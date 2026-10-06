# 文档目录与事实源

本目录按业务模块组织；当前个人账单模块为 personal-bill-pwa。根 README 面向使用和开发入门，AGENTS 是 AI 协作规则，CLAUDE 仅引用 AGENTS。当前技术事实、部署方案、实例证据和需求过程分别维护，不能互相替代。

| 位置 | 职责 | 何时更新 |
|---|---|---|
| [requirement.md](requirement.md) | 业务需求、编号、范围和验收标准 | 用户确认需求改变时 |
| [requirement-closure.md](requirement-closure.md) | 上游需求闭环与确认依据 | 业务决策改变时，与正式需求同步 |
| [plan.md](plan.md) | 全局阶段顺序、依赖、实际状态与专项入口 | 每阶段实施和验证后；专项实施过程放对应改动目录 |
| [architecture/](architecture/README.md) | 当前技术实现、数据/权限、环境变量 | 相应实现或配置改变时；不累积阶段流水 |
| [deployment/](deployment/README.md) | 可复用部署架构、操作、构建和恢复 | 部署能力或操作约定改变时 |
| [deployment/cases/](deployment/cases/README.md) | 每个实例的当前总览与按主题分开的操作记录 | 部署、升级或演练后更新总览及对应主题记录 |
| [deployment/logging-management/](deployment/logging-management/README.md) | 统一日志专项计划、过程与发布验证 | 本专项范围或实施状态变化时 |
| [prototypes/](prototypes/) | 需求页面原型 | 需求/交互变更时；不是实际页面验收证据 |
| [screenshot/](screenshot/) | 已有截图材料 | 只保存真实生成且注明场景的截图 |
| [pre-release-test-report.md](pre-release-test-report.md) | 部署前候选及验证证据 | 候选变更或补充验证时，保留版本边界 |
| [test-report.md](test-report.md) | T29目标环境验收结果与剩余边界 | 部署或补验后，区分用户实机与隔离验证 |
| [performance-test.md](performance-test.md)、[security-test.md](security-test.md) | 性能/安全专项口径和证据 | 相关风险或验证结果改变时 |
| [DESIGN.md](../DESIGN.md) | 页面登记、组件、视觉与响应式契约 | 页面/组件/设计变更时 |
| [contracts/openapi.yaml](../contracts/openapi.yaml) | API机器契约 | 接口改变时，同步生成类型与测试 |
| [deploy/README.md](../deploy/README.md) | 部署实现目录的导航 | 部署入口变更时，不重复方案与案例 |

## 文档放置与维护规则

- 当前项目的架构沿用 architecture，不另建同主题平行目录；部署资料沿用 deployment。专项计划、重试和验证过程放所属模块的改动子目录，全局 plan 只保留必要状态与链接。
- 实例在 deployment/cases 下按稳定环境名建目录；README 维护当前实例摘要和入口，各次操作按主题单独记录。通用方案、既有案例记录不追加无关专项过程。
- 新业务需求仍按全局规则归入所属模块及需求子目录；不要将需求计划写进架构，也不在 AGENTS/CLAUDE 保存一次性主机信息。
- 同一事实只在责任文档完整描述，其它文档用链接。配置字段与加载顺序在环境架构，具体值在实例；规范路径若被脚本硬编码则在方案中明确。
- 文档与实现矛盾时回查源码和用户已确认需求，修正漂移；已确认需求不能因代码暂未实现而删掉，保留未完成状态。
- 测试和实例证据注明时间、提交及范围。历史通过不等于新版本通过，命令存在不等于执行成功，未验证明确标注。
