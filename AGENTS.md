# 我的账单项目 AI 协作说明

## 适用范围与事实源

本文件约束整个仓库；子目录如新增 AGENTS.md，按就近且更具体规则执行。用户明确要求优先于项目约束，项目约束优先于 `~/ai-agent-config/config/force/collaboration-rule.md` 的兜底规则；代码或文档任务先读取该通用规则。

- 一期业务基线保存在[初始需求](agent-works/initial-development/requirement.md)及其[上游闭环](agent-works/initial-development/requirement-closure.md)；[初始开发资料](agent-works/initial-development/README.md)中的计划、原型与验收仅供历史查阅，不承载后续开发进度。后续变更以用户当前确认及相应代码、契约为准，未被明确变更的业务约束仍有效。
- 设计以 [DESIGN.md](DESIGN.md) 为准；仅涉及 UI 时读取相应规则。接口以 [OpenAPI](contracts/openapi.yaml) 为准。
- 当前实现机制见[技术架构](agent-works/architecture/README.md)，变量与加载规则见[环境架构](agent-works/architecture/environment-configuration.md)。有冲突先回查源码、配置和已确认需求；实现缺失不能通过删需求来消除。
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
| agent-works | initial-development归档初始开发资料；architecture放当前技术事实，deployment放通用方案，deployment/cases放具体实例 |
| .local、node_modules、web/dist、server/target | 本机私密数据、依赖和构建产物；不提交，不为验证清空已有数据 |

文档默认目录沿用通用协作规则；本模块复用现有目录。新增同类架构先更新已有专题，禁止建立第二份变量表或把服务器信息写回通用方案。

未获用户明确要求，不新建或追加需求文档、开发计划、验收报告、自审报告或过程记录；验证结果与未覆盖项默认在回复中说明，不因开发或验证自动落盘。初始开发资料不追加后续任务；明确要求编写后续过程文档时，放所属模块的本次改动子目录。README、架构、DESIGN、契约与运维说明继续按实际变化同步稳定事实，部署实例按稳定环境名维护 cases 总览。

`.local` 不作为开发过程文档归档目录。提交消息、提交文件清单、文档草稿及一次性改写/排查脚本默认不保留；命令确需文件输入时使用系统临时目录，并在使用后清理。临时截图和测试输出在本次验证结束且无后续用途时清理；数据库、凭据、证书、备份、部署证据、仍需使用的配置/制品及运行中服务依赖的文件按各自生命周期保留，不能仅因位于 `.local` 就删除。

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
| npm run check | 组合执行前端检查/构建、后端verify与一次性数据库集成；不能用默认跳过代替数据库通过 |
| npm run dev | 本地联调；页面与/api/v1/health就绪，Ctrl+C仅停止本次启动服务，已有PG保留 |
| scripts/toolchain.sh | 解析仓库要求的Node与Java；不静默降级 |

已有专项入口 `npm --prefix web run dev`、`npm --prefix web run check`、`npm run check:server`、`npm run check:database`、`npm run check:performance`、`npm run check:security`、`npm run check:e2e` 继续按[验证说明](README.md#开发与验证)和脚本选择；它们不是每次文档变更的强制全量流程。数据库/性能测试使用一次性PG集群，不连接开发/生产/其他项目库；安全扫描需网络，容器OS扫描另计。

### 页面改动的复测选择

- 开发或修改页面前，必须读取 [README 页面复测](README.md#页面复测方式与选择) 和 DESIGN 的响应式契约，按受影响范围执行对应流程；复测方法、操作清单、测试配置和证据细则统一以 README 为准。
- 大多数日常页面复测由 AI 在本机完成，默认使用内置浏览器及 iOS 模拟器，不逐次要求用户提供手机。文案、注释和不改变运行逻辑的展示属性按最低充分验证处理；其他页面改动检查受影响页面及相关消费者。输入、候选、原生控件、滚动和手势须补原生直接操作；导航、安全区、软键盘或 PWA 生命周期改动还须检查运行本次生产构建的模拟器主屏幕 PWA。WebDriver 的 DOM/状态检查不能证明完整键盘与触摸流程。
- 真机按明确风险触发：修复真机特有问题、本次改动涉及的 iOS 版本兼容风险无法由模拟器覆盖、证书信任/真实手机网络/硬件/性能相关能力，以及全局导航结构、安全区处理、滚动容器或共享弹层焦点/关闭机制的较大调整，须补对应实体 iPhone 检查。触发时说明具体受影响行为及模拟器不能充分证明的部分，不因修改了共享文件或行数较多就要求手机。发布前集中验收本次候选受影响的实体 iPhone Safari 与主屏幕 PWA；发布后的实际终端核验按部署手册执行。提交、预览构建及不影响页面/PWA/终端环境的文档或工具发布不机械触发手机复测。安装、缓存更新、离线及后台恢复的日常检查可用模拟器。
- 按本阶段所需检查判断完成，分别标注模拟器、真机和未验证范围。未触发真机条件时，模拟器及相应直接操作通过可完成日常页面验收；触发条件、必需操作或版本证据缺失时，说明缺口与阻塞原因，不得声称对应验收完成。先完成 AI 能自主操作的部分，仅为确实必要的解锁、授权或实体操作请求用户介入。

### 服务生命周期

默认开发端口前端5174、后端8080、PG54329；开始验证先检查占用，不终止用户已有进程。开发脚本不自动读取根.env；旧库迁移校验失败不得自动repair或清空，先核对差异，独立验证用临时数据库并仅清理自身资源。

## 部署、敏感数据与完成标准

- [部署方案](agent-works/deployment/README.md)定义可复用操作；[案例](agent-works/deployment/cases/README.md)保存具体主机、连接、路径、制品与证据。实例例外不得推广为通用安全基线。
- secret、CA私钥、初始密码和真实数据不进入Git/镜像/日志。生产禁E2E写开关；迁移凭据不授常驻app。未经相应授权不进行外部写入、破坏性清理、数据库覆盖或宿主升级；只读核查及授权范围内可逆工作直接完成。
- 运行成功、脚本存在、历史测试通过分别记录；未验证写“未验证”。部署验收不得以基础服务启动替代目标终端PWA、续期、恢复/注销重放等验证；用户实测、工具实测与隔离模拟需分别标注。
- 一次实施一个任务阶段；验证与自审完成后进入下一阶段。仅在用户明确要求编写计划时同步该任务的计划状态，不更新初始计划。
- 改动完成必须以第三方视角审查完整业务闭环、同类问题、复用、权限、安全、性能与错误路径，并修复；检查是否需同步README、架构、环境、部署、DESIGN与契约等长期事实文档。在回复中报告验证及未覆盖项，不默认写入过程文档。

同步时间、测试轮次和实例进度属于临时执行记录，不进入本文件。改代码前按通用规则核实最近成功同步时间；无法核实时先同步。
