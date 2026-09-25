# C8 前端人工评审留痕（C8-8，T5）

> C8-8 为 `[评审]` 类验收（截图/实机视觉留痕），自动化不可代填结论。本文件按
> human-gate 标准格式留痕：**结论：待人工评审；已备复现步骤**。T5（2026-09-25）
> 已交付 C8-4/C8-5/C8-6 的全部自动化面（test/notify-view.test.js 11 例绿；
> 7394 冒烟真机驱动核验记录见下「已完成的自动化核对」）。

## 结论

**待人工评审。** 需实机截图/视觉复核的各项：

- 三页提醒呈现双主题截图：pet 气泡（含消毒文本样例——URL 剥为 `[链接]` 后
  的形态）、widget 副行胶囊形态（数字行下方、severity 语义色文本）、index
  通知卡/toast（底部弹出、5s 驻留）。已备真机素材两帧：
  `docs/acceptance/c8-pet-notify-bubble.png`（气泡回落常态）、
  `c8-pet-notify-bubble-live.png`（notify 接管帧）——评审时可按复现步骤
  重拍更高清/双主题版本。
- 出厂默认形态核对：系统通知关（默认）+声音开（默认）下，alert 级提醒的
  实际呈现＝提示音+气泡（自动化已钉降级矩阵函数行为，`notifyChannels`
  八个矩阵点全测；真机听感/视觉形态需人工确认）。
- 系统通知授权流人工复验一次：overview 页「提醒」卡勾选「系统通知」→
  浏览器弹权限请求 → 授予 → 触发 alert 级通知收到系统横幅；拒绝路径的
  开关回落与提示文案。
- 防噪默认值表照 UI 实态核对：三开关默认态（声音✔/系统通知✘/TTS✘）与
  spec §2.2 需求 2 服务端规则表（error_burst 开+sound / waiting_timeout
  关（R-28 降级处置）/ token_threshold 关+quiet / inactive 关+quiet）。

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
  `c8-widget-subrow.png`、`c8-index-toast.png`、`c8-notify-settings.png`
  （沿用本目录既有 png 留痕惯例）。
- 提示音听感（WebAudio 880Hz/0.2s/gain 0.06）与 TTS 播报（开 TTS 后）
  属人工听感面——自动化只钉了合成参数与守卫逻辑。
