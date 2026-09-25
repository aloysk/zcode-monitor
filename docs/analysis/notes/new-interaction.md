# 新形态监测交互侦察笔记（第二轮生态采纳 · 方向：监测与交互的新形态）

- 侦察员：新形态监测交互侦察员（动态工作流子代理）
- 日期：2026-09-25（SGT）
- 目标：找第一轮生态采纳计划（docs/ecosystem-adoption-plan.md）之外的新候选功能/工具/形态。
  重点=交互范式与数据呈现方式。第一轮已覆盖：宠物包一键导入、token 口径对账、
  JSONL 实时性强化、桌宠行为与安全升级、隐私提示；这些不算新发现。
- 方法：WebSearch + GitHub MCP（search_repositories / get_file_contents，star 数与更新时间
  均来自 GitHub API 返回）+ zread/WebFetch 读 README。凡未读 README 的条目均注明
  「仅 API 描述」。star 数为 2026-09-25 查询时点值。

---

## 一、重点深挖（README 已逐字读过）

### 1. hoangsonww/Claude-Code-Agent-Monitor（下称 CCAM）
- https://github.com/hoangsonww/Claude-Code-Agent-Monitor
- 1014★ / MIT / JS(TS)+React+Express+better-sqlite3 / 更新 2026-09-24（API）
- 与 zcode-monitor 同赛道且同技术栈基因（Express+better-sqlite3+WAL+SSE/WS），1014★ 是该赛道最高。
- 已验证亮点（README）：
  - **Kanban 状态板**：agents 四列 Working/Waiting/Completed/Error，sessions 五列
    Active/Waiting/Completed/Error/Abandoned。「Waiting 列」专门承载「卡在等用户输入/权限
    提示」的会话——把「最需要人介入」的状态做成一等公民列。列头 tooltip 解释生命周期迁移。
  - **告警规则引擎**：四类条件——事件模式（窗口内 N 次匹配，如「2 分钟 >5 错误」）、
    不活跃（活跃会话 N 分钟无事件）、卡死代理（working/waiting 无活动 N 分钟）、token 阈值。
    事件类在 ingest 事务后评估（不拖慢 hook 落库），时间类 60s 扫描；告警落库
    `alert_events`，per-rule+per-session 冷却去重（默认 300s），acknowledge/all 视图。
  - **Webhook 体系**：14 个一等 provider（Slack/Discord/Teams/Google Chat/Mattermost/
    Rocket.Chat/Telegram/PagerDuty/Opsgenie/Splunk On-Call/Zapier/Make/n8n/Pipedream）
    + 通用 JSON 端点（可选 HMAC-SHA256 签名、自定义头）；per-rule 作用域、Send test 探针、
    投递日志；投递与告警路径分离（超时+有界重试退避，永不阻塞监控）；URL/凭据服务端存储
    且 API 一律脱敏返回。
  - **Web Push（VAPID）**：浏览器关掉也能收到；macOS 音频支持；按事件类型开关。
  - **本地 MCP 服务器**（mcp/ 目录）：3 种 transport（stdio / HTTP+SSE / 交互 REPL）、
    25 个类型化工具、localhost-only 强制、变更/破坏性分级安全闸——**让 agent 查询仪表盘**。
  - **Statusline**：CLI 状态栏显示 model/context 占用/git 分支/分向 token/会话成本。
  - **Workflows 页**：agent 编排 DAG、工具执行 Sankey、协作网络、错误传播图、并发时间轴、
    compaction 影响直方图等 11 个区块；每图「What/How to read/Why」气泡 + 确定性解读。
  - **Workflow Runs 册**：从磁盘 run journal（workflows/wf_<runId>.json）重建 dynamic
    workflows（Workflow 工具拉起的无 hook 子代理舰队）：状态/agent 数/token/工具调用，
    展开为 per-agent（phase/state/tokens/tools/duration）表。journal 未写前用 running 探测。
    ——与 zcode-monitor 的 dwf 运行册同型，其「humanized result previews」「彩色 phase 过滤」
    可对照。
  - 子代理工具归因：SubagentStop 时解析 subagents/agent-*.jsonl，按 tool_use_id 配对
    tool_use/tool_result，幂等去重；reconcileSubagentParents 从 Task 工具结果里的
    toolUseResult.agentId 恢复真实父节点（子代理再拉子代理不塌缩到 main 一层）。
  - 其他：Tabby 浮窗猫桌宠、Run Claude（面板内拉起 claude 子进程+流式 UI，写操作）、
    Claude Config Explorer 12 页（skills/agents/MCP/hooks/memory 等，低风险面可改+强制
    时间戳备份）、i18n en/zh/vi、更新提示器（只提示不自动 pull）。
- 吸收面（只读约束内）：Kanban Waiting 列思想 → 会话列表「等待用户输入」分组/置顶；
  告警四条件类型+冷却去重；webhook 通道注册表（payload formatter+凭据解析分离）设计；
  Sankey/DAG 工作流可视化；MCP 查询面（zcode-monitor 可暴露只读查询端点）。
- 不吸收：Run Claude（写操作，违反零写入/只读承诺）；hook 改写 ~/.claude。

### 2. minchenlee/c9watch
- https://github.com/minchenlee/c9watch
- 127★ / MIT / Rust+Tauri+Svelte / macOS / 更新 2026-09-22（API）
- 已验证亮点（README）：
  - **进程级自动发现**：sysinfo 扫描运行中的 claude 进程，再按路径编码+时间戳关联
    ~/.claude/projects/ 会话文件——零插件、任意终端/IDE 启动的会话都能发现。
  - **Needs Attention 置顶**：Working / Needs Attention（权限请求或向用户提问）/ Idle
    三态，按优先级排序，「权限请求浮到最上面，别让 agent 卡在等待」。
  - **托盘 popover**：菜单栏点开即得全部活跃会话快览，不开大窗。
  - **手机/Web 客户端**：WebSocket + 扫 QR 码远程监控。
  - **History 深搜**：全历史元数据过滤+全文内容搜索，命中点滚动定位高亮。
  - **Token distance visualizer**：token 总量画成「米堆超越 22 个真实地标」的趣味图，
    支持动画堆叠、原生分享、Instagram-ready PNG 导出。——趣味呈现直接可借鉴的形态。
  - **CLI for agents**：同一二进制兼作 JSON CLI（list/status/view/history/search/cost/
    tasks/stop/watch NDJSON 流），**`c9watch self` 识别调用者自己的会话**；随附 Claude
    skill 教 agent 用 CLI 监控兄弟会话/检索过往工作——「built for both humans and agents」。
  - 子代理可见性（Task 工具子代理+点击预览 transcript）；会话重命名；成本按日/项目/模型。
- 吸收面：Needs-Attention 置顶排序；token 地标趣味可视化（zcode 有逐行 model_usage，
  完全可算）；「agent 查询自己的运行状态」端点（self 语义）；NDJSON watch 流。

### 3. eunomia-bpf/agentsight
- https://github.com/eunomia-bpf/agentsight （官网 https://agentsight.us ，v1.0.31）
- 706★ / MIT / C / 更新 2026-09-24（API；功能面经官网 WebFetch 核实）
- 已验证亮点：
  - **Agent Flamegraph（token 火焰图）**：读本地 Claude Code/Codex/Gemini 会话历史，
    把 token 与时间按 项目/agent/prompt 类别/模型/token 类型 聚合成火焰图——「token 和
    时间都去哪了」。`agentsight report token` + `agentsight vis`。
  - **Agent Nebula（仓库回放）**：可视化 Git worktree 里的文件读/写/改名/删除序列。
  - eBPF 系统级追踪（进程/文件/TLS，无代理）；本地 SQLite 存会话；overview/timeline/
    process tree/资源指标；OpenTelemetry GenAI span 导出；skill 进化（诊断重复失败→
    生成版本化 skill 变更→held-out 评估→升降级）；有 arXiv 论文。
- 吸收面：**token 火焰图**是「每工具/每模型 token 归因」的成熟呈现范式，zcode-monitor
  的 SQLite 有逐行 usage+工具事件，纯前端（无构建）可用 SVG/div 火焰图实现按
  session→turn→tool→model 的 token/耗时聚合；文件操作回放时间轴（exec 输出+Edit/Write
  事件已有）可作会话深挖的补充视图。eBPF/系统级追踪不适用（Windows+只读）。

### 4. FulAppiOS/Agent-Quest
- https://github.com/FulAppiOS/Agent-Quest
- 139★ / MIT / TS(Bun)+Vite / 更新 2026-09-17（API）
- 已验证亮点（README）：
  - **奇幻村庄隐喻**：每个 agent 会话=一名英雄，按当前工具在村庄里走动——Read→图书馆、
    Edit→铁匠铺、Bash→竞技场。「英雄在哪栋建筑=它在干什么」——工具语义→空间隐喻映射，
    一眼可读的多会话总览。
  - 自动发现全部 ~/.claude* 目录（多套安装）与 ~/.codex；活动 feed、party bar、详情面板。
  - 内置瓦片地图编辑器（自定义村庄布局）；昼夜/天气效果；自带 CC0 像素素材包
    （Tiny Swords）——零额外下载。
  - 原生 WebSocket <2s 延迟；可选 postToolUse hook 更低延迟（仅 Claude Code）。
  - LAN 模式（AGENT_QUEST_LAN=1）手机/iPad 查看，启动打印可达 URL。
- 吸收面：pet.html 桌宠的下一层形态——多 agent 空间化总览（位置=状态）；CC0 素材包
  模式与第一轮宠物包导入衔接；地图/场景可换皮。

### 5. onikan27/claude-code-monitor
- https://github.com/onikan27/claude-code-monitor （npm: claude-code-monitor）
- 310★ / MIT / TS / macOS-only（AppleScript）/ 更新 2026-09-18（API）
- 已验证亮点（README）：
  - **终端 TUI + 手机 Web 双形态**：TUI vim 式导航（j/k/1-9 快选聚焦）；按 `h` 出 QR 码，
    同 Wi-Fi 扫码即得手机端（默认 3456 端口，占用自动换）。
  - **Tailscale 远程**：`-t` 用 Tailnet IP 生成 QR URL，任意网络安全访问。
  - 手机端能力：实时状态 WebSocket、查看最新消息、**远程聚焦终端**（iTerm2/Terminal.app/
    Ghostty 按 TTY/标题定位）、向终端发文本、**权限提示远程应答**（方向键 d-pad+Enter）、
    屏幕截取 1x-5x 捏合缩放、危险命令警示。
  - 三态图标：● Running / ◐ Waiting（等用户输入）/ ✓ Done。
  - 安全：token 认证、仅本地网络、服务端拦截危险 shell 命令、明确警告公共 Wi-Fi。
- 吸收面：**QR 码手机访问**是最低摩擦的「移动端只读视图」形态（zcode-monitor 目前
  只绑 127.0.0.1，可做 opt-in 的 LAN 只读页+token；Tailscale 思路同样适用）；
  三态图标学；「等待输入」状态显式化。远程应答/发消息是写操作，不做。

### 6. henrikekblad/codelight
- https://github.com/henrikekblad/codelight
- 63★ / Python（companion 守护进程）/ 更新 2026-09-23（API；许可证未在所读 README 段落出现，unverified）
- 已验证亮点（README）：
  - **多端常驻全家桶**：ESP8266 GeekMagic 桌面小屏（mDNS 发现）、Android 自适应 widget、
    GNOME Shell 面板扩展、KDE Plasma 6 面板/桌面 widget、VS Code 状态栏扩展——同一
    daemon 经 WebSocket + D-Bus 两个总线喂所有客户端。
  - **远程审批/答题**：`--remote-control` 接管交互提示，推送全部客户端，**谁先答谁赢**；
    无人接客户端时回落到 agent 内建提示（不卡死）。可远程 Allow/Deny 权限、答选择题/
    自由文本题、（OpenCode）远程下发新指令。
  - 六种 agent 支持（Claude Code/Codex/Copilot/Cursor/Grok/OpenCode），每格「状态/用量/
    权限/问答/对话」支持度矩阵如实标注（含大量脚注解释各 agent 的 hook 能力差异）。
  - 三态图示：working / waiting for user input / ready for a new task。
  - 持久化目录/精确命令审批存 agent 中立策略层。
- 吸收面：三态图标学+「waiting」突出；「多端常驻客户端共享一条状态总线」的形态
  （zcode-monitor 的桌宠+主面板即是同思路的两客户端）；远程应答竞速+fall-through 是
  写操作不做，但「等待用户输入超 N 分钟」告警可做。

### 7. atomchung/ccstory
- https://github.com/atomchung/ccstory
- 43★ / Python 3.11+（pipx）/ MIT（README 徽章）/ 更新 2026-09-24（API）
- 已验证亮点（README）：
  - **叙事周报**：「ccusage 告诉你花了多少，ccstory 告诉你花在哪」。读本地会话日志，
    产出分类回顾：Top focus、每桶 2-4 条要点、每会话一行摘要（可 `--llm-narrative` 用
    本地 CLI 润色，带 90s 预算+缓存+证据指纹）。
  - **active hours 口径**：5 分钟间隔启发式（连续消息间隔 ≤5min 算活跃，否则视为离开）；
    **并行会话墙钟去重**——实测一周原始 per-agent 时间 177h 去重后 64h；「N× parallel」
    =原始时间÷墙钟。
  - 分类桶（coding/writing/research/investment/…）两层：Area+Project；folder 规则/内容
    分类/混合三模式，分类覆盖率如实披露（rules/content/fallback 各多少）。
  - trend：8 周 sparkline+环比；burn % = API 等价成本占月配额比例；repo activity 表
    （本地 git commits+可选 gh 富化 PR/releases/stars）；对比块（vs 上期）。
  - 输出：终端卡/Markdown/JSON（schema_version=1 包络）/Obsidian（YAML frontmatter+
    wikilinks）；MCP server（get_recap/get_trend）。
- 吸收面：**active hours（5min-gap+墙钟去重）**是 zcode-monitor 现有「时长」统计可直接
  升级的口径；周/月回顾页（Top focus+分类桶+sparkline+环比）纯 SQLite 可算；
  「覆盖率披露」的诚实风格与本仓 residuals 文化契合。

### 8. Dicklesworthstone/vibe_cockpit
- https://github.com/Dicklesworthstone/vibe_cockpit
- 26★ / Rust / MIT+OpenAI/Anthropic rider / 更新 2026-09-22（API）
- 已验证亮点（README）：
  - **舰队控制台**：16 个采集器（轮询既有工具的 JSON/SQLite/JSONL）→ DuckDB → 健康评分
    → TUI / 只读 web API / MCP server / robot JSON CLI 四个视图；SSH 收编远程机器。
  - **Agent-first**：每个读面都有机器可读形态（`vc --format json`、`vc robot triage` 带
    schema_version 包络；MCP server 9 工具让 agent 不 shell 出来就能问舰队状态）。
  - **「不知道就说不知道」**：无数据支撑的 TUI 屏显示 `NO DATA SOURCE YET` 并点名缺的表，
    不编数字。
  - 健康评分：加权因子（cpu/mem/load/disk/rate_limit/process_health/**data_freshness**），
    data_freshness 恒输出——从未采集的机器接近 0 分而非「没有抱怨=满分」。
  - 告警：Threshold/Pattern/Absence/RateOfChange 四型（README 如实标注只有 Threshold
    已实现）。`vc query ask "which machines are low on disk?"` NL→SQL。
- 吸收面：data_freshness 恒显（数据新鲜度是只读监视器的诚实底线：wal 时滞/JSONL 落后
  多少要常显）；「agent 查询面」（robot JSON+MCP）与 c9watch CLI 印证同趋势；
  NO DATA SOURCE YET 的空态设计。多机 SSH 舰队超出单机范围，暂不吸收。

### 9. fahd09/watchtower
- https://github.com/fahd09/watchtower
- 65★ / MIT / Node≥22 单脚本零依赖 / 更新 2026-09-04（API）
- 已验证亮点（README）：
  - **「给 agent 用的 DevTools Network 面板」**：本地代理（ANTHROPIC_BASE_URL 指过去）
    捕获 Claude Code/Codex 全部 API 流量，实时 web 面板。
  - 请求分类：messages_stream/messages/token_count/quota_check；**agent 角色 main/subagent/
    utility**；「对话分组」把每轮的工具性调用和子代理折叠进主请求。
  - **Turn Diff / Sys Diff**：与上一请求逐行 diff 系统提示与消息——看见上下文每轮长了什么。
  - Replay（改完重发）与断点（in-flight 暂停改/丢，Burp Suite 式）。
  - Overview：TTFT/吞吐 tok/s/上下文窗仪表/限流进度条；成本累计+分请求（cache read ~0.1×、
    write ~1.25× 分开计价，未知模型显示 `—` 不瞎猜）。
  - dashboard.html 单文件+零 npm 依赖——与本仓「原生无构建」哲学同源。
- 吸收面：架构不合（zcode-monitor 是被动读库，不代理流量），但 UI 范式可借鉴：
  「轮次分组折叠（utility 调用归并进主轮）」用于会话深挖；TTFT/吞吐仪表本仓已有同类；
  「未知就显示 —」的成本诚实原则。turn diff 需要消息全文，本库未见该数据面，暂缓。

### 10. 777genius/agent-notifications
- https://github.com/777genius/agent-notifications
- 814★ / GPL-3.0-or-later / Go / 更新 2026-09-24（API）
- 已验证亮点（README）：
  - **通知分类学**（7 状态）：Task Complete / Review Complete / Question / Plan Ready /
    Session Limit Reached / API Error / Permission Request——每种带图标+独立开关+独立声音+
    独立 desktop/webhook 通道覆写。检测用状态机（如 Review=只读工具+长文本回复）。
  - **click-to-focus**：点通知回到来源终端的精确 tab/pane（Ghostty/iTerm2/Warp/tmux/
    kitty/WezTerm/VS Code/Cursor；Windows 为窗口级 Toast 协议激活）。
  - **防噪组合拳**：notifyOnlyWhenUnfocused（正盯着该终端就不弹）、notifyDelaySeconds
    （延迟后重查焦点，「等我走开了再叫我」）、完成任务后 N 秒抑制追问、按状态/分支/目录
    过滤、尊重系统 DND、未知焦点状态=宁弹勿静。
  - webhook：Slack/Discord/Telegram/Lark+custom（Teams/ntfy/PagerDuty/Zapier/n8n/Make），
    带重试/限流/熔断。跨平台 macOS/Linux/Windows。
- 吸收面：**状态分类学+防噪策略**是桌宠气泡/面板提醒的直接升级素材（本仓现只有
  错误链路）；GPL-3.0：只借鉴分类与策略思想，不抄代码。

### 11. langfuse/langfuse
- https://github.com/langfuse/langfuse
- 35011★ / MIT（ee/ 目录除外）/ TS / 自托管 Docker/K8s（API+README 页 WebFetch 核实）
- 定位：开源 LLM agent 观测与评估平台。traces 捕获 LLM 调用与应用逻辑（retrieval/
  embedding/agent actions）为嵌套 span；Sessions 视图检视用户会话；评估/数据集/prompt
  管理/playground。trace 树瀑布（每 span 耗时+token）的精确 UI 细节在其文档站，README
  未逐项列出（已注明）。
- 吸收面：**trace 树范式**——把 zcode-monitor 会话深挖组织成 span 树（session→turn→
  工具调用→子代理，每 span 时长/token/首等），LangSmith/Langfuse/Phoenix 一系通用形态，
  本库 SQLite 已有全部原料。

### 12. cj-vana/claude-swarm（仅 API 描述，未读 README）
- https://github.com/cj-vana/claude-swarm
- 116★ / TS / 更新 2026-09-23（API）
- API 描述：MCP server for orchestrating parallel Claude Code worker swarms with
  protocol-based behavioral governance, persistent state, and real-time monitoring
  dashboard。
- 意义：「MCP 形态的监测/编排服务器」线索的直接例证——agent 侧经 MCP 上报/查询，
  人侧同端口看实时面板。与本轮线索「MCP 形态监测服务器（让 agent 自报状态）」吻合。

---

## 二、广域扫描（API 元数据核实，README 未读，仅列要点）

| 项目 | ★ | 语言 | 一句话（源自 API 描述/搜索摘要） |
|---|---|---|---|
| ccusage/ccusage | 18730 | Rust | npx ccusage；第一轮已覆盖其口径对账，不重复 |
| Piebald-AI/splitrail | 222 | Rust | 跨平台实时 token/成本监视，覆盖 Claude/Codex/Cline/Copilot/OpenCode 等十余 CLI |
| cobra91/better-ccusage | 87 | TS | 从本地 JSONL 分析 Claude/Droid/OpenCode/Zcode/codex 等多 provider 用量成本（注意其把 Zcode 列为支持对象） |
| Nihondo/AgentLimits | 62 | Swift | macOS 桌面小组件（ widgets）显示限额/token/成本/热力图 |
| kenn-io/vibepulse | 53 | Swift | macOS 菜单栏 app，基于 ccusage 监控 Claude/Codex 消耗 |
| goniszewski/cctray | 42 | Swift | macOS 菜单栏监控 Claude Code 用量（2026-05 后未更新） |
| tobyilee/ccmonitor | 54 | TS | （无描述）|
| mukul975/claude-team-dashboard | 70 | JS | Claude Code agent 团队实时监控面板 |
| coding-by-feng/ai-agent-session-center | 82 | TS | 3D 机器人动画+实时终端+工具活动+prompt 队列+会话恢复（Electron+threejs） |
| AndrewKochulab/jarvis-dashboard | 101 | JS | Obsidian DataviewJS 仪表盘：实时会话+舰队+30 天分析+专注计时器 |
| Ericonaldo/AgentMonitor | 33 | TS | 浏览器里运行/监控/管理多 agent：可克隆任务模板、实时流、git worktree 隔离、relay 远程访问 |
| DeibyGS/claudestat | 34 | TS | Claude Code 实时执行 trace+成本智能（sqlite+hooks+dashboard） |
| bjornjee/agent-dashboard | 23 | Go | tmux 内实时仪表盘：监控/管理/编排多 agent |
| artischocki/agent-usage-tmux | 14 | Python | Claude/Codux 用量进 tmux statusline |
| henryavila/claudebar | 0 | JS | 两行分区 statusline（油量表式额度条+agent-active 模式+tmux 集成） |
| MartinWickman/ccmonitor | 2 | Go | 全部运行中 Claude Code 会话的 CLI 仪表盘 |
| adamclark64/ccmon | 2 | Rust | TUI：列出/观看/附着 agent 与子代理 |
| LucioLiu/knock-knock | 2 | — | ntfy 推送到手机：安装+CJK 编码坑+「何时该叫」纪律（Claude Code skill 形态） |
| kgkgzrtk/birdwatch | 2 | Shell | 声化：每个会话唱成一只不同的真实鸟鸣，空间音频（macOS hooks-only） |
| archimedes-market/mcp-postgres-analytics | 0 | Python | 只读 Postgres 分析 MCP server（与本方向无关，搜索噪音） |

网页线索（未核实仓库）：CodexBar（macOS 14+ 菜单栏多 provider 限额+重置窗口，2026-08）；
Usage4Claude（Product Hunt，闭源?）；Agent Reachout（HN：Telegram 通知 agent 完成/阻塞/
需要输入）；felipeelias 博客「Tailscale+自托管 ntfy」手机推送配置文；ccburn（TUI 用量
burn-up 图）；vscode-claude-status（VS Code 实时用量扩展，open-vsx）。

---

## 三、负发现（生态空白，与正发现同等重要）

1. **浏览器扩展形态基本空白**：多路搜索（WebSearch "claude code sessions viewer browser
   extension chrome github"）只命中的是 Anthropic 官方 Claude in Chrome（浏览器自动化，
   不是监测）与官方文档。没有发现任何「把本地监测仪表盘做成浏览器扩展」的第三方项目。
   ——形态未被社区占据；但技术上 zcode-monitor 的 Web 面板已是超集，扩展形态优先级低。
2. **「独立监测 MCP server」稀少**：GitHub 搜 "MCP server observability agent status
   report" 仅 1 条无关结果（mcp-postgres-analytics，0★）。MCP 查询面以「内嵌在仪表盘
   项目里」的形态出现（CCAM 的 mcp/ 目录、vibe_cockpit 的 vc mcp serve、c9watch 的
   CLI+skill），尚无成熟的独立「agent 自报状态」MCP 监测服务器。——半空白：范式已现，
   独立项目未成。
3. **Windows 常驻形态稀缺**：菜单栏/桌面小组件类几乎清一色 macOS（cctray、vibepulse、
   AgentLimits、c9watch、CodexBar 均 macOS；codelight 的多端方案也只覆盖 Linux 面板）。
   Windows 侧只有 Web 面板+浏览器标签。zcode-monitor 的桌宠在 Windows 上本身就是稀缺
   形态，值得继续加码而非照搬 macOS 菜单栏。
4. **tmux statusline 形态小而少**：仅 agent-usage-tmux（14★）与 claudebar（0★）两个
   小工具；且 tmux 在 Windows 宿主不适用（WSL 另论）。对本仓价值有限。
5. **独立「会话回放器」不存在**：回放/时间轴能力都内嵌在面板里（CCAM Timeline 页、
   agentsight timeline+Agent Nebula、watchtower Turn Diff、c9watch conversation viewer），
   没有独立的会话回放项目。「回放」作为面板内的一个视图形态成立。

---

## 四、与 zcode-monitor 的吸收优先级建议（供汇总席参考）

- 高契合、原料齐备（SQLite 已有所需数据）：token 火焰图（agentsight 范式）、
  Kanban/Needs-Attention 置顶（CCAM/c9watch）、trace 树会话深挖（langfuse 范式）、
  active hours 5min-gap+墙钟去重（ccstory）、周/月叙事回顾页（ccstory）、
  token 地标趣味可视化（c9watch）、告警规则四条件+冷却（CCAM）、
  agent 查询端点/robot JSON（vibe_cockpit/c9watch 印证）。
- 中契合（形态可做、需权衡）：QR+LAN 只读手机页（onikan27，须 opt-in+token+隐私横幅）、
  webhook 通知通道（CCAM 14 provider 注册表设计；GPL 的 agent-notifications 只借鉴分类学）、
  轮次分组折叠（watchtower）、空间隐喻多 agent 总览（Agent-Quest，衔接宠物包）。
- 不吸收：代理截流（watchtower 架构）、远程应答/下发指令（codelight/onikan27，写操作）、
  面板内拉起 agent（CCAM Run Claude，写操作）、eBPF（agentsight，平台不符）、
  SSH 舰队（vibe_cockpit，超单机范围）、macOS 菜单栏全家（平台不符）。
