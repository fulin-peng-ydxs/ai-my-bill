# 我的账单项目 AI 协作说明

## 适用范围与事实源

本文件约束整个仓库；子目录如新增 AGENTS.md，按就近且更具体规则执行。用户明确要求优先于项目约束，项目约束优先于 `~/ai-agent-config/config/force/collaboration-rule.md` 的兜底规则；代码或文档任务先读取该通用规则。

- 业务以[需求](agent-works/personal-bill-pwa/requirement.md)及其[上游闭环](agent-works/personal-bill-pwa/requirement-closure.md)为准，顺序、依赖、实施与验收状态以[计划](agent-works/personal-bill-pwa/plan.md)为准。
- 设计以 [DESIGN.md](DESIGN.md) 为准；仅涉及 UI 时读取相应规则。接口以 [OpenAPI](contracts/openapi.yaml) 为准。
- 当前实现机制见[技术架构](agent-works/personal-bill-pwa/architecture/README.md)，变量与加载规则见[环境架构](agent-works/personal-bill-pwa/architecture/environment-configuration.md)。有冲突先回查源码、配置和已确认需求；实现缺失不能通过删需求来消除。
- [README](README.md)负责使用入口，[文档索引](agent-works/README.md)负责目录归属；CLAUDE只链接本文件，不重复规则。

## 代码与文档定位

| 位置 | 职责/修改边界 |
|---|---|
| web/src | 页面、组件、组合函数、领域工具、API与Pinia；先查同类实现，复用共享能力 |
| server/src/main/java/com/mybill | 领域Controller/应用服务/Repository/Mapper；跨领域写入经应用服务或明确只读查询接口 |
| server/src/main/resources/mapper | 运行期SQL唯一位置；Java通过Mapper调用 |
| server/src/main/resources/db | Flyway迁移与受控回滚材料；生产不自动降级 |
| server/src/test、web/src/**/*.spec.ts、web/e2e | 分层测试；E2E只用于低层无法覆盖的关键浏览器链路 |
| contracts | OpenAPI事实源；web/src/api/generated为生成物，修改契约后重新生成，不手改 |
| scripts、deploy | 本地工具链/验证/候选构建与部署实现 |
| agent-works/personal-bill-pwa | 需求、计划、原型、验证；architecture放当前技术事实，deployment放通用方案，deployment/cases放具体实例 |
| .local、node_modules、web/dist、server/target | 本机私密数据、依赖和构建产物；不提交，不为验证清空已有数据 |

文档默认目录沿用通用协作规则；本模块复用现有目录。新增同类架构先更新已有专题，禁止建立第二份变量表或把服务器信息写回通用方案。

## 工程与业务硬约束

- Node.js24 LTS、Vue3、Vite、TypeScript、Pinia、Vue Router；Java21 LTS、Spring Boot模块化单体、MyBatis-Plus、Maven Wrapper。工具链具体版本以仓库配置为准。
- 一期不引入Redis、消息队列、微服务、地图服务、账户余额或转账能力。新增技术方案/不明确业务规则先形成可评估选项；已有用户授权不重复索取。
- 生产运行SQL只在Mapper XML；禁止Spring JDBC、JPA或Java内嵌SQL。schema/授权变更走现有migration/provision文件，说明用途、时机、影响及回退边界，不修改已部署migration校验和。
- 浏览器只访问同源 `/api/v1`；身份/租户来自服务端认证上下文。新增API同步角色守卫与拒绝测试，ADMIN不能读取个人账目；租户事务、RLS、复合归属不可省略。
- 金额/数量用十进制精确类型，禁止二进制浮点处理业务金额；业务时间统一Asia/Shanghai。
- API错误包含code、message、fieldErrors、traceId、retryable；不得返回堆栈、凭据或租户标识。接口变更同步OpenAPI、生成类型及调用者。
- 新增或修改页面同步检查DESIGN的页面登记、组件清单与响应式契约；不得复制共享状态、交互、样式。PWA不得缓存个人API/下载或伪造离线提交。
- 后台任务必须有界、幂等、明确作用域和重试/取消策略；导出与注销遵循文件补偿及审计保留边界。

## 验证与服务生命周期

所有命令在仓库根目录执行；先满足README的工具链前提。按风险选最低充分验证，纯文档通常只检查差异、链接与事实，不默认重跑全套。

| 入口 | 适用范围与判定 |
|---|---|
| npm run check | 已验证组合入口：前端检查/构建、后端verify、一次性数据库集成均成功；不能用默认跳过代替数据库通过 |
| npm run dev | 本地联调；页面与/api/v1/health就绪，Ctrl+C仅停止本次启动服务，已有PG保留 |
| scripts/toolchain.sh | 解析仓库要求的Node与Java；不静默降级 |

已有专项入口 `npm --prefix web run dev`、`npm --prefix web run check`、`npm run check:server`、`npm run check:database`、`npm run check:performance`、`npm run check:security`、`npm run check:e2e` 继续按[验证说明](README.md#开发与验证)和脚本选择；它们不是每次文档变更的强制全量流程。数据库/性能测试使用一次性PG集群，不连接开发/生产/其他项目库；安全扫描需网络，容器OS扫描另计。

默认开发端口前端5174、后端8080、PG54329；开始验证先检查占用，不终止用户已有进程。开发脚本不自动读取根.env；旧库迁移校验失败不得自动repair或清空，先核对差异，独立验证用临时数据库并仅清理自身资源。

## 部署、敏感数据与完成标准

- [部署方案](agent-works/personal-bill-pwa/deployment/README.md)定义可复用操作；[案例](agent-works/personal-bill-pwa/deployment/cases/README.md)保存具体主机、连接、路径、制品与证据。实例例外不得推广为通用安全基线。
- secret、CA私钥、初始密码和真实数据不进入Git/镜像/日志。生产禁E2E写开关；迁移凭据不授常驻app。未经相应授权不进行外部写入、破坏性清理、数据库覆盖或宿主升级；只读核查及授权范围内可逆工作直接完成。
- 运行成功、脚本存在、历史测试通过分别记录；未验证写“未验证”。T29不得以基础服务启动替代手机PWA、续期、恢复/注销重放等最终验收。
- 一次实施一个任务阶段；验证通过、更新计划实际落地、完成本地Git提交后进入下一阶段。提交前使用git-commit-msg技能；未经要求不推送。
- 改动完成必须以第三方视角审查完整业务闭环、同类问题、复用、权限、安全、性能与错误路径，并修复；检查是否需同步README、架构、环境、部署、DESIGN、契约与计划。报告验证及未覆盖项。

最近一次 `git pull` 操作时间：2026-09-28 16:40:42 CST（origin main）。超过通用规则规定间隔时先同步再改代码。
