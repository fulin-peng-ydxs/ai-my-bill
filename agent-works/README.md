# 文档目录与事实源

根 README 面向使用和开发入门，AGENTS 是 AI 协作规则，CLAUDE 仅引用 AGENTS。初始开发资料集中归档，当前技术事实、部署方案及实例信息分别维护，不能互相替代。

| 位置 | 职责 | 何时更新 |
|---|---|---|
| [initial-development/](initial-development/README.md) | 初始需求、计划、原型、截图及历史验收 | 不追加后续任务，仅按明确要求纠正归档内容 |
| [architecture/](architecture/README.md) | 当前技术实现、数据/权限、环境变量 | 相应实现或配置改变时；不累积阶段流水 |
| [deployment/](deployment/README.md) | 可复用部署架构、操作、构建和恢复 | 部署能力或操作约定改变时 |
| [deployment/cases/](deployment/cases/README.md) | 每个实例的当前总览及已有操作记录 | 同步环境稳定事实；过程记录仅在用户明确要求时写入 |
| [deployment/logging-management/](deployment/logging-management/README.md) | 已有统一日志专项计划、过程与发布验证 | 仅在用户明确要求维护该专项材料时更新 |
| [DESIGN.md](../DESIGN.md) | 页面登记、组件、视觉与响应式契约 | 页面/组件/设计变更时 |
| [contracts/openapi.yaml](../contracts/openapi.yaml) | API机器契约 | 接口改变时，同步生成类型与测试 |
| [deploy/README.md](../deploy/README.md) | 部署实现目录的导航 | 部署入口变更时，不重复方案与案例 |

## 文档放置与维护规则

- 过程文档的写入条件以 [AGENTS](../AGENTS.md#代码与文档定位) 为准；未明确要求时，需求、计划、验收和自审结果不自动落盘，验证结果在回复中说明。明确要求编写时，归入所属模块的本次改动目录，不续写初始开发归档。
- 当前架构沿用 architecture，部署资料沿用 deployment，不另建同主题平行目录。实例在 deployment/cases 下按稳定环境名维护当前摘要和入口；长期文档不追加无关任务流水。
- 不将需求计划写进架构，也不在 AGENTS/CLAUDE 保存一次性主机信息。
- 同一事实只在责任文档完整描述，其它文档用链接。配置字段与加载顺序在环境架构，具体值在实例；规范路径若被脚本硬编码则在方案中明确。
- 文档与实现矛盾时回查源码和用户已确认需求，修正漂移；已确认需求不能因代码暂未实现而删掉，保留未完成状态。
- 测试和实例证据注明时间、提交及范围。历史通过不等于新版本通过，命令存在不等于执行成功，未验证明确标注。
