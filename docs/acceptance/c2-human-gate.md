# C2 人工评审留痕（C2-9，T6/T7）

> C2-9 为 `[评审]` 类验收（models-meta 逐条核对记录 + mini 条/水位区/widget 副行
> 双主题截图，含未知模型态、compact 回落态、`—` 空态），自动化不可代填结论。
> 本文件按 human-gate 标准格式留痕：**结论：待人工评审；已备复现步骤**
> （c5/c9 同款格式，plan T7 完成判据与 Global Constraint 9）。T6/T7
> （2026-09-25）已交付 C2-1～C2-8 全部自动化面：C2-1 models-meta 头注出处由
> test/models-meta.test.js 钉；C2-2/C2-4/C2-6 数值面由 test/context-gauge.test.js
> 在 HTTP 层守护；C2-3/C2-5/C2-7 及 renderList mini 条分支由
> test/context-view.test.js 源码契约守护。

## 结论

**待人工评审。** 实施者已交付自动化可做的全部核对，需人工目检判定的部分：

- models-meta 逐条核对（头注 source 字段的「已核对官方源码常量」条目 vs
  zai-org/ZCode `config/provider/zcode-builtin.json`（revision 30）的规则族
  overlay 终值——表首键 GLM-5.3 与 GLM-5.1 200K 档已由测试断言，其余条目
  的人工复核）。
- mini 条/水位区的双主题视觉（列表 mini 条 44px 短轨、Context 标签大条、
  增量曲线上下半区、compaction 边界竖线在两主题下的可读性与 AA 对比）。
- 未知模型态（context_tokens=null → 条渲染但不显百分比、hover 标注
  「非官方权威」）与 compact 回落态（回落摘要前后对比行）的实机形态。
- widget 副行（hover 卡「缓存命中 X%」）与 `—` 空态（当日无数据/全零行日）。
  注意措辞：副行只在 widget.html（胶囊页）——桌宠页 pet.html 的气泡数据源是
  /api/widget/recent 速度轮询，无 hover 卡与今日数据消费（F-档-7 勘正）。

## 复现步骤（实机评审时按序执行）

```bash
cd "F:/project/zcode-monitor"
node --test test/context-gauge.test.js test/context-view.test.js test/models-meta.test.js
                                             # T6/T7 门禁：C2-1~C2-8 全绿
npm test                                     # 全套（收口轮跑亦可）
PORT=7399 OPEN_BROWSER=0 npm start           # 冒烟实例（7331 若是用户在跑的实例则勿动）
# 浏览器打开 http://127.0.0.1:7399/#sessions：
#   1) 会话列表：任一有模型调用的会话行右侧 mini 水位条（百分比/「—」两态）；
#      hover 看「非官方权威」标注
#   2) 打开任一活跃会话 → Context 标签：顶部水位区（水位条/逐轮增量曲线/
#      compact 边界竖线与回落摘要——挑一个发生过 compaction 的会话看回落行）
#   3) 未知模型态：任一 latest_model 为未收录模型的会话（mini 条显「—」、
#      水位区显「窗口未知」不猜百分比）
#   4) 挂件胶囊页（widget.html）hover：缓存命中副行（当日有数据显 X%、
#      空库/全零行日显 —）——副行只在 widget.html，桌宠页无此面
#   5) 双主题（?theme=light|dark）各截一帧：mini 条 + Context 水位区 + widget
#      hover 卡
```

- 截图落位建议：`docs/acceptance/` 下 `c2-gauge-dark.png` / `c2-gauge-light.png` /
  `c2-mini-bar.png` / `c2-widget-cache.png`（沿用本目录既有 png 留痕惯例）。
- 与 C5-6/C9-5 一并纳入人工评审调度（plan「收口（脚本侧）」条目）；C9-5 的
  models-meta 联动抽查子项（未命中不显猜测百分比）随本项同拍。
