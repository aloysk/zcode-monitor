# zcode-monitor 家底盘点（inventory）

- 盘点日期：2026-09-25（SGT）
- 盘点员：本地家底盘点员（只读；本次未运行任何测试、未起服、未写任何仓库文件，唯一写入即本笔记）
- 主仓 HEAD：c6e67b2（main，clean）；worktree `F:/project/zcode-monitor-plan` 为常驻计划 worktree
- 数据面现状（ls 实测，绝不打开 .db/.db-wal/.db-shm）：`~/.zcode/cli/db/db.sqlite` **18GB**（较红线锚点 14.6-17GB 又涨），`-wal` 21MB、`-shm` 66k；`log/` 仅存 2 个日文件（09-24 230MB / 09-25 14MB，旧文件已被 ZCode 轮转清理）

## 1. UI 面（surfaces）

### 1.1 仪表盘单页 `public/index.html`（hash 路由 SPA，6 视图）
nav 定义 `public/index.html:34-41`；视图渲染器 `public/views/*.js` registerView 注册：

| 视图 | 文件 | 能力 |
|---|---|---|
| overview 实时监控 | views/overview.js（31k，最大视图） | KPI 卡（模型/工具/token 含 cache 拆分/速度卡含 TTFT 均值与 gen_seconds 副行）、24h/7d/today 窗口、时序图（Chart.js 本地分发）、by_model/by_tool 分解、近期速度表（含 TTFT 列）、SSE 实时 feed、快照绊线卡（30s 轮询 `/api/snapshot`） |
| sessions 会话 | views/sessions.js（26k） | 左列表右详情 7 标签：Timeline/Context/Turns/Agents/Tasks/Usage/State（TABS 定义 views/sessions.js:10-18）；Conversation 重放（message+part）、reasoning 思维链、子代理树（metadata.json 富化）、tool-output（exec 目录 stdout/stderr 200KB/64KB 截断） |
| agents 子Agent | views/agents.js | 会话森林（≤500 节点，time_updated 排序，孤儿升根） |
| errors 错误与链路 | views/errors.js | 错误聚合（model/tool 分组 error_type）、慢工具 Top N、日志尾部、trace 瀑布（span 森林自 JSONL 重建） |
| raw 原始数据 | views/raw.js | 22 表白名单查看器（受限 where 文法 + 索引背书排序钳制） |
| how 运行原理 | views/how.js | 数据口径文档页（×N 在飞口径、四类 task_type、速度口径） |

顶栏常驻：状态点+meta（healthLoop 5s）、快照活动红标（snapshotLoop 30s）、WAL 合并按钮（force 首部闸）、主题切换（'t' 快捷键）；隐私提示条（localStorage 关闭记忆）。

### 1.2 桌面 widget 胶囊 `public/widget.html`（452 行）
- 速度胶囊：tier 配色数字（<30 红 / 30-80 琥珀 / >80 绿）+ ×N 并发车道徽章 + 30×10s 微 sparkline + 生成中呼吸动画（±12% lightness）+ hover 今日用量卡
- 数据：`/api/widget/recent` 种子（5 分钟滚动窗精确人群，无 LIMIT）→ SSE `/api/live/events` 'model' 增量 + `/api/gen/events` 生成态 + `/api/widget/today`
- 壳窗 240×56 物理（120×28 CSS @200% DPI）；拖动/右键菜单/双击开仪表盘

### 1.3 桌宠 `public/pet.html`（612 行）
- 单文件双尺寸（mini 80×100 / normal 160×190 CSS，container query 缩放）；canvas 精灵动画（rAF+drawImage），Codex 9 行动画契约（idle/running_×2/waving/jumping/failed/waiting_permission/running/review）
- 心情优先级：error（SSE tool_error 4s）> tantrum（4 连击）> gen（tier 选 run 组）> cruise > sleep（60s 无活动 + zzz）
- 数据：`/api/widget/recent` 5s 轮询 + `/api/gen/events` + `/api/pets` 包注册表；轮换 10 包（public/pets/<id>/{pet.json,spritesheet.webp,NOTICE.md}）
- 手势：拖动/右键（含「重启面板」）/双击切换/滚轮换形/4 连击 tantrum

### 1.4 图鉴/导入 `public/pets-preview.html`（10k）
- 候选预览 + 「从暂存导入」面板（`/api/pets/staging` 列表 → `POST /api/pets/import`，许可证未知须 ack）

### 1.5 WinForms 壳 `shell/Program.cs`（61k，WebView2 无边框三形态）
- 胶囊 /pet? 否——胶囊=/widget、mini pet & normal pet =/pet（Program.cs:3-5 注释）；吸附 ZCode 窗口、右键菜单（重启面板=RestartServerAsync 三态探测+netstat 定位+仅 node 放行强杀）、ZCODE_WIDGET_CHILD=1 拉起 companion 模式

## 2. API 端点族（endpoints）

全部挂 `/api`，经回环 Host 闸 + express.json（仅 /api）+ 错误翻译层 + 终端消毒器。装配见 `server/index.js`：

| 端点 | 方法 | 实现 | 要点 |
|---|---|---|---|
| /api/health | GET | health-route.js | 活连接探测、zcode_running、wal_bytes/待合并、last_checkpoint |
| /api/overview | GET | routes/overview.js | window=24h/7d/today；kpis+series+by_model+by_tool+speed+recent_speed(50) |
| /api/sessions | GET | routes/sessions.js:42 | q/task_type 筛选，limit clamp [1,500] |
| /api/sessions/:id | GET | :57 | sessionGet |
| /api/sessions/:id/turns | GET | :64 | turn_usage 时间线 |
| /api/sessions/:id/conversation | GET | :68 | message+part 重放，max clamp [1,2000] |
| /api/sessions/:id/activity | GET | :77 | model+tool 合并活动流，limit [1,1000] |
| /api/sessions/:id/reasoning | GET | :85 | 思维链文本，limit [1,500] |
| /api/sessions/:id/children | GET | :93 | 子代理树 + agents/<parent>/agent_*/metadata.json 富化（段安全闸） |
| /api/sessions/:id/tool-output/:toolCallId | GET | :132 | exec/<sess>/<call>-stdout/stderr.log（200KB/64KB 截断） |
| /api/agents/tree | GET | routes/agents.js | 森林 ≤500 会话，project_id 可选 |
| /api/trace/errors | GET | routes/trace.js:11 | 错误聚合+清单，kind/window/limit |
| /api/trace/slow-tools | GET | :29 | 慢工具；window=all → 30d+rowid≤10万 双钳制 meta 注明 |
| /api/trace/logs/tail | GET | :54 | 当日 JSONL 尾部 ≤2000 行 |
| /api/trace/trace/:traceId | GET | :61 | span 森林重建（今/昨两文件） |
| /api/live/events | GET SSE | routes/live.js | 1.5s 轮询 rowid 水位，model/tool 事件，25s 心跳 |
| /api/gen/state | GET | index.js:210 | {generating,sessions,inflight,lastToolError} |
| /api/gen/events | GET SSE | index.js:220 | start/end/lanes/tool_error 边沿 |
| /api/widget/recent | GET | index.js:257 | 5 分钟精确滚动窗（completion 时间判定，无 LIMIT） |
| /api/widget/today | GET | index.js:214 | 今日 token 总量+请求数 |
| /api/transcript/:sessionId | GET | routes/transcript.js | transcript.jsonl 事件流（**当前真机 0 个 transcript.jsonl，恒 found:false——见 §6 数据面**） |
| /api/raw/:table | GET | routes/raw.js | 22 表白名单、受限 where 文法、索引背书 order、巨表 COUNT≈MAX(rowid) |
| /api/snapshot | GET | snapshot-watch.js | 绊线状态（active/latched/silent/unreadable 等） |
| /api/checkpoint | GET | checkpoint-route.js | WAL 折叠；force 需首部 X-Zcode-Monitor-Checkpoint；wal_active 409 不可绕 |
| /api/restart | POST | restart-route.js | 自重启；首部 X-Zcode-Monitor-Restart:1；幂等闩；child stderr→logs/restart-child.log |
| /api/pets | GET | index.js:261 | 包注册表（public/pets 扫描） |
| /api/pets/staging | GET | index.js:267 | tools/pets-staging 暂存清单 |
| /api/pets/import | POST | pet-import.js | 导入；首部 X-Zcode-Monitor-Import；许可证白名单/ack；32MB sheet 上限 |
| /widget、/pet | GET | index.js:253-255 | 两页面（SPA fallback 之外显式路由） |

## 3. 数据库表与关键字段（从仓库 SQL 推断，未打开 .db）

权威 schema 注释锚点：zai-org/ZCode `session-store/migrations.ts`（migration 0010_usage_observability，db.js:156-167 引用）。

- **model_usage**（38.6 万行 @2026-09-23 实测锚点）：id, session_id, turn_id, trace_id, status(completed/error/cancelled), started_at(索引 model_usage_started_model_idx 最左), duration_ms, time_to_first_token_ms(NULL≈22%), query_source(main_turn/subagent/workflow_child/session_title/compact…), model_id, provider_id, variant, mode, agent, input_tokens(含 cache_read), output_tokens, reasoning_tokens, cache_read_input_tokens, cache_creation_input_tokens, computed_total_tokens(官方预计算权威总量), tool_call_count, error_type/error_code/error_message
- **tool_usage**（52.3 万行锚点）：id(TEXT 主键非 rowid 别名), session_id, turn_id, trace_id, tool_call_id, tool_name, status, started_at(索引), duration_ms, completed_at, side_effect_scope, read_only, approval_status, exit_code, output_bytes, stderr_bytes, error_*
- **turn_usage**：session_id, turn_id, status, trace_id, user_message_id, started_at(索引), first_token_at, completed_at, duration_ms, time_to_first_token_ms, model_request_count, model_retry_count, tool_call_count, tool_error_count, input/output/reasoning/cache_*_tokens, computed_total_tokens, context_exceeded, error_type/code（不含 session_title side call）
- **session**（1.77 万行锚点）：id, title, task_type(main/subagent_child/workflow_child/selection_side_chat…), directory, parent_id, project_id, time_created, time_updated
- **message**（72.4 万行锚点）：id, session_id, sequence, time_created, time_updated, data(JSON: role/modelID/providerID/tokens/anchor.turnId/contextSnapshot.envInfo/time.completed=livegen 在飞判据)
- **part**（293.7 万行锚点）：id, message_id, sequence, time_created, data(JSON: type=reasoning/text…, text, time.start/end)
- **session_entry/session_target/session_input/session_task_link/input_history/local_setting/todo/permission/schema_migration**：raw 白名单小表；todo 已被 views 消费（/api/raw/todo）
- **workflow_definition/workflow_run/workflow_activity/workflow_event**：官方运行册（本机实测全空）
- **dwf_run(≈53)/dwf_actor(≈0.8k)/dwf_node(≈2.9k)/dwf_event(≈1.7万)**：动态工作流真身运行册；dwf_event.payload_json 长尾宽行（R-16① 增长绊线）
- 索引事实（raw.js:61-76）：message/part 无可用时间索引（ROWID_ONLY）；model_usage/tool_usage/turn_usage 只放行 started_at；session_entry time_created；input_history time_created desc

## 4. ~/.zcode 下未被仪表盘利用的数据面（untappedData，均 ls/head 实测形态）

已利用：`cli/db/`（SQLite 主库）、`cli/log/`（JSONL 日志：live feed/trace/瀑布）、`cli/agents/<parent>/agent_*/metadata.json`（子代理富化）、`cli/exec/<sess>/<call>-stdout|stderr.log`（tool-output 端点）、`v2/checkpoints/`（快照绊线监视）。

未利用（内部底牌）：
1. **`cli/rollout/`**：`model-io-sess_dwf-<runId>-actor_N_M.jsonl` — 逐请求完整模型 IO（request.body.system/messages、response、durationMs、attempt、stopReason）。实测样本含子代理 system prompt 全文。当前仅 3 个文件（dwf actor 的模型 IO 落盘），是「请求级重放/审计」唯一原始面；token-speed-monitor 生态正以该形态为主数据源。
2. **`cli/exec/`**（16,304 条目）：除已用的 `<call>-stdout/stderr.log` 外，还有根级散件（bash-startup、cname-test、pr10_diff_full.txt、screen-now.png）与 `shell-snapshots/snapshot-*.sh`（bash 环境快照脚本，时间戳命名）。
3. **`cli/image-cache/`**（69 条目）：`image-<hash>.png`，多数按 `sess_<id>/` 分目录 — 会话内截图/图片产物（含 dialog_after_fix.png 等根级调试图）。可作为「会话画廊/证据回看」面；注意隐私。
4. **`cli/artifacts/`**（4,549 条目）：`<sess>/call_<id>-tool-result-<uuid>.json` — 结构化工具结果工件（JSON），另有根级 asm_diff.txt 等。比 exec 的纯文本 stdout 更结构化。
5. **`cli/agents/<parent>/agent_*/`**（213 父会话 / 7,162 agent 目录）：metadata.json 之外还有 **output.txt / task.output（子代理最终交付文本）** — 仪表盘只读 metadata.json，交付物未利用。**注意：transcript.jsonl 当前 0/7162——ZCode 已停写该文件**（transcript.js 模块与 /api/transcript 端点因此恒 found:false，是真数据面退化事实）。
6. **`cli/memories/projects/`**（按 `<dir>-<hash>` 分目录）：Serena 式项目记忆库，会话内容之外的长期记忆面。
7. **`cli/plugins/`**：installed_plugins.json / known_marketplaces.json / icon-sources.json + `cache/<marketplace>/` + `data/<plugin>@<marketplace>/` — 已装插件与 MCP 面的静态清单（How 页截图曾暴露 MCP 服务器名，R-15 隐私注记相关）。
8. **`cli/config.json`**（87k）+ 多份 .bak：hooks.events.* 等运行时配置（生态计划明确**只读记录、绝不写**）。
9. **`v2/sessions/<hash>/claude-import-*.json`**：Claude 会话导入工件——ZCode 自身的会话迁移面，仪表盘未触及。
10. **`v2/` 其余**：acp-auth/acp-config/acp-traffic-proxy、bots-model-cache、crash/、credentials.json 等——多涉凭据/敏感（绝不入面板，仅登记存在性）；`~/.zcode/notification-events.jsonl`（850B）、`tool-error-logs/`、`feedback/` 亦是潜在观测面。
11. **`~/.zcode/quarantine/`**：治理隔离区（删除通道产物），面板未利用。

## 5. 前端风格事实（styleTokens，自 styles.css/widget.html/pet.html 提取）

**仪表盘**（styles.css:11-127，对齐 kimi-vis 参考页）：
- 双主题：`:root[data-theme="dark"]`（默认）/ `[data-theme="light"]`；`color-scheme` 联动；localStorage `zc-theme` + `?theme=` 覆盖 + 't' 键切换
- 暗色表面栈：--bg #0b0d12 → surface-0 #0f1219 → 1 #12151c → 2 #1a1e27 → 3 #1f2430；边框 #2d3342 / border-soft #1f2430；浅色对应 #f6f8fa/#fff/#f0f3f7/#e6ebf1/#d9e1ea/#cdd6e2
- 文本栈：--fg #fafbfc → fg-1 #e4e8f0 → fg-2 #bfc6d4 → fg-3 #94a3b4 → fg-4 #7f8aa0(AA≥4.5:1 修正) → fg-5 #454c5e；浅色 #1f2328→#b1bac4
- 类目色（事件类型）：conversation #38bdf8 / llm #8b5cf6 / llm-2 #a78bfa / tool #22d3ee / tool-2 #14b8a6 / network #60a5fa / usage+prompt #4ade80 / lifecycle #6366f1（浅色档整体加深，如 #0969da/#8250df/#1a7f37）
- 严重度：ok #4ade80 / warn #fbbf24 / err #f87171（浅色 #1a7f37/#9a6700/#cf222e）
- 强调：--accent #38bdf8（暗）/ #0969da（亮）；--accent-2 #a78bfa / #6f42c1
- 字体：UI "Geist"→-apple-system→…→"Microsoft YaHei" 栈；mono "JetBrains Mono"→ui-monospace→Consolas；基准 13.5px/1.5；数字 tabular-nums
- 圆角克制：--radius 4px / sm 2px / lg 6px；卡=surface-1+1px 边框+radius-lg；KPI 卡同构；徽标 color-mix 8%/30% 透明底；阴影 0 6px 20px rgba(0,0,0,.5)
- 图表调色板走 CSS 变量（app.js chartPalette 经 getComputedStyle 读 --chart-*）

**widget/pet 两页**（Spectrum 2 token 子集，widget.html:30-45 = pet.html:55-73 完全一致）：
- `light-dark()` 双态：surface-card #fff/#222、text-heading #131313/#f2f2f2、negative #d73220/#df3422、accent #3b63fb/#8ea5fb、notice #b35600/#e06400（AA 修正注释）、positive #05834e/#068850
- 字体 "Source Sans 3"+"Noto Sans SC"（Google Fonts @import，唯一外联——R-8 未决）+ "Source Code Pro"
- 速度 tier 三档 <30 红 / 30-80 琥珀 / >80 绿，与仪表盘 KPI 约定一致；数字 tabular-nums 600 weight；pet 卡 radius 16px（窗口 region 实际持圆角）

## 6. 硬红线（constraints，AGENTS.md「硬红线」+ 代码内不变量）

1. **对 `~/.zcode/` 零写入**：只读承诺；唯一例外 = ZCode 退出且 -wal 静默 ≥60s 后 `wal_checkpoint(TRUNCATE)`；`?force=1` 不得绕过 wal_active 409（checkpoint-route.js:32-39 实钉）
2. **性能红线**：真实库（现已 18GB）每条 SQL 必须命中 started_at 索引或 rowid 尾界；禁止事件循环长阻塞（better-sqlite3 同步）；行数参数一律 clampLimit/clampAtLeast；历史事故（tasklist 同步 5-7s、message 全表扫 2.4s、负 LIMIT 整表 8.8s）同类模式视为回归
3. **禁止删除文件**（治理通道）；本仓编辑一律 feature 分支 worktree（main 编辑被 hook 拦截）
4. 子进程控制台程序必须 `windowsHide:true`（zcode-runtime.js:64-69 闪窗事故实证）
5. 面板无鉴权：回环 Host 闸（127.0.0.1/localhost/[::1]）+ 写端点自定义首部闸（Import/Checkpoint/Restart）+ CSP 自源钉死 + pets 静态非图片强制下载
6. 端口约定：7331 生产（勿动用户实例）、7399 冒烟；遗留唯一登记处 docs/acceptance/residuals.md
7. 推送 origin=fork（aloysk/zcode-monitor）；upstream 只读参考

## 7. 第一轮生态采纳计划工作包状态（docs/ecosystem-adoption-plan.md:3-6）

计划 v1（2026-09-21，修订 09-22）**已全部实施**（WP0-WP5，分支 feature/ecosystem-adoption-plan，2026-09-23 收尾定稿）：
- WP0 测试基建：✅ node:test + tmpdir fixture（test/helpers/fixture-db.js），零新依赖
- WP1 宠物包一键导入：✅ server/pet-import.js（校验/NOTICE/许可证确认）+ CLI tools/import-pet.js + 图鉴入口；10 包全 Codex 格式
- WP2 token 口径对齐：✅ 全部查询补官方源码出处注释；computed_total_tokens=官方权威总量；**勘误：ccusage 对 ZCode 实测不可用，对账以纯 SQL 交叉核对收口**（usage-accounting.md §5.1）
- WP3-lite JSONL 实时性：✅ log-tail.js fs.watch + 字节偏移增量 + 降级轮询（零写入）
- WP4 桌宠行为：✅ error 态接线（livegen tool_error）/入睡/连击/tantrum + sanitize.js 消毒共享模块（双端导出，有单测）
- WP5 隐私提示：✅ 仪表盘横幅 + README「隐私提示」+ 快照绊线（后独立成轮）
- 未决人工项：A1-8（真实包导入实机）/A4-7（壳内交互实机）→ residuals R-1；R-8 字体本地化二选一
- backlog：BP1 t/s 进程 IO 实测（先调查后立项）、BP2 壁纸实验（Lively）

计划后已另合入的轮次（AGENTS.md 当前状态）：速度生成口径轮（TTFT 剔除分母）、重启链六视角终审、胶囊重启阻塞态修复、start-detached 脚本轮、workflow_child 计数轮及其六视角终审、快照绊线、tasklist 闪窗快修——main@c6e67b2。

## 8. 遗留项速览（docs/acceptance/residuals.md，R-1..R-19）

未决/已知取舍要点：R-1 人工实机评审（human-gate）；R-3 win32 CLI 形态探测盲区（有 -wal 静默兜底）；R-4 四页视觉人工看图；R-8 Google Fonts 本地化二选一；R-9 overview 回退路径慢但可用；R-11 大 WAL 折叠 I/O 不受 busy_timeout 约束；R-12 staging 硬链接不在防御面；R-13 raw 自由 where 亚秒残余；R-14 绊线覆盖边界（①-⑤）；R-16 raw dwf_* 增长绊线（②已销账）；R-17 重启接替失败静默（日志可查 restart-child.log）；R-18 非 node 占口拒杀；R-19 壳恢复链观测面缺口。已销账：R-2/R-5/R-6/R-10/R-15（R-15 含隐私披露先例：真实会话数据截图随 fork 推送已披露）。

## 9. 测试与脚本

- test/ 26 个文件（25 个 *.test.js + index.js 聚合 + helpers/）：api-hardening、assembly-contract、db-caliber、db-retry、db-smoke、frontend-contract、live-rowid、livegen-error、log-tail-behavior、log-tail、pet-import、pet-page、pet-state、probe-windows-hide、restart-route、sanitize、sessions-routes、slow-tools、snapshot-watch、speed-caliber、start-detached、transcript、workflow-child-accounting、zcode-runtime（本次未运行）
- scripts/start-detached.js：三态探活（ok/refused/blocked/answered:N）幂等拉起；START_TIMEOUT_MS 默认 15s；stderr 续写 logs/restart-child.log；不设 ZCODE_WIDGET_CHILD（长驻语义）
- 运行时依赖仅 2：express ^4.21 + better-sqlite3 ^11.3（package.json）；Node ≥18（本机 v24）
