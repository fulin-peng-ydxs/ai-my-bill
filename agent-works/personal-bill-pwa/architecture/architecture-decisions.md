# 个人账单 PWA 工程基线决策

## 1. 运行时与依赖基线

- 前端锁定 Node.js 24.11.1 与 npm 11.6.2，使用 Vue 3、Vite、TypeScript、Pinia、Vue Router、ECharts 和 Lucide Vue Next。依赖由 `web/package-lock.json` 固化，CI 使用 `npm ci`。
- 后端锁定 Java 21 LTS、Spring Boot 3.5.16 与 Maven Wrapper。选择仍受维护的 Spring Boot 3.x 基线，避免在首期业务开发前引入 Spring Framework 7 的迁移面。
- PostgreSQL 开发基线为 16 或更高受支持版本，生产镜像固定为 PostgreSQL 16.14。当前已固化 Flyway 11.7.2、独立 bootstrap/迁移/应用角色、16 张租户表的强制 RLS 与生产应用只读版本门禁；预期 schema 版本为 `011`。`job_run` 支持有限重试、租约、合作式取消、批次幂等和到时可领取，商品具备显式排序、合并留痕和默认字典规范化约束。

## 2. 应用与模块边界

- 采用单仓库、Vue 单页应用、Spring Boot 模块化单体和 PostgreSQL，同源接口前缀固定为 `/api/v1`。
- 当前后端领域包为 `auth`、`admin`、`dictionary`、`preference`、`job`、`ledger`，公共持久化映射位于 `persistence`，公共契约位于 `shared`；后续报表阶段新增 `report`。跨领域写操作只经应用服务，查询只能消费明确的只读接口或投影。
- T1-T10 已建立工程、安全、应用外壳、共享组件、管理员与字典治理、偏好和账号隔离草稿；T11-T16 已实现收支填报、日常模板、统一明细、编辑及退款/报销。T17 在统一明细中接入有效/回收站互斥数据集、账目与调整软删/恢复/永久清理，并注册首个具体租户后台任务处理 30 天到期数据。导出、注销、报表、运行概况和审计查询仍未实施；注销 API 与页面动作在 T19 的数据保留与清理策略确认前均不登记。

## 3. HTTP 与数据契约

- API 事实源为 `contracts/openapi.yaml`，生成的 TypeScript 类型提交到仓库并由契约检查保证无漂移。
- 错误对象固定包含 `code`、`message`、`fieldErrors`、`traceId`、`retryable`。HTTP 状态表达协议结果，不使用 HTTP 200 包装业务失败。
- 用户名固定为 3–64 位可见 ASCII；备注去除首尾空白后最多 500 个 Unicode code point。
- 金额以十进制字符串传输，Java 使用 `BigDecimal`，PostgreSQL 使用 `numeric`。人民币金额上限为 `999,999,999.99`，通用金额最多两位小数。
- 业务时间使用带偏移的 ISO 8601 时间；服务端以接收时间为权威，并按 `Asia/Shanghai` 生成业务日期。
- 支出创建必须携带 1-128 字符幂等键；请求摘要使用规范化后的十进制值，相同键与等价内容返回既有结果，不同内容冲突。撤销刚保存支出必须回传同一幂等键，只能删除对应且尚无调整或模板关联的记录。

## 4. 前端页面登记与复用判断

- `web/src/app/pageRegistry.ts` 是页面元数据的代码事实源，字段固定为 `pageKey/path/role/navigation/archetype/prototype/states`。
- 路由从页面登记生成，契约测试双向比对 `DESIGN.md` 的 Page Registry，避免未登记受保护路由和孤立登记。
- T1 六页共用 `PlaceholderView`，因为当前差异仅是页面元数据和阶段说明；提前复制六个页面会制造无业务价值的结构分叉。正式业务组件在对应阶段按 DESIGN 组件清单落地。

## 5. 本地启动与持续集成

- `npm run dev` 使用仓库内 `.local/postgres` 数据目录启动隔离的本地 PostgreSQL，再并行启动后端和前端；脚本拒绝外部主机、非法连接参数、低于 16 的 PostgreSQL 以及被其他数据集群占用的端口，退出命令时仅停止本次启动的进程。
- 本地开发由 bootstrap 账号 `my_bill_dev` 只负责建库/建角，非超级迁移所有者 `my_bill_migration` 执行 Flyway，后端连接非超级用户 `my_bill_app`；生产内嵌 Flyway 固定关闭，启动时只读核对 schema 版本 `011`。
- `npm run check:database` 使用系统已有 PostgreSQL 16+ 可执行程序创建一次性隔离集群，不连接本项目开发库、`ai-stocks` 或其他项目数据库，也不探测/依赖 Docker 或 Testcontainers。同一临时集群先运行认证、管理、字典、偏好、收支、明细、调整和回收站 HTTP 集成测试，再重建空 schema 运行 migration、RLS、任务和回滚测试；退出时只清理 `mktemp` 生成的该集群。
- Compose 将长驻数据库、一次性角色 provision、一次性 migrate 和长驻 app 分开；数据库只挂 bootstrap secret，provision 短时挂三类 secret，migrate 只挂迁移 secret，app 只挂运行 secret。前端静态服务和反向代理仍属于 T29。
- CI 分别执行前端 typecheck、lint、unit、OpenAPI 校验/类型漂移检查与后端 Maven verify；本地单独验证后端统一使用 `npm run check:server` 解析系统已有 Java 21。
- 本地缺少目标工具链时立即失败并提示所需版本，不静默降级到 Node 18 或 Java 8。

## 6. 认证、会话与租户上下文

- Spring Security 采用无服务器 HTTP session 的 Cookie 认证链：只显式放行 `GET /api/v1/health` 与 `POST /api/v1/auth/login`，未登记 `/api/v1/**` 默认拒绝。临时密码会话只能读取当前会话、退出和设置首次正式密码。
- 密码使用 BCrypt（生产 strength 12）；正式密码要求 15-64 Unicode code point，并在服务端用 NFKC+小写归一后查离线拒绝表。校验不向任何外部密码服务发送候选值。
- 会话令牌由 32 字节 `SecureRandom` 生成，浏览器仅以 `HttpOnly`/`SameSite=Lax` Cookie 保存，生产额外强制 `Secure`，数据库仅保存 SHA-256 摘要。改密通过凭据版本乐观冲突保护，并撤销该账号全部旧会话后签发新会话。
- 变更请求采用同源 XSRF Cookie/Header 校验。登录限流在 PostgreSQL 中持久化，主体使用服务端 pepper 的 HMAC-SHA256 摘要；生产 pepper 仅通过 app 专用 secret 文件提供，不写入非密钥 env 模板、日志或数据库。
- `CurrentPrincipal` 仅由服务端会话查询构建，对外 DTO 不返回租户 ID 或令牌。`TenantTransactionExecutor` 仅接受有租户的普通用户，并在与业务 SQL 同一事务内使用 `set_config('app.tenant_id', ..., true)`；上下文缺失、设置失败或事务回滚均默认拒绝。
- 前端身份状态只存在于一个 Pinia session store，统一 API 客户端负责 Cookie、CSRF、`no-store` 与标准错误解析。T4 在此基础上接入正式登录、退出后 CSRF 刷新、安全回跳、角色外壳与导航；主题和安装分别由唯一 Pinia store 供登录页与“我的”复用。

## 7. 审计与后台任务边界

- 管理审计只能通过 `AdminAuditService` 追加：策略显式声明稳定动作、对象类型和最多 32 个顶层白名单字段，仅保存真正变化的 before/after；嵌套密码、令牌、凭据、会话、精确地址和坐标递归剔除，并限制摘要深度、集合规模和文本长度。运行角色对 `admin_audit_log` 没有 `UPDATE/DELETE` 权限。
- 具体业务的成功审计应加入同一业务事务；拒绝或失败结果在业务回滚后调用同一入口独立落库。T6 不开放审计查询 HTTP API，管理员只读筛选与详情属于 T24。
- 后台任务实现 `JobDefinition`，必须声明租户/全局作用域、可取消、可重试和最大尝试次数，并以幂等、有界小批次执行。租户任务每批通过共享 `TenantDatabaseExecutor` 在独立事务设置 RLS 上下文；全局任务不得读取租户业务数据。
- `job_run` 是任务协调事实源：非空批次键幂等，任务只在 `available_at` 到达后由 `FOR UPDATE SKIP LOCKED` 原子领取，默认 30 秒有限租约；长批次主动续租使用独立新事务立即提交，不能被业务批次长事务遮蔽。每次领取前收敛过期租约，未耗尽且允许重试则回到 `PENDING`，否则进入 `FAILED`。T17 启用轻量轮询器并注册 `PURGE_EXPIRED_LEDGER`：每个租户每批最多处理 100 条，到期原账目先删除关联调整再删除来源，重复执行无数据副作用；不引入 Redis、消息队列或独立任务服务。

## 8. PWA 与主题边界

- Service Worker 只缓存带内容哈希的同源静态资源和无个人数据离线页；API、下载、个性化导航和非哈希资源始终直连网络。所有 `/api/v1/**` 响应统一 `Cache-Control: no-store`，离线不承诺提交或展示账目数据。
- 首屏内联脚本只恢复合法的本地 `system/light/dark` 安全值并同步 `theme-color`，运行时由唯一主题 store 接管。登录后的服务端偏好权威、失败回退和跨设备恢复由 T10 偏好接口闭环，不在 T4 伪造服务端保存。
- T4 使用明确标记的临时 SVG 安装图标；正式品牌图标、启动图、目标移动浏览器系统安装框和独立窗口验收保留到 T29。
