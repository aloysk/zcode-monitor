# 真实库 EXPLAIN / 计时 / 误报抽样照录（ecosystem-round2-batch2）

- 用途：本批 [命令] 类验收（R8-1 / C6-7 / C6-8 / C8-7 / C7-7 / C12-7）的统一
  照录处——T1 建头（R-8 状态确认），T2 起各任务向本文件追加各自小节。
- 纪律：真实库访问一律只读（`~/.zcode/cli/db/db.sqlite`，AGENTS.md 红线 1/2；
  `~/.zcode` 一个字节不写）；探针脚本留 `os.tmpdir()`，非仓内文件。
- 环境：Windows 10.0.26200 x64，Node v24.11.1，worktree
  `F:/project/zcode-monitor-plan`（分支 `feature/ecosystem-round2-batch2`）。

---

## 0. T1 / R8-1：R-8 字体终形状态确认（2026-09-25，零行为变更）

R-8 销账（系统字体为最终形态）已由 `fix/r8-system-fonts` 轮（`6d979ae`，经 PR
合并进本批基线）完成；本节为守护性确认，命令逐条照录（grep 退出码 1 = 0 命中）：

| # | 命令 | 结果（照录） |
|---|---|---|
| 1 | `git -C F:/project/zcode-monitor-plan merge-base --is-ancestor 6d979ae HEAD` | 退出码 0——基线含 R-8 销账轮（merge-base 结论，不依赖具体 HEAD 短串，基线前进不失实） |
| 2 | `grep -rn "fonts.googleapis\|fonts.gstatic" F:/project/zcode-monitor-plan/public F:/project/zcode-monitor-plan/server` | 0 命中（退出码 1）——前端/服务端字体域全清 |
| 3 | `grep -n "@import" public/pet.html public/widget.html public/styles.css`（worktree 根） | 仅 `public/widget.html:47:   原 @import 排在 :root 之后本就无效，删除后语义不变） */`（解释性注释）；pet.html 与 styles.css 均 0 命中 |
| 4 | `grep -n "fonts.googleapis\|fonts.gstatic\|Google Fonts" README.md`（worktree 根，T1 复核项） | 0 命中（退出码 1）——README 无字体外联表述，无需勘改 |

契约钉（R8-2 守护面）：`test/frontend-contract.test.js` 本任务补 styles.css
无外联 `@import url(` 断言（widget/pet 两页既有形态断言之外的唯一缺口）；
变异验钉（node -e，不触碰真实文件）：现态 styles.css 对 `/@import\s+url\(/i`
为 false（过），注入 `@import url(https://fonts.googleapis.com/…)` 样本为
true（挂）——断言非恒过。单文件 `node --test test/frontend-contract.test.js`
退出码 0（3 pass / 0 fail）。
