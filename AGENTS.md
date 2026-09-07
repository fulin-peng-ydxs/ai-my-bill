# 我的账单项目协作约束

## 事实源与阶段边界

- 业务事实源为 `agent-works/personal-bill-pwa/requirement.md`，上游闭环为同目录 `requirement-closure.md`。
- 设计事实源为 `DESIGN.md`；新增或修改页面时必须同步检查页面登记、组件清单和响应式契约。
- 开发顺序、依赖与状态以 `agent-works/personal-bill-pwa/plan.md` 为准。一次只实施一个任务阶段，验证通过、更新计划实际落地情况并完成本地 Git 提交后，才能进入下一阶段。
- 第一阶段不引入 Redis、消息队列、微服务、地图服务、账户余额或转账能力。

## 工程基线

- 前端使用 Node.js 24 LTS、Vue 3、Vite、TypeScript、Pinia 与 Vue Router；页面不得复制共享状态、交互或样式能力。
- 后端使用 Java 21 LTS、Spring Boot 模块化单体、MyBatis-Plus 与 Maven Wrapper；生产 SQL 只能位于 `server/src/main/resources/mapper/**/*.xml`，Java 通过 Mapper 方法访问数据库，禁止直接使用 Spring JDBC 或 JPA；跨领域修改通过应用服务或只读查询接口完成。
- 浏览器只通过同源 `/api/v1` 访问服务端；身份和租户只能来自服务端认证上下文。
- 时间统一使用 `Asia/Shanghai`，金额与数量使用十进制精确类型，禁止用二进制浮点处理业务金额。
- API 错误统一为 `code`、`message`、`fieldErrors`、`traceId`、`retryable`；不得返回堆栈、凭据或租户标识。

## 常用验证

- 全量工程基线：`npm run check`
- 前端开发：`npm --prefix web run dev`
- 前端检查：`npm --prefix web run check`
- 后端检查：`npm run check:server`（通过项目脚本解析 Java 21，不依赖当前 shell 的默认 Java）
- 数据库迁移与隔离：`npm run check:database`（复用系统 PostgreSQL 16+ 可执行程序创建并销毁一次性测试集群）
- 本地联调：`npm run dev`

任何代码改动完成后，先做定向验证，再从第三方视角自审业务边界、复用、权限、安全、性能和相关事实文档是否同步。
