# 我的账单项目 AI 协作说明

## 适用范围与事实源

本文件约束整个仓库；子目录如新增 AGENTS.md，按就近且更具体规则执行。用户明确要求优先于项目约束，项目约束优先于 `~/ai-agent-config/config/force/collaboration-rule.md` 的兜底规则；代码或文档任务先读取该通用规则。

- 业务以已确认需求及用户后续变更为准；归档不取消未被明确变更的业务约束。当前实现、契约与历史依据有冲突时回查确认来源，不以代码缺失删除需求；历史材料从[文档索引](agent-works/README.md#历史归档)定位。
- 设计以 [DESIGN.md](DESIGN.md) 为准；仅涉及 UI 时读取相应规则。接口以 [OpenAPI](contracts/openapi.yaml) 为准。
- 当前实现机制见[技术架构](agent-works/README.md#技术架构)，变量与加载规则见[环境架构](agent-works/architecture/environment-configuration.md)。
- [README](README.md)负责使用入口，[文档索引](agent-works/README.md)负责目录归属；CLAUDE只链接本文件，不重复规则。

## 代码与文档定位

| 位置 | 职责/修改边界 |
|---|---|
| app/src、app/ios | 离线 iPhone 入口、原生 SQLite 连接与 Xcode 工程；页面外壳已迁入，完整本地业务仍分阶段接入，机制见总体架构 |
| app/native-tests、app/test-support、app/ios/App/NativeTests、app/ios/App/UITests | Node SQLite 辅助、共享数据场景、hosted XCTest 探针及外部 XCUITest；测试资源不进入生产 App |
| web/src | 页面、组件、组合函数、领域工具、API与Pinia；先查同类实现，复用共享能力 |
| server/src/main/java/com/mybill | 领域Controller/应用服务/Repository/Mapper；跨领域写入经应用服务或明确只读查询接口 |
| server/src/main/resources/mapper | 运行期SQL唯一位置；Java通过Mapper调用 |
| server/src/main/resources/db | Flyway迁移与受控回滚材料；生产不自动降级 |
| server/src/test、web/src/**/*.spec.ts、web/e2e | 分层测试；E2E只用于低层无法覆盖的关键浏览器链路 |
| contracts | OpenAPI事实源；web/src/api/generated为生成物，修改契约后重新生成，不手改 |
| scripts、deploy | 本地工具链/验证/候选构建与部署实现 |
| agent-works | architecture放当前技术事实，testing放验证规范，deployment放通用方案及cases实例；历史资料由文档索引定位 |
| .local、node_modules、app/dist、app/.native-test、app/ios/App/CapApp-SPM、web/dist、server/target | 本机私密数据、依赖和生成产物；不提交，不为验证清空已有数据；SPM 生成适配通过脚本维护，Package.resolved 提交锁定 |

文档默认目录沿用通用协作规则；本模块复用现有目录。新增同类架构先更新已有专题，禁止建立第二份变量表或把服务器信息写回通用方案。

未获用户明确要求，不新建或追加需求文档、开发计划、验收报告、自审报告或过程记录；验证结果与未覆盖项默认在回复中说明，不因开发或验证自动落盘。初始开发资料不追加后续任务；明确要求编写后续过程文档时，放所属模块的本次改动子目录。README、架构、DESIGN、契约与运维说明继续按实际变化同步稳定事实，部署实例按稳定环境名维护 cases 总览。

开发临时产物遵循全局协作规则。`.local` 中的数据库、凭据、证书、备份、部署证据及仍在使用的配置/制品按各自生命周期保留。

本地运行资料按端隔离：现有 Web 端使用 `.local/web/`，后续离线 iOS App 使用 `.local/ios/`；配置、数据库、日志、测试凭据和制品不得跨端共用。相对工作目录产生的 `.local` 同样按端分层；整个 `.local` 继续由 Git 忽略。

## 工程与业务硬约束

- Node.js24 LTS、Vue3、Vite、TypeScript、Pinia、Vue Router；Java21 LTS、Spring Boot模块化单体、MyBatis-Plus、Maven Wrapper。工具链具体版本以仓库配置为准。
- App 使用 Capacitor 与原生 SQLite，仅声明 iPhone、最低 iOS 27.0；随包运行，不配置远程入口，不用 Web/WASM/IndexedDB 替代原生账本。迁移保持原有页面布局、导航、组件与交互，围绕同一界面做必要 iPhone 适配。
- 一期不引入Redis、消息队列、微服务、地图服务、账户余额或转账能力。新增技术方案/不明确业务规则先形成可评估选项；已有用户授权不重复索取。
- 旧服务端生产运行SQL只在Mapper XML；禁止Spring JDBC、JPA或Java内嵌SQL。schema/授权变更走现有migration/provision文件，说明用途、时机、影响及回退边界，不修改已部署migration校验和。
- 旧 Web 浏览器只访问同源 `/api/v1`；身份/租户来自服务端认证上下文。新增API同步角色守卫与拒绝测试，ADMIN不能读取个人账目；租户事务、RLS、复合归属不可省略。App 原生路径不依赖这组联网服务，不为验证恢复已停止的日常 Web/PG。
- 金额/数量用十进制精确类型，禁止二进制浮点处理业务金额；业务时间统一Asia/Shanghai。
- API错误包含code、message、fieldErrors、traceId、retryable；不得返回堆栈、凭据或租户标识。接口变更同步OpenAPI、生成类型及调用者。
- 新增或修改页面同步检查DESIGN的页面登记、组件清单与响应式契约；不得复制共享状态、交互、样式。PWA不得缓存个人API/下载或伪造离线提交。
- 后台任务必须有界、幂等、明确作用域和重试/取消策略；导出与注销遵循文件补偿及审计保留边界。

## 开发与验证

运行、工具链及首次账号入口见 [README](README.md)。所有改动按[开发验证规范](agent-works/testing/guide.md)选择适用检查、维护项与完成证据；页面开发前还须读取 DESIGN 的响应式契约。该规范统一维护模拟器/真机选择、直接操作、服务保护和未验证处理，不以工程检查替代页面或部署验收。

离线 App 日常调试、页面与原生数据库回归优先使用独立 iPhone 模拟器；真机仅用于模拟器无法覆盖的必要问题及最终安装/性能/交付验收，提前使用须说明具体缺口。模拟器结果不得替代已约定的真机 Release 指标。

## 部署、敏感数据与完成标准

- [部署方案](agent-works/deployment/README.md)定义可复用操作；[案例](agent-works/deployment/README.md#部署案例)保存具体主机、连接、路径、制品与证据。实例例外不得推广为通用安全基线。
- secret、CA私钥、初始密码和真实数据不进入Git/镜像/日志。生产禁E2E写开关；迁移凭据不授常驻app。未经相应授权不进行外部写入、破坏性清理、数据库覆盖或宿主升级；只读核查及授权范围内可逆工作直接完成。
- 一次实施一个任务阶段；验证与自审完成后进入下一阶段。仅在用户明确要求编写计划时同步该任务的计划状态，不更新初始计划。
- 改动完成必须以第三方视角审查完整业务闭环、同类问题、复用、权限、安全、性能与错误路径，并修复；检查是否需同步README、架构、环境、部署、DESIGN与契约等长期事实文档。在回复中报告验证及未覆盖项，不默认写入过程文档。
