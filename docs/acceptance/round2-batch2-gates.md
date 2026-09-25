# batch2 门禁照录（GX-1 / GX-2）——六席终审第 1 轮修复轮收口

- 轮次：生态采纳 batch2（feature/ecosystem-round2-batch2）T1-T8 + 实现评审第 1 轮修复 + 六席终审第 1 轮 27 条修复轮（2026-09-25）。
- 环境纪律：门禁跑全套前 7399 双检（R-21 治理：`netstat -ano | grep 7399` 无 LISTENING 且无残留 ESTABLISHED/TIME_WAIT 才开跑）——本轮实测空闲，全套含 `test/start-detached.test.js`（7399 占口桩，10.0s 三例全绿进程完整退出）。

## GX-1 全套测试（node --test，两种计数口径）

| 口径 | 命令 | 结果 | 耗时 |
|---|---|---|---|
| 聚合入口（spec GX-1 原文命令） | `npm test`（= `node --test test/index.js`，run() per-file 子进程聚合） | **退出码 0，tests 1 / pass 1 / fail 0**（聚合壳层口径；任一子文件失败会使 test/index.js 红） | 60893ms |
| 直列计数（batch1「两种计数口径」先例） | `node --test` + 39 个 `test/*.test.js` 显式文件清单 | **tests 384 / pass 384 / fail 0，退出码 0** | 10014ms |

- 修复轮内分段验证（同日更早）：notify+export 两文件 24/24；前端契约族（frontend-contract/signals-view/pet-page/notify-view/recap-view 等）65/65——终值以上表为准。
- 本批测试面变更（`git diff --name-status main...HEAD -- test/`）：新增 7 文件（export-routes / notify-view / notify / recap-view / recap / signals-view / signals）+ 修改 4（frontend-contract 契约扩、helpers/fixture-db 种子扩、index 失败明细透出、pet-page permission 钉）。
- 间歇红披露：export-routes CSV 毒行断言曾 1 红/4 绿后 5 连跑不复现，未根因，登记 R-34（断言失败明细已携带 CSV 全文）。

## GX-2 依赖面

- 命令：`node -p "JSON.stringify(Object.keys(require('./package.json').dependencies))"`（worktree 根）。
- 实跑输出（2026-09-25 终审修复轮收口）：`["better-sqlite3","express"]` ——恰两运行时依赖，零新增（spec §1.1 红线 4）。

## 7399 冒烟与取证

- 终审修复轮 UI 复验：`PORT=7399 OPEN_BROWSER=0 HOST=127.0.0.1 node server/index.js` 起服（真库只读；起服前后 netstat 双检净），补拍 13 帧入本目录（c8-widget-subrow、c8-index-toast-{dark,light}、c8-notify-settings-{dark,light}、c6-waiting-chip、batch2-v3-sessions-waiting-{dark,light}、batch2-v3-recap-{month,year}-{dark,light}、batch2-v3-recap-fail-dark；其中 waiting 帧用真库真实 waiting 会话直拍）；复验收官后停服并复查端口净（`netstat -ano | grep 7399` 0 命中）。原记「12 帧」系计数笔误（枚举即 13 个文件名，2026-09-25 五席一轮勘正）。
- 五席审查第 1 轮视觉重拍/补拍（2026-09-25，同款 7399 起服 + CDP 纪律）：`c8-index-toast-{dark,light}-v2.png` 重拍入位（原两帧主题错位——light 帧实拍于深色态、dark 帧缺 toast；根因与本轮方法见 c8-human-gate.md 勘误注，旧帧已 mv 隔离至 Desktop 清理目录）；新增 `batch2-v3-recap-month-coverage-light.png`（1440×1400 加高视口，覆盖披露卡入镜——R-39 C7-9 复核面补强）。
- 拍摄方法披露：widget 副行/toast/设置面板帧经 onNotify/presentNotify + MessageEvent 驱动（真实渲染代码路径，服务端事件源以驱动样例替代——R-30 无回放边界的测试面等价物）；recap 失败帧经 page.route abort 驱动 failCard 真路径；数据帧（sessions/recap month/year）全真实。
- 早期实施轮冒烟端口 7393/7396 的偏差注记见 round2-batch2-explain-timing.md §T8 头注。
- AI 目检（analyze_image 抽查）两形态故障如实记录：终审席会话 429 限流；修复轮会话 400（Read 上传链路把绝对路径嵌入 URL，4_5v 解析失败）——上轮目检未完成，留人工看图（c6/c7/c8-human-gate.md 各自留痕）。五席一轮（2026-09-25）目检已走通：429 限流经等待重试后全过，v2 toast 双帧 + recap 覆盖帧共 3 帧读图核验（主题/文案/配色/无乱码 NaN）完成，结论入 c8-human-gate.md 勘误注与本目录各帧。
