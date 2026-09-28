# 文档目录与事实源

本目录按业务模块组织；当前个人账单模块为 personal-bill-pwa。根 README 面向使用和开发入门，AGENTS 是 AI 协作规则，CLAUDE 仅引用 AGENTS。当前技术事实、部署方案、实例证据和需求过程分别维护，不能互相替代。

| 位置 | 职责 | 何时更新 |
|---|---|---|
| [requirement.md](personal-bill-pwa/requirement.md) | 业务需求、编号、范围和验收标准 | 用户确认需求改变时 |
| [requirement-closure.md](personal-bill-pwa/requirement-closure.md) | 上游需求闭环与确认依据 | 业务决策改变时，与正式需求同步 |
| [plan.md](personal-bill-pwa/plan.md) | 阶段顺序、依赖、实际落地与状态 | 每阶段实施和验证后；未验证不能标完成 |
| [architecture/](personal-bill-pwa/architecture/README.md) | 当前技术实现、数据/权限、环境变量 | 相应实现或配置改变时；不累积阶段流水 |
| [deployment/](personal-bill-pwa/deployment/README.md) | 可复用部署架构、操作、构建和恢复 | 部署能力或操作约定改变时 |
| [deployment/cases/](personal-bill-pwa/deployment/cases/README.md) | 具体环境、连接、路径、制品和验收 | 每次实例部署、升级或演练后 |
| [prototypes/](personal-bill-pwa/prototypes/) | 需求页面原型 | 需求/交互变更时；不是实际页面验收证据 |
| [screenshot/](personal-bill-pwa/screenshot/) | 已有截图材料 | 只保存真实生成且注明场景的截图 |
| [pre-release-test-report.md](personal-bill-pwa/pre-release-test-report.md) | 部署前候选及验证证据 | 候选变更或补充验证时，保留版本边界 |
| [test-report.md](personal-bill-pwa/test-report.md) | T29目标环境验收结果与剩余边界 | 部署或补验后，区分用户实机与隔离验证 |
| [performance-test.md](personal-bill-pwa/performance-test.md)、[security-test.md](personal-bill-pwa/security-test.md) | 性能/安全专项口径和证据 | 相关风险或验证结果改变时 |
| [DESIGN.md](../DESIGN.md) | 页面登记、组件、视觉与响应式契约 | 页面/组件/设计变更时 |
| [contracts/openapi.yaml](../contracts/openapi.yaml) | API机器契约 | 接口改变时，同步生成类型与测试 |
| [deploy/README.md](../deploy/README.md) | 部署实现目录的导航 | 部署入口变更时，不重复方案与案例 |

## 文档放置与维护规则

- 当前模块的架构沿用 personal-bill-pwa/architecture，不另建同主题平行目录；部署资料沿用 deployment，实例一案一文放 cases。
- 新业务需求仍按全局规则归入所属模块及需求子目录；不要将需求计划写进架构，也不在 AGENTS/CLAUDE 保存一次性主机信息。
- 同一事实只在责任文档完整描述，其它文档用链接。配置字段与加载顺序在环境架构，具体值在实例；规范路径若被脚本硬编码则在方案中明确。
- 文档与实现矛盾时回查源码和用户已确认需求，修正漂移；已确认需求不能因代码暂未实现而删掉，保留未完成状态。
- 测试和实例证据注明时间、提交及范围。历史通过不等于新版本通过，命令存在不等于执行成功，未验证明确标注。
