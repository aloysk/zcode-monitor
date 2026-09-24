# Claude-Code 生态侦察 · 原始笔记（第二轮：第一轮之外的新候选）

- 侦察员：Claude-Code生态侦察员（dwf actor_2_1）
- 日期：2026-09-25（SGT）
- 方法：WebSearch/WebFetch + GitHub REST API（`gh api`）逐仓核实 stars/许可证/pushed_at；
  awesome-claude-code 主清单 Observability & Monitoring 全章节提取（README.md line 569 起）。
- 边界：第一轮（docs/ecosystem-adoption-plan.md，已合并）已覆盖 ccusage 对账/GLM 定价表、
  codex-pets 导入、Claude-Code-Agent-Monitor 字节偏移解析、clawd 12 态交互、OpenPets 消毒、
  tokibean 情绪映射、隐私提示——本轮只登记**第一轮之外**的新点，重复项标注「一轮已覆盖」。
- 所有 stars/许可证/推送时间均为 2026-09-25 gh api 实测值。

---

## A. 高契合新候选（第一轮未覆盖）

### A1. duqaXxX/seedeep — turn 粒度 live 观测（46★ MIT，TypeScript/Bun，pushed 2026-09-23）
URL: https://github.com/duqaXxX/seedeep
- 数据面与本体同构：tail Claude Code JSONL 会话日志实时重建 turn；SSE 单向推流到浏览器 GUI。
  「No proxy, no daemon, no session content leaves the machine」，远程访问须 TLS+token。
- **Context window 填充 live 视图**：逐 content-block 重建，窗口条**模型感知**——会话中途
  `/model` 切换会移动窗口；Haiku 子代理即使跑在 1M 上下文 Opus 会话内也按 200k 计。
  官网例：一个 turn 窗口从 3% 涨到 26%，6 个子代理 3 种模型，2.9M tokens billed，
  其中 2.5M 是重复 context 读。
- **Waste scoring**：turn 收尾时跑 7 项确定性（无 LLM）检查，每项引用 Claude Code 官方文档。
- 状态信号：API 调用失败→标签页变红并归档进「Broken」分类；权限提示→琥珀色并显示待批
  命令名。子代理折叠在 spawn 者之下，显示自己的填充窗口/实际模型/逐字输出。
- API 调用面板：延迟、input/output、**cached-vs-new token 分解**（逐调用）。
- 会话产出：commits 与 tracker 卡片从产生它们的调用读出；搜索接受 commit hash/tracker ID。
- Home 视图：跨会话 turn-size 分布、浪费源、按模型分 token；密度排序全文搜索+就地高亮。
- 可选 Tauri 托盘（仅 3 个通知事件：等批准/最后 API 调用失败/turn 完成）。
- 吸收点：①上下文填充 live 条（模型感知）②浪费评分（确定性检查框架：重复 context 读、
  缓存命中率等——本仓 model_usage 逐行有 cache_read/input 字段可直接算）③Broken/amber
  会话状态信号（本仓已有错误链路，可加会话级红/黄徽标）。

### A2. lookfree/cc-harness — 成本来源分解 + 拓扑图下钻（48★ MIT，TypeScript/Electron，pushed 2026-08-06）
URL: https://github.com/lookfree/cc-harness
- 读本地 `~/.claude/`（+项目 `.claude/`）JSONL，实时 tail；**只读**、内容不出机。
- **token 成本按来源分解**：base session / skills / subagents / MCP / plugins 五桶——
  与本仓「dwf/workflow_child 分列计数」同思想，粒度更细（技能、MCP 单列）。
- **下钻链**：点 cost slice → 该桶最贵 turn 排名 → 点行跳到会话回放中的**确切 message**。
- **live 子代理/workflow 拓扑图**（React Flow，最多 5 级嵌套）：每节点 latency/token 成本/
  嵌套深度；workflow 停摆时可看到哪条分支卡住。与本仓「子代理树」契合但图形化+停摆定位。
- **Cost optimizer**：把当前会话 Opus token 按 Sonnet 价实时重定价，用真实数据展示确切
  节省额（不是估算）。
- 另监控 ScheduleWakeup 事件（pending/fired/expired）、diff MEMORY.md、配置覆盖关系图。
- 吸收点：①五桶成本分解（skills/MCP 单列——需先核实 ZCode schema 是否可区分 skill/MCP
  来源）②cost slice → turn → message 下钻链 ③节点级停摆定位 ④模型重定价对比视角。

### A3. Maciek-roboblog/Claude-Code-Usage-Monitor — 限额推断与耗尽预测（8721★ MIT，Python，pushed 2026-07-05）
URL: https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor
- 社区事实标准的实时用量 TUI 监视器（本轮线索之一「ccmonitor 看板」的真身；GitHub 上
  其余名 ccmonitor 仓库均 ≤54★，不构成候选）。
- **P90 限额推断**：从最近 192h（8 天）会话统计 P90 得出个性化限额（Custom 计划默认），
  宣称限额检测 95% 准确率——无官方限额 API 时的统计学替代。
- **burn rate**（tokens/min，近 1h 会话）+ **Prediction Engine**（预估当前块 token 何时
  耗尽）；v4 加 reset-aware pace 与 date-context forecasts（工作日/周末节奏）。
- **5h 滚动窗建模**：检测 block 起止/过期——与本仓 24h/速度窗同族但按 Claude 计费块。
- **程序化退出码**：0 ok / 10 near limit / 11 limit hit / 20 indeterminate / 30 no data
  ——严重度信号可被脚本消费的形态。
- 数据源三路：本地 JSONL（默认）+ 官方 rate_limits（statusline hook 捕获，新鲜时为唯一
  真相）+ opt-in OAuth usage API。
- 吸收点：①burn rate + 耗尽预测（本仓有逐行 duration/tokens，可做 5h 窗预测线）②P90
  思想推断 GLM 套餐限额（ZCode 无公开限额 API 时的统计学口径）③退出码/严重度分级形态。

### A4. lis186/ccxray — 代理录制 + Context HUD（295★ PolyForm Noncommercial，JS，pushed 2026-09-24）
URL: https://github.com/lis186/ccxray
- ⚠️ 许可证 PolyForm Noncommercial——**只能借鉴思路，不可复制代码**。
- 透明 HTTP 代理（ANTHROPIC_BASE_URL 指到本地 5577）录制每对请求/响应为 JSON 文件，
  零配置；亦支持 Codex/Grok。
- **Context HUD**：附加在响应尾部的 footer「📊 Context: 28% (290k/1M)」+ input/output
  tokens + cache 命中率 + 成本；另有每 turn 的 context window usage bar。
- Token Accounting：逐 turn input/output/cache-read/cache-create 分解、USD 成本、burn
  rate、**per-account rate-limit 卡（5h + 周双窗）**、cache TTL。
- timeline turn 卡片：成本、**cache warmth（缓存热度）**、**tool-fail 风险**、工具名置于
  turn 标题上方；系统提示词版本 diff 查看器。
- `ccxray usage` CLI：JSON 输出、工具分解、最贵会话排行。
- 吸收点：①Context HUD 形态（单行浓缩：百分比+绝对值+cache 命中+成本）②cache warmth/
  tool-fail 风险作为 turn 卡片副指标 ③5h+周双窗限额卡 ④最贵会话排行。代理形态本身与本
  仓「零代理只读」路线冲突，不采纳数据面。

### A5. cobra91/better-ccusage — blocks --live 实时块仪表盘（87★ MIT，TypeScript，pushed 2026-09-21）
URL: https://github.com/cobra91/better-ccusage
- 一轮已用其 GLM 定价表与 ZCode 数据源（`~/.zcode/cli/db/db.sqlite` 直读，本仓同源证据）。
  本轮新点是 **`blocks --live`**：实时仪表盘显示 active session 进度、token burn rate、
  **成本预测（cost projections）**，按 5h 计费块组织。
- 其余：daily/weekly/monthly/session 报告、`--breakdown` 按模型成本、`--since/--until`、
  JSON 输出、项目/实例分组、statusline 模式；多源自动发现（Claude Code/Droid/ZCode/
  Codex/OpenCode/Devin/pi/omp）。
- 吸收点：①5h 块组织 + live 进度 + 成本预测的仪表盘形态（本仓有 24h 窗，可加 5h 块视角
  ——需先核实 GLM 计费是否 5h 块制；若非，作纯展示窗仍可）②「社区已把 ZCode 当一等数据
  源」的生态证据持续成立。

### A6. stefanprodan/cctop — top 风格多会话总览（139★ Apache-2.0，TypeScript/Bun，pushed 2026-09-23）
URL: https://github.com/stefanprodan/cctop
- 终端 TUI：列出每个运行中 Claude Code 会话——进程统计、busy/idle 态、**context size**、
  模型、git branch；live 子代理+子进程树；**孤儿端口检测**（可就地释放）；失控会话可发
  信号停止。零依赖 Bun；只读进程表 + `~/.claude` 会话/转录文件。
- 吸收点：①「全部会话一屏总览」的列设计（状态/上下文量/模型/分支四元组——本仓会话列表
  可加 context size 与 git branch 列）②孤儿 dev-server 端口检测（Windows 上对
  zcode-monitor 用户同样实用）。停止/释放是主动操作，与本仓只读红线冲突，不采纳操作面。

### A7. simple10/agents-observe — hooks 生命周期事件流（682★ MIT，TypeScript，pushed 2026-09-04）
URL: https://github.com/simple10/agents-observe
- 以 Claude Code **插件**安装：注册全会话生命周期 hooks（tool 调用、子代理 start/stop、
  task/permission 事件）流到本地 React UI + SQLite（Docker）；过滤、父子层级、**完整会话
  回放**、per-model token 统计。
- 吸收点：①事件分类学（tool/subagent/task/permission 四类事件的字段设计——本仓 SSE feed
  可对照补缺）②「会话回放」形态（按时间轴重放事件流，只读可做）。
- 注意：其数据面靠 hooks 主动上报（写侧），本仓只读 JSONL/SQLite——吸收事件**分类与回放
  形态**，不吸收 hook 注入路线（红线：对 ~/.zcode 零写入）。

## B. 形态参考（中契合）

### B1. CodeZeno/Claude-Code-Usage-Monitor — Windows 任务栏常驻（520★ MIT，Rust/egui，pushed 2026-09-24）
URL: https://github.com/CodeZeno/Claude-Code-Usage-Monitor
- Windows 任务栏 widget：每 provider 当前用量 + **限额重置倒计时**（5h 短窗行 + 周长窗行
  双行布局）；支持 Claude Code/Codex/Antigravity/OpenCode Go/Cursor/Grok Build，多账号
  （Claude Code/Codex）；托盘控制（左键显隐/右键菜单）、主题工作室；WinGet 安装。
- ⚠️ 数据面与本体相反：读本地凭证**直连官方 API** 拉用量，不解析日志——本仓不可走此路
  （外呼+凭证），但其**双窗倒计时任务栏常驻形态**对本仓桌宠 widget 之外的「常驻层」有
  直接参考价值（Windows 用户即本仓主场景）。

### B2. winfunc/opcode（原 getAsterisk/claudia）— GUI 客户端（22400★ AGPL-3.0，Tauri2+React+Rust+SQLite，pushed 2026-09-24）
URL: https://github.com/winfunc/opcode
- 2026 年从 getAsterisk/claudia 改名迁移至 winfunc org（gh api 实证：getAsterisk/claudia
  302 重定向至此）。
- 用量分析仪表盘：实时成本监控、按模型/项目/时段 token 分解、趋势图表、**数据导出**；
  本地存储、进程隔离、无遥测。
- **Checkpoint 分支时间线**：会话版本可视化分支树、一键恢复、会话 fork、checkpoint 间
  diff 查看器；CC Agents 执行历史与日志指标。
- 吸收点：①checkpoint/会话版本**时间线可视化**（本仓可从 SQLite 只读侧画时间线——
  ZCode 有 `~/.zcode/v2/checkpoints/`，本仓快照监视已存在，可加只读时间线视图）②用量
  趋势图表 + 导出（CSV/JSON 导出是低成本高感知功能）。恢复/fork 是写操作，不采纳。

### B3. rullerzhou-afk/clawd-on-desk — 桌宠（6282★ AGPL-3.0，Electron，pushed 2026-09-24）
URL: https://github.com/rullerzhou-afk/clawd-on-desk
- 一轮 WP4 已吸收其 12 态/入睡/连击交互。本轮新点：
  - **Recap**：本地私有时段统计（时/日/周/月视图，无遥测）——桌宠承载统计视图的形态。
  - **订阅配额一览**：消费 Claude Code 官方 statusline `rate_limits` payload 显示套餐余量。
  - **PWA 手机伴侣**：只读 LAN 镜像 + token 门控——「局域网只读镜像」对本仓（127.0.0.1
    绑定）是可选扩展形态（需过隐私/安全评审）。
  - 远程通知/交互式批准：Telegram/Feishu（可批准）、Slack（仅通知）。
  - 主题系统支持导入 Codex Pet zip 包（与一轮 WP1 的 pet.json+spritesheet 导入同族形态，
    佐证该路线是社区共识）。
- AGPL-3.0：只借鉴形态，不引代码。

### B4. minchenlee/c9watch — 会话三态 + 工人编排视图（127★ MIT，Rust/Tauri2+Svelte5，pushed 2026-09-24）
URL: https://github.com/minchenlee/c9watch
- macOS 菜单栏：扫描 OS 进程自动发现运行中会话，live **working / needs-attention / idle**
  三态；会话历史搜索、成本追踪、PM 式 worker 编排视图；token 门控移动 Web 客户端。
- 吸收点：①三态会话分类（本仓会话列表可按「工作中/待输入/空闲」聚类——needs-attention
  即「等用户批准」是高价值信号）②「把并发子代理当工人排班看」的编排视图视角。

### B5. 官方 /usage 命令与 statusline rate_limits payload（Anthropic 官方，Claude Code 内置）
URL: https://code.claude.com/docs（costs/monitoring 相关页）；社区佐证：Usage-Monitor
`--statusline`、Clawd 配额卡、ccvitals/claude-code-status-bar 均以 rate_limits JSON 为
权威限额源。
- `/usage`：terminal UI 显示当前 Session block（token 统计、context window 百分比、
  rate-limit 状态）。
- statusline stdin JSON 的 `rate_limits` 字段：多工具共同的「官方口径限额」数据源。
- 吸收点：若 ZCode 存在等价 payload（statusline 输出/等价端点），可作本仓限额卡的权威
  数据源替代统计学推断——**本仓是否可得需另行核实**（本轮未验证，unverified）。

### B6. statusline 工具家族（低星但概念可借）
- Owloops/claude-powerline（1167★，TypeScript，pushed 2026-09-24）：vim 风 powerline。
- educlopez/ccvitals：纯 bash，「prettiest statusline」——usage quota、context window、
  git status，**永不阻塞 prompt** 的自约束。
- briansmith80/claude-code-status-bar：**usage limits 的 pacing markers（消耗节奏标记）**、
  context window、git state、live activity、session cost、8 色主题。
- tddworks/ClaudeBar：burn-rate / dollar-balance / reset-countdown 三指示器。
- fabioconcina/claumon（16★ MIT Go）：live rate-limit gauges、**校准用量预测**、memory
  browser。
- 吸收点：pacing markers（在 5h 窗时间轴上标注当前消耗速度是否超前/落后于配额节奏）是
  独特小概念；statusline 家族整体与本仓 Web 仪表盘形态不同，仅概念借鉴。

## C. 已核实但不入选（fit 低 / 已被一轮覆盖）

- hoangsonww/Claude-Code-Agent-Monitor（1014★ MIT，pushed 2026-09-24）：一轮 WP3 已用其
  字节偏移增量解析；其余形态（hooks 仪表盘）与 A7 重叠且 A7 事件分类更细。
- gmr/claude-status（62★ BSD-3）：macOS 菜单栏+桌面 widget，一键 focus 到会话所在窗格
  ——平台限定 macOS，形态与 B1/B4 重叠。
- sverrirsig/claude-control（133★ MIT）：Electron 会话控制台（可批准/拒绝/杀会话）——
  控制面与本仓只读红线冲突；其「git changes/PR checks 并入会话视图」可算边缘参考。
- mishanefedov/agentwatch（15★ MIT，pushed 2026-07-09）：跨编码/非编码 agent 单一时间
  线——star 少、半年未大动，仅记形态。
- simion/termic（283★）：开源 Conductor.build 替代（真终端并行跑 CLI）——会话**运行器**
  非监测器，方向不符。
- zihenghe04/CCDash、tombii/better-ccflare、goccc、toktrack、Pacer、ClaudeBar：用量面板
  家族，形态被 A3/A5 覆盖，不再单列。
- rootedlab-code/claude-code-usage-monitor（6★）：ESP32 硬件小屏显示成本/token/7 天图/
  5h 窗——趣味呈现极致形态，小屏约束下的信息密度设计可参考，star 过少不入选。
- Continuum-AI-Corp/OrcaReplay：录制/回放/分叉，自标「Early」，成熟度不足。
- duqaXxX/seedeep 之外的 ccmonitor 名下仓库（tobyilee 54★ 等）：功能均被 A3 覆盖。
- 纯 bash statusline 见 B6；agent-cli-kit/cc-candybar/claude-powerline-rust（≤13★）不单列。

## D. 负发现（生态空白）

1. **Compaction（压缩）前后 diff 可视化：社区空白。** 官方仅 `/context` 命令（分类占用
   breakdown）与状态栏百分比；社区 statusline/监控器（seedeep、ccxray 等）都做「context
   百分比/填充过程」，但没有一个成熟开源项目做「auto-compact 前后上下文损失了什么」的
   diff 可视化。对本仓：若 ZCode JSONL 有 compact 事件边界，这是一个无人做的差异化功能
   （需先核实数据面）。
2. **Windows 平台的会话监测工具稀缺**：Session Monitors 品类几乎全 macOS 菜单栏
   （c9watch/claude-status/claude-status-bar/ClaudeBar/Pacer/so-agentbar）+ 跨平台 TUI
   （cctop/Usage-Monitor）；Windows 原生只有 CodeZeno 任务栏 widget（B1）与 Clawd。
   本仓天然 Windows 场景，竞品密度低。
3. **「监测 + 桌宠」融合只有 Clawd 一家成势**（6.3k★）；tokibean（一轮已用）之外无第二
   个高星项目把统计视图做进桌宠（Clawd 的 Recap 是唯一先例）。
4. **hook 注入式观测（agents-observe 等）与只读日志观测（seedeep/cc-harness/本仓）是两
   条平行路线**：前者事件全但需写配置，后者零侵入但受限于日志字段。社区无项目同时做两
   面；本仓保持只读路线与社区主流观测面（JSONL tail）一致。
5. ccmonitor 名称下无高星统一项目（最高 54★）——「看板」需求实际由 Usage-Monitor（TUI）
   与 opcode（GUI）分摊。

## E. 复核备忘

- getAsterisk/claudia → winfunc/opcode 改名：gh api 直接返回新名（302 语义），笔记记新名。
- sugyan/claudecodeui 已 404（gh api 404 实证）；现存主仓 siteboon/claudecodeui（13800★，
  现名 CloudCLI）为移动/Web 远程控制 GUI，控制面方向与监测仪表盘不同，未入选。
- Clawd/opcode AGPL-3.0、ccxray PolyForm-NC：均「借鉴形态、不引代码」处理。
- awesome-claude-code 清单 54549★（hesreallyhim，Python，pushed 2026-09-24）——Observability
  & Monitoring 章节为本次候选主来源。
