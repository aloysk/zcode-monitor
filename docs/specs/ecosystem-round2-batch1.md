# 生态采纳需求规格 · 第二轮第一批（ecosystem-round2-batch1）

- 日期：2026-09-25（SGT）
- 状态：**已实施**（2026-09-25，分支 `feature/ecosystem-round2-batch1` T1-T7 交付 + 三席评审/评审修复轮 + 六席终审修复两轮；实施 HEAD 以合并 commit 为准）。本 Spec 把上游分析的第一批范围转化为可验收需求；实施计划（How/步骤/骨架）另行编写。
- 分支/实施位置：worktree `F:/project/zcode-monitor-plan`，分支 `feature/ecosystem-round2-batch1`（本会话核实：分支已在位、工作树 clean，HEAD `c000375`）；主仓库 `F:/project/zcode-monitor` 与 `C:/Users/18086/.zcode` 一律只读。
- 上游指针：范围定义＝`docs/analysis/ecosystem-scan-round2.md` §1.1 第一批（数据基座层+快赢：C1→C2，C5 搭 C1 顺风车，C9 快赢随时插入）；候选完整描述/评审修正/风格约束/红线表/未核实项＝同文档 §3/§4/§7/§9（worktree commit `c000375`）。
- 格式与深度参照：`docs/specs/ecosystem-adoption-v1.md`（第一轮 Spec；Given/When/Then + `[测试]`/`[命令]`/`[评审]` 标注法沿用）。
- 代码现状锚点：2026-09-25 本会话逐文件实读 `server/db.js`、`server/routes/*`、`server/index.js`、`server/http-hardening.js`、`server/health-route.js`、`public/app.js`、`public/views/*`、`public/widget.html`、`test/helpers/fixture-db.js`——本文行号以 `c000375` 为准；现状以代码为准，与上游分析冲突处以代码实读结果标注。
- 验收条数：31 条（C1×9 / C2×9 / C5×6 / C9×5 / 全局×2），逐条可判定完成与否。

---

## 1. 背景与目标

官方 harness 开源（zai-org/ZCode，Apache-2.0）把表结构从「推断」升级为「权威锚定」（分析 §1）。第一批取**数据基座层 + 快赢**四条：C1 窗口级回合/工具统计（官方 schema 数据的增量聚合面）、C2 上下文水位体系（三路侦察独立指向的形态 + compaction 观测这一社区空白）、C5 Token 归因火焰图（与 C1 同基座的呈现层）、C9 数据新鲜度恒显与空态诚实化（成本最低、原则最强）。

本批目标一句话：**在不新增任何运行时依赖、不碰 `~/.zcode` 一个写入字节的前提下，把 turn_usage/tool_usage/model_usage 的窗口级聚合视角、上下文水位观测与「数据落后多少」的诚实呈现做出来，全部消费既有官方口径数据。**

三条既有事实构成本批的地基（均出自上游分析 §2.4 勘误与 §9 销账，2026-09-25 只读实测）：

1. `turn_usage` 13,776 行 / `tool_usage` 547,227 行 / `model_usage` 404,782 行，三表最早行均 ≈2026-08-25——`USAGE_RETENTION_DAYS=30` 的 prune 在本机生效且**覆盖全部三表**（年尺度 token 指标无 30 天外数据源）。
2. `model_usage.query_source` 30d 窗值域：subagent 307,565 / main_turn 65,155 / workflow_child 31,497 / **compact 341** / session_title 224——compact 行真实存在，compaction 边界可判定。
3. 会话粒度消费 WP2 轮起已有（`sessionTurns` db.js:548-572 + sessions.js Usage 标签 renderUsage sessions.js:449-467）——C1 的立项面是**窗口级跨会话聚合**，纯增量。

---

## 2. 范围

### 2.0 勘误与口径修正（承上游分析 + 本 Spec 新增一条）

上游分析已经修正、本 Spec 照录为口径义务的：

- **C1 是增量非从 0 到 1**：两表会话粒度自 WP2 轮已在消费（§2.4 勘误）；原落地项「sessions.js Usage 标签用 turn_usage 富化逐回合行」已删除（该能力已存在）。本批**不得重复立项会话粒度能力，不得改动 `sessionTurns` 的返回形状**（既有契约测试守护继续绿，见 GX-1）。
- **C2 模型元数据权威源 = zai-org/ZCode 源码常量**（§9-8）：zcode-api 仓库无许可证（GitHub API license:null），**只取数值事实、不复制其 README 整理文本**；界面恒标注「非官方权威」（静态整理表，非运行时读取）。
- **compact 30d 窗 341 行实测**（§9-3 销账）：C2 compaction 边界判定的可行性依据。
- **30 天 prune 覆盖三表**（§2.4 勘误）：本批所有窗口级视图与 API 响应负有**口径标注义务**——窗口读数上限即保留窗，界面与响应 meta 必须注明（见 C1-7）。

**本 Spec 新增勘误（规格评审职责，实施必须遵守）**：

- **C2 上下文水位分子公式**：上游分析原文「input+cache_read+cache_creation 逐轮累计 vs 窗口」**重复计 cache_read**。官方语义（`usage-accounting.md` §2.2，经 zai-org 源码 + 真实库数据双重核实）：`input_tokens` 已含 cache_read，cache 列只是 breakdown；真实库窗口实测 input 2,995,457,494 vs cache_read 2,898,595,584（§5.2）——照抄原文公式会使水位 ≈2 倍虚高、缓存重的会话恒爆窗。**修正为：水位分子 = 逐行 `input_tokens`（该次请求时的上下文占用）；`input_tokens = 0` 的行（error/cancelled 全零行）回退官方 fallback 公式 `cache_creation_input_tokens + cache_read_input_tokens`（出处：`usage.ts recordModelUsage` 的 `inputSideTokensFromNormalizedUsage`，usage-accounting.md §2.1）**。回退行在 UI 如实标注。

### 2.1 C1 窗口级回合与工具统计（P0 · M）

**用户故事**：作为用量关注者，我要一个跨会话的窗口视角看回合健康度（重试/错误/context 超限）与工具维度表现（成功率/耗时/字节/只读与审批分档），而不必逐个会话点开 Usage 标签。

**现状锚点（2026-09-25 实读）**

- 窗口查询先例：`overviewKpis`/`breakdownByModel`/`breakdownByTool`（db.js:171-318）全部 `WHERE started_at >= @since`；窗口参数解析先例 `overview.js:8-18`（`24h|7d|today`，未知值回退 24h）。
- 行数钳界先例：`clampLimit(req.query.limit, 100, 500)`（sessions.js:48）；helper 语义 http-hardening.js:83-91（负值钳 1、0/NaN 回落缺省、超上限钳 max）。
- 官方 schema 出处注释约定：db.js 逐查询 `// schema source: zai-org/ZCode MIG/USAGE/OBS`（usage-accounting.md §9）。
- 会话粒度已有面（勿动）：`sessionTurns`（db.js:548-572）、sessions.js `renderUsage`（:449-467）、`renderTurns`（:388-404）。

**需求**

1. **L1 usage-attribution 查询族（窗口切面）**：`server/db.js` 新增窗口级聚合查询，按既有 `── 分节 ──` 形态独立成节（`── Usage attribution ──`，不散插既有域；db.js 现状 929 行/8 个功能分节，实读 c000375）——turn 侧：窗口内 turn 计数、status 分布（completed/error/cancelled）、`SUM(model_request_count)`、`SUM(model_retry_count)`、`SUM(tool_error_count)`、`AVG(time_to_first_token_ms)`（回合 TTFT 窗口视角，上游 C1 点名指标；与速度口径轮 model_usage 侧的 avg_ttft_ms 互补——那是逐请求生成速度面，本处是回合健康度窗口面，不重复）、`context_exceeded` 计数、`error_type` 分布 Top 5（**截断如实标注**——分布对象内附 truncated 标记或响应 meta 注明被裁计数，比照 C5-2 的诚实截断义务，不静默裁剪）；逐回合时间线行（turn_id/session_id/started_at/duration_ms/time_to_first_token_ms/status/model_retry_count/tool_error_count/error_type/context_exceeded/computed_total_tokens，新→旧，行数钳界见需求 3）。tool 侧：按 `tool_name` 分组——calls/errors/成功率/`AVG(duration_ms)`/`MAX(duration_ms)`/`SUM(output_bytes)` + 组内 `read_only` 分布（只读/非只读计数）+ `destructive` 分布（值→计数，与 read_only 同形态；上游 C1 点名三档之一）+ `approval_status` 分布（值→计数）。全部 `WHERE started_at >= ?`。token 口径一律 `computed_total_tokens`（官方预计算权威值，不自造公式）。
2. **`approval_status` 诚实呈现**：该列实测只记终态（7d 窗 160,827 行 'none' + 1 行 'denied'，§9-4）——分档列如实展示值域分布，**不得赋予「待批/pending」语义**（那是 C6 的时间启发式问题，本批不碰）。
3. **新路由 `server/routes/usage.js`**：`GET /api/usage/turns?window=` 与 `GET /api/usage/tools?window=`。window 取值 `24h|7d|30d`（默认 24h；未知值回退 24h，对齐 overview.js 先例；30d=完整保留窗，对齐 §2.4 实测）。**窗口解析与响应 meta（window/since/retention_days）抽为本路由文件内一处共享 helper，本族三端点（turns/tools/attribution，见 2.3）统一消费，禁止逐端点内联**——overview.js:8-18 先例是路由内联 if/else 且值域不同（24h|7d|today，无 retention meta），照抄即 4 处手写两套值域；helper 注释显式声明与 overview 的值域差异（本族含 30d、不含 today；overview.js 既有内联不动，不越界改既有路由）。响应含 `window`/`since`/`meta.retention_days` 与口径说明；`retention_days` 为服务端常量（默认 30——本机实测值，非读取上游配置；上游 `USAGE_RETENTION_DAYS` 是 ZCode 侧可配置项，本仓不读其配置文件；常量注入可测，与 C9-1 阈值同款形态）。时间线行数一律 `clampLimit` 钳界（**默认 100、上限 500**——sessions.js:48 先例同款二元组）；tool_name 分组返回全量工具名基数（真实库工具名为有限枚举，无 limit 参数、无整表物化风险）。装配于 index.js 既有 `/api/*` 路由区（index.js:171-177 同款 `app.use('/api/usage', …)`）。
4. **新视图 `public/views/usage.js`「回合与工具」**：回合时间线（横条长度=耗时、错误红/取消黄着色、重试与工具错误数、context_exceeded 标记——形态对齐 sessions.js renderTurns :388-404）+ 工具维度分档表（成功率/平均耗时/字节/read_only/**destructive**/approval 分档列——destructive 与需求 1 聚合、C1-3 断言同源呈现，聚合返回而视图不展示将成三档只显两档的暗缺口）。空态经 C9 的 `window.ZC.emptyState` 渲染。30 天保留边界标注（C1-7）。
5. **文档与 How 页增补**：`docs/usage-accounting.md` 新增小节「queryTaskUsage 增量口径（C1 增补）」——官方 `queryTaskUsage()` 的 input 增量口径（压缩 baseline 不回扣，USAGE 源码出处）与「该口径是会话内增量、非本仓窗口聚合口径」的边界声明；`how.js` 补 30 天窗口声明段（保留窗覆盖三表的实测事实）与 queryTaskUsage 口径指引。此为 WP2 对账锚点的官方升级（分析 §6 WP2 行）。

### 2.2 C2 上下文水位体系（P0 · M-L）

**用户故事**：作为长会话用户，我要一眼看到「上下文窗口占了多少、每轮长了多少、compaction 压掉多少、缓存命中多少」——长会话为何变慢变贵可解释。

**现状锚点（2026-09-25 实读）**

- 会话内查询走 `model_usage_session_turn_idx(session_id, turn_id)`（真实库 sqlite_master 实测存在，分析 §7-C2）；fixture 对应 `idx_model_usage_session`（fixture-db.js:36）。两段查询模式先例：`sessionList`（db.js:515-534，页内 id 索引寻址聚合）。
- SSE model 行载荷已含 `input_tokens`/`query_source`/`model_id`（`recentModelRowsAfterRowid` db.js:808-821；发射于 live.js:44-59）——**水位增量零服务端改动**。行在请求完成时落库（`recordModelUsageFact` 完成后写入），生成中不跳动（UI 口径说明义务）。
- widget hover 卡现状：`.tip`（widget.html:157-173），数据源 `GET /api/widget/today` → `todayUsage()`（index.js:214、db.js:482-492；注意其 `tokens` 是速度口径 output+reasoning，非 input）。
- Context 标签现状：`renderContext`（sessions.js:159-326，左侧 turn 轨+右侧对话，compaction part 行已存在 :374-376 但无水位视图）。
- 无 `server/models-meta.js`、无 `public/context-gauge.js`、无 freshness/emptyState（本会话 grep 证实为 0 命中）。

**需求**

1. **`server/models-meta.js` 静态模型元数据**：导出按 `model_id` 精确匹配查 `{ context_tokens, max_output_tokens }`（v1 不做 variant 键——与「不猜窗口」原则一致，未命中即 null，不尝试前缀/后缀等模糊匹配）；未知模型返回 `null`（诚实空态，不猜窗口）。数值事实参考 zcode-api 的 coding-plan 档（上下文 200K / 5.2 为 1M / 最大输出 128K）——**只取数值、不复制文本**（其仓库无许可证）；权威核对以 zai-org/ZCode 源码模型常量为准（§9-8 路径），逐值标注「已核对官方源码常量（出处）」或「未核实」；文件头注声明许可证纪律与「静态整理表、非官方权威」。纯数据模块，node:test 可直接 require。
2. **L1 context-gauge 查询族**（查询函数落 `server/db.js`，独立 `── Context gauge ──` 分节，不散插既有域）：会话 token 序列查询（逐 model 行：started_at/turn_id/model_id/query_source/input_tokens/cache_read_input_tokens/cache_creation_input_tokens，**取最近 N 行后按 started_at ASC 返回**——`ORDER BY started_at DESC LIMIT @limit` 子查询（或 rowid 尾界）取最新端再反转；ASC+LIMIT 直取会错取会话**最旧**端，长会话超 100 行常态（真实库 model_usage 404,782 行），live 水位条种子、compact 前后回落摘要都消费最新端，截错端则种子停在远古、SSE 只推 connect 后新行、中间段永久缺失；会话内小集合 + session 索引寻址 + 小排序，无整表物化风险；既有 sessionTurns（db.js:554-566）全量 ASC 无 limit，本条是首次引入会话内序列 limit，故显式钉方向，行数钳界见需求 3）——`query_source='compact'` 行天然可标记为 compaction 边界（30d 窗实测 341 行，§9-3）。**水位分子口径见 §2.0 勘误（input_tokens，input=0 回退 cache_creation+cache_read）**；查询命中 session 复合索引（会话内查询，sessionTurns 同款模式）。**窗口值唯一通路**：行由路由层经 models-meta 查 `model_id` 附 `context_tokens`（未知→null）——浏览器端组件无法 require `server/models-meta.js`，前端不持有、不复制模型窗口表（一处定义多处消费，见需求 4）。
3. **会话级 API**：`GET /api/sessions/:id/context-gauge?limit=`（挂 routes/sessions.js，`:id/turns` 同款形态，**非新端点族**；limit 经 clampLimit，**默认 100、上限 500**——sessions.js:48 先例同款二元组）。
4. **L3 组件 `public/context-gauge.js`**：核心计算（占用比=分子/窗口、相邻请求增量、compact 边界前后水位回落值、未知模型→unknown 态不显示百分比）为**纯函数双端导出**（浏览器挂 `window.ZC.ContextGauge` + `module.exports` 供 node:test，pet-state.js 先例；**挂载责任单点：context-gauge.js 文件自身（browser 分支）挂 `window.ZC.ContextGauge`，app.js 不含 `window.ZC.ContextGauge =` 赋值**——同 C9-3 对 emptyState 的钉法）；渲染部走 styles.css 既有 token。**组件两处消费 + widget 数据面一处扩展**（第三处是 todayUsage 增列的独立数据面，非本组件消费面）：
   - sessions 列表行内 mini 条：`sessionList` 响应扩展每会话「最新 model 行」的 `model_id`+`input_tokens`+`context_tokens`（后两者由路由层经 models-meta resolve 附带——组件不持模型表；两段查询模式，页内 id 索引寻址，db.js:515-534 先例）；renderList（sessions.js:83-116）行内 mini 水位条，未知模型（context_tokens=null）不渲染百分比。
   - 会话详情 Context 标签深化（renderContext 内新增水位区）：live 水位条（种子=context-gauge 查询——行内 context_tokens 即窗口值，SSE model 行 `input_tokens` 只推分子增量，会话内模型切换以最新种子行为准）+ 逐轮增量曲线 + compaction 边界竖线 + 水位回落摘要（compact 前后占用对比）。
   - widget hover 卡 cache 命中副行（数据面扩展，非组件消费）：`todayUsage()` 增列 `input_tokens`/`cache_read_tokens` 两 SUM 并在响应侧算好 `cache_hit_rate`（=cache_read/input，分母官方语义已含 cache_read；**当日 input 总和为 0（全零行日，§2.0 勘误承认存在）→ 比率为 null，widget 副行显示『—』（共享 formatter null 语义），禁止 NaN/Infinity 上屏**）；widget.html `.tip` 增「缓存命中 X%」副行，纯渲染不计算。
5. **SSE 复用不加新通道**：活动会话水位由既有 `/api/live/events` 的 model 行驱动（载荷已含所需列，零服务端改动；server/ 下 `text/event-stream` 写头点保持 2 处——live.js:29 与 index.js:222，本会话 grep 实测基线）。
6. **明确不做**：compaction 完整 diff（消息全文对比）列 v2（分析 C2 原文；part 全文在库但跨 compact 对齐口径复杂，v1 只做边界+水位回落可视化）。

### 2.3 C5 Token 归因火焰图（P1 · M）

**用户故事**：作为用户我要一屏回答「token 和时间都去哪了」——按会话/回合/模型层级聚合，宽度即占比，点击下钻到会话详情。

**需求**

1. **与 C1 同基座**（usage-attribution 聚合切面，GROUP BY 逐层下钻，全部 started_at 索引窗）。
2. **`GET /api/usage/attribution?window=&level=&limit=`**（挂在 2.1 的 routes/usage.js，同一路由文件；窗口解析与响应 meta 走需求 3 的共享 helper——三端点一处定义）：
   - `level=session`（默认）：按 session 聚合——tokens（`SUM(computed_total_tokens)` 官方口径）/耗时（`SUM(duration_ms)`）/calls/`by_query_source` 分解（五值域见 §1 事实 2），携 session 标题（session 表 join 或页内补齐），按 tokens 降序，行数 `clampLimit`（默认 50、上限 200），截断须在 `meta.truncated` 如实标注（诚实原则）。
   - `level=turn&session_id=`：该会话内逐 turn 分解（token/耗时/model_calls/tool_calls），走 session 复合索引（会话内天然小）；行数 `clampLimit` 同 session 档（**默认 50、上限 200**），截断 `meta.truncated` 同款如实标注。
   - 响应含 `window`/`since`/`meta.retention_days`（共享 helper 装配，口径标注义务不因端点多而豁免）；空窗口 → 空数组 + meta（不抛错）。
     > **终审偏差注（2026-09-25 六席终审 F-码-5，§2.0 勘误同款形态）**：本条按 session 层字面实施；`level=turn` 的响应**不带 `window`/`since`**——下钻层是会话内全量分解、无窗口语义（窗口选择器只治理会话层），携带窗口字段对下钻层是误导；`meta.retention_days` 仍适用（保留期是库级事实）。实施语义见 server/routes/usage.js 分节注释，偏差记录见 AGENTS.md 当前状态条目与 residuals 变更日志。
3. **新视图 `public/views/attribution.js`「Token 归因」**：SVG/div 火焰图=**嵌套宽度布局，零图表库**（火焰图本质是嵌套 div 宽度布局，分析 C5 原文；本仓 Chart.js 仅 overview 既有使用，本视图不引）；色带经 `--chart-*` 变量由 `cssVar` 读取（app.js:109-133 既有通道）、主题切换经 `zc-theme-changed` 事件重绘（rethemeCharts 既有形态）；hover 显示 token/耗时/占比；点击 session 层帧下钻 `#sessions/<id>`（turn 层帧 → `#sessions/<id>/turns`）。
4. **窗口档与规模钳制义务**：默认 24h；7d/30d 提供但**必须真实库只读实测计时**（30d 窗 model_usage ≈40 万行的 GROUP BY 聚合，量级为 24h 的 ~18 倍——overviewKpis 的 24h 窗实测 32.9ms / 39.7–50.5ms 可作参照基线，usage-accounting.md §6:231-232 原始区间照录）；实测超事件循环安全量级（历史事故锚点：message 全表扫 2.4s；负 LIMIT 整表物化 8.8s——AGENTS.md 红线 2）则必须加规模钳制（rowid 尾界 cap，slowTools db.js:771-794 先例）或收窄档位，取舍照录入验收记录。

### 2.4 C9 数据新鲜度恒显与空态诚实化（P1 · S，快赢）

**用户故事**：作为只读监视器的用户，「数据落后多少、缺什么」永远可见——没有抱怨不等于满分，静默空白不等于没有数据。

**现状锚点（2026-09-25 实读）**

- `/api/health` 现状：工厂 `makeHealthRoute`（health-route.js:12-34，依赖全注入可测），已有 `zcode_running`/`wal_bytes`——freshness 有基础面。
- 顶栏：`healthLoop`（app.js:193-221）每 5s 轮询 health 写 `#topbar-meta`；index.html 顶栏 :32-56。
- transcript 空态现状：timeline.js:26-34 的 found:false 卡片文案称「主交互会话不产生 transcript…只有子 agent 才有」——**与本机实况冲突**（ZCode 已停写 transcript.jsonl，0/7162，`/api/transcript` 恒 found:false，分析 §2）——对子代理会话该文案已失实，是「空态诚实化」的实锤第一例。
- 未知模型显示 `—`：共享 formatter `fmtNum(null)` → `'—'`（app.js:8-16）已是既有契约。

**需求**

1. **`/api/health` 扩展 `freshness` 对象**（health-route.js 工厂内，依赖注入形态不变）：`db`（最后 model 行 `started_at` vs now 的 lag_ms——查询走 rowid 尾界 `ORDER BY rowid DESC LIMIT 1`，latestModelRowid db.js:824-826 同款通道；无行→null）、`jsonl`（当日日志文件 `log.defaultTodayFile()` 的 mtime vs now；无文件→null。**不用 `todayLogFile()`**——其 UTC 映射在本地 00:00-08:00（SGT，UTC+8）期间指向昨日停写旧文件，mtime 恒陈旧，freshness 将每天误报 err 档 8 小时；log-tail.js:12-20 头注已定性其为「不再是内部读路径的依据」。`defaultTodayFile()`（log-tail.js:155-168）取 LOG_DIR 内名字最新匹配文件，「名字最新」语义对 UTC/本地命名惯例都成立，已随 module.exports 导出（log-tail.js:363-364），内部读路径（tailLog/watch 缺省）既有同款，规格引用不算扩 API 面）、`zcode_running`（复用既有字段）。**阈值与分档判定在服务端**（常量注入可测）：`ok / warn / err` 三档语义色（severity 约定），缺省阈值 `FRESHNESS_WARN_MS=5min`、`FRESHNESS_ERR_MS=30min`——本 Spec 拍板的工程缺省值（量级依据：companion 无请求自清 5min、健康轮询 5s；常量可调，UI hover 说明口径）。**档位归属 `>=`（含等值）**：lag 恰等于 5min 即 warn、恰等于 30min 即 err。口径说明义务：生成中的长请求完成前不落库，lag 读数偏大属正常——hover 文案注明，与 `zcode_running` 并读。
2. **顶栏常驻新鲜度 chip**：index.html 顶栏新增元素；app.js healthLoop 渲染「数据落后 Xm」（<60s 显示秒数「数据落后 Xs」、>60s 显示分钟、>1h 显示小时——三级均为**显示格式化**阈值，非分档判定；warn/err 用 severity 色）——前端只渲染，分档判定全在服务端（可测性设计）。
3. **L3 共享空态组件 `window.ZC.emptyState(dataSourceLabel, hint)`**：独立文件 `public/empty-state.js`，**双端导出**（浏览器挂 `window.ZC.emptyState` + `module.exports` 供 node:test 直测——sanitize.js/pet-state.js 先例）；**组件内对 label/hint 一律转义后拼接**（共享 escapeHtml 同款规则——app.js:51 定义、:305 导出；empty-state.js 加载序不可依赖 app.js 时组件内自带等价实现，sanitize.js 先例同思路：安全默认收在共享模块），**消费方无需自行转义**——首例 timeline 传静态串无风险，但组件是共享基建（「本批新增空态一律经该组件渲染」），后续批次传动态值（会话标题/模型名等库内字符串）时未转义即 XSS 入口，故转义义务钉在组件自身；index.html 引入。各视图空态**只传数据源名与处置指引**，禁止逐视图散点缝补（验收含「本批新增空态一律经该组件渲染」的契约钉）。
4. **第一例：transcript 空态诚实化**：timeline.js found:false 分支改经 emptyState 渲染，**区分两情形**——(a) 主会话（interactive）：本就无 transcript，指引去 Context（既有文案语义保留）；(b) 子代理/其他会话：明示「ZCode 已停写 transcript.jsonl（本机实测数据源退化）」而非静默空白。视图可经 `/api/sessions/:id` 取 task_type 判型。
5. **未知模型显示 `—`**：本批不引入成本估算（C3 非目标）；凡本批新增数字位，未知/缺失值一律走共享 formatter 的 null→`—` 语义（既有契约），models-meta 未命中不显示猜测的窗口/百分比（与 C2 需求 1 联动）。

---

## 3. 非目标（本批不做，出现即越界）

1. **C3 全部**（配额·burn·耗尽预测，**含本地统计基座**）——批次边界干净：本批只做数据基座+快赢；C3 的远程配额链路另属待拍板 ①（分析 §1.2）。**注：上游分析认为本地统计链路不依赖该决策可先行（§1.2 表①前置列、§1.1 第 2 批「C3 本地基座可先行」）；本 Spec 收紧为本地基座与远程链路一并留待拍板后另批实施——这是规格的批次收紧决策，非上游原文口径**（理由：C1 本批已交付窗口级用量聚合，C3 本地基座的增量价值需与配额模型一并设计，避免同域两批口径漂移）。
2. **C6/C8**（会话状态信号/本地提醒）——消费面层后续批次（依赖关系：C8 依赖 C6 分类器）。
3. **C15**（LAN 手机只读镜像）——待拍板 ②（安全评审+用户决策前置）。
4. **C7/C10/C11/C12/C13/C14/C16**——后续批次/增强层/C14 先 spike 后立项（分析 §1.1 序列）。
5. **C4**（span 树重构+证据深链）——增强层批次；本批火焰图的下钻止于既有会话详情路由，不做 Timeline/Turns 标签重组。
6. **compaction 完整 diff**（消息全文对比）——C2 的 v2 明确不做（§2.2 需求 6）。
7. **既有视图空态的全量改造**——C9 本批交付组件+第一例（transcript）+本批新增视图（usage/attribution/context-gauge 空态）接线；既有其余视图空态改造随消费面批次。
8. **`ROW_ANIMS` 9 行动画契约/桌宠行为/壳（shell/）改动**——本批不涉。
9. **`sessionTurns` 返回形状变更**——会话粒度能力 WP2 已交付，本批纯增量（§2.0）。
10. **新增运行时依赖/图表库**——约束重申（§4）；火焰图零图表库。

---

## 4. Global Constraints（硬红线全文，违反任何一条＝返工）

1. **只在 `F:/project/zcode-monitor-plan`（分支 `feature/ecosystem-round2-batch1`）内改动**；`F:/project/zcode-monitor` 主仓与 `C:/Users/18086/.zcode` 一律只读（测试用 `os.tmpdir()` fixture，绝不触碰真实库；对 `~/.zcode/` 零写入，唯一例外仍是既有 WAL 折叠白名单，本批不触碰）。
2. **每条新 SQL 必须命中 `started_at` 索引或 rowid 尾界**；行数参数一律经 `clampLimit`/`clampAtLeast`（server/http-hardening.js）钳界；**禁止事件循环长阻塞**（better-sqlite3 是同步 API；历史事故：tasklist 同步探测 5-7s、message 全表扫描 2.4s、负 LIMIT 整表物化 8.8s——同类模式视为回归）。
3. **运行时依赖零新增**（express + better-sqlite3 之外禁引包）；前端无构建（vanilla JS/CSS；双主题走 `:root[data-theme]` 与 `--chart-*` 变量；语义色复用 severity ok/warn/err 不发明新色；数字 tabular-nums；风格对齐既有 `views/*.js`）。
4. **子进程调用系统控制台程序必须 `windowsHide: true`**（本批原则上不新增子进程调用；如引入，照 zcode-runtime.js:64-69 红线）。
5. **行为变更必带回归测试**（node:test + tmpdir fixture，跟随既有 `test/*.test.js` 模式；新测试文件放入 `test/` 即被 `test/index.js` 自动发现，无需手工登记）。
6. **不运行 git 提交**（脚本统一提交）；**不改与本任务无关的文件**；**不删除文件**（文件系统删除走治理通道，本批无删除需求）。
7. **全套测试由脚本统一运行**；实施者可自跑单文件：`cd F:/project/zcode-monitor-plan && node --test test/<file>.test.js`。
8. **验收无法满足或指令矛盾时如实上报（escalate），不要伪造通过**。

---

## 5. 逐候选验收标准

> 标注法：`[测试]`（node:test 用例，tmpdir fixture）、`[命令]`（可直接执行命令与期望输出）、`[评审]`（人工评审留痕）。EXPLAIN 命令模板（真实库只读，仓库根执行）：

```bash
node -e "
const dbq = require('./server/db');
const since = Date.now() - 86400000; // 或 30*86400000 验 30d 档
const sql = '<待验证 SQL，参数以字面量内联>';
console.log(dbq.db().prepare('EXPLAIN QUERY PLAN ' + sql).all());
console.time('q'); dbq.db().prepare(sql).all(); console.timeEnd('q');
"
```

通过判据：EXPLAIN 输出**不含对任何表的 `SCAN`**（`SEARCH ... USING INDEX` 或 rowid 尾界命中；GROUP BY 的 TEMP B-TREE 允许——overviewKpis 先例 usage-accounting.md §6），计时照录验收记录。

### C1 窗口级回合与工具统计

- **C1-1** `[测试]` Given fixture 库构造 turn_usage/tool_usage 行跨 24h 窗内外（started_at 现在减 1h 与减 3 天各若干），When 分别请求 `/api/usage/turns?window=24h` 与 `?window=7d`，Then 24h 只聚合窗内行、7d 含 3 天前行；`?window=999d`（未知值）回退 24h（响应 `window` 字段如实回显 `'24h'`，对齐 overview.js 先例）；`?window=30d` 可用——并构造 started_at=now-31d 的边界行，断言 30d 档**不计入**（30d=完整保留窗，窗边界语义钉，防档位映射错位）。**窗口断言（999d 回退 + 30d 可用含边界行）以表驱动覆盖本族三端点（turns/tools/attribution）**——共享 helper 的行为一致性验收（§2.1 需求 3 机制钉的对偶面）：逐端点内联且值域漂移（误收 today、30d 误解析）的实现不得通过。
- **C1-2** `[测试]` Given fixture 构造已知值行（含 error turn、retry>0、tool_error>0、model_request_count>0、time_to_first_token_ms 已知、context_exceeded=1、error_type='api_error'），When `GET /api/usage/turns?window=24h`，Then totals 逐项与构造值相等（turns/completed/errors/cancelled/model_requests/retries/tool_errors/avg_ttft_ms/context_exceeded），`by_error_type` 含 `api_error` 计数；响应 `meta.retention_days === 30` 且 `since` 为 ISO 时间。两分支钉：① 另一窗口（或会话分组）turn 的 time_to_first_token_ms 全 NULL 时 `avg_ttft_ms === null`（SQLite AVG 全 NULL 语义，不伪造 0；前端经共享 formatter 显示 `—`，与 C9-5 未知值原则对齐——model_usage 侧 ttft NULL 实测 22.1%，turn 侧 NULL 非罕见路径）；② 构造 ≥6 种 error_type（计数递减）时分布恰含 Top 5、第 6 名被裁且截断如实标注（§2.1 需求 1 的诚实截断义务验收面）。
- **C1-3** `[测试]` Given fixture 构造两工具行（Bash 完成 900ms/output 120B/read_only=0/destructive=1/approval 'none'；Read 错误 50ms/read_only=1/destructive=0/approval 'denied'——approval 多值分布构造，7d 实测存在 'denied'），When `GET /api/usage/tools?window=24h`，Then 按 tool_name 分组行逐项相等（calls/errors/成功率/avg_ms/max_ms/output_bytes/`read_only` 分布 `{ro:1,rw:1}` 形态/`destructive` 分布 `{1:1,0:1}` 形态/`approval` 分布 `{none:1,denied:1}` 计数值）；响应 `meta.retention_days === 30` 且 `since` 为 ISO 时间（与 C1-2 对 turns 的同款 meta 断言对称——口径标注义务覆盖本族全部端点）。
- **C1-4** `[测试]` Given fixture turn 行 ≥3 条，When `GET /api/usage/turns?window=24h&limit=2`，Then 时间线恰返回 2 行且新→旧；`?limit=-1` 钳 1（负 LIMIT 整表物化事故形态回归守护）；`?limit=99999` 钳上限 **500**（缺省 100/上限 500，§2.1 需求 3 拍板值）。时间线行含 turn_id/session_id/started_at(ISO)/duration_ms/time_to_first_token_ms/status/model_retry_count/tool_error_count/error_type/context_exceeded/computed_total_tokens。
- **C1-5** `[测试]`（源码契约，frontend-contract.test.js 形态）Given 实施完成，When 读 `public/index.html` 与 `public/views/usage.js` 源码，Then index.html nav 含 `data-view="usage"` 条目与 `<script src="/views/usage.js">`；usage.js 含 `registerView('usage'`、空态调用命中正则 `/(window\.)?ZC\.emptyState\(/`（显式正则钉入测试，不留「或等价引用」的判定空间）、30 天标注文案「30 天」；usage.js 不含硬编码色值字面量（判据同 C5-3：`#[0-9a-f]{3,6}`、`rgba?(`、`hsla?(` 与具名色名单 0 命中——色值仅允许经 `cssVar(` 读取）；usage.js 不含「pending」「待批」字样（§2.1 需求 2 禁令的 UI 层钉）；且 `server/routes/usage.js` 存在、index.js 含 `app.use('/api/usage'` 装配；routes/usage.js 中窗口解析具名函数仅一处定义（如 `function resolveWindow` 的 grep 计数=1）——共享 helper 的源码契约钉，与 C1-1 三端点表驱动互为犄角。
- **C1-6** `[命令]` Given C1 新增的每条 SQL（turn 聚合/时间线/tool 分组），When 在真实库按上文模板执行 `EXPLAIN QUERY PLAN` + 计时（24h 与 30d 两档），Then 计划无 `SCAN <table>`、计时照录；30d 档实测数字与「是否加规模钳制/收窄档位」的决策记录**必须存在**（无记录即不通过——与 C5-5 同款措辞，可判定物是照录的数字与决策，不是主观「够快」）；其中 30d 档实测 **>500ms** 时，决策记录还须附取舍理由（500ms 为本 Spec 拍的可判定触发线——事件循环风险锚点 2.4s 的一半以下即进入须论证区，低于 500ms 时「不加钳制」一句决策即可）。
- **C1-7** `[命令]` Given 实施完成，When 执行 `grep -n "30 天" public/views/usage.js public/views/attribution.js public/views/how.js`，Then 三文件均命中（30 天保留窗口口径在本批全部窗口级视图与 How 页声明；attribution 与 usage 同负口径标注义务；how.js 今日基线 0 命中，本会话实测）；When 以 7399 冒烟实例（`PORT=7399 OPEN_BROWSER=0 npm start` 后）执行 `curl -s http://127.0.0.1:7399/api/usage/turns?window=24h`，Then 响应 JSON 含 `"retention_days":30`（7331 可能是用户在跑的实例，勿动——冒烟一律 7399，起服前后 `netstat -ano | grep 7399` 确认端口干净）。
- **C1-8** `[命令]` Given 实施完成，When 执行 `grep -n "queryTaskUsage 增量口径（C1 增补）" docs/usage-accounting.md` 与 `grep -n "queryTaskUsage" public/views/how.js`，Then 前者命中新增小节标题、后者命中（本会话实测两 grep 今日基线均为 0 命中——how.js 无 queryTaskUsage、无「30 天」；usage-accounting.md 无该小节标题——命中即增量证据）。
- **C1-9** `[测试]` Given 空 fixture 库（或窗内无行——新库是 `/api/usage/*` 首次部署的真实形态），When 分别请求 `/api/usage/turns?window=24h` 与 `/api/usage/tools?window=24h`，Then 两端点均返回 200、totals 全零/timeline 与 groups 为空数组、meta（window/since/retention_days）完整且不抛错（与 C5-1 对 attribution 的空窗口钉同款义务）。

### C2 上下文水位体系

- **C2-1** `[测试]` Given `server/models-meta.js`，When require 并查已知 model_id，Then 返回 `{context_tokens, max_output_tokens}` 数值；查未知 id 返回 `null`；文件头注含「非官方权威」声明与 zcode-api 许可证纪律（只取数值不复制文本）；每条数值带出处标注（已核对 zai-org 源码常量的注明出处，未核实的注明 unverified）。
- **C2-2** `[测试]` Given fixture 构造会话 s1 的 model 行序列（input 递增 3 行 + 1 行 `query_source='compact'` + 1 行 input=0/cache_creation=100/cache_read=50 的 error 行），When `GET /api/sessions/s1/context-gauge`，Then 行序 started_at ASC、compact 行带边界标记、行含 model_id/context_tokens（路由层 models-meta resolve 附带，§2.2 需求 2 通路）/input_tokens/cache_read/cache_creation/turn_id；行数 `?limit=` 经 clampLimit（`?limit=-1` 钳 1、`?limit=99999` 钳 **500**——缺省 100/上限 500，§2.2 需求 3 拍板值）；**截断方向**：注入小 limit（如 3）+ s1 序列 >3 行时返回的恰为最新 3 行且行序仍 ASC（首行恰为截断窗外最旧行——默认 5 行构造测不出方向，故注入小 limit 钉「取最新端」，§2.2 需求 2）。
- **C2-3** `[测试]` Given context-gauge 纯函数（双端导出模块 node 侧 require）与 C2-2 的序列 + models-meta 窗口 200000，When 计算水位序列，Then 占用比=input/200000 逐行正确；**input=0 行回退 (cache_creation+cache_read)/200000**（§2.0 勘误口径的执行证据）；compact 边界前后水位回落值=前后两行占用差；models-meta 未命中 → 占用为 null/unknown 态（**不显示百分比**）；增量曲线值=相邻行 input 差（compact 后为负）。
- **C2-4** `[测试]` Given fixture 两会话各带不同 model_id 的最新 model 行，When `GET /api/sessions`，Then 响应每会话含最新行的 `model_id`、`input_tokens` 与 `context_tokens`（路由层经 models-meta resolve 附带，未知模型→null；取 rowid 最大行，非 MAX(input)——fixture 构造一行「更晚但 input 更小」的行守护此语义）；另构造一会话**无任何 model 行**，Then 该会话三字段均为 null（字段存在值为 null，非缺字段）且源码契约：sessions.js renderList 对其不渲染 mini 条（空数据形状钉死，不留实施歧义）；renderList 渲染 mini 水位条且未知模型（context_tokens=null）不渲染百分比（mini 条位于既有文件 sessions.js 的新增段，全文色值 grep 不适用于既有文件——其双主题视觉验证走 C2-9 截图留痕；新文件 usage.js/context-gauge.js/attribution.js 的全文色值断言见 C1-5/C2-5/C5-3）。
- **C2-5** `[测试]`（源码契约）Given 实施完成，When 读 sessions.js renderContext 与 public/context-gauge.js，Then Context 标签水位区含：live 水位条（订阅 `/api/live/events` 的 model 行）、逐轮增量曲线、compaction 边界竖线、水位回落摘要四要素的渲染代码；水位区对空序列（会话无 model 行）经 `/(window\.)?ZC\.emptyState\(/` 命中的调用渲染（空态出口钉死，同 C1-5 正则形态）；context-gauge.js 不含硬编码色值字面量（判据同 C5-3/C1-5：`#[0-9a-f]{3,6}`、`rgba?(`、`hsla?(` 与具名色名单 0 命中——色值仅允许经 `cssVar(` 读取，§6 风格约束的可机检面）；`public/index.html` 含 `<script src="/context-gauge.js">`（单一可机检形态——该文件在 public/ 根，与 empty-state.js 同层同款引入路径约定，不留「或经既有 script 机制」的判定空间）。
- **C2-6** `[测试]` Given fixture 当日行（input 1000/cache_read 400），When `GET /api/widget/today`，Then 响应含 `input_tokens: 1000`、`cache_read_tokens: 400`、`cache_hit_rate: 0.4`（比率响应侧算好，widget 纯渲染；与既有速度口径 `tokens` 字段并存、命名不混淆）；另构造当日全为 input=0 的 error 行，Then `input_tokens === 0` 时 `cache_hit_rate === null`（零分母语义钉死，§2.2 需求 4——禁止 NaN/Infinity）；源码契约：widget.html `.tip` 渲染「缓存命中」副行，null 时显示「—」（共享 formatter null 语义）。
- **C2-7** `[测试]`（源码契约）Given 实施完成，When `grep -rn "text/event-stream" server/`，Then 命中数仍为 2（live.js:29 与 index.js:222；本会话实测基线）——不加新 SSE 通道的契约钉。
- **C2-8** `[命令]` Given C2 新增 SQL（context-gauge 序列查询、sessionList 最新行扩展查询），When 真实库 EXPLAIN + 计时，Then 序列查询 `SEARCH ... USING INDEX`（session 复合索引）、sessionList 扩展两段均索引寻址、无 `SCAN`，计时照录。
- **C2-9** `[评审]` models-meta 数值与 zai-org/ZCode 源码模型常量的逐条核对记录（§9-8 销账路径：能核对的注明源码出处文件/常量，不能的标 unverified）；UI「非官方权威」标注形态（hover/徽章）双主题截图留痕；sessions 列表 mini 水位条、**Context 标签水位区（live 条+增量曲线+compact 竖线+回落摘要，含未知模型不显百分比态与 compact 回落摘要态）**与 widget hover 卡「缓存命中」副行双主题各一帧截图（mini 条另含未知模型不显百分比帧、副行含 `—` 空态帧——三者中 mini 条/水位区在既有文件 sessions.js 新增段、全文色值 grep 不适用既有文件，故走截图留痕；水位区是本批最复杂新 UI，与 mini 条同通道不豁免；§6 适用注第 1/3/4/5 条）；水位「随已落库请求推进、生成中不跳动」的口径说明文案评审。

### C5 Token 归因火焰图

- **C5-1** `[测试]` Given fixture 两会话各带已知 token/耗时行，When `GET /api/usage/attribution?window=24h`，Then `level=session` 返回按 tokens 降序的会话聚合行（tokens=SUM(computed_total_tokens)、duration_ms_sum、calls、by_query_source 分解、session 标题），数值与构造相等，且响应 `meta.retention_days === 30`、`since` 为 ISO 时间（口径标注义务，与 C1-2/C1-3 同款断言）；`?level=turn&session_id=s1`（s1 另造两 turn 已知 token/duration/model_calls/tool_calls）返回逐 turn 行**逐项与构造值相等、按 token 降序**（turn 层与 session 层同深度断言，不留只验形状不验数值的浅通道）；空窗口（`?window=24h` 且 fixture 无窗内行）返回空数组+meta 不抛错。
- **C5-2** `[测试]` Given fixture 构造会话数 > limit 上限的场景（或注入小 limit），When `?limit=1`，Then 仅返回 top1 行且 `meta.truncated` 如实标注（诚实截断，不静默）；`?limit=-1` 钳 1。
- **C5-3** `[测试]`（源码契约）Given 实施完成，When 读 public/views/attribution.js 与 index.html，Then registerView('attribution' 注册 + nav/script 引入；火焰图渲染为 SVG 或 div 嵌套宽度布局且**不含 Chart.js 调用**（无 `registerChart`/`new Chart`）；色值经 `cssVar('--chart-` 读取，无硬编码色值字面量——`#[0-9a-f]{3,6}`、`rgba?(`、`hsla?(` 三类函数记法与 CSS 具名色名单（`red|orange|yellow|lime|green|teal|cyan|blue|violet|purple|magenta|pink|brown|gray|grey|silver|white|black|gold` 作单词边界匹配）均不出现在该文件（CSS 变量引用除外）；含「30 天」标注文案（口径义务的视图层钉，C1-7 grep 的第三文件）。
- **C5-4** `[测试]`（源码契约）Given 实施完成，When 读 attribution.js，Then hover 载荷（title/data-* 属性承载 token/耗时/占比三值）与下钻链接（session 层帧 → `#sessions/<id>`、turn 层帧 → `#sessions/<id>/turns`）存在；空态经 `ZC.emptyState(` 渲染。
- **C5-5** `[命令]` Given attribution 两级 SQL，When 真实库 EXPLAIN + 计时（24h/7d/30d 三档），Then 无 `SCAN`（TEMP B-TREE 分组允许）、计时照录；30d 档（≈40 万行聚合）的实测数字与是否加规模钳制/收窄档位的取舍记录**必须存在**（无记录即不通过——本条的可判定物是照录的数字与决策，不是主观「够快」）；30d 档实测 **>500ms** 时决策记录还须附取舍理由（**与 C1-6 同款触发线，两族共用同一判据**——本条聚合量级不小于 C1，判据从宽无理由）。
- **C5-6** `[评审]` 火焰图双主题截图（hover 态 + 下钻后会话详情）留痕；宽度占比与 C5-1 fixture 数值的手工核对记录。

### C9 数据新鲜度恒显与空态诚实化

- **C9-1** `[测试]` Given fixture 库插入 started_at=now-10min 的 model 行与 mtime=now-40min 的当日日志文件（按 `defaultTodayFile()`「名字最新」语义构造——LOG_DIR 内名字最新的 `zcode-YYYY-MM-DD.jsonl`，非 UTC 日期映射；测试自洽须与生产读路径同函数，避免用 `todayLogFile` 同名构造恰好掩盖生产误报），When 挂载 health 路由并 GET `/api/health`，Then `freshness.db.lag_ms ≈ 600000 ± 30000`（构造到断言间的时钟流逝容差 ±30s）且档位 warn（5min 阈）、`freshness.jsonl.lag_ms ≈ 2400000 ± 30000` 且档位 err（30min 阈）；started_at=now-1min → ok；档位归属 `>=`（含等值）两用例：注入小阈值（如 warn=100ms/err=200ms）构造 started_at=now-150ms → warn、now-250ms → err，另以恰等于阈值的行钉含等值语义；库无行/日志无文件 → 对应字段 null（诚实空态，不伪造 0）。阈值常量可注入（小值可测）。
- **C9-2** `[测试]`（源码契约）Given 实施完成，When 读 index.html 与 app.js，Then 顶栏存在 freshness chip 元素；healthLoop 渲染「数据落后」文案与 severity 档位类；分档判定不在前端——可执行判据：`grep -nE '300000|300_000|1800000|1_800_000|5\s*\*\s*60\s*\*\s*1000|30\s*\*\s*60\s*\*\s*1000' public/app.js` 应 0 命中（分档阈值 5min/30min 的字面量与乘式变体；**不含** 60000——<60s→秒、>60s→分钟、>1h→小时是前端显示格式化阈值（§2.4 需求 2），属 app.js 合法字面量，判定与显示分离）。
- **C9-3** `[测试]` Given `public/empty-state.js`（双端导出），When node 侧 require 并调用 `emptyState('transcript.jsonl', '去 Context 看对话')`，Then 返回 HTML 字符串含 `transcript.jsonl` 与指引文本；源码契约：index.html 引入该文件、**该文件自身**（browser 分支）将 `emptyState` 挂上 `window.ZC`（双端导出文件自挂载，sanitize.js/pet-state.js 先例形态——单一形态钉死，不留「app.js 或该文件」二选一）；app.js 不含 `window.ZC.emptyState =` 赋值（挂载责任单点）。
- **C9-4** `[测试]`（源码契约）Given 实施完成，When 读 timeline.js found:false 分支，Then 经 `emptyState` 渲染且文案区分两情形——主会话（interactive）保留「本就无 transcript、去 Context」语义；其余会话含「已停写 transcript.jsonl」字样（grep「已停写」命中）；判型数据来自 `/api/sessions/:id`（task_type）。
- **C9-5** `[评审]` 本批新增全部数字位核查：未知/缺失值一律 `—`（共享 formatter null 语义）或 unknown 态，无捏造数值路径；models-meta 未命中时水位组件不显示猜测百分比（与 C2-3 联动抽查）；顶栏 chip 在「ZCode 已停写」实况下的真机截图（数据落后读数与 zcode_running 并读呈现）**双主题各一帧**（§6 适用注第 1/3 条对 chip 的视觉留痕）；emptyState 组件双主题截图一帧（首例 transcript 场景）。

### 全局

- **GX-1** `[命令]` Given 全部实施完成，When 在 `F:/project/zcode-monitor-plan` 运行 `npm test`（node --test 聚合入口），Then 退出码 0、0 failed（含本批新增测试文件与既有全套——`sessionTurns` 形状等既有契约守护随套继续绿，即 §2.0「纯增量」的回归证据）。
- **GX-2** `[命令]` Given 实施完成，When `node -e "console.log(Object.keys(require('./package.json').dependencies))"`（于 worktree 根），Then 输出恰为 `[ 'better-sqlite3', 'express' ]`（零新增——照第一轮 A0-6 同款命令）。

---

## 6. UI 风格约束（分析文档 §4 六条全文照录）

1. **双主题**：新视图/组件一律走 `:root[data-theme]` 双态 + `color-scheme` 联动；图表色经 CSS 变量 `--chart-*` 由 `getComputedStyle` 读取（主题切换自动重绘）——C5 火焰图、C10 热图/天际线、C2 水位条均按此实现，禁止硬编码色值。
2. **表面与文本栈**：卡片=surface-1+1px 边框+`--radius-lg 6px`（圆角克制 4/2/6px 档）；文本用 fg-1..fg-5 分层（fg-4 起保 AA≥4.5:1）；数字一律 tabular-nums。
3. **语义色复用**：新阈值带不发明新色——C3 配额 80%/95% 用 severity `warn #fbbf24`/`err #f87171`（浅色 #9a6700/#cf222e）；C2 上下文水位档位同理用 ok/warn/err 三档（与速度 tier <30/30-80/>80 三档约定同构）；C6 状态徽标用类目色+color-mix 8% 透明底模式。
4. **字体**：仪表盘 Geist/JetBrains Mono 栈、基准 13.5px/1.5；widget/pet 两页 Spectrum 子集（light-dark() 双态、Source Sans 3+Noto Sans SC）——**两页 token 子集保持完全一致**的现状纪律，C11 的 HUD/双环/边缘钉组件须同源双页复用一份实现。
5. **无构建约束**：全部新组件为 vanilla 模块（渲染函数或自定义元素），SVG 分享卡（C10）确定性客户端渲染、无 CDN 无外联；唯一既有外联 Google Fonts 维持 R-8 未决状态不扩大。
6. **CSP 自源**：C8 通知用内置 Notification/WebAudio API，不引入远程资源；C15 LAN 页同样受 CSP 自源钉死约束。

> 本批适用注：第 1/2/3/5 条直接约束 C1/C2/C5/C9 的全部新 UI（火焰图/水位条/mini 条/空态/新鲜度 chip）；第 4 条约束 widget hover 卡改动（Spectrum 子集不扩）；第 3 条的 C2 水位三档与本 Spec C9-1 的 freshness ok/warn/err 同构——阈值分档一律复用 severity，不发明新色带。C6/C10/C11/C15 字样为上游原文照录的后续批次适用项。

## 7. 测试要求

1. **行为变更必带回归测试**：每条候选至少一个新测试文件（建议：`test/usage-routes.test.js`（C1+C5 API/钳界/窗口回退）、`test/context-gauge.test.js`（C2 查询族+纯函数+sessionList 扩展+todayUsage 增列）、`test/models-meta.test.js`（C2 元数据模块）、`test/freshness.test.js`（C9 health 扩展+empty-state 模块）+ 既有 frontend-contract.test.js 形态的源码契约断言并入各文件；命名实施可调，覆盖面不变）。
2. **tmpdir fixture**：全部测试经 `ZCODE_DB`/`ZCODE_LOG_DIR` 等既有 env 注入指向 `os.tmpdir()` fixture（db.js:16-23 模式），绝不触碰真实库；fixture DDL 增补——`turn_usage` 加 `turn_usage_started_idx(started_at)`（真实库同名索引，usage-accounting.md §1；fixture 现缺，C1 窗口查询的 EXPLAIN 形态测试需要）；引用官方列而 fixture 缺列时（如 tool_usage 的 `destructive`/`time_to_first_output_ms`）按官方 schema 增补（WP0 既有约定：fixture 以 db.js 现行查询所假设列集为准）。
3. **测试与 cwd 无关**：被测模块路径一律 `__dirname`/env 注入（既有约定）；源码契约测试读文件用绝对路径拼接（frontend-contract.test.js:15 形态）。
4. **真实库只读实测仅限 [命令] 条目**：EXPLAIN+计时在真实库执行时必须只读、带 started_at 下界（或 rowid 尾界），输出照录验收记录；**不得**为测试目的向真实库写入任何内容。
5. **全套测试由脚本统一运行**（GX-1）；实施侧自跑单文件命令：`cd F:/project/zcode-monitor-plan && node --test test/<file>.test.js`。

## 8. 验收与交付顺序（摘要）

| 序 | 内容 | 出口判据 | 依赖 |
|---|---|---|---|
| 1 | C9 快赢（freshness+emptyState+第一例） | C9-1~5 | 无（先行，为 C1/C5 新视图提供空态出口） |
| 2 | C1 查询族+路由 | C1-1~4, C1-6, C1-9 | 无 |
| 3 | C1 视图+文档 | C1-5, C1-8, C1-7 的 usage.js/how.js 部分 | C1 路由、C9 组件 |
| 4 | C5 火焰图（搭 C1 顺风车） | C5-1~6, C1-7 的 attribution.js 部分 | C1 查询族 |
| 5 | C2 水位体系 | C2-1~9 | models-meta 先行，组件两消费面 + widget 数据面扩展随后 |
| 6 | 全局收口 | GX-1~2 | 全部 |

> 表注：C1-7 是三文件 grep，其三个目标文件分属序 3（usage.js/how.js）与序 4（attribution.js）交付物——出口判据按文件归属拆分如上，**C1-7 的完整通过时点在序 4 之后**；各序出口以本行所列条目/部分判定，不要求跨序提前满足。
