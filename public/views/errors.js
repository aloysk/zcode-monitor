'use strict';
// views/errors.js — error aggregation + trace/span waterfall + slow tools
(function () {
  const { registerView, $, fmtInt, fmtMs, fmtTime, escapeHtml, shortId, statusBadge, getJSON, loading, errorCard } = window.ZC;

  async function view() {
    $('#root').innerHTML = `<div class="view max">
      <div class="toolbar">
        <h1>错误与链路排查</h1>
        <div class="spacer"></div>
        <select id="er-window">
          <option value="today">今天</option>
          <option value="24h" selected>近 24h</option>
          <option value="7d">近 7d</option>
          <option value="all">全部</option>
        </select>
        <button class="btn ghost" id="er-refresh">↻</button>
      </div>

      <h2>错误汇总 <span class="sub">按类型 / 工具</span></h2>
      <div class="grid cols-3" id="er-summary">${loading()}</div>

      <h2>失败调用 <span class="sub">点击复制错误信息</span></h2>
      <div class="grid cols-2">
        <div class="card tight" style="overflow-x:auto"><h3 style="padding:10px 14px 0">模型失败</h3><table id="er-model"><thead></thead><tbody></tbody></table></div>
        <div class="card tight" style="overflow-x:auto"><h3 style="padding:10px 14px 0">工具失败</h3><table id="er-tool"><thead></thead><tbody></tbody></table></div>
      </div>

      <h2>最慢工具调用 Top 30</h2>
      <div class="card tight" style="overflow-x:auto"><table id="er-slow"><thead></thead><tbody></tbody></table></div>

      <h2>Trace 链路还原 <span class="sub">输入 trace_id 还原事件瀑布</span></h2>
      <div class="card">
        <div class="toolbar" style="margin:0 0 8px">
          <input type="text" id="tr-input" placeholder="trace_id (从上方失败记录点击带入，或粘贴)" style="flex:1">
          <button class="btn" id="tr-go">还原</button>
        </div>
        <div id="tr-out" class="faint" style="font-size:12px">输入 trace_id 后点击「还原」</div>
      </div>
    </div>`;

    $('#er-refresh').onclick = load;
    $('#er-window').onchange = load;
    $('#tr-go').onclick = runTrace;
    $('#tr-input').onkeydown = e => { if (e.key === 'Enter') runTrace(); };
    // clicking a failed row → put its trace_id into the trace input
    $('#er-model').addEventListener('click', e => {
      const tr = e.target.closest('tr[data-trace]'); if (!tr) return;
      $('#tr-input').value = tr.dataset.trace; runTrace();
    });
    $('#er-tool').addEventListener('click', e => {
      const tr = e.target.closest('tr[data-trace]'); if (!tr) return;
      $('#tr-input').value = tr.dataset.trace; runTrace();
    });
    await load();
  }

  async function load() {
    const w = $('#er-window').value;
    try {
      const data = await getJSON(`/api/trace/errors?window=${w}&limit=200`);
      renderSummary(data.summary);
      renderFailed(data.items);
    } catch (e) { $('#er-summary').innerHTML = errorCard(e); }
    try {
      const slow = await getJSON(`/api/trace/slow-tools?window=${w}&limit=30`);
      renderSlow(slow.items);
    } catch {}
  }

  function renderSummary(s) {
    const block = (title, rows, color) => `<div class="card"><h3>${title}</h3>
      ${rows.length ? `<table><tbody>${rows.map(r => `<tr><td><span class="mono">${escapeHtml(r.k)}</span></td><td class="num">${fmtInt(r.n)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">无</div>'}</div>`;
    $('#er-summary').innerHTML =
      block('按模型错误类型', s.byModelErrorType) +
      block('按工具', s.byToolName) +
      block('按工具错误类型', s.byToolErrorType);
  }

  function renderFailed(items) {
    $('#er-model').querySelector('thead').innerHTML = `<tr><th>时间</th><th>会话</th><th>状态</th><th>来源</th><th>模型</th><th class="num">时延</th><th>错误</th></tr>`;
    $('#er-model').querySelector('tbody').innerHTML = (items.model||[]).map(m => `<tr data-trace="${escapeHtml(m.trace_id||'')}">
      <td class="mono faint">${fmtTime(m.started_at)}</td>
      <td><a href="#sessions/${encodeURIComponent(m.session_id)}/timeline">${shortId(m.session_id,8)}</a></td>
      <td>${statusBadge(m.status)}</td>
      <td><span class="badge dim">${escapeHtml(m.query_source||'')}</span></td>
      <td class="mono">${escapeHtml(m.model_id||'?')}</td>
      <td class="num">${fmtMs(m.duration_ms)}</td>
      <td class="mono" style="color:var(--sev-err);font-size:11px;max-width:280px;overflow:hidden;text-overflow:ellipsis">${escapeHtml((m.error_message||m.error_type||'').slice(0,120))}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">无失败</td></tr>';

    $('#er-tool').querySelector('thead').innerHTML = `<tr><th>时间</th><th>会话</th><th>工具</th><th>状态</th><th>exit</th><th class="num">时延</th><th>错误</th></tr>`;
    $('#er-tool').querySelector('tbody').innerHTML = (items.tool||[]).map(t => `<tr data-trace="${escapeHtml(t.trace_id||'')}">
      <td class="mono faint">${fmtTime(t.started_at)}</td>
      <td><a href="#sessions/${encodeURIComponent(t.session_id)}/timeline">${shortId(t.session_id,8)}</a></td>
      <td class="mono">${escapeHtml(t.tool_name)}</td>
      <td>${statusBadge(t.status)}</td>
      <td class="num">${t.exit_code==null?'—':t.exit_code}</td>
      <td class="num">${fmtMs(t.duration_ms)}</td>
      <td class="mono" style="color:var(--sev-err);font-size:11px;max-width:240px;overflow:hidden;text-overflow:ellipsis">${escapeHtml((t.error_message||t.error_type||'').slice(0,120))}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">无失败</td></tr>';
  }

  function renderSlow(items) {
    $('#er-slow').querySelector('thead').innerHTML = `<tr><th>时间</th><th>会话</th><th>工具</th><th>状态</th><th class="num">时延</th><th>错误</th></tr>`;
    $('#er-slow').querySelector('tbody').innerHTML = items.map(t => `<tr data-trace="${escapeHtml(t.trace_id||'')}">
      <td class="mono faint">${fmtTime(t.started_at)}</td>
      <td><a href="#sessions/${encodeURIComponent(t.session_id)}/timeline">${shortId(t.session_id,8)}</a></td>
      <td class="mono">${escapeHtml(t.tool_name)}</td>
      <td>${statusBadge(t.status)}</td>
      <td class="num">${fmtMs(t.duration_ms)}</td>
      <td class="mono faint">${escapeHtml((t.err||'').slice(0,80))}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">无数据</td></tr>';
  }

  async function runTrace() {
    const traceId = $('#tr-input').value.trim();
    const out = $('#tr-out');
    if (!traceId) { out.innerHTML = '<span class="faint">请输入 trace_id</span>'; return; }
    out.innerHTML = loading('解析日志…');
    try {
      const data = await getJSON(`/api/trace/trace/${encodeURIComponent(traceId)}`);
      renderTrace(traceId, data, out);
    } catch (e) { out.innerHTML = errorCard(e); }
  }

  function renderTrace(traceId, data, out) {
    const evs = data.events || [];
    if (!evs.length) { out.innerHTML = `<div class="empty">日志中无此 trace_id <code>${escapeHtml(traceId)}</code> 的事件（日志按 UTC 天滚动，可能已被清理）</div>`; return; }
    const minTs = new Date(evs[0].timestamp).getTime();
    const maxTs = new Date(evs[evs.length-1].timestamp).getTime();
    const span = Math.max(1, maxTs - minTs);
    out.innerHTML = `<div class="faint" style="margin-bottom:8px">${evs.length} 个事件 · 跨度 ${fmtMs(span)} · ${evs.length} 条 span 记录</div>
      <div class="waterfall" style="border:1px solid var(--border);border-radius:6px;padding:10px">
      ${evs.map(ev => {
        const off = new Date(ev.timestamp).getTime() - minTs;
        const w = Math.max(2, (ev.durationMs || 10) / span * 100);
        const left = off / span * 100;
        const cat = (ev.event||'').startsWith('tool') ? 'tool' : (ev.event||'').startsWith('model') ? 'llm' : 'other';
        const color = cat==='tool' ? 'var(--cat-tool)' : cat==='llm' ? 'var(--cat-llm-2)' : 'var(--fg-5)';
        return `<div class="span-row">
          <span class="faint">${fmtTime(ev.timestamp).slice(0,8)}</span>
          <span class="label"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color};margin-right:6px"></span>${escapeHtml(ev.event||'?')} <span class="faint">${escapeHtml(ev.module||'')}</span></span>
          <span><span style="display:inline-block;height:8px;border-radius:2px;background:${color};width:${Math.min(w,40)}px;margin-left:${Math.min(left,60)}%"></span></span>
          <span class="dur">${ev.durationMs?fmtMs(ev.durationMs):'·'}</span>
        </div>`;
      }).join('')}
      </div>
      <details style="margin-top:8px"><summary class="faint" style="cursor:pointer;font-size:12px">展开原始 span 树 (JSON)</summary><pre class="mono" style="font-size:10.5px;max-height:300px;overflow:auto">${escapeHtml(JSON.stringify(data.forest, null, 2))}</pre></details>`;
  }

  registerView('errors', view);
})();
