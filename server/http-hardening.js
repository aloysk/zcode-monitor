'use strict';
// http-hardening.js — 面板 HTTP 面的三个统一防线（可独立 require 供测试挂载）：
// 1) loopbackHostGate：/api 全局回环 Host 闸（防 DNS rebinding）。
//    面板无鉴权、默认只绑 127.0.0.1；DNS rebinding 让恶意页与 127.0.0.1「同源」
//    后即可携带同源凭据读全部 /api（整库转录外传）。请求的 Host 头仍是攻击者
//    域名——只接受回环形态（127.0.0.1 / localhost / [::1]，可带端口）。
//    写操作端点（/api/pets/import）另要求自定义首部 X-Zcode-Monitor-Import
//    （跨源简单 POST 带不了），两闸叠加。
// 2) securityHeaders：全站 CSP + X-Content-Type-Options: nosniff。
// 3) petsStaticOptions：/pets 静态服务的收紧选项（非图片强制下载，防导入面
//    夹带的 .html/.svg 以面板同源执行）。
// 防护边界（显式声明）：HOST=0.0.0.0 覆写监听后，非浏览器直连客户端可伪造
// 回环 Host 绕过本闸——与面板的无鉴权回环姿态一致（默认只绑 127.0.0.1 即主
// 防线），对外暴露场景须自行加鉴权层。

const LOOPBACK_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

function loopbackHostGate(req, res, next) {
  const host = String(req.get('host') || '').toLowerCase();
  if (!LOOPBACK_HOST_RE.test(host)) {
    return res.status(403).json({
      ok: false,
      error: 'forbidden',
      message: `拒绝非回环 Host「${host}」：API 只接受 127.0.0.1/localhost 访问（防 DNS rebinding）。`,
    });
  }
  next();
}

// CSP 把页面的可执行面钉死在自身来源。本仓前端为无构建器的内联形态，
// script/style 需 'unsafe-inline'（无 nonce 基建，务实取舍）；Chart.js 已本地化
// （public/assets/chart.umd.js），script 无任何外联；仅剩的外联是 pet/widget 两页
// 的字体 CSS（fonts.googleapis.com + 字体文件 fonts.gstatic.com，本地化的取舍见
// docs/acceptance/residuals.md R-8）；SSE/fetch 全部同源。form-action/
// frame-ancestors 收窄导航与嵌入面；注意 CSP 管不到顶层导航，「钉死外传面」的
// 说法不成立（数据外传由 connect-src 限制，导航型外传需用户参与）。
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self' https://fonts.gstatic.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', CSP);
  next();
}

// /pets 静态收紧：本仓精灵图全部是 spritesheet.webp，目录内其余类型
// （pet.json/NOTICE.md，或任何经手工放入的白名单外文件）一律以 octet-stream +
// attachment 下发——即使有可执行面（.html/.svg）混进 public/pets，也不能再以
// 面板同源在浏览器里执行。SVG 有脚本载体能力，不按图片放行（精灵管线只产 webp）。
const PETS_RASTER_RE = /\.(webp|png|gif|jpe?g)$/i;
function petsStaticOptions() {
  return {
    setHeaders(res, filePath) {
      if (!PETS_RASTER_RE.test(filePath)) {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment');
      }
    },
  };
}

module.exports = { LOOPBACK_HOST_RE, loopbackHostGate, CSP, securityHeaders, petsStaticOptions };
