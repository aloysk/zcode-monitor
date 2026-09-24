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
2. **性能红线**：真实库 14.6-17GB，每条 SQL 必须命中 `started_at` 索引或 rowid 尾部；
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

## 当前状态（2026-09-24）

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
  命令恢复——`npm run start:detached`（scripts/start-detached.js：detached+
  windowsHide 接替形态同 restart-route、/api/health 幂等探活、stderr 续写
  logs/restart-child.log、默认 OPEN_BROWSER=0，`--open` 显式开）。
  E2E 回归 test/start-detached.test.js 1 例（7399：拉起→幂等→回收）。
- main（2c39076）：生态采纳计划 + 四轮多视角加固审查 + 快照绊线（五视角对抗评审 +
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
