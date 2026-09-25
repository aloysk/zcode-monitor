# C8 前端人工评审留痕（C8-8，T5）

> C8-8 为 `[评审]` 类验收（截图/实机视觉留痕），自动化不可代填结论。本文件按
> human-gate 标准格式留痕：**结论：待人工评审；已备复现步骤**。T5（2026-09-25）
> 已交付 C8-4/C8-5/C8-6 的全部自动化面（test/notify-view.test.js 11 例绿；
> 7394 冒烟真机驱动核验记录见下「已完成的自动化核对」）。

## 结论

**待人工评审（评审面已收窄——终审第 1 轮修复轮 2026-09-25 补拍 5 帧入位，见下）。** 仍需人工的项：

- ~~三页提醒呈现双主题截图~~：pet 气泡＝既有 `c8-pet-notify-bubble{,-live}.png`
  两帧；widget 副行＝`c8-widget-subrow.png`（420×260，数字行下方 err 色
  副行、胶囊窗不加宽）；index toast＝`c8-index-toast-{dark,light}-v2.png`
  （1280×800 双主题，五席一轮重拍——见下勘误注）；设置面板＝
  `c8-notify-settings-{dark,light}.png`（三开关默认态双主题）。
  **severity 语义色/对比度/淡出时序观感仍需人眼。**
- 出厂默认形态核对：设置帧内三开关默认态（声音✔/系统通知✘/TTS✘）已可见；
  alert 级「提示音+气泡」的实际听感/视觉形态需人工确认（降级矩阵函数行为
  已自动化钉死——notifyChannels 八矩阵点全测）。
- **系统通知授权流人工复验**（开放）：overview 勾「系统通知」→ 权限弹窗 →
  授予收横幅/拒绝回落文案——真授权弹窗交互不可自动代填。
- **提示音听感与 TTS 播报**（开放）：WebAudio 880Hz/0.2s/gain 0.06 与
  TTS 开启后的播报属人工听感面。
- 防噪默认值表照 UI 实态核对：spec §2.2 需求 2 表已加终审偏差注
  （waiting_timeout 落默认关＝R-28 ③款落锤）——设置帧与规则表口径一致。

### 终审第 1 轮修复轮补拍帧（2026-09-25，7399 真库只读起服）

| 帧 | 内容 | 驱动方式 |
|---|---|---|
| `c8-widget-subrow.png` | widget 数字行下方 severity(err) 副行（胶囊单行窗、无弹窗） | onNotify + MessageEvent（真实渲染代码路径；服务端事件以驱动样例替代——R-30 无回放边界） |
| `c8-index-toast-{dark,light}-v2.png` | index 底部 toast 双主题（五席一轮重拍，2026-09-25） | presentNotify 同款驱动 + `?theme=` 引导参数（见下勘误注） |
| `c8-notify-settings-{dark,light}.png` | 「提醒」卡三开关默认态双主题 | 真实 DOM 直拍 |

- AI 目检抽查：五席一轮（2026-09-25）对 v2 双帧已完成（analyze_image，
  读图核验主题/toast 文案与配色/无乱码 NaN/无关闭按钮——详下勘误注）；
  其余帧的视觉判定留人工（上轮两形态故障记录见 round2-batch2-gates.md）。

### 勘误注（2026-09-25 五席审查第 1 轮：原 toast 双主题帧主题错位重拍）

- **缺陷形态**：原 `c8-index-toast-{light,dark}.png` 两帧中，light 帧实拍于
  深色态（页面深底）、dark 帧内未见 toast——双帧均不能作双主题证据。
  旧帧已移出隔离（`C:/Users/18086/Desktop/zcode-monitor-cleanup-20260923/`，
  治理通道 mv、非 rm）。
- **根因**：index.html 的主题引导脚本只在页面加载时运行——加载完成后写
  `localStorage` 不重载不会改 `data-theme`（只有 `setTheme()`/重载会），
  上轮拍摄用的加载后注入形态落空；dark 帧则系 presentNotify 触发与截图
  的竞速错过 5s toast 驻留窗。
- **本轮方法**：`http://127.0.0.1:7399/?theme=light|dark#overview`——
  `?theme=` 查询参数由引导脚本在首绘前消费（零竞态，DOMContentLoaded 时
  replaceState 剥离）；CDP（PUT /json/new + WebSocket）navigate 后真等
  3s，页面内 `presentNotify({id:'reshoot-1', rule:'error_burst', …,
  severity:'err', intensity:'sound', …})` 驱动（= SSE notify 监听体同款
  入口，R-30 无回放边界的文档化等价形态），700ms 后截屏；**拍摄时运行时
  断言**双保险：`data-theme`、`#toast` 计算样式底色（light
  rgb(255,255,255) / dark rgb(31,36,48)=#1f2430）、toast 文案、
  `toast.hidden===false`。AI 目检复核双帧：主题/文案/配色全对、无乱码
  NaN；**toast 右端无 × 关闭按钮**（app.js `toast()` 纯 textContent，
  此前疑问就此核销）。
- **主题判据勘正（防复发）**：**顶栏主题图标不能作主题判据**——五席一轮
  实锤 `syncThemeIcon` 对 SVG 的 `hidden` 赋值只写 JS expando、从不翻转
  content attribute，月亮图标双主题常显（缺陷登记 R-40，与本帧主题无关）。
  主题判定应以页面底色/toast 计算样式/`data-theme` 为准（本轮 v2 帧即按
  此三重核验）。

## 已完成的自动化核对（T5 冒烟，7394 真实库只读）

- 三页加载 console 零错误（Playwright 驱动，逐页导航后 error 级消息 0 条）。
- 设置区三开关初始态与 `window.ZC.notifySwitches()` 真机一致
  `{sound:true, desktop:false, tts:false}`。
- widget 副行真机驱动（`onNotify(new MessageEvent(...))`）：毒文本
  `<img onerror=alert(1)>` 以字面文本呈现（textContent 钝化）；同 id 第二帧
  不覆盖（幂等）；err→`var(--negative)` / ok→`var(--positive)`；
  t0 隐藏 → t600ms opacity=1（淡入）→ 8s+500ms on 类移除、opacity=0
  （淡出时序完整）；body 左锚定+nowrap 布局契约未变。
- pet 气泡真机驱动：URL 消毒为 `[链接]`（sanitize.js 生效）、换行收敛单行、
  `<b>` 标签字面存活+不执行（C8-5 勘正口径）、warn→`var(--notice)`、
  unit/lanes 让位、8s hold 后回落速度读数+unit 恢复+内联色清除。
- index 通知面真机驱动：toast 出现（5s 驻留）、同 id 幂等、声音开关关闭时
  alert 级仍走 toast（气泡底线通道不受开关控制）。

## 复现步骤（实机评审时按序执行）

```bash
cd "F:/project/zcode-monitor-plan"
node --test test/notify-view.test.js        # T5 门禁：C8-4/5/6 十一例全绿
PORT=7399 OPEN_BROWSER=0 HOST=127.0.0.1 npm start   # 冒烟（7331 勿动）
# 触发提醒的三种途径（真实 notify 事件由服务端规则引擎 30s tick 评估——
# 默认仅 error_burst 开：真库近 5min error 行 ≥3 时自然触发；评审时可等自然
# 触发，或按下述页面内驱动形态即时预览渲染路径）：
#   1) pet.html 单开：DevTools Console 执行
#      onNotify(new MessageEvent('notify', {data: JSON.stringify(
#        {id:'review-1', rule:'error_burst', title:'错误爆发',
#         body:'近 5 分钟内错误 3 行（model 2 + tool 1）', severity:'err',
#         intensity:'sound', at: Date.now()})}))
#      → 气泡接管 8s（severity 红）后回落速度读数；双主题（浅色模式随系统）
#      各截一帧
#   2) widget.html 同款 onNotify 驱动 → 数字行下方副行出现（severity 色）、
#      8s 淡出；确认不弹窗、数字行位置不动（左锚定契约）
#   3) index（http://127.0.0.1:7399/）：Console 执行 presentNotify({...}) 同款
#      载荷 → 底部 toast 5s；overview 页尾「提醒」卡核对三开关默认态；
#      勾选「系统通知」走授权流（授予/拒绝两态）再触发 alert 级看横幅
```

- 截图落位建议：`docs/acceptance/` 下 `c8-pet-notify-*.png`（已备两帧）、
  `c8-widget-subrow.png`、`c8-index-toast-{dark,light}-v2.png`、
  `c8-notify-settings-{dark,light}.png`
  （沿用本目录既有 png 留痕惯例）。
- 提示音听感（WebAudio 880Hz/0.2s/gain 0.06）与 TTS 播报（开 TTS 后）
  属人工听感面——自动化只钉了合成参数与守卫逻辑。
