# 遗留项统一登记（residuals）

- 建立：2026-09-22（全量审查 R1 加固轮）。此前遗留事项散落在各验收文档与评审
  记录里，无统一追溯点——本文件是唯一登记处：新遗留入册，已解决的销账并注明
  证据，不删除条目（保留审计轨迹）。
- 互链：实施留痕见 `docs/plans/ecosystem-adoption-v1.md`；各项验收记录见本目录。
- 2026-09-23（R2 加固轮）：更正 R-2 销账理由（原举例失实），增补 R-8～R-10。
- 2026-09-23（R3 加固轮）：改写 R-9 机制描述（原「逐 JSONL 现算」失实），增补 R-11～R-13。
- 2026-09-23（R4 双轮加固轮）：无新增登记，既有条目无状态变化。该轮落地 raw/sessions/trace/transcript 行数参数全量钳界（负值原为 SQLite 无上限 LIMIT，真实库实测最长 8.8s 同步冻结）与 slowTools 候选集规模钳制（rowid 尾界 ≤10 万行 + 30d 双保险，UI 注明口径）；R-13 的自由 where 亚秒级残余维持原判。
- 2026-09-23（快照绊线轮）：新增快照绊线功能（`server/snapshot-watch.js`，一轮五视角对抗评审后合入）；R-5 隐私横幅截图补拍销账；增补 R-14（绊线已知边界）。
- 2026-09-23（六视角终审轮，zcode-pr-review-toolkit）：绊线增量二次加固——子目录读失败从「折叠静默」改为 partial 分级（读不了的那拍不进差异也不进零点，双向防假告警/防吞活动）、截断拍（超规模钳界）拒绝锚零点、`__proto__` 目录名防护、slice 置位 truncated、未知 status 前端异常渲染、README 目录锁定矛盾修正（icacls 只拒写不拒读）。无新增登记；R-14 边界①～⑤为结构性边界，本轮修复不改变其成立性。
- 2026-09-23（洁癖收尾轮，neat-freak）：文档/记忆一致性核查——T6 两份验收文档补 R-2 销账指针、plans 行号时效声明与「勿重放」注记、specs §2 加「现状锚点为开工前快照」注、T2 复现路径注记、README 绊线卡补「首扫中」瞬时态。无行为变更，无新增登记，既有条目无状态变化。

## 登记项

| # | 事项 | 状态 | 说明与证据 |
|---|---|---|---|
| R-1 | A1-8 与 A4-7 的壳内侧（WebView2）人工实机评审 | **未决（human-gate）** | 自动化可验证项全绿，但两验收点的实机演示未执行：A1-8（真实包导入→图鉴可见→轮换可达）见 `T2-import-e2e.md`；A4-7（壳内拖动/连击/滚轮/帧率）见 `T5-behavior-e2e.md`。两文件均含复现步骤，不代填结论。 |
| R-2 | `todayLogFile()` 的 UTC 日映射读侧缺陷（本地 00:00–08:00 读不到新行） | **已销账（本轮）** | 实测依据 `T6-latency-samples.md` §4。本轮把 `tailLog` / `eventsForTrace` 一并切到 `defaultTodayFile` 的「名字最新」语义（对 UTC/本地命名都成立），watch 缺省早已如此；`todayLogFile()` 导出保留 UTC 映射仅为兼容仓外既有调用面——仓内已无读路径依赖它（R2 核对：`tools/log-latency-probe.js` 的 mini-tail 本就跟随 `defaultTodayFile`；`server/routes/live.js:18` 仅存一处赋值、未被读取）。测试：`test/log-tail-behavior.test.js` 跨本地午日用例。 |
| R-3 | win32 CLI 形态探测盲区 | **未决（有兜底）** | `tasklist` 探测只认桌面端镜像名 `ZCode.exe`，`node` 跑的 CLI 形态探测为「未运行」。兜底：`-wal` 静默窗口（`walIdleMs < 60s` = 真实 writer 在场）在自动 checkpoint 前否决误报（`server/zcode-runtime.js`）；本轮把同一否决加到 `/api/checkpoint` 执行前（即时判据，不再只依赖最长 ~37s 陈旧的进程探测结果）。根治（识别 CLI 形态进程）无必要不做。 |
| R-4 | UI 视觉发现的追溯缺口 | **未决（需人工看图）** | R1 评审报告称存在 3 项视觉发现未入库，并引用了 dashboard/pets/widget/pet 四页的截图复核结论（pets 布局、对比度 5.76:1 达 AA 等）——这些结论未在本仓留痕，本轮无法核实或复现。代码级已核事实：`public/widget.html`/`public/pet.html` 的 `--notice` 浅色档注释声明 #b35600 对白底 ≈4.9:1（AA）。销账条件：人工看图复核四页并把结论入库。 |
| R-5 | dashboard 隐私横幅的截图取证缺口 | **已销账（快照绊线轮）** | 补拍默认展示态截图：`docs/acceptance/privacy-banner-default.png`（2026-09-23，Playwright 全新浏览器 profile——无关闭记录，横幅默认展示；文案为该轮升级后的本机实证三分措辞）。代码级事实不变：横幅默认展示，关闭写 `localStorage zc-privacy-notice-dismissed` 后不再出现。 |
| R-6 | 「锚定无测试」的过时说法 | **已销账** | 该说法早于 `test/log-tail-behavior.test.js` 的 A3-watch 锚定用例（EPERM 补锚定、历史不回放）；本轮又补 A3-7（截断重读）与 A3-8（文件名回退/回归不回放）。后续引用以测试文件为准。 |
| R-7 | 许可证未知包的导入语义（A1-4 修订） | **已实施（本轮，语义变更留痕）** | 原 Spec A1-4 为「许可证缺失仅警告、导入不阻断」；本轮改为缺省拒绝、显式确认（API `ackUnknownLicense` / CLI `--ack-unlicensed`）后放行，NOTICE 免责声明同步改为中性措辞（不再自动断言「粉丝自制」——来源与授权状态未核实）。确认后仍为「成功但带警告」，A1-4 的 NOTICE 三要素断言不变。 |
| R-8 | Google Fonts 本地化（R2 低-i，驳回登记） | **未决（权衡后挂起）** | CSP 仅存的外联域。驳回理由：Noto Sans SC 是 CJK `unicode-range` 子集矩阵（100+ 个 woff2、合计 ~10MB+），全量 vendoring 体积不可接受；手工裁剪子集在动态文本（会话名、包元数据）上有豆腐块风险。现状：断网时回退 `styles.css` 的系统字体栈，功能无损。出路二选一即销账：接受系统字体为最终形态（删 `@import`），或自托管拉丁字体 + 系统 CJK。 |
| R-9 | overview 回退路径「慢但可用」（R1 低-4 驳回登记） | **已知取舍** | 机制（R3 改写，原「逐 JSONL 现算」描述失实——本端点不读 JSONL）：`server/db.js:203-221` 在 `model_usage_started_model_idx` 缺失（旧版 ZCode / 外部 `ZCODE_DB`）时回退到不加 `INDEXED BY` 的原查询，真实库实测单次 1.4-1.8s 全索引扫、同步阻塞事件循环（INDEXED BY 路径 0.6ms、结果一致）。R1 低-4 的 TTL 缓存建议被驳回（回退是异常路径、低频；缓存会掩盖恢复时刻的陈旧窗口，正确性优先于回退速度）。接受残余：触发回退期间该端点慢，但可用性与新鲜度正确。 |
| R-10 | log-tail 换名回归丢行（R2 低-c） | **已销账（R2）** | `readOffsets` Map（名字→语义未读偏移，截断取 min）替代「读过」集合：回归到已读文件从记录偏移续读，锚定后新写入不丢。测试：`test/log-tail.test.js` A3-8。有意保留的窄窗取舍：删除/复活（高-B、低-d）按「复活即当刻 size 补锚定」，复活瞬间已存在的行不追认——避免整文件回放，代码注释逐处标明。**R3 更新**：复活用例（i:4）已改为 A3-8 式重试追加——被读过的文件删除重建后从已读偏移续读、窗口内写入补投递（`test/log-tail-behavior.test.js` 复活重试追加用例）；从未读过的文件仍按 size 锚定不回放。 |
| R-11 | checkpoint 折叠 I/O 时长不受 busy_timeout 约束（R3 登记low-①） | **未决（接受残余）** | `wal_checkpoint(TRUNCATE)` 是同步 better-sqlite3 调用：busy_timeout 只约束**锁等待**，不约束折叠 WAL 的磁盘 I/O——巨大 `-wal`（数百 MB，异常退出遗留）时事件循环可被秒级冻结。预检体积改 PASSIVE/延后均不成立：PASSIVE 不清空 `-wal`，达不到「ZCode 退出后新只读连接可见全史」的存在目的；延后=大 WAL 永不折叠，正中要害场景。缓解现状：自动 checkpoint 仅在 ZCode 退出且 `-wal` 静默 ≥60s 后触发，且正常退出路径 ZCode 自身已折叠 WAL——残留窗口仅「异常退出 + 巨大 WAL」的罕见组合。可选后续缓解：折叠前 `-wal` 体积预检超阈值时 console.warn 提示（不改变行为，只留观测面）。 |
| R-12 | staging 硬链接可绕包含性不变量（R3 登记low-②） | **未决（声明不在防御面）** | `auditNoSymlinks` 用 lstat，硬链接在 lstat 视角是普通文件——staging 内指向卷外文件的硬链接对词法/真实路径包含性审计均不可见，其内容可随导入落入 `public/pets`。危害有限：创建硬链接需本地写权限（面板威胁模型外的本地攻击者）；内容面受 sheet 32MB 上限、webp 头校验、`/pets` 非图片强制下载与 `/api` 回环闸约束（声明见 `server/pet-import.js` auditNoSymlinks 注释）。深度防御（内容寻址/来源标记）成本高于残余风险，不做。 |
| R-13 | raw 查询面的亚秒级残余（R3 必修-2 伴随登记） | **已知取舍** | UI 可达组合（13 表 × 下拉 5 order 值 × desc，真实库实测 130 组合最慢 71ms）已全部达标；自由 where 输入框的残余面：非巨表（model_usage 38.6万/tool_usage 52.3万/session_entry 11.7万行）上前缀 LIKE 或无索引列谓词在**无命中**时全表扫 0.2-0.7s（实测 model_usage 285ms / tool_usage 冷态 724ms）——亚秒级、一次性 debug 动作，接受；巨表（message/part）的 LIKE 与无索引列谓词已直接 400（实测无命中前缀 LIKE 在 part 上 61.7s 冷/8.9s 热，不容许）。 |
| R-14 | 快照绊线的覆盖边界（快照绊线轮登记） | **已知取舍** | ① 只在面板运行时段设防：停机期间机制复活以启动后的「遗留静止」态呈现（卡上「最后活动」相对时间辅助判断，UI tooltip 已注明零点语义）；② 面板重启重置零点——闩锁告警随重启消失（真实告警证据同时消失，处置前先自行留痕）；③ 纯轮询降级（fs.watch 不可用/出错）时检测延迟上界 = 轮询周期 30s；watch 存活时 ≈3s 去抖+扫描时长；④ 理论漏报窗口：快照「落盘→上传→清理」全部发生在一拍之间且连 state.json 都不残留时纯扫描差异不可见——本机实证（2026-09-23，21 个 state.json 在上传被接受后仍滞留）表明真实上传必留 state.json，按证据接受；⑤ 顶栏 chip fail-safe 取向为「宁可不亮不误报」：`/api/snapshot` 持续不可达时告警面只剩绊线卡自身。缓解现状均写入 `server/snapshot-watch.js` 头注与 README「快照绊线」节；watch 异步错误已挂 error 监听降级（不再崩进程），不可读目录单列 unreadable 态（不伪装静默）。 |
