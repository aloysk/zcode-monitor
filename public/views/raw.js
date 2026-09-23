'use strict';
// views/raw.js — raw table viewer for debugging
(function () {
  const { registerView, $, fmtInt, escapeHtml, getJSON, loading, errorCard } = window.ZC;

  // 与 server/routes/raw.js 的 ALLOWED 白名单保持同族（不含 permission/
  // session_task_link 等敏感/边缘表，仅列调试有意义的运行数据表）。
  const TABLES = ['session','message','part','model_usage','tool_usage','turn_usage',
    'session_entry','session_target','session_input','input_history','local_setting','todo','schema_migration',
    'workflow_definition','workflow_run','workflow_activity','workflow_event',
    'dwf_run','dwf_actor','dwf_node','dwf_event'];

  async function view() {
    $('#root').innerHTML = `<div class="view max">
      <div class="toolbar">
        <h1>原始数据</h1>
        <div class="spacer"></div>
        <select id="rw-table">${TABLES.map(t=>`<option value="${t}">${t}</option>`).join('')}</select>
        <select id="rw-order">
          <option value="">不排序</option>
          <option value="started_at">started_at</option>
          <option value="time_created">time_created</option>
          <option value="time_updated">time_updated</option>
          <option value="sequence">sequence</option>
          <option value="id">id</option>
        </select>
        <label class="faint" style="font-size:12px"><input type="checkbox" id="rw-desc"> 降序</label>
        <input type="text" id="rw-where" placeholder="where 条件，如 status='error'" style="width:240px">
        <button class="btn" id="rw-go">查询</button>
      </div>
      <div class="faint" style="font-size:11.5px;margin-bottom:10px">只读访问。最多返回 1000 行。JSON 列已高亮。</div>
      <div id="rw-out">${loading('选择表后查询…')}</div>
    </div>`;
    $('#rw-go').onclick = load;
    $('#rw-where').onkeydown = e => { if (e.key==='Enter') load(); };
    load();
  }

  async function load() {
    const table = $('#rw-table').value;
    const order = $('#rw-order').value;
    const desc = $('#rw-desc').checked ? '1' : '0';
    const where = $('#rw-where').value.trim();
    const out = $('#rw-out');
    out.innerHTML = loading();
    try {
      const q = new URLSearchParams({ limit: 100, order, desc });
      if (where) q.set('where', where);
      const data = await getJSON(`/api/raw/${table}?${q}`);
      renderTable(data, out);
    } catch (e) { out.innerHTML = errorCard(e); }
  }

  function renderTable(data, out) {
    if (!data.rows.length) { out.innerHTML = '<div class="empty">无数据</div>'; return; }
    const cols = Object.keys(data.rows[0]);
    const isJson = (v) => typeof v === 'string' && (v.startsWith('{') || v.startsWith('[')) ;
    // 服务端 order 回落/COUNT 近似说明（R3 raw 收紧）：如实展示，避免「选了
    // time_created 却按 rowid 排」看起来像排序失灵
    const metaBits = [];
    if (data.meta && data.meta.order && data.meta.order.note) metaBits.push(data.meta.order.note);
    if (data.meta && data.meta.count_approx) metaBits.push('行数为 MAX(rowid) 近似（大表精确计数会全表扫描）');
    const metaLine = metaBits.length
      ? `<div class="faint" style="margin-bottom:8px;font-size:11px">⚠ ${metaBits.map(m => escapeHtml(m)).join('；')}</div>` : '';
    out.innerHTML = `<div class="faint" style="margin-bottom:8px">${data.count} 行（显示前 ${data.rows.length}）· 表 <code>${escapeHtml(data.table)}</code></div>`
      + metaLine
      + `<div class="card tight" style="overflow:auto;max-height:70vh"><table>
        <thead><tr>${cols.map(c=>`<th>${escapeHtml(c)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${data.rows.map(r => `<tr>
          ${cols.map(c => {
            const v = r[c];
            if (v == null) return '<td class="faint">null</td>';
            if (isJson(v)) return `<td><details><summary class="faint mono" style="cursor:pointer;font-size:11px">{…}</summary><pre class="mono" style="font-size:10.5px;max-width:520px;max-height:240px;overflow:auto">${escapeHtml(pretty(v))}</pre></details></td>`;
            if (typeof v === 'number') return `<td class="num">${escapeHtml(v)}</td>`;
            return `<td class="mono" style="font-size:11px">${escapeHtml(String(v).slice(0,60))}${String(v).length>60?'…':''}</td>`;
          }).join('')}
          <td><details><summary class="faint" style="cursor:pointer;font-size:11px">行</summary><pre class="mono" style="font-size:10.5px;max-width:600px;max-height:300px;overflow:auto">${escapeHtml(JSON.stringify(r, null, 2))}</pre></details></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  }

  function pretty(s) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } }

  registerView('raw', view);
})();
