'use strict';
// views/overview.js — real-time monitoring dashboard
(function () {
  const { registerView, $, fmtInt, fmtNum, fmtMs, fmtTime, fmtTimeFull, relTime,
          escapeHtml, statusBadge, getJSON, pct, loading, Chart,
          chartPalette, registerChart, cssVar } = window.ZC;

  let charts = {};
  let liveEs = null;
  let liveRows = [];
  let lastWindow = '24h';
  let themeHandler = null;
  let snapTimer = null;

  function destroyCharts() {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch {} });
    charts = {};
  }

  async function view() {
    if (liveEs) { liveEs.close(); liveEs = null; }
    // remove any prior theme listener so re-entry doesn't stack handlers
    if (themeHandler) window.removeEventListener('zc-theme-changed', themeHandler);
    if (snapTimer) { clearInterval(snapTimer); snapTimer = null; }
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
        <div class="kpis" id="kpi-speed" style="margin-top:10px">${loading()}</div>

        <h2>快照绊线 <span class="sub">只读监视 ~/.zcode/v2/checkpoints · 快照机制复活即红</span> <span id="snap-status-badge" class="badge dim">…</span></h2>
        <div class="card snapshot-card" id="snapshot-card">${loading()}</div>

        <h2>趋势 <span class="sub" id="series-range"></span></h2>
        <div class="grid cols-2">
          <div class="card"><h3>模型调用 / 小时</h3><div class="chart-wrap"><canvas id="ch-calls"></canvas></div></div>
          <div class="card"><h3>Token 构成（输入 / 输出 / 推理）</h3><div class="chart-wrap"><canvas id="ch-tokens"></canvas></div></div>
        </div>

        <h2>Token 速度 <span class="sub">tokens/sec · 每次完成请求</span></h2>
        <div class="grid cols-2">
          <div class="card"><h3>速度随时间</h3><div class="chart-wrap"><canvas id="ch-speed"></canvas></div></div>
          <div class="card tight" style="display:flex;flex-direction:column">
            <h3 style="padding:12px 14px 0">最近请求速度</h3>
            <div class="speed-wrap" id="speed-table-wrap">${loading()}</div>
            <div class="speed-foot" id="speed-foot" hidden></div>
          </div>
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
    refreshSnapshot();
    // 绊线卡轮询：view 存续期间低频刷新（顶栏告警由 app.js snapshotLoop 负责）
    snapTimer = setInterval(refreshSnapshot, 15 * 1000);

    // re-fetch + re-render charts when the theme flips (palette changes)
    themeHandler = async () => { await loadOverview(); };
    window.addEventListener('zc-theme-changed', themeHandler);
  }

  // ── 快照绊线卡（语义见 server/snapshot-watch.js）─────────────────
  // 五态：clear 静默（目录空/不存在）· static 遗留静止（有内容但零点以来
  // 无新增）· unreadable 目录不可读（读取被拒——仅拒写入的锁定不触发本态）
  // · active 活动告警（闩锁，上传后清理回空也保持）· pending 首扫中。
  // 未知 status（前后端版本错位）按异常渲染，不与合法 pending 合流伪装成
  // 良性暂态。workspaces 的 path/hash 均为不可信文本，渲染一律过 escapeHtml
  // （源码契约测试锁住）。
  const SNAP_VIEW = {
    clear:      { badge: 'green',  label: '静默' },
    static:     { badge: 'yellow', label: '遗留静止' },
    unreadable: { badge: 'yellow', label: '目录不可读' },
    active:     { badge: 'red',    label: '检测到活动!' },
    pending:    { badge: 'dim',    label: '首扫中' },
  };

  async function refreshSnapshot() {
    // 视图已离开（card 不在 DOM）：停掉孤儿定时器——否则每 15s 一次空转
    // fetch，且 catch 出口因选择器落空而完全静默（错误可见性随之失去）
    const liveCard = $('#snapshot-card');
    if (!liveCard || !document.body.contains(liveCard)) {
      if (snapTimer) { clearInterval(snapTimer); snapTimer = null; }
      return;
    }
    let s;
    try {
      s = await getJSON('/api/snapshot', { retries: 1 });
      renderSnapshot(s);
    } catch (e) {
      // getJSON 抛错（接口不可达/非 2xx）与 renderSnapshot 抛错（前后端
      // 版本错位导致响应形变）共用同一可见出口——后者若不接住，卡片会
      // 永久停在「首次扫描中…」且只有 console 痕迹。
      const card = $('#snapshot-card');
      if (card) card.innerHTML = `<div class="empty">绊线数据异常：${escapeHtml(e.message)}</div>`;
    }
  }
  function fmtBytes(b) {
    if (b == null) return '—';
    if (b >= 1024 * 1024 * 1024) return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
    return b + ' B';
  }

  function renderSnapshot(s) {
    const card = $('#snapshot-card');
    const badgeEl = $('#snap-status-badge');
    if (!card) return;
    const v = SNAP_VIEW[s.status];
    if (!v) {
      // 未知状态 = 前后端契约错位，按异常渲染——不得落入「首次扫描中」的
      // 良性暂态文案（否则数据链路死亡被伪装成耐心等待）
      if (badgeEl) { badgeEl.className = 'badge dim'; badgeEl.textContent = '未知'; }
      card.innerHTML = `<div class="empty">绊线数据异常：未知状态 ${escapeHtml(String(s && s.status))}（前后端版本错位?）</div>`;
      return;
    }
    if (badgeEl) { badgeEl.className = 'badge ' + v.badge; badgeEl.textContent = v.label; }
    card.classList.toggle('active', s.status === 'active');

    const wss = s.workspaces || [];
    let head;
    if (s.status === 'clear') {
      head = `目录为空或不存在——快照机制未在本机活动（面板运行时段内）。`;
    } else if (s.status === 'static') {
      head = `目录有遗留内容：<b>${fmtInt(s.current.workspaces)}</b> 个工作区 · <b>${fmtBytes(s.current.bytes)}</b> 加密工件`
           + (s.current.lastWriteMs ? ` · 最后活动 <b>${relTime(s.current.lastWriteMs)}</b>` : '')
           + `<span class="caliber" title="绊线以面板启动时的目录状态为零点：boot 前已有的内容不告警，只如实展示；面板重启后零点重置">绊线零点以来无新增</span>`;
    } else if (s.status === 'unreadable') {
      head = `<b>目录不可读</b>（${s.readError ? escapeHtml(s.readError) : '权限被拒'}）——绊线无法扫描该目录。`
           + `<div class="faint" style="margin-top:4px">这是「读取被拒」的信号：若你以拒绝读取式 ACL 锁定了目录属预期；常见的仅拒写入式锁定（README 程序）不会触发本态——出现本态请检查目录权限，绊线在此期间不设防。</div>`;
    } else if (s.status === 'active') {
      const d = s.activityDetail || {};
      const parts = [];
      if (d.added && d.added.length) parts.push(`新增工作区 ${d.added.length}`);
      if (d.modified && d.modified.length) parts.push(`变化工作区 ${d.modified.length}`);
      if (d.removed && d.removed.length) parts.push(`移除 ${d.removed.length}`);
      head = `<b>面板启动后检测到新增快照活动</b>（${fmtTimeFull(s.firstActivityAt)}）`
           + (parts.length ? ` · ${parts.join(' · ')}` : '')
           + (d.bytesDelta > 0 ? ` · 净增 <b>${fmtBytes(d.bytesDelta)}</b> 加密工件` : '')
           + `<div class="faint" style="margin-top:4px">这是 ZCode 快照上传机制复活的迹象——如非预期，可按 README「隐私提示」的目录锁定程序处置。</div>`;
    } else {
      head = `首次扫描中…`;
    }

    const rows = wss.slice(0, 8).map(w => `<tr>
        <td class="mono">${escapeHtml(shortHash(w.hash))}</td>
        <td>${w.path ? escapeHtml(w.path) : '<span class="faint">（state.json 缺失/损坏）</span>'}</td>
        <td class="num">${fmtBytes(w.encBytes)}</td>
        <td class="num">${w.failureCount != null ? fmtInt(w.failureCount) : '—'}</td>
        <td class="num">${relTime(w.lastWriteMs)}</td>
      </tr>`).join('');
    const more = wss.length > 8 ? `<tr><td colspan="5" class="faint">… 共 ${fmtInt(wss.length)} 个工作区（按最近活动排序，前 8 个）</td></tr>` : '';
    const table = wss.length ? `
      <table style="margin-top:10px"><thead><tr>
        <th>hash</th><th>工作区</th><th class="num">加密工件</th><th class="num">上传失败</th><th class="num">最后写入</th>
      </tr></thead><tbody>${rows}${more}</tbody></table>` : '';

    let mode;
    if (s.watchMode === 'watch') mode = 'fs.watch+轮询';
    else if (s.watchMode === 'parent') mode = '父目录 watch+轮询';
    else if (s.watchMode === 'poll') mode = `仅轮询${s.watchError ? `（watch 不可用：${escapeHtml(s.watchError)}）` : ''}`;
    else mode = '装配中';
    card.innerHTML = `
      <div>${head}</div>${table}
      <div class="faint" style="margin-top:10px;font-size:11px">
        <span class="mono">${escapeHtml(s.dir)}</span> · ${mode} · 上次扫描 ${s.scannedAt ? relTime(s.scannedAt) : '—'} · 本卡纯只读（readdir/stat，零写入）
        ${s.truncated ? ` · <span style="color:var(--sev-warn)">本次扫描被截断（目录异常大），明细不完整、此拍不参与判定</span>` : ''}
        ${s.partial ? ` · <span style="color:var(--sev-warn)">部分内容不可读（${s.readError ? escapeHtml(s.readError) : '权限被拒'}），此拍不参与判定</span>` : ''}
        ${s.scanStuck ? ` · <span style="color:var(--sev-err)">扫描疑似卡死</span>` : ''}
        ${s.scanError ? ` · <span style="color:var(--sev-warn)">扫描异常：${escapeHtml(s.scanError)}</span>` : ''}
      </div>`;
  }

  function shortHash(h) { return h ? String(h).slice(0, 12) + '…' : '—'; }

  async function loadOverview() {
    const w = $('#ov-window') ? $('#ov-window').value : lastWindow;
    lastWindow = w;
    const data = await getJSON(`/api/overview?window=${w}`);
    renderKpis(data.kpis, w);
    renderSpeedKpi(data.speed);
    renderSeries(data.series, w);
    renderBreakdown(data.by_model, data.by_tool);
    renderSpeedChart(data.recent_speed || []);
    renderSpeedTable(data.recent_speed || []);
  }

  function renderKpis(k, w) {
    if (!$('#kpis')) return; // 视图已切走（loadOverview 在途）：整批渲染自弃，防 errorCard 覆写新视图
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
        <div class="delta">缓存命中 ${cacheRate}% · 写入 ${fmtNum(k.tokens.cache_write)}<span class="caliber" title="官方口径：input 为官方列 SUM(input_tokens)，已含缓存读（AI SDK v6）；缓存命中/写入取官方分项列。去重展示的纯输入见 docs/usage-accounting.md">官方口径</span></div></div>
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

  // ── token speed ──
  // Tier: red <30 / yellow 30–80 / green >80 t/s (design.md D4).
  // Null/undefined/non-finite → no tier (empty string).
  function speedClass(tps) {
    if (tps == null || !isFinite(tps)) return '';
    if (tps < 30) return 'spd-red';
    if (tps <= 80) return 'spd-yellow';
    return 'spd-green';
  }

  // query_source → 徽标色：速度表行与 by_model 来源列共用（收敛单点正是
  // dwf 轮漏计 bug 的防复发——同一映射散落多处时新增来源必漏改）；未知
  // 来源落 dim+原值文本，不冒充已知类别。
  const SRC_COLOR = { main_turn: 'blue', subagent: 'teal', workflow_child: 'purple' };

  function renderSpeedKpi(s) {
    const host = $('#kpi-speed');
    if (!host) return;
    const cls = speedClass(s && s.weighted_tps);
    host.innerHTML = `
      <div class="kpi">
        <div class="label">平均 Token 速度 (${lastWindow})</div>
        <div class="value ${cls}">${s && s.weighted_tps != null ? s.weighted_tps + ' <span class="faint" style="font-size:13px;font-weight:400">t/s</span>' : '—'}</div>
        <div class="delta">加权:总 token ÷ 总秒数 · 主 ${fmtInt(s && s.main_count)} · 子agent(含工作流) ${fmtInt((s && s.subagent_count || 0) + (s && s.workflow_child_count || 0))} · 其中工作流 ${fmtInt(s && s.workflow_child_count)}</div>
      </div>`;
  }

  function renderSeries(series, w) {
    if (!$('#series-range')) return; // 视图已切走：自弃（同 renderKpis 守卫家族）
    $('#series-range').textContent = w === '7d' ? '近 7 天·按小时' : '近 24 小时';
    if (!series.length) return;
    // 轴刻度统一带日期（M/D HH:MM）：fmtTime 的 sameDay 分支只出时间，24h 窗的
    // 末档与其余档呈两种格式、读轴易误判（截图实测）；桶恒为小时对齐。
    const fmtAxis = iso => {
      const d = new Date(iso);
      if (isNaN(d)) return iso;
      const hh = String(d.getHours()).padStart(2, '0');
      return `${d.getMonth() + 1}/${d.getDate()} ${hh}:00`;
    };
    const labels = series.map(s => fmtAxis(s.bucket));
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

  // tier color from CSS variables, resolved at render time so theme flips
  // recolor points on the next render.
  function tierVar(cls) {
    if (cls === 'spd-red') return '--sev-err';
    if (cls === 'spd-yellow') return '--sev-warn';
    if (cls === 'spd-green') return '--sev-ok';
    return '--fg-4';
  }

  function renderSpeedChart(recent) {
    const host = $('#ch-speed');
    charts.speed && charts.speed.destroy();
    // chronological order (oldest → newest) for a left→-right line
    const rows = [...recent].reverse().filter(r => r.tps != null);
    if (!rows.length) {
      if (host) {
        const ctx = host.getContext('2d');
        ctx && ctx.clearRect(0, 0, host.width, host.height);
      }
      // overlay an empty-state note inside the chart card
      const card = host && host.closest('.card');
      if (card) card.querySelector('.empty-speed')?.remove();
      if (card) card.insertAdjacentHTML('beforeend', '<div class="empty empty-speed">窗口内无完成请求</div>');
      return;
    }
    // clear any prior empty-state note
    const card = host && host.closest('.card');
    if (card) card.querySelector('.empty-speed')?.remove();

    const P = chartPalette();
    const colors = rows.map(r => cssVar(tierVar(speedClass(r.tps))));
    charts.speed = registerChart(new Chart(host, {
      type: 'line',
      data: {
        labels: rows.map(r => fmtTime(r.time)),
        datasets: [{
          label: 'tok/s',
          data: rows.map(r => r.tps),
          borderColor: P.accent,
          backgroundColor: hexA(P.accent, .08),
          fill: false, tension: .25, borderWidth: 1.5,
          pointRadius: 3, pointHoverRadius: 5,
          pointBackgroundColor: colors,
          pointBorderColor: colors,
        }],
      },
      options: chartOpts({ y: { title: 'tok/s' } }),
    }));
  }

  function renderSpeedTable(recent) {
    const wrap = $('#speed-table-wrap');
    const foot = $('#speed-foot');
    if (!wrap) return;
    if (!recent.length) {
      wrap.innerHTML = `<div class="empty">窗口内无完成请求</div>`;
      if (foot) foot.hidden = true;
      return;
    }
    wrap.innerHTML = `
      <table id="tbl-speed">
        <thead><tr>
          <th>Time</th><th>Model</th><th class="num">Output</th><th class="num">Reason</th>
          <th class="num">Duration</th><th class="num">Speed</th><th>Source</th>
        </tr></thead>
        <tbody>${
          recent.map(r => {
            const cls = speedClass(r.tps);
            return `<tr>
              <td class="ts-cell">${fmtTime(r.time)}</td>
              <td><span class="mono">${escapeHtml(r.model || '?')}</span></td>
              <td class="num">${fmtInt(r.output)}</td>
              <td class="num">${r.reasoning ? fmtInt(r.reasoning) : '<span class="faint">0</span>'}</td>
              <td class="num">${fmtMs(r.duration_ms)}</td>
              <td class="num">${r.tps != null ? `<span class="spd-chip ${cls}">${r.tps} t/s</span>` : '<span class="faint">—</span>'}</td>
              <td><span class="badge ${SRC_COLOR[r.query_source] || 'dim'}">${escapeHtml(r.query_source||'')}</span></td>
            </tr>`;
          }).join('')
        }</tbody>
      </table>`;

    // footer summary: window weighted avg + totals, recomputed from the same
    // caliber (Σtokens / Σseconds). recent_speed is capped at 50 rows, but the
    // footer should reflect those visible rows (consistent with the table).
    if (foot) {
      const totTok = recent.reduce((a, r) => a + (r.output + r.reasoning), 0);
      const totSec = recent.reduce((a, r) => a + (r.duration_ms || 0), 0) / 1000;
      const wTps = totSec > 0 ? (totTok / totSec).toFixed(1) : null;
      const subs = recent.filter(r => r.query_source === 'subagent').length;
      const wfs = recent.filter(r => r.query_source === 'workflow_child').length;
      foot.hidden = false;
      foot.innerHTML = `
        <span><span class="lbl">均速</span> <b class="${speedClass(wTps != null ? +wTps : null)}">${wTps != null ? wTps + ' t/s' : '—'}</b></span>
        <span><span class="lbl">总 token</span> <b>${fmtInt(totTok)}</b><span class="caliber" title="本地估算：速度专用口径 Σ(输出+推理)，不含输入，与官方 computed_total_tokens（input+output）口径不同，见 docs/usage-accounting.md">本地估算</span></span>
        <span><span class="lbl">请求</span> <b>${fmtInt(recent.length)}</b></span>
        <span><span class="lbl">subagent</span> <b>${fmtInt(subs)}</b></span>
        <span><span class="lbl">工作流</span> <b>${fmtInt(wfs)}</b></span>`;
    }
  }

  function renderBreakdown(byModel, byTool) {
    const tm = $('#tbl-model');
    if (!tm) return; // 视图已切走：自弃（同 renderKpis 守卫家族）
    tm.querySelector('thead').innerHTML = `<tr><th>provider / model</th><th>来源</th><th class="num">调用</th><th class="num">输入</th><th class="num">输出</th><th class="num">推理</th><th class="num">均时延</th></tr>`;
    tm.querySelector('tbody').innerHTML = byModel.map(m => `<tr>
      <td><span class="mono">${escapeHtml(m.model_id||'?')}</span><div class="faint mono" style="font-size:10px">${escapeHtml((m.provider_id||'').replace('builtin:',''))} ${m.variant?'· '+escapeHtml(m.variant):''}</div></td>
      <td><span class="badge ${SRC_COLOR[m.query_source] || 'dim'}">${escapeHtml(m.query_source)}</span></td>
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
    // 快速 overview→X→overview 时，第二次 startLive 可能晚于 view() 入口的
    // 同步 close 执行——这里幂等再关一次，杜绝孤儿 EventSource（连接泄漏+双行）。
    if (liveEs) { liveEs.close(); liveEs = null; }
    const status = $('#live-status');
    try { liveEs = new EventSource('/api/live/events'); }
    catch (e) {
      console.error('[overview] EventSource 创建失败', e);
      if (status) status.textContent = '不支持 SSE';
      return;
    }
    liveEs.onopen = () => { if (!status) return; status.className = 'badge green'; status.textContent = '已连接'; };
    // onerror 兼两种形态：连接断开（浏览器自动重连中）与服务端 error 帧（live.js
    // 轮询失败时携带 {"message"})——后者连接还活着，标「重连中」会误导排查。
    liveEs.onerror = e => {
      if (!status) return;
      status.className = 'badge red';
      let msg = null;
      if (e && e.data) { try { msg = JSON.parse(e.data).message; } catch { /* 畸形帧按连接错误处理 */ } }
      status.textContent = msg ? ('服务端: ' + msg) : '重连中…';
    };
    liveEs.addEventListener('model', e => {
      try { pushRow('model', JSON.parse(e.data)); }
      catch (err) { console.warn('[overview] live model 帧解析失败', err); }
    });
    liveEs.addEventListener('tool', e => {
      try { pushRow('tool', JSON.parse(e.data)); }
      catch (err) { console.warn('[overview] live tool 帧解析失败', err); }
    });
  }

  function pushRow(kind, r) {
    let cat, label, summary, spd = null;
    if (kind === 'model') {
      cat = 'llm'; label = 'llm→';
      summary = `${r.query_source} · ${r.model_id||'?'} ${r.variant||''} · in ${fmtNum(r.input_tokens)} / out ${fmtNum(r.output_tokens)}`;
      if (r.reasoning_tokens) summary += ` / think ${fmtNum(r.reasoning_tokens)}`;
      // token speed — only for completed calls with a real duration
      if (r.status === 'completed' && r.duration_ms > 0) {
        const out = (r.output_tokens || 0) + (r.reasoning_tokens || 0);
        spd = +(out / (r.duration_ms / 1000)).toFixed(1);
      }
    } else {
      cat = 'tool'; label = 'tool.call';
      summary = `${r.tool_name} · ${r.status}${r.exit_code!=null?' exit='+r.exit_code:''}`;
    }
    liveRows.unshift({ seq: liveRows.length, t: r.started_at, cat, label, summary, status: r.status, sid: r.session_id, dur: r.duration_ms, spd });
    liveRows = liveRows.slice(0, 60);
    renderFeed();
  }

  function renderFeed() {
    const feed = $('#feed');
    // hash 切走后 DOM 已被替换、但本视图的 SSE 仍连着：每条推送都会撞
    // null innerHTML 抛 TypeError（实测离开 overview 后每分钟刷几十条）。
    // 自愈：目标元素不在即关掉这条 EventSource；回到 overview 时 view()
    // 开头的 close+重开逻辑会建新连接，不依赖这条旧流。
    if (!feed) { if (liveEs) { liveEs.close(); liveEs = null; } return; }
    feed.innerHTML = liveRows.map((row, i) => `
      <div class="ev-row ${i===0?'row-flash':''} ${row.status==='error'?'err':''}">
        <span class="seq">${row.seq}</span>
        <span class="ts">${fmtTime(row.t)}</span>
        <span class="cat cat-dot ${row.cat}"></span>
        <span class="desc"><span class="k ${row.cat}">${row.label}</span> <span class="m">${escapeHtml(row.summary)}</span> <span class="faint">${shortId(row.sid,8)}</span> ${statusBadge(row.status)}</span>
        <span class="right">${row.dur?fmtMs(row.dur):''}${row.spd!=null?` <span class="spd-chip ${speedClass(row.spd)}">${row.spd} t/s</span>`:''}</span>
      </div>`).join('') || `<div class="empty">等待新事件…</div>`;
  }

  registerView('overview', view);
})();
