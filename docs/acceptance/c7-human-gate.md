# C7 人工评审留痕（C7-9，T7）

> C7-9 为 `[评审]` 类验收（recap 页双主题截图——week 与 month 两档的 Top focus
> 表/日桶 sparkline/覆盖披露卡/空态帧；叙事要点文案；year 档「上界口径」标注
> 与要点降级形态核对），自动化不可代填结论。本文件按 human-gate 标准格式留痕：
> **结论：待人工评审；已备复现步骤**（c2/c5/c9 同款格式，batch2 T7 完成判据
> 与 Global Constraint 12）。T6/T7（2026-09-25）已交付 C7-1~C7-8 全部自动化面：
> C7-1/C7-2/C7-5 查询族与去重口径、C7-3/C7-4 路由与覆盖披露由 test/recap.test.js
> 在 fixture/EQP 层守护；C7-6 视图源码契约与 C7-8 文档口径锚由
> test/recap-view.test.js 守护；C7-7 真实库 EXPLAIN/计时照录
> docs/acceptance/round2-batch2-explain-timing.md。

## 结论

**待人工评审（评审面已收窄——终审第 1 轮修复轮 2026-09-25 补拍 5 帧入位，见下）。** 仍需人工的项：

- ~~双主题截图（week/month/year 三档）~~：week 档＝`batch2-v2-recap-{dark,light}.png`
  （T7 默认周档）；month/year 档＝`batch2-v3-recap-{month,year}-{dark,light}.png`
  （本轮补拍，1265×959 全页帧）；失败兜底帧＝`batch2-v3-recap-fail-dark.png`
  （page.route abort 驱动 failCard 真路径——含修复轮「候选集内全部行（宽窗
  截断）」措辞真机验证）。**可读性与 AA 对比仍需人眼判定。**
- **空态帧未拍**（开放）：真库近 7 天有活动、无自然空窗；构造需 fixture 起服
  （种子形态参考 test/recap.test.js 空态用例），留人工或后续批次补拍。
- **悬停 tooltip 帧未拍**（开放）：日桶柱 hover 的日期/活跃分钟/峰值并行/
  token/调用数五要素 tooltip 属交互态。
- **叙事要点文案**（month/year 帧内可见三要点/两要点降级形态，措辞语义评审
  开放）与 **sparkline-覆盖卡对齐**（帧内可比对，判定开放）。
- 已知口径边界（非缺陷）：月/年档覆盖起点受 30 天保留与 cap 治理约束
  （meta.token_coverage_from 三元 max），月初日期可能不在覆盖内——覆盖披露卡
  如实申报，柱带起点随之后移。

### 终审第 1 轮修复轮补拍帧（2026-09-25，7399 真库只读起服）

| 帧 | 内容 | 驱动方式 |
|---|---|---|
| `batch2-v3-recap-month-{dark,light}.png` | month 档全页（Top focus/sparkline/覆盖卡/环比不适用注明） | 真实数据直拍 |
| `batch2-v3-recap-year-{dark,light}.png` | year 档全页（上界口径标注/要点降级/Top focus 不适用注明/KPI token '—'） | 真实数据直拍 |
| `batch2-v3-recap-fail-dark.png` | 取数失败 failCard（「取数失败——稍后点「↻ 刷新」重试」） | page.route abort 驱动真实 failCard 路径 |

- AI 目检抽查未完成（两形态故障如实记录见 round2-batch2-gates.md）；帧的
  视觉判定留人工。

## 复现步骤（实机评审时按序执行）

```bash
cd "F:/project/zcode-monitor-plan"
node --test test/recap-view.test.js test/recap.test.js
                                             # T7/T6 门禁：C7-6/C7-8 与 C7-1~C7-5 全绿
PORT=7399 OPEN_BROWSER=0 HOST=127.0.0.1 npm start   # 冒烟实例（7331 是用户生产实例勿动）
# 浏览器打开 http://127.0.0.1:7399/#recap：
#   1) 期别选择器切 week：五张 KPI 卡（活跃时长/峰值并行/token/模型请求/活跃
#      天数）、「本期要点」三要点、日桶走势（8 桶）、Top focus 表、环比
#      （token+活跃两维，上一期→本期）、覆盖与口径卡（「官方 30 天保留」字样）
#   2) 切 month：日桶序列起点＝覆盖起点对齐日（30 天线内）；环比区显示
#      「月档不提供环比——…」注明；其余面同 week
#   3) 切 year：活动时长 delta 行「会话区间并集上界（含挂机时间）」；要点区
#      仅最活跃日/错误两要点（无「token 峰值日」占位）；Top focus 区为不适用
#      注明段；覆盖卡含上界口径行；KPI token 值 '—'
#   4) 悬停日桶柱看 tooltip（日期/活跃分钟/峰值并行/token/调用数）
#   5) 主题切换（顶栏按钮或按 t 键）：sparkline 柱色/基线/日期标签即时换色
#      （cssVar 渲染期读取、zc-theme-changed 纯重渲）
#   6) 空态帧：期别 week 且库内近 7 天无模型行时，要点区为共享空态卡
#      （「无 model_usage 数据」标题 + 处置指引）
# 截图留痕：上述 1/2/3 各在 dark 与 light 两主题下截图，共 ≥6 帧，
#   存 docs/acceptance/（命名如 recap-{week|month|year}-{dark|light}.png）
```

## 自动化交付对照（评审前已完成）

- C7-6 源码契约：test/recap-view.test.js 7 例（接线/形态/色值禁令/year 降级/
  环比档别/失败兜底/文档锚）。
- C7-8 两 grep：`grep -n "recap 口径（C7 增补）" docs/usage-accounting.md` 命中
  （§13）；`grep -n "active hours" public/views/how.js` 命中（口径段）——基线
  均 0 命中，命中即增量证据（T7 会话实测照录）。
- 本留痕不预填评审结论与截图（Global Constraint 12：严禁虚构）。
