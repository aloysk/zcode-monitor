// webp-size.js <file...> — print each WebP's canvas dimensions from the
// RIFF/VP8X (or VP8/VP8L) header without an image library.
'use strict';
const fs = require('fs');

function webpSize(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') {
    // VP8X: 10-byte payload; canvas size is 24-bit minus one, little-endian
    const w = 1 + (buf[24] | buf[25] << 8 | buf[26] << 16);
    const h = 1 + (buf[27] | buf[28] << 8 | buf[29] << 16);
    return { w, h };
  }
  if (fourcc === 'VP8 ') {
    // lossy: frame tag 3 bytes + start code 3 bytes, then 14-bit w/h
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return { w, h };
  }
  if (fourcc === 'VP8L') {
    // lossless: 14-bit w-1 / h-1 packed into 4 bytes after signature
    const b = buf.readUInt32LE(21);
    const w = (b & 0x3fff) + 1;
    const h = ((b >> 14) & 0x3fff) + 1;
    return { w, h };
  }
  return null;
}

if (require.main === module) {
  for (const f of process.argv.slice(2)) {
    const s = webpSize(fs.readFileSync(f));
    const ok = s && s.w === 1536 && s.h % 208 === 0 && s.h / 208 >= 9;
    console.log(`${f}: ${s ? s.w + 'x' + s.h + ' rows=' + (s.h / 208) : 'PARSE-FAIL'} ${ok ? 'OK' : 'NONSTANDARD'}`);
  }
}

module.exports = { webpSize };
