'use strict';
// index.js — test/ 目录的聚合入口，让 `node --test <本目录>` 形态可用。
// 背景：Node v24.11（win32 实测）对 --test 的显式目录参数不做递归发现，
// 而是把目录当模块路径去 spawn（报 Cannot find module）；目录存在
// index.js 后，该形态按 CJS 目录 main 规则落到本文件。
//
// 三条本机实测结论，决定了下面的写法：
// 1) 本进程被 --test 父进程 spawn 时带 NODE_TEST_CONTEXT 标记，node:test
//    会把 run() 判为递归调用而跳过执行（警告 "skipping running files"，
//    子进程退出 0 → 目录形态假绿）。本文件就是目录聚合入口，显式嵌套
//    一层正是目的，故运行时清除该标记；孙进程上下文由 run() 自行注入。
// 2) TestsStream 在本用法下不触发 'close'，进程在事件循环耗尽时直接
//    退出——退出码必须在 'test:fail' 事件里即时设置，收尾时集中设置
//    来不及（首版即栽在这里：close 永不到来，失败静默变绿）。
// 3) 孙进程的测试输出走本进程 stdout，会被 --test 父进程的 reporter
//    吞掉；stderr 能透传，故失败明细打到 stderr 供门禁日志定位。
//
// run() 仍按每文件独立子进程执行（与直接列 *.test.js 同一隔离机制，不合并
// 进程）：db-smoke.test.js 依赖 require 时注入 env 且 server/db.js 模块级缓存
// 连接，跨文件共用进程会互相污染。npm test 现为 `node --test test/index.js`
//（显式文件入参，各 Node 版本语义一致）：package.json 原先的 test/*.test.js
// 依赖测试运行器内建 glob 展开（Node ≥21/22）或 shell 通配（Windows cmd 不
// 展开），engines 声明的 Node 18/20 上会失败；显式文件在所有版本都成立，且
// run() 的 per-file 子进程隔离不变。
const { run } = require('node:test');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join(__dirname, f));

if (files.length === 0) {
  console.error(`test/index.js: 目录下没有 *.test.js: ${__dirname}`);
  process.exitCode = 1;
} else {
  delete process.env.NODE_TEST_CONTEXT; // 见头部注释 1)
  const stream = run({ files });
  stream.on('test:fail', (e) => {
    console.error(`test/index.js: 失败: ${e && e.name ? e.name : '(未命名)'}`);
    process.exitCode = 1; // 见头部注释 2)：必须在事件内即时设置
  });
}
