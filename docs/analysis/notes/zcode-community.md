# ZCode 与智谱/GLM 社区侦察笔记（第二轮生态采纳）

- 侦察员：ZCode与智谱社区侦察员
- 日期：2026-09-25（SGT）
- 任务：找第一轮生态采纳计划（docs/ecosystem-adoption-plan.md）之外的 ZCode/智谱/GLM 生态新候选
- 纪律遵守：只写本笔记文件；未运行 git commit/push；未打开 ~/.zcode 下任何数据库文件

## 0. 检索方法与工具（过程记录）

- 主力工具：GitHub MCP（search_repositories / search_code / get_file_contents）、zread MCP（get_repo_structure / read_file）、WebSearch（内置 web_search_prime）、WebFetch。
- gh CLI 未使用（github MCP 全程可用，无需降级）。
- zread 索引限制实证：beecode-rs/usage-pulse、tizerluo/zcode-open-bridge 在 zread 返回 "repo not found"，改用 github get_file_contents 成功读取（usage-pulse 已读，open-bridge 未再读）。
- WebFetch `https://zcode.z.ai/usage-stats` 返回 404（官方文档站具体 usage-stats 页路径未核实到，unverified）；官方文档站 zcode.z.ai 本身存在（WebSearch 结果引用，含「View Coding Plan usage」章节标题）。
- 检索词实际使用：`zcode in:name,description,readme`、`user:yiyanwannian`、`user:zai-org`、`GLM coding plan usage tracker`、`zcode in:name,description z.ai`、`repo:zai-org/zai-coding-plugins`、code 搜索 `monitor/usage` / `turn_usage` / `tool_usage`（均限定 repo:zai-org/ZCode）、WebSearch「zcode monitor usage dashboard GLM coding plan」「"Z.ai GLM Usage Tracker" VS Code extension」「costgoat GLM coding plan」。
- 重名甄别：`zcode` 全域搜索命中大量 README 提及型结果（ccusage/tokscale/codeburn/agentsview 等 Claude Code 系通用工具）与无关项目（如 sabre-io/Baikal）；均已剔除，只保留 ZCode/GLM 专属或直接支持 ZCode 的项目。老编辑器 zCode（重名产品）在搜索中未构成主要噪音。

## 1. 最重要的结论（正+负发现）

### 1.1 正发现：官方 harness 开源，本地数据面知识全部可吸收

**zai-org/ZCode**（Z.ai 官方 coding agent harness，Apache-2.0，Copyright 2026 Z.AI Co., Ltd，LICENSE 已逐字核实）2026-09-20 创建，现 6686 stars / 1995 forks。monorepo：`apps/zcode-cli`（Agent CLI/TUI/运行时）+ `packages/{desktop,web,server,services,ui,...}`（Electron 桌面 + Web 工作台）。README 核实。

对本仓最高价值的三处源码（均已逐字读取，SHA 29628c9）：

1. **`packages/services/src/usage-stats/usageStatsService.ts`**——官方用量统计服务：
   - App Usage「现读取 agent 数据库真实统计（model_usage/turn_usage/tool_usage），经 ZCode Protocol usage/stats 取回，不再读本地 session JSON 估算」；
   - Coding Plan 页面走 `BigModelUsageQuotaProvider`，端点 `/api/monitor/usage/quota/limit` 与 `/api/v1/coding-plan/reset`；有 Coding Plan Reset（窗口重置机会请求/使用/历史已读标记）完整机制；
   - 官方 Server MCP 额度走 `zcodeMcpQuotaProvider`（与 server MCP 调用同套 5 身份头）；
   - 「任何 monitor 失败都不能回退本地数据，保持数据源隔离」——官方自己隔离了远程配额链路与本地统计链路。

2. **`apps/zcode-cli/packages/adapters/src/storage/session-store/repositories/usage.ts`**——zcode-monitor 所读 SQLite 的官方写入端，完整表结构：
   - `model_usage` 列全集（39 列）：除本仓已用的 token/时长/TTFT 列外，还有 `query_source`（值域 main_turn/subagent/workflow_child，与 dwf 计数对应）、`variant`（=reasoning level，思维链档位）、`agent`/`mode`/`task_type`、`attempt_index`/`retry_count`/`retryable`、`cancelled_by_user`/`context_exceeded`、`error_type/error_code/error_message`、`reasoning_tokens`、`cache_creation_input_tokens/cache_read_input_tokens`、`provider_total_tokens/computed_total_tokens`、`raw_usage_json/provider_metadata_json`；
   - **`turn_usage` 表**（本仓未用）：session_id/turn_id/status/duration_ms/time_to_first_token_ms/model_request_count/model_retry_count/tool_call_count/tool_error_count/各 token 列/retryable/cancelled_by_user/context_exceeded/error_type/error_code；
   - **`tool_usage` 表**（本仓未用）：tool_name/side_effect_scope/read_only/destructive/approval_status/status/duration_ms/time_to_first_output_ms/exit_code/output_bytes/stdout_bytes/stderr_bytes/truncated/retry_count/error_*；
   - **保留策略：`USAGE_RETENTION_DAYS = 30`**——三表行 30 天后 prune（每次写入后触发）；
   - 官方聚合维度 `queryAppUsage`：模型侧 avg TTFT/modelErrorCount、回合侧 totalSessions/avgTurnDurationMs/longestSessionMs（按 session 聚合 turn duration 之和取最大）、工具侧 toolCallCount/toolErrorCount、按本地日 dayIndex（tzOffsetMs 偏移）归桶 totalTokens/turnCount/toolCallCount、dayIndex×model_id 明细；
   - **官方 session 级 token 口径 `queryTaskUsage`**：按 query_source（main_turn/subagent/workflow_child）维护 inputBaseline——压缩使后续 context input 变小时不回扣历史、baseline 降到压缩后值再按增量计；input 侧口径三分支：input<=0 用 cache 两列之和；cache<=0 用 input；否则用 providerTotalTokens 与 input(+cache)+output 的距离判断是否叠加 cache。第一轮的 token 口径对账可直接吸收此官方口径。

3. **插件系统**（zmem README 证实）：ZCode 桌面有 Settings → Plugin Management → Discover → 粘贴 GitHub URL 装插件；原生记忆存储 `~/.zcode/memory/store.sqlite`、`~/.zcode/v2/setting.json` 有 `memoryEnabled` 开关——zcode-monitor 可观测对象可扩展到插件/记忆状态。

### 1.2 负发现：本地深挖仪表盘在 ZCode 生态是空白（先发机会确认）

- **没有任何第三方项目做「读 ZCode 本地 SQLite/JSONL 的会话深挖仪表盘」**。全部 GLM/Z.ai 用量工具（约 10 款，见 §3）走远程配额 API（/api/monitor/usage/*），形态为 VS Code 状态栏扩展、Raycast、浏览器扩展、macOS 菜单栏、Electron/Tauri 桌面常驻。zcode-monitor 的定位（会话深挖/子代理树/错误链路/SSE 实时流/桌宠）在 ZCode 生态无竞品。
- **上游作者 yiyanwannian 名下 12 个仓库**，除 zcode-monitor（3 stars/2 forks，2026-09-10 最后更新）外全是无关旧项目（Go 基准测试、爬虫等）——上游无生态延伸，不存在「上游系」工具群。
- **`zcode-plugins-official` 该名字不存在**；官方插件仓库实际是 `zai-org/zai-coding-plugins`（"Z.ai Coding Plugins Marketplace in Claude Code"，130 stars/20 forks，Apache-2.0，2026-09-23 更新）。插件两个：`glm-plan-usage`（Claude Code 内查 GLM Coding Plan 配额与用量，`/glm-plan-usage:usage-query`）与 `glm-plan-bug`（提交反馈，会摘要会话上下文）。安装也可走 `npx @z_ai/coding-helper`。
- **CostGoat（costgoat.com GLM Coding Plan Usage Tracker）未能核实**：WebSearch 首轮给过链接，第二轮定向检索找不到对应 GitHub 仓库，无法确认其真实性——标 unverified，不收录 discoveries。
- 智谱开放文档（docs.bigmodel.cn）有「用量查询插件」页（WebSearch 引用），即 zai-coding-plugins 的 glm-planusage 文档化；另有一款「AI Coding Plan Monitor」项目自述「智谱用量查询不支持 API Key（反爬严格），引导用户去官方统计页」——该仓库未能按名字定位（GitHub 搜索 `"AI Coding Plan Monitor" in:name,description` 0 结果），作为边界情报记录：**智谱侧配额查询可能比 z.ai 侧更受限**。

## 2. 官方生态（zai-org，53 仓库）

| 仓库 | stars | 说明 |
|---|---|---|
| zai-org/ZCode | 6686 | 官方 harness（§1.1 已详述） |
| zai-org/zai-coding-plugins | 130 | 官方 Claude Code 插件市场（§1.2 已详述） |
| zai-org/Synapse | 515 | 自托管 AI workspace（共享队友/对话/记忆/插件与 MCP 治理），TypeScript；与监测仪表盘关联弱，仅记录 |
| zai-org/GLM-5（7234）/ GLM-4.5（4424）/ CodeGeeX 等 | — | 模型仓库，与工具生态无关，剔除 |

## 3. GLM Coding Plan 用量监控工具群（第三方）

通用底座知识（多项目交叉证实）：
- 官方监控端点三件套：`/api/monitor/usage/quota/limit`（当前配额百分比）、`/api/monitor/usage/model-usage`（模型用量，startTime/endTime 参数）、`/api/monitor/usage/tool-usage`（MCP 工具用量）；
- 双平台：全球 `https://api.z.ai` vs 大陆 `https://open.bigmodel.cn`；
- 鉴权细节：Authorization 头**不带 Bearer 前缀**直接传 token（opencode-glm-quota 源码级描述）；quota 端点是轻量管理读、**不消耗 token 配额**（Fahim-Yusuf FAQ）；
- 配额窗口概念：5 小时滚动 token 窗 + 周（Claude）/月（z.ai MCP）长窗 + 月度 MCP 工具调用配额（如 26/1000）；计划档位 Lite/Pro/Max；
- 智谱/BigModel 侧另有 coding-plan reset 机制（官方源码 `/api/v1/coding-plan/reset`）。

逐个（全部经 GitHub 元数据核实，README 标注者已逐字读）：

1. **guyinwonder168/opencode-glm-quota**（30★，MIT，npm 包，2026-09-17 更新，README 已读）：OpenCode 插件 `/glm_quota`。三端点全对接；MCP 工具细分（web_search/web_reader/zread 各自计数）；账号计划档显示；重置倒计时（本地时区 HH:MM）；ASCII 进度条渲染；平台自动检测；fail-fast 无重试。自述从 zai-coding-plugins 改编。
2. **melon-hub/zai-usage-tracker**（7★，MIT，VS Code Marketplace + Open VSX 双上架，2026-08-31 更新，README 已读）：状态栏常显 `✓ ⚡ 1% • 14.6K tokens`（连接态✓/⚠ + 百分比 + token 数）；悬停 tooltip 含 5h 进度条 + 7 天/30 天（prompts+tokens）+ 最后同步时间；档位常量 Lite≈120 prompts/5h、Pro≈600、Max≈2400；≥80% 状态栏 warning 底色；密钥存 VS Code SecretStorage。
3. **Fahim-Yusuf/zai-glm-usage-tracker**（0★但 v0.3.0、49 单测、README 已读）：VS Code + Antigravity IDE。10s 高频轮询 + 智能降频（失焦/空闲→300s，键击即恢复）；阈值告警 80%/95% 按窗口去重、翻转自动重臂；**burn velocity（+X.X%/hr）与 time-to-exhaustion 预测，和下次重置时间交叉对比**；历史 SVG 折线/面积图（24h/7d/30d）+ 阈值参考线 + KPI 卡；一键 Markdown/CSV 报告；多账户（Personal/Work/Client）；401/403 暂停轮询、Stale 态保缓存；0 运行时依赖 + CSP nonce + 凭据脱敏。
4. **beecode-rs/usage-pulse**（3★，MIT，v0.3.0 自述 POC/vibe coding，macOS+Linux，README 已读）：Electron 桌面常驻。**5h 窗环形 + 长窗条形**；z.ai 卡显示月度 MCP 配额 consumed（26/1000）；活动会话列表（本地+SSH 远程，项目目录/上下文 token/模型/分支/pid/uptime，点击聚焦终端）；菜单状态点语义（红=任一屏出错、**紫=有会话在等你回答**、橙=额度临期或步速超窗）；用量通知；OS 调度器（launchd/systemd）定时小 prompt 刻意开新 5h 窗（窗口对齐工作日的玩法）；Windows 支持在 planned。
5. **pauldub/zai-coding-plan-raycast**（0★，2026-06-23 创建，**README 未读**，仅 GitHub 搜索元数据）：Raycast 扩展——Lite/Pro/Max 档、5h&每周 prompt 窗、MCP 工具配额、重置倒计时、菜单栏指示器。
6. **ecerutti/glm-usage-monitor**（0★，浏览器/Chrome 扩展，元数据）：工具栏实时 5h/每周 token 限额、月度 MCP 配额、重置时间。
7. **hous-lab/glm_usage_tracker**（0★，macOS 菜单栏，元数据）：智谱+火山方舟 coding plan 用量。
8. **victorhdchagas/zai_quotecheck**（0★，Go，元数据）：TIME_LIMIT/TOKENS_LIMIT 用量 + 自动重置追踪。
9. **EnlightenK/ai-coding-usage-tracker**（0★，Python，元数据）：多计划（MiniMax/GLM/Claude Code/Codex）配额/用量/订阅状态。
10. **Hermbot14/claude-code-usage-tracker**（0★，Electron+React，元数据）：跨 provider（Claude/Z.AI/Zhipu/Codex）系统托盘+overlay，自动读本地 CLI 登录态或 API key。
11. **creditai/Coding-Plan-Monitoring-System（CPMS）**（1★，MIT，Tauri 2 + React 18，README 已读）：多服务商（智谱按量/GLM Coding Plan/MiniMax CN+Global/DeepSeek）。**10s 快照检测+60s 长期追踪双周期**；消耗速率（tokens/min 或货币/min）颜色告警；**超支预测**（速率推算耗尽时间 vs 重置周期）；重置倒计时；**毛玻璃悬浮窗**（始终置顶、可拖拽、悬停显关闭——形态同本仓桌宠 widget）；状态灯 🟢空闲/🔴使用中/🔵检测中；API key AES-GCM（OS 机器密钥派生）；零遥测。

## 4. ZCode 本身第三方周边

1. **TriDefender/zcode-api**（327★，MIT，2026-06 创建，2026-09-24 活跃，README 已读）：Z.AI/Bigmodel coding-plan 反代（OpenAI+Anthropic 双协议）。对本仓有用的知识：**coding-plan 档模型元数据清单**（glm-4.5-air/4.6/4.6v/4.7/5/5-turbo/5v-turbo/5.1/5.2；上下文 200K（5.2 为 1M）、最大输出 128K）；OAuth 流程（chat.z.ai authorize → zcode.z.ai token exchange）；可从 ZCode 桌面配置直接导入 API key；coding-plan vs start-plan 双层路由。
2. **csuftt/zcode-jetbrains-plugin**（20★，MIT，2026-08 创建，README 已读）：JetBrains IDE 插件，`node zcode.cjs app-server` 子进程 + stdio JSON-RPC 驱动 ZCode。对本仓可吸收形态：**上下文容量圆环（含用量构成与缓存命中）**、子代理执行过程/最终报告双弹窗、任务清单实时进度、文件改动统计（行内 diff）、**思考耗时统计**、消息锚点导航（用户消息圆点+hover 预览）、应用用量 7/30/全部区间本地统计 + GLM 套餐用量曲线/明细表（标注凭证来源与 key 脱敏）、5h/每周额度查询；凭证位于 `~/.zcode/v2/`；`docs/zcode-appserver-protocol.md` 有完整 app-server 协议整理（RPC 方法/V4 会话协议/反向请求/事件流/错误码）——ZCode 内部协议的社区文档。
3. **tizerluo/zcode-open-bridge**（17★，Python，元数据）：非官方把 ZCode 接入 MCP/ACP 开放 Agent 生态。
4. **zaxbysauce/zmem**（0★，README 已读，工程极重）：ZCode+Claude Code+Codex+Hermes 共享记忆插件（FTS5+可选 ONNX 嵌入）。对本仓的事实价值：ZCode 插件系统安装路径（§1.1-3）、`~/.zcode/v2/setting.json`、`~/.zcode/memory/store.sqlite`。
5. **7836246/kcode**（19★，Apache-2.0，元数据）：ZCode 官方 Apache-2.0 的社区 fork「开源 AI 编程工作台」，与 Z.ai 无关联——许可证先例证据。
6. 打包分发类（信息即可，无吸收价值）：Kasbuky-sudo/NAS-ZCode（fnOS 原生包）、sliced-paraiba/zcode-flatpak、Anyi-qaq/Zcode-bin（AUR）、utom/zcode-oss 等镜像 fork。
7. **alexeygrigorev/codex-zcode**（0★，Rust，元数据）：Codex CLI 的原生 ZCode/Z.AI 集成。
8. **nitishagar/runwaybar**（0★，2026-09-23 刚建，元数据）：Linux 轻量 AI 用量条（Claude Code/Codex/z.ai ZCode/OpenCode）。
9. **scotjam/zcode-remote**（0★，2026-09-24 刚建，元数据）：Android 驱动 ZCode 桌面 live session（Android app + Windows relay）。
10. **a137460387/zcode2api**（0★，元数据）：ZCode 套餐反代 OpenAI/Anthropic 双协议+账号池+**captcha 农场**——灰色项目，明确不吸收、不推荐。
11. **lengjingxu/CLIProxyAPI-ZCode**（0★，元数据）：CLIProxyAPI 插件把 ZCode 配额注册为 zcode/* 模型。

## 5. 未核实项清单（诚实边界）

- CostGoat：WebSearch 两轮未能定位仓库，unverified，不入选。
- zcode.z.ai 官方文档 usage-stats 页具体路径：WebFetch 404，未核实。
- pauldub/zai-coding-plan-raycast、ecerutti/glm-usage-monitor、hous-lab、victorhdchagas、EnlightenK、Hermbot14、tizerluo、7836246、alexeygrigorev、nitishagar、scotjam、lengjingxu 各仓：仅 GitHub 搜索元数据（名称/描述/stars/日期），README 未读，细节以描述为准。
- 本地库 `~/.zcode/cli/` 中 turn_usage/tool_usage 表是否实际存在：按纪律未开库核实；官方写入端源码已逐字核实（这是官方 CLI 写的库，同源）。
- 智谱侧「API Key 反爬不支持用量查询」说法：来自未能定位的「AI Coding Plan Monitor」项目自述（WebSearch 转述），二手信息，待验。

## 6. 对 zcode-monitor 的吸收点汇总（供汇总席取用）

1. turn_usage / tool_usage 两张本地表（若在库中存在）→ 回合级 TTFT/时长/工具错误数、工具维度统计（调用次数/错误率/平均耗时/输出字节/read_only·destructive·approval_status 语义分档）——官方 30 天保留窗口内可查。
2. 官方 queryTaskUsage 的 input 增量口径（压缩 baseline 不回扣）→ 第一轮 token 口径对账的官方锚点。
3. 官方远程配额三端点 + Coding Plan Reset 机制 + 双平台（api.z.ai/open.bigmodel.cn）+ 无 Bearer 鉴权细节 → 配额卡（远程链路，与本仓本地只读不冲突，但需用户自愿提供 token）。
4. usage-pulse：5h 环形+长窗条形、重置倒计时、步速/burn-rate 告警着色、「会话在等你回答」紫色状态点、用量通知。
5. Fahim-Yusuf：burn velocity +X%/hr 与 TTE 预测对齐重置时刻、80%/95% 阈值告警去重与重臂、历史 SVG 折线（24h/7d/30d）+阈值参考线、Markdown/CSV 报告导出。
6. zcode-jetbrains-plugin：上下文容量圆环（构成+缓存命中）、思考耗时统计、子代理过程/报告双弹窗、消息锚点导航；其 app-server 协议文档可作深挖参考。
7. CPMS：毛玻璃置顶悬浮窗（桌宠 widget 同型）、超支预测、双周期探测（快照+长期）、状态灯。
8. TriDefender/zcode-api：coding-plan 模型元数据表（上下文 200K/1M、输出 128K）→ 模型徽标/容量参考线。
9. zmem：ZCode 插件系统、~/.zcode/v2/setting.json、~/.zcode/memory/store.sqlite → 可观测对象扩展（插件/记忆状态页）。
10. 负发现：本地深挖仪表盘无竞品，先发窗口存在；上游无生态。
