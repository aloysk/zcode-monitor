'use strict';
// views/overview.js — real-time monitoring dashboard
(function () {
  const { registerView, $, fmtInt, fmtNum, fmtMs, fmtTime,
          escapeHtml, statusBadge, getJSON, pct, loading, Chart,
          chartPalette, registerChart } = window.ZC;

  let charts = {};
  let liveEs = null;
  let liveRows = [];
  let lastWindow = '24h';
  let themeHandler = null;

  function destroyCharts() {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch {} });
    charts = {};
  }

  async function view() {
    if (liveEs) { liveEs.close(); liveEs = null; }
    // remove any prior theme listener so re-entry doesn't stack handlers
    if (themeHandler) window.removeEventListener('zc-theme-changed', themeHandler);
    destroyCharts();
    liveRows = [];
    lastWindow = '24h';

    $('#root').innerHTML = `
      <div class="view max">
        <div class="toolbar">
          <h1>实时监控</h1>
          <span class="muted" style="font-size:12px">观察 agent 此刻的运行状态</span>
          <div class="spacer"></div>
          <select id="ov-window">
            <option value="today">今天</option>
            <option value="24h" selected>近 24 小时</option>
            <option value="7d">近 7 天</option>
          </select>
          <button class="btn ghost" id="ov-refresh">↻ 刷新</button>
        </div>

        <div class="kpis" id="kpis">${loading()}</div>

        <h2>趋势 <span class="sub" id="series-range"></span></h2>
        <div class="grid cols-2">
          <div class="card"><h3>模型调用 / 小时</h3><div class="chart-wrap"><canvas id="ch-calls"></canvas></div></div>
          <div class="card"><h3>Token 构成（输入 / 输出 / 推理）</h3><div class="chart-wrap"><canvas id="ch-tokens"></canvas></div></div>
        </div>

        <h2>实时活动 <span class="sub">SSE 推送新发生的模型/工具调用</span> <span id="live-status" class="badge dim">连接中…</span></h2>
        <div class="card">
          <div class="timeline" id="feed" style="max-height:280px;overflow-y:auto"><div class="empty">等待新事件…</div></div>
        </div>

        <h2>算力分布 <span class="sub">花在哪</span></h2>
        <div class="grid cols-2">
          <div class="card tight" style="overflow-x:auto"><h3 style="padding:12px 14px 0">按模型 / 请求来源</h3><table id="tbl-model"><thead></thead><tbody></tbody></table></div>
          <div class="card tight" style="overflow-x:auto"><h3 style="padding:12px 14px 0">按工具</h3><table id="tbl-tool"><thead></thead><tbody></tbody></table></div>
        </div>
      </div>
    `;

    $('#ov-refresh').onclick = loadOverview;
    $('#ov-window').onchange = loadOverview;
    await loadOverview();
    startLive();

    // re-fetch + re-render charts when the theme flips (palette changes)
    themeHandler = async () => { await loadOverview(); };
    window.addEventListener('zc-theme-changed', themeHandler);
  }

  async function loadOverview() {
    const w = $('#ov-window') ? $('#ov-window').value : lastWindow;
    lastWindow = w;
    const data = await getJSON(`/api/overview?window=${w}`);
    renderKpis(data.kpis, w);
    renderSeries(data.series, w);
    renderBreakdown(data.by_model, data.by_tool);
  }

  function renderKpis(k, w) {
    const errRate = k.model.calls ? (k.model.errors / k.model.calls * 100) : 0;
    const cacheRate = pct(k.tokens.cache_read, k.tokens.input);
    const reasonPct = k.tokens.reasoning_ratio != null ? (k.tokens.reasoning_ratio * 100) : null;
    const reasonCls = reasonPct == null ? '' : (reasonPct > 30 ? 'v-purple' : reasonPct > 5 ? 'v-teal' : 'v-accent');
    $('#kpis').innerHTML = `
      <div class="kpi"><div class="label">模型调用 (${w})</div><div class="value v-accent">${fmtInt(k.model.calls)}</div>
        <div class="delta">完成 ${fmtInt(k.model.completed)} · 失败 ${fmtInt(k.model.errors)} · 取消 ${fmtInt(k.model.cancelled)}</div></div>
      <div class="kpi"><div class="label">平均响应时延</div><div class="value">${fmtMs(k.model.avg_duration_ms)}</div>
        <div class="delta">到首 token 时间另计</div></div>
      <div class="kpi"><div class="label">输入 token</div><div class="value v-green">${fmtNum(k.tokens.input)}</div>
        <div class="bar"><span style="width:${cacheRate}%;background:var(--cat-tool-2)"></span></div>
        <div class="delta">缓存命中 ${cacheRate}% · 写入 ${fmtNum(k.tokens.cache_write)}</div></div>
      <div class="kpi"><div class="label">输出 token</div><div class="value">${fmtNum(k.tokens.output)}</div>
        <div class="delta">模型实际生成</div></div>
      <div class="kpi"><div class="label">推理 token 占比</div><div class="value ${reasonCls}">${reasonPct == null ? '—' : reasonPct.toFixed(1) + '%'}</div>
        <div class="delta">推理 ${fmtNum(k.tokens.reasoning)} / 输出 ${fmtNum(k.tokens.output)}</div></div>
      <div class="kpi"><div class="label">工具调用</div><div class="value v-teal">${fmtInt(k.tools.calls)}</div>
        <div class="delta">失败 ${fmtInt(k.tools.errors)} · 均 ${fmtMs(k.tools.avg_duration_ms)}</div></div>
      <div class="kpi"><div class="label">活跃会话</div><div class="value">${fmtInt(k.active_sessions)}</div>
        <div class="delta">窗口内有模型调用</div></div>
      <div class="kpi"><div class="label">错误率</div><div class="value ${errRate > 5 ? 'v-red' : ''}">${errRate.toFixed(1)}%</div>
        <div class="delta">${fmtInt(k.model.errors)} / ${fmtInt(k.model.calls)}</div></div>
    `;
  }

  function renderSeries(series, w) {
    $('#series-range').textContent = w === '7d' ? '近 7 天·按小时' : '近 24 小时';
    if (!series.length) return;
    const labels = series.map(s => fmtTime(s.bucket));
    const P = chartPalette();
    charts.calls && charts.calls.destroy();
    charts.tokens && charts.tokens.destroy();
    charts.calls = registerChart(new Chart($('#ch-calls'), {
      type: 'bar',
      data: { labels, datasets: [
        { label: '调用数', data: series.map(s => s.calls),
          backgroundColor: hexA(P.accent, .55), borderColor: P.accent },
      ]}, options: chartOpts({ y: { title: '调用数' } }),
    }));
    charts.tokens = registerChart(new Chart($('#ch-tokens'), {
      type: 'line',
      data: { labels, datasets: [
        { label: '输入', data: series.map(s=>s.input), borderColor: P.usage, backgroundColor: hexA(P.usage,.1), fill:true, tension:.3 },
        { label: '输出', data: series.map(s=>s.output), borderColor: P.accent, backgroundColor: hexA(P.accent,.08), fill:true, tension:.3 },
        { label: '推理', data: series.map(s=>s.reasoning), borderColor: P.llm2, backgroundColor: hexA(P.llm2,.1), fill:true, tension:.3 },
      ]}, options: chartOpts({ y: { title: 'token' } }),
    }));
  }

  // add alpha to a hex color (handles #rgb / #rrggbb)
  function hexA(hex, a) {
    hex = (hex || '#38bdf8').replace('#','');
    if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
    const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function chartOpts(axis = {}) {
    const P = chartPalette();
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: P.legend, boxWidth: 10, font: { size: 11 } } },
        tooltip: { backgroundColor: P.tipBg, borderColor: P.tipBd, borderWidth: 1, titleColor: P.tipTitle, bodyColor: P.tipBody },
      },
      scales: {
        x: { ticks: { color: P.tick, maxRotation: 0, autoSkipPadding: 24 }, grid: { color: P.gridX } },
        y: { ticks: { color: P.tick }, grid: { color: P.grid }, ...(axis.y||{}) },
      },
    };
  }

  function renderBreakdown(byModel, byTool) {
    $('#tbl-model').querySelector('thead').innerHTML = `<tr><th>provider / model</th><th>来源</th><th class="num">调用</th><th class="num">输入</th><th class="num">输出</th><th class="num">推理</th><th class="num">均时延</th></tr>`;
    $('#tbl-model').querySelector('tbody').innerHTML = byModel.map(m => `<tr>
      <td><span class="mono">${escapeHtml(m.model_id||'?')}</span><div class="faint mono" style="font-size:10px">${escapeHtml((m.provider_id||'').replace('builtin:',''))} ${m.variant?'· '+m.variant:''}</div></td>
      <td><span class="badge ${m.query_source==='main_turn'?'blue':m.query_source==='subagent'?'teal':'dim'}">${escapeHtml(m.query_source)}</span></td>
      <td class="num">${fmtInt(m.calls)}</td><td class="num">${fmtNum(m.in_tok)}</td><td class="num">${fmtNum(m.out_tok)}</td><td class="num">${fmtNum(m.reason_tok)}</td><td class="num">${fmtMs(m.avg_ms)}</td></tr>`).join('') || `<tr><td colspan="7" class="empty">无数据</td></tr>`;

    $('#tbl-tool').querySelector('thead').innerHTML = `<tr><th>工具</th><th class="num">调用</th><th class="num">错误</th><th class="num">均时延</th><th class="num">最大</th><th class="num">输出字节</th></tr>`;
    $('#tbl-tool').querySelector('tbody').innerHTML = byTool.map(t => `<tr>
      <td><span class="mono">${escapeHtml(t.tool_name)}</span></td>
      <td class="num">${fmtInt(t.calls)}</td>
      <td class="num ${t.errors?'':''}">${t.errors?`<span style="color:var(--sev-err)">${fmtInt(t.errors)}</span>`:'<span class="faint">0</span>'}</td>
      <td class="num">${fmtMs(t.avg_ms)}</td><td class="num">${fmtMs(t.max_ms)}</td><td class="num">${fmtNum(t.out_bytes)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">无数据</td></tr>`;
  }

  // ── live feed (maps DB rows to wire-style rows) ──
  function startLive() {
    const status = $('#live-status');
    try { liveEs = new EventSource('/api/live/events'); } catch { status.textContent = '不支持 SSE'; return; }
    liveEs.onopen = () => { status.className = 'badge green'; status.textContent = '已连接'; };
    liveEs.onerror = () => { status.className = 'badge red'; status.textContent = '重连中…'; };
    liveEs.addEventListener('model', e => pushRow('model', JSON.parse(e.data)));
    liveEs.addEventListener('tool', e => pushRow('tool', JSON.parse(e.data)));
  }

  function pushRow(kind, r) {
    let cat, label, summary;
    if (kind === 'model') {
      cat = 'llm'; label = 'llm→';
      summary = `${r.query_source} · ${r.model_id||'?'} ${r.variant||''} · in ${fmtNum(r.input_tokens)} / out ${fmtNum(r.output_tokens)}`;
      if (r.reasoning_tokens) summary += ` / think ${fmtNum(r.reasoning_tokens)}`;
    } else {
      cat = 'tool'; label = 'tool.call';
      summary = `${r.tool_name} · ${r.status}${r.exit_code!=null?' exit='+r.exit_code:''}`;
    }
    liveRows.unshift({ seq: liveRows.length, t: r.started_at, cat, label, summary, status: r.status, sid: r.session_id, dur: r.duration_ms });
    liveRows = liveRows.slice(0, 60);
    renderFeed();
  }

  function renderFeed() {
    $('#feed').innerHTML = liveRows.map((row, i) => `
      <div class="ev-row ${i===0?'row-flash':''} ${row.status==='error'?'err':''}">
        <span class="seq">${row.seq}</span>
        <span class="ts">${fmtTime(row.t)}</span>
        <span class="cat cat-dot ${row.cat}"></span>
        <span class="desc"><span class="k ${row.cat}">${row.label}</span> <span class="m">${escapeHtml(row.summary)}</span> <span class="faint">${shortId(row.sid,8)}</span> ${statusBadge(row.status)}</span>
        <span class="right">${row.dur?fmtMs(row.dur):''}</span>
      </div>`).join('') || `<div class="empty">等待新事件…</div>`;
  }

  registerView('overview', view);
})();
