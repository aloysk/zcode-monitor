// empty-state.js — 共享空态组件（Spec ecosystem-round2-batch1 C9 需求 3）：
// emptyState(dataSourceLabel, hint) → 空态卡片 HTML 字符串（数据源名 + 处置
// 指引）。各视图空态只传这两样，禁止逐视图散点缝补（契约钉）。
// 双端导出（pet-state.js UMD 形态）：浏览器经 <script src> 由本文件自身挂
// window.ZC.emptyState（挂载责任单点——app.js 不含挂载赋值，加载序空隙不产生
// 第二挂载点）；node --test require 同一份文件直测——测试守护的就是页面实际
// 加载的那份（无构建器，无副本漂移面）。
// 转义义务钉在组件自身：label/hint 一律转义后拼接，消费方无需（也不应）自行
// 转义——首例 timeline 传静态串无风险，但组件是共享基建（本批新增空态一律经
// 此渲染），后续批次传动态值（会话标题/模型名等库内字符串）时未转义即 XSS
// 入口。escapeHtml 为 app.js:51 同款实现，组件内自带等价副本：加载序不可依赖
// app.js（sanitize.js 先例同思路——安全默认收在共享模块内）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.ZC = root.ZC || {}; root.ZC.emptyState = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  }

  function emptyState(dataSourceLabel, hint) {
    const label = escapeHtml(dataSourceLabel);
    const hintHtml = hint ? `<p class="muted">${escapeHtml(hint)}</p>` : '';
    return `<div class="card empty-state"><h3>无 ${label} 数据</h3>${hintHtml}</div>`;
  }

  return emptyState;
});
