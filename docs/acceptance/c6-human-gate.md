# C6 人工评审留痕（C6-9，T3）

> C6-9 为 `[评审]` 类验收（截图/实机视觉留痕），自动化不可代填结论。本文件按
> human-gate 标准格式留痕：**结论：待人工评审；已备复现步骤**。T3（2026-09-25）
> 已交付 C6-4/C6-6/C6-8 的全部自动化面（test/signals-view.test.js 10 例绿；
> 误报回放抽样与超线处置照录 round2-batch2-explain-timing.md §1.5）。
>
> **降级处置注**：C6-8 回放抽样超线（39.8% > 20%），spec §2.1 需求 7 降级
> 条款生效——needs-attention 置顶分组已摘除（residuals R-28）。本验收原列的
> 「置顶」评审子项随处置不再存在，评审面按降级后形态执行（三态徽标/低置信
> 形态仍在）。

## 结论

**待人工评审。** 需实机截图/视觉复核的各项：

- sessions 列表三态徽标（working 蓝 / waiting 黄虚线 / idle 灰）与 broken
  叠加徽标（红）双主题截图各一帧——waiting 徽标的虚线描边在两主题下的辨识
  度、徽标不透明文本对比（§6 第 2 条 AA）。
- waiting 置信标注 hover 文案（虚线徽标 hover 弹出的固定文案）——文案语义
  与可读性评审（§6 适用注第 1/3 条）。
- overview 默认首屏顶栏 waiting chip 可见帧（**waiting>0 态**——「N 等待中」
  黄徽标形态 + hover 的最长等待格式化读数；waiting=0 态 chip 隐藏为默认形态）。
- pet `waiting_permission` 动画真机帧（/api/signals/summary 轮询驱动）——
  **连续 15s 以上轮询期观察记录**：hold（10s=2× 轮询周期）覆盖轮询间隙、
  mood 无 sleep 抖动断裂（§2.1 需求 6 的 hold 判据人工面）。

## 复现步骤（实机评审时按序执行）

```bash
cd "F:/project/zcode-monitor-plan"
node --test test/signals-view.test.js        # T3 门禁：C6-4/C6-6 十例全绿
PORT=7399 OPEN_BROWSER=0 HOST=127.0.0.1 npm start   # 冒烟（7331 勿动）
# 浏览器打开 http://127.0.0.1:7399/：
#   1) 会话页（#sessions）：列表行 .s 区三态徽标/broken 叠加；waiting 行
#      徽标虚线描边；hover 等待徽标看置信标注文案；双主题（右上角钮/t 键/
#      ?theme=light）各截一帧
#   2) 顶栏 waiting chip：waiting>0 态出现「N 等待中」黄徽标（无 waiting
#      时隐藏——可用真库实况等一个等待会话出现，或构造 ZCODE_DB fixture
#      种子）；hover 看最长等待读数；点击跳 #sessions
#   3) pet.html 单开（http://127.0.0.1:7399/pet.html）：有 waiting 会话时
#      宠物持续 playing waiting_permission 行（第 7 行）；连续观察 ≥15s——
#      5s 轮询间隙不回 sleep/cruise（hold=10s 覆盖）；截图一帧
```

- 截图落位建议：`docs/acceptance/` 下 `c6-sessions-badges-dark.png` /
  `c6-sessions-badges-light.png` / `c6-waiting-chip.png` /
  `c6-pet-waiting-permission.png`（沿用本目录既有 png 留痕惯例）。
- waiting>0 态的触发依赖真实库会话状态；评审时若无自然 waiting 会话，可临时
  以 fixture（`ZCODE_DB` 指向 tmpdir 种子库）起服构造——种子形态参考
  `test/signals.test.js` 的 waiting 用例（interactive 会话 + 新鲜 completed 行）。
