'use strict';
// views/sessions.js — left list + right detail (7 tabs). The core investigative view.
// Tabs: Timeline | Context | Turns | Agents | Tasks | Usage | State
(function () {
  const { registerView, $, $$, fmtInt, fmtNum, fmtMs, fmtDur, fmtTime, fmtTimeFull,
          relTime, escapeHtml, shortId, statusBadge, getJSON, toast, pct, loading, errorCard } = window.ZC;
  // resolve at call time — timeline.js may load after this module
  const TL = () => window.ZC.Timeline;
  // resolve at call time — context-gauge.js 加载于本模块之前（index.html 引入序），
  // 但取用点防漂移（与 TL() 同款形态）
  const ZCg = () => window.ZC.ContextGauge;

  // Context 标签水位区的 live 订阅（overview.js liveEs 同款生命周期）：
  // 切会话/重入由 renderContext/view 入口同步幂等 close（overview.js:453 先例，
  // 杜绝孤儿 EventSource）；离开标签后容器不在 DOM 时的事件路自愈关流见
  // startGaugeLive 守卫（model+tool 双帧触发）。
  let gaugeEs = null;
  // live 行软上限（F-码-8）：种子侧有意钳 100 行（contextGaugeRows 方向钉），
  // live 行无条件累积则长开 Context 标签数小时后序列达数千行、每条新行都触发
  // O(n) 全量重 compute 与重写——超 2× 种子上限即丢最旧 live 行（种子行永不
  // 丢；水位/增量口径不变：丢行后 delta 基准自动退到下一保留行/末种子行）。
  const GAUGE_LIVE_ROWS_CAP = 200;
  // 曲线呈现列数上限（F-码-8）：种子 100 列是既有可读设计（≈8px/列@800px 标签
  // 面板）+20 列余量；数据面由上行 200 行界住计算，呈现面再取最近 120 列
  // （被截段在曲线左端以「+k」占位如实标示，水位条/回落摘要不受影响）。
  const GAUGE_CURVE_MAX_COLS = 120;
  // 代际 token（F-码-4）：renderContext 入口自增，在途取数完成后与当前值比对
  // ——迟到的旧实例整批自弃。防跨会话取数竞态：A 在途时切到 B，B 先占
  // gaugeEs 单槽，A 迟到若照常 startGaugeLive 会覆写槽位成孤儿连接（其自愈
  // 守卫按 #ctx-gauge-card 查卡，B 的新卡同 id 在 DOM，守卫永不触发）。
  let gaugeGen = 0;
  function closeGaugeLive() {
    if (gaugeEs) { gaugeEs.close(); gaugeEs = null; }
  }

  // Agents tab 子代理计数轮询（overview.js autoTimer 同款生命周期纪律）：
  // 深挖页停留期间新派生的子代理此前永不出现（renderAgents 只在切 tab 时
  // 查询一次）。sessionChildren SQL 走 session_parent_idx + model_usage 的
  // (session_id,turn_id) 索引毫秒级；路由侧 metadata enrich 已索引化+缓存
  //（server/routes/sessions.js childMetaIndex，O(N) 单遍 + mtime/TTL 缓存）。
  // 数据相同跳过重渲染（不打断 hover/文本选择）；tab/会话切换由 loadTab/
  // view 入口统一停。5s 一轮。
  const AGENTS_POLL_MS = 5000;
  let agentsTimer = null;
  // 代际 token（gaugeGen 同款）：renderAgents 的 setInterval 在 await 取数
  // 之后才执行——两次交叠调用（route 重入）会让后者的 stopAgentsPoll 扑空
  // （前者尚未 set），两个都 set 后槽位只留一个句柄，另一个成孤儿定时器
  // （无法停、双倍轮询）。入口 ++、await 后比对：旧实例整批自弃，定时器
  // 恒由最新实例创建，槽位一致。
  let agentsGen = 0;
  function stopAgentsPoll() {
    if (agentsTimer) { clearInterval(agentsTimer); agentsTimer = null; }
  }

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
    closeGaugeLive(); // 会话视图重入（含会话内 hash 跳转）：摘掉上一实例的 live 订阅
    stopAgentsPoll(); // 同上：摘掉 Agents tab 可能存续的轮询定时器

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
                <option value="workflow_child">workflow</option>
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

  // ── C6 会话状态徽标（§2.1 需求 4）──────────────────────────────────────
  // 分类器四态、三态位只承三态：working/waiting/idle 各一枚；broken 会话的
  // 三态位渲染 idle 形态、可见性由叠加的 broken 徽标独占（评审钉，防发散）。
  // 形态全复用既有 badge 类（类目色 + color-mix 8% 透明底，styles.css 零触碰）：
  // working=blue（运行中，statusBadge 的 running 同色）、idle=dim、broken=red；
  // waiting 的低置信只落在虚线描边上（badge.yellow 的文本/描边色本就不透明——
  // 「弱化」不得降文本对比，§6 第 2 条 AA 调和的评审钉），hover title 固定
  // 置信标注文案（spec §2.1 需求 4 照抄，含「启发式」grep 锚）；全段禁用
  // approval 语义措辞（approval_status 只记终态——spec 同条的措辞禁令）。
  // signal 字段缺失
  // （旧缓存/旧服务）时徽标整位不渲染：renderList 是无 try/catch 的逐键热
  // 路径，装饰性元素不得拖垮列表（C2 mini 条同款纪律）。
  //
  // needs-attention 置顶分组（§2.1 需求 4 原设计）已按 C6-8 误报抽样处置
  // **摘除**（residuals R-28）：48h 回放 576 样本误报 39.8%（复核跑 580/41.2%，
  // 均 >20% 线），收窗 8min 重测反升至 47.8%——spec §2.1 需求 7 降级条款
  // 生效：waiting 徽标与置信标注保留（低置信如实呈现），置顶（对 waiting 的
  // 视觉强推送）摘除；broken 徽标不受影响（数据驱动、无误报问题）。
  const SIGNAL_WAIT_TITLE = '启发式判定：最近一次模型活动正常收尾且当前无在飞请求'
    + '——数据面无权限等待信号源，判定为时间启发式（可能误报）';
  function signalBadgesHtml(sig) {
    if (!sig || !sig.state) return '';
    const reasonTitle = escapeHtml(sig.reason || '');
    const threeState = sig.state === 'working'
      ? `<span class="badge blue" title="${reasonTitle}">working</span>`
      : sig.state === 'waiting'
        ? `<span class="badge yellow" style="border-style:dashed" title="${SIGNAL_WAIT_TITLE}">waiting</span>`
        : `<span class="badge dim" title="${reasonTitle}">idle</span>`;
    const broken = sig.state === 'broken'
      ? ` <span class="badge red" title="${reasonTitle}">broken</span>`
      : '';
    return threeState + broken;
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
    // 排序/过滤语义与服务端排序不因 C6 改动（置顶分组已按 C6-8 处置摘除，
    // 见上方徽标注释块；三态徽标随行内渲染，不参与排序）。

    const el = $('#list-scroll');
    if (!items.length) { el.innerHTML = '<div class="empty">无匹配会话</div>'; return; }
    el.innerHTML = items.map(s => renderListRow(s)).join('');
  }

  function renderListRow(s) {
    // 徽标四态：已知三类显式映射；未知 task_type 落 dim+原值——不冒充 main
    //（dwf 轮的教训：此前未知类型一律标 main，selection_side_chat 就曾被错标）。
    const tt = s.task_type;
    const badge = tt === 'subagent_child' ? '<span class="badge dim">subagent</span>'
      : tt === 'workflow_child' ? '<span class="badge purple">workflow</span>'
      : tt === 'interactive' ? '<span class="badge blue">main</span>'
      : `<span class="badge dim">${escapeHtml(tt || '?')}</span>`;
    // C2 mini 水位条（sessionList latest_model）：无 model 行会话
    //（latest_model.model_id===null）不渲染——空数据形状钉死（C2-4 源码契约）；
    // 未知模型（context_tokens===null）条可渲染但不显百分比（不猜窗口，
    // 「非官方权威」标注挂 title——miniGaugeHtml 内实现）。组件缺失（加载失败）
    // 时静默降级为不渲染——renderList 是逐键热路径且无 try/catch，装饰性元素
    // 不得拖垮整个会话列表。
    const lm = s.latest_model || {};
    const cg = ZCg();
    const mini = cg && lm.model_id != null && lm.input_tokens != null
      ? cg.miniGaugeHtml(lm.input_tokens, lm.context_tokens)
      : '';
    return `<div class="listitem ${s.id===currentId?'active':''}" data-id="${escapeHtml(s.id)}">
      <div class="t">${escapeHtml(s.title || '(无标题)')}</div>
      <div class="s">
        <span>${relTime(new Date(s.time_updated).toISOString())}</span>
        <span>${badge}</span>
        ${signalBadgesHtml(s.signal)}
        ${s.total_tokens?`<span>${fmtNum(s.total_tokens)} tok</span>`:''}
        ${s.model_calls?`<span>${fmtInt(s.model_calls)} req</span>`:''}
        ${mini}
      </div>
    </div>`;
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
      const isWf = s.task_type === 'workflow_child';
      $('#detail-head').innerHTML = `
        <div class="title">${escapeHtml(s.title || '(无标题)')} ${isSub?'<span class="badge purple">subagent</span>':''} ${isWf?'<span class="badge purple">workflow</span>':''}</div>
        <div class="sub">${escapeHtml(s.id)} ${s.parent_id?'· parent '+shortId(s.parent_id):''} ${s.directory?'· '+escapeHtml(s.directory):''}</div>`;
    } catch (e) { console.warn('[sessions] 详情头加载失败', e); }
  }

  async function loadTab() {
    if (!currentId) return;
    stopAgentsPoll(); // 切 tab 统一先停旧轮询（Agents 分支按需重启）
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
  // 顶部为 C2 上下文水位区（live 水位条 + 逐轮增量曲线 + compaction 边界竖线 +
  // 水位回落摘要；种子 GET /api/sessions/:id/context-gauge，live 走既有
  // /api/live/events 的 model 行——SSE 复用不加新通道）。
  async function renderContext(id, body) {
    closeGaugeLive(); // 切会话/重入：先同步关掉上一实例的 live 订阅（幂等）
    const gen = ++gaugeGen; // 本实例代际：在途取数期间被更新代际超越即自弃
    const [data, turnsData, gaugeData] = await Promise.all([
      getJSON(`/api/sessions/${id}/conversation?max=800`),
      getJSON(`/api/sessions/${id}/turns`).catch(() => ({ turns: [] })),
      // 水位种子取数失败不折叠成空序列（F-败-2）：一切错误（含旧 schema 缺列
      // 的 500）都曾落进「新会话无数据」空态文案——失败与空必须可区分；failed
      // 标记传 renderGaugeSection 渲染错误卡（live 行到达后以 live 数据为准）。
      getJSON(`/api/sessions/${id}/context-gauge?limit=100`)
        .catch(e => { console.warn('[sessions] 水位种子取数失败', e); return { rows: [], failed: true }; }),
    ]);
    // 迟到的旧实例自弃（F-码-4）：不覆写新实例 DOM、不 startGaugeLive（防孤儿）。
    if (gen !== gaugeGen) return;
    const messages = data.messages || [];
    const seedRows = gaugeData.rows || [];
    const seedFailed = !!gaugeData.failed;
    const gaugeHtml = renderGaugeSection(seedRows, [], { failed: seedFailed });
    if (!messages.length) {
      body.innerHTML = `${gaugeHtml}<div class="empty">无对话记录</div>`;
      startGaugeLive(id, seedRows, seedFailed); // 无消息但可能有 model 行（水位不因会话空丢live）
      return;
    }

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

    body.innerHTML = `${gaugeHtml}<div class="ctx-grid">
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

    startGaugeLive(id, seedRows, seedFailed);
  }

  // ── C2 上下文水位区渲染（种子 + 已到达的 live 行；纯渲染不计算——计算面在
  // public/context-gauge.js 纯函数）──
  function renderGaugeSection(seedRows, liveRows = [], opts = {}) {
    const wrap = inner => `<div id="ctx-gauge-card" style="margin-bottom:12px">${inner}</div>`;
    // 取数失败形态（F-败-2）：错误卡而非「该会话没有模型调用行」空态——
    // 「静默给 0=失败」的降级不诚实；live 行到达后（liveRows 非空）以 live
    // 数据为准恢复水位区（失败卡只在没有可用数据时占位）。
    if (opts.failed && !liveRows.length) {
      return wrap(window.ZC.emptyState('model_usage',
        '上下文水位取数失败——稍后重进本标签或刷新重试；服务端日志有详情（常见成因：旧版 ZCode 库缺列）。'));
    }
    // 会话内模型切换以最新种子行为准：SSE model 行不带窗口字段（载荷无
    // context_tokens——窗口值唯一通路是路由层 models-meta resolve），live 行
    // 补窗取最新种子行的 context_tokens（种子全空 → null → unknown 态不猜）。
    let win = null;
    for (let i = seedRows.length - 1; i >= 0; i--) {
      if (seedRows[i].context_tokens != null) { win = seedRows[i].context_tokens; break; }
    }
    const rows = seedRows.concat(liveRows.map(r => ({ ...r, context_tokens: win })));
    const CG = ZCg();
    const series = CG.computeGaugeSeries(rows);
    const drops = CG.compactDrops(series);
    const lvl = CG.currentLevel(series);
    const fbCount = series.filter(p => p.fallback).length;

    // 空序列（会话无 model 行且取数成功）→ 共享空态组件（C9-3 出口钉死）
    if (!rows.length) {
      return wrap(window.ZC.emptyState('model_usage',
        '该会话没有模型调用行——上下文水位无数据（新会话，或行早于 30 天保留窗）。'));
    }
    const sub = lvl.window
      ? `最新请求带入 ${fmtNum(lvl.molecule)} tok / 窗口 ${fmtNum(lvl.window)} tok`
        + (lvl.fallback ? ' · 末行为回退分子（input=0，以 cache 两列估算）' : '')
        + (lvl.unavailable ? ' · 末行分子不可得（SSE 行缺 cache 列），水位维持上一已知读数' : '')
      : `最新请求带入 ${fmtNum(lvl.molecule)} tok · 窗口未知（未收录模型，不猜）`
        + (lvl.unavailable ? ' · 末行分子不可得（SSE 行缺 cache 列），水位维持上一已知读数' : '');
    return wrap(`<div class="card">
      <h2 style="margin-bottom:4px">上下文水位
        <span class="caliber" title="窗口值来自静态整理表（server/models-meta.js，非官方权威）：只收录已核对官方源码常量的模型，未收录模型不猜窗口、不显百分比">非官方权威</span>
        <span class="sub">${sub}</span>
      </h2>
      <div class="muted" style="font-size:11.5px;margin:2px 0 8px">水位随已落库请求推进、生成中不跳动（口径：分子=input_tokens，官方语义已含 cache_read；input=0 行回退 cache 两列估算；缺 cache 列的 live 行分子不可得、不推进水位${fbCount ? `——本段含 ${fbCount} 行回退行，曲线 hover 已逐行标注` : ''}）</div>
      ${CG.gaugeBarHtml(lvl.ratio, { title: '上下文占用 = 分子/窗口 · 档位：<60% 正常 / ≥60% 偏高 / ≥85% 逼近上限（呈现层分档，数据不因分档改变）' })}
      <div class="sub" style="margin:12px 0 4px">逐轮增量曲线<span class="faint">（上=增长 下=回落 · 竖线=compaction 边界 · hover 看逐行分子）</span></div>
      ${CG.deltaCurveHtml(series, { maxCols: GAUGE_CURVE_MAX_COLS })}
      ${drops.length ? `<div class="sub" style="margin:12px 0 0">水位回落摘要<span class="faint">（compact 前后占用对比：边界行=压缩前全部上下文，后一行=压缩后首个请求）</span></div>` : ''}
      ${CG.dropSummaryHtml(drops)}
    </div>`);
  }

  // 水位区 live 订阅：既有 /api/live/events 的 model 行（载荷已含 input_tokens/
  // query_source/model_id/rid——水位增量零服务端改动，C2-5 SSE 复用不加新通道）。
  // 行在请求完成时落库，生成中不推送（UI 口径与文案一致）。
  function startGaugeLive(id, seedRows, seedFailed = false) {
    const liveRows = [];
    // 防重叠闸按行序（rowid，F-码-3/F-败-3）：以末种子行 rid 为闸（种子行带
    // rowid AS rid，SSE model 行载荷自带同名字段）——rid 更大的行才是真增量。
    // (种子查询, SSE 连接] 间落库的行低于 live.js 连接水位（MAX(rowid)@连接时
    // 刻）、不入流也不在种子——已知缺口登记 residuals，此处只防种子已含的行
    // 从流里再次到达（双计污染增量曲线）。
    const lastSeedRid = seedRows.length ? seedRows[seedRows.length - 1].rid : 0;
    try { gaugeEs = new EventSource('/api/live/events'); }
    catch (e) { console.warn('[sessions] 水位 live 订阅创建失败', e); return; }
    gaugeEs.addEventListener('model', e => {
      try {
        // 自愈关流：水位区容器不在 DOM（已切走标签/会话/视图）——任意 model 行
        // 到达即关（切会话的同步 close 之外的第二道防线）。
        const card = $('#ctx-gauge-card');
        if (!card) { closeGaugeLive(); return; }
        const m = JSON.parse(e.data);
        if (m.session_id !== id) return;
        if (!ZCg().shouldAcceptLiveRow(lastSeedRid, m)) return;
        liveRows.push(m);
        // 有界累积（F-码-8）：超软上限丢最旧 live 行（种子基准不丢，见常量注）。
        if (liveRows.length > GAUGE_LIVE_ROWS_CAP) {
          liveRows.splice(0, liveRows.length - GAUGE_LIVE_ROWS_CAP);
        }
        card.outerHTML = renderGaugeSection(seedRows, liveRows, { failed: seedFailed });
      } catch (err) { console.warn('[sessions] live model 帧解析失败', err); }
    });
    // tool 帧自愈（F-败-4）：model 帧守卫只在下一 model 帧到达时触发——纯工具
    // 活动时段连接滞留（服务端每 1.5s 轮询照跑）；tool 帧同款守卫把空闲窗口
    // 收窄到无任何活动的时段（单连接、重进即清，残余接受）。
    gaugeEs.addEventListener('tool', () => {
      if (!$('#ctx-gauge-card')) closeGaugeLive();
    });
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
      return `<div class="part step-finish">step-finish · ${escapeHtml(d.reason||'')} · in ${fmtNum(tk.input)} / out ${fmtNum(tk.output)} / think ${fmtNum(tk.reasoning)} · cache r${fmtNum(tk.cache?.read)} w${fmtNum(tk.cache?.write)}</div>`;
    }
    if (t === 'timeline') {
      return `<div class="part step-finish">⎯ ${escapeHtml(d.timelineType||'timeline')} ${escapeHtml(d.fromModel?.modelID||'')} → ${escapeHtml(d.toModel?.modelID||'')} ${escapeHtml(d.toModel?.variant||'')} ${statusBadge(d.status)}</div>`;
    }
    if (t === 'compaction') {
      return `<div class="part step-finish">⌘ compaction (${escapeHtml(d.trigger||'')}) · ${fmtNum(d.preCompactTokenCount)} → ${fmtNum(d.postCompactTokenCount)} tok ${statusBadge(d.timelineStatus)}</div>`;
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
  // 行徽标：task_type 优先（DB 真值，对 metadata 覆盖面变化稳定）——workflow_child
  // actor 恒标 workflow；其余有 profile（metadata.json 命中）标角色，无则 '?'
  //（title 带原 task_type 供排查）。
  function childBadge(c) {
    if (c.task_type === 'workflow_child') return '<span class="badge purple">workflow</span>';
    if (c.profile) return `<span class="badge ${c.profile==='Explore'?'teal':'purple'}">${escapeHtml(c.profile)}</span>`;
    return `<span class="badge dim" title="${escapeHtml(c.task_type || '')}">?</span>`;
  }

  async function renderAgents(id, body) {
    stopAgentsPoll();
    // 渲染统一路径（空态/表格同门）：轮询期间「未派生 → 派生了」也要能翻页，
    // 空态分支不得 early return 后不再刷新。
    const render = (children) => {
      if (!children.length) { body.innerHTML = '<div class="empty">该会话未派生子 agent</div>'; return; }
      // children 按 parent_id 查询，天然同时含 Task 子代理与工作流 actor——
      // 计数拆开展示，避免把工作流 actor 混记进 Task 子代理数。
      // 口径澄清（用户实锤「怎么可能 20 多个」）：总数是会话全生命周期的
      // **累计派生数**——每次 Agent 调用一个子会话，多轮并行评审/实施
      // 跑几十个是常态；并发上限约束的是同时在飞，不是累计。活跃/等待拆分
      // 走 C6 逐子代理信号（与列表徽标同源），回答「此刻多少在工作」。
      // 直系一级（子代理再派的不含，全谱见「子 Agent 关系树」页）。
      const wfs = children.filter(c => c.task_type === 'workflow_child').length;
      const working = children.filter(c => c.signal && c.signal.state === 'working').length;
      const waiting = children.filter(c => c.signal && c.signal.state === 'waiting').length;
      const broken = children.filter(c => c.signal && c.signal.state === 'broken').length;
      body.innerHTML = `<h2>子 Agent <span class="sub">累计派生 ${children.length} 个${wfs ? ` · 工作流 actor ${wfs}` : ''}${working ? ` · <span style="color:var(--accent)">活跃 ${working}</span>` : ''}${waiting ? ` · 等待 ${waiting}` : ''}${broken ? ` · 异常 ${broken}` : ''}</span></h2>
        <div class="card tight" style="overflow-x:auto"><table>
          <thead><tr><th>profile</th><th>状态</th><th>描述</th><th class="num">token</th><th>创建</th><th></th></tr></thead>
          <tbody>${children.map(c => `<tr data-id="${escapeHtml(c.id)}">
            <td>${childBadge(c)}</td>
            <td>${signalBadgesHtml(c.signal)}</td>
            <td>${escapeHtml((c.prompt||'').slice(0,80))}${c.prompt&&c.prompt.length>80?'…':''}</td>
            <td class="num">${fmtNum(c.total_tokens)}</td>
            <td><span class="mono faint">${relTime(c.time_created)}</span></td>
            <td><a href="#sessions/${encodeURIComponent(c.id)}/timeline">打开 →</a></td>
          </tr>`).join('')}</tbody></table></div>`;
    };
    const gen = ++agentsGen;
    const alive = () => currentTab === 'agents' && currentId === id && gen === agentsGen;
    const data = await getJSON(`/api/sessions/${id}/children`);
    if (!alive()) return; // 取数在途期间已切走/被更新代际超越：自弃（gaugeGen 同款语义）
    render(data.children);
    let lastJson = JSON.stringify(data.children);
    // 在途守卫（性能席发现：重会话 enrich 慢时，无守卫的轮询会每 5s 堆一个
    // 在途请求排队串行处理）——overview refreshInFlight 同款。
    let pollInFlight = false;
    agentsTimer = setInterval(async () => {
      if (!alive()) { stopAgentsPoll(); return; }
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const d = await getJSON(`/api/sessions/${id}/children`);
        if (!alive()) { stopAgentsPoll(); return; } // await 后复查：等待期间可能已切走
        const j = JSON.stringify(d.children);
        if (j === lastJson) return; // 数据相同跳过：不打断 hover/文本选择
        lastJson = j;
        render(d.children);
      } catch (e) { console.warn('[sessions] 子 agent 列表轮询失败（保留上次渲染）', e); }
      finally { pollInFlight = false; }
    }, AGENTS_POLL_MS);
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
