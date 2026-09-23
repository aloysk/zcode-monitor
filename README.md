<div align="center">

# zcode-monitor

**本地常驻的 Web 工具，用来实时追踪、调查、理解 ZCode agent 的运行。**

[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#贡献)

只读访问 `~/.zcode/cli/` 下的 SQLite + JSONL，**无需改动 ZCode 任何东西**。

</div>

---

## 简介

`zcode-monitor` 是一个跑在 `127.0.0.1` 的本地观测面板。它会读取 ZCode 客户端在磁盘上落下的数据（SQLite 主库、`transcript.jsonl` 事件流、日志、Bash 输出），把一次 agent 运行里发生的所有事——模型请求、token 消耗、工具调用、子 agent 派生、推理链——整理成可视、可查、可追溯的界面。

监控读路径全程**只读**，不修改、不删除任何 ZCode 数据，也不和 ZCode 的写事务抢锁（唯一例外是 WAL checkpoint 功能，完整边界见下文「隐私提示」之后的说明）。

视觉对齐 kimi-vis 参考页面：分层暗色背景、分类色编码、左列表 + 右详情（7 标签）。

## 特性

-  **实时监控** —— 模型调用数、token（输入/输出/推理/缓存）、工具调用、错误率、活跃会话；按小时趋势图；按模型 / 请求来源 / 工具的算力分布；SSE 实时推送。
-  **会话深挖** —— 左栏会话列表（搜索 / 筛选 / 排序），右栏 7 个标签：Timeline / Context / Turns / Agents / Tasks / Usage / State。
-  **子 Agent 关系树** —— 从主会话到派生子 agent 的调用树（`parent_id` 级联）。
- ️ **错误与链路** —— 按错误类型 / 工具汇总；失败调用列表；最慢工具 Top 30；输入 `trace_id` 还原事件瀑布图。
-  **推理可视化** —— 思考型模型的推理链单独呈现，与最终回答分开，点击展开。
- ️ **原始数据查看器** —— 直接查任意 SQLite 表（`where` / `order` / 降序，JSON 列可展开）。
-  **双主题** —— Dark（默认）/ Light，三种切换方式。
- 🐾 **宠物一键导入** —— Codex 格式宠物包（`pet.json + spritesheet.webp`）一键导入，导入时校验 sheet 尺寸 / 行数 / JSON 健全性并生成 NOTICE，且**按白名单复制**（只带走 pet.json / 精灵图 / NOTICE / README·LICENSE 文本，`.html`/`.svg` 等一律跳过并告警）；许可证缺失、或自报值不在已知 SPDX/惯用写法白名单的包**缺省拒绝导入**，需显式确认（CLI `--ack-unlicensed`、图鉴页确认弹窗、API `ackUnknownLicense: true`；确认后照 NOTICE 记录自报值并放行）；CLI（`node tools/import-pet.js <包目录>`）、API（`POST /api/pets/import`）与图鉴页（`pets-preview.html`）三个入口共用同一校验模块。
- ⚡ **fs.watch 实时增强** —— 日志目录 `fs.watch` 监听 + 字节偏移增量解析，JSONL 追加即触发、大幅降低日志尾部发现延迟；watch 失败自动降级短轮询，周期偏移对账兜底，事件不丢不重。
- 🚨 **快照绊线（tripwire）** —— 只读监视 `~/.zcode/v2/checkpoints/`（ZCode 工作区快照上传机制的落盘目录，背景见下文「隐私提示」）：实时监控页常驻一张绊线卡，四态呈现（静默 / 遗留静止 / 目录不可读 / **检测到活动**）；快照机制复活、新内容落盘的那一刻卡片转红、顶栏亮出「快照活动!」告警（任何视图可见）。boot 时目录状态即零点，此后新增工作区 / `state.json` 变化 / pending 工件增减都判为活动并闩锁（上传后目录被清理也保持告警）；fs.watch 快路径 + 30s 轮询兜底，全程对 `~/.zcode/` 零写入。
- ✅ **测试套件** —— Node 内置 `node:test`（零新依赖），`npm test` 一键运行；fixture 全部落 `os.tmpdir()`，与真实库完全隔离。
-  **全程只读** —— 不改 ZCode 一行数据。

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) ≥ 18
- 已安装并至少运行过一次的 ZCode 客户端（用于生成 `~/.zcode/cli/` 下的数据）

### 安装与运行

```bash
git clone <your-repo-url> zcode-monitor
cd zcode-monitor
npm install          # 装 express + better-sqlite3
npm start            # 启动服务并自动打开浏览器
```

浏览器会自动打开 `http://127.0.0.1:7331/`。`Ctrl-C` 停止。

### 开发模式

```bash
npm run dev          # node --watch，文件改动自动重启
```

## 配置

通过环境变量配置，均有默认值：

| 变量         | 默认值                         | 说明                   |
|------------|-----------------------------|----------------------|
| `PORT`     | `7331`                      | 监听端口                 |
| `HOST`     | `127.0.0.1`                 | 监听地址（出于安全默认只绑本地）     |
| `ZCODE_DB` | `~/.zcode/cli/db/db.sqlite` | SQLite 主库路径          |
| `ZCODE_SNAPSHOT_DIR` | `~/.zcode/v2/checkpoints` | 快照绊线监视的目录（测试/异构环境改址） |
| `OPEN_BROWSER` | `1`（未设即开）          | 启动时是否自动打开浏览器（设 `0` 关闭） |

示例：

```bash
PORT=8000 ZCODE_DB=/path/to/db.sqlite npm start
```

## 它能看什么

### 1. 实时监控 (Overview)

此刻的运行状态：模型调用数、token（输入/输出/推理/缓存）、工具调用、错误率、活跃会话；按小时的趋势图；按模型/请求来源/工具的算力分布；**SSE 实时推送**新发生的模型/工具调用。

![实时监控 Overview](public/assets/monitor.png)

### 2. 会话深挖 (Sessions) — 核心

左栏会话列表（搜索/筛选/排序），右栏 7 个标签（下图展示 **Context** 标签：完整对话历史，推理思考用紫色侧边块单独呈现，点击展开看全文）：

![会话深挖 Sessions - Context](public/assets/context.png)

- **Timeline** — 事件时间线（子 agent 的 transcript.jsonl 事件流）。
  把 `turn_started → model_request → model_network_status → model_streaming → model_complete → tool.call/result → turn_complete`
  映射成 wire 风格行，按分类色编码。**推理流式输出折叠成 `◆ think` 行**，点击展开。
- **Context** — 完整对话历史（SQLite message+part）。**推理思考(reasoning)用紫色侧边块单独呈现**，与最终回答分开，点击展开看全文。
- **Turns** — 每个 turn 的耗时横条 + token/工具统计。
- **Agents** — 该会话派生的子 agent（profile、token、prompt）。
- **Tasks** — TodoWrite 写入的任务清单。
- **Usage** — 每个 turn 的 token/工具明细表。
- **State** — 会话元数据（cwd、parent、trace_id、时间）。

### 3. 子 Agent 关系树 (Agents)

从主会话到派生子 agent 的调用树（`parent_id` 级联）。点节点跳转该 agent 会话。

### 4. 错误与链路 (Errors)

按错误类型/工具汇总；失败调用列表（点击带入 `trace_id`）；最慢工具 Top 30；**输入 `trace_id` 还原日志事件瀑布图**。

### 5. 原始数据 (Raw)

直接查任意 SQLite 表（`session`/`message`/`part`/`model_usage`/`tool_usage`/`turn_usage`/`todo`...），支持 `where`/`order`/降序，JSON 列可展开。调试用。

### 6. 运行原理 (How It Works)

用**你自己机器上的真实数据**解释 ZCode 怎么工作：数据模型 ER 图、`turn → request → tool` 的完整流程、推理（reasoning）机制、上下文压缩、prompt 缓存。

## 数据源

全部只读：

| 来源             | 路径                                                      | 用途                            |
|----------------|---------------------------------------------------------|-------------------------------|
| SQLite 主库      | `~/.zcode/cli/db/db.sqlite`                             | 会话/消息/模型调用/工具调用/turn 汇总（权威数据） |
| transcript 事件流 | `~/.zcode/cli/agents/<parent>/agent_*/transcript.jsonl` | 子 agent 的实时事件流（Timeline 标签）   |
| 子 agent 元数据    | 同目录 `metadata.json`                                     | profile、prompt、token、派生关系     |
| 每日日志           | `~/.zcode/cli/log/zcode-YYYY-MM-DD.jsonl`               | `trace_id` 还原事件瀑布             |
| Bash 输出        | `~/.zcode/cli/exec/<sess>/<callId>-stdout.log`          | 工具调用的 stdout/stderr           |

关联键：

- `turn_id` 串起一个回合
- `trace_id` 贯穿整棵请求树
- `tool_call_id` 连接工具调用 ↔ 输出 ↔ 事件

## 隐私提示

有第三方报告称 ZCode 可能会在后台上传工作区快照到云端（涉及本机 `~/.zcode/v2/checkpoints/` 目录）。
**该机制在本机活动过且留下实证（只读核查，2026-09-23）**：该目录存在 21 个工作区目录（共约 1.1GB），其中 5 个滞留加密上传工件（`pending/*.tar.gz.enc`，各带重试失败计数），多个 `state.json` 的 `lastAcceptedManifestHash` 非空（存在被接受的上传）。**当前状态：整条快照/上传链路自 2026-09-18 13:32 起零活动**——此后 ZCode 每日重度使用，但全部 `state.json` 无任何更新、近两日日志亦无快照/上传操作命中（只读检索）；停止当日无本地版本或配置变更，推断为服务端开关，可能随更新恢复。**仍未验证的部分**：上传目的地与云端用途（未做网络侧取证），本项目对此不下断言；以下来源供参考：

- 第三方项目：Masterchiefm/zcode-speed-panel 的「快照防护」说明（早期版本曾引 HumanAILoop/zemote 的「停更声明」，经核实全网查无此项目，已弃用该来源——与 docs/specs/ecosystem-adoption-v1.md WP5 的裁定一致）
- 社区报道：Hacker News「Zcode silent workspace snapshot upload」讨论串、知乎文章《智谱ZCode，你打包上传我的代码仓库干什么》、开源中国 2026-09 相关报道

如需自查，可在 Windows 上以只读方式列出该目录（只列目录，不做任何改动）：

- PowerShell：`Get-ChildItem "$env:USERPROFILE\.zcode\v2\checkpoints"`
- Git Bash：`ls ~/.zcode/v2/checkpoints`

以上均为只读取证；上传目的地与云端处置未经网络侧验证，本项目不对此下断言。

### 快照绊线：面板内置的复活监视

「实时监控」页常驻**快照绊线卡**，顶栏在告警态亮出「快照活动!」红标（语义见 `server/snapshot-watch.js` 头注）：boot 时的目录状态即零点，此后任何新增工作区、`state.json` 重写、pending 加密工件增减都判定为机制复活并闩锁告警；fs.watch（Windows/macOS 递归）秒级快路径 + 30s 轮询兜底；目录不可读（如手动锁定后）如实显示「目录不可读」态而不是伪装成「静默」。已知边界：绊线只在面板运行时段设防，面板停机期间的活动以启动后的「遗留静止」态呈现（可用最后活动时间辅助判断）；面板重启会重置零点。

### 可选：目录锁定（阻断快照写入，可逆）

如决定阻断 ZCode 的快照写入（参考 Masterchiefm/zcode-speed-panel `snapshot_guard.rs` 的实现思路，MIT），在 Windows 上以拒绝 ACE 锁定目录（先 `whoami /user` 取当前用户 SID）：

```powershell
icacls "$env:USERPROFILE\.zcode\v2\checkpoints" /deny "*<SID>:(OI)(CI)(WD,AD)"   # 锁定（只拒写入/创建，不影响读取）
icacls "$env:USERPROFILE\.zcode\v2\checkpoints" /remove:d "*<SID>"               # 解除（可逆）
```

锁定后 ZCode 写不进该目录、快照上传链路失效，代价是「检查点回滚 / 时间线」功能不可用；绊线卡会如实转为「目录不可读」态（预期行为，非故障）。注意：锁定/解除是**对 `~/.zcode/` 的写入性操作**，由你手动执行——本面板自身对 `~/.zcode/` 始终零写入，不提供也代行不了这个动作。

监控读路径对 `~/.zcode/` 全程只读。唯一例外是 WAL checkpoint 功能（ZCode 退出后自动折叠，或经 `/api/checkpoint` 手动触发）：它以短时可写连接执行 `wal_checkpoint(TRUNCATE)`，只把 WAL 日志折叠进主库、清空 `-wal` 文件，不改变任何数据行内容。

安全姿态（与隐私相关的部分）：面板无鉴权、默认只绑 `127.0.0.1`，全部 `/api` 仅接受回环 Host（`127.0.0.1` / `localhost`，防 DNS rebinding 整库转录）；全站下发 CSP 与 `X-Content-Type-Options: nosniff`，前端脚本零外联（Chart.js 已本地化到 `public/assets/`，仅 pet/widget 两页保留 Google Fonts 字体 CSS 外联，见 `docs/acceptance/residuals.md`）；`/pets` 静态目录内非图片一律强制下载，导入夹带的页面类文件无法以面板同源执行。手动 checkpoint 的拒绝语义：WAL 近 60s 内有写入 → `409 wal_active`（`?force=1` 也不越过，绝不与真实写入方抢锁）；探测显示 ZCode 运行中 → `409 zcode_running`（`?force=1` 可越过）；锁竞争 → `503 checkpoint_busy`（可重试）；`?force=1` 另要求请求头 `X-Zcode-Monitor-Checkpoint: 1`（面板按钮自动携带；防跨站简单请求触发，缺头 → `403`）。全部 `/api` 行数参数（limit/max/offset）统一钳界，负值不再构成无上限查询。

## 故障排查

### 启动后页面一直显示"检查 ZCode 是否在运行" / health 报 `ok:false`

`better-sqlite3` 是原生模块，必须针对你**当前**的 Node 版本编译。如果换了 Node 版本（比如从 18 升到 22/24），会因 `NODE_MODULE_VERSION` 不匹配而加载失败、服务静默崩溃。修复：

```bash
npm rebuild better-sqlite3   # 用当前 node 重新编译原生模块
```

> 报错信息形如 `was compiled against a different Node.js version using NODE_MODULE_VERSION 108` 就是这个问题。

### 查询偶发失败 / 提示"数据库繁忙"

ZCode 用 SQLite 内嵌库（WAL 模式）并持续写入，读时会和它的写事务/checkpoint 抢锁。本工具已做四层加固，正常情况下你会感知不到：

1. **打开层**：连接失败自动重试 5 次（指数退避），不在首次锁竞争时崩溃。
2. **并发层**：`busy_timeout=5000ms` 让 SQLite 等 ZCode 写完而非立即抛 `SQLITE_BUSY`，并以只读连接参与 WAL 共享锁。
3. **查询层**：每条 `prepare().all/get` 自动重试 4 次；连接损坏（CORRUPT/IOERR）时自动重连。
4. **接口层**：锁竞争转成 HTTP `503 retryable`，前端 `getJSON` 自动指数退避重试（300ms → 600ms → 1200ms），不再弹错误卡。

顶栏状态点：绿 = DB 可读、红 = DB 暂不可读（通常几秒内自愈）。如果持续红色，多半是上面那个 Node 版本问题，或 DB 路径不对。

## 主题切换

支持 **Dark（默认）** 和 **Light** 两套主题，三种切换方式：

- 顶栏右侧的 **🌙 / ☀️ 按钮** 点击切换
- 键盘快捷键 **`t`** 切换（输入框内不触发）
- URL 参数 **`?theme=light`** 或 **`?theme=dark`**（会记住选择，如 `http://127.0.0.1:7331/?theme=light`）

选择会存到 `localStorage`，下次打开自动恢复。切换主题时图表颜色会跟随重渲染。主题在页面加载前通过内联脚本应用，避免闪烁（FOUC）。

## 技术栈

- **后端**：Node 18 + Express + better-sqlite3（只读连接，`readonly: true`）
- **前端**：原生 HTML/CSS/JS（无框架、无构建步骤）+ Chart.js（已本地化到 `public/assets/`，脚本零外联；仅 pet/widget 两页保留 Google Fonts 字体 CSS 外联，见 `docs/acceptance/residuals.md` R-8）
- **实时**：Server-Sent Events（SSE）推送新 `model_usage`/`tool_usage` 行
- 全程只读，只监听 `127.0.0.1`，不修改 / 删除任何 ZCode 数据

## 项目结构

```
zcode-monitor/
├── package.json
├── server/
│   ├── index.js              # 入口：Express + 自动开浏览器 + 安全响应头（CSP/nosniff）
│   ├── db.js                 # 只读 DB 连接 + 查询函数
│   ├── zcode-runtime.js      # ZCode 运行状态探测 + WAL checkpoint
│   ├── livegen.js            # 生成态引擎（呼吸动画/×N 车道的 SSE 边沿）
│   ├── snapshot-watch.js     # 快照绊线（只读监视 checkpoints/，复活即告警）
│   ├── transcript.js         # 解析 transcript.jsonl + metadata.json
│   ├── log-tail.js           # 日志读取 + trace 还原 + fs.watch 实时增量
│   ├── pet-import.js         # 宠物包导入共享模块（校验/白名单复制/端点中间件）
│   ├── http-hardening.js     # 安全响应头 + /api 回环 Host 闸 + 错误翻译/行数钳界工具
│   ├── checkpoint-route.js   # /api/checkpoint 工厂（force 首部闸 + wal_active 否决）
│   ├── health-route.js       # /api/health 工厂（连接自愈探测）
│   └── routes/
│       ├── overview.js       # 实时监控
│       ├── sessions.js       # 会话列表 + 详情 7 端点
│       ├── transcript.js     # 事件时间线
│       ├── trace.js          # 错误 + trace 瀑布
│       ├── live.js           # SSE 实时推送
│       ├── agents.js         # 子 agent 树
│       └── raw.js            # 原始表查看器
├── public/
│   ├── index.html            # 单页 shell
│   ├── app.js                # 路由 + 辅助函数
│   ├── styles.css            # 暗色主题（对齐参考页配色 token）
│   ├── widget.html           # token 速度胶囊页（WebView2 壳常驻）
│   ├── pet.html              # 桌宠页（精灵动画 + 手势 + 心情）
│   ├── pets-preview.html     # 宠物候选预览 + 从暂存导入面板
│   ├── pet-state.js          # 桌宠行为纯决策模块（单测面）
│   ├── sanitize.js           # 气泡文本消毒共享模块（双端导出）
│   ├── pets/                 # 宠物包目录（<id>/pet.json + spritesheet.webp）
│   └── views/                # 各标签渲染逻辑
│       ├── overview.js
│       ├── sessions.js       # 7 标签
│       ├── timeline.js       # 事件时间线（含 reasoning 折叠）
│       ├── agents.js
│       ├── errors.js
│       ├── raw.js
│       └── how.js            # 运行原理
├── tools/
│   ├── import-pet.js         # 宠物包导入 CLI
│   ├── webp-size.js          # webp 头尺寸读取（导入校验）
│   ├── log-latency-probe.js  # 日志摄取延迟探针
│   └── pets-staging/         # 导入暂存区（gitignored）
├── test/                     # node:test 套件（test/index.js 聚合入口）
├── docs/                     # 计划/规格/验收记录（acceptance/）
└── README.md
```

## 开发

无构建步骤，前后端都是原生 JS，改完即生效（开发用 `npm run dev` 自动重启）。

```bash
npm install
npm run dev
```

前端入口 `public/index.html` + `public/app.js`；后端入口 `server/index.js`。各路由按文件拆分在 `server/routes/`。

## 贡献

欢迎提 Issue 和 PR。

1. Fork 本仓库
2. 新建分支：`git checkout -b feat/your-feature`
3. 提交：`git commit -m 'feat: add your feature'`（建议遵循 [Conventional Commits](https://www.conventionalcommits.org/)）
4. 推送：`git push origin feat/your-feature`
5. 提交 Pull Request

请确保：

- 不引入新的原生依赖（除非必要）
- 保持全程只读，不修改 ZCode 数据
- 前端不引入框架 / 构建步骤

## 许可证

[MIT](LICENSE)
