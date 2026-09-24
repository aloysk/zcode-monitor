# 桌宠与趣味呈现侦察笔记（第二轮生态采纳·pet-fun lane）

调研日期：2026-09-25。方法：WebSearch + GitHub REST API（search_repositories / get_file_contents）
逐仓核实 stars/描述/许可证；本地比对 `public/pet-state.js`（9 行契约、computeMood/animFor/
applyGenEvent/classifyGesture）与 `public/widget.html`、`public/pets-preview.html` 现状，
避免与第一轮（宠物包导入、token 口径、JSONL 实时性、桌宠行为与安全、隐私提示）重复。
所有 stars 为当日 GitHub API 实测值。

## 一、编码代理桌宠生态（Codex pets 宇宙）

2026-05 起 Codex pets 形成了完整生态：画廊/注册表、桌面播放器、SDK、生成工具链、状态桥。
入口索引：**alterhq/awesome-codex-pets-projects**（20★，CC0 清单，2026-09-23 仍更新）
https://github.com/alterhq/awesome-codex-pets-projects

### 1. alvinunreal/openpets — 1237★，MIT（README 明示），TypeScript/Electron，2026-09-24 活跃
https://github.com/alvinunreal/openpets
跨平台桌宠平台 + Plugin SDK v3 + 编码代理集成。README 实读要点：
- **Virtual Pet 官方插件**：Tamagotchi 数值系统——hunger/affection/energy 三维状态，
  "live status pin" 常驻显示；HUD 是"2x2 grid 布局 + 进度条"的迷你气泡。
- **openpets_react MCP 动作集**：`thinking / editing / testing / success / error` 五种
  反应动画 + `openpets_say` 气泡 + `openpets_status` 连通性。比 zcode-monitor 现有
  5 心情（error/tantrum/gen/sleep/cruise）更细的工作流语义（editing/testing 是独立态）。
- **气泡防泄露**：动态语音先过本地 sanitize（路径/URL/机密/多行代码片段涂黑），
  自动反应只用静态本地触发——与第一轮"隐私提示"同族但落到执行层。
- **插件测试 harness**：createTestHarness 可 mock host、advance clock、
  expectScheduled/expectSpoke 断言——桌宠行为的确定性测试形态。
- ctx.audio：提示音/自定义音频；Reminders 插件 = snoozeable 铃声通知。
- 官方趣味插件：Fortune Cookie（每日随机签）、Magic 8 Ball、Mood Check-in。
吸收判断：**high**。数值系统（三属性+常驻 HUD）与 react 动作词汇表可直接进 pet.html/
widget；sanitize/测试 harness 是工程质量范本。

### 2. alterhq/openpets — 97★，MIT（清单标注），Swift/macOS 原生
https://github.com/alterhq/openpets
"One shared macOS desktop pet for AI agents and apps"——同一生态的 macOS 原生实现，
MCP/CLI 控制多代理共享一只宠物 + "shared visible task state"。
配套 OpenPetsKit（Swift 运行时）。zcode-monitor 无 macOS 壳，仅形态参考：**low**。

### 3. crafter-station/petdex — 4156★，MIT（清单标注），Next.js，2026-09-24 活跃
https://github.com/crafter-station/petdex
本生态最大画廊：animated pets for **Codex, Claude Code, DeepSeek Harness, Hermes,
OpenCode, Gemini CLI**。浏览器内动画预览、collections、一键安装命令、提交审核。
zcode-monitor 已有 pets-preview.html（本地包预览）；可借鉴的是**浏览器内验证**与
**画廊组织形态**（collections/安装命令）。技术栈 Next.js+Postgres 不随迁。**medium**。

### 4. portons/codex-pet-share — 133★，MIT（清单标注），TypeScript/Cloudflare
https://github.com/portons/codex-pet-share
自托管宠物分享站（Codex-Pets.net 后端）：浏览/上传/一键 CLI 安装 + **multiplayer
playground rooms**（多人房间看宠物）。分享生态参考：**low-medium**。

### 5. Alichua/TamaCodex — 5★，MIT（清单标注），Python
https://github.com/Alichua/TamaCodex
"in-codex pet that **grows & evolves on your token consumption**"——宠物随 token
消耗成长、进化，信号=本地工作量+token 用量+照料事件。-stars 少但机制正是
zcode-monitor 独有数据面（model_usage 逐行 token）能做的新形态：**high**
（吸收机制不吸收实现）。

### 6. petergpt/codex-pet-limit-rings — 84★，MIT（清单标注），Swift/macOS
https://github.com/petergpt/codex-pet-limit-rings
"overlay that **follows the Codex pet** and shows **short-window and weekly
usage-limit rings** without patching Codex"——双时间窗用量环（当前窗+周窗）跟随
桌宠显示。zcode-monitor 的 widget 有完整 usage 数据，环形进度挂件是新可视化件：**high**
（吸收形态：SVG 双环组件贴在 widget/pet 角落）。

### 7. Shellishack/vibebud — 72★，MIT（清单标注），TypeScript
https://github.com/Shellishack/vibebud
浮动 AI 宠物 for Codex/Claude Code，desktop+web+Android 多面，定位
"companion presence and notifications"（存在感+通知）。通知时机设计参考：**medium**。

### 8. gibbon/agent-pet — 10★，Apache-2.0（description 明示），HTML/vanilla JS
https://github.com/gibbon/agent-pet
"Tiny animated companion-pet widget for any web app. Self-hosted, **vanilla DOM,
~7 KB gzip**"，shadow-dom + web-components + spritesheet topics。与 zcode-monitor
无框架/无构建约束完全同频：**widget/pet 工程形态**（Shadow DOM 隔离样式、
自定义元素封装）参考：**medium-high**。

### 9. arata-ai-daisuki/talking-pets — 0★，MIT（清单标注），JavaScript
https://github.com/arata-ai-daisuki/talking-pets
"monitors assistant speech from **local conversation logs** and reads it aloud
through **local TTS**"（kokoro/voicevox 引擎，local-first topics）。声音方向唯一
实证项目：**medium**（吸收形态：完成/错误/等待权限时的本地 TTS 或提示音——
浏览器 SpeechSynthesis 可零依赖实现）。

### 10. vcxzvfe/codex-pet-bridge — 1★，MIT（清单标注），JavaScript/SSE
https://github.com/vcxzvfe/codex-pet-bridge
"turns AI agent status into **pet-friendly events**"（SSE/webhook/MCP 到桌宠与
小智硬件）。zcode-monitor 已有 SSE，仅事件词汇表参考：**low**。

### 11. rullerzhou-afk/clawd-on-desk / LeslieLeung/petty / felipetodev/petdex-dock
（清单条目，未逐一核仓）跨平台桌宠观察多家代理 / Tauri 播放器 / Electron dock。
均为独立桌面 app，与浏览器形态距离远：**low**。

### 12. openai/skills hatch-pet — 官方 curated skill，MIT（清单标注）
https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/SKILL.md （全文实读）
生成/修复/**验证**/预览/打包 Codex 宠物的官方工作流。关键可吸收件：
- **9 行动画契约同源**：idle/running-right/running-left/waving/jumping/failed/
  waiting/running/review —— 与 zcode-monitor ROW_ANIMS（pet-state.js:16-17）逐词
  对得上（zcode 作 waiting_permission）。
- **逐行视觉语义指导**：如 `running`=处理任务/思考/打字（明确禁止字面跑步）、
  `review`=专注倾斜/眨眼（默认不加放大镜新道具）、`failed` 允许附着泪/烟/星。
  这套语义表可为 zcode 宠物包规范/Pets 文档直接引用。
- **确定性 QA 管线**：contact sheet + 逐行动画 GIF 预览 + validation.json（透明度
  不变量、192x208 cell、1536x1872 atlas、未用格必须全透明）——pets-preview.html
  可升级成"导入即 QA"（帧数/透明度/尺寸自动验证报告）。
吸收判断：**high**（文档/规范/验收形态，非代码依赖）。

## 二、游戏化与统计叙事

### 13. DenverCoder1/github-readme-streak-stats — 7146★，MIT（LICENSE 实读），PHP
https://github.com/DenverCoder1/github-readme-streak-stats
streak 三指标体系的标杆：**current streak / longest streak / total**，主题化卡片。
zcode-monitor 的会话表全量在库（started_at 索引在）——"连续编码日 streak"（当日有
完成 turn 即计）+ 桌宠气泡播报"连胜 N 天"是纯本地可算的新游戏化卡：**high**。

### 14. didrod205/coderecap — 1★，TypeScript，zero-dependency
https://github.com/didrod205/coderecap
"Spotify Wrapped for your **git history** — local, **deterministic** year-in-code
recap (**terminal card + shareable SVG**). No upload, no API key."
形态样本虽小，但**确定性+本地+可分享 SVG**三原则与 zcode-monitor 完全同频：
"编码年报"页（年度 token 总量/模型使用排行/最活跃日/总时长/错误统计→单张
SVG 卡）是数据全在库里的现成新页：**high**（吸收理念）。

### 15. github/gh-skyline — 1343★，MIT（LICENSE 实读），Go
https://github.com/github/gh-skyline
官方 CLI：贡献图→3D 城市 STL（3D 打印）。可视化隐喻（每天一根楼、高度=活动量）
可用 CSS 3D transform/Canvas 零依赖实现（three.js 违反无构建/两依赖约束，
不建议引入）。**medium**（仅隐喻，落到"会话活动天际线"小玩具视图）。

### 16. battlesquid/gh-skyline — 30★，TypeScript/three.js web 版（Cloudflare）
https://github.com/battlesquid/gh-skyline —— 佐证 web 版 skyline 需 three.js，
印证上条"只取隐喻不取栈"。**low**。

## 三、经典桌宠行为库

### 17. Shimeji 家族
- Shimeji-ee（kilkakon，Java/Win）：经典行为= wandering/climb window edges/fall/
  grab & throw windows。窗口边缘攀爬/拖窗在浏览器页面内无对应物（页面无窗口
  概念），**不适用——负发现**。
- web 版检索（"shimeji-web in:name,description" 按星排序）：最高 welltilln/
  desksprite 3★（零依赖 vanilla JS，grab/throw & seat 手势——抓起/抛出/落座），
  其余 0★。生态里 web shimeji 无头部实现；desksprite 的"抓抛物理"手势可作为
  pet.html 点击手势之外的补充交互（拖拽+惯性）参考：**low-medium**。

### 18. DesktopGoose（TogoFire/DesktopGoose 11★ 等 fork 群；原版非此）
恶搞型：拖走窗口、抢鼠标、追光标。对本地仪表盘既做不到也不该做（干扰工作流），
**负发现：不吸收**。

## 四、负发现与生态空白（重要结论）

1. **通用"开发者游戏化仪表盘"组件生态为空**：GitHub 搜索
   "developer gamification streak achievements dashboard" 与
   "coding streak XP gamification developer motivation" 均 total_count:0（两次
   实测）。游戏化要么在 streak-stats 这类 README 卡（贡献图数据面），要么在
   wakatime 类商业服务；**"编码代理监测 × 游戏化（XP/成就/streak）"没有现成
   开源件**——zcode-monitor 若做 streak/成就/宠物成长，是填空白而非重复造轮。
2. **LLM 任务完成声音通知专用工具**搜索（"LLM agent task complete notification
   sound terminal"）total_count:0；声音方向仅有 talking-pets（TTS 朗读）与
   OpenPets ctx.audio（提示音 API）两个间接样本。空白。
3. **Shimeji 窗口攀爬/DG 恶搞交互**在浏览器形态不成立（无窗口概念/干扰原则）。
4. 桌宠生态的"播放器"层（Electron/Tauri/macOS 原生壳）与 zcode-monitor 的
   浏览器+面板形态不同层；可吸收的都在**协议层**（9 行契约、事件词汇、数值系统）
   与**呈现层**（HUD/环/气泡/SVG 卡），不在壳层。

## 五、精选优先级（供汇总）

high：openpets(数值系统+react 动作集)、TamaCodex(token 成长进化)、
limit-rings(双窗用量环)、streak-stats(三指标 streak)、coderecap(确定性年报 SVG)、
hatch-pet(9 行契约语义表+QA 管线)。
medium：agent-pet(shadow-dom 封装)、petdex(浏览器内验证)、talking-pets(本地 TTS)、
vibebud(通知时机)、gh-skyline(天际线隐喻)。
low：alterhq/openpets、codex-pet-bridge、codex-pet-share、desksprite、battlesquid 版。

—— 以上 stars/许可证除特别标注"清单标注"（来自 awesome-codex-pets-projects 的
license 字段）外，均为本日 GitHub API 或文件实读；未核实项已逐一说明。
