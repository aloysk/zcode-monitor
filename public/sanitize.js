// sanitize.js — 气泡类展示文本的消毒共享模块（pet/widget 页面经 <script> 引入，
// node:test 经 require() 复用同一份；经典脚本双端导出，保持无构建器现状）。
//
// 覆盖面声明（显式）：仅下列几类"敏感样式"的字面替换，不是完备的安全边界；
// 「过了消毒」不等于「可安全展示」。既定决策：气泡默认不展示 agent 原始文本
// （pet 气泡只显示数值），本模块是文本类展示点（现有与未来）进入气泡前的
// 必经闸门——任何新敏感样式须先在这里加规则再有单测。
//
// 已知盲区（2026-09-23 实测，均在覆盖外、须按上面的流程新增规则）：
// Basic 认证的短 base64 头（<40 位不触发长 base64 规则）、AWS AccessKeyId
// （AKIA…，20 位）、UNC 路径（\\host\share）、%ENV% 环境变量路径、/etc 与
// /var 等 POSIX 系统路径、data:/javascript: 内联 URL、HTML 事件属性（如
// <img onerror>——本模块是隐私剥除闸、不是 HTML 消毒器；消费方一律
// textContent 渲染，无 XSS 面）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SanitizeSpeech = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 顺序敏感：URL 在前（先整体剥除，避免其路径段被路径规则二次改写）、
  // 凭证在长 hex/base64 之前（让 "Bearer <token>" 收敛成一个占位符）、
  // 空白收敛放最后。路径类规则的停止集含全角标点——否则中文句子里路径
  // 后面的「，然后」会被贪心吞进占位符。
  const PUNCT = '\\s"\'<>|：，。；、！？（）【】「」『』）】';
  const RULES = [
    // URL 及查询串：http(s)/file/ftp/ws(s) 整串剥除（含 query）
    { re: new RegExp('\\b(?:https?|file|ftp|wss?):\\/\\/[^' + PUNCT + ']+', 'gi'), sub: '[链接]' },
    // Bearer 头 + 凭证串
    { re: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, sub: '[凭证]' },
    // JWT 三段整体剥除：规范 JWT（如 36/27/42 三段）每段都可能短于长 base64
    // 的 40 位下限，长 base64 规则只剥掉签名段、头与载荷原样残留（可 base64url
    // 解出 claims）。必须排在长 hex/base64 规则之前——否则签名段先被剥、三段
    // 整体匹配失配。第二段不要求 eyJ 开头（payload 首字节非 { 时不成立）。
    { re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, sub: '[凭证]' },
    // 绝对路径·Windows 盘符（C:\... 与 C:/... 两种斜杠都算）
    { re: new RegExp('[A-Za-z]:[\\\\/][^' + PUNCT + ']*', 'g'), sub: '[本地路径]' },
    // 绝对路径·用户目录波浪号（~/.zcode/...、~\foo）
    { re: new RegExp('~[\\\\/][^' + PUNCT + ']*', 'g'), sub: '[本地路径]' },
    // 绝对路径·POSIX 用户目录（/home/<u>/...、/Users/<u>/...、/root/...；
    // 需要第二段之后还有内容，孤立 "/home" 一词不误伤）
    { re: new RegExp('\\/(?:home|Users|root)\\/[^' + PUNCT + ']+', 'g'), sub: '[本地路径]' },
    // 密钥样式·sk- 前缀 token
    { re: /\bsk-[A-Za-z0-9_-]{6,}/g, sub: '[密钥]' },
    // 密钥样式·长 hex（≥32 位，sha/摘要/API key 形态）
    { re: /\b[0-9a-f]{32,}\b/gi, sub: '[密钥]' },
    // 密钥样式·长 base64 样串（≥40 位连续 token 字母表，PAT/JWT 片段形态；
    // 不设尾边界：结尾的 padding '=' 是非词字符，带尾边界会失配留下尾巴。
    // 起点用 lookbehind 而非 \b：+ / 开头的 token 前没有词边界（非词字符），
    // \b 会让首字符残留在气泡里）
    { re: /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{40,}={0,2}/g, sub: '[密钥]' },
  ];

  // 气泡是单行 nowrap 展示：连续空白（含换行）收敛为单空格并去首尾。
  function sanitizeSpeech(input) {
    if (typeof input !== 'string') return '';
    let out = input;
    for (const r of RULES) out = out.replace(r.re, r.sub);
    return out.replace(/\s+/g, ' ').trim();
  }

  return { sanitizeSpeech };
});
