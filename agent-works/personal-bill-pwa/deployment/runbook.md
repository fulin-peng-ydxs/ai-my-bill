# 首次部署、升级与运维手册

## 使用前提与参数

本手册面向授权运维人员，描述当前单机内网方案。命令来自现有脚本；本次仅静态核对，既有执行证据见案例，不代表在新环境已验证。所有宿主写操作在目标环境身份和备份确认后进行，禁止对其他项目全局清理或重启 Docker。

准备两端：构建/签发端安装项目 Node、Java、PostgreSQL 工具链和 OpenSSL；目标宿主由运维提供受支持且完成更新核查的 Linux、Docker Engine/Compose v2、bash、OpenSSL CMS、flock、tar、sha256sum、Python（现有备份命令名为 python）、systemd。引擎安装/升级须按该宿主运维制度执行，不能在已有业务机器直接套用重装命令。

| 参数 | 来源 | 约束 |
|---|---|---|
| BILL_HOST、BILL_SSH_KEY | 部署案例 | SSH 目标与本地私钥路径；公钥/主机指纹经可信渠道确认 |
| BILL_BIND_IP、BILL_HTTPS_PORT | 案例网络规划 | 主机拥有的内网 IPv4、独立未占端口 |
| BILL_ALLOWED_CIDRS | 案例访问决策 | 显式网段，不默认全开放 |
| BILL_COMMIT | 干净候选的完整 Git SHA | 源码、前端、镜像和发布记录一致 |
| /opt/my-bill/current | 代码与已验证 dist | 当前脚本部署根约定，root 可写 |
| /etc/my-bill | 环境文件、secrets、叶证书、备份密钥 | 与代码分离，不打包进镜像/Git |
| /var/backups/my-bill | 加密副本 | 当前脚本固定，保留期见恢复方案 |

以下操作块使用 Bash，启用 `set -euo pipefail`，任一前置检查失败即停止；Shell 变量均需从案例填写，不把真实密码放进参数。SSH 示例（构建端）：

```bash
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -i "$BILL_SSH_KEY" "root@$BILL_HOST"
```

首次连接若无可信 known_hosts，先人工核对主机指纹后登记；不使用 StrictHostKeyChecking=no。

## 1. 构建与交付

先执行 [持续构建](continuous-delivery.md) 的关卡，取得干净候选、web/dist 和摘要。新主机采用与目标 CPU 架构匹配的镜像；本地 ARM 镜像不能直接当成 x86 制品。

源码交付用白名单，macOS 禁附加元数据。下面在候选根目录执行，BILL_COMMIT 应等于 HEAD；dist 必须来自该候选：

```bash
mkdir -p .local/delivery
git archive --format=tar "$BILL_COMMIT" .dockerignore .mvn mvnw pom.xml server deploy scripts > .local/delivery/source.tar
COPYFILE_DISABLE=1 tar --no-xattrs -czf .local/delivery/web-dist.tar.gz web/dist
(cd .local/delivery && shasum -a 256 source.tar web-dist.tar.gz > SHA256SUMS)
scp -i "$BILL_SSH_KEY" -o StrictHostKeyChecking=yes .local/delivery/source.tar .local/delivery/web-dist.tar.gz .local/delivery/SHA256SUMS "root@$BILL_HOST:/opt/my-bill/"
```

上传前先在目标执行 `install -d -m 0750 /opt/my-bill`；上传后在该目录用 `sha256sum -c SHA256SUMS` 校验。摘要使用纯文件名，核验工作目录必须是这两个归档的所在目录。首次空目录解包：

```bash
install -d -m 0750 /opt/my-bill/current
# 在 /opt/my-bill 上传目录执行；先核对摘要，再解包。
tar --no-same-owner -xf source.tar -C /opt/my-bill/current
tar --no-same-owner -xzf web-dist.tar.gz -C /opt/my-bill/current
chown -R root:root /opt/my-bill/current
```

不要将整个工作区打包；.local、个人文件、密钥、开发库不交付。升级时不能直接在运行的 dist 上解包，按 §7 的维护窗口流程处理。部署后写 REVISION 并记录镜像 ID/摘要；目标机重新构建 JAR 时需重新记录最终 JAR 摘要，不能继承本地 JAR 摘要。

## 2. 主机预检与配置

在目标项目根目录执行：

```bash
docker version
docker compose version
bash deploy/scripts/preflight-host.sh "$BILL_BIND_IP" "$BILL_HTTPS_PORT"
```

预检只读，检查 OS 清单、内存、磁盘、Docker、IP 与端口（含 Swarm ingress）。已经运行的相同实例占用入口时会失败，因此它是首次部署准入，不是在线健康检查。特定系统例外只能按已批准案例执行。

首次部署在目标项目根目录执行以下准备；已有环境文件不得覆盖：

```bash
install -d -m 0700 /etc/my-bill /etc/my-bill/secrets
test ! -e /etc/my-bill/production.env
install -m 0600 deploy/env/production.env.example /etc/my-bill/production.env
```

由运维编辑这份非密钥配置，替换 IP/CIDR/HTTPS 端口、绝对 dist 路径、TLS 目录及 secret 路径；当前模板含实例值，禁止不经核对直接套用。数据库 URL、POSTGRES_DB、角色与备份脚本固定值须一致。

## 3. 凭据、TLS 与终端信任

首次空环境可用 OpenSSL 随机生成文件，禁止覆盖已有 secret（在 root 的新环境执行）：

```bash
umask 077
install -d -m 0700 /etc/my-bill/secrets
for name in postgres_admin_password migration_db_password app_db_password auth_rate_limit_pepper initial_admin_password; do
  (set -o noclobber; openssl rand -base64 32 > "/etc/my-bill/secrets/$name") || exit 1
done
chown 10001:10001 /etc/my-bill/secrets/migration_db_password /etc/my-bill/secrets/app_db_password /etc/my-bill/secrets/auth_rate_limit_pepper /etc/my-bill/secrets/initial_admin_password
chmod 0600 /etc/my-bill/secrets/*
```

管理员 DB secret 由 root 持有；app/migrate/bootstrap 用到的文件属主10001。初始管理员密码通过受控私有文件单独交付，勿粘进终端日志。每个 secret 独立随机；备份密钥在备份章节另建。

签发端创建独立 CA（仅首次）与叶证书（每次新目录）：

```bash
bash deploy/tls/internal-ca.sh init .local/intranet-pki/ca
bash deploy/tls/internal-ca.sh issue .local/intranet-pki/ca "$BILL_BIND_IP" .local/intranet-pki/issued-new
openssl x509 -in .local/intranet-pki/ca/ca.crt -noout -fingerprint -sha256
openssl x509 -in .local/intranet-pki/issued-new/server.crt -noout -dates -ext subjectAltName
```

脚本拒绝覆盖目录与公网 IP；CA10年、叶证书90天。在目标先用 `install -d -o 10001 -g 10001 -m 0700 /etc/my-bill/tls` 创建目录；签发端通过已核对的SSH连接分别scp叶证书与叶私钥至此，随后在目标执行 `chown 10001:10001 /etc/my-bill/tls/server.*`、`chmod 0644 /etc/my-bill/tls/server.crt`、`chmod 0600 /etc/my-bill/tls/server.key`。只传这两个叶文件，不复制整个CA目录。CA 私钥留签发端并受控备份；客户端仅安装 ca.crt，核对指纹后在电脑/手机启用信任，浏览器无警告才通过。命令行 `--cacert` 成功不代表操作系统/手机已安装信任。

续期先签发新目录，校验 SAN、有效期及证书/密钥公钥摘要一致，保全当前叶文件后替换已挂载目录中的文件，再执行：

```bash
bill_compose exec -T proxy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

bill_compose 见下一节。reload 失败保留日志、还原上一对叶文件并 reload，再从客户端校验证书。当前没有自动续签、到期告警或失败恢复演练；上线验收需补齐这些证据。

## 4. 镜像、迁移和首管理员

以下 Bash 函数在目标项目根目录定义（后续命令同一 shell 使用）：

```bash
bill_compose() {
  docker compose --env-file /etc/my-bill/production.env \
    -f deploy/compose.yaml -f deploy/compose.intranet.yaml "$@"
}
bill_compose config --quiet
bill_compose build app migrate proxy
# name: my-bill 下 app 默认构建标签即 my-bill-app，bootstrap 使用此标签。
docker image inspect my-bill-app --format '{{.Id}}'
bill_compose up -d db
bill_compose ps
```

等待 db healthy 后，逐条执行，任一失败即停止后续步骤：

```bash
bill_compose run --rm --no-deps provision
bill_compose run --rm --no-deps migrate
docker compose --env-file /etc/my-bill/production.env \
  -f deploy/compose.yaml -f deploy/compose.intranet.yaml -f deploy/compose.bootstrap.yaml \
  run --rm --no-deps bootstrap-admin
bill_compose up -d app
bill_compose ps
```

provision 创建/收敛数据库角色并设置密码；重复执行会重设角色密码，不在运行中随意执行。migrate 成功执行/校验12个版本后退出。bootstrap 只在空账号库成功，锁表、写 ADMIN 及审计，初始密码24h且首次必须修改；数据库已有账号时拒绝，不在升级步骤重跑。

app healthy 后再 `bill_compose up -d proxy`。服务器初始密码文件只在初始化成功、凭据已安全交付且登录验证完成后删除；不要删除其它长期 secret。普通记账账号在管理页创建。生产 app 禁止 E2E、migration、bootstrap 变量，不用开发夹具替代初始化。

## 5. 验收与观测

| 检查 | 操作/成功条件 |
|---|---|
| 运行与端口 | bill_compose ps；db/app healthy、proxy running；仅指定 IP 的 HTTPS 发布，app/db 无宿主端口 |
| HTTPS | 客户端以 CA 验证 /login、静态资源、/api/v1/health；证书 IP SAN 正确、health UP；不使用 -k |
| 身份与边界 | 匿名管理接口401、缺CSRF403、首登改密门禁、不同角色/租户拒绝、退出会话失效 |
| 容器与 secret | 使用选择性 inspect 检查 Mounts/User/ReadonlyRootfs/PortBindings，不输出整个环境；app 无迁移/管理员密码 |
| PWA | 实机信任、安装、独立窗口、版本更新、离线提示及无个人数据缓存 |
| 备份与恢复 | 按备份手册启用、检查副本与隔离恢复；完整注销重放/RTO另验 |
| 监控 | 日志、容量、连接池、任务、5xx；Prometheus 规则文件需接入采集与告警接收方并触发演练 |

日常用 `bill_compose logs --tail=100 app proxy db` 定位，不输出 secret。`/api/v1/metrics` 与 `/api/v1/prometheus` 仅管理员可访问；当前没有已配置机器采集凭据，不能为监控将端点改成匿名。启动可用 `bill_compose up -d app proxy`；维护停止 `bill_compose stop proxy app`；db 单独管理，禁止 down -v 或 docker system prune。

## 6. 备份接入

完整准备、systemd 操作和恢复边界见 [备份恢复](backup-recovery.md)。备份脚本依赖固定容器名、库名、路径及运行中的 app；先备份再停止 app，不能停 app 后直接执行依赖 docker cp 的日常备份。主机 timer 与管理页面状态尚未打通。

## 7. 升级、失败与回退

1. 在隔离构建目录验证新候选，登记旧/新提交、镜像ID、配置、前端摘要、schema版本及变更兼容性；保留旧镜像标签与完整旧目录，不能依赖会被覆盖的默认标签。
2. 用当前脚本生成并验证维护前备份；宣布维护窗口、停止 proxy 阻止新入口。等待正在运行的任务收敛后停止 app。数据库保留运行；后台导出/数据库与文件一致性按恢复手册核查。
3. 将新交付解包到独立待发布目录并校验摘要，不覆盖当前目录中的旧文件。停止相关服务后切换 current，保证 root 所有权与路径约定；若使用符号链接，需重新创建 proxy 才能更新绑定挂载，不能只换链接。
4. 在新 current 构建/加载同一候选镜像，`config --quiet`；升级只运行 migrate，不重跑 bootstrap。执行成功后启动 app，healthy 后启动 proxy，逐项复核登录/读写/租户/静态与SW。
5. 失败时保持入口停服，先保全错误与 schema 状态。未改 schema 或已证明向后兼容时，恢复旧 current、旧配置及旧 app/proxy 镜像，再重建这两个服务验证。不要把构建新产物留在旧 dist 中造成混版。
6. 不兼容迁移不能只退镜像；优先受控 forward-fix。确需数据恢复时进入 [恢复流程](backup-recovery.md)，明确恢复点之后的数据损失及注销审计重放；当前完整生产恢复尚未验收，不能当成一键回滚承诺。

本仓库尚无自动切换、零停机部署或自动回滚脚本。上述升级/回退为操作方案，本次未实操，不写为通过。每次执行后更新对应案例的版本、资源、操作结果与未完成项。
