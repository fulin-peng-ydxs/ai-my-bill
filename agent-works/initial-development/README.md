# 初始开发资料

归档状态：已归档

本目录集中保存项目初始开发的需求、计划、原型、截图和历史验证，以及归档前已写入这些文件的后续记录。它们用于追溯业务基线与历史证据，不承载后续任务进度；原有内容保留，历史通过不代表当前版本或新环境通过。

历史记录中的 `.local/audit/` 等本机临时路径不属于持久证据归档，低价值过程产物清理后可能已不存在；需要核验当前行为时重新运行对应检查。

| 资料 | 用途 |
|---|---|
| [requirement-closure.md](requirement-closure.md) | 初始业务闭环与确认依据 |
| [requirement.md](requirement.md) | 一期业务基线、需求编号及验收标准 |
| [plan.md](plan.md) | 初始实施阶段、依赖和已有进度记录 |
| [prototypes/](prototypes/) | 初始页面原型、样式与原型检查脚本 |
| [screenshot/](screenshot/) | 已有历史截图，不是当前页面验收证据 |
| [pre-release-test-report.md](pre-release-test-report.md) | 部署前候选与回归证据 |
| [test-report.md](test-report.md) | 内网验收及归档前已追加的页面验证 |
| [performance-test.md](performance-test.md)、[security-test.md](security-test.md) | 初始性能与安全验证 |

后续开发不向本目录追加需求、计划或验收材料。用户明确要求编写后续过程文档时，按 [AGENTS](../../AGENTS.md#代码与文档定位) 放入所属模块的本次改动目录；未要求时，验证结果在回复中说明。当前使用、技术和视觉事实分别见 [README](../../README.md)、[架构](../README.md#技术架构) 与 [DESIGN](../../DESIGN.md)，当前环境状态见 [部署案例](../deployment/README.md#部署案例)。

## 历史原型检查

以下命令在仓库根目录、使用 [README 指定的 Node 工具链](../../README.md#2-检查环境并安装依赖)执行。检查以 `prototypes/` 中保留的 HTML、CSS、JavaScript 和测试断言为历史基线，不读取当前根目录 `DESIGN.md`，也不证明当前 Vue 页面通过。设计检查覆盖原型样式、主题对比度和结构，响应式检查覆盖断点及触控尺寸，业务检查覆盖原型逻辑；当前页面登记与设计文档的一致性由 `web/src/app/pageRegistry.spec.ts` 检查。

```bash
node agent-works/initial-development/prototypes/design-contract.test.mjs
node agent-works/initial-development/prototypes/responsive-contract.test.mjs
node agent-works/initial-development/prototypes/business-contract.test.mjs
```
