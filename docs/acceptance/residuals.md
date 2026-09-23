# 遗留项统一登记（residuals）

- 建立：2026-09-22（全量审查 R1 加固轮）。此前遗留事项散落在各验收文档与评审
  记录里，无统一追溯点——本文件是唯一登记处：新遗留入册，已解决的销账并注明
  证据，不删除条目（保留审计轨迹）。
- 互链：实施留痕见 `docs/plans/ecosystem-adoption-v1.md`；各项验收记录见本目录。

## 登记项

| # | 事项 | 状态 | 说明与证据 |
|---|---|---|---|
| R-1 | A1-8 与 A4-7 的壳内侧（WebView2）人工实机评审 | **未决（human-gate）** | 自动化可验证项全绿，但两验收点的实机演示未执行：A1-8（真实包导入→图鉴可见→轮换可达）见 `T2-import-e2e.md`；A4-7（壳内拖动/连击/滚轮/帧率）见 `T5-behavior-e2e.md`。两文件均含复现步骤，不代填结论。 |
| R-2 | `todayLogFile()` 的 UTC 日映射读侧缺陷（本地 00:00–08:00 读不到新行） | **已销账（本轮）** | 实测依据 `T6-latency-samples.md` §4。本轮把 `tailLog` / `eventsForTrace` 一并切到 `defaultTodayFile` 的「名字最新」语义（对 UTC/本地命名都成立），watch 缺省早已如此；`todayLogFile()` 导出保留 UTC 映射仅为兼容既有调用面（如 tools/log-latency-probe.js），内部读路径不再依赖它。测试：`test/log-tail-behavior.test.js` 跨本地午日用例。 |
| R-3 | win32 CLI 形态探测盲区 | **未决（有兜底）** | `tasklist` 探测只认桌面端镜像名 `ZCode.exe`，`node` 跑的 CLI 形态探测为「未运行」。兜底：`-wal` 静默窗口（`walIdleMs < 60s` = 真实 writer 在场）在自动 checkpoint 前否决误报（`server/zcode-runtime.js`）；本轮把同一否决加到 `/api/checkpoint` 执行前（即时判据，不再只依赖最长 ~37s 陈旧的进程探测结果）。根治（识别 CLI 形态进程）无必要不做。 |
| R-4 | UI 视觉发现的追溯缺口 | **未决（需人工看图）** | R1 评审报告称存在 3 项视觉发现未入库，并引用了 dashboard/pets/widget/pet 四页的截图复核结论（pets 布局、对比度 5.76:1 达 AA 等）——这些结论未在本仓留痕，本轮无法核实或复现。代码级已核事实：`public/widget.html`/`public/pet.html` 的 `--notice` 浅色档注释声明 #b35600 对白底 ≈4.9:1（AA）。销账条件：人工看图复核四页并把结论入库。 |
| R-5 | dashboard 隐私横幅的截图取证缺口 | **未决（需补拍）** | 仓库内无 `dashboard.png`（`git ls-files` 无此文件）；评审所引截图会话当时已 dismiss 横幅，故不构成「默认展示」证据。代码级事实（`public/index.html`）：横幅默认展示（`hidden` 初始态 + 未关闭过即显示），点击关闭写 `localStorage zc-privacy-notice-dismissed` 后不再出现。补一张默认展示态截图即可销账。 |
| R-6 | 「锚定无测试」的过时说法 | **已销账** | 该说法早于 `test/log-tail-behavior.test.js` 的 A3-watch 锚定用例（EPERM 补锚定、历史不回放）；本轮又补 A3-7（截断重读）与 A3-8（文件名回退/回归不回放）。后续引用以测试文件为准。 |
| R-7 | 许可证未知包的导入语义（A1-4 修订） | **已实施（本轮，语义变更留痕）** | 原 Spec A1-4 为「许可证缺失仅警告、导入不阻断」；本轮改为缺省拒绝、显式确认（API `ackUnknownLicense` / CLI `--ack-unlicensed`）后放行，NOTICE 免责声明同步改为中性措辞（不再自动断言「粉丝自制」——来源与授权状态未核实）。确认后仍为「成功但带警告」，A1-4 的 NOTICE 三要素断言不变。 |
