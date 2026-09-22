# T6 watch 预验证记录（A3-4 附带 / 降级启用依据）

日期：2026-09-23（Asia/Singapore，凌晨时段）。环境：Windows 10.0.26200 x64，Node v24.11.1，Git Bash。
全部证据来自本 worktree 实跑（`node --test test/log-tail.test.js` 与一次性 tmpdir 诊断脚本，后者不入库）。

## 1. watch 命中率（A3-4 用例附带输出 `watch-hit N/100 within 1s`）

| 轮次 | watch-hit | 结果 |
|---|---|---|
| 第 1 次 | 100/100 | 5/5 用例全绿 |
| 第 2 次 | 100/100 | 5/5 用例全绿 |
| 第 3 次 | 100/100 | 5/5 用例全绿 |

三次中位数 = **100%**，远高于降级阈值（< 50% 改为纯短轮询，Spec WP3 需求 2）。
**结论：保留 fs.watch 路径，不启用降级改造。**

## 2. 本机 fs.watch 行为实测（决定 A3-2 用例形态与兜底设计）

一次性诊断脚本（tmpdir）实测，Node v24.11.1 / win32：

- **删除被监视目录**：`fs.rmSync` 对被 `fs.watch` 监视中的目录**成功**（无 EBUSY/EPERM），
  目录确实消失；但 300ms 观察窗内 watcher **不触发 `error` 事件、同步也不抛错——静默失效**。
  → A3-2 采用「删除目录 → 重建 → 追加」形态，可见性由 5s reconcile 对账兜底
  （实测 453ms 内送达，两重兜底任一生效即达标）。
- **目录级监听事件流量**：对 `~/.zcode/cli/log` 建 watch，4 秒收到 14～44 个目录事件
  （来源为 ZCode 自身对当日文件的追加），事件驱动的增量读取正常。
- **EMFILE / 句柄安全**：`createLogWatcher` 全生命周期只建**一个**目录句柄
  （`persistent: false`，不逐文件监听），30ms 防抖合并事件风暴；
  `fs.watch` 同步抛错（如目录不存在，ENOENT）与异步 `error`（EPERM/EMFILE 等）
  两条降级路径均有用例覆盖（A3-2 / A3-2b），降级时 `console.warn` 告警**恰好一次**。

## 3. 附加发现：日志文件按本地日命名（UTC 映射缺陷，见 T6-latency-samples.md）

`~/.zcode/cli/log/zcode-2026-09-22.jsonl` 末写时间 **2026-09-22 23:59:59.648 +0800**，
`zcode-2026-09-23.jsonl` 自本地午夜起持续增长——ZCode 按**本地日**轮转命名。
既有 `todayLogFile()` 的 UTC 日映射在本地 00:00–08:00 (SGT) 指向已停写的旧文件。
本任务保持该既有导出语义不动（行为对外不变），`createLogWatcher` / 探针的缺省
解析改为「LOG_DIR 内名字最新的匹配文件」，证据与影响详见 `T6-latency-samples.md`。
