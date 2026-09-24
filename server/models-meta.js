'use strict';
// models-meta.js — C2 上下水位的静态模型元数据（纯数据模块：无 IO、无依赖，
// node:test 直接 require）。
//
// 纪律声明（docs/specs/ecosystem-round2-batch1.md §2.2 需求 1）：
//   (a) 本表是**静态整理表、非官方权威**——界面恒标注「非官方权威」（UI 标注
//       义务在前端消费面实现，本模块只提供数据）。
//   (b) TriDefender/zcode-api 仓库无许可证（GitHub API license:null 实测）——
//       **只取其 README 数值事实作起步参考，不复制其整理文本**；本文件不含其
//       任何文案。其记 GLM-5.3 上下文 200K 与官方常量（1M）分歧，以官方为准。
//   (c) 权威核对以 zai-org/ZCode 源码模型常量为准（分析 §9-8 销账路径）：
//       config/provider/zcode-builtin.json（revision 30，blob eb48d99d，
//       2026-09-25 核对；本机在用副本 ~/.zcode/v2/runtime/provider/**/zcode-builtin.json
//       同 revision 实读一致）的 modelConfigRules.modelRules 规则族 + 官方解析
//       语义（packages/provider/src/config/model-config.ts matchesRule：
//       `^(?:<modelMatch>)$` 大小写不敏感；规则按数组序 overlay，后定义值覆盖
//       前值——config-overlay.ts overlayValue）。表内每条数值均按该语义对官方
//       规则族求值定值，出处逐条标注于 source 字段（已核对官方源码常量/unverified）。
//   (d) resolve 为 model_id **精确匹配**，不做前缀/后缀/大小写等模糊匹配——
//       「不猜窗口」：未命中返回 null（诚实空态），不回退官方 catch-all 规则
//       （`.*` 缺省规则的 200K/32K 是未知模型的兜底，不是对具体模型的断言，
//       照抄即猜测）。v1 不做 variant 键（如 `[1m]` 后缀形态）。
//   (e) 收录范围＝官方 canonical 名单（packages/shared/src/official-glm-model-id.ts）
//       中的 GLM 文本模型 + 本机真实库值域实测成员（2026-09-25 rowid 尾界 5000
//       行采样：GLM-5.3 / GLM-5.3-FlashX，照录 docs/acceptance/round2-batch1-
//       explain-timing.md T6 段）。GLM-5.3-FlashX 不在 canonical 名单，但官方
//       glm-5.3 规则的后缀组 `(?:[.\-:/\[].*)?` 覆盖该 id（官方解析语义实跑
//       核实命中），故照该规则定值。未收录 id 一律 null。

// 出处前缀（(c) 的完整核对路径，逐条 source 复用）
const SRC =
  '已核对官方源码常量：zai-org/ZCode config/provider/zcode-builtin.json（revision 30）' +
  '，官方解析语义＝packages/provider/src/config/model-config.ts（matchesRule 大小写' +
  '不敏感 + 规则序 overlay）';

// 数值均为规则族 overlay 终值（2026-09-25 按官方语义实跑求值；键序＝使用频率，
// 首键 GLM-5.3 即本机真实库主力模型）。
const MODEL_META = {
  'GLM-5.3': {
    context_tokens: 1000000, max_output_tokens: 128000,
    source: SRC + '，命中规则 `.*glm-5\\.3(?:-flash)?(?:[.\\-:/\\[].*)?`（contextWindow=1000000 / maxOutputTokens.max=128000）',
  },
  'GLM-5.3-Flash': {
    context_tokens: 1000000, max_output_tokens: 128000,
    source: SRC + '，命中规则 `.*glm-5\\.3(?:-flash)?(?:[.\\-:/\\[].*)?`（同 GLM-5.3 档；官方 canonical 名单成员）',
  },
  'GLM-5.3-FlashX': {
    context_tokens: 1000000, max_output_tokens: 128000,
    source: SRC + '，命中规则 `.*glm-5\\.3(?:-flash)?(?:[.\\-:/\\[].*)?` 的后缀组（id 不在 canonical 名单；本机真实库值域实测成员，按官方语义实跑核实命中）',
  },
  'GLM-5.2': {
    context_tokens: 1000000, max_output_tokens: 128000,
    source: SRC + '，命中规则 `.*GLM-5\\.2(?:[.\\-:/\\[].*)?`（contextWindow=1000000 / maxOutputTokens.max=128000）',
  },
  'GLM-5.1': {
    context_tokens: 200000, max_output_tokens: 64000,
    source: SRC + '，命中规则 `.*glm-5\\.1(?:[.\\-:/\\[].*)?`（contextWindow=200000 / maxOutputTokens.max=64000）',
  },
  'GLM-5.1-Highspeed': {
    context_tokens: 200000, max_output_tokens: 64000,
    source: SRC + '，命中规则 `.*glm-5\\.1-highspeed(?:[.\\-:/\\[].*)?`（同 GLM-5.1 档）',
  },
  'GLM-5': {
    context_tokens: 200000, max_output_tokens: 64000,
    source: SRC + '，命中规则 `.*glm-5(?:[.\\-:/\\[].*)?`（contextWindow=200000 / maxOutputTokens.max=64000）',
  },
  'GLM-5-Turbo': {
    context_tokens: 200000, max_output_tokens: 64000,
    source: SRC + '，命中规则 `.*GLM-5-Turbo(?:[.\\-:/\\[].*)?`（同 GLM-5 档）',
  },
  'GLM-5V-Turbo': {
    context_tokens: 200000, max_output_tokens: 131072,
    source: SRC + '，命中规则 `.*glm-5v-turbo(?:[.\\-:/\\[].*)?`（contextWindow=200000 / maxOutputTokens.max=131072）',
  },
  'GLM-4.7': {
    context_tokens: 200000, max_output_tokens: 131072,
    source: SRC + '，命中规则 `.*glm-4\\.7(?:[.\\-:/\\[].*)?`（contextWindow=200000 / maxOutputTokens.max=131072）',
  },
  'GLM-4.7-FlashX': {
    context_tokens: 200000, max_output_tokens: 131072,
    source: SRC + '，命中规则 `.*glm-4\\.7-flashx(?:[.\\-:/\\[].*)?`（同 GLM-4.7 档）',
  },
  'GLM-4.7-Flash': {
    context_tokens: 200000, max_output_tokens: 131072,
    source: SRC + '，命中规则 `.*glm-4\\.7-flash(?:[.\\-:/\\[].*)?`（同 GLM-4.7 档）',
  },
  'GLM-4.6': {
    context_tokens: 200000, max_output_tokens: 131072,
    source: SRC + '，命中规则 `.*glm-4\\.6(?:[.\\-:/\\[].*)?`（contextWindow=200000 / maxOutputTokens.max=131072）',
  },
  'GLM-4.5': {
    context_tokens: 131072, max_output_tokens: 98304,
    source: SRC + '，命中规则 `.*glm-4\\.5(?:[.\\-:/\\[].*)?`（contextWindow=131072 / maxOutputTokens.max=98304）',
  },
  'GLM-4.5-Air': {
    context_tokens: 131072, max_output_tokens: 98304,
    source: SRC + '，命中规则 `.*glm-4\\.5-air(?:[.\\-:/\\[].*)?`（同 GLM-4.5 档）',
  },
};

// model_id 精确匹配 → { context_tokens, max_output_tokens }；未命中 → null。
// 不做前缀/后缀/大小写模糊（「不猜窗口」，头注 (d)）；返回对象不带 source 等
// 内部标注字段（API 面形状钉）。
function resolve(modelId) {
  if (typeof modelId !== 'string') return null;
  const m = Object.prototype.hasOwnProperty.call(MODEL_META, modelId)
    ? MODEL_META[modelId] : null;
  if (!m) return null;
  return { context_tokens: m.context_tokens, max_output_tokens: m.max_output_tokens };
}

module.exports = { table: MODEL_META, resolve };
