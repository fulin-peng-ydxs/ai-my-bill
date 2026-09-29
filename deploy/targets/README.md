# 持续更新目标配置

仓库中的 `example.env` 只定义配置契约，不对应真实机器。具体服务器配置放在被 Git 忽略的 `.local/deploy-targets/<目标>.env`；复制示例后修改，不要把密码、运行环境变量、证书私钥或 CA 私钥写入其中。

目标文件使用严格的 `KEY=value` 格式：不支持 `export`、引号、变量展开或命令替换。发布入口按允许字段解析，不会 `source` 文件。`BILL_IDENTITY_FILE` 可以留空，此时使用已加载的 SSH agent/默认身份；`BILL_KNOWN_HOSTS_FILE` 必须是已通过可信渠道核对的主机记录。服务器运行参数和 secret 继续由 `BILL_ENV_FILE` 指向的目标机文件管理。`BILL_BACKUP_SERVICE` 与 `BILL_BACKUP_STATUS_FILE` 必须指向环境搭建阶段已经配置好的备份单元和状态文件；持续更新只调用并验证，不负责创建它们。

需要 `--all` 时，创建 `.local/deploy-targets/targets.list`，每行一个目标 ID，顺序就是更新顺序。多目标串行执行；任一目标失败后停止，不继续扩大影响面。
