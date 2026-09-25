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

## 1.5 T3 / C6-8：waiting 误报回放抽样与超线处置（2026-09-25）

探针脚本留 `os.tmpdir()`（`zcmon-t3-c68-replay.js` / `zcmon-t3-c68-retest.js`，
只读连接 + busy_timeout 5000ms；运行时窗内库活度自然前进，两脚本相隔数分钟、
主口径复核数字随窗沿漂移 ±2pp 属正常）。

**回放口径（spec C6-8 钉）**：历史时刻 t ∈ [now−48h, now−30min]（t+2min 已
流逝、30d prune 窗内），步长 10min；每时刻每会话经 started_at 索引窗
[t−15min, t) 取最新行（`INDEXED BY model_usage_started_model_idx` + 子查询
`ORDER BY started_at DESC LIMIT 2000` + 外层 GROUP BY session_id 取
bare-column+MAX(rowid)——与在线分类器 `signalsRecentModelLatest` 同源形态）；
interactive 且最新行 status='completed' → waiting 候选。后续判定＝[t, t+2min)
窗内该会话有无新 model/tool 行（两路 INDEXED BY 强制 started_at 前导索引，
禁 message 时间谓词）；有 → 误报。

**EQP 照录（三路查询）**：

| 查询 | EQP |
|---|---|
| 候选窗（model 近窗最新行） | `CO-ROUTINE (subquery-1)` \| `SEARCH model_usage USING INDEX model_usage_started_model_idx (started_at>? AND started_at<?)` \| `SCAN (subquery-1)` \| `USE TEMP B-TREE FOR GROUP BY` |
| model 后续判定 | `SEARCH model_usage USING INDEX model_usage_started_model_idx (started_at>? AND started_at<?)` |
| tool 后续判定 | `SEARCH tool_usage USING INDEX tool_usage_started_tool_idx (started_at>? AND started_at<?)` |

（`SCAN (subquery-1)` 是对子查询协程输出 ≤2000 行的扫描、非基表扫描。）

**抽样结果与处置**：

| 口径 | 样本 | 误报 | 占比 | 耗时 |
|---|---|---|---|---|
| 主口径（窗 15min，286 时刻） | 576 | 229 | **39.8%** | 82.5ms |
| 主口径复核（同法重跑） | 580 | 239 | 41.2% | 82.5ms |
| 处置 A：收窗重测（15min→8min） | 452 | 216 | **47.8%** | 63.3ms |
| 诊断变体：completed_at<t（剔除「行还在飞就被判 waiting」的膨胀面） | 421 | 97 | 23.0% | 72.5ms |
| 诊断变体 × 收窗 8min | 294 | 74 | 25.2% | 55.2ms |

- **判定：超线**（主口径 39.8% > 20% 阈值；样本 576 ≥ 30 例充足）。
- **口径近似声明**：历史时刻的在飞集合不可回放（rowid 尾界锚定当下
  MAX(rowid)），回放省略在飞排除——偏差方向保守（混入的 working 会话在 t 后
  2min 内大概率出现新行、只可能推高误报率）。诊断变体显示该膨胀面贡献约
  18pp（41.2%→23.0%），但剔除后仍超线。另按 spec 口径，「用户在 2min 内
  回复」与「agent 自续」同计误报（无法区分、spec 明文接受该代理）。
- **处置决策（spec §2.1 需求 7 二选一照录）**：收窗重测一轮已执行——
  **47.8%，不降反升**（收窗剔除「长间隙真等待」、留下「短间隙自续」，此路
  不通）；落入**降级**：waiting 徽标保留（含低置信虚线与置信标注 hover）、
  **置顶分组摘除**（views/sessions.js 降级注记 + test/signals-view.test.js
  降级态契约钉）、**C8 waiting_timeout 提醒摘除**（T4 实施约束，登记
  residuals R-28 转达）。置顶验收面（C6-4 的置顶子项）随降级处置不再在案，
  徽标/置信标注/chip/pet 接线各面不受影响。
- 顶栏 waiting chip 保留的依据：降级条款字面摘除面为「置顶与 C8 waiting
  提醒」；chip 是 C6 需求 4 的面板常驻信号显示（非打扰性提醒、自带低置信
  披露 hover），与徽标同族保留。

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


---

## 3. T4 / C8-7：notify 引擎取数 SQL 真实库 EXPLAIN + 计时（2026-09-25）

探针脚本留 `os.tmpdir()`（`zcmon-c8-7-probe.js`，只读连接 + busy_timeout
5000ms）；SQL 与 `server/notify.js` 取数层运行时形态逐字一致（参数内联）；
计时＝预热/二次单次执行墙钟。waiting 判定复用 C6 查询族与分类器
（sessionsWithSignals，C6-7 判据、无独立时长 SQL），不重复照录。IN 探针
取近 15min 活跃域前 10 会话（引擎真实域 ≤SIGNALS_MAX_ROWS=2000 有界）。

| # | 查询 | 行数/值 | 计时（warm/second，ms） | EQP（照录） |
|---|---|---|---|---|
| 1 | error_burst model 窗计数（5min） | c=0 | 0.168 / 0.022 | `SEARCH model_usage USING INDEX model_usage_started_model_idx (started_at>?)` |
| 2 | error_burst tool 窗计数（5min） | c=7 | 1.734 / 0.017 | `SEARCH tool_usage USING INDEX tool_usage_started_tool_idx (started_at>?)` |
| 3 | token 会话内 SUM（IN(10) + 30d 下界） | 1 会话 s=1619033 | 0.160 / 0.017 | `SEARCH model_usage USING INDEX model_usage_session_turn_idx (session_id=?)` |
| 3b | 同上对照（去掉 30d 下界） | 同值 1619033 | 0.076 / 0.015 | 同上（计划不变；30d prune 下两形同值——保留窗谓词是口径诚实项，不付计划代价） |
| 4 | inactive 最新行时间戳（rowid=MAX(rowid)） | started_at=…099243 | 0.014 / 0.004 | `SEARCH model_usage USING INTEGER PRIMARY KEY (rowid=?)` \| `SCALAR SUBQUERY 1` \| `SEARCH model_usage` |
| 5 | inactive 24h 存在性探测 | hit=1 | 0.020 / 0.004 | `SEARCH model_usage USING COVERING INDEX model_usage_started_model_idx (started_at>?)` |

判据逐条：**无 SCAN**（#4 的 `SCALAR SUBQUERY 1` 内 `SEARCH model_usage`
是 MAX(rowid) 的 O(1) 尾点寻址，非独立扫描）；窗计数走 started_at 索引
（#1/#2/#5）、会话内 SUM 走 `model_usage_session_turn_idx`（#3，spec 钉）
、rowid 尾点寻址（#4）。

**单次评估 tick 总耗时**（全四规则开启的最重形态——默认形态仅
error_burst+waiting_timeout 两规则开启，取数更少）：经
`ZCODE_DB=<真库> node -e` 起 makeNotifyEngine 后计时 `evaluate()`＝
**warm 35.1ms / second 15.7ms**（含 sessionsWithSignals 三路 + 窗计数两路
+ IN SUM + 标题补齐 + inactive 两路）——30s tick 节奏下事件循环占用可忽略
（红线 2）。真实评估出的候选：error_burst×1（5min 窗 tool 7 行）+
token_threshold 多会话（近窗 dwf actor 30d 累计 1M-5M+ 档，验证了同 tick
跨档形态——引擎已加发送侧档位收敛，见 test/notify.test.js 收敛用例）。

**源码契约**：notify.js 无全表 GROUP BY session 的无界聚合（唯一 GROUP BY
session_id 语句在 `session_id IN (有界)` 寻址内，test/notify.test.js 源码
契约钉）；`text/event-stream` 写头点全 server/ 仍 2 处（live.js/index.js）。

**waiting_timeout 默认关（R-28 处置，与本节 SQL 无关的实施约束照录）**：
T3 的 C6-8 误报回放抽样 39.8% 超 20% 线（§1.5），spec §2.1 需求 7 降级条款
生效——C8 waiting_timeout 提醒面摘除。本任务按处置决策落「默认关」臂
（`RULE_DEFAULTS.waiting_timeout.enabled=false`，判定/冷却/强度语义照
spec §2.2 原文实现并保留，测试用显式开启钉；收口/终审裁决摘除或维持
默认关）。spec §2.2 需求 2 表与交付默认的偏差即此一处，其余三规则与表
逐项相等（test/notify.test.js 默认值钉）。

**7396 冒烟（真库只读，2026-09-25）**：`PORT=7396 OPEN_BROWSER=0
HOST=127.0.0.1` 起服 → `/api/health` 200（ok/freshness ok）→ SSE
`/api/live/events` 客户端挂 38s，**首个引擎 tick（boot+30s）即收到
`event: notify` 帧**（真库实况：error_burst，5min 窗 7 行 tool 错误——
并行波工作流的真实数据）：

```
data: {"id":"error_burst:all:1790326289715","rule":"error_burst","title":"错误爆发","body":"近 5 分钟内错误 7 行（model 0 + tool 7）","severity":"err","intensity":"sound","at":1790326289715}
```

全链路（boot→单例装配→30s tick→真库评估→共享 bus→live.js per-connection
转发→客户端帧）实测打通；服务端日志零 `[notify]` 错误；进程 SIGKILL 回收、
端口复查无 LISTENING。

---

## §T8 C12-7 导出端点真机冒烟（2026-09-25，PORT=7393 专属口，真实库只读）

EXPLAIN 不适用——C12 同源钉（export 消费源端点相同查询函数，零新 SQL，C12-2 源码契约+测试已证）。本节为下载对照照录：

- usage 核心数值与源端点逐位一致：`GET /api/export/usage?window=24h`（包络）data.timeline=100 / totals.turns=924 / totals.model_requests=22899 / meta.truncated=false == `GET /api/usage/turns?window=24h` 同字段；schema_version=1、meta.retention_days=30、generated_at ISO。
- 三数据集两格式各下载一次：overview.json 23,756B / overview.csv 610 行（kpis=19、speed=9、recent_speed=500=50 行×10 字段、series=25=JSON series.length、by_model=6=JSON、by_tool=50=JSON）/ usage.json 36,479B / usage.csv 101 行（=JSON timeline 100+首行）/ recap.json 3,005B（days=8）/ recap.csv 9 行（=JSON days 8+首行，列集 date,tokens,calls,sessions,active_minutes,parallel_max）。
- 响应头：`Content-Disposition: attachment; filename="zcode-monitor-usage-24h-20260925T085508361Z.csv"`、`X-Zcode-Monitor-Export-Schema-Version: 1`（json/csv 双形态）、`Content-Type: text/csv; charset=utf-8`、`X-Content-Type-Options: nosniff`（全局头不破坏）。
- 端口纪律：起服前 netstat 无 LISTENING（仅两条历史 CLOSE_WAIT/FIN_WAIT_2 客户端尾巴，不阻塞 bind），结束后杀净（pid 见下）。

---
