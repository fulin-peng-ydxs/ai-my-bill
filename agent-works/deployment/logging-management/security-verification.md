# 统一日志管理：发布安全验证

记录范围：2026-10-06 本次日志候选的依赖处置与风险批准；目标机镜像扫描和实际发布见[内网日志应用记录](../cases/intranet-single-host/logging-management.md)。

## 发布前复扫

本次日志发布前扫描发现新的依赖命中。Jackson同兼容分支更新为2.21.7，构建插件databind/core显式对齐，OSV插件坐标覆盖同步；source-map-js固定1.2.2并更新锁文件；版本与integrity已比对官方HTTPS npm元数据一致。完整工程检查（含隔离PG集成）通过，复扫仅剩Spring MVC `GHSA-pc63-qcmh-9cmg`，当前安全门禁仍失败。

[Spring官方公告](https://spring.io/security/cve-2026-47884/)要求XsltView、隐式视图名与通配映射组合；项目静态核查仅有REST控制器，未发现该配置。6.2.20仅商业支持，公开修复为7.0.9；未擅自迁移框架或添加忽略项，不将历史零命中作为当前发布安全通过。

用户随后明确接受仅本次内网候选的Spring公告风险例外。通过私有 `MY_BILL_SECURITY_EXCEPTION_FILE` 审批记录指定精确依赖/公告、完整HEAD、目标与主机、批准时间和不超过7天的有效期；默认无记录仍拒绝，制品标记 `accepted-candidate-risk` 并绑定审批摘要，部署只允许本次目标且重新检查有效性。定向测试覆盖默认拒绝、合法例外、其他公告、错误提交/目标/主机/版本及过期拒绝。例外通过不记为零漏洞；具体环境与授权见[内网日志应用记录](../cases/intranet-single-host/logging-management.md)。
