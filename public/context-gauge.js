// context-gauge.js — C2 上下文水位组件（ecosystem-round2-batch1 §2.2 需求 4）：
// 占用比 / 逐轮增量 / compact 回落 / unknown 态的纯函数计算 + 渲染 helper。
// 双端导出（pet-state.js UMD 工厂形态）：浏览器经 <script src> 由本文件自身挂
// window.ZC.ContextGauge（挂载责任单点——app.js 不含挂载赋值，C9-3 对 emptyState
// 的同款钉法；加载序须在 app.js 之后——app.js 末行整体重建 window.ZC，先加载
// 会被覆盖）；node --test require 同一份文件直测——测试守护的就是页面实际加载
// 的那份（无构建器，无副本漂移面）。
//
// 口径钉（§2.0 勘误的执行处，db.js Context gauge 区头注的数据面对应物）：
//   - 水位分子 = 逐行 input_tokens（官方语义 input 已含 cache_read；照抄上游
//     「input+cache_read+cache_creation 累计」会 ≈2 倍虚高）；input_tokens=0 的
//     行（error/cancelled 全零行）回退官方 fallback 公式 cache_creation+cache_read
//     （USAGE inputSideTokensFromNormalizedUsage），回退行标 fallback:true，UI 如实
//     标注。SSE model 行载荷不含 cache 两列（live.js recentModelRowsAfterRowid），
//     该缺列形态分子=null——缺列即未知，绝不按 0 计（plan 拍板：JS 语义
//     null/N === 0，仅判 context_tokens 会把缺列行算成 0% 占用）；缺列行不推进
//     水位（currentLevel 维持上一已知读数并标 unavailable）、不参与增量（delta
//     null，下一行相对最近已知分子）。
//   - ratio = (分子 != null && context_tokens) ? +(分子/context_tokens).toFixed(4)
//     : null。窗口值唯一通路：行由路由层经 server/models-meta.js resolve 附带
//     context_tokens（未知模型 → null）。本组件不持有、不复制模型窗口表；
//     ratio=null 即 unknown 态——不显示百分比（不猜窗口）。
//   - 增量 = 当前行分子 − 前一已知分子（首行/分子不可得行 null）；compact 边界
//     后一行为负（压掉的上下文）。
//   - compactDrops：边界行（query_source='compact'）与紧随其后的行——「边界前」
//     = compact 行自身（该次请求读入的就是被压缩前的全部上下文），「边界后」=
//     压缩后首个请求；回落值 = 前后两行占用差（分子差照发——窗口未知时比率侧
//     诚实为 null，token 差是事实不依赖窗口；任一侧分子不可得 → dropTokens null）。
//   - 档位阈值（呈现层分档，数据不因分档改变；与速度 tier 三档同构）：
//     占用 <60% ok / ≥60% warn / ≥85% err——色值一律 var(--sev-ok/warn/err)
//     （styles.css 双主题同源变量），本文件全文禁硬编码色值（C2-5 契约：十六进制
//     字面量、rgb/hsl 函数记法与具名色 0 命中）。渲染 helper 均返回 HTML 字符串：
//     颜色只写 var(--*) 引用（浏览器绘制期解析，主题切换自动生效）——不经
//     window.ZC.cssVar 取值，保 node 侧 require 可直测（getComputedStyle 在
//     node 不存在）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.ZC = root.ZC || {}; root.ZC.ContextGauge = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // escapeHtml 为 app.js:51 同款实现，组件内自带等价副本（empty-state.js 先例：
  // 加载序不可依赖 app.js，转义义务钉在共享组件自身——title/hover 载荷拼库内
  // 字符串，未转义即 XSS 入口）。
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  }

  // token 数缩写（app.js fmtNum 同款算法的本地副本，保双端纯净——node 侧无
  // window.ZC）。仅用于 hover/摘要文案，不参与任何口径计算。
  function fmtTok(n) {
    if (n == null || !isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }

  function pctOf(ratio) { return Math.round(ratio * 100) + '%'; }

  // 时间短格式（hover/摘要用；非法值原样返回，不猜）。
  function fmtClock(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 档位阈值（呈现层分档，见文件头注）：unknown（ratio=null）返回 null——调用方
  // 渲染 unknown 态、不显百分比。
  function severityClass(ratio) {
    if (ratio == null) return null;
    if (ratio < 0.60) return 'ok';
    if (ratio < 0.85) return 'warn';
    return 'err';
  }

  // 逐行分子：input_tokens>0 → input_tokens；否则（DB 行，cache 两列在）回退
  // cache_creation+cache_read（§2.0 勘误回退，标 fallback:true）；cache 两列均
  // undefined/null（SSE live 行缺列形态）→ molecule:null——缺列即未知，绝不按
  // 0 计（plan 拍板；混合形态——仅一列在——按在册列事实值回退）。
  function moleculeOf(r) {
    if ((r.input_tokens || 0) > 0) return { molecule: r.input_tokens, fallback: false };
    if (r.cache_creation_input_tokens == null && r.cache_read_input_tokens == null) {
      return { molecule: null, fallback: false };
    }
    const fb = (r.cache_creation_input_tokens || 0) + (r.cache_read_input_tokens || 0);
    return { molecule: fb, fallback: true };
  }

  const isBoundary = r => r.compact_boundary === true || r.query_source === 'compact';

  // 核心纯函数：token 序列 → 水位序列。输入行形状 = GET /api/sessions/:id/
  // context-gauge 的行（context_tokens 由路由层经 models-meta 附带；unknown →
  // null）或视图层补窗后的 SSE model 行。输出逐行 {…原行, molecule, fallback,
  // ratio, delta, compact_boundary}。分子不可得行（molecule:null）delta=null 且
  // 不作下一行的增量基准（下一行相对最近已知分子——缺列行不参与增量，绝不
  // 按 0 计出大负值）。
  function computeGaugeSeries(rows) {
    const src = Array.isArray(rows) ? rows : [];
    const out = [];
    let prevMolecule = null; // 最近已知分子（缺列行跳过，不进基准）
    for (let i = 0; i < src.length; i++) {
      const r = src[i] || {};
      const { molecule, fallback } = moleculeOf(r);
      const ratio = molecule != null && r.context_tokens
        ? +((molecule / r.context_tokens).toFixed(4)) : null;
      const delta = molecule != null && prevMolecule != null ? molecule - prevMolecule : null;
      if (molecule != null) prevMolecule = molecule;
      out.push({
        ...r,
        molecule, fallback, ratio, delta,
        compact_boundary: isBoundary(r),
      });
    }
    return out;
  }

  // compact 边界前后回落（回落摘要数据）：边界行=「前」（读入被压缩前全部上下文
  // 的那次请求），紧随后一行=「后」。前后两行占用差即回落值；任一侧窗口未知
  // （ratio=null）→ drop=null（不猜），dropTokens 仍照发（token 差是事实）。
  // 边界是序列末行（压缩后尚无新请求）→ 不产出该条（无「后」可对比）。
  function compactDrops(series) {
    const drops = [];
    for (let i = 0; i < series.length; i++) {
      if (!series[i].compact_boundary) continue;
      const after = series[i + 1];
      if (!after) continue;
      const before = series[i];
      drops.push({
        index: i,
        at: before.started_at || null,
        before: before.ratio,
        after: after.ratio,
        drop: before.ratio != null && after.ratio != null
          ? +((before.ratio - after.ratio).toFixed(4)) : null,
        dropTokens: before.molecule != null && after.molecule != null
          ? before.molecule - after.molecule : null,
      });
    }
    return drops;
  }

  // 当前水位（live 水位条数据）：取末行分子；末行分子不可得（SSE 缺列行）→
  // 不推进水位——回退最近已知分子读数并标 unavailable:true（plan 拍板「水位条
  // 维持上一已知读数并如实标注」，绝不按 0 计；全序列无已知分子 → 分子 null）。
  // 窗口从未行起向前取最近一个非空 context_tokens（「会话内模型切换以最新种子
  // 行为准」——SSE 行不带窗口字段，视图层补窗后此处直接命中末行自身；此处
  // 兜底扫描保未补窗消费面的语义）。
  function currentLevel(series) {
    if (!series || !series.length) {
      return { molecule: null, window: null, ratio: null, severity: null,
               fallback: false, compact_boundary: false, unavailable: false };
    }
    let window = null;
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].context_tokens != null) { window = series[i].context_tokens; break; }
    }
    const last = series[series.length - 1];
    let molecule = last.molecule;
    if (molecule == null) {
      for (let i = series.length - 2; i >= 0; i--) {
        if (series[i].molecule != null) { molecule = series[i].molecule; break; }
      }
    }
    const ratio = molecule != null && window ? +((molecule / window).toFixed(4)) : null;
    return { molecule, window, ratio, severity: severityClass(ratio),
             fallback: last.fallback, compact_boundary: last.compact_boundary,
             unavailable: last.molecule == null };
  }

  // SSE live 行防重叠闸（sessions.js startGaugeLive 消费）：SSE 连接建立晚于
  // 种子查询，(连接, 查询] 间落库的行会经流重放——以末种子行 started_at 为闸，
  // 早于等于它的重复行跳过（双计污染增量曲线）。比较是 ISO 字符串字典序
  // （种子与 SSE 行同经 db.js ts() ISO 化，同格式字典序=时序）；任一侧时间戳
  // 缺失 → 兜底接受（无法判序时不丢行）。
  function shouldAcceptLiveRow(lastSeedAt, row) {
    if (!lastSeedAt || !row || !row.started_at) return true;
    return row.started_at > lastSeedAt;
  }

  // 水位条（Context 标签大条）。ratio=null → unknown 态：空轨道 + 「—」，
  // 不显百分比（不猜窗口）。opts.title 附加 hover 说明。
  function gaugeBarHtml(ratio, opts = {}) {
    const sev = severityClass(ratio);
    const known = ratio != null;
    const width = known ? Math.min(100, Math.round(ratio * 100)) : 0;
    const label = known ? pctOf(ratio) : '—';
    const title = escapeHtml(opts.title || '');
    const fill = known
      ? `<span style="display:block;height:100%;width:${width}%;background:var(--sev-${sev})"></span>`
      : '';
    return `<div style="display:flex;align-items:center;gap:10px" title="${title}">
      <div style="flex:1;height:12px;border-radius:4px;background:var(--surface-3);overflow:hidden">${fill}</div>
      <span class="mono" style="font-size:12px;color:var(--fg-3);font-variant-numeric:tabular-nums">${label}${known ? '' : '<span class="faint"> 未知窗口</span>'}</span>
    </div>`;
  }

  // sessions 列表 mini 水位条（C2-4）：inputTokens=null → 返回 ''（不渲染，
  // 调用方另有「无 model 行不渲染」分支）；contextTokens=null（未知模型）→
  // 条可渲染但不显百分比。「非官方权威」标注挂 title（窗口是静态整理表）。
  function miniGaugeHtml(inputTokens, contextTokens, opts = {}) {
    if (inputTokens == null) return '';
    const ratio = contextTokens ? +((inputTokens / contextTokens).toFixed(4)) : null;
    const known = ratio != null;
    const sev = severityClass(ratio);
    const width = known ? Math.min(100, Math.round(ratio * 100)) : 0;
    const title = escapeHtml('上下文水位（非官方权威：窗口值为静态整理表）'
      + (opts.title ? ' · ' + opts.title : ''));
    const fill = known
      ? `<span style="display:block;height:100%;width:${width}%;background:var(--sev-${sev})"></span>`
      : '';
    // 外层 inline-flex：flex 缺省不换行（轨+标签不折行）。有意不设文本换行
    // CSS 属性——其属性名前缀会撞具名色名单的机检（C2-5 判据，故意绕开）。
    return `<span class="mono" title="${title}" style="display:inline-flex;gap:4px;align-items:center">
      <span style="display:inline-block;width:44px;height:5px;border-radius:3px;background:var(--surface-3);overflow:hidden;vertical-align:middle">${fill}</span>
      <span style="font-size:10.5px;color:var(--fg-4);font-variant-numeric:tabular-nums">${known ? pctOf(ratio) : '—'}</span>
    </span>`;
  }

  // 逐轮增量曲线（零图表库，div 条形）：中线为基线，向上=增长、向下=回落；
  // compact 边界列叠竖线。列高按 |delta|/maxAbs 比例（首行 delta=null → 空列）。
  // 高度/宽度只有数字与 var(--*) 引用，无硬编码色值（C2-5）。
  function deltaCurveHtml(series, opts = {}) {
    if (!series || !series.length) return '';
    let maxAbs = 1;
    for (const p of series) if (p.delta != null) maxAbs = Math.max(maxAbs, Math.abs(p.delta));
    const H = opts.heightPx || 56;
    const cols = series.map((p, i) => {
      const bits = [`#${i + 1}`, fmtClock(p.started_at)];
      if (p.model_id) bits.push(String(p.model_id));
      bits.push(`分子 ${fmtTok(p.molecule)} tok`);
      // 增量三态：分子不可得（缺列行，与首行同为 delta=null 但语义不同）→
      // 「分子不可得」；首行（有分子无前值）→「首行」；否则数值。
      bits.push(p.molecule == null ? '增量 —（分子不可得）'
        : p.delta == null ? '增量 —（首行）'
        : `增量 ${p.delta >= 0 ? '+' : ''}${fmtTok(p.delta)} tok`);
      if (p.molecule == null) bits.push('分子不可得（缺 cache 列，不按 0 计）');
      else if (p.fallback) bits.push('回退行（input=0，以 cache 两列估算）');
      if (p.compact_boundary) bits.push('compaction 边界');
      let bar = '';
      if (p.delta != null && p.delta !== 0) {
        const h = Math.max(2, Math.round(Math.abs(p.delta) / maxAbs * 100) / 2); // 半高百分数（0-50）
        const pos = p.delta > 0;
        bar = `<div style="position:absolute;left:25%;right:25%;${pos ? 'bottom:50%' : 'top:50%'};height:${h}%;background:var(--${pos ? 'cat-llm' : 'cat-tool-2'})"></div>`;
      }
      const vline = p.compact_boundary
        ? `<div title="compaction 边界" style="position:absolute;top:0;bottom:0;left:50%;width:2px;background:var(--sev-warn)"></div>`
        : '';
      return `<div title="${escapeHtml(bits.join(' · '))}" style="flex:1 1 0;min-width:0;position:relative;height:100%">${bar}${vline}</div>`;
    }).join('');
    return `<div style="position:relative;display:flex;align-items:stretch;height:${H}px;border:1px solid var(--border-soft);border-radius:4px;overflow:hidden">
      <div style="position:absolute;left:0;right:0;top:50%;height:1px;background:var(--border)"></div>
      ${cols}
    </div>`;
  }

  // 水位回落摘要（compact 前后占用对比）：每边界一行；比率侧任一未知 → 「—」，
  // token 差照发（事实不依赖窗口）。
  function dropSummaryHtml(drops) {
    if (!drops || !drops.length) return '';
    const lines = drops.map(d => {
      const b = d.before != null ? pctOf(d.before) : '—';
      const a = d.after != null ? pctOf(d.after) : '—';
      const pctDrop = d.drop != null ? `（回落 ${(d.drop * 100).toFixed(1)} 个百分点）` : '';
      return `<div class="mono" style="font-size:11px;color:var(--fg-3)">
        ⌘ ${escapeHtml(fmtClock(d.at))} compaction 回落：${b} → ${a}${pctDrop} · 压掉 ${fmtTok(d.dropTokens)} tok
      </div>`;
    }).join('');
    return `<div style="margin-top:8px;display:flex;flex-direction:column;gap:3px">${lines}</div>`;
  }

  return {
    computeGaugeSeries, compactDrops, currentLevel, severityClass,
    gaugeBarHtml, miniGaugeHtml, deltaCurveHtml, dropSummaryHtml,
    shouldAcceptLiveRow,
  };
});
