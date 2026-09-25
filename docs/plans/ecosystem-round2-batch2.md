# 生态采纳第二轮第二批实施计划（ecosystem-round2-batch2）

> **状态：草稿（评审中）**——本计划把 `docs/specs/ecosystem-round2-batch2.md`（37 条验收）拆成 8 个有序任务；每任务一个 commit，**由编排脚本统一提交，实施者不得自行 commit、不得跑全套测试（`npm test` 由脚本统一执行）**，回滚单位即 commit。
>
> **For agentic workers:** 按本文 T1→T8 顺序逐任务执行，每任务完成其「完成判据」后即停，由脚本提交。步骤用 checkbox（`- [ ]`）跟踪。**实施者不运行 git commit/push、不删除文件、不改任务外文件；可自跑单文件测试 `cd F:/project/zcode-monitor-plan && node --test test/<file>.test.js`。**
>
> **C12 授权链披露（T8 前置条件）**：规格 §1.1 表 ④ 定 C12 实施前置条件＝用户确认（拍板记录增补或实施轮明示均可）。本实施轮的编排任务骨架明示包含 T8（C12 导出夹带）——即「实施轮明示」形态，前置条件视为满足；若脚本侧后续下达裁撤指令，T8 整节跳过（对应规格 §8 序 6 摘除条款），其余任务不受影响。

**Goal:** 在零新增运行时依赖、对 `~/.zcode` 零写入、不加第三条 SSE 通道的前提下，交付：C6 会话状态信号（waiting 一等公民化）、C8 本地提醒体系（默认防噪）、C7 active hours 口径升级与周/月回顾页、C12 统一导出口，并落地 R-8 守护与状态确认。

**Architecture:** 全部工作在 worktree `F:/project/zcode-monitor-plan`（分支 `feature/ecosystem-round2-batch2`，HEAD `09ec130`（规格书定稿提交，含 `2c3fd0a`——基线核对本会话 git log 实测），2026-09-25 规格书会话核实 clean）。分层数据流：L1 查询族（`server/db.js` 独立分节）→ L2 纯函数（`server/signals.js` 分类器 / `server/notify.js` 规则引擎，依赖注入可单测）→ 路由（`server/routes/*` 工厂）→ 视图（`public/views/*.js` 原生模块）。执行序：T1 先行守护基线（防后续条目回退归因困难，规格 §8 序 1）→ T2 建分类器与查询族 → T3/T4 两个消费面前端/服务端切面（T4 依赖 T2 的分类器输出）→ T5 通知前端 → T6/T7 回顾服务端/前端 → T8 导出（依赖 T6 的 recap 查询族）。

**Tech Stack:** Node ≥18（本机 v24）+ express + better-sqlite3（运行时依赖零新增，GX-2 守护恰为 `['better-sqlite3','express']`）+ `node:test`（tmpdir fixture）+ 原生 HTML/CSS/JS（无构建；双主题 `:root[data-theme]` + `--chart-*`/`--sev-*` 变量；数字 tabular-nums；零外联——R-8 落地后）。

**Spec:** `docs/specs/ecosystem-round2-batch2.md`（37 条验收：C6×9 / C8×8 / C7×9 / C12×7 / R-8×2 / 全局×2；**语义钉以 spec 为单一权威，本计划只做执行编排与细化，与 spec 冲突处以 spec 为准**）。上游分析：`docs/analysis/ecosystem-scan-round2.md`。执行者开工前必读这两份与本计划。

---

## Global Constraints（每任务隐含前提，违反任一条＝返工）

**硬红线 8 条全文＝spec §4（权威源），摘录如下；执行细节补充在后：**

1. **对 `~/.zcode/` 零写入**（只读承诺；服务以真实库只读跑冒烟是允许的）。
2. **性能红线**：真实库 18GB，每条 SQL 必须命中 `started_at` 索引或 rowid 尾界；行数参数一律经 `clampLimit`/`clampAtLeast`（`server/http-hardening.js:82-91`）钳界；禁止事件循环长阻塞（better-sqlite3 同步 API）。session 表基表扫描是既有 A2-3 出路条款管辖的例外（计时照录、机检显式滤出）。
3. **禁止直接删除文件**；临时/杂散产物 mv 到 `C:/Users/18086/Desktop/zcode-monitor-cleanup-20260923/`（禁止 rm）。
4. **一切文件编辑只发生在 worktree `F:/project/zcode-monitor-plan`**（分支 `feature/ecosystem-round2-batch2`）；绝不改主仓 `F:/project/zcode-monitor` 的文件（本机 hook 拦 main 编辑）。编辑一律用 Edit/Write 工具写 worktree 绝对路径，勿用 serena 相对路径编辑（有误写主仓前科）。
5. **子进程调用系统控制台程序（tasklist/netstat 等）必须带 `windowsHide:true`**。
6. **冒烟一律 `PORT=7399 OPEN_BROWSER=0 HOST=127.0.0.1`**；7331 是用户生产实例勿动；起服前后 `netstat -ano | grep 7399` 确认端口干净，结束杀干净自己起的进程（`process.kill(pid,'SIGKILL')` 形态，勿用可能吊死的 taskkill）。
7. **运行时依赖上限 express+better-sqlite3 两个**；前端无构建、无框架、零外联（R-8 落地后）。
8. **遗留项唯一登记处 `docs/acceptance/residuals.md`**：新遗留入册、解决销账、不删条目。当前最大编号 R-27（residuals.md:49 实测），本批新登记自 **R-28** 起顺延。

**执行细节补充：**

9. 测试一律 `os.tmpdir()` fixture（`ZCODE_DB`/`ZCODE_LOG_DIR` 等 env 注入、require 前置，`test/helpers/fixture-db.js` 模式），绝不触碰真实库；新测试文件放入 `test/` 即被 `test/index.js` 自动发现（readdirSync，无需登记）。
10. 行为变更必带回归测试；时间窗/日界/时长判定一律常量+时钟注入（`SIGNALS_WINDOW_MS`、tz、now），测试与宿主机时区/时刻无关。
11. 真实库只读实测仅限 [命令] 条目（EXPLAIN+计时/误报抽样/7399 冒烟），带 started_at 下界或 rowid 尾界，输出照录 `docs/acceptance/round2-batch2-explain-timing.md`；不得为测试目的写入真实库任何内容。SSE 页 UI 复验须 CDP 真等待（virtual-time 与 EventSource 死锁，AGENTS 实证）。
12. 验收无法满足或指令矛盾时如实上报（escalate），不伪造通过；人工评审项（C6-9/C8-8/C7-9 截图类）按 human-gate 留痕格式处理：在 `docs/acceptance/*.md` 记「结论：待人工评审；已备复现步骤」——严禁虚构评审结论或截图。
13. 7399 冒烟同时刻至多一个执行者；门禁跑全套前 `netstat -ano | grep 7399` 双检（R-21 治理惯例）。
14. **实施者不得自行 commit、不得跑全套测试（脚本统一）**；全套测试（GX-1）与依赖守护（GX-2）由编排脚本统一运行。

---

## 执行顺序与提交总览

| 序 | 任务 | 内容 | 依赖 | 提交主题（脚本用，实施者不跑 git） |
|---|---|---|---|---|
| 1 | T1 | R-8 字体终形守护：状态确认 + csp-verification 勘正 + styles.css 外联 @import 契约钉 | 无（先行，防后续条目回退归因困难） | `docs+test: R-8 字体终形守护——状态确认+csp-verification 勘正+styles.css 外联 @import 契约钉` |
| 2 | T2 | C6 服务端：signals.js 纯函数分类器 + db.js Session signals 查询族 + /api/sessions 扩展 + /api/signals/summary + fixture message 索引镜像 | 无 | `feat: C6 服务端——signals.js 分类器+sessionsWithSignals 查询族+/api/signals/summary+fixture message 索引镜像` |
| 3 | T3 | C6 前端：sessions 三态徽标与 needs-attention 置顶 + 顶栏 waiting chip + 桌宠 waiting 行接线 + 误报抽样 | T2 | `feat: C6 前端——sessions 三态徽标与置顶+顶栏 waiting chip+桌宠 waiting 行接线` |
| 4 | T4 | C8 服务端：notify.js 规则引擎 + 自有 tick + SSE notify 事件 | T2（waiting_timeout 消费分类器） | `feat: C8 服务端——notify.js 规则引擎+自有 tick+SSE notify 事件` |
| 5 | T5 | C8 前端：三页消费通知（Notification/WebAudio/桌宠气泡）+ 降级矩阵 + 开关 | T4 | `feat: C8 前端——三页通知消费+降级矩阵+三开关（默认防噪）` |
| 6 | T6 | C7 服务端：recap-dates 查询族 + /api/recap 路由 + cap 覆盖起点治理 | T2（db.js 相交，分节互不相扰；与 T3/T4/T5 文件不相交可并行） | `feat: C7 服务端——recap-dates 查询族+/api/recap 路由+cap 覆盖起点三元 max 治理` |
| 7 | T7 | C7 前端：recap 回顾视图 + how 口径补写 + usage-accounting 增补 | T6 | `feat: C7 前端——recap 回顾视图+how active hours 口径+usage-accounting §13` |
| 8 | T8 | C12 导出夹带：/api/export/:dataset（json/csv）+ usage-window 提取重构 | T6（recap 数据集依赖查询族）；T2-T7 全部完成后收尾（index.js 多次相交的最后触碰） | `feat: C12 导出夹带——/api/export/:dataset（json/csv）+usage-window 提取重构+schema_version 包络` |

- **文件相交与顺序**（判定标准＝文件不相交且依赖列无先后）：
  - `server/db.js`：T2 → T6 依序触碰（各自新增独立分节，互不改对方段）。**notify 取数 SQL 不进 db.js**（T4 内嵌 `server/notify.js`，livegen `createGenWatcher(dbq)` 内嵌先例同款——见 T4 锚点段）。
  - `server/index.js`：T2 → T4 → T6 → T8 依序触碰（每次只加自己的装配行）。
  - `public/index.html`：T3（chip）→ T5（通知 UI 若需）→ T7（nav/script）。
  - `public/app.js`：T3（signalsLoop）→ T5（notify 监听）。
  - `public/pet.html`：T3（summary 轮询）→ T5（notify 订阅+气泡）；`public/pet-state.js` 仅 T3。
  - `server/routes/usage.js` 仅 T8 触碰（提取重构）；`server/routes/recap.js` 仅 T6 触碰（T6 交付 `buildRecapPayload` 导出，T8 require 消费但**不改该文件**）；`test/helpers/fixture-db.js` 仅 T2 触碰。
  - `server/livegen.js` 仅 T2 触碰（导出在飞卫生窗两常量键，零行为变更——单一来源防 drift，见 T2）；`public/views/overview.js` 仅 T5 触碰（通知开关设置区）；`public/styles.css` **全任务零触碰**（样式一律复用既有类或元素内联 `style="…var(--…)"`，见文件结构总图 public/ 区注）。
- **可并行对**（仅文件面）：T1∥T2、T1∥T6、T3∥T6、T4∥T6、T5∥T6、T5∥T7。
- **回滚**：每任务一 commit；相交文件使 revert 必须**从新到旧**（先 T8 后 T7 …）；无持久化数据迁移，回滚后重启进程即恢复。

### 验收条目 → 任务映射

| 任务 | 覆盖验收条目 |
|---|---|
| T1 | R8-1、R8-2 |
| T2 | C6-1、C6-2、C6-3（API 面）、C6-5、C6-7（两路 SQL EXPLAIN+计时；fixture message 索引镜像前置） |
| T3 | C6-4、C6-6、C6-8（误报回放抽样）、C6-9（评审留痕） |
| T4 | C8-1、C8-2、C8-3、C8-7 |
| T5 | C8-4、C8-5、C8-6、C8-8（评审留痕） |
| T6 | C7-1~C7-5、C7-7 |
| T7 | C7-6、C7-8、C7-9（评审留痕） |
| T8 | C12-1~C12-7 |
| 收口（脚本） | GX-1、GX-2；C6-9/C8-8/C7-9 人工评审调度 |

---

## 文件结构总图（完成后新增/修改面）

```
zcode-monitor-plan/
├── README.md                                    # [T2/T4/T6/T8] routes 目录清单逐任务补一行
├── docs/
│   ├── plans/ecosystem-round2-batch2.md         # 本文件
│   ├── usage-accounting.md                      # [T7] 新小节 §13「recap 口径（C7 增补）」
│   └── acceptance/
│       ├── csp-verification.md                  # [T1] 两处过时字体域记载勘正（:35/:64）
│       ├── residuals.md                         # [T1] R-8 状态确认注记；[T2/T4/T5/T8] 新遗留入册（R-28 起）
│       └── round2-batch2-explain-timing.md      # [T1 新建（文件头），T2/T3/T4/T6 追加] 真实库 EXPLAIN/计时/误报抽样照录
├── server/
│   ├── db.js                                    # [T2] 新分节 ── Session signals ──；[T6] 新分节 ── Recap dates ──
│   ├── signals.js                               # [T2 新建] 纯函数分类器（不碰 IO）
│   ├── notify.js                                # [T4 新建] 规则引擎（makeNotifyEngine 工厂 + sharedBus）
│   ├── index.js                                 # [T2] /api/signals 装配；[T4] notify 单例；[T6] /api/recap；[T8] /api/export
│   └── routes/
│       ├── sessions.js                          # [T2] GET / 路由层合并 signal 字段
│       ├── signals.js                           # [T2 新建] GET /api/signals/summary
│       ├── live.js                              # [T4] per-connection 订阅 notify 转发（写头点不新增）
│       ├── recap.js                             # [T6 新建] GET /api/recap?period=；导出 buildRecapPayload（T8 require 消费、文件本身仅 T6 触碰）
│       ├── usage-window.js                      # [T8 新建] resolveWindow/wideWindowScope 提取（行为零变更）
│       ├── usage.js                             # [T8] 改 require 消费 usage-window
│       └── export.js                            # [T8 新建] GET /api/export/:dataset
├── public/
│   ├── index.html                               # [T3] 顶栏 waiting chip；[T5] 通知 UI；[T7] recap nav/script
│   ├── app.js                                   # [T3] signalsLoop chip 轮询；[T5] notify 监听
│   ├── styles.css                               # [全任务零触碰] 仅 index.html 引用（grep 实证 widget/pet 0 引用）；T3 徽标/chip、T5 通知卡、T7 recap 表样式一律复用既有类（badge/--sev-*）或元素内联 style="…var(--…)"（how.js:20-21 先例）——styles.css 保持零改动，文件清单不含它即不构成清单外修改
│   ├── pet-state.js                             # [T3] computeMood 接入 permission 位次（零新行动契约）
│   ├── pet.html                                 # [T3] /api/signals/summary 轮询+permHoldUntil；[T5] notify 订阅+气泡
│   ├── widget.html                              # [T5] notify 临时副行（页内 <style>，不经 styles.css）
│   └── views/
│       ├── overview.js                          # [T5] 通知开关设置区（视图尾部一角）
│       ├── sessions.js                          # [T3] 三态徽标+broken 叠加+needs-attention 置顶
│       ├── recap.js                             # [T7 新建] 「回顾」视图
│       └── how.js                               # [T7] active hours 口径段
└── test/
    ├── helpers/fixture-db.js                    # [T2] message 索引集镜像真库三索引
    ├── frontend-contract.test.js                # [T1] styles.css 无外联 @import 断言增补
    ├── signals.test.js                          # [T2 新建] 分类器+查询族+summary 端点+EQP
    ├── signals-view.test.js                     # [T3 新建] 前端源码契约+pet-state 行为
    ├── notify.test.js                           # [T4 新建] 规则引擎+防噪+SSE 事件+源码契约+EQP
    ├── notify-view.test.js                      # [T5 新建] 三页消费源码契约
    ├── recap.test.js                            # [T6 新建] 查询族+口径+路由+EQP
    ├── recap-view.test.js                       # [T7 新建] 视图源码契约+文档锚
    └── export-routes.test.js                    # [T8 新建] 白名单/转义/包络/钳界/头
```

---

## T1：R-8 字体终形——状态确认与守护（零行为变更）

**目标**：R-8 销账实况是**已由 `fix/r8-system-fonts` 轮完成并合入本批基线**（worktree 基线含 `6d979ae`，以 merge-base 确认命令为准（见下）——不引用具体 HEAD 短串，防基线前进后注记失实；规格 §2.5 定稿：本批对 R-8＝守护与状态确认，非重复实施）。本任务＝①基线含销账轮的确认命令；②`docs/acceptance/csp-verification.md` 两处过时字体域记载勘正（本会话实测仅此文件残留 fonts.googleapis/gstatic 字样——styles.css/pet.html/widget.html/http-hardening.js/README 均已 0 命中）；③`test/frontend-contract.test.js` R-8 契约块增补 styles.css 无外联 `@import` 断言（**现状勘正（本会话实读 :46-57）：widget/pet 两页的 `!/@import\s+url\(/` 形态断言已存在（:49），缺口仅 styles.css 一处——该文件现只查 Google Fonts 域名（:53），未钉 @import 形态本身**）；④residuals R-8 销账状态确认与日志注记。零行为变更。

**Files:**
- Modify: `F:/project/zcode-monitor-plan/docs/acceptance/csp-verification.md`
- Modify: `F:/project/zcode-monitor-plan/docs/acceptance/residuals.md`
- Modify: `F:/project/zcode-monitor-plan/test/frontend-contract.test.js`
- Modify: `F:/project/zcode-monitor-plan/docs/acceptance/round2-batch2-explain-timing.md`（本任务新建文件头——后续任务（T2 起）向此文件追加 EXPLAIN/计时/误报抽样记录）

**实施步骤:**
- [ ] 状态确认（R8-1，[命令] 照录进 `docs/acceptance/round2-batch2-explain-timing.md` 文件头（本任务建头）或本任务验收记录）：
  - `git -C F:/project/zcode-monitor-plan merge-base --is-ancestor 6d979ae HEAD` 退出码 0；
  - `grep -rn "fonts.googleapis\|fonts.gstatic" F:/project/zcode-monitor-plan/public F:/project/zcode-monitor-plan/server` 0 命中（预期，基线已清）；
  - `grep -n "@import" public/pet.html public/widget.html public/styles.css` 仅 widget.html:47 注释命中（styles.css 0 命中——本会话实测）。
- [ ] csp-verification.md 勘正（两处，保持验收记录的历史性质、不抹除 R2 时点事实）：
  - :35 的「R2 CSP 全文」代码块**保留原串**（R2 时点记录），紧跟一行勘正注：「2026-09-25 勘正（R-8 决策轮 `6d979ae`）：`style-src`/`font-src` 已撤销 fonts.googleapis.com/fonts.gstatic.com 白名单，面板至此零外联域；CSP 权威以 `server/http-hardening.js` 现态为准」；
  - :64 口径声明段「字体两域（fonts.googleapis.com / fonts.gstatic.com）仍外联，本地化取舍见 … R-8」改写为现态：「字体零外联（系统字体为最终形态，R-8 已销账，回归钉 `test/frontend-contract.test.js`）；样式/字体家族名保留为本地可选」。
- [ ] residuals.md：核对 R-8 行（:33）已是「**已销账（R-8 决策轮，2026-09-25）**」在位（本会话实测确认）——不改写销账内容；在文件头部日志区追加一行「2026-09-25（batch2 T1）：R-8 守护确认——`merge-base --is-ancestor 6d979ae HEAD` 退出码 0（基线含销账轮，merge-base 结论照录、不引用具体 HEAD 短串），csp-verification 两处过时记载勘正，styles.css 外联 @import 契约钉入 frontend-contract.test.js」。
- [ ] `test/frontend-contract.test.js` 的 R-8 测试块（:46-57）增补断言：`readPublic('styles.css')` 不匹配 `/@import\s+url\(/i`（styles.css 不得再出现任何外联 @import；widget/pet 两页的该形态断言已存在（:49），**本条只补 styles.css 一行、勿重复添加既有断言**；本地 `@import "foo.css"` 形态本仓不存在，若未来引入本地拆分文件则需同步修此断言——注释注明）。
- [ ] README.md 复核：`grep -n "fonts.googleapis\|fonts.gstatic\|Google Fonts" README.md` 已 0 命中（本会话实测），无需改动，照录确认即可。

**回归测试清单:**
- R8-2 守护钉：frontend-contract.test.js 既有零外联字体契约 + 新增 styles.css `@import url(` 断言随单文件跑绿：`cd F:/project/zcode-monitor-plan && node --test test/frontend-contract.test.js` 退出码 0。
- R8-1 的三条 [命令] 逐条执行并照录（见实施步骤第一条）。

**规格验收条目映射**：R8-1（命令全过）、R8-2（契约钉增补）。

**完成判据**：R8-1 三命令输出符合预期且照录在案；frontend-contract.test.js 单文件绿；csp-verification.md 与 http-hardening.js 现态一致（`grep -c "fonts.googleapis" docs/acceptance/csp-verification.md` 命中处均带勘正注语境）；README 无需改动已照录。零行为变更（无 server/public 运行时代码改动）。

---

## T2：C6 服务端——signals.js 分类器 + sessionsWithSignals 查询族 + 路由

**目标**：新建 `server/signals.js` 纯函数分类器（零 IO、node:test 直测）；`server/db.js` 新增 `── Session signals ──` 分节（在飞集合 + 近窗最新行两路查询，SQL 形状按规格 §2.1 需求 2 钉死的合规形态，绕开 §1.2 事实 5 的两处 GROUP BY 计划翻转）；`/api/sessions` 每行合并 `signal` 字段；新端点 `GET /api/signals/summary`（全库近窗域，无行数参数）；fixture message 索引集镜像真库三索引（规格 §1.2 事实 4 连带修复，EQP 机检前置）。

**Files:**
- Create: `F:/project/zcode-monitor-plan/server/signals.js`
- Modify: `F:/project/zcode-monitor-plan/server/db.js`（新分节置于 `── Context gauge ──` 分节之后、`module.exports` 之前）
- Create: `F:/project/zcode-monitor-plan/server/routes/signals.js`
- Modify: `F:/project/zcode-monitor-plan/server/routes/sessions.js`（仅 GET `/` 处理器）
- Modify: `F:/project/zcode-monitor-plan/server/index.js`（`/api` 路由区 :172-181 内加一行装配）
- Modify: `F:/project/zcode-monitor-plan/server/livegen.js`（仅 module.exports 增导出 `CREATED_WINDOW_MS`/`UPDATED_WINDOW_MS` 两常量键，零行为变更——单一来源，见下「在飞判据」锚点）
- Modify: `F:/project/zcode-monitor-plan/test/helpers/fixture-db.js`（message 索引镜像）
- Create: `F:/project/zcode-monitor-plan/test/signals.test.js`
- Modify: `F:/project/zcode-monitor-plan/docs/acceptance/round2-batch2-explain-timing.md`（T1 已建头，本任务追加）
- Modify: `F:/project/zcode-monitor-plan/README.md`（routes 目录清单补 signals.js 行）

**遵循的既有模式（锚点）:**
- 纯函数模块：`server/models-meta.js`（纯数据/纯函数、node:test 直测、无 IO）。
- 在飞判据：`server/livegen.js:63-72` 主查询（rowid 尾界 `MAX(rowid)-8000` + 卫生窗 created 5min/updated 90s + `json_extract` 判 assistant/completed-NULL）——**同款判据/卫生窗/rowid 尾界、同款无 GROUP BY，仅输出列换 `session_id`**；卫生窗常量 `CREATED_WINDOW_MS/UPDATED_WINDOW_MS`（livegen.js:46-47）**本任务加导出、查询族默认参数引该导出**（单一来源：两处在飞判据同窗同义，改窗必须同步——字面量双份定义会 drift，评审第 1 轮意见采纳）。
- INDEXED BY 强制 + sqlite_master 探测 + 回退记忆：`db.js` overviewKpis（:226-231 `conn._hasStartedModelIdx` 按连接记忆）。
- bare-column+MAX(rowid) 取最新伴随列：sessionList latestModel（db.js:567-576；注释原文＝「取 rowid 最大行＝写入序最新行，**非 MAX(input_tokens)**——后者会选『历史最大输入』」——引文照此，勿改述为 started_at）。
- 两段补齐 task_type：sessionList 页内 IN 寻址（db.js:547-566）。
- 小路由工厂 + index.js 装配：`makeUsageRouter` + `app.use('/api/usage', …)`（usage.js:26、index.js:181）。
- EQP 机检形态：`test/usage-queries.test.js`（fixture EXPLAIN QUERY PLAN 断言）。

**实施步骤:**
- [ ] **fixture message 索引镜像（先行，EQP 机检前置）**：fixture-db.js:94 的 `CREATE INDEX idx_message_session ON message(session_id)`（真库无此名索引，本会话 grep 证实仓内无其他引用）替换为真库两个二级索引（sqlite_autoindex_message_1 由 `id TEXT PRIMARY KEY` 自动产生无需手建，列序照真库）：
  ```sql
  CREATE INDEX message_session_time_created_id_idx ON message(session_id, time_created, id);
  CREATE INDEX message_session_sequence_idx ON message(session_id, sequence, time_created, id);
  ```
  **创建序照真库 rootpage 序**（fixture-db.js:60-66 建序教训：SQLite 在两个等效 session 前导覆盖索引间选「创建序最晚」者，建序即 EQP 保真度——batch1 R3 终审实证）：实施时实读真库 `sqlite_master` 的 rootpage 序（只读 SELECT，与既有 EXPLAIN 探测同族）并照录，fixture 按同序建这两条；本批 message 新查询全走 rowid 尾界不依赖该选择，但镜像保真度照 batch1 R3 惯例钉死（防回归备注）。注释注明出处（规格 §1.2 事实 4：真库 sqlite_master 实读，两索引 time_created 均为非前导第二列，时间谓词单独不可索引寻址）；同批核对 tool_usage/model_usage 索引集无同族漂移（现 fixture :35-36/:67-69 已对齐，照录核对结论）。
- [ ] **`server/signals.js` 纯函数分类器**：`classifySessions({ inflightSessions, recentModel, sessions, now }, { windowMs = SIGNALS_WINDOW_MS })` → 逐会话 `{ session_id, state, confidence, waiting_since, reason }`；`state ∈ working|waiting|idle|broken`。语义钉（规格 §2.1 需求 1 全文为准）：
  - 输入形状：`inflightSessions: Set<id>`、`recentModel: Map<id, {status, error_type, started_at, completed_at, rid}>`、`sessions: Map<id, {task_type}>`；常量 `SIGNALS_WINDOW_MS = 15 * 60_000` 可注入。
  - 判定序（§2.0 拍板 1）：working（在飞）> broken（近窗 error，**用 `started_at` 判新鲜、不用 completed_at**——NULL 比较永假会漏判）> waiting（时间启发式）> idle；在飞会话的近窗 error 行属既往回合不降级。
  - waiting 候选限 `task_type === 'interactive'`（§2.0 拍板 2，分类器入口过滤）；`waiting_since` = 该会话最新 completed 行的 `completed_at`（数据派生、无状态）；completed 行 `completed_at` 为 NULL → `waiting_since = null`。
  - 置信：working/broken=high、waiting=low、idle 的 `confidence` 与 `waiting_since` 均 **null（字段存在值为 null）**。
  - 模块头注声明：不碰任何 IO；`reason` 字段携带可读判定依据（供 hover/debug，字符串）。
- [ ] **db.js `── Session signals ──` 分节**（三条查询 + 一个组装，行数封顶常量 `SIGNALS_MAX_ROWS = 2000` 导出）：
  - `signalsInflightSessionIds({ createdWindowMs = livegen.CREATED_WINDOW_MS, updatedWindowMs = livegen.UPDATED_WINDOW_MS } = {})` → `Set<session_id>`：livegen 主查询同款（livegen.js:63-72 的 WHERE/rowid 尾界零改动），仅 SELECT 列换 `session_id`；默认参数引 livegen 导出常量（单一来源，默认值与 livegen 判据窗永不漂移）；**禁 GROUP BY/DISTINCT/子查询包裹**（三种写法真库 EQP 实测全部翻转为 `SCAN message USING INDEX message_session_time_created_id_idx`，规格 §1.2 事实 5①；合规形态 `SEARCH message USING INTEGER PRIMARY KEY (rowid>?)`，行数上界 ≤8000 有界）；JS 侧 `new Set()` 去重。
  - `signalsRecentModelLatest(sinceMs, { maxRows = SIGNALS_MAX_ROWS } = {})` → `Map<session_id, {status, error_type, started_at, completed_at, rid}>`：形状钉死——
    ```sql
    SELECT session_id, status, error_type, started_at, completed_at, MAX(rowid) AS rid
    FROM (SELECT session_id, status, error_type, started_at, completed_at, rowid
          FROM model_usage INDEXED BY model_usage_started_model_idx
          WHERE started_at >= @since
          ORDER BY started_at DESC
          LIMIT @cap)
    GROUP BY session_id
    ```
    INDEXED BY 强制 + sqlite_master 探测回退（overviewKpis 机制照搬：缺索引时回退无强制形态，回退形态披露登记 residuals——规格 §2.1 需求 2 取舍原文）；`ORDER BY started_at DESC LIMIT @cap` 截断保最新侧（无 ORDER BY 时 SQLite 按索引升序返回、截断保最老行，被截会话误判 idle）；外层 bare-column+MAX(rowid) 取写入序最新行。
  - `signalsSessionTypes(ids)` → `Map<id, {task_type}>`：session 表 `WHERE id IN (…)`（两段模式，sessionList :547-566 同款；基表主键寻址）。
  - `sessionsWithSignals({ sinceMs, sessionIds = null, windowMs } = {})` → 组装：sessionIds 传数组＝场景 (a) 页内域（/api/sessions）；null＝场景 (b) 全库近窗活跃域（recentModel keys 即活跃会话集，与任何行数参数无关）；依次调三条查询 + `classifySessions`，返回 `Map<session_id, signal>`。
- [ ] **`/api/sessions` 响应扩展（sessions.js GET `/`，:43-63）**：路由层调 `dbq.sessionsWithSignals({ sinceMs: Date.now() - SIGNALS_WINDOW_MS, sessionIds: page 内 ids })`，按 id 合并 `s.signal = {state, confidence, waiting_since, reason}`；无近窗活动的会话 `signal.state='idle'`（字段存在值为 idle）；sessionList 返回形状不动（additive）。窗口常量从 `server/signals.js` 导入（单一来源，防两处漂移）。
- [ ] **`server/routes/signals.js`**：`makeSignalsRouter()` 工厂（依赖注入可测形态，retentionDays 先例不适用——本路由无参数），`GET /summary` → 固定形状 `{waiting_count, broken_count, oldest_waiting_ms, generated_at}`；会话域＝全库近窗域（场景 (b)）；`oldest_waiting_ms = max(now − waiting_since)`（waiting_since 为 null 的会话不参与聚合——NaN 防护；无 waiting 会话时 0）；空库/空窗全零不抛错。index.js `/api` 路由区加 `app.use('/api/signals', makeSignalsRouter());`。
- [ ] README routes 清单（:246-252 区）补 `signals.js` 行。

**回归测试清单（test/signals.test.js，tmpdir fixture）:**
- C6-1 纯分类器单测：六分支逐项断言（(a) 在飞→working/high；(b) error+started_at 新鲜+不在飞→broken/high，**含 completed_at=NULL 的 error 行种子**；(c) interactive+completed 新鲜+不在飞→waiting/low 且 waiting_since=该行 completed_at；(d) 无近窗活动→idle 且 confidence===null、waiting_since===null（字段存在钉）；(e) subagent/workflow_child completed 新鲜→idle（task_type 过滤钉）；(f) 在飞且近窗 error→working（优先级钉））；`SIGNALS_WINDOW_MS` 注入小值可测；waiting_since NULL 边界（completed+completed_at=NULL 种子→null）。
- C6-2 查询族行为：fixture 构造（在飞 assistant 行新鲜/僵尸行 time_created 6min、error 行含 completed_at=NULL 形态、interactive completed 5min）→ 在飞集合恰含前者（卫生窗生效）；对抗样本（started_at 更早但 rowid 更大的晚落库行被取为最新——MAX(rowid) 语义守护）；`SIGNALS_MAX_ROWS` 注入小值截断保最新侧（旧行会话不因截断产生假信号）且不抛错；窗口参数注入生效（窗外行不计入）。
- C6-3 HTTP：`GET /api/sessions` 每行含 signal 字段（活跃/无近窗活动两形态）+ 既有字段断言不变（additive 钉，对齐既有 sessions-routes.test.js 的字段契约）。
- C6-5 HTTP：`GET /api/signals/summary` 固定形状四字段；分页域 vs 全库域分歧行构造（第 2 页会话 waiting）→ waiting_count 与全库域一致；空库 → 全零 + generated_at 存在 + 200。
- EQP 机检（fixture，usage-queries.test.js 形态）：在飞 SQL 断言含 `SEARCH message USING INTEGER PRIMARY KEY (rowid>`、近窗 SQL 断言含 `SEARCH model_usage USING INDEX model_usage_started_model_idx`，且均不含对基表的 `SCAN`。
- **[命令] C6-7（真实库只读，spec §5 模板）**：两路 SQL 各 EXPLAIN+计时（24h 与 15min 两档）→ ① message＝`SEARCH … INTEGER PRIMARY KEY (rowid>?)` 无 `SCAN message USING INDEX`；② model＝`SEARCH … model_usage_started_model_idx` 无 `SCAN … session_turn_idx`；照录 round2-batch2-explain-timing.md。

**规格验收条目映射**：C6-1、C6-2、C6-3（API 面）、C6-5、C6-7。

**完成判据**：`node --test test/signals.test.js` 退出码 0；既有全套相关文件（sessions-routes/frontend-contract/live-rowid/livegen-error——后两者因 livegen.js 加导出键而复核，导出为纯 additive 预期零影响）单跑不红（fixture 索引变更影响的既有测试若有失败，属本任务修复范围）；C6-7 EXPLAIN 记录在案且无翻转形态。

---

## T3：C6 前端——sessions 三态徽标与置顶 + 顶栏 waiting chip + 桌宠 waiting 行接线

**目标**：sessions 列表加 working/waiting/idle 三态徽标 + broken 叠加徽标 + needs-attention 置顶分组（排序稳定性与既有筛选交互）；waiting 低置信形态（虚线描边、文本不降对比）；顶栏 waiting chip（30s 轮询 /api/signals/summary）；pet-state.js 心情链接入 waiting_permission（零新行、只插位次）；pet.html 轮询驱动 permHoldUntil；误报真机抽样（C6-8）。

**Files:**
- Modify: `F:/project/zcode-monitor-plan/public/views/sessions.js`（renderList :110-155 区）
- Modify: `F:/project/zcode-monitor-plan/public/index.html`（顶栏 chip，freshness-chip/snapshot-alert 同区 :50/:54 之后）
- Modify: `F:/project/zcode-monitor-plan/public/app.js`（signalsLoop，healthLoop/snapshotLoop 同族）
- Modify: `F:/project/zcode-monitor-plan/public/pet-state.js`（computeMood :33-39 + 头注预留说明更新）
- Modify: `F:/project/zcode-monitor-plan/public/pet.html`（poll 区 :490-547 加 summary 轮询一条 fetch）
- Create: `F:/project/zcode-monitor-plan/test/signals-view.test.js`
- Modify: `F:/project/zcode-monitor-plan/docs/acceptance/round2-batch2-explain-timing.md`（C6-8 误报抽样照录追加）

**遵循的既有模式（锚点）:**
- 徽标色：类目色 + color-mix 8% 透明底（§6 第 3 条）；severity 色走 `--sev-*`（styles.css 双主题已定义）。
- chip 形态：freshness-chip（index.html:50 + app.js renderFreshnessChip）与 snapshot-alert（index.html:54 + snapshotLoop 30s）先例——fail-safe（数据获取失败静默隐藏，不告警）。
- 轮询周期 **30s**：waiting 是分钟级信号（spec 第 2 轮勘正：healthLoop 实测 5s 周期 app.js:221，原「healthLoop 同款 30s」数值失实；chip 降频 30s 足够）。
- pet 心情链：pet-state.js:25-32 预留接线三步（SSE 分派加 permHoldUntil；computeMood gen 之后插 `if (now < s.permHoldUntil) return 'permission';`；animFor :47 已备好映射）。
- pet 轮询先例：pet.html poll()（:490-547，每 5s `/api/widget/recent`）——summary 轮询随既有 poll 通道**另起一条 fetch**（pet.html:490-492 形态）。

**实施步骤:**
- [ ] **views/sessions.js renderList**：
  - 行内三态徽标位（working/waiting/idle）+ broken 红黄错误徽标叠加；**broken 会话的三态位渲染 idle 形态**（分类器四态、三态位只承三态，broken 可见性由叠加徽标独占）。
  - waiting 徽标低置信形态：虚线描边 + fg-3 及以上不透明文本色（半透明仅限徽标底色）；hover title 固定文案＝「启发式判定：最近一次模型活动正常收尾且当前无在飞请求——数据面无权限等待信号源，判定为时间启发式（可能误报）」（§2.1 需求 4 第 2 轮勘正文案，照抄——注意**不得含「待批/pending」字样**，新增 signal 代码段禁令）。
  - needs-attention 置顶分组：waiting/broken 会话置顶分组（组恒在最前，用户切换 tokens/calls 排序时**组位不变、组内改按当前排序键**——renderList 现有三键排序 :119-121 逻辑复用）；搜索/类型过滤作用于组与主列表同域，过滤后组空则整组不渲染（无空组头）；waiting 限 interactive（类型筛选非 interactive 时组必空不渲染）；排序在前端对 `listData` 实施、不改服务端排序语义。
  - 徽标装饰性元素静默降级先例：renderList 逐键热路径无 try/catch，signal 字段缺失（旧缓存/旧服务）时徽标不渲染不抛错（C2 mini 条 :137 同款纪律）。
- [ ] **顶栏 waiting chip**：index.html 顶栏加 `<a>`/`<div>` chip（freshness-chip 同款形态、`hidden` 初始、id 如 `waiting-chip`）；app.js 新增 `signalsLoop()`：30s 轮询 `/api/signals/summary`（复用 getJSON），`waiting_count>0` 显示（warn 语义色 `--sev-warn`）+ 文本「N 等待中」+ 点击跳 `#sessions` + hover title 含「最长等待 {oldest_waiting_ms 格式化}」（fmtFreshnessLag 的显示格式化先例可复用——60s/1h 显示阈值允许）；为 0 隐藏；获取失败静默隐藏（fail-safe）。boot 区（app.js:325-326 healthLoop/snapshotLoop 旁）加 `signalsLoop()`。
- [ ] **pet-state.js 接线**：computeMood 在 `if (s.gen) return 'gen';` 之后、sleep 之前插入 `if (now < s.permHoldUntil) return 'permission';`；头注「预留位次」说明（:25-32）更新为已接线（数据源＝/api/signals/summary 轮询，非 approval_status）；**ROW_ANIMS 9 行长度与次序零改动**（pet-state.test.js 既有契约）。
- [ ] **pet.html**：poll 循环内另起一条 `fetch('/api/signals/summary')`（5s 周期随 poll；失败静默），`waiting_count>0` 时 `st.permHoldUntil = Date.now() + WAITING_HOLD_MS`；`WAITING_HOLD_MS = 10000`（**≥2× 轮询周期 5s**——hold 不得短于两个轮询周期，`ERROR_HOLD_MS`(4s) 形态拒收；pet.html 侧常量、可调整）。
- [ ] 空态纪律：本任务新增 UI 无独立空态面（列表空态既有「无匹配会话」保留）。

**回归测试清单（test/signals-view.test.js）:**
- C6-4 源码契约：views/sessions.js 含三态徽标与 broken 叠加渲染代码（broken 三态位=idle 形态钉）、needs-attention 置顶排序代码（组位不变/组内排序键/空组不渲染的稳定锚）、waiting 置信标注命中「启发式」字样；**新增 signal 代码段不含「待批/pending」**（断言范围按 spec 钉：对徽标/置信/置顶/chip 相关代码段提取后断言，sessions.js 既有 7 处 pending 字样在范围外——:232-271/:586）；index.html 含 waiting chip 元素；app.js 含 `/api/signals/summary` 轮询与跳转代码。
- C6-6 行为+契约：node 侧 require pet-state.js——注入 `permHoldUntil` 未过期 + `gen=false` → `computeMood==='permission'` 且 `animFor('permission')==='waiting_permission'`；位次钉（gen 期间 gen 优先、error/tantrum 压过 permission）；`ROW_ANIMS.length===9` 且次序与基线一致；源码契约：pet.html 含 `/api/signals/summary` fetch 与 `permHoldUntil` 推进代码、`WAITING_HOLD_MS` 常量 ≥ 2×5000。
- C6-8 **[命令] 误报回放抽样（真实库只读）**：回放口径按 spec C6-8 全文（历史时刻 t ≤ now−30min 且在 30d prune 窗内；每会话 started_at 窗 `[t−SIGNALS_WINDOW_MS, t)` 取最新行 → interactive 且 completed → waiting 候选；在飞集合不可回放如实申报口径近似；后续判定＝`[t, t+2min)` 窗内有无新 model/tool 行，禁 message 时间谓词）；样本 ≥30 例（不足如实申报），误报占比 ≤20% 过线；超线处置二选一照录；**照录报告必须存在**（样本数/误报数/占比/口径近似声明/处置决策）于 round2-batch2-explain-timing.md。
- C6-9 [评审] 留痕：三态徽标+置顶+低置信双主题截图、overview 顶栏 chip 可见帧（waiting>0 态）、pet waiting_permission 真机帧 + 连续 15s 以上轮询期观察记录（hold 覆盖轮询间隙、无 sleep 抖动断裂）、置信标注 hover 文案——human-gate 留痕格式（Global Constraint 12），不虚构。

**规格验收条目映射**：C6-4、C6-6、C6-8、C6-9。

**完成判据**：`node --test test/signals-view.test.js` 退出码 0（含 pet-state.test.js 既有契约单跑仍绿）；C6-8 照录报告在案；C6-9 留痕文件在案（结论待人工）。

---

## T4：C8 服务端——notify.js 规则引擎 + SSE notify 事件

**目标**：新建 `server/notify.js` 规则引擎（`makeNotifyEngine({...})` 工厂、依赖全注入可测；四规则 + 独立参数与冷却窗；规则核心纯函数可单测）；process 级单实例、评估在自有定时 tick（默认 30s，unref'd）执行；触发经 EventEmitter 广播，live.js 每连接订阅转发 `event: notify` 帧（写头点不新增）；webhook 明确不做。

**Files:**
- Create: `F:/project/zcode-monitor-plan/server/notify.js`
- Modify: `F:/project/zcode-monitor-plan/server/routes/live.js`（events 处理器内订阅转发）
- Modify: `F:/project/zcode-monitor-plan/server/index.js`（process 级单例装配）
- Create: `F:/project/zcode-monitor-plan/test/notify.test.js`
- Modify: `F:/project/zcode-monitor-plan/docs/acceptance/round2-batch2-explain-timing.md`（C8-7 追加）
- Modify: `F:/project/zcode-monitor-plan/docs/acceptance/residuals.md`（notify 无回放边界 + per-rule 配置面登记，R-28 起）
- Modify: `F:/project/zcode-monitor-plan/README.md`（server 清单补 notify.js 行）

**遵循的既有模式（锚点）:**
- 工厂依赖注入：`makeHealthRoute`（health-route.js）/ `makeNotifyEngine` 同族；livegen 单实例装配先例（index.js:212 `createGenWatcher(dbq)`）。
- **取数落点（本任务钉死）：notify 取数 SQL 内嵌 `server/notify.js`**（livegen `createGenWatcher(dbq)` 先例：livegen.js:63-72/:94-103 内嵌 SQL + statement 缓存按连接身份键 + 依赖注入 dbq）——**不进 db.js**（db.js 仅 T2→T6 触碰，文件相交表与 T4∥T6 并行对据此成立；取数面仅本引擎消费，无第二调用方，无共享诉求）。
- 自有 tick + unref：livegen `setInterval(tick, pollMs)` + `timer.unref()`（livegen.js:176-177）。
- SSE 转发与退订：index.js /api/gen/events 的 `onEvent`/`off` 配对（index.js:241-248）——注意那是 livegen 自定义 onEvent 返回 off 闭包的形态；notify 用裸 EventEmitter，退订须**具名 listener 引用 + `.off` 同引用**（见实施步骤 SSE 条）。
- 窗计数 SQL：`overviewKpis` 的 `WHERE started_at >= @since` + SUM(CASE WHEN status='error')（db.js:191-213）。
- 会话内 SUM：`model_usage_session_turn_idx` 寻址（sessionList modelAgg db.js:559-562 同款 IN 寻址形态）。
- inactive 取数形状（本计划钉死，两路）——`latestModelRowid()`（db.js:875-877）只回 MAX(rowid) 数值、不含 started_at，**不够用**；本引擎取数为：
  - 最新行时间戳：`SELECT started_at FROM model_usage WHERE rowid = (SELECT MAX(rowid) FROM model_usage)`（rowid 尾点主键寻址 O(1)——append-only 表 rowid 最大即写入序最新行，latestModel 同语义的裸列版）；
  - 24h 窗曾有活动：`SELECT 1 FROM model_usage WHERE started_at >= @since LIMIT 1`（started_at 索引窗存在性探测，命中即止）。

**实施步骤:**
- [ ] **规则集与默认值（spec §2.2 需求 2 表为单一权威，常量全可注入）**：
  | 规则 | 默认开关 | 触发条件 | 冷却 | 内建强度 |
  |---|---|---|---|---|
  | error_burst | 开 | 5min 窗 error 行（model+tool）≥3 | 10min（全局） | sound |
  | waiting_timeout | 开 | interactive waiting 持续 ≥5min（持续=now−waiting_since，起点=C6 分类器派生口径） | 15min（per-session） | alert |
  | token_threshold | 关 | 单会话 30d 窗累计 `SUM(computed_total_tokens)` ≥1M | 每会话每档位一次（1M/5M/20M） | quiet |
  | inactive | 关 | 全库无 model 行 ≥30min 且 24h 窗内曾有活动 | 60min | quiet |
  token 阈值取数＝近窗活跃会话集合（C6 查询输出）经 session 复合索引会话内 SUM；**禁止全表 GROUP BY session 无界聚合、不建 C3 模块**；气泡文案/How 披露「按 30 天保留窗口径」。
- [ ] **引擎形态**：`makeNotifyEngine({ dbq, signals, windowMs…常量族, bus } = {})` 返回 `{ emitter, evaluate, tick, stop }`；**评估不在任何请求路径、不在 live.js 的 per-connection poll 内**；规则核心评估抽纯函数 `evaluateRules({ errorCounts, waitingSessions, sessionTokens, lastModelRow, now }, config)` 可单测（输入由引擎的取数层从 db 拉取——取数 SQL 全走 started_at 索引窗/rowid 尾界/会话复合索引，单次评估有行数上界）；waiting_timeout 消费 C6 分类器输出（引擎内直接调 `dbq.sessionsWithSignals` 全库域 + `classifySessions`，无 HTTP 自环）。
- [ ] **冷却**：每规则独立冷却窗，冷却时间戳内存态（维度＝全局/per-session/每档位一次）；冷却只拦发送行为、不改条件评估结果（C8-1/C8-2 两断言面对象不同）。
- [ ] **SSE notify 事件**：`server/notify.js` 提供模块级共享 bus（`sharedNotifyBus()` 返回 process 级单例 EventEmitter——**live.js 不工厂化**：live-rowid.test.js:22/:113 直 require 挂载是既有契约，工厂化会连带改既有测试，非必要不扩大改动面；live.js 自身本就有模块级状态先例 :24-25）。live.js `/events` 处理器内**具名 listener 引用**（裸 EventEmitter 的 `.on` 返回 emitter 本身、不是退订函数，匿名箭头函数事后无法 `.off`——与 index.js:241 的 livegen 自定义 onEvent 返回 off 闭包是不同形态，「同语义」仅语义层成立）：
  ```js
  const onNotify = (payload) => res.write(`event: notify\ndata: ${JSON.stringify(payload)}\n\n`);
  sharedNotifyBus().on('notify', onNotify);
  // req.on('close') 内：
  sharedNotifyBus().off('notify', onNotify);
  ```
  `req.on('close')` 内退订；**写头点保持 2 处**（live.js:29 与 index.js:226，零新增）。index.js 装配 process 级单例（`createNotifyEngine` 于 genWatcher 旁）；**SIGINT/SIGTERM 处理器（index.js:253-254）同步加 `notifyEngine.stop()`**——与 genWatcher/snapshotWatcher teardown 惯例对齐（timer 本 unref'd 不阻塞退出，纯惯例对称，评审第 1 轮意见采纳）。
- [ ] **载荷契约**：`{id, rule, title, body, severity, at, session?}`；`` id = `${rule}:${session ?? 'all'}:${at}` ``（本地模板串，零新依赖）；severity 映射钉：error_burst→err、waiting_timeout→warn、token_threshold→warn、inactive→ok（severity 管视觉色、强度管通道，两正交轴）；`session` 字段仅 per-session 规则携带；`body` 含库内字符串（服务端生成仍视为不可信输入——消费侧消毒，T5）。
- [ ] **回放边界声明**：notify 是即发即失事件（live.js per-connection 水位不回放）——连接前/断线间隙触发的提醒永久错过，兜底＝顶栏 waiting chip 轮询 + sessions 刷新；登记 residuals（R-28 起）。per-rule 用户自定义配置面 v1 不提供，一并登记。
- [ ] residuals/README 增补。

**回归测试清单（test/notify.test.js，依赖注入 fixture 数据源 + HTTP 挂载）:**
- C8-1 触发语义：error_burst 5min 窗 ≥3 触发/2 行不触发；waiting_timeout 仅 interactive 且 now−waiting_since ≥5min 触发（subagent waiting 不触发；无状态钉——注入两次相同输入**条件评估结果**一致，引擎不维护 per-session 首次判定时刻 Map）；token_threshold 1M 档触发一次、5M 档再触发（每档一次）；inactive 有历史活动（24h 窗内曾有 model 行）+ 无新行 ≥30min 触发。
- C8-2 防噪：同规则冷却窗内第二次满足条件不再发（error_burst 全局 10min、waiting_timeout per-session 15min 独立——A 会话触发不占 B 会话冷却）；不同规则互不冷却；默认值钉（四规则 on/off、冷却时长、强度与 §2.2 需求 2 表逐项相等——常量导出断言）。
- C8-3 SSE 事件：挂载 /api/live/events 客户端 + 触发规则 → 收到 `event: notify` 帧、载荷含六字段（id 形如 `rule:session:at`、severity 映射断言）、session 字段仅 per-session 规则携带；连接关闭后退订（无泄漏断言——bus.listenerCount 归零）；源码契约：`grep -rn "text/event-stream" server/` 命中数仍为 **2**；notify.js/live.js 无评估调用点在 live.js 内。
- C8-7 **[命令] 真实库 EXPLAIN**（spec §5 模板）：error_burst 窗计数（model+tool started_at 窗）、token 阈值会话内 SUM（session_turn_idx）、inactive 两路（rowid 尾点最新行 started_at + started_at 窗存在性探测——形状见锚点段 inactive 条）；waiting 判定复用 C6 查询族（C6-7 判据）无独立时长 SQL；无 SCAN；单次评估 tick 总耗时照录；源码契约：notify.js 无全表 GROUP BY session 形态。

**规格验收条目映射**：C8-1、C8-2、C8-3、C8-7。

**完成判据**：`node --test test/notify.test.js` 退出码 0；live-rowid.test.js 既有测试单跑仍绿（live.js 改动零破坏）；C8-7 EXPLAIN/计时照录在案；residuals 两条登记（无回放边界 + per-rule 配置面）。

---

## T5：C8 前端——三页消费通知（Notification/WebAudio/桌宠气泡）

**目标**：overview（index.html/app.js 通知面 + 浏览器 Notification + WebAudio 短提示音）、widget.html（轻量临时副行）、pet.html（气泡）三页消费 SSE `notify` 事件；每规则内建强度 × 前端三开关的降级矩阵；幂等去重双保险；文本消毒。

**Files:**
- Modify: `F:/project/zcode-monitor-plan/public/index.html`（通知面 UI 元素——若全部动态创建则仅 app.js）
- Modify: `F:/project/zcode-monitor-plan/public/app.js`（notify 监听 + 通知面 + 开关）
- Modify: `F:/project/zcode-monitor-plan/public/views/overview.js`（通知开关设置区——视图尾部一角注入，见实施步骤）
- Modify: `F:/project/zcode-monitor-plan/public/widget.html`（notify 订阅 + 临时副行）
- Modify: `F:/project/zcode-monitor-plan/public/pet.html`（增订阅 `/api/live/events` 的 notify 事件 + 气泡）
- Create: `F:/project/zcode-monitor-plan/test/notify-view.test.js`

**遵循的既有模式（锚点）:**
- SSE 订阅：widget.html:333（`new EventSource('/api/live/events')` + addEventListener）——pet.html 增订阅同款先例（spec §2.0 拍板 3）；overview 页经 views/overview.js:456 同款（本任务在 app.js 层全局订阅，切页不断流——通知是全局面非视图面）。
- **widget 临时副行（先例勘正＋新形态钉死，评审第 1 轮 major 意见采纳）**：spec §2.2 需求 4 所引「batch1 C2 缓存命中副行同款通道」**失实**——本会话实读 widget.html:399-411，C2 副行在 `.tip` 悬浮卡文本内（:404），`.tip` 是 position:fixed/pointer-events:none 的 **hover 悬浮卡**（:158-174），由 pointerenter 400ms 延迟触发（:419）——hover 才可见，而 C8 用户故事是「用户不在屏幕前时提醒才有意义」，tip 通道对 notify 场景**不可见**。实施口径勘正如下（语义仍满足 spec 需求 4 的「速度数字行下方的临时副行」正文——spec 的错误仅在先例引用，实施按本条）：窗体常驻 DOM 新增一个副行容器元素，置于速度数字行下方（壳窗 280×56 的数字行下方空带，页内 `<style>` 块加样式——absolute 定位锚数字行下方、初始 `display:none`），notify 事件到达时以 `textContent` 填充 severity 语义色文本（severity→语义色映射经 CSS 变量/内联 var()，勿硬编码色值）、显示 8s 后淡出、多条只显最新一条；**不弹窗、不加宽窗体**（胶囊单行窗左锚定+nowrap 契约 widget.html:60-70）。此为**本批新增 UI 形态**（窗体常驻副行），非任何既有通道复用。
- 气泡消毒：`window.SanitizeSpeech`（sanitize.js:15 双端导出；widget.html:411 消费先例）——pet 气泡文本一律过 `public/sanitize.js`。**消毒语义勘正（评审第 1 轮 major 意见采纳）**：sanitize.js 是隐私剥除闸**不是 HTML 消毒器**（其头注 :4-7/:11-12 显式声明：`<img onerror>` 类 HTML 事件属性是已知盲区，消费方一律 textContent 渲染、无 XSS 面）——防注入的真正闸门是**渲染出口用 textContent**（widget.html:411 `tip.textContent = …` 同款形态），两闸正交、缺一不可。
- toast 形态：app.js `toast()`（既有导出）可作 index 通知面基底。

**实施步骤:**
- [ ] **前端配置面 v1 三开关**（localStorage 持久化，key 自定如 `zc-notify-sound`/`zc-notify-desktop`/`zc-notify-tts`）：声音默认**开**、系统通知默认**关**、TTS 默认**关**（Web SpeechSynthesis 内置）；开关 UI 挂 overview 页一角（轻量，勿新建导航页）——**注入路径钉死（评审第 1 轮意见采纳）：改 `public/views/overview.js`**（overview 视图 DOM 由该视图渲染——app.js:172/:179 registerView/`views[name]` 分发、无渲染后 hook，app.js 侧注入须自造时机），在视图模板尾部追加一个轻量设置小卡（三开关，内联 `style="…var(--…)"`——styles.css 零改动纪律）；开关状态读写经 window.ZC 暴露的小助手或视图内自持（app.js 的 notify 消费侧读同一 localStorage key，文件相交序 T5 内自洽）。
- [ ] **降级矩阵（三页统一实现）**：实际呈现＝内建强度 ∩ 已开启通道；alert 在系统通知关（声音开）时＝提示音+气泡（出厂默认形态）；声音再关时＝仅气泡；sound 同理降为气泡；**气泡是三页恒在的底线通道（不受开关控制）**。实现抽共享小函数（app.js 侧定义，pet/widget 各自内联同语义实现——两页不引 app.js，语义钉用注释+源码契约测试对齐）。
- [ ] **Notification API 姿态**：`Notification.requestPermission` 调用仅在用户显式开启系统通知开关的路径可达（默认态页面加载**不请求权限**）；授权拒绝回落（开关状态如实呈现、不重弹）。
- [ ] **WebAudio 短提示音**：`AudioContext` oscillator 内置合成（零外联、零音频资源文件；音量克制——gain 低值如 0.05-0.1 量级、时长 <0.3s）。
- [ ] **幂等去重**：前端按载荷 `id` 记忆已呈现通知（有界 Set/Map，防长开标签无界增长），服务端冷却之外的双保险。
- [ ] **pet.html**：增订阅 `/api/live/events`（openSSE 旁另起 EventSource 或复用——pet 现只订 /api/gen/events:523，新开一条 `/api/live/events` 订 notify 事件）；alert/warn 级走气泡（SanitizeSpeech 消毒）+ 提示音（受声音开关）；连接失败静默（poll 数据面兜底）。
- [ ] **widget.html**：订阅 `/api/live/events` 的 notify 事件（:333 既有 EventSource 上 addEventListener('notify') 零新连接）；临时副行渲染（形态按锚点段勘正口径：窗体常驻副行容器、数字行下方、**文本一律 textContent 写入**——与 tip 通道的 `tip.textContent` 同款渲染纪律，C8-5 契约锚）。
- [ ] TTS：`speechSynthesis` 调用被 TTS 开关守卫且默认 false；无 TTS 引擎/network 资源引用。

**回归测试清单（test/notify-view.test.js，源码契约，frontend-contract.test.js readPublic 形态）:**
- C8-4：三页均含 notify 事件监听与呈现代码；提示音走 WebAudio（无外部音频资源引用——`\.mp3|\.wav|\.ogg|Audio\(` 外联资源正则 0 命中）；`Notification.requestPermission` 仅在开关开启路径可达（源码形态断言：调用点与开关判定同分支）；三开关默认值钉（声音开/通知关/TTS 关）；降级矩阵钉（三页呈现代码实现「alert∩通道」逻辑且气泡通道不受开关控制）；widget 呈现形态＝数字行下方临时副行（不弹窗、不改单行窗布局契约——8s 淡出与多条只显最新可 grep 锚）。
- C8-5 消毒行为（断言面按 sanitize.js 实际行为面钉死——评审第 1 轮 major 意见采纳：sanitizeSpeech 无 HTML 标签/引号剥除规则（RULES 全表仅 URL/凭证/路径/密钥），`<img>` 与引号在输出中原样存活，**不得断言其不存活**——照抄旧措辞必挂或诱导超范围改 sanitize.js；防注入的真正闸门是 textContent 渲染出口）：
  - 换行收敛断言（sanitize 实际行为）：node 侧 require `public/sanitize.js`，`sanitizeSpeech('a\nb')` 输出无 `\n`（`\s+` 收敛为单空格，sanitize.js:95）；隐私剥除面沿用既有 `test/sanitize.test.js`，不重复建设。
  - 渲染出口源码契约（防注入真闸门）：pet 气泡与 widget 副行的文本写入点均为 `textContent` 赋值形态（widget.html:411 `tip.textContent = window.SanitizeSpeech ? …` 同款——断言两页消费代码含 `textContent` 字样且不含 `innerHTML`/`insertAdjacentHTML` 写入通知文本）。
  - spec C8-5 原文（specs:224）与本断言面的张力照此勘正口径消化，差异在验收记录注明。
- C8-6 TTS 钉：`speechSynthesis` 调用被 TTS 开关守卫且默认 false；无 TTS 引擎/network 资源引用。
- C8-8 [评审] 留痕：三页提醒呈现双主题截图（pet 气泡+消毒文本样例、widget 副行胶囊形态、index 通知卡/toast）；出厂默认形态（系统通知关）下 alert 级实际呈现=提示音+气泡照实态核对；系统通知授权流人工复验一次；防噪默认值表照 UI 实态核对——human-gate 留痕。

**规格验收条目映射**：C8-4、C8-5、C8-6、C8-8。

**完成判据**：`node --test test/notify-view.test.js` 退出码 0；C8-8 留痕文件在案（结论待人工）。

---

## T6：C7 服务端——recap-dates 查询族 + /api/recap 路由

**目标**：db.js 新增 `── Recap dates ──` 分节（本地日界日桶聚合、5min 活动桶并行去重、Top focus 行级桶聚合+JS 归并、会话区间拉取、cap 覆盖起点 MIN+rowid 尾界形态）；新路由 `server/routes/recap.js`（period 白名单与回退、period_start 本地日界、规模治理并入 R-22 同治、meta 覆盖披露三元 max；装配函数 `buildRecapPayload` 导出供 T8 同源消费）；index.js 装配。

**Files:**
- Modify: `F:/project/zcode-monitor-plan/server/db.js`（新分节置于 Session signals 分节之后）
- Create: `F:/project/zcode-monitor-plan/server/routes/recap.js`
- Modify: `F:/project/zcode-monitor-plan/server/index.js`（/api 路由区装配）
- Create: `F:/project/zcode-monitor-plan/test/recap.test.js`
- Modify: `F:/project/zcode-monitor-plan/docs/acceptance/round2-batch2-explain-timing.md`（C7-7 追加）
- Modify: `F:/project/zcode-monitor-plan/README.md`（routes 清单补 recap.js 行）

**遵循的既有模式（锚点）:**
- 本地日界：`startOfDayMs`（db.js:166-170）；tz 注入使测试与宿主机时区无关（R2 跨午夜用例先例）。
- 工厂+窗口治理：`makeUsageRouter({ retentionDays })`（usage.js:26）+ `wideWindowScope` 的 30d cap `meta.scope` 申报（usage.js:20-24）；R-22 重测触发线。
- rowid 尾部候选集钳制：`USAGE_CANDIDATE_CAP_ROWS` + `WHERE rowid > (SELECT MAX(rowid) FROM …) - @cap`（slowTools 的 `window=all 候选集钳制` 分节 db.js:802 起 / usage 族 db 层既有机制直接复用，宽窗 ≥8d 判定）。
- INDEXED BY 强制 + 探测回退：overviewKpis 机制（db.js:226-231）。
- session→directory 映射：sessionList 页内 IN 寻址（db.js:547-576，两段先例的**第二段**形态——recapTopFocus 的 session→directory 一次寻址复用此形态；注意其第一段 GROUP BY session_id 聚合形状不适用于 top-focus，见查询族条目形状重钉说明）。
- 路由装配位置：`/api` 路由区（index.js:172-181）——**错误翻译层（:287）与终端消毒器（:300）注册序在全部 /api 路由之后，新路由挂路由区即自动被罩**（勿挂到翻译层之后）。

**实施步骤:**
- [ ] **查询族（db.js 新分节，token 口径一律 `SUM(computed_total_tokens)`）**：
  - `recapDailyUsage(sinceMs, { tzMs })`：model_usage started_at 索引窗 → SQL 侧 `(started_at + @tzMs)/86400000` 整除日桶；每桶 tokens=SUM(computed_total_tokens)/calls/sessions COUNT DISTINCT。分桶表达式 GROUP BY 不匹配索引最左列、恒走 started_at SEARCH + TEMP B-TREE（安全形态，注释照录防改列式分桶引入 session 前导列）。
  - `recapActivityBuckets(sinceMs, { tzMs })`：同窗行投 5 分钟桶 `GROUP BY (started_at+@tzMs)/300000`，每桶 COUNT(DISTINCT session_id)——activeMinutes=有活动的桶数（跨会话去重即并行去重）、`parallel_max/parallel_avg` JS 由桶级分布派生（§2.0 拍板 5 week/month 档事件级口径）；事件源不用 message 表（无时间索引）。
  - `recapTopFocus(sinceMs, { tzMs, capRows = null })`：**形状重钉（评审第 1 轮 major 意见采纳）**——by-directory 的 `activeMinutes` 是 directory 级跨会话去重 5min 桶数，`GROUP BY session_id` 单段聚合在数据上产不出该维度；且「先截会话 Top N 再归并」会让 directory 级 tokens/calls 被会话截断污染。正确形状＝**行级 (session_id × 5min 桶) 聚合 + JS 归并**：
    ```sql
    SELECT session_id, (started_at + @tzMs) / 300000 AS bucket,
           COUNT(*) AS calls, SUM(computed_total_tokens) AS tokens
    FROM model_usage
    WHERE started_at >= @since            -- 窄窗（week）：INDEXED BY model_usage_started_model_idx 强制
    -- 宽窗（month/year，窗宽 ≥8d 判定）改：NOT INDEXED
    --   AND rowid > (SELECT MAX(rowid) FROM model_usage) - @cap
    GROUP BY session_id, bucket
    ```
    JS 归并（**对全部窗口行涉及的 session ids，不做会话级 Top N 截断**；session→directory 映射经 session 表页内 `WHERE id IN (…)` 一次寻址——ids 集合有界（≤窗口行集去重会话数），directory 数远小于会话数）：per-directory `tokens=Σtokens`、`calls=Σcalls`、`sessions=DISTINCT(session_id) 数`、`activeMinutes=DISTINCT bucket 数（跨会话去重——同桶两会话只计一次，与 recapActivityBuckets 口径一致）`；**Top N 截断只在 directory 级归并完成后排序取前 N**（截断不污染任何聚合计数）。
    - 窄窗（week）：`INDEXED BY model_usage_started_model_idx` 强制（无强制则翻转为 `SCAN … model_usage_session_turn_idx` 全索引扫，规格 §2.3 需求 1 实测 1250ms vs 强制后 167.8ms；sqlite_master 探测+回退同 overviewKpis）。
    - **宽窗（month/year，窗宽 ≥ USAGE_CAP_WINDOW_MS=8d 判定，db.js:1022 既有常量）：`NOT INDEXED` 钉死计划 + rowid 尾部候选集钳制 `rowid > (SELECT MAX(rowid) FROM model_usage) - @cap AND started_at >= @since`**（batch1 已实证形态：30d 全窗逐行回表聚合热态 653-820ms/冷态至 4.5s 超 500ms 触发线；不钉 NOT INDEXED 时 planner 会为省 GROUP BY 的 TEMP B-TREE 改走 session 索引全扫、cap 形同虚设——db.js:1001-1007 注释原文形态，照抄即合规）；month 档（本月 1 日起、最长 31d）必然落入宽窗语义；`meta.scope` 同 usage 族申报。**INDEXED BY 强制只用于窄窗——禁止在 ≥8d 宽窗照抄强制形态**（评审第 1 轮 major 意见采纳）。
  - `recapSessionSpans()`：session 表 `time_created/time_updated` 区间拉取（**基表 SCAN，A2-3 出路条款管辖**——1.84 万行小表，计时照录、机检显式滤出）→ JS 侧 interval union（year 档活动上界口径）。
  - `recapCapCoverageStart({ capRows = USAGE_CANDIDATE_CAP_ROWS })`：`SELECT MIN(started_at) FROM model_usage WHERE rowid > (SELECT MAX(rowid) FROM model_usage) - @cap`——**MIN+rowid 尾界形态钉死**（OFFSET 形态实机 EQP=SCAN model_usage 133.6ms 是第 2 轮实证反例；MIN 形态 `SEARCH … COVERING INDEX model_usage_started_model_idx` 15.2ms、零近似）；可按 tick 缓存。
- [ ] **路由 `makeRecapRouter({ retentionDays = 30, now, tzOffsetMinutes } = {})`**：`GET /api/recap?period=week|month|year`——period 缺省 week、未知值回退 week 且回显 `'week'`（resolveWindow 先例）；period_start＝week=now−7d、month=本月 1 日（本地）、year=本年 1 月 1 日（本地）（now/tz 注入可测）。**装配函数导出（评审第 1 轮 major 意见采纳，T8 同源消费的前置交付物）**：数据装配抽为模块级导出函数 `buildRecapPayload({ period, now, tzOffsetMinutes, retentionDays })` → 完整响应对象（period 白名单/回退、period_start 本地日界、各查询族调用、meta 三元 max 组装**全在此函数**）；`makeRecapRouter` 为薄壳——query 解析 → 调 `buildRecapPayload` → `res.json`。`module.exports = { makeRecapRouter, buildRecapPayload }`（T8 的 export.js require 消费 buildRecapPayload，**recap.js 文件 T8 不触碰**——文件相交表据此钉「recap.js 仅 T6 触碰」）。
- [ ] **规模治理（R-22 同治）**：week 档走 started_at 精确窗；month/year 档 token/活动桶**与 top-focus**一律走 `USAGE_CANDIDATE_CAP_ROWS` 同款 rowid 尾部候选集钳制 + `NOT INDEXED` 钉死计划（db 层既有机制直接复用；top-focus 的宽窗分支见其形状条目），`meta.scope` 如实申报。
- [ ] **响应 meta**：必含 `retention_days=30`、`period`、`period_start`（ISO）、`tz_offset_minutes`、`token_coverage_from`（ISO）＝**max(period_start, now−30d, cap 覆盖起点)**（三元 max 唯一诚实公式；cap 未生效时该元取 now−30d 语义值）。
- [ ] **year 档语义**：token 类字段 **null**（不伪造 0，30d prune 外无数据源）；活动时长＝`recapSessionSpans` 区间并集（标注上界性质含挂机时间）；环比仅 week 档（§2.0 拍板 6）。
- [ ] **日桶生成边界**（路由/视图共同契约，数据侧在路由生成）：日桶序列自 `token_coverage_from` 对齐的本地自然日起生成——coverage 之前的 period 内日期**不产出桶行**（不伪造 0 桶）；coverage 之内无活动的日期产出**真 0 桶**（tokens=0/calls=0）。
- [ ] index.js 装配 `app.use('/api/recap', makeRecapRouter());`（/api/usage 旁）；README 补行。

**回归测试清单（test/recap.test.js）:**
- C7-1：跨日界行（注入固定 tz UTC+8：行 A 某日 23:50、行 B 次日 00:10）→ 两行分属不同日桶、桶键与注入 tz 一致（tz 注入使测试与宿主机时区无关）。
- C7-2：三会话（A/B 同一 5min 桶各有行、C 相邻桶）→ activeMinutes=2（同桶跨会话去重）、parallel_max≥2、parallel_avg 与构造一致。
- C7-3 HTTP：`?period=week|month|year` 回显正确、period_start 分别为 now−7d/本月 1 日/本年 1 月 1 日（注入固定 now/tz）；`?period=year!` 回退 week 且回显 'week'；缺省=week。
- C7-4：`meta.retention_days===30`、`token_coverage_from` 为 ISO 且等于三元 max（构造 cap 极小值使覆盖起点晚于 now−30d，断言其参与取值右移）；month/year cap 生效时 `meta.scope` 申报；日桶边界钉（coverage 前无桶行、coverage 内无活动日真 0 桶）；`?period=year` token 类字段 null；环比字段仅 week 档存在。
- C7-5：两 directory 各两会话已知 token 行（**含跨会话同 5min 桶与不同桶的对照构造**）→ by-directory 归并 tokens/calls/sessions/**activeMinutes** 四字段逐项相等（activeMinutes 构造期望值＝两 directory 各自的去重桶数——同桶两会话只计一次，钉跨会话去重口径）；空窗 → 空数组 + meta 完整不抛错。
- EQP 机检（fixture）：日桶/5min 桶/top-focus **（窄窗 INDEXED BY 强制与宽窗 NOT INDEXED+rowid cap 两形态各检一路）**/cap 覆盖起点各 SQL 计划断言——无对基表 SCAN（TEMP B-TREE 允许；session 基表 SCAN 进显式排除集，batch1 先例）。
- **[命令] C7-7 真实库 EXPLAIN+计时**（week 精确窗与 month cap 形态两档）：无 SCAN（session 基表 SCAN 显式滤出并计时照录；cap 覆盖起点须为 MIN+rowid 尾界形态）；month 档聚合实测 **>500ms** 时「cap 保留/放宽」取舍记录必须存在（C1-6 同款触发线）——照录 round2-batch2-explain-timing.md。

**规格验收条目映射**：C7-1、C7-2、C7-3、C7-4、C7-5、C7-7。

**完成判据**：`node --test test/recap.test.js` 退出码 0；C7-7 EXPLAIN/计时/取舍记录在案且 cap 覆盖起点为 MIN+rowid 形态。

---

## T7：C7 前端——recap 回顾视图 + how 口径补写

**目标**：新建 `public/views/recap.js`「回顾」视图（Top focus 表/每桶要点/8 周 sparkline/环比/覆盖披露卡，双主题 CSS token）；app.js 视图注册与导航；how.js 补 active hours 口径段；usage-accounting.md 新增 §13「recap 口径（C7 增补）」。

**Files:**
- Create: `F:/project/zcode-monitor-plan/public/views/recap.js`
- Modify: `F:/project/zcode-monitor-plan/public/index.html`（nav 增 `data-view="recap"` 条目 + `<script src="/views/recap.js">` 追加在 views script 块内）
- Modify: `F:/project/zcode-monitor-plan/public/views/how.js`（「数据保留窗口」卡后补 active hours 口径段）
- Modify: `F:/project/zcode-monitor-plan/docs/usage-accounting.md`（新小节 §13）
- Create: `F:/project/zcode-monitor-plan/test/recap-view.test.js`

**遵循的既有模式（锚点）:**
- 视图 IIFE + registerView：views/usage.js（batch1 T4 先例）`(function () { const { registerView, … } = window.ZC; … registerView('recap', view); })()`。
- 窗口选择器（period 三档 week/month/year）+ fetch `/api/recap?period=`。
- sparkline 色值经 `cssVar('--chart-` 读取（app.js:109 通道）+ 主题切换重绘 `window.addEventListener('zc-theme-changed', rerender)`（batch1 C5 先例）；**零图表库**（div/SVG 条形，attribution.js 火焰图同款纪律）。
- 空态：`window.ZC.emptyState`；30d 边界与空窗如实标注。
- how.js 静态模板分节形态（h2 + card，「数据保留窗口」卡先例，本会话实读 :36-41 区）；口径出处注释风格对齐仓内既有 how 条目。

**实施步骤:**
- [ ] **视图结构**（period 选择 → 数据 fetch）：
  - Top focus：按 directory 聚合表（tokens/calls/sessions/activeMinutes，tabular-nums）。
  - 每桶要点：**week/month 档三要点**（最活跃日/最大 token 日/错误计数日）；**year 档降级两要点**（最活跃日/错误计数日——token 字段 null 时「最大 token 日」不存在，不渲染不占位）。
  - 日桶 sparkline：8 周窗口（`--chart-*` 经 cssVar、主题联动重绘）；**无桶日期不从左邻插值**（覆盖披露卡与 sparkline 空洞对齐）。
  - 环比：仅 week 档（token+活动两维）；month/year 档注明原因（前一周期数据不可保证完整）。
  - 覆盖披露卡（常驻）：「token/请求维度自 {token_coverage_from} 起可读（官方 30 天保留{，cap 生效时追加：候选集上限 N 行、实际覆盖如上}）」；month/year 另注 cap 申报；year 档活动时长标注「会话区间上界口径（含挂机时间）」。
  - 空态经 `window.ZC.emptyState`；**色值禁令**（新文件全文）：无 `#[0-9a-f]{3,6}`、无 `rgba?(`/`hsla?(`、无具名色名单（batch1 C5-3 判据同款）。
- [ ] **index.html**：nav 增 `<a data-view="recap">回顾</a>`（usage/attribution 之后、raw 之前）；script 块内加 `<script src="/views/recap.js"></script>`。
- [ ] **how.js**：补 active hours 口径段——本地日界/5 分钟桶/跨会话去重（并行会话同桶只计一次）/「N× parallel」派生/会话区间上界口径/30d 覆盖与 cap 治理一段；文案含「5 分钟」与「active hours」grep 锚；风格对齐既有条目（中文口径+数据源指引）。
- [ ] **usage-accounting.md §13**：标题**恰为** `## 13. recap 口径（C7 增补）`（编号顺延现有 §12；C7-8 grep 锚是「recap 口径（C7 增补）」子串）——内容：本地日界（对齐官方 queryAppUsage 的 dayIndex/tzOffsetMs 维度）/5min 桶去重/并行指标/span 上界/30d 覆盖与 cap 治理（三元 max 公式）/year 档 token null 语义。

**回归测试清单（test/recap-view.test.js，源码契约）:**
- C7-6：`registerView('recap'` 命中；index.html 含 `data-view="recap"` 与 `<script src="/views/recap.js">`；空态命中 `/(window\.)?ZC\.emptyState\(/`；「30 天」覆盖披露文案命中；sparkline 色值经 `cssVar('--chart-` 读取、硬编码色值三正则+具名色名单 0 命中。
- C7-8 [命令]：`grep -n "recap 口径（C7 增补）" docs/usage-accounting.md` 命中；`grep -n "active hours" public/views/how.js` 命中（两 grep 基线均 0 命中——本会话实测，命中即增量证据）；how 段含「5 分钟」与去重/上界表述。
- C7-9 [评审] 留痕：recap 页双主题截图（week 与 month 两档：Top focus 表/日桶 sparkline/覆盖披露卡/空态帧）；叙事要点文案人工评审；year 档「上界口径」标注与要点降级形态核对——human-gate 留痕。

**规格验收条目映射**：C7-6、C7-8、C7-9。

**完成判据**：`node --test test/recap-view.test.js` 退出码 0；C7-8 两 grep 命中；C7-9 留痕在案（结论待人工）。

---

## T8：C12 导出夹带——/api/export/:dataset（json/csv）

> 前置条件见文档头部「C12 授权链披露」；若脚本侧裁撤指令先到，本节整体跳过。

**目标**：新建 `server/routes/export.js`（dataset/format 双白名单、复用 L1 既有查询零新 SQL、CSV RFC 4180 + 公式注入防护、JSON schema_version 包络）；前置一步**结构性提取、行为零变更**重构：`resolveWindow`/`wideWindowScope` 提取到新共享模块 `server/routes/usage-window.js`（规格 §2.4 需求 2 显式授权）；README/how 端点清单补录。

**Files:**
- Create: `F:/project/zcode-monitor-plan/server/routes/usage-window.js`
- Modify: `F:/project/zcode-monitor-plan/server/routes/usage.js`（改 require 消费——薄委托 `resolveWindow = (q) => shared.resolveWindow(q, retentionDays)`，调用点与返回值零改动；详见提取步骤）
- Create: `F:/project/zcode-monitor-plan/server/routes/export.js`
- Modify: `F:/project/zcode-monitor-plan/server/index.js`（/api 路由区装配）
- Modify: `F:/project/zcode-monitor-plan/README.md`（routes 清单 + 端点补录）
- Modify: `F:/project/zcode-monitor-plan/public/views/how.js`（端点清单行 + Excel 导入约束一句）
- Create: `F:/project/zcode-monitor-plan/test/export-routes.test.js`
- Modify: `F:/project/zcode-monitor-plan/docs/acceptance/residuals.md`（C12 robot/MCP、`?self=1`、tools/attribution 不导出登记，R-28 起）

**遵循的既有模式（锚点）:**
- 提取重构先例授权：规格 §2.4 需求 2（现状 resolveWindow 是 makeUsageRouter 闭包内函数 usage.js:34、wideWindowScope 是模块级私有 :20-24；提取后 usage.js require 消费，**既有 usage-routes.test.js 零改动通过＝重构回归证据**）。
- 同源消费：export 直接调 `dbq.overviewKpis/timeseries/breakdownByModel/breakdownByTool/overviewSpeed/recentSpeed`（/api/overview 装配面 overview.js:25-34 同清单）、`dbq.usageTurnsSummary/usageTurnTimeline`（usage.js:52-62 同参数语义）、**`buildRecapPayload`（T6 交付的 recap.js 模块级导出装配函数——export.js require 消费，recap.js 文件 T8 不触碰，文件相交表「recap.js 仅 T6 触碰」成立）**。
- clampLimit：usage timeline 100/500（usage.js:62 同款二元组）。
- 400 可读错误码先例：usage.js:86-89（`{error:'bad_request', message:…}`——本路由用 `{error:'unknown_dataset'/'unknown_format'}`）。

**实施步骤:**
- [ ] **usage-window.js 提取（先做，行为零变更）**：`resolveWindow(q, retentionDays)` 与 `wideWindowScope(window)` 移入新模块并 `module.exports`（**签名钉死——评审第 1 轮两席意见采纳**：提取后 retentionDays 闭包捕获必然失效，统一为**双参函数 `resolveWindow(q, retentionDays)`**，不做 options 工厂包装二选一；usage.js 侧改为薄委托 `const resolveWindow = (q) => shared.resolveWindow(q, retentionDays)` 保**调用点与返回值形状零改动**——真实不变量即此，`{sinceMs, window, head}` 形状与既有行为不动；`wideWindowScope` 引用 `dbq.USAGE_CANDIDATE_CAP_ROWS`，新模块 require `../db`）；既有 `node --test test/usage-routes.test.js` 零改动跑绿为重构回归证据。
- [ ] **export.js**：`makeExportRouter({ retentionDays = 30 } = {})`，`GET /api/export/:dataset?format=json|csv&window=&period=&limit=`：
  - dataset 白名单 `overview|usage|recap`（**路径参数形态，`?dataset=` query 不参与路由判定**）；format 白名单 `json|csv`（缺省 json）；白名单外一律 **400**（可读错误码 `unknown_dataset`/`unknown_format`，不静默回退——机器可读面从严，§2.0 拍板 7）。
  - 参数透传源端点值域：overview/usage 传 `window`（24h|7d|today / 24h|7d|30d，随源端点缺省与回退语义——overview 内联窗口解析不提取，值域两套）；recap 传 `period`；usage 行数 `clampLimit(req.query.limit, 100, 500)`。
  - **overview 值域窗口解析落点（评审第 1 轮意见采纳，断言措辞同步钉死）**：overview.js:13-22 的内联解析（window→sinceMs + series 桶数 24\*7:24）按既定决策不提取，export.js 处理 overview 数据集时**须在 export.js 内实现一份同语义映射**（24h|7d|today → sinceMs/桶数，today=startOfDayMs、7d 桶数 168、缺省 24h）——代码上是 overview 值域的第二处窗口解析，属**授权例外**（与「无第二套窗口解析」契约的调和口径：该契约的完整表述＝**usage 值域走 resolveWindow 复用（零第二处）、overview 值域以 overview.js:13-22 为同语义锚、export 内映射仅此一处且注释指向锚点**）；C12-2 源码契约按此限定断言（见测试清单），HTTP 对照测试钉行为等价。
  - **同源钉（零新 SQL）**：直接消费源端点相同的 db.js 查询函数与 usage-window helper，export 内不出现第二套聚合或第二处窗口解析。
- [ ] **JSON 包络**：`EXPORT_SCHEMA_VERSION = 1` 常量；顶层 `{schema_version, generated_at, dataset, format, meta, data}`（data=源端点载荷原形）；meta 装配——usage/recap 继承源端点 meta（retention_days/scope 等）；**overview 例外补装** `meta={retention_days:30, window, since}`（源端点无 meta；保留期是库级事实，usage 族 head 先例 usage.js:43）。
- [ ] **CSV 形态（每数据集固定一张矩形主表）**：usage＝turn 时间线矩形（列同 C1 timeline 行字段）；recap＝日桶矩形（`date,tokens,calls,sessions,active_minutes,parallel_max`）；overview＝section 长表三列（section,key,value——kpis/speed/recent_speed 逐叶子标量展开，key 点路径如 `kpis.model.calls`；series 每桶一行 value=桶对象 JSON 序列化；by_model/by_tool 每行一行 value=行对象 JSON 序列化）。
- [ ] **CSV 转义钉 RFC 4180**：字段含 `,` `"` `\r` `\n` 时双引号包裹、内部 `"` 加倍 `""`；行尾 `\r\n`；首行列名；UTF-8 无 BOM；**公式注入防护**：以 `=` `+` `-` `@` 开头的字段前置 `'` 转义（Excel/Sheets 公式注入面，任务要点钉；How 页注明导入约束）。
- [ ] **响应头**：`Content-Disposition: attachment; filename="zcode-monitor-<dataset>-<window|period>-<UTC时间戳>.<ext>"`；`X-Zcode-Monitor-Export-Schema-Version: 1`（JSON/CSV 双形态均带）；装配在 `/api` 路由区（Host 闸/securityHeaders 之后自动带全局头——装配契约断言）。
- [ ] README（routes 清单 export.js/usage-window.js 行 + 端点清单）、how（端点清单行 + CSV Excel 导入约束一句）、residuals 登记（robot/MCP 未做、`?self=1` 不做、tools/attribution 两端点数据不导出）。

**回归测试清单（test/export-routes.test.js，HTTP 契约，tmpdir fixture）:**
- C12-1 白名单：六组合（3 dataset × 2 format）全 200；`/api/export/bogus` → 400 `unknown_dataset`；`?format=xml` → 400 `unknown_format`；format 缺省=json（包络回显）。
- C12-2 同源：同 fixture 下 `/api/export/usage?window=7d` 与 `/api/usage/turns?window=7d` 核心数值逐项相等（recap 同法对照）；`schema_version===1`、`generated_at` ISO、`meta.retention_days===30` 三数据集统一断言（overview 的 retention_days 由 export 层补装）；源码契约：export.js 消费的查询函数名与源端点一致（无第二套聚合；**resolveWindow 复用计数——usage 值域零第二处；overview 值域映射仅 export.js 内一处、与 overview.js:13-22 同语义（today→startOfDayMs、7d 桶数 168、缺省 24h），注释含指向 overview.js 的锚点引用**）。
- C12-3 CSV 转义：会话标题含 `逗号, "引号"` 与换行的毒字段 → 双引号包裹、`"` 加倍、`\r\n` 行尾、首行列名、Buffer 首三字节非 `EF BB BF`；三数据集主表列集与钉一致；公式注入防护（毒字段以 = + - @ 开头时前置 `'`）。
- C12-4 钳界：`?limit=-1` 钳 1、`?limit=99999` 钳 500；行数一致性分数据集（usage/recap CSV 行数=JSON data 行数；overview 断言 CSV 各 section 行数=JSON 对应 section 元素数，不按行集口径）。
- C12-5 响应头：Content-Disposition 形态、schema-version 头双形态均在、全局既有头（nosniff/CSP/回环闸）不破坏（装配契约断言）。
- C12-6 空态：空 fixture 三数据集导出 200——JSON data 空集形状 + meta 完整（含 overview 补装）、CSV 仅首行列名，不抛错。
- C12-7 **[命令] 7399 冒烟对照**：起服（Global Constraint 6 全流程）→ `curl -s http://127.0.0.1:7399/api/export/usage?window=24h` 与 `/api/usage/turns?window=24h` 核心字段对照一致；三数据集两格式下载各一次、`wc -l`/行数与 JSON 对照照录（EXPLAIN 不适用——零新 SQL，同源钉声明）。

**规格验收条目映射**：C12-1~C12-7。

**完成判据**：`node --test test/export-routes.test.js` 与 `node --test test/usage-routes.test.js`（零改动）均退出码 0；C12-7 冒烟照录在案；residuals 登记三条在册。

---

## 收口（脚本侧，非实施者任务）

- **GX-1**：worktree 根 `npm test`（node --test 聚合入口）退出码 0、0 failed——含本批 **7 个新建测试文件（signals/signals-view/notify/notify-view/recap/recap-view/export-routes）+ 1 个既有文件增补（frontend-contract.test.js）**（计数口径：新建 7、增补 1——GX-1 的「新测试文件数」验收记录照此口径分别照录）与既有全套（batch1 收官 297 例为基线；新增计数照录验收记录）。门禁前 `netstat -ano | grep 7399` 双检（R-21 治理）。
- **GX-2**：`node -e "console.log(Object.keys(require('./package.json').dependencies))"` 输出恰为 `[ 'better-sqlite3', 'express' ]`。
- **逐任务提交**：按「执行顺序与提交总览」的提交主题逐任务 commit（T1→T8）。
- **六席终审**：全部任务交付后进入六席终审流程；终审修复（如有）逐条落实并复验门禁；**终审全绿后合并 main 并推送 fork**（origin=aloysk/zcode-monitor）。
- **人工评审调度**：C6-9（徽标/置顶/chip/pet waiting 帧与 15s 观察记录）、C8-8（三页通知呈现+授权流+防噪表）、C7-9（recap 双主题截图+要点文案+year 降级形态）——留痕文件在 `docs/acceptance/`（human-gate 格式），评审完成后各自记结论。
- **7399 冒烟终验**（如脚本编排需要重复各任务的 curl 检查）。
- **遗留对账**：residuals.md 本批新登记（R-28 起：notify 无回放、C8 per-rule 配置面、C6 索引回退披露、C12 robot/MCP、tools/attribution 不导出、C3 本地基座待后续、C6-8 超线处置视结果）逐条在册；R-8 守护注记在册。
