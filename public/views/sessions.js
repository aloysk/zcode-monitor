'use strict';
// views/sessions.js — left list + right detail (7 tabs). The core investigative view.
// Tabs: Timeline | Context | Turns | Agents | Tasks | Usage | State
(function () {
  const { registerView, $, $$, fmtInt, fmtNum, fmtMs, fmtDur, fmtTime, fmtTimeFull,
          relTime, escapeHtml, shortId, statusBadge, getJSON, toast, pct, loading, errorCard } = window.ZC;
  // resolve at call time — timeline.js may load after this module
  const TL = () => window.ZC.Timeline;

  const TABS = [
    { id: 'timeline', label: 'Timeline' },
    { id: 'context',  label: 'Context' },
    { id: 'turns',    label: 'Turns' },
    { id: 'agents',   label: 'Agents' },
    { id: 'tasks',    label: 'Tasks' },
    { id: 'usage',    label: 'Usage' },
    { id: 'state',    label: 'State' },
  ];

  let currentId = null;
  let currentTab = 'timeline';
  let listData = [];

  async function view(args) {
    // args may be [sessionId] or [sessionId, tab]
    currentId = args[0] || null;
    currentTab = args[1] && TABS.some(t => t.id === args[1]) ? args[1] : 'timeline';

    $('#root').innerHTML = `
      <div class="work">
        <aside class="listpane">
          <div class="head">
            <input type="search" id="list-search" placeholder="搜索 id / 标题 / 目录…">
            <div class="toolbar" style="margin:0;display:flex;gap:6px">
              <select id="list-tasktype" style="flex:1">
                <option value="">全部类型</option>
                <option value="interactive">interactive</option>
                <option value="subagent_child">subagent</option>
                <option value="selection_side_chat">side_chat</option>
              </select>
              <select id="list-sort">
                <option value="recent">最近</option>
                <option value="tokens">token 多</option>
                <option value="calls">调用多</option>
              </select>
            </div>
          </div>
          <div class="scroll" id="list-scroll">${loading('加载会话…')}</div>
        </aside>
        <section class="detailpane">
          <div id="detail-head"></div>
          <div class="tabs" id="tabs"></div>
          <div class="tab-body" id="tab-body">${currentId ? loading() : '<div class="empty">← 从左侧选择一个会话</div>'}</div>
        </section>
      </div>
    `;

    $('#list-search').oninput = renderList;
    $('#list-tasktype').onchange = loadList;
    $('#list-sort').onchange = renderList;
    $$('#tabs')[0].addEventListener('click', e => {
      const t = e.target.closest('.tab'); if (!t) return;
      currentTab = t.dataset.tab; renderTabs(); loadTab();
    });
    $$('#list-scroll')[0].addEventListener('click', e => {
      const it = e.target.closest('.listitem'); if (!it) return;
      currentId = it.dataset.id; currentTab = 'timeline';
      renderListActive(); renderTabs(); loadDetailHead(); loadTab();
    });

    await loadList();
    if (currentId) { renderTabs(); loadDetailHead(); loadTab(); }
  }

  async function loadList() {
    try {
      listData = (await getJSON('/api/sessions?limit=500')).sessions;
      renderList();
    } catch (e) { $('#list-scroll').innerHTML = errorCard(e); }
  }

  function renderList() {
    const q = ($('#list-search')?.value || '').toLowerCase().trim();
    const tt = $('#list-tasktype')?.value || '';
    const sort = $('#list-sort')?.value || 'recent';
    let items = listData.filter(s => !tt || s.task_type === tt);
    if (q) items = items.filter(s =>
      (s.id||'').toLowerCase().includes(q) ||
      (s.title||'').toLowerCase().includes(q) ||
      (s.directory||'').toLowerCase().includes(q));
    if (sort === 'tokens') items.sort((a,b) => (b.total_tokens||0) - (a.total_tokens||0));
    else if (sort === 'calls') items.sort((a,b) => ((b.model_calls||0)+(b.tool_calls||0)) - ((a.model_calls||0)+(a.tool_calls||0)));
    else items.sort((a,b) => (b.time_updated||0) - (a.time_updated||0));

    const el = $('#list-scroll');
    if (!items.length) { el.innerHTML = '<div class="empty">无匹配会话</div>'; return; }
    el.innerHTML = items.map(s => {
      const isSub = s.task_type === 'subagent_child';
      const hasErr = s.model_calls && !s.tool_calls; // crude; real error shown in detail
      return `<div class="listitem ${s.id===currentId?'active':''}" data-id="${escapeHtml(s.id)}">
        <div class="t">${escapeHtml(s.title || '(无标题)')}</div>
        <div class="s">
          <span>${relTime(new Date(s.time_updated).toISOString())}</span>
          <span>${isSub?'<span class="badge dim">subagent</span>':'<span class="badge blue">main</span>'}</span>
          ${s.total_tokens?`<span>${fmtNum(s.total_tokens)} tok</span>`:''}
          ${s.model_calls?`<span>${fmtInt(s.model_calls)} req</span>`:''}
        </div>
      </div>`;
    }).join('');
  }

  function renderListActive() {
    $$('#list-scroll .listitem').forEach(el => el.classList.toggle('active', el.dataset.id === currentId));
  }

  function renderTabs() {
    $('#tabs').innerHTML = TABS.map(t =>
      `<div class="tab ${t.id===currentTab?'active':''}" data-tab="${t.id}">${t.label}</div>`).join('');
  }

  async function loadDetailHead() {
    if (!currentId) return;
    try {
      const s = (await getJSON('/api/sessions/' + currentId)).session;
      const isSub = s.task_type === 'subagent_child';
      $('#detail-head').innerHTML = `
        <div class="title">${escapeHtml(s.title || '(无标题)')} ${isSub?'<span class="badge purple">subagent</span>':''}</div>
        <div class="sub">${escapeHtml(s.id)} ${s.parent_id?'· parent '+shortId(s.parent_id):''} ${s.directory?'· '+escapeHtml(s.directory):''}</div>`;
    } catch {}
  }

  async function loadTab() {
    if (!currentId) return;
    const body = $('#tab-body');
    body.innerHTML = loading();
    try {
      switch (currentTab) {
        case 'timeline': await TL().render(currentId, body); break;
        case 'context':  await renderContext(currentId, body); break;
        case 'turns':    await renderTurns(currentId, body); break;
        case 'agents':   await renderAgents(currentId, body); break;
        case 'tasks':    await renderTasks(currentId, body); break;
        case 'usage':    await renderUsage(currentId, body); break;
        case 'state':    await renderState(currentId, body); break;
      }
    } catch (e) { body.innerHTML = errorCard(e); }
  }

  // ── Context tab: full conversation from message+part ──
  // Left mini-rail (one node per turn) + right conversation body.
  // Each rail node shows: status-color dot + user question summary + tool/tok/dur.
  async function renderContext(id, body) {
    const [data, turnsData] = await Promise.all([
      getJSON(`/api/sessions/${id}/conversation?max=800`),
      getJSON(`/api/sessions/${id}/turns`).catch(() => ({ turns: [] })),
    ]);
    const messages = data.messages || [];
    if (!messages.length) { body.innerHTML = '<div class="empty">无对话记录</div>'; return; }

    // Group messages into turns. Messages with no turn_id (lifecycle events:
    // model_change / compaction) are attached to the NEXT real turn, so the
    // rail has one node per actual turn rather than one per stray event.
    const turnOrder = [];              // turn_id[] in first-seen order
    const turnUser = new Map();        // turn_id → first user text-part text
    const turnFallback = new Map();    // turn_id → first assistant text-part text
    const msgTurnIdx = new Array(messages.length).fill(-1); // msg i → index into turnOrder
    let pending = [];                  // orphan msg indices awaiting a turn
    const firstText = (m) => (m.parts || []).map(p => (p.data||{}).type === 'text' && (p.data||{}).text)
      .filter(Boolean).join(' ').trim();
    messages.forEach((m, i) => {
      const tid = m.turn_id;
      if (!tid) { pending.push(i); return; }       // defer; fold into next real turn
      if (!turnUser.has(tid)) {
        turnOrder.push(tid);
        turnUser.set(tid, '');
        turnFallback.set(tid, '');
      }
      const ix = turnOrder.indexOf(tid);
      msgTurnIdx[i] = ix;
      // fold deferred orphans into this turn (they precede it)
      for (const pi of pending) msgTurnIdx[pi] = ix;
      pending = [];
      const txt = firstText(m);
      if (!txt) return;
      if (m.role === 'user' && !turnUser.get(tid)) turnUser.set(tid, txt);
      else if (m.role === 'assistant' && !turnFallback.get(tid)) turnFallback.set(tid, txt);
    });

    // Pick a clean one-line summary for a turn. Strips agent-injected XML
    // wrappers (<system-reminder>, <untrusted_objective>, …) that some turns
    // carry as the "user" message; falls back to the assistant's first text.
    const cleanText = (s) => (s || '')
      .replace(/<[a-zA-Z][^>]*>/g, ' ')        // drop XML-ish tags & their content
      .replace(/<\/[a-zA-Z][^>]*>/g, ' ')
      .replace(/\s+/g, ' ').trim();
    const pickSummary = (tid, idx) => {
      const u = cleanText(turnUser.get(tid));
      if (u && u.length >= 2) return u;
      const a = cleanText(turnFallback.get(tid));
      if (a && a.length >= 2) return a;
      return idx > 0 ? `Turn ${idx + 1}` : 'Turn 1';
    };
    // trailing orphans (lifecycle after the last turn) → attach to last turn
    if (pending.length && turnOrder.length) {
      const lastIx = turnOrder.length - 1;
      for (const pi of pending) msgTurnIdx[pi] = lastIx;
    }
    // turn metadata from /turns (status / dur / tokens / tools) by turn_id
    const turnMeta = new Map((turnsData.turns || []).map(t => [t.turn_id, t]));

    // build rail nodes, one per turn in order
    const railNodes = turnOrder.map((tid, idx) => {
      const meta = turnMeta.get(tid) || {};
      const stColor = meta.status === 'error' ? 'err'
                    : meta.status === 'cancelled' ? 'warn' : 'ok';
      const summary = pickSummary(tid, idx);
      const short = summary.length > 40 ? summary.slice(0, 40) + '…' : summary;
      const dur = meta.duration_ms ? fmtDur(meta.duration_ms / 1000) : '';
      const tok = meta.computed_total_tokens ? fmtNum(meta.computed_total_tokens) + ' tok' : '';
      const tools = meta.tool_call_count ? '⚙×' + meta.tool_call_count : '';
      const sub = [tools, tok, dur].filter(Boolean).join(' · ');
      return `<div class="ctx-node" data-turnidx="${idx}" title="${escapeHtml(summary)}">
        <span class="ctx-dot ${stColor}"></span>
        <div class="ctx-text">
          <div class="ctx-sum">${escapeHtml(short)}</div>
          ${sub ? `<div class="ctx-sub mono">${sub}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    // build conversation body — tag each message with id for scroll-to + turn mapping
    const msgsHtml = messages.map((m, i) => {
      const html = renderMessage(m, i);
      const idx = msgTurnIdx[i];
      if (idx < 0) {
        return html.replace('<div class="msg"', `<div class="msg" id="msg-${i}"`);
      }
      // inject id + data-turnidx into the .msg wrapper (first attr after class)
      return html.replace('<div class="msg"',
        `<div class="msg" id="msg-${i}" data-turnidx="${idx}"`);
    }).join('');

    body.innerHTML = `<div class="ctx-grid">
      <aside class="ctx-rail" id="ctx-rail">
        <div class="ctx-rail-tools" id="ctx-rail-tools">
          <button type="button" class="ctx-tool-btn" data-act="expand">展开全部</button>
          <button type="button" class="ctx-tool-btn" data-act="collapse">收拢全部</button>
        </div>
        ${railNodes}
      </aside>
      <div class="conv">${msgsHtml}</div>
    </div>`;

    // wire tool-part toggles
    $$('.part.tool .plabel', body).forEach(el => el.onclick = () => {
      el.nextElementSibling.classList.toggle('collapsed');
    });
    $$('.part.reasoning .plabel', body).forEach(el => el.onclick = () => {
      el.parentElement.classList.toggle('collapsed');
    });

    // expand-all / collapse-all for the collapsible blocks.
    // tool:     toggle the `.body` sibling (.collapsed hides it)
    // reasoning:toggle the `.part.reasoning` itself (.collapsed hides .ptext)
    const setAll = (expand) => {
      $$('.part.tool .body', body).forEach(el => el.classList.toggle('collapsed', !expand));
      $$('.part.reasoning', body).forEach(el => el.classList.toggle('collapsed', !expand));
    };
    $('#ctx-rail-tools', body).addEventListener('click', e => {
      const btn = e.target.closest('.ctx-tool-btn'); if (!btn) return;
      setAll(btn.dataset.act === 'expand');
    });
    // load tool outputs lazily where they're referenced
    $$('.part.tool[data-callid]', body).forEach(async (el) => {
      const callId = el.dataset.callid;
      try {
        const out = await getJSON(`/api/sessions/${id}/tool-output/${callId}`);
        const ob = $('.output-block', el);
        if (out.stdout || out.stderr) {
          ob.classList.remove('empty');
          ob.innerHTML = `${out.stdout?`<div>stdout:</div><pre>${escapeHtml(out.stdout)}</pre>`:''}${out.stderr?`<div style="color:var(--sev-err)">stderr:</div><pre>${escapeHtml(out.stderr)}</pre>`:''}`;
        }
      } catch {}
    });

    // rail node click → scroll the .tab-body (the real scroll container) so the
    // turn's first message sits near the top. We compute the offset manually
    // instead of scrollIntoView, which would also scroll ancestor containers.
    const scroller = body;  // #tab-body
    const railEl = $('#ctx-rail', body);
    railEl.addEventListener('click', e => {
      const node = e.target.closest('.ctx-node'); if (!node) return;
      const idx = +node.dataset.turnidx;
      const msg = body.querySelector(`.msg[data-turnidx="${idx}"]`);
      if (!msg) return;
      const delta = msg.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollBy({ top: delta, behavior: 'smooth' });
    });

    // highlight current turn in the rail as you scroll
    const nodes = $$('.ctx-node', body);
    const msgEls = $$('.msg[data-turnidx]', body);
    if ('IntersectionObserver' in window) {
      const activeFor = new Map();   // turnIdx → ratio
      const io = new IntersectionObserver(entries => {
        entries.forEach(en => {
          const idx = +en.target.dataset.turnidx;
          activeFor.set(idx, (activeFor.get(idx) || 0) + (en.isIntersecting ? en.intersectionRatio : 0));
        });
        // pick turn with highest visibility; ties → lowest idx (earliest)
        let best = -1, bestR = 0;
        for (const [idx, r] of activeFor) {
          if (r > bestR || (r === bestR && (best < 0 || idx < best))) { best = idx; bestR = r; }
        }
        if (best >= 0) nodes.forEach(n => n.classList.toggle('active', +n.dataset.turnidx === best));
      }, { root: scroller, rootMargin: '0px 0px -60% 0px', threshold: [0, 0.25, 0.5, 1] });
      msgEls.forEach(el => io.observe(el));
    }
  }

  function renderMessage(m, idx) {
    const role = m.role || '?';
    const meta = [
      m.model, m.variant && `variant=${m.variant}`, m.mode, m.agent,
      m.turn_id && 'turn ' + shortId(m.turn_id, 10),
      m.tokens && `in ${fmtNum(m.tokens.input)} / out ${fmtNum(m.tokens.output)}${m.tokens.reasoning?` / think ${fmtNum(m.tokens.reasoning)}`:''}`,
    ].filter(Boolean).join(' · ');
    const num = idx != null ? `<span class="msg-num mono" title="消息序号">#${idx + 1}</span>` : '';
    return `<div class="msg">
      <div class="msg-head">
        ${num}
        <span class="role ${role}">${role}</span>
        <span class="meta">${escapeHtml(meta)}</span>
        <span class="meta right">${fmtTime(m.time_created)}</span>
      </div>
      <div class="msg-body">${(m.parts||[]).map(p => renderPart(p)).join('') || '<div class="faint">(无内容)</div>'}</div>
    </div>`;
  }

  function renderPart(p) {
    const d = p.data || {};
    const t = d.type;
    if (t === 'text') return `<div class="part text"><div class="ptext">${escapeHtml(d.text||'')}</div></div>`;
    if (t === 'reasoning') return `<div class="part reasoning collapsed">
      <div class="plabel">◆ 推理思考 (reasoning) <span class="faint" style="font-weight:400">— 点击展开</span></div>
      <div class="ptext">${escapeHtml(d.text||'')}</div></div>`;
    if (t === 'tool') {
      const st = d.state || {};
      const inp = st.input ? JSON.stringify(st.input, null, 2) : '';
      const flags = [];
      // tool flags from part aren't stored; we just show status
      return `<div class="part tool" data-callid="${escapeHtml(d.callID||'')}">
        <div class="plabel">⚙ ${escapeHtml(d.tool||'?')} ${statusBadge(st.status)} <span class="flags faint">${escapeHtml(st.title||'')}</span></div>
        <div class="body collapsed">
          ${inp?`<div class="input-block">input:<pre>${escapeHtml(inp)}</pre></div>`:''}
          <div class="output-block empty">output: <span class="faint">(加载中或无 exec 记录)</span></div>
        </div>
      </div>`;
    }
    if (t === 'step-finish') {
      const tk = d.tokens || {};
      return `<div class="part step-finish">step-finish · ${d.reason||''} · in ${fmtNum(tk.input)} / out ${fmtNum(tk.output)} / think ${fmtNum(tk.reasoning)} · cache r${fmtNum(tk.cache?.read)} w${fmtNum(tk.cache?.write)}</div>`;
    }
    if (t === 'timeline') {
      return `<div class="part step-finish">⎯ ${escapeHtml(d.timelineType||'timeline')} ${d.fromModel?.modelID||''} → ${d.toModel?.modelID||''} ${d.toModel?.variant||''} ${statusBadge(d.status)}</div>`;
    }
    if (t === 'compaction') {
      return `<div class="part step-finish">⌘ compaction (${d.trigger||''}) · ${fmtNum(d.preCompactTokenCount)} → ${fmtNum(d.postCompactTokenCount)} tok ${statusBadge(d.timelineStatus)}</div>`;
    }
    if (t === 'file') {
      const url = d.url || '';
      if (d.mime && d.mime.startsWith('image/') && url) {
        return `<div class="part file"><img src="${escapeHtml(url)}" alt="image"></div>`;
      }
      return `<div class="part step-finish">📎 file · ${escapeHtml(d.mime||'')} · ${escapeHtml(url)}</div>`;
    }
    return `<div class="part step-faint">[${escapeHtml(t||'part')}]</div>`;
  }

  // ── Turns tab ──
  async function renderTurns(id, body) {
    const data = await getJSON(`/api/sessions/${id}/turns`);
    if (!data.turns.length) { body.innerHTML = '<div class="empty">无 turn 记录</div>'; return; }
    const maxDur = Math.max(...data.turns.map(t => t.duration_ms || 0), 1);
    body.innerHTML = `<h2>Turn 时间线 <span class="sub">${data.turns.length} 个 turn</span><span class="caliber" title="turn_usage 不含标题生成等 side call（query_source='session_title' 只写 model_usage），turn 级 token 总量为下界，见 docs/usage-accounting.md">下界</span></h2>
      <div class="turns">${data.turns.map(t => {
        const w = pct(t.duration_ms, maxDur);
        const fill = t.status==='error' ? 'var(--sev-err)' : t.status==='cancelled' ? 'var(--sev-warn)' : 'var(--accent)';
        const dur = t.duration_ms ? fmtDur(t.duration_ms/1000) : '…';
        return `<div class="turn" data-turn="${escapeHtml(t.turn_id||'')}">
          <span class="dur">${dur}</span>
          <div><div class="bar"><span class="fill" style="width:${w}%;background:${fill}"></span></div>
            <div class="faint mono" style="font-size:10.5px;margin-top:3px">${shortId(t.turn_id,16)} ${t.context_exceeded?'· ⚠ context_exceeded':''} ${t.error_type?'· '+escapeHtml(t.error_type):''}</div></div>
          <span class="stats">${fmtInt(t.model_request_count)} req · ${fmtInt(t.tool_call_count)} tools · ${fmtNum(t.computed_total_tokens)} tok</span>
        </div>`;
      }).join('')}</div>`;
  }

  // ── Agents tab ──
  async function renderAgents(id, body) {
    const data = await getJSON(`/api/sessions/${id}/children`);
    if (!data.children.length) { body.innerHTML = '<div class="empty">该会话未派生子 agent</div>'; return; }
    body.innerHTML = `<h2>子 Agent <span class="sub">${data.children.length} 个</span></h2>
      <div class="card tight" style="overflow-x:auto"><table>
        <thead><tr><th>profile</th><th>描述</th><th class="num">token</th><th>创建</th><th></th></tr></thead>
        <tbody>${data.children.map(c => `<tr data-id="${escapeHtml(c.id)}">
          <td><span class="badge ${c.profile==='Explore'?'teal':'purple'}">${escapeHtml(c.profile||'?')}</span></td>
          <td>${escapeHtml((c.prompt||'').slice(0,80))}${c.prompt&&c.prompt.length>80?'…':''}</td>
          <td class="num">${fmtNum(c.total_tokens)}</td>
          <td><span class="mono faint">${relTime(c.time_created)}</span></td>
          <td><a href="#sessions/${encodeURIComponent(c.id)}/timeline">打开 →</a></td>
        </tr>`).join('')}</tbody></table></div>`;
  }

  // ── Tasks tab (todo) ──
  async function renderTasks(id, body) {
    const data = await getJSON(`/api/raw/todo?limit=200&order=position&where=session_id='${encodeURIComponent(id)}'`);
    if (!data.rows.length) { body.innerHTML = '<div class="empty">无 todo 记录</div>'; return; }
    const sc = { pending:'yellow', in_progress:'blue', completed:'green' };
    const pc = { high:'red', medium:'yellow', low:'dim' };
    body.innerHTML = `<div class="card"><div class="turns" style="gap:3px">${data.rows.map(r => `
      <div style="display:flex;gap:10px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border-soft)">
        <span class="badge ${sc[r.status]||'dim'}">${escapeHtml(r.status)}</span>
        <span class="badge ${pc[r.priority]||'dim'}">${escapeHtml(r.priority)}</span>
        <span style="flex:1">${escapeHtml(r.content)}</span>
      </div>`).join('')}</div></div>`;
  }

  // ── Usage tab: per-turn token/tool breakdown ──
  async function renderUsage(id, body) {
    const data = await getJSON(`/api/sessions/${id}/turns`);
    if (!data.turns.length) { body.innerHTML = '<div class="empty">无 usage 数据</div>'; return; }
    body.innerHTML = `<div class="card tight" style="overflow-x:auto"><table>
      <thead><tr><th>turn</th><th>状态</th><th class="num">req</th><th class="num">tools</th><th class="num">tool err</th><th class="num">input</th><th class="num">output</th><th class="num">reasoning</th><th class="num">cache read</th><th class="num">total<span class="caliber" title="turn_usage 不含标题生成等 side call，总量为下界（官方口径 computed_total_tokens 本身的下界），见 docs/usage-accounting.md">下界</span></th><th class="num">耗时</th></tr></thead>
      <tbody>${data.turns.map(t => `<tr>
        <td class="mono faint">${shortId(t.turn_id,10)}</td>
        <td>${statusBadge(t.status)}</td>
        <td class="num">${fmtInt(t.model_request_count)}</td>
        <td class="num">${fmtInt(t.tool_call_count)}</td>
        <td class="num ${t.tool_error_count?'':''}">${t.tool_error_count?`<span style="color:var(--sev-err)">${t.tool_error_count}</span>`:'0'}</td>
        <td class="num">${fmtInt(t.input_tokens)}</td>
        <td class="num">${fmtInt(t.output_tokens)}</td>
        <td class="num ${t.reasoning_tokens?'v-purple':''}">${fmtInt(t.reasoning_tokens)}</td>
        <td class="num">${fmtInt(t.cache_read_input_tokens)}</td>
        <td class="num">${fmtInt(t.computed_total_tokens)}</td>
        <td class="num">${fmtMs(t.duration_ms)}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  // ── State tab: session metadata ──
  async function renderState(id, body) {
    const s = (await getJSON('/api/sessions/' + id)).session;
    const kv = (k, v) => `<div class="k">${escapeHtml(k)}</div><div class="v">${v==null?'<span class="faint">null</span>':escapeHtml(String(v))}</div>`;
    body.innerHTML = `<div class="card"><div class="kv">
      ${kv('id', s.id)}
      ${kv('title', s.title)}
      ${kv('task_type', s.task_type)}
      ${kv('parent_id', s.parent_id)}
      ${kv('workspace_id', s.workspace_id)}
      ${kv('project_id', s.project_id)}
      ${kv('directory', s.directory)}
      ${kv('permission', s.permission)}
      ${kv('trace_id', s.trace_id)}
      ${kv('time_created', fmtTimeFull(new Date(s.time_created).toISOString()))}
      ${kv('time_updated', fmtTimeFull(new Date(s.time_updated).toISOString()))}
      ${kv('summary_files', s.summary_files)}
      ${kv('summary_additions', s.summary_additions)}
      ${kv('summary_deletions', s.summary_deletions)}
      ${kv('share_url', s.share_url)}
    </div></div>`;
  }

  registerView('sessions', view);
})();
