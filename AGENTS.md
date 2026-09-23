# AGENTS.md — zcode-monitor 工作约定

本地只读 Web 仪表盘：读取 `~/.zcode/cli/`（SQLite 主库 + JSONL 日志 + exec 输出），
服务 `127.0.0.1:7331`，可视化 ZCode agent 的运行（会话深挖/用量/子代理树/错误链路/桌宠 widget）。

## 运行与测试

```bash
npm install && npm start   # 生产启动（自动开浏览器）
npm run dev                # node --watch 开发模式
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
- 遗留项唯一登记处：`docs/acceptance/residuals.md`（新遗留入册、解决销账、不删条目）。
- 推送目标：`origin` = fork（aloysk/zcode-monitor）；`upstream` = yiyanwannian 原仓库（只读参考）。

## 当前状态（2026-09-23）

- main：生态采纳计划 + 四轮多视角加固审查 + 快照绊线（五视角对抗评审 + 六视角
  zcode-pr-review-toolkit 终审：子目录读失败 partial 分级 / 截断拍零点拒绝 /
  README 锁定矛盾修正 / __proto__ 与截断置位 / 测试补强至 29 例）全部合并。
- workflow_child 计数轮（fix/workflow-child-accounting）：动态工作流（dwf）actor
  此前在全面板被漏计（24h 窗口 ≈17% 请求）；本轮分列纳入——速度卡/速度表徽标/
  会话徽标与筛选/raw 页 dwf 运行册表/How 文档，顺带修复 overview 切页后 SSE
  刷错（renderFeed 自愈）。三子代理对抗评审（code/API 兼容/测试质量）通过，
  已知边界登记 residuals R-16。
- workflow_child 六视角终审轮（zcode-pr-review-toolkit）：How 页示例行跨模型组
  求和（find 少报 41% 缺陷）、raw 缺表 400 化（R-16② 销账）、未知 task_type 不再
  冒充 main、startLive/renderKpis 竞态家族加固、SRC_COLOR/childBadge 收敛；
  测试补强至 5 例，全套 179 用例全绿（node --test 直列计数口径）。
- 重启菜单轮（feat/widget-restart-menu）：桌宠右键菜单「重启面板」+ 服务端
  `POST /api/restart`（首部闸/自 spawn 接替进程/端口交接时序见
  server/restart-route.js 头注）；壳侧 RestartServerAsync 兼容自有/收养两态。
  测试 test/restart-route.test.js 11 例；7399 真重启循环实机验证过（含
  EADDRINUSE 重试自愈、SEC-006 Range 泄露闭合复验）。R-17 登记。
- 快照绊线（server/snapshot-watch.js）：只读监视 `~/.zcode/v2/checkpoints/`，
  机制复活即告警；语义（零点/闩锁/unreadable 态/watch 降级）见模块头注，
  已知边界登记 residuals R-14。
- 未决（详见 residuals.md）：R-1 人工实机评审（A1-8 导入轮换 / A4-7 壳内交互）、
  R-8 字体本地化二选一决策；其余为已接受残余（R-5 隐私横幅截图已补拍销账）。
