// pet-state.js — 桌宠行为的纯决策模块（Spec WP4 需求 2 / A4-1~A4-6 的"共享模块
// 形态"）：9 行动画契约常量、事件→状态决策、心情→动画行映射、点击手势判定。
// 经典脚本双端导出：浏览器经 <script src> 挂 window.PetState（pet.html 只消费
// 全局、不保留内联副本）；node --test require 同一份文件做行为单测——测试守护
// 的就是页面实际加载的那份（无构建器，无副本漂移面）。
// 全部函数为纯函数：不触 DOM、不取当前时间之外的环境状态；时间一律由入参给出，
// 阈值全部可注入（A4-3）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PetState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // standard contract: the first 9 rows are these anims, in this order
  // （含 failed、waiting_permission 行；入睡复用 idle 行，9 行契约不新增）
  const ROW_ANIMS = ['idle', 'running_right', 'running_left', 'waving', 'jumping',
                     'failed', 'waiting_permission', 'running', 'review'];

  const SLEEP_AFTER_MS   = 60 * 1000; // 60s 无 agent 活动入睡
  const ERROR_HOLD_MS    = 4 * 1000;  // 工具失败后 failed 行的可见时长
  const COMBO_HOLD_MS    = 1500;      // 连击发脾气（failed 行）的可见时长
  const GESTURE_WINDOW_MS = 500;      // click 手势判定窗口（≈Windows 默认双击时长）

  // 单一心情判定（优先级从高到低）：
  //   error > tantrum > generating > waiting_permission（预留位次）> sleep > cruise
  // 入睡只查 now - s.lastActive 这一个时钟；s.sleepAfterMs 可注入（A4-3）。
  // waiting_permission 预留说明（未接线）：/api/live 与 /api/gen/state 目前都
  // 拿不到权限信号——2026-09-22 只读实测：tool_usage.approval_status 尾部取值
  // 全 'none'、permission 表 max rowid 0。出现信号源后接线三步：SSE 分派里加
  // permHoldUntil = Date.now() + ERROR_HOLD_MS；本函数 gen 之后插入
  // `if (now < s.permHoldUntil) return 'permission';`；animFor 已备好
  // 'waiting_permission' 行，无需再改。
  function computeMood(now, s) {
    if (now < s.errorHoldUntil) return 'error';   // 系统报错：优先于一切（生成中也先报错）
    if (now < s.comboHoldUntil) return 'tantrum'; // 用户互动反馈，短暂压过后台生成画面
    if (s.gen) return 'gen';
    if (now - s.lastActive >= s.sleepAfterMs) return 'sleep';
    return 'cruise';
  }

  // 心情 → 行映射。gen 档位沿用上游词汇（3 档）：low → running、mid → jumping、
  // high → running_right（每整帧循环与 running_left 交替）；无数字 → 中速 running。
  // error 与 tantrum 共用 failed 行：系统报错与「被惹恼了」在这批像素包里是同一
  // 个懊恼动画，语义都成立，不新增行（9 行契约不动）。
  function animFor(mood, tps) {
    if (mood === 'error' || mood === 'tantrum') return 'failed';
    if (mood === 'permission') return 'waiting_permission'; // 预留，见 computeMood
    if (mood === 'gen') {
      if (tps == null || !isFinite(tps) || tps < 30) return 'running';
      if (tps <= 80) return 'jumping';
      return 'running_right';
    }
    if (mood === 'sleep') return 'idle'; // 冻结在首帧 + CSS 呼吸，非循环
    return 'review';                     // cruise
  }

  // gen SSE 事件（/api/gen/events 透传的 livegen 边）→ 状态补丁。纯函数：返回
  // patch（调用方 Object.assign 进自己的状态）与 awoke（本次事件是否把活动时钟
  // 推进了——A4-2 的"惊醒副作用"断言面；入睡判定派生自 lastActive，活动事件
  // 一到即离开 sleep）。ev.phase ∈ 'start'|'lanes'|'end'|'tool_error'。
  // tool_error 不是生成结束：不改 gen/lanes，只置 errorHold（页面呼吸态不因
  // 工具失败清零——widget.html 与本分派同款契约）。
  function applyGenEvent(s, ev, now) {
    const patch = {};
    let awoke = false;
    switch (ev.phase) {
      case 'start':
        patch.gen = true;
        patch.lanes = Math.max(1, ev.sessions || 1);
        patch.lastActive = now;
        awoke = true;
        break;
      case 'lanes':
        patch.lanes = ev.sessions || 0;
        patch.lastActive = now;
        awoke = true;
        break;
      case 'end':
        patch.gen = false;
        patch.lanes = 0;
        patch.lastActive = Math.max(s.lastActive, now); // an end IS traffic
        awoke = true;
        break;
      case 'tool_error':
        // 失败也是活动：惊醒；failed 行 hold ERROR_HOLD_MS——优先级最高，
        // 生成中也被短暂盖过（见 computeMood）。
        patch.lastActive = now;
        patch.errorHoldUntil = now + ERROR_HOLD_MS;
        awoke = true;
        break;
      default:
        break; // 未知 phase：无操作（分派对未知事件保持现状，不臆造边）
    }
    return { patch, awoke };
  }

  // 点击手势判定（A4-4 的纯函数面）。times：窗口内各击的 performance.now()
  // 时间戳（任意顺序，内部排序）；windowMs：判定窗口。返回 { count, action }，
  // action ∈ 'none' | 'switch' | 'combo'：1 击无动作；2-3 击切包；≥4 击连击
  // （发脾气、不切包）。冲突在判定层解决：combo 消费掉整次手势，4 连击不会
  // 顺带切包。窗口 500ms ≈ Windows 默认双击时长，三连点仍落在窗口内判 switch。
  function classifyGesture(times, windowMs) {
    const ts = times.slice().sort((a, b) => a - b);
    const count = ts.length ? ts.filter(t => t - ts[0] <= windowMs).length : 0;
    return {
      count,
      action: count >= 4 ? 'combo' : count >= 2 ? 'switch' : 'none',
    };
  }

  return {
    ROW_ANIMS, SLEEP_AFTER_MS, ERROR_HOLD_MS, COMBO_HOLD_MS, GESTURE_WINDOW_MS,
    computeMood, animFor, applyGenEvent, classifyGesture,
  };
});
