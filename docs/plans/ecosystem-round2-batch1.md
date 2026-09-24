# 生态采纳第二轮第一批实施计划（ecosystem-round2-batch1）

> **状态：待实施**（2026-09-25 起草）。本计划把 `docs/specs/ecosystem-round2-batch1.md`（31 条验收）拆成 7 个有序任务；每任务一个 commit（**由编排脚本统一提交，实施者不运行 git**），回滚单位即 commit。
>
> **For agentic workers:** 按本文 T1→T7 顺序逐任务执行，每任务完成其「完成判据」后即停，由脚本提交。步骤用 checkbox（`- [ ]`）跟踪。**实施者不运行 git commit/push、不删除文件、不改任务外文件。**

**Goal:** 在零新增运行时依赖、对 `~/.zcode` 零写入的前提下，交付第二批生态采纳四条：C1 窗口级回合/工具统计、C2 上下文水位体系、C5 Token 归因火焰图、C9 数据新鲜度恒显与空态诚实化——全部消费既有官方口径数据（turn_usage/tool_usage/model_usage），窗口级读数一律标注 30 天保留口径。

**Architecture:** 全部工作在 worktree `F:/project/zcode-monitor-plan`（分支 `feature/ecosystem-round2-batch1`，HEAD `aee89a9`，2026-09-25 本会话核实 clean）。分层数据流：L1 查询族（`server/db.js` 独立分节）→ 路由（`server/routes/usage.js` 工厂 + sessions.js 增端点）→ 视图/组件（`public/views/*.js` + 双端导出共享组件）。T1（C9）先行——`emptyState` 组件是 T4/T5/T7 新视图空态的统一出口；T2 建族（C1 与 C5 同基座一次建成）→ T3 三端点 → T4/T5 两视图切面并行面；T6/T7 为 C2 服务端/前端两段。

**Tech Stack:** Node ≥18（本机 v24）+ express + better-sqlite3（运行时依赖零新增，GX-2 守护恰为 `['better-sqlite3','express']`）+ `node:test`（tmpdir fixture）+ 原生 HTML/CSS/JS（无构建；双主题 `:root[data-theme]` + `--chart-*`/`--sev-*` 变量；数字 tabular-nums）。

**Spec:** `docs/specs/ecosystem-round2-batch1.md`（31 条验收：C1×9 / C2×9 / C5×6 / C9×5 / 全局×2；行号锚点以 worktree `c000375` 为准，正文引用以函数名/符号为准）。上游分析：`docs/analysis/ecosystem-scan-round2.md`（§1.1 第一批范围、§2.4 勘误、§9 未核实项）。执行者开工前必读这两份与本计划。

---

## Global Constraints（每任务隐含前提，违反任一条＝返工）

1. **只在 `F:/project/zcode-monitor-plan`（分支 `feature/ecosystem-round2-batch1`）内改动**；`F:/project/zcode-monitor` 主仓与 `C:/Users/18086/.zcode` 一律只读。测试一律 `os.tmpdir()` fixture（`ZCODE_DB`/`ZCODE_LOG_DIR` 等 env 注入，`test/helpers/fixture-db.js` 模式），绝不触碰真实库。
2. **每条新 SQL 必须命中 `started_at` 索引或 rowid 尾界**（真实库 18GB）；行数参数一律经 `clampLimit`/`clampAtLeast`（`server/http-hardening.js:83-91`）钳界；禁止事件循环长阻塞（better-sqlite3 同步 API；历史事故：message 全表扫 2.4s、负 LIMIT 整表物化 8.8s——同类模式视为回归）。
3. **运行时依赖零新增**；前端无构建（vanilla JS/CSS；双主题走 `:root[data-theme]` 与 `--chart-*` 变量；语义色复用 severity `ok/warn/err` 不发明新色；数字 tabular-nums；风格对齐既有 `views/*.js`）。
4. **子进程调用控制台程序必须 `windowsHide: true`**（本批原则上不新增子进程调用；如引入，照 `server/zcode-runtime.js:64-69` 红线）。
5. **行为变更必带回归测试**（node:test + tmpdir fixture，跟随既有 `test/*.test.js` 模式；新测试文件放入 `test/` 即被 `test/index.js` 自动发现，无需登记）。
6. **不运行 git 提交（脚本统一提交）**；不改与本任务无关的文件；不删除文件。
7. **全套测试（GX-1 `npm test`）与依赖守护（GX-2）由脚本统一运行**；实施者可自跑单文件：`cd F:/project/zcode-monitor-plan && node --test test/<file>.test.js`。
8. **真实库只读实测仅限 [命令] 条目**（EXPLAIN+计时须带 started_at 下界或 rowid 尾界，输出照录验收记录），不得为测试目的写入真实库任何内容。
9. **验收无法满足或指令矛盾时如实上报（escalate），不伪造通过**；人工评审项（C2-9/C5-6/C9-5 截图类）按 human-gate 留痕格式处理：在 `docs/acceptance/*.md` 记「结论：待人工评审；已备复现步骤」——严禁虚构评审结论或截图。
10. **冒烟一律 7399**（起服前后 `netstat -ano | grep 7399` 确认端口干净）；7331 可能是用户在跑的实例，勿动；7399 冒烟同时刻至多一个执行者。

---

## 执行顺序与提交总览

| 序 | 任务 | 内容 | 依赖 | 提交主题（脚本用，实施者不跑 git） |
|---|---|---|---|---|
| 1 | T1 | C9 快赢：health freshness + 顶栏 chip + emptyState 组件 + transcript 空态第一例 | 无（先行，为 T4/T5/T7 视图提供空态出口） | `feat: C9 数据新鲜度恒显与空态诚实化——health freshness+顶栏 chip+emptyState+transcript 第一例` |
| 2 | T2 | L1 usage-attribution 查询族（C1+C5 同基座一次建族）+ fixture DDL 增补 + 真实库 EXPLAIN | 无（可与 T1 并行，文件不相交） | `feat: L1 usage-attribution 查询族——窗口级 turn/tool 聚合与归因两级下钻（db.js 新分节）` |
| 3 | T3 | 路由 `server/routes/usage.js` 三端点 + index.js 装配 | T2 | `feat: /api/usage 三端点——turns/tools/attribution+共享窗口 helper+30 天保留口径` |
| 4 | T4 | C1 视图 + 文档（usage.js / how.js / usage-accounting.md） | T1、T3 | `feat: C1 回合与工具视图与 30 天口径文档——usage.js+how+accounting 增补` |
| 5 | T5 | C5 视图（attribution.js 火焰图） | T1、T3（C1-7 完整通过时点在本任务后） | `feat: C5 Token 归因火焰图——attribution.js 零图表库嵌套宽度布局` |
| 6 | T6 | C2 服务端：models-meta + context-gauge 查询族 + 端点 + sessionList/todayUsage 扩展 | 无强依赖（db.js 与 T2 相交，**必须排在 T2 之后**） | `feat: C2 上下文水位服务端——models-meta+context-gauge 查询族+端点+列表与今日用量扩展` |
| 7 | T7 | C2 前端：context-gauge 组件 + 会话两消费面 + widget 缓存命中副行 | T1、T6 | `feat: C2 上下文水位前端——context-gauge 组件+mini 条+Context 水位区+widget 副行` |

- **文件相交与顺序**：`public/index.html` 被 T1→T4→T5→T7 依序触碰（每次只加自己的 nav/script 行）；`server/db.js` 被 T2→T6 依序触碰（各自独立分节，互不改对方段）；`server/index.js` 仅 T3 触碰；`docs/acceptance/round2-batch1-explain-timing.md` 被 T2 建、T6 追加。其余文件两两不相交。
- **可并行对**（仅文件面，门禁/冒烟不并行；清单非穷尽，判定标准＝文件不相交且「执行顺序与提交总览」依赖列无先后，编排可自行推导）：T1∥T2、T1∥T3、T3∥T6、T4∥T6、T5∥T6。
- **回滚**：每任务一 commit；相交文件使 revert 必须**从新到旧**（先 T7 后 T6 …）；无持久化数据迁移，回滚后重启进程即恢复。

### 验收条目 → 任务映射

| 任务 | 覆盖验收条目 |
|---|---|
| T1 | C9-1、C9-2、C9-3、C9-4（C9-5 评审留痕归收口） |
| T2 | C1-6、C5-5 的 SQL 面与决策记录（EXPLAIN/计时/30d 取舍）；C1-2/C1-3/C5-1/C5-2/C1-9 的函数层数值钉 |
| T3 | C1-1、C1-2、C1-3、C1-4、C1-9、C5-1、C5-2 的 API 面；C1-5 的路由侧契约；C1-7 的 7399 冒烟 |
| T4 | C1-5 视图侧契约、C1-7 的 usage.js/how.js 部分、C1-8 |
| T5 | C5-3、C5-4；C1-7 的 attribution.js 部分（三文件 grep 终验）；C5-6 评审留痕 |
| T6 | C2-1、C2-2、C2-4 API 面、C2-6 API 面、C2-8 |
| T7 | C2-3、C2-4 前端契约、C2-5、C2-6 前端契约、C2-7；C2-9 评审留痕 |
| 收口（脚本） | GX-1、GX-2；C9-5/C2-9/C5-6 人工评审调度 |

---

## 文件结构总图（完成后新增/修改面）

```
zcode-monitor-plan/
├── docs/
│   ├── plans/ecosystem-round2-batch1.md        # 本文件
│   ├── usage-accounting.md                     # [T4] 新小节「queryTaskUsage 增量口径（C1 增补）」
│   └── acceptance/round2-batch1-explain-timing.md  # [T2 新建，T6 追加] 真实库 EXPLAIN/计时/30d 决策照录
├── server/
│   ├── db.js                                   # [T2] 新分节 ── Usage attribution ──；[T6] 新分节 ── Context gauge ── + sessionList/todayUsage 扩展
│   ├── health-route.js                         # [T1] freshness 对象（阈值注入可测）
│   ├── models-meta.js                          # [T6 新建] 静态模型元数据（纯数据模块）
│   ├── index.js                                # [T3] app.use('/api/usage', …)
│   └── routes/
│       ├── usage.js                            # [T3 新建] makeUsageRouter 工厂（turns/tools/attribution）
│       └── sessions.js                         # [T6] GET /:id/context-gauge + GET / 的 models-meta resolve
├── public/
│   ├── index.html                              # [T1] chip + empty-state.js；[T4] usage nav/script；[T5] attribution；[T7] context-gauge.js
│   ├── app.js                                  # [T1] healthLoop 渲染新鲜度 chip（判定全在服务端）
│   ├── empty-state.js                          # [T1 新建] 双端导出共享空态组件（自挂 window.ZC.emptyState）
│   ├── context-gauge.js                        # [T7 新建] 双端导出水位组件（纯函数+渲染）
│   ├── widget.html                             # [T7] .tip「缓存命中」副行（纯渲染）
│   └── views/
│       ├── timeline.js                         # [T1] found:false 分支经 emptyState 诚实化
│       ├── usage.js                            # [T4 新建] 「回合与工具」视图
│       ├── attribution.js                      # [T5 新建] 「Token 归因」火焰图视图
│       ├── how.js                              # [T4] 30 天窗口声明段 + queryTaskUsage 指引
│       └── sessions.js                         # [T7] renderList mini 条 + renderContext 水位区
└── test/
    ├── helpers/fixture-db.js                   # [T2] turn_usage_started_idx + tool_usage 补列
    ├── freshness.test.js                       # [T1 新建]
    ├── usage-queries.test.js                   # [T2 新建]
    ├── usage-routes.test.js                    # [T3 新建]
    ├── usage-view.test.js                      # [T4 新建]
    ├── attribution-view.test.js                # [T5 新建]
    ├── models-meta.test.js                     # [T6 新建]
    ├── context-gauge.test.js                   # [T6 新建]
    └── context-view.test.js                    # [T7 新建]
```

---

## T1：C9 快赢——freshness + 顶栏 chip + emptyState 组件 + transcript 空态第一例

**目标**：`/api/health` 扩展 `freshness` 对象（db/jsonl 双源 lag + 三档判定，服务端判定、阈值注入可测）；顶栏常驻「数据落后 X」chip（前端只渲染）；新建共享空态组件 `window.ZC.emptyState`（双端导出、组件内转义）；第一例落地——timeline.js 的 transcript 空态按会话类型区分两情形诚实呈现。

**Files:**
- Modify: `F:/project/zcode-monitor-plan/server/health-route.js`
- Create: `F:/project/zcode-monitor-plan/public/empty-state.js`
- Modify: `F:/project/zcode-monitor-plan/public/index.html`
- Modify: `F:/project/zcode-monitor-plan/public/app.js`
- Modify: `F:/project/zcode-monitor-plan/public/views/timeline.js`
- Create: `F:/project/zcode-monitor-plan/test/freshness.test.js`

**遵循的既有模式（锚点）:**
- 工厂依赖注入：`makeHealthRoute({ dbq, runtime, runtimeState, dbPath, logDir })`（health-route.js:12-34）——新增 opts `freshnessWarnMs = 300_000`、`freshnessErrMs = 1_800_000`、`defaultTodayFile = require('./log-tail').defaultTodayFile`（默认值注入，小值可测——checkpoint-route 同款形态）。
- db lag 查询内联 prepare：health-route.js:16 `dbq.db().prepare('SELECT 1').get()` 先例；lag 用 `SELECT started_at FROM model_usage ORDER BY rowid DESC LIMIT 1`（rowid 尾界——`latestModelRowid` db.js:824-826 同款通道；无行→null）。
- jsonl 源：`log-tail.js` 的 `defaultTodayFile()`（log-tail.js:155-168，已随 module.exports 导出 log-tail.js:363-364）+ `fs.statSync().mtimeMs`。**禁用 `todayLogFile()`**（UTC 映射在本地 00:00-08:00 指向昨日停写旧文件，freshness 将每天误报 err 档 8 小时——log-tail.js:12-20 头注已定性）。
- 双端导出 UMD：`public/pet-state.js:8-11` 的 `(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.X = factory(); })` 形态；browser 分支**由组件文件自身**挂 `root.ZC = root.ZC || {}; root.ZC.emptyState = …`（挂载责任单点，sanitize.js 同思路）。
- 组件内转义：自带一份与 `app.js:51` `escapeHtml` 等价的实现（模块不可依赖 app.js 加载序）。
- chip 渲染：`healthLoop`（app.js:193-221）既有 parts 拼接模式旁新增 chip 更新；severity 色走既有 `--sev-*` 类。
- 测试挂载：`test/sessions-routes.test.js` 的 express `app.listen(0, '127.0.0.1')` + http.get helper 形态。

**实施要点:**
- freshness 形状：`freshness: { db: { lag_ms, level }, jsonl: { lag_ms, level }, zcode_running: <复用既有字段值> }`；`level ∈ 'ok'|'warn'|'err'|null`；**档位归属 `>=`（含等值）**：lag ≥ errMs → 'err'，≥ warnMs → 'warn'，否则 'ok'；无行/无文件 → 对应 `lag_ms: null, level: null`（诚实空态，不伪造 0）。
- 顶栏 chip：index.html 顶栏 `.meta`（index.html:43）旁新增元素（如 `<div class="meta freshness" id="freshness-chip" hidden></div>`）；app.js 渲染「数据落后 Xs/Xm/Xh」——<60s 显秒、>60s 显分钟、>1h 显小时（这三档是**显示格式化**阈值，与分档判定无关）；warn/err 加 severity 类；`freshness.db.level === null` 时 chip 隐藏或显「—」。**app.js 严禁出现 5min/30min 分档阈值字面量**（C9-2 grep 禁令：`300000|300_000|1800000|1_800_000|5*60*1000|30*60*1000`——60000/3600 显示阈值允许）。
- hover 口径说明：chip `title` 注明「生成中的长请求完成前不落库，lag 偏大属正常；与 ZCode 运行态并读」。
- empty-state.js：`emptyState(dataSourceLabel, hint)` 返回 HTML 字符串（空态卡片：数据源名 + 处置指引）；label/hint 一律转义后拼接，消费方无需自行转义；index.html 在 `/app.js` 之后、`/views/*.js` 之前引入 `<script src="/empty-state.js"></script>`。
- timeline.js found:false 分支（timeline.js:26-34）：经 `getJSON('/api/sessions/' + sessionId)` 取 `task_type` 判型——(a) `interactive`：保留「本就无 transcript、去 Context」语义（经 emptyState 渲染）；(b) 其余会话及判型失败兜底：明示「ZCode 已停写 transcript.jsonl（本机实测数据源退化）」而非静默空白（文案须含「已停写」）。

**测试（test/freshness.test.js）:**
- C9-1（行为）：fixture 插 `started_at = now-10min` 的 model 行 + LOG_DIR 写名字最新语义文件（如 `zcode-2999-01-01.jsonl`，mtime 设 `now-40min`——用比今天更晚的日期名保证 `defaultTodayFile()` 的「名字最新」选中它与 UTC/本地命名无关；测试与生产读路径同函数）→ 挂载 makeHealthRoute（runtime stub `{ walStatus: () => null }`、runtimeState stub）→ GET `/api/health` → `freshness.db.lag_ms ≈ 600000 ± 30000` 且 level `'warn'`、`freshness.jsonl.lag_ms ≈ 2400000 ± 30000` 且 level `'err'`；`now-1min` 行 → ok；注入 `freshnessWarnMs=100, freshnessErrMs=200` → `now-150ms` 行 warn、`now-250ms` 行 err、**恰等于阈值**（如 now-200ms 对 err=200）→ err（含等值钉）；空库+无日志文件 → 两源均 null。
- C9-2（源码契约）：index.html 含 chip 元素 id；app.js healthLoop 含「数据落后」渲染与 severity 档位类；对 app.js 执行 `grep -nE '300000|300_000|1800000|1_800_000|5\s*\*\s*60\s*\*\s*1000|30\s*\*\s*60\s*\*\s*1000'` 等价的正则断言 **0 命中**。
- C9-3（模块+契约）：node 侧 `require('../public/empty-state.js')` → `emptyState('transcript.jsonl', '去 Context 看对话')` 返回 HTML 含两段文本；`emptyState('<script>x</script>', …)` 输出中 `<script>` 已转义；契约：index.html 含 `<script src="/empty-state.js"`；empty-state.js 自身含 `ZC` 挂载代码（browser 分支）；app.js **不**匹配 `/window\.ZC\.emptyState\s*=/`。
- C9-4（源码契约）：timeline.js found:false 分支命中 `/(window\.)?ZC\.emptyState\(/`；文件含「已停写」；含 `/api/sessions/` 判型取 `task_type` 的调用。

**完成判据:** `cd F:/project/zcode-monitor-plan && node --test test/freshness.test.js` 退出码 0（C9-1~C9-4 全绿）；C9-5 截图类评审项按 Global Constraint 9 留痕待人工。

---

## T2：L1 usage-attribution 查询族（C1+C5 同基座一次建族）+ fixture DDL 增补

**目标**：`server/db.js` 新增独立 `── Usage attribution ──` 分节（不散插既有域），一次建成 C1（turn 聚合/时间线、tool 分组）与 C5（归因 session/turn 两级下钻）全部窗口级查询；fixture DDL 按官方 schema 增补；真实库只读 EXPLAIN+计时并落决策记录。

**Files:**
- Modify: `F:/project/zcode-monitor-plan/server/db.js`
- Modify: `F:/project/zcode-monitor-plan/test/helpers/fixture-db.js`
- Create: `F:/project/zcode-monitor-plan/test/usage-queries.test.js`
- Create: `F:/project/zcode-monitor-plan/docs/acceptance/round2-batch1-explain-timing.md`

**遵循的既有模式（锚点）:**
- 分节形态：db.js 既有 `── Overview ──`/`── Sessions ──` 等 929 行 8 分节（如 db.js:155、:497）；新分节置于 Agents tree 分节之前或之后，风格一致。
- 窗口查询：`overviewKpis`/`breakdownByTool`（db.js:171-318）全部 `WHERE started_at >= @since` + 命名参数；每条查询带 `// schema source: zai-org/ZCode MIG/USAGE/OBS` 出处注释（db.js:172-173 先例）。
- 官方口径：token 一律 `SUM(computed_total_tokens)`（db.js 头注 :164-167——官方预计算权威值，不自造公式）。
- 两段查询（attribution session 层补标题）：`sessionList` 的「先取页内 id、再 IN 寻址聚合」模式（db.js:515-534）。
- 截断探针：取 `LIMIT @limit + 1` 行，多出 1 行即置 truncated 并丢弃（避免额外 COUNT）。
- scale 钳制先例（仅当 30d 实测超线时启用）：`slowTools` 的 rowid 尾部 cap（db.js:771-794，`WHERE rowid > (SELECT MAX(rowid) FROM …) - @cap`）。

**新增查询函数（导出名可微调，语义钉死）:**
- `usageTurnsSummary(sinceMs)` → `{ totals: { turns, completed, errors, cancelled, model_requests, retries, tool_errors, avg_ttft_ms, context_exceeded }, by_error_type: [ {type, count} × ≤5 ], by_error_type_truncated: bool }`——turn_usage 上 `WHERE started_at >= @since`；`SUM(model_request_count)`/`SUM(model_retry_count)`/`SUM(tool_error_count)`/`SUM(CASE WHEN context_exceeded=1 …)`/`AVG(time_to_first_token_ms)`（全 NULL → null，SQLite AVG 语义，不伪造 0）；error_type 分布 `GROUP BY COALESCE(error_type,'(none)') ORDER BY count DESC LIMIT 6`（取 6 探截断，返回前 5 + truncated 标记——诚实截断，不静默裁剪）。
- `usageTurnTimeline(sinceMs, limit)` → 新→旧行数组，每行含 `turn_id/session_id/started_at(ISO)/duration_ms/time_to_first_token_ms/status/model_retry_count/tool_error_count/error_type/context_exceeded/computed_total_tokens`（`ORDER BY started_at DESC LIMIT ?`，命中 started_at 索引；limit 由路由层钳界后传入）。
- `usageToolBreakdown(sinceMs)` → 按 `tool_name` GROUP BY 全量（真实库工具名为有限枚举，无 limit、无整表物化风险）：`calls/errors/success_rate(JS: 1−errors/calls)/avg_ms(仅 completed——计划口径拍板：错误行时长不代表健康耗时；规格 §2.1 需求 1 AVG(duration_ms) 未限定行集，此处收紧、作为计划对规格的口径细化记录在案)/max_ms(仍全行——极端值含错误行)/output_bytes` + `read_only` 分布 `{ro, rw}` + `destructive` 分布 `{0: n, 1: n}`（值→计数，与 read_only 同形态）+ `approval_status` 分布（值→计数；**只呈现值域，不赋 pending 语义**——7d 实测 160,827 'none' + 1 'denied'，该列只记终态）。
- `usageAttributionBySession(sinceMs, limit)` → 两段：① `GROUP BY session_id` 按 `SUM(computed_total_tokens) DESC LIMIT @limit+1`（tokens/duration_ms_sum=SUM(duration_ms)/calls）；② 对页内 id `GROUP BY session_id, query_source` 组装 `by_query_source`（五值域 subagent/main_turn/workflow_child/compact/session_title）；③ 页内 id 从 session 表 IN 寻址补 `title`。
- `usageAttributionByTurn(sessionId, limit)` → `WHERE session_id = ?`（session 复合索引寻址，会话内天然小集合）`GROUP BY turn_id`，按 token 降序，行含 token/耗时/model_calls/tool_calls，`LIMIT @limit+1` 探截断。

**fixture DDL 增补（test/helpers/fixture-db.js）:**
- `CREATE INDEX turn_usage_started_idx ON turn_usage(started_at)`（真实库同名索引，usage-accounting.md §1；fixture 现缺——EXPLAIN 形态测试需要）。
- `turn_usage` 加 `PRIMARY KEY (session_id, turn_id)`（**镜像真实库主键**——usage-accounting.md §1 实测记载「主键 (session_id, turn_id)」，fixture 现无任何 turn_usage 主键/索引；`usageAttributionByTurn` 的 `WHERE session_id = ?` session 寻址路径在真实库即靠该主键，fixture 不加则本条 SQL 的 EXPLAIN 形态测试（下「EXPLAIN 形态」条「不含对基表的 SCAN」）确定性失败、实施者被迫未经授权临时加 DDL 或放松判据——与 C5-5 真实库验收脱钩）。
- `tool_usage` 增列 `destructive INTEGER`、`time_to_first_output_ms INTEGER`（官方 schema 列，WP0 约定：fixture 以 db.js 现行查询所假设列集为准，随查询扩列）。
- 不改既有列/索引名（既有 24 个测试文件依赖——2026-09-25 修复轮本会话 `ls test/*.test.js` 实测）。

**测试（test/usage-queries.test.js，db 层直测 + fixture EXPLAIN）:**
- 窗口语义：构造 started_at = now-1h / now-3d / now-31d 三组行 → 各函数 24h/7d/30d 三档聚合边界正确（31d 边界行不计入 30d 档——30d=完整保留窗的窗边界语义钉）。
- C1-2 数值钉：构造 error turn、retry>0、tool_error>0、model_request_count>0、ttft 已知、context_exceeded=1、error_type='api_error' → totals 逐项与构造值相等；另一窗口全 NULL ttft → `avg_ttft_ms === null`；≥6 种 error_type（计数递减）→ 恰 Top 5 + truncated=true。
- C1-3 数值钉：Bash（完成 900ms/output 120B/read_only=0/destructive=1/approval 'none'）与 Read（错误 50ms/read_only=1/destructive=0/approval 'denied'）→ 分组行逐项相等（含三个分布对象形态；**Read 组期望钉**：`avg_ms === null`——仅 completed 口径下组内无完成行，SQLite 全 NULL AVG 语义；`max_ms === 50`——全行口径）。
- C5-1 数值钉：两会话各带已知 token/耗时行 → session 层聚合值/降序/by_query_source 分解/标题；单会话两 turn 已知值 → turn 层逐项相等、按 token 降序。
- C5-2 截断：注入小 limit（如 1）→ 仅 top1 + truncated 标记。
- 空集稳健：空库（或窗内无行）全函数不抛错、totals 全零/null、数组为空（C1-9/C5-1 空窗钉的函数层）。
- EXPLAIN 形态（fixture 上）：对本族每条 SQL `EXPLAIN QUERY PLAN` 输出不含对基表的 `SCAN`（TEMP B-TREE 分组/排序允许）。

**真实库 [命令]（C1-6/C5-5，只读）:** 按 Spec §5 模板（仓库根 `node -e`，`dbq.db().prepare('EXPLAIN QUERY PLAN ' + sql)` + `console.time`，SQL 参数字面量内联、必须带 started_at 下界）对本族每条 SQL 跑 24h 与 30d 两档（**attribution 两级 SQL 按规格 C5-5 加跑 7d 档**——验收档位逐条对齐：C1-6 两档、C5-5 三档，防照录数字不齐）→ 计划无 `SCAN <table>`、计时照录 `docs/acceptance/round2-batch1-explain-timing.md`；**30d 档实测 >500ms 时必须给出取舍**（加 rowid 尾界 cap 或收窄档位）并附理由——无记录即不通过；≤500ms 时「不加钳制」一句决策即可。

**完成判据:** `cd F:/project/zcode-monitor-plan && node --test test/usage-queries.test.js` 退出码 0；EXPLAIN 记录文件存在、无 SCAN、30d 档实测数字与取舍决策记录在案（≤500ms 亦须「不加钳制」一句决策，无记录即不通过——与正文及 spec C1-6/C5-5 同强）；既有全套不受影响（GX-1 由脚本统一跑）。

---

## T3：路由 `server/routes/usage.js` 三端点 + index.js 装配

**目标**：新建 usage 路由（工厂形态、retention 常量注入可测），`GET /api/usage/turns|tools|attribution?window=`，窗口解析与响应 meta 抽为一处共享 helper，装配进 index.js 既有 `/api/*` 路由区。

**Files:**
- Create: `F:/project/zcode-monitor-plan/server/routes/usage.js`
- Modify: `F:/project/zcode-monitor-plan/server/index.js`
- Create: `F:/project/zcode-monitor-plan/test/usage-routes.test.js`

**遵循的既有模式（锚点）:**
- 可测路由工厂：`makeHealthRoute`（health-route.js:12）/ `makeErrorTranslator`（http-hardening.js:100）——`makeUsageRouter({ retentionDays = 30 })` 返回 express Router；index.js `app.use('/api/usage', makeUsageRouter())`（挂 index.js:171-177 既有 `/api/*` 路由区同款）。
- 行数钳界：`clampLimit(req.query.limit, 100, 500)`（sessions.js:48 先例同款二元组；helper 语义 http-hardening.js:83-91：负值钳 1、0/NaN 回落缺省、超上限钳 max）。turns 时间线 100/500；attribution 两级 50/200。
- **窗口解析 helper（共享，禁逐端点内联）**：本路由文件内具名函数 `function resolveWindow(q)` 仅一处定义（值域 `24h|7d|30d`，默认 24h、未知回退 24h——回退后响应 `window` 字段如实回显 `'24h'`，`server/routes/overview.js:8-18` 未知回退先例（窗口解析在**路由**文件——勿与 public/views/overview.js 同名视图文件混淆））；helper 注释**显式声明与 overview 的值域差异**（本族含 30d、不含 today；server/routes/overview.js 既有内联不动、不越界改既有路由）。
- 响应 meta：`{ window, since: ISO, meta: { retention_days } }`——`retention_days` 取注入常量（默认 30=本机实测值，非读取上游配置；`USAGE_RETENTION_DAYS` 是 ZCode 侧可配置项，本仓不读其配置文件）。

**实施要点:**
- `GET /turns?window=&limit=`：`{ window, since, meta, totals, by_error_type, by_error_type_truncated, timeline }`（timeline 行数 clampLimit 100/500）。
- `GET /tools?window=`：`{ window, since, meta, groups }`（全量工具名基数，无 limit 参数）。
- `GET /attribution?window=&level=&limit=&session_id=`：`level=session`（默认）或 `level=turn`；turn 层缺 `session_id` → 400 `{error:'bad_request'}`（本计划拍板：下钻必须有锚）；响应 `{ window, since, meta: { retention_days, truncated }, level, rows }`；空窗口 → 空数组 + meta 不抛错。
- 消费 T2 查询族；不在路由层重复聚合。

**测试（test/usage-routes.test.js，HTTP 层——express `listen(0)` + http.get，sessions-routes.test.js:44-64 形态；env 指向 tmpdir fixture 后 require）:**
- C1-1（表驱动）：三端点 × window ∈ {24h, 7d, 30d, 999d}——999d 回退 24h（响应 `window === '24h'`）；7d 含 3 天前行；30d 含 3d 行、**不含 31d 边界行**（共享 helper 行为一致性验收）。
- C1-2 / C1-3：turns totals 与 by_error_type、tools groups 逐项与 fixture 构造值相等；`meta.retention_days === 30`、`since` 为 ISO 时间（两端点对称断言）。
- C1-4：`?limit=2` → 时间线恰 2 行新→旧、行形状字段齐（turn_id/session_id/started_at/duration_ms/time_to_first_token_ms/status/model_retry_count/tool_error_count/error_type/context_exceeded/computed_total_tokens）；`?limit=-1` 钳 1；`?limit=99999` 钳 500。
- C1-9：空库（或窗内无行）→ 两端点 200、totals 全零/数组空、meta 完整。
- C5-1 / C5-2：attribution 两级数值与构造值逐项相等（turn 层与 session 层同深度断言）；attribution 响应 `meta.retention_days === 30` 且 `since` 为 ISO 时间（规格 C5-1 字面，与 C1-2/C1-3 同款断言——三端点对称，不留只验 turns/tools 的口径缺口）；`?limit=1` → top1 + `meta.truncated` 如实标注；`?limit=-1` 钳 1；空窗空数组+meta。
- 可注入性钉：`makeUsageRouter({ retentionDays: 7 })` 挂载 → `meta.retention_days === 7`（一例）。
- C1-5 路由侧源码契约：`server/routes/usage.js` 中 `function resolveWindow` 出现次数恰为 1；`server/index.js` 含 `app.use('/api/usage'`。

**[命令] 冒烟（C1-7 的 7399 部分）:** 起服前后 `netstat -ano | grep 7399` 确认端口干净 → `PORT=7399 OPEN_BROWSER=0 npm start`（worktree 根；7331 勿动）→ `curl -s http://127.0.0.1:7399/api/usage/turns?window=24h` 响应含 `"retention_days":30` → 停服并确认端口释放。

**完成判据:** `cd F:/project/zcode-monitor-plan && node --test test/usage-routes.test.js` 退出码 0；7399 冒烟 curl 命中 `"retention_days":30`；7331 未被触碰。

---

## T4：C1 视图 + 文档（usage.js / how.js / usage-accounting.md）

**目标**：新视图「回合与工具」（回合时间线 + 工具维度分档表，空态经 emptyState，30 天口径标注）；how 页补 30 天窗口声明与 queryTaskUsage 口径指引；usage-accounting.md 增官方增量口径小节。

**Files:**
- Create: `F:/project/zcode-monitor-plan/public/views/usage.js`
- Modify: `F:/project/zcode-monitor-plan/public/index.html`（nav 增 `data-view="usage"` 条目 + `<script src="/views/usage.js">`——追加在既有 views script 块 index.html:87-94 内）
- Modify: `F:/project/zcode-monitor-plan/public/views/how.js`
- Modify: `F:/project/zcode-monitor-plan/docs/usage-accounting.md`
- Create: `F:/project/zcode-monitor-plan/test/usage-view.test.js`

**遵循的既有模式（锚点）:**
- 视图 IIFE + registerView：sessions.js:4-5（`(function () { const { registerView, … } = window.ZC; … registerView('usage', view); })()`）。
- 回合时间线形态：sessions.js `renderTurns`（:388-404）——bar 宽=耗时占比、error 填 `var(--sev-err)`/cancelled 填 `var(--sev-warn)`、`.turn`/`.bar`/`.fill` 既有 class、mono 副行带 context_exceeded ⚠ 与 error_type。
- 表格形态：sessions.js `renderUsage`（:449-467）`.card tight` + `<table>` + `.num` 列（tabular-nums）。
- 窗口选择器：overview 视图的 `?window=` 切换形态（视图自带 24h/7d/30d 三档按钮，fetch `/api/usage/turns?window=` 与 `/api/usage/tools?window=`）。
- 空态：`window.ZC.emptyState(dataSourceLabel, hint)`（T1 组件）。
- null 呈现：`fmtNum(null)` → `'—'`（app.js:8-16 共享 formatter 契约）——`avg_ttft_ms` null 显 `—`。
- 色值禁令（本文件是**新文件**，全文适用）：无 `#[0-9a-f]{3,6}`、无 `rgba?(`/`hsla?(`、无具名色单词——颜色一律 `var(--*)`。

**实施要点:**
- 视图结构：窗口选择（24h/7d/30d）→ totals 卡片区（turns/completed/errors/cancelled/model_requests/retries/tool_errors/avg_ttft_ms/context_exceeded）→ error_type Top 5（truncated 时显「前 5（共 N 类被裁）」如实标注）→ 回合时间线（新→旧，行数=服务端 timeline）→ 工具分档表（成功率/平均耗时/最大耗时/字节/read_only/destructive/approval 分布列——**destructive 列必须展示**：聚合返回而视图不展示将成三档只显两档的暗缺口）。
- approval 列只呈现值域分布（`none`/`denied` 计数），**文案禁含「pending」「待批」**（该列只记终态——C6 时间启发式是后续批次）。
- 30 天口径标注：视图头部显式文案含「30 天」（如「窗口读数上限 30 天（ZCode 保留期，三表 prune 实测生效）」）。

**文档增补:**
- `docs/usage-accounting.md` 新小节标题**恰为** `## N. queryTaskUsage 增量口径（C1 增补）`（编号顺延现有 §1-§10）——内容：官方 `queryTaskUsage()` 的 input 增量口径（压缩 baseline 不回扣，USAGE 源码出处 zai-org/ZCode `repositories/usage.ts`）；**边界声明**：该口径是会话内增量、非本仓窗口聚合口径（本仓窗口聚合仍以 `SUM(computed_total_tokens)` 官方预计算值为准）。此为 WP2 对账锚点的官方升级。
- `public/views/how.js`：新增「30 天窗口」声明段（保留窗覆盖三表的实测事实：model_usage/turn_usage/tool_usage 各 40.5 万/1.4 万/54.7 万行、最早行 ≈2026-08-25，`USAGE_RETENTION_DAYS=30` prune 生效）+ queryTaskUsage 一句口径指引（文案含「queryTaskUsage」与「30 天」两个 grep 锚）。

**测试（test/usage-view.test.js，源码契约——frontend-contract.test.js:15 `readPublic` 形态）:**
- C1-5 视图侧：index.html 含 `data-view="usage"` 与 `<script src="/views/usage.js">`；usage.js 含 `registerView('usage'`；命中 `/(window\.)?ZC\.emptyState\(/`；含「30 天」；**不含**硬编码色值（`#[0-9a-f]{3,6}`、`rgba?(`、`hsla?(` 三正则 + 具名色名单 `\b(red|orange|yellow|lime|green|teal|cyan|blue|violet|purple|magenta|pink|brown|gray|grey|silver|white|black|gold)\b` 均 0 命中）；**不含**「pending」「待批」。
- C1-8：`docs/usage-accounting.md` 含「queryTaskUsage 增量口径（C1 增补）」；how.js 含「queryTaskUsage」。
- C1-7 部分：how.js 含「30 天」（usage.js 部分已由上一条覆盖；attribution.js 属 T5）。

**完成判据:** `cd F:/project/zcode-monitor-plan && node --test test/usage-view.test.js` 退出码 0；`grep -n "30 天" public/views/usage.js public/views/how.js` 双命中（attribution.js 在 T5 后终验）。

---

## T5：C5 视图——attribution.js 火焰图

**目标**：新视图「Token 归因」——嵌套宽度布局火焰图（零图表库），session 层帧按 token 占比定宽、点击下钻 turn 层与会话详情；hover 显示 token/耗时/占比；双主题经 `--chart-*` 变量 + 主题事件重绘。

**Files:**
- Create: `F:/project/zcode-monitor-plan/public/views/attribution.js`
- Modify: `F:/project/zcode-monitor-plan/public/index.html`（nav 增 `data-view="attribution"` + `<script src="/views/attribution.js">`）
- Create: `F:/project/zcode-monitor-plan/test/attribution-view.test.js`

**遵循的既有模式（锚点）:**
- registerView IIFE（同 T4）；窗口选择器（同 T4）。
- 色带读取：`cssVar('--chart-…')`（app.js:109-133 既有通道，`window.ZC.cssVar` 已导出）；主题切换重绘：`window.addEventListener('zc-theme-changed', rerender)`（`rethemeCharts` 派发该事件，app.js:146-150——overview 图表重绘既有形态）。
- **零图表库**：本视图不调用 `registerChart`/`new Chart`（Chart.js 仅 overview 既有使用）；火焰图=嵌套 div（外层宽度 100%、子层 `style="width: X%"`），色带可用 `--cat-*`/`--chart-*` 变量轮转。
- 下钻导航：hash 路由既有形态（sessions.js:430 `href="#sessions/<id>/…"` 先例）——session 层帧 → `#sessions/<id>`；turn 层帧 → `#sessions/<id>/turns`。
- hover 载荷：`title` 与 `data-*` 属性承载 token/耗时/占比三值（转义后拼接）。
- 空态：`window.ZC.emptyState`；30 天口径文案含「30 天」。

**实施要点:**
- 数据流：`GET /api/usage/attribution?window=&level=session`（默认）→ 渲染 session 帧（宽=tokens/Σtokens）；点击 session 帧 → `?level=turn&session_id=<id>` 重取渲染 turn 层 + 提供「返回 session 层」按钮；`meta.truncated` 时显式标注「仅前 N 项（被裁）」。
- 视图头部 30 天口径标注（与 usage.js 同款文案家族）。

**测试（test/attribution-view.test.js，源码契约，C5-3/C5-4）:**
- registerView('attribution' + index.html nav/script 引入。
- **不含** `registerChart`/`new Chart` 调用（零图表库钉）。
- 色值经 `cssVar('--chart-` 或 `var(--chart-` 读取；硬编码色值三正则 + 具名色名单 0 命中（同 T4 判据）。
- hover 载荷：token/耗时/占比三值经 title 或 data-* 属性承载（可 grep 的属性名）。
- 下钻链接：session 层帧含 `#sessions/` 链接形态、turn 层帧含 `#sessions/<id>/turns` 形态。
- 空态命中 `/(window\.)?ZC\.emptyState\(/`；含「30 天」。

**[命令]（C1-7 终验）:** `grep -n "30 天" public/views/usage.js public/views/attribution.js public/views/how.js` 三文件均命中（C1-7 完整通过时点在本任务）。
**[评审] C5-6:** 双主题截图（hover 态 + 下钻后会话详情）与宽度占比手工核对——human-gate 留痕 `docs/acceptance/`（Global Constraint 9 格式），不虚构。

**完成判据:** `cd F:/project/zcode-monitor-plan && node --test test/attribution-view.test.js` 退出码 0；C1-7 三文件 grep 全命中。

---

## T6：C2 服务端——models-meta + context-gauge 查询族 + 端点 + sessionList/todayUsage 扩展

**目标**：静态模型元数据模块（精确匹配、未命中 null、出处逐值标注）；db.js 新 `── Context gauge ──` 分节（会话 token 序列查询）；`GET /api/sessions/:id/context-gauge`；sessionList 每会话附最新 model 行三字段（路由层 resolve 窗口）；todayUsage 增 input/cache_read 与 cache_hit_rate（响应侧算好）。

**卡重标注：** 本批最重卡（6 文件、4 个异质关注点：models-meta 内容型定值 / contextGaugeRows 查询族+端点 / sessionList 扩展 / todayUsage 扩列）——model_id 值域侦察 [命令]（见本卡末「真实库 [命令]」段①）先行、models-meta 定值随后；全增量无迁移、单 commit 可整体干净回滚，各关注点测试面独立（models-meta.test.js / context-gauge.test.js），维持单卡不拆。

**Files:**
- Create: `F:/project/zcode-monitor-plan/server/models-meta.js`
- Modify: `F:/project/zcode-monitor-plan/server/db.js`（**排在 T2 之后**——各自独立分节，不改 T2 段）
- Modify: `F:/project/zcode-monitor-plan/server/routes/sessions.js`
- Create: `F:/project/zcode-monitor-plan/test/models-meta.test.js`
- Create: `F:/project/zcode-monitor-plan/test/context-gauge.test.js`
- Modify: `F:/project/zcode-monitor-plan/docs/acceptance/round2-batch1-explain-timing.md`（C2-8 追加）

**遵循的既有模式（锚点）:**
- models-meta：纯数据模块（node:test 直接 require，无 IO）；模块导出 `{ table, resolve }`（`table` 供测试自洽取已知 id 首键——导出形状与 C2-1 用例点对齐，实施者无需从测试反推接口）；`resolve(modelId)` 精确匹配 → `{ context_tokens, max_output_tokens }` 或 `null`——**不做前缀/后缀等模糊匹配**（「不猜窗口」原则）。
- 序列查询：会话内查询走 session 索引（`sessionTurns` db.js:548-572 同款 `WHERE session_id = ?`）；**首次引入会话内序列 limit，方向显式钉**：`ORDER BY started_at DESC LIMIT ?` 子查询取最新端 → JS 反转为 ASC（ASC+LIMIT 直取会错取会话最旧端——长会话超 100 行常态，截错端则 live 水位种子停在远古）。
- sessionList 扩展：页内 id IN 寻址第三条聚合（db.js:527-534 既有两段同款）；「最新行」用 SQLite bare-column+MAX 特性：`SELECT session_id, model_id, input_tokens, MAX(rowid) AS rid FROM model_usage WHERE session_id IN (…) GROUP BY session_id`（注释注明该 SQLite 语义：MAX 所在行的裸列取值）——**取 rowid 最大行，非 MAX(input)**。
- todayUsage：既有函数（db.js:482-492）SELECT 增两 SUM 列；`cache_hit_rate = input>0 ? +(cache_read/input).toFixed(4) : null`（分母官方语义已含 cache_read；零分母 → null，禁止 NaN/Infinity）。
- 路由端点：sessions.js `/:id/turns`（:64-66）同款形态挂 `/:id/context-gauge?limit=`；limit `clampLimit(req.query.limit, 100, 500)`（:48 先例二元组）。
- **窗口值唯一通路**：行由路由层经 `modelsMeta.resolve(model_id)` 附 `context_tokens`（未知→null）——浏览器端不持有、不复制模型窗口表。

**实施要点:**
- `contextGaugeRows(sessionId, limit)`（db.js Context gauge 分节）→ 行含 `started_at(ISO)/turn_id/model_id/query_source/input_tokens/cache_read_input_tokens/cache_creation_input_tokens`，**ASC 返回**；路由层每行附 `context_tokens`（resolve）与 `compact_boundary: query_source === 'compact'`（30d 窗实测 341 行，边界可判定）。
- **水位分子口径（§2.0 勘误，执行义务）**：分子 = 逐行 `input_tokens`（input 已含 cache_read，照抄上游「input+cache_read+cache_creation 累计」会使水位 ≈2 倍虚高）；`input_tokens = 0` 的行回退官方 fallback `cache_creation + cache_read`（出处 USAGE `inputSideTokensFromNormalizedUsage`）——回退计算在 T7 组件纯函数内做（db 层返回原始三列，不预判）；**回退行 UI 如实标注**（T7）。
- sessionList 响应：每会话增 `latest_model: { model_id, input_tokens, context_tokens }`——前两者来自 db 聚合（无行会话为 null、null），`context_tokens` 路由层 resolve（`latest_model.model_id` 为 null 时直接 null）——**字段存在值为 null，非缺字段**。
- models-meta 数值来源与纪律：文件头注声明 (a)「静态整理表、非官方权威——界面恒标注」（UI 标注在 T7）；(b) zcode-api 无许可证——**只取数值事实、不复制其 README 整理文本**；(c) 权威核对以 zai-org/ZCode 源码模型常量为准（分析 §9-8 路径），每条数值标注「已核对官方源码常量（文件/常量出处）」或「unverified」；起步数值参考 zcode-api coding-plan 档（上下文 200K / 5.2 为 1M / 最大输出 128K），逐条对照官方源码后定值。models-meta 定值前先行真实库 model_id 值域侦察——**该侦察是 [命令] 条目**（Global Constraint 8：真实库只读实测仅限 [命令]，不得在 [命令] 面外对真实库跑任何查询；SQL 与照录要求见本卡末「真实库 [命令]」段①）。
- `/api/widget/today` 路由是 `res.json(dbq.todayUsage())` 直通（index.js:214），todayUsage 扩列后端点响应自动扩展——不改 index.js。

**测试:**
- `test/models-meta.test.js`（C2-1）：require 后取表内任一已知 id（自洽——用模块自身导出的表首个键）→ 返回数值对象；未知 id（如 `'nonexistent-model-x'`）→ `null`；源码含「非官方权威」头注声明与 zcode-api 许可证纪律注释；每条数值带出处标注（「已核对」含出处串或「unverified」）。
- `test/context-gauge.test.js`（C2-2/C2-4 API 面/C2-6 API 面）：
  - C2-2：会话 s1 构造 input 递增 3 行 + 1 行 `query_source='compact'` + 1 行 input=0/cache_creation=100/cache_read=50 → `GET /api/sessions/s1/context-gauge` → 行序 started_at ASC、compact 行带边界标记、**行形状断言**：每行含 started_at/turn_id/model_id/query_source/input_tokens/cache_read_input_tokens/cache_creation_input_tokens/context_tokens 八字段并与构造值逐项核对（规格 C2-2 字面行集——API 响应缺列被本用例直接抓到，不靠 C2-3 函数层间接覆盖）；context_tokens 判定：构造行 model_id 用 models-meta 已知 id → 非 null，另造一行未知 model_id → null；`?limit=-1` 钳 1、`?limit=99999` 钳 500；**截断方向**：`?limit=3` 于 5 行序列 → 返回恰为最新 3 行且行序仍 ASC。
  - C2-4：两会话各带不同 model_id 最新行（构造一行「更晚但 input 更小」守护 rowid-max 语义）→ `GET /api/sessions` → 每会话 `latest_model` 三字段正确；另造无 model 行会话 → 三字段均为 null 且存在。
  - C2-6：当日行 input 1000/cache_read 400 → `dbq.todayUsage()` 含 `input_tokens: 1000`、`cache_read_tokens: 400`、`cache_hit_rate: 0.4`；并补一例真实 HTTP `GET /api/widget/today` 断言响应三字段与 db 层一致（规格 C2-6 判定物是 HTTP 响应——端点为 index.js:214 `res.json(dbq.todayUsage())` 直通，最小 express 同款直通挂载即可、不必拉起完整 index.js）；另构造当日全 input=0 → `cache_hit_rate === null`（db 层与 HTTP 例同断）。
- fixture 注意：测试所需 model_id 须与 models-meta 表键一致（用模块导出的已知 id 构造行）；`session` 表 fixture 建会话行即可（sessionList 两段查询复用）。

**真实库 [命令]（C2-8 + model_id 值域侦察，只读）:** ① **model_id 值域侦察**（models-meta 定值前先行）：`SELECT DISTINCT model_id FROM (SELECT model_id FROM model_usage WHERE rowid > (SELECT MAX(rowid) FROM model_usage) - 5000)`（rowid 尾界采样，满足红线；不用全表 GROUP BY）→ 结果逐值照录 `docs/acceptance/round2-batch1-explain-timing.md`（追加段），models-meta 表键与实测值域的对齐结论一并记录；② 按 Spec §5 模板对 `contextGaugeRows`（session 索引寻址）与 sessionList 扩展第三聚合（IN 寻址）跑 EXPLAIN+计时 → `SEARCH … USING INDEX`、无 SCAN，照录同文件（追加段）。

**完成判据:** `node --test test/models-meta.test.js test/context-gauge.test.js`（各自单跑亦可）退出码 0；C2-8 记录在案且无 SCAN；model_id 值域侦察结果照录在案。

---

## T7：C2 前端——context-gauge 组件 + 会话两消费面 + widget 缓存命中副行

**目标**：双端导出水位组件（纯函数：占用比/增量/compact 回落/unknown 态）+ sessions 列表 mini 条 + Context 标签水位区（live 条+增量曲线+compact 竖线+回落摘要）+ widget hover 卡「缓存命中」副行。

**Files:**
- Create: `F:/project/zcode-monitor-plan/public/context-gauge.js`
- Modify: `F:/project/zcode-monitor-plan/public/index.html`（`<script src="/context-gauge.js">`——C2-5 钉死该单一形态；置于 views script 之前）
- Modify: `F:/project/zcode-monitor-plan/public/views/sessions.js`
- Modify: `F:/project/zcode-monitor-plan/public/widget.html`
- Create: `F:/project/zcode-monitor-plan/test/context-view.test.js`

**遵循的既有模式（锚点）:**
- 双端导出 UMD：pet-state.js:8-11 工厂形态；**挂载责任单点**：context-gauge.js 文件自身（browser 分支）挂 `window.ZC.ContextGauge`，app.js 不含 `window.ZC.ContextGauge =` 赋值（同 C9-3 对 emptyState 的钉法）。
- live 订阅：public/views/overview.js:456 `new EventSource('/api/live/events')` + model 行事件形态；**离开视图/切会话时幂等 close**（public/views/overview.js:454 同步 close 先例——杜绝孤儿 EventSource；此处 overview.js 是**视图**文件，勿与 server/routes/overview.js 同名路由文件混淆）。
- 色值：severity 三档 `var(--sev-ok/warn/err)`（styles.css:46-48/106-109 双主题已定义）——**水位档位阈值本计划拍板缺省：占用 <60% ok、≥60% warn、≥85% err**（呈现层分档，注释注明口径；数据不因分档改变）；未知模型不显百分比（`ratio = null` → unknown 态条+「窗口未知」标注，非猜值）。文件为新文件，全文硬编码色值 0 命中（同 T4 判据）。
- renderList：sessions.js:83-116 行内新增 mini 条段（`.s` 行内或其下细条）；renderContext：sessions.js:159-326 内新增水位区（置于 ctx-grid 顶部或独立卡片区）。
- widget 副行：widget.html `showTip()`（:380-418）文本追加「缓存命中 X%」——`d.cache_hit_rate` 数值 → `Math.round(rate*100)+'%'`；null/undefined → `'—'`；**纯渲染不计算**（比率响应侧已算好）。

**实施要点:**
- `public/context-gauge.js` 纯函数（node:test 直测）：
  - `computeGaugeSeries(rows)`：逐行分子 = `input_tokens > 0 ? input_tokens : cache_creation_input_tokens + cache_read_input_tokens`（§2.0 勘误回退；回退行标 `fallback: true`；input=0 且 cache 两列缺失/undefined——SSE live 行缺列形态——→ 分子 `null`，不按 0 计）；`ratio = (context_tokens && 分子 != null) ? +(分子/context_tokens).toFixed(4) : null`（unknown 态；分子判空必须显式——JS 语义 `null/N === 0`，仅判 context_tokens 会把分子 null 的缺列行算成 0% 占用，与「分子 null、绝不按 0 计」拍板矛盾）；`delta` = 当前行分子 − 前一行分子（首行 null；compact 后为负值）。
  - `compactDrops(series)`：compact 边界前后两行占用差（回落摘要数据）。
  - 渲染 helper：`gaugeBarHtml(ratio)`（宽度=占用、sev 色档、ratio null → unknown 形态）、增量曲线（div/SVG 条形，零图表库）、compact 竖线、回落摘要 HTML——走 styles.css 既有 token。
- Context 水位区：种子 `GET /api/sessions/:id/context-gauge?limit=100`（行内 context_tokens 即窗口值）→ live 水位条（SSE model 行 `input_tokens` 只推分子增量；**会话内模型切换以最新种子行为准**；**live 行 input=0 拍板**：SSE model 行载荷无 cache 两列——`recentModelRowsAfterRowid` db.js:808-821 SELECT 清单，live.js 直推——§2.0 回退分子不可得，该行不推进水位、绝不按 0 计入，水位条维持上一已知读数并如实标注「分子不可得」，待下次种子端点刷新修正）；逐轮增量曲线；compaction 边界竖线；回落摘要（compact 前后占用对比）；空序列 → `ZC.emptyState`；**口径说明文案**：「水位随已落库请求推进、生成中不跳动」（行在请求完成时落库）+ 回退行标注。
- renderList mini 条：`latest_model` 存在且 `input_tokens != null` 且 `context_tokens != null` → 渲染 mini 条 + 百分比；`context_tokens === null`（未知模型）→ 条可渲染但**不显百分比**；无 model 行会话（`latest_model.model_id === null`）→ **不渲染 mini 条**（空数据形状钉死）；「非官方权威」标注以 hover/title 形式挂在 mini 条与水位区（models-meta 静态表的界面恒标注义务）。
- widget.html `.tip`：副行文案含「缓存命中」；null → 「—」（共享 null 语义）。

**测试（test/context-view.test.js）:**
- C2-3（纯函数，node 侧 require `../public/context-gauge.js`）：以 C2-2 同款序列 + 窗口 200000 → 占用比逐行 `input/200000` 正确（**构造行选 `context_tokens === 200000` 的已知 id——models-meta 表内混档（5.2 为 1M），勿盲取表首键；首键非 200K 档时须显式选档**，与 T6 fixture 注意「用模块导出的已知 id」衔接：那边任意档皆可，本用例分母断言锚定 200K 档）；input=0 行回退 `(100+50)/200000` 且标 fallback；compact 边界前后回落值 = 前后两行占用差；models-meta 未命中（context_tokens null）→ 占比为 null（不显百分比）；增量曲线值 = 相邻行**分子差**（回退行取回退值——与实施要点 delta 口径统一拍板消歧：规格 C2-3「相邻行 input 差」在回退行上与「分子差」两义，以分子差为准、与 §2.0 勘误同源；compact 后为负）；另构造一行 input=0 且 cache 两列 undefined（模拟 SSE live 行缺列形态）→ 分子为 null、delta 不按 0 计、**ratio 亦为 null**（live 边界钉——伪代码分子判空的对应用例：JS 语义 null/N === 0，防实现照抄单条件判空把缺列行算成 0% 占用；行为拍板见实施要点水位区条）。
- C2-5（源码契约）：sessions.js renderContext 含四要素渲染代码——可 grep 锚：SSE 订阅 `/api/live/events`、增量曲线、compaction 竖线、回落摘要（以稳定注释/标识串钉，如「水位区」「增量曲线」「compaction」「回落摘要」中文锚）；空序列命中 `/(window\.)?ZC\.emptyState\(/`；context-gauge.js 硬编码色值三正则+具名色名单 0 命中；index.html 含 `<script src="/context-gauge.js">`；app.js 不含 `window.ZC.ContextGauge =`。
- C2-6（源码契约）：widget.html 含「缓存命中」副行渲染与 null → `'—'` 分支。
- C2-7（源码契约）：`server/` 目录（递归）`text/event-stream` 出现次数恰为 2（live.js 与 index.js 各一——2026-09-25 本会话 grep 实测基线）。
- renderList 契约（C2-4 前端面）：sessions.js 含 mini 条渲染段与「未知模型不显百分比」「无 model 行不渲染」两分支（可 grep 锚）。

**[评审] C2-9:** models-meta 逐条核对记录（头注出处已由 C2-1 测试钉；截图类）——mini 条/水位区（含未知模型态、compact 回落态）/widget 副行（含 `—` 空态）双主题各一帧 + 「非官方权威」标注形态，human-gate 留痕 `docs/acceptance/`。

**完成判据:** `cd F:/project/zcode-monitor-plan && node --test test/context-view.test.js` 退出码 0；C2-9 评审项按留痕格式待人工。

---

## 收口（脚本侧，非实施者任务）

- **GX-1**：worktree 根 `npm test` 退出码 0、0 failed（含本批 **8 个**新测试文件与既有全套——freshness/usage-queries/usage-routes/usage-view/attribution-view/models-meta/context-gauge/context-view；另 test/helpers/fixture-db.js 增补 DDL，helper 非 .test.js、test/index.js 按 `test/*.test.js` 发现不计入测试计数——`sessionTurns` 形状等既有契约守护随套继续绿，即「纯增量」的回归证据）。
- **GX-2**：`node -e "console.log(Object.keys(require('./package.json').dependencies))"` 输出恰为 `[ 'better-sqlite3', 'express' ]`。
- 人工评审调度：C9-5 全子项（顶栏 chip 真机双主题截图 + emptyState 截图 + **本批新增全部数字位 null→—/unknown 态核查** + **models-meta 未命中不显猜测百分比抽查**——后者与 C2-3 联动）、C2-9、C5-6。
- 7399 冒烟终验（如脚本编排需要重复 T3 的 curl 检查）。
