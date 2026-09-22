'use strict';
// 30 字节最小 RIFF/VP8X 头：仅承载画布宽高（各减一、3 字节小端），非可渲染图像。
// webpSize 只读前 30 字节（tools/webp-size.js），导入校验只需尺寸，不需要真图。
const fs = require('fs');
const path = require('path');

function vp8xSheet(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(22, 4);
  b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii');
  b.writeUInt32LE(10, 16); b.writeUInt32LE(0, 20);
  const w1 = w - 1, h1 = h - 1;
  b[24] = w1 & 0xff; b[25] = (w1 >> 8) & 0xff; b[26] = (w1 >> 16) & 0xff;
  b[27] = h1 & 0xff; b[28] = (h1 >> 8) & 0xff; b[29] = (h1 >> 16) & 0xff;
  return b;
}

function writeSheet(dir, name, w, h) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, vp8xSheet(w, h));
  return p;
}

module.exports = { vp8xSheet, writeSheet };
