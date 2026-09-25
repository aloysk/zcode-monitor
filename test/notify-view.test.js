'use strict';
// test/notify-view.test.js — C8 前端三页消费面（T5）的源码契约 + 行为提取
// 单测（spec 验收 C8-4 / C8-5 / C8-6）。readPublic 形态沿 frontend-contract /
// signals-view 先例：断言浏览器实际加载的那份源文件（无构建器，无副本漂移面）。
//
// C8-5 断言面勘正（计划 T5 测试清单钉死的口径）：sanitize.js 是隐私剥除闸、
// 不是 HTML 消毒器（其 RULES 全表仅 URL/凭证/路径/密钥规则，`<img>` 与引号在
// 输出中原样存活——**不得断言其不存活**）；防注入的真正闸门是渲染出口一律
// textContent。两闸正交缺一不可：本文件对 sanitize 断言其真实行为面（换行
// 收敛），对渲染出口断言 textContent 写入形态 + 无 innerHTML/insertAdjacentHTML
// 写入通知文本。与 spec C8-5 原文（specs:224「注入标记不存活」）的张力按此
// 口径消化，差异记录于本头注（WP4 出口复用的行为钉不受影响）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const readPublic = (name) => fs.readFileSync(path.join(PUB, name), 'utf8');
const Sanitize = require(path.join(PUB, 'sanitize.js'));

// ── 提取器：C8 新增 notify 代码段（范围钉，防整文件断言误伤既有文本）──────
function notifySegments() {
  const app = readPublic('app.js');
  const widget = readPublic('widget.html');
  const pet = readPublic('pet.html');
  const ov = readPublic('views/overview.js');
  const seg = (src, startMarker, endMarker) => {
    const s = src.indexOf(startMarker);
    const e = src.indexOf(endMarker);
    assert.ok(s >= 0 && e > s, `提取锚缺失：${startMarker.slice(0, 24)}…`);
    return src.slice(s, e);
  };
  return {
    // app.js：三开关助手（NOTIFY_KEYS→降级矩阵注释前，自包含可求值）
    switches: seg(app, 'const NOTIFY_KEYS =', '// 降级矩阵'),
    // app.js：降级矩阵纯函数（→幂等去重注释前，自包含可求值）
    matrix: seg(app, 'function notifyChannels', '// 幂等去重'),
    // app.js：整段 notify 消费（→DOMContentLoaded）
    app: seg(app, '// ── C8 notify 消费', "document.addEventListener('DOMContentLoaded'"),
    // widget：notify 副行消费段（→bump 变量）
    widget: seg(widget, '// ── C8 notify 消费', 'let bump = null;'),
    // pet：notify 订阅段（→openNotifyStream）
    pet: seg(pet, '// ── C8 notify 消费：气泡 + 提示音', 'function openNotifyStream()'),
    // pet：render() 内气泡接管分支（→常驻速度读数注释）
    petRender: seg(pet, '// C8 notify 接管期', "// the bubble is the pet's only speed readout"),
    // overview：设置区绑定（→文件尾部 registerView 前，截到段尾花括号即可）
    ovSettings: seg(ov, 'function bindNotifySettings', "  // ── 快照绊线卡"),
  };
}

// ── C8-4：三页均含 notify 事件监听与呈现代码 ─────────────────────────────
test('C8-4: 三页（app.js/widget/pet）均含 notify 事件监听与呈现代码', () => {
  const app = readPublic('app.js'), widget = readPublic('widget.html'), pet = readPublic('pet.html');
  assert.ok(app.includes("addEventListener('notify'"), 'app.js notify 监听在案');
  assert.ok(app.includes('function presentNotify'), 'app.js 呈现函数在案');
  assert.ok(widget.includes("addEventListener('notify'"), 'widget notify 监听在案（挂既有 /api/live/events 连接）');
  assert.ok(pet.includes("addEventListener('notify'"), 'pet notify 监听在案（新开 /api/live/events 订阅）');
  assert.ok(pet.includes("new EventSource('/api/live/events')"), 'pet 增订阅 /api/live/events 在案');
  // boot 接线：app.js DOMContentLoaded 内启动全局订阅（切页不断流）
  assert.ok(/\bstartNotifyStream\(\);/.test(app), 'app.js boot 区 startNotifyStream() 在案');
  assert.ok(pet.includes('openNotifyStream();'), 'pet boot 区 openNotifyStream() 在案');
});

// ── C8-4：提示音走 WebAudio，无外部音频资源引用 ──────────────────────────
test('C8-4: 提示音走 WebAudio 内置合成——外联音频资源正则 0 命中', () => {
  for (const f of ['app.js', 'widget.html', 'pet.html', 'views/overview.js']) {
    const src = readPublic(f);
    assert.ok(!/\.mp3|\.wav|\.ogg|Audio\(/i.test(src), `${f} 不得引用外部音频资源`);
  }
  const segs = notifySegments();
  for (const [name, seg] of [['app', segs.app], ['pet', segs.pet]]) {
    assert.ok(seg.includes('AudioContext'), `${name} 页 WebAudio AudioContext 在案`);
    assert.ok(seg.includes('createOscillator'), `${name} 页 oscillator 合成在案`);
  }
});

// ── C8-4：Notification.requestPermission 仅在用户显式开启路径可达 ──────────
test('C8-4: requestPermission 全仓唯一调用点在 overview 设置区的开关开启分支', () => {
  // 消费侧三页（含 app.js 的 presentNotify）只检查已授予态，永不请求权限
  for (const f of ['app.js', 'pet.html', 'widget.html']) {
    assert.ok(!readPublic(f).includes('requestPermission'),
      `${f} 不得出现权限请求（默认态页面加载不请求权限）`);
  }
  // 全 public 扫描（排除 assets 第三方分发与既有页面）：唯一命中=overview.js
  const hits = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (ent.name !== 'assets') walk(p); continue; }
      if (!/\.(js|html)$/.test(ent.name)) continue;
      if (readPublic(path.relative(PUB, p).replace(/\\/g, '/')).includes('requestPermission')) {
        hits.push(path.relative(PUB, p).replace(/\\/g, '/'));
      }
    }
  };
  walk(PUB);
  assert.deepStrictEqual(hits, ['views/overview.js'], 'requestPermission 唯一调用点=overview.js');
  // 调用点与开关判定同分支：desktop.onchange 内、未勾选路径已提前 return
  const seg = notifySegments().ovSettings;
  assert.ok(seg.includes('desktop.onchange'), '系统通知开关 change 绑定在案');
  assert.ok(seg.includes('if (!desktop.checked)'), '未勾选路径提前 return（请求只在开启路径可达）');
  const uncheckedBranch = seg.slice(seg.indexOf('if (!desktop.checked)'), seg.indexOf("if (typeof Notification !== 'function')"));
  assert.ok(!uncheckedBranch.includes('requestPermission'), '关闭路径不含权限请求');
  // 开启路径内部形态：default 态判定 → 请求调用（granted/denied 不重弹）
  const openPath = seg.slice(seg.indexOf('let perm = Notification.permission'), seg.indexOf("} catch { perm = 'denied'; }"));
  assert.ok(openPath.includes("if (perm === 'default')"), '仅 default 态请求（granted/denied 不重弹）');
  assert.ok(openPath.includes('await Notification.requestPermission()'), '请求调用点在显式开启路径内');
});

// ── C8-4：三开关默认值钉（声音开/系统通知关/TTS 关）+ 值语义往返（行为）──
test('C8-4: 三开关默认值——声音开、系统通知关、TTS 关；localStorage 往返生效', () => {
  const src = notifySegments().switches;
  const make = (store) => new Function('localStorage',
    src + '\nreturn { notifySwitches, setNotifySwitch, NOTIFY_KEYS };')(store);
  // 空库（null/缺省）→ 默认组合（spec §2.2 需求 4）
  const fresh = make({ getItem: () => null, setItem: () => {} });
  assert.deepStrictEqual(fresh.notifySwitches(),
    { sound: true, desktop: false, tts: false }, '默认值钉：声音开/通知关/TTS 关');
  // 显式读写往返（null=默认、'1'=开、'0'=关；键名钉）
  const m = {};
  const store = {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
  };
  const h = make(store);
  assert.strictEqual(h.NOTIFY_KEYS.sound, 'zc-notify-sound');
  assert.strictEqual(h.NOTIFY_KEYS.desktop, 'zc-notify-desktop');
  assert.strictEqual(h.NOTIFY_KEYS.tts, 'zc-notify-tts');
  h.setNotifySwitch('sound', false);
  assert.strictEqual(m['zc-notify-sound'], '0');
  assert.strictEqual(h.notifySwitches().sound, false, '声音显式关生效');
  h.setNotifySwitch('desktop', true);
  assert.strictEqual(h.notifySwitches().desktop, true, '系统通知显式开生效');
  h.setNotifySwitch('sound', true);
  assert.strictEqual(h.notifySwitches().sound, true, '声音显式开生效');
  // localStorage 抛异常（隐私模式）：读默认、写不崩
  const broken = make({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
  assert.deepStrictEqual(broken.notifySwitches(), { sound: true, desktop: false, tts: false },
    'localStorage 不可用时回退默认值');
  assert.doesNotThrow(() => broken.setNotifySwitch('sound', false), '写侧异常不外泄');
});

// ── C8-4：降级矩阵钉——alert∩通道逻辑 + 气泡通道不受开关控制（行为）────────
test('C8-4: notifyChannels 降级矩阵——实际呈现=内建强度∩已开启通道', () => {
  const fn = new Function(notifySegments().matrix + '\nreturn notifyChannels;')();
  const on = { sound: true, desktop: true };
  // quiet：仅气泡（token_threshold/inactive）
  assert.deepStrictEqual(fn('quiet', on), { bubble: true, sound: false, desktop: false });
  // sound：声音开→提示音+气泡；声音关→降为仅气泡
  assert.deepStrictEqual(fn('sound', on), { bubble: true, sound: true, desktop: false });
  assert.deepStrictEqual(fn('sound', { sound: false, desktop: true }),
    { bubble: true, sound: false, desktop: false }, 'sound 强度×声音关→仅气泡');
  // alert：出厂默认形态（通知关+声音开）=提示音+气泡（spec §2.2 需求 4 钉）
  assert.deepStrictEqual(fn('alert', { sound: true, desktop: false }),
    { bubble: true, sound: true, desktop: false }, '出厂默认形态=提示音+气泡');
  assert.deepStrictEqual(fn('alert', on), { bubble: true, sound: true, desktop: true });
  assert.deepStrictEqual(fn('alert', { sound: false, desktop: true }),
    { bubble: true, sound: false, desktop: true }, 'alert×声音关×通知开→系统通知+气泡');
  // 未知/缺省 intensity 回落 quiet 行为
  assert.deepStrictEqual(fn(undefined, on), { bubble: true, sound: false, desktop: false });
});

// ── C8-4：pet/widget 内联同语义——强度×开关守卫 + 气泡恒在不设开关 ─────────
test('C8-4: pet 提示音走强度×声音开关守卫；pet/widget 气泡通道不受开关控制', () => {
  const segs = notifySegments();
  // pet：提示音调用点与强度判定、声音开关同分支
  const petChime = segs.pet.slice(segs.pet.indexOf('const intensity'), segs.pet.indexOf('render();'));
  assert.ok(petChime.includes("intensity === 'sound' || intensity === 'alert'"),
    'pet 提示音强度判定在案（sound/alert，quiet 仅气泡）');
  assert.ok(petChime.includes('notifySoundOn()'), 'pet 提示音受声音开关守卫在案');
  // pet：气泡接管（notifyText/hold）无开关判定——onNotify 内 sanitize/hold 段
  // 不含 notifySoundOn（声音开关只守提示音，不守气泡）
  const petBubble = segs.pet.slice(segs.pet.indexOf('function onNotify'), segs.pet.indexOf('const intensity'));
  assert.ok(petBubble.includes('notifyHoldUntil = Date.now() + NOTIFY_HOLD_MS'), '气泡 hold 推进在案');
  assert.ok(!petBubble.includes('notifySoundOn'), '气泡通道不受声音开关控制');
  // pet render() 接管分支存在（hold 期通知文本优先、回落路径清内联色）
  assert.ok(segs.petRender.includes('notifyText && Date.now() < notifyHoldUntil'), 'render 接管分支在案');
  assert.ok(segs.petRender.includes("bnumEl.textContent = notifyText"), '接管分支 textContent 渲染在案');
  assert.ok(segs.petRender.includes("bnumEl.style.color = ''"), '过期回落清内联色在案');
  // widget：副行呈现无条件（恒在底线通道）——onNotify 内 add('on') 前无开关判定
  const wShow = segs.widget.slice(segs.widget.indexOf('function onNotify'), segs.widget.indexOf('clearTimeout(notifyTimer)'));
  assert.ok(wShow.includes("classList.add('on')"), '副行显示在案');
  assert.ok(!/localStorage|Sound|notifySwitch/.test(wShow), '副行通道不受任何开关控制');
});

// ── C8-4：widget 呈现形态＝数字行下方临时副行（不弹窗、不改布局契约）───────
test('C8-4: widget 副行——数字行下方 absolute 叠加、8s 淡出、多条只显最新、不弹窗', () => {
  const widget = readPublic('widget.html');
  const segs = notifySegments();
  // 页内 <style> 的 .notify-row 形态：absolute 叠加（不参与 flex 重排）、
  // nowrap、初始隐藏（opacity:0）
  const css = widget.slice(widget.indexOf('.notify-row {'), widget.indexOf('.notify-row.on'));
  assert.ok(css.includes('position: absolute'), '副行 absolute 叠加（不改单行窗布局）');
  assert.ok(css.includes('white-space: nowrap'), '副行 nowrap（不加宽窗体契约）');
  assert.ok(css.includes('opacity: 0'), '副行初始隐藏在案');
  // 8s 驻留 + 多条只显最新（覆盖文本+重置计时）
  assert.ok(segs.widget.includes('8000'), '8s 淡出驻留在案');
  assert.ok(segs.widget.includes('clearTimeout(notifyTimer)'), '多条只显最新（重置驻留计时）在案');
  assert.ok(widget.includes('transition: opacity .4s ease'), '淡出过渡在案');
  // 不弹窗：widget notify 段无 Notification 构造
  assert.ok(!segs.widget.includes('new Notification'), '胶囊窗不弹系统通知');
});

// ── C8-5：消毒行为（断言面按 sanitize.js 实际行为钉，见头注勘正）───────────
test('C8-5: sanitizeSpeech 换行收敛（\\s+ → 单空格，气泡单行语境前提）', () => {
  assert.ok(!Sanitize.sanitizeSpeech('a\nb').includes('\n'), '换行收敛为单空格');
  assert.strictEqual(Sanitize.sanitizeSpeech('a\n\n  b\t c'), 'a b c', '多空白收敛为单空格');
  // 隐私剥除面沿用既有 test/sanitize.test.js，此处不重复建设（计划钉）
});

// ── C8-5：渲染出口源码契约——防注入真闸门是 textContent ────────────────────
test('C8-5: pet 气泡与 widget 副行文本写入点均为 textContent；无 innerHTML 写入通知文本', () => {
  const segs = notifySegments();
  // pet：onNotify 内 sanitize 赋值 + render 接管分支 textContent（两处写入点）
  assert.ok(segs.pet.includes('SanitizeSpeech.sanitizeSpeech(raw)'), 'pet 气泡文本过消毒闸在案');
  assert.ok(segs.petRender.includes('bnumEl.textContent = notifyText'), 'pet 气泡渲染出口 textContent 在案');
  // widget：副行写入点 textContent（tip.textContent 同款渲染纪律）
  assert.ok(segs.widget.includes('notifyRow.textContent ='), 'widget 副行渲染出口 textContent 在案');
  assert.ok(segs.widget.includes('SanitizeSpeech.sanitizeSpeech(raw)'), 'widget 副行文本过消毒闸在案');
  // 两页 notify 消费代码段禁 HTML 注入写入形态（断言写入语句而非字样——
  // 注释中的「无 innerHTML 面」说明文字不属写入行为）
  for (const [name, seg] of [['pet', segs.pet], ['petRender', segs.petRender],
    ['widget', segs.widget], ['app', segs.app]]) {
    assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(/.test(seg),
      `${name} 段不得以 HTML 注入形态写入通知文本`);
  }
  // app.js 通知面走 toast()（textContent 写入，app.js:90-94 既有形态）
  assert.ok(segs.app.includes('toast(`${n.title || n.rule}：${n.body || \'\'}`'),
    'index 通知面 toast() 基底在案');
});

// ── C8-5：幂等去重双保险（服务端冷却之外，三页同款有界记忆）───────────────
test('C8-5: 三页按载荷 id 有界去重（NOTIFY_SEEN_CAP 防长开标签无界增长）', () => {
  const segs = notifySegments();
  for (const [name, seg] of [['app', segs.app], ['pet', segs.pet], ['widget', segs.widget]]) {
    assert.ok(seg.includes('function notifyDuplicate'), `${name} 页幂等去重在案`);
    assert.ok(seg.includes('NOTIFY_SEEN_CAP'), `${name} 页去重记忆有界在案`);
    assert.ok(seg.includes('notifyDuplicate(n.id)'), `${name} 页消费前查重在案`);
  }
});

// ── C8-6：TTS 钉——speechSynthesis 被 TTS 开关守卫且默认关、无引擎/网络引用 ──
test('C8-6: speechSynthesis 调用被 TTS 开关守卫；无 TTS 引擎/network 资源引用', () => {
  const app = readPublic('app.js');
  const seg = notifySegments().app;
  // 调用点前有 sw.tts 守卫（默认 false 由三开关默认值用例钉）
  const tts = seg.slice(seg.indexOf('// TTS'), seg.indexOf('function startNotifyStream'));
  assert.ok(tts.includes('sw.tts &&'), 'speechSynthesis 被 TTS 开关守卫在案');
  assert.ok(tts.includes("n.intensity === 'sound' || n.intensity === 'alert'"),
    'TTS 强度轴与提示音一致（quiet 级不播报）');
  assert.ok(tts.includes("'speechSynthesis' in window"), '能力探测守卫在案');
  // TTS 调用只在 app.js（pet/widget 无 TTS——面板页独有，防多页同开重复播报）
  assert.ok(!readPublic('pet.html').includes('speechSynthesis'), 'pet 页无 TTS 调用');
  assert.ok(!readPublic('widget.html').includes('speechSynthesis'), 'widget 页无 TTS 调用');
  // 无 TTS 引擎依赖（kokoro/voicevox——spec §2.2 需求 5 明确不做）、无外链资源
  for (const f of ['app.js', 'widget.html', 'pet.html', 'views/overview.js']) {
    const src = readPublic(f);
    assert.ok(!/kokoro|voicevox/i.test(src), `${f} 无 TTS 引擎引用`);
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(src), `${f} 无外链资源引用`);
  }
});
