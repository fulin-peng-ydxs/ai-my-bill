# 部署实现入口

部署方案与实例分开维护：

- [部署导航与模式](../agent-works/deployment/README.md)
- [宿主环境准备](../agent-works/deployment/host-preparation.md)
- [首次环境初始化自动化](../agent-works/deployment/environment-bootstrap.md)
- [首次部署、升级和运维手册](../agent-works/deployment/runbook.md)
- [持续构建与发布链路](../agent-works/deployment/continuous-delivery.md)
- [备份恢复方案与验证边界](../agent-works/deployment/backup-recovery.md)
- [统一运维、异机备份与恢复演练](../agent-works/deployment/operations.md)
- [公网部署演进与实现门禁](../agent-works/deployment/public-deployment.md)
- [环境变量与配置加载](../agent-works/architecture/environment-configuration.md)
- [当前内网部署案例](../agent-works/deployment/cases/intranet-single-host/README.md)

## 实现目录

| 文件/目录 | 职责 |
|---|---|
| compose.yaml | db、provision、migrate、app、网络、卷与secret分发 |
| compose.intranet.yaml、Caddyfile、Dockerfile.proxy | 内网HTTPS入口、静态资源、反向代理与运行限额 |
| compose.bootstrap.yaml | 首次空账号库管理员初始化，完成后退出 |
| env/production.env.example | 非密钥配置示例；含当前实例取值，使用前按案例核对替换 |
| scripts/preflight-host.sh | 首次目标主机只读准入检查 |
| scripts/bootstrap-environment.sh | 目标端首次初始化、状态续跑、验证与初始密码收尾 |
| profiles/ | 部署模式能力契约；当前内网已实现，公网模式明确预留但拒绝执行 |
| targets/ | 通用目标字段契约；具体机器配置只在本机 `.local/deploy-targets` |
| scripts/run-*.sh、postgres/ | 应用/迁移/角色/管理员初始化入口 |
| tls/internal-ca.sh、activate-certificate.sh | 签发端建立CA/签发IP叶证书；目标端校验、加载及失败回退 |
| scripts/backup-local.sh、verify-backup-restore.sh | 同机加密备份、基础隔离数据库恢复检查 |
| scripts/verify-recovery-tool.sh、verify-recovery-http.py | 注销审计保全/重放、隔离样本恢复与应用/入口验证 |
| scripts/check-operations.sh、systemd/ | 备份定时、容器/证书/磁盘/备份状态本机巡检 |
| scripts/operate-service.sh、../scripts/operations.sh | 目标端日常动作与构建端统一运维入口 |
| Dockerfile.postgres | 固定PostgreSQL16.14，构建安装发行版补丁的数据库镜像 |
| monitoring/ | 待实际接入验证的监控告警规则 |

当前内网实例已按本次范围完成T29，证据汇总见[验收报告](../agent-works/initial-development/test-report.md)。具体地址、例外、凭据位置、镜像摘要和验证结果只维护在案例中；不能把方案命令当作已执行证据。
