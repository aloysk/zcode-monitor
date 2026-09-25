# T2 真实库 EXPLAIN / 计时 / 30d 取舍照录（ecosystem-round2-batch1 · C1-6 + C5-5）

- 日期：2026-09-25（SGT）。环境：Windows 10.0.26200 x64，Node v24.11.1，worktree
  `F:/project/zcode-monitor-plan`（分支 `feature/ecosystem-round2-batch1`）。
- 真实库：`~/.zcode/cli/db/db.sqlite`（14.6-18GB 量级，AGENTS.md 红线 2），全程
  **只读**（`server/db.js` 的 readonly 连接；EXPLAIN QUERY PLAN + console.time，
  零写入——`~/.zcode` 一个字节未动）。
- 计时口径：`console.time` 包住 `dbq.db().prepare(sql).all()`（better-sqlite3 同步
  执行，即事件循环阻塞时长）。cold = 探针进程内该语句首次执行；warm = 紧随其后的
  第二次执行。真实库由 ZCode 并发写入（WAL），数字有页缓存/检查点状态的常规波动。
- 探针形态：§1-§3 为 Spec §5 模板形态（`node -e` / 探针脚本，SQL 参数字面量内联）；
  §4 为**实现形态终验**——直接调用 `server/db.js` 导出的函数本体，经 prepare 缝捕获
  其真实发出的每条 SQL（零漂移），逐条 EXPLAIN + 函数级冷/热计时。探针脚本留于
  `os.tmpdir()`（`zcmon-t2-*-probe.js`），非仓内文件。
- 当日行数分布（只读 COUNT，窗口下界同探针）：

| 窗口 | turn_usage | tool_usage | model_usage |
|---|---|---|---|
| 24h | 817 | 26,335 | 20,146 |
| 7d | 4,099 | 161,181 | 127,385 |
| 30d | 13,886 | 550,310 | 407,122 |

---

## 1. C1-6：turn / tool 族 EXPLAIN + 计时（24h 与 30d 两档）

### 1.1 首测（未钳制形态——30d 超线触发取舍的实证）

命令（worktree 根，`node -e`，SQL 与实现同文、since 字面量内联；输出照录）：

```
== turns-totals / 24h ==            SEARCH turn_usage USING INDEX turn_usage_started_idx (started_at>?)
                                    turns-totals/24h: 4.875ms
== turns-by-error-type / 24h ==     SEARCH turn_usage USING INDEX turn_usage_started_idx (started_at>?)
                                    USE TEMP B-TREE FOR GROUP BY / USE TEMP B-TREE FOR ORDER BY
                                    turns-by-error-type/24h: 0.499ms
== turns-timeline / 24h ==          SEARCH turn_usage USING INDEX turn_usage_started_idx (started_at>?)
                                    turns-timeline/24h: 0.251ms
== tools-main / 24h ==              SEARCH tool_usage USING INDEX tool_usage_started_tool_idx (started_at>?)
                                    USE TEMP B-TREE FOR GROUP BY / USE TEMP B-TREE FOR ORDER BY
                                    tools-main/24h: 27.46ms
== tools-approval / 24h ==          SEARCH tool_usage USING INDEX tool_usage_started_tool_idx (started_at>?)
                                    USE TEMP B-TREE FOR GROUP BY
                                    tools-approval/24h: 9.786ms
== turns-totals / 30d ==            SEARCH turn_usage USING INDEX turn_usage_started_idx (started_at>?)
                                    turns-totals/30d: 115.899ms
== turns-by-error-type / 30d ==     （同 24h 计划形态）
                                    turns-by-error-type/30d: 3.833ms
== turns-timeline / 30d ==          （同 24h 计划形态）
                                    turns-timeline/30d: 0.209ms
== tools-main / 30d ==              （同 24h 计划形态）
                                    tools-main/30d: 4.476s
== tools-approval / 30d ==          （同 24h 计划形态）
                                    tools-approval/30d: 988.892ms
```

热态复跑（同进程第二次）：tools-main/7d 193.6/201.8ms、tools-approval/7d
189.6/180.7ms、tools-main/30d 710.6/653.3ms、tools-approval/30d 455.5/444.1ms。

**判读**：计划全部无基表 SCAN（SEARCH started_at 索引 + TEMP B-TREE 分组/排序，
判据允许）；但 **tools-main 30d 冷态 4.476s / 热态 653-711ms、tools-approval 30d
冷态 989ms** ——超 500ms 触发线（C1-6 措辞：>500ms 须附取舍）。根因：30d 窗
550,310 行逐行回表聚合（started_at 索引不覆盖被聚合列，只读库不能建覆盖索引），
与历史事故「message 全表扫 2.4s」同级的事件循环阻塞形态。turn_usage 侧 30d 全表
仅 13,886 行（116ms 冷/12ms 热），远在线内。

### 1.2 取舍决策（C1-6 的「必须存在」项）

**启用 slowTools 先例的 rowid 尾部候选集钳制**（db.js `slowTools` 同款；
`USAGE_CANDIDATE_CAP_ROWS = 200_000`，`USAGE_CAP_WINDOW_MS = 8d`（第二轮评审
修正，原 7d）——窗宽 ≥8d 的查询走 `WHERE rowid > (SELECT MAX(rowid) FROM
tool_usage) - @cap AND started_at >= @since` + `NOT INDEXED`；<8d 窗（本族值域
24h/7d）保持 started_at 精确路径。修正缘由：宽窄判定在 db 层对 `Date.now()`
二次求值，而 `sinceMs` 由路由在更早时刻算出（T1≤T2 恒真）——阈值取 7d 时 7d
请求的窗宽（7d+求值延迟）恒过线、被静默尾界收窄且路由（按 window 标签仅对
30d 申报 meta.scope）无申报；8d=7d 档加 1 天余量，令 7d 恒走精确路径，与 meta
申报机制同源。回归钉：test/usage-queries.test.js 阶段 9 补 7d 直调捕获——无
NOT INDEXED/无 rowid 尾界、归因页查询钉 INDEXED BY started_at 索引）。理由与
边界：

1. **cap=200,000 的定标**：7d 档行数 161,181（tools）/127,385（model_usage，C5），
   cap 须大于 7d 峰值以不改窄窗语义——200k 留 24%/57% 余量；cap=250,000 实测
   attr 30d 已到 398.9/500.2ms（贴线，否决）；cap=100,000 会咬 7d 档（161k>100k，
   隐藏截断用户点名窗，否决）。
2. **窄窗不变形实证**：cap=200k 下 24h 与 7d 的 tools-main/tools-approval/
   attr-page 三查询 capped 与 uncapped 结果**逐字节相等**（JSON.stringify 比对，
   六组全 true）。
3. **30d 有效窗收窄量化（如实申报义务）**：tool_usage 30d 550,352 行被裁至
   200,000（最早保留行年龄 **8.53 天**）；model_usage 407,161 → 200,000（**12.05
   天**）。即 30d 档读数实际是「最近约 8.5/12 天」——路由 meta 须注明 scope
   （`slow_tools_scope` 先例，T3 接线；常量已导出 `USAGE_CANDIDATE_CAP_ROWS`）。
4. **NOT INDEXED 的必要性（计划钉）**：加 rowid 谓词而不钉 NOT INDEXED 时，
   attr 页查询 planner 仍为省 GROUP BY 的 TEMP B-TREE 改走 session 索引**全扫**
   （实测 `SCAN model_usage USING INDEX model_usage_session_turn_idx`，30d 热态
   783.979ms——cap 形同虚设）；钉后 `SEARCH model_usage USING INTEGER PRIMARY KEY
   (rowid>?)`，337-357ms。tools 族不钉也自然选 rowid 尾界，仍统一钉死为契约。
5. **增长边界**：若单日用量涨至 7d 档行数超 200k，7d 档将被尾界收窄（今日
   24%/57% 余量）——与 slowTools「时间跨度会随使用时长无限增长，规模必须有独立
   上界」同一取舍：上界即 cap、语义收窄经 meta 如实申报；触及线时重测再定。
   **重测触发线（六席终审轮补充，2026-09-25，F-SQL-1）**：tool/attribution 族
   任一 7d 函数级 warm 计时 >450ms，或 7d 档窗内行数 >180k（tools）/>150k
   （model_usage）——满足其一即重评 cap 上调/加列覆盖面并重基线本表数字
   （与 turn_usage 既有的「>5 万行/>300ms」触发口径对齐；终审复测余量见
   §1.3 末段）。
6. **turn_usage 不钳**：30d 全表 13,886 行、首测 116ms（热态 8-12ms），无超线面
   ——不引入无谓复杂度。

### 1.3 钳制后 30d 档形态实测（探针，照录）

```
== tools-main / 30d / cap=200000 ==     SEARCH tool_usage USING INTEGER PRIMARY KEY (rowid>?)
                                        SCALAR SUBQUERY 1 / SEARCH tool_usage（MAX(rowid) 子查询）
                                        USE TEMP B-TREE FOR GROUP BY / USE TEMP B-TREE FOR ORDER BY
                                        tools-main/30d/cap200000-cold: 180.781ms
                                        tools-main/30d/cap200000-warm: 177.21ms
== tools-approval / 30d / cap=200000 == （同上计划形态）
                                        tools-approval/30d/cap200000-cold: 173.159ms
                                        tools-approval/30d/cap200000-warm: 154.252ms
```

**跨进程冷态补充实测（第二轮评审 + 评审修复轮，2026-09-25）**：上表为探针
进程内数字，冷态受 OS 页缓存状态影响显著——评审席冷态实测 tools-main 30d
capped 338.7ms、attr-page 30d capped 509.4ms；修复轮冷态复测（函数本体直调、
readonly、探针 `zcmon-i-sql-2-cold-probe.js` 留 os.tmpdir()）：
`usageToolBreakdown/30d 301-313ms`、`usageAttributionBySession(50)/30d 309.8ms`
（归因单趟化后的现行形态——见 §2 sources 修正注的演进；两段式+宽窗 sources
钉死形态曾实测 535-605ms 超线，单趟化回线内）。tools 30d 冷态贴线属页缓存
依赖（热态 177-193ms），与 §1.2 取舍共存；/api/usage 30d 请求还会叠加 titles
（~0.2ms）与 turns 查询（12ms 冷）。7d 档（恒走窄窗精确路径）冷态 184-251ms
在线内。

**六席终审轮复测（2026-09-25，F-SQL-1 留痕；readonly 通道、函数本体直调）**：
tool_usage 行数 550,310→554,178（评审时点）——usageToolBreakdown/7d 443ms
cold / 410ms warm、/30d（cap 后）471.8ms cold / 448ms warm、
usageAttributionBySession/30d 404.5ms cold / 379.6ms warm，均在线内但余量
收窄至 6-20%（首测/修复轮记录为 184-251ms / 299-313ms 量级）；行数增长方向
与余量收窄一致。7d warm 计时已贴近线（410/450 触发线），触及 §1.2 条目 5
的触发线即重评 cap/加列覆盖面并重基线本表。

---

## 2. C5-5：attribution 两级 SQL EXPLAIN + 计时（24h/7d/30d 三档 + 会话内单跑）

页内样本 session_id（24h top-2，字面量内联进 sources/titles/attr-turn）：
`sess_bede0b0e-77de-4d19-b1a8-799d2e68dbf2`、
`sess_dwf-dwfrun-3c44903f-1d52-4317-8cce-f4a16abb57e8-actor_6_1`。

```
== attr-session-page / 24h ==   SEARCH model_usage USING INDEX model_usage_started_model_idx (started_at>?)
                                USE TEMP B-TREE FOR GROUP BY / USE TEMP B-TREE FOR ORDER BY
                                attr-session-page/24h-cold: 32.653ms   warm: 31.192ms
== attr-session-sources / 24h ==SEARCH model_usage USING INDEX model_usage_session_turn_idx (session_id=?)
                                USE TEMP B-TREE FOR GROUP BY
                                attr-session-sources/24h-cold: 7.625ms  warm: 1.205ms
== attr-session-page / 7d ==    （同 24h 计划形态）
                                attr-session-page/7d-cold: 203.87ms    warm: 204.79ms
== attr-session-sources / 7d == （同 24h 计划形态）
                                attr-session-sources/7d-cold: 3.191ms  warm: 1.728ms
== attr-session-page / 30d（未钳形态，超线实证）==
                                attr-session-page/30d-cold: 820.331ms warm: 810.228ms
== attr-session-sources / 30d ==（同 24h 计划形态；该独立查询已随第二轮评审的
                                单趟化移除——分解并入页查询，见下注）
                                attr-session-sources/30d-cold: 10.696ms warm: 1.298ms
== attr-session-titles（单跑）== SEARCH session USING INDEX sqlite_autoindex_session_1 (id=?)
                                attr-session-titles: 0.227ms
== attr-turn（单跑，会话内寻址无窗口档）==
                                SEARCH model_usage USING INDEX model_usage_session_turn_idx (session_id=?)
                                USE TEMP B-TREE FOR ORDER BY
                                attr-turn: 0.619ms
== attr-page-wide NOT INDEXED / 30d / cap=200000（钳制后实现形态）==
                                SEARCH model_usage USING INTEGER PRIMARY KEY (rowid>?)
                                SCALAR SUBQUERY 1 / SEARCH model_usage
                                USE TEMP B-TREE FOR GROUP BY / USE TEMP B-TREE FOR ORDER BY
                                attr-page-wide/30d/cap200000-cold: 356.94ms warm: 337.384ms
```

**C5-5 30d 决策**：attr-session-page 30d 未钳 810-820ms **> 500ms** → 与 C1 共用
§1.2 的 rowid 尾界 cap 取舍（同一条决策覆盖两族——spec 明言「两族共用同一判据」）；
钳制后 337-357ms（两段式页查询单条；终态单趟双键分组见下注，30d 299-310ms）。
titles/attr-turn 均为个位数毫秒；sources 独立查询已随单趟化移除（并入页查询）。

**sources 分解同口径修正与单趟化（第二轮评审修复，2026-09-25）**：原实现宽窗
页查询带 rowid 尾界 cap 而 sources 分解按全窗 started_at 聚合——同一响应行内
tokens 为 cap 窗值、by_query_source 为全窗值（小 cap 下分解和可达行总量 11 倍，
子条份额超 100%），「份额与该行窗口总量可对账」失实。第一版修复给 sources 加
同款 rowid 尾界谓词（NOT INDEXED），正确性成立但宽窗成双尾界扫描：真实库只读
实测页 270-360ms + sources 200-246ms ≈ 541-605ms、整函数新进程 cold 535.1ms，
持续超 500ms 触发线（I-SQL-4）。终版修复（方案 a）：分解并入页查询——同趟
`GROUP BY session_id, query_source` 一次尾界扫描，JS 侧归并出每会话总量/分解/
排序截断（30d 5187 分组行 → 4978 会话，归并 3.2ms）；成本探针
（`zcmon-i-sql-4-merge-probe.js` 留 os.tmpdir()）：单趟双键 30d 299.3ms 冷/
290.2ms 热、7d 189.7ms 冷、24h 33.4ms 冷——均优于两段式（7d 两段 207ms、24h
40ms），实现本体冷态复测 30d 309.8ms / 7d 183.8ms 回线内。正确性回归钉
test/usage-queries.test.js 阶段 8（cap=1 对拍 by_query_source={main_turn:50}，
全窗聚合旧实现得 550）。

---

## 3. 实现形态终验（函数本体直调，prepare 缝捕获全部 15 条去重 SQL）

对 `server/db.js` 导出的五个函数按 24h/7d/30d 直调（含函数内全部两段查询），
函数级冷/热计时（即单次 API 请求的同步阻塞上界）：

| 函数 \ 窗口 | 24h cold/warm | 7d cold/warm | 30d cold/warm（钳制后） |
|---|---|---|---|
| usageTurnsSummary | 1.42 / 0.44ms | 4.01 / 1.93ms | 12.2 / 8.49ms |
| usageTurnTimeline(100) | 0.60 / 0.73ms | 0.30 / 0.25ms | 0.42 / 0.37ms |
| usageToolBreakdown | 32.8 / 19.9ms | 281.1 / 261.7ms | 289.4 / 293.0ms |
| usageAttributionBySession(50) | 43.1 / 34.2ms | 324.0 / 282.2ms | 390.6 / 393.3ms |
| usageAttributionByTurn(50) | — | — | 单跑 1.04 / 1.11ms |

注：本表 7d 档两函数的数字采于宽窄判定阈值仍为 7d 时——彼时 7d 请求因
「路由早时刻 sinceMs vs db 晚时刻 now」恒被判宽窗、实走 rowid 钳制路径（I-码-1
评审发现）；修复（阈值 8d）后 7d 走窄窗精确路径，冷态复测见 §1.3 补记
（184-251ms）。30d 档数字不受该修复影响（两态同为宽窗）。usageAttributionBySession
的行另采于两段式形态——单趟化（§2 注）后函数级冷态 30d 309.8ms / 7d 183.8ms。

15 条 SQL 的计划逐条核对：**全部为 `SEARCH ... USING INDEX` 或 `SEARCH ...
USING INTEGER PRIMARY KEY (rowid>?)`，无对任何基表（turn_usage/tool_usage/
model_usage/session）的 SCAN**（TEMP B-TREE 分组/排序为判据允许项）。唯一 SCAN
是 `SELECT 1 FROM sqlite_master WHERE type='index' AND name=...`——索引存在性
守卫探针（`overviewKpis` 既有同款，sqlite_master 为 schema 目录非基表；连接级
记忆，每连接仅一次）。

窄窗（≤7d）attribution 页查询带 `INDEXED BY model_usage_started_model_idx`：
不加钉时 planner 为省 GROUP BY 的 TEMP B-TREE 会全索引扫 session 索引（fixture
EXPLAIN 实测 `SCAN model_usage USING INDEX idx_model_usage_session`，真实库 40
万行同形态即 2.4s 级阻塞）——overviewKpis 头注同款问题与解法（含缺索引库回退
路径的「慢但可用」取舍）。

---

## 4. 判据核对结论

- **C1-6**：turn 聚合/时间线/tool 分组每条 SQL 计划无 SCAN ✓；24h/30d 计时照录
  （§1.1/§1.3）✓；30d >500ms 的取舍与理由存在（§1.2）✓。
- **C5-5**：attribution 两级 SQL 三档计划无 SCAN、计时照录（§2/§3）✓；30d >500ms
  的取舍记录存在（与 C1 共用 §1.2）✓。
- fixture 侧 EXPLAIN 形态钉（`test/usage-queries.test.js` 阶段 9，评审修复后
  扩容）：窄窗 8 条 + 宽窗 4 条（NOT INDEXED×3——归因单趟化后 sources 独立
  查询移除）+ 7d 直调 4 条（I-码-1 回归钉：7d 恒走窄窗精确路径、无 NOT
  INDEXED）全部无基表 SCAN，随测试套持续守护。

> T6（C2-8：contextGaugeRows / sessionList 扩展 / model_id 值域侦察）的记录由
> T6 任务追加至本文件，此处不预留占位。

---

## 5. T6（C2 服务端）：model_id 值域侦察 + C2-8 EXPLAIN/计时（2026-09-25 追加）

- 环境同 §头部（Windows 10.0.26200 x64，Node v24.11.1，worktree
  `F:/project/zcode-monitor-plan`，分支 `feature/ecosystem-round2-batch1`）。
  全程**只读**（`server/db.js` readonly 连接；EXPLAIN QUERY PLAN + console.time，
  `~/.zcode` 零写入）。探针脚本 `os.tmpdir()`（`zcmon-t6-c28-probe.js`），非仓内文件
  （T2 §头部同款纪律）。

### 5.1 model_id 值域侦察（models-meta 定值前先行，任务卡「真实库 [命令]」段①）

命令（rowid 尾界 5000 行采样，红线允许路径；不用全表 GROUP BY）：

```sql
SELECT DISTINCT model_id FROM (SELECT model_id FROM model_usage
  WHERE rowid > (SELECT MAX(rowid) FROM model_usage) - 5000)
```

实测（2026-09-25，15.6ms）：**恰两值——`GLM-5.3`、`GLM-5.3-FlashX`**。

对齐结论：`server/models-meta.js` 表键完整覆盖实测值域（GLM-5.3＝表首键/主力
模型；GLM-5.3-FlashX 已收录）。两值均「已核对官方源码常量」——出处
zai-org/ZCode `config/provider/zcode-builtin.json`（revision 30，blob eb48d99d）
`modelConfigRules.modelRules`，按官方解析语义（`packages/provider/src/config/
model-config.ts` matchesRule：`^(?:<modelMatch>)$` 大小写不敏感 + 规则数组序
overlay，`config-overlay.ts` overlayValue 后值覆盖）实跑求值：

| id | 命中规则（overlay 终值） | context_tokens | max_output_tokens |
|---|---|---|---|
| GLM-5.3 | `.*`→`.*glm-5(?:[.\-:/\[].*)?`→`.*glm-5\.3(?:-flash)?(?:[.\-:/\[].*)?` | 1000000 | 128000 |
| GLM-5.3-FlashX | 同上（glm-5.3 规则后缀组覆盖；id 不在 canonical 名单 official-glm-model-id.ts，本机值域实测成员） | 1000000 | 128000 |

两点如实申报：

1. **zcode-api 数值分歧以官方为准**：其 README 记 GLM-5.3 上下文 200K，官方
   常量为 1M（glm-5.3 规则 contextWindow=1000000，后序 overlay 覆盖 `.*glm-5`
   层的 200000）——models-meta 取 1M 并在头注记名分歧（许可证纪律：只取数值
   事实，不复制其文本）。
2. **GLM-5.3-FlashX 的核对路径**：官方规则族无逐字命名该 id 的规则，但其值由
   glm-5.3 规则的后缀组 `(?:[.\-:/\[].*)?` 确定覆盖（官方解析语义实跑核实命中
   `.*` / `.*glm-5…` / `.*glm-5\.3(?:-flash)?…` 三层、终值 1M/128000）；本机
   在用副本 `~/.zcode/v2/runtime/provider/windows-x86_64/3.14.3/**/zcode-builtin.json`
   与 master 同 revision 30 实读一致。

### 5.2 C2-8：context-gauge 序列查询 + sessionList 第三聚合 EXPLAIN/计时

操作数（尾样本最忙会话，165 行/5000 样本；字面量内联）：
`sess_dwf-dwfrun-55669306-3a62-410c-8aee-b7f0db491b4a-actor_9_1`；IN 页取尾样本
前 5 会话。输出照录：

```
== gauge-seq/session-id/LIMIT100 ==   SEARCH model_usage USING INDEX model_usage_session_turn_idx (session_id=?)
                                      USE TEMP B-TREE FOR ORDER BY
                                      gauge-seq/session-id/LIMIT100/cold: 1.032ms   warm: 0.263ms
== sessionList-latest-model/IN5 ==    SEARCH model_usage USING INDEX model_usage_session_turn_idx (session_id=?)
                                      sessionList-latest-model/IN5/cold: 1.143ms    warm: 0.205ms
== todayUsage-增列后（C2-6 数据面，顺带核）==
                                      SEARCH model_usage USING INDEX model_usage_started_model_idx (started_at>?)
                                      todayUsage-modified/24h-cold: 28.866ms        warm: 25.918ms
```

函数级终验（T2 §3 同款 prepare 缝捕获，零漂移）——实现本体直调计时：

```
fn-contextGaugeRows(100)/cold: 1.173ms   warm: 0.446ms
   （165 行会话截最新 100 行，ASC 首/末：2026-09-24T17:24:01Z → 18:30:20Z）
fn-sessionList(5)/cold: 22.139ms         warm: 3.932ms
   （含既有页查询 session 表 ORDER BY time_updated 的排序成本——T2 前既有形态，
    本批未改；第三聚合自身即上面的 1.143ms/0.205ms）
CAPTURED（节选，与上面探针字面量 SQL 逐字一致）:
   SELECT started_at, turn_id, model_id, query_source, input_tokens,
     cache_read_input_tokens, cache_creation_input_tokens FROM model_usage
     WHERE session_id = ? ORDER BY started_at DESC LIMIT ?
   SELECT session_id, model_id, input_tokens, MAX(rowid) AS rid FROM model_usage
     WHERE session_id IN (?,?,?,?,?) GROUP BY session_id
```

真实数据顺带目检：sessionList 样例会话 latest_model 取到
`{model_id:'GLM-5.3', input_tokens:77022}` / `{model_id:'GLM-5.3', input_tokens:198059}`
（rowid 最大行；db 层 context_tokens 恒 null 待路由层 resolve——探针直调 db 层，
null 为预期形状）。

### 5.3 判据核对结论（C2-8）

- contextGaugeRows 序列查询：`SEARCH ... USING INDEX model_usage_session_turn_idx
  (session_id=?)`（session 复合索引）+ TEMP B-TREE 排序（判据允许项），**无 SCAN** ✓；
  计时照录（≤1.2ms）✓。
- sessionList 最新行扩展第三聚合：`SEARCH ... USING INDEX model_usage_session_turn_idx
  (session_id=?)`（IN 寻址，GROUP BY 走索引序、无 TEMP B-TREE），**无 SCAN** ✓；
  计时照录（≤1.2ms）✓。
- todayUsage 增列（SELECT 清单扩展，非新查询）：仍 `SEARCH ... USING INDEX
  model_usage_started_model_idx (started_at>?)`，计划形态不变，24h 档 26-29ms
  （与 Overview 既有 started_at 窗查询同量级）✓。
- model_id 值域侦察结果照录在案（§5.1），models-meta 表键与实测值域对齐 ✓。
