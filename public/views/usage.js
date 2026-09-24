'use strict';
// views/usage.js — 「回合与工具」：窗口级（跨会话）回合健康度 + 工具维度分档
// （ecosystem-round2-batch1 C1，规格 §2.1 需求 4）。
// 数据面：/api/usage/turns（totals + error_type Top5 + 逐回合时间线，T2 查询族
// + T3 路由）与 /api/usage/tools（按 tool_name 分档）——本视图纯渲染，不自行聚合。
// 口径钉：
//   - 窗口读数上限 30 天（ZCode 官方 USAGE_RETENTION_DAYS=30 保留期，本机实测
//     三表 prune 生效，见 docs/usage-accounting.md §1）。
//   - approval_status 只记终态（7d 窗实测 160,827 行 'none' + 1 行 'denied'）——
//     呈现值域分布，不赋任何「等待中」语义（时间启发式属后续批次 C6）。
//   - avg_ttft_ms 是回合口径 AVG(time_to_first_token_ms)（全 NULL → null → 显
//     '—'，共享 formatter 契约），与速度口径轮 model_usage 侧逐请求口径互补。
//   - 30d 档工具分档走 rowid 尾部候选集钳制（事件循环红线），服务端 meta.scope
//     如实申报——本视图照录该 scope 说明，不静默。
// 形态锚点：窗口选择器/工具栏 = views/overview.js；回合时间线 = sessions.js
// renderTurns（.turn/.bar/.fill 既有 class）；表格 = sessions.js renderUsage
// （.card tight + .num tabular-nums）。新文件全文禁硬编码色值（颜色一律
// var(--*)，C1-5 契约）；空态一律经 window.ZC.emptyState（C9-3 共享组件）。
(function () {
  const { registerView, $, fmtInt, fmtNum, fmtMs, fmtDur, fmtTime, escapeHtml,
          shortId, getJSON, pct, loading } = window.ZC;

  // 字节格式化：window.ZC 未导出 fmtBytes（overview.js:126 局部函数同款实现，
  // 视图内自带一份——两视图无共享面，不为此扩 app.js 导出）。
  function fmtBytes(b) {
    if (b == null) return '—';
    if (b >= 1024 * 1024 * 1024) return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
    return b + ' B';
  }

  // 渲染防护（overview renderKpis 先例）：load() 在途时视图可能已被切走，
  // 选择器落空即整批自弃，防旧视图的迟到响应覆写新视图。
  function setHtml(id, html) {
    const el = $(id);
    if (el) el.innerHTML = html;
    return !!el;
  }

  async function view() {
    $('#root').innerHTML = `
      <div class="view max">
        <div class="toolbar">
          <h1>回合与工具</h1>
          <span class="muted" style="font-size:12px">窗口读数上限 30 天（ZCode 保留期，三表 prune 实测生效）</span>
          <div class="spacer"></div>
          <select id="usage-window">
            <option value="24h" selected>近 24 小时</option>
            <option value="7d">近 7 天</option>
            <option value="30d">近 30 天</option>
          </select>
          <button class="btn ghost" id="usage-refresh">↻ 刷新</button>
        </div>

        <div class="kpis" id="usage-totals">${loading()}</div>

        <h2>错误类型分布 <span class="sub" id="usage-errors-sub"></span></h2>
        <div class="card tight" style="overflow-x:auto" id="usage-errors">${loading()}</div>

        <h2>回合时间线 <span class="sub" id="usage-timeline-sub"></span></h2>
        <div class="card" id="usage-timeline">${loading()}</div>

        <h2>工具分档 <span class="sub" id="usage-tools-sub"></span></h2>
        <div class="card tight" style="overflow-x:auto" id="usage-tools">${loading()}</div>
      </div>
    `;

    $('#usage-refresh').onclick = load;
    $('#usage-window').onchange = load;
    await load();
  }

  async function load() {
    const w = $('#usage-window') ? $('#usage-window').value : '24h';
    const [turns, tools] = await Promise.all([
      getJSON(`/api/usage/turns?window=${w}`),
      getJSON(`/api/usage/tools?window=${w}`),
    ]);
    renderTotals(turns.totals, w);
    renderErrorTypes(turns);
    renderTimeline(turns);
    renderTools(tools);
  }

  // totals 卡：九值全覆盖（turns 总数 + completed/errors/cancelled 分布作为
  // delta 副行，overview「模型调用」卡同款形态）。avg_ttft_ms null → fmtMs
  // null 语义显 '—'（不伪造 0）；errors/context_exceeded 非零用 severity 色。
  function renderTotals(t, w) {
    setHtml('#usage-totals', `
      <div class="kpi"><div class="label">回合 (${w})</div><div class="value v-accent">${fmtInt(t.turns)}</div>
        <div class="delta">完成 ${fmtInt(t.completed)} · <span style="${t.errors ? 'color:var(--sev-err)' : ''}">错误 ${fmtInt(t.errors)}</span> · 取消 ${fmtInt(t.cancelled)}</div></div>
      <div class="kpi"><div class="label">模型请求</div><div class="value">${fmtInt(t.model_requests)}</div>
        <div class="delta">重试 ${fmtInt(t.retries)}</div></div>
      <div class="kpi"><div class="label">工具错误</div><div class="value" style="${t.tool_errors ? 'color:var(--sev-err)' : ''}">${fmtInt(t.tool_errors)}</div>
        <div class="delta">窗口内 tool_usage status='error' 行数</div></div>
      <div class="kpi"><div class="label">平均回合首等</div><div class="value">${fmtMs(t.avg_ttft_ms)}</div>
        <div class="delta">回合口径 AVG(time_to_first_token_ms)<span class="caliber" title="turn_usage 回合粒度的窗口均值；与实时监控速度卡的请求粒度 avg_ttft_ms 互补（那是逐请求生成速度面），两者口径不同">回合口径</span></div></div>
      <div class="kpi"><div class="label">context 超限</div><div class="value" style="${t.context_exceeded ? 'color:var(--sev-warn)' : ''}">${fmtInt(t.context_exceeded)}</div>
        <div class="delta">context_exceeded=1 的回合</div></div>
    `);
  }

  // error_type Top5（含 '(none)'——无 error_type 的行，completed/cancelled 常态）。
  // 截断如实标注：服务端 by_error_type_truncated=true 时标题显「前 5（被裁）」。
  function renderErrorTypes(turns) {
    const dist = turns.by_error_type || [];
    const total = turns.totals.turns || 0;
    const sub = $('#usage-errors-sub');
    if (sub) sub.textContent = dist.length
      ? (turns.by_error_type_truncated ? '前 5（被裁）· 按计数降序' : '按计数降序')
      : '';
    if (!total) {
      setHtml('#usage-errors', window.ZC.emptyState('turn_usage',
        '窗口内无回合记录——换更宽的窗口，或等 ZCode 产生新回合后刷新。'));
      return;
    }
    setHtml('#usage-errors', `<table>
      <thead><tr><th>error_type</th><th class="num">回合数</th><th class="num">占比</th></tr></thead>
      <tbody>${dist.map(r => `<tr>
        <td class="mono">${r.type === '(none)' ? '<span class="faint">(none)</span><span class="caliber" title="无 error_type 的行——completed/cancelled 回合的常态，非数据缺失">无错误</span>' : escapeHtml(r.type)}</td>
        <td class="num">${fmtInt(r.count)}</td>
        <td class="num">${pct(r.count, total)}%</td>
      </tr>`).join('')}</tbody></table>`);
  }

  // 回合时间线（新→旧，行数=服务端钳界后 timeline，默认 100/上限 500）：
  // 形态对齐 sessions.js renderTurns——bar 宽=耗时占比、error 填 sev-err /
  // cancelled 填 sev-warn、mono 副行带 context_exceeded ⚠ 与 error_type；
  // 窗口级增量：副行加时刻与会话短链锚，stats 列带重试/工具错误数（规格点名）。
  function renderTimeline(turns) {
    const tl = turns.timeline || [];
    const total = turns.totals.turns || 0;
    const sub = $('#usage-timeline-sub');
    if (sub) {
      sub.textContent = total > tl.length
        ? `${total} 个回合 · 显示最近 ${tl.length}（新→旧）`
        : `${tl.length} 个回合 · 新→旧`;
    }
    if (!tl.length) {
      setHtml('#usage-timeline', window.ZC.emptyState('turn_usage',
        '窗口内无回合记录——换更宽的窗口，或等 ZCode 产生新回合后刷新。'));
      return;
    }
    const maxDur = Math.max(...tl.map(t => t.duration_ms || 0), 1);
    setHtml('#usage-timeline', `<div class="turns">${tl.map(t => {
      const w = pct(t.duration_ms, maxDur);
      const fill = t.status === 'error' ? 'var(--sev-err)' : t.status === 'cancelled' ? 'var(--sev-warn)' : 'var(--accent)';
      const dur = t.duration_ms ? fmtDur(t.duration_ms / 1000) : '…';
      return `<div class="turn" data-turn="${escapeHtml(t.turn_id || '')}">
        <span class="dur">${dur}</span>
        <div><div class="bar"><span class="fill" style="width:${w}%;background:${fill}"></span></div>
          <div class="faint mono" style="font-size:10.5px;margin-top:3px">${fmtTime(t.started_at)} · ${shortId(t.session_id, 8)}/${shortId(t.turn_id, 12)} ${t.context_exceeded ? '· ⚠ context_exceeded' : ''} ${t.error_type ? '· ' + escapeHtml(t.error_type) : ''}</div></div>
        <span class="stats">ttft ${fmtMs(t.time_to_first_token_ms)} · 重试 ${fmtInt(t.model_retry_count)} · 工具错 ${fmtInt(t.tool_error_count)} · ${fmtNum(t.computed_total_tokens)} tok</span>
      </div>`;
    }).join('')}</div>`);
  }

  // 工具分档表：成功率/平均耗时（仅 completed 行，服务端口径）/最大耗时（全行）
  // /字节/read_only/destructive/approval 分布列。destructive 列必须展示（聚合
  // 返回而视图不展示将成三档只显两档的暗缺口）；approval 列只呈现值域分布
  // （终态值→计数，键为库内值域、动态转义）。30d 档 meta.scope 存在时照录服务端
  // 的候选集钳制申报（宽窗读数上限=最近 cap 行，不静默）。
  function renderTools(tools) {
    const groups = tools.groups || [];
    const sub = $('#usage-tools-sub');
    if (sub) {
      sub.textContent = groups.length
        ? `${groups.length} 个工具 · 按调用数降序${tools.meta && tools.meta.scope ? ' · ' + tools.meta.scope + '（宽窗候选集钳制，读数上限=最新 20 万行）' : ''}`
        : '';
    }
    if (!groups.length) {
      setHtml('#usage-tools', window.ZC.emptyState('tool_usage',
        '窗口内无工具调用记录——换更宽的窗口，或等 ZCode 产生新调用后刷新。'));
      return;
    }
    setHtml('#usage-tools', `<table>
      <thead><tr>
        <th>工具</th><th class="num">调用</th><th class="num">错误</th><th class="num">成功率</th>
        <th class="num">平均耗时<span class="caliber" title="仅 status=completed 行的均值（错误行时长不代表健康耗时）；最大耗时为全行（极端值含错误行）——服务端 db.js 分节口径">成功行</span></th>
        <th class="num">最大耗时</th><th class="num">输出字节</th>
        <th class="num">read_only</th><th class="num">destructive</th><th class="num">审批终态</th>
      </tr></thead>
      <tbody>${groups.map(g => {
        const ro = g.read_only || {};
        const d = g.destructive || {};
        const appr = Object.entries(g.approval_status || {})
          .map(([k, v]) => `${escapeHtml(k)} ${fmtInt(v)}`).join(' · ');
        return `<tr>
          <td class="mono">${escapeHtml(g.tool_name)}</td>
          <td class="num">${fmtInt(g.calls)}</td>
          <td class="num">${g.errors ? `<span style="color:var(--sev-err)">${fmtInt(g.errors)}</span>` : '0'}</td>
          <td class="num">${g.success_rate == null ? '—' : (g.success_rate * 100).toFixed(1) + '%'}</td>
          <td class="num">${fmtMs(g.avg_ms)}</td>
          <td class="num">${fmtMs(g.max_ms)}</td>
          <td class="num">${fmtBytes(g.output_bytes)}</td>
          <td class="num">只读 ${fmtInt(ro.ro)} · 读写 ${fmtInt(ro.rw)}</td>
          <td class="num">破坏性 ${fmtInt(d['1'])} · 非破坏 ${fmtInt(d['0'])}</td>
          <td class="num">${appr || '—'}</td>
        </tr>`;
      }).join('')}</tbody></table>`);
  }

  registerView('usage', view);
})();
