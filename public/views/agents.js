'use strict';
// views/agents.js — subagent relationship tree (417 nodes)
(function () {
  const { registerView, $, fmtNum, fmtInt, escapeHtml, shortId, relTime, getJSON, loading, errorCard } = window.ZC;

  async function view() {
    $('#root').innerHTML = `<div class="view max">
      <h1>子 Agent 关系树</h1>
      <span class="muted" style="font-size:12px">主会话 → 派生的子 agent（parent_id 级联）。点击节点跳转会话详情。</span>
      <div id="tree" style="margin-top:14px">${loading('加载树…')}</div>
    </div>`;
    try {
      const data = await getJSON('/api/agents/tree');
      $('#tree').innerHTML = `<div class="faint" style="margin-bottom:8px">${data.total} 个会话 · ${data.roots.length} 个根会话</div>
        <div class="tree">${data.roots.map(r => renderNode(r, 0)).join('')}</div>`;
      // collapse/expand
      $$('#tree .tree-node .row').forEach(row => {
        row.onclick = (e) => {
          if (e.target.closest('a')) return;
          const node = row.parentElement;
          const kids = node.querySelector(':scope > .kids');
          if (kids) kids.hidden = !kids.hidden;
        };
      });
    } catch (e) { $('#tree').innerHTML = errorCard(e); }
  }

  function renderNode(n, depth) {
    const isMain = !n.parent_id;
    const hasKids = n.children && n.children.length;
    const indent = '  '.repeat(depth);
    const label = isMain ? `<span style="color:var(--accent)">● ${escapeHtml(n.title||'(无标题)')}</span>`
                         : `<span style="color:var(--cat-tool-2)">└ ${escapeHtml(n.title||n.id)}</span>`;
    const stats = `${fmtInt(n.model_calls)}req · ${fmtInt(n.tool_calls)}tools · ${fmtNum(n.tokens)}tok`;
    return `<div class="tree-node">
      <div class="row ${isMain?'main':''}">
        <span class="gid">${indent}</span>
        ${label}
        <span class="faint" style="font-size:11px">${stats}</span>
        <span class="faint" style="font-size:11px">${relTime(n.time_updated)}</span>
        <a href="#sessions/${encodeURIComponent(n.id)}/timeline" style="margin-left:auto;font-size:11px">打开 →</a>
      </div>
      ${hasKids ? `<div class="kids">${n.children.map(c => renderNode(c, depth+1)).join('')}</div>` : ''}
    </div>`;
  }

  registerView('agents', view);
})();
