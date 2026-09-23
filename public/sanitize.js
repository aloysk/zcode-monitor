// sanitize.js — 气泡类展示文本的消毒共享模块（pet/widget 页面经 <script> 引入，
// node:test 经 require() 复用同一份；经典脚本双端导出，保持无构建器现状）。
//
// 覆盖面声明（显式）：仅下列几类"敏感样式"的字面替换，不是完备的安全边界；
// 「过了消毒」不等于「可安全展示」。既定决策：气泡默认不展示 agent 原始文本
// （pet 气泡只显示数值），本模块是文本类展示点（现有与未来）进入气泡前的
// 必经闸门——任何新敏感样式须先在这里加规则再有单测。
//
// 已知盲区（须按上面的流程新增规则后再放行对应样式）：
// Basic 认证的短 base64 头（<40 位不触发长 base64 规则）、%ENV% 环境变量
// 路径、/etc 与 /var 等 POSIX 系统路径、HTML 事件属性（如 <img onerror>——
// 本模块是隐私剥除闸、不是 HTML 消毒器；消费方一律 textContent 渲染，无 XSS 面）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SanitizeSpeech = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 顺序敏感：URL/内联 URI 在前（先整体剥除，避免其路径段被路径规则二次改写）、
  // 凭证（Bearer/JWT）在长 hex/base64 之前（让 "Bearer <token>" 收敛成一个占位符）、
  // 路径类规则的停止集含全角标点——否则中文句子里路径后面的「，然后」会被贪心
  // 吞进占位符。
  const PUNCT = '\\s"\'<>|：，。；、！？（）【】「」『』）】';
  const RULES = [
    // URL 及查询串：http(s)/file/ftp/ws(s) 整串剥除（含 query）
    { re: new RegExp('\\b(?:https?|file|ftp|wss?):\\/\\/[^' + PUNCT + ']+', 'gi'), sub: '[链接]' },
    // data:/javascript: 内联 URI（URL 规则不含这两协议，单列；停止集同路径规则含
    // 全角标点）。锚不用 \b：'metadata:image/png' 之类粘连前缀下 \b 失配整体漏过，
    // 从 data:/javascript: 起剥除即可，残前缀不是 URI 内容
    { re: new RegExp('(?:data|javascript):[^' + PUNCT + ']+', 'gi'), sub: '[链接]' },
    // Bearer 头 + 凭证串。token 字母表内的续段（跨行/分段凭据在气泡的单行语境
    // 本就拼回一条）一并收敛为一个 [凭证]；起点 lookbehind 而非 \b：+ / 开头的
    // token 前没有词边界（非词字符），\b 会让首字符残留在气泡里
    { re: /(?<![A-Za-z0-9_-])Bearer\s+[A-Za-z0-9._~+/=-]+(?:\s+[A-Za-z0-9._~+/=-]+)*/gi, sub: '[凭证]' },
    // JWT 三段整体剥除：规范 JWT（如 36/27/42 三段）每段都可能短于长 base64
    // 的 40 位下限，长 base64 规则只剥掉签名段、头与载荷原样残留（可 base64url
    // 解出 claims）。必须排在长 hex/base64 规则之前——否则签名段先被剥、三段
    // 整体匹配失配。段间空白（跨点分段的凭据）与粘连前缀（xeyJ…）都容忍：
    // 锚不用 \b/lookbehind——粘连时从 eyJ 起剥除即可，残下的前缀字符不是密钥
    // 材料；第二段不要求 eyJ 开头（payload 首字节非 { 时不成立）。
    { re: /eyJ[A-Za-z0-9_-]+(?:\s*\.\s*[A-Za-z0-9_-]+){2}/g, sub: '[凭证]' },
    // 绝对路径·Windows 盘符（C:\... 与 C:/... 两种斜杠都算）
    { re: new RegExp('[A-Za-z]:[\\\\/][^' + PUNCT + ']*', 'g'), sub: '[本地路径]' },
    // 绝对路径·UNC（\\host\share\…；第二段起用与路径规则一致的停止集）
    { re: new RegExp('\\\\\\\\[A-Za-z0-9.$_-]+\\\\[^' + PUNCT + ']*', 'g'), sub: '[本地路径]' },
    // 绝对路径·用户目录波浪号（~/.zcode/...、~\foo）
    { re: new RegExp('~[\\\\/][^' + PUNCT + ']*', 'g'), sub: '[本地路径]' },
    // 绝对路径·POSIX 用户目录（/home/<u>/...、/Users/<u>/...、/root/...；
    // 需要第二段之后还有内容，孤立 "/home" 一词不误伤）
    { re: new RegExp('\\/(?:home|Users|root)\\/[^' + PUNCT + ']+', 'g'), sub: '[本地路径]' },
    // 密钥样式·AWS AccessKeyId（AKIA + 20 位大写字母数字；锚不用 \b——粘连前缀
    // （keyAKIA…）下 \b 失配整体漏过，从 AKIA 起剥除即可，前缀残字非密钥材料）
    { re: /AKIA[0-9A-Z]{16}/g, sub: '[密钥]' },
    // 密钥样式·sk- 前缀 token（i：'SK-' 大写同形态）。锚不用 \b/lookbehind：
    // 'keysk-…' 粘连时 \b 在词中失配、整体漏过——从 'sk-' 起剥除即可（残前缀
    // 不是密钥材料）。体内容忍单个空格（跨行分段凭据，空白已先行收敛为单空格；
    // 空格后须仍是 token 字符，尾部不吃空格）。代价：英文行文里含 'sk-' 的
    // 连字符词（task-…）可能被整体收敛——隐私闸宁过杀，气泡文本以中文/数值为主。
    { re: /sk-[A-Za-z0-9_-](?:[A-Za-z0-9_-]|\s(?=[A-Za-z0-9_-])){5,}/gi, sub: '[密钥]' },
    // 密钥样式·Stripe 形态（sk_/pk_ [live|test]_ ≥16 位字母数字；环境段可缺省
    // ——legacy 裸 sk_ 形态。无前缀锚，粘连时从 sk_/pk_ 起剥除，同上取舍）
    { re: /(?:sk|pk)_(?:(?:live|test)_)?[A-Za-z0-9]{16,}/g, sub: '[密钥]' },
    // 密钥样式·长 hex（≥32 位，sha/摘要/API key 形态）
    { re: /\b[0-9a-f]{32,}\b/gi, sub: '[密钥]' },
    // 密钥样式·分段 hex 兜底：hex 字符以单空格分段（'a3f9… 91c5…' 两段合计
    // ≥32 字符）时各段都低于上一规则的 32 位下限——空格只在后随 hex 时可入，
    // 首尾不吃空格；与长 hex 规则互不重叠（一个吃整段、一个吃分段）。数字也
    // 在字符表内：纯数字以空格分段合计 ≥32 会被一并收敛（宁过杀，气泡数字
    // 均带小数点/单位不受影响）
    { re: /(?<![0-9a-f])[0-9a-f](?:[0-9a-f]|[ ](?=[0-9a-f])){31,}(?![0-9a-f])/gi, sub: '[密钥]' },
    // 密钥样式·长 base64 样串（≥40 位连续 token 字母表，PAT/JWT 片段形态；
    // 不设尾边界：结尾的 padding '=' 是非词字符，带尾边界会失配留下尾巴。
    // 起点用 lookbehind 而非 \b：+ / 开头的 token 前没有词边界（非词字符），
    // \b 会让首字符残留在气泡里）
    { re: /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{40,}={0,2}/g, sub: '[密钥]' },
  ];

  // 气泡是单行 nowrap 展示。空白收敛在规则循环**之前**：跨行/分段的凭据
  // （'sk-abc12\ndef…'、跨点空格的 JWT）在收敛后的单行语境里仍是同一条凭据，
  // 规则先看收敛形态、分段样式才不漏过；收敛放最后会把已被分段拆开的凭据
  // 拼回原样泄漏。收敛后剩余空白必为单空格，规则替换不引入新空白，末尾仅 trim。
  function sanitizeSpeech(input) {
    if (typeof input !== 'string') return '';
    let out = input.replace(/\s+/g, ' ').trim();
    for (const r of RULES) out = out.replace(r.re, r.sub);
    return out.trim();
  }

  return { sanitizeSpeech };
});
