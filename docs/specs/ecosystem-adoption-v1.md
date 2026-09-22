# 生态采纳需求规格 v1（ecosystem-adoption）

- 日期：2026-09-22
- 状态：v1.2（2026-09-22 第二轮规格评审修订——9 条发现全部采纳落实，验证证据见提交说明；v1.1 为首轮修订）
- 上游：`docs/ecosystem-adoption-plan.md`（v1，已通过架构 / 对抗性 / 事实核查三视角评审）。本 Spec 把该计划转化为**可验收的需求**；任务级实施计划（How、步骤、代码骨架）在上游计划基础上另行编写。
- 实施位置：worktree `F:/project/zcode-monitor-plan`，分支 `feature/ecosystem-adoption-plan`；主仓库 `F:/project/zcode-monitor` 一律只读。
- 本文行号基于 worktree HEAD `5933a1f`（2026-09-22 核实）。
- 验收标准均以 Given/When/Then 书写，每条标注可转化形态：`[测试]`（node:test 用例）、`[命令]`（可直接执行的命令与期望输出）、`[评审]`（人工评审，须留痕记录）。

---

## 1. 背景与目标

调研确认 ZCode 第三方生态真实存在且增长极快（监控 / 桌宠 / 用量三条线均有现成成果，集中于 2026-06 ~ 09），而"会话级 agent 运行可视化 + 桌宠"的完整组合尚无人做，是 zcode-monitor 的差异化空位。同时，Codex 单格式（`pet.json + spritesheet.webp`）兼容的事实基础在我们仓库内已经就位：`public/pets/` 下 10 个包全部是该格式（本会话核实：chiikawa / firefly / guga / hutao / maid-deepseek-whale / miku / nezukocoder / pikachu-local / xilian / yuexinmiao），`/api/pets` 已按此扫描并容忍 BOM 与 snake_case（`server/index.js:262-284`），`public/pet.html` 的 `ROW_ANIMS` 9 行动画契约含 `failed` 与 `waiting_permission` 行（`public/pet.html:186-187`）。

本 Spec 覆盖六个工作包（WP0 ~ WP5）：补测试基建（WP0），把"手工放目录"升级为"校验 + 一键导入"（WP1），用量口径对齐官方并可与 ccusage 对账（WP2），JSONL 摄取实时性强化且全程零写入（WP3-lite），桌宠行为与安全升级——error 态接线、入睡、连击、消毒模块（WP4），以及隐私提示（WP5）。原 WP6（t/s 实测）与 WP7（壁纸）已移入 backlog，不在本轮范围。

全部工作在三条硬约束内进行：真实库约 15.4 GiB 且持续增长的性能红线（2026-09-22 实测 16,521,129,984 字节；对 message 表全表扫描曾致事件循环饿死约 2.4s/次，一票否决）；对 `~/.zcode/` 下一切**无业务写入**（数据、日志与配置零业务写入；机制性触碰的白名单边界见 §4.2）；运行时依赖保持 express + better-sqlite3 之外零新增（优先 Node 内置模块）。

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
- 实施环境前置（2026-09-22 实测）：worktree `F:/project/zcode-monitor-plan` 尚无 `node_modules`（`better-sqlite3` 无法 require）——WP0 开工前先在 worktree `npm install`（或显式注明依赖供给方式），否则 A0-1 与 §4.1 的真实库模板会以 MODULE_NOT_FOUND 失败。

**需求**

1. 测试入口为 Node 内置 test runner（`node --test`），新增 `npm test` script；`dependencies` 不新增任何条目。
2. 临时目录 fixture 库：伪造 `~/.zcode/cli` 形状的小型 SQLite 库与 JSONL，全部位于 `os.tmpdir()` 下的临时目录，用完即弃。fixture 的 SQLite schema 以 `server/db.js` 现行查询所假设的最小列集为准；fixture 的验收定义是**让 `db.js` 导出的每个查询函数（清单固定见 A0-4，共 23 个）都能跑通且返回结构正确**。WP2 核实官方 schema 后，若现行假设有出入，fixture 随 WP2 同步修订。fixture 构建器按表分组交付（每表一个构建函数），WP2 修订时只动对应表。
3. 测试与 cwd 无关：被测模块的路径一律由模块参数或环境变量注入，不依赖进程工作目录。新增的测试内辅助模块（fixture 构建器等）同样不得读 cwd。

**验收标准**

- **A0-1** `[命令]` Given 全新 checkout 且依赖已安装（`npm install` 已完成——`better-sqlite3` 为原生模块，其构建 / 预编译产物须就位；纯 checkout 未装依赖时本条无从按字面执行），When 在仓库根运行 `npm test`，Then 退出码 0、0 failed。
- **A0-2** `[命令]` Given 任意非仓库根 cwd（如 `%TEMP%`），When `node --test "F:/project/zcode-monitor-plan/tests"`（绝对路径；注意 `npm test` 从子目录调用时 npm 会把 cwd 切回包根，故 cwd 无关性必须用直接调用 `node --test` 验证），Then 结果与 A0-1 一致（全绿），证明测试文件与 fixture 构建器不依赖进程工作目录。
- **A0-3** `[测试]` Given 测试套件已加载 `server/db.js` 且环境变量指向 fixture，When 读取 `DB_PATH`、`LOG_DIR`、`ROLLOUT_DIR` 导出值，Then 三者均以 `os.tmpdir()` 为前缀且不包含 `.zcode` 路径段。
- **A0-4** `[测试]` Given fixture SQLite 库（含 `model_usage` / `tool_usage` / `session` / `turn_usage` / `message` / `part` 表与少量构造行），When 以注入路径调用 `db.js` 导出的每个查询函数——**查询函数清单固定为 23 个**（按 `server/db.js:707-718` 导出面排除 `DB_PATH` / `LOG_DIR` / `ROLLOUT_DIR` / `db` / `warmDb` / `invalidateDb` / `ts` / `j` / `startOfDayMs` 后点得：overviewKpis、timeseries、breakdownByModel、breakdownByTool、overviewSpeed、recentSpeed、completedSince、todayUsage、sessionList、sessionGet、sessionTurns、sessionConversation、sessionActivity、sessionChildren、sessionReasoning、errorsList、errorSummary、slowTools、recentModelRows、recentToolRows、latestModelStartedAt、latestToolStartedAt、agentsForest；WP2 触碰导出面时清单同步修订），Then 全部不抛错且返回值字段结构与现行调用方期望一致。抽查断言集固定为：`overviewKpis().tokens.input` 为数值、`timeseries()` 为数组且元素含 `bucket` / `calls`、`sessionList()[].total_tokens` 为数值或 null、`agentsForest()` 含 `roots` 数组。
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
2. 服务端校验判据（与 `tools/webp-size.js:33` 字面一致）：webp 可解析（RIFF/WEBP 魔数）；宽 = 1536（= `CELL_W 192 × COLS 8`）；高能被 208 整除且行数 ≥ 9。`pet.json` 可解析（容忍 BOM 与 snake_case，对齐 `/api/pets` 的容忍面，`server/index.js:274-276`）；`spritesheetPath` 指向存在的文件。像素级空行检测**不在**服务端校验范围（仍由页面 `scanRow` 承担，`public/pet.html:283-300`）——校验层不得引入图像解码依赖（依赖门槛，§4.3）。页面侧 `PACK_OVERRIDES` 例外机制保留不动（`public/pet.html:190-192`，上游计划 WP1 明确要求），导入校验不改变其语义。**对上游计划 WP1"帧表规范化 / 行列越界 / 非 9 行布局报错"的削减记录**（显式声明，避免静默缩水）：(i) 现行 Codex 包的 `pet.json` 不含帧表，sheet 像素是帧布局的唯一事实来源（`public/pet.html:279-281`），服务端无图像解码（§4.3）无从推导帧表；(ii) 列方向由"宽 = 1536 = 192×8"判据与页面 `scanRow` 固定 `COLS=8` 采样天然约束（`public/pet.html:284-299`），越界列不会被采样；(iii) "非 9 行布局报错"与实测事实冲突——行数判据按实测放宽为 ≥9（A1-9：maid-deepseek-whale 为 1536x2288 rows=11 的合法包），以本 Spec 为准。
3. 错误路径：缺 `pet.json`、webp 无法解析、宽 / 高 / 行数不符、JSON 损坏（BOM 之外的语法错误）——每类给出指明原因的报错；落位必须原子（先校验后复制，或落临时名再改名），失败时目标根不残留半成品目录。
4. NOTICE 管线：导入时在包目录生成 `NOTICE.md`，含三要素——来源、许可证、非商用声明，三要素各以固定字面量承载（断言对象固定，见 A1-4）：来源缺失记 `source: <未提供>`，许可证缺失记 `license: unknown` 且 CLI 输出警告（导入不阻断），非商用声明含 `非商用` 字样。整体格式参照现行包（如 `public/pets/yuexinmiao/NOTICE.md`），固定字面量为纯增量的标记行，不与其自由格式冲突。
5. 导入产物默认不进版本库：导入的包与精选 10 包共享同一格式与发现管线，但**不得被 git 跟踪**（防止 IP 敏感素材经一次 `git add -A` 进入默认分发——上游计划 §8"不作为默认分发主张 / 宝可梦、米哈游系不入默认图鉴"的可执行化）。**机制定为单根方案（默认）**：导入产物直接落位 `public/pets/<id>/`（与精选包同层，`/api/pets` 发现管线零改动、无合并逻辑），git 排除经 `.gitignore` 的 `public/pets/*` + 精选 10 包 `!` 白名单规则实现；验收以 git 命令为准（A1-5）。
6. `/api/pets` 行为兼容：现有 10 包的发现结果与排序不变（`order` 前置不变）。发现扫描根须可注入（现行硬编码于 `server/index.js:264`），否则 A1-6 无法在 tmpdir 上验证。备选双根方案（仅在单根白名单被证伪时启用，如精选包频繁增删使白名单维护成本过高）：`/api/pets` 合并扫描两根且精选根保持在前。
7. 明确不做（承上游计划 WP1"明确不做"）：双格式注册表；包目录根 `pets.json` 对外索引（对外可被第三方抓取，构成再分发）。
8. 导入端点的滥用面：该端点本质是"把本机任意目录复制进 web 静态服务目录"，必须避免成为跨源网页可触发的任意文件复制原语（本服务**默认**绑定 `127.0.0.1`——`server/index.js:21` 为 `process.env.HOST || '127.0.0.1'`，HOST 环境变量可覆盖；跨源对策不得依赖回环假设）。服务端须要求非简单请求特征（如自定义首部校验）或等效来源校验；具体威胁模型与对策在实施计划展开。

**验收标准**

- **A1-1** `[测试]` Given 一个 fixture Codex 包目录（1536×1872 的最小可解析 webp + 合法 `pet.json`），When 调用导入模块（目标根注入 tmpdir），Then 结果为成功、目标根出现 `<id>/pet.json` + `spritesheet.webp` + `NOTICE.md`，且 `node tools/webp-size.js <落位 webp>` 输出含 `OK`。fixture webp 的构造方式固定：**恰 30 字节的手工 RIFF/VP8X 头二进制资产**（`webpSize` 只读前 30 字节：`RIFF` + 4B 尺寸 + `WEBP` + `VP8X` + 4B payload 尺寸 + 标志 / 保留 4B + 宽、高各减一的 3B 小端——w-1=1535、h-1=1871；2026-09-22 已按此构造实测解析出 1536×1872、rows=9、判据 OK），入库 `tests/fixtures/` 仅供服务端尺寸校验、非可渲染图像——不引入任何图像编码依赖（§4.3）。
- **A1-2** `[测试]`（参数化五案，与需求 3 的错误类一一对应）Given 分别为缺 `pet.json` / webp 魔数损坏（不可解析）/ 宽 ≠ 1536 / 高不能被 208 整除 / 行数 < 9 的来源目录，When 导入，Then 每案失败且错误信息指明对应原因（后三案各自断言宽 / 高 / 行数的具体报错文案，不共用一条），目标根无新增目录（原子性）。
- **A1-3** `[测试]` Given `pet.json` 带 UTF-8 BOM 且字段为 snake_case（`display_name` / `spritesheet_path`），When 导入，Then 成功且显示名解析正确。
- **A1-4** `[测试]` Given 未提供许可证与来源元数据，When 导入，Then 生成的 `NOTICE.md` 以固定字面量承载三要素并逐一断言（`indexOf !== -1`）：`source: <未提供>`（来源占位）、`license: unknown`（许可证占位）、`非商用`（非商用声明），且导入结果为"成功但带警告"。
- **A1-5** `[命令]` Given 用 CLI 完成的一次真实导入到默认根（前置命令固定：`node tools/import-pet.js "F:/project/zcode-monitor/tools/pets-staging/<任一含 pet.json 的包目录>"`——staging 仅存在于主仓库、worktree 下无此目录（2026-09-22 实测 `ls` 报 os error 2），为本地 gitignored 暂存区且内容随时间变化，不硬编码包名，来源目录仅读取；staging 不可达或为空时改用任一本地 Codex 包目录并照录所用命令），When `git -C "F:/project/zcode-monitor-plan" status --porcelain`，Then 导入产物不出现在待提交清单（`git check-ignore` 命中导入产物路径亦可作为等价证据）。
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
3. 每条口径决定必须留痕：结论 + 官方源码出处（文件 / 函数级）+ 对 `db.js` 的影响，写入口径文档（位置由实施计划定，随 WP2 提交）。口径切换交付时随附**新旧值对照表**（同一时段、修正前后两套查询的输出对照，真实库与 fixture 各一组）——用户可见数字的跳变可追溯（承 R9）。
4. **不做**对外 JSON 口径端点（对外暴露非本轮目标）。
5. 性能红线适用：本 WP 触碰或新增的每条查询，验收必须在真实库上只读实测（§4.1）。

**验收标准**

- **A2-1** `[测试]` Given fixture 库构造了覆盖口径边界的行（含 cache_read 与 cache_creation 并存、reasoning 为 NULL、`parent_id` 子代理组、`turn_usage` 缺 side call 的场景），When 调用修正后的用量查询，Then 返回值符合口径文档记载的结论（fixture 断言把口径文档固化为可执行检查；口径文档修订时本测试同步修订）。
- **A2-2** `[命令]+[评审]`（复合验收）Given 真实库只读访问，When 对同一 UTC 时段（建议取最近一个完整 UTC 日）分别以我方口径与对账基准工具计算 token 总量，Then 产出对账记录：双方命令与原始输出、逐项差异、每条差异的原因分类与出处。**"已解释"的判定规则**：每条差异须附官方源码 / 数据样本出处，经评审记录确认后方可计为已解释；**通过判据 = 全部差异均"已解释"（评审确认留痕）**——差异可以存在（承上游计划"无法对齐的差异逐条留痕"）。对账基准首选 ccusage（"已支持 ZCode 数据源"系上游计划 §2.1 的调研结论，本会话未验证），调用命令以其当时文档为准、实施时如实记录、不预设 flag；**fallback 基准**：ccusage 不可用或支持形态不匹配时，改用 zcode-token-usage-statusbar 的 JSON CLI（同数据源、口径已对齐官方，上游计划 §2.1）或纯 SQL 交叉核对，同样逐条留痕——基准替换本身记入对账记录。
- **A2-3** `[命令]` Given WP2 修改过的每条 SQL，When 在真实库上执行 `EXPLAIN QUERY PLAN` 与计时（只读、带 `started_at` 下界；命令模板见 §4.1），Then 计划输出**不含对任何表的 `SCAN`**（须为 `SEARCH ... USING INDEX` 或 rowid 尾界命中）——与 §4.1 红线一致，覆盖 `session` / `turn_usage` / `part` 等全部表（含触碰 `agentsForest` 等现存风险查询的情形，见 WP2 现状锚点），计时结果记入验收记录。**出路条款**：若口径核实结论要求触碰的现存查询在只读约束下（§4.2 禁 CREATE INDEX）无法消 SCAN——实证：`session` 表仅有 parent / project / task_type / trace / workspace 索引、无时间列索引（2026-09-22 真实库 sqlite_master 实测），`agentsForest`（`server/db.js:678-705`）无 projectId 时功能上必须全量扫 `session`——则二选一并留痕：(a) 不触碰该查询，口径影响写入口径文档；(b) 该查询以"改造后真实库只读计时不劣于改造前同查询基线"为替代判据收口，两个数字与理由记入验收记录。
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

1. `server/log-tail.js` 增加 watch 增量路径：`fs.watch` 监听**日志目录**（而非仅当日文件句柄），追加即触发解析；任一目录事件触发时按 `todayLogFile()` 重新解析当日文件名（`server/log-tail.js:12-15`），UTC 日切换（被监视文件换名）由此覆盖，跨日后新文件从偏移 0 起读。以字节偏移增量读取（对齐 hoangsonww/Claude-Code-Agent-Monitor 的混合摄取思路），同一偏移的行不得产出两次。
2. 失败与漏事件双重兜底：watch 报错（如 ENOENT / EMFILE）自动回退现有轮询，不丢事件；watch 静默漏事件时，周期性偏移对账补齐，保证最终一致。对账周期 5s（取仓库既有 5s 轮询惯例：`server/index.js:98`、`public/pet.html:494`）。**降级路径（若 A3-4 的 Windows 预验证显示 watch 命中率不可接受，阈值实施计划定）**：改用"当日文件 1s 短轮询 + 字节偏移去重"（`tailLog` 单次尾读 ≤1MB，`server/log-tail.js:40-60`，成本可忽略，同样满足 A3-5 判据）——机制替换属实施权限内，**除 A3-2 外验收判据不变**：降级态下无 watch 可回退，A3-2 的 Given 无法构造，其验证目标映射为"纯 1s 短轮询在停止追加后 ≤10s 内全部行可见且全程无重复"（连续性等价检查）。
3. 全程零写入：模块及其测试对 `~/.zcode/` 无任何写操作；测试 fixture 全在 tmpdir。
4. 明确不做：hooks 事件接收端点、hooks 安装 / 卸载脚本、配置 diff 展示。

**验收标准**

- **A3-1** `[测试]` Given fixture 日志目录（`ZCODE_LOG_DIR` 注入）且 watch 增量路径激活，When 向当日 JSONL 追加 10 行（每行间隔 ≥100ms），Then **硬判据**：事件总数恰为 10（偏移守恒，无重复）；**时序判据**：每行对应的事件在追加后 1s 内被解析回调收到（10/10）——Windows `fs.watch` 抖动容忍（承 R3）：允许整组重跑至多 2 次、任一次全过即通过；三次均未达 1s 时改以 3s 上界复测——**3s 复测全过则时序判据记通过（带注记），仍不过则时序判据记不通过、交 A3-5 综合裁定**（偏移守恒硬判据不过仍一票否决）。亚秒级目标是否达成最终以 A3-5 实测裁定，不因时序抖动否决 watch 路径。
- **A3-2** `[测试]` Given watch 处于回退态（fixture 中以删除被监视目录等方式触发错误），When 继续追加行，Then 事件仍被产出（轮询兜底），停止追加后 ≤10s（两个对账周期）内全部行可见，且全程无重复行。（若需求 2 的降级路径被启用、watch 整体移除，本条按需求 2 的映射执行。）
- **A3-3** `[命令]` Given `server/log-tail.js` 及其测试目录，When `grep -rnE 'writeFile|appendFile|createWriteStream|open(Sync)?\([^)]*['\''"]((w|wx|a|ax)\+?|r\+|rs\+)' server/log-tail.js tests/`，Then 无匹配（grep 退出码 1 属预期——ERE 不支持前向查找，故枚举写打开模式而非排除 `r`；模式以单引号承载、内嵌引号经 `'\''` 转义，字面可执行——2026-09-22 实测：`bash -n` 语法通过；对现存 `server/log-tail.js` 退出码 1；`w/a/r+/wx/w+/a+/rs+/ax` 八种写打开形态全部命中、`r`/`rs` 不命中；`open(` 同时覆盖 `fs.open` / `fs.openSync` / `fs.promises.open`；动态面由 A0-3 的 tmpdir 注入守护兜底）。
- **A3-4** `[测试]`（Windows 预验证，上游计划风险项）Given WP0 fixture 在 Windows 上以接近 ZCode 的节奏连续追加 100 行，Then watch 命中率与漏事件数被记录，且最终一致判据（停止追加后 ≤10s 全部可见）成立——无论 watch 漏不漏，混合兜底必须满足最终一致。另覆盖一次 UTC 日切换场景：构造跨日文件名后继续追加（换名后的当日文件），事件仍须可见（对应需求 1 的目录监听与重解析）。本条结果同时是需求 2 降级路径（1s 短轮询）的启用依据。
- **A3-5** `[评审]` 真实环境观测（量化判据）：对比强化前后"JSONL 追加 → 活动流可见"的延迟，各记 ≥5 个样本并照录原始值。**通过判据 = 强化后样本中位数 < 强化前纯轮询基线的中位数**（基线为现行 5s 轮询的同法采样）；"各样本 <1s"作为观测目标照录、不作硬判据（时序抖动由 A3-1 的容忍条款管辖）。

### WP4（P1）桌宠行为与安全升级

**用户故事**

- 作为桌宠玩家，agent 出错时宠物明确演失败动画、权限请求时演等待动画、长时间无事时入睡、连点它时有连击反应；且这些行为互不误触——两击永远是切换宠物，四击永远是连击，入睡永不吞掉工作事件。
- 作为注重隐私的用户，即使未来气泡展示 agent 文本，路径 / URL / 密钥也不会出现在气泡里。

**现状锚点**

- 动画契约：`ROW_ANIMS` 固定 9 行含 `failed` / `waiting_permission`（`public/pet.html:186-187`）——error 态**不缺资产，缺接线**。9 行契约不变，不新增动画行。
- 现行状态机：`computeState()` 三态 gen / cruise / idle（`:386-389`），`IDLE_AFTER = 2min`（`:173`），`GEN_STALE = 10min`（`:174`）；gen 期间按 t/s 档位挑行 running / jumping / running_right（`desiredAnim`，`:394-401`）；换行动画只在整循环边界生效（`step`，`:236-248`）。
- 手势现状：双击 = 切换宠物（`dblclick` → `cyclePack`，`public/pet.html:511`；`cyclePack` 在 `:345-348`），单击 = 拖动（`:504-506`），滚轮 = 形态切换（`:515-518`）。
- 事件源：SSE `/api/gen/events`，现发 `phase: start / lanes / end`（发射点：start / end 为 `server/livegen.js:107,110`、lanes 为 `server/livegen.js:112`，经 `server/index.js:235-237` 的 onEvent 写出；连接时快照仅含 start / end 两相，`server/index.js:232`；`openSSE` 在 `public/pet.html:468-491`，按三相处列 `public/pet.html:475-477`）——error / permission 是新增事件载荷。
- 权限请求的现存数据面（2026-09-22 真实库只读核实）：schema 含独立 `permission` 表（`project_id` / `time_created` / `time_updated` / `data`，当前 0 行）与 `tool_usage.approval_status` 列（`server/db.js:532` 已在 sessionActivity 选取；真实库尾 5000 行取值全为 `'none'`）——两者是**候选落点，但均未被证实为权限请求的可观测来源**（`db.js` 现无任何查询触及 `permission` 表；`approval_status` 非 `none` 取值的触发时机未核实）。核实路径见需求 1 的数据源核实门。
- 素材与设计来源：clawd-on-desk（12 态、入睡 + 惊醒、连击）**只学交互设计，不抄代码与素材**（AGPL，上游计划 §8）；OpenPets 的 speech 消毒思路；tokibean 的事件 → 情绪映射。

**需求**

1. **第一步（数据源核实门，对标 WP2 的核实步骤）**：接线开工前，先证实两类事件在零写入约束下的可轮询落点与记录形态，结论（落点 + 记录形态 + fixture 样例行形态）写明后才开始接线。工具失败：核实 `tool_usage.status='error'`（既有列与用法先例 `server/db.js:163,177`）；权限请求：依次核实 (a) 真实使用中触发一次权限请求后 `permission` 表是否出现新行（只读观察；该表当前 0 行）、(b) `tool_usage.approval_status` 非 `'none'` 取值的出现时机、(c) zai-org/ZCode 官方源码的落盘行为。**若权限请求确无可轮询落点，则 `waiting_permission` 接线子项降级 backlog（显式部分交付），A4-1 / A4-7 的对应子项同步移除；error 态交付不受影响。**
2. **error 态接线**：livegen 的工具失败事件 → `failed` 行；权限请求事件（数据源核实门通过时）→ `waiting_permission` 行；事件结束后回常规状态判定。页面与服务器之间新增的事件载荷（phase 或事件类型）在实施计划定义。**共享模块形态**："事件 → 目标状态"的决策逻辑与 `ROW_ANIMS` 契约常量抽为独立文件（如 `public/pet-state.js`，命名实施定），采用经典脚本 + 双端导出——浏览器经 `<script src>` 挂 `window` 全局，node 侧同一文件以 `module.exports` 条件导出供 `node --test` `require()`；`pet.html`（现为内联非 module 脚本，`public/pet.html:170`）在该文件之后加载并只消费全局，删除 `ROW_ANIMS` 等契约常量的内联副本——测试守护的必须是页面实际加载的那份文件（依赖门槛下不引入浏览器自动化，页面接线本身走评审）。
3. **入睡（idle 的深化态）**：idle 持续满入睡阈值后进入 sleep 状态；阈值可注入（参考 clawd 的短入睡节奏，实施时定值）；任何 livegen 活动（工具开始 / 完成 / 权限请求）**立即惊醒**并重置 idle 计时；工作事件优先级恒高于入睡。入睡无专属动画行（9 行契约不动），视觉表现为 idle 行 + 可叠加暗示（如 body class / 气泡 zzz），细节实施定，行为契约以状态机断言为准。
4. **双击与连击的互斥**：采用上游计划拍板的"双击优先、计数延后"——每次点击起约 300ms 判定窗口（可调）；窗口内第 2 击挂起切换动作；窗口关闭前无后续点击 → 执行切换；窗口内累计 ≥4 击 → 判定连击，取消挂起的切换并触发连击反应。不变量：2 击 → 切换；≥4 击 → 连击（不切换）；3 击 → 窗口关闭时执行切换；1 击 → 无手势。判定逻辑为纯函数，单测覆盖上述全部不变量。**显式代价与范围**：切换动作延迟一个判定窗口（约 300ms，实施实测调整）才执行——"双击优先"设计的固有代价；现行 `dblclick` 仅在 WebView2 壳内注册（`public/pet.html:503,511-513`），本 WP 将手势事件注册扩展为页面通用（浏览器直开页面同样可双击切换，A4-7 的浏览器演示以此为前提；壳内拖动等 `postMessage` 契约不变，`public/pet.html:504-518`）。
5. **消毒层共享模块**：独立于页面文件，输入 agent 文本、输出消毒后文本，供 `node --test` 直接测试。必须拦截：Windows 本地路径（`C:\...` 形态）、`file://` 与 `http(s)://` URL、密钥样式的 token（`sk-` 前缀、`Bearer` 头等）。普通文本原样保留。模块注释与导出须显式声明**覆盖面有限**：仅上述 4 类样式的字面替换、不是完备的安全边界——避免"过了消毒即可展示"的虚假安全感。**按既定决策 §6.2，气泡默认不展示 agent 原始文本——本 WP 交付的是模块 + 单测（上游计划 WP4 验收明文"消毒层有单测"），不改变默认展示行为。**

**验收标准**

- **A4-1** `[测试]` Given 状态机纯函数，When 输入工具失败事件（fixture 样例行按需求 1 核实门记载的记录形态构造，如 `tool_usage` 行 `status='error'`），Then 目标动画为 `failed`；输入权限请求事件（同样按核实门记载的落点与形态构造 fixture 样例行；核实门降级时本子项整体移除），Then 为 `waiting_permission`；随后输入 gen end 事件，Then 回到 cruise / idle 判定路径。
- **A4-2** `[测试]` Given 处于 sleep 状态，When 任一 livegen 活动事件到达（参数化：工具开始 / 完成 / 权限请求），Then 状态立即离开 sleep 且 idle 计时被重置（输出含惊醒副作用标记）；Given 工作事件与入睡条件同时满足，Then 工作态胜出。
- **A4-3** `[测试]` Given idle 持续时长跨过注入的入睡阈值，When tick，Then 进入 sleep；Given 未达阈值，Then 不进入。
- **A4-4** `[测试]`（参数化手势不变量）Given 判定窗口内点击序列，When 窗口关闭，Then：`[c,c]` → 执行切换且无连击；`[c,c,c,c]` → 连击且不切换；`[c,c,c]` → 窗口关闭时执行切换；`[c]` → 无动作。
- **A4-5** `[测试]` Given 消毒模块，When 输入含 `C:\Users\x\secret.txt`、`https://example.com/p?token=abc`、`sk-abcdefgh`、`Bearer xyz` 的文本，Then 输出不含上述任一敏感子串（逐项断言 `indexOf === -1`）；Given 普通中文短句，Then 输出与输入一致。
- **A4-6** `[测试]`（契约守护）Given `pet.html` 实际加载的那份共享模块文件（测试以 `require()` 加载它，并另断言 `public/pet.html` 含指向同一文件的 `<script src=` 引用——防止守护到副本），其导出的 `ROW_ANIMS`，Then 恒等于 `['idle','running_right','running_left','waving','jumping','failed','waiting_permission','running','review']`（9 行、顺序不变）。
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
- **A5-3** `[命令]` Given 仪表盘 HTML 与 README，When 依次执行三条固定 grep（三要素各一关键词，不得替换或自选）：`grep -n "第三方报告" public/index.html README.md`、`grep -in "checkpoints" public/index.html README.md`、`grep -n "未经我们验证" public/index.html README.md`，Then 三条命令均对两文件命中。

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

- 真实库 `~/.zcode/cli/db/db.sqlite` 约 **15.4 GiB 且持续增长**（2026-09-22 实测 16,521,129,984 字节；早期基线约 14.6GB）——红线按当时实测的更大值执行。历史事故：对 message 表的全表扫描曾致事件循环饿死约 **2.4s/次**，视为回归、一票否决。
- 任何新查询必须命中**任一可用索引**（`EXPLAIN QUERY PLAN` 显 `SEARCH ... USING INDEX`）或 rowid 尾界——即计划输出不含对任何表的 `SCAN`（与 A2-3 同一口径）；时间窗口类查询仍应优先 `started_at` 下界（历史事故教训的针对性手法）。本 Spec 各 WP 对 `db.js` 的改动（WP2）与一切后续查询均适用。
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

- `~/.zcode/` 下一切**无业务写入**：本项目代码不写 ZCode 的任何数据、日志与配置文件（2026-09-22 措辞校准：原文"一个字节都不写"与既有白名单例外字面冲突）。白名单（均为既有机制、非本 Spec 新增）：(a) `/api/checkpoint` 与 ZCode 退出时的自动 WAL 折叠——`wal_checkpoint(TRUNCATE)` 打开**可写**连接把 WAL 帧折叠进库主文件（`server/zcode-runtime.js:62-86`、`server/index.js:73-93,100-121`），属既有能力，边界不变；(b) WAL 模式下只读连接对 `-shm` 读锁的机制性触碰（SQLite 读取机制，非内容写入，`server/db.js:56`）。A3-3 式静态审查的边界即本白名单。
- 测试一律用 `os.tmpdir()` fixture，绝不触碰真实库（A0-3 / A0-7 守护）。
- 范围澄清：WP1 导入落位写的是**本仓库自身目录**（`public/pets` 或其等效落位根），不在上述约束范围内；但导入产物默认不得被 git 跟踪（A1-5）。

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

- Windows + Git Bash，Node v24.11.1（2026-09-22 实测）；`node --test` 为验收底座，不引入浏览器自动化框架（页面级行为走纯函数抽取 + 实机评审，见 WP4 需求 2）。
- 被测路径一律注入（env 或参数），不依赖 cwd；`server/db.js:16-23` 的 env 注入模式为既有先例。
- 验收证据（EXPLAIN 输出、计时、对账输出、评审截图）随各 WP 提交留痕（提交说明或 docs/specs/ 下验收记录文件，实施计划定载体）。

---

## 5. 风险与回滚

| # | 风险 | 影响面 | 对策与回滚 |
|---|---|---|---|
| R1 | WP2 触碰查询在真实库上变慢（15.4 GiB 且持续增长） | 事件循环饿死，全站卡顿 | §4.1 红线：EXPLAIN + 计时前置到验收；一票否决即 revert 该 commit。先例手法（2h pad，`db.js:361-367`）必须保持 |
| R2 | zai-org/ZCode 刚开源（上游记载仅 2 commits），schema 核实材料不全 | 口径结论不确定 | 以核实结果为准，不确定处显式留痕（A2-2 通过判据是"无未解释差异"而非"零差异"）；不伪造结论 |
| R3 | Windows `fs.watch` 漏事件 / 报错 | WP3 实时性退化或事件丢失 | 双重兜底：错误回退轮询 + 周期偏移对账保证最终一致（A3-2 / A3-4）；回退态即现行行为，功能回滚 = 关闭 watch 路径 |
| R4 | WP4 状态机复杂度膨胀、动画状态爆炸；权限请求事件可能无可观测数据源（hooks 已随零写入否决；`permission` 表与 `approval_status` 候选落点均未证实） | 回归面扩大、维护成本；`waiting_permission` 子项成死交付 | 9 行契约不动（A4-6 守护）；决策逻辑全部抽纯函数单测；实机评审项（A4-7）把关；需求 1 数据源核实门前置，无落点即降级 backlog（显式部分交付） |
| R5 | 导入引入 IP 敏感素材进入版本库 / 分发 | 法律与社区风险 | 导入产物默认不进 git（A1-5）；NOTICE 三要素强制（A1-4）；`license: unknown` 显式留痕 |
| R6 | 导入端点被跨源网页滥用为文件复制原语 | 本地文件经静态服务外泄 | 非简单请求特征校验（A1-7），对策不依赖回环假设；服务默认绑 127.0.0.1（`index.js:21`，HOST 环境变量可覆盖） |
| R7 | WP5 措辞不当（断言化 / 制造恐慌） | 用户误导、产品调性受损 | 三要素 + 负面清单评审（A5-1）；"第三方报告，未经我们验证"为固定措辞 |
| R8 | 测试 fixture 与真实库意外耦合（路径注入遗漏） | 触碰真实库，违反只读承诺 | A0-3 tmpdir 前缀守护 + A3-3 静态审查；新模块一律参数注入 |
| R9 | WP2 口径切换一次性改动约 8 个用量查询函数的语义（input 含 cache-read 拆分、总量公式、`parent_id` 去重、side call 标注），全部前端数字随之变动；对账基准依赖 ccusage 对 ZCode 数据源的支持形态（上游调研结论，本会话未验证） | 用户已锚定的历史读数跳变；A2-2 按字面不可执行 | 口径文档逐条留痕（需求 3）+ 新旧值对照表；ccusage 不可用或不匹配时回退 zcode-token-usage-statusbar JSON CLI（同源、官方口径）或纯 SQL 交叉核对，基准替换记入对账记录（A2-2） |

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
