# C5 人工评审留痕（C5-6，T5）

> C5-6 为 `[评审]` 类验收（双主题截图：hover 态 + 下钻后会话详情；宽度占比与
> fixture 数值的手工核对），自动化不可代填结论。本文件按 human-gate 标准格式
> 留痕：**结论：待人工评审；已备复现步骤**。T5（2026-09-25）已交付 C5-1～C5-5
> 全部自动化面（C5-1/C5-2/C5-3/C5-4 由 test/usage-routes.test.js（T3，API 层）
> 与 test/attribution-view.test.js（T5，源码契约）守护；C5-5 的 EXPLAIN/计时
> 与 30d 档取舍记录在 round2-batch1-explain-timing.md，T2 已照录）。

## 结论

**待人工评审。** 实施者已在 7399 冒烟实例（真实库只读）完成自动化可做的全部
核对并留档（见下「已备证据」），需人工目检判定的部分：

- 火焰图双主题视觉（帧带/来源图例/帧下标签在两主题下的可读性、AA 对比）。
- hover 态（title 浮层的排版与三值可读性——原生 title 无法进截图，需实机
  hover 目检）。
- 下钻后会话详情页（turn 帧直链跳转后的 Turns 标签上下文是否可理解）。
- 宽度占比「手工核对」的人工复核（机检抽样已过，见下；人工可另抽帧复核）。

## 已备证据（2026-09-25，7399 冒烟，真实库只读）

自动化/机检面（命令与输出照录）：

1. **测试**：`cd F:/project/zcode-monitor-plan && node --test
   test/attribution-view.test.js` → 7 pass / 0 fail（C5-3/C5-4 源码契约）。
2. **C1-7 终验**：`grep -n "30 天" public/views/usage.js
   public/views/attribution.js public/views/how.js` → 三文件均命中（usage.js
   :7/:46/:51、attribution.js :7/:62/:68、how.js :36），exit=0。
3. **API 两级形状**（7399 实测）：`GET /api/usage/attribution?window=24h` →
   level=session、50 行、meta.truncated=true；`?level=turn&session_id=
   sess_bede0b0e-…` → 50 行、行含 turn_id/tokens/duration_ms_sum/model_calls/
   tool_calls，meta.truncated=true。
4. **渲染冒烟**（Playwright 浏览器，7399）：暗/亮双主题各一帧截图 + turn 帧直链
   跳转后会话详情（Turns 标签）一帧，全程控制台 0 error / 0 warning。
5. **主题重绘实证**：切亮色后首帧底色 getComputedStyle=rgb(9,105,218)=
   #0969da（styles.css 亮色 --cat-conversation，:96；暗色值为 #38bdf8）——
   色带确经 cssVar 渲染期重读；图例文字色 rgb(89,99,110)=#59636e（亮色
   --chart-legend，:121）；五来源（main_turn/compact/workflow_child/subagent/
   session_title）图例齐显。
6. **宽度占比机检**（C5-6 手工核对的自动化预核，7399 实页）：DOM 渲染宽占容器
   宽的份额 vs API tokens/Σtokens 份额，抽样 rank 1/2/3/10/50 五帧两位小数
   逐位一致（18.43%/6.92%/4.22%/2.15%/0.79%）；帧 data-tokens/data-dur-ms/
   data-share 三属性与 API 数值一致（231304334 tok / 18.4%）。
7. **下钻数据对账**：turn 层首帧（turn_e116abd9：249 req · 261 tools ·
   61.11M tok）与会话详情 Turns 标签同名行逐值一致。

截图落位（本目录，沿用既有 png 惯例）：

- `attr-smoke-dark-session.png` — 暗色 · session 层火焰图（hover 载荷在帧
  title 属性，快照可访问名实证：「询问通道文件混合导入报错含义 · 231.30M tok ·
  耗时 4h4m · 占比 18.4% · 1,031 次调用」）。
- `attr-smoke-dark-drilled-session-detail.png` — 暗色 · turn 帧直链跳转后的
  会话详情 Turns 标签。
- `attr-smoke-light-session.png` — 亮色 · session 层火焰图（主题翻转重绘后）。

## 复现步骤（实机评审时按序执行）

```bash
cd "F:/project/zcode-monitor-plan"
node --test test/attribution-view.test.js    # T5 门禁：C5-3/C5-4 契约全绿
npm test                                     # 全套（收口轮跑亦可）
PORT=7399 OPEN_BROWSER=0 npm start           # 冒烟实例（7331 若是用户在跑的实例则勿动）
# 浏览器打开 http://127.0.0.1:7399/#attribution：
#   1) session 层：帧宽与明细表占比列对照；hover 任一帧看 title 三值浮层
#      （token/耗时/占比）；窗口切 7d/30d 看 scope 钳制申报文案
#   2) 点击最宽的帧 → 下钻 turn 层：返回按钮、turn 帧直链（点击跳会话 Turns
#      标签）、明细表模型/工具调用列
#   3) 右上角切主题（或 ?theme=light|dark）：火焰带与图例随主题重绘
#   4) 截图留档：双主题各一帧 + hover 态 + 下钻后会话详情
#   5) 宽度手工核对：任抽 2-3 帧，量像素宽 ÷ 容器宽，与明细表占比列比对
```

- 空态复核（C9 联动）：窗口内无数据时（如新库）页面显示 emptyState 卡
  （「无 model_usage 数据」+ 处置指引），无双空卡。
- 已知呈现边界：截断（>50 会话/回合）时最窄帧常 <1% 宽，hover 才能读到
  值——明细表为兜底读数面，副行「仅前 N 项（被裁）」如实标注。
