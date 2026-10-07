# 首次部署、升级与运维手册

## 使用前提与参数

本手册面向授权运维人员，描述当前单机内网方案。命令与当前脚本相对应；执行前按案例填写参数，执行后记录退出状态和检查结果，新环境需要独立验收。所有宿主写操作在目标环境身份和备份确认后进行，禁止对其他项目全局清理或重启 Docker。

新空环境优先使用[首次环境初始化自动化](environment-bootstrap.md)：`npm run environment -- configure <目标>` 交互生成具体实例，`preflight` 只读准入，`bootstrap` 执行本手册可自动化部分，失败后用同一提交 `resume`。本手册后续章节仍是脚本实现、人工验收和故障处置的事实依据，不要求运维重复手工执行已经由脚本成功完成的步骤。

准备两端：构建/签发端安装项目 Node、Java、PostgreSQL 工具链和 OpenSSL；目标端先由运维提供受支持且完成更新核查、可root SSH的 Linux，再按[宿主环境准备](host-preparation.md)安装或核对 Docker Engine/Compose v2、bash、OpenSSL CMS、flock、tar、sha256sum、Python3和systemd。`existing-linux`不会改变已有业务机器，`managed-linux`也不会升级既有Docker或删除冲突包。

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

### 命令封装规则

是否封装不只看字符数。满足任一条件的正常操作应进入 `scripts/` 或 `deploy/scripts/`：会改变远端/生产状态；包含三个及以上有顺序依赖的命令；需要重复输入SSH、Compose、CA、secret或路径参数；需要确认、幂等、回退、清理、多目标或证据记录；命令超过约120字符且容易因引号/换行误执行。单条只读诊断、标准工具的短查询、一次性事故取证可留在文档，但必须说明身份、工作目录、成功条件和副作用。

脚本至少做到参数白名单、失败非零、危险动作确认、秘密不回显、仅清理自身资源，并把通用逻辑与 `.local/deploy-targets` 具体机器分开。README只给稳定入口；本文的底层长命令用于解释实现或异常处置，不是要求运维日常复制。当前正常路径分别为 `npm run environment`（宿主与首次建设）、`npm run release`（代码/schema更新）和 `npm run ops`（日常运维、备份与恢复演练）。

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

### 3.1 先确定三个位置

签发端保管 CA 私钥并运行签发脚本；业务主机运行 Caddy，只接收服务器叶证书和叶私钥；手机/电脑只安装 CA 公钥。签发端不参与线上请求，不需要一直开机。当前实例恰好由开发电脑签发，不是项目绑定该电脑；详见[证书职责](architecture.md#证书信任链与签发端职责)。

### 3.2 在另一套独立内网首次部署

以下是未绑定具体主机的操作模板；新环境仍须完成前两节的主机、构建和配置准备，不复制旧环境数据库口令或 CentOS7 风险例外。

1. 确定固定 RFC1918 内网 IPv4、HTTPS 端口、访问范围和负责续签的运维人员。选择受控签发端，准备项目脚本、Bash、支持 `req -addext` 的 OpenSSL 与 Python3。业务主机按通用部署基线准备。
2. 在**签发端项目根目录**设置该环境专用目录并创建 CA。下面的 IP 是示例，必须替换。目录应位于仅运维可访问且不会入 Git/制品的位置；脚本拒绝覆盖已有 CA 或签发输出目录。

   ```bash
   umask 077
   BILL_BIND_IP=192.168.20.10
   BILL_PKI_ROOT="$HOME/my-bill-pki/environment-b"
   BILL_LEAF_DIR="$BILL_PKI_ROOT/issued-$(date +%Y%m%d-%H%M%S)"
   bash deploy/tls/internal-ca.sh init "$BILL_PKI_ROOT/ca"
   bash deploy/tls/internal-ca.sh issue "$BILL_PKI_ROOT/ca" "$BILL_BIND_IP" "$BILL_LEAF_DIR"
   openssl x509 -in "$BILL_PKI_ROOT/ca/ca.crt" -noout -fingerprint -sha256
   openssl x509 -in "$BILL_LEAF_DIR/server.crt" -noout -dates -ext subjectAltName
   ```

   根证书有效期10年，叶证书90天；CA剩余有效期不足93天时脚本拒绝签发。每次签发生成新的叶私钥与随机序列号。`init` 只做一次，续期只执行 `issue`，不能重新 `init` 当作续期。
3. 在**业务主机以 root** 创建 `/etc/my-bill/tls`，属主 `10001:10001`、权限0700。使用已核对主机身份的 SSH/SCP，将签发端的 `server.crt`、`server.key` 分别传到该目录；将公钥 `ca.crt` 传到 `/etc/my-bill/ca.crt` 供健康校验使用。不要传输整个 CA 目录或 `ca.key`。

   ```bash
   install -d -o 10001 -g 10001 -m 0700 /etc/my-bill/tls
   # 完成受控传输后执行：
   chown 10001:10001 /etc/my-bill/tls/server.crt /etc/my-bill/tls/server.key
   chmod 0644 /etc/my-bill/tls/server.crt /etc/my-bill/ca.crt
   chmod 0600 /etc/my-bill/tls/server.key
   ```

4. 在目标机 `/etc/my-bill/production.env` 配好该实例的 IP、端口、来源范围及 TLS 目录，按第4节启动 Caddy。使用 `curl --cacert /etc/my-bill/ca.crt https://实际IP:实际端口/api/v1/health`，应返回健康结果；失败先查 IP SAN、有效期、文件权限和 Caddy 日志，不使用 `-k` 作为通过证据。
5. 给**该环境的客户端**分发 `ca.crt`，核对本环境指纹后安装并完全信任，再用 Safari/浏览器验证 HTTPS 和主屏幕安装。iPhone/iPad 菜单操作见 [README 手机安装与使用](../../README.md#手机安装与使用)；具体地址、证书指纹及终端验收结果记录在本环境案例。
6. 启用巡检定时器并建立本环境案例，登记 CA 指纹、CA/叶证书有效期、签发端保管人和路径、目标路径、客户端验收与下次轮换安排。私钥本身不得写入文档。跨环境 CA 名称可能相同，靠指纹识别。

### 3.3 后续续签、更换与异常处理

正式流程统一使用文末[内部 CA 叶证书轮换](#内部-ca-叶证书轮换)，不与手动覆盖流程混用。巡检每15分钟检查，叶证书距到期30天以内会在宿主日志告警；不会自动调用签发端或发送外部通知，运维需查看并执行轮换。

| 场景 | 运维处理 | 客户端影响 |
|---|---|---|
| 同 IP 叶证书即将到期 | 用原 CA 在新的输出目录执行 `issue`，传输新叶文件，再运行激活脚本 | CA没变，通常无需重装信任 |
| 更换业务 IP | 用原 CA 为新 IP 签发，同时更新实例配置及访问地址 | 信任无需重装，原主屏幕入口可能需按新地址重新添加 |
| 签发端换电脑 | 受控迁移同一 CA 的公钥和私钥、核对指纹，恢复仅授权人员可读权限并更新案例 | 信任不变，服务器不用因此重签 |
| CA 私钥丢失且无可用备份 | 无法继续沿用该 CA 签发；建立新 CA、重签并安排信任迁移 | 所有客户端需安装新 CA |
| CA 私钥疑似泄露或根证书将到期 | 更换 CA、叶证书和密钥，安排终端移除旧信任；当前无自动撤销分发机制 | 需要协调客户端更新，不可只替换服务器文件 |

CA 私钥依靠目录/文件权限和受控备份保管；当前脚本生成的私钥没有口令加密，不应放到共享盘、Git、镜像或普通文件同步目录。保管方案应包含可恢复的受控备份，不能把“电脑暂时离线不影响访问”误解为“电脑丢失也不影响续签”。

## 4. 镜像、迁移和首管理员

以下 Bash 函数在目标项目根目录定义（后续命令同一 shell 使用）：

```bash
bill_compose() {
  docker compose --env-file /etc/my-bill/production.env \
    -f deploy/compose.yaml -f deploy/compose.intranet.yaml "$@"
}
bill_compose config --quiet
bill_compose build --pull db app migrate proxy
# name: my-bill 下 app 默认构建标签即 my-bill-app，bootstrap 使用此标签。
docker image inspect my-bill-app --format '{{.Id}}'
bill_compose up -d db
bill_compose ps
```

等待 db healthy 后，逐条执行，任一失败即停止后续步骤：

```bash
bill_compose run --rm --no-deps -T provision < /dev/null
bill_compose run --rm --no-deps -T migrate < /dev/null
docker compose --env-file /etc/my-bill/production.env \
  -f deploy/compose.yaml -f deploy/compose.intranet.yaml -f deploy/compose.bootstrap.yaml \
  run --rm --no-deps -T bootstrap-admin < /dev/null
bill_compose up -d app
bill_compose ps
```

一次性工具使用 `-T` 并将标准输入接到 `/dev/null`，避免通过 SSH 标准输入执行多行脚本时，Compose 消费后续命令。自动发布更推荐先保存脚本文件再执行，并在未走到最终健康确认时返回非零；不可把正常 EOF 当作发布成功。

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
| 监控 | systemctl/journald 核对15分钟本机巡检：容器、备份新鲜度、证书30天阈值与磁盘85%水位；按隔离故障注入验证。Prometheus 规则仅为后续可选接入模板 |

日常用 `bill_compose logs --tail=100 app proxy db` 定位，不输出 secret。`/api/v1/metrics` 与 `/api/v1/prometheus` 仅管理员可访问；当前没有已配置机器采集凭据，不能为监控将端点改成匿名。启动可用 `bill_compose up -d app proxy`；维护停止 `bill_compose stop proxy app`；db 单独管理，禁止 down -v 或 docker system prune。

日常执行优先使用[统一运维入口](operations.md)的 `npm run ops -- status|health|logs|start|stop|restart`，由脚本加载目标、Compose覆盖、CA与路径并执行确认和健康等待。上面的底层命令保留用于理解和异常处置，不应在正常工作中重新拼接长命令。

## 6. 备份接入

完整准备、systemd 操作和恢复边界见 [备份恢复](backup-recovery.md)。备份脚本依赖固定容器名、库名、路径及运行中的 app；先备份再停止 app，不能停 app 后直接执行依赖 docker cp 的日常备份。主机 timer 的执行结果通过只读状态文件接入管理概况，应用不能读取备份归档或密钥。

日常手工触发使用 `npm run ops -- backup <目标>`，成功后会自动拉取并复核异机加密副本；不要只执行服务器备份而长期忽略异机副本和解密材料托管。

## 7. 升级、失败与回退

1. 在隔离构建目录验证新候选，登记旧/新提交、镜像ID、配置、前端摘要、schema版本及变更兼容性；保留旧镜像标签与完整旧目录，不能依赖会被覆盖的默认标签。
2. 用当前脚本生成并验证维护前备份；宣布维护窗口、停止 proxy 阻止新入口。等待正在运行的任务收敛后停止 app。数据库保留运行；后台导出/数据库与文件一致性按恢复手册核查。
3. 将新交付解包到独立待发布目录并校验摘要，不覆盖当前目录中的旧文件。停止相关服务后切换 current，保证 root 所有权与路径约定；若使用符号链接，需重新创建 proxy 才能更新绑定挂载，不能只换链接。
4. 在新 current 构建/加载同一候选镜像，`config --quiet`；升级只运行 migrate，不重跑 bootstrap。执行成功后启动 app，healthy 后启动 proxy，逐项复核登录/读写/租户/静态与SW。
5. 失败时保持入口停服，先保全错误与 schema 状态。未改 schema 或已证明向后兼容时，恢复旧 current、旧配置及旧 app/proxy 镜像，再重建这两个服务验证。不要把构建新产物留在旧 dist 中造成混版。
6. 不兼容迁移不能只退镜像；优先受控 forward-fix。确需数据恢复时进入 [恢复流程](backup-recovery.md)，明确恢复点之后的数据损失及注销审计重放；隔离演练不等于真实生产覆盖验证，不能当成一键回滚承诺。

### 7.1 已建环境的自动持续更新

普通前后端代码更新优先使用仓库根目录的统一入口：

```bash
npm run release -- plan intranet-main
npm run release -- deploy intranet-main
npm run release -- status intranet-main
```

入口自动完成本节第1至4步中可通用化的检查、制品、上传、备份、迁移、切换和健康验证；具体机器配置位于本机 `.local/deploy-targets`，字段见 `deploy/targets/README.md`。多目标可逐个列出或使用 `--all`，始终串行，首个失败即停止。它不替代首次部署、环境建设、数据库镜像升级、容器OS扫描审批和破坏性迁移恢复。

该脚本是维护窗口切换，不是零停机；也不是自动数据库回滚。迁移前失败可恢复旧服务，迁移一旦尝试就停止自动回切，按本节失败边界处置。已执行证据与未覆盖边界仍记录到对应案例，不能因脚本退出0自动把新环境标记为全面验收完成。

## 内部 CA 叶证书轮换

CA 私钥继续只在受控签发端。执行 `bash deploy/tls/internal-ca.sh issue <CA目录> <内网IP> <新的输出目录>` 签发，向服务器受控暂存目录传送叶证书、叶私钥和 CA 公钥。不要上传 CA 私钥。

目标机 root 执行 `bash deploy/tls/activate-certificate.sh <叶证书暂存目录> <CA公钥路径> <内网IP>`。脚本校验证书链、IP、剩余有效期和密钥匹配，保留旧叶证书，更新后 reload Caddy 并验证 HTTPS；失败恢复旧文件并尝试 reload，回滚 reload 失败写错误日志。激活脚本只清理自身创建的旧证书临时备份，不删除调用者传入的叶证书暂存目录；成功后由运维确认并清理该暂存目录。巡检提前 30 天提示轮换；本方案不依赖 CA 私钥常驻服务器，当前为受控人工触发轮换，不承诺无人值守签发。
