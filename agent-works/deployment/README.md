# 部署文档导航

按操作目标选择下列入口；具体主机取值、版本及验证结果见部署案例。实例例外不推广为通用要求。

## 阅读顺序

| 阅读顺序 | 文档 | 内容 |
|---|---|---|
| 1 | [部署架构与模式](architecture.md) | 服务、网络、数据、资源、支持边界 |
| 2 | [环境配置架构](../architecture/environment-configuration.md) | 加载链路、变量表、secret 与生效方式 |
| 3 | [宿主环境准备](host-preparation.md) | 支持系统、软件源、只读检查、安装和安全边界 |
| 4 | [首次环境初始化自动化](environment-bootstrap.md) | 交互向导、通用入口、续跑、内网实现与公网预留 |
| 5 | [首次部署与运维手册](runbook.md) | 自动化步骤的事实依据、人工验收、起停、升级和回退 |
| 6 | [持续构建与发布](continuous-delivery.md) | CI、统一更新入口、目标配置、候选产物与失败边界 |
| 7 | [备份与恢复](backup-recovery.md) | 备份实施、隔离演练、真实恢复要求与缺口 |
| 8 | [统一运维入口](operations.md) | 状态、启停、日志、备份、异机复制、密钥托管与恢复演练 |
| 9 | [公网部署演进](public-deployment.md) | 直连/边缘模式、安全门禁、抽象层与落地顺序 |
| 10 | [部署案例](#部署案例) | 实例配置、制品、例外和验证结果 |

操作手册中的 `/opt/my-bill`、`/etc/my-bill`、`/var/backups/my-bill` 为现有脚本约定路径，不是任意占位符。IP、SSH 身份、存储容量、版本摘要和验收结果只能从目标案例取得。需要改路径/项目名时，必须同步脚本与 systemd，不能仅修改文档或 env。

宿主准备、首次初始化与持续更新都按“通用执行器 + profile + 具体目标”分层，共用严格目标解析器。`scripts/environment.sh` 准备宿主并建设空环境，`scripts/release.sh` 更新已有环境；具体机器放在本机 `.local/deploy-targets`，不进入Git。

证书入门先看[签发端与信任链](architecture.md#证书信任链与签发端职责)，新内网部署按[首次签发流程](runbook.md#32-在另一套独立内网首次部署)，客户端安装见[README](../../README.md#手机安装与使用)。实际终端和恢复验证按候选、环境分别核验，结果见案例。

## 部署实现

下列路径相对于仓库 `deploy/`；运维端入口位于仓库 `scripts/`。

| 文件/目录 | 职责 |
|---|---|
| compose.yaml | db、provision、migrate、app、网络、卷与 secret 分发 |
| compose.intranet.yaml、Caddyfile、Dockerfile.proxy | 内网 HTTPS、静态资源、反向代理与运行限额 |
| compose.bootstrap.yaml | 首次空账号库管理员初始化，完成后退出 |
| env/production.env.example | 非密钥配置示例；含实例值，使用前核对替换 |
| host-profiles/、scripts/prepare-host.sh、scripts/preflight-host.sh | 宿主变更策略、准备与首次只读准入 |
| scripts/bootstrap-environment.sh | 初始化、状态续跑、验证与初始密码收尾 |
| profiles/ | 部署模式契约；内网已实现，公网预留但拒绝执行 |
| [targets/](../../deploy/targets/README.md) | 通用目标字段；具体机器只在 `.local/deploy-targets` |
| scripts/run-*.sh、postgres/ | 应用、迁移、角色与管理员初始化入口 |
| tls/internal-ca.sh、tls/activate-certificate.sh | CA/叶证书签发；目标端校验、加载与失败回退 |
| scripts/backup-local.sh、scripts/verify-backup-restore.sh | 加密备份与基础隔离数据库恢复 |
| scripts/verify-recovery-tool.sh、scripts/verify-recovery-http.py | 注销审计重放、数据/文件恢复与业务入口验证 |
| scripts/check-operations.sh、systemd/ | 备份定时与容器、证书、磁盘、备份状态巡检 |
| scripts/operate-service.sh、../scripts/operations.sh | 目标执行器与统一运维入口 |
| Dockerfile.postgres | PostgreSQL 16.14 镜像与发行版补丁构建 |
| monitoring/ | 待实际接入验证的监控告警规则 |

## 部署案例

- [现有内网单机](cases/intranet-single-host/README.md)：IP + 项目 CA；最近版本、事实截止、例外与未验证项只在实例总览维护。

尚无公网案例；仅在真实实施后以稳定环境目录名登记，如 `cases/public-single-host/`，不将预想资源登记为已部署。实例总览须能定位主机与连接、端口与来源范围、资源及共存服务、路径/卷/网络、配置、凭据托管位置、证书、备份及 RPO/RTO。

变更同步实例当前事实并复核通用方案；方案只维护可复用操作。按 [AGENTS](../../AGENTS.md#代码与文档定位)，仅在用户明确要求时编写部署、升级或演练记录，保留方案/版本、授权、提交与制品摘要、步骤/差异、失败与重试、验收证据、未验证项及回退边界。历史证据保留日期与版本，不代替新候选验收；秘密只记受控位置和权限。
