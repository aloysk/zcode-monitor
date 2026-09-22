# zcode-monitor 生态调研 · 分析与采纳计划

- 日期：2026-09-21（v1 修订：2026-09-22）
- 状态：**v1（已通过三视角评审并修订）** —— 架构 / 对抗性 / 事实核查三视角的评审共识已逐条落实
- 输入：4 路并行子代理调研（ZCode 生态、Claude Code 生态、桌宠引擎与素材、桌面 widget 与壁纸框架），共核实约 60 个仓库的 README 与许可证
- 性质：**计划文档（已实施）**。评审已通过；WP0–WP5 已于分支 `feature/ecosystem-adoption-plan`（worktree `F:/project/zcode-monitor-plan`）按 T1–T6 顺序实施并逐任务提交（实施状态注记，2026-09-23：HEAD `abead5a`，分支未合并回主仓 main——主仓库代码尚未含本计划改动，勿以主仓代码对照本文档验收）。实施与计划的提交结构差异见 `docs/plans/ecosystem-adoption-v1.md` 的实施留痕。

---

## 1. 背景与目的

调研确认：ZCode（Z.ai 的 coding agent CLI）的第三方生态真实存在且增长极快（集中于 2026-06 ~ 09），监控 / 桌宠 / 用量三条线都有现成成果；同时"会话级 agent 运行可视化（工具链、子代理树、推理链）+ 桌宠"的完整组合**尚无人做**，是 zcode-monitor 的差异化空位。

本文档把调研结论转化为可执行的采纳计划：**吸收什么、以什么顺序、边界在哪、如何验收**。

## 2. 生态快照（调研结论摘要）

### 2.1 关键仓库

| 仓库 | 星数 / 许可 | 与我们的关系 |
|---|---|---|
| zai-org/ZCode | 5.1k★ Apache-2.0（2026-09-20 开源） | 官方 harness 源码，`db.sqlite` schema 的权威来源 |
| zai-org/zcode-plugins | 58★ Apache-2.0 | 官方插件市场，无监控类插件（空位） |
| xhwxt/zcode-token-usage-statusbar | 68★ MIT | 同数据源（只读 `db.sqlite`），token 口径已对齐官方，有 JSON CLI / MCP 可互操作 |
| Masterchiefm/zcode-speed-panel | 20★ MIT | 三形态桌宠 + 速度仪表盘，与我们的 widget 几乎同构；t/s 用进程 IO 实测；"快照防护"是快照上传警示的出处之一 |
| xiufengsun/TokenTracker | 1.7k★ MIT | 多工具用量追踪（已支持 ZCode），排除非 GLM 子代理的过滤逻辑可借鉴 |
| arvelvale/orrery | 19★ MIT | token 记账语义最严谨（cache/reasoning 归属、`turn_usage` 漏 side call） |
| ccusage/ccusage | 18.7k★ MIT | 用量报告事实标准，已支持 ZCode 数据源；fork better-ccusage 明确解析 `~/.zcode/cli/db/db.sqlite` 并内置 GLM 定价；WP2 的对账基准。**勘误（2026-09-23，实施后回填）**：WP2 实测主线 ccusage / fork / statusbar 均不可用于对账（详见 docs/usage-accounting.md §5.1），实际以第 4 级「纯 SQL 交叉核对」收口 |
| rullerzhou-afk/clawd-on-desk | 6.3k★ **AGPL-3.0** | 桌宠交互设计标杆（12 态状态机、权限气泡、连击、入睡），ZCode 一等公民；**只学设计，不抄代码** |
| hoangsonww/Claude-Code-Agent-Monitor | 1k★ MIT | 同款产品架构范本：JSONL 字节偏移增量解析的混合摄取 |
| backnotprop/codex-pets-react | 39★ MIT | `pet.json + spritesheet.webp` 声明式渲染实现，可整段借鉴 |

### 2.2 跨项目验证的技术事实（可作为稳定依赖面）

- **SQLite 主库**：`~/.zcode/cli/db/db.sqlite`（真实库约 14.6GB，见 §6 性能红线），核心表 `model_usage`（每次 API 调用一行）、`turn_usage`、`tool_usage`、message 表；schema 为 "OpenCode-fork"，待对照官方源码核实（WP2 第一步）
- **token 口径**：`input_tokens` 已含 cache-read；官方总量 = input + output + reasoning + cache_creation（cache_read 单列）；`computed_total_tokens` 与该公式的关系待核实（WP2 第一步）；子代理按 `parent_id` 归组去重；`turn_usage` 漏标题生成等 side call
- **Hooks**：`~/.zcode/cli/config.json`（`hooks.events.*`，支持 `UserPromptSubmit` / `Stop` / `PermissionRequest` 等）——**仅作为外部事实记录，我们不写此文件**（WP3 已定为零写入）
- **运行时**：`zcode.cjs` 的 `app-server`（stdio JSON-RPC）；凭据在 `~/.zcode/v2/provider_config.json`
- **桌宠包事实标准**：`<pet-id>/pet.json + spritesheet.webp`（外部目录另有根 `pets.json` 索引与 `npx codex-pet-installer add <slug>` 安装约定——这是外部目录站的做法；**我们不对自己的包目录建对外索引**，见 WP1）

### 2.3 风险信号

- **AGPL 传染**（clawd-on-desk）与**美术版权**（chiikawa / 宝可梦 / 米哈游系粉丝包）
- **隐私**：Hacker News 讨论串（"ZCode silent workspace snapshot upload"）、知乎《智谱ZCode，你打包上传我的代码仓库干什么》、开源中国报道（三者均在 2026-09-18 前后）与 zcode-speed-panel 的"快照防护"均报告 ZCode 会后台上传工作区快照（`~/.zcode/v2/checkpoints/`）——第三方报告，未经我们验证
- **灰色生态**：账号切换 / 额度反代类项目星数最大，不关联、不互链

## 3. 目标与非目标

**目标**
1. 以最小改动接入桌宠包生态（Codex 格式已是现状，补齐校验与一键导入）
2. 用量数字与官方口径对齐，与 ccusage 可单方对账
3. 提升数据摄取实时性（强化 JSONL 追踪，保持对 ZCode 零写入）
4. 桌宠行为与安全升级（error 态接线、睡眠、连击、speech 消毒模块）

**非目标**
- 不做账号切换、额度反代、API 转发（灰色地带）
- 不引入 Live2D / Spine / DragonBones（专有许可或停更）
- 不写 ZCode 的任何数据与配置（只读承诺不变；WP3 hooks 方案已否决）
- 不建对外宠物包索引 / 在线目录（构成再分发，见 §8 与既定决策 §9）
- 本轮只出计划，不动代码

## 4. 现状盘点（我们已有什么）

| 模块 | 现状 |
|---|---|
| `server/db.js`（718 行） | 只读 SQLite 读取器，含各表查询 |
| `server/index.js` `/api/pets`（262 行起） | 已按 Codex 格式（`pet.json + spritesheet.webp`）自动发现包，容忍 UTF-8 BOM 与 snake_case 字段 |
| `public/pet.html` | 已是 Codex Pet pack format：`ROW_ANIMS` 固定 9 行动画契约（idle / running_right / running_left / waving / jumping / **failed** / **waiting_permission** / running / review，186-187 行）；双击切换宠物（511 行）；`IDLE_AFTER` 2 分钟 idle 判定（173 行） |
| `server/livegen.js` + `routes/live.js` | 并发 lane（xN）实时引擎 |
| `server/log-tail.js` / `transcript.js` | JSONL 追踪（轮询式，WP3 强化对象） |
| `public/pets/`（10 个包） | 精选图鉴：**已全部是 Codex 格式**，含每包 NOTICE |
| `tools/` | 已抓取 codex-pet.org / codex-pets.net / petscodex 三份目录 JSON；`webp-size.js` 可读 webp 尺寸；`pets-staging/`（gitignored）已暂存约 23 个包（其中 18 个已含 pet.json，其余仅有素材待规范化）。**勘误（2026-09-23 实测）**：暂存区内容随时间变化，当时实测为 14 个目录、其中 8 个含 pet.json（docs/specs/ecosystem-adoption-v1.md WP1 现状锚点以此为准） |
| `shell/` | WinForms + WebView2 无边框壳，三形态（胶囊 / 迷你宠 / 正常宠），吸附 ZCode 窗口 |

结论：**Codex 单格式兼容的事实基础已经就位**（现有 10 包即 Codex 格式，`/api/pets` 已按此扫描），WP1 是把"手工放目录"升级为"校验 + 一键导入"的正式能力；WP0 先补测试基建，其余 WP 的验收都跑在上面。

## 5. 工作包（WP）

> 每个 WP 含：动机 / 外部来源 / 改动面 / 验收标准 / 风险。优先级 P0 > P1 > P2。新增依赖一律先过门槛：**优先 Node 内置模块**，内置覆盖不了才论证引入（WP0 确立）。

### WP0（P0）测试基建（新增）

- **动机**：后续所有 WP 的验收都依赖可重复的测试；真实库 14.6GB 且只读，测试必须与真实数据完全隔离
- **改动面**：
  - 用 Node 内置 `node:test` 搭测试入口（`node --test`），**零新依赖**
  - 临时目录 fixture 库：伪造 `~/.zcode/cli` 形状的小型 SQLite 库与 JSONL，全部落在 `os.tmpdir()` 临时目录、用完即弃，**绝不触碰真实库**
  - 测试与 cwd 无关：路径一律由模块参数或环境变量注入，不依赖进程工作目录
  - 确立依赖门槛：优先 Node 内置模块（`fs` / `path` / `node:test` 等），任何新依赖须先论证内置模块无法覆盖
- **验收**：`node --test` 全绿；fixture 全部位于临时目录（测试内断言）；换任意 cwd 运行结果一致
- **风险**：低

### WP1（P0）宠物包一键导入：Codex `pet.json + spritesheet.webp`（单格式）

- **动机**：杠杆最大的一条。**现状已是单格式**：`public/pets/` 10 个包全部是 Codex 格式，`/api/pets` 已按 `pet.json + spritesheet.webp` 扫描（`server/index.js:262`），`public/pet.html` 自称 Codex Pet pack format（第 11、180 行）。缺的不是格式兼容，而是**导入时的质量把关**——社区包质量参差（sheet 尺寸异常、行数不符、帧表错误），需要校验层
- **来源**：backnotprop/codex-pets-react（MIT，reducer / atlas 实现）、`tools/webp-size.js`（已有 webp 尺寸读取）
- **改动面**：
  - **sheet 布局校验与帧表规范化**：用 `webp-size.js` 读尺寸，按 9 行契约（`ROW_ANIMS`）推导帧表；行列越界、空 sheet、非 9 行布局等异常给出明确报错；`PACK_OVERRIDES` 例外机制保留
  - **一键导入**：共享模块 `server/pet-import.js`（校验 + 落位 + NOTICE 管线）+ CLI `tools/import-pet.js` + 图鉴页导入入口（三入口复用同一模块）
  - NOTICE 管线：导入时生成本包 NOTICE（来源、许可证、非商用声明）
  - **明确不做**：双格式注册表（无自有格式与 Codex 格式并存的必要）；包目录根 `pets.json` 对外索引（对外可被第三方识别抓取，构成再分发，与 §8 的 IP 对策冲突）
- **验收**：一个未经改动的 Codex 包目录 → 导入 → 图鉴可见、可预览、可选用；错误格式（缺 pet.json / webp 尺寸异常 / JSON 损坏）有明确报错且不进入图鉴；导入路径由 WP0 fixture 测试覆盖
- **风险**：素材 IP（维持 NOTICE + 非商用 + 不作为默认分发主张；宝可梦 / 米哈游系不入默认图鉴）

### WP2（P0）token 口径对齐与对账（吸收原 WP8：官方 schema 核实）

- **动机**：多个项目已对齐官方口径，我们的数字若口径不同会"看起来不对"；zai-org/ZCode 已开源，`db.js` 718 行里的 schema 假设应升级为权威版本
- **第一步（原 WP8）**：对照 zai-org/ZCode 开源源码核实 `db.sqlite` schema。重点**澄清 `computed_total_tokens` 与官方总量公式（input + output + reasoning + cache_creation）的关系**——它是官方预计算的权威总量还是派生列，决定我们直接取用还是自行计算。核实后给 `db.js` 中每条表 / 列假设补官方源码出处注释
- **来源**：zai-org/ZCode（schema 权威）、zcode-token-usage-statusbar、arvelvale/orrery（记账语义）、better-ccusage（GLM 定价表）
- **改动面**：`server/db.js` 用量查询按核实后的口径修正（input 含 cache-read 的展示拆分、总量公式、`parent_id` 归组、`turn_usage` side call 缺口标注）；前端数字标注来源（官方口径 / 本地估算）。**不做对外 JSON 口径端点**（对外暴露非本轮目标）
- **验收**：同一时段 our 数字与 **ccusage 单方对账**通过；无法对齐的差异逐条留痕（口径文档注明出处与原因）。**勘误（2026-09-23，实施后回填）**：ccusage 对 ZCode 数据源的支持形态经实测不可用（主线/fork/statusbar 三路均不满足），对账改以纯 SQL 交叉核对收口并留痕（docs/usage-accounting.md §5.1）；本验收条的「与 ccusage 对账」按此口径解释
- **风险**：中（一次性改动约 8 个用量查询函数的语义——input 含 cache-read 拆分、总量公式、`parent_id` 去重、side call 标注——全部前端数字随之变动；对账基准依赖 ccusage 对 ZCode 数据源的支持形态，实施时实测，不可用时回退 zcode-token-usage-statusbar 的 JSON CLI 或纯 SQL 交叉核对。2026-09-22 规格评审由"低"上调）；官方仓库刚开源（2 commits），内容可能不完整——以核实结果为准，不确定处留痕

### WP3（P1，lite）JSONL 实时性强化（零写入）

- **动机**：transcript JSONL 先于 SQLite 落盘，是零成本提升实时性的唯一途径；hooks 方案需写 `~/.zcode/cli/config.json`，违背只读承诺，**已否决**
- **来源**：hoangsonww/Claude-Code-Agent-Monitor（字节偏移增量解析）、现有 `server/log-tail.js`
- **改动面**：`server/log-tail.js` 用 `fs.watch` 强化：文件追加即触发解析、字节偏移增量读取；watch 失败自动回退现有轮询，不丢事件
- **验收**：JSONL 追加后事件延迟较纯轮询明显下降（可观测）；watch 失败自动回退且无事件丢失；全程对 `~/.zcode/` 零写入
- **明确不做**：hooks 事件接收端点、hooks 安装 / 卸载脚本、配置 diff 展示——全部随零写入决策取消，相关风险项从 §8 移除
- **风险**：低；Windows `fs.watch` 的事件可靠性需先在 WP0 fixture 上验证

### WP4（P1）桌宠行为与安全升级

- **动机**：xN 徽章已有；error 态、入睡、连击是社区验证过的高价值行为
- **来源**：clawd-on-desk（12 态、入睡 + 惊醒、连击——**只学交互，不抄实现**）、OpenPets（speech 消毒：气泡不泄路径 / URL / 密钥）、tokibean（事件 → 情绪映射表）
- **改动面**：
  - **error 态 = 事件接线，不缺资产**：`ROW_ANIMS` 已有 `failed` / `waiting_permission` 行（`public/pet.html:186-187`），只需把 livegen 的工具失败 / 权限请求事件接到对应动画行
  - **入睡与 `IDLE_AFTER` 的优先级**：现有 `IDLE_AFTER`（`public/pet.html:173`，2 分钟无完成流量 → idle）是 idle 判定；入睡是 idle 的深化态——idle 持续满入睡阈值（实施时定，参考 clawd 的短入睡节奏）后才进入；任何 livegen 活动（工具开始 / 完成 / 权限请求）**立即惊醒并重置 idle 计时**；工作事件优先级恒高于入睡，入睡不吞工作态
  - **双击切换与连击手势的冲突解法**：双击（`public/pet.html:511`）已占用为切换宠物，连击（参考 clawd 的连点反应）与其争抢同一手势。解法——**双击优先、计数延后**：每次点击起一个判定窗口（约 300ms，实施时调）；窗口内第 2 击挂起切换动作；窗口关闭前无后续点击 → 执行切换；窗口内累计 ≥4 击 → 判定为连击手势，**取消挂起的切换**并触发连击反应。即两击即停永远是切换，四击永远是连击，二者互斥
  - **消毒层抽为可测共享模块**：若气泡展示 agent 文本，先过消毒模块（路径 / URL / 密钥样例不外泄）；模块独立于页面文件，供 `node --test` 直接测试
- **验收**：error / 入睡 / 惊醒 / 连击均可被 livegen 事件触发且互不误触（两击不触发连击、四击不切换宠物、入睡不吞工作态）；消毒层有单测（路径、密钥样例不外泄）
- **风险**：低；注意状态机复杂度上限，避免动画状态爆炸（`ROW_ANIMS` 9 行契约不动）

### WP5（P1）隐私提示（快照上传警示）

- **动机**：多个独立来源报告 ZCode 后台上传工作区快照；我们是"本地只读监控"定位，提示用户与产品调性一致且建立信任
- **来源**（v0 所引"zemote 停更声明"全网查无此项目，已弃用）：Hacker News 讨论串（"ZCode silent workspace snapshot upload"）、知乎《智谱ZCode，你打包上传我的代码仓库干什么》、开源中国报道（三者均在 2026-09-18 前后）、zcode-speed-panel 的"快照防护"
- **改动面**：仪表盘 / README 增加一条提示（措辞严谨：注明"第三方报告，未经我们验证"，给出 checkpoints 目录自查方法）
- **验收**：文案评审通过；不制造恐慌、不下断言
- **风险**：低；主要风险是措辞不当

> 原 WP6（t/s 实测）与 WP7（壁纸）移入附录 A backlog；原 WP8 并入 WP2 第一步。

## 6. 性能回归红线

- 真实库 `~/.zcode/cli/db/db.sqlite` 约 **14.6GB**（早期基线；库持续增长，现行实测锚点以 docs/specs/ecosystem-adoption-v1.md §4.1 为准——红线按其中更大的实测值执行）
- 历史事故：对 message 表的**全表扫描**曾导致事件循环饿死（约 **2.4s/次**），视为回归、**一票否决**
- 规则：任何新查询必须命中 `started_at` 索引或 rowid 尾界；本计划各项涉及 `db.js` 的改动（WP2）与一切后续查询均适用
- 验证：涉及新查询的 WP，验收时必须在真实库上以只读方式实测（`EXPLAIN QUERY PLAN` 确认命中索引 + 计时），结果记入验收记录

## 7. 里程碑

| 里程碑 | 内容 | 出口判据 |
|---|---|---|
| M1 基建 · 格式 · 口径 · 提示 | WP0 + WP1 + WP2 + WP5 | `node --test` 就绪；Codex 包一键导入可用；用量与 ccusage 对账通过（差异留痕）；隐私提示发布。（M1 已达成；「与 ccusage 对账」按 WP2 勘误的纯 SQL 交叉核对口径收口） |
| M2 行为与实时性 | WP4 + WP3-lite | 新桌宠状态上线（error / 入睡 / 连击）；JSONL 实时性提升且全程零写入 |
| backlog | 附录 A（原 M3：WP6 / WP7） | 由实验结论决定是否立项 |

## 8. 风险与合规总表

| 风险 | 对策 |
|---|---|
| AGPL 传染（clawd-on-desk） | 只参考交互设计与状态语义，不复制代码与素材 |
| 素材 IP（chiikawa 等） | NOTICE + 非商用声明 + 不作为默认分发主张；宝可梦 / 米哈游系不入默认图鉴；不建对外包索引（WP1 明确不做项） |
| 写用户 ZCode 数据 / 配置 | **全计划零写入**（WP3 hooks 方案已否决）；`~/.zcode/` 下一切只读 |
| 大库查询回归 | §6 性能红线：新查询必须命中 `started_at` 索引或 rowid 尾界，验收含真实库实测 |
| 口径争议 | 对齐前先记录差异；数字标注来源（官方口径 / 本地估算） |
| 灰色生态关联 | 不与账号切换 / 反代项目互链、不引用其代码 |
| 隐私表述 | "第三方报告，未经我们验证" + 自查方法，不断言 |

## 9. 既定决策（原开放问题）

评审已拍板，不再是开放问题：

1. **在线宠物目录默认不开启**：仅本地导入 / staging 管线，默认无外联拉取
2. **气泡默认不展示 agent 原始文本**；如未来要展示，必须先过消毒层（WP4 共享模块）并有单测
3. **WP6（t/s 实测）与 WP7（壁纸）移入 backlog**（附录 A），不在本轮里程碑内

## 10. 来源仓库清单

- 官方：https://github.com/zai-org/ZCode · https://github.com/zai-org/zcode-plugins
- ZCode 同类：https://github.com/xhwxt/zcode-token-usage-statusbar · https://github.com/Masterchiefm/zcode-speed-panel · https://github.com/xiufengsun/TokenTracker · https://github.com/arvelvale/orrery · https://github.com/ScaleXY/zcode-stats
- 用量标准：https://github.com/ccusage/ccusage · https://github.com/cobra91/better-ccusage
- Claude Code 参考：https://github.com/hoangsonww/Claude-Code-Agent-Monitor · https://github.com/jarrodwatts/claude-hud · https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor
- 桌宠：https://github.com/rullerzhou-afk/clawd-on-desk · https://github.com/OpenPetsHQ/openpets · https://github.com/backnotprop/codex-pets-react · https://github.com/ChanceYu/CoPet · https://github.com/Lelecolele/pet_chiikawa
- 壁纸 / 宿主（backlog 相关）：https://github.com/rocksdanister/lively · https://github.com/rocksdanister/system-stats-wallpaper · https://github.com/rainmeter/rainmeter · https://github.com/NSTechBytes/WebView2 · https://github.com/jingluoguo/lively-mascot
- 协议层：https://github.com/kingsword09/zcode-cli · https://github.com/william0wang/zcode-acp · https://github.com/csuftt/zcode-jetbrains-plugin
- 隐私报道（非仓库来源，WP5）：Hacker News 讨论串（"ZCode silent workspace snapshot upload"，2026-09-18 前后）· 知乎《智谱ZCode，你打包上传我的代码仓库干什么》· 开源中国报道

## 附录 A：backlog（原 WP6 / WP7）

### BP1（原 WP6）t/s 实测（调查型）

- **动机**：speed-panel 用进程 IO 字节实测 + token 自校准得到真实 t/s；我们目前只有 SQLite 事后数据
- **来源**：Masterchiefm/zcode-speed-panel（Windows `GetProcessIoCounters`）
- **改动面**：**先调查后立项**——Node 侧获取 IO counters 的可行路径（原生模块 / PowerShell 桥 / 放弃），输出一份可行性结论再决定
- **验收**：调查报告一份（含推荐方案或不做的理由）
- **风险**：原生依赖引入（Windows 专属复杂度；需过 WP0 的依赖门槛——优先内置模块）

### BP2（原 WP7）壁纸与宿主实验

- **动机**：零 / 低成本扩大呈现面
- **来源**：rocksdanister/lively（网页壁纸，URL 直接设壁纸）、system-stats-wallpaper（官方 API 模板）、Rainmeter + NSTechBytes/WebView2（薄皮肤壳）、jingluoguo/lively-mascot（MIT，SVG 宠物渲染库）
- **改动面**：先做**验证性实验**（把 widget URL 设为 Lively 壁纸跑通）；如体验好，做一个壁纸专用页面（暗色、低信息密度）
- **验收**：实验记录 + 截图；是否正式支持由实验结论决定
- **风险**：低（纯增量）
