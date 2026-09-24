# C9 人工评审留痕（C9-5，T1）

> C9-5 为 `[评审]` 类验收（截图/实机视觉留痕），自动化不可代填结论。本文件按
> human-gate 标准格式留痕：**结论：待人工评审；已备复现步骤**。T1（2026-09-25）
> 已交付 C9-1～C9-4 的全部自动化面；models-meta 联动抽查子项属 C2 任务面
>（T6/T7 交付后才存在该组件），届时由收口轮并入调度，本文件不预填。

## 结论

**待人工评审。** C9-5 的四个子项中，可机检部分已过（见下），需实机截图/视觉
复核的三项留待人工：

- 顶栏 chip 在「ZCode 已停写」实况下的真机截图——数据落后读数与 `zcode_running`
  并读呈现，**双主题各一帧**（浅/深，`?theme=light|dark` 或顶栏切换钮）。
- emptyState 组件双主题截图一帧（首例 transcript 场景：任一子代理/无 transcript
  会话的 Timeline 标签空态卡）。
- 本批新增全部数字位核查（未知/缺失值一律 `—`，无捏造数值路径）：T1 的新增
  数字位仅顶栏 chip 读数——双源均 null 时渲染「数据落后 —」（app.js
  renderFreshnessChip 的 null 分支），该行为已由 test/freshness.test.js 的
  C9-1 空态用例在 API 层守护（双源 null → level/lag_ms 均 null）；视觉呈现
  （`—` 实际显示、severity 色在双主题下的可读性）仍需实机目检。

## 复现步骤（实机评审时按序执行）

```bash
cd "F:/project/zcode-monitor-plan"
node --test test/freshness.test.js        # T1 门禁：C9-1~4 全绿
npm test                                   # 全套（收口轮跑亦可）
PORT=7399 OPEN_BROWSER=0 npm start         # 冒烟实例（7331 若是用户在跑的实例则勿动，直接开 7331 页面评审亦可）
# 浏览器打开 http://127.0.0.1:7399/：
#   1) 顶栏观察「数据落后 X」chip：读数、颜色（ok 不染色 / warn 黄 / err 红）、
#      hover 的双源详情与口径文案；与顶栏 meta 的 ZCode 运行态并读截图
#   2) 切换主题（右上角按钮 / 按 t / ?theme=light）各截一帧
#   3) 会话页任一子代理或无 transcript 会话 → Timeline 标签：空态卡
#      （「无 transcript.jsonl 数据」+ 已停写/interactive 两情形文案）双主题截图
```

- 判型两情形的触发面：interactive 主会话（session 表 task_type='interactive'）
  显示「不产生 transcript 事件流…去 Context」；其余会话及判型失败兜底显示
  「ZCode 已停写 transcript.jsonl（本机实测：数据源退化…）」。
- 截图落位建议：`docs/acceptance/` 下 `c9-chip-dark.png` / `c9-chip-light.png` /
  `c9-empty-state.png`（沿用本目录既有 png 留痕惯例）。
