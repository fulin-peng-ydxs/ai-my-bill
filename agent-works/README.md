# 项目文档索引

| 入口 | 用途 |
| --- | --- |
| [README](../README.md) | 离线 App 使用、安装与开发入口 |
| [AGENTS](../AGENTS.md) | 工程、协作与文档维护规则 |
| [DESIGN](../DESIGN.md) | 保留原页面的视觉、交互、组件与响应式契约 |
| [总体架构](architecture/architecture-decisions.md) | 原生入口、SQLite 生命周期、本地业务/文件闭环及契约 |
| [环境配置](architecture/environment-configuration.md) | 工具链、测试配置、私密材料与证据位置 |
| [开发验证规范](testing/guide.md) | 选测、CI、失败锁、模拟器与真机边界 |
| [前置开发技术指引](offline-ios-app/pre-development-technical-guide.md) | 原样保存的改造评估；决定和实际状态以开发计划为准 |
| [离线 App 开发计划](offline-ios-app/plan.md) | 已确认范围、17 项任务、验证、交付结果及后续未验证范围 |

## 技术架构

当前机制由上述总体架构和环境配置维护，代码、迁移、锁文件及实际报告是事实依据。旧 Web、服务器部署与 OpenAPI 不再是当前工程入口。

## 历史归档

归档不取消未被明确变更的业务要求；历史通过不代表当前候选通过。原文中的旧命令和路径按当时版本解释，不对当前 App 执行；旧 `.local/<目录>` 资料已隔离到 `.local/web/`，后端原有资料保留于 server/.local/web，不为清理受控源码删除私密资料。

| 资料 | 保存内容 |
| --- | --- |
| [初始开发资料](initial-development/README.md) | 历史需求、闭环、原型及验证原文 |
| [退役前源码与文档基线](https://github.com/fulin-peng-ydxs/ai-my-bill/tree/d152ea615d3c5e25df6dfbd250b342ef4ab790ed/) | 旧 Web、Java/PG、OpenAPI、部署案例、日志治理记录和归档相对链接的完整上下文；按此固定版本追溯，勿恢复当前服务 |

原技术指引中的历史绝对路径及归档原文中的退役相对路径保持不变。本仓库的退役路径从上述固定基线定位；外部 stock 项目等绝对路径按计划列明的来源解释，不能用本仓库同名文件替代。不为修链接改写原始指引或历史证据。凭据、证书私钥、真实账本及外部实例均不随源码退役删除。
