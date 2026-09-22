#!/usr/bin/env node
// import-pet.js <包名|包目录> [--id <id>] [--source <url|text>] [--author <name>]
//               [--license <spdx|text>] [--force] [--root <targetRoot>] [--staging <dir>]
// 把一个 Codex 宠物包（pet.json + spritesheet.webp）校验并导入 zcode-monitor。
// 裸包名默认在 tools/pets-staging/ 下解析（--staging 可换根）；给路径则按路径导入。
// targetRoot 默认 <repo>/public/pets（导入产物不入 git，见 .gitignore 白名单）。
'use strict';
const path = require('path');
const {
  importPetPack, resolveStagingSource, PetImportError, DEFAULT_STAGING_ROOT,
} = require('../server/pet-import');

const args = process.argv.slice(2);
// 位置参数识别须排除「已知名选项的值」：`node tools/import-pet.js --id foo`
// （漏写包名）若把 'foo' 当包名送进 staging 解析，会报 OUTSIDE_STAGING 而非
// 用法提示，误导排障。
const VALUE_OPTS = ['id', 'source', 'author', 'license', 'root', 'staging'];
const consumed = new Set();
for (const name of VALUE_OPTS) {
  const i = args.indexOf('--' + name);
  if (i >= 0 && i + 1 < args.length) consumed.add(i + 1);
}
const positional = args.find((a, i) => !a.startsWith('--') && !consumed.has(i));
const opt = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (!positional) {
  console.error('用法: node tools/import-pet.js <包名|包目录> [--id <id>] [--source <url>] '
    + '[--author <name>] [--license <l>] [--force] [--root <dir>] [--staging <dir>]');
  process.exit(1);
}

// 裸名 → staging 内解析（强制包含关系）；含分隔符或绝对路径 → 按路径导入
let sourceDir;
try {
  const looksLikePath = path.isAbsolute(positional)
    || positional.includes('/') || positional.includes('\\');
  sourceDir = looksLikePath
    ? positional
    : resolveStagingSource(positional, opt('staging') || DEFAULT_STAGING_ROOT);
} catch (e) {
  console.error(`导入失败 [${e.code}]: ${e.message}`);
  process.exit(1);
}

try {
  const r = importPetPack({
    sourceDir,
    targetRoot: opt('root') || path.join(__dirname, '..', 'public', 'pets'),
    id: opt('id'),
    source: opt('source'),
    author: opt('author'),
    license: opt('license'),
    force: args.includes('--force'),
  });
  for (const w of r.warnings) {
    if (w === 'source_missing') console.warn('警告: 未提供来源，NOTICE 记为 source: <未提供>（导入未阻断）');
    if (w === 'author_missing') console.warn('警告: 未提供原作者，NOTICE 记为 author: <未提供>（导入未阻断）');
    if (w === 'license_missing') console.warn('警告: 未提供许可证，NOTICE 记为 license: unknown（导入未阻断）');
  }
  console.log(`导入成功: ${r.id} → ${r.dir}`);
} catch (e) {
  if (e instanceof PetImportError) {
    console.error(`导入失败 [${e.code}]: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
