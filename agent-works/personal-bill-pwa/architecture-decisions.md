# 个人账单 PWA 工程基线决策

## 1. 运行时与依赖基线

- 前端锁定 Node.js 24.11.1 与 npm 11.6.2，使用 Vue 3、Vite、TypeScript、Pinia、Vue Router、ECharts 和 Lucide Vue Next。依赖由 `web/package-lock.json` 固化，CI 使用 `npm ci`。
- 后端锁定 Java 21 LTS、Spring Boot 3.5.16 与 Maven Wrapper。选择仍受维护的 Spring Boot 3.x 基线，避免在首期业务开发前引入 Spring Framework 7 的迁移面。
- PostgreSQL 开发基线为 16 或更高受支持版本，生产镜像固定为 PostgreSQL 16.14。T2 已固化 Flyway 11.7.2、独立 bootstrap/迁移/应用角色、15 张租户表的强制 RLS 与生产应用只读版本门禁。

## 2. 应用与模块边界

- 采用单仓库、Vue 单页应用、Spring Boot 模块化单体和 PostgreSQL，同源接口前缀固定为 `/api/v1`。
- 后端领域包固定为 `auth`、`admin`、`dict`、`ledger`、`report`、`job`，公共契约位于 `shared`。跨领域写操作只经应用服务，查询只能消费明确的只读接口或投影。
- T1 只建立工程空壳；T2 已建立持久化结构、JPA 映射与数据库约束，但没有实现认证、业务 API 或页面。认证上下文从 T3 开始，字典与收支业务行为仍按后续任务落地。

## 3. HTTP 与数据契约

- API 事实源为 `contracts/openapi.yaml`，生成的 TypeScript 类型提交到仓库并由契约检查保证无漂移。
- 错误对象固定包含 `code`、`message`、`fieldErrors`、`traceId`、`retryable`。HTTP 状态表达协议结果，不使用 HTTP 200 包装业务失败。
- 用户名固定为 3–64 位可见 ASCII；备注去除首尾空白后最多 500 个 Unicode code point。
- 金额以十进制字符串传输，Java 使用 `BigDecimal`，PostgreSQL 使用 `numeric`。人民币金额上限为 `999,999,999.99`，通用金额最多两位小数。
- 业务时间使用带偏移的 ISO 8601 时间；服务端以接收时间为权威，并按 `Asia/Shanghai` 生成业务日期。

## 4. 前端页面登记与复用判断

- `web/src/app/pageRegistry.ts` 是页面元数据的代码事实源，字段固定为 `pageKey/path/role/navigation/archetype/prototype/states`。
- 路由从页面登记生成，契约测试双向比对 `DESIGN.md` 的 Page Registry，避免未登记受保护路由和孤立登记。
- T1 六页共用 `PlaceholderView`，因为当前差异仅是页面元数据和阶段说明；提前复制六个页面会制造无业务价值的结构分叉。正式业务组件在对应阶段按 DESIGN 组件清单落地。

## 5. 本地启动与持续集成

- `npm run dev` 使用仓库内 `.local/postgres` 数据目录启动隔离的本地 PostgreSQL，再并行启动后端和前端；脚本拒绝外部主机、非法连接参数、低于 16 的 PostgreSQL 以及被其他数据集群占用的端口，退出命令时仅停止本次启动的进程。
- 本地开发由 bootstrap 账号 `my_bill_dev` 只负责建库/建角，非超级迁移所有者 `my_bill_migration` 执行 Flyway，后端连接非超级用户 `my_bill_app`；生产内嵌 Flyway固定关闭，启动时只读核对 schema 版本 `007`。
- `npm run check:database` 使用系统已有 PostgreSQL 16+ 二进制创建一次性隔离集群，验证空库/重复迁移、回滚脚本、seed 不覆盖、复合归属、RLS、金额精度、分类层级、并发调整累计和模板 upsert，退出时只清理该临时集群。
- Compose 将长驻数据库、一次性角色 provision、一次性 migrate 和长驻 app 分开；数据库只挂 bootstrap secret，provision 短时挂三类 secret，migrate 只挂迁移 secret，app 只挂运行 secret。前端静态服务和反向代理仍属于 T29。
- CI 分别执行前端 typecheck、lint、unit、OpenAPI 校验/类型漂移检查与后端 Maven verify。
- 本地缺少目标工具链时立即失败并提示所需版本，不静默降级到 Node 18 或 Java 8。
