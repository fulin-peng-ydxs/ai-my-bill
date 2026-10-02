# 部署目标配置

仓库中的 `example.env` 只定义配置契约，不对应真实机器。具体服务器配置放在被Git忽略的 `.local/deploy-targets/<目标>.env`。优先通过 `npm run environment -- configure <目标>` 交互生成；也可复制示例后修改。不要把密码、运行环境变量、证书私钥正文或CA私钥写入其中。

目标文件使用严格的 `KEY=value` 格式：不支持 `export`、引号、变量展开或命令替换。初始化和发布入口共用白名单解析器，不会 `source` 文件。

字段分为六组：SSH连接与严格known_hosts；宿主profile、软件源、时区和防火墙责任；服务器发布根、运行配置、CA、备份和Compose路径；异机加密副本与解密材料的本地落点；初始化所需的部署profile、绑定IP/端口、允许CIDR和TLS来源；本机初始管理员凭据输出位置。`BILL_IDENTITY_FILE` 可留空使用既有SSH身份。服务器运行参数和secret由 `BILL_ENV_FILE` 指向的目标机文件管理，目标文件只保存路径。TLS叶私钥可作为本机受控来源路径保存，但正文和CA私钥不得写入目标文件或仓库。

宿主字段的抽象语义如下：

| 字段 | 允许值 | 作用 |
|---|---|---|
| `BILL_HOST_PROFILE` | `managed-linux` / `existing-linux` | 前者允许安装缺失组件，后者只检查；旧目标缺失时默认只读 |
| `BILL_HOST_PACKAGE_SOURCE` | `preconfigured` / `docker-official` | 使用已有组织源，或由脚本配置Docker官方稳定源 |
| `BILL_HOST_TIMEZONE` | IANA时区，当前向导写 `Asia/Shanghai` | systemd timer和宿主时间基线 |
| `BILL_HOST_FIREWALL_MODE` | 当前仅 `external` | 明确防火墙由组织/云平台管理，脚本不接管全局规则 |

宿主准备要求root SSH，不隐式调用sudo。`managed-linux`不会升级已经可用的Docker，也不会自动删除冲突软件包；完整边界见[宿主环境准备](../../agent-works/deployment/host-preparation.md)。

`BILL_BACKUP_SERVICE` 与 `BILL_BACKUP_STATUS_FILE` 在首次初始化时由环境入口建立并验证；持续更新只调用并核对。当前只有 `intranet-single-host` 可执行；公网profile保留字段契约但会被入口拒绝。

`BILL_OFFSITE_BACKUP_DIRECTORY` 和 `BILL_OFFSITE_KEY_DIRECTORY` 必须是构建/运维端绝对路径，不是服务器路径。前者保存已加密归档，后者仅作为一次性解密材料转存点；两者不应共址。旧目标缺失字段时，`ops` 分别使用仓库下被忽略的 `.local/offsite-backups/<目标>` 与 `.local/backup-keys/<目标>`，但这不自动满足组织级异机灾备或密钥托管要求。

需要 `--all` 时，创建 `.local/deploy-targets/targets.list`，每行一个目标 ID，顺序就是更新顺序。多目标串行执行；任一目标失败后停止，不继续扩大影响面。
