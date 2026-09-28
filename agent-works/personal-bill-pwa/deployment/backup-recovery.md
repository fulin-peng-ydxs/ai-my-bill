# 备份、恢复与数据保留方案

## 范围与实现边界

按 deploy/scripts/backup-local.sh、verify-backup-restore.sh、systemd 配置于2026-09-28核对。当前实现单机加密副本与隔离恢复验证；不提供异机灾备或自动切换；离线注销审计工具已实现，完整生产恢复仍需业务/文件一致性和目标机 RTO 验收。具体频率/保留/目标及已执行结果在案例确认，现有脚本基线每日一次、7日/4周。

数据库管理员在 db 容器内经本地 socket 执行 pg_dump -Fc → 验证目录 → 从 app 容器复制 exports → manifest记录时间及镜像 → tar流经OpenSSL CMS AES256/RSA加密 → 全量解密列目录核验 → 原子放入daily并算SHA256 → 每周最新副本硬链接 → 轮转 → last-success。flock防并发重复执行，失败写系统日志并清理本次明文临时目录。

## 一次性准备

以下命令仅在已授权目标主机 root、目录与密钥不存在时执行。密钥不可重复生成覆盖，否则旧副本无法解密。

```bash
umask 077
install -d -m 0700 /var/backups/my-bill
# 先确认以下两个文件均不存在；存在则复用受控密钥，不执行生成。
test ! -e /etc/my-bill/backup-encryption.key
test ! -e /etc/my-bill/backup-encryption.crt
openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 \
  -subj '/CN=my-bill-backup' \
  -keyout /etc/my-bill/backup-encryption.key \
  -out /etc/my-bill/backup-encryption.crt
chmod 0600 /etc/my-bill/backup-encryption.key /etc/my-bill/backup-encryption.crt
```

这套证书用于备份加密，独立于 HTTPS CA，不能发给客户端当根信任。真实执行应在 set -e shell 中进行，前置检查失败即停。

脚本固定容器名 my-bill-db-1/my-bill-app-1/my-bill-proxy-1、库my_bill和目录；改项目名、库名或路径须同步脚本和验证，不能只改 env。宿主需要 `python` 命令与 date 的ISO周格式能力，备份目录、解密密钥和Docker访问仅root。

## 执行、校验与调度

在目标 current 目录执行：

```bash
bash deploy/scripts/backup-local.sh
cat /var/backups/my-bill/last-success
# 指定刚生成且核对日期的副本，不使用未经确认的任意路径。
bash deploy/scripts/verify-backup-restore.sh /var/backups/my-bill/daily/YYYY-MM-DD.cms
install -m 0644 deploy/systemd/my-bill-backup.service /etc/systemd/system/my-bill-backup.service
install -m 0644 deploy/systemd/my-bill-backup.timer /etc/systemd/system/my-bill-backup.timer
systemctl daemon-reload
systemctl enable --now my-bill-backup.timer
systemctl start my-bill-backup.service
systemctl status my-bill-backup.timer --no-pager
journalctl -u my-bill-backup.service -n 50 --no-pager
```

先核对宿主时区 Asia/Shanghai；OnCalendar 用宿主本地时间，脚本里的 TZ 只影响归档日期，不能替代 timer 时区。其他业务依赖宿主时区时，不擅自全局修改，应为定时配置设计独立时区方案并验证。

保留最近7个日历日和最近4个ISO周内的成功副本，各最多7/4个；不是“永远至少7份”。断电后 Persistent=true 补触发；失败仅有日志，通过本机 journald/systemd 告警，外部消息渠道未配置。last-success 是最后成功记录，失败不会改成失败标记，必须同时检查新鲜度和服务结果；管理概况通过独立只读状态目录接入最近尝试结果与成功时间；应用不访问备份归档或密钥。

## 隔离恢复验证能证明什么

verify-backup-restore.sh 校验路径和checksum，在 --network none、无宿主端口、2GiB tmpfs、768MiB内存的临时PG中创建无登录引用角色，解密导入数据库后重新导出；结束只清理自身临时容器。其trust认证仅用于无网络临时实例，不得复用于生产。

该验证证明数据库归档可解析、对象和数据可读；不恢复导出文件、不保留生产所有者/权限（--no-owner/--no-privileges）、不验证应用登录/租户样本、不重放注销。数据超过tmpfs或资源限制时需另行规划隔离演练资源，不能调低校验掩盖失败。

## 真实业务恢复操作方案（尚未完整实施）

1. 确认事故范围、恢复点、允许数据损失和维护窗口，阻断新写入；保全现库和导出卷用于追查，不能先覆盖唯一副本。
2. **覆盖数据库前**，独立保全尚未过期的 account_deletion_audit。若现库损坏导致无法取得，必须从独立可靠来源恢复注销事实；使用下述离线工具；若没有可靠的最新审计来源，仍存在已注销用户数据复活风险，禁止开放恢复库。
3. 验证副本checksum、加密密钥和隔离恢复；准备匹配PG版本的替代库/卷。通过正确角色与Flyway构建授权，不把隔离脚本的无权限导入直接作为生产恢复。
4. 恢复数据库及同一副本导出文件，按应用版本升级schema；恢复导出目录属主10001。备份先dump后复制文件，无跨资源一致快照，需逐条核验导出记录与文件状态，缺失/过期文件收敛为不可下载并按业务流程重建。
5. 导入保全的匿名注销审计，以不可逆主体指纹匹配恢复的账号，重放删除在线数据、会话及文件，保留必要审计。使用下述维护工具；本地隔离演练已有证据，目标恢复库必须单独验证。
6. 用至少两租户业务样本核验条数、金额、报表口径、下载、回收站、注销、权限和任务幂等，检查任务启动恢复；记录实际恢复时间，满足RTO后再放入口。
7. 新建备份、验证告警、记录案例的新恢复点与证据，保留事故原始副本到确认可清理。

以上是验收要求与实施顺序，不是已验证的一键生产恢复命令。尚缺目标环境完整数据/文件一致性恢复和RTO验收，属于当前阶段未完成项。

## 风险与后续模式

| 类型 | 已确认限制 | 对策 |
|---|---|---|
| 整机丢失 | 同机副本和解密密钥可能同时丢失 | 只有另行确认并实现异机副本/密钥托管后，才可承诺灾备 |
| 在线备份 | 数据库与导出非一致快照 | 恢复验证文件状态，重要维护采用受控写入/任务暂停方案 |
| 保留策略 | 7日/4周无法代替180天注销审计恢复策略 | 覆盖前独立保全未过期注销事实，恢复后重放 |
| 可观测性 | 本机日志、巡检单元和管理概况；无外部通知 | 每 15 分钟检查服务、磁盘、证书及备份新鲜度；告警需运维查看 |

## 状态与本机告警部署

以 root 创建 `/var/lib/my-bill/operations`（0755，root 所有），由备份脚本原子发布 0644 的 `backup.properties`。应用仅只读挂载这个目录。首次接入先成功运行一次备份，再重建 app 容器。管理页成功只代表归档校验，不能替代完整恢复演练。

将 `deploy/systemd/my-bill-monitor.service` 和 `.timer` 安装到 `/etc/systemd/system/` 后执行 `systemctl daemon-reload`、`systemctl enable --now my-bill-monitor.timer`、`systemctl start my-bill-monitor.service`。用 `journalctl -u my-bill-monitor.service` 和 `journalctl -t my-bill-monitor` 查看检查与告警；非零退出令巡检单元标为失败，后续成功检查恢复。每 15 分钟检查容器、备份文件系统 85% 水位、叶证书 30 天到期阈值和备份 26 小时新鲜度。该巡检不读取个人账目，也不自动重启服务或删除数据。

## 注销审计离线维护工具

`run-app --recovery-tool` 为一次性 Java 维护模式，绑定回环随机端口并在完成后退出，禁用后台轮询、任务启动恢复和文件启动恢复，不增加 HTTP 接口。SQL 位于 `RecoveryAuditMapper.xml`，删除重放复用原注销应用服务与文件提交补偿。

1. 进入维护窗口并停止 app，阻断所有用户、管理员和后台写入，再从尚可读取的当前库执行 `MY_BILL_RECOVERY_ACTION=preserve`。用相同 app 镜像、数据库网络和 app secret，设置 `MY_BILL_RECOVERY_AUDIT_FILE` 为 UID10001 可写受控目录内的**新文件**，以 `/usr/local/bin/run-app --recovery-tool` 启动。不要向工具授予迁移或管理员数据库凭据。保全按 100 条游标分页导出未过期成功审计，只保存匿名指纹及审计字段；首尾标记用于拒绝截断文件，不提供密码学防篡改。立即把文件放入受控加密归档并保存校验值。
2. 将备份恢复到以 `my_bill_restore_` 开头的专用恢复库与独立导出卷。保持标准数据库角色、迁移授权、RLS 和原导出根路径；不要直接把 `--no-privileges` 的临时恢复结果视为生产就绪。
3. 使用该库实时 `current_database|inet_server_addr|inet_server_port|pg_postmaster_start_time` 指纹，设置 `MY_BILL_RECOVERY_EXPECTED_DB_FINGERPRINT`、`MY_BILL_RECOVERY_ACTION=replay` 和只读审计文件路径。工具先校验专用库名、指纹、格式、64MiB上限和结束计数，再导入未过期审计，按指纹匹配普通用户并重放租户数据与导出文件清理。已有审计不覆盖、重复执行不重复删除，也不延长原保留期。每次重放先收敛上次中断的文件隔离状态，避免账号已删但隔离文件残留。
4. 验证未注销租户及管理员不受影响、已注销账号与导出不可恢复、金额/报表口径和完整文件恢复通过后，才考虑受控切换。工具不能绕过生产库名门禁直接对线上库执行重放。

保全要求维护窗口内没有并发注销；如果当前库已损坏且没有独立可靠审计副本，应停止恢复开放流程，不能从旧备份推断之后无人注销。当前工具不承诺覆盖此类整机/数据源损失。审计文件不得由普通用户提供；文件校验和、私密传输与加密存储由维护流程保证。工具完成不等于业务 RTO 已达标，实测记录归部署案例。

### 命令与本地隔离验证

开发机执行 `bash scripts/test-recovery.sh`。脚本先编译测试后端，再创建一次性 PostgreSQL 集群，运行真实 HTTP/业务样本，保全审计、全库导出、恢复至 `my_bill_restore_drill` 并核对非空账目条数及十进制金额。恢复副本加入旧快照中已注销账号与导出文件的合成情景，再执行 CLI 重放两次，断言只减少该账号、文件消失、其余账目条数与金额不变。退出销毁集群，不读取生产连接。它不能替代目标机全量业务恢复或 RTO 证明。

离线容器命令形式如下；占位值必须按已隔离的恢复环境填写，不能复制线上网络、数据库 URL 或导出卷作为 replay 目标：

```bash
docker run --rm --network RECOVERY_INTERNAL_NETWORK --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 1g --cpus 1 \
  -e MY_BILL_APP_DB_URL=jdbc:postgresql://RECOVERY_DB:5432/my_bill_restore_CASE \
  -e MY_BILL_APP_DB_USERNAME=my_bill_app \
  -e MY_BILL_RECOVERY_ACTION=replay \
  -e MY_BILL_RECOVERY_AUDIT_FILE=/recovery/audit.jsonl \
  -e MY_BILL_RECOVERY_EXPECTED_DB_FINGERPRINT='经独立查询并确认的实时指纹' \
  -v /受控目录/app_db_password:/run/secrets/app_db_password:ro \
  -v /受控目录/auth_rate_limit_pepper:/run/secrets/auth_rate_limit_pepper:ro \
  -v /受控目录/audit.jsonl:/recovery/audit.jsonl:ro \
  -v RECOVERY_EXPORT_VOLUME:/var/lib/my-bill/exports \
  已验证包含恢复工具的应用镜像 --recovery-tool
```

`preserve` 使用 `MY_BILL_RECOVERY_ACTION=preserve`、当前库的应用 URL 和 secret、可写保全目录，省略预期指纹；必须先停止写入端，且输出文件不得已存在。`replay` 的实时指纹查询与 `RecoveryAuditMapper.xml` 的 `fingerprint` 保持完全一致，用应用角色、同一连接地址从恢复库取得；数据库重启后须重新核对。容器不发布端口、不挂 Docker socket、不挂线上导出卷、不持有管理员或迁移凭据。失败退出后保留审计源与恢复副本，修复失败原因并重新执行；只有业务核验通过后才制定切换步骤。
