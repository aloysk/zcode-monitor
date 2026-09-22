# 生态采纳需求规格 v1（ecosystem-adoption）

- 日期：2026-09-22
- 状态：v1（待评审）
- 上游：`docs/ecosystem-adoption-plan.md`（v1，已通过架构 / 对抗性 / 事实核查三视角评审）。本 Spec 把该计划转化为**可验收的需求**；任务级实施计划（How、步骤、代码骨架）在上游计划基础上另行编写。
- 实施位置：worktree `F:/project/zcode-monitor-plan`，分支 `feature/ecosystem-adoption-plan`；主仓库 `F:/project/zcode-monitor` 一律只读。
- 本文行号基于 worktree HEAD `5933a1f`（2026-09-22 核实）。
- 验收标准均以 Given/When/Then 书写，每条标注可转化形态：`[测试]`（node:test 用例）、`[命令]`（可直接执行的命令与期望输出）、`[评审]`（人工评审，须留痕记录）。

---

## 1. 背景与目标

调研确认 ZCode 第三方生态真实存在且增长极快（监控 / 桌宠 / 用量三条线均有现成成果，集中于 2026-06 ~ 09），而"会话级 agent 运行可视化 + 桌宠"的完整组合尚无人做，是 zcode-monitor 的差异化空位。同时，Codex 单格式（`pet.json + spritesheet.webp`）兼容的事实基础在我们仓库内已经就位：`public/pets/` 下 10 个包全部是该格式（本会话核实：chiikawa / firefly / guga / hutao / maid-deepseek-whale / miku / nezukocoder / pikachu-local / xilian / yuexinmiao），`/api/pets` 已按此扫描并容忍 BOM 与 snake_case（`server/index.js:262-284`），`public/pet.html` 的 `ROW_ANIMS` 9 行动画契约含 `failed` 与 `waiting_permission` 行（`public/pet.html:186-187`）。

本 Spec 覆盖六个工作包（WP0 ~ WP5）：补测试基建（WP0），把"手工放目录"升级为"校验 + 一键导入"（WP1），用量口径对齐官方并可与 ccusage 对账（WP2），JSONL 摄取实时性强化且全程零写入（WP3-lite），桌宠行为与安全升级——error 态接线、入睡、连击、消毒模块（WP4），以及隐私提示（WP5）。原 WP6（t/s 实测）与 WP7（壁纸）已移入 backlog，不在本轮范围。

全部工作在三条硬约束内进行：真实库约 14.6GB 的性能红线（对 message 表全表扫描曾致事件循环饿死约 2.4s/次，一票否决）；对 `~/.zcode/` 下一切的零写入承诺；运行时依赖保持 express + better-sqlite3 之外零新增（优先 Node 内置模块）。

---

## 2. 范围

依赖顺序：WP0 是其余全部 WP 验收的底座（fixture 与 `node --test` 入口）；WP1 / WP2 / WP5 构成里程碑 M1；WP4 与 WP3-lite 构成里程碑 M2（对应上游计划 §7）。各 WP 独立提交，回滚单位是 commit（见 §5）。

### WP0（P0）测试基建

**用户故事**

- 作为后续各 WP 的实施者，我要一个与真实数据完全隔离、与工作目录无关的测试入口，使每条验收标准可以重复执行，绝不触碰 `~/.zcode/` 下的真实库与日志。

**现状锚点**

- 仓库目前无任何测试目录（本会话核实 `tests/`、`test/` 均不存在），`package.json` 无 `test` script，`dependencies` 仅 `better-sqlite3` + `express`。
- 路径环境变量注入模式已有先例：`ZCODE_DB` / `ZCODE_LOG_DIR` / `ZCODE_ROLLOUT_DIR`（`server/db.js:16-23`）——fixture 注入沿用该模式，不发明新机制。
- Node v24.11.1（本会话实测），`node:test` 内置可用，零新依赖即可搭建。

**需求**

1. 测试入口为 Node 内置 test runner（`node --test`），新增 `npm test` script；`dependencies` 不新增任何条目。
2. 临时目录 fixture 库：伪造 `~/.zcode/cli` 形状的小型 SQLite 库与 JSONL，全部位于 `os.tmpdir()` 下的临时目录，用完即弃。fixture 的 SQLite schema 以 `server/db.js` 现行查询所假设的最小列集为准；fixture 的验收定义是**让 `db.js` 导出的每个查询函数（`server/db.js:707-718`）都能跑通且返回结构正确**。WP2 核实官方 schema 后，若现行假设有出入，fixture 随 WP2 同步修订。
3. 测试与 cwd 无关：被测模块的路径一律由模块参数或环境变量注入，不依赖进程工作目录。新增的测试内辅助模块（fixture 构建器等）同样不得读 cwd。

**验收标准**

- **A0-1** `[命令]` Given 全新 checkout，When 在仓库根运行 `npm test`，Then 退出码 0、0 failed。
- **A0-2** `[命令]` Given 任意非仓库根 cwd（如 `%TEMP%`），When `node --test "F:/project/zcode-monitor-plan/tests"`（绝对路径；注意 `npm test` 从子目录调用时 npm 会把 cwd 切回包根，故 cwd 无关性必须用直接调用 `node --test` 验证），Then 结果与 A0-1 一致（全绿），证明测试文件与 fixture 构建器不依赖进程工作目录。
- **A0-3** `[测试]` Given 测试套件已加载 `server/db.js` 且环境变量指向 fixture，When 读取 `DB_PATH`、`LOG_DIR`、`ROLLOUT_DIR` 导出值，Then 三者均以 `os.tmpdir()` 为前缀且不包含 `.zcode` 路径段。
- **A0-4** `[测试]` Given fixture SQLite 库（含 `model_usage` / `tool_usage` / `session` / `turn_usage` / `message` / `part` 表与少量构造行），When 以注入路径调用 `db.js` 导出的每个查询函数，Then 全部不抛错且返回值字段结构与现行调用方期望一致（抽查代表性字段，如 `overviewKpis().tokens.input` 为数值）。
- **A0-5** `[测试]` Given fixture JSONL 目录（`zcode-YYYY-MM-DD.jsonl` 命名，UTC 日，与 `server/log-tail.js:12-15` 一致），When 调用 `listLogFiles` / `tailLog` / `parseLine` / `eventsForTrace`，Then 返回值与构造行一致，坏行被静默跳过（现行 `parseLine` 语义，`server/log-tail.js:29-37`）。
- **A0-6** `[命令]` Given WP0 完成后的 `package.json`，When `node -e "console.log(Object.keys(require('./package.json').dependencies))"`，Then 输出恰为 `[ 'better-sqlite3', 'express' ]`（零新增）。
- **A0-7** `[测试]` Given 一次完整测试运行结束，When 检查 `os.tmpdir()`，Then 本运行的 fixture 目录已被清理（清理逻辑注册于测试钩子；守护断言：运行中记录的临时路径在 after 钩子内不存在）。

### WP1（P0）宠物包一键导入：Codex `pet.json + spritesheet.webp`

**用户故事**

- 作为玩家，我想把一个未经改动的社区 Codex 宠物包目录一键导入 zcode-monitor：导入时自动做 sheet 布局校验并生成 NOTICE，导入后立即可在图鉴预览、可被桌宠选用。
- 作为维护者，我想让格式错误的包在导入时被明确拒绝并给出原因，而不是进入图鉴后运行时才发现空白或报错。

**现状锚点**

- 发现规则：`/api/pets`（`server/index.js:262-284`）扫描 `public/pets/*`，要求 `pet.json` 与 `spritesheet.webp` 同时存在；容忍 UTF-8 BOM（`:274`）与 snake_case 字段（`:276`）；`order` 数组前置两个包保证轮换稳定（`:265`）。该行为是兼容面，WP1 不得破坏。
- 布局契约：`CELL_W=192, CELL_H=208, COLS=8, FRAME_MS=160`（`public/pet.html:184`）；9 行动画契约 `ROW_ANIMS`（`:186-187`）；例外机制 `PACK_OVERRIDES`（`:190-192`）；空行检测由页面像素扫描承担、空行回退到第 0 列（`scanRow`，`:283-300`；回退 `:299`）。
- 尺寸读取：`tools/webp-size.js` 的 `webpSize(buf)` 可解析 RIFF/VP8X、VP8、VP8L（`:6-29`），但其 CLI 判据 `w === 1536 && h % 208 === 0 && h / 208 >= 9`（`:33`）目前**未导出、仅供 CLI**（该文件无 `module.exports`）——WP1 需先使其可被 `require`，且 CLI 行为不变。
- 导入来源池：主仓库 `tools/pets-staging/`（gitignored，`.gitignore:30`）现有 14 个包目录、其中 8 个含 `pet.json`（2026-09-22 实测；上游计划写"约 23 个、18 个含 pet.json"，以实测为准——staging 是本地暂存区，内容随时间变化，Spec 不硬编码其数量）。
- 图鉴 / 预览页：`public/pets-preview.html` 已存在（提交 `dfdb45f` 引入的 curation preview），是导入入口的挂载点之一。

**需求**

1. 共享导入模块 `server/pet-import.js`：校验 + 落位 + NOTICE 生成，导出纯函数（输入：来源目录路径、目标根路径、元数据参数；输出：结构化结果对象）。CLI `tools/import-pet.js` 与图鉴页导入入口（经一个本地 HTTP 端点包装同一模块）复用之。目标根路径必须可注入（服务端校验测试才可能落在 tmpdir），默认值为现行 `public/pets`。
2. 服务端校验判据（与 `tools/webp-size.js:33` 字面一致）：webp 可解析（RIFF/WEBP 魔数）；宽 = 1536（= `CELL_W 192 × COLS 8`）；高能被 208 整除且行数 ≥ 9。`pet.json` 可解析（容忍 BOM 与 snake_case，对齐 `/api/pets` 的容忍面，`server/index.js:274-276`）；`spritesheetPath` 指向存在的文件。像素级空行检测**不在**服务端校验范围（仍由页面 `scanRow` 承担，`public/pet.html:283-300`）——校验层不得引入图像解码依赖（依赖门槛，§4.3）。页面侧 `PACK_OVERRIDES` 例外机制保留不动（`public/pet.html:190-192`，上游计划 WP1 明确要求），导入校验不改变其语义。
3. 错误路径：缺 `pet.json`、webp 无法解析、宽 / 高 / 行数不符、JSON 损坏（BOM 之外的语法错误）——每类给出指明原因的报错；落位必须原子（先校验后复制，或落临时名再改名），失败时目标根不残留半成品目录。
4. NOTICE 管线：导入时在包目录生成 `NOTICE.md`，含三要素——来源、许可证、非商用声明。未提供许可证信息时，导入不阻断，但 NOTICE 显式记录 `license: unknown` 且 CLI 输出警告。格式参照现行包（如 `public/pets/yuexinmiao/NOTICE.md`）。
5. 导入产物默认不进版本库：导入的包与精选 10 包共享同一格式与发现管线，但**不得被 git 跟踪**（防止 IP 敏感素材经一次 `git add -A` 进入默认分发——上游计划 §8"不作为默认分发主张 / 宝可梦、米哈游系不入默认图鉴"的可执行化）。机制不限（gitignored 落位子目录 + 双根扫描，或等效 .gitignore 规则），验收以 git 命令为准。
6. `/api/pets` 行为兼容：现有 10 包的发现结果与排序不变（`order` 前置不变）；若采用双根方案，`/api/pets` 合并扫描两根且精选根保持在前。发现扫描根须可注入（现行硬编码于 `server/index.js:264`），否则 A1-6 无法在 tmpdir 上验证。
7. 明确不做（承上游计划 WP1"明确不做"）：双格式注册表；包目录根 `pets.json` 对外索引（对外可被第三方抓取，构成再分发）。
8. 导入端点的滥用面：该端点本质是"把本机任意目录复制进 web 静态服务目录"，必须避免成为跨源网页可触发的任意文件复制原语（本服务绑定 `127.0.0.1`，`server/index.js:21`，但浏览器跨源简单 POST 仍可到达）。服务端须要求非简单请求特征（如自定义首部校验）或等效来源校验；具体威胁模型与对策在实施计划展开。

**验收标准**

- **A1-1** `[测试]` Given 一个 fixture Codex 包目录（1536×1872 的最小合法 webp + 合法 `pet.json`），When 调用导入模块（目标根注入 tmpdir），Then 结果为成功、目标根出现 `<id>/pet.json` + `spritesheet.webp` + `NOTICE.md`，且 `node tools/webp-size.js <落位 webp>` 输出含 `OK`。
- **A1-2** `[测试]`（参数化四案）Given 分别为缺 `pet.json` / webp 魔数损坏 / 宽 ≠ 1536 / 高不能被 208 整除或行数 < 9 的来源目录，When 导入，Then 每案失败且错误信息指明原因，目标根无新增目录（原子性）。
- **A1-3** `[测试]` Given `pet.json` 带 UTF-8 BOM 且字段为 snake_case（`display_name` / `spritesheet_path`），When 导入，Then 成功且显示名解析正确。
- **A1-4** `[测试]` Given 未提供许可证元数据，When 导入，Then 生成的 `NOTICE.md` 含 `license: unknown` 字样、来源占位与非商用声明三要素，且导入结果为"成功但带警告"。
- **A1-5** `[命令]` Given 一次真实导入到默认根，When `git -C "F:/project/zcode-monitor-plan" status --porcelain`，Then 导入产物不出现在待提交清单（`git check-ignore` 命中导入产物路径亦可作为等价证据）。
- **A1-6** `[测试]` Given 现仓库 `public/pets`（10 包），When 调用 `/api/pets` 的发现逻辑（注入该根），Then 返回 10 包、前两位为 `yuexinmiao` 与 `maid-deepseek-whale`（回归守护）。
- **A1-7** `[测试]` Given 模拟跨源简单 POST（无自定义首部），When 调用导入端点，Then 403 拒绝；带约定首部的同源请求正常放行。
- **A1-8** `[评审]` 端到端：一个未经改动的真实 Codex 包目录 → 导入 → 图鉴可见、可预览、桌宠可选用（双击轮换能到达该包）；评审记录含截图。
- **A1-9** `[命令]` Given `tools/webp-size.js` 改造后，When 直接运行 `node tools/webp-size.js public/pets/yuexinmiao/spritesheet.webp`，Then 输出与改造前一致（`...1536x1872 rows=9 OK` 形态；2026-09-22 改造前实测该输出，另实测 maid-deepseek-whale 为 `1536x2288 rows=11 OK`——印证行数判据为 ≥9 而非 =9，sheet 可有多于 9 行的多余行），证明 CLI 行为未回归。

### WP2（P0）token 口径对齐与对账

**用户故事**

- 作为用量关注者，我看到的 token 总量与输入 / 缓存拆分和官方口径一致，且能与 ccusage 对同一时段的数字对上账；对不齐的每一处差异都有出处留痕，而不是"看起来不对"却无从核对。

**现状锚点**

- 现行用量查询全部在 `server/db.js`：`overviewKpis`（`:159-218`，分列 input / output / reasoning / cache_read / cache_write）、`timeseries`（`:221-245`）、`breakdownByModel`（`:248-261`）、`overviewSpeed`（`:293-316`）、`recentSpeed`（`:321-352`）、`completedSince`（`:359-387`）、`todayUsage`（`:393-402`）；`sessionList`（`:417-436`）与 `agentsForest`（`:678-705`）使用 `computed_total_tokens`（`:430`、`:684`）。
- 待核实的核心问题（上游计划 §2.2 / WP2）：`computed_total_tokens` 与官方总量公式（input + output + reasoning + cache_creation，cache_read 单列）的关系；schema 的权威出处（zai-org/ZCode 已开源，Apache-2.0）；`turn_usage` 漏标题生成等 side call；子代理按 `parent_id` 归组。
- 性能先例：`completedSince` 注释记录了裸表达式扫描 ~430ms 的教训与"先用 indexed `started_at` 预过滤 + 2h pad"的手法（`server/db.js:361-367`）——本 WP 触碰查询时必须维持该纪律。
- 已知现存风险查询（非本 WP 引入，触碰时适用红线）：`slowTools` 无 `sinceMs` 时无时间下界（`server/db.js:637-646`）；`agentsForest` 无界扫 `session` 表（`:681-687`）。

**需求**

1. **第一步（核实）**：对照 zai-org/ZCode 开源源码核实 `db.sqlite` schema，重点澄清 `computed_total_tokens` 与官方总量公式的关系（官方预计算权威值 or 派生列），据以决定直接取用还是自行计算。核实后为 `server/db.js` 中每条表 / 列假设补官方源码出处注释。
2. 口径修正落点：`server/db.js` 用量查询按核实结论修正——input 含 cache-read 的展示拆分、总量公式、`parent_id` 归组去重、`turn_usage` side call 缺口标注。前端数字标注来源（官方口径 / 本地估算）。
3. 每条口径决定必须留痕：结论 + 官方源码出处（文件 / 函数级）+ 对 `db.js` 的影响，写入口径文档（位置由实施计划定，随 WP2 提交）。
4. **不做**对外 JSON 口径端点（对外暴露非本轮目标）。
5. 性能红线适用：本 WP 触碰或新增的每条查询，验收必须在真实库上只读实测（§4.1）。

**验收标准**

- **A2-1** `[测试]` Given fixture 库构造了覆盖口径边界的行（含 cache_read 与 cache_creation 并存、reasoning 为 NULL、`parent_id` 子代理组、`turn_usage` 缺 side call 的场景），When 调用修正后的用量查询，Then 返回值符合口径文档记载的结论（fixture 断言把口径文档固化为可执行检查；口径文档修订时本测试同步修订）。
- **A2-2** `[命令]` Given 真实库只读访问，When 对同一 UTC 时段（建议取最近一个完整 UTC 日）分别以我方口径与 ccusage（对 ZCode 数据源）计算 token 总量，Then 产出对账记录：双方命令与原始输出、逐项差异、每条差异的原因分类与出处；**通过判据 = 无未解释差异**（差异可以存在，但必须逐条留痕——承上游计划"无法对齐的差异逐条留痕"）。ccusage 侧调用命令以其当时文档为准，实施时如实记录，不预设 flag。
- **A2-3** `[命令]` Given WP2 修改过的每条 SQL，When 在真实库上执行 `EXPLAIN QUERY PLAN` 与计时（只读、带 `started_at` 下界；命令模板见 §4.1），Then 计划输出不含对 `model_usage` / `tool_usage` / `message` 的 `SCAN`（须为 `SEARCH ... USING INDEX`），计时结果记入验收记录。
- **A2-4** `[评审]` 前端用量数字旁标注口径来源（官方口径 / 本地估算）；文案与位置评审通过，记录截图。
- **A2-5** `[评审]` `server/db.js` 每条被触碰查询的表 / 列假设处有官方源码出处注释；抽查 5 处核对注释与口径文档一致。

### WP3-lite（P1）JSONL 实时性强化（零写入）

**用户故事**

- 作为实时观察者，我要日志 / transcript 事件在文件追加后亚秒级可见，而不是等下一轮固定间隔轮询；同时监控器对 `~/.zcode/` 保持零写入、零配置改动。

**现状锚点**

- `server/log-tail.js` 现为纯轮询读：`tailLog` 尾部至多 1MB 块读（`:40-60`），`eventsForTrace` 对今天 + 昨天全文件 readline 扫描（`:64-84`）；日志按 UTC 日命名 `zcode-YYYY-MM-DD.jsonl`（`:12-15`）；`LOG_DIR` 可经 `ZCODE_LOG_DIR` 注入（`server/db.js:19-20`）。
- hooks 方案（写 `~/.zcode/cli/config.json`）已因违反只读承诺被否决，随案取消的还有 hooks 事件接收端点、安装 / 卸载脚本、配置 diff 展示（上游计划 WP3"明确不做"）。
- Windows `fs.watch` 的事件可靠性是已知风险（上游计划 WP3 风险项），必须先在 WP0 fixture 上验证。

**需求**

1. `server/log-tail.js` 增加 watch 增量路径：`fs.watch` 监听日志目录 / 当日文件，追加即触发解析；以字节偏移增量读取（对齐 hoangsonww/Claude-Code-Agent-Monitor 的混合摄取思路），同一偏移的行不得产出两次。
2. 失败与漏事件双重兜底：watch 报错（如 ENOENT / EMFILE）自动回退现有轮询，不丢事件；watch 静默漏事件时，周期性偏移对账补齐，保证最终一致。对账周期 5s（取仓库既有 5s 轮询惯例：`server/index.js:98`、`public/pet.html:494`）。
3. 全程零写入：模块及其测试对 `~/.zcode/` 无任何写操作；测试 fixture 全在 tmpdir。
4. 明确不做：hooks 事件接收端点、hooks 安装 / 卸载脚本、配置 diff 展示。

**验收标准**

- **A3-1** `[测试]` Given fixture 日志目录（`ZCODE_LOG_DIR` 注入）且 watch 增量路径激活，When 向当日 JSONL 追加 10 行（每行间隔 ≥100ms），Then 每行对应的事件在追加后 1s 内被解析回调收到（10/10），且事件总数恰为 10（偏移守恒，无重复）。
- **A3-2** `[测试]` Given watch 处于回退态（fixture 中以删除被监视目录等方式触发错误），When 继续追加行，Then 事件仍被产出（轮询兜底），停止追加后 ≤10s（两个对账周期）内全部行可见，且全程无重复行。
- **A3-3** `[命令]` Given `server/log-tail.js` 及其测试目录，When `grep -rnE "writeFile|appendFile|createWriteStream|openSync\([^)]*'(w|a|r\+)" server/log-tail.js tests/`，Then 无匹配（grep 退出码 1 属预期——ERE 不支持前向查找，故枚举写模式而非排除 `r`；动态面由 A0-3 的 tmpdir 注入守护兜底）。
- **A3-4** `[测试]`（Windows 预验证，上游计划风险项）Given WP0 fixture 在 Windows 上以接近 ZCode 的节奏连续追加 100 行，Then watch 命中率与漏事件数被记录，且最终一致判据（停止追加后 ≤10s 全部可见）成立——无论 watch 漏不漏，混合兜底必须满足最终一致。
- **A3-5** `[评审]` 真实环境观测：对比强化前后"JSONL 追加 → 活动流可见"的延迟（各记 ≥5 个样本），确认较纯轮询明显下降，样本记录入验收记录。

### WP4（P1）桌宠行为与安全升级

**用户故事**

- 作为桌宠玩家，agent 出错时宠物明确演失败动画、权限请求时演等待动画、长时间无事时入睡、连点它时有连击反应；且这些行为互不误触——两击永远是切换宠物，四击永远是连击，入睡永不吞掉工作事件。
- 作为注重隐私的用户，即使未来气泡展示 agent 文本，路径 / URL / 密钥也不会出现在气泡里。

**现状锚点**

- 动画契约：`ROW_ANIMS` 固定 9 行含 `failed` / `waiting_permission`（`public/pet.html:186-187`）——error 态**不缺资产，缺接线**。9 行契约不变，不新增动画行。
- 现行状态机：`computeState()` 三态 gen / cruise / idle（`:386-389`），`IDLE_AFTER = 2min`（`:173`），`GEN_STALE = 10min`（`:174`）；gen 期间按 t/s 档位挑行 running / jumping / running_right（`desiredAnim`，`:394-401`）；换行动画只在整循环边界生效（`step`，`:236-248`）。
- 手势现状：双击 = 切换宠物（`dblclick` → `cyclePack`，`public/pet.html:511`；`cyclePack` 在 `:345-348`），单击 = 拖动（`:504-506`），滚轮 = 形态切换（`:515-518`）。
- 事件源：SSE `/api/gen/events`，现发 `phase: start / lanes / end`（`server/index.js:232`；`openSSE` 在 `public/pet.html:468-491`）——error / permission 是新增事件载荷。
- 素材与设计来源：clawd-on-desk（12 态、入睡 + 惊醒、连击）**只学交互设计，不抄代码与素材**（AGPL，上游计划 §8）；OpenPets 的 speech 消毒思路；tokibean 的事件 → 情绪映射。

**需求**

1. **error 态接线**：livegen 的工具失败事件 → `failed` 行；权限请求事件 → `waiting_permission` 行；事件结束后回常规状态判定。页面与服务器之间新增的事件载荷（phase 或事件类型）在实施计划定义；"事件 → 目标状态"的决策逻辑抽为纯函数共享模块，供 `node --test` 直接测试（依赖门槛下不引入浏览器自动化，页面接线本身走评审）。
2. **入睡（idle 的深化态）**：idle 持续满入睡阈值后进入 sleep 状态；阈值可注入（参考 clawd 的短入睡节奏，实施时定值）；任何 livegen 活动（工具开始 / 完成 / 权限请求）**立即惊醒**并重置 idle 计时；工作事件优先级恒高于入睡。入睡无专属动画行（9 行契约不动），视觉表现为 idle 行 + 可叠加暗示（如 body class / 气泡 zzz），细节实施定，行为契约以状态机断言为准。
3. **双击与连击的互斥**：采用上游计划拍板的"双击优先、计数延后"——每次点击起约 300ms 判定窗口（可调）；窗口内第 2 击挂起切换动作；窗口关闭前无后续点击 → 执行切换；窗口内累计 ≥4 击 → 判定连击，取消挂起的切换并触发连击反应。不变量：2 击 → 切换；≥4 击 → 连击（不切换）；3 击 → 窗口关闭时执行切换；1 击 → 无手势。判定逻辑为纯函数，单测覆盖上述全部不变量。
4. **消毒层共享模块**：独立于页面文件，输入 agent 文本、输出消毒后文本，供 `node --test` 直接测试。必须拦截：Windows 本地路径（`C:\...` 形态）、`file://` 与 `http(s)://` URL、密钥样式的 token（`sk-` 前缀、`Bearer` 头等）。普通文本原样保留。**按既定决策 §6.2，气泡默认不展示 agent 原始文本——本 WP 交付的是模块 + 单测，不改变默认展示行为。**

**验收标准**

- **A4-1** `[测试]` Given 状态机纯函数，When 输入工具失败事件，Then 目标动画为 `failed`；输入权限请求事件，Then 为 `waiting_permission`；随后输入 gen end 事件，Then 回到 cruise / idle 判定路径。
- **A4-2** `[测试]` Given 处于 sleep 状态，When 任一 livegen 活动事件到达（参数化：工具开始 / 完成 / 权限请求），Then 状态立即离开 sleep 且 idle 计时被重置（输出含惊醒副作用标记）；Given 工作事件与入睡条件同时满足，Then 工作态胜出。
- **A4-3** `[测试]` Given idle 持续时长跨过注入的入睡阈值，When tick，Then 进入 sleep；Given 未达阈值，Then 不进入。
- **A4-4** `[测试]`（参数化手势不变量）Given 判定窗口内点击序列，When 窗口关闭，Then：`[c,c]` → 执行切换且无连击；`[c,c,c,c]` → 连击且不切换；`[c,c,c]` → 窗口关闭时执行切换；`[c]` → 无动作。
- **A4-5** `[测试]` Given 消毒模块，When 输入含 `C:\Users\x\secret.txt`、`https://example.com/p?token=abc`、`sk-abcdefgh`、`Bearer xyz` 的文本，Then 输出不含上述任一敏感子串（逐项断言 `indexOf === -1`）；Given 普通中文短句，Then 输出与输入一致。
- **A4-6** `[测试]`（契约守护）Given 共享状态模块导出的 `ROW_ANIMS`，Then 恒等于 `['idle','running_right','running_left','waving','jumping','failed','waiting_permission','running','review']`（9 行、顺序不变）。
- **A4-7** `[评审]` 实机验收：error / 入睡 / 惊醒 / 连击 / 双击切换在浏览器与 WebView2 壳各演示一轮，互不误触，记录截图；评估状态机实现未使动画状态超出 9 行契约。

### WP5（P1）隐私提示（快照上传警示）

**用户故事**

- 作为用户，我想在仪表盘与 README 看到一条关于"ZCode 后台上传工作区快照"的第三方报告提示，并附自查方法，以便知情决策。

**现状锚点**

- 依据（上游计划 WP5）：Hacker News 讨论串（"ZCode silent workspace snapshot upload"）、知乎《智谱ZCode，你打包上传我的代码仓库干什么》、开源中国报道（均 2026-09-18 前后）与 zcode-speed-panel 的"快照防护"——**均为第三方报告，未经我们验证**；v0 曾引的"zemote 停更声明"已查无此项目、弃用。涉及目录：`~/.zcode/v2/checkpoints/`。
- 提示载体：仪表盘（`public/index.html`）与 README。

**需求**

文案三要素，缺一不可：(1) 明示"第三方报告，未经我们验证"；(2) 给出 checkpoints 目录自查方法（Windows 可执行）；(3) 不下断言、不制造恐慌。禁用句式（负面清单）：断言 ZCode 确实在上传的表述（如"ZCode 上传了你的代码"）。

**验收标准**

- **A5-1** `[评审]` 仪表盘与 README 两处提示均含三要素；对照负面清单逐句核查，评审通过并留痕。
- **A5-2** `[命令]` Given 文案中的自查方法，When 验收者在 Windows 实际执行（如 `ls ~/.zcode/v2/checkpoints` 或 PowerShell `Get-ChildItem "$env:USERPROFILE\.zcode\v2\checkpoints"`——只读列目录），Then 命令可执行且输出形态与文案描述一致；目录内容不抄入仓库文档。
- **A5-3** `[命令]` Given 仪表盘 HTML，When `grep -n "未经我们验证" public/index.html README.md`（或等效关键词），Then 两文件均命中。

---

## 3. 非目标

以下各项本轮**不做**，验收时出现即视为越界：

1. 账号切换、额度反代、API 转发（灰色地带；不互链、不引用其代码）。
2. Live2D / Spine / DragonBones 等专有许可或停更的动画技术。
3. 写 `~/.zcode/` 下任何数据、日志与配置——WP3 hooks 方案（含事件接收端点、安装 / 卸载脚本、配置 diff 展示）已随零写入决策整体否决。
4. 对外宠物包索引 / 在线目录（`pets.json` 对外索引构成再分发；在线目录默认关闭，见 §6.1）。
5. 双格式注册表：不引入自有格式与 Codex 格式并存的机制，单格式（Codex）是长期形态。
6. 对外 JSON 口径端点（用量口径仅内部展示与对账）。
7. `ROW_ANIMS` 9 行契约的变更或新增动画行（入睡复用 idle 行，不新增 sleep 行）。
8. `shell/`（WinForms + WebView2 壳）改动：WP4 手势与状态均在页面 JS 内实现，壳只收既有 `postMessage` 契约（drag / menu / form-cycle，`public/pet.html:503-518`）。
9. WP6（t/s 实测）与 WP7（壁纸与宿主）——已移入 backlog（§6.3）。
10. 对灰色生态项目的任何关联（星数最大的账号切换 / 反代类项目不引用）。

---

## 4. 约束

### 4.1 性能红线（一票否决项）

- 真实库 `~/.zcode/cli/db/db.sqlite` 约 **14.6GB**。历史事故：对 message 表的全表扫描曾致事件循环饿死约 **2.4s/次**，视为回归、一票否决。
- 任何新查询必须命中 `started_at` 索引或 rowid 尾界；本 Spec 各 WP 对 `db.js` 的改动（WP2）与一切后续查询均适用。
- 真实库实测模板（只读、须带 `started_at` 下界）：

  ```bash
  # 在仓库根执行；默认即真实库（db.js:16-17），只读。仅用于 WP2 触碰过的、带 started_at 下界的查询
  node -e "
  const dbq = require('./server/db');
  const since = Date.now() - 86400000; // UTC 数值下界，内联字面量避免绑定差异
  const sql = 'SELECT COUNT(*) AS n FROM model_usage WHERE started_at >= ' + since;
  console.log(dbq.db().prepare('EXPLAIN QUERY PLAN ' + sql).all());
  console.time('q'); dbq.db().prepare(sql).get(); console.timeEnd('q');
  "
  ```

  通过判据：`EXPLAIN QUERY PLAN` 输出为 `SEARCH ... USING INDEX`（无 `SCAN <table>`），计时记入验收记录。既有先例：`completedSince` 的 2h pad 手法（`server/db.js:359-387`，注释记载裸表达式扫描 ~430ms 教训）。

### 4.2 只读承诺

- `~/.zcode/` 下一切只读：数据、日志、配置，一个字节都不写。测试一律用 `os.tmpdir()` fixture，绝不触碰真实库（A0-3 / A0-7 守护）。
- 范围澄清：WP1 导入落位写的是**本仓库自身目录**（`public/pets` 或其等效落位根），不在只读承诺范围内；但导入产物默认不得被 git 跟踪（A1-5）。`/api/checkpoint` 的 WAL checkpoint 是既有能力，不因本 Spec 改变其边界。

### 4.3 依赖门槛

- 运行时依赖保持 `better-sqlite3` + `express` 之外零新增（A0-6 守护）；新能力优先 Node 内置模块（`fs` / `path` / `node:test` / `Atomics` 等）。任何新依赖（含 BP1 可能的原生模块）须先论证内置模块无法覆盖。
- WP1 服务端校验不得引入图像解码依赖（像素级检测留在页面 `scanRow`）。

### 4.4 IP 与 NOTICE

- AGPL（clawd-on-desk）：只参考交互设计与状态语义，不复制代码与素材。
- 素材 IP：NOTICE + 非商用声明 + 不作为默认分发主张；宝可梦 / 米哈游系不入默认图鉴（git 跟踪的精选根）；导入产物不进 git（A1-5）。
- 不建对外包索引；不与账号切换 / 反代项目互链。

### 4.5 气泡默认不展示原始文本

- 桌宠气泡默认不展示 agent 原始文本（现行气泡仅承载 t/s 数字与 ×N 徽章，`public/pet.html:420-429`）。如未来要展示，必须先过 WP4 消毒共享模块且有单测（A4-5），缺一不可。

### 4.6 平台与可测性

- Windows + Git Bash，Node v24.11.1（2026-09-22 实测）；`node --test` 为验收底座，不引入浏览器自动化框架（页面级行为走纯函数抽取 + 实机评审，见 WP4 需求 1）。
- 被测路径一律注入（env 或参数），不依赖 cwd；`server/db.js:16-23` 的 env 注入模式为既有先例。
- 验收证据（EXPLAIN 输出、计时、对账输出、评审截图）随各 WP 提交留痕（提交说明或 docs/specs/ 下验收记录文件，实施计划定载体）。

---

## 5. 风险与回滚

| # | 风险 | 影响面 | 对策与回滚 |
|---|---|---|---|
| R1 | WP2 触碰查询在真实库上变慢（14.6GB） | 事件循环饿死，全站卡顿 | §4.1 红线：EXPLAIN + 计时前置到验收；一票否决即 revert 该 commit。先例手法（2h pad，`db.js:361-367`）必须保持 |
| R2 | zai-org/ZCode 刚开源（上游记载仅 2 commits），schema 核实材料不全 | 口径结论不确定 | 以核实结果为准，不确定处显式留痕（A2-2 通过判据是"无未解释差异"而非"零差异"）；不伪造结论 |
| R3 | Windows `fs.watch` 漏事件 / 报错 | WP3 实时性退化或事件丢失 | 双重兜底：错误回退轮询 + 周期偏移对账保证最终一致（A3-2 / A3-4）；回退态即现行行为，功能回滚 = 关闭 watch 路径 |
| R4 | WP4 状态机复杂度膨胀、动画状态爆炸 | 回归面扩大、维护成本 | 9 行契约不动（A4-6 守护）；决策逻辑全部抽纯函数单测；实机评审项（A4-7）把关 |
| R5 | 导入引入 IP 敏感素材进入版本库 / 分发 | 法律与社区风险 | 导入产物默认不进 git（A1-5）；NOTICE 三要素强制（A1-4）；`license: unknown` 显式留痕 |
| R6 | 导入端点被跨源网页滥用为文件复制原语 | 本地文件经静态服务外泄 | 非简单请求特征校验（A1-7）；服务仅绑 127.0.0.1（`index.js:21`） |
| R7 | WP5 措辞不当（断言化 / 制造恐慌） | 用户误导、产品调性受损 | 三要素 + 负面清单评审（A5-1）；"第三方报告，未经我们验证"为固定措辞 |
| R8 | 测试 fixture 与真实库意外耦合（路径注入遗漏） | 触碰真实库，违反只读承诺 | A0-3 tmpdir 前缀守护 + A3-3 静态审查；新模块一律参数注入 |

**回滚原则**：各 WP 独立成 commit（一组或多组），回滚单位是 commit；本 Spec 全程不产生持久化数据迁移（server 无落盘状态），回滚 = revert + 重启进程。M1 与 M2 之间可独立回滚；WP3 回退轮询路径即回到现状行为。

---

## 6. 既定决策（上游评审已拍板，不再是开放问题）

1. **在线宠物目录默认不开启**：仅本地导入 / staging 管线，默认无任何外联拉取。若未来开启，须另行立项并重审 §4.4 的 IP 与再分发约束。
2. **气泡默认不展示 agent 原始文本**；如未来要展示，必须先过 WP4 消毒共享模块并有单测（§4.5）。
3. **WP6（t/s 实测）与 WP7（壁纸与宿主）移入 backlog**（上游计划附录 A）：BP1 先调查后立项（可行性结论先行，原生依赖须过 §4.3 门槛）；BP2 先做验证性实验（widget URL 设为 Lively 壁纸跑通），是否正式支持由实验结论决定。两者不在本轮 M1 / M2 里程碑内。

---

## 7. 验收与交付顺序（摘要）

| 里程碑 | 内容 | 出口判据（对应验收条款） |
|---|---|---|
| M1 | WP0 + WP1 + WP2 + WP5 | A0-1~7；A1-1~9；A2-1~5（含真实库红线实测 A2-3）；A5-1~3 |
| M2 | WP4 + WP3-lite | A4-1~7；A3-1~5（含零写入审查 A3-3） |
| backlog | BP1 / BP2 | 上游计划附录 A，不在本 Spec 验收范围 |
