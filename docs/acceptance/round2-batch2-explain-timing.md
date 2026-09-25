# 真实库 EXPLAIN / 计时 / 误报抽样照录（ecosystem-round2-batch2）

- 用途：本批 [命令] 类验收（R8-1 / C6-7 / C6-8 / C8-7 / C7-7 / C12-7）的统一
  照录处——T1 建头（R-8 状态确认），T2 起各任务向本文件追加各自小节。
- 纪律：真实库访问一律只读（`~/.zcode/cli/db/db.sqlite`，AGENTS.md 红线 1/2；
  `~/.zcode` 一个字节不写）；探针脚本留 `os.tmpdir()`，非仓内文件。
- 环境：Windows 10.0.26200 x64，Node v24.11.1，worktree
  `F:/project/zcode-monitor-plan`（分支 `feature/ecosystem-round2-batch2`）。

---

## 0. T1 / R8-1：R-8 字体终形状态确认（2026-09-25，零行为变更）

R-8 销账（系统字体为最终形态）已由 `fix/r8-system-fonts` 轮（`6d979ae`，经 PR
合并进本批基线）完成；本节为守护性确认，命令逐条照录（grep 退出码 1 = 0 命中）：

| # | 命令 | 结果（照录） |
|---|---|---|
| 1 | `git -C F:/project/zcode-monitor-plan merge-base --is-ancestor 6d979ae HEAD` | 退出码 0——基线含 R-8 销账轮（merge-base 结论，不依赖具体 HEAD 短串，基线前进不失实） |
| 2 | `grep -rn "fonts.googleapis\|fonts.gstatic" F:/project/zcode-monitor-plan/public F:/project/zcode-monitor-plan/server` | 0 命中（退出码 1）——前端/服务端字体域全清 |
| 3 | `grep -n "@import" public/pet.html public/widget.html public/styles.css`（worktree 根） | 仅 `public/widget.html:47:   原 @import 排在 :root 之后本就无效，删除后语义不变） */`（解释性注释）；pet.html 与 styles.css 均 0 命中 |
| 4 | `grep -n "fonts.googleapis\|fonts.gstatic\|Google Fonts" README.md`（worktree 根，T1 复核项） | 0 命中（退出码 1）——README 无字体外联表述，无需勘改 |

契约钉（R8-2 守护面）：`test/frontend-contract.test.js` 本任务补 styles.css
无外联 `@import url(` 断言（widget/pet 两页既有形态断言之外的唯一缺口）；
变异验钉（node -e，不触碰真实文件）：现态 styles.css 对 `/@import\s+url\(/i`
为 false（过），注入 `@import url(https://fonts.googleapis.com/…)` 样本为
true（挂）——断言非恒过。单文件 `node --test test/frontend-contract.test.js`
退出码 0（3 pass / 0 fail）。

---

## 1. T2 / C6-7：会话状态信号两路 SQL 真实库 EXPLAIN + 计时（2026-09-25）

探针形态＝spec §5 模板（worktree 根 `node -e`，只读连接 + busy_timeout
5000ms；计时为单次执行墙钟，`process.hrtime.bigint()`）。两条 SQL 与
`server/db.js` Session signals 分节的运行时字面完全一致（在飞路＝
`signalsInflightSessionIds`、近窗路＝`signalsRecentModelLatest` 的 INDEXED BY
分支；参数内联）。窗口两档：15min（分类器缺省窗）与 24h（压力档）。

**路②（model_usage 近窗最新行，INDEXED BY 强制 + 子查询 ORDER BY started_at
DESC LIMIT @cap=2000 截断 + 外层 GROUP BY session_id 取 bare-column+MAX(rowid)）：**

| 窗口 | 会话数 | 单次计时 | EQP（照录） |
|---|---|---|---|
| 15min | 10 | 0.38ms | `CO-ROUTINE (subquery-1)` \| `SEARCH model_usage USING INDEX model_usage_started_model_idx (started_at>?)` \| `SCAN (subquery-1)` \| `USE TEMP B-TREE FOR GROUP BY` |
| 24h | 80 | 4.21ms | 同上（两档计划一致） |

判据②达成：`SEARCH model_usage USING INDEX model_usage_started_model_idx`
在案；无 `SCAN model_usage …`（翻转反例形态为
`SCAN model_usage USING INDEX model_usage_session_turn_idx`，未出现）。
`SCAN (subquery-1)` 是对子查询协程输出（≤cap=2000 行）的扫描、非基表扫描，
TEMP B-TREE 为 GROUP BY 允许形态（spec §5 判据明文）。

**路①（message 在飞集合，rowid 尾界 MAX(rowid)-8000 + 卫生窗 created 5min/
updated 90s + json_extract 判 assistant/completed-NULL；本路无窗口参数——
卫生窗锚定当下，与档位无关，单跑一档）：**

| 单次计时 | 行数/去重会话 | EQP（照录） |
|---|---|---|
| 22.99ms | 4 行 / 4 会话 | `SEARCH message USING INTEGER PRIMARY KEY (rowid>?)` \| `SCALAR SUBQUERY 1` \| `SEARCH message` |

判据①达成：`SEARCH message USING INTEGER PRIMARY KEY (rowid>?)` 在案；
无 `SCAN message USING INDEX …`（GROUP BY/DISTINCT/子查询包裹三形态的翻转
反例未出现——本路 SQL 无 GROUP BY/DISTINCT，去重在 JS 侧 new Set()）。
`SCALAR SUBQUERY 1` 内的 `SEARCH message` 是 MAX(rowid) 的 O(1) 尾点寻址。

fixture 前置（规格 §1.2 事实 4 连带修复）：`test/helpers/fixture-db.js` 的
message 索引集由虚构 `idx_message_session(session_id)` 换为真库三索引镜像
（`message_session_time_created_id_idx(session_id,time_created,id)` 先建、
`message_session_sequence_idx(session_id,sequence,time_created,id)` 后建——
建序照真库 rootpage 11→16286 实读；sqlite_autoindex_message_1 由 TEXT 主键
自动产生无需手建）。同批核对 tool_usage/model_usage 索引集无同族漂移：
model_usage 建序 started_model(66)→session_turn(67) 与 fixture 一致；
tool_usage 两 session 前导覆盖索引真库序 session_tool_call(76)→
session_turn(78) 与 fixture 相对序一致。EQP 机检（fixture）钉在
`test/signals.test.js`：在飞路 `SEARCH message USING INTEGER PRIMARY KEY
(rowid>`、近窗路 `SEARCH model_usage USING INDEX
model_usage_started_model_idx`、无基表 SCAN，18/18 绿。

2026-09-25 复验（交付会话实跑）：同探针同 SQL 重跑，两路 EQP 形态逐字
一致（路② 两档均 `SEARCH model_usage USING INDEX
model_usage_started_model_idx (started_at>?)`、路① `SEARCH message USING
INTEGER PRIMARY KEY (rowid>?)`，均无基表 SCAN）；计时 0.61ms（15min，29
会话）/ 3.18ms（24h，95 会话）/ 22.41ms（路①，13 行）——会话数与计时随
真实库活度自然变化，量级吻合。真库 rootpage 序同轮复读：message
autoindex(10)→time_created_id(11)→sequence(16286)、model_usage
started_model(66)→session_turn(67)、tool_usage session_tool_call(76)→
started_tool(77)→session_turn(78)，与上文照录一致。

---

## 2. T6 / C7-7：recap 查询族真实库 EXPLAIN + 计时（2026-09-25）

探针脚本留 `os.tmpdir()`（`zcmon-c7-7-probe.js`，只读连接）；SQL 与
`server/db.js` Recap dates 分节运行时形态逐字一致（tz=本机本地偏移
28800000=UTC+8 内联；cap=200000=USAGE_CANDIDATE_CAP_ROWS）。计时＝预热后
单次执行墙钟（附第二次值防冷页误读；spec §5 模板口径）。

| # | 查询（档） | 行数 | 计时（预热/二次，ms） | EQP（照录） |
|---|---|---|---|---|
| 1 | 日桶（week 窄窗精确） | 8 | 227.5 / 221.1 | `SEARCH model_usage USING INDEX model_usage_started_model_idx (started_at>?)` \| `USE TEMP B-TREE FOR GROUP BY` \| `USE TEMP B-TREE FOR count(Distinct)` |
| 2 | 5min 活动桶（week 窄窗） | 1706 | 221.8 / 258.7 | 同上 |
| 3 | top-focus 分组（week 窄窗，INDEXED BY 强制） | 12905 | 304.0 / 313.6 | `SEARCH … model_usage_started_model_idx (started_at>?)` \| `USE TEMP B-TREE FOR GROUP BY` |
| 4 | 日桶（month 宽窗，NOT INDEXED + rowid cap） | 13 | 404.3 / 346.3 | `SEARCH model_usage USING INTEGER PRIMARY KEY (rowid>?)` \| `SCALAR SUBQUERY 1` \| `SEARCH model_usage` \| `USE TEMP B-TREE FOR GROUP BY` \| `USE TEMP B-TREE FOR count(Distinct)` |
| 5 | 5min 活动桶（month 宽窗） | 2810 | 337.6 / 317.9 | 同上 |
| 6 | top-focus 分组（month 宽窗） | 20481 | 384.0 / 338.5 | `SEARCH … INTEGER PRIMARY KEY (rowid>?)` \| `SCALAR SUBQUERY 1` \| `SEARCH model_usage` \| `USE TEMP B-TREE FOR GROUP BY` |
| 7 | session 区间拉取（spans，A2-3 例外） | 18793 | 9.0 / 8.0 | `SCAN session`（基表全扫——出路条款管辖，显式滤出并计时照录） |
| 8 | cap 覆盖起点（MIN+rowid 尾界） | 1 | 7.2 / 6.6 | `SEARCH model_usage USING COVERING INDEX model_usage_started_model_idx` \| `SCALAR SUBQUERY 1` \| `SEARCH model_usage` |

判据逐条：

- **无基表 SCAN**（session 基表 SCAN 为 #7 的 A2-3 例外，显式滤出、计时 8-9ms
  照录）；TEMP B-TREE 分组允许（判据明文）。`SCALAR SUBQUERY 1` 内的
  `SEARCH model_usage` 是 MAX(rowid) 的 O(1) 尾点寻址，非独立扫描。
- **窄窗 INDEXED BY 强制**（#3）：`SEARCH … model_usage_started_model_idx`
  在案；翻转反例形态（`SCAN … model_usage_session_turn_idx`）未出现。
- **宽窗 NOT INDEXED + rowid 尾界**（#4-6）：`SEARCH … INTEGER PRIMARY KEY
  (rowid>?)` 在案——cap 生效的形态前提（不钉时 planner 会为省 GROUP BY 的
  TEMP B-TREE 改走 session 索引全扫，cap 形同虚设）。
- **cap 覆盖起点为 MIN+rowid 尾界形态**（#8）：`SEARCH … COVERING INDEX
  model_usage_started_model_idx`、7.2ms——OFFSET 反例形态（EQP=`SCAN
  model_usage` 133.6ms）未复现，规格 §2.3 需求 2 第 2 轮改钉达成。
- **month 档聚合 >500ms 触发线**：未触发（实测最高 404.3ms，#4）——无需
  「cap 保留/放宽」取舍变更，R-22 cap 治理维持现状；week 窄窗最高 313.6ms
  （#3）同在线内。margin 偏窄（month 档 ~80% 线位），列入 R-22 复测观察面
  （既有「7d warm >450ms 或行数 model >150k 重测」触发线继续生效）。
