# Token 用量口径（usage accounting v1）

> 任务来源：docs/plans/ecosystem-adoption-v1.md T4（WP2 token 口径对齐与对账）。
> 本文档按计划 T4 Step 1 的固定结构（【结论】+【官方源码出处】+【对 db.js 的影响】+【fixture 断言取值】）
> 合并承载原计划的 `docs/caliber/token-caliber-v1.md` 与 `docs/acceptance/T4-caliber-reconciliation.md`、
> `T4-explain-timing.md`、`T4-before-after.md` 四份文件的内容（按任务指令收敛为单文档）。
> 官方核实基准：zai-org/ZCode @ commit `872ad96`（"feat: open source"，2026-09-20；仓库共 2 个 commit，
> 另一为 `77432b6` "Initial commit"）。

## 0. 结论速览（核实门 → 分支选择）

| 计划决策点 | 核实结论 | 落地分支 |
| --- | --- | --- |
| 总量公式 | `computed_total_tokens` 是官方预计算权威值 | **分支 A**：`SUM(computed_total_tokens)`，不自造公式 |
| `parent_id` 归组 | 官方无 parent 维度去重；每行只属于一个 session，时间窗聚合无重复计入 | **分支 A**：全量行计入，不排除子代理行 |
| `turn_usage` side call 缺口 | 真实库 30/30 样本证实：turn_usage 总量不含标题生成 side call | **纯标注**：总量为下界，不改数字 |

计划中分支 B 的备选公式 `input+output+reasoning+cache_creation` 被否决：官方语义下
`input_tokens` 已含 cache_read（cache 字段只是 breakdown，见 §2.2），把 `cache_creation`
再加一次与官方语义不符；`reasoning_tokens` 在本地库恒为 0（provider 未单独上报），公式值
虽与 `computed_total_tokens` 数值巧合相等，但语义错误、不可依赖。

---

## 1. schema 权威出处

【结论】db.sqlite 的用量三表 DDL 权威出处是官方开源仓库的单条 migration。
【官方源码出处】`apps/zcode-cli/packages/adapters/src/storage/session-store/migrations.ts`
→ `SQLITE_MIGRATIONS` 数组，migration id `0010_usage_observability`（appVersion 0.15.0）。
本机真实库 PRAGMA 逐列比对一致：`input_tokens`/`output_tokens`/`reasoning_tokens`/
`cache_creation_input_tokens`/`cache_read_input_tokens`/`computed_total_tokens` 全部
`INTEGER NOT NULL DEFAULT 0`，`provider_total_tokens INTEGER`（可空）。
索引：`model_usage_started_model_idx(started_at, provider_id, model_id)`、
`model_usage_session_turn_idx(session_id, turn_id)`、`model_usage_trace_idx`、
`model_usage_query_source_idx`；`turn_usage_started_idx(started_at)`、
主键 `(session_id, turn_id)`；`tool_usage` 唯一索引 `(session_id, tool_call_id)` +
`tool_usage_started_tool_idx(started_at, tool_name)`。
【对 db.js 的影响】所有带 `started_at >= @since` 下界的查询可命中
`model_usage_started_model_idx` / `tool_usage_started_tool_idx` / `turn_usage_started_idx`；
`session` 表无时间列索引（`sessionList`/`agentsForest` 的根扫描受 Spec A2-3 出路条款管辖，
本任务未触碰其扫描面）。
【fixture 断言取值】`test/helpers/fixture-db.js` 的 DDL 提供同名索引
`model_usage_started_model_idx`（db.js 的 `INDEXED BY` 需要同名索引，见 §7）。

官方 30 天保留策略（对账窗口约束）：`usage.ts` `pruneUsage()` +
`USAGE_RETENTION_DAYS = 30`——每次写入后删除 `started_at` 早于 30 天前的
model_usage/turn_usage/tool_usage 行。本机实测 30 天窗口共 381,548 行 model_usage。
**对账窗口必须落在近 30 天内。**

## 2. `computed_total_tokens` 语义与总量公式

### 2.1 【结论】官方预计算权威值，官方聚合口径即 `SUM(computed_total_tokens)`

【官方源码出处】
- 写入路径：`apps/zcode-cli/packages/adapters/src/storage/session-store/repositories/usage.ts`
  `recordModelUsage()`：
  ```ts
  const computedTotalTokens =
    input.computedTotalTokens ??
    inputSideTokensFromNormalizedUsage(inputTokens, cacheCreation, cacheRead) + outputTokens;
  // inputSideTokensFromNormalizedUsage: input>0 ? input : cacheCreation + cacheRead
  ```
- 事实采集路径：`apps/zcode-cli/packages/core/src/runtime/methods/usage-observability.ts`
  `recordModelUsageFact()` **不传** `computedTotalTokens`，只传
  `providerTotalTokens: usage?.totalTokens`（AI SDK 上报的 provider 总量）——即本地库该列
  走 `usage.ts` 的 fallback 公式 `input + output`。
- 官方聚合：同 `usage.ts` `queryAppUsage()` 的 `totals.totalTokens` 就是
  `coalesce(sum(computed_total_tokens), 0) from model_usage`。

【数据验证】（只读探针，命令与输出留痕于 §5）
- 全库（30 天）381,548 行：`computed_total_tokens = input_tokens + output_tokens` 恒等式
  381,548/381,548 成立。
- `provider_total_tokens` 非空的 381,076 行全部 `== computed_total_tokens`；为空的 472 行
  全是 error/cancelled 全零行（fallback 公式同样得 0）。
- 抽样 400 行（近 24h completed 且 output>0）：候选公式中
  `input+output`、`input+output+reasoning`、`input+output+reasoning+cache_creation`、
  fallback 四个全部 400/400 匹配（因为本地库 reasoning/cache_creation 恒 0，无法区分），
  `input+cache_read+cache_creation+output`（重复计 cache_read）仅 4/400。

【对 db.js 的影响】`overviewKpis` 主查询加 `SUM(computed_total_tokens) AS total_tok`，
返回 `tokens.total`；`sessionList`/`sessionChildren`/`agentsForest` 三处
`SUM(computed_total_tokens)` 保持原样（补出处注释）。**不自造公式。**

【fixture 断言取值】`test/db-caliber.test.js`：边界行 1（computed=1400）+ 边界行 2
（computed=650）→ `k.tokens.total === 2050`（≠ 分项和 1950，证明取的是预计算列）。

### 2.2 【结论】`input_tokens` 已含 cache_read；cache 列只是 breakdown

【官方源码出处】`usage.ts` `inputSideTokensFromStoredUsage()` 注释原文：
> AI SDK v6 写入的 inputTokens 已经是 total input；历史表里 cache 字段只是 breakdown。
> task usage 和 compact 基线不能再把 cache read/write 叠到 inputTokens 上。

【数据验证】近 24h：`cache_read > 0` 的 22,036 行全部满足 `input ≥ cache_read`，
`cache_read > input` 的行数为 0；抽样中 `input+cache_read+...` 公式 396/400 不匹配。

【对 db.js 的影响】展示层拆分：`overviewKpis` 返回
`tokens.input_ex_cache = Math.max(0, input − cache_read)`（纯输入，去重展示）；
缓存命中率的分母仍是官方 `input`（含 cache_read，与官方 breakdown 一致）。
【fixture 断言取值】`k.tokens.input === 1500`、`k.tokens.input_ex_cache === 1100`
（1500 − 400）。

### 2.3 reasoning / cache_creation 的本地事实

`reasoning_tokens` 与 `cache_creation_input_tokens` 在本地库 381,548 行中**恒为 0**
（provider 对 GLM 系未单独上报这两项）。查询仍保留对它们聚合（官方列、未来 provider
上报即生效），`COALESCE(reasoning_tokens,0)` 对 NULL 稳健（fixture 无 NOT NULL 约束，
保留 NULL 边界行覆盖该路径）。

## 3. `parent_id` 归组与去重规则

【结论】**无重复计入，不去重**（分支 A）。
【官方源码出处】`usage.ts` `queryAppUsage()` 对 model_usage 全量行求和，无任何按
session 层级/parent 的排除或折算；子代理是独立 `session` 行（`session.parent_id` 关联），
其 `model_usage` 行的 `session_id` 指向子会话——同一行在时间窗聚合中只出现一次。
官方确有按 `query_source`（`main_turn`/`subagent`/`workflow_child`）维护「增量 input
基线」的逻辑（`queryTaskUsage()`，用于桌面 task 面板防止 compact 后 context 重复折算），
但那是会话内增量口径，不是我们 dashboard 的窗口聚合口径，本任务不采用。
【对 db.js 的影响】不改 SQL；`overviewKpis.model.calls` 计全量行（含子代理行）。
【fixture 断言取值】`k.model.calls === 3`（主会话 2 行 + 子会话 1 行）；
`sessionList`：p1→1400、c1→650；`sessionChildren('p1')`→650；
`agentsForest`：roots[0].tokens=1400、children[0].tokens=650（各持各的，不叠加）。
【数据验证】对账日（§5）B/C 两组独立构造（按 session+turn 分组、按 session 分组）与
直接聚合结果完全一致（3,014,674,037），实证无重复计入。

## 4. `turn_usage` side call 缺口

【结论】turn_usage 的 token 总量是**下界**：标题生成等 side call 只写 model_usage，
不进 turn_usage。
【官方源码出处】
- `apps/zcode-cli/packages/core/src/runtime/methods/title-generation-sidecar.ts`：
  `SESSION_TITLE_QUERY_SOURCE = "session_title"`、`GOAL_SUMMARY_TITLE_QUERY_SOURCE =
  "goal_summary_title"`；标题生成经 `runWithModelInvocationContext` 独立调用模型，
  完成后 `recordModelUsageFact()`（只写 model_usage）。
- `turn.ts`：标题生成在首条 query 持久化后**异步**启动（注释：避免被主链路取消拖死）。
- `usage-observability.ts` `recordTurnUsageFact()`：turn_usage 的
  `computed_total_tokens = Σ getModelUsageTotalTokens(usage)`（contracts
  `session.events.ts` `createModelUsageSummaryFromEvents` → 只汇总该 turn 生命周期内的
  `ModelComplete` 事件）；sidecar 在 turn 完成后异步完成，不在其中。

【数据验证】（真实库只读）
- 近 30 天 model_usage 有 206 行 `query_source='session_title'`（24h 内 9 行）。
- 取近 7 天 30 个含 session_title 行的 turn：**30/30** 满足
  `turn_usage.computed_total_tokens == Σ(model_usage 该 turn 排除 session_title 行)`，
  且全部 ≠ 含标题行的总和（差值恰等于标题行 ct：610/380/252/…）。
- 对账日（§5）窗口内 `session_title` 7 行、2,730 tokens，仅存在于 model_usage。

【对 db.js 的影响】`sessionTurns()` 注释标注「不含 side call、总量为下界」，不改数字；
前端 Turns 视图（`sessions.js` Turn 时间线标题 + Usage 表 total 列头）加「下界」徽章。
【fixture 断言取值】无——纯标注无数值差可断言（相对计划 Spec A2-1 字面的显式缩减，
理由即本段：标注不改变任何查询输出）。已知残余：配对对账中 9/674 turn 的 turn 略大、
7/674 model 略大（净 85,850，占 0.003%），来源是事件流汇总与 model_usage 行的写入时点差，
方向不定、量级可忽略，如实记录不掩盖。

## 5. 对账（A2-2，真实库只读，降级链留痕）

窗口：最近完整 UTC 日 **[T0, T1) = 2026-09-21T00:00:00Z ~ 2026-09-22T00:00:00Z**。

### 5.1 降级链逐级执行记录（基准替换留痕）

| 级 | 命令 | 结果 |
| --- | --- | --- |
| 1 ccusage 主线 | `npx -y ccusage zcode daily` | `Unknown command 'zcode'`；`ccusage --help` 命令表（daily/monthly/…/claude/codex/opencode/amp/droid/…/kimi/qwen/openclaw）无 zcode |
| 2 better-ccusage fork | `npx -y better-ccusage --help` | 仅 Claude Code 家族命令（daily/monthly/weekly/session/blocks/statusline），无 zcode 数据源 |
| 3 zcode-token-usage-statusbar | `npm view zcode-token-usage-statusbar` | `E404 Not Found`（registry.npmjs.org） |
| 4 纯 SQL 交叉核对 | 见 5.2 | **命中，作为对账基准** |

### 5.2 第 4 级：三条独立构造 SQL 互查（同一窗口）

我方口径（dashboard 同款直接聚合，命令内联 started_at 上下界）：

```
A（直接聚合）: SELECT COUNT(*), SUM(input_tokens), SUM(output_tokens),
  SUM(reasoning_tokens), SUM(cache_creation_input_tokens),
  SUM(cache_read_input_tokens), SUM(computed_total_tokens)
  FROM model_usage WHERE started_at >= T0 AND started_at < T1
B（按 session+turn 分组再求和）: SELECT COUNT(*), SUM(ct) FROM
  (SELECT session_id, turn_id, SUM(computed_total_tokens) AS ct FROM model_usage
   WHERE started_at >= T0 AND started_at < T1 GROUP BY session_id, turn_id)
C（按 session 分组再求和）: SELECT COUNT(*), SUM(ct) FROM
  (SELECT session_id, SUM(computed_total_tokens) AS ct FROM model_usage
   WHERE started_at >= T0 AND started_at < T1 GROUP BY session_id)
```

原始输出：

| 组 | rows/groups | input | output | reasoning | cache_creation | cache_read | computed_total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A 直接 | 22,462 | 2,995,457,494 | 19,216,543 | 0 | 0 | 2,898,595,584 | **3,014,674,037** |
| B session+turn | 679 | 2,995,457,494 | 19,216,543 | — | — | — | **3,014,674,037** |
| C session | 544 | — | — | — | — | — | **3,014,674,037** |

恒等式复核：`computed_total_tokens == input + output` 在窗口内 22,462/22,462 行成立。
**三条独立构造完全一致 → 无未解释差异。**

### 5.3 与 turn_usage 官方聚合的交叉核对（差异全部已解释）

窗口内 turn_usage：674 turn，`SUM(computed_total_tokens)` 实测 **3,039,350,371**；
与 A 差 **+24,676,334**。逐项分解（每项独立实测）：

| 差异项 | 数值（tokens） | 原因与证据 |
| --- | --- | --- |
| ① 窗口边缘（turn 窗 ≠ 行窗） | +53,972,367 | 353 条 model_usage 行 `started_at` 在窗外、但属于窗口内 turn（跨午夜长 turn）——按 (session_id, turn_id) 逐 turn 配对实测 |
| ② 窗口边缘（反向） | −29,381,883 | 窗口内的 model_usage 行归属窗口外 turn（T0 前启动的长 turn），由 D1−A 与①③差值反推 |
| ③ turn 记录漂移 | +85,850 | 674 个配对 turn：658 完全相等、9 个 turn 侧大、7 个 model 侧大（事件流汇总与行写入时点差，量级 0.003%） |
| **合计** | **+24,676,334** | ①+②+③ = 53,972,367 − 29,381,883 + 85,850 = 24,676,334 ✓ 与 D1−A 精确闭合 |
| （旁证）side call | 窗口内 session_title 7 行 / 2,730 | 只在 model_usage（§4）；量级远小于①~③，非本差异来源 |

配对明细样本：`{turn_ct:2443510, model_sum:2416917, n:35, delta:+26593}`、
`{turn_ct:2412702, model_sum:2413021, n:15, delta:-319}`、
`{turn_ct:354967, model_sum:355349, n:4, delta:-382}`。

窗口内 query_source 分布（A 的分解）：main_turn 3,021 行 / 687,656,586；
subagent 19,409 行 / 2,320,551,915；compact 25 行 / 6,462,806；session_title 7 行 / 2,730。

**通过判据核验：全部差异均已解释（每条附实测出处），无未解释差异。**

### 5.4 与外部工具对账的结论

ccusage 主线/fork 与 statusbar 包（降级链 1–3 级）均不支持 ZCode 数据源，无法产出
对账基准（命令与输出已在 5.1 如实照录）。代码级对齐已完成：本仓库总量口径与官方
`queryAppUsage` 逐符号一致（§2.1），即与未来任何读取同一 DB 的官方口径工具天然对齐。

## 6. 红线实测（A2-3，真实库 EXPLAIN + 计时）

环境：真实库（早期基线约 14.6GB；现行规模持续增长，实测锚点见
docs/specs/ecosystem-adoption-v1.md §4.1），model_usage 30 天 381,548 行；窗口 `since = now − 24h`；
命令形态 `EXPLAIN QUERY PLAN <sql>` + `console.time`（better-sqlite3 readonly）。

| 查询 | 改动前 | 改动后 |
| --- | --- | --- |
| overviewKpis model_usage 聚合（加 `SUM(computed_total_tokens) AS total_tok`） | `SEARCH model_usage USING INDEX model_usage_started_model_idx (started_at>?)` 32.9ms | 同 SEARCH，32.7–32.8ms ✓ |
| overviewKpis sessions `COUNT(DISTINCT session_id)` | `SCAN model_usage USING INDEX model_usage_session_turn_idx` **1.297–1.956s** | 加 `INDEXED BY model_usage_started_model_idx` → `SEARCH … (started_at>?)` + TEMP B-TREE，**39.7–50.5ms**（约 40 倍；结果一致 510=510） |
| overviewKpis tool_usage 聚合 | `SEARCH tool_usage USING COVERING INDEX tool_usage_started_tool_idx` 1.0ms | 未改 ✓ |
| overviewSpeed / recentSpeed / completedSince / todayUsage | 均带 started_at 下界 | SQL 未改（补注释）✓ |
| sessionList/sessionChildren/agentsForest 的 session_id 子查询 | `SEARCH m USING INDEX model_usage_session_turn_idx (session_id=?)` | SQL 未改（补注释）✓ |
| sessionTurns | `SEARCH turn_usage USING INDEX sqlite_autoindex_turn_usage_1 (session_id=?)` | SQL 未改（补注释）✓ |

- 本次实际修改过 SQL 的查询共两条（model_usage 聚合、sessions 去重计数），均
  `SEARCH ... USING INDEX`，无 `SCAN <table>`。
- sessions 计数虽非本任务新增查询，但位于本次触碰的 overviewKpis 内、实测 1.3–2.0s
  属事件循环饿死量级，按红线精神就地修复并留痕（表值 510=510 验证语义不变）。
- 新增查询清单：无（`total_tok` 是既有聚合查询上加列，计划不变）。
- 时序纪律核验：未新增任何无 `started_at` 下界或无 rowid 尾界的查询。

## 7. 新旧值对照（A2-2 / WP2 需求 3）

真实库时段：复用 §5 窗口（直接聚合组 A 的数值即改动后 dashboard 口径；
`sessionList`/`sessionChildren`/`agentsForest` 分支 A 保持原 SQL，改动前后输出不变）。
fixture 组：边界行在改动前后各跑一次（`git stash` 切换），脚本
`$TMP/t4-before-after.js`（会话内执行，不入库）：

| 字段 | 改动前 | 改动后 |
| --- | --- | --- |
| `tokens.input` | 1500 | 1500（不变） |
| `tokens.input_ex_cache` | （无此字段） | **1100**（新增） |
| `tokens.output` | 300 | 300（不变） |
| `tokens.reasoning` | 50 | 50（不变） |
| `tokens.cache_read` | 400 | 400（不变） |
| `tokens.cache_write` | 100 | 100（不变） |
| `tokens.total` | （无此字段） | **2050**（新增） |
| `model.calls` | 3 | 3（不变） |
| `sessionList` total_tokens | p1=1400, c1=650 | 同左（不变） |
| `agentsForest` tokens | p1=1400, children=[650] | 同左（不变） |

真实库 INDEXED BY 修复的对照：`COUNT(DISTINCT session_id)`（近 24h）
改动前 1.956s（计划器走 session_turn_idx 全索引 SCAN）→ 改动后 43.0–50.5ms，
返回值 510 一致。

## 8. 前端徽章映射表（A2-4）

规则（机械）：数字直接来自官方预计算/官方列 → `官方口径`；由我方公式合成 → `本地估算`；
官方列但有结构性缺口 → `下界`。徽章均带 `title` hover 说明。

| 数字位置 | 来源 | 徽章 | hover 要点 |
| --- | --- | --- | --- |
| overview 输入 token 卡 delta（`public/views/overview.js` renderKpis） | `SUM(input_tokens)` 官方列 + 官方 cache 分项 | `官方口径` | input 已含缓存读（AI SDK v6）；命中/写入取官方分项列 |
| overview 速度表 footer 总 token（同文件 renderSpeedTable） | Σ(output+reasoning) 我方合成（速度口径） | `本地估算` | 速度专用口径，不含输入；≠ computed_total_tokens |
| sessions 视图 Turn 时间线标题（`public/views/sessions.js` renderTurns） | turn_usage | `下界` | 不含标题生成等 side call |
| sessions 视图 Usage 表 total 列头（同文件 renderUsage） | turn_usage.computed_total_tokens | `下界` | 同上 |

样式：`public/styles.css` 新增 `.caliber`（11px 圆角描边徽章）。`public/app.js` 为
应用外壳（路由/主题/健康轮询），不含用量数字，本任务未改动。

2026-09-23 增补（workflow_child 计数轮）：overview 速度卡的「主/子agent(含工作流)/其中
工作流」三段与速度表 footer 的 subagent/工作流 计数均为 `model_usage` 原始行 COUNT
（`overviewSpeed` 分列 main_turn/subagent/workflow_child，速度口径过滤同前；速度表
footer 仅统计该表可见的最近 ≤50 行，非全窗口——速度卡三段才是全窗口口径），非 token
口径；UI「子agent(含工作流)」= `subagent_count + workflow_child_count`（API 两字段各自
保持纯口径、可分列复原）。widget ×N（在飞会话数）与窗口内行为计数的口径差异见 How 页
「widget 的 ×N」条目。

2026-09-24 增补（速度生成时长轮）：`overviewSpeed.weighted_tps`、`recentSpeed.tps`、
`completedSince` 行的 `gen_ms`、widget/桌宠/overview feed 的全部速度读数，分母自本日起为
**生成时长** Σ(duration − time_to_first_token_ms, 下限 1ms)，ttft 为 NULL 的行（实测
22.1%）回退全时长；此前口径（Σduration 含首等）在 GLM-5.3 上读数偏低约四成（首等平均
6.7s、占总时长 29-39%，24h 实测 51.5 → 72.6 t/s）。分子口径不变（Σ(output+reasoning)，
不含输入）。社区对照：JuDaXia/claude-speed METRIC v1.2 的 duration ≈ TTFT + out/TPS
分解；权威实现注见 `server/db.js` Token speed 区头注。`overviewSpeed` 并列返回
`gen_seconds`（生成秒）与 `avg_ttft_ms`（平均首等，仅 ttft 非 NULL 行参与）。

## 9. db.js 注释出处约定（A2-5）

`server/db.js` Overview 段头注释定义缩写，逐查询以
`// schema source: zai-org/ZCode <缩写> <符号>` 标注：

| 缩写 | 官方文件 |
| --- | --- |
| MIG | apps/zcode-cli/packages/adapters/src/storage/session-store/migrations.ts（0010_usage_observability） |
| USAGE | apps/zcode-cli/packages/adapters/src/storage/session-store/repositories/usage.ts |
| OBS | apps/zcode-cli/packages/core/src/runtime/methods/usage-observability.ts |

带标注的查询（16 处；成员逐条以各 "schema source:" 注释在其所属函数体内为准，
2026-09-23 按 `grep -n "schema source" server/db.js` 的 16 条逐查询命中
（:172/:262/:287/:304/:336/:367/:414/:441/:472/:495/:608/:650/:679/:712/:726/:772）
逐一回溯所属函数核实；段头 :158 另有 1 条全路径版总注不计入）：overviewKpis、
timeseries、breakdownByModel、breakdownByTool、overviewSpeed、recentSpeed、
completedSince、todayUsage、sessionList、sessionTurns（含 side call 下界标注）、
sessionChildren、errorsList(model)、errorSummary、recentModelRows、
recentToolRows、agentsForest。（初稿曾写「13 处」；修订轮曾把成员误改为含
sessionActivity/sessionReasoning、并误断言 errorsList/errorSummary 无标注——
二者实有标注（errorsList model 段 :650、errorSummary :679），
sessionActivity(:574)/sessionReasoning(:621) 实无——本行按逐条回溯函数体的
实测改正，列为后续补注候选。）
抽查 5 处与本文档一致性核验：见 commit 说明。

## 10. 与计划文件的对应关系

- 计划 `docs/caliber/token-caliber-v1.md` → 本文 §1–§4、§9。
- 计划 `docs/acceptance/T4-caliber-reconciliation.md` → 本文 §5。
- 计划 `docs/acceptance/T4-explain-timing.md` → 本文 §6。
- 计划 `docs/acceptance/T4-before-after.md` → 本文 §7、§8（A2-4 截图按计划不入库，
  以徽章 DOM 片段与样式留痕）。
- 计划的 `tests/` 目录名按仓库实际为 `test/`（T1 既有布局），测试文件
  `test/db-caliber.test.js`。
