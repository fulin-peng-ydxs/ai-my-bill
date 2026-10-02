# 统一运维入口

## 定位与分层

`npm run ops -- ...` 面向已经完成首次初始化的目标，封装日常状态、健康、启停、日志、备份、异机复制、密钥托管和隔离恢复演练。它不替代 `environment` 的宿主/首次建设，也不替代 `release` 的代码与schema更新。

| 层次 | 位置 | 内容 |
|---|---|---|
| 通用入口 | `scripts/operations.sh` | 目标解析、确认、SSH、异机复制与本地校验 |
| 目标执行器 | `deploy/scripts/operate-service.sh` | Compose、systemd、HTTPS和隔离恢复动作 |
| 具体目标 | `.local/deploy-targets/<目标>.env` | 主机、路径、CA、备份服务及异机落点 |
| 实例证据 | `deployment/cases/*.md` | 实际执行时间、归档日期、结果与遗留风险 |

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

`logs` 只取 app/proxy/db 最近200行及备份/巡检最近100行，不输出完整容器环境；日志仍可能含业务错误上下文，按运维日志权限保管。多目标按 `targets.list` 或命令顺序串行，首个失败即停止。

## 备份、异机副本和密钥

```bash
npm run ops -- backup intranet-main
npm run ops -- backup-list intranet-main
npm run ops -- backup-pull intranet-main
npm run ops -- backup-verify intranet-main
npm run ops -- backup-key-status intranet-main
```

`backup` 先触发目标systemd备份服务并要求状态为 `SUCCEEDED`，随后自动拉取最新的CMS加密日归档和服务器生成的SHA-256文件；本地重新校验后才原子落入目标专属目录。指定历史日期可执行 `backup-pull <目标> YYYY-MM-DD`。同名完整副本只复核复用；不完整或冲突文件拒绝覆盖，也不自动删除异机历史副本。

异机目录由目标字段 `BILL_OFFSITE_BACKUP_DIRECTORY` 指定；旧目标留空时默认 `.local/offsite-backups/<目标>`。默认目录只是被Git忽略的本机落点，不自动等于组织级灾备；运维必须把它纳入独立磁盘、对象存储或备份平台的访问控制、容量、保留和恢复制度。

加密归档在整机丢失后只有配套私钥可用。`backup-key-status` 只检查服务器私钥权限并输出公钥证书指纹。首次环境建立后由获授权运维显式执行：

```bash
npm run ops -- backup-key-pull intranet-main
```

该动作通过已校验SSH一次性复制证书和解密私钥到 `BILL_OFFSITE_KEY_DIRECTORY`（旧目标默认 `.local/backup-keys/<目标>`），校验公私钥匹配、权限设为0600，并拒绝覆盖既有目录。这个目录是转存暂存点，不应与唯一归档副本共址；应继续进入组织密钥库或离线保管介质，登记指纹和恢复责任人。脚本不会上传密钥到第三方服务，也不会把密钥写入Git、日志或目标配置正文。

## 隔离恢复演练与生产恢复

```bash
npm run ops -- recovery-drill intranet-main 2026-10-02
```

该动作调用现有 `verify-backup-restore.sh`，在无宿主端口、无网络的临时 PostgreSQL 中验证checksum、解密、导入和重新导出；只清理本轮临时资源，不连接生产数据库。它需要服务器仍可访问归档和解密私钥，因此不能替代“用异机归档+托管私钥重建新主机”的灾难恢复演练。

生产覆盖恢复涉及恢复点选择、当前库/注销审计保全、写入阻断、数据库和文件一致性、schema兼容、业务抽样及入口切换，不能由一个无条件命令直接覆盖线上数据。完整受控流程见[备份与恢复](backup-recovery.md)；后续生产恢复编排必须保持预检、计划、确认、执行、验证和可追溯状态分离。

## 失败边界

- 任何SSH、systemd、Compose、HTTPS或checksum失败均返回非零；多目标不继续。
- 启停动作不执行 `down -v`、`docker system prune`、数据库删除或宿主重启。
- `backup-pull`只复制加密文件，不能证明可解密；密钥匹配与隔离恢复是独立门禁。
- `backup-key-pull`是敏感读操作，需要确认且拒绝覆盖；执行成功不代表外部密钥托管已经完成。
- 日常备份不是schema回退机制；发布更新仍由 `npm run release` 在维护窗口完成。
