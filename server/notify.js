'use strict';
// server/notify.js — C8 本地提醒规则引擎（ecosystem-round2-batch2 §2.2）。
//
// 形态（§2.2 需求 1）：process 级单实例（index.js 装配，livegen 先例），评估
// 只在自有定时 tick（默认 30s，unref'd）执行——不在任何请求路径、不在 live.js
// 的 per-connection poll 内（多客户端下重复评估且阻塞发射，spec 明确禁止）。
// 规则核心 evaluateRules 为纯函数（输入由取数层装配、零 IO、无跨调用状态，
// node:test 直测）；冷却只拦发送行为、不改条件评估结果（C8-1 的条件评估
// 无状态钉与 C8-2 的冷却钉是两个断言面，对象不同）。触发经 EventEmitter
// 广播；live.js 每连接订阅共享 bus 转发 `event: notify` 帧（写头点不新增，
// 仍 2 处）。webhook 通道明确不做（§2.2 需求 5）。
//
// 规则集与默认值（§2.2 需求 2 表为基准；常量全可注入）：
//   | 规则 | 默认开关 | 触发条件 | 冷却 | 强度 | severity |
//   |---|---|---|---|---|---|
//   | error_burst     | 开 | 5min 窗 error 行（model+tool）≥3 | 10min（全局） | sound | err  |
//   | waiting_timeout | 关（R-28 降级处置） | interactive waiting 持续 ≥5min（持续=now−waiting_since，起点=C6 分类器 completed_at 派生口径） | 15min（per-session） | alert | warn |
//   | token_threshold | 关 | 单会话 30d 保留窗累计 SUM(computed_total_tokens) ≥1M | 每会话每档位一次（1M/5M/20M） | quiet | warn |
//   | inactive        | 关 | 全库无 model 行 ≥30min 且 24h 窗内曾有活动 | 60min | quiet | ok   |
// waiting_timeout 默认关是 R-28 降级处置（residuals.md，2026-09-25 T3 的
// C6-8 误报回放抽样 39.8% 超 20% 线、收窗重测反升，spec §2.1 需求 7 降级条款
// 生效）——规则本体的判定/冷却/强度语义照 §2.2 原文实现并保留（默认关 ≠ 摘除，
// 终审裁决两臂之一；§9-4 复测路径出现真信号源后回翻 enabled 即恢复）。
// severity 与内建强度是两个正交轴（severity 管视觉色 --sev-*、强度管通道），
// 映射钉死防实施自造。token 阈值取数＝近窗活跃会话集合（C6
// sessionsWithSignals 全库近窗域）经会话复合索引会话内 SUM——禁止全表
// GROUP BY session 的无界聚合，不建 C3 模块（拍板②）。
//
// 取数 SQL 性能契约（红线 2；内嵌本模块不进 db.js——livegen createGenWatcher
// 先例：取数面仅本引擎消费，无第二调用方，无共享诉求）：
//   - error 窗计数：model_usage/tool_usage 各自的 started_at 索引窗 COUNT，
//     无 GROUP BY、无翻转面（§1.2 事实 5 的翻转皆因对 session_id 分组）。
//   - waiting 判定：复用 C6 查询族与分类器（sessionsWithSignals，§2.1 需求 1
//     completed_at 派生起点），无独立时长 SQL。
//   - token 会话内 SUM：session_id IN（近窗活跃域，≤SIGNALS_MAX_ROWS=2000
//     有界）寻址 model_usage_session_turn_idx（sessionList modelAgg 同款两段
//     形态）+ 30d started_at 下界（保留窗口径，索引寻址后的行级过滤）；会话
//     标题经 session 表主键 IN 寻址补齐。
//   - inactive 两路：rowid = MAX(rowid) 尾点主键寻址 O(1)（append-only 表
//     rowid 最大即写入序最新行——不活跃口径以写入序最新行的 started_at 为
//     准；latestModelRowid 只回数值不含时间戳，故此处取裸列版）；24h 曾有
//     活动＝started_at 索引存在性探测（命中即止 LIMIT 1）。
//
// 回放边界（§2.2 需求 1 第 2 轮评审声明）：notify 是即发即失事件——live.js
// per-connection 水位只管 model/tool 行流、notify 不回放，连接建立前/断线
// 间隙触发的提醒永久错过、不补发；可见性兜底＝顶栏 waiting chip 轮询与
// sessions 页刷新（不依赖 SSE 在线）。登记 residuals R-30。
const EventEmitter = require('events');
const { SIGNALS_WINDOW_MS } = require('./signals');

// 评估 tick 缺省 30s（§2.2 需求 1；可注入）。
const NOTIFY_TICK_MS = 30 * 1000;
// 冷却记忆上界（终审第 1 轮代码席 note：此前无任何淘汰路径，token_threshold
// 的 cooldownMs=Infinity 使每会话每档位条目永不失效——与前端三页 notifySeen
// NOTIFY_SEEN_CAP=200 的有界纪律对称收口）。超界丢最旧插入（Map 插入序≈发送
// 序；对已存在键的 set 不改插入位，属可接受近似）。代价：域内会话数 >cap 时
// 最旧冷却记忆被逐出、该会话/档位可能在下一 tick 重发一次提醒（幂等去重按
// id、id 含 at 时间戳，跨 tick 重发是新 id——按有界内存优先接受；cap 量级
// 取实际单用户近窗会话域上界（SIGNALS_MAX_ROWS=2000）之半）。
const NOTIFY_COOLDOWN_CAP = 1000;
// tick 取数失败的限频日志间隔（livegen 同款纪律：持续 busy 的库不得每 tick 刷屏）。
const ERROR_LOG_INTERVAL_MS = 30 * 1000;
// token 阈值累计窗＝30 天保留窗（三表 30d prune 下的口径边界：跨月历史不计，
// 长会话阈值触发系统性延迟——气泡文案与 How 披露「按 30 天保留窗口径」）。
const TOKEN_RETENTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
// 变长 IN 寻址的分块上限（近窗活跃域 ≤2000 会话 → ≤4 块；防超长语句形态）。
const IN_CHUNK = 500;

// 规则默认值（§2.2 需求 2 表逐项相等；测试对表钉）。token_threshold 的
// cooldownMs=Infinity 是「每会话每档位一次」的统一冷却模型表达（首次发送后
// 永在冷却窗内）；cooldownKey 含档位，档与档互不占用配额。
const RULE_DEFAULTS = {
  error_burst: {
    enabled: true, windowMs: 5 * 60 * 1000, minErrors: 3,
    cooldownMs: 10 * 60 * 1000, intensity: 'sound', severity: 'err',
  },
  waiting_timeout: {
    // 默认关＝R-28 降级处置（见头注；spec §2.2 需求 2 表原值 enabled:true，
    // C6-8 误报超线后按 §2.1 需求 7 摘除提醒面——判定语义照原文保留可回翻）。
    enabled: false, timeoutMs: 5 * 60 * 1000,
    cooldownMs: 15 * 60 * 1000, intensity: 'alert', severity: 'warn',
  },
  token_threshold: {
    enabled: false, tiers: [1000000, 5000000, 20000000],
    cooldownMs: Infinity, intensity: 'quiet', severity: 'warn',
  },
  inactive: {
    enabled: false, idleMs: 30 * 60 * 1000, recentMs: 24 * 60 * 60 * 1000,
    cooldownMs: 60 * 60 * 1000, intensity: 'quiet', severity: 'ok',
  },
};

// process 级共享事件总线：engine 的触发发射与 live.js 的每连接订阅在此汇合。
// live.js 不工厂化（live-rowid.test.js 直 require 挂载是既有契约），模块级
// 单例与该文件自身的模块级状态先例（lastLogSize/currentLogFile）同族。
let sharedBus = null;
function sharedNotifyBus() {
  if (!sharedBus) {
    sharedBus = new EventEmitter();
    // 每条 SSE 连接经 live.js 挂 1 个 notify listener：Node 缺省 10 上限会在
    // 第 11 个客户端连接时打 MaxListenersExceededWarning——放宽到 50（本地
    // 单用户多标签/多页同开形态；livegen.js 的 gen 总线非本批面，不动）。
    sharedBus.setMaxListeners(50);
  }
  return sharedBus;
}

// ── 规则核心（纯函数：输入全注入、零 IO、无跨调用状态）──────────────────────
//
// 输入形状（由引擎取数层装配；disabled 规则的输入缺省不喂）：
//   errorCounts     { model, tool }——error_burst 窗计数
//   waitingSessions [{ session_id, waiting_since }]——分类器 waiting 态且
//                   waiting_since 非 null 的会话（interactive 过滤在分类器内）
//   sessionTokens   Map<session_id, sum>——token_threshold 的近窗活跃域会话内累计
//   titles          Map<session_id, title|null>——per-session 规则 body 的会话标题
//   lastModelRow    { started_at } | null——写入序最新 model 行（null=空表）
//   recentActivity  boolean——24h 窗内曾有 model 行（存在性探测结果）
//   now             评估时刻（注入）
// 返回候选数组：每项 = SSE 载荷字段 + 内部 cooldownKey（引擎发送前剥除，不
// 上线）。冷却不在本函数——条件评估无状态（注入两次相同输入结果一致）。
// 载荷契约（§2.2 需求 3）：{id, rule, title, body, severity, at, session?}，
// id = `${rule}:${session ?? 'all'}:${at}`（本地模板串零新依赖；session 字段
// 仅 per-session 规则携带——全局规则整键缺席，非值 null）。intensity 为
// additive 字段：T5 前端降级矩阵的强度轴（rule→intensity 映射单一来源在
// 服务端，前端不复制表）。body 含会话标题等库内字符串——服务端生成仍视为
// 不可信输入，消费侧消毒（T5）。
function evaluateRules(
  { errorCounts, waitingSessions, sessionTokens, titles,
    lastModelRow, recentActivity, now } = {},
  { rules = RULE_DEFAULTS } = {},
) {
  const t = now != null ? now : Date.now();
  const titleMap = titles || new Map();
  const titleOf = (sid) => {
    const v = titleMap.get(sid);
    if (v == null || v === '') return sid;
    // 会话标题钳 80 字符（pet.html onNotify 气泡 80 字符防御的服务端单点
    // 收口：超长标题在载荷源头截断，三消费页拿到的已是钳后文本——客户端
    // 各自再钳时对已钳文本为幂等；截断以省略号明示）。
    return v.length > 80 ? v.slice(0, 79) + '…' : v;
  };
  const out = [];
  const push = (rule, cfg, fields) => {
    const session = fields.session;
    out.push({
      id: `${rule}:${session ?? 'all'}:${t}`,
      rule,
      title: fields.title,
      body: fields.body,
      severity: cfg.severity,
      intensity: cfg.intensity,
      at: t,
      cooldownKey: fields.cooldownKey,
      // tier 是 token 档位收敛的内部字段（与 cooldownKey 同族，发送前剥除）。
      ...(fields.tier != null ? { tier: fields.tier } : {}),
      ...(session != null ? { session } : {}),
    });
  };

  if (rules.error_burst.enabled) {
    const cfg = rules.error_burst;
    const c = errorCounts || {};
    const model = c.model || 0;
    const tool = c.tool || 0;
    const total = model + tool;
    if (total >= cfg.minErrors) {
      push('error_burst', cfg, {
        title: '错误爆发',
        body: `近 ${Math.round(cfg.windowMs / 60000)} 分钟内错误 ${total} 行`
          + `（model ${model} + tool ${tool}）`,
        cooldownKey: 'error_burst',
      });
    }
  }

  if (rules.waiting_timeout.enabled) {
    const cfg = rules.waiting_timeout;
    for (const w of waitingSessions || []) {
      // waiting_since null 边界：数据层已滤，纯函数不信任调用方（signals 同款
      // 纪律）——null 会话不参与时长判定（NaN 防护）。
      if (w.waiting_since == null) continue;
      const durMs = t - w.waiting_since;
      if (durMs >= cfg.timeoutMs) {
        push('waiting_timeout', cfg, {
          title: '等待超时',
          body: `会话「${titleOf(w.session_id)}」已等待 ${Math.round(durMs / 60000)} 分钟`
            + '（interactive，时间启发式判定，可能误报）',
          session: w.session_id,
          cooldownKey: `waiting_timeout:${w.session_id}`,
        });
      }
    }
  }

  if (rules.token_threshold.enabled) {
    const cfg = rules.token_threshold;
    for (const [sid, sum] of sessionTokens || new Map()) {
      // SUM 全 NULL 行的 sum=null 形态按 0 处理（不跨档）。纯函数照回全部
      // 跨档候选（无状态钉）；同 tick 多档的发送侧收敛见 tick() 的档位收敛。
      const total = sum || 0;
      for (const tier of cfg.tiers) {
        if (total >= tier) {
          push('token_threshold', cfg, {
            title: 'Token 阈值',
            body: `会话「${titleOf(sid)}」累计 token ${total}（按 30 天保留窗口径）`
              + `已跨 ${tier / 1000000}M 档`,
            session: sid,
            cooldownKey: `token_threshold:${sid}:${tier}`,
            tier,
          });
        }
      }
    }
  }

  if (rules.inactive.enabled) {
    const cfg = rules.inactive;
    const l = lastModelRow;
    if (l && l.started_at != null && recentActivity
        && t - l.started_at >= cfg.idleMs) {
      push('inactive', cfg, {
        title: '不活跃',
        body: `已 ${Math.round((t - l.started_at) / 60000)} 分钟无模型活动`
          + '（24 小时窗内曾有活动）',
        cooldownKey: 'inactive',
      });
    }
  }

  return out;
}

// ── 引擎（工厂：依赖全注入可测；取数层 + 冷却门 + 发射）──────────────────────
// 取数 SQL（性能契约见头注；schema source: zai-org/ZCode MIG
// 0010_usage_observability）。
const SQL_MODEL_ERROR_COUNT = `
  SELECT COUNT(*) AS c
  FROM model_usage
  WHERE started_at >= ? AND status = 'error'`;
const SQL_TOOL_ERROR_COUNT = `
  SELECT COUNT(*) AS c
  FROM tool_usage
  WHERE started_at >= ? AND status = 'error'`;
const SQL_LAST_MODEL_ROW = `
  SELECT started_at FROM model_usage WHERE rowid = (SELECT MAX(rowid) FROM model_usage)`;
const SQL_RECENT_ACTIVITY = `
  SELECT 1 AS hit FROM model_usage WHERE started_at >= ? LIMIT 1`;

function inPlaceholders(n) {
  return Array.from({ length: n }, () => '?').join(',');
}

function makeNotifyEngine(
  { dbq, bus, tickMs = NOTIFY_TICK_MS,
    signalsWindowMs = SIGNALS_WINDOW_MS, cooldownCap = NOTIFY_COOLDOWN_CAP,
    nowFn = () => Date.now(), rules: ruleOverrides } = {},
) {
  if (!dbq) {
    throw new TypeError('makeNotifyEngine: dbq 必须注入（livegen createGenWatcher(dbq) 同款纪律）');
  }
  const emitBus = bus || sharedNotifyBus();
  // 浅合并每规则覆盖（注入小值可测；未覆盖规则保持缺省）。
  const rules = {};
  for (const [name, def] of Object.entries(RULE_DEFAULTS)) {
    rules[name] = { ...def, ...((ruleOverrides && ruleOverrides[name]) || {}) };
  }

  // 固定 SQL 的语句缓存，按连接身份键（invalidateDb 换连接后陈旧语句孤儿化
  // ——livegen statement() 同款纪律）。变长 IN 查询不进缓存：30s tick 下按次
  // prepare 代价可忽略（db.js 全仓 prepare-per-call 同款），缓存变长语句族
  // 反而引入按 arity 的无界缓存面。
  let stmtCache = new Map();
  let stmtCacheRaw = null;
  function statement(sql) {
    const conn = dbq.db();
    if (stmtCacheRaw !== conn._raw) {
      stmtCache = new Map();
      stmtCacheRaw = conn._raw;
    }
    let stmt = stmtCache.get(sql);
    if (!stmt) { stmt = conn.prepare(sql); stmtCache.set(sql, stmt); }
    return stmt;
  }

  // 近窗活跃域会话的 token 累计（会话复合索引寻址 + 30d 保留窗下界；分块
  // IN——域有界 ≤SIGNALS_MAX_ROWS）。
  function sessionTokenSums(ids, sinceMs) {
    const sums = new Map();
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const rows = dbq.db().prepare(`
        SELECT session_id, SUM(computed_total_tokens) AS s
        FROM model_usage
        WHERE session_id IN (${inPlaceholders(chunk.length)}) AND started_at >= ?
        GROUP BY session_id
      `).all(...chunk, sinceMs);
      for (const r of rows) sums.set(r.session_id, r.s || 0);
    }
    return sums;
  }

  // per-session 规则 body 的会话标题（session 表主键 IN 寻址，ids 有界）。
  function sessionTitles(ids) {
    const titles = new Map();
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const rows = dbq.db().prepare(
        `SELECT id, title FROM session WHERE id IN (${inPlaceholders(chunk.length)})`,
      ).all(...chunk);
      for (const r of rows) titles.set(r.id, r.title);
    }
    return titles;
  }

  // 取数层：按需装配 evaluateRules 的输入（disabled 规则不取数——默认关的
  // token/inactive 零查询成本）。waiting/token 共享一次 sessionsWithSignals
  // （全库近窗活跃域，§2.1 需求 2 场景 (b)；分类器内已含 interactive 过滤与
  // 在飞卫生窗——引擎直接调 db 层，无 HTTP 自环）。
  function gather(now) {
    const inputs = { now };
    if (rules.error_burst.enabled) {
      const since = now - rules.error_burst.windowMs;
      inputs.errorCounts = {
        model: statement(SQL_MODEL_ERROR_COUNT).get(since).c || 0,
        tool: statement(SQL_TOOL_ERROR_COUNT).get(since).c || 0,
      };
    }
    if (rules.waiting_timeout.enabled || rules.token_threshold.enabled) {
      // windowMs 与 sinceMs 同注 signalsWindowMs（终审第 1 轮代码席 note：此前
      // 只传导取数窗、分类器新鲜度复核用缺省 SIGNALS_WINDOW_MS——注入非默认
      // 值时两窗分叉；生产默认两值同源，行为不变，注入语义补齐）。
      const signals = dbq.sessionsWithSignals(
        { sinceMs: now - signalsWindowMs, windowMs: signalsWindowMs });
      const titleIds = new Set();
      if (rules.waiting_timeout.enabled) {
        inputs.waitingSessions = [];
        for (const sig of signals.values()) {
          if (sig.state === 'waiting' && sig.waiting_since != null) {
            inputs.waitingSessions.push(
              { session_id: sig.session_id, waiting_since: sig.waiting_since });
            titleIds.add(sig.session_id);
          }
        }
      }
      if (rules.token_threshold.enabled) {
        const ids = [...signals.keys()];
        inputs.sessionTokens = sessionTokenSums(ids, now - TOKEN_RETENTION_WINDOW_MS);
        for (const id of ids) titleIds.add(id);
      }
      inputs.titles = sessionTitles([...titleIds]);
    }
    if (rules.inactive.enabled) {
      inputs.lastModelRow = statement(SQL_LAST_MODEL_ROW).get() || null;
      inputs.recentActivity =
        !!statement(SQL_RECENT_ACTIVITY).get(now - rules.inactive.recentMs);
    }
    return inputs;
  }

  // 时钟统一入口（nowFn 仅测试拨针注入用——冷却「过期再发」分支的确定性
  // 驱动；缺省 Date.now()，生产行为零变化）。tick 内冷却判定与 evaluate 的
  // 缺省评估时刻同走它；显式传参的 evaluate(now) 直测路径不受影响。
  function evaluate(now) {
    const t = now != null ? now : nowFn();
    return evaluateRules(gather(t), { rules });
  }

  // 冷却时间戳内存态：维度＝全局（error_burst/inactive，key=规则名）/
  // per-session（waiting_timeout，key=规则:会话）/ 每档位一次（token_threshold，
  // key=规则:会话:档位 + cooldownMs=Infinity）。进程重启即重置（无持久化，
  // 与「冷却只拦发送」的防噪定位一致）。有界：超 cooldownCap 丢最旧插入
  // （NOTIFY_COOLDOWN_CAP 头注——前端 notifySeen CAP 同族纪律）。
  const cooldownSentAt = new Map();
  function rememberCooldown(key, t) {
    cooldownSentAt.set(key, t);
    while (cooldownSentAt.size > cooldownCap) {
      cooldownSentAt.delete(cooldownSentAt.keys().next().value);
    }
  }
  let stopped = false;
  let lastErrorLogAt = 0;

  function tick() {
    if (stopped) return;
    let notes;
    try {
      notes = evaluate();
    } catch (e) {
      // 瞬态失败（SQLITE_BUSY/连接损伤）：跳过本 tick、不崩进程、不伪造事件；
      // 限频日志防持续 busy 刷屏（livegen 同款）。
      if (Date.now() - lastErrorLogAt >= ERROR_LOG_INTERVAL_MS) {
        lastErrorLogAt = Date.now();
        console.error(`[notify] evaluate failed (tick skipped): ${e.message}`);
      }
      return;
    }
    const t = nowFn();
    // token 档位收敛（C8-2 防噪家族，发送路径专属——评估结果不动）：同一次
    // 评估内同会话跨多档（引擎首见即已跨高档的形态：重启后/会话新入近窗域，
    // 真实库实测 dwf actor 常态直跳 5M）只发最高档——逐档连发是同 tick 两帧
    // 噪音且 id（rule:session:at 模板钉）同 tick 撞号；被涵盖的低档一并记为
    // 已发送，防后续 tick 倒挂补发低档文案。
    const topTier = new Map();
    for (const n of notes) {
      if (n.rule !== 'token_threshold') continue;
      if (!topTier.has(n.session) || n.tier > topTier.get(n.session)) {
        topTier.set(n.session, n.tier);
      }
    }
    for (const note of notes) {
      const last = cooldownSentAt.get(note.cooldownKey);
      if (last != null && t - last < rules[note.rule].cooldownMs) continue;
      if (note.rule === 'token_threshold' && topTier.get(note.session) !== note.tier) {
        rememberCooldown(note.cooldownKey, t); // 低档被高档涵盖：标已发、不发送
        continue;
      }
      rememberCooldown(note.cooldownKey, t);
      const { cooldownKey, tier, ...payload } = note;
      emitBus.emit('notify', payload);
    }
  }

  // 无即时首 tick：规则评估无状态（无 livegen 的边沿基线需求），boot 即刻评估
  // 只会把通知发进零订阅者的虚空并白耗冷却配额（notify 即发即失、无回放）；
  // 首评估在 tickMs 后，届时常规客户端已可连上。
  const timer = setInterval(tick, tickMs);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    emitter: emitBus,
    evaluate,
    tick,
    stop() { stopped = true; clearInterval(timer); },
  };
}

module.exports = {
  makeNotifyEngine, evaluateRules, sharedNotifyBus,
  RULE_DEFAULTS, NOTIFY_TICK_MS, TOKEN_RETENTION_WINDOW_MS, NOTIFY_COOLDOWN_CAP,
};
