# 部署目标配置

仓库中的 `example.env` 只定义配置契约，不对应真实机器。具体服务器配置放在被Git忽略的 `.local/deploy-targets/<目标>.env`。优先通过 `npm run environment -- configure <目标>` 交互生成；也可复制示例后修改。不要把密码、运行环境变量、证书私钥正文或CA私钥写入其中。

目标文件使用严格的 `KEY=value` 格式：不支持 `export`、引号、变量展开或命令替换。初始化和发布入口共用白名单解析器，不会 `source` 文件。

字段分为四组：SSH连接与严格known_hosts；服务器发布根、运行配置、CA、备份和Compose路径；初始化所需的profile、绑定IP/端口、允许CIDR、TLS来源；本机初始管理员凭据输出位置。`BILL_IDENTITY_FILE` 可留空使用既有SSH身份。服务器运行参数和secret由 `BILL_ENV_FILE` 指向的目标机文件管理，目标文件只保存路径。TLS叶私钥可作为本机受控来源路径保存，但正文和CA私钥不得写入目标文件或仓库。

`BILL_BACKUP_SERVICE` 与 `BILL_BACKUP_STATUS_FILE` 在首次初始化时由环境入口建立并验证；持续更新只调用并核对。当前只有 `intranet-single-host` 可执行；公网profile保留字段契约但会被入口拒绝。

需要 `--all` 时，创建 `.local/deploy-targets/targets.list`，每行一个目标 ID，顺序就是更新顺序。多目标串行执行；任一目标失败后停止，不继续扩大影响面。
