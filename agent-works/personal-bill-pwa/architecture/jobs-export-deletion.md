# 后台任务、导出与账号注销架构

## 范围与组成

面向后端与运维，覆盖 job、ledger 导出/清理和 account 注销；2026-09-28 静态核对。任务协调在单体内运行，数据库是执行状态事实源，文件位于独立导出目录。

```mermaid
flowchart LR
  Request[导出或生命周期请求] --> Coordinator[JobCoordinator]
  Coordinator --> State[(job_run)]
  State --> Poller[JobPoller 原子领取]
  Poller --> Definition[JobDefinition 有界批次]
  Definition --> Tenant[租户事务与幂等]
  Tenant --> Data[(业务数据)]
  Definition --> Files[临时文件至原子发布]
```

## 任务生命周期与失败路径

JobDefinition 声明类型、租户/全局作用域、是否可取消/重试、最大尝试次数；JobDefinitionRegistry 统一注册。job_run 非空 batch key 去重，`available_at` 到期后用 `FOR UPDATE SKIP LOCKED` 原子领取。默认租约 30 秒；长批次通过独立事务续租，不能被业务长事务遮蔽。

领取前处理过期租约：允许重试且未耗尽次数回到 PENDING，否则 FAILED。JobPoller 默认一轮最多 20 个任务，按任务类型轮转，配置限制 1–100；业务实现分批幂等。租户任务每批设置 RLS；全局任务不能读取租户账目。bootstrap/recovery profile 不运行轮询器。

## 业务任务与宿主定时任务的区别

job_run是应用内业务任务队列，JobPoller在Java进程内轮询；导出、回收站清理和注销审计清理通过该机制执行。宿主systemd备份不经过job_run，也不会由JobPoller唤醒；两者的记录、权限、失败日志和运维入口不同。

| 情况 | 业务任务会怎样 | 应检查什么 |
|---|---|---|
| 用户提交导出 | 创建导出记录并排队，稍后由app领取 | export_job与job_run状态、app日志 |
| app停止 | 无执行器处理新任务 | 容器/Java状态；不能只看队列表存在 |
| 处理耗时过长 | 租约需要续期，丢失租约应停止该次执行 | 批次耗时、lease_owner/lease_expires_at |
| 进程中断后重启 | 根据过期租约与剩余次数重试或失败 | 幂等键、尝试次数、是否有残留临时文件 |
| 用户取消 | 提交取消意图，执行器合作式停止并清理 | 是否已经进入终态、文件是否补偿删除 |

租约相当于“某个执行器在限定时间内拥有处理权”，不是永久锁；幂等是重复执行仍不制造重复结果。二者都需要，不能用无限重试代替数据一致性。

## 导出闭环

普通用户选择当前筛选或完整数据 → ExportService 创建同租户 export_job 与后台任务 → PersonalExportJob 用 MyBatis Cursor、fetch size 200 流式读账目 → ExportCsvWriter 输出 UTF-8 BOM、引号转义、公式防护、上海时间 → 同租户临时文件原子替换 → 成功后可下载。

下载重新验证账号、租户、任务状态和期限，API 不暴露服务器路径。运行中取消需处理终态提交竞态并补偿删除已发布文件；到期由 ExpiredExportPurgeJob 删除文件并收敛状态。默认保留 24h，目录必须位于持久卷，配置见环境文档。前端终态后再导出须更换幂等键。

## 回收站与注销闭环

ExpiredLedgerPurgeJob 按租户与到期分钟合并调度，每批最多 100 条，执行 30 天回收站清理。注销由 AccountDeletionService 锁用户、校验本人确认文本或管理端版本，写匿名审计并删除租户在线数据、撤销会话。

个人导出先在受控根目录原子移到隔离名，数据库回滚恢复，提交后物理删除。AccountDeletionFileStartupRecovery 启动时根据仍存在的导出记录恢复或清除隔离文件，收敛进程中断的半状态。匿名审计不保存用户名、用户/租户 ID 或账目，仅匿名编号、执行元数据和不可逆主体指纹，保留 180 天后任务清理。

在线注销补偿与旧备份恢复重放是两个入口，均复用注销服务的数据/文件补偿逻辑。离线入口为 `run-app --recovery-tool`，由 `RecoveryAuditRunner` 执行，不开放管理 API。

1. `preserve` 分页导出当前未过期匿名审计，使用 CREATE_NEW 拒绝覆盖，写格式头与完成条数标记。
2. 恢复旧数据库和导出文件到独立恢复环境；将保全文件作为只读输入挂载。
3. `replay` 先校验专用库名前缀 `my_bill_restore_` 与实时数据库指纹，完整校验64MiB以内的审计文件，再收敛文件补偿、跳过过期审计、按匿名指纹查找恢复出的账号并重放注销。
4. 重复重放必须幂等；恢复后启动普通应用，验证认证、账目/报表、下载及跨租户拒绝，再按运维流程切换入口。

恢复模式禁用周期轮询/启动任务恢复，工具结束关闭上下文；失败返回非零，不能放行入口。配置见[环境架构](environment-configuration.md#离线恢复工具配置)，操作与隔离演练见[恢复方案](../deployment/backup-recovery.md)。

## 使用与开发接入

接口由 [OpenAPI](../../../contracts/openapi.yaml) 的 exports、ledger lifecycle、me/admin users 定义；任务没有独立公共消息入口。新增后台能力实现 JobDefinition、明确作用域、失败重试与批次幂等、注册后补 JobCoordinator 和真实数据库测试；禁止新增无限队列或无限批次。

任务变更影响 job_run、租户事务、资源限额与轮询延迟；导出格式变更影响下载、公式防护、前端进度及备份；注销变更影响审计、所有租户资产和备份恢复政策。

## 验证与风险

JobCoordinatorTest、PersonalExportJobTest、ExportFileStoreTest、ExportHttpIntegrationTest、AccountDeletionHttpIntegrationTest 和 PostgresSchemaIntegrationTest 覆盖协调、文件、HTTP、补偿与 RLS；由 check:server/check:database 按类型执行。性能数据见 [性能记录](../performance-test.md)。

| 类型 | 证据状态 | 限制与处理 |
|---|---|---|
| 恢复合规 | 已实现并有界验证 | 离线审计保全/恢复库指纹门禁/幂等重放复用注销服务；目标机三万条合成账目与文件演练通过，隔离入口切换及恢复后HTTP业务已验证；真实生产入口未切换，其他规模不作承诺 |
| 文件容量 | 已确认 | 导出卷和备份占用随数据增长，需容量告警；不能只看数据库大小 |
| 备份一致性 | 已确认实现边界 | 当前先 dump 后复制导出，无跨资源快照；业务恢复须核对缺失/过期文件，维护窗口暂停写入与任务 |
