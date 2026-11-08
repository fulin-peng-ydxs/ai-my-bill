# 部署案例：现有内网单机

本目录按操作主题保存本环境的证据。下列当前状态依据 2026-10-19 持续发布实测，不代表此后持续在线监测；历史主题记录按各自版本和验证边界读取。

| 项目 | 最近已核实状态 / 事实来源 |
|---|---|
| 入口与连接 | HTTPS `10.100.101.104:18443`；CLI SSH root、端口22。连接文件、资源、证书及凭据托管位置见[既有实例资料](baseline.md#主机连接和资源) |
| 后端源码 | `d13d92617dceafc511690d871c9593359b612a86`，2026-10-19 11:04:44（Asia/Shanghai）发布；schema仍为12:012，数据库容器保持原实例。当前镜像/JAR/配置摘要在服务器current/deployment.properties |
| 前端 | 与后端为同一候选；MY_BILL_WEB_DIST=/opt/my-bill/current/web/dist，代理实际挂载本候选目录。经CA验证的HTTPS逐项核对13个静态文件摘要一致，/login正常 |
| 服务与日志 | app/db healthy、HTTPS UP；维护前备份成功。旧代理损坏日志以已停止容器的有界原始尾部保全后完成切换；此前归档失败触发的旧服务自动恢复已实测。当前发布日志见服务器logs目录 |
| 验收边界 | 本候选本地完整工程、一次性数据库、性能及5项浏览器E2E通过；生产匿名管理/会话接口401。用户明确允许本次先部署，实体iPhone Safari/PWA标为未验证；本次未做生产账号写入、隔离恢复及注销重放验收。历史iOS确认不替代本候选 |
| 风险与缺口 | CentOS7、数据库镜像既有内网例外见baseline；本候选spring-webmvc 6.2.19两项公告为用户明确接受的限定例外，非漏洞修复或零命中。容器OS漏洞本次未复扫。共存gxts_taskapi约48.4GiB日志经授权保留尾部后清空，当前磁盘约47GiB可用，但该服务仍无轮转 |

## 当前发布追溯与维护边界

- 发布由现有 `npm run release -- deploy intranet-main` 完成。源码快照在本机分支 `codex/intranet-release-20261019`，未推送；制品及实机日志在 `.local/releases/d13d92617dceafc511690d871c9593359b612a86/`，其中 `deployments/intranet-main.properties` 保存服务器版本元数据。运行env原值私有保存在 `/etc/my-bill/production.env.before-20261019T030315Z-d13d92617dce`，迁移后的回退仍须按手册判断。
- 本次批准仅覆盖该候选、intranet-main/10.100.101.104、`Maven:org.springframework:spring-webmvc:6.2.19` 的 `GHSA-j9f9-w8pj-32f8` 和 `GHSA-pc63-qcmh-9cmg`。审批文件绑定候选、有效期24小时并在发布后清理，构建记录标记 `accepted-candidate-risk`；后续候选不可沿用。当前未发现官方公告的SSE视图片段或XsltView触发配置，不能据此宣称漏洞修复。公告见[Spring SSE](https://spring.io/security/cve-2026-47890/)与[Spring XSLT](https://spring.io/security/cve-2026-47884/)。
- 维护前备份完成于2026-10-19 11:03:52（Asia/Shanghai）。本机运维入口已修复同日旧副本误复用，按服务器最新摘要拉取并保留旧副本到history；该收尾修改属于本机工具，不改变已发布业务版本。异机副本及历史保留规则见[统一运维入口](../../operations.md#备份异机副本和密钥)。
- 本次依赖构建复用了与锁文件逐项版本一致的本机依赖；全新npm安装未完成，不能算作全新环境安装验收。远端CI未运行，实测门禁均为本机执行。

## 操作记录

- [首次部署、补丁、恢复与既有维护](baseline.md)：2026-09-28 至 2026-10-02；包含主机、路径、CA、手机验收证据及历史制品，不作为当前后端版本依据。
- [统一日志应用](logging-management.md)：2026-10-06 至 2026-10-07；包含本次授权、失败与重试、实机制品、日志验收及未覆盖项。

日常操作按[统一运维入口](../../operations.md)执行，升级与回退按[操作手册](../../runbook.md)执行。后续变更更新本页必要的当前事实；仅在用户明确要求时新建对应主题记录，不向已归档记录追加另一项实施过程。
