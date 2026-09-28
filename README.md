# 我的账单

个人收支管理PWA，面向普通记账用户和独立的系统管理员。支持支出/收入录入、个人字典与日常模板、明细与退款报销、回收站、导出和报表；管理员负责账号、默认字典、运行概况与审计，不读取个人账目。

一期面向内网IP使用。当前基础内网服务已运行，最终部署验收仍有待完成项；地址与实际证据见[内网部署案例](agent-works/personal-bill-pwa/deployment/cases/intranet-single-host.md)，阶段状态见[计划](agent-works/personal-bill-pwa/plan.md)。不提供账户余额、转账或离线记账。

## 快速开始

在项目根目录操作。前置：Node24.11.1（.nvmrc）、npm11.6.2、完整Java21 JDK、PostgreSQL16+可执行工具。Maven使用仓库Wrapper；无需运行其他项目数据库或安装Redis。脚本会查找已安装工具链，缺失则明确失败。

```bash
NPM_CONFIG_USERCONFIG=/dev/null npm_config_registry=https://registry.npmjs.org npm run bootstrap
npm run dev
```

bootstrap只安装web锁文件依赖，不初始化生产账号。上述已验证命令在当前调用中绕过用户级npm配置并将registry设为官方HTTPS源（包仍按锁文件URL下载），不修改全局设置；若你的环境依赖组织代理或私有仓库，应由运维提供正确配置后执行普通npm run bootstrap。根目录无需另跑npm install。

dev使用`.local/postgres`，默认创建开发库my_bill_dev，独立迁移/运行角色，再启动前后端；只允许本机PG并验证数据目录，已有PG进程会保留。默认访问 http://127.0.0.1:5174/login；健康检查：

```bash
curl --fail http://127.0.0.1:8080/api/v1/health
```

返回status UP且登录页正常代表基础服务就绪；没有默认密码或自动创建的业务账号。生产首管理员通过[独立初始化步骤](agent-works/personal-bill-pwa/deployment/runbook.md#4-镜像迁移和首管理员)创建，不能将生产凭据或开发测试seed互相复制。开发首次账号需在独立开发库按同一bootstrap机制受控初始化；不把集成测试临时账号当作持久开发账号。

Ctrl+C停止本次启动的前后端及由脚本新启动的PG，保留已有PG与数据。根`.env.example`是模板，脚本不会自动加载`.env`；环境变量须在调用前导出，完整字段见[环境架构](agent-works/personal-bill-pwa/architecture/environment-configuration.md)。

若已有开发库提示Flyway checksum不一致，先保留库并核对差异，不执行repair或清空。可为启动验证指定独立临时库名，例如`MY_BILL_DB_NAME=my_bill_docs_verify_20260928 npm run dev`；本次已用该方式验证并清理临时库，原开发库保持不变。

## 使用流程

管理员首次登录修改临时密码，再创建普通账号；普通用户首次改密后进入“记一笔”，选择个人分类/商品或收入类别并提交，在“收支明细”查看和调整，在“收支报表”分析并下钻。需要迁移数据时从导出入口创建任务，完成后在有效期内下载；回收站和账号注销按需求中的保留/删除规则处理。

PWA离线只显示无个人数据的提示页；真实手机安装、系统CA信任及独立窗口仍需最终验收。管理页面当前备份状态尚未接入宿主备份任务，运维状态以实例记录为准。

## 架构与代码结构

Vue3/Vite/TypeScript/Pinia前端通过同源/api/v1访问Java21/Spring Boot模块化单体，MyBatis-Plus/XML访问PostgreSQL；任务使用数据库协调。生产由Caddy承接HTTPS与静态资源。

| 目录 | 内容 |
|---|---|
| web/ | 页面、共享组件、状态、API、单元测试与E2E |
| server/ | 领域服务、认证/租户、Mapper、迁移与后端测试 |
| contracts/ | OpenAPI及校验配置；前端类型由此生成 |
| scripts/ | 工具链、本地开发、隔离验证、候选构建 |
| deploy/ | Compose、代理、secret入口、CA、备份与监控实现 |
| agent-works/ | 按业务模块组织的需求、计划、架构、方案、案例和验证材料 |
| .local/ | 忽略入库的开发数据、凭据及临时产物；不可整体交付 |

## 开发与验证

常规改动按[AGENTS](AGENTS.md)选择最低充分验证。需要完整工程基线时：

```bash
npm run check
```

此命令包含前端typecheck/lint/Vitest/OpenAPI漂移/build、后端Maven verify、临时PG数据库集成。源码生成或构建产物不手改；接口变更修改contracts后重新生成类型。专项命令见package.json：check:server、check:database、check:performance、check:security、check:e2e；持续发布关卡见[持续构建](agent-works/personal-bill-pwa/deployment/continuous-delivery.md)。专项入口按实际执行记录判断，不因脚本存在就视为通过。

安装、起停与检查入口已完成本次验证，详细范围及已发现的本机配置问题见[验证记录](agent-works/personal-bill-pwa/pre-release-test-report.md#9-文档与安装链路核验2026-09-28)。npm registry不是HTTP代理；锁文件版本、下载地址和完整性摘要必须一致，不删除integrity绕过校验。

## 部署与排查

从[部署导航](agent-works/personal-bill-pwa/deployment/README.md)依次阅读架构、配置、操作手册、持续构建、备份恢复，再选择具体案例。当前CI做检查，尚未自动构建推送镜像或部署。公网方案尚未实施，后续使用独立案例记录，不能把内网宿主例外推广。

| 现象 | 检查入口 |
|---|---|
| 工具链不匹配 | .nvmrc、scripts/toolchain.sh、JAVA_HOME |
| npm包校验/代理错误 | 当前npm源/代理与锁文件下载地址；不得删除integrity字段绕过 |
| 前端无法连接API | 实际Vite端口、后端health、两侧MY_BILL_SERVER_PORT一致 |
| Flyway校验失败 | 当前源码迁移与目标库历史；不自动repair |
| HTTPS证书告警 | 案例CA指纹、客户端信任、IP SAN和有效期；不跳过校验 |
| 备份页面未配置 | 当前是已知集成缺口；查宿主timer、服务日志和last-success |

## 文档导航

[完整目录与维护职责](agent-works/README.md)是文档总索引。常用入口如下：

| 想了解 | 文档 |
|---|---|
| AI协作规则 | [AGENTS](AGENTS.md)、[Claude入口](CLAUDE.md) |
| 业务范围与进度 | [需求](agent-works/personal-bill-pwa/requirement.md)、[计划](agent-works/personal-bill-pwa/plan.md) |
| 技术架构 | [架构索引](agent-works/personal-bill-pwa/architecture/README.md) |
| 环境变量/secret | [配置架构](agent-works/personal-bill-pwa/architecture/environment-configuration.md) |
| 页面规范/接口 | [DESIGN](DESIGN.md)、[OpenAPI](contracts/openapi.yaml) |
| 可复用部署方案 | [部署架构与手册](agent-works/personal-bill-pwa/deployment/README.md) |
| 当前服务器与部署结果 | [案例索引](agent-works/personal-bill-pwa/deployment/cases/README.md) |
| 部署前验证 | [验收记录](agent-works/personal-bill-pwa/pre-release-test-report.md)、[性能](agent-works/personal-bill-pwa/performance-test.md)、[安全](agent-works/personal-bill-pwa/security-test.md) |
