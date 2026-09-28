# 部署实现入口

部署方案与实例分开维护：

- [部署导航与模式](../agent-works/personal-bill-pwa/deployment/README.md)
- [首次部署、升级和运维手册](../agent-works/personal-bill-pwa/deployment/runbook.md)
- [持续构建与发布链路](../agent-works/personal-bill-pwa/deployment/continuous-delivery.md)
- [备份恢复方案与当前缺口](../agent-works/personal-bill-pwa/deployment/backup-recovery.md)
- [环境变量与配置加载](../agent-works/personal-bill-pwa/architecture/environment-configuration.md)
- [当前内网部署案例](../agent-works/personal-bill-pwa/deployment/cases/intranet-single-host.md)

## 实现目录

| 文件/目录 | 职责 |
|---|---|
| compose.yaml | db、provision、migrate、app、网络、卷与secret分发 |
| compose.intranet.yaml、Caddyfile、Dockerfile.proxy | 内网HTTPS入口、静态资源、反向代理与运行限额 |
| compose.bootstrap.yaml | 首次空账号库管理员初始化，完成后退出 |
| env/production.env.example | 非密钥配置示例；含当前实例取值，使用前按案例核对替换 |
| scripts/preflight-host.sh | 首次目标主机只读准入检查 |
| scripts/run-*.sh、postgres/ | 应用/迁移/角色/管理员初始化入口 |
| tls/internal-ca.sh | 内部CA与IP叶证书签发 |
| scripts/backup-local.sh、verify-backup-restore.sh、systemd/ | 同机加密备份、隔离数据库恢复检查与定时 |
| monitoring/ | 待实际接入验证的监控告警规则 |

当前基础内网实例可运行，T29仍未最终验收。具体地址、例外、凭据位置、镜像摘要和验证结果只维护在案例中；不能把方案命令当作已执行证据。
