'use strict';
// server/signals.js — C6 会话状态信号分类器（L2 纯函数：不碰任何 IO，零依赖，
// node:test 直接 require——models-meta.js 纯模块同族纪律）。
//
// 语义钉（docs/specs/ecosystem-round2-batch2.md §2.1 需求 1 / §2.0 拍板 1·2）：
//   - 四态 state ∈ working|waiting|idle|broken，判定序
//     working（在飞）> broken（近窗 error）> waiting（时间启发式）> idle；
//     在飞会话的近窗 error 行属既往回合，不降级为 broken。
//   - broken 判据用 started_at 判新鲜、不用 completed_at——error 行的
//     completed_at 值域真库未实测（可能为 NULL），NULL 比较永假会漏判；
//     started_at 与查询窗同列，行在结果集内即新鲜，分类器侧再独立复核一次
//     （纯函数可被任意输入直调，不得信任调用方已过滤）。
//   - waiting 候选限 task_type='interactive'（subagent/workflow_child 等后台
//     会话的完成不构成「等用户」——误报风暴主源，入口过滤）。数据面无权限
//     等待信号源（approval_status 只记终态，§1.2 事实 1），waiting 是时间
//     启发式：confidence='low'；waiting_since＝最新 completed 行的
//     completed_at（数据派生、无状态——排除跨 tick 记忆首次判定时刻的
//     有状态形态）；completed_at 为 NULL → waiting_since=null（该会话不参与
//     oldest_waiting_ms 聚合，防 Math.max 混入 null 得 NaN）。
//   - 置信：working/broken='high'（数据驱动）、waiting='low'（启发式）、
//     idle 的 confidence 与 waiting_since 均 null（字段存在值为 null，非缺
//     字段——C2-4 空数据形状钉同款精神）。
//   - reason 携带可读判定依据（供 hover/debug）。全模块禁用「待批/pending」
//     措辞（approval_status 不承载 pending 语义，§3 非目标 9）。
//
// 输入形状（两路 L1 查询输出 + 会话域 + now，全部由调用方装配）：
//   inflightSessions: Set<id>（在飞会话——livegen 同源判据的会话维度）
//   recentModel: Map<id, {status, error_type, started_at, completed_at, rid}>
//                （近窗每会话最新 model 行，bare-column+MAX(rowid) 取写入序最新）
//   sessions: Map<id, {task_type}>（会话域的 task_type 补齐）
// 输出 Map<session_id, {session_id, state, confidence, waiting_since, reason}>，
// 域＝三输入键并集（页内域/全库近窗域两场景由调用方经 sessions Map 与
// recentModel 的键集表达，分类器对域本身无感知）。

// waiting/broken 判定窗缺省 15min 量级（分析 C6 口径；可注入小值测试）。
const SIGNALS_WINDOW_MS = 15 * 60 * 1000;

// idle 的固定形状（路由层兜底与分类器同源，防两处漂移）。
function idleSignal(reason) {
  return {
    state: 'idle',
    confidence: null,
    waiting_since: null,
    reason: reason || '近窗无在飞请求与 model 活动',
  };
}

function classifySessions(
  { inflightSessions, recentModel, sessions, now },
  { windowMs = SIGNALS_WINDOW_MS } = {},
) {
  const inflight = inflightSessions || new Set();
  const recent = recentModel || new Map();
  const types = sessions || new Map();
  const t = now == null ? Date.now() : now;
  const out = new Map();

  const domain = new Set([...inflight, ...recent.keys(), ...types.keys()]);
  for (const id of domain) {
    if (inflight.has(id)) {
      // 拍板 1 首位：在飞压过近窗 error（既往回合）与 waiting 启发式。
      out.set(id, {
        session_id: id,
        state: 'working',
        confidence: 'high',
        waiting_since: null,
        reason: '在飞：卫生窗内存在未收尾的 assistant 请求行（livegen 同源判据）',
      });
      continue;
    }
    const m = recent.get(id);
    if (!m) {
      out.set(id, idleSignal('近窗无在飞请求与 model 行'));
      continue;
    }
    // 新鲜度独立复核（started_at 口径，见头注；now−started_at 为负的时钟
    // 抖动行不剔除——回退窗口只会更宽，不构成误判面）。
    const fresh = m.started_at != null && t - m.started_at <= windowMs;
    if (!fresh) {
      out.set(id, idleSignal('最新 model 行 started_at 超出判定窗'));
      continue;
    }
    if (m.status === 'error') {
      out.set(id, {
        session_id: id,
        state: 'broken',
        confidence: 'high',
        waiting_since: null,
        reason: '近窗 error：最新 model 行 status=error'
          + (m.error_type ? `（error_type=${m.error_type}）` : ''),
      });
      continue;
    }
    const type = types.get(id);
    if (m.status === 'completed' && type && type.task_type === 'interactive') {
      out.set(id, {
        session_id: id,
        state: 'waiting',
        confidence: 'low',
        waiting_since: m.completed_at == null ? null : m.completed_at,
        reason: '时间启发式：interactive 会话最新 model 行已收尾且当前无在飞请求（可能误报）',
      });
      continue;
    }
    out.set(id, m.status === 'completed'
      ? idleSignal('最新行 completed 但会话非 interactive（后台完成不构成等待）')
      : idleSignal(`最新行 status=${m.status}，不构成信号`));
  }
  return out;
}

module.exports = { classifySessions, idleSignal, SIGNALS_WINDOW_MS };
