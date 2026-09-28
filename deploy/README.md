# 内网部署

一期在受控内网以 IP + HTTPS 访问，不发布公网入口。当前仓库提供基础 Compose、内网覆盖配置、代理、CA 签发与只读预检；用户已接受当前 CentOS 7 内网环境例外，可继续实际部署。当前基础内网服务已启动；T29 最终验收仍有未完成项，见下方实测记录。

## 1. 主机就绪

在目标 Linux 上运行：

```sh
bash deploy/scripts/preflight-host.sh <本机内网IPv4> 18443
```

预检不修改服务器。部署资源基线为：受维护且完成补丁核查的 Linux、Docker/Compose v2、至少 2GiB 可用内存、Docker 所在盘至少 10GiB 空闲且使用率低于 85%、独立未占用 HTTPS 端口；已有 Swarm 需同时核对 ingress 发布端口。发行版匹配只能初筛，不能代替运维补丁和内核维护证明。未识别的受支持发行版需核对后扩展清单，不能跳过检查。

当前主机已清理 TDengine，可用约 60GiB、使用率 38%。用户明确允许当前 CentOS 7 内网环境：执行预检时设置 `MY_BILL_ALLOW_EOL_CENTOS7=1`，该例外仅适用于 `10.100.101.104`，不代表补丁验收通过。禁止自行重启 Docker、升级/重装宿主机、调整现有 Swarm 或清理其他业务文件/卷/镜像。

## 2. 内部 CA 与终端信任

在受控签发端（本机）生成，目录必须不存在：

```sh
bash deploy/tls/internal-ca.sh init .local/intranet-pki/ca
bash deploy/tls/internal-ca.sh issue .local/intranet-pki/ca <内网IPv4> .local/intranet-pki/issued-new
```

CA 有效期 10 年，叶证书 90 天，SAN 严格绑定内网 IPv4。签发前检查 CA 余期。脚本拒绝覆盖已有目录或签发公网 IP；私钥只供文件属主读取。CA 私钥留在签发端安全保存，不上传业务服务器、不进入 Git/镜像。客户端仅安装并信任 `ca.crt`，核对 SHA-256 指纹；不安装 CA 私钥，不忽略浏览器证书错误。客户端安装信任尚需在实际电脑/手机验证。

服务器只接收 `server.crt` 和 `server.key`。TLS 目录属主 `10001:10001`、模式 `0700`，私钥 `0600`。续期签发到新目录，检查 SAN/公钥与私钥匹配后替换叶证书目录内的文件，并在容器中执行 `caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`。目录挂载使替换后的文件可见。定时续期、到期告警、reload 失败补偿与恢复均待部署阶段落地和演练，不能仅凭签发脚本关闭验收。

## 3. Compose 与凭据边界

使用两个配置文件：

```sh
docker compose --env-file deploy/env/production.env \
  -f deploy/compose.yaml -f deploy/compose.intranet.yaml config --quiet
```

从 `production.env.example` 创建未入库配置。用户已明确允许所有可达客户端，当前设置 `MY_BILL_ALLOWED_CIDRS=0.0.0.0/0 ::/0`；入口仍绑定内网 IP。只发布指定内网 IP 的 HTTPS 端口；数据库和应用不映射宿主端口。不要改用 `docker stack deploy`，本部署采用独立 Compose 项目，不消费既有 Swarm 服务。

- 真实 secret 文件不入库、不经命令行参数输出。Compose 的文件 secret 是 bind mount；`uid/gid/mode` 字段不能替代宿主机文件权限。app/migrate 所需文件由 UID/GID 10001 持有、模式 0600，父目录仅运维可遍历；db/provision 的管理员 secret 只按对应短生命周期用途授予。
- 代理只挂载叶证书；应用只挂载 app 密码及限流 pepper；迁移凭据只给一次性 provision/migrate。
- app 使用只读根文件系统、临时目录和独立导出卷；镜像预先建立导出目录属主，避免首次创建卷后非 root 无法写入。所有常驻服务限额和日志轮转，不修改现有业务配置。
- 应用启动强制 prod，并拒绝 migration 环境变量及所有 `MY_BILL_E2E_*`；不降低 Secure Cookie、CSRF 或租户/RLS 规则。
- Caddy 只接受明确允许的直连来源，不信任客户端转发头。当前应用按代理连接地址执行来源总限流，这是保守共享限额；未配置转发地址信任，不能声称已按各终端来源单独限流。
- `.dockerignore` 使用白名单，构建不得发送 `.local`、密钥和个人文件。部署前重建并记录镜像 digest，不把本地配置校验等同于镜像扫描/运行验收。

启动顺序仍为：只读预检 → 核对候选/镜像/配置/secret → db → 一次性 provision → 一次性 migrate 成功且退出 → 安全初始化首个管理员 → app → proxy → 登录/权限/租户/备份/PWA 验收。首管理员通过叠加 `compose.bootstrap.yaml` 后执行 `run --rm bootstrap-admin` 初始化：默认账号 `admin`，随机密码从 `/etc/my-bill/secrets/initial_admin_password` 读取，只在空账号库中成功；事务写入管理员和审计，24 小时内首次登录必须改密。重复运行拒绝且不覆盖已有账号；初始化容器不发布端口、不运行任务调度，完成后退出。验证凭据已交付后删除服务器初始密码文件，常驻 app 不挂载它。禁止拿开发 seed 或 E2E fixture 替代。

## 4. 备份与恢复边界

用户确认：每天一次、目标 RPO 24 小时、目标 RTO 4 小时，保留 7 个日备份和 4 个周备份；副本只保存在服务器，不建立异机副本。同机备份仅覆盖主机和磁盘仍可读时的逻辑恢复，不覆盖整机/磁盘损坏；该故障下不承诺上述恢复目标。

已新增 `backup-local.sh`：数据库与导出文件加密归档、校验、7 日/4 周轮转；`verify-backup-restore.sh` 仅向无网络的临时容器恢复。备份密钥 `/etc/my-bill/backup-encryption.key` 仅 root 可读，不随业务容器挂载；丢失该密钥无法解密已有副本。`systemd/my-bill-backup.timer` 在主机上海时区每天 03:00 执行，失败写系统日志。已完成实际执行、隔离恢复验证与定时启用，详见 §6。恢复前保全注销审计、恢复后重放清理、管理端真实备份状态、告警演练仍待完成，不可据基础恢复成功直接关闭 R55。维护前后不能用“已有计划”标记备份已生效；仅同机副本时不做未经备份核验的破坏性重装。

## 5. 已执行与未执行验证

- `npm run check:server`：后端编译测试及部署入口负例通过；数据库集成按该命令默认开关跳过，新增首管理员 Mapper SQL，不修改 schema；`bash scripts/test-initial-admin.sh` 使用一次性 PostgreSQL 集群验证初始化、密码摘要、临时密码到期、审计和重复拒绝。
- `python3 scripts/test-intranet-proxy.py <已校验的Caddy二进制>`：在本机临时 CA/回环端口验证 SAN、私钥权限、覆盖保护、HTTPS、SPA、CSP、API no-store/不回退 HTML、转发头移除、非允许来源拒绝。不会安装系统根信任，测试不使用真实服务器数据。
- 目标机 Docker Compose 2.26.1 已实际启动 db/app/proxy，验证仅 `10.100.101.104:18443` 发布，app/db 无宿主端口，常驻 app 只挂载运行密码和认证 pepper。
- `npm run check:security`：工作区/Git 历史 secret 检查及 363 个 npm/Maven 依赖 OSV 检查通过；这不覆盖容器镜像 OS 包。
- 目标机容量已达标，显式 CentOS 7 例外下预检通过；未声明宿主补丁验收通过。
- 未完成：容器 OS 漏洞扫描、终端系统根信任/手机 PWA、证书续期与告警演练、注销审计保全及恢复重放、管理端备份状态接入、完整业务恢复与 RTO 验收。因此不关闭 T29/R23/R55 最终验收。

### 本轮部署准备验证

- 首管理员 Java 单元测试及后端编译通过；一次性本地 PostgreSQL 初始化/密码摘要/审计/重复拒绝测试通过。
- PostgreSQL 16.14 Alpine 在目标机出现写文件 `Operation not permitted`，停止失败容器，改用同版本 bookworm 镜像后初始化和健康检查通过，已完成 12 个迁移。
- Caddy 官方镜像携带 `cap_net_bind_service` 文件能力，和 `cap_drop ALL` 冲突；派生镜像移除该能力，在 8443 非特权端口运行，不放宽能力限制。

发布源码归档必须关闭 macOS 附加元数据，例如 `COPYFILE_DISABLE=1 tar --no-xattrs ...`，目标端使用 `tar --no-same-owner`，并确认 `/opt/my-bill` 仅 root 可写。`.dockerignore` 同时排除 `._*` 和 `.DS_Store`，避免附加文件被 Flyway/MyBatis 识别为迁移或 Mapper。

## 6. 当前内网实例（2026-09-28 实测）

- 入口：`https://10.100.101.104:18443`，所有能到达该私网地址的客户端可访问；操作仍要求登录和权限。
- db/app 健康检查通过；代理页面/静态资源 200、受信任 CA 校验、匿名管理 API 401、缺 CSRF 403、管理员登录、Secure/HttpOnly/SameSite Cookie、首次改密门禁、退出登录均实际通过。
- 管理员账号 `admin`，临时随机密码已以本机 0600 私有文件交付，不入 Git、不输出日志；首次登录须改密。服务器初始密码文件已删除。普通记账账号由管理员创建。
- 客户端须信任本项目 CA 公钥证书；服务器仅持有叶证书。当前叶证书到期时间为 2026-12-27 12:38:33（上海时间），需提前续签；自动续签/告警尚未实现。
- `backup-local.sh` 已真实生成约 20KiB 的初始数据库/导出文件加密备份，完整解密校验通过；`verify-backup-restore.sh` 已在无网络临时容器中完成恢复及重新导出，临时容器已删除。该初始库验证不替代有业务数据时的完整 R55 验收。
- 每日备份 timer 已启用，下次执行 2026-09-29 03:00 CST；保留最多最近 7 个日历日及最近 4 个 ISO 周的成功副本。查看 `systemctl status my-bill-backup.timer`、`journalctl -u my-bill-backup.service` 和 `/var/backups/my-bill/last-success`；管理页面尚未接入此运维任务，仍显示未配置，不能以页面状态判断服务器任务。
- 根盘约 57GiB 可用、使用率 41%；原有 12 个业务容器仍运行且未重启，原有业务功能未做回归。
- 应用镜像 ID：`sha256:77e86986340b2fb889c78c4042f325884dd40808ff6ed635c5b02c436feec294`。
- 代理镜像 ID：`sha256:9b490fbca5c2ff80730e3922e5ef3363b75ddf79bf169de1c0784b058809f5c5`。
- 迁移镜像 ID：`sha256:861bc0e32011b7be4600576a8494466a6781c8657609eada6411e73abade6198`。
- PostgreSQL 官方镜像 digest：`postgres@sha256:64154d0babcb1741988719e703419af0382b19953706149f9872fbd0f438efa8`。
- 运行 JAR SHA-256：`d00669c49f480455f02d2e862c0ff1b60eb18a29aba2f3f91fb13066964f03a8`；首页 SHA-256：`348fe6ad84023435e52ab0d305a636cc339c7a92de66fcd0de015aae4fb01454`。
