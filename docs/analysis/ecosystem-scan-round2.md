# zcode-monitor 生态扫描 · 第二轮采纳分析（ecosystem-scan-round2）

- 日期：2026-09-25（SGT）
- 性质：分析与采纳建议文档（本轮只写本文档一个文件；未运行 git 提交、未改仓库其他文件、未起服未跑测试——文中所有事实均引自下述输入或仓库既有文档，未在本轮新执行验证。**修订（2026-09-25 三席评审修复轮）**：25 条意见全部落实——GitHub 元数据十余处失实值按评审 gh api 实测更正；另对 `~/.zcode` 库执行了一组**只读** SELECT 核查（better-sqlite3 readonly 连接，与 server/db.js 同款姿态，零写入；执行时刻 UTC 2026-09-24T17:38=SGT 2026-09-25 01:38，文内实测标注按 SGT 计；结果回填 §2.4 勘误、§9 三项销账及 C1/C2/C6/C7/C10/C11 相关表述），除此之外未新执行验证）
- 输入：家底盘点 ×1 + 五路侦察笔记 ×5（路径见附录 A）；各条目的 stars/许可证/活跃度均为侦察笔记 2026-09-25 经 GitHub API/页面实读的值，本文汇总转述、未复核（评审修复轮已按 gh api 实测更正其中失实处，以文中更正后为准）
- 主仓锚点：main@c6e67b2（clean）；常驻 worktree `F:/project/zcode-monitor-plan`
- 第一轮计划：`docs/ecosystem-adoption-plan.md`（已全部实施，见 §6）
- 本轮结论速览：**候选 16 条（P0×2 / P1×7 / P2×7）**，不采纳 15 组，未核实 16 项（评审修复轮销账 3 项：§9-1/§9-3/§9-9，余 13 项）

---

## 1. 执行摘要

本轮最大的外部变化：**官方 harness 开源（zai-org/ZCode，Apache-2.0，6686★，2026-09-20）**。它把第一轮「从仓库代码推断表结构」升级为「官方源码锚定」——`turn_usage`/`tool_usage` 两张表的完整列定义、`queryTaskUsage` 官方 token 增量口径、30 天保留策略全部可直接吸收（zcode-community.md §1.1，源码 SHA 29628c9 逐字读取）。生态面两个确认：**ZCode 生态的本地深挖仪表盘零竞品**（约 10 款 GLM 用量工具全走远程配额 API）；**Windows 常驻监测形态全生态稀缺**——本仓桌宠+壳是差异化资产，应继续加码而非照搬 macOS 菜单栏。

Top 5 建议（完整清单见 §3）：

| # | 建议 | 一句话理由 | 预期价值 |
|---|------|-----------|---------|
| C1 | **窗口级回合/工具统计（turn_usage/tool_usage 跨会话聚合）** | 官方开源使 schema 权威化；会话粒度消费 WP2 轮起已有（sessionTurns/Usage 标签，db.js:548-572），本轮补的是**窗口级聚合与新视图**（纯增量） | 回合 TTFT/重试/工具错误数的窗口级视角、工具维度成功率/耗时/字节分档（read_only/destructive/approval_status）——官方口径数据的增量面（勘误：原「从 0 到 1」不实，见 §2.4） |
| C2 | **上下文水位体系（context-gauge 统一组件）** | 五路侦察中三路独立指向上下文水位形态（seedeep/abtop/claude-tap/jetbrains 插件/ccxray——按水位/百分比形态计；abtop 原记「compaction 检测告警」README 未证实已删）；compaction 前后观测是**社区空白**（claude-code.md D1 负发现；本库 30d 窗实测 compact 341 行，边界可判定） | 「长会话为何变慢变贵」可解释；一个组件喂会话列表/详情/Widget 三处消费面 |
| C3 | **配额·burn·耗尽预测（quota 统一模块）** | 生态最成熟形态（Usage-Monitor 8.7k★/CodexBar 21.9k★/usage-pulse/Fahim-Yusuf…十余项目同构）；官方配额三端点与鉴权细节已被社区摸清 | 5h 窗进度+重置倒计时+burn 速率+耗尽预测；本地统计为基座，远程配额 opt-in 隔离链路（官方自身也隔离两链路） |
| C4 | **会话深挖 span 树重构 + 证据深链** | langfuse/LangSmith/Phoenix 一系通用范式；同时变现两个未利用数据面（artifacts 工件 4549 条、子代理 output.txt） | session→turn→tool→子代理嵌套 span（时长/token/TTFT）+「点分解→最贵 turn→确切消息/工件」下钻链 |
| C6+C8 | **会话状态信号与本地提醒（waiting 一等公民化）** | 「等用户批准/输入」是三路侦察共同点名的最高价值信号（CCAM Waiting 列/c9watch 置顶/codelight/usage-pulse 紫点）；⚠️ approval_status 待批信号**两轮实测缺失**（尾部全 'none'、permission 表空，§9-4）——v1 按时间启发式+置信标注落地 | 三态会话分类（working/waiting/idle）+ 红黄徽标置顶 + 防噪提醒（气泡/提示音/系统通知），桌宠 waiting_permission 动画行顺势接线 |

排序逻辑：C1/C2 进 P0（数据基座+差异化，原料齐备）；C3-C9 为 P1（形态成熟但各有一项前置核实或依赖；**C9 例外**——无前置、无依赖、§7 风险列为「无」，留 P1 仅因非数据基座、不阻塞其他候选，**快赢性质，可 opportunistic 插入任意轮次**）；C10-C16 为 P2（趣味/延伸/需评审）。

### 1.1 建议实施序列（分批采纳参考）

工作量标注（M/S/L）仅为**相对粒度、非人日**，排期与批次待实施轮按资源评估。按「数据基座 → 消费面 → 增强层」三层分批：

1. **数据基座层**：C1 → C2（P0 查询族先行）；C5 搭 C1 顺风车可同期；C9 无依赖可随时插入（快赢，含共享空态组件）。
2. **消费面层**：C6 → C8（分类器先行，提醒依赖分类器）；C3 本地基座可先行（远程链路待拍板，见 1.2）。
3. **增强层**：C7 → C10/C11（回顾页查询族先行，游戏化与桌宠成长消费其输出）；C4 → C13；C12/C15/C16 按需（C14 先 spike 后立项）。

### 1.2 待用户拍板清单（一次决策覆盖全部悬置授权）

| # | 事项 | 出处 | 前置 |
|---|------|------|------|
| ① | C3 远程配额链路 opt-in（含隐私说明要求） | §3-C3 | 本仓首个外呼面；本地统计链路不依赖此决策可先行 |
| ② | C15 LAN 手机只读镜像 | §3-C15 | 须先闭合「HOST=0.0.0.0 覆写后回环闸可伪造」声明边界，token 闸补位 |
| ③ | 关联既有未决：R-8 字体本地化二选一 | residuals.md | 随本轮一并拍板可省一轮往返 |

> **2026-09-25 结果注**：① C3 拍板为**仅批本地基座**——远程配额链路未批，
> 本地基座待后续批次实施时接线（residuals R-33；batch2 的 C8 token_threshold
> 已按扫描约束用既有会话级查询，未建 quota 模块）；② C15 **暂缓（不做）**；
> ③ R-8 拍板「系统字体为最终形态」已落地销账（fix/r8-system-fonts 合入，
> batch2 T1 守护确认，CSP 至此零外联域）。§1.1 序列中的 C6+C8→C7 已随
> batch2（feature/ecosystem-round2-batch2）交付，后续优先序 C10/C11。

---

## 2. 家底盘点现状（2026-09-25）

> 完整盘点见 `notes/inventory.md`（本节为决策摘要）。数据面现状：真实库 `~/.zcode/cli/db/db.sqlite` **18GB**（ls 实测，较红线锚点 14.6-17GB 又涨）——**处置建议：下一性能相关轮次重跑基线并更新 AGENTS.md 锚点**；读压力中期可由 C14 侧车索引分流（如采纳），本轮接受增长、不单独应对；`transcript.jsonl` 当前 0/7162——ZCode 已停写，`/api/transcript` 恒 `found:false`（数据面退化事实）。

### 2.1 现有 UI 面

- 仪表盘 SPA `public/index.html`：hash 路由 6 视图（overview/sessions/agents/errors/raw/how，`views/*.js` registerView 注册；另有共享组件 `views/timeline.js`）
- 会话深挖 `views/sessions.js`：7 标签（Timeline/Context/Turns/Agents/Tasks/Usage/State）
- 速度胶囊 `public/widget.html`（240×56 壳窗：tier 配色+×N 车道+微 sparkline+呼吸动画）
- 桌宠 `public/pet.html`（双尺寸 canvas 精灵，9 行动画契约 `pet-state.js`，心情优先级 error/tantrum/gen/cruise/sleep——**当前心情链未含 waiting 态**，inventory §1.3）
- 图鉴/导入 `public/pets-preview.html`（staging→导入，许可证 ack 闸）；10 个本地宠物包
- WinForms+WebView2 壳 `shell/Program.cs`（胶囊/迷你宠/正常宠三形态，右键含「重启面板」）

### 2.2 API 端点族（分组概述）

健康与总览（`/api/health`、`/api/overview`）；会话深挖 7 端点（`/api/sessions/:id` 的 turns/conversation/activity/reasoning/children/tool-output）；子代理森林（`/api/agents/tree`）；错误链路（`/api/trace/errors|slow-tools|logs/tail|trace/:id`）；SSE 双通道（`/api/live/events` rowid 水位 + `/api/gen/state|events` 生成态）；widget（`/api/widget/recent|today`）；transcript（恒 found:false）；raw 查看器（22 表白名单）；运维面（`/api/snapshot` 绊线、`/api/checkpoint`、`POST /api/restart`、`/api/pets*`）。装配见 `server/index.js`，路由实现于 `server/routes/`（7 文件）。

### 2.3 已有能力（要点）

只读访问层 `db.js`（重试开连+busy 503 翻译）；token 口径=官方权威（computed_total_tokens，含出处注释）；速度生成口径（1bb73c0：分母剔 TTFT）；SSE 实时体系（live events + livegen ×N 车道）；会话深挖重放/思维链/子代理富化/exec 回看；raw 三重性能钳制；ZCode 运行时守护（tasklist 异步+windowsHide）；快照绊线；桌宠体系（9 行契约+sanitize.js 消毒）；宠物包导入管线；重启链+start-detached；测试 25 个 *.test.js；运行时依赖仅 express+better-sqlite3。

### 2.4 未利用数据面（本轮候选的原料）

| 数据面 | 形态 | 规模 | 本轮消费 |
|---|---|---|---|
| db 列 `query_source`（含 compact）、`variant`、`approval_status`、`attempt_index/retry_count`、`context_exceeded` | model_usage 39 列/官方 schema | — | C1/C2/C6 |
| `cli/artifacts/` | `<sess>/call_<id>-tool-result-<uuid>.json` 结构化工件 | 4549 条目 | C4 |
| `cli/agents/*/output.txt`、`task.output` | 子代理最终交付文本（metadata.json 之外） | 7162 agent 目录 | C4 |
| `cli/rollout/model-io-sess_dwf-*.jsonl` | 逐请求完整模型 IO（dwf actor 落盘） | 仅 3 文件 | 本轮不采（数据量不足以立项，登记） |
| `cli/image-cache/` | 会话截图/图片产物 | 69 条目 | 不采（隐私，§8） |
| `cli/memories\|plugins\|config.json`、`v2/` 其余、quarantine 等 | 记忆库/插件清单/运行时配置/凭据敏感面 | — | 不采（§8，仅登记存在性） |

> **勘误（2026-09-25 只读实测回填）**：本表原首行「db 表 `turn_usage`/`tool_usage`——官方写入端源码已核实完整列；**本机库存在性未开库核实（纪律）**」不实，已移出「未利用数据面」：两表**会话粒度自 WP2 轮起已在消费**（`sessionTurns` db.js:548-572 + sessions.js Usage 标签逐回合渲染、`sessionActivity` db.js:639-648、errorsList/errorSummary/slowTools db.js:699-748/312、livegen 工具失败扫描），未消费面仅剩**窗口级跨会话聚合**（归 C1 增量立项）。「纪律」指扫描轮「不起服、不开库、只读笔记与 GitHub API」的工作约定，评审修复轮解除并补测。同轮实测：两表存在——turn_usage **13,776** 行、tool_usage **547,227** 行、model_usage **404,782** 行，三表最早行均 ≈2026-08-25 21:35（30d 窗 COUNT=全表 COUNT），而 session 表跨 2026-06-07 起——**USAGE_RETENTION_DAYS=30 的 prune 在本机安装生效且覆盖 model_usage/turn_usage/tool_usage 全部三表**（年尺度 token 指标因此无 30 天外数据源，C7/C10/C11 口径已联动修正；本机库另实测 model_usage 存在 session_id 复合索引，见 §7-C2）。

### 2.5 硬红线（全部候选的约束基线）

对 `~/.zcode/` 零写入（唯一例外=WAL 折叠且 wal_active 409 不可绕，`checkpoint-route.js:32-39`）；每条 SQL 命中 `started_at` 索引或 rowid 尾界（18GB 库）；行数参数一律 `clampLimit`/`clampAtLeast`（`http-hardening.js:83-91`）；禁止直接删文件；feature 分支 worktree 编辑；子进程控制台程序 `windowsHide:true`（`zcode-runtime.js:64-69`）；无鉴权姿态=回环 Host 闸+写端点首部闸；两运行时依赖上限；前端无构建步骤；7331 勿动、冒烟 7399。

---

## 3. 候选功能清单（主体，16 条）

### 3.0 统一抽象总览（先读本节）

为避免散点缝补，16 条候选共享四层抽象，同类功能一律落在同一层：

- **L1 查询层**（`server/db.js`，必要时拆 `server/queries/` 子模块，db.js 保持连接/自愈/钳界职责）：三个查询族——
  - `usage-attribution` 族（started_at 索引窗聚合，供 C1/C5/C10/C11/C12 复用）；
  - `context-gauge` 族（会话级 token 序列→水位，供 C2）；
  - `recap-dates` 族（本地日界日桶+active-hours 口径，官方 `queryAppUsage` 的 dayIndex/tzOffsetMs 维度对齐，供 C7/C10/C11）。
- **L2 状态/事件层**（`server/livegen.js` 扩展 + 新 `server/signals.js` 纯函数分类器 + `server/notify.js` 规则引擎）：状态分类（C6）与提醒分型（C8）一次计算、三端消费（面板/widget/pet），分类器不碰 IO 保证可单测。
- **L3 呈现层**（`public/` 共享 vanilla 组件）：`context-gauge.js`（C2）、quota 环/边缘钉（C11 视觉件）、SVG 分享卡渲染器（C10）、火焰图渲染器（C5）、共享空态组件 `window.ZC.emptyState`（C9——各视图空态的统一出口，新增空态一律经它渲染）——全部走 `styles.css` 既有 token（§4）。
- **D 数据面扩展**（只读新面）：artifacts/output.txt 深链（C4）为唯一新增读取面；侧车自有库（C11 累计缓存、C14 检索索引）落在仓内 gitignored 目录，绝不触碰 `~/.zcode`。

每条候选格式：来源 → 它做什么 → 核心亮点 → 如何吸收 → 架构契合 → 工作量/优先级与理由（「值得做」门槛）。

---

### C1 窗口级回合与工具统计（turn_usage / tool_usage 跨会话聚合）｜P0 · M

- **来源**：zai-org/ZCode（https://github.com/zai-org/ZCode，6686★，Apache-2.0，2026-09-20 开源后持续活跃；官方写入端源码 `apps/zcode-cli/.../session-store/repositories/usage.ts` 已逐字读取，SHA 29628c9）
- **它做什么**：官方 harness 自身就是最大的「同源工具」——其 usageStatsService 直接读本地库 model_usage/turn_usage/tool_usage 做官方用量统计。
- **核心亮点**：`turn_usage`（回合级 TTFT/model_request_count/retry_count/tool_error_count/context_exceeded/error_type）与 `tool_usage`（tool_name/approval_status/read_only/destructive/side_effect_scope/exit_code/output_bytes/time_to_first_output_ms）两张表**会话粒度本仓已在消费**（sessionTurns db.js:548-572 + sessions.js:448-466 Usage 标签逐回合渲染 req/tools/tool err/各 token 列/耗时；sessionActivity db.js:639-648；errorsList/errorSummary/slowTools db.js:699-748/312；livegen 工具失败扫描）——**未消费的是窗口级跨会话聚合视角**，本轮立项面；官方 `queryTaskUsage` 的 input 增量口径（压缩 baseline 不回扣）；**30 天保留期**（USAGE_RETENTION_DAYS=30，写入后 prune）——2026-09-25 只读实测确认 prune 生效且覆盖三表（§2.4 勘误）。
- **如何吸收**：直接借鉴（官方源码=权威 schema 文档）。落地：①L1 新增 turn/tool **窗口查询族**（全部 `WHERE started_at >= ?`）；②新路由 `server/routes/usage.js`：`GET /api/usage/turns|tools?window=`；③新视图 `public/views/usage.js`「回合与工具」（回合时间线含重试/错误数、工具维度成功率/平均耗时/字节分档表）；④`how.js` 与 `docs/usage-accounting.md` 补 30 天窗口声明与 queryTaskUsage 官方口径段（升级一轮 WP2 的对账锚点）。（原落地项「sessions.js Usage 标签用 turn_usage 富化逐回合行」删除——该能力 WP2 轮已实现。）
- **架构契合**：纯 L1 查询族+一条新路由+一个新视图，完全复用 clampLimit/索引钳制模式；是 C5/C7/C10/C11 的数据基座（统一抽象的根）。
- **值得做/P0 理由**：杠杆最大——官方开源把 schema 从推断变权威，零新数据面成本换窗口级官方口径指标；原「唯一前置核实：两表在本机库的行数与值域（§9-1）」**已于 2026-09-25 只读实测完成并销账**（两表存在、行数与值域实测，见 §2.4 勘误/§9-1）。

### C2 上下文水位体系（context-gauge 统一组件）｜P0 · M-L

- **来源**：duqaXxX/seedeep（https://github.com/duqaXxX/seedeep，46★，MIT，pushed 2026-09-23；turn 粒度 context 填充 live 视图，模型感知窗口）；graykode/abtop（https://github.com/graykode/abtop，3632★，MIT，pushed 2026-09-14；context 百分比+告警，与本仓最同构项目——原记「compaction 检测告警」README 未证实，已删）；liaohch3/claude-tap（https://github.com/liaohch3/claude-tap，3234★，MIT，pushed 2026-09-22；「相邻请求 diff→上下文逐轮膨胀」观测思想）；csuftt/zcode-jetbrains-plugin（https://github.com/csuftt/zcode-jetbrains-plugin，20★，MIT；上下文容量圆环=构成+缓存命中）；lis186/ccxray（https://github.com/lis186/ccxray，295★，**PolyForm Noncommercial**，pushed 2026-09-24——**只借鉴思路，禁引代码**；Context HUD 单行浓缩形态）；TriDefender/zcode-api（https://github.com/TriDefender/zcode-api，329★，**无许可证（GitHub API license:null 实测——无 LICENSE 文件即默认保留所有权利）**；coding-plan 档模型元数据：上下文 200K/5.2 为 1M、最大输出 128K——**仅取数值事实，不复制其 README 整理文本**）
- **它做什么**：把「上下文窗口占了多少、每轮长了多少、压掉多少」做成一等观测面。
- **核心亮点**：seedeep 的模型感知窗口条（子代理按自身模型窗口计）；ccxray 的 cache warmth 副指标；claude-tap 的逐轮增量曲线；**社区空白：compaction 前后损失了什么的可视化无人做**（claude-code.md D1 负发现）——本库 `model_usage.query_source` 值域含 `compact`（官方 schema；2026-09-25 只读实测 30d 窗 compact 341 行，§9-3 销账），compaction 边界可判定。
- **如何吸收**：复制形态。落地：①`server/models-meta.js` 静态模型元数据表（窗口/最大输出；数值事实参考 zcode-api 整理——其仓库无许可证，只取数值不复制文本；**权威口径以 zai-org/ZCode 官方源码模型常量核对为准（§9-8）**，界面标注非官方权威）；②L1 `context-gauge` 查询族（会话 token 序列：input+cache_read+cache_creation 逐轮累计 vs 窗口；compact 边界行标记）；③SSE 侧：复用 `/api/live/events` 的 model 行增量驱动活动会话水位（不加新通道）；④L3 `public/context-gauge.js` 组件三处消费：sessions 列表行内 mini 条、会话详情 **Context 标签**（已存在，深化：live 条+逐轮增量曲线+compaction 边界竖线+前后水位回落摘要）、widget hover 卡 cache 命中副行（cache_read/input 比率，纯 SQL）。
- **架构契合**：L1 一族查询 + L3 一个组件 + 现有 Context 标签深化，无新端点族；compaction 完整 diff（消息全文对比）列 v2（part 全文在库，但跨 compact 对齐口径复杂），v1 先做边界+水位回落可视化即社区空白的基本盘。
- **值得做/P0 理由**：三路侦察独立指向同一形态；全部原料（model_usage 逐行 token 列）已在库且命中索引；差异化机会（compaction 观测）+可解释性价值（长会话变慢变贵的原因可见）。

### C3 配额·burn 速率·耗尽预测（quota 统一模块）｜P1 · M

- **来源**：Maciek-roboblog/Claude-Code-Usage-Monitor（https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor，8721★，MIT，Python，pushed 2026-07-05；burn rate+P90 限额推断+耗尽预测）；cobra91/better-ccusage（https://github.com/cobra91/better-ccusage，87★，MIT，pushed 2026-07-20；blocks --live 实时块仪表盘——「成本预测」系形态印象，README 未见明文；**唯一已直读本仓同源 db.sqlite 的社区工具，SQL 口径可对账互验**）；steipete/CodexBar（https://github.com/steipete/CodexBar，21872★，MIT，pushed 2026-09-24；重置倒计时+重置庆祝动效+自有 SQLite 成本历史）；beecode-rs/usage-pulse（https://github.com/beecode-rs/usage-pulse，3★，MIT，POC；5h 环形+长窗条形+步速告警）；Fahim-Yusuf/zai-glm-usage-tracker（https://github.com/Fahim-Yusuf/zai-glm-usage-tracker，0★但 v0.3.0/49 单测，MIT；burn velocity +X%/hr+TTE 对齐重置时刻+80/95 阈值去重重臂）；melon-hub/zai-usage-tracker（7★，MIT；≥80% 变色）；zai 官方配额三端点知识（`/api/monitor/usage/quota/limit|model-usage|tool-usage`，Authorization 不带 Bearer，双平台 api.z.ai/open.bigmodel.cn，quota 读不耗配额——zcode-community.md §3 多项目交叉证实）；creditai/Coding-Plan-Monitoring-System（1★，MIT；超支预测=速率外推 vs 重置周期）
- **它做什么**：把「还能用多久、按当前速度几点耗尽、何时重置」做成常驻卡。
- **核心亮点**：P90 统计学限额推断（无官方限额 API 时的替代口径）；本地统计链路与远程配额链路隔离（官方 usageStatsService 自身原则：「monitor 失败不回退本地数据」）。
- **如何吸收**：借鉴思路。落地：①`server/quota.js` 统一「配额面」模块：本地统计基座（5h 滚动窗聚合走 started_at 索引、burn 速率、线性外推 TTE、可选 P90 个性化基线）+ opt-in 远程配额（用户自愿 token 经环境变量/仓内 gitignored 配置注入，Node 内置 fetch，60s 级缓存；**凭证绝不落 ~/.zcode，远程链路默认关闭**）；②`GET /api/quota`（本地）与 `GET /api/quota/remote`（opt-in）；③overview 加配额卡（5h 进度+周窗副行+burn/预测线+有远程数据时的倒计时）；widget hover 卡补一行；重置庆祝动效与桌宠双环的视觉件在 C11 实现、数据由本模块供给。
- **架构契合**：单模块+两条只读端点；80/95 阈值用 severity warn/err token（§4）；与 C8 的「限额临期」提醒共享阈值判断。
- **值得做/P1 理由**：生态最成熟、社区需求实证最充分；不进 P0 因两项前置：GLM 计费是否 5h 块制及 token↔prompts 计量单位未定（melon-hub 口径是 prompts/5h，§9-2）——若非块制则 5h 窗退化为纯展示窗（仍可做）；远程链路是本仓**首个外呼面**，须 opt-in+隐私说明，动工前需用户拍板。

### C4 会话深挖 span 树重构 + 证据深链｜P1 · M

- **来源**：langfuse/langfuse（https://github.com/langfuse/langfuse，35011★，MIT（ee/ 目录除外），pushed 2026-09-24；trace 嵌套 span 范式——LangSmith/Langfuse/Phoenix 一系通用形态，不引入本体）；lookfree/cc-harness（https://github.com/lookfree/cc-harness，48★，MIT，pushed 2026-08-06；「点 cost slice→最贵 turn→确切 message」下钻链+拓扑图卡死分支定位）；fahd09/watchtower（https://github.com/fahd09/watchtower，65★，MIT，pushed 2026-07-12；轮次分组折叠——工具性调用归并进主轮；其代理架构不采）；家底盘点 §2.4 未利用数据面（artifacts 4549 条、agents output.txt）
- **它做什么**：把会话深挖从「平铺标签」升级为「嵌套 span 树 + 可下钻到证据」。
- **核心亮点**：每 span 时长/token/TTFT 一屏可读；证据深链到结构化工件（比 exec 纯文本 stdout 更结构化——inventory §2.4）与子代理最终交付文本。
- **如何吸收**：借鉴范式。落地：①**零新查询**：span 树数据已由 `/api/sessions/:id` 的 turns+activity+children 三端点提供，前端 `sessions.js` 的 Timeline/Turns 标签重组为 span 树渲染（session→turn→tool/model 嵌套）；②「轮次分组折叠」：session_title/compact 等 side call（query_source）默认折叠进主轮；③下钻链：Usage 分解点→turn→conversation 重放锚点（现有能力串成链）；④证据面：新端点 `GET /api/sessions/:id/artifacts`（`cli/artifacts/<sess>/call_<id>-tool-result-*.json` 前缀匹配、条目封顶）与 `GET /api/sessions/:id/agent-output/:agent`（`agents/<parent>/agent_*/output.txt`，段安全闸同 children 富化模式 `server/routes/sessions.js:93`）；tool span 点击→exec 日志（已有 `/tool-output/:toolCallId`）与工件 JSON 双证据切换；子代理 span→交付文本。
- **架构契合**：前端重组为主；两条新只读路由复用 sessions.js 既有段安全/截断模式；与 C5 火焰图共享 L1 usage-attribution 聚合口径（detail 与 aggregate 两视角一份数据）。
- **值得做/P1 理由**：通用观测范式+两个未利用数据面一次变现；定级勘误：原「M-L 上限来自 sessions.js（26k 行）重构风险」系把 26KB 文件规模误读为行数（实测 **493 行/26KB**，inventory §1.1 规模列为 KB 口径）——Timeline/Turns 标签重组属 493 行文件内的局部改动，复评定级 **M**；仍按「行为变更必带回归测试」纪律分步走。后续盘点与本文档的文件规模标注一律带单位（行数/KB），防再次误读传导到定级。

### C5 Token 归因火焰图｜P1 · M

- **来源**：eunomia-bpf/agentsight（https://github.com/eunomia-bpf/agentsight，706★，MIT，pushed 2026-09-13，v1.0.31；token 火焰图=按项目/agent/prompt 类别/模型/token 类型聚合，官网 agentsight.us 核实；其 eBPF 系统级追踪不适用 Windows+只读）
- **它做什么**：「token 和时间都去哪了」——火焰图一屏回答。
- **核心亮点**：按 session→turn→tool→model 层级聚合 token/耗时，宽度即占比。
- **如何吸收**：复制范式。落地：①L1 `usage-attribution` 查询族（`GROUP BY` 逐层下钻，全部 started_at 索引窗）；②`GET /api/usage/attribution?window=`；③新视图 `public/views/attribution.js`（SVG/div 火焰图，vanilla 无构建，色带走 `--chart-*` 变量主题联动）；hover 显示 token/耗时/占比，点击下钻到 C4 会话详情。
- **架构契合**：与 C1 同基座（同查询族不同切面）；不引入任何图表库（火焰图本质是嵌套 div 宽度布局）。
- **值得做/P1 理由**：呈现范式成熟、原料齐备、边际成本低（搭 C1 顺风车）；跨会话归因视角是 overview by_model/by_tool 分解的「可下钻版」，非重复。

### C6 会话状态信号与 waiting 一等公民化｜P1 · M

- **来源**：hoangsonww/Claude-Code-Agent-Monitor（CCAM，https://github.com/hoangsonww/Claude-Code-Agent-Monitor，1014★，MIT，pushed 2026-09-24，同赛道最高星且同 Express+better-sqlite3 系；Kanban Waiting 列=「等用户输入/权限」一等公民）；minchenlee/c9watch（https://github.com/minchenlee/c9watch，127★，MIT，Rust+Tauri，2026-09 仍更新；Needs-Attention 置顶三态）；henrikekblad/codelight（https://github.com/henrikekblad/codelight，63★，Python，pushed 2026-09-11，MIT（GitHub API 实测，§9-9 销账）；waiting 三态图标学——原记「waiting 超 N 分钟告警」README 未证实，已删）；seedeep（Broken/amber 会话状态信号）；beecode-rs/usage-pulse（紫点=「有会话在等你回答」）
- **它做什么**：把「哪个会话正在等我」做成面板最显眼的信号。
- **核心亮点**：状态分类先于统计——working/waiting/idle 三态 + 错误红黄徽标。
- **如何吸收**：借鉴形态。落地：①L2 新 `server/signals.js` 纯函数分类器（输入=各会话最近活动摘要，输出=working/waiting_approval/idle/broken（近窗 error_type）；不碰 IO、node:test 可单测）；②L1 `sessionsWithSignals`——**查询形状钉死**：`WHERE started_at >= now-窗口` 走 started_at 索引取近窗行、按 session_id 聚合取最新伴随列（窗口默认 15min 量级、行数封顶，session 表 1.84 万行级而近窗活跃行远小；**不做逐会话 N+1 逐查**），与 livegen 的分工=并列消费不重复计算（SSE 已连客户端走 `/api/gen/state`（index.js:210）全局 generating 边沿，列表首屏/刷新走本查询）；**approval_status 待批主判定路径两轮实测不可用**（2026-09-22 pet-state.js:27-29 记录 + 2026-09-25 复测：7d 窗 160,827 行全 'none'、1 行 'denied' 系终态回填、permission 表 0 行——该列只记终态、不承载 pending，§9-4）；③`sessions.js` 列表三态徽标+needs-attention 置顶；④`pet.html` 接线 waiting 态到 9 行契约中已就位、当前心情链（error/tantrum/gen/cruise/sleep）未含的 `waiting_permission` 行（inventory §1.3）——低成本补齐且与一轮 WP4 行为体系自然衔接。
- **架构契合**：分类器是 C8 提醒与 C13 卡死分支高亮的共享基座（L2 统一抽象）；waiting 主信号缺失已被两次实测坐实（见上），**C6 v1 收窄为「working/idle + error 徽标 + 时间启发式 waiting」**（最近活动>阈值+会话 time_updated 新，UI **标注置信**）；动工前先定义「启发式-only」验收标准——waiting 误报的可接受阈值与置信标注形态；复测路径=真实触发一次权限批准流后尾部抽查 approval_status 与 permission 表（§9-4），出现非终态值再升级判定。
- **值得做/P1 理由**：三路侦察独立点名同一信号；「别让 agent 卡在等待」是监视器的核心 actionable 价值；分类器纯函数、风险低。

### C7 active hours 口径升级 + 周/月叙事回顾页｜P1 · M

- **来源**：atomchung/ccstory（https://github.com/atomchung/ccstory，43★，MIT，Python，pushed 2026-09-24；**active hours 口径：5min-gap 启发式+并行会话墙钟去重——实测一周原始 177h 去重后 64h**；Top focus/分类桶/8 周 sparkline/环比/覆盖率如实披露）；rullerzhou-afk/clawd-on-desk（https://github.com/rullerzhou-afk/clawd-on-desk，6282★，**AGPL-3.0**，pushed 2026-09-24——只借鉴形态不引代码；Recap 时/日/周/月本地统计视图）
- **它做什么**：「ccusage 告诉你花了多少，ccstory 告诉你花在哪」。
- **核心亮点**：墙钟去重修正并行会话重复计时——直接指出本仓现有「时长」统计的口径缺陷。
- **如何吸收**：复制口径+借鉴形态。落地：①L1 `recap-dates` 查询族（本地日界日桶——对齐官方 queryAppUsage 的 dayIndex/tzOffsetMs 维度；activeHours=5min-gap+墙钟去重，「N× parallel」指标）；②`server/routes/recap.js`：`GET /api/recap?period=week|month|year`；③新视图 `public/views/recap.js`「回顾」：Top focus（按 directory/project 聚合）、每桶要点、sparkline、环比、**覆盖率披露**（与本仓 residuals 文化同频）；④`how.js` 补 active hours 口径定义。
- **架构契合**：C10/C11 复用同查询族；**30 天 prune 已实测覆盖三表（§2.4 勘误）**——token 维度（model_usage）仅 30 天存量：period=month 近似可用（30d≈1 月），**year 档 token 类指标无数据源**，须标「保留窗口内」或依赖 C11 侧车累计供数；活动维度（message/session 表，session 实测跨 2026-06-07 起）可跨窗。口径边界如实标注（诚实原则，联动 C9）。
- **值得做/P1 理由**：修正既有统计缺陷+纯展示增量；叙事回顾是桌宠 Recap 形态与游戏化（C10）的载体页。

### C8 本地提醒体系：通知分类学 + 防噪组合｜P1 · M（排在 C6 之后）

- **来源**：777genius/agent-notifications（https://github.com/777genius/agent-notifications，814★，**GPL-3.0-or-later**，Go，pushed 2026-09-24——**只借鉴思想不抄代码**；7 状态通知分类学+防噪组合：延迟重查焦点/抑制窗口/按状态过滤/DND 尊重/未知焦点宁弹勿静）；CCAM（告警四条件类型：事件模式/不活跃/卡死代理/token 阈值，per-rule 冷却去重——原记「300s/per-session 维度」README 未证实已删；评估在 ingest 事务后不拖慢落库）；arata-ai-daisuki/talking-pets（https://github.com/arata-ai-daisuki/talking-pets，0★，MIT；通知时机设计——「完成/错误/等待权限」三类归纳系形态印象，日文 README 未见明文；VOICEVOX/Kokoro TTS 引擎属实但其引擎路线不引依赖）；Shellishack/vibebud（https://github.com/Shellishack/vibebud，72★，MIT；三态差异化呈现——「强度差异」系形态印象，README 未见明文）
- **它做什么**：任务完成/需要批准/出错时，用恰当强度提醒用户。
- **核心亮点**：分类学（每状态独立开关/声音/强度）+防噪（冷却/抑制/去重）——通知系统的两个正交轴。
- **如何吸收**：借鉴思想。落地：①L2 `server/notify.js` 规则引擎：错误爆发（窗内 N 次）、waiting 超时（依赖 C6 分类器）、单会话 token 阈值（依赖 C3）、不活跃；per-rule 冷却；评估挂在 SSE 事件路径后异步执行不阻塞；②SSE 新事件类型 `notify`，index/widget/pet 三页消费：浏览器 Notification API + WebAudio 短提示音（均内置零依赖）+ pet 气泡（**文本一律过一轮 WP4 的 `public/sanitize.js`**）；③TTS 朗读仅可选（Web SpeechSynthesis 内置），默认关。
- **架构契合**：全本地闭环，无外呼（webhook 通道明确不做，§8）；桌宠气泡出口复用现有消毒模块——统一到既有安全边界。
- **值得做/P1 理由**：提醒是监视器的终点价值（用户不在屏幕前时监视才有意义）；GPL/引擎依赖全部规避；依赖 C6 先行故排序其后。

### C9 数据新鲜度恒显与空态诚实化｜P1 · S

- **来源**：Dicklesworthstone/vibe_cockpit（https://github.com/Dicklesworthstone/vibe_cockpit，26★，MIT+双厂商 rider，Rust，pushed 2026-09-22；**data_freshness 恒输出**——从未采集的机器接近 0 分而非「没有抱怨=满分」；`NO DATA SOURCE YET` 空态点名缺失数据源）；fahd09/watchtower（「未知模型成本显示 `—` 不瞎猜」系形态印象，README 未见明文）；ccstory（覆盖率披露）
- **它做什么**：只读监视器的诚实底线——落后多少、缺什么，永远可见。
- **如何吸收**：复制原则。落地：①`/api/health` 扩展 freshness 对象（SQLite 最后 rowid 时间 vs now、JSONL tail 偏移滞后、ZCode 运行态——health-route.js 已有 zcode_running/wal_bytes 基础）；②`public/app.js` 顶栏常驻新鲜度 chip（「数据落后 X 分钟」）；③空态点名：**L3 共享空态组件 `window.ZC.emptyState(dataSourceLabel, hint)`**（落在 §3.0 L3 层，对照 sanitize.js/pet-state.js 共享模块先例），各视图只传数据源名与处置指引——**不做逐视图散点缝补**；验收标准补一条「新增空态一律经该组件渲染」（与 §4 风格一致性条款同构）——**现成第一例：`/api/transcript` 真机恒 found:false，Sessions 相关空态应明示「ZCode 已停写 transcript.jsonl」而非静默空白**（inventory §2.2/§2.4）；④若做成本估算，未知模型显示 `—`。
- **架构契合**：S 级工作量；freshness 计算与 C12 robot 端点共享（一份计算两处消费）。
- **值得做/P1 理由**：成本最低、原则最强、与本仓既有诚实文化（residuals 登记/口径出处注释/覆盖率披露）完全同频；transcript 数据面退化是当下就该诚实呈现的实锤场景。

### C10 游戏化统计组：streak + 热图 + 确定性 SVG 分享卡｜P2 · M

- **来源**：DenverCoder1/github-readme-streak-stats（https://github.com/DenverCoder1/github-readme-streak-stats，7146★，MIT（LICENSE 实读）；当前/最长/总三指标体系）；xiufengsun/TokenTracker（https://github.com/xiufengsun/TokenTracker，1718★，MIT，pushed 2026-09-24；GitHub 式活跃热图+15 线成就+像素桌宠——其数据面与本仓完全同构，证明形态生态成立）；didrod205/coderecap（https://github.com/didrod205/coderecap，1★，MIT（GitHub API 实测——原「未标注」有误）；**本地/确定性/可分享 SVG** 三原则同频）；minchenlee/c9watch（token 地标趣味可视化：总量画成超越真实地标的米堆）；github/gh-skyline（https://github.com/github/gh-skyline，1343★，MIT（LICENSE 实读）；天际线隐喻——只取隐喻不取栈：该仓库为 Go CLI 生成 3D 打印 STL、不含 three.js，需 three.js 的是 skyline.github.com 网页查看器形态，浏览器内 3D 渲染违反本仓两依赖/无构建约束）
- **它做什么**：把用量数据变成可分享、可炫耀的成就叙事。
- **核心亮点**：确定性渲染（同输入同输出，可复现可审计）——与「编码代理监测×游戏化」生态空白（pet-fun.md 负发现 1：两项检索均 0 结果）正交：**做出来是填空白而非重复造轮子**。
- **如何吸收**：借鉴指标体系+理念。落地：①与 C7 共享 `recap-dates` 查询族；②`recap.js` 视图加「里程碑」区：streak 三卡（当日有完成 model 行即计，纯 SQL 走 started_at）、CSS grid 热图（双主题走 `--chart-*`）；③SVG 分享卡渲染器（L3）：年度 token 总量/模型排行/最活跃日/总时长/错误统计→前端确定性渲染单张 SVG（无随机数、无外联）；**年度 token 总量为保留窗口读数——30 天 prune 实测覆盖三表（§2.4 勘误），标「保留窗口内」或改由 C11 侧车累计缓存供数（二选一实施轮定）**；模式切换：年报卡/token 地标/天际线（每楼=一天，CSS 3D transform）；④成就从简：先 3-5 条确定性成就（连续 7 天/单日 1M token/首次百会话）。
- **架构契合**：纯展示层，消费 C7 数据；C11 桌宠成长播报复用 streak 数据。
- **值得做/P2 理由**：趣味价值高但非监测刚需；全部纯本地可算、零依赖，适合作放松轮次。

### C11 桌宠成长进化 + 数值 HUD + 用量环｜P2 · M

- **来源**：Alichua/TamaCodex（https://github.com/Alichua/TamaCodex，5★，MIT；宠物随 token 消耗成长进化——星少但机制正对本仓独有数据面）；alvinunreal/openpets（https://github.com/alvinunreal/openpets，1237★，MIT，2026-09-24 活跃；Tamagotchi 三维数值+2x2 HUD+live status pin+react 五反应词汇表 editing/testing 独立态）；petergpt/codex-pet-limit-rings（https://github.com/petergpt/codex-pet-limit-rings，84★，MIT；短窗+周窗双用量环跟随桌宠）；vinzdg/codenotch（https://github.com/vinzdg/codenotch，2453★，MIT；屏幕边缘常驻视觉钉）；CodexBar（重置时刻撒花庆祝）
- **它做什么**：桌宠从「状态指示器」进化为「随真实工作量成长的伙伴+常驻配额钉」。
- **如何吸收**：复制机制。落地：①新 `public/pet-progress.js` 纯函数模块（同 `pet-state.js` 形态：输入事件/累计值→成长阶段/HUD 状态，node:test 可测——openpets 的插件测试 harness 思想落到本仓单测模式）；②成长阶段按累计 token/完成会话数（**累计值不做全表 SUM**——违反性能红线；原「启动一次聚合」同样是全表聚合、自相矛盾，已改**渐进构建**：rowid 尾部分块扫描 + 每事件循环 tick 行数预算 + setImmediate 让出、进度可见——listen 不被拖慢、构建期 HUD 读数如实标「累计构建中」；构建完成后由 rowid 水位增量维护，水位复用 latestModelRowid()（db.js:825）同款 MAX(rowid) 通道；**侧车定死仓内 `data/`（gitignored，与 C14 共用目录约定）落盘、内存仅作会话内加速**；30 天 prune 删行不回退已累计值（水位只前进防重复计入）；且因 prune 实测覆盖三表，本侧车是 token 累计指标越过 30 天窗口的**唯一**供数通道（C7 year 档/C10 年度卡依赖于此））；③HUD：2x2 迷你气泡（等级/今日 token/streak/心情）；④SVG 双环贴 widget/pet 角落（5h+周窗，数据来自 C3）+ 桌宠顶部细进度条（codenotch 钉形态，纯 CSS）+ 重置撒花（C3 触发）；⑤react 词汇表扩展（editing/testing 独立反应）并入 pet-state 的 applyGenEvent 分派需克制，**9 行契约不动、避免状态爆炸**（一轮 WP4 风险条沿用）。
- **架构契合**：Windows 常驻稀缺（两路负发现）——本仓差异化资产加码；数据依赖 C3/C7 基座，视觉件是 L3 共享组件。
- **值得做/P2 理由**：机制新颖且原料独有，但属增强层；依赖两个 P1 基座先行。

### C12 agent 自查询面 + 数据导出｜P2 · S-M

- **来源**：getagentseal/codeburn（https://github.com/getagentseal/codeburn，11217★，MIT，pushed 2026-09-24；MCP server 形态让被监测 agent 查询自身用量）；CCAM（本地 MCP 服务器 **97 类型化工具/16 域模块**（README 实读——原记「25 类型化工具」为低报），localhost-only 强制）；c9watch（CLI for agents+`self` 识别调用者自己的会话+NDJSON watch 流——「built for both humans and agents」）；vibe_cockpit（robot JSON 端点+schema_version 包络）；winfunc/opcode（https://github.com/winfunc/opcode，22400★，**AGPL-3.0**，pushed 2026-09-18——只借鉴形态；用量数据 CSV/JSON 导出）；Fahim-Yusuf（Markdown/CSV 报告导出）
- **它做什么**：让脚本和 agent 本人也能消费监测数据。
- **核心亮点**：schema_version 包络（消费者可校验契约）+ 一次性快照形态（abtop `--json` 同款）。
- **如何吸收**：借鉴形态。落地：①`server/routes/export.js`：`GET /api/export/:dataset?format=json|csv`（dataset=overview/usage/recap；Content-Disposition 下载；行数 clampLimit）——**机器可读出口统一端点**，也满足人类用户的报表导出需求；②`GET /api/robot`：一次性快照（`schema_version:1` 包络+freshness 对象（C9 共享）+当前状态/在飞/速度/今日用量）；③可选末段：`tools/mcp-server.js` stdio JSON-RPC 只读包装（手写最小 MCP 协议零依赖；独立手动拉起不进面板进程；localhost-only）——验证需求后再做；④`?self=1` 透传当前会话 id 的 self 语义 v1 不做（调用方识别需壳配合）。
- **架构契合**：只读端点族的自然延伸；导出与 robot 共用 L1 查询族；无任何写面。
- **值得做/P2 理由**：三路独立印证同一趋势（codeburn/CCAM/vibe_cockpit/c9watch）但本仓尚无用户要求实证；导出部分 S 级可先行，MCP 包装等需求信号。

### C13 dwf 运行册视图增强｜P2 · M

- **来源**：CCAM（Workflows 页：编排 DAG、工具执行 Sankey、每图 What/How to read/Why 气泡；Workflow Runs 册从磁盘 journal 重建——与 dwf 运行册同型，「humanized result previews」「彩色 phase 过滤」可对照）；cc-harness（live 拓扑图+停摆分支定位）
- **它做什么**：动态工作流运行从 raw 表格升级为可视化运行册。
- **核心亮点**：phase 彩色过滤+结果 humanized 预览+卡死分支高亮。
- **如何吸收**：借鉴形态。落地：①L1 dwf 查询族（dwf_run≈53/dwf_actor≈0.8k/dwf_node≈2.9k 行级小表；**SELECT 具体列、payload_json 长尾宽行不整取或截断——R-16① 增长绊线约束**）；②`server/routes/dwf.js`：`GET /api/dwf/runs`+`/api/dwf/runs/:id`（actors 表：phase 徽标/state/tokens/tools/duration+result 预览截断）；③新视图 `public/views/dwf.js`（raw 页保持通用查看器定位不塞特化逻辑）；④卡死分支高亮：running 且超阈值的 actor（复用 C6 signals 思想）。
- **架构契合**：与一轮后合入的 workflow_child 计数轮（raw 页 dwf 表/徽标）衔接为「表→册→图」三级；行数小、索引面压力低。
- **值得做/P2 理由**：增量明确但使用频率依赖用户 dwf 工作流密度（本机 53 runs）；排后观察。

### C14 会话全文检索（自建侧车索引）｜P2 · L（先 spike 后立项）

- **来源**：Dicklesworthstone/coding_agent_session_search（https://github.com/Dicklesworthstone/coding_agent_session_search，1144★，**许可证 NOASSERTION**，Rust，pushed 2026-09-24；索引并搜索 11+ 提供商本地会话历史；功能细节未逐条核验）
- **它做什么**：跨会话全文搜索历史。
- **核心亮点**：会话深挖的自然延伸；本仓 message/part 全文在库但 **message/part 无时间索引（ROWID_ONLY，raw.js:61-76）**，18GB 库直接 LIKE 即红线事故。
- **如何吸收**：参考形态+自有方案。落地（设计约束）：①侧车索引库用 better-sqlite3（**现有依赖**）落在仓内 data/ 目录（gitignored），**绝不写入 ~/.zcode**；②增量索引由 message rowid 水位驱动（复用 `/api/live/events` 水位通道思想）——**同步阻塞规避机制是 spike 的硬性验收项**：better-sqlite3 是同步 API、单线程 Node 没有天然「后台」，必须二选一写实：(a) worker_threads（Node 内置、两依赖合规）内建索引、主线程仅收结果；或 (b) rowid 分块扫描+每事件循环 tick 行数预算+节流间隔让出的渐进构建，并给出对在线查询延迟的上界影响（message 72.4 万行/part 293.7 万行的 18GB 库；历史事故形态：message 全表扫 2.4s）；③索引内容：part.data text+session title/directory；FTS5 需核实 better-sqlite3 构建是否含 FTS5（§9-12），**不可用时的降级路径不再含糊——要么写实侧车替代表设计（n-gram/前缀表的具体 schema、查询形态与体积预估），要么放弃 C14**（不做未定义的「降级前缀索引」）；④`GET /api/search?q=&limit=`；sessions 视图搜索框升级（现有 q 仅查标题）。
- **架构契合**：侧车模式=零写入红线的合规绕行（写自己的库）；与 C11 累计缓存共用侧车目录约定（data/）。
- **值得做/P2 理由**：需求真实但工程量最大、需过性能评审（索引构建期 IO/库增长）；**按 BP1 模式先出可行性 spike 再立项**，不直接进里程碑。

### C15 LAN 手机只读镜像（opt-in）｜P2 · M（需安全评审+用户拍板）

- **来源**：onikan27/claude-code-monitor（https://github.com/onikan27/claude-code-monitor，310★，MIT，pushed **2026-01-29（GitHub API 实测，已停更约 8 个月）**，macOS-only；QR 码扫码手机访问+token 认证+只读手机页——远程应答/发消息是写操作不采）；clawd-on-desk（PWA 只读 LAN 镜像+token 门控，AGPL 只借鉴形态）；c9watch（手机 Web 客户端）；FulAppiOS/Agent-Quest（https://github.com/FulAppiOS/Agent-Quest，139★，MIT，pushed 2026-06-12；LAN 模式 env 开关）
- **它做什么**：离开电脑也能盯屏（手机只读视图）。
- **如何吸收**：借鉴形态，全部加前置条件。落地：①默认关闭（显式 env 开启）；②token 门控中间件（`server/http-hardening.js` 旁新增）；**Host 闸语义联动升级——现声明边界「HOST=0.0.0.0 覆写后闸可伪造」须先闭合**（LAN 形态下回环闸放开、token 闸补位）；③只读轻量页（今日用量/速度/在飞/等待批准列表——复用 C3/C6 数据）+隐私横幅（一轮 WP5 文案复用）；④写端点（import/checkpoint/restart）在 LAN 形态**一律禁用**；⑤QR 码受两依赖约束（手写编码器过大）：以「URL+端口」文本提示为主、QR 为可选增强。
- **架构契合**：攻击面扩大是与「无鉴权姿态」声明边界的正面冲突，须用户拍板后才动工。
- **值得做/P2 理由**：需求真实（LAN 手机只读形态多项目同构：clawd-on-desk/c9watch/Agent-Quest；**QR 具体形态主要来自已停更约 8 个月的 onikan27，证据面不宜高估**）但与安全姿态冲突最大的一条，宁慢勿险。

### C16 宠物包导入 QA 升级（导入即验）｜P2 · S-M

- **来源**：openai/skills hatch-pet（https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/SKILL.md，官方 curated skill，**Apache-2.0（skills/.curated/hatch-pet/LICENSE.txt 实读；openai/skills README 明示单 skill 许可证以目录内 LICENSE.txt 为准——原「MIT 清单标注」不实，仓库任何清单处无 MIT 标注）**，SKILL.md 全文实读；**逐行视觉语义表**（running=处理任务/思考/打字、明确禁止字面跑步等）+确定性 QA 管线：contact sheet+逐行动画预览+validation.json（透明度不变量/未用格必须全透明））；crafter-station/petdex（https://github.com/crafter-station/petdex，4156★，MIT；petdex.dev web 画廊形态——「浏览器内验证+逐行动画预览」系站点形态印象，README 未见明文）
- **它做什么**：宠物包导入时自动出验证报告，而非导入后才发现包有缺陷。
- **如何吸收**：借鉴管线。落地：①`server/pet-import.js` 校验层扩展（一轮 WP1 已有尺寸/帧表校验：补行序/帧数完整性校验摘要）；②`public/pets-preview.html`：逐行动画预览循环+canvas 像素级透明度不变量检查+验证报告面板（导入即 QA）；③宠物包规范文档（pets-preview 页或 docs）写入 hatch-pet 逐行视觉语义表——**复制时随附出处链接与 Apache-2.0 许可声明（NOTICE）**：Apache-2.0 允许复制但附带保留/署名义务，按 MIT 假设行事会漏掉该义务（§7-C16 已登记）。
- **架构契合**：一轮 WP1 管线的增量打磨，三入口（CLI/端点/图鉴）复用模式不变。
- **值得做/P2 理由**：非新能力、体验补强；排 P2 因不影响监测主价值。

---

## 4. UI 类建议的风格一致性说明

所有 UI 候选必须落在盘点提取的既有风格事实上（inventory §5，源自 `styles.css:11-127`、`widget.html:30-45`、`pet.html:55-73`）：

1. **双主题**：新视图/组件一律走 `:root[data-theme]` 双态 + `color-scheme` 联动；图表色经 CSS 变量 `--chart-*` 由 `getComputedStyle` 读取（主题切换自动重绘）——C5 火焰图、C10 热图/天际线、C2 水位条均按此实现，禁止硬编码色值。
2. **表面与文本栈**：卡片=surface-1+1px 边框+`--radius-lg 6px`（圆角克制 4/2/6px 档）；文本用 fg-1..fg-5 分层（fg-4 起保 AA≥4.5:1）；数字一律 tabular-nums。
3. **语义色复用**：新阈值带不发明新色——C3 配额 80%/95% 用 severity `warn #fbbf24`/`err #f87171`（浅色 #9a6700/#cf222e）；C2 上下文水位档位同理用 ok/warn/err 三档（与速度 tier <30/30-80/>80 三档约定同构）；C6 状态徽标用类目色+color-mix 8% 透明底模式。
4. **字体**：仪表盘 Geist/JetBrains Mono 栈、基准 13.5px/1.5；widget/pet 两页 Spectrum 子集（light-dark() 双态、Source Sans 3+Noto Sans SC）——**两页 token 子集保持完全一致**的现状纪律，C11 的 HUD/双环/边缘钉组件须同源双页复用一份实现。
5. **无构建约束**：全部新组件为 vanilla 模块（渲染函数或自定义元素），SVG 分享卡（C10）确定性客户端渲染、无 CDN 无外联；唯一既有外联 Google Fonts 维持 R-8 未决状态不扩大。
6. **CSP 自源**：C8 通知用内置 Notification/WebAudio API，不引入远程资源；C15 LAN 页同样受 CSP 自源钉死约束。

---

## 5. 已有能力对照（我们不缺什么）

与现有能力重复的候选已剔除，逐条说明：

| 生态形态 | 本仓已有 | 处置 |
|---|---|---|
| TTFT/吞吐仪表（watchtower Overview、seedeep API 面板） | 速度卡+TTFT 均值/列（速度生成口径轮 1bb73c0，全消费面接线） | 不缺，剔除 |
| 用量多窗分解/趋势图（opcode/ccusage/TokenTracker 趋势） | overview KPI+series+by_model/by_tool，24h/7d/today 三窗 | 不缺；导出归 C12 |
| SSE 实时推流（seedeep） | live events（rowid 水位）+livegen（生成态边沿）双通道 | 不缺，剔除 |
| JSONL 增量解析（CCAM 字节偏移） | 一轮 WP3：log-tail.js fs.watch+字节偏移+降级轮询 | 已覆盖（一轮） |
| 子代理树（abtop/cc-harness 拓扑图） | agents/tree 森林+children metadata.json 富化 | 树已有；图形化/卡死定位归 C4/C13 增量 |
| 桌宠行为/消毒/包导入/隐私提示 | 一轮 WP1/WP4/WP5 全部实施 | 已覆盖（一轮）；C16 是 WP1 增量 |
| 错误聚合/慢工具/trace 瀑布 | /api/trace/* 四端点 | 不缺，剔除 |
| 配置查看器（CCAM Claude Config Explorer 多页签——原「12 页」计数无 README 出处已删） | raw 页 22 表白名单；config.json 生态计划明确定为「只读记录、绝不写」 | 不再扩展（隐私取舍，维持既定决策） |
| 会话回放（agents-observe 回放页） | conversation 重放（message+part）+Timeline 标签 | 重放已有；事件时间轴重组归 C4 |
| 多源聚合/多 provider（codeburn 41 工具、TokenTracker 40 工具） | 本仓单数据面单工具定位（ZCode 官方库） | 不适用，剔除 |
| TUI 形态（cctop/Usage-Monitor/abtop） | Web 面板+壳三形态已覆盖 Windows 主场景 | 不采纳（§8） |
| WAL/运行时守护、自重启链 | zcode-runtime/snapshot-watch/restart-route/start-detached | 生态无对应更强形态，剔除 |

---

## 6. 与第一轮计划的衔接

第一轮（docs/ecosystem-adoption-plan.md，v1 2026-09-21/修订 09-22）**WP0-WP5 已全部实施**（inventory §7，分支 feature/ecosystem-adoption-plan，2026-09-23 收尾）。已覆盖条目本轮不重复展开：

| 第一轮条目 | 状态 | 与本轮关系 |
|---|---|---|
| WP0 测试基建（node:test+tmpdir fixture） | ✅ 已实施 | 本轮全部候选的验收基座 |
| WP1 宠物包一键导入（pet-import.js 三入口） | ✅ 已实施 | **C16 是其增量打磨**（导入即 QA） |
| WP2 token 口径对齐（computed_total_tokens 权威+出处注释；ccusage 勘误后以纯 SQL 交叉核对收口） | ✅ 已实施 | **C1 吸收官方 queryTaskUsage input 增量口径=WP2 的官方锚点升级**（usage-accounting.md §8 增补段）；better-ccusage 直读同源库的 SQL 口径可作对账互验（C3 附带） |
| WP3-lite JSONL 实时性（fs.watch+字节偏移+降级轮询） | ✅ 已实施 | C6/C8 的事件源基础 |
| WP4 桌宠行为与安全（error/入睡/连击/sanitize.js） | ✅ 已实施 | C6 接线 waiting_permission 行、C8 气泡出口复用 sanitize、C11 扩展 pet-state——均为 WP4 体系内延伸 |
| WP5 隐私提示（横幅/README/快照绊线） | ✅ 已实施（绊线后独立成轮） | C15 隐私横幅复用其文案 |
| BP1 t/s 进程 IO 实测 | backlog 未动 | 保持 backlog，本轮不重复 |
| BP2 壁纸实验（Lively） | backlog 未动 | 保持 backlog，本轮不重复 |

第一轮后的独立轮次（速度口径、重启链、workflow_child 计数、快照绊线等，AGENTS.md 当前状态）均已合并 main@c6e67b2，本轮候选在其之上叠加。

---

## 7. 风险与红线校验表（红线合规**设计自查**，除标注「实测」外未实测）

> 下表 ✅ 为设计意图的自查结论而非已验证事实（L4 全局声明适用），密集 ✅ 不应被读作「已过验证」；标注「实测」处为 2026-09-25 只读核查结果。

| 候选 | 零写入 ~/.zcode | SQL 索引/性能 | 两依赖 | 无构建 | 其他风险与对策 |
|---|---|---|---|---|---|
| C1 turn/tool 统计 | ✅ 只读 | ✅ 全部 started_at 窗查询；30 天保留期界面须标注 | ✅ | ✅ | 前置核实已完成（§9-1 销账：两表存在、行数/值域实测，2026-09-25） |
| C2 context-gauge | ✅ 只读 | ✅（实测）会话内查询走 `model_usage_session_turn_idx(session_id, turn_id)`（本机库 sqlite_master 实测存在；sessionTurns/sessionActivity 同款查询模式）；水位增量随 SSE model 行 | ✅ | ✅ | 模型窗口元数据非官方权威（界面标注；zcode-api 无许可证仅取数值事实，权威=zai-org/ZCode 源码常量 §9-8）；compaction 判定已实测可行（30d 窗 compact 341 行，§9-3 销账） |
| C3 quota | ✅（凭证/缓存绝不落 ~/.zcode） | ✅ 5h 窗聚合走 started_at | ✅（Node 内置 fetch） | ✅ | **首个外呼面**：opt-in+隔离链路+隐私说明；5h 块制口径未核实（§9-2）；P90 推断标注统计学口径 |
| C4 span 树+证据深链 | ✅ 只读新增 artifacts/output.txt 读取面 | ✅ 复用现有三端点；新端点按 session 目录前缀+条目封顶 | ✅ | ✅ | sessions.js（**493 行/26KB**——原「26k 行」系 KB 误读）重构分步+回归测试；工件内容视为不可信输入（服务端截断+前端转义，沿用 tool-output 模式） |
| C5 火焰图 | ✅ 只读 | ✅ L1 聚合族 started_at 索引 | ✅ | ✅（SVG/div 自绘） | 大窗聚合行数封顶+clampLimit |
| C6 状态信号 | ✅ 只读 | ✅（实测）`WHERE started_at >= 窗口` + session_id 聚合取最新行（model/tool_usage 各有 session 复合索引，sqlite_master 实测）；不做逐会话 N+1 | ✅ | ✅ | waiting 主信号**两轮实测缺失**（approval_status 尾部全 'none'/permission 空，2026-09-22+09-24）；v1=时间启发式+置信标注，验收含误报阈值；复测路径=真实触发权限批准流（§9-4） |
| C7 回顾页 | ✅ 只读 | ✅ recap-dates 日桶+started_at | ✅ | ✅ | 30 天保留窗口外口径边界如实标注 |
| C8 提醒 | ✅ | ✅ 规则评估在事件路径后异步 | ✅（Notification/WebAudio/SpeechSynthesis 内置） | ✅ | 防噪参数保守默认；GPL 项目只借鉴思想；TTS 默认关 |
| C9 新鲜度/空态 | ✅ | ✅ 复用 health/现有字段 | ✅ | ✅ | 无 |
| C10 游戏化统计 | ✅ | ✅ 共享 recap-dates；streak 走 distinct 日期聚合（started_at） | ✅ | ✅（SVG/CSS 3D） | 无外联（分享卡本地渲染）；**年度 token 类指标受 30 天 prune 限制（三表实测满 30d 覆盖，§2.4 勘误）——标「保留窗口内」或依赖 C11 侧车累计供数** |
| C11 桌宠成长 | ✅（侧车缓存落仓内 data/ 目录） | ⚠️ **全表 SUM 禁止**（含冷启动一次性聚合）→渐进构建（rowid 分块+每 tick 行数预算+setImmediate）+rowid 水位增量维护（db.js:825 通道） | ✅ | ✅ | 状态机复杂度上限（9 行契约不动）；侧车失效场景见 §7.1 |
| C12 agent 查询/导出 | ✅ | ✅ 复用 L1 查询族+clampLimit | ✅（MCP 手写零依赖） | ✅ | 导出含会话标题等——同 raw 页现有隐私边界（本地只读，无外发） |
| C13 dwf 视图 | ✅ 只读 | ✅ 小表+具体列；payload_json 不整取（R-16①） | ✅ | ✅ | 行数增长持续观察 |
| C14 全文检索 | ✅（索引写**自己的**侧车库） | ⚠️ **索引构建同步阻塞=机制性风险**（better-sqlite3 同步 API、无天然后台；message 全表扫 2.4s 历史事故形态）——worker_threads 或分块让出设计为 spike 硬性验收项；查询走侧车索引非主库 | ✅（better-sqlite3 现有） | ✅ | FTS5 可用性未核实（§9-12）；不可用则写实替代表设计或放弃，不做模糊降级；**先 spike 再立项** |
| C15 LAN 镜像 | ✅ | ✅ 复用现有 API | ✅ | ✅ | **攻击面扩大**：token 闸补位 Host 闸、写端点禁用、默认关、须用户拍板 |
| C16 宠物包 QA | ✅ | ✅ 不涉主库 | ✅ | ✅（canvas 像素检查原生） | 复制 hatch-pet 语义表须随附出处链接+Apache-2.0 声明（NOTICE）——署名/保留义务 |

通用项：所有新端点过 clampLimit/clampAtLeast 双侧钳界与回环 Host 闸；行为变更各带回归测试（node:test+tmpdir fixture）；编辑在 feature 分支 worktree。

### 7.1 采纳后维护面增量（全采口径的长期成本，决策前应知）

| 面 | 现状（2026-09-25 worktree 实测） | 全采后 | 增量 |
|---|---|---|---|
| 视图 | 6 个（overview/sessions/agents/errors/raw/how）+共享 timeline.js | +usage/attribution/recap/dwf（robot/export 若做并入现有页或另增） | ≥4-5 |
| 路由文件 | 7（server/routes/） | +usage.js/recap.js/export.js/dwf.js | +4 |
| 服务端模块 | db.js/livegen.js 等既有 | +signals.js/notify.js/quota.js/models-meta.js/pet-progress.js（必要时 queries/ 拆分） | ≥5 |
| 前端共享件 | timeline.js/sanitize.js/pet-state.js | +context-gauge.js/emptyState/SVG 分享卡渲染器/火焰图渲染器 | ≥4 |
| 侧车库 | 0 | data/（gitignored）：C11 累计缓存 + C14 检索索引 | +2 |
| 测试文件 | 24 个 *.test.js（ls 实测；§2.3 的「25」为盘点口径笔误） | 每候选 1-2 个新文件（行为变更必带回归测试红线） | 预计 +16-25 |

侧车（C11 累计缓存 / C14 检索索引）失效与一致性场景清单（实施轮测试必须覆盖）：

1. **重启后水位恢复**：启动读侧车最后水位，与主库 MAX(rowid)（db.js:825 同款通道）对齐后再增量，防止重扫或漏扫。
2. **30 天 prune 与 rowid 语义**：prune 删旧行不回退 C11 已累计值（水位只前进防重复计入）；SQLite 无 AUTOINCREMENT 时新行 rowid=max+1，删最大行后存在 rowid 复用窗口——水位推进逻辑须在测试中对拍验证（漏计/重复计两方向）。
3. **侧车损坏重建**：删除侧车文件即回退冷启动路径（C11 渐进重建/C14 全量重建），重建期读数如实标注（不静默给 0）。
4. **官方 schema 漂移**：侧车列依赖官方 migration——启动时核对 schema_migration 版本，不匹配则停用该侧车并告警（不猜列）。

---

## 8. 不采纳清单与原因

| # | 不采纳项 | 来源 | 原因 |
|---|---|---|---|
| 1 | 代理截流数据面（本地 HTTP 代理录制） | watchtower、ccxray、claude-tap 的架构面 | 违背零代理只读定位；ccxray 另有 **PolyForm Noncommercial 许可证**禁引代码（其 Context HUD 思想已归 C2） |
| 2 | 主动控制面：远程应答/审批/发消息/面板内拉起 agent/杀会话/释放端口 | onikan27、codelight、CCAM Run Claude、abtop、cctop | 写操作/主动干预，违背只读承诺 |
| 3 | hook 注入式观测 | agents-observe 数据面、CCAM hook 体系 | 需写 ~/.zcode 配置，零写入红线（其事件分类学与回放形态已被 C4/C8 吸收） |
| 4 | eBPF 系统级追踪 | agentsight | 平台（Windows）+只读均不符 |
| 5 | SSH 多机舰队 | vibe_cockpit | 超出单机定位 |
| 6 | macOS 菜单栏/原生小组件家族 | CodexBar 本体、c9watch、cctray、vibepulse、AgentLimits、claude-status | 平台不符；Windows 常驻已由壳+桌宠承担（其倒计时/重置/环形态已归 C3/C11） |
| 7 | 直连官方 API 拉用量的数据面 | CodeZeno（凭证外呼） | 外呼+凭证违背纯本地只读；仅其双窗倒计时布局形态归 C3 |
| 8 | tmux statusline 家族 | agent-usage-tmux、claudebar | Windows 宿主不适用 |
| 9 | 多设备同步 | Javis603/token-monitor | 与本机仪表盘定位不符 |
| 10 | AGPL/GPL 代码引入 | opcode、clawd-on-desk、agent-notifications | 许可证不允许；一律只借鉴形态（各条目已内联标注） |
| 11 | 浏览器扩展形态 | 负发现（new-interaction.md §三-1） | Web 面板已是超集 |
| 12 | 会话画廊（image-cache 回看） | inventory §2.4 | 隐私风险（会话截图）；本轮不采，C4 仅登记存在性 |
| 13 | plugins/memories/配置静态清单页 | zmem 提示的可观测面 | 低价值+R-15 隐私注记（截图曾暴露 MCP 名）；暂缓 |
| 14 | TTS 引擎依赖（kokoro/voicevox）、灰色生态（zcode2api captcha 农场等） | talking-pets 引擎路线；zcode-community §4-10 | 前者违两依赖红线（内置 SpeechSynthesis 可选替代，归 C8）；后者不关联不互链（一轮既定决策沿用） |
| 15 | rollout JSONL 请求级重放面板 | inventory §2.4（仅 3 文件） | 数据量不足以立项（dwf actor 才落盘）；登记待数据面增长后复议 |

---

## 9. 未核实项清单（留待事实核查）

| # | 未核实项 | 影响候选 | 核实方法建议 |
|---|---|---|---|
| 1 | ~~turn_usage/tool_usage 存在性/行数/值域~~ **已销账（2026-09-25 只读实测）**：两表存在——turn_usage 13,776 行、tool_usage 547,227 行、model_usage 404,782 行，三表最早行均 ≈2026-08-25（30d 窗 COUNT=全表 COUNT，prune 三表生效，详见 §2.4 勘误）；turn_usage 尾部样本值域与官方 schema 相符（status/model_request_count/retry/tool_error/context_exceeded/error_type）。原「纪律未开库」指扫描轮「不起服不开库」约定，评审修复轮已解除补测 | C1 | 已执行（better-sqlite3 readonly 连接，与 server/db.js 同款姿态，零写入） |
| 2 | GLM Coding Plan 是否 5h 计费块制；token↔prompts 计量单位（melon-hub 口径为 prompts/5h，多项目交叉证实 5h 窗概念但单位未定） | C3 | 官方配额端点 opt-in 实测（三端点+无 Bearer 鉴权细节已知）或对照 zai-coding-plugins 官方实现 |
| 3 | ~~`query_source` 的 compact 值覆盖~~ **已销账（2026-09-25 只读实测）**：30d 窗 GROUP BY（started_at 索引）实测值域——subagent 307,565 / main_turn 65,155 / workflow_child 31,497 / **compact 341** / session_title 224。compact 行真实存在，C2 compaction 边界可判定 | C2 | 已执行（索引窗聚合） |
| 4 | `tool_usage.approval_status` 待批可判定性：**两轮实测均否定主信号**（2026-09-22 pet-state.js:27-29：尾部全 'none'、permission 表 max rowid 0；2026-09-25 复测：7d 窗 160,827 行 'none'+1 行 'denied' 系终态回填、permission 表 0 行）——该列只记终态、不承载 pending | C6 | 余下复测路径：真实触发一次权限批准流后尾部抽查；出现非终态值再升级判定，否则维持时间启发式+置信标注 |
| 5 | ZCode 是否有官方 rate_limits/statusline 等价 payload（Claude Code 官方口径的等价物） | C3（权威限额源） | 对照 zai-org/ZCode 源码 statusline/输出面；zcode.z.ai 文档站（usage-stats 页本轮 WebFetch 404） |
| 6 | ZCode 官方配额端点的 token 获取路径对本仓用户的可用性（官方插件 token 由用户自愿提供） | C3 | 参考 zai-coding-plugins glm-plan-usage 实现文档化引导 |
| 7 | better-ccusage 直读同源 db.sqlite 的 SQL 口径细节（对账互验用） | C3/C1 | 读其源码 ZCode provider 段 |
| 8 | zcode-api 模型元数据表（200K/1M/128K）的准确性（**其仓库无许可证——仅取数值事实参考、不复制整理文本**；权威口径=zai-org/ZCode 源码模型常量，本条即核对路径） | C2 | 对照 zai-org/ZCode 源码模型常量 |
| 9 | ~~codelight 许可证~~ **已销账：MIT（GitHub API 实测，评审修复轮）** | C6（仅形态借鉴，无代码引用则不受限） | 已核实 |
| 10 | tokscale、coding_agent_session_search 功能细节（元数据核实，README/细节未逐条核验；后者许可证 NOASSERTION） | C14（形态参考） | 读 README/源码 |
| 11 | claude-swarm README 未读（仅 API 描述） | 无直接影响（MCP 趋势佐证） | — |
| 12 | better-sqlite3 构建是否含 FTS5 | C14 | `SELECT fts5(?1)` 探测或文档 |
| 13 | CostGoat（GLM Coding Plan Usage Tracker）真实性：两轮检索未定位仓库 | 无（未收录） | — |
| 14 | 智谱侧「API Key 反爬不支持用量查询」说法（二手转述自未能定位的项目自述） | C3（双平台选择） | 官方文档核实 |
| 15 | pet.html waiting_permission 行当前接线状态（盘点心情链未含 waiting，代码未逐行复核） | C6 | 读 pet.html/pet-state.js 源码即可 |
| 16 | Cline/Roo/Aider 内置用量面板（训练知识，本轮未核实文档原文） | 无（背景判断） | — |

---

## 附录 A：输入笔记路径

| 输入 | 路径 |
|---|---|
| 家底盘点 | `F:/project/zcode-monitor-plan/docs/analysis/notes/inventory.md` |
| Claude-Code 生态侦察 | `F:/project/zcode-monitor-plan/docs/analysis/notes/claude-code.md` |
| 多厂商 Harness 侦察 | `F:/project/zcode-monitor-plan/docs/analysis/notes/multi-vendor.md` |
| ZCode 与智谱社区侦察 | `F:/project/zcode-monitor-plan/docs/analysis/notes/zcode-community.md` |
| 桌宠与趣味呈现侦察 | `F:/project/zcode-monitor-plan/docs/analysis/notes/pet-fun.md` |
| 新形态监测交互侦察 | `F:/project/zcode-monitor-plan/docs/analysis/notes/new-interaction.md` |
| 第一轮采纳计划（对照） | `F:/project/zcode-monitor/docs/ecosystem-adoption-plan.md`（已实施） |
