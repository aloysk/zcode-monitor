# T5 数据源核实门留痕（WP4 需求 1：工具失败 / 权限请求的可轮询落点）

> 本文件为终审修订轮（2026-09-23）补记。核实门的原始结论当时只写在 `public/pet.html` 的 computeMood 预留注释里（现随抽取迁至 `public/pet-state.js` 同注），未按 human-gate 清单落成本文件；T5 的 commit `9885bd5` 正文为空。现把结论与证据转写于此，并附终审轮的复测。

## 核实结论

**工具失败：有可轮询落点（已接线）。权限请求：无可轮询落点，`waiting_permission` 接线子项按 Spec 需求 1 降级 backlog（显式部分交付）。**

### 工具失败（已接线）

- 落点：`tool_usage.status='error'` 行，`server/livegen.js` 的 tick 内按隐式 rowid 水位扫描（`dbq.recentToolRowsAfterRowid`），经 `/api/gen/events` SSE 透传 `phase:'tool_error'` 事件。
- 记录形态（真实库只读实测，终审轮 2026-09-23 复测）：尾部 200 行 status 分布 `{"completed":186,"error":8,"running":6}`——真实使用中 error 行持续产生，信号源成立。
- fixture 样例行形态：`{ id: 'tu-1', session_id: 's1', tool_name: 'Bash', status: 'error', started_at: <epoch ms> }`（test/livegen-error.test.js 的行为测试以此构造）。

### 权限请求（降级预留）

- 核实（2026-09-22 原始轮，只读）：`tool_usage.approval_status` 尾部取值全 `'none'`；`permission` 表 `MAX(rowid)` 为 0（空表）。
- 终审轮复测（2026-09-23，同一真实库只读连接）：尾部 200 行 approval_status 分布 `{"none":200}`；`SELECT MAX(rowid) FROM permission` 仍为 NULL（表存在但零行）——结论不变。
- zai-org/ZCode 官方源码落盘行为：未在只读约束内进一步核实（无自然产生的权限请求样本可观察，代理不得代填真实权限请求）。
- 降级裁定：`waiting_permission` 行保留在 9 行契约中（`pet-state.js` 的 `animFor` 已备映射），预留位次与接线三步注记见 `public/pet-state.js` computeMood 注释；出现信号源后接线不改动契约为。

## 自动可验证前置

- `npm test` 全绿（终审轮 2026-09-23 实测），其中 test/livegen-error.test.js 覆盖 tool_error 的 boot 不回放、同毫秒批量、晚落库旧行、completed 不发射等语义；test/pet-state.test.js 覆盖 A4-1（事件→failed 行）与 A4-2（活动事件惊醒）的行为断言。
