# 内网部署

一期在受控内网以 IP + HTTPS 访问，不发布公网入口。当前仓库提供基础 Compose、内网覆盖配置、代理、CA 签发与只读预检；实际部署等待目标宿主机维护完成。以下不是已上线声明。

## 1. 主机就绪

在目标 Linux 上运行：

```sh
bash deploy/scripts/preflight-host.sh <本机内网IPv4> 18443
```

预检不修改服务器。部署资源基线为：受维护且完成补丁核查的 Linux、Docker/Compose v2、至少 2GiB 可用内存、Docker 所在盘至少 10GiB 空闲且使用率低于 85%、独立未占用 HTTPS 端口；已有 Swarm 需同时核对 ingress 发布端口。发行版匹配只能初筛，不能代替运维补丁和内核维护证明。未识别的受支持发行版需核对后扩展清单，不能跳过检查。

目前提供的主机预检不通过：CentOS 7、根盘使用率 87%。按用户决策由运维维护现有主机后继续。禁止自行重启 Docker、升级/重装宿主机、调整现有 Swarm 或清理其他业务文件/卷/镜像。

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

从 `production.env.example` 创建未入库配置。必须显式设置允许的客户端 CIDR；不能根据一个服务器地址推断所有办公网段均获授权。只发布指定内网 IP 的 HTTPS 端口；数据库和应用不映射宿主端口。不要改用 `docker stack deploy`，本部署采用独立 Compose 项目，不消费既有 Swarm 服务。

- 真实 secret 文件不入库、不经命令行参数输出。Compose 的文件 secret 是 bind mount；`uid/gid/mode` 字段不能替代宿主机文件权限。app/migrate 所需文件由 UID/GID 10001 持有、模式 0600，父目录仅运维可遍历；db/provision 的管理员 secret 只按对应短生命周期用途授予。
- 代理只挂载叶证书；应用只挂载 app 密码及限流 pepper；迁移凭据只给一次性 provision/migrate。
- app 使用只读根文件系统、临时目录和独立导出卷；镜像预先建立导出目录属主，避免首次创建卷后非 root 无法写入。所有常驻服务限额和日志轮转，不修改现有业务配置。
- 应用启动强制 prod，并拒绝 migration 环境变量及所有 `MY_BILL_E2E_*`；不降低 Secure Cookie、CSRF 或租户/RLS 规则。
- Caddy 只接受明确允许的直连来源，不信任客户端转发头。当前应用按代理连接地址执行来源总限流，这是保守共享限额；未配置转发地址信任，不能声称已按各终端来源单独限流。
- `.dockerignore` 使用白名单，构建不得发送 `.local`、密钥和个人文件。部署前重建并记录镜像 digest，不把本地配置校验等同于镜像扫描/运行验收。

启动顺序仍为：只读预检 → 核对候选/镜像/配置/secret → db → 一次性 provision → 一次性 migrate 成功且退出 → 安全初始化首个管理员 → app → proxy → 登录/权限/租户/备份/PWA 验收。首次管理员初始化流程尚待实现，禁止拿开发 seed 或 E2E fixture 替代。

## 4. 备份与恢复边界

用户确认：每天一次、目标 RPO 24 小时、目标 RTO 4 小时，保留 7 个日备份和 4 个周备份；副本只保存在服务器，不建立异机副本。同机备份仅覆盖主机和磁盘仍可读时的逻辑恢复，不覆盖整机/磁盘损坏；该故障下不承诺上述恢复目标。

备份调度、加密/校验/轮转、恢复前保全注销审计、恢复后重放清理、管理端真实备份状态、磁盘/失败告警与恢复演练仍待实现。维护前后不能用“已有计划”标记备份已生效；仅同机副本时不做未经备份核验的破坏性重装。

## 5. 已执行与未执行验证

- `npm run check:server`：后端编译测试及部署入口负例通过；数据库集成按该命令默认开关跳过，本轮无 SQL/schema 变更。
- `python3 scripts/test-intranet-proxy.py <已校验的Caddy二进制>`：在本机临时 CA/回环端口验证 SAN、私钥权限、覆盖保护、HTTPS、SPA、CSP、API no-store/不回退 HTML、转发头移除、非允许来源拒绝。不会安装系统根信任，测试不使用真实服务器数据。
- 目标机 Docker Compose 2.26.1 解析合并配置通过，验证不发布 app/db 端口、内网 IP 绑定、资源限制和 secret 分离；只执行 config，无 build/up。
- `npm run check:security`：工作区/Git 历史 secret 检查及 363 个 npm/Maven 依赖 OSV 检查通过；这不覆盖尚未构建的容器镜像 OS 包。
- 目标机只读预检正确拒绝 CentOS 7 与磁盘 87% 两项。
- 未执行：镜像构建/扫描、真实容器启动、线上 HTTPS/账户登录、手机根信任/PWA、证书续期调度、备份恢复、告警演练。待维护后重新检查，不能据当前配置推断通过。
