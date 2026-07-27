'use strict';
// views/timeline.js — wire-style event timeline from transcript.jsonl.
// Exported as window.ZC.Timeline with render(sessionId, container).
// This is the primary "what is the agent doing / how does it reason" view.
(function () {
  const { $, $$, fmtNum, fmtMs, fmtTime, escapeHtml, getJSON, loading } = window.ZC;

  // Filters shown above the timeline
  const FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'prompt', label: 'prompt', cats: ['prompt'] },
    { id: 'llm', label: 'llm→', cats: ['llm'] },
    { id: 'tool', label: 'tools', cats: ['tool'] },
    { id: 'network', label: 'network', cats: ['network'] },
    { id: 'usage', label: 'usage', cats: ['usage'] },
    { id: 'errors', label: '⚠ 错误', errorsOnly: true },
  ];

  let activeFilter = 'all';
  let allEvents = [];

  async function render(sessionId, container) {
    activeFilter = 'all';
    container.innerHTML = loading('加载事件流…');
    const data = await getJSON(`/api/transcript/${sessionId}?limit=4000`);
    if (!data.found) {
      container.innerHTML = `
        <div class="card">
          <h3>该会话没有 transcript.jsonl</h3>
          <p class="muted" style="font-size:12.5px;margin:0 0 8px">主交互会话（interactive）不产生 transcript 事件流——它的对话记录在 SQLite 的 <code>message</code>/<code>part</code> 表里，请切到 <b>Context</b> 标签查看完整对话（含推理思考）。</p>
          <p class="muted" style="font-size:12.5px;margin:0">只有子 agent（subagent）才有 transcript.jsonl 实时事件流。</p>
          <p style="margin-top:12px"><a href="#sessions/${encodeURIComponent(sessionId)}/context">→ 去看 Context（完整对话 + reasoning）</a></p>
        </div>`;
      return;
    }
    allEvents = data.events;
    renderHeader(container, data);
    renderEvents(container);
  }

  function renderHeader(container, data) {
    const meta = data.meta || {};
    const agg = data.aggregate || {};
    const toolTop = Object.entries(agg.tools || {}).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const topRow = `
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:baseline">
          <div><span class="badge ${meta.profileId==='Explore'?'teal':'purple'}">${escapeHtml(meta.profileId||'?')}</span></div>
          <div class="muted" style="font-size:12px">${escapeHtml(meta.description||'')}</div>
        </div>
        <div class="kv" style="margin-top:10px;font-size:11.5px">
          <div class="k">状态</div><div class="v">${meta.status||'?'}</div>
          <div class="k">耗时</div><div class="v">${fmtMs(meta.totalDurationMs)}</div>
          <div class="k">总 token</div><div class="v">${fmtNum(meta.totalTokens)}</div>
          <div class="k">工具调用</div><div class="v">${meta.totalToolUseCount ?? '?'}</div>
          <div class="k">事件总数</div><div class="v">${data.count}</div>
          <div class="k">parent</div><div class="v">${meta.parentSessionId?shortIdWrap(meta.parentSessionId):'—'}</div>
          <div class="k">spawn by</div><div class="v">${meta.parentToolUseId?escapeHtml(meta.parentToolUseId):'—'}</div>
        </div>
        ${toolTop.length?`<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${toolTop.map(([n,c])=>`<span class="badge teal">${escapeHtml(n)} <span class="faint">${c}</span></span>`).join('')}</div>`:''}
      </div>`;
    const filterRow = `<div class="toolbar" style="margin:0 0 8px">${FILTERS.map(f =>
      `<button class="btn ${f.id===activeFilter?'on':'ghost'}" data-filter="${f.id}">${f.label}</button>`).join('')}
      <div class="spacer"></div><span class="faint" style="font-size:11.5px" id="tl-count"></span></div>`;
    container.innerHTML = topRow + filterRow + `<div class="timeline" id="tl-events" style="border:1px solid var(--border);border-radius:6px;max-height:65vh;overflow-y:auto"></div>`;
    $$('.btn[data-filter]', container).forEach(b => b.onclick = () => {
      activeFilter = b.dataset.filter;
      $$('.btn[data-filter]', container).forEach(x => x.classList.toggle('on', x.dataset.filter === activeFilter));
      $$('.btn[data-filter]', container).forEach(x => x.classList.toggle('ghost', x.dataset.filter !== activeFilter));
      renderEvents(container);
    });
  }

  function shortIdWrap(id) { return `<a href="#sessions/${encodeURIComponent(id)}/timeline">${escapeHtml(id.slice(0,12))}…</a>`; }

  function renderEvents(container) {
    const filterDef = FILTERS.find(f => f.id === activeFilter) || FILTERS[0];
    let events = allEvents;
    if (filterDef.cats) events = events.filter(e => filterDef.cats.includes(e.category));
    if (filterDef.errorsOnly) events = events.filter(e => isError(e));
    // collapse consecutive streaming deltas into summary rows to reduce noise
    events = coalesceStreaming(events);
    const el = $('#tl-count', container); if (el) el.textContent = `显示 ${events.length} / ${allEvents.length}`;
    const box = $('#tl-events', container);
    if (!events.length) { box.innerHTML = '<div class="empty">无匹配事件</div>'; return; }
    box.innerHTML = events.map(ev => renderRow(ev)).join('');
    // toggle payload
    $$('.ev-row', box).forEach(row => row.onclick = () => {
      const payload = row.nextElementSibling;
      if (payload && payload.classList.contains('ev-payload')) {
        payload.hidden = !payload.hidden;
        row.classList.toggle('open', !payload.hidden);
      }
    });
  }

  function isError(ev) {
    if (ev.type === 'turn_complete' && ev.payload?.resultType && ev.payload.resultType !== 'success') return true;
    const s = (ev.payload?.status || '') + (ev.payload?.resultType || '');
    return /error|fail/i.test(s);
  }

  // Collapse runs of model_streaming text_delta/reasoning_delta into single rows,
  // but PROMINENTLY surface reasoning so the thinking process is visible.
  function coalesceStreaming(events) {
    const out = [];
    let buf = null; // {kind, chars, firstIdx}
    const flush = () => {
      if (!buf) return;
      const ref = events[buf.firstIdx];
      if (buf.kind === 'reasoning_delta') {
        // surface reasoning as its own highlighted pseudo-event
        out.push({
          ...ref,
          type: 'reasoning_coalesced',
          category: 'llm',
          label: 'think',
          icon: '◆',
          summary: `推理输出 +${fmtNum(buf.chars)} 字符 (已折叠 ${buf.count} 段，点开看原文)`,
          payload: { coalesced: true, chars: buf.chars, segments: buf.count },
        });
      } else if (buf.kind === 'text_delta') {
        out.push({
          ...ref,
          type: 'text_coalesced',
          category: 'llm',
          label: 'text',
          icon: '✎',
          summary: `文本输出 +${fmtNum(buf.chars)} 字符 (${buf.count} 段)`,
          payload: { coalesced: true, chars: buf.chars, segments: buf.count },
        });
      } else {
        out.push(ref);
      }
      buf = null;
    };
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'model_streaming') {
        const k = ev.payload?.kind;
        if (k === 'text_delta' || k === 'reasoning_delta') {
          const len = (ev.payload?.delta || '').length;
          if (buf && buf.kind === k) { buf.chars += len; buf.count++; continue; }
          flush();
          buf = { kind: k, chars: len, count: 1, firstIdx: i };
          continue;
        }
        // non-delta streaming kinds (start/end) → keep as-is but skip noise
        if (k === 'start' || k === 'finish' || k?.endsWith('_start') || k?.endsWith('_end')) {
          flush(); out.push(ev); continue;
        }
        flush(); out.push(ev); continue;
      }
      flush();
      out.push(ev);
    }
    flush();
    return out;
  }

  function renderRow(ev) {
    const errCls = isError(ev) ? 'err' : '';
    const payload = ev.payload && Object.keys(ev.payload).length ? ev.payload : null;
    return `<div class="ev-row ${errCls}">
      <span class="seq">${ev.sequenceNumber ?? '·'}</span>
      <span class="ts">${fmtTime(ev.timestamp)}</span>
      <span class="cat cat-dot ${ev.category}"></span>
      <span class="desc"><span class="k ${ev.category}">${escapeHtml(ev.icon||'')} ${escapeHtml(ev.label)}</span> <span class="m">${escapeHtml(ev.summary||'')}</span></span>
      <span class="right">${payload ? '<span class="faint">payload ▾</span>' : ''}</span>
    </div>${payload ? `<div class="ev-payload" hidden><pre>${escapeHtml(JSON.stringify(ev.payload, null, 2))}</pre></div>` : ''}`;
  }

  window.ZC = window.ZC || {};
  window.ZC.Timeline = { render };
})();
