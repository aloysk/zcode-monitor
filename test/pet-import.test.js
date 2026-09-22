'use strict';
// pet-import.test.js — 宠物包导入模块 / CLI / 端点的行为与拒绝面。
// fixture 全部在 os.tmpdir() 下构建，绝不触碰真实库与真实 public/pets。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);
const { vp8xSheet } = require('./helpers/webp-fixture');
const {
  importPetPack, listPetPacks, listStagingPacks, resolveStagingSource,
  importEndpointMiddleware, buildNotice, PetImportError,
} = require('../server/pet-import');

const REPO = path.join(__dirname, '..');
const LEGAL = { w: 1536, h: 1872 }; // 9 行契约最小尺寸

// 组一个来源包目录：pet.json + spritesheet.webp（30 字节头，仅尺寸有效）。
// 默认 pet.json 带小写 id——mkdtemp 随机后缀可能含大写，不该漏进 id 校验。
function makePack(parent, { petJson = {}, webp = vp8xSheet(LEGAL.w, LEGAL.h), petRaw = null } = {}) {
  const dir = fs.mkdtempSync(path.join(parent, 'pack-'));
  if (petRaw !== null) {
    fs.writeFileSync(path.join(dir, 'pet.json'), petRaw);
  } else if (petJson !== null) {
    fs.writeFileSync(path.join(dir, 'pet.json'),
      JSON.stringify(Object.assign({ id: 'test-pack', displayName: '测试包' }, petJson)));
  }
  if (webp) fs.writeFileSync(path.join(dir, 'spritesheet.webp'), webp);
  return dir;
}

// A0-7：记录本文件全部临时根，after 钩子断言已清理（用例中途抛错时由 finally
// 兜底清理；崩溃残留由本断言在正常路径上暴露为红）。
const TMP_ROOTS = [];
function tmp(tag) {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-pet-' + tag + '-'));
  TMP_ROOTS.push(p);
  return p;
}

test.after(() => {
  for (const p of TMP_ROOTS) {
    assert.equal(fs.existsSync(p), false, 'A0-7: 临时目录已清理: ' + p);
  }
});

test('合法包导入成功：三件套落位、NOTICE 齐备、无临时残留、webp-size CLI 判 OK', async () => {
  const root = tmp('ok');
  try {
    const src = makePack(root);
    const targetRoot = path.join(root, 'pets');
    const r = importPetPack({
      sourceDir: src, targetRoot,
      source: 'https://example.com/pack', author: '某作者', license: 'CC-BY-NC-4.0',
    });
    assert.equal(r.ok, true);
    assert.equal(fs.existsSync(path.join(r.dir, 'pet.json')), true);
    assert.equal(fs.existsSync(path.join(r.dir, 'spritesheet.webp')), true);
    const notice = fs.readFileSync(path.join(r.dir, 'NOTICE.md'), 'utf8');
    assert.ok(notice.includes('source: https://example.com/pack'));
    assert.ok(notice.includes('author: 某作者'));
    assert.ok(notice.includes('license: CC-BY-NC-4.0'));
    assert.ok(notice.includes('粉丝自制'));
    assert.ok(notice.includes('非商用'));
    assert.deepEqual(r.warnings, []);
    // 原子性：目标根无 .import-* 临时目录残留
    assert.equal(fs.readdirSync(targetRoot).some(n => n.startsWith('.import-')), false);
    // A1-1 的 webp-size CLI 子断言：落位 webp 上跑 node tools/webp-size.js 输出含 OK
    //（同时守护 CLI 的 1536×208n×rows≥9 判据，A1-9 判据的套件内回归）
    const { execFile: execFileCb } = require('child_process');
    const { promisify: pms } = require('util');
    const cli = await pms(execFileCb)(process.execPath,
      [path.join(REPO, 'tools', 'webp-size.js'), path.join(r.dir, 'spritesheet.webp')]);
    assert.ok(/rows=9 OK/.test(cli.stdout),
      'webp-size CLI 须对落位 webp 判 OK: ' + cli.stdout.trim());
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('校验拒绝面（参数化）：每类错误各自报因且目标根零残留', async t => {
  const CASES = [
    ['缺 pet.json', { petJson: null }, 'PET_JSON_MISSING', '缺少 pet.json'],
    ['坏 JSON', { petRaw: '{"displayName": ' }, 'PET_JSON_INVALID', 'pet.json 解析失败'],
    ['缺 webp', { webp: null }, 'SHEET_MISSING', 'spritesheet 不存在'],
    ['webp 损坏', { webp: Buffer.from('NOTWEBPNOTWEBPNOTWEBPNOTWEBP') }, 'SHEET_UNPARSEABLE', '无法解析'],
    ['宽不符', { webp: vp8xSheet(1024, 1872) }, 'SHEET_WIDTH', '宽度 1024'],
    ['高不整除', { webp: vp8xSheet(1536, 1800) }, 'SHEET_HEIGHT', '不能被 208 整除'],
    ['行数不足', { webp: vp8xSheet(1536, 1664) }, 'SHEET_ROWS', '行数 8'],
    ['非法 id', { idArg: '../evil' }, 'ID_INVALID', '非法包 id'],
    ['大写 id', { idArg: 'Chiikawa' }, 'ID_INVALID', '非法包 id'],
    ['来源目录不存在', { sourceMissing: true }, 'SOURCE_MISSING', '来源目录不存在'],
  ];
  for (const [label, spec, code, frag] of CASES) {
    await t.test(`拒绝: ${label} → ${code}`, () => {
      const root = tmp('rej');
      try {
        const src = spec.sourceMissing ? path.join(root, 'no-such-dir') : makePack(root, spec);
        const targetRoot = path.join(root, 'pets');
        fs.mkdirSync(targetRoot);
        const before = fs.readdirSync(targetRoot).length;
        assert.throws(
          () => importPetPack({ sourceDir: src, targetRoot, id: spec.idArg }),
          e => e instanceof PetImportError && e.code === code && e.message.includes(frag));
        // 原子性：目标根没有新增任何目录
        assert.equal(fs.readdirSync(targetRoot).length, before);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
  }
});

test('BOM + snake_case 的 pet.json 导入成功且显示名正确（对齐 /api/pets 容忍面）', () => {
  const root = tmp('bom');
  try {
    const src = makePack(root, { petJson: null });
    fs.writeFileSync(path.join(src, 'pet.json'),
      '\uFEFF{"id":"bom-pack","display_name":"测试喵","spritesheet_path":"spritesheet.webp"}');
    const r = importPetPack({ sourceDir: src, targetRoot: path.join(root, 'pets') });
    assert.equal(r.ok, true);
    assert.equal(r.name, '测试喵');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('字段缺失：NOTICE 留占位、结果带三类警告、导入不阻断', () => {
  const root = tmp('warn');
  try {
    const src = makePack(root);
    const r = importPetPack({ sourceDir: src, targetRoot: path.join(root, 'pets') });
    assert.equal(r.ok, true);
    assert.deepEqual(r.warnings, ['source_missing', 'author_missing', 'license_missing']);
    const notice = fs.readFileSync(path.join(r.dir, 'NOTICE.md'), 'utf8');
    assert.ok(notice.includes('source: <未提供>'));
    assert.ok(notice.includes('author: <未提供>'));
    assert.ok(notice.includes('license: unknown'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('重名拒绝；--force 覆盖后内容为新包且无残留', () => {
  const root = tmp('dup');
  try {
    const targetRoot = path.join(root, 'pets');
    const srcA = makePack(root, { petJson: { displayName: 'A 包' } });
    const r1 = importPetPack({ sourceDir: srcA, targetRoot, id: 'dup-pack' });
    assert.equal(r1.ok, true);
    const noticeA = fs.readFileSync(path.join(r1.dir, 'NOTICE.md'), 'utf8');
    assert.ok(noticeA.includes('A 包'));

    const srcB = makePack(root, { petJson: { displayName: 'B 包' } });
    assert.throws(
      () => importPetPack({ sourceDir: srcB, targetRoot, id: 'dup-pack' }),
      e => e instanceof PetImportError && e.code === 'ID_TAKEN' && e.message.includes('dup-pack'));

    const r2 = importPetPack({ sourceDir: srcB, targetRoot, id: 'dup-pack', force: true });
    assert.equal(r2.ok, true);
    const noticeB = fs.readFileSync(path.join(r2.dir, 'NOTICE.md'), 'utf8');
    assert.ok(noticeB.includes('B 包'));
    assert.ok(!noticeB.includes('A 包'));
    // 目标根只有正式包目录，无 .import-* 残留
    const leftovers = fs.readdirSync(targetRoot).filter(n => n.startsWith('.import-'));
    assert.deepEqual(leftovers, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('目录穿越防护：resolveStagingSource 拒绝路径形态，放行裸目录名', () => {
  const root = tmp('trav');
  try {
    const staging = path.join(root, 'staging');
    fs.mkdirSync(path.join(staging, 'good-pack'), { recursive: true });
    for (const bad of ['../evil', 'a/b', 'a\\b', '..', '.', '/abs', 'C:/abs', 'C:\\abs', '']) {
      assert.throws(() => resolveStagingSource(bad, staging),
        e => e instanceof PetImportError,
        `应拒绝: ${JSON.stringify(bad)}`);
    }
    assert.throws(() => resolveStagingSource(undefined, staging),
      e => e instanceof PetImportError && e.code === 'SOURCE_MISSING');
    const ok = resolveStagingSource('good-pack', staging);
    assert.equal(path.resolve(ok), path.resolve(path.join(staging, 'good-pack')));
    // 裸名解析后必落在 staging 内（复核包含关系）
    const rel = path.relative(path.resolve(staging), path.resolve(ok));
    assert.equal(rel.startsWith('..'), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('junction 逃逸防护：staging 内链接条目被拒，包外内容绝不落 web 服务目录', () => {
  const root = tmp('junc');
  try {
    const staging = path.join(root, 'staging');
    fs.mkdirSync(staging, { recursive: true });
    // 合规包放在 staging 外，staging/link-j junction 指过去
    const outsidePack = path.join(root, 'outside-pack');
    fs.renameSync(makePack(root, {}), outsidePack);
    fs.symlinkSync(outsidePack, path.join(staging, 'link-j'), 'junction');
    // 端点入口：真实路径包含复核在 stat/cpSync 跟随链接之前拒绝
    assert.throws(() => resolveStagingSource('link-j', staging),
      e => e instanceof PetImportError && e.code === 'OUTSIDE_STAGING');
    // CLI 直路径形态：源树审计拒绝链接根
    assert.throws(() => importPetPack({
      sourceDir: path.join(staging, 'link-j'), targetRoot: path.join(root, 'pets'),
    }), e => e instanceof PetImportError && e.code === 'SOURCE_SYMLINK');
    // 落位目录根本不该被创建（零残留）
    assert.equal(fs.existsSync(path.join(root, 'pets')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('junction 逃逸防护：包目录树内的嵌套链接条目被拒', () => {
  const root = tmp('junc2');
  try {
    const src = makePack(root, {});
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(src, 'extra'), 'junction');
    assert.throws(() => importPetPack({ sourceDir: src, targetRoot: path.join(root, 'pets') }),
      e => e instanceof PetImportError && e.code === 'SOURCE_SYMLINK');
    assert.equal(fs.existsSync(path.join(root, 'pets')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('导入端点：非回环 Host（DNS rebinding 形态）403，回环 Host 过闸进入后续校验', () => {
  const staging = tmp('host'); // 同入 A0-7 收集面（等价目录名）
  try {
    const mw = importEndpointMiddleware({
      petsRoot: path.join(staging, 'unused-pets'), stagingRoot: staging,
    });
    const call = (hostHeader) => {
      const hits = [];
      const req = { get: h => (h.toLowerCase() === 'x-zcode-monitor-import' ? '1' : hostHeader) };
      const res = {
        status(c) { hits.push(['status', c]); return this; },
        json(b) { hits.push(['error', b.error]); return this; },
      };
      mw(req, res);
      return hits;
    };
    // rebinding 下恶意页与 127.0.0.1「同源」可携带自定义首部，但 Host 头仍是攻击者域名
    assert.deepEqual(call('evil.example:7331'), [['status', 403], ['error', 'forbidden']]);
    assert.deepEqual(call('[::1]:7331'), [['status', 400], ['error', 'SOURCE_MISSING']],
      '回环 IPv6 Host 应过闸（进入 source 校验）');
    // 过闸后进入 source 校验（空 staging → SOURCE_MISSING），证明闸在 source 之前且已放行
    assert.deepEqual(call('127.0.0.1:7331'), [['status', 400], ['error', 'SOURCE_MISSING']]);
    assert.deepEqual(call('localhost:7331'), [['status', 400], ['error', 'SOURCE_MISSING']]);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
});

test('spritesheetPath 指向包外被拒（SHEET_MISSING，不读包外文件）', () => {
  const root = tmp('esc');
  try {
    const src = makePack(root);
    fs.writeFileSync(path.join(root, 'outside.webp'), vp8xSheet(LEGAL.w, LEGAL.h));
    fs.writeFileSync(path.join(src, 'pet.json'),
      JSON.stringify({ id: 'escape-pack', displayName: 'x', spritesheetPath: '../outside.webp' }));
    assert.throws(() => importPetPack({ sourceDir: src, targetRoot: path.join(root, 'pets') }),
      e => e instanceof PetImportError && e.code === 'SHEET_MISSING' && e.message.includes('越出包目录'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('spritesheetPath 为非固定名时，导入产物补一份 spritesheet.webp 固定名', () => {
  const root = tmp('alias');
  try {
    const src = makePack(root, { webp: null });
    fs.writeFileSync(path.join(src, 'pet.json'),
      JSON.stringify({ id: 'alias-pack', displayName: '别名', spritesheetPath: 'sheet.webp' }));
    fs.writeFileSync(path.join(src, 'sheet.webp'), vp8xSheet(LEGAL.w, LEGAL.h));
    const r = importPetPack({ sourceDir: src, targetRoot: path.join(root, 'pets') });
    assert.equal(fs.existsSync(path.join(r.dir, 'sheet.webp')), true);
    assert.equal(fs.existsSync(path.join(r.dir, 'spritesheet.webp')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('spritesheet_path（snake_case 键名）选路同样生效并补固定名', () => {
  const root = tmp('alias2');
  try {
    const src = makePack(root, { webp: null });
    fs.writeFileSync(path.join(src, 'pet.json'),
      JSON.stringify({ id: 'snake-pack', displayName: '蛇形', spritesheet_path: 'sheet.webp' }));
    fs.writeFileSync(path.join(src, 'sheet.webp'), vp8xSheet(LEGAL.w, LEGAL.h));
    const r = importPetPack({ sourceDir: src, targetRoot: path.join(root, 'pets') });
    assert.equal(r.ok, true);
    assert.equal(fs.existsSync(path.join(r.dir, 'sheet.webp')), true);
    assert.equal(fs.existsSync(path.join(r.dir, 'spritesheet.webp')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('buildNotice：来源包自带 NOTICE 原样保留在分隔线之后', () => {
  const text = buildNotice({
    id: 'p', name: 'P', source: 'u', author: 'a', license: 'l',
    originalNotice: 'ORIGINAL-CONTENT',
  });
  assert.ok(text.includes('---'));
  assert.ok(text.includes('ORIGINAL-CONTENT'));
  const noOrig = buildNotice({ id: 'p', name: 'P' });
  assert.ok(!noOrig.includes('---'));
});

test('A1-6 回归：精选包可发现、order 前置两名恒定、其余按序性质稳定（数量随内容增删）', () => {
  const packs = listPetPacks(path.join(REPO, 'public', 'pets'));
  assert.ok(packs.length >= 2, '至少发现两个精选包');
  // 回归守护的实质是 order 前置（pet-import.js listPetPacks 的注释契约）：
  // 数量硬编码会随图鉴内容增删假红（roster 已变过一次）
  assert.equal(packs[0].id, 'yuexinmiao');
  assert.equal(packs[1].id, 'maid-deepseek-whale');
  // 前置之后按首字符码兜底排序的相对顺序稳定
  const rest = packs.slice(2).map(p => p.id);
  assert.deepEqual(rest,
    [...rest].sort((a, b) => (90 + a.charCodeAt(0)) - (90 + b.charCodeAt(0))));
  for (const p of packs) {
    assert.equal(typeof p.name, 'string');
    assert.equal(p.sheet, '/pets/' + p.id + '/spritesheet.webp');
  }
});

test('listStagingPacks：hasPetJson 标记正确，staging 不存在返回 []', () => {
  const root = tmp('lst');
  try {
    const staging = path.join(root, 'staging');
    fs.mkdirSync(path.join(staging, 'has-json'), { recursive: true });
    fs.mkdirSync(path.join(staging, 'no-json'));
    fs.writeFileSync(path.join(staging, 'has-json', 'pet.json'),
      '\uFEFF{"display_name":"有JSON"}');
    fs.writeFileSync(path.join(staging, 'has-json', 'spritesheet.webp'), vp8xSheet(LEGAL.w, LEGAL.h));
    const packs = listStagingPacks(staging);
    assert.equal(packs.length, 2);
    assert.deepEqual(packs.map(p => p.id), ['has-json', 'no-json']); // 按名排序
    assert.equal(packs[0].name, '有JSON');
    assert.equal(packs[0].hasPetJson, true);
    assert.equal(packs[1].hasPetJson, false);
    assert.deepEqual(listStagingPacks(path.join(root, 'missing')), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('导入端点：缺首部 403；带首部放行；穿越 400 OUTSIDE_STAGING；重名 400 ID_TAKEN', async t => {
  const express = require('express');
  const root = tmp('end');
  try {
    const staging = path.join(root, 'staging');
    const petsRoot = path.join(root, 'pets');
    fs.mkdirSync(staging, { recursive: true });
    // staging 内的合法包：显式目录名（mkdtemp 随机后缀可能含大写，过不了 id 校验）
    const packName = 'endpoint-pack';
    const src = path.join(staging, packName);
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'pet.json'),
      JSON.stringify({ id: packName, displayName: '端点包' }));
    fs.writeFileSync(path.join(src, 'spritesheet.webp'), vp8xSheet(LEGAL.w, LEGAL.h));
    const app = express();
    app.use(express.json());
    app.post('/api/pets/import', importEndpointMiddleware({ petsRoot, stagingRoot: staging }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.on('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (body, extraHeaders = {}) => fetch(`${base}/api/pets/import`, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders),
      body: JSON.stringify(body),
    });
    try {
      // 缺自定义首部：跨源简单 POST 形态 → 一律 403
      const noHeader = await post({ source: packName });
      assert.equal(noHeader.status, 403);

      // 带首部 + staging 包名 → 200 导入成功
      const okRes = await post({ source: packName }, { 'X-Zcode-Monitor-Import': '1' });
      assert.equal(okRes.status, 200);
      const okBody = await okRes.json();
      assert.equal(okBody.ok, true);
      assert.equal(okBody.id, packName);
      assert.equal(fs.existsSync(path.join(petsRoot, packName, 'NOTICE.md')), true);

      // 重名 → 400 ID_TAKEN
      const dup = await post({ source: packName }, { 'X-Zcode-Monitor-Import': '1' });
      assert.equal(dup.status, 400);
      assert.equal((await dup.json()).error, 'ID_TAKEN');

      // 目录穿越形态 → 400 OUTSIDE_STAGING（绝不落到 staging 外）
      for (const bad of ['../evil', 'a/b', path.resolve(root, 'evil')]) {
        const res = await post({ source: bad }, { 'X-Zcode-Monitor-Import': '1' });
        assert.equal(res.status, 400, `应拒绝穿越形态: ${bad}`);
        assert.equal((await res.json()).error, 'OUTSIDE_STAGING');
      }
      assert.equal(fs.existsSync(path.join(root, 'evil')), false);
      assert.equal(fs.existsSync(path.join(root, 'b')), false);

      // force 覆盖 → 200
      const forceRes = await post({ source: packName, force: true },
        { 'X-Zcode-Monitor-Import': '1' });
      assert.equal(forceRes.status, 200);
      assert.equal((await forceRes.json()).ok, true);

      // 缺 source → 400 SOURCE_MISSING
      const missing = await post({}, { 'X-Zcode-Monitor-Import': '1' });
      assert.equal(missing.status, 400);
      assert.equal((await missing.json()).error, 'SOURCE_MISSING');
    } finally { server.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI：路径导入成功（--root 指到临时目录）；坏包退出码 1 并报错误码', async t => {
  const root = tmp('cli');
  try {
    const src = makePack(root, {});
    const outRoot = path.join(root, 'out');
    const cli = path.join(REPO, 'tools', 'import-pet.js');
    const ok = await execFileP(process.execPath,
      [cli, src, '--root', outRoot, '--id', 'cli-pack',
        '--source', 'https://example.com/x', '--author', '作者甲', '--license', 'MIT']);
    assert.ok(ok.stdout.includes('导入成功'));
    assert.ok(fs.existsSync(path.join(outRoot, 'cli-pack', 'NOTICE.md')));
    assert.ok(fs.readFileSync(path.join(outRoot, 'cli-pack', 'NOTICE.md'), 'utf8')
      .includes('author: 作者甲'));

    const badSrc = makePack(root, { webp: null });
    await assert.rejects(
      execFileP(process.execPath, [cli, badSrc, '--root', path.join(root, 'out2')]),
      err => err.code === 1 && String(err.stderr).includes('[SHEET_MISSING]'));

    // 裸包名形态：--staging 指向伪造 staging 根（pet.json id 与目录名一致，导入 id 即 bare-name）
    const staging = path.join(root, 'staging');
    fs.mkdirSync(staging);
    const namedSrc = makePack(staging, { petJson: { id: 'bare-name' } });
    await fs.promises.rename(namedSrc, path.join(staging, 'bare-name'));
    const bare = await execFileP(process.execPath,
      [cli, 'bare-name', '--staging', staging, '--root', path.join(root, 'out3')]);
    assert.ok(bare.stdout.includes('导入成功: bare-name'));

    // 裸名穿越形态被 CLI 拒绝（'..' 无分隔符、走 staging 名解析 → OUTSIDE_STAGING；
    // 含分隔符的路径形态按路径导入处理，不存在时报 SOURCE_MISSING，见上一用例）
    await assert.rejects(
      execFileP(process.execPath, [cli, '..', '--staging', staging, '--root', path.join(root, 'out4')]),
      err => err.code === 1 && String(err.stderr).includes('[OUTSIDE_STAGING]'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
