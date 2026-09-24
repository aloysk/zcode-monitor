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
`USAGE_CANDIDATE_CAP_ROWS = 200_000`，`USAGE_CAP_WINDOW_MS = 7d`——窗宽 >7d 的
查询走 `WHERE rowid > (SELECT MAX(rowid) FROM tool_usage) - @cap AND
started_at >= @since` + `NOT INDEXED`；≤7d 窗保持 started_at 精确路径）。理由与
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
== attr-session-sources / 30d ==（同 24h 计划形态）
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
钳制后 337-357ms。sources/titles/attr-turn 均为个位数毫秒，不钳。

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
- fixture 侧 EXPLAIN 形态钉（`test/usage-queries.test.js` 阶段 9）：窄窗 9 条 +
  宽窗 5 条（NOT INDEXED×3）全部无基表 SCAN，随测试套持续守护。

> T6（C2-8：contextGaugeRows / sessionList 扩展 / model_id 值域侦察）的记录由
> T6 任务追加至本文件，此处不预留占位。
