# 内网单机：首次部署与既有维护记录

记录范围：2026-09-28 至 2026-10-02。文中的“当前”均指对应记录时点；最新实例状态见[案例总览](README.md)。

## 状态与适用方案

2026-09-28 已完成基础部署，2026-09-29 用户补齐 iOS 专项实机确认后，T29 按本次内网范围验收完成。采用 [单机内网架构](../../architecture.md)、[操作手册](../../runbook.md) 和 [同机备份](../../backup-recovery.md)。下述地址、资源、例外和验证只属于本案例，不作为其他环境默认值。

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
| 宿主准备复核 | 2026-10-02 只读 `inspect/host-plan/host-verify`：Docker、Compose、绑定IP、Asia/Shanghai时区、磁盘和内存满足；仅有Python2.7，无Python3.8+，因此新宿主门禁失败 |
| 统一运维入口 | 2026-10-02 只读实测status/health、备份列表和加密证书指纹通过；最新 `2026-10-02.cms` 已拉取到本机被忽略目录并再次校验SHA-256 |
| 共存业务 | 部署完成时原12个业务容器仍运行且未重启；其功能未做回归 |
| 访问范围 | 用户明确允许全部可达来源，MY_BILL_ALLOWED_CIDRS=0.0.0.0/0 ::/0；只绑定该私网IPv4，无新增公网映射 |

日常不再复制具体SSH长命令；连接身份、私钥和严格 `known_hosts` 已保存在本机 `.local/deploy-targets/intranet-main.env`，由 `environment`、`release`、`ops` 三个入口统一消费。事故诊断必须直连时，从该受控目标文件核对参数，仍保持批处理身份与严格主机密钥校验。

用户明确接受本机 CentOS7 的内网例外，预检仅此IP可用 `MY_BILL_ALLOW_EOL_CENTOS7=1`；不代表宿主补丁验收通过，也不降低HTTPS、CSRF、鉴权、RLS和密钥要求。禁止据此对别的主机跳过维护基线。没有为部署升级/重装宿主、重启Docker、调整Swarm或更改SELinux现状。

2026-10-02 新增的通用宿主准备入口按安全默认把本案例映射为 `existing-linux`，只读检查且禁止 `host-apply`。现有服务可运行不等于新的完整环境初始化工具链通过；在补齐受支持Python前，依赖Python3.8+的首次初始化和高级恢复HTTP演练入口不得在本机宣称可用。既有日常备份轮转兼容当前Python2.7，基础隔离归档恢复不依赖Python。该缺口没有通过CentOS7例外豁免，也未在本轮对服务器安装软件。

本轮异机复制只包含CMS加密归档及其checksum，落点为本项目 `.local/offsite-backups/intranet-main`，未进入Git。服务器备份证书指纹为 `2B:AE:B1:4A:72:80:BB:CE:A5:7D:31:B8:62:A3:EE:56:63:A3:DB:33:6A:46:CA:45:49:E5:7D:85:64:15:67:B9`；解密私钥仍未执行新的 `backup-key-pull` 或组织密钥库托管，所以不能把该副本记为整机灾难恢复闭环。

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
- 首管理员admin；临时凭据通过本地 `/Users/pengshuaifeng/ai-my-bill/.local/deployment/initial-admin.json`（0600）交付。本文不保存密码；初始临时凭据已失效；本次以用户提供的当前凭据验证认证成功，`passwordChangeRequired=false`，未将当前密码写入文档。
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

当时未完成（后续状态见下文）：上述镜像漏洞处置、目标终端 CA 信任/手机 PWA 与启动表现、管理页实机展示、人工入口切换及更大规模恢复时间、最终验收。注销审计保全/重放工具已有本地实现与隔离测试：91 项 HTTP/业务测试通过，CLI 保全、全库恢复、非空条数/精确金额对账、旧快照注销账号与文件清理及重复执行通过，恢复环节约 10 秒；目标机工具与三万条代表性样本恢复证据见后；其他规模和人工切换仍独立验收。

## 离线恢复工具目标机演练

源码 `83c6c1f` 已在目标机独立构建为 `my-bill-recovery:83c6c1f`，镜像 ID `sha256:c54c4abf7c1ba3d5d715efa9f6de7926a449653c7cd47b09a275e0a8ce21e7e8`；来源目录 `/opt/my-bill/releases/recovery-83c6c1f`。这是一次性维护镜像，常驻 app 仍是 d7ce73d，未将恢复操作指向线上库。

以 `/var/backups/my-bill/daily/2026-09-28.cms` 执行 `verify-recovery-tool.sh`：SHA256 成功，独立 internal 网络/无宿主端口临时 PG 恢复数据库原授权和导出目录，工具以随机 app 凭据完成 preserve、replay、再次 replay。耗时 87 秒，账目条数/金额前后一致，临时容器、网络、明文目录已清理。备份账目为零，脚本输出 LIMIT；这不是代表性业务 RTO 通过，也没有把副本中的审计当作覆盖前最新注销事实。

恢复镜像另行 Trivy OS 复扫：CRITICAL/HIGH 均为 0，MEDIUM 38、LOW 4；结果 `/opt/my-bill/scans/recovery-83c6c1f.json`。数据库和迁移镜像此前高危命中仍未处置。证书签发上传的暂存叶文件已清除，正式证书仍在 `/etc/my-bill/tls`。

## 后续维护入口

在 /opt/my-bill/current 按通用手册定义bill_compose后，查看ps/logs与选择性容器状态；备份查看timer/service日志和last-success。新版本升级先保全旧制品及备份，按手册维护窗口操作，完成后更新本案例。本次切换曾触发回退并恢复健康，保留 `/opt/my-bill/releases/before-security-4f0af93` 及 `before-security-4f0af93` 镜像标签；该回退仅针对本次无 schema 变化的发布，不能泛化到破坏性迁移。

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

下述补丁已实际切换。2026-09-29 用户明确接受上述已记录残余风险，作为本次内网部署例外。该授权仅适用于本案例主机 `10.100.101.104` 和上述数据库补丁镜像 `sha256:b44b1638299c22cf46c39815995cdaf69b55eaa3d24c09d2ea8d58bc5822e3b8` 的本次扫描基线；安全门禁按“已接受风险例外”记录，不记为扫描无漏洞或利用验证通过。后续发现新增风险、提供修复版本、变更镜像或开放公网时须重新评估；不降低 HTTPS、鉴权、租户隔离、密钥及备份要求。

迁移补丁候选 `sha256:4fcd72a27a88a010d8eb812f854ad8fc6d0ca103579a74485a0c6ec86cf73b8d` 复扫为 CRITICAL0/HIGH0/MEDIUM13/LOW16，原13个高危命中清除。另只读评估官方 `postgres:16.14-trixie`，原始扫描为 CRITICAL13/HIGH113/MEDIUM169/LOW147/UNKNOWN6；未经补丁构建/主机兼容测试，不作为当前替代制品，也不能据此承诺换发行版会清零。

### 实际切换结果

部署源码为 `4f0af93e588391ecbc5ce380db66dde0037d105e`。当前数据库使用上述 b44b1638 补丁镜像；app 使用已构建验证的 `83c6c1f` 代码制品 `sha256:c54c4abf7c1ba3d5d715efa9f6de7926a449653c7cd47b09a275e0a8ce21e7e8`（4f0af93 未改变 Java 或 app 入口）；migrate 使用上述4fcd72a2，proxy保持9b490fbc；前端仍为d7ce73d构建资产。

运行 JAR SHA256 `8e0a0bf68b1327f19f0e6bfa3307f4bf87b83d5f295175c29287ff0cfcbbf2c8`；首页 `3cece33eae27758b468483493197c36a3a6a2dec280bab0dd5bb321a78db9ce8`。PostgreSQL服务端/客户端均16.14，12个迁移校验一致且无需执行新SQL。

最终代码隔离演练再次通过（含 NOINHERIT 角色），耗时68秒。发布前加密备份成功，最新状态时间 `2026-09-28T16:27:03Z`；旧源码目录和镜像保留。第一次通过 SSH 标准输入执行时，Compose 一次性任务消费了后续输入，虽迁移正常退出0，发布未走到完成标记而回退旧服务，健康恢复。随后改为服务器脚本文件执行，迁移使用 `-T < /dev/null`，再次切换成功；手册同步防止复现。

切换后：db/app healthy、HTTPS health UP、monitor Result=success；常驻app无法读取迁移/管理员secret，无法写备份状态文件；真实管理员认证后概况返回 SUCCEEDED（上述新时间），退出后管理API401。manifest名称、三个PNG图标及Apple图标均通过受信任CA的HTTP校验。根盘约51GiB可用；所有本次恢复临时容器/网络已清理。iPhone/iPad上的页面、安装与启动仍未验证。

### iPhone / iPad 安装与待验收步骤

适用于本案例的独立内部 CA。手机须接入能访问 `10.100.101.104` 的内网。首次证书警告后选择继续、后续不再提示，并不能证明已建立系统信任；应核对下面的完全信任开关。PWA 基于浏览器引擎，不是 Mac 专属技术，本项目没有 IPA/APK 下载包，也不支持离线记账。

1. **在 Mac 找到并发送公钥证书。** Finder 按 `⌘⇧G`（前往文件夹），输入 `/Users/pengshuaifeng/ai-my-bill/.local/intranet-pki/ca/`。选中 `ca.crt`，右键“共享 → 隔空投送”，发送到自己的 iPhone/iPad。只发送 `ca.crt`，不要发送私钥 `ca.key` 或整个目录。
2. **在手机安装描述文件。** 接收并打开证书后，进入“设置 → 已下载描述文件”；若没有该入口，查看“设置 → 通用 → VPN 与设备管理”。选择 `My Bill Private Root CA`，点击“安装”，按系统提示输入设备锁屏密码并确认。如果名称不符，停止安装并核对文件来源。
3. **开启完全信任。** 进入“设置 → 通用 → 关于本机 → 证书信任设置”，在“针对根证书启用完全信任”下开启 `My Bill Private Root CA` 并确认。安装描述文件本身不会自动取得 SSL/TLS 信任，见 [Apple 官方说明](https://support.apple.com/zh-cn/102390)。如果这里没有该证书，返回上一步确认安装已完成。
4. **重新验证 HTTPS。** 关闭原页面，用 Safari 重新打开 `https://10.100.101.104:18443`，应无证书警告，并核对上述信任开关仍开启。若仍警告，不以“继续访问”作为验收通过；检查设备日期、证书安装与信任状态，并由运维核对服务器叶证书有效期和 IP 是否匹配。
5. **安装到主屏幕。** Safari 中点击“分享 → 添加到主屏幕”；系统若显示“作为网页 App 打开”，保持启用。从桌面“我的账单”图标启动，检查图标、独立窗口、初次启动和横竖屏。操作入口见 [Apple 说明](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/27/ios/27)。
6. **完成实际功能验收。** 登录后检查管理概况备份状态。临时断网时应提示无法访问/重试，不应从离线缓存重新展示个人账目；恢复网络后应可继续。版本发布后验证 Service Worker 自动接管、旧静态缓存清理和重载后的启动；当前没有更新提示按钮。记录设备型号、系统版本、验证时间和各项结果，异常保持待验收。

本次已核实本机公钥证书名称为 `My Bill Private Root CA`，SHA-256 指纹为：

```text
E0:A6:29:12:BB:BA:E0:33:67:8B:D7:EB:0A:6B:FD:66:17:51:62:F0:D2:79:05:47:76:5B:B0:03:AE:C8:24:AD
```

2026-09-29 用户实机确认以下四项**通过**：项目根证书完全信任已开启、Safari 无证书警告、添加主屏幕后可独立打开、登录和基本操作正常。证据来源为用户本次确认，非 AI 直接操作或截图验证；具体设备型号及系统版本未提供，不推定 iPhone 与 iPad 两类设备均已覆盖。

2026-09-29 用户进一步确认 iOS 真机离线、版本更新与横竖屏专项测试通过，补齐最终实机验收。依据是用户对前一轮列出的三项剩余测试明确回复“ios真机测试通过了”；不是从“基本操作正常”推定。设备型号、系统版本与截图未提供，不推定所有 iPhone/iPad 型号均已覆盖。对应内置浏览器验证见下一节。前文部署时点的未验证记录为历史状态，以本节及后续补验结论为准。

### 浏览器专项与恢复服务切换补验（2026-09-29）

内置浏览器未安装本案例 CA，直接访问返回 `ERR_CERT_AUTHORITY_INVALID`，未绕过警告。验证改用仅监听本机 `127.0.0.1:18544` 的临时转发，向线上 HTTPS 校验本案例 CA；线上制品和配置未改变。由内置 Chromium 查看实际前端与管理接口，不作为 Safari/手机引擎专项通过证据。

- 页面：管理员真实登录、管理概况实际显示“备份成功”和成功时间；390×844、844×390 两个视口无整页横向溢出（scrollWidth 等于 viewport）。测试后退出成功。
- 离线：本地转发故障注入，API及下载请求失败而不回放缓存；顶层导航显示“当前没有网络”，缓存键没有 API、下载或个性化导航。
- 更新：仅在临时转发端替换 SW 的缓存版本标识，浏览器更新注册后自动接管、删除旧静态缓存，重载管理概况恢复正常。没有发布假版本到线上；当前实现没有更新提示按钮。初次测试工具误用 iframe（被安全响应头拒绝）及过早读取激活状态，改为顶层导航并等待激活完成后通过。
- 清理：本次 localhost 的 SW 注册/缓存已移除，管理员会话已退出，转发进程已停止；没有修改个人浏览器。

恢复服务切换使用 `/opt/my-bill/recovery-http-validation/` 下的专项脚本和9月28日加密归档，仍是三万条合成样本规模。`verify-recovery-tool.sh --synthetic` 增加普通生产应用启动和内部临时 Caddy：入口先502，切换到恢复服务后健康200；两存续账号报表各10000条、支出246800.00，账目分页与导出原始字节一致；跨租户导出404、退出后401、已注销账号登录401；入口回退再切换后会话保持有效。总耗时101秒，包含样本准备、恢复、注销重放和服务启动/HTTP检查，不含人工事故判断时间。首次临时代理目录权限不匹配导致失败，修正隔离配置后全流程通过。

此演练不发布宿主端口，不覆盖线上库、不切换真实生产代理，不携带线上数据库secret；临时容器、网络和解密目录均已清理，随后线上 app/db healthy、HTTPS health UP。结果日志：`/opt/my-bill/recovery-http-validation/result.log`。真实事故的生产入口切换操作未执行，以该隔离切换演练作为恢复流程证据；不宣称已经发生过真实灾难恢复。更大规模耗时按用户要求本次不处理。
