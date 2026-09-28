# 备份、恢复与数据保留方案

## 范围与实现边界

按 deploy/scripts/backup-local.sh、verify-backup-restore.sh、systemd 配置于2026-09-28核对。当前实现单机加密副本与隔离恢复验证；不提供异机灾备、自动切换或完整生产恢复工具。具体频率/保留/目标及已执行结果在案例确认，现有脚本基线每日一次、7日/4周。

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

保留最近7个日历日和最近4个ISO周内的成功副本，各最多7/4个；不是“永远至少7份”。断电后 Persistent=true 补触发；失败仅有日志，当前无已验证消息告警。last-success 是最后成功记录，失败不会改成失败标记，必须同时检查新鲜度和服务结果；管理概况尚未接入该状态。

## 隔离恢复验证能证明什么

verify-backup-restore.sh 校验路径和checksum，在 --network none、无宿主端口、2GiB tmpfs、768MiB内存的临时PG中创建无登录引用角色，解密导入数据库后重新导出；结束只清理自身临时容器。其trust认证仅用于无网络临时实例，不得复用于生产。

该验证证明数据库归档可解析、对象和数据可读；不恢复导出文件、不保留生产所有者/权限（--no-owner/--no-privileges）、不验证应用登录/租户样本、不重放注销。数据超过tmpfs或资源限制时需另行规划隔离演练资源，不能调低校验掩盖失败。

## 真实业务恢复操作方案（尚未完整实施）

1. 确认事故范围、恢复点、允许数据损失和维护窗口，阻断新写入；保全现库和导出卷用于追查，不能先覆盖唯一副本。
2. **覆盖数据库前**，独立保全尚未过期的 account_deletion_audit。若现库损坏导致无法取得，必须从独立可靠来源恢复注销事实；当前没有这条完整实施链路，存在已注销用户数据复活风险。
3. 验证副本checksum、加密密钥和隔离恢复；准备匹配PG版本的替代库/卷。通过正确角色与Flyway构建授权，不把隔离脚本的无权限导入直接作为生产恢复。
4. 恢复数据库及同一副本导出文件，按应用版本升级schema；恢复导出目录属主10001。备份先dump后复制文件，无跨资源一致快照，需逐条核验导出记录与文件状态，缺失/过期文件收敛为不可下载并按业务流程重建。
5. 导入保全的匿名注销审计，以不可逆主体指纹匹配恢复的账号，重放删除在线数据、会话及文件，保留必要审计。此步骤脚本与演练尚未落地，不能跳过并宣称完成恢复。
6. 用至少两租户业务样本核验条数、金额、报表口径、下载、回收站、注销、权限和任务幂等，检查任务启动恢复；记录实际恢复时间，满足RTO后再放入口。
7. 新建备份、验证告警、记录案例的新恢复点与证据，保留事故原始副本到确认可清理。

以上是验收要求与实施顺序，不是已验证的一键生产恢复命令。尚缺注销审计保全/重放、完整数据/文件一致性恢复和RTO演练，属于当前阶段未完成项。

## 风险与后续模式

| 类型 | 已确认限制 | 对策 |
|---|---|---|
| 整机丢失 | 同机副本和解密密钥可能同时丢失 | 只有另行确认并实现异机副本/密钥托管后，才可承诺灾备 |
| 在线备份 | 数据库与导出非一致快照 | 恢复验证文件状态，重要维护采用受控写入/任务暂停方案 |
| 保留策略 | 7日/4周无法代替180天注销审计恢复策略 | 覆盖前独立保全未过期注销事实，恢复后重放 |
| 可观测性 | 只有本机日志/最后成功文件 | 接入实际告警与管理概况并演练失败、新鲜度过期 |
