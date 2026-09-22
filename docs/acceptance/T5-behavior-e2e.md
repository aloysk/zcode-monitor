# T5 桌宠行为实机演示留痕（A4-7）

> 本文件为终审修订轮（2026-09-23）补记。原始执行轮（2026-09-23 00:02–00:03）用 Playwright 驱动浏览器页面对四态做了截图演示并留下本目录的日志，但未按 human-gate 清单落成本文件、T5 的 commit `9885bd5` 正文为空。现按计划「留痕格式」补齐，**不虚构未发生的壳内实机项**。

## 浏览器侧演示证据（已留存）

证据均在 `docs/acceptance/`（本轮随本文件一并入库）：

| 状态 | 截图 | 说明 |
|---|---|---|
| error（failed 行） | `pet-error-failed-row.png` | SSE `tool_error` 边触发 failed 行 |
| sleep（idle 静帧 + 呼吸 + zzz） | `pet-sleep-zzz.png` | 60s 无活动入睡的可视形态 |
| 入睡静帧（row0 首帧冻结） | `pet-idle-row0.png` | sleep 判定的画布静帧对照 |
| 双击切换宠物 | `pet-after-switch.png` | 切包手势执行后的下一只宠物 |

浏览器会话日志：`playwright-mcp-t5/console-2026-09-22T16-02-23-353Z.log`、`playwright-mcp-t5/page-2026-09-22T16-02-24-019Z.yml`（页面可访问性快照；console 中 `/api/widget/recent` 500 为当时测试实例指向空 fixture 的预期形态，与行为演示无关）。

## 结论

- **浏览器侧**：error / 入睡 / 惊醒 / 连击 / 双击切换的页面级行为已有自动化行为单测兜底（终审轮新增 test/pet-state.test.js：A4-1～A4-4 全量不变量），并有上述四态截图；动画状态未超出 9 行契约（契约由 test/pet-state.test.js 的 A4-6 守护）。
- **WebView2 壳内侧（待人工实机评审）**：壳内拖动/连击/滚轮换形态等 `postMessage` 交互与真实渲染帧率需在壳内实机操作，属 human-gate——原始轮与本轮均未执行，不代填结论。复现步骤：`npm start` 后启动 shell 壳（`shell/` 目录工程），在壳内对桌宠做 2 击（切换）、4+ 击（发脾气）、拖动、滚轮各一轮，对照上表截图核对形态。

## 与终审修订的关系

终审轮把判定逻辑抽为 `public/pet-state.js` 共享模块（Spec WP4 需求 2 的既定形态），页面接线经 test/pet-page.test.js 守护（script 引用、内联脚本可编译、无内联副本）。上表截图产生于抽取前的内联实现；抽取为等价重构（行为单测锁定语义），壳内实机评审如发现视觉回归，按截图对照定位。
