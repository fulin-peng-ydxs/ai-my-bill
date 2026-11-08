# 宿主环境准备

## 适用起点与完成边界

本流程从“运维已取得一台可通过严格主机密钥校验、可使用 root 登录的 Linux 服务器”开始，负责安装或核对项目运行所需的宿主组件。它不安装操作系统镜像，不创建云主机、VM、网卡、安全组、DNS或公网地址，也不接管组织的软件源、补丁和防火墙制度。

宿主准备完成只表示 Linux、systemd、Python、Docker和Compose等基础条件满足；应用仍需继续执行[首次环境初始化](environment-bootstrap.md)。真实机器是否执行成功只记录在[部署案例](README.md#部署案例)，不能因脚本存在而视为已安装。

## 抽象与具体配置

`deploy/scripts/prepare-host.sh` 按 `deploy/host-profiles/*.env` 识别系统、生成计划、安装缺失组件并验证；机器取值保存在[部署目标配置](../../deploy/targets/README.md)，默认行为与字段契约以该处为准。`managed-linux` 用于项目专用主机，可安装缺失组件、启用 Docker 和设置时区；`existing-linux` 用于共享、既有或例外主机，只检查、不安装、不启动服务。

## 支持范围

| 系统 | 自动检查 | `managed-linux`安装 | 说明 |
|---|---|---|---|
| Ubuntu 22.04、24.04 | 是 | 是 | apt；官方Docker源或组织预配源 |
| Debian 12、13 | 是 | 是 | apt；官方Docker源或组织预配源 |
| RHEL 9、10 | 是 | 是 | dnf；官方Docker源或组织预配源 |
| Rocky/AlmaLinux 9、10 | 是 | 是 | dnf；官方模式使用Docker的CentOS仓库，属于衍生发行版适配，需逐实例验收 |
| 当前案例中的CentOS 7 | 有界例外 | 否 | 仅指定IP、`existing-linux`和已批准开关同时满足时检查；不推广 |
| 其他系统、容器内systemd、非root SSH | 否 | 否 | 停止并要求新增独立适配与验证 |

最低要求为Docker 24、Compose 2.20、Python 3.8、systemd、2GiB可用内存，以及Docker所在文件系统至少10GiB空闲且使用率低于85%。支持 `x86_64`、`aarch64/arm64`；实际镜像构建仍须与目标架构一致。

Docker官方仓库的配置步骤以[Ubuntu](https://docs.docker.com/engine/install/ubuntu/)、[Debian](https://docs.docker.com/engine/install/debian/)、[RHEL](https://docs.docker.com/engine/install/rhel/)及[Compose插件](https://docs.docker.com/compose/install/linux/)官方说明为依据。脚本不使用面向开发环境的便捷安装脚本。

## 软件源模式

`preconfigured` 是内网推荐模式。运维先按组织制度配置操作系统或内部镜像源，脚本只从该源安装缺失包。Docker尚未安装时，该源需要提供 `docker-ce`、CLI、containerd、Buildx和Compose插件。

`docker-official` 适合允许访问 `download.docker.com` 的专用主机。脚本通过HTTPS取得官方仓库公钥/仓库文件；目标文件已存在但内容不一致时停止，不覆盖未知配置。脚本不会删除Docker、Podman兼容层、containerd或runc等冲突包，发现冲突后由运维核实来源和数据再处理。

两种模式都不会执行全系统升级，也不会升级或替换已经可用的Docker。已有Docker但Compose缺失时拒绝混装，必须按原Docker安装来源补齐。

## 操作主路径

先由向导生成具体目标，再按检查、计划、应用、复核顺序执行：

```bash
npm run environment -- configure intranet-main
npm run environment -- inspect intranet-main
npm run environment -- host-plan intranet-main
npm run environment -- host-apply intranet-main
npm run environment -- host-verify intranet-main
```

`inspect` 输出系统、架构、Python、Docker、Compose、systemd、IP、时区、磁盘和内存事实，不修改服务器。`host-plan` 说明将安装或启用什么；`existing-linux` 始终显示不修改。`host-apply` 仅允许 `managed-linux`，执行前再次确认；非交互执行必须显式添加 `--yes`。`host-verify` 重新读取实际状态，只有全部门禁通过才成功。

成功应用后，服务器保存 `/var/lib/my-bill/operations/host-bootstrap.properties`，只记录profile、系统、架构、组件版本、时区、软件源模式和更新时间，不保存密码或SSH信息。重复执行会保留已满足项；它不是Docker升级入口。

## 安全、网络与失败处理

- SSH固定使用 `BatchMode`、`StrictHostKeyChecking` 和指定 `known_hosts`；脚本不接受首次连接自动信任。
- 宿主防火墙模式当前固定为 `external`。Docker发布端口可能绕过ufw/firewalld的普通规则，项目不能在不了解组织网络的情况下自动改全局规则；入口绑定IP和Caddy来源CIDR仍由应用部署校验。
- 如果包下载失败，修复软件源或网络后重新执行 `host-apply`；不要通过关闭TLS校验或执行在线未知脚本绕过。
- 如果发现未知Docker数据目录、既有Docker缺少Compose、仓库文件不一致或冲突包，脚本停止，不删除软件包、镜像、卷或配置。
- `host-apply` 不支持CentOS 7例外，不把EOL主机变成通用受支持环境。
- 多目标按给定顺序串行；首个失败后停止。每台机器仍须分别保存事实与验收证据。

宿主验证通过后的下一步是：

```bash
npm run environment -- bootstrap intranet-main
```
