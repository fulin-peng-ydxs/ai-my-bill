# T27 安全与权限专项验证

## 结论

T27 本地可验证范围通过。认证、角色、租户、数据库、输入输出、下载、缓存、客户端存储、日志与依赖链未发现未解释的严重项；发现的测试工具链已知漏洞已全部修复并重新扫描。T27 未进入 T28，也未把 T29 的 TLS、入口静态资源 CSP、容器 secret 或生产日志证据记为已完成。

## 验证范围与结果

| 边界 | 证据 | 结论 |
| --- | --- | --- |
| 认证与默认拒绝 | `AuthHttpIntegrationTest` 覆盖匿名会话 401、缺失/错误 CSRF 403、未知 API 匿名 401/登录用户 403、Cookie `HttpOnly`/`SameSite=Lax`、临时密码、账号停用/过期、会话过期/注销/改密撤销；用户名与直连来源双维限流拒绝轮换用户名和伪造转发头绕过 | 通过 |
| 角色矩阵 | 普通用户访问 `/api/v1/admin/**` 为 403；管理员访问普通用户偏好为 403；管理员指标可访问但普通用户/匿名拒绝 | 通过 |
| 租户与数据库 | 一次性 PostgreSQL 16.14 以真实 `my_bill_app` 运行；16 张租户表 FORCE RLS，运行/迁移角色均无 superuser、createdb、createrole、inherit、bypassrls；缺少、非法、切换及回滚后的租户上下文均 fail-closed；复合外键拒绝跨租户引用 | 通过 |
| 后台任务上下文 | `JobCoordinatorTest` 与数据库任务测试覆盖 TENANT/GLOBAL scope 不匹配、租约、并发领取、取消和恢复；租户任务只能在租户事务中执行 | 通过 |
| 业务对象与下载 | 字典、模板、收支、调整、生命周期、报表、导出与注销集成测试覆盖跨租户 ID/引用不可见；下载在认证租户和本人归属内校验，路径不出接口 | 通过 |
| 输入输出与 XSS/CSV | 前端源码无 `v-html`、`innerHTML`、`document.write`、`eval` 或 `new Function`；Vue 文本插值默认转义，ECharts tooltip 实现对名称/value 进行 `encodeHTML`；CSV 单元/集成测试覆盖 RFC 4180 与公式前缀防护 | 通过 |
| 安全响应头与缓存 | API 精确断言 CSP `default-src 'none'`、`no-referrer`、最小 Permissions Policy、`nosniff`、`X-Frame-Options: DENY`、`Cache-Control: no-store`；Service Worker 只缓存同源带 hash 静态资源，API 与下载 network-only | 通过 |
| 共享设备存储 | 单元测试覆盖不可逆账号命名空间、禁止枚举、跨账号不可读、最小字段白名单、16 KiB、7 天 TTL、版本/时间异常精确清理、账号切换清内存、注销清理已知账号键 | 通过 |
| 日志与错误 | 全局异常日志只记录 traceId、方法、路径和异常类型；认证/幂等指标不含用户名、租户、账目文本或金额；审计摘要 sanitizer 及管理接口负向字段断言通过；API 不返回堆栈、凭据或租户标识 | 通过 |
| secret 与依赖 | `npm run check:security` 扫描当前工作区、未跟踪待提交文件和完整 Git 历史中的高置信 token/private key/敏感文件名；对 npm 锁文件、Maven compile/runtime/provided/test 依赖及本项目 `verify/package` 实际使用的 Maven 插件链提交 OSV 查询，网络失败即失败 | 360 个去重依赖零命中 |

## 本阶段修复

1. 补齐 API CSP、Referrer Policy 和 Permissions Policy，并把既有 `nosniff`、拒绝 framing 与 `no-store` 纳入真实 HTTP 断言。
2. 补齐登录用户访问未知 API、普通用户访问管理端、管理员访问用户端的角色反向断言；增加用户名与直连来源双维 HMAC 限流，默认不信任 `X-Forwarded-For`。
3. 建立可重复的 secret/Git 历史/OSV 门禁。扫描扩大到 npm 开发依赖后初次发现 9 个漏洞记录：`@faker-js/faker`、OpenTelemetry 两项、Vitest/mocker、`js-yaml` 与 `undici` 三项；升级 `@redocly/cli`、Vite、Vue 插件、Vitest，并约束 `js-yaml >= 4.3.2`。整体自审继续把 Maven 构建插件链纳入后，又发现 11 个漏洞记录；资源、编译、测试、打包和 Enforcer 插件已固定到当前稳定版，Spring Boot 3.5.16 及插件仍未升级的传递项通过插件级依赖收敛到已修复版本。最终扫描全部清零。
4. 将离线弱密码拒绝表固定到 SecLists commit `c5a05259b61cc60dee828ad1bf92c288c7e97ea0`，按正式 15-64 字符规则派生、去重并随包保留 MIT 许可证；新增来源词条的拒绝测试。
5. 工具链升级后按项目 nvm Node 24 重新执行类型检查、Lint、131 项测试、OpenAPI lint/生成漂移检查和生产构建，未以系统默认 Node 代替项目工具链。

## 执行记录

- `npm run check:security`：通过；当前工作区与 Git 历史 secret/敏感文件无命中，OSV 360 个依赖无命中。
- `npm run check:server`：通过；127 项中 32 项本地测试实际运行，95 项需一次性 PostgreSQL/性能开关的用例按契约跳过。
- `npm run check:database`：通过；一次性 PostgreSQL 16.14 中 87 项 HTTP/业务集成测试与 7 项 schema/migration/RLS/任务测试均 0 失败、0 跳过，测试结束后集群和角色已销毁。
- `bash scripts/run-frontend.sh check`：通过；42 个文件 131 项测试、类型检查、Lint、OpenAPI lint/生成漂移检查和 Vite 生产构建通过。

## 未执行与环境边界

- 未做浏览器截图/交互：本阶段没有页面、路由、视觉或交互改动；Service Worker、存储与权限由单元/接口测试覆盖，既有跨视口页面证据在 T25。未使用用户个人浏览器。
- 未验证目标入口静态资源的最终 CSP、HSTS/TLS 与反向代理头：`deploy/Caddyfile` 按计划属于 T29；本阶段只验证后端 API 响应头，不用本地 Vite 冒充公网入口。应用当前只信任直连地址，T29 必须在 app 不对公网暴露的前提下配置并验证代理覆盖的精确来源头，否则来源限流会把代理视为一个总量主体（安全但粒度较粗）。
- 未运行容器 secret 挂载隔离、生产日志采集、目标主机/移动设备与真实备份恢复：这些都需要 T29 目标环境和已确认生产参数。

## 整体自审

第三方视角复核了 T1-T27 的认证、授权、租户隔离、复合归属、数据一致性、异常默认拒绝、性能边界、缓存、客户端存储、日志和供应链。新增安全头不改变业务 API 合同；依赖升级后的完整工程检查通过；扫描脚本对当前文件只报告文件名、对历史命中不输出内容，且任何扫描不可用都会失败。自审修复了 Maven classifier 坐标解析、Git 历史管道提前退出风险，并补扫实际执行的 Maven 插件链；插件显式覆盖同时由 POM 声明检查、OSV 和真实 Maven 构建三重验证。没有新增生产 SQL、migration、seed、菜单、动态权限、页面或部署拓扑，也没有进入 T28。当前剩余项均是文档明确归属 T29 的目标环境证据，不影响 T27 本地验收结论。

## 2026-09-30 持续构建复验

T30 首次通过统一入口构建时，OSV 门禁发现 Jackson 新公告并正确停止候选生成。进一步复核确认 Maven 4 的 `dependency:list` 会在 scope 后追加 `-- module ...`，旧解析器因此漏掉带 JPMS 描述的运行/测试依赖；现已先剥离展示后缀再解析坐标。完整扫描随即发现 Jackson、Log4j API、Tomcat Embed 和 PostgreSQL JDBC 新公告，均在 Spring Boot 3.5 兼容分支升级到无命中补丁版本。复扫覆盖 464 个 npm、Maven运行/测试与实际构建插件去重依赖，OSV 零命中；`npm run check` 通过。历史 T27/T28 的 360/363 结果保留为当时证据，不回写成后续已执行。

## 2026-10-06 发布前复扫

本次日志发布前扫描发现新的依赖命中。Jackson同兼容分支更新为2.21.7，构建插件databind/core显式对齐，OSV插件坐标覆盖同步；source-map-js固定1.2.2并更新锁文件；版本与integrity已比对官方HTTPS npm元数据一致。完整工程检查（含隔离PG集成）通过，复扫仅剩Spring MVC `GHSA-pc63-qcmh-9cmg`，当前安全门禁仍失败。

[Spring官方公告](https://spring.io/security/cve-2026-47884/)要求XsltView、隐式视图名与通配映射组合；项目静态核查仅有REST控制器，未发现该配置。6.2.20仅商业支持，公开修复为7.0.9；未擅自迁移框架或添加忽略项，不将历史零命中作为当前发布安全通过。

用户随后明确接受仅本次内网候选的Spring公告风险例外。通过私有 `MY_BILL_SECURITY_EXCEPTION_FILE` 审批记录指定精确依赖/公告、完整HEAD、目标与主机、批准时间和不超过7天的有效期；默认无记录仍拒绝，制品标记 `accepted-candidate-risk` 并绑定审批摘要，部署只允许本次目标且重新检查有效性。定向测试覆盖默认拒绝、合法例外、其他公告、错误提交/目标/主机/版本及过期拒绝。例外通过不记为零漏洞；具体环境与授权见内网案例。
