'use strict';
// views/how.js — "How ZCode works" — explains the data model + reasoning mechanism,
// using the user's own real data as examples.
(function () {
  const { registerView, $, fmtNum, fmtInt, escapeHtml, getJSON, loading, errorCard } = window.ZC;

  async function view() {
    $('#root').innerHTML = `<div class="view max">
      <h1>ZCode 运行原理</h1>
      <span class="muted" style="font-size:12px">用你自己的真实数据解释：一次 agent 运行里发生了什么、推理是怎么进行的、token 花在哪。</span>

      <h2>数据模型 <span class="sub">一次运行产生的层级关系</span></h2>
      <div class="er-diagram">${ER_DIAGRAM}</div>

      <h2>核心概念 <span class="sub">点开看你机器上的真实例子</span></h2>
      <div class="concept-grid" id="concepts">${loading('拉取真实数据…')}</div>

      <h2>推理（reasoning）是怎么发生的 <span class="sub">你重点关注的部分</span></h2>
      <div class="card">
        <p style="font-size:13px;margin:0 0 10px;color:var(--fg-1)">GLM-5.2 等"思考型"模型在给出最终回答前，会先输出一段<b style="color:var(--accent-2)">推理过程（chain-of-thought）</b>。ZCode 把它单独记录，与最终输出分开：</p>
        <ul style="color:var(--fg-2);font-size:12.5px;line-height:1.8;margin:0;padding-left:18px">
          <li><code>part</code> 表里 <code>type='reasoning'</code> 的行 = 推理原文（思考链）</li>
          <li><code>part</code> 表里 <code>type='text'</code> 的行 = 最终回答</li>
          <li><code>model_usage.reasoning_tokens</code> = 推理消耗的 token（计入成本，但用户看不到这段文字）</li>
          <li>在 <a href="#sessions">会话详情 → Context</a> 标签里，每条推理会以紫色侧边块呈现，点击可展开看全文</li>
          <li>在子 agent 的 <a href="#sessions">Timeline</a> 里，<code>reasoning_delta</code> 流式事件被折叠成 <code>◆ think</code> 行，显示推理字符量</li>
        </ul>
        <div class="example" id="reason-example">${loading()}</div>
      </div>

      <h2>一次 turn 的完整流程 <span class="sub">turn → model_request → tools → model_complete</span></h2>
      <div class="er-diagram">${TURN_FLOW}</div>
    </div>`;
    loadConcepts();
    loadReasonExample();
  }

  async function loadConcepts() {
    try {
      const [ov, agents] = await Promise.all([
        getJSON('/api/overview?window=24h'),
        getJSON('/api/agents/tree'),
      ]);
      const k = ov.kpis;
      const byModel = ov.by_model;
      const mainSrc = byModel.find(m => m.query_source === 'main_turn');
      const subSrc = byModel.find(m => m.query_source === 'subagent');
      const titleSrc = byModel.find(m => m.query_source === 'session_title');

      const concepts = [
        {
          h: 'Session（会话）',
          p: `一次独立的对话。分三类：<code>interactive</code>（你直接聊的主会话）、<code>subagent_child</code>（主 agent 派生的子 agent，做搜索/调研等只读活）、<code>selection_side_chat</code>（选中代码的侧边提问）。你的库里有 <b>${fmtInt(agents.total)}</b> 个会话，其中 ${fmtInt(agents.roots.length)} 个主会话派生了大量子 agent。`,
          ex: `例：最近的主会话 "查看和观测 zcode agent" 派生了 4 个 Explore 子 agent（在「子 Agent」页可见调用树）`,
        },
        {
          h: 'Turn（回合）',
          p: `你发一条消息 → agent 完整回复一次，中间可能调多次模型、跑多个工具，这整个过程是一个 turn。一个 turn = 多个 model_request + 多个 tool_call。24h 内有 <b>${fmtInt(k.active_sessions)}</b> 个活跃会话在产生 turn。`,
          ex: `看「会话 → Turns」标签：每行是一个 turn，横条长度=耗时，能看到模型请求次数、工具调用数、token 消耗`,
        },
        {
          h: 'query_source（请求来源）',
          p: `区分这次模型调用是为什么：${renderQuerySources(byModel)}。<b>main_turn</b> 是真正回答你的；<b>subagent</b> 是子 agent 干活；<b>compact</b> 是上下文压缩；<b>session_title</b> 只是给会话起个标题（很便宜）。`,
          ex: `24h 内：main_turn ${fmtInt(mainSrc?.calls||0)} 次、subagent ${fmtInt(subSrc?.calls||0)} 次、标题生成 ${fmtInt(titleSrc?.calls||0)} 次`,
        },
        {
          h: 'mode（运行模式）',
          p: `<b>yolo</b> = 自由执行（默认）、<b>plan</b> = 先出方案再实施、<b>build</b> = 实施模式。影响 agent 的自主程度和是否需要确认。`,
          ex: `mode 存在 message.data.mode 字段，在 Context 标签的每条 assistant 消息头部可见`,
        },
        {
          h: 'context compaction（上下文压缩）',
          p: `对话太长时（接近模型上下文窗口），ZCode 自动把历史压缩成摘要，腾出空间继续。这是为什么你能跟 agent 聊很久而不爆 token。`,
          ex: `看「会话 → Timeline/Context」里的 ⌘ compaction 行：会显示 pre/post token 数，比如 95393 → 6035`,
        },
        {
          h: 'prompt cache（提示缓存）',
          p: `系统提示、工具定义、历史消息会被缓存，下次请求命中缓存就不重新计费。你的缓存命中率：<b style="color:var(--sev-ok)">${pct(k.tokens.cache_read, k.tokens.input)}%</b>（输入 token 里被缓存命中的比例）。这是省成本的关键。`,
          ex: `24h 内：输入 ${fmtNum(k.tokens.input)} token，其中 ${fmtNum(k.tokens.cache_read)} 来自缓存读取`,
        },
        {
          h: 'tool 调用（工具）',
          p: `agent 通过工具与外界交互：<code>Bash</code> 跑命令、<code>Read/Edit/Write</code> 改文件、<code>Grep/Glob</code> 搜索、<code>Agent</code> 派生子 agent。每个工具有 <b>readOnly/destructive/sideEffectScope</b> 安全标记。`,
          ex: `24h 内工具调用 ${fmtInt(k.tools.calls)} 次，失败 ${fmtInt(k.tools.errors)} 次。在 Timeline 里 tool.call/tool.result 行可见`,
        },
        {
          h: 'MCP 工具',
          p: `名字以 <code>mcp__</code> 开头的是外部 MCP 服务器提供的工具（如 gitnexus、agentmemory、chrome-devtools）。你装了 3 个 MCP 服务器，扩展了 agent 的能力。`,
          ex: `在「实时监控」按工具表里能看到 mcp__gitnexus__query 等的调用频次`,
        },
      ];
      $('#concepts').innerHTML = concepts.map(c => `
        <div class="concept"><h3>${c.h}</h3><p>${c.p}</p><div class="example">${c.ex}</div></div>
      `).join('');
    } catch (e) { $('#concepts').innerHTML = errorCard(e); }
  }

  function renderQuerySources(byModel) {
    const map = {};
    byModel.forEach(m => { map[m.query_source] = (map[m.query_source]||0) + m.calls; });
    return Object.entries(map).sort((a,b)=>b[1]-a[1])
      .map(([k,v]) => `<code>${escapeHtml(k)}</code>(${fmtInt(v)})`).join('、');
  }

  async function loadReasonExample() {
    try {
      // find a subagent session that has reasoning parts, show one
      const sess = await getJSON('/api/sessions?limit=200&task_type=subagent_child');
      let found = null;
      for (const s of sess.sessions) {
        const r = await getJSON(`/api/sessions/${s.id}/reasoning?limit=1`);
        if (r.reasoning && r.reasoning.length && r.reasoning[0].text) { found = r.reasoning[0]; break; }
      }
      const el = $('#reason-example');
      if (!found) { el.innerHTML = '<span class="faint">暂无 reasoning 记录（当前会话未启用思考，或已被清理）</span>'; return; }
      el.innerHTML = `<div class="faint" style="margin-bottom:4px">来自你机器的真实推理片段（节选）：</div>${escapeHtml(found.text.slice(0, 400))}${found.text.length>400?'…':''}`;
    } catch (e) { $('#reason-example').innerHTML = '<span class="faint">加载失败</span>'; }
  }

  const ER_DIAGRAM =
`session (一次会话)
  │  id · title · task_type · parent_id · directory · trace_id
  │
  ├──▶ message (一条消息: user 或 assistant)
  │      │  data.role · data.modelID · data.mode · data.anchor.turnId
  │      │
  │      └──▶ part (消息的一部分: text / reasoning / tool / step-finish ...)
  │             data.type 决定含义
  │
  ├──▶ turn_usage (一个回合的汇总)  ← 主键 (session_id, turn_id)
  │      │
  │      ├──▶ model_usage (单次模型调用)  ← turn_id 关联
  │      │      input/output/reasoning_tokens · query_source · status
  │      │
  │      └──▶ tool_usage (单次工具调用)  ← turn_id 关联
  │             tool_name · tool_call_id · status · read_only · destructive
  │
  ├──▶ session_entry (运行时事件: checkpoint / model_selection ...)
  ├──▶ todo (TodoWrite 写入的任务)
  └──▶ session_input (用户输入队列)

关联键:
  turn_id     串起 turn_usage ↔ model_usage ↔ tool_usage ↔ message.anchor
  trace_id    贯穿 session ↔ *_usage ↔ 日志 JSONL ↔ transcript.jsonl
  tool_call_id 连接 tool_usage ↔ part(type=tool).callID ↔ exec/<callId>-stdout.log`;

  const TURN_FLOW =
`用户发消息
   │
   ▼
turn_started (transcript) / message(role=user) 写入 SQLite
   │
   ▼
model_request #1 ──▶ 发给 GLM-5.2（带完整历史 + 工具定义）
   │                   │
   │                   ├── model_network_status: started (sse, attempt 1)
   │                   ├── model_streaming: reasoning_delta × N  ← 推理在这里流式产生
   │                   ├── model_streaming: text_delta × N       ← 最终回答在这里流式产生
   │                   └── model_network_status: completed
   │
   ▼
model_complete: stopReason='tool-calls' (模型决定要调工具)
   │
   ▼
tool.call: Bash / Read / Agent(...) ──▶ 执行 ──▶ tool.result (写入 part)
   │   （如果是 Agent 工具，会派生子 agent → 新的 session + transcript）
   │
   ▼
model_request #2 ──▶ 带上工具结果再问模型 …… (循环直到 stopReason='stop')
   │
   ▼
turn_complete (transcript) / message(role=assistant) 写入 SQLite
   │   turn_usage 汇总本轮所有 token / 工具 / 耗时`;

  registerView('how', view);
})();
