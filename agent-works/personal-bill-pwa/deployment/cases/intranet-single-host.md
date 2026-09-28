# 部署案例：现有内网单机

## 状态与适用方案

2026-09-28 已完成基础部署，T29 最终验收仍进行中。采用 [单机内网架构](../architecture.md)、[操作手册](../runbook.md) 和 [同机备份](../backup-recovery.md)。下述地址、资源、例外和验证只属于本案例，不作为其他环境默认值。

当日约17:28只读状态快照：db/app healthy、proxy运行；根盘57GiB可用；backup timer enabled；last-success 为 `2026-09-28T17:13:31+0800`。HTTPS/初始化/恢复证据来自当日部署实测；状态快照不重复证明这些写操作。

## 主机、连接和资源

| 项目 | 实际值 |
|---|---|
| 使用入口 | https://10.100.101.104:18443 |
| SSH | root@10.100.101.104，默认22端口，CLI SSH；未注册独立SSH MCP，不在Codex连接列表显示 |
| 本地私钥位置 | /Users/pengshuaifeng/works/ssh/gzzn_gxts_id_rsa，0600；不在仓库内 |
| OS/内核 | CentOS Linux7.9.2009，3.10.0-1160.el7；libseccomp2.3.1-4.el7，SELinux现状Disabled |
| 资源 | 4CPU，内存约16GiB；快照时 available8616MiB；根XFS94GiB，使用38GiB/41%，可用57GiB |
| 容器环境 | Docker26.0.1、Compose2.26.1、overlay2，已有Swarm处于active |
| 共存业务 | 部署完成时原12个业务容器仍运行且未重启；其功能未做回归 |
| 访问范围 | 用户明确允许全部可达来源，MY_BILL_ALLOWED_CIDRS=0.0.0.0/0 ::/0；只绑定该私网IPv4，无新增公网映射 |

连接命令：

```bash
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -i /Users/pengshuaifeng/works/ssh/gzzn_gxts_id_rsa root@10.100.101.104
```

用户明确接受本机 CentOS7 的内网例外，预检仅此IP可用 `MY_BILL_ALLOW_EOL_CENTOS7=1`；不代表宿主补丁验收通过，也不降低HTTPS、CSRF、鉴权、RLS和密钥要求。禁止据此对别的主机跳过维护基线。没有为部署升级/重装宿主、重启Docker、调整Swarm或更改SELinux现状。

## 路径、配置与凭据映射

| 路径/资源 | 具体用途与权限 |
|---|---|
| /opt/my-bill/current | 发布源码、deploy、web/dist；root所有，其他用户不可写 |
| /opt/my-bill/current/REVISION | 部署源码完整提交号 |
| /opt/my-bill/app-build.log、bootstrap.log | 构建/初始化日志；bootstrap.log仅root可读，不含初始明文密码 |
| /etc/my-bill/production.env | 0600非密钥配置；项目名my-bill，库my_bill，内部app8080 |
| /etc/my-bill/secrets | 管理员DB secret为root0600；迁移/app/pepper为10001:10001、0600 |
| /etc/my-bill/tls | 10001:10001、0700；server.crt0644、server.key0600；只有叶证书 |
| /etc/my-bill/backup-encryption.key、.crt | root0600，备份CMS用RSA3072密钥与证书，不是HTTPS CA |
| /var/backups/my-bill | daily/weekly、checksum、last-success；仅服务器副本 |
| /etc/systemd/system/my-bill-backup.service、.timer | 每天主机上海时间03:00，Persistent=true，已启用 |
| my-bill_postgres_data、my-bill_export_data | Docker命名持久卷；用docker volume inspect定位，不假设宿主Docker根目录 |
| my-bill_database、my-bill_application | 数据库内部网络与应用入口网络 |
| my-bill-db-1、my-bill-app-1、my-bill-proxy-1 | 常驻服务；仅proxy发布10.100.101.104:18443→8443 |

app1GiB/1CPU、db768MiB/1CPU、proxy128MiB/0.5CPU；app JVM Xmx512MiB。当前不存在迁移常驻服务，app只挂app密码及pepper。

## CA 与首管理员交付

签发端项目目录下 `.local/intranet-pki/ca/ca.key`、`ca.crt`；叶证书在 `.local/intranet-pki/issued-10.100.101.104/`。CA私钥未上传服务器、未入Git。客户端安装的是ca.crt公钥证书。

- CA SHA256指纹：`E0:A6:29:12:BB:BA:E0:33:67:8B:D7:EB:0A:6B:FD:66:17:51:62:F0:D2:79:05:47:76:5B:B0:03:AE:C8:24:AD`。
- 叶证书SAN为IP10.100.101.104，到期 `2026-12-27 23:38:55 Asia/Shanghai`；受控人工签发/加载已演练，30天到期巡检已部署；未实现自动签发。
- 首管理员admin；临时凭据通过本地 `/Users/pengshuaifeng/ai-my-bill/.local/deployment/initial-admin.json`（0600）交付。本文不保存密码；24h首次改密有效期，是否已改密未验证。
- 初始化成功并验证登录后，服务器 `/etc/my-bill/secrets/initial_admin_password` 已删除。后续不再执行bootstrap；普通记账账号从管理页创建。
- 命令行显式CA验证通过；电脑/手机系统信任安装与PWA独立窗口未验证。

## 实施顺序与实例差异

当日已实际执行：容量清理后的只读预检 → 白名单源码/dist交付 → app/migrate/proxy镜像构建 → PG启动 → 角色provision →12个迁移 → 首管理员bootstrap → app/proxy → HTTPS与认证检查 → 加密备份 → 隔离恢复 → systemd启用。首次源码提交为 `78f751964a2308e206889477f8b8291e3f23a9f2`；23:31 增量部署 `d7ce73d`，后续文档提交不意味着重新部署。

本机曾出现 PostgreSQL16.14 Alpine 写postmaster.pid/WAL报Operation not permitted；改用相同版本bookworm后成功，未放宽容器安全条件，底层原因未完整归因。Caddy原镜像文件capability与cap_drop ALL冲突，派生镜像移除该capability并使用8443；这项实现已在通用配置中固化。

发布避免macOS ._附加文件，tar禁附加元数据、目标--no-same-owner；代码目录所有权归root。此前按用户指令卸载TDengine释放空间，属于本机容量处理，不属于其他项目部署的必需步骤。

## 制品记录

以下为首次部署制品（增量见后），不以当前本地HEAD或重新构建结果替代：

- 应用镜像 ID：`sha256:77e86986340b2fb889c78c4042f325884dd40808ff6ed635c5b02c436feec294`。
- 代理镜像 ID：`sha256:9b490fbca5c2ff80730e3922e5ef3363b75ddf79bf169de1c0784b058809f5c5`。
- 迁移镜像 ID：`sha256:861bc0e32011b7be4600576a8494466a6781c8657609eada6411e73abade6198`。
- PostgreSQL 官方镜像 digest：`postgres@sha256:64154d0babcb1741988719e703419af0382b19953706149f9872fbd0f438efa8`。
- 运行 JAR SHA-256：`d00669c49f480455f02d2e862c0ff1b60eb18a29aba2f3f91fb13066964f03a8`；首页 SHA-256：`348fe6ad84023435e52ab0d305a636cc339c7a92de66fcd0de015aae4fb01454`。

## 已验证与未验证

| 项目 | 当日证据与边界 |
|---|---|
| 基础服务 | db/app healthy、proxy运行、仅指定入口发布；常驻app不持迁移/管理员secret |
| HTTPS/静态 | 显式项目CA校验、/login与资源200、CSP、health UP |
| 身份 | 匿名管理API401、缺CSRF403、admin登录200、Secure/HttpOnly/SameSite Cookie、改密前管理操作403、退出204 |
| 本地初始化验证 | 临时PG验证摘要、24h临时密码、审计及重复拒绝；目标机初始化真实成功 |
| 备份 | 初始库约20KiB加密归档、完整解密检查；最后成功17:13:31，timer enabled |
| 隔离恢复 | 无网络临时容器恢复并重新导出成功，临时容器已清理；不含完整业务样本与注销重放 |
| 既有安全扫描 | 363个npm/Maven依赖OSV无命中及secret扫描通过；不覆盖容器OS包，不代表后续版本扫描结果 |

用户确认每天一次、最多7个日备份和4个周备份；目标RPO24h/RTO4h仅限主机与磁盘可读的逻辑恢复。实际脚本保留最近7日历日/4ISO周的成功副本，未提供异机容灾。自动化数据恢复耗时证据见后；不将固定样本自动化时间泛化成人工切换或任意规模 RTO。

23:31 增量已部署 `d7ce73d`：app 镜像 `sha256:d24861b2df1b9777881b16519ffa98911da57557bdbd8b1ec03cbd30043e26fa`；部署前备份成功，旧目录 `/opt/my-bill/releases/before-t29-d7ce73d` 与旧镜像标签 `my-bill-app:before-t29-d7ce73d` 已保留。备份状态文件 `/var/lib/my-bill/operations/backup.properties` 为 SUCCEEDED，完成时间 `2026-09-28T15:31:55Z`；应用只读挂载；monitor timer 已启用，手动执行 Result=success，HTTPS health UP。管理页认证后实际展示未验证。

23:39 使用本地独立 CA 签发的新叶证书执行受控加载成功，HTTPS 校验通过；新叶 SHA256 `AF:35:B1:DF:D7:C8:EA:B1:2D:89:E3:EA:F3:66:69:98:30:AB:E7:68:F8:7E:72:E2:0E:53:12:50:81:4F:5A:29`。CA 私钥未上传。9月29日追加失败注入：加载另一张同 CA 的有效叶证书后令健康探针失败，脚本恢复原证书/私钥，前后 SHA256 一致，HTTPS health UP。

Trivy 0.74.0 官方校验和核对后，在目标机执行 OS 包扫描，结果位于 `/opt/my-bill/scans/`（不是 npm/Maven 依赖扫描）：

| 镜像 | CRITICAL | HIGH | MEDIUM | LOW | UNKNOWN |
|---|---:|---:|---:|---:|---:|
| my-bill-app（d7ce73d） | 0 | 0 | 38 | 4 | 0 |
| postgres:16.14-bookworm | 15 | 81 | 184 | 154 | 9 |
| my-bill-proxy | 0 | 0 | 0 | 0 | 0 |
| my-bill-migrate | 0 | 13 | 267 | 112 | 0 |

数量为漏洞与包的命中数，非唯一 CVE 数。数据库镜像有未提供修复版本的高危项；libpcre2 已有 `10.42-1+deb12u1` 修复。迁移镜像的 GnuPG/OpenSSL 有修复版本。扫描完成不等于安全通过，仍需升级可修复包、复扫并对剩余项按可达性处置，不能套用宿主 CentOS 7 例外豁免容器风险。

仍未完成：上述镜像漏洞处置、目标终端 CA 信任/手机 PWA 与启动表现、管理页实机展示、人工入口切换及更大规模恢复时间、最终验收。注销审计保全/重放工具已有本地实现与隔离测试：91 项 HTTP/业务测试通过，CLI 保全、全库恢复、非空条数/精确金额对账、旧快照注销账号与文件清理及重复执行通过，恢复环节约 10 秒；目标容器运行与完整恢复仍需验证，不以本地测试冒充目标恢复通过。

## 离线恢复工具目标机演练

源码 `83c6c1f` 已在目标机独立构建为 `my-bill-recovery:83c6c1f`，镜像 ID `sha256:c54c4abf7c1ba3d5d715efa9f6de7926a449653c7cd47b09a275e0a8ce21e7e8`；来源目录 `/opt/my-bill/releases/recovery-83c6c1f`。这是一次性维护镜像，常驻 app 仍是 d7ce73d，未将恢复操作指向线上库。

以 `/var/backups/my-bill/daily/2026-09-28.cms` 执行 `verify-recovery-tool.sh`：SHA256 成功，独立 internal 网络/无宿主端口临时 PG 恢复数据库原授权和导出目录，工具以随机 app 凭据完成 preserve、replay、再次 replay。耗时 87 秒，账目条数/金额前后一致，临时容器、网络、明文目录已清理。备份账目为零，脚本输出 LIMIT；这不是代表性业务 RTO 通过，也没有把副本中的审计当作覆盖前最新注销事实。

恢复镜像另行 Trivy OS 复扫：CRITICAL/HIGH 均为 0，MEDIUM 38、LOW 4；结果 `/opt/my-bill/scans/recovery-83c6c1f.json`。数据库和迁移镜像此前高危命中仍未处置。证书签发上传的暂存叶文件已清除，正式证书仍在 `/etc/my-bill/tls`。

## 后续维护入口

在 /opt/my-bill/current 按通用手册定义bill_compose后，查看ps/logs与选择性容器状态；备份查看timer/service日志和last-success。新版本升级先保全旧制品及备份，按手册维护窗口操作，完成后更新本案例。当前未登记已演练的旧版业务回退制品，不承诺一键回滚。

## 9月29日补丁与代表性恢复验收

- 管理员真实凭据认证通过，概况 API 返回 `backup.status=SUCCEEDED`，时间为 `2026-09-28T15:31:55Z`，验证后退出；不记录密码，浏览器页面展示仍未验证。
- 四类巡检异常经隔离命令桩故障注入：容器、TLS、磁盘95%和备份状态均产生非零退出及 journald 告警，随后真实 monitor service Result=success。没有真实停掉常驻服务或写满磁盘。日志明确补记 DRILL 标识。
- 状态生产者回归：隔离目录验证 `+0800` 历史时间转 UTC、RUNNING 发布、FAILED 保留成功时间、明文临时目录清理；巡检验证新鲜 RUNNING 通过、失败/超时/未来时间拒绝。
- 代表性恢复：patched PostgreSQL 16.14、恢复工具 83c6c1f，在独立容器中还原三万条支出及三个导出；独立保全快照后的注销，重放两次后剩两万条、精确总额493600.00、两个文件哈希一致，第三账号/文件消失，两租户 RLS 通过。总耗时86秒，包括合成样本准备和维护工具启动，未包含人工事故判断或入口切换。首次实测暴露并修复导出根目录未显式传入和 CentOS 7 sha256sum 不支持 --ignore-missing 两项配置/兼容问题。

数据库补丁候选 ID `sha256:b44b1638299c22cf46c39815995cdaf69b55eaa3d24c09d2ea8d58bc5822e3b8`，PostgreSQL 保持16.14，libpcre2 更新为 `10.42-1+deb12u1`。OS复扫原始包命中为 CRITICAL15/HIGH78/MEDIUM177/LOW146/UNKNOWN4，高危中无已提供修复版本的剩余项；这不是“无漏洞”。

剩余风险核实：

| 项目 | 证据与结论 |
|---|---|
| CVE-2023-45853 | [Debian说明](https://security-tracker.debian.org/tracker/CVE-2023-45853)指出 bookworm 的 zlib 未编译受影响 MiniZip；候选内未安装 minizip/libminizip1。该 zlib 命中不等同于运行制品受影响。 |
| CVE-2026-8376 | [Debian说明](https://security-tracker.debian.org/tracker/CVE-2026-8376)限定32位 Perl 构建；候选 `perl -V:ptrsize` 为8字节，32位触发条件不成立。 |
| libxml2 等其他未修复项 | [CVE-2026-6653](https://security-tracker.debian.org/tracker/CVE-2026-6653)仍由 Debian 延后修复。仓库生产查询未发现 XMLParse/XPath/PLPerl/SQLite 调用；线上扩展仅 plpgsql，数据库无宿主发布端口。只能说明当前接口未发现这些调用路径，不能宣称全部不可利用；未做漏洞利用验证，未添加扫描忽略规则。 |

补丁候选的构建/扫描/恢复证据不替代部署，实际切换及最终镜像记录另行回填。宿主 CentOS7 例外不自动覆盖上述残余容器风险。

迁移补丁候选 `sha256:4fcd72a27a88a010d8eb812f854ad8fc6d0ca103579a74485a0c6ec86cf73b8d` 复扫为 CRITICAL0/HIGH0/MEDIUM13/LOW16，原13个高危命中清除。另只读评估官方 `postgres:16.14-trixie`，原始扫描为 CRITICAL13/HIGH113/MEDIUM169/LOW147/UNKNOWN6；未经补丁构建/主机兼容测试，不作为当前替代制品，也不能据此承诺换发行版会清零。
