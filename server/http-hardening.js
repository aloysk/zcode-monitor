'use strict';
// http-hardening.js — 面板 HTTP 面的三个统一防线（可独立 require 供测试挂载）：
// 1) loopbackHostGate：/api 全局回环 Host 闸（防 DNS rebinding）。
//    面板无鉴权、默认只绑 127.0.0.1；DNS rebinding 让恶意页与 127.0.0.1「同源」
//    后即可携带同源凭据读全部 /api（整库转录外传）。请求的 Host 头仍是攻击者
//    域名——只接受回环形态（127.0.0.1 / localhost / [::1]，可带端口）。
//    写操作端点另要求自定义首部：/api/pets/import 要求 X-Zcode-Monitor-Import、
//    /api/checkpoint?force=1 要求 X-Zcode-Monitor-Checkpoint（均跨源简单请求
//    带不了，首部名常量见 pet-import.js / checkpoint-route.js），两闸叠加。
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

// ── 查询参数钳界（R5 修-high，阻断-1 横向覆盖）──────────────────────────────
// 缺陷形态：`Math.min(+q.limit || 默认, 上限)` 只有上界——?limit=-1 产出 -1，
// SQLite 的负 LIMIT = 无上限 → SELECT 整表同步物化（真实库实测 slowTools 8.8s /
// sessionList 6.4s / errorsList 1.8s，better-sqlite3 同步查询即事件循环冻结）。
// c69a145 只修了 raw.js；本组 helper 统一双侧钳界后应用到全部同类端点：
//   - clampLimit(value, fallback, max) → [1, max]：行数/条数类参数（与 raw.js
//     既有钳界语义逐字一致：负值钳 1、0/NaN 回落缺省、超上限钳 max）；
//   - clampAtLeast(value, fallback, max) → [0, max]：0 是有意义取值的形态
//     （transcript 的「取前 0 条」、raw 的 offset），负值钳 0 防 slice(0,-1)
//     静默丢尾行；max 缺省不设上界。NaN/Infinity 回落缺省。
function clampLimit(value, fallback, max) {
  const n = +value || fallback; // 0 / NaN / 缺省 → 缺省值（raw.js 既有语义）
  return Math.max(1, Math.min(n, max));
}

function clampAtLeast(value, fallback, max = Infinity) {
  const n = +value; // 0 在此是合法取值，不与缺省混淆；仅 NaN/±Infinity 回落
  return Number.isFinite(n) ? Math.max(0, Math.min(n, max)) : fallback;
}

// 重复 query 参数归一（四席全量审查轮，2026-09-25）：Express qs 把 `?k=a&k=b`
// 解析成数组、`?k[foo]=bar` 解析成对象、`?k[0][]=x` 解析成嵌套数组——非字符串
// 标量直透给 better-sqlite3 绑定会抛错落 500（实测 GET /api/usage/attribution?
// session_id=s1&session_id=s2 → 500 internal；第 2 轮安全席又实证 bracket/
// 对象深层形态同 500）。归一语义＝取首值（HTML 表单重复键的常见解析语义），
// 非字符串一律回落 ''（与缺参同语义：如 attribution 的 session_id 空 → 400
// 引导、q/task_type 空 → 不筛选；先例 routes/raw.js 的 `typeof === 'string'`
// 守卫）。clampLimit 数值面 `+[]`/`+{}` 的 Number 化已天然安全，不经本 helper。
function firstParam(v) {
  if (Array.isArray(v)) v = v.length ? v[0] : '';
  return typeof v === 'string' ? v : '';
}

// 锁竞争/连接损伤错误翻译中间件工厂（R4 修-low，自 server/index.js 内联逻辑抽出
// 供测试挂载，行为不变）：SQLite busy/locked → 503 database_busy（可重试），
// 连接损伤（CORRUPT/NOTADB/IOERR）→ 503 database_unavailable，均先 invalidateDb
// 丢弃只读连接缓存让下次请求重开；其余错误 next(err) 透传。
// 挂载位置约定（index.js）：必须注册在所有会碰 DB 的 /api 路由之后（Express 按
// 注册顺序选中错误处理器——先注册的翻译层罩不住后注册路由抛出的错误，曾致
// /api/widget/today、/api/widget/recent 出错时 500 而非契约 503）。
function makeErrorTranslator({ invalidateDb } = {}) {
  return (err, _req, res, next) => {
    const msg = (err && err.message) || String(err);
    const code = err && (err.code || err.errno);
    const isLock = code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED'
      || /database is locked|unable to open database|database table is locked/i.test(msg);
    if (isLock) {
      if (typeof invalidateDb === 'function') invalidateDb(); // force a fresh connection next time
      return res.status(503).json({
        error: 'database_busy',
        message: 'ZCode 正在写入数据库，请稍后重试。',
        retryable: true,
      });
    }
    // connection damage → 503 too, the next request will reopen
    const broken = code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB' || code === 'SQLITE_IOERR'
      || /bad database|file is not a database|disk i\/o/i.test(msg);
    if (broken) {
      if (typeof invalidateDb === 'function') invalidateDb();
      return res.status(503).json({
        error: 'database_unavailable',
        message: '数据库连接异常，正在自动重连。',
        retryable: true,
      });
    }
    next(err);
  };
}

module.exports = { LOOPBACK_HOST_RE, loopbackHostGate, CSP, securityHeaders, petsStaticOptions,
                   makeErrorTranslator, clampLimit, clampAtLeast, firstParam };
