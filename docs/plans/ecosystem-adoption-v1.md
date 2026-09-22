# 生态采纳 v1 实施计划（ecosystem-adoption）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（顺序执行）或 superpowers:subagent-driven-development（每任务一个子代理）按任务实施本计划。步骤用 checkbox（`- [ ]`）跟踪。**若本机技能清单中不存在 `superpowers:*` 技能，则按本文档 checkbox 顺序逐任务顺序执行、每任务一 commit（放弃子代理并行），不阻塞。**

**Goal:** 为 zcode-monitor 落地生态采纳 v1 的六个工作包：测试基建（WP0）、Codex 宠物包一键导入（WP1）、隐私提示（WP5）、token 口径对齐与对账（WP2）、桌宠行为与安全升级（WP4）、JSONL watch 实时化（WP3-lite）。

**Architecture:** 全部工作在 worktree `F:/project/zcode-monitor-plan`（分支 `feature/ecosystem-adoption-plan`）进行；主仓库 `F:/project/zcode-monitor` 一律只读（唯一例外：可复制其 `node_modules`）。T1 先立测试底座，T2 与 T3 文件不相交、可并行，随后 T4 → T5 → T6 顺序执行。每个任务独立成 commit（T2 可拆多组），回滚单位是 commit。

**Tech Stack:** Node v24.11.1（2026-09-22 实测）、express + better-sqlite3（运行时依赖零新增）、`node:test`（Node 内置测试 runner）、原生 HTML/CSS/JS（无框架无构建）。

**Spec:** `docs/specs/ecosystem-adoption-v1.md`（v1.2 定稿，行号基于 worktree `5933a1f`；经本会话核实，代码文件自该提交以来零改动，行号对当前 HEAD `0160704` 仍然有效）。上游分析：`docs/ecosystem-adoption-plan.md`。执行者须同时读这两份与本计划。

---

## Global Constraints（每条任务的隐含前提，摘自 Spec，一字不改的数值照抄）

- **性能红线（一票否决）**：真实库 `~/.zcode/cli/db/db.sqlite` 约 15.4 GiB 且持续增长（2026-09-22 实测 16,521,129,984 字节）。任何新查询必须命中任一可用索引（`EXPLAIN QUERY PLAN` 显 `SEARCH ... USING INDEX`）或 rowid 尾界，计划输出不得含对任何表的 `SCAN`；历史事故：message 表全表扫描致事件循环饿死约 2.4s/次。时间窗口查询优先 `started_at` 下界（先例手法：`completedSince` 的 2h pad，`server/db.js:359-387`）。
- **只读承诺**：对 `~/.zcode/` 下一切无业务写入。白名单（均为既有机制）：(a) `/api/checkpoint` 与退出时 `wal_checkpoint(TRUNCATE)`（`server/zcode-runtime.js:62-86`）；(b) WAL 只读连接对 `-shm` 读锁的机制性触碰。测试一律用 `os.tmpdir()` fixture，绝不触碰真实库。
- **依赖门槛**：`dependencies` 保持恰为 `better-sqlite3` + `express`（A0-6 守护）；新能力优先 Node 内置模块。WP1 服务端校验不得引入图像解码依赖（像素级检测留在页面 `scanRow`）。
- **9 行动画契约不动**：`ROW_ANIMS = ['idle','running_right','running_left','waving','jumping','failed','waiting_permission','running','review']`（`public/pet.html:186-187`），不新增动画行；入睡复用 idle 行。
- **平台与可测性**：Windows + Git Bash；被测路径一律注入（env 或参数），不依赖 cwd；不引入浏览器自动化框架（页面级行为走纯函数抽取 + 实机评审）。
- **IP 与分发**：导入产物不得被 git 跟踪（A1-5）；NOTICE 三要素强制；不建对外宠物包索引；不与账号切换 / 反代项目互链；AGPL 项目（clawd-on-desk）只学交互设计不抄代码素材。
- **气泡默认不展示 agent 原始文本**（`public/pet.html:419-431` 气泡渲染区现状：内容仅为速度数字、单位与 ×N 徽章，全页无 agent 文本来源——SSE 消费只见 phase/sessions/tps）；本计划只交付消毒模块 + 单测，不改默认展示行为。
- **提交规范**：中文主题行 + 前缀（`docs:`/`feat:`/`fix:`/`test:`/`chore:`）；**不要 push**（收尾阶段统一处理）。

---

## 执行顺序与提交总览

| 顺序 | 任务 | 内容（WP） | 可并行 | 提交（commit 主题行） |
|---|---|---|---|---|
| 1 | T1 | 测试基建（WP0） | — | `test: WP0 测试基建——node --test 入口与 tmpdir fixture` |
| 2a | T2 | 宠物包一键导入（WP1） | ∥ T3 | `feat: WP1 宠物包校验导入——共享模块+CLI` / `feat: WP1 导入端点与图鉴入口+gitignore 白名单` / `test: WP1 导入模块测试` |
| 2b | T3 | 隐私提示（WP5） | ∥ T2 | `docs: WP5 隐私提示——仪表盘与 README 快照上传第三方报告警示` |
| 3 | T4 | token 口径对齐（WP2） | — | `feat: WP2 token 口径对齐——官方 schema 核实落地与对账` |
| 4 | T5 | 桌宠行为与安全（WP4） | — | `feat: WP4 桌宠行为升级——error 接线/入睡/连击/消毒模块` |
| 5 | T6 | JSONL watch 实时化（WP3-lite） | — | `feat: WP3-lite JSONL watch 增量摄取——目录监听+偏移去重+双重兜底` |

- **并行不相交性**：T2 改动 `server/pet-import.js`（新建）、`tools/import-pet.js`（新建）、`tools/webp-size.js`、`server/index.js`、`public/pets-preview.html`、`.gitignore`、`tests/`；T3 只改 `README.md`、`public/index.html`、`public/styles.css`。两集合交集为空（注意 `server/index.js` 与 `public/index.html` 是两个不同文件）。
- **对任务书 T2 文件清单的两处必要增补**（来源为定稿 Spec，并行不相交性不受影响）：Spec WP1 需求 2 + 验收 A1-9 要求 `tools/webp-size.js` 可被 `require` 且 CLI 行为不变（现状无 `module.exports`）；Spec WP1 需求 5 + 验收 A1-5 要求 `.gitignore` 增加 `public/pets/*` + 精选 10 包 `!` 白名单。没有这两处改动，A1-9 / A1-5 无法通过。
- **里程碑**：M1 = T1 + T2 + T3 + T4（出口判据 A0-1~7、A1-1~9、A2-1~5、A5-1~3）；M2 = T5 + T6（A4-1~7、A3-1~5）。backlog（BP1/BP2）不在本计划。

### 门禁定义（每个 commit 提交前必须全过）

1. **测试全绿**：在 worktree 根运行 `npm test`（即 `node --test tests/`），退出码 0、0 failed。
2. **服务冒烟**（fixture 环境，绝不指向真实库）：

   > **串行纪律**：门禁（尤其本冒烟，固定 `PORT=7391`）在任意时刻至多一个执行者在跑——T2/T3 的「可并行」指文件改动不相交，**不含门禁并行**；两个执行者同时跑冒烟会端口冲突、假失败。

   ```bash
   cd "F:/project/zcode-monitor-plan"
   FX=$(node -e "const f=require('./tests/helpers/fixture-db');const fx=f.createFixtureDb();fx.seed();console.log(fx.root)")
   ZCODE_DB="$FX/db.sqlite" ZCODE_LOG_DIR="$FX/log" ZCODE_ROLLOUT_DIR="$FX/rollout" \
     PORT=7391 OPEN_BROWSER=0 node server/index.js > "$FX/server.log" 2>&1 &
   SRV=$!; sleep 2
   curl -sf http://127.0.0.1:7391/api/health | grep -q '"ok":true' && echo HEALTH-OK
   curl -sf http://127.0.0.1:7391/api/pets > /dev/null && echo PETS-OK
   curl -sf http://127.0.0.1:7391/ | grep -q '<title>' && echo INDEX-OK
   kill $SRV
   FXROOT="$FX" node -e "require('fs').rmSync(process.env.FXROOT,{recursive:true,force:true})"
   ```

   期望输出三行 `HEALTH-OK / PETS-OK / INDEX-OK`。
3. **依赖零新增**：`node -e "console.log(Object.keys(require('./package.json').dependencies))"` 输出恰为 `[ 'better-sqlite3', 'express' ]`。
4. **加码项**（按任务）：T4 的 commit 另跑 §4.1 红线实测（T4 步骤 5）；T6 的 commit 另跑 A3-3 零写入 grep（T6 步骤 5）。

### human-gate 清单（人工实机评审项，代理执行到此留痕即过、不得造假）

以下步骤本质需要人或实机环境（截图、真实权限请求、WebView2 壳交互），自主执行的代理**无法亲自完成**。代理到达该步时的标准留痕格式：在对应 `docs/acceptance/*.md` 写一行「结论：待人工评审；已备复现步骤：<命令/操作序列>；自动可验证前置（npm test 等门禁）已全过」——这算该步的合法完成态，不算跳过；**严禁虚构评审结论或截图路径**。

| 步骤 | 为什么是 human-gate | 留痕文件 |
|---|---|---|
| T2 Step 10（A1-8 端到端） | 需实机浏览器/壳查看图鉴与轮换 | `docs/acceptance/T2-import-e2e.md` |
| T3 Step 5（A5-1 评审） | 文案观感与语气属人工判断 | 结论记入该任务 commit 说明（对照负面清单逐句自查） |
| T4 Step 7（A2-4 徽章截图） | 需实机页面截图 | `docs/acceptance/T4-before-after.md` |
| T5 Step 0(a)（触发真实权限请求） | 需在真实 ZCode 使用中自然产生权限请求，代理不得代填 | `docs/acceptance/T5-permission-gate.md` |
| T5 Step 6（A4-7 手势演示） | 需 WebView2 壳内实机拖动/连击 | `docs/acceptance/T5-behavior-e2e.md` |

### 回滚方式

- 每个任务独立成 commit，回滚 = `git -C "F:/project/zcode-monitor-plan" revert <sha>`。多个 commit 时按**从新到旧**的顺序 revert（先 revert 依赖方、后 revert 被依赖方，例如 T2 的三连提交先 revert `test:`、再 `feat: 端点`、最后 `feat: 模块`）。
- 本计划全程不产生持久化数据迁移（server 无落盘状态），回滚后重启进程即恢复。
- T6 特例：watch 路径自带回退态，功能回滚也可只关 watch（R3）；T2 的导入产物是 gitignored 本地文件，revert 后仍留在磁盘上，属无害残留，可保留或自行清理。
- 证据载体（Spec §4.6）：各 WP 的验收证据（EXPLAIN 输出、计时、对账记录、评审截图路径）统一放 `docs/acceptance/`（本计划新建目录），随对应任务的 commit 提交。

---

## 文件结构总图（本计划完成后的新增/修改面）

```
zcode-monitor-plan/
├── package.json                          # [T1] +test script
├── .gitignore                            # [T2] +public/pets/* 白名单规则
├── README.md                             # [T3] +隐私提示章节
├── docs/
│   ├── plans/ecosystem-adoption-v1.md    # 本文件
│   ├── caliber/token-caliber-v1.md       # [T4 新建] 口径文档
│   └── acceptance/                       # [T4/T5/T6 新建] 验收证据目录
├── server/
│   ├── pet-import.js                     # [T2 新建] 导入共享模块（校验+落位+NOTICE+发现逻辑）
│   ├── index.js                          # [T2] /api/pets 改调共享模块；+POST /api/pets/import
│   ├── log-tail.js                       # [T6] +createLogWatcher（fs.watch+偏移增量+双重兜底）
│   ├── livegen.js                        # [T5] tick() 增发 tool_error 事件
│   └── db.js                             # [T4] 用量查询口径修正 + 官方出处注释
├── tools/
│   ├── webp-size.js                      # [T2] require.main 守卫 + module.exports（CLI 行为不变）
│   ├── import-pet.js                     # [T2 新建] 导入 CLI
│   └── log-latency-probe.js              # [T6 新建] 只读延迟观测探针（A3-5）
├── public/
│   ├── index.html                        # [T3] +隐私提示条
│   ├── styles.css                        # [T3] +.privacy-notice；（T4 另加 .caliber）
│   ├── pets-preview.html                 # [T2] +导入面板
│   ├── pet.html                          # [T5] 接线共享状态机/手势；删内联契约常量
│   ├── pet-state.js                      # [T5 新建] 契约常量+事件→状态纯决策+手势判定（双端导出）
│   ├── pet-sanitize.js                   # [T5 新建] 消毒共享模块（双端导出）
│   └── views/overview.js                 # [T4] 用量数字旁标注口径来源
└── tests/                                # [T1 新建] 全部测试
    ├── fixtures/sheet-1536x1872.webp     # 30 字节最小 webp 头资产（仅尺寸校验用）
    ├── helpers/
    │   ├── fixture-db.js                 # tmpdir SQLite fixture（按表分组构建器）
    │   ├── fixture-jsonl.js              # tmpdir JSONL fixture
    │   └── webp-fixture.js               # vp8xSheet(w,h) 头构造器
    ├── db-env.test.js                    # A0-3
    ├── db-queries.test.js                # A0-4（23 个查询函数）
    ├── log-tail.test.js                  # A0-5
    ├── hygiene.test.js                   # A0-6 / A0-7
    ├── pet-import.test.js                # A1-1~4、A1-6、A1-7
    ├── db-caliber.test.js                # A2-1（T4 新建）
    ├── pet-state.test.js                 # A4-1~4、A4-6
    ├── pet-sanitize.test.js              # A4-5
    └── log-tail.watch.test.js            # A3-1/2/4
```

---

## T1：测试基建（WP0）

**Files:**
- Modify: `package.json:8-11`（scripts 增加 test）
- Create: `tests/helpers/fixture-db.js`、`tests/helpers/fixture-jsonl.js`、`tests/helpers/webp-fixture.js`
- Create: `tests/fixtures/sheet-1536x1872.webp`（30 字节二进制资产）
- Create: `tests/db-env.test.js`、`tests/db-queries.test.js`、`tests/log-tail.test.js`、`tests/hygiene.test.js`

**Interfaces（后续任务依赖的产物，签名固定）:**
- `tests/helpers/fixture-db.js` 导出：
  - `createFixtureDb()` → `{ root, dbPath, logDir, rolloutDir, conn, seed(), close(), cleanup() }`；`root` 等全部位于 `os.tmpdir()` 下（`fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-fx-'))`），不读 cwd。
  - 按表构建器（WP2 修订时只动对应表）：`buildSession(conn, rows)`、`buildModelUsage(conn, rows)`、`buildToolUsage(conn, rows)`、`buildTurnUsage(conn, rows)`、`buildMessage(conn, rows)`、`buildPart(conn, rows)`。
- `tests/helpers/fixture-jsonl.js` 导出：`createLogFixture()` → `{ root, write(name, lines), append(name, lines), path(name), cleanup() }`。
- `tests/helpers/webp-fixture.js` 导出：`vp8xSheet(w, h)`（返回 30 字节 Buffer）、`writeSheet(dir, name, w, h)`（返回文件路径）。
- 环境注入约定（后续所有 DB/日志测试沿用）：**先**设 `process.env.ZCODE_DB / ZCODE_LOG_DIR / ZCODE_ROLLOUT_DIR` 指向 fixture 路径，**再** `require('../server/db')`（`server/db.js:16-23` 在 require 时读 env）。

- [ ] **Step 1：供给 worktree 依赖（Spec WP0 现状锚点：worktree 无 node_modules）**

  首选（标准）：`cd "F:/project/zcode-monitor-plan" && npm install`。
  等价捷径（共享上下文明确允许复制主仓库 node_modules）：
  ```bash
  cp -R "F:/project/zcode-monitor/node_modules" "F:/project/zcode-monitor-plan/node_modules"
  ```
  验证（本会话已实测 Node v24.11.1、主仓库 `node_modules/better-sqlite3` 存在）：
  ```bash
  cd "F:/project/zcode-monitor-plan" && node -e "console.log(require('better-sqlite3') ? 'native ok' : 'fail')"
  ```
  期望：`native ok`。

- [ ] **Step 2：写 `tests/helpers/webp-fixture.js`**

  ```js
  'use strict';
  // 30 字节最小 RIFF/VP8X 头：仅承载画布宽高（各减一、3 字节小端），非可渲染图像。
  // webpSize 只读前 30 字节（tools/webp-size.js:6-29），服务端尺寸校验不需要真图。
  const fs = require('fs');
  const path = require('path');

  function vp8xSheet(w, h) {
    const b = Buffer.alloc(30);
    b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(22, 4);
    b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii');
    b.writeUInt32LE(10, 16); b.writeUInt32LE(0, 20);
    const w1 = w - 1, h1 = h - 1;
    b[24] = w1 & 0xff; b[25] = (w1 >> 8) & 0xff; b[26] = (w1 >> 16) & 0xff;
    b[27] = h1 & 0xff; b[28] = (h1 >> 8) & 0xff; b[29] = (h1 >> 16) & 0xff;
    return b;
  }
  function writeSheet(dir, name, w, h) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, vp8xSheet(w, h));
    return p;
  }
  module.exports = { vp8xSheet, writeSheet };
  ```

- [ ] **Step 3：生成并入库 `tests/fixtures/sheet-1536x1872.webp`，验证字节正确**

  ```bash
  cd "F:/project/zcode-monitor-plan"
  mkdir -p tests/fixtures
  node -e "const{vp8xSheet}=require('./tests/helpers/webp-fixture');require('fs').writeFileSync('tests/fixtures/sheet-1536x1872.webp',vp8xSheet(1536,1872))"
  node tools/webp-size.js tests/fixtures/sheet-1536x1872.webp
  node -e "const b=require('fs').readFileSync('tests/fixtures/sheet-1536x1872.webp');console.log(b.length, b.toString('hex'))"
  ```
  期望（本会话 2026-09-22 已按同一构造实测）：第一行 `tests/fixtures/sheet-1536x1872.webp: 1536x1872 rows=9 OK`；第二行 `30 524946461600000057454250565038580a00000000000000ff05004f0700`。

- [ ] **Step 4：写 `tests/helpers/fixture-db.js`（DDL 编码 db.js 现行查询所假设的最小列集）**

  ```js
  'use strict';
  // tmpdir SQLite fixture：伪造 ~/.zcode/cli/db/db.sqlite 的形状。
  // DDL 编码的是 server/db.js 现行查询所假设的最小列集（Spec WP0 需求 2）；
  // WP2 核实官方 schema 后只修订对应表的 DDL + 构建器。绝不触碰真实库。
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const Database = require('better-sqlite3');

  const DDL = `
  CREATE TABLE session (
    id TEXT PRIMARY KEY, title TEXT, task_type TEXT, directory TEXT,
    parent_id TEXT, project_id TEXT, time_created INTEGER, time_updated INTEGER);
  CREATE TABLE model_usage (
    id INTEGER PRIMARY KEY, session_id TEXT, turn_id TEXT, trace_id TEXT,
    status TEXT, started_at INTEGER, completed_at INTEGER, duration_ms INTEGER,
    query_source TEXT, model_id TEXT, provider_id TEXT, variant TEXT, mode TEXT,
    agent TEXT, input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
    cache_read_input_tokens INTEGER, cache_creation_input_tokens INTEGER,
    tool_call_count INTEGER, computed_total_tokens INTEGER,
    error_type TEXT, error_code TEXT, error_message TEXT);
  CREATE INDEX idx_model_usage_started_at ON model_usage(started_at);
  CREATE INDEX idx_model_usage_session ON model_usage(session_id);
  CREATE TABLE tool_usage (
    id INTEGER PRIMARY KEY, session_id TEXT, turn_id TEXT, trace_id TEXT,
    tool_call_id TEXT, tool_name TEXT, status TEXT, started_at INTEGER,
    completed_at INTEGER, duration_ms INTEGER, side_effect_scope TEXT,
    read_only INTEGER, approval_status TEXT, exit_code INTEGER,
    output_bytes INTEGER, stderr_bytes INTEGER,
    error_type TEXT, error_code TEXT, error_message TEXT);
  CREATE INDEX idx_tool_usage_started_at ON tool_usage(started_at);
  CREATE INDEX idx_tool_usage_session ON tool_usage(session_id);
  CREATE TABLE turn_usage (
    turn_id TEXT, session_id TEXT, status TEXT, trace_id TEXT, user_message_id TEXT,
    started_at INTEGER, first_token_at INTEGER, completed_at INTEGER,
    duration_ms INTEGER, time_to_first_token_ms INTEGER,
    model_request_count INTEGER, model_retry_count INTEGER,
    tool_call_count INTEGER, tool_error_count INTEGER,
    input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
    cache_read_input_tokens INTEGER, cache_creation_input_tokens INTEGER,
    computed_total_tokens INTEGER, context_exceeded INTEGER,
    error_type TEXT, error_code TEXT);
  CREATE TABLE message (
    id INTEGER PRIMARY KEY, session_id TEXT, time_created INTEGER,
    sequence INTEGER, data TEXT);
  CREATE INDEX idx_message_session ON message(session_id);
  CREATE TABLE part (
    id INTEGER PRIMARY KEY, message_id INTEGER, sequence INTEGER,
    time_created INTEGER, data TEXT);
  CREATE INDEX idx_part_message ON part(message_id);
  `;

  function insertRows(conn, table, rows) {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const stmt = conn.prepare(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    for (const r of rows) stmt.run(cols.map(c => (r[c] === undefined ? null : r[c])));
  }
  // 按表构建器：行对象字段即上面对应 DDL 的列名，缺省补 NULL。
  const buildSession = (conn, rows) => insertRows(conn, 'session', rows);
  const buildModelUsage = (conn, rows) => insertRows(conn, 'model_usage', rows);
  const buildToolUsage = (conn, rows) => insertRows(conn, 'tool_usage', rows);
  const buildTurnUsage = (conn, rows) => insertRows(conn, 'turn_usage', rows);
  const buildMessage = (conn, rows) => insertRows(conn, 'message', rows);
  const buildPart = (conn, rows) => insertRows(conn, 'part', rows);

  function createFixtureDb() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-fx-'));
    const dbPath = path.join(root, 'db.sqlite');
    const logDir = path.join(root, 'log');
    const rolloutDir = path.join(root, 'rollout');
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(rolloutDir, { recursive: true });
    const conn = new Database(dbPath);
    conn.exec(DDL);
    const fx = {
      root, dbPath, logDir, rolloutDir, conn,
      seed() {
        const now = Date.now();
        buildSession(conn, [
          { id: 's1', title: '主会话', task_type: 'interactive', directory: 'F:/demo',
            parent_id: null, project_id: 'p1', time_created: now - 3600e3, time_updated: now - 60e3 },
          { id: 's2', title: '子代理', task_type: 'subagent', directory: 'F:/demo',
            parent_id: 's1', project_id: 'p1', time_created: now - 1800e3, time_updated: now - 120e3 },
        ]);
        buildModelUsage(conn, [
          { id: 1, session_id: 's1', turn_id: 't1', trace_id: 'tr1', status: 'completed',
            started_at: now - 300e3, completed_at: now - 290e3, duration_ms: 10000,
            query_source: 'main_turn', model_id: 'glm-5', provider_id: 'zai',
            input_tokens: 1000, output_tokens: 200, reasoning_tokens: null,
            cache_read_input_tokens: 400, cache_creation_input_tokens: 100,
            tool_call_count: 2, computed_total_tokens: 1300 },
          { id: 2, session_id: 's2', turn_id: 't2', trace_id: 'tr1', status: 'completed',
            started_at: now - 200e3, completed_at: now - 190e3, duration_ms: 8000,
            query_source: 'subagent', model_id: 'glm-5', provider_id: 'zai',
            input_tokens: 500, output_tokens: 100, reasoning_tokens: 50,
            cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
            tool_call_count: 1, computed_total_tokens: 650 },
          { id: 3, session_id: 's1', turn_id: 't3', trace_id: 'tr2', status: 'error',
            started_at: now - 60e3, completed_at: now - 59e3, duration_ms: 1000,
            query_source: 'main_turn', model_id: 'glm-5', provider_id: 'zai',
            input_tokens: 10, output_tokens: 0, reasoning_tokens: null,
            cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
            tool_call_count: 0, computed_total_tokens: 10,
            error_type: 'api_error', error_code: '500', error_message: 'boom' },
        ]);
        buildToolUsage(conn, [
          { id: 1, session_id: 's1', turn_id: 't1', trace_id: 'tr1', tool_call_id: 'c1',
            tool_name: 'Bash', status: 'completed', started_at: now - 280e3,
            completed_at: now - 279e3, duration_ms: 900, side_effect_scope: 'workspace',
            read_only: 0, approval_status: 'none', exit_code: 0,
            output_bytes: 120, stderr_bytes: 0 },
          { id: 2, session_id: 's1', turn_id: 't3', trace_id: 'tr2', tool_call_id: 'c2',
            tool_name: 'Read', status: 'error', started_at: now - 55e3,
            completed_at: now - 54e3, duration_ms: 50, side_effect_scope: 'none',
            read_only: 1, approval_status: 'none', exit_code: 1,
            output_bytes: 0, stderr_bytes: 40,
            error_type: 'not_found', error_code: 'ENOENT', error_message: 'missing.txt' },
        ]);
        buildTurnUsage(conn, [
          { turn_id: 't1', session_id: 's1', status: 'completed', trace_id: 'tr1',
            user_message_id: 1, started_at: now - 300e3, first_token_at: now - 298e3,
            completed_at: now - 290e3, duration_ms: 10000, time_to_first_token_ms: 2000,
            model_request_count: 1, model_retry_count: 0, tool_call_count: 2,
            tool_error_count: 0, input_tokens: 1000, output_tokens: 200,
            reasoning_tokens: null, cache_read_input_tokens: 400,
            cache_creation_input_tokens: 100, computed_total_tokens: 1300,
            context_exceeded: 0 },
        ]);
        buildMessage(conn, [
          { id: 1, session_id: 's1', time_created: now - 300e3, sequence: 1,
            data: JSON.stringify({ role: 'user', tokens: 12 }) },
          { id: 2, session_id: 's1', time_created: now - 290e3, sequence: 2,
            data: JSON.stringify({ role: 'assistant', modelID: 'glm-5',
              time: { completed: now - 290e3 } }) },
        ]);
        buildPart(conn, [
          { id: 1, message_id: 2, sequence: 1, time_created: now - 295e3,
            data: JSON.stringify({ type: 'reasoning', text: '思考中' }) },
          { id: 2, message_id: 2, sequence: 2, time_created: now - 292e3,
            data: JSON.stringify({ type: 'text', text: '回答' }) },
        ]);
      },
      close() { conn.close(); },
      cleanup() {
        try { conn.close(); } catch { /* already closed */ }
        fs.rmSync(root, { recursive: true, force: true });
      },
    };
    return fx;
  }
  module.exports = { createFixtureDb, buildSession, buildModelUsage, buildToolUsage,
    buildTurnUsage, buildMessage, buildPart };
  ```

- [ ] **Step 5：写 `tests/helpers/fixture-jsonl.js`**

  ```js
  'use strict';
  // tmpdir JSONL fixture：zcode-YYYY-MM-DD.jsonl 命名（UTC 日，对齐 server/log-tail.js:12-15）。
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  function utcName(d = new Date()) {
    return `zcode-${d.toISOString().slice(0, 10)}.jsonl`;
  }
  function createLogFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-log-'));
    const p = name => path.join(root, name);
    return {
      root, utcName, path: p,
      write(name, lines) { fs.writeFileSync(p(name), lines.join('\n') + '\n'); },
      append(name, lines) { fs.appendFileSync(p(name), lines.join('\n') + '\n'); },
      cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
    };
  }
  module.exports = { createLogFixture, utcName };
  ```

- [ ] **Step 6：package.json 加 test script**

  把 `package.json` 的 scripts 块（`:8-11`）改为：

  ```json
  "scripts": {
    "start": "node server/index.js",
    "dev": "node --watch server/index.js",
    "test": "node --test tests/"
  },
  ```

- [ ] **Step 7：写 `tests/db-env.test.js`（A0-3）**

  ```js
  'use strict';
  const test = require('node:test');
  const assert = require('node:assert');
  const os = require('os');
  const path = require('path');
  const { createFixtureDb } = require('./helpers/fixture-db');

  test('A0-3: 注入后 DB_PATH/LOG_DIR/ROLLOUT_DIR 均在 tmpdir 下且不含 .zcode 段', () => {
    const fx = createFixtureDb();
    process.env.ZCODE_DB = fx.dbPath;
    process.env.ZCODE_LOG_DIR = fx.logDir;
    process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;
    const dbq = require('../server/db');
    try {
      const inTmp = p => {
        const rel = path.relative(os.tmpdir(), p);
        return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
      };
      for (const p of [dbq.DB_PATH, dbq.LOG_DIR, dbq.ROLLOUT_DIR]) {
        assert.ok(inTmp(p), `不在 tmpdir 下: ${p}`);
        assert.ok(!p.includes('.zcode'), `包含 .zcode 段: ${p}`);
      }
    } finally { fx.cleanup(); }
  });
  ```

- [ ] **Step 8：写 `tests/db-queries.test.js`（A0-4：23 个查询函数全跑通 + 抽查断言）**

  ```js
  'use strict';
  const test = require('node:test');
  const assert = require('node:assert');
  const { createFixtureDb } = require('./helpers/fixture-db');

  // 查询函数清单固定为 23 个（Spec A0-4，按 server/db.js:707-718 导出面点得）；
  // WP2 触碰导出面时同步修订本清单。
  const QUERIES = [
    ['overviewKpis', s => [s]], ['timeseries', () => [24]],
    ['breakdownByModel', s => [s]], ['breakdownByTool', s => [s]],
    ['overviewSpeed', s => [s]], ['recentSpeed', s => [s]],
    ['completedSince', s => [s]], ['todayUsage', () => []],
    ['sessionList', () => [{}]], ['sessionGet', () => ['s1']],
    ['sessionTurns', () => ['s1']], ['sessionConversation', () => ['s1']],
    ['sessionActivity', () => ['s1']], ['sessionChildren', () => ['s1']],
    ['sessionReasoning', () => ['s1']],
    ['errorsList', () => [{}]], ['errorSummary', s => [s]],
    ['slowTools', () => [{}]], ['recentModelRows', () => [0]],
    ['recentToolRows', () => [0]], ['latestModelStartedAt', () => []],
    ['latestToolStartedAt', () => []], ['agentsForest', () => [{}]],
  ];

  test('A0-4: 23 个查询函数在 fixture 上全部跑通且结构正确', () => {
    const fx = createFixtureDb();
    fx.seed();
    process.env.ZCODE_DB = fx.dbPath;
    process.env.ZCODE_LOG_DIR = fx.logDir;
    process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;
    const dbq = require('../server/db');
    try {
      const since = Date.now() - 3600e3;
      const out = {};
      for (const [name, argf] of QUERIES) {
        out[name] = dbq[name](...argf(since)); // 不抛错即过第一关
      }
      // 抽查断言集（Spec A0-4 固定四条）
      assert.equal(typeof out.overviewKpis.tokens.input, 'number');
      assert.ok(Array.isArray(out.timeseries));
      assert.ok(out.timeseries.length >= 1);
      for (const b of out.timeseries) {
        assert.ok('bucket' in b && 'calls' in b);
      }
      for (const row of out.sessionList) {
        assert.ok(row.total_tokens === null || typeof row.total_tokens === 'number');
      }
      assert.ok(Array.isArray(out.agentsForest.roots));
      assert.equal(out.agentsForest.total, 2); // s1 + s2
    } finally { fx.cleanup(); }
  });
  ```

- [ ] **Step 9：写 `tests/log-tail.test.js`（A0-5）**

  ```js
  'use strict';
  const test = require('node:test');
  const assert = require('node:assert');
  const { createLogFixture } = require('./helpers/fixture-jsonl');

  test('A0-5: listLogFiles/tailLog/parseLine/eventsForTrace 与 fixture 构造一致，坏行静默跳过', async () => {
    const fx = createLogFixture();
    process.env.ZCODE_LOG_DIR = fx.root; // db.js:19-20 先注入再 require
    const dbq = require('../server/db');
    const log = require('../server/log-tail');
    const today = fx.utcName();
    try {
      assert.equal(dbq.LOG_DIR, fx.root);
      fx.write(today, [
        JSON.stringify({ traceId: 'tr1', event: 'a', timestamp: '2026-09-22T00:00:01Z' }),
        'not-json-line', // 坏行
        JSON.stringify({ traceId: 'tr2', event: 'b', timestamp: '2026-09-22T00:00:02Z' }),
        JSON.stringify({ traceId: 'tr1', event: 'c', timestamp: '2026-09-22T00:00:03Z' }),
      ]);
      const files = log.listLogFiles();
      assert.equal(files.length, 1);
      assert.equal(files[0].name, today);
      const tail = await log.tailLog({ lines: 10 });
      assert.equal(tail.length, 3); // 坏行被静默跳过（parseLine 现行语义）
      assert.equal(log.parseLine('not-json-line'), null);
      assert.equal(log.parseLine('{"x":1}').x, 1);
      const evs = await log.eventsForTrace('tr1');
      assert.equal(evs.length, 2);
      assert.deepEqual(evs.map(e => e.event), ['a', 'c']); // 按 timestamp 升序
      assert.equal((await log.eventsForTrace('nope')).length, 0);
    } finally { fx.cleanup(); }
  });
  ```

- [ ] **Step 10：写 `tests/hygiene.test.js`（A0-6 / A0-7）**

  ```js
  'use strict';
  const test = require('node:test');
  const assert = require('node:assert');
  const fs = require('fs');
  const path = require('path');
  const { createFixtureDb } = require('./helpers/fixture-db');

  test('A0-6: dependencies 恰为 better-sqlite3 + express，零新增', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.deepEqual(Object.keys(pkg.dependencies), ['better-sqlite3', 'express']);
  });

  test('A0-7: fixture 目录在 cleanup 后不存在（tmpdir 清理守护）', () => {
    // 与 Spec A0-7 字面的已知差异：Spec 写"一次完整运行后守护全部已登记临时路径"，
    // node --test 每文件独立进程，跨文件集中断言不可行；本测试守护 cleanup 机制本身，
    // 各文件的泄漏面由其 try { } finally { fx.cleanup() } / fs.rmSync 模式 + A0-3 注入守护共同承担。
    const fx = createFixtureDb();
    const root = fx.root;
    assert.ok(fs.existsSync(root));
    fx.cleanup();
    assert.ok(!fs.existsSync(root));
  });
  ```

- [ ] **Step 11：跑 A0-1 与 A0-2**

  ```bash
  cd "F:/project/zcode-monitor-plan" && npm test
  ```
  期望：退出码 0、`# fail 0`、`# pass 5`（4 个文件 5 个用例：db-env 1 + db-queries 1 + log-tail 1 + hygiene 2）。
  ```bash
  cd "$TMP" && node --test "F:/project/zcode-monitor-plan/tests"
  ```
  期望：与 A0-1 一致全绿（证明测试与 fixture 构建器不依赖 cwd）。
  依赖零新增复核：`node -e "console.log(Object.keys(require('./package.json').dependencies))"`（在 worktree 根）。

- [ ] **Step 12：提交**

  ```bash
  git -C "F:/project/zcode-monitor-plan" add package.json tests/
  git -C "F:/project/zcode-monitor-plan" commit -m "test: WP0 测试基建——node --test 入口与 tmpdir fixture"
  ```

---

## T2：宠物包一键导入（WP1）——可与 T3 并行

**Files:**
- Create: `server/pet-import.js`（共享模块：校验 + 落位 + NOTICE + 发现逻辑 + 端点中间件）
- Create: `tools/import-pet.js`（CLI）
- Modify: `tools/webp-size.js:31-35`（CLI 加 `require.main` 守卫 + `module.exports`，判据 `:33` 与 CLI 输出格式**一字不改**）
- Modify: `server/index.js:261-284`（`/api/pets` 改调共享模块；新增 `POST /api/pets/import`）
- Modify: `public/pets-preview.html`（新增导入面板，样式内联在本页 `<style>`，**不动** `public/styles.css`）
- Modify: `.gitignore`（`public/pets/*` + 精选 10 包 `!` 白名单；Spec WP1 需求 5）
- Test: `tests/pet-import.test.js`

**Interfaces:**
- `server/pet-import.js` 导出（T2 各入口与测试共同依赖）：
  - `class PetImportError extends Error`，实例带 `code` 属性，取值：`PET_JSON_MISSING` / `PET_JSON_INVALID` / `SHEET_MISSING` / `SHEET_UNPARSEABLE` / `SHEET_WIDTH` / `SHEET_HEIGHT` / `SHEET_ROWS` / `ID_INVALID` / `SOURCE_MISSING`。
  - `importPetPack({ sourceDir, targetRoot, id, source, license })` → 同步，成功返回 `{ ok: true, id, name, dir, warnings: string[] }`，失败 throw `PetImportError`。原子性：先全量校验、再复制到 `targetRoot/.import-<id>-<pid>-<ts>` 临时目录、写 NOTICE、最后 `fs.renameSync` 落位；中途失败清理临时目录，目标根无残留。
  - `listPetPacks(root)` → `[{ id, name, sheet }]`（把 `server/index.js:262-284` 的扫描逻辑原样搬入，`order = ['yuexinmiao','maid-deepseek-whale']` 前置排序不变——A1-6 回归守护）。
  - `importEndpointMiddleware({ petsRoot })` → express handler，挂 `POST /api/pets/import`；非简单请求特征校验：缺首部 `X-Zcode-Monitor-Import: 1` 一律 403（A1-7，跨源简单 POST 无法携带自定义首部，且本服务不回 preflight）。
  - `buildNotice({ id, name, source, license })` → NOTICE.md 文本（三要素固定字面量）。
  - 常量 `SHEET_W = 1536`、`CELL_H = 208`、`MIN_ROWS = 9`（与 `tools/webp-size.js:33` 判据字面一致：宽 = 1536 = CELL_W 192 × COLS 8；高被 208 整除且行数 ≥ 9）。
- `tools/webp-size.js` 导出：`{ webpSize }`（新增；现有 CLI 循环包进 `if (require.main === module)`）。
- `server/index.js` 新增 `const PETS_ROOT = path.join(__dirname, '..', 'public', 'pets');` 并复用于 `/api/pets` 与导入端点（扫描根可注入，满足 A1-6 的 tmpdir 验证路径）。

**A1-2 五类错误 → 判据对照（错误文案必须各自指明原因，不共用一条）:**

| 错误码 | 触发 | 报错文案要点 |
|---|---|---|
| `PET_JSON_MISSING` | 来源目录无 `pet.json` | `缺少 pet.json` |
| `PET_JSON_INVALID` | BOM 之外的 JSON 语法错误 | `pet.json 解析失败` + 原始错误 |
| `SHEET_MISSING` | `spritesheetPath`（或 `spritesheet_path`）指向的文件不存在 | `spritesheet 不存在: <路径>` |
| `SHEET_UNPARSEABLE` | webp 魔数损坏（`webpSize` 返回 null） | `webp 无法解析（RIFF/WEBP 头缺失或损坏）` |
| `SHEET_WIDTH` | 宽 ≠ 1536 | `sheet 宽度 <实测>w ≠ 1536（CELL_W 192 × COLS 8）` |
| `SHEET_HEIGHT` | 高不能被 208 整除 | `sheet 高度 <实测> 不能被 208 整除（CELL_H）` |
| `SHEET_ROWS` | 行数 < 9 | `sheet 行数 <实测> < 9（ROW_ANIMS 契约）` |

- [ ] **Step 1：改 `tools/webp-size.js`（可 require、CLI 不变）**

  把 `:31-35` 的 CLI 循环改为：

  ```js
  if (require.main === module) {
    for (const f of process.argv.slice(2)) {
      const s = webpSize(fs.readFileSync(f));
      const ok = s && s.w === 1536 && s.h % 208 === 0 && s.h / 208 >= 9;
      console.log(`${f}: ${s ? s.w + 'x' + s.h + ' rows=' + (s.h / 208) : 'PARSE-FAIL'} ${ok ? 'OK' : 'NONSTANDARD'}`);
    }
  }
  module.exports = { webpSize };
  ```

  验证 CLI 未回归（A1-9 的改造前基线，本会话 2026-09-22 已实测同一文件输出如下，改造后应逐字一致）：
  ```bash
  cd "F:/project/zcode-monitor-plan" && node tools/webp-size.js public/pets/yuexinmiao/spritesheet.webp
  ```
  期望：`public/pets/yuexinmiao/spritesheet.webp: 1536x1872 rows=9 OK`。
  （对照样例：`node tools/webp-size.js public/pets/maid-deepseek-whale/spritesheet.webp` → `1536x2288 rows=11 OK`，印证行数判据为 ≥9。）

- [ ] **Step 2：写 `server/pet-import.js`**

  ```js
  'use strict';
  // pet-import.js — Codex 宠物包（pet.json + spritesheet.webp）导入共享模块。
  // CLI（tools/import-pet.js）与图鉴导入端点（POST /api/pets/import）复用同一模块。
  // 校验判据与 tools/webp-size.js:33 字面一致；像素级空行检测不在服务端范围
  // （仍由页面 scanRow 承担，public/pet.html:283-300），因此不引入图像解码依赖。
  const fs = require('fs');
  const path = require('path');
  const { webpSize } = require('../tools/webp-size');

  const SHEET_W = 1536; // CELL_W 192 × COLS 8（public/pet.html:184）
  const CELL_H = 208;
  const MIN_ROWS = 9;   // ROW_ANIMS 9 行契约（public/pet.html:186-187）
  const IMPORT_HEADER = 'x-zcode-monitor-import';

  class PetImportError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  function stripBom(s) { return s.replace(/^\uFEFF/, ''); }

  // 读取并解析 pet.json（容忍 UTF-8 BOM 与 snake_case，对齐 /api/pets 的容忍面）
  function readPetJson(sourceDir) {
    const p = path.join(sourceDir, 'pet.json');
    if (!fs.existsSync(p)) throw new PetImportError('PET_JSON_MISSING', `缺少 pet.json: ${p}`);
    let raw;
    try { raw = JSON.parse(stripBom(fs.readFileSync(p, 'utf8'))); }
    catch (e) { throw new PetImportError('PET_JSON_INVALID', `pet.json 解析失败: ${e.message}`); }
    return raw || {};
  }

  // 读取 sheet 尺寸并按布局契约校验（判据与 tools/webp-size.js:33 字面一致）
  function checkSheet(sourceDir, pet) {
    const rel = pet.spritesheetPath || pet.spritesheet_path || 'spritesheet.webp';
    const p = path.join(sourceDir, rel);
    if (!fs.existsSync(p)) throw new PetImportError('SHEET_MISSING', `spritesheet 不存在: ${p}`);
    let size;
    try { size = webpSize(fs.readFileSync(p)); }
    catch (e) { throw new PetImportError('SHEET_UNPARSEABLE', `webp 无法解析（读取失败）: ${e.message}`); }
    if (!size) throw new PetImportError('SHEET_UNPARSEABLE', 'webp 无法解析（RIFF/WEBP 头缺失或损坏）');
    if (size.w !== SHEET_W) throw new PetImportError('SHEET_WIDTH', `sheet 宽度 ${size.w} ≠ ${SHEET_W}（CELL_W 192 × COLS 8）`);
    if (size.h % CELL_H !== 0) throw new PetImportError('SHEET_HEIGHT', `sheet 高度 ${size.h} 不能被 ${CELL_H} 整除（CELL_H）`);
    const rows = size.h / CELL_H;
    if (rows < MIN_ROWS) throw new PetImportError('SHEET_ROWS', `sheet 行数 ${rows} < ${MIN_ROWS}（ROW_ANIMS 契约）`);
    return { sheetRel: rel, w: size.w, h: size.h, rows };
  }

  // NOTICE.md 三要素固定字面量（A1-4）：来源缺失记 <未提供>，许可证缺失记 unknown，
  // 非商用声明含「非商用」。来源包自带的 NOTICE.md 内容原样保留在分隔线之后。
  function buildNotice({ id, name, source, license, originalNotice }) {
    const lines = [
      `# ${name}（${id}）— NOTICE（zcode-monitor 导入生成）`, '',
      `- source: ${source || '<未提供>'}`,
      `- license: ${license || 'unknown'}`,
      '- 用途声明：非商用。素材归原权利人所有，仅限本地个人使用，不作为默认分发。', '',
    ];
    if (originalNotice) lines.push('---', '', '# 来源包自带 NOTICE（原样保留）', '', originalNotice);
    return lines.join('\n') + '\n';
  }

  function importPetPack({ sourceDir, targetRoot, id, source, license }) {
    if (!sourceDir || !fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      throw new PetImportError('SOURCE_MISSING', `来源目录不存在: ${sourceDir}`);
    }
    if (!id) id = path.basename(sourceDir);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)
        || path.resolve(targetRoot, id).indexOf(path.resolve(targetRoot) + path.sep) !== 0) {
      throw new PetImportError('ID_INVALID', `非法包 id: ${id}`);
    }
    const pet = readPetJson(sourceDir);
    const name = pet.displayName || pet.display_name || pet.name || id;
    const { sheetRel } = checkSheet(sourceDir, pet);

    fs.mkdirSync(targetRoot, { recursive: true });
    const tmpDir = path.join(targetRoot, `.import-${id}-${process.pid}-${Date.now()}`);
    try {
      fs.cpSync(sourceDir, tmpDir, { recursive: true });
      const originalNoticePath = path.join(tmpDir, 'NOTICE.md');
      const originalNotice = fs.existsSync(originalNoticePath)
        ? fs.readFileSync(originalNoticePath, 'utf8') : '';
      fs.writeFileSync(path.join(tmpDir, 'NOTICE.md'),
        buildNotice({ id, name, source, license, originalNotice }));
      // /api/pets 与页面按固定名 spritesheet.webp 发现/引用：来源里叫别的名字时补一份固定名
      if (path.posix.normalize(sheetRel.replace(/\\/g, '/')) !== 'spritesheet.webp') {
        fs.copyFileSync(path.join(tmpDir, sheetRel), path.join(tmpDir, 'spritesheet.webp'));
      }
      const finalDir = path.join(targetRoot, id);
      if (fs.existsSync(finalDir)) throw new PetImportError('ID_INVALID', `目标已存在同名包: ${finalDir}`);
      fs.renameSync(tmpDir, finalDir); // 同卷原子落位
      const warnings = [];
      if (!license) warnings.push('license_missing');
      if (!source) warnings.push('source_missing');
      return { ok: true, id, name, dir: finalDir, warnings };
    } catch (e) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
      throw e;
    }
  }

  // /api/pets 的发现逻辑（自 server/index.js:262-284 原样搬入；root 可注入）。
  // order 前置 + 首字符码兜底排序保持不变（A1-6 回归守护）。
  function listPetPacks(root) {
    const order = ['yuexinmiao', 'maid-deepseek-whale'];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory()
        && fs.existsSync(path.join(root, d.name, 'pet.json'))
        && fs.existsSync(path.join(root, d.name, 'spritesheet.webp')))
      .map(d => {
        try {
          const raw = fs.readFileSync(path.join(root, d.name, 'pet.json'), 'utf8').replace(/^\uFEFF/, '');
          const m = JSON.parse(raw);
          const name = m.displayName || m.display_name || m.name || d.name;
          return { id: d.name, name, sheet: '/pets/' + d.name + '/spritesheet.webp' };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (order.indexOf(a.id) + 1 || 90 + a.id.charCodeAt(0)) - (order.indexOf(b.id) + 1 || 90 + b.id.charCodeAt(0)));
  }

  // 导入端点中间件：滥用面对策是「非简单请求特征校验」（自定义首部），
  // 不依赖回环绑定假设（HOST 可被环境变量覆盖，server/index.js:21）。
  function importEndpointMiddleware({ petsRoot }) {
    return (req, res) => {
      if (req.get(IMPORT_HEADER) !== '1') {
        return res.status(403).json({ ok: false, error: 'forbidden',
          message: '缺少 X-Zcode-Monitor-Import 首部：该端点只接受本地图鉴页发起的请求。' });
      }
      const { sourceDir, id, source, license } = req.body || {};
      if (!sourceDir) return res.status(400).json({ ok: false, error: 'SOURCE_MISSING', message: '缺少 sourceDir' });
      try {
        res.json(importPetPack({ sourceDir, targetRoot: petsRoot, id, source, license }));
      } catch (e) {
        if (e instanceof PetImportError) {
          return res.status(400).json({ ok: false, error: e.code, message: e.message });
        }
        throw e;
      }
    };
  }

  module.exports = { PetImportError, importPetPack, listPetPacks, importEndpointMiddleware,
    buildNotice, SHEET_W, CELL_H, MIN_ROWS };
  ```

- [ ] **Step 3：写 `tools/import-pet.js`（CLI）**

  ```js
  #!/usr/bin/env node
  // import-pet.js <sourceDir> [--id <id>] [--source <url|text>] [--license <spdx|text>] [--root <targetRoot>]
  // 把一个 Codex 宠物包目录校验并导入 zcode-monitor。targetRoot 默认 <repo>/public/pets。
  'use strict';
  const path = require('path');
  const { importPetPack, PetImportError } = require('../server/pet-import');

  const args = process.argv.slice(2);
  const sourceDir = args.find(a => !a.startsWith('--'));
  const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };

  if (!sourceDir) {
    console.error('用法: node tools/import-pet.js <sourceDir> [--id <id>] [--source <s>] [--license <l>] [--root <dir>]');
    process.exit(1);
  }
  try {
    const r = importPetPack({
      sourceDir,
      targetRoot: opt('root') || path.join(__dirname, '..', 'public', 'pets'),
      id: opt('id'), source: opt('source'), license: opt('license'),
    });
    for (const w of r.warnings) {
      if (w === 'license_missing') console.warn('警告: 未提供许可证，NOTICE 记为 license: unknown（导入未阻断）');
      if (w === 'source_missing') console.warn('警告: 未提供来源，NOTICE 记为 source: <未提供>（导入未阻断）');
    }
    console.log(`导入成功: ${r.id} → ${r.dir}`);
  } catch (e) {
    if (e instanceof PetImportError) {
      console.error(`导入失败 [${e.code}]: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  ```

- [ ] **Step 4：改 `server/index.js`**

  - 顶部 require 区（`:9-18` 之后）加：
    ```js
    const petImport = require('./pet-import');
    const PETS_ROOT = path.join(__dirname, '..', 'public', 'pets');
    ```
  - 删除 `:261` 行的 `const fs = require('fs');`（该文件其余位置不使用 fs；`/api/pets` 内联扫描逻辑整体移入 `pet-import.listPetPacks`）。
  - `/api/pets`（`:262-284`）函数体替换为：
    ```js
    app.get('/api/pets', (_req, res) => {
      try { res.json(petImport.listPetPacks(PETS_ROOT)); }
      catch { res.json([]); }
    });
    // 导入端点：缺 X-Zcode-Monitor-Import 首部一律 403（跨源简单 POST 无法携带自定义首部）
    app.post('/api/pets/import', petImport.importEndpointMiddleware({ petsRoot: PETS_ROOT }));
    ```
  - 说明：`express.json()` 已在 `:25` 全局挂载，POST body 解析无需改动。

- [ ] **Step 5：改 `.gitignore`（单根白名单方案，Spec WP1 需求 5）**

  在 `.gitignore` 末尾（`:33` `.serena/` 之后）追加：

  ```gitignore

  # imported pet packs stay local-only (IP / 非默认分发主张, Spec WP1 需求5 / A1-5)；
  # 精选 10 包白名单（目录名以 2026-09-22 实测为准，worktree 与主仓库双仓核对均为 xilian）
  public/pets/*
  !public/pets/chiikawa/
  !public/pets/firefly/
  !public/pets/guga/
  !public/pets/hutao/
  !public/pets/maid-deepseek-whale/
  !public/pets/miku/
  !public/pets/nezukocoder/
  !public/pets/pikachu-local/
  !public/pets/xilian/
  !public/pets/yuexinmiao/
  ```

  验证：`git -C "F:/project/zcode-monitor-plan" status --porcelain` 无新增待提交项（精选 10 包保持已跟踪状态，gitignore 只影响未跟踪文件）。

- [ ] **Step 6：`public/pets-preview.html` 加导入面板**

  在 `<body>` 内 `<h1>` 之前插入（样式用本页既有内联 `<style>` 追加，不动 `public/styles.css`）：

  ```html
  <style> /* 追加到既有 style 末尾 */
    .import-panel { background:#242424; border:1px solid #3a3a3a; border-radius:10px;
      padding:12px; margin-bottom:18px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
    .import-panel input { background:#1b1b1b; border:1px solid #3a3a3a; color:#f2f2f2;
      border-radius:6px; padding:6px 8px; font-size:12px; }
    .import-panel button { background:#3b63fb; color:#fff; border:0; border-radius:6px;
      padding:6px 14px; font-size:12px; cursor:pointer; }
    #import-out { width:100%; font-size:12px; color:#afafaf; white-space:pre-wrap; margin:0; }
  </style>
  <section class="import-panel">
    <strong style="font-size:13px">导入 Codex 宠物包</strong>
    <input id="import-src" size="44" placeholder="本机包目录绝对路径，如 D:/pets/my-pack">
    <input id="import-id" size="14" placeholder="包 id（可选）">
    <input id="import-source" size="20" placeholder="来源（可选）">
    <input id="import-license" size="14" placeholder="许可证（可选）">
    <button id="import-btn">导入</button>
    <pre id="import-out"></pre>
  </section>
  ```

  在页面末尾既有 `<script>` 之后追加：

  ```html
  <script>
  'use strict';
  // 导入面板 → POST /api/pets/import（同源 + 自定义首部；缺首部服务端 403）
  document.getElementById('import-btn').addEventListener('click', async () => {
    const out = document.getElementById('import-out');
    const body = {
      sourceDir: document.getElementById('import-src').value.trim(),
      id: document.getElementById('import-id').value.trim() || undefined,
      source: document.getElementById('import-source').value.trim() || undefined,
      license: document.getElementById('import-license').value.trim() || undefined,
    };
    try {
      const r = await fetch('/api/pets/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zcode-Monitor-Import': '1' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      out.textContent = (r.ok && j.ok)
        ? `导入成功: ${j.id} → ${j.dir}` + (j.warnings.length ? `（警告: ${j.warnings.join(', ')}）` : '')
        : `失败 [${j.error}]: ${j.message}`;
    } catch (e) { out.textContent = '请求失败: ' + e.message; }
  });
  </script>
  ```

- [ ] **Step 7：写 `tests/pet-import.test.js`（A1-1 / A1-2 / A1-3 / A1-4 / A1-6 / A1-7 + 路径穿越守护）**

  ```js
  'use strict';
  const test = require('node:test');
  const assert = require('node:assert');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileP = promisify(execFile);
  const { vp8xSheet } = require('./helpers/webp-fixture');
  const { importPetPack, listPetPacks, PetImportError } = require('../server/pet-import');

  const REPO = path.join(__dirname, '..');

  // 组一个来源包目录：pet.json + spritesheet.webp（30 字节头，仅尺寸有效）
  function makePack(parent, { petJson = {}, webp } = {}) {
    const dir = fs.mkdtempSync(path.join(parent, 'pack-'));
    if (petJson !== null) {
      fs.writeFileSync(path.join(dir, 'pet.json'),
        JSON.stringify(Object.assign({ displayName: '测试包' }, petJson)));
    }
    if (webp) fs.writeFileSync(path.join(dir, 'spritesheet.webp'), webp);
    return dir;
  }

  test('A1-1: 合法包导入成功，三件套落位，webp-size 判 OK', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-imp-'));
    try {
      const src = makePack(root, { webp: vp8xSheet(1536, 1872) });
      const targetRoot = path.join(root, 'pets');
      const r = importPetPack({ sourceDir: src, targetRoot });
      assert.equal(r.ok, true);
      assert.ok(fs.existsSync(path.join(r.dir, 'pet.json')));
      assert.ok(fs.existsSync(path.join(r.dir, 'spritesheet.webp')));
      assert.ok(fs.existsSync(path.join(r.dir, 'NOTICE.md')));
      const cli = await execFileP(process.execPath,
        [path.join(REPO, 'tools', 'webp-size.js'), path.join(r.dir, 'spritesheet.webp')]);
      assert.ok(cli.stdout.includes('OK'));
      assert.ok(!fs.readdirSync(targetRoot).some(n => n.startsWith('.import-'))); // 无临时残留
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('A1-2: 五类错误各自报因，且目标根零残留（参数化子测试）', async t => {
    const CASES = [
      ['缺 pet.json', { petJson: null, webp: vp8xSheet(1536, 1872) }, 'PET_JSON_MISSING', '缺少 pet.json'],
      ['webp 损坏', { webp: Buffer.from('NOTWEBPNOTWEBPNOTWEBPNOTWEBP') }, 'SHEET_UNPARSEABLE', '无法解析'],
      ['宽不符', { webp: vp8xSheet(1024, 1872) }, 'SHEET_WIDTH', '宽度 1024'],
      ['高不符', { webp: vp8xSheet(1536, 1800) }, 'SHEET_HEIGHT', '不能被 208 整除'],
      ['行数不足', { webp: vp8xSheet(1536, 1664) }, 'SHEET_ROWS', '行数 8'],
    ];
    for (const [label, spec, code, frag] of CASES) {
      await t.test(`A1-2: ${label}`, () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-err-'));
        try {
          const src = makePack(root, spec);
          const targetRoot = path.join(root, 'pets');
          fs.mkdirSync(targetRoot);
          const before = fs.readdirSync(targetRoot).length;
          assert.throws(() => importPetPack({ sourceDir: src, targetRoot }),
            e => e instanceof PetImportError && e.code === code && e.message.includes(frag));
          assert.equal(fs.readdirSync(targetRoot).length, before); // 原子性：无新增目录
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
      });
    }
  });

  test('A1-3: BOM + snake_case 的 pet.json 导入成功且显示名正确', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-bom-'));
    try {
      const src = makePack(root, { webp: vp8xSheet(1536, 1872) });
      fs.writeFileSync(path.join(src, 'pet.json'),
        '\uFEFF{"display_name":"测试喵","spritesheet_path":"spritesheet.webp"}');
      const r = importPetPack({ sourceDir: src, targetRoot: path.join(root, 'pets') });
      assert.equal(r.ok, true);
      assert.equal(r.name, '测试喵');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('A1-4: 无来源无许可证时 NOTICE 三要素齐备且带警告', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-not-'));
    try {
      const src = makePack(root, { webp: vp8xSheet(1536, 1872) });
      const r = importPetPack({ sourceDir: src, targetRoot: path.join(root, 'pets') });
      const notice = fs.readFileSync(path.join(r.dir, 'NOTICE.md'), 'utf8');
      assert.ok(notice.indexOf('source: <未提供>') !== -1);
      assert.ok(notice.indexOf('license: unknown') !== -1);
      assert.ok(notice.indexOf('非商用') !== -1);
      assert.ok(r.warnings.includes('license_missing'));
      assert.equal(r.ok, true); // 成功但带警告，导入不阻断
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('A1-6: 现仓库 10 包发现结果与排序不变（回归守护）', () => {
    const packs = listPetPacks(path.join(REPO, 'public', 'pets'));
    assert.equal(packs.length, 10);
    assert.equal(packs[0].id, 'yuexinmiao');
    assert.equal(packs[1].id, 'maid-deepseek-whale');
  });

  test('A1-7: 导入端点缺自定义首部 403，带首部放行（express + fetch，无新依赖）', async () => {
    const express = require('express');
    const { importEndpointMiddleware } = require('../server/pet-import');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-end-'));
    try {
      const src = makePack(root, { webp: vp8xSheet(1536, 1872) });
      const petsRoot = path.join(root, 'pets');
      const app = express();
      app.use(express.json());
      app.post('/api/pets/import', importEndpointMiddleware({ petsRoot }));
      const server = app.listen(0, '127.0.0.1');
      await new Promise(r => server.on('listening', r));
      const base = `http://127.0.0.1:${server.address().port}`;
      try {
        const noHeader = await fetch(`${base}/api/pets/import`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceDir: src }),
        });
        assert.equal(noHeader.status, 403);
        const withHeader = await fetch(`${base}/api/pets/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Zcode-Monitor-Import': '1' },
          body: JSON.stringify({ sourceDir: src }),
        });
        assert.equal(withHeader.status, 200);
        assert.equal((await withHeader.json()).ok, true);
      } finally { server.close(); }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('安全: 非法包 id（路径穿越形态）被拒', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-id-'));
    try {
      const src = makePack(root, { webp: vp8xSheet(1536, 1872) });
      assert.throws(() => importPetPack({ sourceDir: src, targetRoot: root, id: '../evil' }),
        e => e instanceof PetImportError && e.code === 'ID_INVALID');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  ```

- [ ] **Step 8：跑门禁（npm test 全绿 + 服务冒烟 + 依赖检查），然后分三次提交**

  ```bash
  cd "F:/project/zcode-monitor-plan" && npm test
  git -C "F:/project/zcode-monitor-plan" add tools/webp-size.js server/pet-import.js tools/import-pet.js
  git -C "F:/project/zcode-monitor-plan" commit -m "feat: WP1 宠物包校验导入——共享模块+CLI"
  git -C "F:/project/zcode-monitor-plan" add server/index.js public/pets-preview.html .gitignore
  git -C "F:/project/zcode-monitor-plan" commit -m "feat: WP1 导入端点与图鉴入口+gitignore 白名单"
  git -C "F:/project/zcode-monitor-plan" add tests/pet-import.test.js
  git -C "F:/project/zcode-monitor-plan" commit -m "test: WP1 导入模块测试"
  ```

- [ ] **Step 9：A1-5（命令验收，真实导入到默认根）**

  staging 仅存在于主仓库（本会话实测：`F:/project/zcode-monitor/tools/pets-staging` 存在、含 14 个包目录、8 个含 pet.json；worktree 下无此目录，`ls` 报 os error 2）。staging 内容随时间变化，不硬编码包名，执行时任选一个含 `pet.json` 的包目录：
  ```bash
  node "F:/project/zcode-monitor-plan/tools/import-pet.js" "F:/project/zcode-monitor/tools/pets-staging/<任一含 pet.json 的包目录>" --id local-import-check
  git -C "F:/project/zcode-monitor-plan" status --porcelain    # 期望：无任何新增待提交项
  git -C "F:/project/zcode-monitor-plan" check-ignore -v public/pets/local-import-check/pet.json
  ```
  期望：`check-ignore` 命中（`.gitignore:<行>:public/pets/*	public/pets/local-import-check/pet.json`）。staging 不可达或为空时，改用任一本地 Codex 包目录（如 `public/pets/yuexinmiao` 复制成临时目录后作为来源），照录所用命令。导入产物 `public/pets/local-import-check/` 是 gitignored 本地文件，保留或自行清理均可。

- [ ] **Step 10：A1-8（评审验收，端到端）**

  启动服务（真实库只读，`npm start` 即可），用图鉴导入面板或 CLI 导入一个真实包 → 打开 `/pet` 与 `/pets-preview`：图鉴可见该包、双击轮换能到达该包、预览正常。评审记录（含截图）落 `docs/acceptance/T2-import-e2e.md`（截图不入库，只记路径与结论）。

---

## T3：隐私提示（WP5）——可与 T2 并行

**Files:**
- Modify: `README.md`（新增「隐私提示」章节，置于「故障排查」之前）
- Modify: `public/index.html:45-46`（`</header>` 与 `<main id="root">` 之间插入提示条）
- Modify: `public/styles.css`（追加 `.privacy-notice` 样式）

**Interfaces:** 无（纯文案与静态展示；不改 `app.js`/views，无 JS 行为变更）。

**文案三要素（缺一不可）+ 负面清单：** (1) 明示「第三方报告，未经我们验证」；(2) Windows 可执行的 checkpoints 自查方法；(3) 不下断言、不制造恐慌。禁用断言式表述（如「ZCode 上传了你的代码」）。依据均为第三方报告（HN 讨论串、知乎文章、开源中国报道、zcode-speed-panel 的「快照防护」），未经我们验证。

- [ ] **Step 1：`public/index.html` 插入提示条**

  在 `:45`（`</header>`）与 `:46`（`<main id="root"></main>`）之间插入：

  ```html
  <div class="privacy-notice">
    <span class="privacy-notice-tag">隐私提示</span>
    有第三方报告称 ZCode 可能会在后台上传工作区快照（涉及 <code>~/.zcode/v2/checkpoints/</code>）。
    该说法<strong>未经我们验证</strong>，本工具与之无关、对 <code>~/.zcode/</code> 全程只读。
    自查（只读列目录，PowerShell）：<code>Get-ChildItem "$env:USERPROFILE\.zcode\v2\checkpoints"</code>
  </div>
  ```

- [ ] **Step 2：`public/styles.css` 追加样式**

  在文件末尾追加（EOF；现文件 478 行，末条规则为 `:478` `.kv .v`——`.toast` 在 `:469`，其后尚有 `.scroll`/`.row-flash`/`@keyframes flash`/`.kv` 共 9 行）：

  ```css

  /* ── privacy notice bar (WP5 快照上传第三方报告提示) ── */
  .privacy-notice { margin: 10px 14px 0; padding: 8px 12px; border-radius: var(--radius);
    border: 1px solid color-mix(in srgb, var(--sev-warn) 35%, transparent);
    background: color-mix(in srgb, var(--sev-warn) 8%, transparent);
    font-size: 12.5px; color: var(--fg-2); line-height: 1.7; }
  .privacy-notice code { font-family: var(--font-mono); font-size: 12px; color: var(--sev-warn); }
  .privacy-notice-tag { font-weight: 700; color: var(--sev-warn); margin-right: 6px; }
  ```

- [ ] **Step 3：`README.md` 加章节**

  在 `## 故障排查`（`:135`）之前插入：

  ```markdown
  ## 隐私提示

  有第三方报告称 ZCode 可能会在后台上传工作区快照（涉及 `~/.zcode/v2/checkpoints/` 目录）。
  **该说法为第三方报告，未经我们验证**，本项目不下断言，也不复现该行为。如需自查，可在
  Windows 上以只读方式列出该目录（只列目录，不做任何改动）：

  - PowerShell：`Get-ChildItem "$env:USERPROFILE\.zcode\v2\checkpoints"`
  - Git Bash：`ls ~/.zcode/v2/checkpoints`

  本工具（zcode-monitor）对 `~/.zcode/` 全程只读，不会写入或改动任何 ZCode 数据。
  ```

- [ ] **Step 4：跑 A5-3 三条固定 grep（关键词不得替换或自选）**

  ```bash
  cd "F:/project/zcode-monitor-plan"
  grep -n "第三方报告" public/index.html README.md
  grep -in "checkpoints" public/index.html README.md
  grep -n "未经我们验证" public/index.html README.md
  ```
  期望：三条命令对**两个文件**均命中（每个文件至少一行）。再跑 A5-2：
  ```bash
  ls ~/.zcode/v2/checkpoints
  ```
  期望：命令可执行（存在则列出条目、不存在则报 No such file——两种输出形态都与文案「自查该目录」语义一致）；**目录内容不要抄入仓库文档**。

- [ ] **Step 5：A5-1 评审留痕 + 提交**

  对照负面清单逐句自查两处文案（无断言式表述、无恐慌措辞），结论记入 commit 说明。然后：
  ```bash
  git -C "F:/project/zcode-monitor-plan" add README.md public/index.html public/styles.css
  git -C "F:/project/zcode-monitor-plan" commit -m "docs: WP5 隐私提示——仪表盘与 README 快照上传第三方报告警示"
  ```

---

## T4：token 口径对齐与对账（WP2）

**Files:**
- Modify: `server/db.js`（用量查询口径修正 + 每条被触碰查询补官方源码出处注释）
- Create: `docs/caliber/token-caliber-v1.md`（口径文档）
- Create: `docs/acceptance/T4-caliber-reconciliation.md`、`docs/acceptance/T4-explain-timing.md`、`docs/acceptance/T4-before-after.md`（验收证据）
- Modify: `public/views/overview.js`（用量数字旁标注口径来源）
- Modify: `public/styles.css`（`.caliber` 徽章样式；T4 在 T3 之后执行，无并行冲突）
- Test: `tests/db-caliber.test.js`（A2-1）

**Interfaces:**
- T1 的 fixture 构建器按表分组，本任务只需增补 `tests/db-caliber.test.js` 内的口径边界行（不改动 `fixture-db.js` 的既有导出签名）。
- 本任务设有**核实门（Step 1→2）**：Step 1 的核实结论决定 Step 2 各修正点的取值分支。两个分支的代码都已完整给出，执行者按口径文档结论「择一保留」，这是机械选择而非设计决策。**缺省规则**：核实门无结论（克隆失败、上游材料不全、两点均「未核实到」）时，一律**缺省走分支 A**（维持现状 SQL 只补注释 + overviewKpis 增 total 字段，取 `SUM(computed_total_tokens)`——列存在性是本地 schema 事实，不依赖上游核实；分支 B 的去重/公式改写一律不做），Step 3 保留分支 A 断言行、删除分支 B 断言行，口径文档如实记录「未核实到 + 按保守缺省落地」的理由。若核实发现与本计划假设冲突（如 `computed_total_tokens` 语义与两分支都不符），如实把结论写入口径文档并按文档调整断言，**不伪造结论**（诚实条款）。

**触碰面与性能预判（本会话只读实测真实库 sqlite_master 所得的索引事实）：**
`model_usage` 有 `started_at`/`session_turn`/`query_source`/`trace` 索引；`tool_usage` 有 `started_tool`/`session_tool_call`/`session_turn` 索引；`turn_usage` 有 `started_idx`；`session` 只有 parent/project/task_type/trace/workspace 索引、**无时间列索引**；`permission` 表当前 0 行。因此：凡 `model_usage`/`tool_usage`/`turn_usage` 上带 `started_at >=` 下界的查询可预期 `SEARCH`；`sessionList`/`agentsForest` 的根扫描受 Spec A2-3 出路条款管辖（见 Step 5）。

- [ ] **Step 1：核实官方 schema（对账与修正的前置）**

  ```bash
  rm -rf "$TMP/ZCode-src" 2>/dev/null; git clone --depth 1 https://github.com/zai-org/ZCode "$TMP/ZCode-src"
  grep -rn "computed_total_tokens" "$TMP/ZCode-src" --include='*.ts' --include='*.go' --include='*.rs' --include='*.sql' -l
  grep -rn "CREATE TABLE\|input_tokens\|cache_creation_input_tokens\|parent_id\|approval_status" "$TMP/ZCode-src" -r --include='*.sql' | head -50
  ```
  （`rm -rf` 只针对 `$TMP/ZCode-src` 这个本次克隆的临时目录，且位于任务临时区；如删除受限则跳过清理，不阻塞。）核实重点（Spec WP2 需求 1）：
  1. `db.sqlite` schema 的权威出处（文件/函数级）；
  2. `computed_total_tokens` 是官方预计算权威值还是派生列；与官方总量公式 `input + output + reasoning + cache_creation`（cache_read 单列、input 已含 cache-read）的关系；
  3. `turn_usage` 是否漏标题生成等 side call；
  4. 子代理按 `parent_id` 归组的官方语义。
  产出：`docs/caliber/token-caliber-v1.md`，固定结构：每条结论一段——【结论】+【官方源码出处（文件/函数）】+【对 db.js 的影响】+【fixture 断言取值】。**若上游仓库刚开源、材料不全，如实记录「未核实到」**（R2）。

- [ ] **Step 2：按口径文档修正 `server/db.js`**

  对每条被触碰查询，在 SQL 注释处补 `// schema source: zai-org/ZCode <file> <symbol>`（A2-5）。确定性改动（两分支共用）：

  - `overviewKpis`（`server/db.js:159-218`）：返回值 `tokens` 增加 `input_ex_cache`（展示拆分：input 已含 cache-read，拆出去重展示）：
    ```js
    // tokens 对象（:208-215）内追加一行：
    input_ex_cache: Math.max(0, (m.in_tok || 0) - (m.cache_read || 0)),
    ```
  - `errorsList`/`errorSummary`/`recentSpeed`/`completedSince`/`todayUsage`/`timeseries`/`breakdownByModel`/`overviewSpeed`/`recentToolRows`/`recentModelRows`：按口径文档补出处注释；SQL 本体仅在文档结论要求时才改。

  分支改动（按口径文档结论择一保留，另一分支删除）：

  - **总量公式**（若结论为「`computed_total_tokens` 不可直接取用 / 语义不符」→ 分支 B；否则分支 A）：
    ```js
    // 分支 A（官方预计算权威）：三处同口径子查询全部保持原样、补注释即可——
    //   sessionList(:430)、sessionChildren(:554) 与 agentsForest(:684) 的
    //   SUM(m.computed_total_tokens)。同时 overviewKpis 的 tokens 增加 total 字段
    //   （A2-1 断言依赖）：主查询（db.js:160-173，带 started_at 下界）SELECT 加
    //   SUM(computed_total_tokens) AS total_tok，tokens 对象（:208-215）加
    //   total: m.total_tok || 0。
    // 分支 B（自行计算）：上述三处（:430/:554/:684，含 sessionChildren——漏改会使
    //   会话子树与主列表口径不一致）全部改为
    //   (SELECT SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)
    //     +COALESCE(reasoning_tokens,0)+COALESCE(cache_creation_input_tokens,0))
    //    FROM model_usage m WHERE m.session_id = …) AS total_tokens
    // 同时 overviewKpis 的 tokens 增加 total 字段（同公式聚合）。
    ```
  - **`parent_id` 归组去重**（若核实结论为主会话与子代理行重复计入 → 分支 B；否则分支 A）：
    ```js
    // 分支 A（官方口径即全量行、无重复计入）：不改 SQL，口径文档记录即可。
    // 分支 B（需去重）：overviewKpis 的 model_usage 聚合补
    //   AND (query_source IS NULL OR query_source != 'subagent')
    //   或等价的 parent 维度过滤（以文档结论为准），并在返回值加
    //   subagent_tokens 单列保留可见性。
    ```
  - **`turn_usage` side call 缺口**：纯标注，不改数字——`sessionTurns`（`:443-462`）注释补 `// turn_usage 不含标题生成等 side call，总量为下界（出处见口径文档 §x）`，前端 Turns 表头加同义提示。

  前端标注（A2-4）：`public/views/overview.js:105-107`（输入 token 卡的 `.delta` 行）与 `:283`（速度表 footer 的总 token span：`<span><span class="lbl">总 token</span> <b>…</b></span>`，非 `.delta` 结构）追加口径徽章：
  ```js
  // overview.js renderKpis 内，输入 token 卡的 delta 行改为（徽章文案为固定二选一，
  // 按口径文档对该数字的映射填写，不做运行时条件）：
  <div class="delta">缓存命中 ${cacheRate}% · 写入 ${fmtNum(k.tokens.cache_write)}
    <span class="caliber">官方口径</span></div>
  ```
  `public/styles.css` 追加：
  ```css
  .caliber { font-size: 11px; padding: 1px 6px; margin-left: 6px; border-radius: 999px;
    border: 1px solid var(--border); color: var(--fg-3); }
  ```
  徽章取值规则（机械）：该数字直接来自官方预计算列 → 写 `官方口径`；由我们公式合成 → 写 `本地估算`；以口径文档逐条映射为准，映射表抄入 `docs/acceptance/T4-before-after.md`（A2-4 评审对象）。

- [ ] **Step 3：写 `tests/db-caliber.test.js`（A2-1，fixture 断言固化口径文档）**

  ```js
  'use strict';
  const test = require('node:test');
  const assert = require('node:assert');
  const { createFixtureDb, buildSession, buildModelUsage } = require('./helpers/fixture-db');

  test('A2-1: 口径边界行（cache 并存 / reasoning NULL / parent_id 组 / side call 标注）', () => {
    const fx = createFixtureDb();
    buildSession(fx.conn, [
      { id: 'p1', title: '主', task_type: 'interactive', parent_id: null, project_id: 'pp',
        time_created: 1, time_updated: 2 },
      { id: 'c1', title: '子', task_type: 'subagent', parent_id: 'p1', project_id: 'pp',
        time_created: 1, time_updated: 2 },
    ]);
    buildModelUsage(fx.conn, [
      // 边界1：cache_read 与 cache_creation 并存；reasoning 为 NULL（COALESCE 路径）；
      // computed_total_tokens 故意 ≠ 公式和（1400 vs 1300），模拟官方预计算含 side call 的
      // 可能差异——保证分支 A / 分支 B 的期望值可区分。
      { id: 1, session_id: 'p1', status: 'completed', started_at: Date.now() - 60e3,
        duration_ms: 1000, query_source: 'main_turn', input_tokens: 1000,
        output_tokens: 200, reasoning_tokens: null, cache_read_input_tokens: 400,
        cache_creation_input_tokens: 100, computed_total_tokens: 1400 },
      // 边界2：子代理组（parent_id 归组语义的 fixture 面）
      { id: 2, session_id: 'c1', status: 'completed', started_at: Date.now() - 50e3,
        duration_ms: 1000, query_source: 'subagent', input_tokens: 500,
        output_tokens: 100, reasoning_tokens: 50, cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0, computed_total_tokens: 650 },
      // 边界3：NULL token 列全空（SUM 稳健性）
      { id: 3, session_id: 'p1', status: 'error', started_at: Date.now() - 40e3,
        duration_ms: null, query_source: 'main_turn' },
    ]);
    process.env.ZCODE_DB = fx.dbPath;
    process.env.ZCODE_LOG_DIR = fx.logDir;
    process.env.ZCODE_ROLLOUT_DIR = fx.rolloutDir;
    const dbq = require('../server/db');
    try {
      const k = dbq.overviewKpis(Date.now() - 3600e3);
      // 两分支无关断言（无论核实结论如何都成立）：
      assert.equal(k.tokens.input, 1500);          // 1000+500（input 列原样含 cache-read）
      assert.equal(k.tokens.input_ex_cache, 1100); // 1500 − 400（展示拆分，去重）
      assert.equal(k.tokens.cache_read, 400);
      assert.equal(k.tokens.cache_write, 100);
      // ——总量断言按 docs/caliber/token-caliber-v1.md 的结论择一保留，删除另一行——
      assert.equal(k.tokens.total, 2050); // 分支 A：官方预计算权威（1400+650，含 side call 差异）
      // assert.equal(k.tokens.total, 1950); // 分支 B：自行计算公式（1000+200+0+100 + 500+100+50+0）
      // ——parent_id 归组断言按口径文档结论择一保留，删除另一组——
      assert.equal(k.model.calls, 3);       // 分支 A：官方口径全量计入、无重复计入
      // assert.equal(k.model.calls, 2);    // 分支 B：主口径排除子代理行
      // assert.equal(k.subagent_tokens, 600); // 分支 B 携带：子代理 token 单列保留可见性
      // side call 标注为注释级交付（无数字变化），fixture 断言不涉及——相对 Spec A2-1
      // 字面（"turn_usage 缺 side call 的场景"入 fixture）是显式缩减，理由（纯标注无
      // 数值差可断言）在 docs/caliber/token-caliber-v1.md 的【fixture 断言取值】段留痕。
    } finally { fx.cleanup(); }
  });
  ```
  注意：分支断言行以成对注释形式给出两套完整取值（数值已按 fixture 可区分地算好），实施时**保留与口径文档一致的那行、删除另一行并去注释**。文档未定论的字段不写断言（诚实条款）。

- [ ] **Step 4：A2-2 对账（真实库只读，复合验收）**

  1. 选最近一个**完整 UTC 日**（记下 `[T0, T1)`）。
  2. 我方口径（真实库只读，带 started_at 下界）：
     ```bash
     node -e "
     const dbq = require('./server/db');
     const t0 = Date.parse('<T0 ISO>'); const t1 = Date.parse('<T1 ISO>');
     const r = dbq.db().prepare('SELECT SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)' +
       '+COALESCE(reasoning_tokens,0)+COALESCE(cache_creation_input_tokens,0)) AS total,' +
       ' SUM(input_tokens) AS input_sum FROM model_usage WHERE started_at >= ' + t0 +
       ' AND started_at < ' + t1).get();
     console.log(JSON.stringify(r));"
     ```
  3. 对账基准按以下**显式降级链**依次尝试，命中即停（ccusage 主线「已支持 ZCode 数据源」系上游调研结论、本会话 web 检索未能在主线证实，仅见 fork——故主线失败时下一级是 fork 而非跳过）：
     1. ccusage 主线（调用命令以其当时文档为准、不预设 flag、如实照录）；
     2. better-ccusage 社区 fork（cobra91/better-ccusage，若检索证实其支持 ZCode 数据源）；
     3. zcode-token-usage-statusbar 的 JSON CLI；
     4. 纯 SQL 交叉核对（对同一窗口用第二条独立构造的 SQL 口径互查，如按 session 聚合 vs 按 turn 聚合）。
     **基准替换本身记入对账记录。**
  4. 产出 `docs/acceptance/T4-caliber-reconciliation.md`：双方命令与原始输出、逐项差异、每条差异的原因分类与出处。**通过判据 = 全部差异均「已解释」（每条附官方源码/数据样本出处）；差异可以存在，未解释差异不行。**

- [ ] **Step 5：A2-3 红线实测（真实库只读，EXPLAIN + 计时）**

  对 Step 2 实际修改过 SQL 的每条查询（SQL 以执行时 db.js 现文为准复制进模板）：
  ```bash
  node -e "
  const dbq = require('./server/db');
  const since = Date.now() - 86400000;
  const sql = '<该查询的 SQL，参数内联为字面量 since=' + '>';  // 见模板示例
  console.log(JSON.stringify(dbq.db().prepare('EXPLAIN QUERY PLAN ' + sql).all(), null, 1));
  console.time('q'); dbq.db().prepare(sql).get(); console.timeEnd('q');"
  ```
  模板示例（`overviewKpis` 的 model_usage 聚合段）：
  ```bash
  node -e "
  const dbq = require('./server/db');
  const since = Date.now() - 86400000;
  const sql = 'SELECT COUNT(*) AS n, SUM(input_tokens) AS s FROM model_usage WHERE started_at >= ' + since;
  console.log(JSON.stringify(dbq.db().prepare('EXPLAIN QUERY PLAN ' + sql).all()));
  console.time('q'); dbq.db().prepare(sql).get(); console.timeEnd('q');"
  ```
  通过判据：`EXPLAIN` 输出无 `SCAN <table>`（须 `SEARCH ... USING INDEX` 或 rowid 尾界）；计时照录 `docs/acceptance/T4-explain-timing.md`。
  **出路条款**（Spec A2-3）：`sessionList`（`:417-436`）与 `agentsForest`（`:678-705`）根扫描 `session` 表、只读约束下无法新建时间索引——若口径结论要求触碰它们，二选一并留痕：
  - (a) **默认**：不触碰这两条 SQL 的扫描面，`computed_total_tokens` 口径影响只写入口径文档；
  - (b) 改造前先取基线（`git stash` 或在改动 commit 之前）：
    ```bash
    node -e "const dbq=require('./server/db');console.time('sl');dbq.sessionList({limit:100});console.timeEnd('sl')"
    node -e "const dbq=require('./server/db');console.time('af');dbq.agentsForest({});console.timeEnd('af')"
    ```
    改造后同法计时，**不劣于基线 +10%** 方可收口，两个数字与理由记入验收记录。
  时序纪律：本任务**禁止**新增任何无 `started_at` 下界或无 rowid 尾界的新查询。

- [ ] **Step 6：新旧值对照表（Spec WP2 需求 3）**

  同一时段（复用 Step 4 的 `[T0, T1)`）修正前后两套查询输出对照，真实库与 fixture 各一组，落 `docs/acceptance/T4-before-after.md`。真实库取「改动前」用 `git stash`（或改动 commit 的父提交 checkout 到临时 worktree）跑同一命令；fixture 组直接用 `tests/db-caliber.test.js` 的边界行在两个版本下各跑一次并抄录返回值。

- [ ] **Step 7：A2-4 / A2-5 评审留痕 + 提交**

  A2-4：前端徽章截图（`/` 页 KPI 区）记入 `docs/acceptance/T4-before-after.md`（截图不入库）。A2-5：抽查 5 处 db.js 注释与口径文档一致性，结论写入 commit 说明。然后：
  ```bash
  git -C "F:/project/zcode-monitor-plan" add server/db.js tests/db-caliber.test.js \
    docs/caliber docs/acceptance public/views/overview.js public/styles.css
  git -C "F:/project/zcode-monitor-plan" commit -m "feat: WP2 token 口径对齐——官方 schema 核实落地与对账"
  ```

---

## T5：桌宠行为与安全升级（WP4）

**Files:**
- Create: `public/pet-state.js`（契约常量 + 事件→状态纯决策 + 手势判定；经典脚本双端导出）
- Create: `public/pet-sanitize.js`（消毒共享模块；经典脚本双端导出）
- Modify: `public/pet.html`（删内联契约常量、接共享状态机、入睡、手势窗口、惊醒）
- Modify: `server/livegen.js`（`tick()` 增发 `tool_error` 事件）
- Create: `docs/acceptance/T5-permission-gate.md`（数据源核实门结论）
- Test: `tests/pet-state.test.js`、`tests/pet-sanitize.test.js`

**Interfaces:**
- `public/pet-state.js` 经 `<script src>` 挂 `window.PetState`；同一文件被 `node --test` `require()`（条件导出，双端同一份——A4-6 守护页面实际加载的那份）。导出：`{ CELL_W, CELL_H, COLS, FRAME_MS, ROW_ANIMS, DEFAULTS, initState(now, opts), onEvent(state, ev), classifyClicks(clicks, windowMs) }`。
  - `initState(now, opts)` → `{ mode:'awake'|'sleep', anim:null|'failed'|'waiting_permission'|'waving', idleSince, holdUntil, opts }`；`opts` 缺省 `{ sleepAfterMs: 600000, errorHoldMs: 4000, permHoldMs: 4000, comboHoldMs: 1500 }`（均可注入）。
  - `onEvent(state, ev)` → `{ state, woke, animOverride }`；`ev = { type, now }`，`type ∈ 'gen_start'|'gen_lanes'|'gen_end'|'tool_error'|'permission'|'combo'|'tick'`。工作事件（前五种 gen/tool/permission）惊醒 + 重置 idle；`tool_error`→`failed` 行、`permission`→`waiting_permission` 行、`combo`→`waving` 行，各持 `holdUntil` 到期；`tick` 到期清除 hold，且 idle 时长 ≥ `sleepAfterMs` 时进入 `sleep`（无专属动画行，9 行契约不动）。
  - `classifyClicks(clicks, windowMs)` → `'none'|'switch'|'combo'`：窗口内 1 击 none、2–3 击 switch、≥4 击 combo（不变量 A4-4）。
- `public/pet-sanitize.js` 导出 `{ sanitizeText(input) → string }`。
- `server/livegen.js`：`tick()` 内新增工具失败边检测（复用 `dbq.recentToolRows`，started_at 水位去重），向同一 emitter 发 `{ phase:'tool_error', tool, session, at }`；`server/index.js:235-237` 的 onEvent 透传，`server/index.js` **无需改动**。

**核实门（权限事件，对标 WP2 的核实步骤）——先核实后接线：**

- [ ] **Step 0：数据源核实门（结论决定 `waiting_permission` 子项去留）**

  ```bash
  # (a)(b) 真实库只读观察：permission 表规模 + tool_usage.approval_status 取值分布（带 started_at 下界）。
  # permission 用 MAX(rowid) 有界取数（本会话实测 EXPLAIN：COUNT(*) 为 SCAN permission，
  # 违反红线；MAX(rowid) 走 B-tree 尾页为 SEARCH permission）——0 行时返回 0，语义同"无行"。
  node -e "
  const Database = require('F:/project/zcode-monitor/node_modules/better-sqlite3');
  const db = new Database(process.env.USERPROFILE + '/.zcode/cli/db/db.sqlite', { readonly: true });
  console.log('permission max rowid（0 = 空表）:', db.prepare('SELECT IFNULL(MAX(rowid),0) AS n FROM permission').get());
  const since = Date.now() - 86400e3;
  console.log('approval_status 分布(24h):',
    JSON.stringify(db.prepare('SELECT approval_status, COUNT(*) AS n FROM tool_usage' +
      ' WHERE started_at >= ' + since + ' GROUP BY approval_status').all()));
  db.close();"
  ```
  (a) 在真实使用中触发一次权限请求（如让 ZCode 执行一个需要批准的命令）——**human-gate**（见「human-gate 清单」）：代理执行到此无法自然制造权限请求时，按标准格式在 `docs/acceptance/T5-permission-gate.md` 留痕「待人工触发」并以 (b) 与既有快照证据先出结论；随后重跑上面命令观察 max rowid 是否增长、`approval_status` 是否出现非 `'none'` 取值（只读观察）；(b) 在 T4 Step 1 克隆的 `$TMP/ZCode-src`（**若已被清理，按 T4 Step 1 同命令重克隆**）中 grep 落盘行为：`grep -rn "approval_status\|permission" "$TMP/ZCode-src" --include='*.ts' -l | head`。
  **判定**：两类落点均被证实 → 权限事件接线进入 Step 2~4（事件类型 `'permission'` 已在状态机内）；**任一未证实（2026-09-22 快照证据：permission 表 max rowid 0（空表）、approval_status 尾部取值全 'none'）→ `waiting_permission` 接线子项降级 backlog**（显式部分交付），A4-1 / A4-7 的对应子项移除，error 态交付不受影响。结论（落点 + 记录形态 + fixture 样例行形态或降级理由）写入 `docs/acceptance/T5-permission-gate.md`。

- [ ] **Step 1：error 事件源（livegen）**

  `server/livegen.js` 的 `createGenWatcher` 内，`let lastSessions = 0;`（`:64`）之后加水位变量；插入点在 `tick()` 内、**try/catch 块结束之后**的赋值区（主查询 :85 在 :83-96 的 try 内，:98-100 为 `sessions`/`inflight`/`nowGenerating` 赋值）之后、边检测（`:106` 起 if 链）之前——不在 try 块内（try 块只含主查询，其后即 catch 的错误兜底路径）：

  ```js
  // 工具失败边：复用 recentToolRows（started_at 索引命中，db.js:664-673），
  // 以 started_at 严格递增水位去重；ASC LIMIT 50 下极端高频错误可能漏发，
  // 桌宠动画属尽力而为信号，接受该截断（注释留档）。
  const errRows = dbq.recentToolRows(lastErrStartedAt, 50);
  for (const r of errRows) {
    const t = Date.parse(r.started_at);
    if (t > lastErrStartedAt) {
      if (r.status === 'error') {
        emitter.emit('gen', { phase: 'tool_error', tool: r.tool_name,
          session: r.session_id, at: Date.now() });
      }
      lastErrStartedAt = t;
    }
  }
  ```
  并在状态声明区（`:61-66`）加 `let lastErrStartedAt = dbq.latestToolStartedAt();`（boot 不回放历史错误）。

- [ ] **Step 2：写 `public/pet-state.js`（双端导出）**

  ```js
  // pet-state.js — 桌宠行为契约：sheet 常量 + 事件→状态纯决策 + 手势判定。
  // 浏览器：<script src> 挂 window.PetState；node --test：同一文件 require()。
  // 本文件是 ROW_ANIMS 等契约常量的唯一权威版本（pet.html 不再保留内联副本）。
  (function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PetState = factory();
  })(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const CELL_W = 192, CELL_H = 208, COLS = 8, FRAME_MS = 160;
    // 9 行动画契约：顺序固定，不新增行（入睡复用 idle，failed/waiting_permission 常驻）
    const ROW_ANIMS = ['idle', 'running_right', 'running_left', 'waving', 'jumping',
                       'failed', 'waiting_permission', 'running', 'review'];

    const DEFAULTS = {
      sleepAfterMs: 10 * 60 * 1000, // idle 持续多久入睡（可注入，参考 clawd 的短入睡节奏调参）
      errorHoldMs: 4000,            // failed 行播放时长
      permHoldMs: 4000,             // waiting_permission 行播放时长
      comboHoldMs: 1500,            // 连击反应（waving 行）时长
    };
    const WORK = new Set(['gen_start', 'gen_lanes', 'gen_end', 'tool_error', 'permission']);

    // 状态：{ mode:'awake'|'sleep', anim:null|'failed'|'waiting_permission'|'waving',
    //         idleSince, holdUntil, opts }
    function initState(now, opts) {
      return { mode: 'awake', anim: null, idleSince: now, holdUntil: 0,
               opts: Object.assign({}, DEFAULTS, opts || {}) };
    }

    // 纯决策：工作事件立即惊醒（woke=true）并重置 idle 计时——工作事件优先级恒高于入睡。
    // 返回 { state, woke, animOverride }；animOverride 非空时页面把它作为 pending 行，
    // 为 null 时页面走常规 desiredAnim()（gen 档位 / cruise / idle 判定）。
    function onEvent(state, ev) {
      const o = state.opts, now = ev.now;
      const next = { mode: state.mode, anim: state.anim, idleSince: state.idleSince,
                     holdUntil: state.holdUntil, opts: o };
      let woke = false;
      if (WORK.has(ev.type)) {
        if (state.mode === 'sleep') { next.mode = 'awake'; woke = true; }
        next.idleSince = now;
      }
      if (ev.type === 'tool_error') { next.anim = 'failed'; next.holdUntil = now + o.errorHoldMs; }
      else if (ev.type === 'permission') { next.anim = 'waiting_permission'; next.holdUntil = now + o.permHoldMs; }
      else if (ev.type === 'combo')    { next.anim = 'waving'; next.holdUntil = now + o.comboHoldMs; }
      if (ev.type === 'tick') {
        if (next.anim && now >= next.holdUntil) { next.anim = null; next.holdUntil = 0; }
        if (next.mode === 'awake' && !next.anim && now - next.idleSince >= o.sleepAfterMs) {
          next.mode = 'sleep'; // 入睡 = idle 深化态；无专属行（9 行契约不动），视觉靠 body class
        }
      }
      return { state: next, woke, animOverride: next.anim };
    }

    // 手势判定（纯函数）：clicks 为同一判定窗口内的点击时间戳，windowMs 为窗口宽。
    // 不变量：≥4 击 → combo（不切换）；2–3 击 → switch；1 击 → none。
    function classifyClicks(clicks, windowMs) {
      const ts = (clicks || []).filter(t => typeof t === 'number' && isFinite(t)).sort((a, b) => a - b);
      if (!ts.length) return 'none';
      const t0 = ts[0];
      const n = ts.filter(t => t - t0 <= windowMs).length;
      if (n >= 4) return 'combo';
      if (n >= 2) return 'switch';
      return 'none';
    }

    return { CELL_W, CELL_H, COLS, FRAME_MS, ROW_ANIMS, DEFAULTS, initState, onEvent, classifyClicks };
  });
  ```

- [ ] **Step 3：写 `public/pet-sanitize.js`（双端导出；只交付模块+单测，不改默认展示）**

  ```js
  // pet-sanitize.js — 桌宠气泡文本消毒共享模块。
  // 覆盖面声明（显式）：仅下列 4 类样式的字面替换，不是完备的安全边界；
  // 「过了消毒」不等于「可安全展示」。任何新敏感样式须先加规则再有单测。
  (function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PetSanitize = factory();
  })(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const RULES = [
      { re: /\b(?:https?|file):\/\/[^\s"'<>）】]+/gi, sub: '[链接]' },   // http(s):// 与 file:// URL
      { re: /[A-Za-z]:\\[^\s"'<>|：][^\s"'<>|]*/g,   sub: '[本地路径]' }, // Windows 本地路径 C:\... 形态
      { re: /\bsk-[A-Za-z0-9_-]{6,}/g,               sub: '[密钥]' },    // sk- 前缀 token
      { re: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,      sub: '[凭证]' },    // Bearer 头
    ];
    function sanitizeText(input) {
      if (typeof input !== 'string') return '';
      let out = input;
      for (const r of RULES) out = out.replace(r.re, r.sub);
      return out;
    }
    return { sanitizeText };
  });
  ```

- [ ] **Step 4：改 `public/pet.html`（函数级改动点）**

  1. `:170`（`<script>` 之前）加 `<script src="/pet-state.js"></script>`。
  2. 删除 `:184-187` 的内联 `const CELL_W…ROW_ANIMS` 副本，替换为解构（`PACK_OVERRIDES`（`:190-192`）**保留原样不动**）：
     ```js
     const { CELL_W, CELL_H, COLS, FRAME_MS, ROW_ANIMS, initState, onEvent: petEvent,
             classifyClicks } = window.PetState;
     ```
  3. 状态机实例（滚动状态区 `:369-377` 附近）：
     ```js
     const SLEEP_AFTER_MS = 10 * 60 * 1000; // 入睡阈值（可调）
     const GESTURE_WINDOW_MS = 300;         // 手势判定窗口（可调）
     let pet = initState(Date.now(), { sleepAfterMs: SLEEP_AFTER_MS });
     ```
  4. `openSSE` 的事件分派（`:471-481`）扩展两相：
     ```js
     if (m.phase === 'start') { gen = true; lanes = Math.max(1, m.sessions || 1);
       pet = petEvent(pet, { type: 'gen_start', now: Date.now() }).state; }
     else if (m.phase === 'lanes') { lanes = m.sessions || 0;
       pet = petEvent(pet, { type: 'gen_lanes', now: Date.now() }).state; }
     else if (m.phase === 'end') { gen = false; lanes = 0;
       lastActivity = Math.max(lastActivity, Date.now());
       pet = petEvent(pet, { type: 'gen_end', now: Date.now() }).state; }
     else if (m.phase === 'tool_error') { pet = petEvent(pet, { type: 'tool_error', now: Date.now() }).state; }
     else if (m.phase === 'permission') { pet = petEvent(pet, { type: 'permission', now: Date.now() }).state; }
     ```
     （核实门降级时删掉 `permission` 分支。）
  5. `render()`（`:410-431`）：原 `:411` 的 `const s = computeState(), tier = tierOf(tps);` 改为：
     ```js
     const tickRes = petEvent(pet, { type: 'tick', now: Date.now() }); // 推进入睡/hold 到期
     pet = tickRes.state;
     const s = pet.mode === 'sleep' ? 'sleep' : computeState(); // sleep 是 idle 的深化态
     const tier = tierOf(tps);
     ```
     原 `:417` 的 `pending = desiredAnim();` 改为：
     ```js
     pending = tickRes.animOverride || desiredAnim(); // failed/waiting_permission/waving hold 优先
     ```
     `ariaLabel`（`:403-408`）增加 sleep 分支：`if (s === 'sleep') return 'Token 桌宠：睡着了';`。body className（`:414`）逻辑不变（用新的 `s` 即含 `state-sleep`）。
  6. 入睡视觉（无专属行，idle 行 + body class 暗示）：`<style>` 末尾加
     ```css
     .state-sleep .bubble-zone::after { content: "zzz"; font-weight: 600;
       color: var(--text-disabled); font-size: 12px; margin-left: 4px; }
     ```
  7. 手势替换：删除 `if (IN_WEBVIEW)` 块内的 `dblclick` 监听（`:511-513`），在 `IN_WEBVIEW` 块**之后**（页面通用注册，浏览器直开同样可双击切换）加：
     ```js
     // 双击优先、计数延后：窗口内累计点击，关闭时判定——2/3 击切换，≥4 击连击。
     // 拖动排除：壳内 pointerdown 即 postMessage drag（:504-506，postMessage 在 :505），松开仍会补发 click；
     // down→up 间位移超阈值的序列不计入手势，否则连续两次快速拖动会被判为 switch 误切包。
     let clickTimes = [], clickTimer = 0, downPt = null, dragMoved = false;
     document.addEventListener('pointerdown', e => {
       if (e.button === 0) { downPt = { x: e.clientX, y: e.clientY }; dragMoved = false; }
     });
     document.addEventListener('pointermove', e => {
       if (downPt && (Math.abs(e.clientX - downPt.x) > 6 || Math.abs(e.clientY - downPt.y) > 6)) dragMoved = true;
     });
     document.addEventListener('click', e => {
       if (e.button !== 0) return;
       if (dragMoved) { dragMoved = false; return; } // 拖动后的 click 不计入手势
       clickTimes.push(performance.now());
       if (!clickTimer) clickTimer = setTimeout(() => {
         const action = classifyClicks(clickTimes, GESTURE_WINDOW_MS);
         clickTimes = []; clickTimer = 0;
         if (action === 'switch') cyclePack();
         else if (action === 'combo') pet = petEvent(pet, { type: 'combo', now: Date.now() }).state;
       }, GESTURE_WINDOW_MS);
     });
     ```
     `:504-510,514-518` 的 pointerdown 拖动 / contextmenu / wheel `postMessage` 契约**保持不变**（上面的 pointerdown/pointermove 记录只读坐标、不发消息，与既有契约叠加不冲突）。

- [ ] **Step 5：写 `tests/pet-state.test.js`（A4-1~4、A4-6）与 `tests/pet-sanitize.test.js`（A4-5）**

  ```js
  // tests/pet-state.test.js
  'use strict';
  const test = require('node:test');
  const assert = require('node:assert');
  const fs = require('fs');
  const path = require('path');
  // A4-6：require 的就是页面实际加载的那份文件；另断言 pet.html 有指向它的 script 引用
  const petStatePath = path.join(__dirname, '..', 'public', 'pet-state.js');
  const PetState = require(petStatePath);
  const { initState, onEvent, classifyClicks, ROW_ANIMS } = PetState;

  test('A4-6: 契约守护——ROW_ANIMS 恒等 9 行且顺序不变，pet.html 引用同一文件且无内联副本', () => {
    assert.deepEqual(ROW_ANIMS,
      ['idle', 'running_right', 'running_left', 'waving', 'jumping',
       'failed', 'waiting_permission', 'running', 'review']);
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'pet.html'), 'utf8');
    assert.ok(html.includes('<script src="/pet-state.js">'));
    assert.ok(!html.includes('const ROW_ANIMS')); // 内联副本已删除
  });

  test('A4-1: 工具失败→failed；hold 到期回常规判定路径', () => {
    let st = initState(0);
    let r = onEvent(st, { type: 'tool_error', now: 100 });
    assert.equal(r.animOverride, 'failed');
    st = r.state;
    r = onEvent(st, { type: 'tick', now: 100 + st.opts.errorHoldMs });
    assert.equal(r.animOverride, null);          // hold 到期
    assert.equal(r.state.mode, 'awake');         // 页面按 cruise/idle 常规判定
  });

  test('A4-1: 权限请求→waiting_permission（核实门降级时本用例随子项移除）', () => {
    const r = onEvent(initState(0), { type: 'permission', now: 100 });
    assert.equal(r.animOverride, 'waiting_permission');
  });

  test('A4-2: sleep 中任一工作事件立即惊醒并重置 idle（参数化五种）', () => {
    for (const type of ['gen_start', 'gen_lanes', 'gen_end', 'tool_error', 'permission']) {
      let st = initState(0, { sleepAfterMs: 1000 });
      st = onEvent(st, { type: 'tick', now: 2000 }).state;
      assert.equal(st.mode, 'sleep', `前置: ${type} 应已入睡`);
      const r = onEvent(st, { type, now: 2100 });
      assert.equal(r.woke, true, type);
      assert.equal(r.state.mode, 'awake', type);
      assert.equal(r.state.idleSince, 2100, type); // idle 计时被重置
    }
  });

  test('A4-2: 工作事件与入睡条件同时满足时工作态胜出', () => {
    const st = initState(0, { sleepAfterMs: 1000 });
    const r = onEvent(st, { type: 'gen_start', now: 1000 }); // 恰在阈值点来工作事件
    assert.equal(r.state.mode, 'awake');
    assert.equal(r.woke, false); // 尚未睡着，谈不上惊醒
    assert.equal(r.state.idleSince, 1000);
  });

  test('A4-3: idle 持续跨过注入阈值才入睡', () => {
    let st = initState(0, { sleepAfterMs: 1000 });
    st = onEvent(st, { type: 'tick', now: 999 }).state;
    assert.equal(st.mode, 'awake');
    st = onEvent(st, { type: 'tick', now: 1000 }).state;
    assert.equal(st.mode, 'sleep');
  });

  test('A4-4: 手势不变量（参数化四案）', () => {
    assert.equal(classifyClicks([0, 10], 300), 'switch');        // [c,c] → 切换、无连击
    assert.equal(classifyClicks([0, 10, 20, 30], 300), 'combo'); // [c,c,c,c] → 连击、不切换
    assert.equal(classifyClicks([0, 10, 20], 300), 'switch');    // [c,c,c] → 窗口关闭时切换
    assert.equal(classifyClicks([0], 300), 'none');              // [c] → 无手势
  });
  ```

  ```js
  // tests/pet-sanitize.test.js
  'use strict';
  const test = require('node:test');
  const assert = require('node:assert');
  const { sanitizeText } = require('../public/pet-sanitize');

  test('A4-5: 四类敏感样式全部拦截（逐项 indexOf === -1）', () => {
    const out = sanitizeText('看下 C:\\Users\\x\\secret.txt 和 https://example.com/p?token=abc' +
      ' 还有 sk-abcdefgh 与 Bearer xyz 的日志');
    assert.equal(out.indexOf('C:\\Users\\x\\secret.txt'), -1);
    assert.equal(out.indexOf('https://example.com/p?token=abc'), -1);
    assert.equal(out.indexOf('sk-abcdefgh'), -1);
    assert.equal(out.indexOf('Bearer xyz'), -1);
    assert.ok(out.includes('[本地路径]') && out.includes('[链接]')
           && out.includes('[密钥]') && out.includes('[凭证]'));
  });

  test('A4-5: 普通中文短句原样保留', () => {
    const s = '今天完成了三个任务，一切正常。';
    assert.equal(sanitizeText(s), s);
  });
  ```

- [ ] **Step 6：跑门禁 + A4-7 实机评审 + 提交**

  ```bash
  cd "F:/project/zcode-monitor-plan" && npm test
  ```
  A4-7：`npm start` 后浏览器打开 `/pet`，以及经 WebView2 壳（widget 常驻）各演示一轮：制造一次工具失败（如让 ZCode 读不存在文件）看 `failed` 行；静置超入睡阈值看 zzz；期间发起生成看惊醒；快速两击切换、四击连击、三击切换；**拖动卡片一段距离后松开（不切包）、紧接着再快速拖动一次（仍不切包）**——验证拖动排除不与 click 手势互扰。互不误触记录截图入 `docs/acceptance/T5-behavior-e2e.md`（截图不入库；human-gate，见清单）。
  ```bash
  git -C "F:/project/zcode-monitor-plan" add public/pet-state.js public/pet-sanitize.js \
    public/pet.html server/livegen.js tests/pet-state.test.js tests/pet-sanitize.test.js docs/acceptance
  git -C "F:/project/zcode-monitor-plan" commit -m "feat: WP4 桌宠行为升级——error 接线/入睡/连击/消毒模块"
  ```

---

## T6：JSONL watch 实时化（WP3-lite，零写入）

**Files:**
- Modify: `server/log-tail.js`（新增 `createLogWatcher`；既有导出签名不变）
- Create: `tools/log-latency-probe.js`（只读延迟观测探针，A3-5）
- Create: `docs/acceptance/T6-latency-samples.md`、`docs/acceptance/T6-watch-prevalidation.md`（证据）
- Test: `tests/log-tail.watch.test.js`

**Interfaces:**
- `server/log-tail.js` 新导出：`createLogWatcher({ onEvents, reconcileMs = 5000, todayFile, pollMs = 1000 })` → `{ stop() }`。
  - `onEvents(events)`：新解析出的事件数组（同一偏移的行**不产出两次**，偏移守恒）。
  - `reconcileMs`：周期偏移对账（5s，对齐仓库既有 5s 惯例 `server/index.js:98`、`public/pet.html:494`）；`pollMs`：watch 失效后的兜底短轮询周期（1s）。
  - `todayFile()`：可注入的当日文件解析函数（缺省 `() => todayLogFile(new Date())`）——测试用它注入 UTC 日切换与 fixture 路径，同时满足 cwd 无关。
  - 行为：监听**日志目录**（`fs.watch(path.dirname(file))`）；任一目录事件 → 重新解析当日文件名并从字节偏移增量读取（残行保留到下次拼接）；watch `error` → 关闭监听、降级 `pollMs` 短轮询；对账定时器恒在（偏移读幂等，漏事件由它补齐）。
- `tools/log-latency-probe.js`：`node tools/log-latency-probe.js --mode watch|poll --samples 5 [--logdir <dir>]`；只读观测（对日志文件只 `stat`/读，**绝不追加**——真实环境样本来自 ZCode 自身写入），输出每次「文件增长被发现 → 行可见」的延迟样本清单。

- [ ] **Step 1：`server/log-tail.js` 实现 watch 增量路径**

  在 `buildSpanForest`（`:89-106`）之后、`module.exports`（`:108`）之前加：

  ```js
  // ── watch 增量路径（WP3-lite）───────────────────────────────
  // fs.watch 监听日志目录（不是单文件句柄）：任一目录事件都按 todayFile() 重新
  // 解析当日文件名，UTC 日切换（换名）由此覆盖，新文件从偏移 0 起读。追加 →
  // 立即 pump；watch 报错（ENOENT/EPERM/EMFILE）→ 降级 1s 短轮询；5s 对账定时器
  // 恒在——偏移读幂等，watch 静默漏事件由它补齐（最终一致）。全程只读。
  function createLogWatcher({ onEvents, reconcileMs = 5000, pollMs = 1000,
                              todayFile = () => todayLogFile(new Date()) } = {}) {
    if (typeof onEvents !== 'function') throw new TypeError('onEvents required');
    let curFile = null, offset = 0, remainder = '';
    let watcher = null, pumpTimer = 0, reconcileTimer = 0, pollTimer = 0, stopped = false;
    let pending = 0;

    function pump() {
      if (stopped) return;
      pending = 0;
      let file;
      try { file = todayFile(); } catch { return; }
      if (file !== curFile) {
        const isFirst = curFile === null;
        curFile = file; offset = 0; remainder = ''; // 日切换（换名）→ 新文件从偏移 0 起读
        if (isFirst) { // 起点对账：已存在的当日文件从尾部开始，不回放历史
          try { offset = fs.statSync(curFile).size; } catch { /* 文件未生成，等下次 */ }
          return;
        }
      }
      let stat;
      try { stat = fs.statSync(curFile); }
      catch { return; } // 当日文件尚不存在：等下次事件/对账
      if (stat.size < offset) { offset = 0; remainder = ''; } // 截断/回绕：按新文件从 0 重读
                                                               // （对账定时器调的就是本 pump，走同一
                                                               //  分支兜不了底；offset 不重置会让此后
                                                               //  追加在 size 追回 offset 前全部不可见）
      if (stat.size === offset) return; // 无新字节
      const chunkSize = stat.size - offset;
      const buf = Buffer.alloc(chunkSize);
      let fd;
      try {
        fd = fs.openSync(curFile, 'r');
        fs.readSync(fd, buf, 0, chunkSize, offset);
      } catch { return; }
      finally { try { if (fd != null) fs.closeSync(fd); } catch { /* ignore */ } }
      offset = stat.size;
      const text = remainder + buf.toString('utf8');
      const lines = text.split('\n');
      remainder = lines.pop() ?? ''; // 尾部残行留到下次拼接
      const events = lines.map(parseLine).filter(Boolean);
      if (events.length) onEvents(events);
    }

    function schedulePump() {
      if (pending || stopped) return;
      pending = setTimeout(pump, 30).unref?.(); // 抖动合并：30ms 内的连续事件合并一次读
    }

    function startWatch() {
      try {
        watcher = fs.watch(path.dirname(todayFile()), { persistent: false }, schedulePump);
        watcher.on('error', () => { // ENOENT/EPERM/EMFILE…：降级短轮询，不丢事件
          try { watcher.close(); } catch { /* ignore */ }
          watcher = null;
          if (!pollTimer && !stopped) pollTimer = setInterval(pump, pollMs).unref?.();
        });
      } catch {
        if (!pollTimer && !stopped) pollTimer = setInterval(pump, pollMs).unref?.();
      }
    }

    pump(); // 起点对账：从当前文件尾开始（不回放历史）
    startWatch();
    reconcileTimer = setInterval(pump, reconcileMs).unref?.();

    return {
      stop() {
        stopped = true;
        try { if (watcher) watcher.close(); } catch { /* ignore */ }
        for (const t of [pending, reconcileTimer, pollTimer]) { try { clearTimeout(t); clearInterval(t); } catch { /* ignore */ } }
      },
    };
  }
  ```

  并把 `module.exports`（`:108`）改为：
  ```js
  module.exports = { todayLogFile, listLogFiles, parseLine, tailLog, eventsForTrace,
                     buildSpanForest, createLogWatcher };
  ```

- [ ] **Step 2：写 `tests/log-tail.watch.test.js`（A3-1 / A3-2 / A3-4）**

  实现说明：三个用例全部用**可注入的 `todayFile`** 绑定各自的 fixture 路径（不依赖 `ZCODE_LOG_DIR`，因此不受 require 缓存影响、也与 cwd 无关）；文件顶部仍须在 require `log-tail` 前设一次 inert 的 `ZCODE_LOG_DIR`，防止 `log-tail → db.js` 在 require 时落到真实 `~/.zcode` 路径（R8 守护；该值本文件从不读取）。

  ```js
  'use strict';
  const test = require('node:test');
  const assert = require('node:assert');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // R8 守护：先注入 inert 路径再 require（本文件全部用例走注入的 todayFile，不读它）
  process.env.ZCODE_LOG_DIR = path.join(os.tmpdir(), 'unused-zcode-log-dir');
  const log = require('../server/log-tail');

  function makeLogRoot(name) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), name));
    const logDir = path.join(root, 'log');
    fs.mkdirSync(logDir, { recursive: true });
    return { root, logDir };
  }

  test('A3-1: 追加 10 行 → 恰 10 个事件（偏移守恒）且每行 1s 内可见', async () => {
    const { root, logDir } = makeLogRoot('zcmon-watch-');
    const file = path.join(logDir, 'zcode-2026-09-22.jsonl');
    const got = [], latencies = [];
    const w = log.createLogWatcher({
      todayFile: () => file,
      onEvents: evs => { for (const e of evs) { got.push(e); latencies.push(Date.now() - e.at); } },
    });
    try {
      for (let i = 0; i < 10; i++) {
        fs.appendFileSync(file, JSON.stringify({ i, at: Date.now() }) + '\n'); // at = 追加时刻
        await sleep(120); // 每行间隔 ≥100ms
      }
      await sleep(1500); // 等 watch/对账收尾
      assert.equal(got.length, 10);                        // 硬判据：恰 10，偏移守恒
      assert.equal(new Set(got.map(e => e.i)).size, 10);   // 无重复
      assert.ok(latencies.every(l => l <= 1000),
        '每行 1s 内可见: ' + latencies.join(','));
    } finally { w.stop(); fs.rmSync(root, { recursive: true, force: true }); }
  });
  ```

  Windows `fs.watch` 抖动容忍（Spec A3-1 的验收执行协议，不写进测试逻辑）：时序判据未达时**整组重跑至多 2 次**、任一次全过即通过；三次均未达 1s 时以 3s 上界复测——3s 全过则时序判据记通过（带注记），仍不过则时序判据记不通过、交 A3-5 综合裁定；**偏移守恒（恰 10、无重复）不过仍一票否决**。

  ```js
  test('A3-2: watch 回退态（删除被监视目录）后追加仍可见、≤10s 全量、无重复', async () => {
    const { root, logDir } = makeLogRoot('zcmon-fb-');
    const file = path.join(logDir, 'zcode-2026-09-22.jsonl');
    const got = [];
    const w = log.createLogWatcher({
      todayFile: () => file,
      onEvents: evs => got.push(...evs),
    });
    try {
      fs.rmSync(logDir, { recursive: true, force: true }); // 触发 watch 错误 → 降级短轮询
      await sleep(200);
      fs.mkdirSync(logDir, { recursive: true });
      const t0 = Date.now();
      for (let i = 0; i < 5; i++) { fs.appendFileSync(file, JSON.stringify({ i }) + '\n'); await sleep(50); }
      const deadline = t0 + 10000;
      while (got.length < 5 && Date.now() < deadline) await sleep(100);
      assert.equal(got.length, 5);            // 轮询兜底继续产出
      assert.ok(Date.now() - t0 <= 10000);    // 两个对账周期内全量可见
      assert.equal(new Set(got.map(e => e.i)).size, 5); // 无重复
    } finally { w.stop(); fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('A3-4: 100 行连续追加——最终一致（≤10s 全量、恰 100）+ UTC 日切换场景', async () => {
    const { root, logDir } = makeLogRoot('zcmon-pv-');
    const d1 = path.join(logDir, 'zcode-2026-09-21.jsonl');
    const d2 = path.join(logDir, 'zcode-2026-09-22.jsonl');
    const got = [], atFirstSecond = [];
    let onDay2 = false;
    const bootAt = Date.now();
    const w = log.createLogWatcher({
      // 可注入 todayFile：先指到 d1，翻日后指到 d2（模拟 UTC 日切换换名）
      todayFile: () => (onDay2 ? d2 : d1),
      onEvents: evs => { for (const e of evs) { got.push(e); if (Date.now() - bootAt <= 1000) atFirstSecond.push(e); } },
    });
    try {
      for (let i = 0; i < 100; i++) { fs.appendFileSync(d1, JSON.stringify({ day: 1, i }) + '\n'); }
      const deadline = Date.now() + 10000;
      while (got.length < 100 && Date.now() < deadline) await sleep(50);
      assert.equal(got.length, 100); // 无论 watch 命中率如何，混合兜底必须最终一致
      assert.equal(new Set(got.map(e => e.day + ':' + e.i)).size, 100);
      // watch 命中率照录（降级启用依据）：1s 内到达数 vs 对账补齐数
      console.log(`watch-hit ${atFirstSecond.length}/100 within 1s`);
      onDay2 = true;                 // 换名后的当日文件从偏移 0 起读
      for (let i = 0; i < 10; i++) { fs.appendFileSync(d2, JSON.stringify({ day: 2, i }) + '\n'); await sleep(30); }
      const dl2 = Date.now() + 10000;
      while (got.length < 110 && Date.now() < dl2) await sleep(50);
      assert.equal(got.length, 110); // 跨日事件仍可见
      assert.ok(got.every(e => e.day === 1 || e.day === 2));
    } finally { w.stop(); fs.rmSync(root, { recursive: true, force: true }); }
  });
  ```

  watch 命中率记录（A3-4 附带，启用降级路径的依据）：把上面用例打印的 `watch-hit N/100` 与后续重跑值照录进 `docs/acceptance/T6-watch-prevalidation.md`（三次重跑取中位数）。**降级启用规则**（Spec WP3 需求 2）：若预验证显示 watch 命中率不可接受（三次重跑中位数命中率 < 50%），改为「当日文件 1s 短轮询 + 字节偏移去重」——即删除 Step 1 的 `startWatch()` 调用、`pollMs` 短轮询转正；此时除 A3-2 按映射执行（停止追加后 ≤10s 全量可见且全程无重复）外，其余验收判据不变。

- [ ] **Step 3：写 `tools/log-latency-probe.js`（A3-5 观测探针，全程只读）**

  ```js
  #!/usr/bin/env node
  // log-latency-probe.js — 观测「JSONL 追加 → 行可见」延迟（真实环境，A3-5）。
  // 只读：对日志目录只 stat/read，绝不写入（样本由 ZCode 自身的追加产生）。
  //   --mode watch  用 createLogWatcher（强化后）
  //   --mode poll   每 5s 调 tailLog 模拟现行纯轮询基线
  //   --samples N   收集 N 个样本后退出
  //   --logdir DIR  覆盖 LOG_DIR（默认走 db.js 注入链，即真实日志目录）
  'use strict';
  const fs = require('fs');
  const path = require('path');
  const argv = process.argv.slice(2);
  const opt = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
  if (opt('logdir')) process.env.ZCODE_LOG_DIR = opt('logdir');
  const log = require('../server/log-tail');
  const mode = opt('mode') || 'watch';
  const want = +(opt('samples') || 5);

  let lastSize = 0, samples = [];
  function tick() {
    try {
      const f = log.todayLogFile();
      const s = fs.existsSync(f) ? fs.statSync(f).size : 0;
      if (s > lastSize) { lastSize = s; return Date.now(); } // 文件增长被发现
    } catch { /* ignore */ }
    return null;
  }
  function record(tGrow, tVisible) {
    samples.push({ grow: tGrow, visible: tVisible, latencyMs: tVisible - tGrow });
    console.log(`sample ${samples.length}: ${samples[samples.length - 1].latencyMs}ms`);
    if (samples.length >= want) { console.log(JSON.stringify(samples, null, 1)); process.exit(0); }
  }

  if (mode === 'watch') {
    let tGrow = null;
    const w = log.createLogWatcher({
      onEvents: evs => { if (tGrow != null) { record(tGrow, Date.now()); tGrow = null; } },
      reconcileMs: 5000,
    });
    setInterval(() => { const t = tick(); if (t) tGrow = t; }, 200).unref();
    console.log(`probing (watch): waiting for ${want} appends…`);
  } else {
    setInterval(async () => {
      const t = tick();
      if (t) {
        const events = await log.tailLog({ lines: 5 }); // 模拟现行 5s 轮询的消费方式
        if (events.length) record(t, Date.now());
      }
    }, 5000).unref();
    console.log(`probing (poll 5s baseline): waiting for ${want} appends…`);
  }
  setInterval(() => {}, 60000); // keep alive
  ```

- [ ] **Step 4：A3-5 真实环境观测**

  在 ZCode 活跃使用时段（日志有真实追加）各采 ≥5 个样本，照录原始值：
  ```bash
  cd "F:/project/zcode-monitor-plan"
  node tools/log-latency-probe.js --mode poll  --samples 5   # 改造前基线（或先在未改 log-tail 的 commit 上跑）
  node tools/log-latency-probe.js --mode watch --samples 5   # 强化后
  ```
  基线也可在 T6 开工前的当前 HEAD 直接采样（现行 5s 轮询同法）。通过判据：**强化后样本中位数 < 基线中位数**；「各样本 <1s」作为观测目标照录、不作硬判据。样本写入 `docs/acceptance/T6-latency-samples.md`。

- [ ] **Step 5：A3-3 零写入静态审查 + 门禁 + 提交**

  ```bash
  cd "F:/project/zcode-monitor-plan"
  grep -rnE 'writeFile|appendFile|createWriteStream|open(Sync)?\([^)]*['\''"]((w|wx|a|ax)\+?|r\+|rs\+)' server/log-tail.js tools/log-latency-probe.js
  ```
  期望：退出码 1（无匹配）。**范围相对 Spec A3-3 字面（`server/log-tail.js tests/`）收窄**：T1 起 `tests/` 合法含写 tmpdir fixture 的 `fs.writeFileSync`/`fs.appendFileSync`（fixture-jsonl.js、pet-import.test.js、log-tail.watch.test.js 等），纳入范围则本门禁恒为命中、退出码 0，与期望矛盾、不可执行——零写入承诺（Spec §4.2）的主体是服务端模块，测试的 tmpdir 写入由 A0-3 注入守护兜底（测试永远指 fixture）。该收窄理由随本 commit 留痕。
  本会话已预验证：该 ERE 对现存 `server/log-tail.js` 退出码 1，`w/a/r+/wx/w+/a+/rs+/ax` 八种写打开形态全部命中、`r`/`rs` 不命中（grep 退出码 1 属预期——ERE 不支持前向查找，故枚举写打开模式而非排除 `r`）；修订会话复测确认 `fs.writeFileSync(p, x)`/`fs.appendFileSync(f, l)` 均命中（count=2、exit=0），坐实 `tests/` 不可纳入。
  > 注意：`tailLog` 与 `createLogWatcher.pump` 内的 `fs.openSync(file, 'r')` 是只读打开，`'r'` 不在枚举内、不命中；探针 `tools/log-latency-probe.js` 全程只 stat/read。
  然后 `npm test` 全绿 + 服务冒烟，提交：
  ```bash
  git -C "F:/project/zcode-monitor-plan" add server/log-tail.js tools/log-latency-probe.js \
    tests/log-tail.watch.test.js docs/acceptance
  git -C "F:/project/zcode-monitor-plan" commit -m "feat: WP3-lite JSONL watch 增量摄取——目录监听+偏移去重+双重兜底"
  ```

---

## 附录：Spec 验收条款 ↔ 任务步骤映射（自查用）

| Spec 条款 | 任务/步骤 | 形态 |
|---|---|---|
| A0-1 / A0-2 | T1 Step 11 | 命令 |
| A0-3 | T1 Step 7 | 测试 |
| A0-4 | T1 Step 8 | 测试 |
| A0-5 | T1 Step 9 | 测试 |
| A0-6 | T1 Step 6/10/11 + 门禁 3 | 命令 + 测试 |
| A0-7 | T1 Step 10 | 测试 |
| A1-1 | T2 Step 7（用例 1） | 测试 |
| A1-2 | T2 Step 7（参数化五案） | 测试 |
| A1-3 | T2 Step 7 | 测试 |
| A1-4 | T2 Step 7 | 测试 |
| A1-5 | T2 Step 9 | 命令 |
| A1-6 | T2 Step 7 | 测试 |
| A1-7 | T2 Step 7 | 测试 |
| A1-8 | T2 Step 10 | 评审（留痕 docs/acceptance/） |
| A1-9 | T2 Step 1 | 命令 |
| A2-1 | T4 Step 3 | 测试 |
| A2-2 | T4 Step 4 | 命令+评审 |
| A2-3 | T4 Step 5 | 命令（含出路条款） |
| A2-4 | T4 Step 2 + Step 7 | 评审 |
| A2-5 | T4 Step 2 + Step 7 | 评审 |
| A3-1 | T6 Step 2（含抖动容忍协议） | 测试 |
| A3-2 | T6 Step 2 | 测试 |
| A3-3 | T6 Step 5 | 命令 |
| A3-4 | T6 Step 2（含降级启用规则） | 测试 |
| A3-5 | T6 Step 4 | 评审（中位数判据） |
| A4-1 | T5 Step 5 | 测试（权限子项随核实门去留） |
| A4-2 / A4-3 / A4-4 | T5 Step 5 | 测试 |
| A4-5 | T5 Step 5 | 测试 |
| A4-6 | T5 Step 5 | 测试（契约守护） |
| A4-7 | T5 Step 6 | 评审（截图留痕） |
| A5-1 | T3 Step 5 | 评审 |
| A5-2 | T3 Step 4 | 命令 |
| A5-3 | T3 Step 4 | 命令 |
| §4.1 红线 | 门禁 4 + T4 Step 5 | 每个触 SQL 的 commit |
| §4.2 只读 | 门禁 2（fixture 冒烟）+ T6 Step 5 | 全程 |
| §4.3 依赖门槛 | 门禁 3 | 全程 |

**明确不做（出现即越界，Spec §3）**：账号切换/额度反代/API 转发；Live2D/Spine/DragonBones；写 `~/.zcode/`（hooks 端点、安装/卸载脚本、配置 diff 均不做）；对外宠物包索引/在线目录；双格式注册表；对外 JSON 口径端点；`ROW_ANIMS` 增行；`shell/`（WinForms 壳）改动；WP6/BP1 与 WP7/BP2。

---

## 计划自查记录（writing-plans Self-Review，2026-09-22）

1. **Spec 覆盖**：WP0→T1（A0-1~7 全映射）；WP1→T2（A1-1~9；需求 5 的 gitignore、需求 2 的 webp-size exports、需求 8 的端点滥用面对策均有对应步骤）；WP5→T3（三要素 + 负面清单 + 三 grep）；WP2→T4（核实门、A2-1~5、出路条款、对照表）；WP4→T5（核实门、A4-1~7、消毒模块只交付不改默认展示、9 行契约守护）；WP3-lite→T6（watch/兜底/对账、A3-1~5、降级路径）。backlog（BP1/BP2）与全部「明确不做」项未排任务，符合 Spec §3/§6。
2. **占位符扫描**：A1-1 webp 字节、A3-3 grep、A5-3 关键词、门禁冒烟命令均为可执行字面量；本会话实测过的构造（30 字节 webp 头解析 OK、grep 退出码 1、真实库索引清单、staging 形态）已逐条写入。T4 Step 2/3 与 T5 Step 0 的「两分支择一」是核实门结论的机械选择，两套代码均完整给出；依赖核实结论的具体数值（口径断言取值）不允许在本计划里凭空预写，已显式标注「以口径文档为准、勿凭记忆」——这是诚实条款下的已知限制，不是待填占位符。
3. **类型一致性**：`importPetPack({sourceDir,targetRoot,id,source,license})`、`listPetPacks(root)`、`importEndpointMiddleware({petsRoot})` 在 T2 的模块/CLI/端点/测试四处一致；`createLogWatcher({onEvents,reconcileMs,pollMs,todayFile})` 在 T6 模块/测试/探针一致；`initState/onEvent/classifyClicks` 签名在 pet-state 定义、pet.html 消费、pet-state.test 断言三处一致；`createFixtureDb()` 返回形状在门禁冒烟与各测试一致。
4. **事实勘误（相对 Spec 的以实测为准的核对，2026-09-22 修订会话复核）**：① 精选包目录名为 `xilian`（Spec §1 正确；本计划初稿白名单误写 `xinlian` 且自称"实测为 xinlian"，方向写反——修订会话双仓实测：worktree 与主仓库 `ls public/pets` 均为 `xilian`、`git ls-files` 含 3 个 `xilian/` 跟踪文件、0 个 `xinlian`，已更正白名单为 `!public/pets/xilian/`；沙盒模拟实测：白名单写 `xinlian` 时 `xilian/` 内新增未跟踪文件会被 `public/pets/*` 命中忽略，写 `xilian` 后不忽略）；② staging 本修订会话实测为 14 个包目录 + 8 个含 pet.json（初稿记 12/8 有误；Spec 记 14/8 与现值吻合，staging 为本地暂存区、内容随时间变化，Spec 本身声明不硬编码其数量）。
