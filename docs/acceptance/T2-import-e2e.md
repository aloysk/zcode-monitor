# T2 导入端到端留痕（A1-8）

> 本文件为终审修订轮（2026-09-23）补记。T2 的原始 commit `3938525`（feat: 宠物一键导入（共享模块+CLI+API+图鉴入口）与隐私提示）正文为空、未按 human-gate 清单要求落 `docs/acceptance/T2-import-e2e.md`——按计划「代理到达该步时的标准留痕格式」补齐如下，不虚构任何未发生的实机结论。

## 结论

**自动化可验证前置已全过；A1-8 的实机（浏览器/壳）评审项仍待人工复核。**

- 套件内 A1-1～A1-7 全部有自动化覆盖且全绿（终审轮 2026-09-23 `npm test` 实测：fixture 导入成功案含三件套落位、NOTICE、webp-size CLI `rows=9 OK` 判据、拒绝面参数化十案、BOM+snake_case、缺省占位、重名/--force、staging 穿越、junction 逃逸、端点 403/400/200 全链路、CLI 成功/失败/裸名形态）。
- A1-8 字面要求「未经改动的真实 Codex 包目录 → 导入 → 图鉴可见、可预览、桌宠可选用（双击轮换能到达该包）；评审记录含截图」——该环节需实机浏览器/WebView2 壳，原始执行轮未留下截图或结论文本，本文件不代填结论。

## 复现步骤（实机评审时按序执行）

```bash
cd "F:/project/zcode-monitor-plan"
npm test                                    # 门禁：全绿
node tools/import-pet.js "F:/project/zcode-monitor/tools/pets-staging/<任一含 pet.json 的包目录>" --source <来源URL> --author <作者> --license <SPDX>
node -e "console.log(JSON.stringify(require('http').get('http://127.0.0.1:7331/api/pets', r => r.on('data', d => process.stdout.write(d)))))"
# 浏览器打开 http://127.0.0.1:7331/ → 图鉴/宠物入口 → 预览新包
# 打开 /pet → 双击轮换至新包（localStorage 停留在旧包时需轮换到位）
```

- 导入产物不入 git（A1-5）：`git -C "F:/project/zcode-monitor-plan" status --porcelain` 不得出现 `public/pets/<id>/` 新增项。
- 壳内实机项（三形态切换、双击手势）与 T5-behavior-e2e.md 的 A4-7 演示共用一轮实机环境即可。
