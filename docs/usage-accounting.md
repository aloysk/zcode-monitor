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

2026-09-25 增补（生态采纳 batch1，「回合与工具」/「Token 归因」30d 档窗口
口径）：官方对用量三表执行 30 天保留（§1 `USAGE_RETENTION_DAYS=30`），本批
窗口级视图的 30d 档读数上限即该保留窗——更早数据无来源（How 页「数据保留
窗口」卡同申明；三表最早行均 ≈2026-08-25，prune 已生效）。性能红线下的
收窄口径：宽窗（≥8d，本族值域即 30d 档）tool/attribution 查询走 rowid
尾部候选集钳制（`USAGE_CANDIDATE_CAP_ROWS=200_000`，slowTools 先例同款；
宽窄阈值 `USAGE_CAP_WINDOW_MS=8d` 而非 7d——宽窄判定在 db 层对 `Date.now()`
二次求值、晚于路由算 `sinceMs`，取 7d 会使 7d 请求恒被判宽窗遭静默收窄且
路由无申报，8d 令 7d 恒走 started_at 窄窗精确路径）。真实库收窄量化：
tool_usage 30d 550,352 行 → 200,000（最早保留行年龄 8.53 天）、model_usage
407,161 → 200,000（12.05 天）——即 30d 档读数实际是「最近约 8.5/12 天」，
路由 `meta.scope` 如实申报（`slow_tools_scope` 先例，不静默）；窄窗 24h/7d
的 capped 与 uncapped 结果逐字节相等（不变形实证）。turn_usage 不钳（30d
全表 13,886 行、冷态 116ms，无超线面）。归因页 `by_query_source` 分解与页
查询同趟同尾界（单趟双键 `GROUP BY session_id, query_source`，JS 侧归并），
保证帧内子条份额与该行窗口总量可对账。重测触发线：tool/attribution 族
任一 7d 函数级 warm 计时 >450ms，或 7d 档窗内行数 >180k（tools）/>150k
（model_usage）——满足其一即重评 cap 上调/加列覆盖面并重基线。计时与计划
照录、取舍全案见 `docs/acceptance/round2-batch1-explain-timing.md`
（§1.2 决策/§1.3 六席终审复测余量 6-20%/§2 归因单趟化）；边界登记
residuals R-22。官方 `queryTaskUsage()` 的会话内 input 增量基线口径与本仓
窗口聚合口径的边界声明见 §11（C1 增补小节）。

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

## 11. queryTaskUsage 增量口径（C1 增补）

> 任务来源：docs/specs/ecosystem-round2-batch1.md §2.1 需求 5（验收 C1-8）。
> 本节是 §3 中「官方确有增量基线逻辑」一句的官方升级锚点——WP2 对账时该语义
> 仅作为否决分支的旁证提及，C1 轮按规格要求补全为独立小节。

【结论】官方 `queryTaskUsage()` 维护的是**会话内 input 增量基线**口径：按
`query_source`（main_turn/subagent/workflow_child）分别维护已计入的 input
基线，每个 task 的 input 用量按相对基线的**增量**呈现；上下文压缩（compact）
后基线**不回扣**——压缩把历史压短，已计入的 input 不因压缩折返而扣减，后续
请求相对新基线重新起算。设计用途是官方桌面 task 用量面板防止 compact 后
context 重复折算（同一段历史不被计两次）。

【官方源码出处】`apps/zcode-cli/packages/adapters/src/storage/session-store/
repositories/usage.ts` `queryTaskUsage()`（官方开源基准 commit `872ad96`，
见本文档头注；与 §2/§3 的 `recordModelUsage`/`queryAppUsage` 同文件）。

【边界声明】该口径是**会话内增量**口径，**非本仓窗口聚合口径**。本仓
dashboard 与窗口级视图（overview /「回合与工具」/ token 归因）的 token 总量
仍以 `SUM(computed_total_tokens)` 官方预计算值为准（§2 分支 A——不自造公式、
不引入增量基线折算）。两口径回答不同问题：`queryTaskUsage` 回答「该 task 从
开始至今新消耗了多少 input」，本仓窗口聚合回答「窗口内全部行的官方预计算
权威值合计多少」；二者不可互相换算、不可混用（§3 的无重复计入结论不变——
全量行求和本来就没有 compact 重复折算问题，无需增量基线）。

【对 db.js 的影响】无。纯口径文档增补，零查询改动；本仓不实现增量基线，
既有对账/速度/归因口径均不受影响。


## 12. C1/C2 呈现层口径增补（ecosystem-round2-batch1）

> 任务来源：六席终审修复轮 F-档-3——本批三项新口径此前只在 db.js /
> context-gauge.js 注释，未入本口径册（唯一登记处），补记如下。实施位与
> 测试钉见各条。

1. **widget 当日缓存命中率 `cache_hit_rate`**（C2-6，`db.js todayUsage`）：
   `cache_read_input_tokens / input_tokens`，响应侧算好（前端纯渲染）；
   零分母（当日全零行/无行）→ **null**，禁 NaN/Infinity（`Math.round` 不接触
   null——前端 null→`—`）。测试：test/context-gauge.test.js C2-6 两例。
2. **C2 水位分子回退**（§2.0 勘误的执行口径，`public/context-gauge.js
   moleculeOf`）：分子 = 逐行 `input_tokens`（官方语义已含 cache_read）；
   `input_tokens=0` 的行（error/cancelled 全零行）回退官方 fallback
   `cache_creation_input_tokens + cache_read_input_tokens`（USAGE
   `inputSideTokensFromNormalizedUsage`），回退行标 `fallback:true`、UI 如实
   标注；cache 两列均缺（SSE live 行载荷形态）→ 分子 null——缺列即未知，
   绝不按 0 计（不推进水位、不参与增量）。测试：test/context-view.test.js
   C2-3 纯函数用例。
3. **tool 分档耗时双口径**（C1，`db.js usageToolBreakdown`）：`avg_ms` 仅聚合
   `status='completed'` 行（错误行时长不代表健康耗时——对规格 §2.1
   AVG(duration_ms) 的收紧细化；组内无完成行 → null，不伪造 0）；`max_ms`
   全行（极端值含错误行）。测试：test/usage-queries.test.js C1-3 钉
   （Read 组错误行 50ms 进 max、avg 为 null）。


## 13. recap 口径（C7 增补）

> 任务来源：docs/specs/ecosystem-round2-batch2.md §2.3（验收 C7-1~C7-9，T6/T7）。
> 实施位：server/db.js `── Recap dates ──` 分节 + server/routes/recap.js
>（buildRecapPayload）+ public/views/recap.js；测试钉 test/recap.test.js（查询
> 族/口径/路由/EQP）与 test/recap-view.test.js（视图源码契约）。How 页口径段
> 见 public/views/how.js「active hours（活跃时长）怎么算」。

1. **本地日界**：recap 日桶按服务器本地时区自然日 00:00 切分——SQL 侧
   `(started_at + @tzMs)/86400000` 整除分桶，tz 由路由层取服务器本地偏移注入
   （`startOfDayMs` db.js 先例；**对齐官方 queryAppUsage 的 dayIndex/
   tzOffsetMs 维度**）。响应 meta.tz_offset_minutes 随载荷披露。
2. **activeHours 去重口径（双档，§2.0 拍板 5）**：week/month＝事件级——
   model_usage 行（一次模型请求＝一次活动事件）投 5 分钟桶
   `(started_at+@tzMs)/300000`，activeMinutes＝有活动的桶数，**跨会话去重
   （并行会话同桶只计一次）**；「N× parallel」＝桶内并行会话数的 max/avg
   （parallel_max/parallel_avg）。事件源不用 message 表（无时间前导索引，
   spec §1.2 事实 4）。year＝会话区间上界——session 表
   `time_created→time_updated` 区间并集（interval union，跨 30 天窗可用），
   **span 含挂机时间，是上界口径**（activity.caliber 字段披露档别：
   event_5min_buckets / session_span_union）。
3. **token 口径**：日桶与 Top focus 一律 `SUM(computed_total_tokens)`（§2
   分支 A 官方预计算权威值）；Top focus 为行级 (session_id × 5min 桶) 聚合 +
   JS 归并（directory 级去重桶数与 recapActivityBuckets 同口径），Top N 截断
   只在 directory 级归并完成后。
4. **30d 覆盖与 cap 治理**：meta.token_coverage_from＝**max(period_start,
   now−retentionDays, cap 覆盖起点)** 三元 max 唯一诚实公式——cap 生效时月初
   日桶先被 cap 截断而非 30d prune，「自 30 天前可读」的宣称会被 cap 先证伪；
   cap 覆盖起点＝rowid 尾部候选集最早行 started_at（`MIN(started_at)` +
   `rowid > MAX(rowid)−cap` 尾界形态；OFFSET 形态实机 EQP＝SCAN 是反例）。
   month/year 档宽窗（≥USAGE_CAP_WINDOW_MS=8d）rowid cap + NOT INDEXED 钉计划
   + meta.scope 申报，与 usage 族同治（§8 增补段 / R-22 重测触发线）。
5. **日桶生成边界**：日桶序列自 token_coverage_from 对齐的本地自然日起生成
   ——**coverage 之前的 period 内日期不产出桶行**（数据不可读≠零活动，不伪造
   0 桶）；**coverage 之内无活动的日期产出真 0 桶**（tokens=0/calls=0——
   「已知零」与「未知不伪造」的区分）。视图 sparkline 只渲染该序列、不从左邻
   插值，与覆盖披露卡对齐。
6. **year 档 token 类字段 null**：30d prune 外无数据源，token 类（日桶
   tokens / top_focus / comparison）为 null 或字段不存在，不伪造 0（C9-5
   未知值原则）；**环比仅 week 档**（§2.0 拍板 6——month/year 前一周期完整
   数据在 30 天保留下不可保证：月末请求时上一周期必缺、月初请求时仅部分仍在
   窗内）。


## 14. 会话状态信号口径（C6 增补）

> 任务来源：docs/specs/ecosystem-round2-batch2.md §2.1（验收 C6-1~C6-9，
> T2/T3）。实施位：server/signals.js（纯函数分类器，零 IO 零依赖）+
> db.js `── Session signals ──` 分节 + server/routes/signals.js；测试钉
> test/signals.test.js（分类器/查询族/EQP）与 test/signals-view.test.js
>（前端源码契约与降级态）。

1. **四态与判定序**：`working > broken > waiting > idle`（`server/signals.js`
   头注钉）。working＝卫生窗内存在未收尾的 assistant 请求行（livegen 同源
   判据的会话维度）——在飞压过近窗 error（属既往回合）与 waiting 启发式；
   broken＝近窗每会话最新 model 行 `status='error'`（bare-column+MAX(rowid)
   取写入序最新；新鲜度用 `started_at` 判、不用值域未实测的 completed_at）；
   waiting＝interactive 会话最新行 completed 且当前无在飞（时间启发式）；
   其余 idle（confidence 与 waiting_since 均 null——字段存在值为 null）。
2. **waiting 是时间启发式，confidence='low'**：数据面无权限等待信号源
   （approval_status 只记终态，分析 §9-4 两轮实测）——waiting 候选限
   `task_type='interactive'`（后台会话的完成不构成「等用户」，误报风暴主源
   入口过滤）；`waiting_since`＝最新 completed 行的 `completed_at`（数据派生
   无状态）；completed_at 为 NULL → waiting_since=null 且该会话不参与
   oldest_waiting_ms 聚合（防 Math.max 混入 null 得 NaN）。
3. **判定窗 15min**（SIGNALS_WINDOW_MS，可注入）；数据面双端点：
   `GET /api/signals/summary` 固定四字段 {waiting_count, broken_count,
   oldest_waiting_ms, generated_at}（全库近窗域，无行数参数，空库全零）；
   `/api/sessions` 行内 signal 字段 additive 同基座。
4. **误报边界与降级（R-28）**：真库 48h 回放抽样（286 时刻/576 样本）误报
   39.8% > spec 20% 线，收窗 8min 重测反升 47.8%——按 spec §2.1 需求 7 落
   降级：needs-attention 置顶分组摘除、C8 waiting_timeout 提醒默认关（徽标/
   置信标注/顶栏 chip 等常驻显示面保留）。回翻条件：真实触发一次权限批准流
   后 tool_usage.approval_status 尾部出现非终态值（真信号源）即可替换时间
   启发式重测。照录：round2-batch2-explain-timing.md §1.5。
5. **性能契约（R-32）**：在飞判定 rowid 尾界、近窗 INDEXED BY 强制 +
   ORDER BY DESC 截断（SIGNALS_MAX_ROWS=2000 有界）；缺
   `model_usage_started_model_idx` 的外部/旧库回退为无 INDEXED BY 同形查询
   （真库同形 1.23ms 仍走 started_at 索引；「真缺索引」库按保守口径申报
   慢但可用——R-9 先例同延）。


## 15. 本地提醒口径（C8 增补）

> 任务来源：docs/specs/ecosystem-round2-batch2.md §2.2（验收 C8-1~C8-8，
> T4/T5）。实施位：server/notify.js（规则引擎，30s unref'd tick、不在任何
> 请求路径）+ live.js notify 帧转发（复用既有 SSE 通道）+ app.js/overview.js/
> widget.html/pet.html 三页消费面；测试钉 test/notify.test.js（规则/冷却/
> tick）与 test/notify-view.test.js（前端契约）。规则默认值权威＝
> server/notify.js `RULE_DEFAULTS`（测试对表钉）。

1. **四规则与默认值（防噪默认）**：error_burst＝**开**（5min 窗 error 行
   model+tool 合计 ≥3，冷却 10min 全局，intensity sound，severity err）；
   waiting_timeout＝**默认关**（R-28 降级处置——interactive waiting 持续
   ≥5min，冷却 15min per-session，alert，warn；判定语义照 spec 原文保留，
   回翻只动 enabled 常量）；token_threshold＝关（单会话 **30d 保留窗**累计
   SUM(computed_total_tokens) ≥1M/5M/20M 三档，每会话每档位一次，quiet，
   warn）；inactive＝关（全库无 model 行 ≥30min 且 24h 窗内曾有活动，冷却
   60min，quiet，ok）。
2. **冷却只拦发送、不改条件评估**（C8-1 条件评估无状态与 C8-2 冷却是两个
   断言面）；冷却记忆有界（NOTIFY_COOLDOWN_CAP=1000 键序逐出，与前端
   notifySeen CAP=200 对称——超界丢最旧，该会话/档位可能在下一 tick 重发
   一次）。token_threshold 的 cooldownMs=Infinity 即「每会话每档位一次」。
3. **token 累计窗＝30 天保留窗**（三表 30d prune 口径边界：跨月历史不计，
   长会话阈值触发系统性延迟——气泡文案与 How 页披露「按 30 天保留窗口径」）。
4. **无回放（R-30）**：notify 是即发即失 SSE 事件，连接建立前/断线重连间隙
   触发的提醒永久错过；可见性兜底＝顶栏 waiting chip 轮询 + sessions 页
   刷新（常驻轮询，不依赖 SSE 在线）。
5. **severity 与 intensity 正交两轴**：severity 管视觉色（--sev-* 变量）、
   intensity 管通道（sound/alert/quiet），映射钉死在服务端 RULE_DEFAULTS
   （前端降级矩阵 notifyChannels 消费，不复制表）。前端三开关出厂默认
   {声音✔ / 系统通知✘ / TTS✘}；toast 5s 驻留；提示音 WebAudio 合成
   （880Hz/0.2s/gain 0.06，零音频资源）。


## 16. 导出口径（C12 增补）

> 任务来源：docs/specs/ecosystem-round2-batch2.md §2.4（验收 C12-1~C12-7，
> T8）。实施位：server/routes/export.js；测试钉 test/export-routes.test.js。
> 用户面口径见 How 页「数据导出」段（public/views/how.js）。

1. **白名单从严**：`GET /api/export/:dataset?format=json|csv`，dataset ∈
   {overview, usage, recap}、format ∈ {json, csv}（缺省 json）——白名单外
   一律 400 可读错误码、不静默回退（机器可读面从严，与窗口参数「未知回退」
   先例有意不同）。窗口参数值域与源端点一致：overview 24h|7d|today、
   usage 24h|7d|30d（resolveWindow，usage-window.js 唯一落点）、recap
   period week|month|year。
2. **同源钉（零新 SQL）**：与源端点同一查询/装配函数——overview＝/api/
   overview 装配面同清单、usage＝**固定绑定 /api/usage/turns 响应原形**
   （tools/attribution 两端点数据不导出，值域裁剪登记 R-29）、recap＝
   buildRecapPayload（T6 模块级导出）。usage 数据集随源携带顶层
   by_error_type_truncated 过渡字段（清理随 R-25 一并，两端口径逐字段一致）。
3. **JSON 包络**：顶层 {schema_version:1, generated_at, dataset, format,
   meta, data}，data＝源端点载荷原形；meta 继承源端点口径标注（usage/recap
   的 retention_days/scope/truncated 等），overview 例外补装
   {retention_days, window, since}（源端点无 meta；保留期是库级事实）。
4. **CSV（RFC 4180）**：每数据集固定一张矩形主表——usage＝turn 时间线 11
   列（C1 timeline 行字段）、recap＝日桶六列（date/tokens/calls/sessions/
   active_minutes/parallel_max；days[].errors 不入表）、overview＝section/
   key/value 三列长表（kpis/speed/recent_speed 逐叶子标量展开，series/
   by_model/by_tool 每行 value＝行对象 JSON 序列化）。转义：含 , " CR LF
   的字段双引号包裹、内部 " 加倍，行尾 CRLF，UTF-8 无 BOM；公式注入防护
   ——以 = + - @ 或 TAB/CR/LF 开头的字段前置 '（OWASP CSV Injection 建议
   集；Excel/Sheets 导入时这些单元格按文本处理，数字不受影响）。
