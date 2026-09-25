# 多厂商 Harness 侦察笔记（其他厂商编码代理 CLI/IDE 的社区监测工具）

- 侦察员：多厂商Harness侦察员（动态工作流第二轮生态侦察）
- 日期：2026-09-25（SGT）
- 方法：WebSearch + WebFetch（GitHub 页面）+ GitHub REST API（gh api repos/...，逐仓核实 stars/license/pushed_at，2026-09-25 抓取）+ GitHub repo/code search MCP。
- 目的：为 zcode-monitor 寻找第一轮采纳计划之外的新候选功能/工具/形态。第一轮已覆盖：宠物包一键导入（Codex pet.json+spritesheet）、token 口径对账（JuDaXia/claude-speed METRIC v1.2）、JSONL 实时性强化、桌宠行为与安全升级、隐私提示。

---

## A. 重点候选（已核实元数据）

stars / license / pushed_at 均来自 `gh api repos/{owner}/{repo}`（2026-09-25 运行）。

### 1. steipete/CodexBar — 21,872★, MIT, Swift, pushed 2026-09-24（极活跃）
- URL: https://github.com/steipete/CodexBar
- 是什么：macOS 14+ 菜单栏 App，显示 AI 编码 provider 的用量上限/额度；有 Linux 桌面、Windows 与 CLI 伴随版。
- 数据源（README 自述）：只读「一小批已知位置」——浏览器 cookie/localStorage、provider 配置文件、本地 JSONL 日志；成本历史存本地 SQLite；复用既有会话凭据（OAuth/device flow/API key/CLI PTY）；可选 agent-aware 刷新（经许可查运行进程表）。
- 功能点：菜单栏图标即微型 usage meter（每 provider）；session/weekly/monthly 窗口 + 重置倒计时；credit 余额/花费面板；按货币/provider/模型/项目/会话分组 + 日/时趋势；provider 状态轮询 + 事故徽标 + 图标叠层；WidgetKit 小组件；配额通知；「weekly-reset confetti」（周配额重置撒花）；Merge Icons（多 provider 合一图标 + 切换器 + Stacked 布局）；~50 provider。
- 启示（zcode-monitor）：①限额/配额重置倒计时 + 重置时刻庆祝动效（桌宠可做）；②菜单栏/图标本体即 meter 的微可视化；③provider 事故状态徽标；④成本历史本地 SQLite 落账（与只读承诺兼容：写自己的库）。

### 2. ccusage/ccusage — 18,730★, 自定义 license（spdx NOASSERTION）, Rust, pushed 2026-09-24
- URL: https://github.com/ccusage/ccusage ；文档站 https://ccusage.com
- 是什么：本地 usage 数据源聚合 CLI（Claude Code / Codex 等），自动聚合所有探测到的数据源，输出 CLI 报告与 token-cost 分解；已用 Rust 重写（repo language=Rust）。
- 功能点：多源自动探测聚合（无需子命令）；日/会话/模型多维度分解；5h 窗口 block 报告。
- 启示：①跨 harness 聚合的「自动探测数据源」思想（我们单仓单数据面，暂不需要，但其 per-source 口径文档化值得学）；②Rust 重写背后是纯 JS 解析大 JSONL 的性能压力——我们用 SQLite 索引规避了同一问题，佐证现有架构。
- 备注：第一轮 token 口径对账可能已对照过 ccusage（usage-accounting.md §8 增补口径段）；本轮新信息点是其 Rust 化与 Codex 源支持。

### 3. getagentseal/codeburn — 11,217★, MIT, TypeScript, pushed 2026-09-24
- URL: https://github.com/getagentseal/codeburn
- 是什么：`npx codeburn` 本地跨工具 token/成本追踪，37-41 个工具（Claude Code、Codex、Cursor、Gemini CLI、Copilot、Cline、Goose、Zed、Warp、Qwen、Kimi、Kiro 等）。
- 数据源：纯本地解析各工具已写盘的 session/transcript 与配置文件（如 `~/.claude/`、`~/.claude.json`、`.mcp.json`）；每工具的数据位置/格式/quirks 文档化在 `docs/providers/`；价格取 LiteLLM（24h 缓存）；日聚合落 `~/.cache/codeburn/`（宣称保十年）。
- 功能点（对我们最新颖的）：
  - **Yield 视图**：花费与 commit 关联，分 productive / reverted / abandoned——「钱花出了什么」而非「花了多少钱」。
  - **one-shot rate**（一次成功率）、retry rate、cache hit rate、cost per edit。
  - **task type 13 类分类**（Coding/Debugging/Planning…，由工具使用 + 消息措辞确定性分类）。
  - 形态五件套：terminal dashboard / 桌面 App（Overview、Spend、Sessions、Compare periods、Pull requests）/ web dashboard（`codeburn web` + LAN 设备配对）/ MCP server（agent 查询自己的用量）/ 菜单栏+托盘+GNOME Shell。
  - **Capacity Dock**：屏幕边缘细轨，每 provider 一个剩余容量环 + hover 卡。
  - 限额双窗口（5h/周）+ 相对订阅计划的 pacing。
- 启示：①Yield（用量×产物关联）是纯用量统计之上的下一个分析维度——我们库里有 exec 输出与 git 信息面；②one-shot/retry/cache-hit 是质量指标，可与速度并列成「速度×质量」双卡；③docs/providers/ 式的数据面文档化（我们已有 usage-accounting.md，可对照补「per-task_type 语义」段）；④MCP server 形态让被监测的 agent 自己能查询（我们 HTTP API 已有，可加 MCP 包装候选）。

### 4. graykode/abtop — 3,632★, MIT, Rust(ratatui), pushed 2026-09-14
- URL: https://github.com/graykode/abtop
- 是什么：「AI 编码 agent 的 htop/btop」——TUI 实时监视 Claude Code / Codex CLI / OpenCode 会话。
- 数据源：本地进程 + 文件状态发现会话（零 API key/auth）；OpenCode 读 `~/.local/share/opencode/opencode.db`（SQLite，需 PATH 有 sqlite3）；端口来自 netstat（Windows）或打开文件元数据；唯一网络用途是可选的 `claude --print` 会话摘要。
- 功能点：每会话 token 用量、**context window 百分比 + 压实(compaction)检测告警**、状态/当前任务、rate limit（`--setup` 装 hook 后实时配额）、Git 状态、子进程/孤儿端口、**子代理树**（Claude Code）、内存状态（Claude Code）；面板 1-5 键切换；可选中/杀会话；终端跳转（cmux/tmux/iTerm2）；`--json` 一次性快照 + 库 API；12 主题（4 色盲友好）；第三方参考 web UI（abtop-web-ui）。
- 启示：**与本仓最同构的项目**（本地文件/进程发现 + SQLite + netstat + 子代理树）。可借鉴：①context window 百分比与 compaction 事件可视化（我们库有 token 序列，可推上下文水位线）；②孤儿端口/子进程健康面板；③`--json` 快照 API 形态（我们 API 可加等价「一次性快照」端点供脚本消费）。

### 5. xiufengsun/TokenTracker — 1,718★, MIT, JavaScript, pushed 2026-09-24
- URL: https://github.com/xiufengsun/TokenTracker
- 是什么：本地优先 localhost:7680 Web dashboard（+原生 App），40 工具（Claude Code、Codex、Cursor、Gemini CLI、Copilot、Kiro、OpenCode、Grok Build、Qoder、Goose、Zed Agent、**Droid(Factory)**、Kilo Code、LM Studio、Devin CLI、MiniMax Code、**DeepSeek Harness** 等）。
- 数据源（README 自述）：纯本地解析（无账号/API key）——SQLite DB、JSONL 会话日志、OTEL 导出，或向工具自身配置装 hook；承诺「prompts 与代码永不保存/上传」，只留 token 数、时间戳、模型名。
- 功能点：用量趋势、模型成本分解、**GitHub 式活跃热图**、项目归属、**17 provider 限额追踪**、**成就系统（15 条线）**、可选全球排行榜；**像素桌宠响应真实编码活动（工作时干活、休息时睡觉、跟随光标）** + 4 个原生 widget（Usage/Activity Heatmap/Top Models/Usage Limits）；三平台原生 App；2,200+ 模型价格库（LiteLLM 离线快照）。
- 启示：**形态与本仓重合度最高的项目**（localhost dashboard + SQLite/JSONL 数据面 + 桌宠）。可借鉴：①GitHub 式贡献热图（按天/按会话强度）；②成就/里程碑系统（趣味呈现，和桌宠联动）；③多 provider 限额面板；④桌宠「响应真实活动」的行为映射（我们桌宠已有行为系统，可加「随真实用量节律作息」）。

### 6. junhoyeo/tokscale — 5,528★, MIT, Rust, pushed 2026-09-23
- URL: https://github.com/junhoyeo/tokscale
- 是什么：跨 16+ 平台的 token 追踪，Rust CLI/TUI + web dashboard（来源：awesome-codex-cli 列表描述 + gh api 核实元数据；功能细节未逐条核实）。
- 启示：大平台聚合账本形态；作者 junhoyeo 有大项目工程信誉。细节 unverified。

### 7. liaohch3/claude-tap — 3,234★, MIT, Python, pushed 2026-09-24
- URL: https://github.com/liaohch3/claude-tap
- 是什么：本地代理拦截 + 检查 15+ 编码 agent 的 API 流量（Claude Code、Codex CLI/App、Gemini CLI、Grok Build、DeepSeek Harness、Kimi、MiMo、OpenCode、OpenClaw、Pi、Hermes、Cursor CLI、Qoder、Antigravity、CodeBuddy）。
- 机制：起本地代理（reverse/forward，自动选端口或 --tap-port）并 spawn 客户端指向它；SSE/WebSocket 边转发边录制；无 base-url 支持的客户端注入 proxy/CA 环境变量（MITM）；Cursor 特例只 watch `~/.cursor/projects/*/agent-transcripts/*.jsonl`。
- 功能点：**相邻请求结构 diff（字符级高亮）**——直接看见上下文如何逐轮膨胀；endpoint 过滤/模型分组/全文搜索；token 四分解（input/output/cache read/cache creation）；工具 schema 检查器；单文件自包含 HTML viewer；SSE live 模式；导出便携 HTML/JSON；录制前抹掉常见 auth 头。
- 启示：我们不做代理（只读数据面），但「**请求间 diff / 上下文增长曲线**」的观测思想可平移到会话深挖页：用现有 message/token 序列画「每轮上下文增量」，让用户看懂长会话为何变慢变贵。

### 8. Javis603/token-monitor — 2,352★, MIT, JavaScript, pushed 2026-09-24
- URL: https://github.com/Javis603/token-monitor
- 是什么：本地优先桌面 widget，跨 40+ 工具（Claude Code、Codex、Cursor、OpenCode、OpenClaw、DeepSeek…topics 含 deepseek-harness/dsh/hermes-agent），多设备同步。
- 启示：桌宠/widget 同领域竞品；「多设备同步」是我们没有的形态（本机仪表盘定位下优先级低）。

### 9. vinzdg/codenotch — 2,453★, MIT, Swift, pushed 2026-09-24
- URL: https://github.com/vinzdg/codenotch
- 是什么：macOS App，把 Claude Code/Cursor/Codex/Antigravity 的用量上限「钉」在屏幕边缘。
- 启示：**常驻边缘视觉钉**形态——低打扰、永远可见的限额提示；对应到本仓可以是桌宠顶部的细进度条/钉状指示（纯 CSS 可实现，符合无构建约束）。

### 10. CodeZeno/Claude-Code-Usage-Monitor — 519★, MIT, Rust, pushed 2026-09-24
- URL: https://github.com/CodeZeno/Claude-Code-Usage-Monitor
- 是什么：**Windows 任务栏** widget，跨 Claude Code/Codex/Cursor，跟踪用量上限与重置时间。
- 启示：Windows 原生常驻形态（本机即 Windows）；对本仓的现实意义是确认「任务栏常驻」是用户真实需求——我们的桌宠已承担该角色，可对照其上限/重置显示补齐字段。

### 11. Dicklesworthstone/coding_agent_session_search — 1,144★, 自定义 license（NOASSERTION）, Rust, pushed 2026-09-24
- URL: https://github.com/Dicklesworthstone/coding_agent_session_search
- 是什么：统一 TUI/CLI，索引并搜索 11+ 提供商的会话历史（来源：awesome-codex-cli 列表描述 + gh api 核实；细节 unverified）。
- 启示：**会话全文检索**是会话深挖的自然延伸（我们库有 message 全文，但 14.6-17GB 下必须走索引——可评估 SQLite FTS5 只读视图/受控临时索引的可行性，需过性能红线）。

### 12. slkiser/opencode-quota — 982★, MIT, TypeScript, pushed 2026-09-23
- URL: https://github.com/slkiser/opencode-quota
- 是什么：OpenCode 的 quota/token 用量插件，「zero context window pollution」（以插件 UI 呈现，不占用上下文窗口）；支持 OpenCode Go、Cursor、Copilot、Kimi Code、Alibaba Coding Plan、Antigravity、Z.ai Coding Plan 等。
- 启示：「零上下文污染」是监测 UI 的好原则（信息呈现给用户而非塞给 agent）；对本仓的直接功能迁移有限，作为设计原则收录。

---

## B. 官方内置能力核实（社区工具的补位背景）

- **Gemini CLI：`/stats` 内置命令实锤**——repo google-gemini/gemini-cli 存在 `packages/cli/src/ui/commands/statsCommand.ts`（gh api code search 命中，另有 docs/resources/quota-and-pricing.md 等文档）。但**无官方持久化 dashboard**；社区侧主要靠 OTel 生态（OneUptime/Dash0 等商业可观测平台按 span 计价）与跨工具聚合器覆盖。GitHub 上「gemini-cli 专用监测 dashboard」独立项目未见强者（搜索被通用项目污染，未发现高星专用项）。
- **OpenAI Codex CLI：官方内置缺位实锤**——openai/codex issue #5085「Cost Tracking & Usage Analytics」（2025-10 提出）仍为开放 feature request（WebSearch 结果）。社区补位繁荣：CodexBar(21.9k★)、codex-history-viewer、codex-viz、CodexMonitor 等。
- **Cline（cline/cline，69,226★，Apache-2.0）与 Roo Code（RooCodeInc/Roo-Code，24,298★，Apache-2.0）**：均为开源 VSCode 扩展，成本/用量面板内置于扩展 UI（per-task cost、context window 百分比——**训练知识，未在本轮核实到文档原文，unverified**；cline README 关键词扫描未命中 usage/cost 行）。GitHub 上「cline/roo 专用独立监测项目」搜索仅 1 个弱命中（splitrail 描述中提及支持 Cline）——IDE 扩展生态把监测需求吸收进了自身 UI。
- **Aider**：自带 `--analytics` 落 analytics.log（训练知识，unverified）；社区项目 ycaptain/aider-usage（0★，2026-06 建仓）「Offline token/cost usage reports from Aider analytics logs — like ccusage, but for Aider」——概念存在但无社区规模。
- **OpenCode（anomalyco/opencode，209,836★，MIT）**：code search 「usage statistics」命中 4 文件（含 packages/app/README.md）；abtop 直接读其本地 SQLite（`~/.local/share/opencode/opencode.db`）证明其数据面开放可读。
- **Goose（aaif-goose/goose，54,614★）/ Crush（charmbracelet/crush，28,281★）**：本轮未发现专属社区监测项目；仅作为聚合器（codeburn/TokenTracker 等）的支持对象出现。
- **Factory Droid**：TokenTracker 支持列表含「Droid」，HarnessRouter 支持 DSH/多 harness；**专属监测项目未发现**。
- **Amp**：所有聚合器支持列表与专项搜索中均未出现——**生态空白**（可能是其本地数据面不开放或用户群小，未深究）。
- **DeepSeek 系（DeepSeek Harness/DSH）**：作为 provider 被多聚合器覆盖（TokenTracker、claude-tap、token-monitor、HarnessRouter topics）；无专属独立监测项目发现。

## C. 闭源/商业线索（不选入，记录备查）

- SessionWatcher（https://sessionwatcher.com）：macOS 菜单栏 Codex/Gemini 用量监视（WebSearch 结果；闭源/商业，未核实）。
- OpenSync（https://opensync.dev）：web 侧同步 Codex 会话/token（OpenAI 社区帖提及；闭源，未核实）。
- Dash0 / OneUptime：OTel 商业可观测平台，按 span 吸收 agent 流量计价（WebSearch 结果）。

## D. 未选入但记录的仓库

- xintaofei/codeg（3,674★，Rust）：聚合 Claude Code/Codex/OpenCode/Pi/Grok Build/DSH 会话的协作工作台（桌面/自托管/Docker）——偏会话执行管理而非监测。
- stravu/crystal（3,120★，TS）：多 Codex/Claude 并行 worktree 桌面 App——工作流编排，非监测。
- HarnessRouter/harnessrouter（2,576★，Apache-2.0）：统一 harness 协议 API 网关——基础设施层，非监测 UI。
- onewesong/codex-viz（74★，MIT，pushed 2026-01 半休眠）：本地优先 dashboard（趋势/token/工具洞察）——方向对但休眠，不建议采纳路线。
- HizTam/codex-history-viewer（37★，MIT）：Codex 会话浏览搜索。
- fahd09/watchtower（65★，MIT）：agent↔API 流量 web dashboard。
- lsm1103/session-dashboard（16★）：跨工具历史会话面板。
- vanthienha199/agent-cost-mcp（1★，MIT）：MCP 实时成本追踪 + 预算告警 + dashboard——形态同 codeburn 的 MCP 面，规模太小。
- Piebald-AI/splitrail（222★，MIT，Rust）：11 harness 实时 token 追踪（ccusage/gcusage 同类）——同质化聚合器。
- RoggeOhta/awesome-codex-cli（529★）：本轮的重要情报源（Monitoring & Analytics 分区）。

## E. 负发现汇总（生态空白）

1. **Amp 专用监测工具：零发现**（跨 5 个聚合器支持列表 + 定向搜索均无）。
2. **Factory Droid / Goose / Crush 专用监测：零发现**（仅作为聚合器 provider 出现）。
3. **Gemini CLI 专用独立 dashboard：无强者**（官方仅 /stats 会话内命令；第三方靠 OTel 商业平台或跨工具聚合器）。
4. **Cline/Roo Code 独立监测：近零**（扩展内置 UI 吸收了需求）。
5. **Aider 监测：概念存在（analytics.log）但社区规模为零星**。
6. Windows 原生常驻形态（taskbar）在生态里稀缺（仅 CodeZeno 一家成规模）——本仓桌宠在 Windows 上是差异化资产。

## F. 与第一轮已采纳项的去重说明

- 第一轮已做 token 口径对账（claude-speed METRIC v1.2 / token-speed-monitor 对照）；本轮 ccusage 仅在其「Rust 化 + Codex 源」新事实上列条，不重复口径内容。
- 第一轮已做宠物包一键导入（Codex pet.json+spritesheet）；本轮 TokenTracker 的「像素桌宠响应真实活动」是行为映射新素材，非资产导入重复。
