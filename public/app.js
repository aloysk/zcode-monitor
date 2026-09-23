'use strict';
// app.js — app shell: topbar nav + hash routing + shared helpers.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ── formatters ──────────────────────────────────────────
function fmtNum(n) {
  if (n == null) return '—';
  if (typeof n !== 'number') return String(n);
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
function fmtInt(n) { return n == null ? '—' : Number(n).toLocaleString(); }
function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return Math.round(ms) + 'ms';
  return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's';
}
function fmtDur(sec) {
  if (sec == null) return '—';
  if (sec < 60) return Math.round(sec) + 's';
  if (sec < 3600) { const m = Math.floor(sec/60), s = Math.round(sec%60); return m + 'm' + (s ? s + 's' : ''); }
  return Math.floor(sec/3600) + 'h' + Math.floor((sec%3600)/60) + 'm';
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2,'0'), mm = String(d.getMinutes()).padStart(2,'0'), ss = String(d.getSeconds()).padStart(2,'0');
  return sameDay ? `${hh}:${mm}:${ss}` : `${d.getMonth()+1}/${d.getDate()} ${hh}:${mm}`;
}
function fmtTimeFull(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString();
}
function relTime(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return Math.round(diff) + 's 前';
  if (diff < 3600) return Math.floor(diff / 60) + 'm 前';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h 前';
  return Math.floor(diff / 86400) + 'd 前';
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function shortId(id, n = 12) { return id ? id.slice(0, n) : '—'; }
function statusBadge(status) {
  const cls = { completed:'green', running:'blue', error:'red', cancelled:'yellow', success:'green', failed:'red' }[status] || 'dim';
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

async function getJSON(url, opts = {}) {
  // Retry on 503 retryable (SQLite busy while ZCode writes). The backend
  // self-heals the connection; a brief backoff usually clears the lock.
  // opts.headers：透传自定义首部（如 checkpoint force 闸的
  // X-Zcode-Monitor-Checkpoint——跨源简单请求带不了，同源 fetch 恒可带）。
  const maxRetries = opts.retries != null ? opts.retries : 3;
  for (let i = 0; i <= maxRetries; i++) {
    let r;
    try { r = await fetch(url, { headers: opts.headers || {} }); }
    catch (e) {
      if (i < maxRetries) { await new Promise(x => setTimeout(x, 300 * Math.pow(2, i))); continue; }
      throw e;
    }
    if (r.status === 503) {
      let body = null; try { body = await r.json(); } catch {}
      if (body && body.retryable && i < maxRetries) {
        await new Promise(x => setTimeout(x, 300 * Math.pow(2, i))); // 300ms, 600ms, 1200ms
        continue;
      }
      throw new Error(body && body.message ? body.message : `503 数据库繁忙`);
    }
    // 404 is often "no data" not "server error" — try to parse a JSON body
    // (e.g. {found:false}) and return it so callers can render a friendly state.
    if (r.status === 404) {
      const text = await r.text();
      try { return JSON.parse(text); } catch { throw new Error(`404: ${text.slice(0,160)}`); }
    }
    if (!r.ok) { const t = await r.text(); throw new Error(`${r.status}: ${t.slice(0,160)}`); }
    return r.json();
  }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2400);
}

function pct(part, whole) { return whole ? Math.min(100, Math.round(part / whole * 100)) : 0; }

// loading placeholder
function loading(msg = '加载中…') {
  return `<div class="empty"><span class="spinner"></span> ${msg}</div>`;
}
function errorCard(e) {
  return `<div class="card"><h3>出错</h3><pre class="mono">${escapeHtml(e.message || e)}</pre>
    <p class="muted" style="margin-top:8px">检查 ZCode 是否在运行，数据库是否可读。</p></div>`;
}

// ── theme management ────────────────────────────────────
// Read CSS-driven chart palette (so charts follow the active theme).
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function chartPalette() {
  return {
    grid:    cssVar('--chart-grid'),
    gridX:   cssVar('--chart-grid-x'),
    tick:    cssVar('--chart-tick'),
    tipBg:   cssVar('--chart-tooltip-bg'),
    tipBd:   cssVar('--chart-tooltip-border'),
    tipTitle:cssVar('--chart-tooltip-title'),
    tipBody: cssVar('--chart-tooltip-body'),
    legend:  cssVar('--chart-legend'),
    // category colors, used by datasets directly
    conversation: cssVar('--cat-conversation'),
    llm:    cssVar('--cat-llm'),
    llm2:   cssVar('--cat-llm-2'),
    tool:   cssVar('--cat-tool'),
    tool2:  cssVar('--cat-tool-2'),
    network:cssVar('--cat-network'),
    usage:  cssVar('--cat-usage'),
    accent: cssVar('--accent'),
    accent2:cssVar('--accent-2'),
  };
}

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

// Track every Chart.js instance created across views so we can re-theme them.
const _charts = new Set();
function registerChart(c) { _charts.add(c); return c; }
function destroyChart(c) { _charts.delete(c); try { c.destroy(); } catch {} }

// Re-render all live charts in the new theme. Views that own charts should
// expose a global re-render hook; otherwise we just re-read options.
function rethemeCharts() {
  // Notify views so they can rebuild with new palette. We dispatch a custom
  // event; each view that renders charts listens and redraws.
  window.dispatchEvent(new CustomEvent('zc-theme-changed'));
}

// 主题图标：顶栏用主题化单色 SVG（index.html），这里按主题切换月/日显示。
function syncThemeIcon(theme) {
  const moon = document.querySelector('#theme-icon .icon-moon');
  const sun = document.querySelector('#theme-icon .icon-sun');
  if (moon) moon.hidden = theme !== 'dark';
  if (sun) sun.hidden = theme === 'dark';
}

function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') theme = 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('zc-theme', theme); } catch {}
  syncThemeIcon(theme);
  rethemeCharts();
}

function toggleTheme() { setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); }

// ── router ──────────────────────────────────────────────
const views = {};
function registerView(name, fn) { views[name] = fn; }

async function route() {
  const hash = location.hash.slice(1) || 'overview';
  const parts = hash.split('/');
  const name = parts[0];
  const rest = parts.slice(1);
  const fn = views[name] || views.overview;
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  $('#root').innerHTML = `<div class="view">${loading()}</div>`;
  try { await fn(rest); }
  catch (e) { $('#root').innerHTML = `<div class="view">${errorCard(e)}</div>`; console.error(e); }
}
window.addEventListener('hashchange', route);

document.addEventListener('click', (e) => {
  const a = e.target.closest('#nav a[data-view]');
  if (a) { e.preventDefault(); location.hash = a.dataset.view; }
});

// health → topbar status dot + meta (DB health + ZCode runtime + WAL state)
async function healthLoop() {
  let h;
  try { h = await getJSON('/api/health'); }
  catch {
    $('#status-dot').classList.add('off');
    $('#topbar-meta').textContent = '服务未响应';
    setTimeout(healthLoop, 5000);
    return;
  }
  const dot = $('#status-dot');
  const meta = $('#topbar-meta');
  const parts = [];
  if (h.ok) {
    dot.classList.remove('off');
    parts.push('DB OK');
  } else {
    dot.classList.add('off');
    parts.push(h.error ? 'DB 重试中' : 'DB 不可读');
  }
  // ZCode runtime indicator — tells the user whether live writes are happening
  if (h.zcode_running === true) parts.push('ZCode 运行中');
  else if (h.zcode_running === false) parts.push('ZCode 已退出');
  // WAL pending → recent data not yet folded into main db
  if (h.wal_pending_checkpoint) {
    parts.push(`WAL ${(h.wal_bytes/1024/1024).toFixed(1)}MB 待合并`);
  }
  meta.textContent = parts.join(' · ');
  setTimeout(healthLoop, 5000);
}

document.addEventListener('DOMContentLoaded', () => {
  // sync theme icon with the (already-applied) attribute
  syncThemeIcon(currentTheme());
  const toggle = $('#theme-toggle');
  if (toggle) toggle.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleTheme(); });

  // Checkpoint button: fold WAL into main db so history survives ZCode exit.
  const ckpt = $('#checkpoint-btn');
  if (ckpt) ckpt.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    // busy 态切换 SVG→spinner（图标为 SVG 后不再有 emoji textContent 可换）
    const iconSvg = document.querySelector('#checkpoint-icon .icon');
    let busy = document.getElementById('checkpoint-busy');
    if (!busy) {
      busy = document.createElement('span');
      busy.className = 'spinner';
      busy.id = 'checkpoint-busy';
      busy.hidden = true;
      document.getElementById('checkpoint-icon').appendChild(busy);
    }
    iconSvg.hidden = true; busy.hidden = false;
    ckpt.disabled = true;
    try {
      // 首部闸（防跨站 <img> 触发 force checkpoint）：面板同源 fetch 恒可携带
      const r = await getJSON('/api/checkpoint?force=1&_=' + Date.now(),
        { headers: { 'X-Zcode-Monitor-Checkpoint': '1' } });
      if (r.ok) {
        const folded = r.before && r.after ? (r.before.walBytes - r.after.walBytes) : null;
        toast(folded != null ? `已合并 WAL：${(folded/1024/1024).toFixed(1)}MB 数据并入主库` : 'checkpoint 完成');
      } else if (r.error === 'zcode_running') {
        toast('ZCode 运行中，请先关闭 ZCode 再点（或点此强制）');
      } else {
        toast('checkpoint 失败：' + (r.error || r.message || ''));
      }
    } catch (err) { toast('checkpoint 出错：' + err.message); }
    finally { iconSvg.hidden = false; busy.hidden = true; ckpt.disabled = false; }
  });

  // keyboard shortcut: press "t" to toggle theme (handy when click is flaky)
  document.addEventListener('keydown', (e) => {
    if (e.key === 't' && !/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) {
      toggleTheme();
    }
  });

  healthLoop();
  // If a ?theme= override was used to open the page, persist it so subsequent
  // visits (and the toggle button) start from that choice.
  const q = new URLSearchParams(location.search).get('theme');
  if (q === 'light' || q === 'dark') {
    try { localStorage.setItem('zc-theme', q); } catch {}
    // strip the param so the URL stays clean and the toggle behaves normally
    const u = new URL(location.href); u.searchParams.delete('theme');
    history.replaceState(null, '', u.toString());
  }
  if (!location.hash) location.hash = 'overview'; else route();
});

window.ZC = { $, $$, fmtNum, fmtInt, fmtMs, fmtDur, fmtTime, fmtTimeFull, relTime,
  escapeHtml, shortId, statusBadge, getJSON, toast, pct, loading, errorCard,
  registerView, route, Chart,
  cssVar, chartPalette, currentTheme, setTheme, toggleTheme, registerChart, destroyChart };
