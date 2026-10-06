# 首次环境初始化自动化

## 定位与边界

`npm run environment -- ...` 同时承载宿主准备和首次项目初始化，但两个阶段保持独立状态：`host-*` 从可SSH的Linux安装或核对缺失组件，`bootstrap/resume` 把宿主门禁已通过的空服务器初始化为可运行环境。`npm run release -- ...` 只对已经初始化的环境持续构建和更新代码。

宿主阶段不会安装操作系统、创建云资源、防火墙、端口映射或外部DNS；详细支持范围和软件源边界见[宿主环境准备](host-preparation.md)。`bootstrap` 自身仍不安装或升级Docker等宿主组件，门禁不满足时停止并要求先完成 `host-verify`。

## 抽象层与具体实例

| 层次 | 位置 | 内容 |
|---|---|---|
| 通用流程 | `scripts/environment.sh`、`deploy/scripts/bootstrap-environment.sh` | 交互配置、构建、传输、初始化、续跑、验证与收尾 |
| 宿主模式 | `deploy/host-profiles/*.env` | 是否允许修改、Docker/Compose最低版本，不含机器信息 |
| 部署模式 | `deploy/profiles/*.env` | 内网/公网入口类型和实现状态，不含机器信息 |
| 字段契约 | `deploy/targets/example.env` | SSH、路径、入口、TLS来源等允许字段 |
| 具体实例 | `.local/deploy-targets/<目标>.env` | 某台机器的实际取值；被Git忽略，不写入通用方案 |

同一入口可接受一个、多个或 `--all` 目标。多目标按给定顺序串行执行，首个失败即停止；每个目标有独立状态和凭据输出，不共享服务器secret或CA私钥。

当前systemd和secret实现固定使用 `/opt/my-bill`、`/etc/my-bill` 与 `/var/lib/my-bill/operations`；向导会显示并校验这些固定路径。这里的抽象是把机器取值移出通用流程，不承诺任意修改实现内部路径。

## 交互式安装向导

首次配置建议运行：

```bash
npm run environment -- configure intranet-main
npm run environment -- inspect intranet-main
npm run environment -- host-plan intranet-main
npm run environment -- host-apply intranet-main
npm run environment -- host-verify intranet-main
npm run environment -- plan intranet-main
npm run environment -- preflight intranet-main
```

`configure` 使用常见安装程序式问答，逐项采集部署模式、宿主模式、软件源、SSH、服务IP/端口、允许网段、服务器路径、TLS材料和本机初始管理员凭据保存位置。输入会校验；最终先显示不含秘密的摘要，经确认后才写入权限为0600的本机目标文件。已有配置必须确认并先备份，不静默覆盖。

向导不要求输入数据库密码、应用密码或初始管理员密码。服务器端初始化时分别随机生成secret；初始管理员凭据通过已验证SSH通道取回到本机0600 JSON文件且不在终端回显。当前TLS可选择已有叶证书/私钥/CA公钥，或在本机 `.local/pki/<目标>` 创建该环境独立内部CA并签发IP叶证书；CA私钥永不上传服务器。

## 初始化、续跑与收尾

```bash
npm run environment -- bootstrap intranet-main
npm run environment -- status intranet-main
npm run environment -- resume intranet-main
npm run environment -- verify intranet-main
npm run environment -- finalize intranet-main
```

`bootstrap` 会先运行持续构建门禁并复用或生成当前干净HEAD的不可变候选，再上传候选和受控TLS材料。目标端依次执行：候选与主机校验、释放版本、运行配置、随机secret、TLS、镜像、数据库、角色、迁移、首管理员、原子 `current`、app/proxy、首次备份、systemd备份/巡检和HTTPS验收。

目标端在 `/var/lib/my-bill/operations/environment-bootstrap.properties` 记录提交和最后完成步骤。SSH中断或可修复失败后，只能使用同一Git提交执行 `resume`；既有文件必须与本次参数匹配，脚本不会用续跑名义覆盖未知环境。`status` 读取状态，`verify` 做基础验收。完成首登改密并安全保存本机凭据后，再执行 `finalize` 删除服务器上的初始管理员密码副本；该动作不删除本机凭据文件。

自动化通过只表示基础环境闭环成功。客户端CA信任、首登改密、角色/租户、真实终端PWA、访问边界和恢复演练仍需按手册与案例分别验收。

## 公网演进

当前只实现 `intranet-single-host`。`public-direct` 与 `public-behind-edge` 已作为模式契约预留，但入口会明确拒绝执行，避免把内网Caddy配置伪装成公网安全方案。完整分层、门禁和迁移边界见[公网部署演进方案](public-deployment.md)。

公网直连至少要先落地：域名/DNS、80/443入口、ACME和持久化Caddy状态、客户端真实IP策略、管理入口限制、异机备份与外部告警。边缘/CDN前置模式还必须确定供应商、可信代理CIDR、源站认证和边缘到源站TLS。完成这些设计后应新增对应Compose覆盖、预检、验收和profile实现，再复用同一个环境入口；具体域名、云资源和主机仍只放实例配置/案例，不写回通用脚本。

## 安全与失败边界

- 目标配置按白名单 `KEY=value` 字面解析，不执行shell表达式。
- SSH固定启用主机密钥严格校验；没有经可信渠道确认的 `known_hosts` 不继续。
- 归档先校验SHA-256和越界路径；已有运行配置、TLS、release或初始化状态不匹配即停止。
- 空环境初始化不等于灾难恢复；已有数据环境不得使用 `bootstrap` 重新接管或清空。
- 宿主脚本与初始化脚本仅完成本地语法、配置和负向验证；未在新的真实服务器执行本轮宿主安装或初始化，不能把“脚本存在”记作环境部署成功。

## 初始化过程日志

bootstrap/resume/finalize共用发布日志工具和目标互斥锁；过程输出（包括provision/migrate/bootstrap-admin的一次性容器输出）写私有压缩归档，失败也保留退出结果。status/verify不创建归档。工具随候选校验交付；维护执行器临时上传时配套传输并清理工具。初始密码仍经私有文件单独交付，不进入归档。目录、保留与查询见[运维入口](operations.md#发布快照与历史诊断)，不改变本节原有宿主准入与状态续跑边界。
