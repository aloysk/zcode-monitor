'use strict';
// test/sanitize.test.js — 气泡消毒模块 public/sanitize.js 的样例契约。
// require 的就是页面 <script src="/sanitize.js"> 实际加载的那份文件（双端导出）。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { sanitizeSpeech } = require(path.join(__dirname, '..', 'public', 'sanitize.js'));

test('A4-5: 绝对路径·Windows 盘符（反斜杠与正斜杠两种形态）', () => {
  // 夹具用中性用户名：仓库公开时不把本机账号名带入版本历史
  const out = sanitizeSpeech('看 C:\\Users\\demo\\secret.txt 和 C:/logs/run.log 的结果');
  assert.equal(out.indexOf('C:\\Users\\demo\\secret.txt'), -1);
  assert.equal(out.indexOf('C:/logs/run.log'), -1);
  assert.equal(out, '看 [本地路径] 和 [本地路径] 的结果');
});

test('A4-5: 绝对路径·用户目录波浪号', () => {
  const out = sanitizeSpeech('配置在 ~/.zcode/cli/db.sqlite 里');
  assert.equal(out.indexOf('~/.zcode/cli/db.sqlite'), -1);
  assert.equal(out, '配置在 [本地路径] 里');
});

test('A4-5: 绝对路径·POSIX 用户目录（/home、/Users、/root）', () => {
  const out = sanitizeSpeech('/home/alice/data.json 与 /Users/bob/x.txt 及 /root/.bashrc');
  for (const p of ['/home/alice/data.json', '/Users/bob/x.txt', '/root/.bashrc']) {
    assert.equal(out.indexOf(p), -1, p);
  }
  assert.equal(out, '[本地路径] 与 [本地路径] 及 [本地路径]');
});

test('A4-5: 路径后紧跟的全角标点不被吞进占位符', () => {
  assert.equal(sanitizeSpeech('读 C:\\x\\a.log，然后重试'), '读 [本地路径]，然后重试');
  assert.equal(sanitizeSpeech('看 ~/.zcode/config。完成'), '看 [本地路径]。完成');
});

test('A4-5: URL 及查询串（http 与 file 协议）', () => {
  const out = sanitizeSpeech('打开 https://example.com/p?token=abc 看看，或 file:///C:/Users/x/a.txt');
  assert.equal(out.indexOf('https://example.com/p?token=abc'), -1);
  assert.equal(out.indexOf('file:///C:/Users/x/a.txt'), -1);
  assert.ok(out.includes('[链接]'));
  assert.equal(out.indexOf('token=abc'), -1, '查询串必须随 URL 整体剥除');
});

test('A4-5: 密钥样式·sk- 前缀 token', () => {
  const out = sanitizeSpeech('密钥 sk-abcdefgh123456 不要外传');
  assert.equal(out.indexOf('sk-abcdefgh123456'), -1);
  assert.ok(out.includes('[密钥]'));
});

test('A4-5: 密钥样式·长 hex（≥32 位）', () => {
  const hex = 'a3f9c2e81b7d4f6091c5a8e3d2b4f607'; // 32 位
  const out = sanitizeSpeech('摘要 ' + hex + ' 已记录');
  assert.equal(out.indexOf(hex), -1);
  assert.ok(out.includes('[密钥]'));
});

test('A4-5: 密钥样式·长 base64（≥40 位，含 padding 尾）', () => {
  const b64 = 'Tm9kZS5qcyBpcyBhd2Vzb21lIGFuZCB2ZXJ5IHNlY3VyZQ==';
  const out = sanitizeSpeech('凭证 ' + b64 + ' 已脱敏');
  assert.equal(out.indexOf('Tm9kZS5qcy'), -1);
  assert.equal(out.includes('='), false, 'padding 尾不得残留在气泡里');
  assert.ok(out.includes('[密钥]'));
});

test('A4-5: 密钥样式·长 base64 以 + / 开头时起点不残留（lookbehind 而非 \\b）', () => {
  // + 开头的 token 前没有词边界（非词字符）：\b 起点锚会失配、首字符残留。
  // 用非 hex 字母（Z/z）：先行执行的 hex 规则（/i）会把 A-F 段先收敛成
  // [密钥]，那属于 hex 规则的正常优先级而非本规则的行为。
  const token = '+' + 'Z'.repeat(40);
  const out = sanitizeSpeech('凭证 ' + token + ' 已带');
  assert.equal(out.indexOf(token), -1, '+ 开头的 base64 样串必须整体脱敏');
  assert.equal(out, '凭证 [密钥] 已带');
  const token2 = '/' + 'z'.repeat(41);
  assert.equal(sanitizeSpeech('密钥 ' + token2 + ' 收'), '密钥 [密钥] 收');
});

test('A4-5: Bearer 凭证头整体收敛', () => {
  const out = sanitizeSpeech('Authorization: Bearer abc123.XYZ_~def 已带上');
  assert.equal(out.indexOf('Bearer abc123.XYZ_~def'), -1);
  assert.ok(out.includes('[凭证]'));
});

test('A4-5: JWT 三段（eyJ 前缀）整体剥除，头/载荷/签名无任何分段残留', () => {
  // 规范三段 JWT：header(eyJ…36) . payload(eyJ…27) . signature(42)——每段都可能
  // 短于长 base64 的 40 位下限，且载荷可 base64url 解出 claims，必须整体收敛。
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0'
              + '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const out = sanitizeSpeech('token=' + jwt + ' 已带上');
  assert.equal(out, 'token=[凭证] 已带上', 'JWT 须整体收敛为一个占位符');
  for (const seg of ['eyJhbGciOi', 'eyJzdWIiOi', 'SflKxwRJSMeK']) {
    assert.equal(out.indexOf(seg), -1, '段残留: ' + seg);
  }
});

test('A4-5: JWT 规则先于长 hex/base64 规则（顺序不变量）', () => {
  // 顺序敏感的守护：若 RULES 重排致长 base64 规则（≥40 位）先跑，签名段先被
  // 剥、三段整体匹配失配，头与载荷（可解出 claims）将原样残留且无报警。
  // 签名段取 ≥40 位：短签名段对重排不敏感（JWT 规则与 base64 规则都各自收敛
  // 到占位符，重排下用例仍绿=假守护）；≥40 位签名被 base64 规则先行剥除时
  // 三段匹配必失配——重排后本用例必红。
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0'
              + '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'; // 签名段 43 位 ≥40
  const out = sanitizeSpeech('jwt:' + jwt + ';end');
  assert.equal(out, 'jwt:[凭证];end');
  assert.equal(out.indexOf('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), -1);
});

test('A4-5: Bearer 先于长 base64 规则（顺序不变量）：≥40 位 token 收敛为单一 [凭证]', () => {
  // 重排（长 base64 先跑）时 token 先被剥成 [密钥]、"Bearer " 残留为孤立头，
  // 断言整体收敛即失配——本用例锁住 Bearer 规则先于长 base64 的顺序。
  const tok = 'Tm9kZS5qcyBpcyBhd2Vzb21lIGFuZCB2ZXJ5IHNlY3VyZQ=='; // 44 位 + padding ≥40
  const out = sanitizeSpeech('Authorization: Bearer ' + tok + ' 已带上');
  assert.equal(out, 'Authorization: [凭证] 已带上');
});

test('A4-5: 跨行/分段凭据不泄漏（空白收敛先于规则循环）', () => {
  // 顺序守护：空白收敛若放回规则之后，分段样式的密钥各段都低于规则阈值、
  // 最后又被拼回一条——凭据原样泄漏。
  assert.equal(sanitizeSpeech('sk-abc12\ndef34567890'), '[密钥]');
  // JWT 跨点空格：三段被空白拆开时各段均不达长 base64 阈值
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 . eyJzdWIiOiIxIn0'
              + ' . SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  assert.equal(sanitizeSpeech('token=' + jwt + ' end'), 'token=[凭证] end');
  // Bearer 凭据分段：token 与续段一并收敛（续段后的普通词同被吞入属过杀取舍）
  assert.equal(sanitizeSpeech('Authorization: Bearer abc123\nXYZ_~def ok'), 'Authorization: [凭证]');
});

test('A4-5: 粘连前缀的 sk-/JWT/AKIA 不整体漏过（锚不依赖词边界）', () => {
  // 'keysk-…'/'xeyJ…'/'keyAKIA…'：前缀粘连时 \b/lookbehind 锚在词中失配、整条
  // 漏过——规则从特征前缀起剥除，残留的前缀字符不是密钥材料。
  const sk = sanitizeSpeech('看 keysk-abcdefgh123456 尾');
  assert.equal(sk.indexOf('abcdefgh123456'), -1, 'sk- 密钥材料不得残留');
  assert.ok(sk.includes('[密钥]'));
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeK';
  const jw = sanitizeSpeech('值x' + jwt + '尾');
  assert.equal(jw.indexOf('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), -1, 'JWT 材料不得残留');
  assert.ok(jw.includes('[凭证]'));
  const ak = sanitizeSpeech('keyAKIA1234567890ABCDEF x');
  assert.equal(ak.indexOf('AKIA1234567890ABCDEF'), -1, 'AKIA 密钥材料不得残留');
  assert.ok(ak.includes('[密钥]'));
});

test('A4-5: AWS AccessKeyId（AKIA + 20 位大写字母数字）', () => {
  const key = 'AKIA1234567890ABCDEF'; // AKIA + 16 位 = 20 位标准形态
  const out = sanitizeSpeech('身份 ' + key + ' 已带');
  assert.equal(out.indexOf(key), -1);
  assert.equal(out, '身份 [密钥] 已带');
});

test('A4-5: UNC 路径（\\\\host\\share\\…）', () => {
  const out = sanitizeSpeech('挂载 \\\\fileserver\\share\\data 后读取');
  assert.equal(out.indexOf('fileserver'), -1);
  assert.equal(out, '挂载 [本地路径] 后读取');
});

test('A4-5: data:/javascript: 内联 URI 整串剥除', () => {
  assert.equal(sanitizeSpeech('图 data:image/png;base64,iVBORw0KGgo= 完'),
    '图 [链接] 完');
  assert.equal(sanitizeSpeech('打 javascript:alert(1) 看'), '打 [链接] 看');
});

test('A4-5: 普通中文短句原样保留（含标点与数字）', () => {
  const s = '今天完成了三个任务，速度 42.5 t/s，一切正常。';
  assert.equal(sanitizeSpeech(s), s);
});

test('A4-5: 多余空白收敛为单空格并去首尾', () => {
  assert.equal(sanitizeSpeech('今天  完成\n\n  三个任务  '), '今天 完成 三个任务');
});

test('A4-5: 非字符串输入返回空串', () => {
  assert.equal(sanitizeSpeech(null), '');
  assert.equal(sanitizeSpeech(undefined), '');
  assert.equal(sanitizeSpeech(42), '');
  assert.equal(sanitizeSpeech({}), '');
});

test('A4-5: 混合敏感样式的整句一次消毒', () => {
  const raw = '检查 C:\\tmp\\a.log，curl https://api.example.com/v1?k=1 失败：' +
    'key=sk-abcdefghijklmnopqrstuvwxyz，trace 4f2a9b1c8d3e7f6045a2b8c1d9e0f3a4';
  const out = sanitizeSpeech(raw);
  for (const frag of ['C:\\tmp\\a.log', 'https://api.example.com/v1?k=1', 'k=1',
                      'sk-abcdefghijklmnopqrstuvwxyz', '4f2a9b1c8d3e7f6045a2b8c1d9e0f3a4']) {
    assert.equal(out.indexOf(frag), -1, frag);
  }
  assert.ok(out.includes('[本地路径]') && out.includes('[链接]')
         && out.includes('[密钥]'));
});
