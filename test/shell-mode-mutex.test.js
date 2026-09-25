// 壳菜单「吸附 ZCode 窗口 / 始终置顶(全局)」互斥契约（源码契约——仓内无
// C# harness，按 restart-route.test.js 壳侧先例钉接线点）。
// 2026-09-25 用户实锤两 bug：① 两项 CheckOnClick 可同时打勾；② 从全局切
// 吸附后置顶残勾，TopMost 仍在顶置带，ZCode 转后台 widget 不消失（浮在
// 别的应用之上）。行为面修复后由此处钉住防回归。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('壳菜单互斥（Program.cs）：开吸附摘置顶并离顶置带/开置顶摘吸附停跟随/tick 再断言/持久化', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'shell', 'Program.cs'), 'utf8');

  // bug① 互斥：dock 开分支必须在 ApplyDock/BindZOrder 之前摘除置顶菜单项并
  // 离开顶置带——顺序是行为（先 BindZOrder 会被 _topMostItem.Checked 守卫
  // 短路，z 绑不回去）
  assert.ok(
    /_dockItem\.Click \+= \(s, e\) =>\s*\{\s*if \(_dockItem\.Checked\)\s*\{\s*_topMostItem\.Checked = false;\s*SetTopmostBand\(false\);[^\n]*\n\s*_docked = true;\s*ApplyDock\(\);\s*BindZOrder\(\);/.test(src),
    '开吸附须摘置顶勾 + SetTopmostBand(false) 先行 + ApplyDock + BindZOrder（顺序即行为：先绑 z 序会被置顶守卫短路）');

  // 互斥对侧：置顶开分支摘吸附勾并停跟随锚点（顶置带里跟 ZCode 锚点跑正是
  // 矛盾态本体）
  assert.ok(
    /_topMostItem\.Click \+= \(s, e\) =>\s*\{\s*if \(_topMostItem\.Checked\)\s*\{\s*_dockItem\.Checked = false;\s*_docked = false;[^\n]*\n\s*SetTopmostBand\(true\);/.test(src),
    '开置顶须摘吸附勾 + _docked=false（全局悬浮不跟随锚点）+ 进顶置带');

  // bug② 根因钉：z 带切换必须直调 SetWindowPos（-1/-2），不得回退到 WinForms
  // TopMost 属性赋值——句柄重建后属性与实窗样式漂移，属性等值短路会静默吞掉
  // 「离开顶置带」，widget 就继续浮在别的应用之上
  assert.ok(
    /private void SetTopmostBand\(bool topmost\)[\s\S]{0,600}?new IntPtr\(-1\) \/\*HWND_TOPMOST\*\/ : new IntPtr\(-2\) \/\*HWND_NOTOPMOST\*\//.test(src),
    'SetTopmostBand 须直调 SetWindowPos 且 HWND_TOPMOST(-1)/HWND_NOTOPMOST(-2) 俱全');
  assert.ok(!/TopMost = _topMostItem\.Checked/.test(src),
    '菜单切换不得再走 WinForms TopMost 属性（等值短路吞切换的形态不许回来）');
  assert.ok(!/^\s*TopMost = true;/m.test(src),
    'ctor 不得再置 TopMost=true（全局悬浮时代遗物：与 CreateParams 注释和菜单默认态矛盾，且播种属性/样式漂移）');

  // watch tick 两侧都要再断言：置顶态重进顶置带（WebView2 句柄重建会掉
  // WS_EX_TOPMOST），非置顶态维持原 z 绑
  assert.ok(
    /if \(_topMostItem\.Checked\) SetTopmostBand\(true\);\s*else if \(_docked \|\| _mode != "pill"\) BindZOrder\(\);/.test(src),
    'watch tick 须对置顶态每 500ms 重断言顶置带（句柄重建掉位），否则维持 z 绑');

  // BindZOrder 守卫保持以菜单态为源（「随 ZCode 一起被盖住」的语义闸门）
  assert.ok(
    /if \(_zcodeHwnd == IntPtr\.Zero \|\| _topMostItem\.Checked\) return;/.test(src),
    'BindZOrder 置顶守卫不得删（置顶期间不做 z 绑是全局模式的语义本体）');

  // 模式选择须持久化（重启后仍是用户选的模式，而不是静默回吸附）
  assert.ok(/TryGetProperty\("topmost", out var tm\) && tm\.GetBoolean\(\)/.test(src),
    'LoadSettings 须读 topmost 键（旧档无键 → 默认吸附/自由，向后兼容）');
  assert.ok(/topmost = _topMostItem\.Checked,/.test(src),
    'SaveSettings 须落 topmost 字段');
  // 两侧 handler 都要 SaveSettings：模式翻转即刻持久化（不能只靠下次拖拽/退出捎带）
  assert.ok(/_dockItem\.Click[\s\S]{0,700}SaveSettings\(\);\s*\};/.test(src),
    '吸附 handler 须以 SaveSettings 收尾（模式翻转即刻持久化）');
  assert.ok(/_topMostItem\.Click[\s\S]{0,700}SaveSettings\(\);\s*\};/.test(src),
    '置顶 handler 须以 SaveSettings 收尾（模式翻转即刻持久化）');

  // ── 评审变异实锤的三个存活点补钉（notify 冷却先例：分支删改套件照绿=必修）──
  // ① 取消吸附分支：_docked 不落 false 则菜单未勾仍吸附（tick 继续 z 绑+跟锚点）
  assert.ok(/_dockItem\.Click[\s\S]{0,900}?else _docked = false;\s*SaveSettings\(\);/.test(src),
    '取消吸附分支须落 _docked=false 并持久化（否则菜单态说谎、吸附暗中生效）');
  // ② 置顶关闭分支体：离开顶置带的一步不得删（守卫释权后靠它落回 ZCode 上方）
  assert.ok(/_topMostItem\.Click \+= \(s, e\) =>[\s\S]{0,600}?\}\s*else\s*\{\s*SetTopmostBand\(false\);\s*BindZOrder\(\);\s*\}/.test(src),
    '置顶关闭分支须 SetTopmostBand(false)+BindZOrder（删 SetTopmostBand 则顶置带未离）');
  // ③ LoadSettings topmost 分支体：摘吸附勾与 _docked=false 是不一致档的防御，整钉
  assert.ok(/TryGetProperty\("topmost", out var tm\) && tm\.GetBoolean\(\)\)\s*\{\s*_topMostItem\.Checked = true;\s*_dockItem\.Checked = false;\s*_docked = false;/.test(src),
    'LoadSettings topmost 分支须整钉：置勾+摘吸附+_docked=false（缺一即菜单态与行为分叉）');
  // ④ docked 恢复同步菜单勾（评审发现 2：docked:false 档重启后勾选态说谎，点一次空翻）
  assert.ok(/if \(b\.TryGetProperty\("docked", out var d\)\) _docked = d\.GetBoolean\(\);\s*_dockItem\.Checked = _docked;/.test(src),
    'LoadSettings 读 docked 后须同步 _dockItem.Checked（勾选态与行为不得分叉）');
});
