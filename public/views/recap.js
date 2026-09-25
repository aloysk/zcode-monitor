'use strict';
// views/recap.js — 「回顾」：周/月/年叙事回顾（ecosystem-round2-batch2 C7，
// 规格 §2.3 需求 4）。数据面：/api/recap?period=week|month|year（T6 查询族 +
// 路由）——本视图纯渲染，不自行聚合。
// 口径钉：
//   - 活跃时长（active hours）：week/month＝事件级——model_usage 行投 5 分钟桶、
//     跨会话去重（并行会话同桶只计一次）；year＝会话区间并集上界（含挂机时间，
//     activity.caliber 披露档别）。口径全文见 how.js「active hours」段与
//     docs/usage-accounting.md §13。
//   - token＝SUM(computed_total_tokens) 官方预计算权威值；year 档 token 类字段
//     null——30 天保留外无数据源，不伪造 0（'—' 呈现，「token 峰值日」要点
//     不渲染不占位）。
//   - 覆盖披露常驻：token/请求维度自 meta.token_coverage_from（三元 max）起
//     可读；日桶自覆盖起点对齐的本地自然日起生成，更早日期不产出桶行（数据
//     不可读≠零活动），柱状不从左邻插值（与覆盖披露卡对齐）。
//   - 环比仅 week 档（token+活动两维）；month/year 注明原因（30 天保留下前一
//     周期完整数据不可保证）。
// 形态锚点：registerView IIFE / 工具栏选择器与失败兜底 = views/usage.js；
// 主题切换重绘 = attribution.js（zc-theme-changed 事件、缓存数据纯重渲不发新
// 请求）；柱状条 = 嵌套 div 零图表库（attribution 火焰图同款纪律）。日桶
// sparkline 为期界日桶条——week 档恰 8 桶（期首对齐日至今天）；上游 ccstory
// 的「8 周 sparkline」在 30 天保留 + cap 治理下无 8 周 token 数据面，按规格
// §2.3 需求 4「日桶 sparkline」语义落地为期界条（规格单一权威）。
// 新文件全文禁硬编码色值（颜色一律 cssVar(--cat-*/--chart-*/--sev-*)，C7-6
// 契约）；空态一律经 window.ZC.emptyState（C9-3 共享组件）。
(function () {
  const { registerView, $, fmtInt, fmtNum, escapeHtml, getJSON, loading, cssVar } = window.ZC;

  let themeHandler = null;
  let st = null; // { period, data }

  // 渲染防护（usage.js setHtml 先例）：load 在途时视图可能已被切走，选择器
  // 落空即自弃，防旧视图的迟到响应覆写新视图。
  function setHtml(sel, html) {
    const el = $(sel);
    if (el) el.innerHTML = html;
    return !!el;
  }

  // 分钟数显示：<60 显「N 分钟」，否则 Xh Ym（fmtDur 吃秒、此处吃分钟，语义不同）。
  function fmtMin(m) {
    if (m == null) return '—';
    if (m < 60) return m + ' 分钟';
    const h = Math.floor(m / 60), mm = m % 60;
    return h + 'h' + (mm ? ' ' + mm + 'm' : '');
  }

  // 日桶日期串（YYYY-MM-DD，服务端按注入 tz 的本地日界生成）→ 「M/D」短显示。
  function fmtDay(s) { return +s.slice(5, 7) + '/' + +s.slice(8, 10); }

  // ISO 时刻 → 浏览器本地日期串（覆盖起点对齐服务器本地日界；面板与库同机，
  // 两口径一致）。
  function fmtIsoDate(iso) {
    const t = new Date(iso);
    return isNaN(t) ? String(iso) : t.getFullYear() + '-' +
      String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  }

  async function view() {
    // remove any prior theme listener so re-entry doesn't stack handlers
    if (themeHandler) window.removeEventListener('zc-theme-changed', themeHandler);
    st = { period: 'week', data: null };

    $('#root').innerHTML = `
      <div class="view max">
        <div class="toolbar">
          <h1>回顾</h1>
          <span class="muted" style="font-size:12px">活跃时长＝5 分钟桶跨会话去重 · 覆盖边界见「覆盖与口径」卡</span>
          <div class="spacer"></div>
          <select id="recap-period">
            <option value="week" selected>近一周</option>
            <option value="month">本月</option>
            <option value="year">今年</option>
          </select>
          <button class="btn ghost" id="recap-refresh">↻ 刷新</button>
        </div>

        <div class="kpis" id="recap-totals">${loading()}</div>

        <h2>本期要点 <span class="sub" id="recap-highlights-sub"></span></h2>
        <div class="card" id="recap-highlights">${loading()}</div>

        <h2>日桶走势 <span class="sub" id="recap-spark-sub"></span></h2>
        <div class="card" id="recap-spark">${loading()}</div>

        <h2>Top focus（按目录） <span class="sub" id="recap-focus-sub"></span></h2>
        <div class="card tight" style="overflow-x:auto" id="recap-focus">${loading()}</div>

        <h2>环比 <span class="sub" id="recap-compare-sub"></span></h2>
        <div class="card" id="recap-compare">${loading()}</div>

        <h2>覆盖与口径 <span class="sub">诚实边界，常驻披露</span></h2>
        <div class="card" id="recap-coverage">${loading()}</div>
      </div>
    `;

    $('#recap-refresh').onclick = load;
    $('#recap-period').onchange = load;
    await load();

    // 主题切换重绘：柱色/基线是渲染期 cssVar 读值，主题翻转后从缓存数据纯重渲
    //（attribution.js 对 zc-theme-changed 的既有响应形态，不发新请求）。
    themeHandler = () => { if (st && st.data) render(); };
    window.addEventListener('zc-theme-changed', themeHandler);
  }

  // 取数失败兜底（usage.js failCard 同款出口形态）：load 由刷新按钮/期别选择器
  // 触发、不经 route() 的 try/catch——不兜底即未处理 rejection + 旧期别数据
  // 静默挂新期别标签。totals 区写共享空态组件错误卡，其余区块/副行清空。
  function failCard(msg) {
    setHtml('#recap-totals', window.ZC.emptyState('model_usage', msg));
    for (const sel of ['#recap-highlights', '#recap-spark', '#recap-focus', '#recap-compare', '#recap-coverage']) {
      setHtml(sel, '');
    }
    for (const sel of ['#recap-highlights-sub', '#recap-spark-sub', '#recap-focus-sub', '#recap-compare-sub']) {
      const el = $(sel);
      if (el) el.textContent = '';
    }
  }

  async function load() {
    const p = $('#recap-period') ? $('#recap-period').value : 'week';
    st.period = p;
    // 先置 loading 再发请求（usage.js F-败-1 评审钉）：杜绝取数在途时旧期别
    // 数据挂新期别标签的不实内容。
    for (const sel of ['#recap-totals', '#recap-highlights', '#recap-spark', '#recap-focus', '#recap-compare', '#recap-coverage']) {
      setHtml(sel, loading());
    }
    let data;
    try {
      data = await getJSON('/api/recap?period=' + encodeURIComponent(p));
    } catch (e) {
      console.warn('[recap] 取数失败', e);
      failCard('取数失败——稍后点「↻ 刷新」重试；详情见控制台。');
      return;
    }
    st.data = data;
    render();
  }

  function render() {
    if (!st.data) return;
    renderTotals(st.data);
    renderHighlights(st.data);
    renderSpark(st.data);
    renderFocus(st.data);
    renderCompare(st.data);
    renderCoverage(st.data);
  }

  // KPI 行：活跃时长（caliber 双档披露）/峰值并行（「N× parallel」）/token
  //（year '—' 不伪造）/模型请求（错误 sev-err 条件色）/活跃天数。
  function renderTotals(data) {
    const a = data.activity || {};
    const days = data.days || [];
    const tokens = data.period === 'year' ? null : days.reduce((s, d) => s + (d.tokens || 0), 0);
    const calls = days.reduce((s, d) => s + (d.calls || 0), 0);
    const errors = days.reduce((s, d) => s + (d.errors || 0), 0);
    const activeDays = days.filter(d => (d.active_minutes || 0) > 0).length;
    const isSpan = a.caliber === 'session_span_union';
    setHtml('#recap-totals', `
      <div class="kpi"><div class="label">活跃时长</div><div class="value v-accent">${fmtMin(a.active_minutes)}</div>
        <div class="delta">${isSpan ? '会话区间并集上界（含挂机时间）' : '5 分钟桶跨会话去重'}<span class="caliber" title="活跃时长口径双档：周/月＝事件级（每次模型请求投 5 分钟桶、并行会话同桶只计一次）；年＝session 区间并集上界——详见「运行原理」页 active hours 段">口径</span></div></div>
      <div class="kpi"><div class="label">峰值并行</div><div class="value">${a.parallel_max == null ? '—' : a.parallel_max + '×'}</div>
        <div class="delta">${a.parallel_avg == null ? '年档区间并集无桶结构，不派生' : '平均 ' + a.parallel_avg + '× 并行（桶内并行会话数）'}</div></div>
      <div class="kpi"><div class="label">token 消耗</div><div class="value">${tokens == null ? '—' : fmtNum(tokens)}</div>
        <div class="delta">${tokens == null ? '30 天保留外无数据源，不伪造' : 'SUM(computed_total_tokens) 覆盖内合计'}</div></div>
      <div class="kpi"><div class="label">模型请求</div><div class="value">${fmtInt(calls)}</div>
        <div class="delta"><span style="${errors ? 'color:var(--sev-err)' : ''}">错误 ${fmtInt(errors)}</span> · 覆盖内全部行</div></div>
      <div class="kpi"><div class="label">活跃天数</div><div class="value">${fmtInt(activeDays)}</div>
        <div class="delta">覆盖 ${fmtInt(days.length)} 天（自覆盖起点起）</div></div>
    `);
  }

  // 本期要点：week/month 三要点（最活跃日/token 峰值日/错误计数日）；year 降级
  // 两要点——token 类 null 时「token 峰值日」不存在，不渲染不占位（规格
  // §2.3 需求 4 钉）。覆盖内全零 → 整卡空态（不编造「最平稳的一天」类叙事）。
  function renderHighlights(data) {
    const days = data.days || [];
    const sub = $('#recap-highlights-sub');
    if (sub) sub.textContent = data.period === 'year'
      ? '两要点 · 年档 token 维不可读，「token 峰值日」不渲染'
      : '三要点 · 覆盖内日桶派生';
    let best = null, tok = null, err = null, errTotal = 0;
    for (const d of days) {
      if ((d.active_minutes || 0) > 0 && (!best || d.active_minutes > best.active_minutes)) best = d;
      if (data.period !== 'year' && (d.tokens || 0) > 0 && (!tok || d.tokens > tok.tokens)) tok = d;
      errTotal += d.errors || 0;
      if ((d.errors || 0) > 0 && (!err || d.errors > err.errors)) err = d;
    }
    if (!best) {
      setHtml('#recap-highlights', window.ZC.emptyState('model_usage',
        '本期覆盖内无活动记录——换一档期别，或等 ZCode 产生新请求后刷新。'));
      return;
    }
    const items = [
      `最活跃日 <b>${fmtDay(best.date)}</b> —— 活跃 ${fmtMin(best.active_minutes)}（当日峰值并行 ${best.parallel_max || 0}×）`,
    ];
    if (tok) items.push(`token 峰值日 <b>${fmtDay(tok.date)}</b> —— ${fmtNum(tok.tokens)} tok · ${fmtInt(tok.calls)} 次调用`);
    items.push(err
      ? `错误最多日 <b>${fmtDay(err.date)}</b> —— ${fmtInt(err.errors)} 个（本期共 ${fmtInt(errTotal)} 个）`
      : `错误 <b>0</b> 个 —— 本期覆盖内无错误行`);
    setHtml('#recap-highlights', `<ul style="margin:0;padding-left:18px;color:var(--fg-2);font-size:12.5px;line-height:1.9">${items.map(t => `<li>${t}</li>`).join('')}</ul>`);
  }

  // 日桶 sparkline：嵌套 div 条带零图表库（attribution 同款纪律）。柱高＝当日
  // 活跃分钟（全期别可得、never null——token 在年档为 null 不能当柱高度量），
  // 逐柱 title 携带 tokens/calls/并行。无桶日期不在服务端 days 序列里（覆盖前
  // 不产桶行）——视图只渲染序列本身，不从左邻插值（与覆盖披露卡对齐）。柱色
  // 经 cssVar 读取，主题翻转由 themeHandler 纯重渲换色。
  function renderSpark(data) {
    const days = data.days || [];
    const sub = $('#recap-spark-sub');
    if (sub) {
      sub.textContent = days.length
        ? `${days[0].date} ~ ${days[days.length - 1].date} · 柱高＝当日活跃分钟（5 分钟桶跨会话去重）· 悬停看逐日明细`
        : '';
    }
    if (!days.length) {
      setHtml('#recap-spark', window.ZC.emptyState('model_usage', '期内无可读日桶——服务端未返回日桶序列。'));
      return;
    }
    const TRACK = 44;
    const maxMin = Math.max(...days.map(d => d.active_minutes || 0), 1);
    const bars = days.map(d => {
      const v = d.active_minutes || 0;
      const h = v > 0 ? Math.max(2, Math.round(v / maxMin * TRACK)) : 0;
      const tip = `${d.date} · 活跃 ${fmtMin(v)} · 峰值并行 ${d.parallel_max || 0}`
        + (d.tokens != null ? ` · ${fmtNum(d.tokens)} tok` : '')
        + ` · ${fmtInt(d.calls)} 次调用`;
      return `<div title="${escapeHtml(tip)}" style="flex:1 1 0;min-width:0;height:${h}px;background:${cssVar('--cat-llm')};border-radius:1px 1px 0 0"></div>`;
    }).join('');
    setHtml('#recap-spark', `
      <div style="display:flex;align-items:flex-end;gap:1px;height:${TRACK}px;border-bottom:1px solid ${cssVar('--chart-grid')}">${bars}</div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10.5px;color:${cssVar('--chart-tick')}">
        <span>${days[0].date}</span><span>${days[days.length - 1].date}</span>
      </div>`);
  }

  // Top focus：按 directory 聚合表（tokens/calls/sessions/去重活跃分钟，服务端
  // 归并排序）。directory=null 是真值域形态（无 session 表行的会话）——faint
  // 呈现不隐藏。year 档 top_focus=null：该面不适用（排序键本身是 token，伪值
  // 即伪序），卡片内注明而非静默消失。
  function renderFocus(data) {
    const sub = $('#recap-focus-sub');
    if (data.top_focus === null) {
      if (sub) sub.textContent = '';
      setHtml('#recap-focus', `<p class="muted" style="margin:0;font-size:12.5px">年档不提供 Top focus——token 归因在官方 30 天保留窗外无数据源（排序键本身是 token，伪值即伪序），不伪造。</p>`);
      return;
    }
    const rows = data.top_focus || [];
    if (sub) sub.textContent = rows.length
      ? `${rows.length} 个目录 · 按 token 降序 · 活跃分钟＝目录级跨会话去重 5 分钟桶`
      : '';
    if (!rows.length) {
      setHtml('#recap-focus', window.ZC.emptyState('model_usage',
        '期内无目录级聚合记录——窗口内无模型调用行，或会话均未记录 directory。'));
      return;
    }
    setHtml('#recap-focus', `<table>
      <thead><tr><th class="num">#</th><th>目录</th><th class="num">token</th><th class="num">调用</th><th class="num">会话</th><th class="num">活跃分钟</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td class="mono">${r.directory ? escapeHtml(r.directory) : '<span class="faint">（未记录目录）</span>'}</td>
        <td class="num">${fmtNum(r.tokens)}</td>
        <td class="num">${fmtInt(r.calls)}</td>
        <td class="num">${fmtInt(r.sessions)}</td>
        <td class="num">${fmtInt(r.active_minutes)}</td>
      </tr>`).join('')}</tbody></table>`);
  }

  // 环比（仅 week 档，token+活动两维）：delta_pct null＝上一窗无数据（服务端
  // 不伪造 ±Infinity）——faint 注明不可算，不显示 0%。
  function renderCompare(data) {
    const sub = $('#recap-compare-sub');
    if (data.period !== 'week') {
      if (sub) sub.textContent = '';
      setHtml('#recap-compare', `<p class="muted" style="margin:0;font-size:12.5px">${data.period === 'month' ? '月' : '年'}档不提供环比——官方 30 天保留下前一周期完整数据不可保证（月末请求时上一周期必缺、月初请求时仅部分仍在窗内），诚实起见仅周档显示环比。</p>`);
      return;
    }
    if (sub) sub.textContent = '上一期 vs 本期（各 7 天，事件级口径）';
    const c = data.comparison || {};
    setHtml('#recap-compare', `
      ${compareRow('token 消耗', c.tokens, fmtNum)}
      ${compareRow('活跃时长', c.active_minutes, fmtMin)}`);
  }

  function compareRow(label, m, fmt) {
    if (!m) return '';
    const delta = m.delta_pct == null
      ? '<span class="faint">上一窗无数据，环比不可算</span>'
      : `<b>${m.delta_pct >= 0 ? '+' : '−'}${Math.abs(m.delta_pct)}%</b>`;
    return `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--border-soft);font-size:12.5px">
      <span style="color:var(--fg-2)">${label}</span>
      <span class="num">${fmt(m.previous)} → <b style="color:var(--fg-1)">${fmt(m.current)}</b>　${delta}</span>
    </div>`;
  }

  // 覆盖披露卡（常驻，规格 §2.3 需求 3 口径义务）：三元 max 覆盖起点 + 30 天
  // 保留 + cap 申报（meta.scope 照录，usage 族同款形态）+ 年档活动上界口径 +
  // 日桶生成边界（不伪造 0 桶、不插值）。
  function renderCoverage(data) {
    const meta = data.meta || {};
    const isSpan = (data.activity || {}).caliber === 'session_span_union';
    const bits = [
      `token/请求维度自 <b>${fmtIsoDate(meta.token_coverage_from)}</b> 起可读（官方 30 天保留${meta.scope ? '；本档宽窗候选集钳制 <span class="mono">' + escapeHtml(meta.scope) + '</span>——读数上限以该申报为准，实际覆盖起点如上' : ''}）。`,
    ];
    if (isSpan) {
      bits.push('年档活动时长为会话区间并集<b>上界口径（含挂机时间）</b>；日桶的活跃分钟仍为 5 分钟事件桶口径。');
    }
    bits.push('日桶序列自覆盖起点对齐的本地自然日起生成——更早的日期不产出桶行（数据不可读≠零活动），柱状不从左邻插值。');
    setHtml('#recap-coverage', `<p style="font-size:12.5px;line-height:1.9;margin:0;color:var(--fg-2)">${bits.join('<br>')}</p>`);
  }

  registerView('recap', view);
})();
