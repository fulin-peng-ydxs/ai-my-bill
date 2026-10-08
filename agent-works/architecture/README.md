# 技术架构索引

本目录维护个人账单系统的当前实现，沿用已有架构目录。架构说明以当前源码为依据；[初始计划](../initial-development/plan.md) 只供历史阶段查阅，不承载后续进度，环境实测以 [部署案例](../deployment/cases/intranet-single-host/README.md) 为准。

## 专题导航

| 文档 | 回答的问题 | 主要代码边界 |
|---|---|---|
| [总体架构与契约](architecture-decisions.md) | 运行单元、依赖方向与不可破坏的契约 | web、server、contracts |
| [前端与 PWA](frontend-pwa.md) | 页面如何登记、状态如何复用、哪些内容能缓存 | web/src |
| [后端与业务模块](backend-domains.md) | 字典、账目、报表、管理之间如何协作 | server 的领域包 |
| [认证与租户隔离](auth-tenant.md) | 身份、CSRF、角色、RLS 如何形成闭环 | auth、SecurityConfig、V007 |
| [数据库与迁移](database-migrations.md) | 表归属、数据库角色、版本升级与回退 | db、mapper、persistence |
| [任务、导出与注销](jobs-export-deletion.md) | 异步任务、文件与数据库如何协同 | job、ledger、account |
| [环境与配置加载](environment-configuration.md) | 变量由谁加载、优先级、密钥边界与生效方式 | scripts、application*.yml、Compose |
| [部署架构](../deployment/architecture.md) | 服务如何交付、部署模式与资源边界 | deploy、Dockerfile |

修改接口时同步 OpenAPI 与生成类型；修改模块机制时更新对应架构；部署实例信息只更新案例。页面布局与视觉规则仍由根目录 DESIGN.md 定义，本目录不复制设计规范。
