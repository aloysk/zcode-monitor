# CSP / 安全响应头实机验证记录

- R1（2026-09-22，首次引入 CSP + nosniff + /pets 静态收紧）：验证证据在提交
  `a5f01ad` 正文（四页 Playwright 加载、0 console 错误、SSE/Chart.js/字体正常）。
- R2（2026-09-23，Chart.js 本地化 + CSP 收紧 + /api 全局回环 Host 闸 + raw where
  受限文法）：本文即验证记录，命令与结果如下，可复跑。

## R2 验证环境

- worktree `F:/project/zcode-monitor-plan`（分支 `feature/review-hardening`），
  Node v24.11.1（win32）。
- 数据面：临时 fixture 库（`test/helpers/fixture-db.js` 产出的 tmpdir SQLite），
  不触碰真实 `~/.zcode`。

```bash
cd "F:/project/zcode-monitor-plan"
node -e "const {createFixtureDb}=require('./test/helpers/fixture-db');const fx=createFixtureDb();fx.seed();console.log(fx.dbPath);fx.close()"
ZCODE_DB=<上一行输出> ZCODE_LOG_DIR=<同根/log> PORT=7399 OPEN_BROWSER=0 node server/index.js
```

## 命令与结果（curl）

| 检查 | 命令 | 结果 |
|---|---|---|
| 四页 200 + 双头 | `curl -sI http://127.0.0.1:7399/`（`/pet`、`/widget`、`/pets-preview.html` 同） | 均 200；`Content-Security-Policy` 与 `X-Content-Type-Options: nosniff` 齐备 |
| 本地 Chart.js | `curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}' http://127.0.0.1:7399/assets/chart.umd.js` | `200 application/javascript 205475`（CSP script-src 已无任何外联域） |
| Host 闸 | `curl -H 'Host: evil.example' -o /dev/null -w '%{http_code}' http://127.0.0.1:7399/api/health` | `403`；不带覆写（回环 Host）时 `200 {"ok":true,…}` |
| raw where 注入面 | `curl 'http://127.0.0.1:7399/api/raw/session?where=1%3D1%20UNION%20SELECT%20%2A%20FROM%20session'` | `400`（受限文法拒绝） |
| raw where 合法 | `curl 'http://127.0.0.1:7399/api/raw/model_usage?where=status%3D%27error%27'` | `200`，`count:1`（fixture 过滤生效，参数化绑定） |
| /pets 收紧 | `curl -sI http://127.0.0.1:7399/pets/yuexinmiao/pet.json` | `application/octet-stream` + `Content-Disposition: attachment`；`spritesheet.webp` 仍 `image/webp` |

R2 CSP 全文（`server/http-hardening.js` 为权威）：

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

2026-09-25 勘正（R-8 决策轮 `6d979ae`）：`style-src`/`font-src` 已撤销
fonts.googleapis.com/fonts.gstatic.com 白名单，面板至此零外联域；CSP 权威以
`server/http-hardening.js` 现态为准（上方 R2 全文保留为时点记录）。

## Chart.js 本地化的来源核对

`public/assets/chart.umd.js` 取自官方 npm 包 `chart.js@4.4.4` 的 `dist/chart.umd.js`
（MIT）。双源字节一致核对：jsdelivr `https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.js`
与 `npm pack chart.js@4.4.4` 解包产物 sha256 相同：
`fed6a739f8d0f0687174de6cd14745fc0fc7809144ab113d22908a26bf0d7fea`
（unpkg/cdnjs 在本网络环境 TLS 不可达，npm registry 由 npm 自身校验 integrity，
jsdelivr 与之逐字节一致）。注意：jsdelivr 的 `chart.umd.min.js` 是其按同名规则
转发的同一文件加注释头，非 npm 包内文件，故本地化采用 `chart.umd.js` 原名。

## 浏览器侧（Playwright MCP）

四页逐一加载（`/`、`/pet`、`/widget`、`/pets-preview.html`），整个会话
console 0 errors / 0 warnings：

- `/`：`window.Chart` 为 4.4.4（本地 `/assets/chart.umd.js`），3 个图表 canvas
  有像素内容，9 张 KPI 卡渲染，SSE「已连接」，隐私横幅默认展示。
- `/pet`：精灵 canvas 背板 1156×1253（sprite 经 `/pets/…/spritesheet.webp`
  加载），气泡出实时数值（18.8），心情态 `state-cruise tier-red`。
- `/widget`：tps 数值与档位色正常（18.8 / spd-red），单位可见。
- `/pets-preview.html`：导入面板 + staging 列表渲染，10 张候选卡 canvas 就绪。

## 口径声明

CSP 收窄的是子资源加载与（部分）嵌入/导航面；**顶层导航本身任何 CSP 都管不住**
——「钉死外传面」的说法不成立：数据外传受 `connect-src 'self'` 限制，导航型外传
需用户参与。字体零外联（系统字体为最终形态，R-8 已销账，回归钉
`test/frontend-contract.test.js`）；样式/字体家族名保留为本地可选。
