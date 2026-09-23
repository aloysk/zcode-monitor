'use strict';
// test/transcript.test.js — server/transcript.js 的纯函数单测 + fixture 定位/读取
//（R3 修-low）。AGENTS_DIR 经 ZCODE_AGENTS_DIR 注入 tmpdir fixture（require 前
// 注入，与 ZCODE_DB 同法），绝不触碰真实 ~/.zcode。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zcmon-tr-'));
process.env.ZCODE_AGENTS_DIR = path.join(fxRoot, 'agents');
const tr = require(path.join(__dirname, '..', 'server', 'transcript.js'));

test.after(() => {
  fs.rmSync(fxRoot, { recursive: true, force: true });
  assert.equal(fs.existsSync(fxRoot), false, 'A0-7: fixture 目录已清理');
});

// ── 纯函数 ───────────────────────────────────────────────────────────────────
test('agentUuidFromChild: 尾部 agent_<uuid> 锚定；非法形态返回 null', () => {
  const uuid = '00112233-4455-6677-8899-aabbccddeeff';
  assert.equal(tr.agentUuidFromChild('sess_subagent_agent_' + uuid), uuid);
  assert.equal(tr.agentUuidFromChild('agent_' + uuid), uuid); // 无前缀也锚尾段
  assert.equal(tr.agentUuidFromChild('sess_agent_bogus'), null, '非 uuid 尾段拒绝');
  assert.equal(tr.agentUuidFromChild(''), null);
  assert.equal(tr.agentUuidFromChild(null), null);
});

test('categorize: 事件类型 → 展示类目（tool.call/tool.result 按 status 判别）', () => {
  assert.equal(tr.categorize({ type: 'turn_started' }).cat, 'prompt');
  assert.equal(tr.categorize({ type: 'model_complete' }).cat, 'usage');
  assert.equal(tr.categorize({ type: 'model_network_status' }).cat, 'network');
  const call = tr.categorize({ type: 'streaming_tool_ledger_updated', payload: { status: 'scheduled' } });
  assert.equal(call.label, 'tool.call');
  const done = tr.categorize({ type: 'streaming_tool_ledger_updated', payload: { status: 'tool_result_committed' } });
  assert.equal(done.label, 'tool.result');
  assert.equal(tr.categorize({ type: 'whatever_new' }).cat, 'other');
});

test('summarize: 各事件摘要串 + 长输入截断', () => {
  const s1 = tr.summarize({ type: 'turn_started', payload: { input: 'x'.repeat(200) } });
  assert.ok(s1.length <= 91 && s1.endsWith('…'), 'turn_started 摘要须截断到 90+省略号');
  assert.match(tr.summarize({ type: 'turn_complete', payload: {
    resultType: 'ok', tokenCount: 1500, toolCallCount: 2, duration: 3200 } }), /ok · tokens=1\.5k/);
  assert.equal(tr.summarize({ type: 'model_streaming', payload: { kind: 'text_delta', delta: 'abc' } }),
    'text +3');
  assert.equal(tr.summarize({ type: 'unknown_evt', payload: {} }), '');
});

test('aggregate: 按类型计数、工具计数、token 累加', () => {
  const a = tr.aggregate([
    { type: 'turn_started', payload: {} },
    { type: 'turn_started', payload: {} },
    { type: 'streaming_tool_ledger_updated', payload: { toolName: 'Bash' } },
    { type: 'streaming_tool_ledger_updated', payload: { toolName: 'Bash' } },
    { type: 'streaming_tool_ledger_updated', payload: { toolName: 'Read' } },
    { type: 'model_complete', payload: { usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 } } },
    { type: 'model_complete', payload: { usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3 } } },
  ]);
  assert.equal(a.byType.turn_started, 2);
  assert.deepEqual(a.tools, { Bash: 2, Read: 1 });
  assert.deepEqual(a.tokens, { input: 101, output: 52, cache: 13 });
});

// ── fixture 定位与读取（注入的 AGENTS_DIR）───────────────────────────────────
const UUID = '00112233-4455-6677-8899-aabbccddeeff';
function writeAgentFixture() {
  const dir = path.join(process.env.ZCODE_AGENTS_DIR, 'parent-sess-1', 'agent_' + UUID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ agentId: 'agent_x', role: 'reviewer' }));
  const lines = [
    { sequenceNumber: 1, type: 'turn_started', timestamp: '2026-09-23T01:00:00.000Z',
      turnId: 't1', traceId: 'tr1', sessionId: 'sess_subagent_agent_' + UUID,
      payload: { input: '开始评审' } },
    { sequenceNumber: 2, type: 'model_complete', timestamp: '2026-09-23T01:00:01.000Z',
      turnId: 't1', traceId: 'tr1', sessionId: 'sess_subagent_agent_' + UUID,
      payload: { usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 } } },
    '{broken json', // 坏行静默跳过
  ];
  fs.writeFileSync(path.join(dir, 'transcript.jsonl'), lines.map(l => typeof l === 'string' ? l : JSON.stringify(l)).join('\n') + '\n');
  return dir;
}

test('locateAgent/readMetadata/readTranscript: fixture 命中，坏行跳过、types/limit 生效', () => {
  const dir = writeAgentFixture();
  const child = 'sess_subagent_agent_' + UUID;

  const loc = tr.locateAgent(child);
  assert.equal(loc.parentSessionId, 'parent-sess-1');
  assert.equal(loc.dir, dir);
  assert.equal(tr.readMetadata(child).agentId, 'agent_x');
  assert.equal(tr.locateAgent('sess_agent_not-a-uuid'), null, '非法 id 不误报');

  const r = tr.readTranscript(child);
  assert.equal(r.found, true);
  assert.equal(r.count, 2, '坏行不计入');
  assert.deepEqual(r.events.map(e => e.type), ['turn_started', 'model_complete']);

  const only = tr.readTranscript(child, { types: ['turn_started'] });
  assert.equal(only.events.length, 1);
  assert.equal(only.count, 1, 'count 与过滤后的事件集一致（过滤发生在读取循环内）');
  const one = tr.readTranscript(child, { limit: 1 });
  assert.equal(one.events.length, 1);
  assert.equal(one.events[0].type, 'turn_started');

  // 未命中（无此 agent 目录）
  const miss = tr.readTranscript('sess_subagent_agent_ffffffff-1111-2222-3333-444444444444');
  assert.deepEqual(miss, { events: [], meta: null, found: false });
});
