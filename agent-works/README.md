# 项目文档索引

| 入口 | 用途 |
|---|---|
| [README](../README.md) | 安装、开发启动、账号初始化与常用操作 |
| [AGENTS](../AGENTS.md) | 项目协作、工程约束与文档维护要求 |
| [DESIGN](../DESIGN.md) | 视觉、交互、组件及响应式契约、页面登记 |
| [OpenAPI](../contracts/openapi.yaml) | API 机器契约与生成类型来源 |
| [开发验证规范](testing/guide.md) | 检查选择、变更维护、模拟器/真机复测与证据要求 |
| [部署方案](deployment/README.md) | 宿主准备、初始化、持续发布、运维与恢复 |

## 技术架构

代码与配置是机制依据，实际环境状态见[部署案例](deployment/README.md#部署案例)。

| 专题 | 回答的问题 | 主要代码边界 |
|---|---|---|
| [总体架构与契约](architecture/architecture-decisions.md) | 运行单元、依赖方向与共享契约 | web、server、contracts |
| [前端与 PWA](architecture/frontend-pwa.md) | 路由与状态复用、资源生命周期、草稿及 PWA 构建与更新 | web/src |
| [后端与业务模块](architecture/backend-domains.md) | 字典、账目、报表、管理之间如何协作 | server 的领域包 |
| [认证与租户隔离](architecture/auth-tenant.md) | 身份、CSRF、角色、RLS 如何形成闭环 | auth、SecurityConfig、V007 |
| [数据库与迁移](architecture/database-migrations.md) | 表归属、数据库角色、版本升级与回退 | db、mapper、persistence |
| [任务、导出与注销](architecture/jobs-export-deletion.md) | 异步任务、文件与数据库如何协同 | job、ledger、account |
| [环境与配置加载](architecture/environment-configuration.md) | 变量加载、优先级、密钥边界与生效方式 | scripts、application*.yml、Compose |
| [部署架构](deployment/architecture.md) | 交付、运行单元与资源边界 | deploy、Dockerfile |

## 历史归档

阶段材料标记 `归档状态：已归档` 后停止日常同步，只有用户明确要求修订或解除归档时才更新。归档不取消仍有效的业务要求，不把未完成项改成已通过，也不删除历史证据。后续任务按 [AGENTS](../AGENTS.md#代码与文档定位) 决定是否产档及保存位置。

| 资料 | 保存内容 |
|---|---|
| [初始开发资料](initial-development/README.md) | 一期需求与上游闭环、计划、原型、截图和历史验收 |
| [统一日志专项](deployment/logging-management/README.md) | 已有实施计划、过程和发布安全验证 |

实例历史操作从各案例总览进入，按记录时点及对应版本读取；历史通过不代表当前版本或另一环境通过。秘密只保留受控位置引用，不复制到文档。
