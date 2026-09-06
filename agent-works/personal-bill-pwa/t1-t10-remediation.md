# T1-T10 审查复核与整改记录

## 1. 结论

外部审查列出的 8 项问题均有事实依据，本次全部认可并完成整改。P1-1 的根因包含计划拆分错误：T7 在 T19 尚被法务保留策略阻塞时提前开放了不可逆的注销前置状态。其余问题主要是实现遗漏、审查矩阵遗漏和事实文档/证据维护遗漏，不是需求本身要求错误。

整改没有实施 T11 及以后收支能力，也没有实现 T19 的实际注销清理。账号注销 API 与页面动作改为在 T19 完整闭环前均不登记；旧路径返回标准 404 且无任何业务副作用。

## 2. 外部审查问题逐项回应

### P1-1 T7 注销造成不可恢复的半注销状态

- 是否认可：认可，且认定为阶段阻塞问题。
- 修改：删除 T7 的注销 API、状态写入、租户暂停、会话撤销、注销 job 创建和成功审计；删除管理页注销动作。T19 计划补充管理员入口登记与实现职责。
- 文件：`AdminUserService.java`、`AdminUserRepository.java`、`AdminUserHttpIntegrationTest.java`、`UserManagementView.vue`、`adminUsers.ts`、`contracts/openapi.yaml`、生成类型、需求/闭环/计划/架构/DESIGN。
- 验证：真实 PostgreSQL 集成测试断言旧路径标准 404 后用户仍为 ACTIVE、租户仍为 ACTIVE、原会话仍为 200、注销 job 为 0、无 `REQUEST_USER_DELETION` 成功审计；浏览器确认操作抽屉无注销入口。

### P1-2 T10 草稿按 UTF-16 长度错误拒绝 emoji

- 是否认可：认可。
- 修改：新增共享 `unicodeCodePointLength`，密码和草稿统一按 Unicode code point 计数；不改变 16 KiB 总序列化上限。
- 文件：`web/src/domain/text.ts`、`web/src/auth/password.ts`、`web/src/composables/useLedgerDraft.ts`、`useLedgerDraft.spec.ts`。
- 验证：新增 500 个 emoji 可保存、501 个被拒绝的边界测试；前端全量 74 项单测通过。

### P1-3 普通用户访问 `/admin` 被重定向而非显示权限错误

- 是否认可：认可。
- 修改：普通用户保留管理目标 URL，由应用壳显示共享 `AppStateBlock(permission)`；受限 `RouterView` 不挂载。管理员访问普通用户页仍回到 `/admin`。
- 文件：`web/src/router/index.ts`、`sessionRouteGuard.spec.ts`、`web/src/App.vue`、`DESIGN.md`、`plan.md`。
- 验证：路由单测断言普通用户保持 `/admin`；真实浏览器确认 URL 为 `/admin`、显示“无权访问此页面”、DOM 中无用户管理标题。

### P1-4 移动端 Toast 遮挡底部导航且违反无阴影规则

- 是否认可：认可。
- 修改：移除 Toast 阴影；增加底部导航高度 token，在 `≤833px` 的普通用户外壳中把 Toast 放到底部导航与安全区上方。
- 文件：`web/src/styles/tokens.css`、`DESIGN.md`。
- 验证：真实 Chromium 移动布局测得 Toast 底边 1719px、导航顶边 1735px，`overlap=false`，计算样式 `box-shadow:none`，页面无横向溢出；截图已提交。

### P1-5 架构决策仍停留在 schema 008、15 张 RLS 表和字典未实现

- 是否认可：认可。
- 修改：同步为 schema 010、16 张强制 RLS 表、真实 `dictionary`/`preference` 包边界、T7-T10 已实现能力和 30+7 数据库验证事实；生产门禁同步描述为 010。
- 文件：`architecture-decisions.md`。
- 验证：代码检索与真实数据库迁移日志确认 10 个 migration、版本 010、16 张 RLS 表；目录核对实际领域包。

### P2-1 多实例过期租约恢复重复计数

- 是否认可：认可。
- 修改：`recoverExpired` 返回条件更新是否命中；协调器只在命中时增加恢复数和指标。
- 文件：`JobRunRepository.java`、`JdbcJobRunRepository.java`、`JobCoordinator.java`、`JobCoordinatorTest.java`、`PostgresSchemaIntegrationTest.java`、`plan.md`。
- 验证：单元测试模拟两实例先后拿到同一陈旧候选，只产生一次计数；真实 PostgreSQL 对同一 run 首次恢复为 true、再次为 false。

### P2-2 T9/T10 截图只声明在忽略目录且已经不存在

- 是否认可：认可。历史执行无法替代当前可复核证据。
- 修改：重新执行 T7/T9/T10 相关真实浏览器流程，将 9 张截图、视口、步骤、测量、清理结果和 SHA-256 放入 Git 跟踪目录；计划不再把已消失的 `.local/audit` 文件当作有效证据。
- 文件：`agent-works/personal-bill-pwa/evidence/t1-t10-remediation/**`、`plan.md`。
- 验证：浏览器完成 T9 商品新增/预览/确认/合并、管理员默认分类新增，T10 最近类型刷新恢复与夜晚偏好，以及权限和 Toast 检查；控制台无 warning/error。当前可用 CSS 视口为 534×1804，未冒充 390px；360/390px 完整矩阵仍由 T25 执行。

### P2-3 文档中的后端检查命令依赖 shell 默认 Java 8

- 是否认可：认可。
- 修改：新增 `npm run check:server` 和 `scripts/check-server.sh`，复用现有 `toolchain.sh` 自动解析系统已有 IntelliJ JBR 21；AGENTS 和架构文档改用该入口。
- 文件：`scripts/check-server.sh`、`package.json`、`AGENTS.md`、`architecture-decisions.md`。
- 验证：在当前默认 `java` 非项目目标版本的 shell 中执行 `npm run check:server`，实际使用 Java 21.0.10，Maven verify 成功。没有下载 JDK、Node 或数据库。

## 3. 本次额外发现并修复

1. `DESIGN.md` 的“当前实现”事实仍停在 T9。已同步 T10、原位 permission、T19 前无注销入口，以及移动 Toast 契约。
2. 任务执行在完成/失败回写前刚失去租约时，会先抛终态写入异常，再在失败分支二次写入并再次抛错。已引入明确的 `JobLeaseLostException`：失去所有权的实例只记录 `lease_lost`，不重试、不覆盖新所有者状态，也不让调度调用异常退出；新增单测覆盖。
3. 开发计划把 R4 在 T7 标为整体完成，和 T19 仍阻塞矛盾。现改为“进行中（T7 已开放操作完成）”，任务映射补入 T19，T7 的完成标准仅覆盖其合法子范围。

## 4. 根因分析

- 计划问题：P1-1。计划把“登记注销请求”和“实际清理”错误拆成 T7/T19，却没有为中间态定义可恢复路径、消费者或关闭门禁；这使按计划实现仍会得到半注销状态。
- 实现遗漏：Unicode 长度、权限态、Toast 布局/阴影、租约更新行数和终态租约丢失。
- 审查遗漏：此前自审偏重单实例成功路径，没有覆盖“跨阶段依赖尚未可用时入口是否应开放”、多实例陈旧读取、Unicode 非 BMP、固定浮层与固定导航的几何关系。
- 文档与证据遗漏：完成阶段后只更新了 plan 局部，没有把 architecture、DESIGN、AGENTS 命令和可持久复核证据纳入同一完成门禁。

## 5. 整体回归边界

- 阶段边界：没有开发 T11-T29 功能；只修复 T1-T10 已完成范围和关闭误提前开放的 T19 入口。
- SQL/seed/权限/菜单/部署：未新增 migration、SQL、seed、权限表、动态菜单或部署依赖；OpenAPI、前端角色显示、管理动作和验证入口已同步。
- 数据库：只使用系统 PostgreSQL 16.14 创建的一次性测试集群；浏览器联调使用本项目隔离开发库，未使用 Docker、未安装数据库、未复用 `ai-stocks` 数据库。
- 页面证据：见 `evidence/t1-t10-remediation/validation.md`。历史 360/390px 证据已丢失，因此本次没有把 534px 结果描述成 390px；完整 360/390px 逐页矩阵仍明确未执行并保留在 T25。

## 6. 最终验证结果

- 定向前端：草稿、权限路由和密码相关 11 项测试通过。
- 后端独立入口：`npm run check:server` 成功解析系统已有 Java 21.0.10；Maven verify 通过。
- 数据库定向：`npm run check:database` 使用系统 PostgreSQL 16.14，一次性集群的 30 项 HTTP 与 7 项 schema/migration/RLS/任务测试均 0 失败、0 跳过。
- 全量：`npm run check` 通过；前端 typecheck、lint、74 项单测、OpenAPI lint/生成漂移检查、生产构建通过；后端 Maven verify 共 56 项（无 JDBC 参数阶段 37 项按契约跳过），随后数据库阶段实际运行上述 30+7 项。
- 浏览器：已执行，详见证据记录；未执行 360/390px 完整逐页矩阵，原因是当前 CUA CSS 视口固定为 534×1804，本次只按实际视口报告，剩余矩阵仍归 T25。
