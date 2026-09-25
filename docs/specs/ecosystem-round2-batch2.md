# 生态采纳需求规格 · 第二轮第二批（ecosystem-round2-batch2）

- 日期：2026-09-25（SGT）
- 状态：**草稿（第 1 轮 26 条 + 第 2 轮终轮 12 条评审意见均已逐条落实——第 2 轮：major 2（cap 覆盖起点 SQL 形态实测改钉 MIN+rowid 尾界/hover title「待批」自相矛盾勘正）、minor 3、note 7，含两条第 1 轮未尽职守的重申意见（C12 同源钉提取重构授权、C12 拍板授权链披露）本轮补落实；**C12 实施前置条件＝用户拍板确认（§1.1 表 ④）**；待终审）**
- 分支/实施位置：worktree `F:/project/zcode-monitor-plan`，分支 `feature/ecosystem-round2-batch2`（本会话 git 实测：分支已在位、工作树 clean，HEAD `2c3fd0a`——已含 R-8 销账轮 `6d979ae` 与 batch1 全部成果）；主仓库 `F:/project/zcode-monitor` 与 `C:/Users/18086/.zcode` 一律只读。
- 上游指针：范围定义＝用户 2026-09-25 拍板（C6+C8→C7→C10/C11 后续，分析 §1.1）+ **C12 导出夹带（授权链披露见 §1.1 表 ④——三处书面拍板记录均不含 C12，实施前置条件＝用户确认）** + `docs/analysis/ecosystem-scan-round2.md` §1.2 拍板清单/§2.4 勘误/§2.5 硬红线/§3.0 统一抽象/§4 风格约束/§7 风险红线表及 C6/C7/C8/C12 各节全文（worktree `2c3fd0a`）；候选间衔接与 L1-L3 分层按同文档 §3.0。
- 格式与深度参照：`docs/specs/ecosystem-round2-batch1.md`（Given/When/Then + `[测试]`/`[命令]`/`[评审]` 标注法、现状锚点/需求分节形态沿用）。
- 代码现状锚点：2026-09-25 本会话实读/实测 `server/db.js`（分节与 sessionList）、`server/livegen.js`、`server/routes/live.js`、`server/routes/overview.js`、`server/routes/usage.js`、`server/routes/sessions.js`、`server/http-hardening.js`、`server/index.js`、`public/pet-state.js`、`public/pet.html`、`public/widget.html`、`public/views/sessions.js`、`public/index.html`、`test/helpers/fixture-db.js`、`test/frontend-contract.test.js`，并 grep 实测 R-8 残留与 `text/event-stream` 写头点——本文行号以 `2c3fd0a` 为准；现状以代码为准，与上游分析冲突处以代码实读结果标注。第 1 轮评审证据复核（真库只读 sqlite_master 索引集、四族 SQL EQP+计时、前端 pending/轮询/布局 grep）同在本会话完成，结论已并入 §1.2 事实 4/5 与各需求钉。
- 验收条数：37 条（C6×9 / C8×8 / C7×9 / C12×7 / R-8×2 / 全局×2），逐条可判定完成与否。

---

## 1. 背景与目标

batch1 已交付数据基座层（C1/C2/C5/C9：窗口级聚合、上下文水位、火焰图、新鲜度与空态）。本批按拍板序列取**消费面层与增强层入口**四条 + 一项销账落地：C6 会话状态信号与 waiting 一等公民化（「别让 agent 卡在等待」是监视器的核心 actionable 价值，三路侦察独立点名）、C8 本地提醒体系（提醒是监视器的终点价值——用户不在屏幕前时监视才有意义；依赖 C6 分类器，排其后）、C7 active hours 口径升级 + 周/月叙事回顾页（修正既有「时长」统计的并行重复计时缺陷）、C12 仅导出部分夹带（机器可读出口的最低成本切片）、R-8 销账落地。

本批目标一句话：**在不新增任何运行时依赖、不碰 `~/.zcode` 一个写入字节、不加第三条 SSE 通道的前提下，把「哪个会话在等我」做成面板最显眼信号、配一套默认防噪的本地提醒，补一周/月叙事回顾与统一导出口。**

### 1.1 拍板记录（2026-09-25 用户，三项）

| # | 拍板 | 对本批的含义 |
|---|------|------------|
| ① | R-8＝系统字体为最终形态 | 本批落地销账（实况：已由 `fix/r8-system-fonts` 轮完成并合入本批基线 `2c3fd0a`——见 §2.5，本批为守护与状态确认，非重复实施） |
| ② | C3＝先只批本地基座（远程配额链路未批） | 本批 C3 完全不动工；「本地基座已获批、待后续批次」登记入 residuals（C8 的 token 阈值规则按扫描文档约束用既有会话级查询，不建 C3 模块） |
| ③ | C15＝无手机看的需求则不急 | 本批不做，不留桩 |
| ④（**待确认**） | C12＝导出部分夹带 | **授权链披露（第 2 轮评审工程边界席两轮重申后落实）**：书面拍板链（本表①-③、AGENTS.md 当前状态、分析 §1.1「后续批次优先序 C6+C8→C7→C10/C11」）三处均不含 C12；C12 入批依据仅为本规格上游指针单方声称的会话序列口径。**实施前置条件＝用户确认**（拍板记录增补或实施轮明示均可）；未确认则 C12 整节裁撤、§8 交付顺序表序 6 摘除，C6/C7/C8/R-8 不受影响 |

### 1.2 地基事实（均出自上游分析实测与本会话核读，口径义务的依据）

1. **approval_status 不承载 pending**（两轮实测，分析 §9-4）：2026-09-22 `pet-state.js:27-29` 记录尾部全 'none'、permission 表 0 行；2026-09-25 复测 7d 窗 160,827 行全 'none' + 1 行 'denied' 系终态回填——该列只记终态。**C6 v1 的 waiting 判定不得依赖该列**，按时间启发式 + 置信标注落地；复测路径＝真实触发一次权限批准流后尾部抽查，出现非终态值再升级判定。
2. **30 天 prune 覆盖三表**（分析 §2.4 勘误，2026-09-25 只读实测）：turn_usage 13,776 / tool_usage 547,227 / model_usage 404,782 行，三表最早行均 ≈2026-08-25——**年尺度 token 指标无 30 天外数据源**；30d 宽窗 rowid cap（`USAGE_CANDIDATE_CAP_ROWS=200_000`）与 7d 重测触发线是既有治理（usage-accounting.md §8 增补、residuals R-22），C7 月/年档并入同一治理。
3. **session 表跨 2026-06-07 起、1.84 万行级**（分析 §2 家底）：活动维度可跨窗；session 表无时间列索引，根扫描受 A2-3 出路条款管辖（usage-accounting.md §1），EXPLAIN 机检须显式滤出该基表 SCAN（batch1 先例）。
4. **message 表无时间前导索引**（2026-09-25 本会话只读实测 sqlite_master，第 1 轮评审修正）：message 实有 3 个索引——`sqlite_autoindex_message_1`（TEXT 主键自动索引）、`message_session_time_created_id_idx(session_id,time_created,id)`、`message_session_sequence_idx(session_id,sequence,time_created,id)`——两个二级索引的 `time_created` 均为**非前导第二列**，时间谓词单独不可索引寻址；C6 在飞判据必须走 rowid 尾界（livegen.js:55-72 同款形态），禁止时间谓词全表扫（历史事故：message 全表扫 2.4s）。**连带事实（fixture 镜像失真，本批必须修）**：fixture-db.js:94 现仅建 `idx_message_session(session_id)`（真库无此名索引）——fixture 须把 message 索引集镜像为真库上述三索引（tool_usage 索引镜像失真的同族修正先例：fixture-db.js:48-66 注释），否则 §7.4 EQP 机检对 message 侧查询守护失效（本轮 blocker 的温床）。
5. **message/model_usage 的 GROUP BY session_id 会翻转索引计划**（2026-09-25 本会话真库只读 EXPLAIN 实测）：① livegen 判据 SQL 加 `GROUP BY session_id` 后从 `SEARCH message USING INTEGER PRIMARY KEY (rowid>?)` 翻转为 `SCAN message USING INDEX message_session_time_created_id_idx`（索引全扫；`DISTINCT session_id` 与「子查询包裹 GROUP BY」两种写法同翻——后者被 SQLite 查询扁平化优化合并回外层）；② `WHERE started_at >= ? GROUP BY session_id` 从 started_at 窗 SEARCH 翻转为 `SCAN model_usage USING INDEX model_usage_session_turn_idx`（全索引扫，真库实测 1804.8ms/次——db.js:215-225 注释记载的同款事故形态，解法 `INDEXED BY model_usage_started_model_idx` 强制即在该处，强制后 2.8ms）。**C6 新增 SQL 的形状必须绕开这两处翻转**（§2.1 需求 2 钉死合规形态；`GROUP BY` 匹配某个索引最左列时 planner 宁可全索引扫也要免 TEMP B-TREE，是翻转机理）。
6. **R-8 已落地**（本会话实测）：pet/widget 两页无活体 `@import`（widget.html:47 仅存解释性注释）、`http-hardening.js` CSP 与 `styles.css` 无 fonts.googleapis/gstatic 域；契约钉在 `test/frontend-contract.test.js:46`。

---

## 2. 范围

### 2.0 口径继承与本批新增拍板（规格前置，实施必须遵守）

**继承既有决策（本批不得推翻）**：

- **速度生成口径**（分母剔 TTFT，ΣMAX(duration−ttft, 1ms)、NULL 回退全时长）——C7/C12 复用任何速度数字时直接取 `overviewSpeed`/`recentSpeed` 既有输出，不自造第二套。
- **token 总量口径**＝`SUM(computed_total_tokens)` 官方预计算权威值（usage-accounting.md §2 分支 A），C7 日桶/C8 token 阈值/C12 导出一律沿用。
- **models-meta 官方大小写不敏感匹配语义**（R-23 登记）——本批不改 `server/models-meta.js`；若新增消费面经既有 resolve 通路取窗口值。
- **WP 系列**：`ROW_ANIMS` 9 行动画契约不动（C6/C8 的桌宠接线全部复用既有行，含已就位的 `waiting_permission` 行）；sanitize 消毒模块出口复用（C8 气泡）。
- **性能红线措辞**：照录见 §4，库规模锚点 18GB（分析 §2 ls 实测）。

**本批新增拍板（规格职责，出现歧义以本节为准）**：

1. **C6 三态优先级**：`working（在飞）> broken（近窗 error）> waiting（时间启发式）> idle`。在飞会话的近窗 error 行属既往回合，不降级为 broken（分类器输入两路并列、优先级如上）。
2. **C6 waiting 候选限交互主会话**：`task_type='interactive'` 的会话才可进 waiting——subagent/subagent_child/workflow_child/selection_side_chat 的完成是后台行为，不构成「等用户」（误报风暴主源，直接在分类器入口过滤）。
3. **C8 提醒通道**：SSE 新**事件类型** `notify` 挂既有 `/api/live/events` 通道（overview.js:456/sessions.js:449/widget.html:333 已订阅；pet.html 增订阅该通道——widget.html:333 同款先例）；**`text/event-stream` 写头点保持 2 处**（live.js:29 与 index.js:226，本会话 grep 实测基线，batch1 C2-7 钉延续）。`/api/gen/events` 不动（livegen 事件面零耦合）。
4. **C7 本地日界**：recap 日桶按**服务器本地时区自然日 00:00** 切分（`startOfDayMs` db.js:166-170 先例；对齐官方 `queryAppUsage` 的 dayIndex/tzOffsetMs 维度），tz 偏移随响应披露。
5. **C7 activeHours 去重口径（双档）**：week/month 档＝**事件级**——model_usage 行（一次模型请求＝一次活动事件）投到 5 分钟桶，`COUNT(DISTINCT 桶)` 跨会话去重（并行会话同桶只计一次），「N× parallel」＝桶内并行会话数的 max/avg；year 档＝**会话区间上界**——session 表 `time_created→time_updated` 区间并集（interval union，跨窗可用；span 含挂机时间，如实标注上界性质）。事件源不用 message 表（无时间索引，§1.2 事实 4）。
6. **C7 环比**：仅 week 档提供（token+活动两维）；month/year 档**前一周期完整数据不可保证**（30 天 prune 下月末请求时上一周期必缺、月初请求时仅部分仍在窗内——第 1 轮评审措辞精确化），不显示环比、界面注明原因（诚实原则）。
7. **C12 机器可读面从严**：白名单外 dataset/format 一律 400，不做静默回退（导出是机器消费面，回退会静默改变格式契约——与窗口参数「未知回退」先例（overview.js:13-22）有意不同，差异在消费方是人还是脚本）。

### 2.1 C6 会话状态信号与 waiting 一等公民化（P1 · M）

**用户故事**：作为用户，我要面板最显眼处直接回答「哪个会话正在等我」——working/waiting/idle 三态 + 错误红黄徽标 + needs-attention 置顶，桌宠同步换上 waiting 动画行。

**现状锚点（2026-09-25 实读）**

- 9 行契约中 `waiting_permission` 行已就位、心情链未接线：`pet-state.js:15-17`（ROW_ANIMS 含该行）、:25-32（预留位次与**接线三步**——SSE 分派加 `permHoldUntil`；`computeMood` 的 gen 之后插入 `if (now < s.permHoldUntil) return 'permission';`；`animFor` 已备好）、:47（`permission→waiting_permission` 映射已存在）。
- 在飞判据先例：livegen.js:63-72 主查询（message rowid 尾界 `MAX(rowid)-8000` + 卫生窗 created 5min/updated 90s + `json_extract` 判 assistant/completed-NULL）——但 livegen 只回全局计数，`state()` 不含会话 id 集（livegen.js:183）。
- 会话列表：`/api/sessions` → `sessionList`（db.js:531-592，两段查询 + 页内 IN 寻址聚合 + latestModel bare-column 先例）；路由钳界 sessions.js:43-53（`clampLimit(req.query.limit, 100, 500)` + `firstParam` 归一）；renderList（sessions.js:110 起）默认按 recency 排序、无信号面。
- pet 数据面：pet.html:490-547 每 5s 轮询 `/api/widget/recent`（index.js:261 直回数组——**数组响应无法附加字段**，摘要须独立端点）+ :523 订阅 `/api/gen/events`。
- 无 `server/signals.js`、无 `/api/signals*` 端点、sessions 响应无 signal 字段（本会话 grep 证实 0 命中）。

**需求**

1. **L2 `server/signals.js` 纯函数分类器**：不碰 IO、node:test 可单测（分析 §3.0 L2 层钉）。输入＝两路查询输出 + now：`{inflightSessions: Set<id>, recentModel: Map<id,{status, error_type, started_at, completed_at, latest_rowid}>, sessions: Map<id,{task_type}>}`；输出＝逐会话 `{session_id, state, confidence, waiting_since, reason}`，`state ∈ working|waiting|idle|broken`，置信：working=high（在飞判据与 livegen 同源）、broken=high（数据驱动）、waiting=**low（时间启发式）**、idle 的 `confidence` 与 `waiting_since` 均为 **null（字段存在值为 null，非缺字段——C2-4 空数据形状钉同款精神，第 1 轮评审补钉）**。判定序与 task_type 过滤按 §2.0 拍板 1/2。**waiting 起点口径（第 1 轮评审钉死，C6-5/C6-8/C8-1 三条验收的共同依赖）**：`waiting_since`＝该会话近窗**最新 completed 行的 `completed_at`**（数据派生、无状态——分类器与消费方均为「单次评估、纯输入派生」，**排除引擎跨 tick 记忆首次判定时刻的有状态形态**；已完成时长＝now−waiting_since）。**waiting_since 的 NULL 边界（第 2 轮评审钉）**：completed 行的 completed_at 为 NULL（真实库该列值域未实测）时 waiting_since 取 null——**null 会话不参与 oldest_waiting_ms 聚合**（JS `Math.max` 混入 null 得 NaN，聚合前过滤；fixture 须补 `completed`+`completed_at=NULL` 种子行，与 broken 侧 NULL 种子对称）。**broken 判据用 `started_at` 判新鲜、不用 `completed_at`**（error 行 completed_at 值域真库未实测、可能为 NULL，NULL 比较永假会漏判；started_at 与查询窗同列，行在结果集即新鲜——fixture 须补 error+completed_at NULL 种子行暴露该形态）。常量可注入：`SIGNALS_WINDOW_MS=15min`（分析 C6「窗口默认 15min 量级」）、在飞卫生窗沿用 livegen 实测值（created 5min/updated 90s）。
2. **L1 `sessionsWithSignals` 查询族**（db.js 新增独立 `── Session signals ──` 分节，不散插既有域——分节先例 :529/:967/:1272）。查询形状钉死（第 1 轮评审按真库 EQP 实测重钉，翻转机理见 §1.2 事实 5）：① 在飞集合——livegen 主查询**同款判据/卫生窗/rowid 尾界、同款无 GROUP BY**，仅把输出列换为 `session_id`（SELECT 列改写、WHERE 零改动），**JS 侧 `new Set()` 去重**——**禁 `GROUP BY session_id`/`DISTINCT session_id`/子查询包裹**（三种写法真库 EQP 实测全部翻转为 `SCAN message USING INDEX message_session_time_created_id_idx` 索引全扫，冷页实测 3667ms，红线事故形态；合规形态实测 `SEARCH message USING INTEGER PRIMARY KEY (rowid>?)` 25.5ms，行数上界＝尾界判据行 ≤8000 有界）；② 近窗最新行——`FROM model_usage INDEXED BY model_usage_started_model_idx WHERE started_at >= now-窗口` 强制走 started_at 索引（不强制则 GROUP BY session_id 匹配 `model_usage_session_turn_idx` 最左列翻转为全索引扫，真库实测 1804.8ms/次、强制后 2.8ms——db.js overviewKpis 的 sqlite_master 探测 + 回退记忆同款机制照搬，含旧库无索引回退；**回退形态披露（第 2 轮评审）**：旧库/外部 ZCODE_DB 无官方索引时回退为无强制 GROUP BY、真库实测 1237ms/次——C6 消费频率（summary 5s 轮询/notify 30s tick）下阻塞占比远高于 overviewKpis 先例（页级请求、db.js:222-225 自注「慢但可用」）；取舍＝本服务自有库恒有官方索引（回退仅罕见形态可达）、照先例接受并登记 residuals，实际部署形态频繁触发再议降频/缓存），外层 `GROUP BY session_id` 取最新伴随列（bare-column+MAX(rowid)，sessionList latestModel db.js:567-576 同款 SQLite 特性）；近窗聚合子查询行数封顶 `SIGNALS_MAX_ROWS=2000` 且**须 `ORDER BY started_at DESC LIMIT @cap`（截断保最新侧——第 1 轮评审钉：无 ORDER BY 时 SQLite 按索引升序返回、截断保最老行，被截会话将误判 idle）**（异常风暴窗护栏）。**禁止逐会话 N+1 逐查**。`task_type` 经会话 id 集补齐（两段模式先例）。**分类器输入会话域按消费场景分两形（第 1 轮评审钉）**：(a) `/api/sessions` 场景＝页内两段补齐（本条既有形态）；(b) `/api/signals/summary` 与 C8 notify 场景＝**全库近窗活跃会话域**（recentModel 全集直取，不按页裁剪、与任何行数参数无关——summary 本无行数参数，分页域会让 waiting_count 依赖 limit，语义失真）。
3. **`/api/sessions` 响应扩展**：路由层调用分类器、按 id 合并进既有行（models-meta resolve 附带 context_tokens 的同款通路，sessionList 返回形状不动）——每行新增 `signal: {state, confidence, waiting_since, reason}`（waiting_since 口径见需求 1）；无近窗活动的会话 `signal.state='idle'`（字段存在值为 idle，非缺字段——C2-4 空数据形状钉同款精神）。
4. **sessions 列表三态徽标 + needs-attention 置顶 + 顶栏 waiting chip（第 1 轮评审补首屏消费面）**：
   - 行内徽标：working/waiting/idle 三态位 + broken 红黄错误徽标叠加（类目色+color-mix 8% 透明底，§6 第 3 条）；**broken 会话的三态位渲染 idle 形态**（分类器四态、三态位只承三态；broken 的可见性由叠加徽标独占——第 1 轮评审钉，防实施发散）。
   - 置顶分组与既有列表交互（第 1 轮评审钉）：waiting/broken 会话置顶分组（needs-attention 组恒在最前，**用户切换 tokens/calls 排序时组位不变、组内改按当前排序键**）；搜索/类型过滤作用于 needs-attention 组与主列表同域，**过滤后组为空则整组不渲染（无空组头）**；waiting 限 interactive（§2.0 拍板 2），类型筛选非 interactive 时组必空、同样不渲染；排序在前端对既有 `listData` 实施、不改服务端排序语义。
   - **顶栏 waiting chip（面板最显眼处的落实——默认首屏 overview 必须可见）**：`index.html` 顶栏常驻 chip（freshness-chip/snapshot-alert 同款形态先例，index.html:50/54），app.js 轮询 `/api/signals/summary`（复用既有 getJSON；周期 **30s**——第 2 轮评审勘正：healthLoop 实测 5s 周期（app.js:199/:221 `setTimeout(healthLoop, 5000)`），原「healthLoop 同款 30s」先例数值失实；waiting 是分钟级信号，chip 降频 30s 足够），`waiting_count>0` 显示（warn 语义色）+ 点击跳 `#sessions` + hover title 含「最长等待 {oldest_waiting_ms 格式化}」（**oldest_waiting_ms 的 UI 消费面，第 2 轮评审补**），为 0 隐藏；数据获取失败静默隐藏（fail-safe，不告警）。
   - **waiting 徽标带置信标注**：低置信形态＝**虚线描边 + fg-3 及以上不透明文本色**（第 1 轮评审改——「半透明」仅限徽标底色（color-mix 8% 底本就是透明），**文本与描边不得半透明降对比**，与 §6 第 2 条 fg-4 起保 AA≥4.5:1 调和）+ hover title「启发式判定：最近一次模型活动正常收尾且当前无在飞请求——数据面无权限等待信号源，判定为时间启发式（可能误报）」（第 2 轮评审勘正：原文案「无权限待批信号」含「待批」二字，与 C6-4「新增 signal 代码段不含『待批』」机械断言直接矛盾——hover title 正属该代码段，照原文案实施必挂）。**UI 不得出现「待批/pending」语义**（batch1 C1-5 同款禁令的 C6 面——approval_status 只记终态；断言范围钉 C6-4：sessions.js 现有 7 处 pending 字样均非 approval 语义（:232-271 orphan 消息归并局部变量、:586 todo 状态色映射），禁令按「新增 signal 代码段」判定）。
5. **`GET /api/signals/summary` 新端点**（`server/routes/signals.js` 小路由，index.js `/api/*` 路由区装配）：固定形状 `{waiting_count, broken_count, oldest_waiting_ms, generated_at}`（无行数参数、无钳界面），空库/空窗全零不抛错；**会话域＝全库近窗活跃会话域（§2.1 需求 2 场景 (b)，与任何分页参数无关——waiting 计数再经分类器 task_type 过滤（拍板 2）、broken 计数含全部会话）；`oldest_waiting_ms`＝`max(now − waiting_since)`（waiting 起点口径见需求 1；**waiting_since 为 null 的会话不参与聚合（NaN 防护，需求 1 第 2 轮钉）**；无 waiting 会话时为 0）**。消费方：pet 轮询（5s 周期随既有 poll 通道另起一条 fetch，pet.html:490-492 先例形态）+ 顶栏 chip（需求 4）。
6. **pet waiting 行接线**（按 pet-state.js:27-32 预留三步，零新行）：pet.html 轮询 `/api/signals/summary`，`waiting_count>0` 时推进 `permHoldUntil`（**`Date.now() + WAITING_HOLD_MS`，`WAITING_HOLD_MS` 默认 10000=2× 轮询周期——第 1 轮评审钉：hold 锚不得复用 `ERROR_HOLD_MS`（4s）< 5s 轮询周期，照旧实施则 hold 在两次 poll 之间失效、mood 落 sleep，动画每 5s 抖动断裂一次；pet.html 侧常量、须 ≥2× poll 周期，可注入**）；`computeMood` 插入 permission 位次（gen 之后、sleep 之前）；`animFor` 零改动。**`ROW_ANIMS` 长度与次序不变**（pet-state.test.js 既有契约守护继续绿）。
7. **误报可接受阈值（启发式-only 验收标准，分析 C6 收窄要求的落地）**：waiting 误报判定口径＝判定时刻 t 后 **2 分钟内**该会话出现新 model/tool 行（未等用户即自续）计误报；真机抽样 ≥30 例（不足 30 例时如实申报样本数，不凑数）误报占比 **≤20%** 为过线；超线处置二选一并照录：收窗重测（15min→8min）一轮，或降级（waiting 徽标保留、置顶与 C8 waiting 提醒摘除）+ 登记 residuals。C6-8 为本条的 [命令] 承载。

### 2.2 C8 本地提醒体系（P1 · M，排在 C6 之后）

**用户故事**：作为常挂监视器的用户，任务出错、会话等我太久、单会话 token 烧穿阈值时，用恰当强度提醒我——而平时绝不被噪音打扰。

**现状锚点（2026-09-25 实读）**

- SSE 拓扑：`/api/live/events`（live.js:27-59，per-connection rowid 水位，发射 `event: model|tool`；overview.js:456、sessions.js:449、widget.html:333 已订阅）；`/api/gen/events`（index.js:224-226，livegen 事件透传；pet.html:523、widget.html:363 已订阅）。写头点 2 处（live.js:29、index.js:226，本会话 grep 实测）。
- 消毒模块：`public/sanitize.js`（window.SanitizeSpeech，双端导出——pet 气泡文本出口复用，WP4 体系）。
- 无 `server/notify.js`、无 notify 事件类型（本会话 grep 证实 0 命中）。

**需求**

1. **L2 `server/notify.js` 规则引擎**（工厂 `makeNotifyEngine({...})` 依赖全注入可测，makeHealthRoute 先例）：**process 级单实例**（index.js 装配，livegen 先例），评估在**自有定时 tick（默认 30s，unref'd，常量可注入）**执行——不在任何请求路径、不在 live.js 的 per-connection poll 内（多客户端下重复评估且阻塞发射，明确禁止）；评估内全部 SQL 走 started_at 索引窗或 rowid 尾界/会话复合索引，单次评估有行数上界。触发经全局 EventEmitter 广播；live.js 路由处理器为每连接订阅该 emitter、转发 `event: notify` 帧、close 时退订（写头点不新增）。**回放边界（第 2 轮评审声明，第 1 轮意见重申后落实）**：notify 是**即发即失**事件——live.js per-connection 水位（连接时 MAX(rowid)，不回放，R-20 同族）决定连接建立前/断线重连间隙触发的提醒**永久错过、不补发**；错过可见性兜底＝顶栏 waiting chip（常驻轮询服务端拉取，不依赖 SSE 在线）与 sessions 页刷新；该边界登记 residuals（「notify 无回放，错过即失——chip 轮询兜底」）。
2. **规则集与防噪组合默认值（本 Spec 拍板，服务端常量、全部可注入）**：

   | 规则 | 默认开关 | 触发条件 | 冷却 | 内建强度 |
   |---|---|---|---|---|
   | error_burst 错误爆发 | **开** | 5min 窗内 error 行（model+tool）≥3 | 10min（全局） | sound（短提示音+气泡，不发系统通知） |
   | waiting_timeout 等待超时 | **开** | interactive 会话 waiting 态持续 ≥5min（持续＝`now − waiting_since`，起点口径＝§2.1 需求 1 数据派生、无状态；消费 C6 分类器输出，引擎内直接调用分类器与查询，无 HTTP 自环；**会话域＝全库近窗活跃 interactive 域，§2.1 需求 2 场景 (b)**） | 15min（per-session） | alert（系统通知+提示音+气泡） |
   | token_threshold 单会话阈值 | **关** | 单会话累计 `SUM(computed_total_tokens)` ≥ 1,000,000（**累计口径＝30 天保留窗内累计**——三表 30d prune（§1.2 事实 2）下跨月历史不计、长会话阈值触发系统性延迟，属已知口径边界：气泡文案与 How/口径册如实披露「按 30 天保留窗口径」，第 1 轮评审钉） | 每会话每档位一次（1M/5M/20M 三档） | quiet（仅气泡） |
   | inactive 不活跃 | **关** | 全库无 model 行 ≥30min 且 **24h 窗内曾有活动**（「窗口内」量化＝24h——overview 缺省窗同款量级，第 1 轮评审补默认值；服务端常量可注入） | 60min | quiet |

   防噪设计：每规则独立开关与冷却；冷却维度如上（全局/per-session/每档位一次）；**评估在 tick 内异步语义执行（查询有界、不阻塞事件循环）**。token 阈值规则取数＝近窗活跃会话集合（C6 查询输出）经 `model_usage_session_turn_idx` 会话内 SUM（sessionList latestModel 两段模式先例）——**禁止全表 GROUP BY session 的无界聚合，不建 C3 模块**（拍板 ②）。
3. **SSE `notify` 事件载荷**：`{id, rule, title, body, severity, at, session?}`。**id 生成钉（第 2 轮评审，第 1 轮意见重申后落实）**：`` `${rule}:${session ?? 'all'}:${at}` ``（本地模板串——零新依赖（不引 uuid 包，依赖红线）、同 tick 多规则/多会话不撞、消费方仅用于展示与去重不解析语义）。**severity ↔ 规则映射钉（第 2 轮评审）**：error_burst→`err`、waiting_timeout→`warn`、token_threshold→`warn`、inactive→`ok`（`severity ∈ ok|warn|err` 复用语义色 §6 第 3 条；与内建强度 quiet/sound/alert 是**两个正交轴**——severity 管视觉色、强度管通道，一一对应关系如上钉死防实施自造）。`body` 含会话标题等库内字符串（服务端生成仍视为不可信输入，消费侧消毒）。
4. **三页消费**（index/widget/pet）：浏览器 Notification API + WebAudio 短提示音（均内置零依赖，§6 第 6 条）+ pet 气泡（**文本一律过 `public/sanitize.js`**）。前端配置面 v1 仅三开关：声音（默认开）、系统通知（**默认关**——未授权不自动请求 `Notification.permission`，仅用户显式开启时请求）、TTS（**默认关**，Web SpeechSynthesis 内置）；localStorage 持久化。强度分级为规则内建（表列 quiet/sound/alert），v1 不提供 per-rule 用户自定义（登记 residuals）。**降级矩阵（第 1 轮评审钉，三页统一实现）**：实际呈现＝内建强度 ∩ 已开启通道；alert 在系统通知默认关（声音开）时＝**提示音+气泡**（即出厂默认形态）；声音再关时＝仅气泡；sound 同理降为气泡；**气泡是三页恒在的底线通道（页内信息、非打扰通道、不受开关控制）**。**widget 呈现形态（第 1 轮评审钉）**：胶囊单行窗（widget.html:60-70 左锚定+nowrap 契约）内不弹窗、不加宽窗体——notify 呈现为**速度数字行下方的临时副行**（batch1 C2「缓存命中副行」同款通道：severity 语义色文本、出现后 8s 淡出、多条时只显最新一条）。
5. **明确不做**：webhook 通道（分析 §8 全本地闭环）；TTS 引擎依赖（kokoro/voicevox——§8-14，内置 SpeechSynthesis 可选替代）；DND/勿扰时段调度（未拍板，按需后续）。

### 2.3 C7 active hours 口径升级 + 周/月叙事回顾页（P1 · M）

**用户故事**：作为用户，我要「这周/这个月花在哪了」的叙事回顾——Top focus、活跃时长（并行去重后）、sparkline 与环比，并且永远看得到口径与覆盖边界。

**现状锚点（2026-09-25 实读）**

- 日界先例：`startOfDayMs`（db.js:166-170，本地时区自然日 00:00）；`today` 窗口径 overview.js:17/trace.js:16 同源。
- 窗口/规模治理先例：`makeUsageRouter` 工厂 + `resolveWindow` 共享 helper（usage.js:26-45）+ `wideWindowScope` 的 30d cap `meta.scope` 申报（usage.js:20-24）；R-22 重测触发线（7d warm >450ms 或行数 model >150k/tools >180k）。
- 会话两段聚合与 directory：sessionList（db.js:531-592）；session 表列含 `directory`（fixture-db.js:14-16）。
- 无 `recap` 查询族/路由/视图；nav 现为 8 视图（index.html:35-42）。

**需求**

1. **L1 `recap-dates` 查询族**（db.js 新增独立 `── Recap dates ──` 分节；分析 §3.0 L1 钉）：
   - `recapDailyUsage`：model_usage started_at 索引窗 → **本地日界日桶**（SQL 侧 `(started_at + @tzMs)/86400000` 整除分桶，tz 由路由层取服务器本地偏移注入；每桶 tokens=SUM(computed_total_tokens)/calls/sessions COUNT DISTINCT）。
   - `recapActivityBuckets`：同窗行投 **5 分钟桶** `GROUP BY (started_at+@tzMs)/300000`，每桶 COUNT(DISTINCT session_id)——activeMinutes=有活动的桶数（跨会话去重即并行去重），`parallel_max/parallel_avg` 由桶级分布派生（§2.0 拍板 5）。
   - `recapTopFocus`：两段模式——窗口行 GROUP BY session_id **`INDEXED BY model_usage_started_model_idx` 强制（第 1 轮评审同族延伸，本会话真库 EQP 实测：无强制则与 §1.2 事实 5② 同款翻转为 `SCAN ... model_usage_session_turn_idx` 全索引扫 1250ms、强制后 SEARCH 167.8ms；sqlite_master 探测+回退同 db.js overviewKpis 机制）** → session 表页内取 `directory` → JS 归并 by directory（tokens/calls/sessions/activeMinutes）。`recapDailyUsage`/`recapActivityBuckets` 的分桶表达式 GROUP BY 不匹配索引最左列、真库实测恒走 started_at SEARCH + TEMP B-TREE（安全形态照录，防实施改列式分桶时无意引入 session 前导列）。
   - `recapSessionSpans`：session 表 `time_created/time_updated` 区间拉取（**基表 SCAN，A2-3 出路条款管辖**——1.84 万行小表，实测计时照录、机检显式滤出）→ JS 侧 interval union（year 档活动上界口径）。
2. **新路由 `server/routes/recap.js`**：`GET /api/recap?period=week|month|year`（工厂形态，retentionDays/tz 可注入）；period 缺省 week、未知值回退 week 且回显 `'week'`（resolveWindow 先例）；period_start＝week=now−7d、month=本月 1 日（本地）、year=本年 1 月 1 日（本地）。**规模治理并入 R-22 同治**：week 档走 started_at 精确窗；month/year 档 token/活动桶走 `USAGE_CANDIDATE_CAP_ROWS` 同款 rowid 尾部候选集钳制（宽窗 ≥8d 判定，db 层既有机制直接复用），`meta.scope` 如实申报。响应 meta 必含：`retention_days=30`、`period`、`period_start`、`tz_offset_minutes`、`token_coverage_from=**max(period_start, now−30d, cap 覆盖起点)**`（ISO；**cap 覆盖起点**＝cap 生效时 rowid 尾部候选集最早行 started_at——`SELECT MIN(started_at) FROM model_usage WHERE rowid > (SELECT MAX(rowid) FROM model_usage) - @cap`，**第 2 轮评审改形态**：原 OFFSET 形态（`ORDER BY rowid DESC LIMIT 1 OFFSET @cap-1`）实机 EQP=`SCAN model_usage`（133.6ms，违反 §5 自身「不含对任何表的 SCAN」判据），且「rowid 序第 N 行的 started_at≠候选集最小 started_at」存在晚落库长请求行的近似失真——两形态真库实测值不相等（…962928 vs …809330）；MIN+rowid 尾界形态实机 EQP=`SEARCH model_usage USING COVERING INDEX model_usage_started_model_idx`（15.2ms）、MIN 语义即候选集最早行零近似（batch1 cap 机制 rowid 范围尾界同族形态，db.js:1167 注释）；可按 tick 缓存；R-22 第 2 轮复测 model_usage 412,717 行、200k cap 实际只覆盖 ~14.5 天——**month 档月初日桶先被 cap 截断而非 30d prune，「自 30 天前可读」的宣称会被 cap 先证伪，三元 max 是唯一诚实公式，第 1 轮评审钉**；cap 未生效时该元取 now−30d 语义值）。
3. **30d prune/cap 披露形态与日桶边界**（口径义务）：recap 视图常驻**覆盖披露卡**——「token/请求维度自 {token_coverage_from} 起可读（官方 30 天保留{，cap 生效时追加：候选集上限 N 行、实际覆盖如上}）」；month/year 档另注 cap 申报（R-22 meta.scope 同款呈现）；year 档 token 类字段为 null（不伪造 0，C9-5 未知值原则）；year 档活动时长标注「会话区间上界口径（含挂机时间）」；环比仅 week 档、其余档注明原因（§2.0 拍板 6）。**日桶生成边界（第 1 轮评审钉）**：日桶序列自 `token_coverage_from` 对齐的本地自然日起生成——**coverage 之前的 period 内日期不产出桶行（数据不可读≠零活动，不伪造 0 桶）；coverage 之内无活动的日期产出真 0 桶（tokens=0/calls=0——「已知零」与 C9-5「未知不伪造」的区分：前者数据面在覆盖内、可断言无活动）**；覆盖披露卡与 sparkline 空洞对齐（无桶日期不从左邻插值）。
4. **新视图 `public/views/recap.js`「回顾」**：Top focus（按 directory 聚合表）、每桶要点（**week/month 档三要点：最活跃日/最大 token 日/错误计数日；year 档降级两要点：最活跃日/错误计数日——「最大 token 日」在 year 档 token 字段为 null 时不存在，不渲染该要点、不显示占位（第 1 轮评审钉）**）、日桶 sparkline（`--chart-*` 经 cssVar，主题联动重绘）、环比（week 档）、覆盖披露卡；空态经 `window.ZC.emptyState` 渲染；nav 注册 `data-view="recap"`。
5. **口径入册与 How 页**：`docs/usage-accounting.md` 新增小节「recap 口径（C7 增补）」——本地日界/5min 桶去重/并行指标/span 上界/30d 覆盖与 cap 治理；`public/views/how.js` 补 active hours 口径定义段（同要点）。

### 2.4 C12 导出部分夹带（P2 · S）

**用户故事**：作为脚本/报表消费者，我要一条统一端点把 overview/usage/recap 数据导出为 JSON 或 CSV，且格式契约可校验。

**现状锚点（2026-09-25 实读）**：`/api/overview`（overview.js:13-34 装配 kpis/by_model/by_tool/speed）、`/api/usage/turns|tools|attribution`（usage.js:50/68/82，resolveWindow+clampLimit 已治理）、`/api/recap`（本批 C7 新增）；无 export 路由（grep 0 命中）。

**需求**

1. **`server/routes/export.js`：`GET /api/export/:dataset?format=json|csv`**，dataset 白名单＝`overview|usage|recap`，format 白名单＝`json|csv`（缺省 json）；白名单外一律 **400**（§2.0 拍板 7，含可读错误码 `unknown_dataset`/`unknown_format`）。参数透传源端点值域：overview/usage 传 `window`（24h|7d|today / 24h|7d|30d，随源端点缺省与回退语义）、recap 传 `period`。
2. **同源钉（零新 SQL）**：export 路由直接消费与源端点**相同的 db.js 查询函数与共享 helper**（resolveWindow/wideWindowScope 等），禁止在 export 内出现第二套聚合或第二处窗口解析（源码契约钉；行为面＝同库同参数下核心数值与源端点逐项相等）。**提取重构授权（第 2 轮评审钉，第 1 轮意见重申后落实）**：现状 resolveWindow 是 makeUsageRouter 工厂闭包内函数（usage.js:34，module.exports 仅 makeUsageRouter）、wideWindowScope 是模块级私有——「直接消费」须经一步**结构性提取、行为零变更**重构：`resolveWindow`/`wideWindowScope` 提取到新共享模块 `server/routes/usage-window.js`（module.exports 二者；retentionDays 仍经参数注入），usage.js 改为 require 消费（签名/返回值不动）、export.js 同源消费；**重构回归证据＝既有 usage 路由测试随套继续绿（usage-routes.test.js 等零改动通过）**——该提取属 §3 非目标 11「行为不动」的授权例外（结构提取非行为变更，显式授权）；overview 内联窗口解析（overview.js:13-22）不提取（值域两套，需求 1 已注）。
3. **schema_version 包络**：常量 `EXPORT_SCHEMA_VERSION=1`。JSON＝顶层字段 `schema_version/generated_at/dataset/format/meta` + `data`（源端点载荷原形）。**meta 装配钉（第 1 轮评审）**：usage/recap 继承源端点 meta（retention_days/scope 等）；**overview 数据集例外补装**——`/api/overview` 现有响应（overview.js:25-34）为九字段复合对象、无 meta/retention_days，export 层为 overview 补装 `meta={retention_days:30, window, since}`（保留期是库级事实、usage 族 head 先例 usage.js:43；源端点零改动，§3 非目标 11 additive 钉）。CSV＝响应头 `X-Zcode-Monitor-Export-Schema-Version: 1`（JSON 双保险同带）+ `Content-Disposition: attachment; filename="zcode-monitor-<dataset>-<window|period>-<UTC时间戳>.<ext>"`。
4. **CSV 形态（每数据集固定一张矩形主表）**：**usage＝turn 时间线矩形（列同 C1 timeline 行字段）；recap＝日桶矩形（date,tokens,calls,sessions,active_minutes,parallel_max）**；**overview＝section 长表三列（section,key,value）**——/api/overview 载荷是复合对象非行集（kpis/series/by_model/by_tool/speed/recent_speed 五组无行集形态），第 1 轮评审重钉映射规则：kpis 与 speed/recent_speed 逐叶子标量展开（key 用点路径如 `kpis.model.calls`，value 为标量字符串）；series 每桶一行（key＝桶时间戳，value＝该桶对象 JSON 序列化）；by_model/by_tool 每行一行（key＝model/tool 标识，value＝行对象 JSON 序列化）——机械可执行、脚本侧 parse value 列即得结构化值。**转义钉 RFC 4180**：字段含 `,` `"` `\r` `\n` 时双引号包裹、内部 `"` 加倍为 `""`；行尾 `\r\n`；首行列名；UTF-8 无 BOM（机器可读出口优先，Excel 导入约束写入 How 页说明）。
5. **钳界**：一切行数参数经 `clampLimit`（usage timeline 默认 100/上限 500，源端点同款二元组）；recap 无行数参数（桶数由 period 决定且有界）。**行数断言分数据集钉（第 1 轮评审）**：usage/recap（行集形态）CSV 行数＝JSON `data` 行数；**overview（对象形态）无「data 行数」概念**——断言改为「CSV 各 section 行数与 JSON 对应 section 元素数相等（series 桶数、by_model/by_tool 行数、kpis/speed/recent_speed 叶子数）」，不得按行集口径断言。
6. **登记不做**：robot 一次性快照端点与 MCP 包装不做——实施轮登记 residuals（「C12 robot/MCP 未做，待需求信号」）；`?self=1` self 语义同分析原文不做；**usage 数据集固定绑定 `/api/usage/turns`（§2.4 需求 1 值域即此），tools/attribution 两端点数据不导出（覆盖面裁剪，同 robot/MCP 一并登记）——第 1 轮评审补登记**。

### 2.5 R-8 销账落地：状态确认与守护（S · 零改动预期）

用户拍板「系统字体为最终形态」。**实况（本会话实测）**：销账已由 `fix/r8-system-fonts` 轮完成并经 PR 合入本批基线（worktree HEAD `2c3fd0a` 含 `6d979ae`）——pet.html 删唯一活体 @import（widget.html 的 @import 排在 `:root` 后本就被浏览器忽略，同删属清死码，widget.html:47 现存注释为证）、CSP style-src/font-src 撤销字体域白名单（http-hardening.js:37-48 现态零外联域）、styles.css 家族名保留为本地可选；residuals R-8 已标已销账、回归钉 `test/frontend-contract.test.js:46` 在位。

本批对该条目的范围＝**守护与状态确认**（非重复实施）：验收见 R8-1/R8-2——本批任何新增前端文件不得引入外联（含 C8 通知仅用内置 API，§6 第 6 条直接适用），契约钉随全套继续绿。

---

## 3. 非目标（本批不做，出现即越界）

1. **C3 全部**——本批不动工（含本地基座）；仅登记「本地基座已获批（2026-09-25 拍板②）、待后续批次」入 residuals；C8 token 阈值规则用既有会话级查询，不建 quota 模块。
2. **C15**（LAN 手机只读镜像）——拍板③「无手机看的需求则不急」，暂缓。
3. **C10/C11**（游戏化统计/桌宠成长）——依赖 C7 输出，后续批次。
4. **C14**（会话全文检索）——单独 spike 后立项。
5. **C4/C13/C16**——后续批次。
6. **C12 robot 快照与 MCP 包装**——不做、登记（§2.4 需求 6）；`?self=1` 同不做。
7. **webhook 通道**——不做（全本地闭环，分析 §8）。
8. **TTS 引擎依赖与 DND/勿扰调度**——内置 SpeechSynthesis 可选且默认关；DND 未拍板不做（§2.2 需求 5）。
9. **approval_status 待批语义**——该列只记终态（§1.2 事实 1），本批任何 UI/字段不得赋予 pending 语义；升级判定路径（真实触发批准流后复测）仅登记，不阻塞本批。
10. **`ROW_ANIMS` 9 行契约/壳（shell/）改动**——桌宠接线全复用既有行；壳零改动。
11. **既有视图/端点行为变更**——sessionList 返回形状、/api/widget/recent 数组形态、livegen 全局 state 语义均不动（本批全部 additive）；speed/caliber 口径零触碰。
12. **新增运行时依赖/图表库**——约束重申（§4）。

---

## 4. Global Constraints（硬红线全文，违反任何一条＝返工）

1. **对 `~/.zcode/` 零写入**（只读承诺；服务以真实库只读跑冒烟是允许的）。
2. **性能红线**：真实库 18GB，每条 SQL 必须命中 `started_at` 索引或 rowid 尾界；行数参数一律经 clampLimit/clampAtLeast（server/http-hardening.js）钳界；禁止事件循环长阻塞（better-sqlite3 同步 API）。session 表基表扫描是既有 A2-3 出路条款管辖的例外（计时照录、机检显式滤出），不因此放宽其余查询。
3. **禁止直接删除文件**；临时/杂散产物 mv 到 `C:/Users/18086/Desktop/zcode-monitor-cleanup-20260923/`（禁止 rm）。
4. **一切文件编辑只发生在 worktree `F:/project/zcode-monitor-plan`（分支 `feature/ecosystem-round2-batch2`）**；绝不改主仓 `F:/project/zcode-monitor` 的文件（本机 hook 拦 main 编辑）。编辑一律用 Edit/Write 工具写 worktree 绝对路径，勿用 serena 相对路径编辑（有误写主仓前科）。
5. **子进程调用系统控制台程序（tasklist/netstat 等）必须带 `windowsHide:true`**。
6. **冒烟一律 `PORT=7399 OPEN_BROWSER=0 HOST=127.0.0.1`**；7331 是用户生产实例勿动；起服前后 `netstat -ano | grep 7399` 确认端口干净，结束杀干净自己起的进程（`process.kill(pid,'SIGKILL')` 形态，勿用可能吊死的 taskkill）。
7. **运行时依赖上限 express+better-sqlite3 两个**；前端无构建、无框架、零外联（R-8 落地后）。
8. **遗留项唯一登记处 `docs/acceptance/residuals.md`**：新遗留入册、解决销账、不删条目。

---

## 5. 逐候选验收标准

> 标注法：`[测试]`（node:test 用例，tmpdir fixture）、`[命令]`（可直接执行命令与期望输出）、`[评审]`（人工评审留痕）。EXPLAIN 命令模板（真实库只读，worktree 根执行，batch1 同款）：

```bash
node -e "
const dbq = require('./server/db');
const since = Date.now() - 7 * 86400000; // 或对应窗口
const sql = '<待验证 SQL，参数以字面量内联>';
console.log(dbq.db().prepare('EXPLAIN QUERY PLAN ' + sql).all());
console.time('q'); dbq.db().prepare(sql).all(); console.timeEnd('q');
"
```

通过判据：EXPLAIN 输出**不含对任何表的 `SCAN`**（`SEARCH ... USING INDEX`、rowid 尾界或 TEMP B-TREE 分组允许；session 基表 SCAN 为 A2-3 例外，须显式滤出并计时照录）。

### C6 会话状态信号与 waiting 一等公民化

- **C6-1** `[测试]` Given signals.js 纯分类器（node 侧 require）与 fixture 构造的输入集，When 分别注入：(a) 会话在飞集合成员→`working/high`；(b) 最新 model 行 `status='error'` 且 `started_at` 距 now ≤ 注入窗口、不在飞→`broken/high`（**判据用 started_at 钉——含 `completed_at=NULL` 的 error 行 fixture 种子（真实库该列值域未实测，NULL 比较永假不得漏判，§2.1 需求 1）**）；(c) `task_type='interactive'` 最新行 `completed` 且距 now ≤ 窗口、不在飞→`waiting/low` 且 `waiting_since`＝该行 `completed_at`；(d) 无近窗活动→`idle` 且 `confidence===null`、`waiting_since===null`（字段存在值为 null 钉）；(e) `subagent`/`workflow_child` 会话最新行 completed 且新鲜、不在飞→**idle（不进 waiting）**——task_type 过滤钉；(f) 在飞且近窗有 error 行→working（优先级钉，§2.0 拍板 1）。Then 逐分支 state/confidence/waiting_since 与 reason 断言相等；`SIGNALS_WINDOW_MS` 注入小值可测。
- **C6-2** `[测试]` Given fixture 构造（message 表：一会话 assistant 行 completed-NULL 且 time_created/time_updated 新鲜=在飞、另一会话 completed-NULL 但 time_created 距 now 6min=僵尸行；model_usage：一会话最新行 error（含一行 `completed_at=NULL` 形态）、一 interactive 会话最新行 completed 距 now 5min），When 调 `sessionsWithSignals`，Then 在飞集合恰含前者（卫生窗 5min/90s 生效）、近窗最新行聚合按 MAX(rowid) 取「写入序最新」行（**对抗样本＝构造 `started_at` 更早但 rowid 更大（晚落库长请求）的行，断言被取为最新——db.js:568-571「MAX(rowid) 非 MAX(started_at)」语义守护；第 2 轮评审勘正：原「更晚但 rowid 更大」措辞方向平凡，落库更晚 rowid 必然更大、守护不了任何东西**）；行数封顶 `SIGNALS_MAX_ROWS` 注入小值时**截断保留最新侧**（§2.1 需求 2 的 `ORDER BY started_at DESC` 钉——构造「旧行会话+新行会话、cap=1」断言新行会话在结果、旧行会话不因截断产生假信号）且不抛错；窗口参数注入生效（started_at 窗外行不计入）；fixture message 索引集＝真库三索引镜像（§1.2 事实 4 连带修复，EQP 机检前置）。
- **C6-3** `[测试]` Given 上述 fixture，When `GET /api/sessions`，Then 每行含 `signal` 字段——活跃会话 state/waiting_since 与分类器一致、无近窗活动会话 `signal.state==='idle'` 且 `confidence/waiting_since` 为 null（字段存在非缺字段）；既有字段（model_calls/total_tokens/latest_model 等）与 batch1 契约测试断言不变（additive 钉）。
- **C6-4** `[测试]`（源码契约）Given 实施完成，When 读 sessions.js renderList，Then 含三态徽标与 broken 徽标渲染代码（broken 会话三态位=idle 形态+叠加钉）、waiting/broken 置顶排序代码（needs-attention 组在最前、排序/过滤/空组交互按 §2.1 需求 4）；waiting 徽标置信标注命中「启发式」字样；**「待批/pending」禁令按新增 signal 代码段（徽标/置信/置顶/chip 相关代码）断言不含**（范围钉——sessions.js 既有 7 处 pending 字样（:232-271 orphan 归并局部变量、:586 todo 状态色）非 approval 语义且在 renderList 外，整文件断言必挂，§2.1 需求 4）；顶栏 waiting chip 契约（index.html 含 chip 元素、app.js 含 `/api/signals/summary` 轮询与跳转代码）；`server/routes/signals.js` 存在、index.js 含 `app.use('/api/signals'` 装配。
- **C6-5** `[测试]` Given fixture（含一会话 waiting 态，started_at 落在页外构造「分页域 vs 全库域」分歧行——如行数足以分页时第 2 页会话 waiting），When `GET /api/signals/summary`，Then 固定形状 `{waiting_count, broken_count, oldest_waiting_ms, generated_at}`：waiting_count/broken_count 与分类器**全库近窗域**输出一致（分页无关钉）、`oldest_waiting_ms===max(now−waiting_since)`（§2.1 需求 1 起点口径钉，无 waiting 会话时 0）；空库/空窗 → 全零 + `generated_at` 存在、200 不抛错。
- **C6-6** `[测试]` Given pet-state.js（node 侧 require），When 注入 `permHoldUntil` 未过期 + `gen=false`，Then `computeMood==='permission'` 且 `animFor('permission')==='waiting_permission'`（位次钉：gen 期间 gen 优先、error/tantrum 压过 permission）；`ROW_ANIMS.length===9` 且次序与 main 基线一致（9 行契约不动钉）；源码契约：pet.html 含 `/api/signals/summary` fetch 与 `permHoldUntil` 推进代码、**`WAITING_HOLD_MS` 常量 ≥ 2×5000（轮询周期 5s、hold 不得短于两个轮询周期——`ERROR_HOLD_MS`(4s) 形态拒收，§2.1 需求 6）**。
- **C6-7** `[命令]` Given C6 两路新 SQL（message 尾界在飞集合、model 近窗聚合），When 真实库按上文模板 EXPLAIN + 计时，Then ① message 查询＝`SEARCH message USING INTEGER PRIMARY KEY (rowid>?)`（**不得出现 `SCAN message USING INDEX ...`——GROUP BY/DISTINCT 翻转形态是本轮实证的反例，§1.2 事实 5**）、② model 查询＝`SEARCH model_usage USING INDEX model_usage_started_model_idx`（INDEXED BY 强制钉；翻转形态 `SCAN ... model_usage_session_turn_idx` 为反例），计时照录验收记录。
- **C6-8** `[命令]` 误报真机抽样（§2.1 需求 7 承载）：只读回放历史——**回放口径钉（第 1 轮评审）**：对历史时刻 t（须满足 t ≤ now−30min 且 t 在 30d prune 窗内，保证 t 后 2min 已流逝）取 waiting 判定样本：每会话经 started_at 索引窗 `[t−SIGNALS_WINDOW_MS, t)` 取最新行（INDEXED BY started_at 索引，同 §2.1 需求 2 形态）→ interactive 且最新行 completed → waiting 候选、waiting_since＝该行 completed_at（与在线口径同源）；**历史时刻的在飞集合不可回放（rowid 尾界锚定当下 MAX(rowid)），回放省略在飞排除、如实申报为口径近似——偏差方向保守：混入的 working 会话在 t 后 2min 内大概率出现新行、只可能推高误报率，不会把不合格样本洗成合格**；后续判定＝`[t, t+2min)` 窗内该会话有无新 model/tool 行（model 走 started_at 索引窗、tool 走 started_at 索引窗，禁 message 时间谓词）。样本 ≥30 例（不足 30 如实申报样本数），统计判定后 2min 内该会话出现新 model/tool 行的占比，Then 占比 ≤20% 为过线；超线时收窗重测一轮或降级置顶/提醒并登记 residuals——**照录报告必须存在**（样本数/误报数/占比/口径近似声明/处置决策），无报告即不通过。
- **C6-9** `[评审]` sessions 列表三态徽标 + needs-attention 置顶 + waiting 低置信形态双主题截图各一帧；**overview 默认首屏顶栏 waiting chip 可见帧（waiting>0 态）**；pet `waiting_permission` 动画真机帧（signals/summary 轮询驱动）留痕——**补一帧连续 15s 以上的轮询期观察记录（hold 覆盖轮询间隙、无 sleep 抖动断裂，§2.1 需求 6）**；置信标注 hover 文案评审（§6 适用注第 1/3 条）。

### C8 本地提醒体系

- **C8-1** `[测试]` Given notify.js 规则引擎（依赖注入 fixture 数据源），When 注入已知输入，Then 四规则触发语义逐项成立：error_burst 在 5min 窗 error 行 ≥3 时触发、2 行不触发；waiting_timeout 仅对 interactive 会话且**持续＝now−waiting_since（§2.1 需求 1 数据派生起点）≥5min** 触发（subagent waiting 不触发；无状态钉——**断言面＝条件评估结果**：引擎的条件评估不维护 per-session 首次判定时刻 Map，注入两次相同输入**条件评估结果**一致；**发送行为受冷却拦截是另一断言面（C8-2 独立钉），两者对象不同，第 2 轮评审区分**）；token_threshold 跨 1M 档触发一次、5M 档再触发（每档一次）；inactive 在有历史活动（24h 窗内曾有 model 行，§2.2 需求 2 量化钉）+ 无新行 ≥30min 触发。
- **C8-2** `[测试]` 防噪组合：同规则冷却窗内第二次满足条件**不**再发（error_burst 全局 10min、waiting_timeout per-session 15min 独立——A 会话触发不占 B 会话冷却）；不同规则互不冷却；**默认值钉**：四规则 on/off、冷却时长、强度与 §2.2 需求 2 表逐项相等（常量导出或注入缺省断言）。
- **C8-3** `[测试]` Given 挂载的 /api/live/events 客户端与触发的规则，Then 收到 `event: notify` 帧、载荷含 `{id, rule, title, body, severity, at}`（**id 形如 `rule:session:at`、severity 按 §2.2 需求 3 映射钉断言**）且 session 字段仅 per-session 规则携带；连接关闭后退订（无泄漏断言）；源码契约：`grep -rn "text/event-stream" server/` 命中数仍为 **2**（live.js/index.js 写头点不新增钉）；notify 评估调用点不在 routes/live.js（自有 tick 钉——live.js 内无评估调用）。
- **C8-4** `[测试]`（源码契约）三页消费：overview（或 app.js）、widget.html、pet.html 均含 notify 事件监听与呈现代码；提示音走 WebAudio（无外部音频资源引用）；系统通知默认关——`Notification.requestPermission` 调用仅在用户显式开启路径可达（默认态页面加载不请求权限）；前端三开关（声音/系统通知/TTS）默认值 声音=开、通知=关、TTS=关 钉；**降级矩阵钉（§2.2 需求 4）：三页呈现代码实现「alert∩通道」逻辑（系统通知关时 alert 强度呈现=提示音+气泡）且气泡通道不受开关控制；widget 呈现形态=数字行下方临时副行（不弹窗、不改单行窗布局契约）**。
- **C8-5** `[测试]` Given notify 载荷 `body` 含标记文本（`<img>`/引号/换行注入样例），When pet 气泡渲染路径执行，Then 输出经 `public/sanitize.js` 消毒（注入标记不存活——WP4 出口复用的行为钉）。
- **C8-6** `[测试]`（源码契约）TTS 钉：`speechSynthesis` 调用被 TTS 开关守卫且默认 false（默认关钉）；无 TTS 引擎/network 资源引用（GX-2 钉依赖面）。
- **C8-7** `[命令]` Given C8 新增 SQL（error_burst 窗计数、token 阈值会话内 SUM、inactive rowid 尾界探测；**waiting 判定复用 C6 查询族与分类器（§2.1 需求 1 completed_at 派生口径），无独立时长 SQL**），When 真实库 EXPLAIN + 计时，Then 无 SCAN（会话内 SUM 走 `model_usage_session_turn_idx`、窗计数走 started_at 索引、inactive 走 rowid 尾界；C6 查询族形状按 C6-7 判据），单次评估 tick 总耗时照录；源码契约：notify.js 无全表 GROUP BY session 形态的无界聚合（token 规则取数形态钉）。
- **C8-8** `[评审]` 三页提醒呈现双主题截图（pet 气泡+消毒文本样例、**widget 副行提示形态（§2.2 需求 4 钉的胶囊窗形态）**、index 通知卡/toast）留痕；**出厂默认形态（系统通知关）下 alert 级提醒的实际呈现=提示音+气泡，照实态核对降级矩阵**；系统通知授权流（用户显式开启→授权→收到 alert 级通知）人工复验一次并记录；防噪默认值表（§2.2 需求 2）照 UI 实态核对。

### C7 active hours 口径升级 + 周/月叙事回顾页

- **C7-1** `[测试]` Given fixture 构造跨日界行（注入固定 tz，如 UTC+8：行 A started_at=某日 23:50、行 B=次日 00:10），When `recapDailyUsage`，Then 两行分属不同日桶、桶键与注入 tz 的本地日界一致（跨本地午夜分桶钉；tz 参数注入使测试与宿主机时区无关——R2 跨午夜用例先例）。
- **C7-2** `[测试]` Given fixture 构造三会话：A 与 B 同一 5min 桶各有行、C 在相邻桶有行，When `recapActivityBuckets`，Then activeMinutes=2（同桶跨会话去重钉）、parallel_max≥2、parallel_avg 数值与构造一致（「N× parallel」钉）。
- **C7-3** `[测试]` Given /api/recap，When `?period=week|month|year` 分别请求，Then period 回显正确、period_start 分别为 now−7d/本月 1 日/本年 1 月 1 日（本地时区，注入固定 now/tz 可测）；`?period=year!`（未知值）回退 week 且回显 `'week'`；缺省=week。
- **C7-4** `[测试]` 30d/cap 披露钉：When `?period=month`，Then 响应 `meta.retention_days===30`、`meta.token_coverage_from` 为 ISO 且等于 **max(period_start, now−30d, cap 覆盖起点)**（§2.3 需求 2 三元 max 钉——cap 生效时注入可测的 cap 覆盖起点断言其参与取值：构造 cap 极小值使覆盖起点晚于 now−30d，断言 token_coverage_from 随之右移而非停在 30d 线）；month/year 档 rowid cap 生效时 `meta.scope` 如实申报（wideWindowScope 同款）；**日桶边界钉：日桶序列自 token_coverage_from 对齐本地自然日起，coverage 之前的日期无桶行（不伪造 0 桶）、coverage 内无活动日为真 0 桶（§2.3 需求 3）**；`?period=year` 时 token 类字段为 **null**（不伪造 0）；环比字段仅 week 档存在。
- **C7-5** `[测试]` Given fixture 两 directory 各两会话带已知 token 行，When `recapTopFocus`，Then by-directory 归并 tokens/calls/sessions 与构造逐项相等（两段模式行为钉）；空窗 → 空数组 + meta 完整不抛错。
- **C7-6** `[测试]`（源码契约）Given 实施完成，When 读 public/views/recap.js 与 index.html，Then `registerView('recap'` + nav `data-view="recap"` + script 引入；空态经 `/(window\.)?ZC\.emptyState\(/` 命中；「30 天」覆盖披露文案命中；sparkline 色值经 `cssVar('--chart-` 读取、无硬编码色值字面量（判据同 batch1 C5-3：`#[0-9a-f]{3,6}`、`rgba?(`、`hsla?(` 与具名色名单 0 命中）。
- **C7-7** `[命令]` Given C7 新增 SQL（日桶/5min 桶/top-focus 两段/span 拉取/**cap 覆盖起点**），When 真实库 EXPLAIN + 计时（week 精确窗与 month cap 形态两档），Then 无 SCAN（TEMP B-TREE 分组允许；session 基表 SCAN 显式滤出并计时照录——batch1 机检排除集先例；**cap 覆盖起点须为 §2.3 需求 2 钉的 MIN+rowid 尾界形态——OFFSET 形态 EQP=SCAN model_usage 是第 2 轮实证反例**）；month 档聚合实测 **>500ms** 时「cap 保留/放宽」取舍记录必须存在（C1-6 同款触发线，R-22 同治）。
- **C7-8** `[命令]` 口径入册：`grep -n "recap 口径（C7 增补）" docs/usage-accounting.md` 命中新增小节；`grep -n "active hours" public/views/how.js` 命中口径段（本会话实测两 grep 今日基线均 0 命中——命中即增量证据）；how 段含「5 分钟」桶与去重/上界表述。
- **C7-9** `[评审]` recap 页双主题截图（week 与 month 两档：Top focus 表/日桶 sparkline/覆盖披露卡/空态帧）留痕；叙事要点（每桶要点文案）人工评审；year 档「上界口径」标注与**要点降级形态（仅最活跃日/错误计数日两要点、无「最大 token 日」占位，§2.3 需求 4）**核对。

### C12 导出部分夹带

- **C12-1** `[测试]` 白名单钉（**路径参数形态，第 1 轮评审与 §2.4 需求 1 对齐**）：`GET /api/export/overview|usage|recap?format=json|csv` **六组合（3 dataset × 2 format）**全部 200；`GET /api/export/bogus` → 400 `unknown_dataset`；`GET /api/export/overview?format=xml` → 400 `unknown_format`（不回退钉，§2.0 拍板 7；**dataset 是路径参数，query 形态 `?dataset=` 不参与路由判定**）；format 缺省=json（响应头/包络回显）。
- **C12-2** `[测试]` 同源钉：Given 同一 fixture 库，When 分别请求 `/api/export/usage?window=7d` 与 `/api/usage/turns?window=7d`（recap 同法对照），Then export 包络 `data` 内核心数值与源端点响应逐项相等（tokens/calls/groups 等）；`schema_version===1`、`generated_at` ISO、`meta.retention_days===30`（**三数据集统一断言——overview 数据集的 retention_days 由 export 层补装（§2.4 需求 3），源端点 /api/overview 无该字段，不回退到源端点形状断言**）；源码契约：export 路由文件消费的查询函数名与源端点一致（同 db 函数清单钉，无第二套聚合/窗口解析——resolveWindow 复用计数）。
- **C12-3** `[测试]` CSV 转义钉：Given fixture 会话标题含 `逗号, "引号"` 与换行（构造已知毒字段），When `format=csv`，Then 输出符合 RFC 4180——含毒字段被双引号包裹、内部 `"` 加倍、行尾 `\r\n`、首行列名、UTF-8 无 BOM（Buffer 首三字节非 EF BB BF）；三数据集主表列集与 §2.4 需求 4 钉一致。
- **C12-4** `[测试]` 钳界钉：`/api/export/usage?window=24h&limit=-1` 行数钳 1、`&limit=99999` 钳 500（源端点同款二元组）；**行数一致性分数据集（§2.4 需求 5 钉）**：usage/recap CSV 行数=JSON `data` 行数（两格式同源同界）；overview 断言 CSV 各 section 行数=JSON 对应 section 元素数（series/by_model/by_tool/kpis 叶子，不按行集口径）。
- **C12-5** `[测试]` 响应头钉：`Content-Disposition` 形如 `attachment; filename="zcode-monitor-usage-7d-<UTC时间戳>.csv"`；`X-Zcode-Monitor-Export-Schema-Version: 1` 在 JSON 与 CSV 双形态均在；全局既有头（nosniff/CSP/回环闸）不因 export 路由破坏（挂载位置在 /api 闸后——装配契约断言）。
- **C12-6** `[测试]` 空态稳健：空 fixture 库三数据集导出 200——JSON data 为空集形状 + meta 完整（**含 overview 的补装 `retention_days`，§2.4 需求 3——「meta 完整」三数据集同判**）、CSV 仅首行列名，不抛错。
- **C12-7** `[命令]` 真机 7399 冒烟对照：`curl -s http://127.0.0.1:7399/api/export/usage?window=24h` 与 `/api/usage/turns?window=24h` 核心字段对照一致；三数据集两格式下载各一次，`wc -l`/行数与 JSON 对照照录验收记录（EXPLAIN 不适用——零新 SQL，同源钉 C12-2 声明）。

### R-8 销账落地（守护与状态确认）

- **R8-1** `[命令]` 状态确认：`git -C F:/project/zcode-monitor-plan merge-base --is-ancestor 6d979ae HEAD` 退出码 0（基线含 R-8 销账轮）；`grep -rn "fonts.googleapis\|fonts.gstatic" F:/project/zcode-monitor-plan/public F:/project/zcode-monitor-plan/server` 0 命中；`grep -n "@import" public/pet.html public/widget.html` 仅注释命中或 0 命中（本会话实测基线：仅 widget.html:47 注释）。
- **R8-2** `[测试]` 守护钉：`test/frontend-contract.test.js` 零外联字体契约随全套继续绿（GX-1 的 R-8 面）；本批新增前端文件（views/recap.js、routes 相关页面改动等）零外联——新增文件并入 frontend-contract 契约清单或以等价 grep 断言钉（C8 通知仅内置 API，§6 第 6 条）。

### 全局

- **GX-1** `[命令]` Given 全部实施完成，When 在 `F:/project/zcode-monitor-plan` 运行 `npm test`（node --test 聚合入口），Then 退出码 0、0 failed（batch1 收官 297 例两种计数口径全绿为基线；本批新增测试文件数与计数照录验收记录——既有契约守护随套继续绿即 §3 非目标 11 的回归证据）。
- **GX-2** `[命令]` Given 实施完成，When `node -e "console.log(Object.keys(require('./package.json').dependencies))"`（于 worktree 根），Then 输出恰为 `[ 'better-sqlite3', 'express' ]`（零新增——batch1 GX-2 同款命令）。

---

## 6. UI 风格约束（分析文档 §4 六条全文照录）

1. **双主题**：新视图/组件一律走 `:root[data-theme]` 双态 + `color-scheme` 联动；图表色经 CSS 变量 `--chart-*` 由 `getComputedStyle` 读取（主题切换自动重绘）——C5 火焰图、C10 热图/天际线、C2 水位条均按此实现，禁止硬编码色值。
2. **表面与文本栈**：卡片=surface-1+1px 边框+`--radius-lg 6px`（圆角克制 4/2/6px 档）；文本用 fg-1..fg-5 分层（fg-4 起保 AA≥4.5:1）；数字一律 tabular-nums。
3. **语义色复用**：新阈值带不发明新色——C3 配额 80%/95% 用 severity `warn #fbbf24`/`err #f87171`（浅色 #9a6700/#cf222e）；C2 上下文水位档位同理用 ok/warn/err 三档（与速度 tier <30/30-80/>80 三档约定同构）；C6 状态徽标用类目色+color-mix 8% 透明底模式。
4. **字体**：仪表盘 Geist/JetBrains Mono 栈、基准 13.5px/1.5；widget/pet 两页 Spectrum 子集（light-dark() 双态、Source Sans 3+Noto Sans SC）——**两页 token 子集保持完全一致**的现状纪律，C11 的 HUD/双环/边缘钉组件须同源双页复用一份实现。
5. **无构建约束**：全部新组件为 vanilla 模块（渲染函数或自定义元素），SVG 分享卡（C10）确定性客户端渲染、无 CDN 无外联；唯一既有外联 Google Fonts 维持 R-8 未决状态不扩大。
6. **CSP 自源**：C8 通知用内置 Notification/WebAudio API，不引入远程资源；C15 LAN 页同样受 CSP 自源钉死约束。

> 本批适用注：第 1/2/3/5 条直接约束 C6 徽标/置信形态、C7 recap 页（sparkline/Top focus 表/覆盖披露卡）与 C12 导出的机器面；第 3 条的 **C6 状态徽标类目色+color-mix 8% 透明底**与 notify `severity` 复用为本批主消费点；**waiting 低置信形态与第 2 条 AA 的调和＝「半透明仅徽标底色、文本/描边不透明」（§2.1 需求 4 第 1 轮评审钉）**；第 4 条约束 C8 的 pet 气泡与提示形态（widget/pet 两页 Spectrum 子集不扩）；**第 6 条直接适用 C8**（内置 API、零远程资源）。第 5 条「R-8 未决」表述系上游分析撰写时状态——**已被 2026-09-25 拍板①取代（系统字体终形已落地、面板零外联），本批照新状态执行（R8-1/R8-2 守护）**；C10/C11/C15 字样为上游原文照录的后续批次适用项。

---

## 7. 测试要求

1. **行为变更必带回归测试**：每候选至少一个新测试文件（建议：`test/signals.test.js`（C6 分类器+查询+路由合并+summary）、`test/notify.test.js`（C8 规则引擎+防噪+SSE 事件+源码契约）、`test/recap.test.js`（C7 查询族+口径+视图契约）、`test/export-routes.test.js`（C12 白名单/转义/包络/钳界）；frontend-contract 形态的源码契约断言并入各文件；命名实施可调，覆盖面不变）。
2. **tmpdir fixture**：全部测试经 `ZCODE_DB`/`ZCODE_LOG_DIR` 既有 env 注入指向 `os.tmpdir()` fixture（db.js:16-23 模式），绝不触碰真实库；fixture 按需增列时遵循 WP0 约定（以 db.js 现行查询所假设列集为准；本批预计无需 DDL 增列——C6/C7/C12 消费既有列；**但 message 索引集须镜像真库三索引（§1.2 事实 4，索引非列）**）。
3. **时区与时间注入**：C6/C7 涉及时间窗/日界/持续时长的判定一律常量+时钟注入（`SIGNALS_WINDOW_MS`、tz、now），测试与宿主机时区/时刻无关（R2 跨本地午夜用例先例）。
4. **EXPLAIN 机检**：本批新增查询并入既有 EQP 机检（fixture 计划形态守护）；**前置修复：fixture message 索引集镜像真库三索引（§1.2 事实 4 连带修复——现存虚构 `idx_message_session` 使 message 侧 EQP 断言守护失效，C6 message 侧查询的 fixture EQP 断言以镜像后索引集为准；同批核对 tool_usage/model_usage 索引集无同族漂移）**；C7 的 session 基表 SCAN 进入**显式排除集**（batch1「session 页查询显式滤出」先例），不允许别名形态静默逸出。
5. **真实库只读实测仅限 [命令] 条目**：EXPLAIN+计时/误报抽样/7399 冒烟对照必须只读、带 started_at 下界或 rowid 尾界，输出照录验收记录；不得为测试目的向真实库写入任何内容。SSE 页 UI 复验须 CDP 真等待（virtual-time 与 EventSource 死锁，AGENTS 实证）。
6. **全套测试由脚本统一运行**（GX-1）；实施侧自跑单文件命令：`cd F:/project/zcode-monitor-plan && node --test test/<file>.test.js`。
7. **验收无法满足或指令矛盾时如实上报（escalate），不要伪造通过**；新遗留（C12 robot/MCP、C8 per-rule 配置面、C6 误报超线处置等）一律登记 `docs/acceptance/residuals.md`。

---

## 8. 验收与交付顺序（摘要）

| 序 | 内容 | 出口判据 | 依赖 |
|---|---|---|---|
| 1 | R-8 状态确认与守护（零改动预期） | R8-1~2 | 无（先确认基线，防后续条目回退归因困难） |
| 2 | C6 分类器+查询族+路由/端点 | C6-1~3, C6-5, C6-7 | 无 |
| 3 | C6 消费面（列表徽标/置顶/顶栏 chip + pet 接线）+ 误报抽样 | C6-4, C6-6, C6-8~9 | 序 2 |
| 4 | C8 规则引擎+SSE 事件+三页消费 | C8-1~8 | 序 2（waiting_timeout 消费分类器；故 C8 整体排 C6 后） |
| 5 | C7 查询族+路由+视图+口径入册 | C7-1~9 | 无（与序 2-4 并行可行；R-22 治理随做） |
| 6 | C12 导出（复用 overview/usage/recap 源）**——待拍板确认（§1.1 表 ④），未确认则本序摘除** | C12-1~7 | 序 5（recap 数据集依赖 /api/recap 查询族） |
| 7 | 全局收口 | GX-1~2 | 全部 |

> 表注：C8 与 C7 无相互依赖，实施轮可按资源并行；交付顺序的硬依赖仅两条——C8 依赖 C6 分类器（用户拍板序列「排在 C6 之后」）、C12 的 recap 数据集依赖 C7 查询族。序 1 的 R8-2 完整通过时点在全部新增前端文件落地后（随 GX-1 一并终判）。
