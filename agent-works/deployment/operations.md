# 统一运维入口

## 定位与分层

`npm run ops -- ...` 面向已经完成首次初始化的目标，封装日常状态、健康、启停、日志、备份、异机复制、密钥托管和隔离恢复演练。它不替代 `environment` 的宿主/首次建设，也不替代 `release` 的代码与schema更新。

`scripts/operations.sh` 负责目标解析、确认、SSH、异机复制与本地校验；`deploy/scripts/operate-service.sh` 执行目标端 Compose、systemd、HTTPS 和隔离恢复动作。机器取值见[部署目标配置](../../deploy/targets/README.md)，结果见[部署案例](README.md#部署案例)。

目标执行器的只读动作以完整 `bash -c` 传输，避免 Docker Compose 消费SSH标准输入；会改变服务或启动演练的动作先上传到目标 `/tmp`，执行后无论成功失败均尝试清理。所有SSH连接沿用严格 `known_hosts` 和批处理认证。

## 日常操作

```bash
npm run ops -- status intranet-main
npm run ops -- health intranet-main
npm run ops -- logs intranet-main
npm run ops -- stop intranet-main
npm run ops -- start intranet-main
npm run ops -- restart intranet-main
```

`status` 汇总当前提交、Compose状态、备份/巡检timer和最近备份状态；`health` 额外使用目标CA验证HTTPS健康接口。`stop` 只停止外部入口和应用，保留数据库运行；`start/restart` 等待应用健康后才启动代理并验证HTTPS。改变服务状态的动作要求交互确认，自动化调用必须显式 `--yes`。

`logs` 默认查询最近 1 小时、app/proxy/db 每服务最多 200 行以及备份/巡检最多 200 行，不输出完整容器环境。时间窗口允许 `s/m/h/d`，最多 30 天；行数 1–10000。多目标串行，首个失败即停止。

```bash
npm run ops -- logs intranet-main --service app --since 30m --tail 200
npm run ops -- logs intranet-main --service app --trace-id <错误响应中的traceId>
npm run ops -- logs intranet-main --service app --follow
npm run ops -- logs-export intranet-main --service app --since 2h
```

服务可选 `app/proxy/db/provision/migrate/bootstrap-admin/system`；跟随只支持一个目标的一个服务，Ctrl+C 仅退出查询；follow使用SSH远端PTY绑定查询生命周期，连接退出会结束远端查看进程。traceId 仅按所查询输出匹配，未找到会提示可能超过保留窗口，不意味着请求不存在。一次性 `--rm` 容器删除后不能通过当前日志查询恢复；它们的过程输出须在发布/初始化流程保存。

`logs-export` 默认每服务最多 10000 行，gzip 保存到本机 `.local/logs/operations/<目标>/diagnostic.*.log.gz`，目录 0700、文件 0600；失败删除本次临时文件。保留期/容量沿用[日志配置](../architecture/environment-configuration.md#日志配置)中的 BILL_LOG_ARCHIVE_DAYS/TOTAL_MB，导出前后清理，活动导出限制100MB。导出只含当前保留窗口的诊断材料，仅运维人员持有和分享。

Java 日志格式、脱敏及采集边界见日志配置。Caddy 访问日志写 stdout，经 JSON 过滤去掉 URI（含查询）、请求/响应头、客户端 IP 和 TLS 客户端信息，保留方法、状态、耗时及服务端 traceId；健康访问跳过。

## 发布快照与历史诊断

持续发布在关闭旧入口/应用后、执行迁移和重建前，保存 app/proxy/db 当前仍能读取的最近24小时、每容器最多10000行及容器/镜像/创建时间信息。失败则阻止迁移并按原有流程恢复旧容器。Docker 已淘汰的内容不会进入快照，数据库在快照后仍运行，因此快照不是完整停机边界。

`apply-release` 和首次初始化/续跑/最终清理保存完整过程输出（含一次性迁移/初始化容器）；失败同样 gzip 落盘并记录退出码，沿用原有迁移后不自动回滚的边界。发布和初始化共享 flock，避免同目标并行切换。记录目录默认 `<发布根>/logs`，由专用标记登记，0700；文件0600。BILL_LOG_ARCHIVE_DIRECTORY可覆盖为非顶层、无符号链接的专用绝对目录，拒绝接管非空未登记目录。

```bash
npm run ops -- logs intranet-main --archive latest --tail 200
npm run ops -- logs intranet-main --archive <实际归档文件名> --trace-id <traceId> --tail 10000
npm run ops -- logs-export intranet-main --archive latest
```

归档查询按整份记录读取后限制行数，不使用 `--since` 筛选归档内部事件，也不接受 `--service/--follow`；入口明确标记当前容器与历史归档来源。`latest` 指最近生成的有效归档。归档最多14天/500MB，时间或容量先达到则淘汰；创建记录/导出时执行清理，闲置期间不承诺到点即时删除。只处理登记目录中精确命名的普通文件，不递归、不清理其他资料；已退出写入进程留下的临时记录在下一次清理回收。活动过程原文最多100MB，压缩期间另有临时占用；容量上限是已完成归档预算，不是整个文件系统硬配额。写入失败或超过活动文件限制会令操作失败，应结合服务/迁移状态判断，不能仅据命令失败推断所有变更已回滚。

生产容器日志策略只在重建时生效，发布入口不自动重建db；db日志参数或轮转配置变更需另行安排数据库维护窗口。PostgreSQL关闭SQL/参数及错误DETAIL/HINT/CONTEXT输出，保留主要运维消息；主要错误消息仍可能由数据库组件包含输入，应按私有诊断材料管理。业务审计继续遵循数据库审计保留规则，不受运行日志清理影响。

## 备份、异机副本和密钥

```bash
npm run ops -- backup intranet-main
npm run ops -- backup-list intranet-main
npm run ops -- backup-pull intranet-main
npm run ops -- backup-verify intranet-main
npm run ops -- backup-key-status intranet-main
```

`backup` 先触发目标systemd备份服务并要求状态为 `SUCCEEDED`，随后自动拉取最新的CMS加密日归档和服务器生成的SHA-256文件；本地在临时目录重新校验后才移入目标专属目录。指定历史日期可执行 `backup-pull <目标> YYYY-MM-DD`。同名完整副本先与服务器最新摘要比较，一致才复核复用；同日服务器归档更新时，先下载并校验新副本，再把旧副本保留到 `history/<日期>/<旧SHA256>/` 后更新daily。不完整或历史冲突文件拒绝覆盖；拉取期间服务器摘要变化会停止并保留旧副本，也不自动删除异机历史副本。

异机落点由 `BILL_OFFSITE_BACKUP_DIRECTORY` 指定，默认值和路径限制见部署目标配置。运维须将该落点纳入独立磁盘、对象存储或备份平台的访问控制、容量、保留和恢复制度，本机默认目录不自动等于组织级灾备。

加密归档在整机丢失后只有配套私钥可用。`backup-key-status` 只检查服务器私钥权限并输出公钥证书指纹。首次环境建立后由获授权运维显式执行：

```bash
npm run ops -- backup-key-pull intranet-main
```

该动作通过已校验 SSH 一次性复制证书和解密私钥到 `BILL_OFFSITE_KEY_DIRECTORY`，校验匹配、设为0600并拒绝覆盖既有目录。此处是转存暂存点，须与唯一归档副本分开，继续进入组织密钥库或离线介质，登记指纹和恢复责任人；脚本不向第三方上传密钥，也不写入 Git、日志或目标配置正文。

在全新替代主机需要使用托管材料时，可执行 `backup-key-restore <目标>`。入口先在本地复核公私钥匹配，并用最新已校验异机归档完成一次流式解密/目录校验，再经严格SSH上传；只有目标 `/etc/my-bill/backup-encryption.key/.crt` 均不存在时才安装，绝不轮换或覆盖已有恢复密钥。该动作需要显式确认，执行后用 `backup-key-status` 对照原登记指纹。

## 隔离恢复演练与生产恢复

```bash
npm run ops -- recovery-drill intranet-main 2026-10-02
npm run ops -- offsite-recovery-drill intranet-main 2026-10-02
```

`recovery-drill` 要求服务器归档和解密私钥仍可用，调用 `verify-backup-restore.sh` 在无网络、无宿主端口的临时 PG 验证，不连接生产库，仅清理本轮资源。覆盖和资源上限见[隔离恢复验证](backup-recovery.md#隔离恢复验证能证明什么)；该动作不证明整机丢失后的新主机重建。

`offsite-recovery-drill` 从 `BILL_OFFSITE_BACKUP_DIRECTORY` 重新校验指定归档，上传到目标专用0700暂存目录，使用目标已恢复/已存在的解密材料执行同一隔离恢复，随后清理暂存文件。它覆盖“服务器本地副本不可依赖、从异机副本重新进入恢复链路”的关键一段；仍不恢复线上导出卷、不切换生产入口。

生产覆盖恢复涉及恢复点选择、当前库/注销审计保全、写入阻断、数据库和文件一致性、schema兼容、业务抽样及入口切换，不能由一个无条件命令直接覆盖线上数据。完整受控流程见[备份与恢复](backup-recovery.md)；后续生产恢复编排必须保持预检、计划、确认、执行、验证和可追溯状态分离。

## 失败边界

- 任何SSH、systemd、Compose、HTTPS或checksum失败均返回非零；多目标不继续。
- 启停动作不执行 `down -v`、`docker system prune`、数据库删除或宿主重启。
- `backup-pull`只复制加密文件，不能证明可解密；密钥匹配与隔离恢复是独立门禁。
- `backup-key-pull`是敏感读操作，需要确认且拒绝覆盖；执行成功不代表外部密钥托管已经完成。
- `backup-key-restore`只面向新主机或密钥确已不存在的受控恢复，不是日常轮换入口；发现任一同名目标文件即停止。
- 日常备份不是schema回退机制；发布更新仍由 `npm run release` 在维护窗口完成。
