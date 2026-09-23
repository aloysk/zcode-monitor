'use strict';
// pet-import.js — Codex 宠物包（pet.json + spritesheet.webp）导入共享模块。
// CLI（tools/import-pet.js）与导入端点（POST /api/pets/import）复用同一实现。
//
// 布局契约与 public/pet.html:184-187 字面一致：CELL_W 192 × COLS 8 = 1536 宽；
// 高度须被 CELL_H 208 整除且行数 ≥ 9（ROW_ANIMS 固定 9 行，含 failed、
// waiting_permission 行）。像素级空行检测留在页面 scanRow，服务端不引入
// 图像解码依赖（只读 webp 头尺寸，tools/webp-size.js）。
const fs = require('fs');
const path = require('path');
const { webpSize } = require('../tools/webp-size');
const { LOOPBACK_HOST_RE } = require('./http-hardening');

const CELL_W = 192;
const CELL_H = 208;
const COLS = 8;
const SHEET_W = CELL_W * COLS; // 1536
const MIN_ROWS = 9;            // ROW_ANIMS 9 行契约
const IMPORT_HEADER = 'x-zcode-monitor-import';
const DEFAULT_STAGING_ROOT = path.join(__dirname, '..', 'tools', 'pets-staging');
// 包 id 即落位目录名：小写字母/数字/连字符，天然排除路径分隔符与 ..
const ID_RE = /^[a-z0-9-]+$/;
// 资源上限：导入是同步复制路径，无上限时一个 GB 级 webp 或巨型目录树会冻结
// 事件循环。精灵契约下 32MB/2000 条目都是远超正常包的宽松上界。
const SHEET_MAX_BYTES = 32 * 1024 * 1024;
const AUDIT_MAX_ENTRIES = 2000;
// 「许可证未知」的语义等价串：占位 unknown 与自报无授权的常见写法都走确认门；
// 自报的具体许可证（MIT/CC-BY-…）是用户提供的事实性元数据，照 NOTICE 记录、
// 不需确认（ack 的语义是「知悉授权未核实」，对自报 SPDX 串加确认只加摩擦不
// 加核实）。
const LICENSE_UNKNOWN_RE = /^(unknown|unlicensed|none|n\/a|not known|未知|无)$/i;

class PetImportError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function stripBom(s) { return s.replace(/^\uFEFF/, ''); }

// 读取并解析 pet.json：容忍 UTF-8 BOM 与 snake_case 键
// （对齐 /api/pets 既有扫描逻辑的容忍面）。
function readPetJson(sourceDir) {
  const p = path.join(sourceDir, 'pet.json');
  if (!fs.existsSync(p)) throw new PetImportError('PET_JSON_MISSING', `缺少 pet.json: ${sourceDir}`);
  let raw;
  try { raw = JSON.parse(stripBom(fs.readFileSync(p, 'utf8'))); }
  catch (e) { throw new PetImportError('PET_JSON_INVALID', `pet.json 解析失败: ${e.message}`); }
  return raw && typeof raw === 'object' ? raw : {};
}

// spritesheet 尺寸读取 + 布局契约校验。相对路径强制留在包目录之内（防穿越）：
// 词法包含复核之后再用 fs.realpathSync 双向比对真实路径——指向包外的符号链接
// 在词法视角完全合法，只有真实路径包含复核对它成立。
function checkSheet(sourceDir, pet) {
  const rel = pet.spritesheetPath || pet.spritesheet_path || 'spritesheet.webp';
  if (typeof rel !== 'string' || !rel.trim()) {
    throw new PetImportError('SHEET_MISSING', 'pet.json 的 spritesheetPath 为空');
  }
  const src = path.resolve(sourceDir);
  const p = path.resolve(src, rel);
  const contained = path.relative(src, p);
  if (contained === '' || contained.startsWith('..') || path.isAbsolute(contained)) {
    throw new PetImportError('SHEET_MISSING', `spritesheet 路径越出包目录: ${rel}`);
  }
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
    throw new PetImportError('SHEET_MISSING', `spritesheet 不存在: ${rel}`);
  }
  // 体积上限（32MB）：导入复制是同步路径，超大文件会冻结事件循环；精灵契约下
  // 真实 sheet 远小于此。头部只读 32 字节不受影响（见下）。
  if (fs.statSync(p).size > SHEET_MAX_BYTES) {
    throw new PetImportError('SHEET_TOO_LARGE',
      `spritesheet ${fs.statSync(p).size} 字节超上限 ${SHEET_MAX_BYTES}（同步复制路径的资源上限）`);
  }
  let realSrc, realP;
  try { realSrc = fs.realpathSync(src); realP = fs.realpathSync(p); }
  catch { throw new PetImportError('SHEET_MISSING', `spritesheet 不可达: ${rel}`); }
  const containedReal = path.relative(realSrc, realP);
  if (containedReal === '' || containedReal.startsWith('..') || path.isAbsolute(containedReal)) {
    throw new PetImportError('SHEET_MISSING', `spritesheet 真实路径越出包目录（链接?）: ${rel}`);
  }
  // 只读头部 32 字节交给 webpSize（三种 fourcc 分支最多索引到第 30 字节）：
  // staging 里一个损坏/超大文件不应被整文件 readFileSync 全量载入内存。
  let head;
  try {
    const fd = fs.openSync(p, 'r');
    try {
      head = Buffer.alloc(32);
      head = head.subarray(0, fs.readSync(fd, head, 0, 32, 0));
    } finally { fs.closeSync(fd); }
  } catch (e) { throw new PetImportError('SHEET_UNPARSEABLE', `webp 无法解析（读取失败）: ${e.message}`); }
  let size;
  try { size = webpSize(head); }
  catch (e) { throw new PetImportError('SHEET_UNPARSEABLE', `webp 无法解析（头部损坏）: ${e.message}`); }
  if (!size) throw new PetImportError('SHEET_UNPARSEABLE', 'webp 无法解析（RIFF/WEBP 头缺失或损坏）');
  if (size.w !== SHEET_W) {
    throw new PetImportError('SHEET_WIDTH', `sheet 宽度 ${size.w} ≠ ${SHEET_W}（CELL_W ${CELL_W} × COLS ${COLS}）`);
  }
  if (size.h % CELL_H !== 0) {
    throw new PetImportError('SHEET_HEIGHT', `sheet 高度 ${size.h} 不能被 ${CELL_H} 整除（CELL_H）`);
  }
  const rows = size.h / CELL_H;
  if (rows < MIN_ROWS) {
    throw new PetImportError('SHEET_ROWS', `sheet 行数 ${rows} < ${MIN_ROWS}（ROW_ANIMS 契约，含 failed/waiting_permission 行）`);
  }
  return { sheetRel: rel, w: size.w, h: size.h, rows };
}

// 源目录树安全审计：任何 symlink/junction 条目（含 sourceDir 本身）一律拒绝。
// fs.statSync/fs.cpSync 都跟随链接——staging 里一个指向包外的 junction，字面名
// 落在词法包含校验之内、真实目标在外，能把 staging 外的整棵目录树带进可被
// HTTP 静态服务的 public/pets（违背 index.js 声明的 "imports may only source
// from inside this directory"）。包目录树很小（pet.json + webp + NOTICE），
// 全树 lstat 成本可忽略。返回遍历到的条目数（供测试断言审计确实发生）。
function auditNoSymlinks(rootDir) {
  if (fs.lstatSync(rootDir).isSymbolicLink()) {
    throw new PetImportError('SOURCE_SYMLINK', `来源目录本身是链接，拒绝导入: ${rootDir}`);
  }
  let seen = 0;
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (++seen > AUDIT_MAX_ENTRIES) {
        // 条目上限：审计与白名单复制都是同步遍历，巨型目录树会冻结事件循环
        throw new PetImportError('SOURCE_TOO_LARGE',
          `来源目录条目超过上限 ${AUDIT_MAX_ENTRIES}（同步遍历路径的资源上限）`);
      }
      if (d.isSymbolicLink()) {
        throw new PetImportError('SOURCE_SYMLINK',
          `来源目录树内含 symlink/junction，拒绝导入: ${path.join(dir, d.name)}`);
      }
      if (d.isDirectory()) walk(path.join(dir, d.name));
    }
  };
  walk(rootDir);
  return seen;
}

// NOTICE.md（导入生成）：来源 URL、原作者、许可证三字段 + 免责声明模板。
// 字段缺失写占位（<未提供>/unknown）；许可证缺失/unknown 需 ackUnknownLicense
// 显式确认后导入（见 importPetPack），其余字段缺失仅 warnings 提示。
// 来源包自带的 NOTICE.md 原样保留在分隔线之后。
function buildNotice({ id, name, source, author, license, originalNotice = '' }) {
  const lines = [
    `# ${name}（${id}）— NOTICE（zcode-monitor 导入生成）`, '',
    `- source: ${source || '<未提供>'}`,
    `- author: ${author || '<未提供>'}`,
    `- license: ${license || 'unknown'}`, '',
    '## 免责声明', '',
    '本包素材的来源与授权状态未经核实，导入时未确认与原作品权利方存在任何隶属、合作或背书关系。',
    '素材著作权归原作者/原权利人所有；请在遵守来源许可与当地法律的前提下限于本地个人非商用使用，不得再分发、转售或用于商业用途。',
    '如权利方或其代表不希望该素材被使用，请联系本仓库维护者移除。', '',
  ];
  if (originalNotice) lines.push('---', '', '# 来源包自带 NOTICE（原样保留）', '', originalNotice);
  return lines.join('\n') + '\n';
}

// 导入白名单：只允许带走这些文件，其余一律跳过并计入 warnings（extra_files_skipped）。
// staging 包里可能夹带任何文件（下载器残留、预览 .html/.svg 等）——public/ 由
// express.static 以面板同源（127.0.0.1:7331）直接服务，一个附带页面就等于
// 在本服务源上落地可执行内容（可读 /api/raw 等并外传）。白名单外文件一律不进
// public/pets；静态侧另有 /pets 非图片强制 octet-stream+attachment 的第二道防线。
// README/LICENSE 的前缀匹配限定纯文本扩展名（裸名亦常见，放行）：不限扩展名时
// README.html 会经白名单落进 /pets（当前被第二道防线中和，但不应依赖它）。
const TOP_LEVEL_ALLOW = [
  /^pet\.json$/i,
  /^notice\.md$/i,
  /^readme([^/]*\.(md|txt))?$/i,
  /^(license|licence)([^/]*\.(md|txt))?$/i,
];
function copyWhitelisted(sourceDir, tmpDir, sheetRel) {
  const sheetPosix = path.posix.normalize(String(sheetRel).replace(/\\/g, '/'));
  const sheetDirs = new Set();
  let acc = '';
  for (const seg of sheetPosix.split('/').slice(0, -1)) {
    acc = acc ? acc + '/' + seg : seg;
    sheetDirs.add(acc);
  }
  const allowed = (relPosix, isDir) =>
    relPosix === sheetPosix
    || (isDir && sheetDirs.has(relPosix))
    || (!relPosix.includes('/') && TOP_LEVEL_ALLOW.some(re => re.test(relPosix)));
  const skipped = [];
  const walk = (dir, relPosix) => {
    fs.mkdirSync(relPosix ? path.join(tmpDir, relPosix) : tmpDir, { recursive: true });
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const relChild = relPosix ? relPosix + '/' + e.name : e.name;
      if (!allowed(relChild, e.isDirectory())) { skipped.push(relChild); continue; }
      if (e.isDirectory()) walk(path.join(dir, e.name), relChild);
      else fs.copyFileSync(path.join(dir, e.name), path.join(tmpDir, relChild));
    }
  };
  walk(sourceDir, '');
  return skipped;
}

// 导入一个包：先全量校验，再复制到临时目录、写 NOTICE、最后 rename 原子落位。
// 失败路径清理临时目录，目标根无残留。force 覆盖同名包（旧包先挪到回收名，
// 落位成功后删除；落位失败回滚恢复旧包）。
function importPetPack({ sourceDir, targetRoot, id, source, author, license,
                         force = false, ackUnknownLicense = false }) {
  if (!sourceDir || !fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new PetImportError('SOURCE_MISSING', `来源目录不存在: ${sourceDir}`);
  }
  if (!targetRoot) throw new PetImportError('SOURCE_MISSING', '缺少 targetRoot（目标根目录）');
  // 在任何 stat/cpSync 跟随链接之前先审计源树：链接条目一律拒绝（见 auditNoSymlinks）。
  auditNoSymlinks(sourceDir);

  const pet = readPetJson(sourceDir);
  const name = pet.displayName || pet.display_name || pet.name || id || path.basename(sourceDir);
  if (!id) id = pet.id || path.basename(sourceDir);
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new PetImportError('ID_INVALID', `非法包 id（须匹配 [a-z0-9-]+）: ${id}`);
  }
  const { sheetRel } = checkSheet(sourceDir, pet);
  // 许可证缺失/unknown 需显式确认才放行：导入产物落在以本服务同源静态分发的
  // public/pets，未核实授权的素材应至少有一次知情确认（API ackUnknownLicense
  // / CLI --ack-unlicensed）；确认后仍照常生成 license: unknown 占位与警告。
  // ack 只认 === true：宽松真值（"false" 字符串/数组等）不得视作确认。
  const licenseUnknown = !license
    || LICENSE_UNKNOWN_RE.test(String(license).trim());
  if (licenseUnknown && ackUnknownLicense !== true) {
    throw new PetImportError('LICENSE_UNKNOWN',
      '许可证缺失或未知（NOTICE 将记 license: unknown）：导入需显式确认——'
      + 'API 传 ackUnknownLicense: true，CLI 加 --ack-unlicensed。请先核实来源与授权状态。');
  }

  const targetRootAbs = path.resolve(targetRoot);
  const finalDir = path.join(targetRootAbs, id);
  let asideDir = null;
  if (fs.existsSync(finalDir)) {
    if (!force) throw new PetImportError('ID_TAKEN', `目标已存在同名包（覆盖请用 --force）: ${id}`);
    // Windows 的 rename 不能覆盖非空目录：先把旧包挪走，落位成功后再删除
    asideDir = path.join(targetRootAbs, `.import-old-${id}-${process.pid}-${Date.now()}`);
    fs.renameSync(finalDir, asideDir);
  }

  fs.mkdirSync(targetRootAbs, { recursive: true });
  const tmpDir = path.join(targetRootAbs, `.import-${id}-${process.pid}-${Date.now()}`);
  let skippedNames = null;
  try {
    skippedNames = copyWhitelisted(sourceDir, tmpDir, sheetRel);
    const origNoticePath = path.join(tmpDir, 'NOTICE.md');
    const originalNotice = fs.existsSync(origNoticePath)
      ? fs.readFileSync(origNoticePath, 'utf8') : '';
    fs.writeFileSync(path.join(tmpDir, 'NOTICE.md'),
      buildNotice({ id, name, source, author, license, originalNotice }));
    // /api/pets 与 pet 页按固定名 spritesheet.webp 发现/引用：来源里叫别的名字时补一份固定名
    if (path.posix.normalize(sheetRel.replace(/\\/g, '/')) !== 'spritesheet.webp') {
      fs.copyFileSync(path.join(tmpDir, sheetRel), path.join(tmpDir, 'spritesheet.webp'));
    }
    fs.renameSync(tmpDir, finalDir); // 同卷原子落位
  } catch (e) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 尽力清理 */ }
    if (asideDir) {
      try { fs.renameSync(asideDir, finalDir); } catch { /* 旧包恢复失败只能如实上报 */ }
    }
    throw e;
  }
  if (asideDir) {
    try { fs.rmSync(asideDir, { recursive: true, force: true }); } catch { /* 尽力清理 */ }
  }

  const warnings = [];
  if (!source) warnings.push('source_missing');
  if (!author) warnings.push('author_missing');
  if (licenseUnknown) warnings.push('license_missing');
  if (skippedNames && skippedNames.length) warnings.push('extra_files_skipped');
  return { ok: true, id, name, dir: finalDir, warnings, skippedFiles: skippedNames };
}

// /api/pets 的包发现逻辑（自 server/index.js 原样搬入，root 可注入）。
// order 前置 + 首字符码兜底排序保持不变（回归守护：yuexinmiao、maid-deepseek-whale 恒排最前）。
// 点前缀目录（.import-*/.import-old-* 轮换残留等）不参与轮换：覆盖路径挪走旧包、
// 落位失败回滚的窄窗里它们会短暂存在，按正式包列出即"幽灵包"。
function listPetPacks(root) {
  const order = ['yuexinmiao', 'maid-deepseek-whale'];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(d => !d.name.startsWith('.'))
    .filter(d => d.isDirectory()
      && fs.existsSync(path.join(root, d.name, 'pet.json'))
      && fs.existsSync(path.join(root, d.name, 'spritesheet.webp')))
    .map(d => {
      try {
        // some galleries emit PowerShell-style JSON: UTF-8 BOM (JSON.parse
        // throws on it) and snake_case keys — tolerate both
        const raw = fs.readFileSync(path.join(root, d.name, 'pet.json'), 'utf8').replace(/^\uFEFF/, '');
        const m = JSON.parse(raw);
        const name = m.displayName || m.display_name || m.name || d.name;
        return { id: d.name, name, sheet: '/pets/' + d.name + '/spritesheet.webp' };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (order.indexOf(a.id) + 1 || 90 + a.id.charCodeAt(0)) - (order.indexOf(b.id) + 1 || 90 + b.id.charCodeAt(0)));
}

// staging 包清单（预览页“从暂存导入”入口的数据源）。
// staging 不存在时返回 []（不抛错），hasPetJson 标记哪些可直接导入。
// 点前缀目录（.import-* 等）与正式轮换同理由不列出。
function listStagingPacks(stagingRoot = DEFAULT_STAGING_ROOT) {
  let entries;
  try { entries = fs.readdirSync(stagingRoot, { withFileTypes: true }); }
  catch { return []; }
  return entries.filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => {
    const petJsonPath = path.join(stagingRoot, d.name, 'pet.json');
    const hasPetJson = fs.existsSync(petJsonPath);
    let name = d.name;
    if (hasPetJson) {
      try {
        const m = JSON.parse(stripBom(fs.readFileSync(petJsonPath, 'utf8')));
        name = (m && (m.displayName || m.display_name || m.name)) || d.name;
      } catch { /* 名字回落目录名；真正导入时会报 PET_JSON_INVALID */ }
    }
    return { id: d.name, name, hasPetJson };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

// 把 staging 包目录名解析为绝对路径。只接受单段目录名：绝对路径、盘符、
// 任何分隔符、. / .. 一律拒绝；再用 path.relative 复核解析结果确落在
// stagingRoot 之内（防目录穿越，端点入参的唯一入口）。词法复核对链接不可见
// （staging 里的 junction 条目字面名在根内、真实目标在外），故最后用
// fs.realpathSync 双向比对真实路径，链接逃逸在 stat/cpSync 跟随之前被挡下。
function resolveStagingSource(source, stagingRoot = DEFAULT_STAGING_ROOT) {
  if (typeof source !== 'string' || !source.trim()) {
    throw new PetImportError('SOURCE_MISSING', '缺少 source（staging 内的包目录名）');
  }
  const name = source.trim();
  if (name === '.' || name === '..'
    || path.isAbsolute(name)
    || /^[a-zA-Z]:/.test(name)
    || name !== path.basename(name)) {
    throw new PetImportError('OUTSIDE_STAGING', `source 必须是 staging 内的包目录名，拒绝路径形态: ${source}`);
  }
  const root = path.resolve(stagingRoot);
  const dir = path.resolve(root, name);
  const rel = path.relative(root, dir);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PetImportError('OUTSIDE_STAGING', `source 解析后越出 staging 根: ${source}`);
  }
  let realRoot, realDir;
  try {
    realRoot = fs.realpathSync(root);
    realDir = fs.realpathSync(dir);
  } catch {
    throw new PetImportError('SOURCE_MISSING', `staging 内不存在该包目录: ${source}`);
  }
  const relReal = path.relative(realRoot, realDir);
  if (relReal === '' || relReal.startsWith('..') || path.isAbsolute(relReal)) {
    throw new PetImportError('OUTSIDE_STAGING', `source 真实路径越出 staging 根（链接?）: ${source}`);
  }
  return dir;
}

// 导入端点中间件。三道防线：
// 1) 自定义首部 X-Zcode-Monitor-Import: 1 —— 跨源“简单 POST”无法携带自定义首部，
//    本服务也不回 preflight，可挡住恶意网页诱导的跨站写入；
// 2) Host 闸：DNS rebinding 让恶意页与 127.0.0.1「同源」从而能携带自定义首部，
//    但请求的 Host 头仍是攻击者域名——只接受回环形态的 Host；
// 3) body.source 只接受 staging 内的包目录名（resolveStagingSource 强制包含关系，
//    词法 + 真实路径双重复核），导入前源树再做 symlink/junction 审计。
// 防护边界（显式声明）：三道防线针对浏览器侧 CSRF / DNS rebinding 设计。若以
// HOST=0.0.0.0 覆写监听（server/index.js 的 HOST 环境变量），非浏览器直连客户端
// 可伪造回环 Host 与自定义首部绕过前两道闸——这与整个面板的无鉴权回环姿态一致
// （默认只绑 127.0.0.1 即是主防线），写入面亦已限定在 staging → public/pets；
// 对外暴露场景须自行加鉴权层，而非依赖本中间件。读面另由 /api 全局回环 Host
// 闸覆盖（server/http-hardening.js loopbackHostGate）。
function importEndpointMiddleware({ petsRoot, stagingRoot } = {}) {
  const staging = stagingRoot || DEFAULT_STAGING_ROOT;
  return (req, res) => {
    if (req.get(IMPORT_HEADER) !== '1') {
      return res.status(403).json({ ok: false, error: 'forbidden',
        message: '缺少 X-Zcode-Monitor-Import 首部：该端点只接受本地图鉴页发起的请求。' });
    }
    const host = String(req.get('host') || '').toLowerCase();
    if (!LOOPBACK_HOST_RE.test(host)) {
      return res.status(403).json({ ok: false, error: 'forbidden',
        message: `拒绝非回环 Host「${host}」：该端点只接受 127.0.0.1/localhost 发起（防 DNS rebinding）。` });
    }
    const body = req.body || {};
    const { source, id, sourceUrl, author, license, force, ackUnknownLicense } = body;
    if (!source) {
      return res.status(400).json({ ok: false, error: 'SOURCE_MISSING',
        message: '缺少 source（staging 内的包目录名）' });
    }
    try {
      const sourceDir = resolveStagingSource(source, staging);
      const r = importPetPack({
        sourceDir, targetRoot: petsRoot,
        id, source: sourceUrl, author, license, force: !!force,
        ackUnknownLicense: ackUnknownLicense === true, // 只认布尔 true（低-f）
      });
      return res.json(r);
    } catch (e) {
      if (e instanceof PetImportError) {
        return res.status(400).json({ ok: false, error: e.code, message: e.message });
      }
      console.error('[pet-import] unexpected error:', e);
      return res.status(500).json({ ok: false, error: 'INTERNAL',
        message: String((e && e.message) || e) });
    }
  };
}

module.exports = {
  PetImportError, importPetPack, listPetPacks, listStagingPacks,
  resolveStagingSource, importEndpointMiddleware, buildNotice,
  CELL_W, CELL_H, COLS, SHEET_W, MIN_ROWS, DEFAULT_STAGING_ROOT,
};
