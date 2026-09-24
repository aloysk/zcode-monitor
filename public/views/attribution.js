'use strict';
// views/attribution.js — 「Token 归因」：token 和时间都去哪了（嵌套 div 宽度
// 布局火焰图，零图表库——ecosystem-round2-batch1 C5，规格 §2.3 需求 3）。
// 数据面：/api/usage/attribution?window=&level=session|turn&session_id=
// （T2 查询族 + T3 路由）——本视图纯渲染，不自行聚合。
// 口径钉：
//   - 窗口读数上限 30 天（ZCode 官方 USAGE_RETENTION_DAYS=30 保留期，本机实测
//     三表 prune 生效）。
//   - token = SUM(computed_total_tokens)（官方预计算权威值）；帧宽 = 该行 token
//     占已显示行合计的份额（截断时服务端 meta.truncated 如实标注，本视图照录
//     「仅前 N 项（被裁）」，不静默）。
//   - 30d 档 session 层走 rowid 尾部候选集钳制（事件循环红线），服务端 meta.scope
//     如实申报——本视图照录该 scope 说明（usage.js 同款形态）。
//   - turn 层是会话内全量分解（无窗口语义）：窗口选择器只治理会话层，切窗即回
//     会话层，避免「窗口变了但 turn 层读数不变」的假联动。
// 形态锚点：registerView IIFE / 工具栏窗口选择器 = views/overview.js 与
// views/usage.js；下钻 hash 直链 = sessions.js 子代理表「打开 →」形态；
// 主题切换 = zc-theme-changed 事件重绘（rethemeCharts 派发的既有形态——色带
// 渲染期经 cssVar 读取，翻转后从缓存数据纯重渲，不发新请求）。
// 新文件全文禁硬编码色值（颜色一律 cssVar(--cat-*/--chart-*) 读取，C5-3 契约）；
// 空态一律经 window.ZC.emptyState（C9-3 共享组件）。
(function () {
  const { registerView, $, fmtInt, fmtNum, fmtDur, escapeHtml, shortId, getJSON,
          pct, loading, cssVar } = window.ZC;

  // 帧底色轮转带：存 CSS 变量名、渲染期经 cssVar 取值（主题切换重绘自动换带；
  // 按行序轮转——归因排名无语义色，rank 即区分度）。
  const FRAME_COLORS = ['--cat-conversation', '--cat-llm', '--cat-tool', '--cat-usage',
                        '--cat-network', '--cat-llm-2', '--cat-tool-2', '--cat-lifecycle'];
  // by_query_source 固定色映射（五值域：30d 窗实测 subagent/main_turn/
  // workflow_child/compact/session_title；未知键兜底 --cat-network——库内
  // query_source 是开放值域，新来源不猜语义只换兜底色）。子层宽度 = 该来源
  // token 占本会话 token 的份额（嵌套第二层，与帧层同款宽度语义）。
  const SRC_META = {
    main_turn:      '--cat-conversation',
    subagent:       '--cat-llm',
    workflow_child: '--cat-llm-2',
    compact:        '--cat-tool',
    session_title:  '--cat-tool-2',
  };

  let themeHandler = null;
  let st = null; // { level, window, sessionId, sessionTitle, data }

  // 渲染防护（usage.js setHtml 先例）：异步回调在途时视图可能已被切走，
  // 选择器落空即自弃，防旧视图的迟到响应覆写新视图。
  function setHtml(sel, html) {
    const el = $(sel);
    if (el) el.innerHTML = html;
    return !!el;
  }

  async function view() {
    // remove any prior theme listener so re-entry doesn't stack handlers
    if (themeHandler) window.removeEventListener('zc-theme-changed', themeHandler);
    st = { level: 'session', window: '24h', sessionId: null, sessionTitle: null, data: null };

    $('#root').innerHTML = `
      <div class="view max">
        <div class="toolbar">
          <h1>Token 归因</h1>
          <span class="muted" style="font-size:12px">窗口读数上限 30 天（ZCode 保留期，三表 prune 实测生效）</span>
          <div class="spacer"></div>
          <button class="btn ghost" id="attr-back" hidden>← 返回会话层</button>
          <select id="attr-window">
            <option value="24h" selected>近 24 小时</option>
            <option value="7d">近 7 天</option>
            <option value="30d">近 30 天</option>
          </select>
          <button class="btn ghost" id="attr-refresh">↻ 刷新</button>
        </div>

        <h2>火焰图 <span class="sub" id="attr-sub"></span></h2>
        <div class="card" id="attr-flame-card">${loading()}</div>

        <div id="attr-detail-sec">
          <h2>明细 <span class="sub" id="attr-table-sub"></span></h2>
          <div class="card tight" style="overflow-x:auto" id="attr-detail">${loading()}</div>
        </div>
      </div>
    `;

    $('#attr-refresh').onclick = reload;
    $('#attr-window').onchange = () => { st.level = 'session'; st.sessionId = null; reload(); };
    $('#attr-back').onclick = () => { st.level = 'session'; st.sessionId = null; reload(); };
    // 帧点击代理（容器级单监听）：帧内 <a>（会话详情/turns 直链）走默认 hash
    // 导航不拦截；其余点击命中帧即下钻该会话的回合层。
    $('#attr-flame-card').addEventListener('click', e => {
      if (e.target.closest('a')) return;
      const f = e.target.closest('[data-sid]');
      if (!f) return;
      drill(f.dataset.sid, f.dataset.title || '');
    });

    await reload();

    // 主题切换重绘：色带是渲染期 cssVar 读值，主题翻转后从缓存数据纯重渲
    // （overview 图表对 zc-theme-changed 的既有响应形态）。
    themeHandler = () => { if (st && st.data) render(); };
    window.addEventListener('zc-theme-changed', themeHandler);
  }

  async function reload() {
    st.window = $('#attr-window') ? $('#attr-window').value : st.window;
    setHtml('#attr-flame-card', loading());
    setHtml('#attr-detail', loading());
    const q = st.level === 'turn' && st.sessionId
      ? `window=${st.window}&level=turn&session_id=${encodeURIComponent(st.sessionId)}`
      : `window=${st.window}&level=session`;
    // 先取数后改状态：请求失败（抛给 route 的 errorCard）时保留旧层旧数据可回退。
    const data = await getJSON('/api/usage/attribution?' + q);
    st.data = data;
    if (data.level === 'session') {
      st.level = 'session'; st.sessionId = null; st.sessionTitle = null;
    }
    render();
  }

  async function drill(sid, title) {
    if (!sid) return;
    setHtml('#attr-flame-card', loading('下钻回合层…'));
    setHtml('#attr-detail', loading());
    const data = await getJSON(`/api/usage/attribution?window=${st.window}&level=turn&session_id=${encodeURIComponent(sid)}`);
    st.level = 'turn'; st.sessionId = sid; st.sessionTitle = title; st.data = data;
    render();
  }

  function render() {
    const back = $('#attr-back');
    if (back) back.hidden = st.level !== 'turn';
    renderFlame();
    renderTable();
  }

  // 火焰图本体：外层容器 100% 宽、帧层 style width:X%（X = token 份额）——
  // 嵌套 div 宽度布局，零图表库。session 层帧内再嵌 by_query_source 子条
  // （第二层宽度布局）。hover 载荷（token/耗时/占比）经 title 与 data-* 双载。
  function renderFlame() {
    const rows = (st.data && st.data.rows) || [];
    const total = rows.reduce((a, r) => a + (r.tokens || 0), 0);
    const meta = (st.data && st.data.meta) || {};

    // 副行：层标识 + 诚实截断/钳制申报 + 交互指引。
    const sub = $('#attr-sub');
    if (sub) {
      const bits = [];
      if (st.level === 'turn') {
        bits.push(`turn 层 · 会话 ${shortId(st.sessionId, 12)} · ${rows.length} 个回合 · 点击帧打开该会话 Turns 标签`);
      } else {
        bits.push(`session 层 · ${rows.length} 个会话 · 点击帧下钻回合层，帧下 ↗ 直达会话详情`);
      }
      if (meta.truncated) bits.push(`仅前 ${rows.length} 项（被裁）`);
      if (meta.scope) bits.push(`${meta.scope}（宽窗候选集钳制，读数上限=最新 20 万行）`);
      if (total) bits.push(`合计 ${fmtNum(total)} tok`);
      sub.textContent = bits.join(' · ');
    }

    if (!rows.length) {
      setHtml('#attr-flame-card', st.level === 'turn'
        ? window.ZC.emptyState('model_usage', '该会话在保留窗内没有模型调用行——会话可能早于保留窗，或仅含尚未落库的进行中请求。')
        : window.ZC.emptyState('model_usage', '窗口内无模型调用记录——换更宽的窗口，或等 ZCode 产生新请求后刷新。'));
      setHtml('#attr-detail-sec', ''); // 空窗口只留一张空态卡，不出空表头
      return;
    }

    const legendKeys = new Map();
    const frames = st.level === 'turn'
      ? rows.map((r, i) => {
          const share = total ? (r.tokens || 0) / total : 0;
          const color = cssVar(FRAME_COLORS[i % FRAME_COLORS.length]);
          const tip = `turn ${r.turn_id || '(无 turn id)'} · ${fmtNum(r.tokens)} tok · 耗时 ${fmtDur((r.duration_ms_sum || 0) / 1000)} · 占比 ${(share * 100).toFixed(1)}% · 模型 ${fmtInt(r.model_calls)} 次 · 工具 ${fmtInt(r.tool_calls)} 次`;
          // turn 层帧整体是直链：点击 → 会话详情 Turns 标签（hash 路由）。
          return `<a href="#sessions/${encodeURIComponent(st.sessionId)}/turns"
            data-tid="${escapeHtml(r.turn_id || '')}" data-tokens="${r.tokens || 0}" data-dur-ms="${r.duration_ms_sum || 0}" data-share="${(share * 100).toFixed(1)}"
            title="${escapeHtml(tip)}"
            style="flex:0 0 auto;display:block;width:${(share * 100).toFixed(2)}%;min-width:0;text-decoration:none;border-right:1px solid var(--border-soft)">
            <div style="height:26px;border-radius:3px;background:${color}"></div>
            <div class="ctx-sub mono">${r.turn_id ? escapeHtml(shortId(r.turn_id, 12)) : '(无 turn id)'}</div>
          </a>`;
        }).join('')
      : rows.map((r, i) => {
          const share = total ? (r.tokens || 0) / total : 0;
          const color = cssVar(FRAME_COLORS[i % FRAME_COLORS.length]);
          const name = r.title || ('（无标题会话） ' + shortId(r.session_id, 8));
          const tip = `${name} · ${fmtNum(r.tokens)} tok · 耗时 ${fmtDur((r.duration_ms_sum || 0) / 1000)} · 占比 ${(share * 100).toFixed(1)}% · ${fmtInt(r.calls)} 次调用（点击下钻回合层）`;
          // 嵌套第二层：by_query_source 子条（宽 = 该来源 token 占本会话份额）。
          const sessTotal = r.tokens || 0;
          const subStrip = Object.entries(r.by_query_source || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
            const varName = SRC_META[k] || '--cat-network';
            legendKeys.set(k, varName);
            return `<span style="display:block;height:100%;width:${sessTotal ? (v / sessTotal * 100).toFixed(2) : 0}%;background:${cssVar(varName)}"></span>`;
          }).join('');
          const label = r.title || shortId(r.session_id, 10);
          return `<div data-sid="${escapeHtml(r.session_id)}" data-title="${escapeHtml(r.title || '')}"
            data-tokens="${r.tokens || 0}" data-dur-ms="${r.duration_ms_sum || 0}" data-share="${(share * 100).toFixed(1)}"
            title="${escapeHtml(tip)}"
            style="flex:0 0 auto;width:${(share * 100).toFixed(2)}%;min-width:0;cursor:pointer;border-right:1px solid var(--border-soft)">
            <div style="height:26px;border-radius:3px;background:${color};overflow:hidden;display:flex;align-items:flex-end">${subStrip}</div>
            <div class="ctx-sub mono">${escapeHtml(label)} <a href="#sessions/${encodeURIComponent(r.session_id)}" title="打开会话详情">↗</a></div>
          </div>`;
        }).join('');

    // 来源图例（session 层才有语义色；turn 层是排名轮转带，无图例）——文字色
    // 走图表图例通道 --chart-legend（既有 Chart.js 图例同源变量）。
    const legend = st.level === 'session' && legendKeys.size
      ? `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:10px;font-size:11px;color:${cssVar('--chart-legend')}">${[...legendKeys].map(([k, v]) =>
          `<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${cssVar(v)};margin-right:4px;vertical-align:-1px"></span>${escapeHtml(k)}</span>`).join('')}</div>`
      : '';

    setHtml('#attr-flame-card', `
      <div style="display:flex;width:100%;align-items:flex-start;overflow:hidden">${frames}</div>
      ${legend}`);
  }

  // 明细表：帧过窄（50 会话时单帧常 <2%）看不清的兜底读数面；「打开 →」直链
  // 与帧内 ↗ 同款 hash 形态。占比列与帧宽同源（已显示行合计为分母）。
  function renderTable() {
    const rows = (st.data && st.data.rows) || [];
    if (!rows.length) return; // 空窗已在 renderFlame 收口为单张空态卡
    const total = rows.reduce((a, r) => a + (r.tokens || 0), 0);
    const tsub = $('#attr-table-sub');
    if (tsub) tsub.textContent = '按 token 降序 · 占比与帧宽同源（已显示项合计为分母）';

    if (st.level === 'turn') {
      setHtml('#attr-detail', `<table>
        <thead><tr><th class="num">#</th><th>turn</th><th class="num">token</th><th class="num">占比</th>
          <th class="num">耗时</th><th class="num">模型调用</th><th class="num">工具调用</th><th></th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr>
          <td class="num">${i + 1}</td>
          <td class="mono">${r.turn_id ? escapeHtml(shortId(r.turn_id, 24)) : '<span class="faint">(无 turn id)</span>'}</td>
          <td class="num">${fmtNum(r.tokens)}</td>
          <td class="num">${pct(r.tokens, total)}%</td>
          <td class="num">${fmtDur((r.duration_ms_sum || 0) / 1000)}</td>
          <td class="num">${fmtInt(r.model_calls)}</td>
          <td class="num">${fmtInt(r.tool_calls)}</td>
          <td><a href="#sessions/${encodeURIComponent(st.sessionId)}/turns">打开 →</a></td>
        </tr>`).join('')}</tbody></table>`);
      return;
    }

    setHtml('#attr-detail', `<table>
      <thead><tr><th class="num">#</th><th>会话</th><th class="num">token</th><th class="num">占比</th>
        <th class="num">耗时</th><th class="num">调用</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td class="mono">${r.title ? escapeHtml(r.title) : '<span class="faint">（无标题）' + escapeHtml(shortId(r.session_id, 12)) + '</span>'}</td>
        <td class="num">${fmtNum(r.tokens)}</td>
        <td class="num">${pct(r.tokens, total)}%</td>
        <td class="num">${fmtDur((r.duration_ms_sum || 0) / 1000)}</td>
        <td class="num">${fmtInt(r.calls)}</td>
        <td><a href="#sessions/${encodeURIComponent(r.session_id)}">打开 →</a></td>
      </tr>`).join('')}</tbody></table>`);
  }

  registerView('attribution', view);
})();
