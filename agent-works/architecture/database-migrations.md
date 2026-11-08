# 数据库、SQL 与迁移架构

## 范围与事实源

面向数据库与后端开发，覆盖 PostgreSQL、MyBatis XML、Flyway 和数据库角色。当前 db/migration、deploy/postgres 和应用配置的预期版本为 `012`。表结构以迁移文件为准，不从实体猜表，也不维护第二份可执行 DDL。

| 数据组 | 代表表 | 所有权与消费者 |
|---|---|---|
| 身份 | tenant、app_user、user_session、auth_rate_limit | 认证与管理，服务端构建身份 |
| 字典 | default_dictionary_item、expense_category、product、unit、各渠道/标签/收入字典 | 全局默认与个人副本分离；商品合并 product_merge_event 留痕 |
| 账目 | ledger_entry、expense_adjustment、daily_entry_template | 普通用户租户资产；字典引用与历史快照并存 |
| 支持 | user_preference、idempotency_record、export_job、job_run | 偏好、幂等、文件任务与协调；按表定义明确租户或全局范围 |
| 审计 | admin_audit_log、account_deletion_job、account_deletion_audit | 管理审计追加写；注销匿名审计 180 天 |
| 备份占位 | backup_run | 该表当前未接入宿主调度；概况从只读 backup.properties 获取状态，不以该表记录作为备份事实 |

## SQL 分层与角色

| 源码/数据 | 执行者与用途 |
|---|---|
| `server/src/main/resources/mapper/**/*.xml` | MyBatis 运行 SQL，Java 通过 Mapper 调用；MybatisOperations 封装公共行读取，不开放 Spring JDBC/JPA |
| `server/src/main/resources/db/migration/V*.sql` | Flyway 按版本改变表、索引、约束与 RLS；不是每次请求执行的 SQL |
| `deploy/postgres/001_roles.sql` | provision 收敛数据库角色及授权，不混入运行 Mapper |
| `server/src/main/resources/db/rollback/U*.sql` | 受控测试/评估材料，不自动生产降级；删表/字段须独立决策和备份 |
| PostgreSQL 数据卷 | 实际账目；容器可重建，删卷后迁移只能恢复结构及明确的 seed，不能恢复业务数据 |

修改查询通常不新增迁移；新增字段或索引需要新版本迁移。

| 角色 | 用途 | 生命周期/禁止事项 |
|---|---|---|
| my_bill_admin | 初次数据库、角色 provision；现有备份从 db 内 socket 导出 | 管理凭据不授予 app；备份实现目前并未使用专门备份登录角色 |
| my_bill_migration | schema 所有者、Flyway | NOSUPERUSER/NOBYPASSRLS；迁移容器执行后退出 |
| my_bill_app | 运行 DML | 非 schema owner、非超级用户、不绕过 RLS，不执行 DDL |
| my_bill_backup | 角色预留 | NOLOGIN；不能把它写成已启用备份账号 |

V007 对租户表 FORCE ROW LEVEL SECURITY；V010 增加商品合并表策略。租户上下文与业务 SQL 同事务，关联约束保证租户归属。admin_audit_log 对运行角色不授 UPDATE/DELETE。

## 迁移和发布流程

空库 → 角色 provision 收敛权限 → Flyway V001–V012 按序校验/执行 → 退出迁移进程 → prod SchemaVersionGuard 只读确认 `012` → app 接受流量。开发默认内嵌 Flyway 使用独立迁移账号，生产 application-prod.yml 关闭内嵌 Flyway。

新增 schema 版本同步 expected-version、Mapper/实体/契约和集成测试，已部署迁移不得修改校验和。`deploy/postgres/rollback` 的删角色脚本只适用于确认无对象与会话的空环境；生产优先 forward-fix。

失败时先记录 Flyway 版本/校验错误、比对源码和实际 schema；不直接 repair 或删历史记录绕过。旧开发库与当前 V012 校验和存在差异时可另建验证空库，保留原库后单独分析，不能为启动演示清空用户数据。

数据库事务保证一组修改同时成功或回滚；RLS上下文必须在该事务内设置才不会在连接池中跨请求残留。文件系统不属于数据库事务，所以导出/注销要额外采用临时文件、原子移动与补偿；不能仅加@Transactional就认为文件和数据库同时回滚。

## seed 与恢复演练数据

生产默认项由 `V006__confirmed_default_seed.sql` 按稳定键幂等写入；不把原型演示字典或恢复样本作为生产 seed。恢复演练不扩展生产角色或 RLS 授权。

`server/src/test/resources/recovery/recovery-business-fixture.sql` 是三租户、各10000条支出和导出任务的合成样本，仅由隔离演练消费。它要求专用库名、空账目和显式会话确认，公开测试密码不得用于真实账号；退出销毁临时库，不提供生产执行或回滚入口。

## 性能、测试与影响

V005 等迁移维护查询和生命周期索引；列表限制分页，导出用游标，清理分批。修改 JOIN/过滤/排序要检查同租户谓词、索引计划及锁范围。数据库变更影响业务、任务和恢复，不能只验证 Java 编译。

数据库验证在一次性集群先跑 HTTP 集成，再重建 schema 跑迁移/RLS/任务/回滚，不依赖 Docker/Testcontainers；命令与当前性能样本见[开发验证规范](../testing/guide.md)。

## 风险与恢复边界

| 类型 | 证据状态 | 风险与要求 |
|---|---|---|
| 迁移兼容 | 已确认 | 应用要求准确 schema 版本；回退旧镜像不保证兼容已升级数据库 |
| 数据恢复 | 已实现并有界验证 | RecoveryAuditRunner保全/重放匿名审计；隔离恢复工具覆盖数据、文件与恢复后业务。真实操作仍需人工保全及切换，见[恢复方案](../deployment/backup-recovery.md) |
| 迁移漂移 | 已确认校验机制 | checksum 不一致时保持原库，使用独立空库定位，修复必须先比较实际结构与迁移历史 |
