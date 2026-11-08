# 持续构建与发布链路

## 当前能力与职责

当前 GitHub Actions 提供持续检查，但不会自动连接环境。经授权的运维人员通过 `npm run release -- ...` 显式执行持续构建更新：统一入口负责本地关卡、候选封装、SSH交付、逐实例更新和健康检查；目标机器信息与通用流程分离。没有自动推送镜像仓库、自动审批、零停机或数据库自动回滚。

```mermaid
flowchart LR
  Commit[提交与 PR] --> CI[CI 检查]
  CI --> Candidate[干净 HEAD 构建候选]
  Candidate --> Manifest[源码 / dist / 摘要与提交]
  Manifest --> Target[选择一个或多个本机目标]
  Target --> Images[目标机构建 app / migrate / proxy]
  Images --> Release[备份 / 迁移 / 原子切换]
  Release --> Verify[目标环境验收]
  Verify --> Case[同步实例当前事实并回复验证结果]
```

## CI 已配置的检查

push 与 pull_request 触发 ubuntu-latest 作业，checkout 全历史用于 secret 扫描，Node 按 .nvmrc、Java21，安装 PostgreSQL16 与隔离 Chromium。依次 npm --prefix web ci、npm run check、check:performance、check:security、check:e2e。

各检查的覆盖与未覆盖项见[工程检查](../testing/guide.md#工程检查)；目标容器、宿主、手机及真实恢复仍由部署验收核对。

CI YAML 存在只证明配置，不等于某次远端作业成功。每次发布保存对应提交的实际执行结果。

## 统一入口与目标分层

```bash
npm run release -- targets
npm run release -- plan intranet-main
npm run release -- build
npm run release -- deploy intranet-main
npm run release -- deploy intranet-a intranet-b
npm run release -- deploy --all
npm run release -- status intranet-main
```

`scripts/release.sh` 调用随候选上传的 `deploy/scripts/apply-release.sh`。目标文件、严格字面解析、秘密边界与 `--all` 顺序统一见[部署目标配置](../../deploy/targets/README.md)，计划和日志不输出运行 secret。持续更新消费 SSH/known_hosts、发布根、服务器环境文件、CA 公钥、HTTPS 健康地址、备份 service/状态文件和 Compose 覆盖；绑定地址、允许网段与本机 TLS 来源由[首次初始化](environment-bootstrap.md)消费，两个入口不互相替代。

## 发布候选构建

在干净的候选仓库根目录执行，源码修改必须先提交：

```bash
npm run release -- build
```

入口拒绝未提交改动，并依次执行 `check`、`check:performance`、`check:security`、`check:e2e` 和 `build:release`。随后生成白名单 `source.tar`、`web-dist.tar.gz`、manifest、构建记录、目标端更新器及 `SHA256SUMS`，保存到 `.local/releases/<完整提交>/`。相同提交仅在全部摘要重新校验通过后复用；不存在跳过门禁开关。manifest 与源码同一提交，不把 `.local` 入库。

经用户明确批准的单次风险例外可由 `MY_BILL_SECURITY_EXCEPTION_FILE` 指向私有JSON审批记录；字段为 `commit/target/host/dependency/approvedAt/expiresAt/reason`，公告使用单个 `id` 或非空且不重复的 `ids` 数组（二者互斥）。记录绑定完整候选HEAD、精确依赖及公告和已获批实例，最长7天，无记录默认严格拦截；其他公告及后续提交不适用。构建记录保存 `securityStatus=accepted-candidate-risk` 和审批摘要，部署重新检查审批与目标，不能记为零漏洞通过。当前白名单仅含 `spring-webmvc:6.2.19` 的 `GHSA-pc63-qcmh-9cmg` 与 `GHSA-j9f9-w8pj-32f8`；每次候选仍须取得对应授权，不提供任意漏洞忽略能力。

审批JSON仅在获批候选构建及部署期间临时保留，默认放系统临时目录并使用私有权限；全部相关操作结束或审批失效后清理，授权依据与发布结果保存在部署案例。日常安全检查生成的 `.local/security` 依赖清单属于可再生扫描输入，不作为过程文档归档。

发布诊断和候选元数据采用私有权限；公开静态资源在候选构建后固定为目录0755、文件0644，保证代理UID10001可读，不因诊断日志的私有umask变成0600。

普通检查生成的JAR/dist不自动成为发布候选；只有干净提交、完整关卡、manifest和目标镜像记录形成对应关系后才可交付。

## 交付产物与可追溯性

入口采用 [手册](runbook.md) 的白名单源码包 + dist 包，摘要只使用相对文件名。目标端先运行 `sha256sum -c`，再检查 tar 不含绝对路径和 `..` 越界项后解包。制品不含开发库、secret、CA 私钥和 node_modules；macOS 附加元数据被禁用，目标解包使用 `--no-same-owner`。

当前 Dockerfile 会在 Maven builder 中重新编译 JAR，不是消费本地 build:release JAR；因此目标镜像中的 JAR 摘要必须单独记录并与目标源码对应，不能宣称两次构建字节必然相同。proxy 镜像不包含 dist，需同时保全对应 dist 包。至少记录：源码 SHA、JAR SHA256、前端 manifest/入口摘要、app/proxy/migrate 镜像 ID、PostgreSQL 上游 RepoDigest 与派生镜像 ID、Compose/环境非敏感版本、schema版本。

现有默认镜像标签可变，更新器会在构建前给旧 app/proxy 镜像增加 `before-<提交>-<时间>` 标签，并把新 app/migrate/proxy 镜像 ID 写入目标版本 `deployment.properties`。数据库镜像升级不属于常规代码持续更新；涉及 `Dockerfile.postgres` 时按数据库维护方案单独执行。若接入 registry，仍需新增登录 secret、目标平台构建、不可变提交标签/digest、签名或来源证明、扫描门禁和拉取策略；这些当前未实现。

## 单目标更新闭环

`deploy` 在没有本提交制品时先自动执行完整 `build`，有制品时重新校验摘要。部署入口在本地构建前只读检查发布根和 Docker 数据目录的可用空间，任一不足 2GiB 即停止；这是最低容量门槛，不保证所有候选的镜像构建/备份容量充足，不自动清理共享主机。随后上传到目标的 `incoming/<提交>`，目标端依次完成：校验归档 → 独立释放目录 → Compose配置检查 → 保留旧镜像 → 构建 app/migrate/proxy → systemd维护前备份并核对本次完成时间 → 停止proxy/app → 执行migrate → 私有备份运行env并将 MY_BILL_WEB_DIST 固定为发布根/current/web/dist → 原子切换current → app健康 → proxy启动 → 限时重试CA校验的HTTPS健康 → 核对HTTPS入口index.html及sw.js与候选摘要一致 → 记录版本、JAR/镜像ID、schema和配置摘要。历史固定前端挂载会随此次完整发布迁移为跟随current；候选Compose始终显式使用候选dist，后续运维重建也读取持久化路径。原env以0600保留在原路径的 `.before-<时间>-<提交>` 文件，不输出secret；迁移后的失败仍须人工判断回退边界。同提交复用也检查前端实际响应和成功部署记录，不能仅凭API健康返回成功。不会执行首次部署的 provision、bootstrap、secret/TLS生成或数据库容器切换。应用与代理启动显式使用 `--no-deps`，数据库配置变更留给独立维护窗口；systemd状态读取解析 `Result=...` 属性，兼容不支持 `--value` 的旧版本。

这是维护窗口更新，不是零停机。每个目标独立完成后才进入下一个目标；因此同批目标可能短时间运行不同版本。`status` 是只读检查，不上传或修改文件。

## 发布职责与失败处理

开发负责候选、契约/迁移兼容性、测试与摘要；运维负责主机、秘密、入口、备份和实例执行；验收负责真实 HTTPS、角色/租户、PWA、恢复与告警。按候选记录实际通过与未验证范围。

失败按最早关卡停止：检查失败不出候选；校验失败不解包；备份失败不停服务；迁移失败不启动新 app；健康失败不放入口。停止服务后但迁移尚未开始的失败会尝试恢复旧 app/proxy；迁移一旦尝试，不自动回切应用或数据库，保持入口状态并按 schema 兼容性、错误证据和恢复手册人工判断。不要通过跳过测试、关闭TLS/CSRF/RLS或删除数据库“修复发布”。

验证记录必须区分本地检查、远端CI、镜像扫描和部署验收，并关联同一候选。工程检查口径见[开发验证规范](../testing/guide.md)，目标环境结果见[案例](README.md#部署案例)；没有执行的关卡保持未验证。

系统包补丁通过重新构建镜像落地，但容器 OS 包扫描与风险审批仍是独立安全门禁：`check:security` 只覆盖依赖与secret，不应被描述为容器扫描。常规持续更新构建 app/migrate/proxy，不替换数据库镜像；数据库补丁发布仍按专项流程构建 `db app migrate proxy`、执行OS复扫、隔离恢复和备份，并保留旧镜像及同一数据库卷。不能在运行容器内临时 apt upgrade，也不能仅凭构建成功宣称漏洞已清零；禁止 `down -v`。

## 明确不包含

持续更新入口要求目标已经按首次部署手册准备完成。它不安装/升级宿主或Docker，不创建目录权限、生产env、secret、TLS、systemd、数据库角色或首管理员，不首次启动空环境，不签发/轮换证书，不自动建设公网入口，也不自动写案例和计划完成状态。首次部署、数据库镜像升级、容器OS扫描处置、破坏性迁移恢复和公网模式分别走对应方案。

## 发布日志保全

候选增加独立 log-archive.sh 校验项及交付文件，执行器在解包前即可保存诊断。apply-release记录整个执行及原始退出码；旧app/proxy停止后、迁移前导出保留窗口快照，失败不进入迁移。若已停止的app/proxy使用json-file但Docker无法解码历史日志，更新器核对容器ID与LogPath后，只读保全日志尾部最多10MiB并标记raw fallback；不修剪Docker文件、不宣称结构化日志正常。运行中的数据库、未知日志驱动或无法保全的路径仍会阻止迁移。重建后当前Docker日志仍由容量轮转管理；历史诊断从共享归档目录读取，权限、容量和查询见[统一运维入口](operations.md#发布快照与历史诊断)。Compose版本元数据来自该制品REVISION，日常start/restart不会把日志版本重置成unknown。

归档成功不替代发布健康/PWA/数据库验收；日志归档是快照而非连续7/30天历史。真实目标轮转、发布归档及故障处置需在部署时另行验收。
