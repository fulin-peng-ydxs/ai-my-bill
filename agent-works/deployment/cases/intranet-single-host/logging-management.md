# 内网单机：统一日志应用记录

记录范围：2026-10-06 至 2026-10-07，仅覆盖本次日志应用。案例当前状态见[总览](README.md)，开发阶段与发布安全验证见[日志专项](../../logging-management/README.md)。

## 2026-10-06 日志配置应用

用户要求应用已完成的统一日志方案。写操作前实测原版本仍为4f0af93，app/db unhealthy，HTTPS健康503；根盘94GiB全部用满。只读定位发现其他业务gxts_taskapi单个Docker日志52,005,007,360字节（约48.4GiB），无轮转；账单三个常驻容器原已为json-file、10m×3。

用户明确批准先保存该容器最近2000行到本机私有目录，再清空其当前日志文件。保存文件 `.local/logs/operations/gxts-taskapi-before-clear-20261006.log.gz`，gzip校验通过、0600；核对完整容器ID/名称及LogPath且文件非链接后截断指定文件，未重启其他业务。根盘恢复49GiB可用；数据库pg_isready及SELECT 1通过。其余历史日志已丢弃，该其他业务的无轮转根因尚未配置，可能再次增长。

发布门禁发现新增依赖公告，Jackson与source-map-js更新到同分支修复版后工程/隔离数据库集成通过。用户明确接受本次内网候选的 `spring-webmvc:6.2.19 / GHSA-pc63-qcmh-9cmg` 风险例外，仅限intranet-main与本案例主机；[官方公告](https://spring.io/security/cve-2026-47884/)的XsltView触发配置未在项目静态核查中发现，6.2.20为商业支持，公开修复在7.x。此授权不代表漏洞修复、零命中或后续候选放行。候选审批记录位于本机私有目录并绑定完整源码SHA，门禁按精确版本/公告核验；框架迁移未实施。实际发布结果见下文“10月7日应用与日志实机验收”。

### 首次应用门禁与兼容修复

首个候选c7ffb61在目标机构建完成，app镜像fc25ccbd、proxy镜像2223813f、migrate镜像32e61587；三者本次Trivy OS扫描均无CRITICAL/HIGH，app为MEDIUM39/LOW4，proxy零命中，migrate为MEDIUM14/LOW16。此结果不代替已获批Spring公告风险或原数据库镜像的历史残余项。构建迁移镜像的发行版补丁安装耗时约1713秒，多次在XFS同步等待，但最终成功；未升级宿主或重启Docker。历史migrate镜像已不在本机，未复用未经本次扫描的旧制品。

23:56维护前加密备份实际成功；旧systemd不支持 `show --value`，发布检查误判后停止。旧app/proxy未停止，迁移未尝试，版本仍为4f0af93；失败过程已保存在私有日志归档。已统一改用读取 `Result=...` 属性的兼容方式，并覆盖发布、日常备份和初始化/巡检。

本次线上前端目录已复制并固定到 `/opt/my-bill/frontend-preserved/4f0af93e588391ecbc5ce380db66dde0037d105e`，完整文件树摘要 `a694b364159e870908615097935be0605774a87bbbfb4d428f7be25d6fee75f6`，首页仍为 `3cece33eae27758b468483493197c36a3a6a2dec280bab0dd5bb321a78db9ce8`；production.env仅原子更新MY_BILL_WEB_DIST，原0600配置备份为 `/etc/my-bill/production.env.before-logging-c7ffb61`。因此候选包中当前HEAD的新前端构建资产不作为本次线上页面；本次保留原已验收页面。

独立合成容器实测Docker轮转仅保留3文件并清理测试容器；独立Compose项目另证明 `up app` 会重建配置变更的db依赖，`--no-deps`才保持数据库。已修正发布与restart的应用/代理启动，不将数据库配置变更隐式带入。数据库日志参数将另行在备份后的维护窗口应用，保持原数据库镜像及持久卷。

### 10月7日应用与日志实机验收

最终线上源码为 `2f3c37b2a05fd875488be55c24aa8ec3924e146d`，00:07:11完成应用切换，schema仍12:012（校验12个迁移，无新SQL）。新候选复跑完整工程/隔离数据库、性能、安全（仅获批Spring风险）与3项Chromium E2E通过；交付前OSV短暂超时阻止写入，复用已校验制品重试后通过。镜像复用首轮已扫描的构建层，运行app为fc25ccbd、proxy为2223813f、migrate为32e61587，JAR SHA256为 `bdc34a0e50b58bcd2aee62bdc8bce55b28449e7e87ccf8dd8916bb33cfb723b8`。

应用切换后再次加密备份成功（00:07:49），关闭入口/app并保全数据库日志，在独立维护中重建db。实际镜像仍 `sha256:b44b1638299c22cf46c39815995cdaf69b55eaa3d24c09d2ea8d58bc5822e3b8`、持久卷仍my-bill_postgres_data，未重建镜像或覆盖数据库。实机pg_settings确认log_statement=none、log_min_error_statement=panic、log_error_verbosity=terse及两项parameter_max_length=0。收尾临时脚本的 `--retry-all-errors` 被旧curl拒绝；数据库设置和服务已生效，随后用兼容命令独立验证HTTPS UP，临时脚本已修正并从目标机删除，保留原失败状态诊断而不重跑数据库维护。

本次最终实测：

- db/app healthy，proxy运行，HTTPS health UP；manual monitor Result=success，backup状态SUCCEEDED，两个timer active。
- 三个常驻容器实际json-file、max-size=10m、max-file=3；已用独立合成容器验证该宿主Docker轮转行为，未向生产日志灌入大流量。
- 真实匿名session请求401：响应头/错误体、Java ECS日志、Caddy日志traceId一致；Java日志service.version为线上2f3c37b，测试查询参数及自定义请求头未落盘，Caddy无URI、请求头、客户端IP/端口/TLS及响应头。
- 实机trace过滤、私有gzip导出（0600并校验）、历史latest查询通过；follow收到新请求，SIGINT退出后服务仍健康。
- 服务器 `/opt/my-bill/logs` 为0700，完成归档0600，已实际生成发布记录、旧容器快照、db维护快照和最终验收记录；14天/500MB策略在创建/导出时清理，未通过等待14天或写满生产磁盘进行破坏性验证。最终验收记录archiveResult=0，先前失败记录仍保留。
- 当前Caddy挂载保留的4f0af93前端目录，真实HTTPS /login响应摘要仍为3cece33e，未切换本地未发布UI。没有重做iPhone/PWA及恢复/注销重放验收，本次仅完成日志应用范围。以后发布新前端时，须验收新资产并显式把MY_BILL_WEB_DIST改为已验证的新资源目录（或恢复current/web/dist），重建proxy后核对HTTP摘要；当前固定路径不会随current切换自动更新页面。
- gxts_taskapi启动时间仍2026-09-29T09:38:00.999975494Z；测试容器与临时Compose项目已清理，未重启其他业务。该业务仍无Docker日志轮转，今后可能再次占满共用根盘；本次授权只包括历史日志清理，未改其Swarm服务。

实机receipt在 `/opt/my-bill/current/logging-acceptance.properties`；本机原始证据位于 `.local/logs/operations`。构建自审另发现私有umask使新候选公开静态文件变成0600，已在本地候选生产者固定公开目录0755/文件0644，并通过真实脚本加构建命令适配器验证；本次线上使用的是已保留且可读的原前端，未受该问题影响。这项构建工具修复及验收文档的后续本地提交不代表再次发布后端版本。

最终退出闭环自审发现首次follow测试的本地SIGINT留下一个远端Docker查看进程；按本次测试完整命令参数核对后只终止该进程。统一SSH入口仅对follow启用远端PTY，使SSH会话退出同步结束前台Docker/journal查询。命令适配器验证普通查询无PTY、follow有PTY；实机复测收到新trace、SIGINT退出，随后服务器无遗留follow CLI且HTTPS仍UP。该修复在本地运维入口即时生效，不需要重启业务容器。
