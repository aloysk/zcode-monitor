# AGENTS.md — zcode-monitor 工作约定

本地只读 Web 仪表盘：读取 `~/.zcode/cli/`（SQLite 主库 + JSONL 日志 + exec 输出），
服务 `127.0.0.1:7331`，可视化 ZCode agent 的运行（会话深挖/用量/子代理树/错误链路/桌宠 widget）。

## 运行与测试

```bash
npm install && npm start   # 生产启动（自动开浏览器）
npm run dev                # node --watch 开发模式
npm run start:detached     # 服务中断后一条命令拉起（detached 接替形态；幂等：已在跑就不动）
npm test                   # node --test test/index.js（聚合入口）
```

- Node ≥18（本机 v24：test runner 不接受目录参数；`test/index.js` 按 `readdirSync`
  自动发现 `test/*.test.js`，新测试文件放入即被纳入，无需手工登记）。
- 冒烟：`PORT=7399 OPEN_BROWSER=0` 起服探 `/api/health`；7331 可能是用户正在跑的实例，勿动；
  起服前后 `netstat -ano | grep 7399` 确认端口干净（防残留进程假绿）。

## 硬红线

1. **对 `~/.zcode/` 零写入**（只读承诺）。唯一例外：ZCode 退出且 `-wal` 静默 ≥60s 后的
   `wal_checkpoint(TRUNCATE)`；`?force=1` 也不得绕过 `wal_active` 的 409 拒绝。
2. **性能红线**：真实库约 18GB（2026-09-25 实测，原锚点 14.6-17GB），每条 SQL 必须命中 `started_at` 索引或 rowid 尾部；
   禁止事件循环长阻塞（better-sqlite3 是同步 API；历史事故：tasklist 同步探测 5-7s、
   message 全表扫描 2.4s、负 LIMIT 整表物化 8.8s——均已修复，同类模式视为回归）。
   行数参数一律经 `clampLimit`/`clampAtLeast`（server/http-hardening.js）钳界。
3. **禁止删除文件**（文件系统删除走治理通道，不直接 rm）；本仓编辑一律在
   feature 分支 worktree 上进行（main 分支编辑被本机 hook 拦截），
   常驻 worktree：`../zcode-monitor-plan`（node_modules 已就位）。

## 约定

- 技术栈：Express + better-sqlite3（仅两个运行时依赖）+ 原生前端（无框架、无构建步骤）。
- 行为变更必须带回归测试；加固轮模式：多视角子代理评审 → 修复 → 门禁全绿才合并 main。
- 子进程调用系统控制台程序（tasklist/netstat 等）必须带 `windowsHide: true`：
  服务存在无控制台形态（重启接替进程 detached、壳隐藏拉起），缺省会另开
  Windows Terminal 弹窗；前台终端跑冒烟共享父控制台，暴露不了这类缺陷
  （2026-09-24 tasklist 探测每 30s 闪窗事故，实证见 zcode-runtime.js 头注）。
- 遗留项唯一登记处：`docs/acceptance/residuals.md`（新遗留入册、解决销账、不删条目）。
- 推送目标：`origin` = fork（aloysk/zcode-monitor）；`upstream` = yiyanwannian 原仓库（只读参考）。

## 当前状态（2026-09-25）

- 五席全量审查两轮（fix/batch2-five-seat，基于 4909a97）：代码/SQL/测试/安全/
  前端视觉+文档口径五席并行 × 2 轮全量覆盖（R2 含双席独立变异复验）。R1
  2 major + 4 minor——notify 冷却「过期再发」分支变异存活（测试席实锤：改
  「发送过即永续」全套绿）→ nowFn 时钟注入 + 2 例钉死；c8 toast 验收帧主题
  错位（light 帧实深色/dark 帧无 toast）→ 双主题 v2 重拍 + human-gate 勘误注；
  另 titleOf 钳 80/presentNotify 三页消毒对称（index 补引 sanitize.js）/
  signalsSessionTypes IN 分块/maxListeners 50/恰等边界 ×2/SQL 恰 2 条契约钉/
  LF 毒行/R-40 主题图标 SVG hidden 不反射修复+契约钉。R2 1 major（R-40 同族：
  checkpoint busy 态 iconSvg 同机理无效赋值）+ 文档数字同步（12→13 帧 ×3、
  红线锚点 18GB）+ widget 副行 80 截断 + titleOf 恰 80 钉；4 READY/1 NEEDS_FIX
  收口。测试 384→393 直列绿。R-40 当轮销账；观察级登记：notify 侧 IN 分块
  测试对称性、IN 常量三处分立、UTF-16 代理对截断边界（详见 residuals
  changelog）。
- batch2 六席终审第 1 轮修复轮（feature/ecosystem-round2-batch2）：27 条逐条
  闭环——export csvCell 公式注入字符集补 TAB/CR/LF（OWASP 建议集）；notify
  冷却记忆有界化（NOTIFY_COOLDOWN_CAP=1000 键序逐出）+ signalsWindowMs 注入
  传导修复（取数窗与判定窗同源）；pet ariaLabel permission 分支（读屏语义）；
  recap 覆盖行宽窗截断措辞；renderSpeedChart 切页自弃守卫；db.js signals 分节
  头注勘正（1237ms 旧引系裸 GROUP BY 形态，同形回退真库 1.23ms——R-32 同步
  勘正）；C12-3 断言携带 CSV 全文（间歇红可诊断）。R-28 ③款落锤
  （waiting_timeout 维持默认关，spec §2.2 表加偏差注）；登记 R-34～R-38
  （间歇红未根因/recap 串行 5 SQL 观察项/SSE 6 连接贴满/路由无卸载钩子/
  token_threshold 单 tick 上限建议）。测试 +6 处，全套两口径绿（聚合
  60893ms exit 0；直列 39 文件 384/384）；GX-2 恰两依赖。7399 真库补拍 13
  帧（c8-*/c6-*/batch2-v3-*，waiting 帧真实会话直拍；原记 12 系计数笔误，
  枚举即 13——五席轮勘正；AI 目检 429/400 两形态
  故障如实记录，留人工）；gates 照录 round2-batch2-gates.md。
- 生态采纳 batch2（feature/ecosystem-round2-batch2，T1-T8 八任务 + 实现评审
  第 1 轮 + UI 视觉验证 + 六席终审第 1 轮）：C6 会话状态信号——signals.js
  纯分类器（四态判定序 working>broken>waiting>idle、置信高/低、waiting 时间
  启发式限 interactive；在飞=rowid 尾界 livegen 同源判据，近窗=INDEXED BY
  强制+ORDER BY DESC 截断，SIGNALS_MAX_ROWS=2000）；消费面 sessions 三态
  徽标（waiting 虚线低置信+置信标注、broken 叠加）、顶栏 waiting chip（30s
  轮询，hover 最长等待）、/api/signals/summary 固定四字段、pet waiting 行
  接线。C8 本地提醒——notify.js 四规则+冷却（默认仅 error_burst 开）+30s
  unref'd tick+共享 bus，live.js notify 帧转发零新通道；前端三页：index
  toast+三开关（声音开/通知关/TTS 关）+WebAudio 合成音+TTS、widget 数字行
  副行（防多页同开重复发声）、pet 气泡 8s hold 接管。C7 回顾视图——db.js
  Recap dates 五查询族（better-sqlite3 把 JS number 绑定为 REAL，分桶除法须
  CAST(@tz AS INTEGER) 恢复整除——代码注释钉死）+ /api/recap period 三档
  （buildRecapPayload 模块级导出）；「回顾」视图五 KPI+本期要点（year 档降级
  两要点）+日桶 sparkline+Top focus+周环比（仅 week 档）+覆盖披露（三元
  max）。C12 导出夹带——/api/export/:dataset json|csv、schema_version=1
  包络、CSV RFC 4180+OWASP 公式注入防护、同源钉零新 SQL（resolveWindow/
  wideWindowScope 提取 usage-window.js，usage-routes 既有测试零改动通过=
  重构回归证据）。R-8 守护确认（基线 6d979ae 已含销账轮，零行为变更）。
  关键降级：C6-8 真库回放 576 样本误报 39.8%>20% 线、收窗 8min 重测反升
  47.8%——needs-attention 置顶摘除、C8 waiting_timeout 落默认关（R-28 ③款
  终审落锤维持默认关，判定语义照 spec 原文保留可回翻）。评审链：规格与计划
  各经三席两轮对抗审查通过后定稿（09ec130/27b052f）；实现评审第 1 轮三席
  合并修复（de91255）；UI 视觉验证 0 修 2 未决（de38c9f，终审轮补拍 13 帧
  收窄，原记 12 系计数笔误——五席轮勘正）；六席终审第 1 轮 27 条闭环（33bcbb1）。测试 297→384 全绿（两种
  计数口径，39 文件；GX-2 恰两依赖）。已知边界登记 R-28～R-39（误报降级/
  导出裁剪/notify 无回放/per-rule 配置面/缺索引回退/C3 待后续/间歇红未根因/
  recap 串行 SQL/SSE 6 连接/路由无卸载钩子/单 tick 上限/三项人工评审）。
- R-8 决策轮（fix/r8-system-fonts，经 PR 合并）：用户拍板「系统字体为最终
  形态」——pet.html 删唯一活体 Google Fonts @import（widget.html 的 @import
  排在 :root 后本就被浏览器忽略，同删属清死码）；CSP style-src/font-src 撤销
  fonts.googleapis/gstatic 白名单，**面板至此零外联域**；字体家族名保留为本地
  可选。回归钉 frontend-contract.test.js 零外联字体契约；R-8 销账。同轮拍板：
  C3 仅批本地基座（远程配额链路未批）、C15 不做；后续批次优先序 C6+C8→C7→
  C10/C11（分析文档 §1.1）。
- batch1 四席全量审查三轮（feature/ecosystem-round2-batch1，6a6f654→22914c6→
  f3ab96e）：代码/SQL/测试质量/安全四席并行对抗评审 × 3 轮全量覆盖（R2 起含
  变异测试验钉，R3 四席 READY）。R1 六 MED+11 LOW：models-meta 升级为官方
  大小写不敏感匹配语义（zcode-builtin.json modelRules 逐条回放实证；新增
  kimi-k3/kimi-k3[1m]/GLM-5.3-highspeed 三键，值域 200k 行+逐会话最新行双域
  勘定）；R-26 运行时修复（invalidateDb 现在显式 close 旧连接——better-sqlite3
  close 幂等、`.open===false` 为关闭判据；连接断开分支改即时重抛原错，防死
  stmt 重试把 503 降级成未翻译 500）；freshness 改 MAX(rowid) 行口径；
  firstParam 归一化助手诞生。R2：firstParam 补类型守卫（数组/对象形态不再
  500），接线 agents/transcript/trace 遗留路由；fixture 虚构索引纠正为真实库
  镜像。R3：fixture 索引建序对齐真实库 rootpage 序（SQLite 规划器在同效覆盖
  索引间取后建者，建序即 EQP 保真度），overview window/transcript limit/trace
  lines 最后三个同族缺口收口。测试 294→297 全绿（两种计数口径），EQP 机检
  16/16 镜像，R-27 登记（live.js SSE 错误载荷 e.message 透传，main 既有）。
  UI 复验：7399 真机库四页截图（r5-*，SSE 页须 CDP 真等待——virtual-time
  与 EventSource 死锁），mini 水位条/水位区/时间线/顶栏健康链全渲染无 NaN。
- 生态采纳 batch1（feature/ecosystem-round2-batch1，T1-T7 七任务 + 六席终审
  修复两轮 25+9 条）：C9 快赢（/api/health freshness + 顶栏新鲜度 chip +
  emptyState 共享组件）→ C1/C5 同基座 L1 查询族 + /api/usage 三端点 →
  「回合与工具」视图（窗口级回合健康度 + 工具分档，宽窗 rowid 尾界钳制
  scope 如实申报）→「Token 归因」火焰图（嵌套 div 零图表库，两级下钻）→
  C2 上下文水位（models-meta 静态窗口表 + context-gauge 双端组件 + 会话
  mini 条/Context 水位区 + widget 缓存命中副行，SSE 复用不加通道）。六席
  终审修复：usage 取数失败兜底（failCard+先置 loading）/attribution 空窗
  明细区改隐藏/水位 live 防重叠闸改 rowid 行序（live.js 连接水位=MAX(rowid)
  不回放，时间闸误丢同毫秒真新行）/renderContext 代际 token 防孤儿
  EventSource/种子失败与空态区分/截断标注收敛 meta.*（turn 层省略
  window/since）/attrLimit ±Infinity 回落/EXPLAIN 机检补两路/README·how·
  口径册 §12·c2-human-gate 补齐。新增 8 测试文件，residuals 增 R-20～R-24。
  评审链：规格与计划各经三席两轮对抗审查通过后定稿（aee89a9/b27ebeb）；
  实现三席评审 + UI 视觉验证修复一轮（ec458c1；火焰图双主题/hover/下钻
  截图 attr-smoke-*.png 三张入 acceptance）。六席终审第 2 轮 9 条：水位
  live 行有界累积（GAUGE_LIVE_ROWS_CAP=2× 种子上限丢最旧行、增量曲线
  maxCols 列数截断+「+k」占位——长开标签亚像素列宽与 O(n) 重渲双收口）/
  EXPLAIN 机检排除集显式化（session 页查询显式滤出，别名形态基表 SCAN 不
  再静默逸出）/start-detached 占口桩 teardown 三重防护（R-21 挂死形态实机
  复现-修复-复验销账：stubDead 后到即毁 + 先 close 停收再摧毁 +
  closeAllConnections 双路）/context-gauge 行形状钉 rid 列（rowid 闸种子侧
  数据依赖）/turns meta.truncated 补 canonical 读法钉+HTTP true 态例/
  README 勘正「widget/桌宠 hover 副行」（pet.html 无此面，速度轮 H-1 同族
  文档层重现）/R-25 登记（by_error_type_truncated 过渡字段清理）。全套
  32 测试文件门禁绿（node --test，编排脚本统一运行）；30d 档 rowid cap
  收窄口径补入 usage-accounting.md §8 增补段。
- 速度生成口径轮（fix/speed-ttft-caliber）：用户感知速度读数偏低实锤——旧口径分母
  含 TTFT（GLM-5.3 首等均值 6.7-8.7s、占总时长 29-39%），24h 窗读数低四成
  （51.5 → 72.6 t/s）。分母改 ΣMAX(duration−ttft, 1ms)，ttft NULL（实测 22.1%
  行）回退全时长。社区对照定谳：JuDaXia/claude-speed METRIC v1.2（duration ≈
  TTFT + out/TPS，headline 剔 TTFT；其仅有记录时间戳须 Theil-Sen 拟合，本库
  model_usage 逐行自带 time_to_first_token_ms）；被镜像的 token-speed-monitor
  含 TTFT 属其 rollout JSONL 无首等字段的数据面限制，非口径偏好。db.js 头注
  「TTFT 只在 turn 粒度可用」前提失效，已修正。消费面全改：overviewSpeed
  （+gen_seconds/avg_ttft_ms）/recentSpeed（+ttft_ms/gen_ms，速度表加 TTFT 列
  与均首等副行）/completedSince（+gen_ms，完成时刻判定仍用 duration）/
  SSE model 行（+ttft 列）/widget·pet·feed（代码席评审抓出 H-1：pet 气泡
  漏改，同端点两 UI 漂移四成）。分档 30/80 有意不变（纯生成下 30 仍=真慢）。
  三席评审（代码/SQL/测试质量）+ 复核 PASS（契约钉经变异测试逐点实证）；SQL
  席 EXPLAIN 四路全走索引、24h 同锚点背靠背五字段逐位一致。新增
  test/speed-caliber.test.js 5 例（空集稳健/NULL 回退等价/脏行 1ms 下限/
  SSE 行形状/前端契约），全套 211 例绿。usage-accounting.md §8 增补口径段。
- 重启链六视角终审轮（fix/restart-six-lens-final，zcode-pr-review-toolkit）：
  注释/静默/简化三席 FIX-FIRST + 测试席 8/10 缺口 + 静默席 HIGH 两条，全部修毕
  ——①10s/12s 文案漂移；②netstat 过滤注释「只锚本地列」为假（连入 7331 的
  客户端行 remote 列同样含 `:7331 `，本/远甄别全靠 LISTENING token）；③
  start-detached 头注「与 restart-route 完全一致」失实（restart-route 无
  windowsHide；不设 ZCODE_WIDGET_CHILD 的长驻语义差异补记）；④强杀调用点
  从裸存在性钉升级为分支钉；⑤start-detached 探活三态化（拒连才 spawn；
  占口不应答→如实报因+指路，不产竞速者；200+body.ok 才算健康）；⑥壳恢复
  失败/进行中改菜单文本可见反馈（重启中…/重启失败——详见 widget-run.log）；
  ⑦netstat 绝对路径 System32+读管道 5s 硬超时（挂起曾可永久搁浅重启闩）；
  ⑧旁路 null 落日志、already-gone 改 continue、START_TIMEOUT_MS NaN 兜底、
  errFd 父侧即关。R-18/R-19 登记。测试 +5（契约钉/占口不 spawn/源码契约）。
- 胶囊重启阻塞态修复轮（fix/widget-restart-blocked）：2026-09-24 19:40 实锤——
  面板事件循环卡死时壳右键「重启面板」对阻塞态裸退（仅记日志、零用户反馈），
  恰是最需要重启的场景。改为：有界观察 12s（墙钟预算——Blocked 探测自身耗满
  2s 客户端超时，按次计数的「10s」实跑 30s）→ 仍阻塞则 netstat 定位 7331
  监听者（隐藏拉起；-ano 行尾是 pid，LISTENING 须作包含 token 匹配）→ 仅
  node.exe 放行强杀（整树）→ netstat 监听表旁路等端口释放（吊死连接可比
  死监听者活得久：实机 25s 探测全超时而监听表已空）→ 落正常拉起重载。
  真机三轮验证：阻塞态（强杀桩→拉起→重载）+ 健康态（endpoint 200→接替→
  重载）全链路；两处实机抓出的实现缺陷（迭代计数超时/EndsWith 恒空）已随
  契约钉入 restart-route.test.js。非 node 进程占住 7331 时拒绝强杀（日志
  提示手动处理）——已接受边界。
- start-detached 启动脚本轮（feat/start-detached-script）：7331 实例随会话/机器
  重启消失（2026-09-24 实况：detached 接替进程被外部终止，无崩溃日志）后一条
  命令恢复——`npm run start:detached`（scripts/start-detached.js：detached 接替
  形态对齐 restart-route 并按红线另加 windowsHide；三态探活幂等——占口但非
  健康不 spawn 竞速者；stderr 续写 logs/restart-child.log；有意不设
  ZCODE_WIDGET_CHILD（实例长驻，换代走桌宠重启）；默认 OPEN_BROWSER=0，
  `--open` 显式开）。回归 test/start-detached.test.js（7399：拉起→幂等→回收、
  占口不 spawn、spawn 形态源码契约）。
- main（1bb73c0）：生态采纳计划 + 四轮多视角加固审查 + 快照绊线（五视角对抗评审 +
  六视角 zcode-pr-review-toolkit 终审）+ 洁癖收尾轮 + workflow_child 计数轮及其
  六视角终审 + 桌宠重启菜单轮及其四席加固三轮（并发/失败模式/安全/测试质量 ×3：
  CRITICAL 退出定时器撤销 / 早夭 exit 守卫 / SEC-002·004·006 泄露面闭合 /
  EADDRINUSE 65s 自愈 / 壳三态探测）+ tasklist 探测闪窗快修轮全部合并并推送 fork。
- workflow_child 计数轮（fix/workflow-child-accounting）：动态工作流（dwf）actor
  此前在全面板被漏计（24h 窗口 ≈17% 请求）；本轮分列纳入——速度卡/速度表徽标/
  会话徽标与筛选/raw 页 dwf 运行册表/How 文档，顺带修复 overview 切页后 SSE
  刷错（renderFeed 自愈）。三子代理对抗评审（code/API 兼容/测试质量）通过，
  已知边界登记 residuals R-16。
- workflow_child 六视角终审轮（zcode-pr-review-toolkit）：How 页示例行跨模型组
  求和（find 少报 41% 缺陷）、raw 缺表 400 化（R-16② 销账）、未知 task_type 不再
  冒充 main、startLive/renderKpis 竞态家族加固、SRC_COLOR/childBadge 收敛；
  测试补强至 5 例，全套 179 用例全绿（node --test 直列计数口径）。
- 重启菜单轮（feat/widget-restart-menu）+ 四席加固三轮（fix/restart-gauntlet）：
  桌宠右键菜单「重启面板」+ 服务端 `POST /api/restart`（首部闸/自 spawn 接替
  进程/端口交接时序/三种失败形态旧进程都不退出——语义见 server/restart-route.js
  头注）；壳侧 RestartServerAsync 兼容自有/收养两态（三态探测：阻塞服务不误判
  down）。接替进程 stderr 落盘 `logs/restart-child.log`（gitignored）。
  测试 test/restart-route.test.js 11 例；7399 真重启循环实机验证过（含
  EADDRINUSE 重试自愈、SEC-006 Range 泄露闭合复验）。R-17 登记。
- tasklist 探测闪窗快修轮（fix/tasklist-window-flash）：无控制台形态（重启接替
  进程 detached / 壳隐藏拉起）下 `execFile('tasklist')` 缺 `windowsHide:true`，
  Win11 为控制台程序另开 Windows Terminal——每探测周期（30s 节流）闪一个
  tasklist.exe 窗（2026-09-24 实锤：7331 接替进程 65268；前台终端形态因共享父
  控制台历轮未暴露）。zcode-runtime.js 单点修复（checkpoint 路由复用同函数一并
  覆盖；ZCode 自身的 tasklist 探测本就句柄 0，非弹窗源）。回归测试
  test/probe-windows-hide.test.js 1 例；7399 真机 A/B：旧码两见句柄
  2625612/4261058（有标题窗）vs 新码生命周期句柄恒 0。全套 204 用例全绿
  （node --test 直列计数口径）。
- 快照绊线（server/snapshot-watch.js）：只读监视 `~/.zcode/v2/checkpoints/`，
  机制复活即告警；语义（零点/闩锁/unreadable 态/watch 降级）见模块头注，
  已知边界登记 residuals R-14。
- 未决（详见 residuals.md）：R-1 人工实机评审（A1-8 导入轮换 / A4-7 壳内交互）、
  R-8 字体本地化二选一决策；其余为已接受残余（R-5 隐私横幅截图已补拍销账）。
