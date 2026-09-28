# 持续构建与发布链路

## 当前能力与职责

2026-09-28 按 .github/workflows/ci.yml、package.json、scripts/build-release-candidate.sh 核对。当前 GitHub Actions 提供持续检查，发布候选脚本生成本地制品摘要；没有自动推送镜像仓库、SSH 部署、环境审批或回滚流水线。本文给出开发到运维的交付链路，实际案例记录所使用提交与摘要。

```mermaid
flowchart LR
  Commit[提交与 PR] --> CI[CI 检查]
  CI --> Candidate[干净 HEAD 构建候选]
  Candidate --> Manifest[JAR / dist 摘要与提交]
  Manifest --> Images[目标架构镜像构建与扫描]
  Images --> Release[按部署手册执行]
  Release --> Verify[目标环境验收]
  Verify --> Case[更新部署案例和计划]
```

## CI 已配置的检查

push 与 pull_request 触发 ubuntu-latest 作业，checkout 全历史用于 secret 扫描，Node 按 .nvmrc、Java21，安装 PostgreSQL16 与隔离 Chromium。依次 npm --prefix web ci、npm run check、check:performance、check:security、check:e2e。

| 关卡 | 覆盖 | 不覆盖 |
|---|---|---|
| check | 前端类型/lint/unit/OpenAPI漂移/build、Maven verify、临时PG HTTP/schema/RLS | 生产容器、手机 |
| check:performance | 代表性数据量的查询、导出、清理 | 目标主机并发容量 |
| check:security | 工作区/Git历史高置信secret、npm/Maven依赖OSV | 容器OS包和宿主漏洞 |
| check:e2e | 受控临时库及独立 Chromium 关键路径 | 手机系统安装/CA信任、全部视觉状态 |

CI YAML 存在只证明配置，不等于某次远端作业成功。每次发布保存对应提交的实际执行结果。

## 发布候选构建

在干净的候选仓库根目录执行，源码修改必须先提交：

```bash
npm run build:release -- "$(git rev-parse HEAD)"
```

脚本拒绝非 HEAD 和未提交改动（仅保留已明确的 .gitignore 例外），先 Maven package -DskipTests，再设置 MY_BILL_BUILD_ID=提交号构建前端，写 `.local/release-candidate/<完整提交>/manifest.txt`。构建跳过测试不代表测试已通过，必须先满足上述发布关卡。manifest 与源码同一提交，保存到发布记录，不把 .local 整体入库。

普通检查生成的JAR/dist不自动成为发布候选；只有干净提交、完整关卡、manifest和目标镜像记录形成对应关系后才可交付。

## 交付产物与可追溯性

采用 [手册](runbook.md) 的白名单源码包 + dist 包。生成上传摘要时在交付目录使用相对文件名，目标同目录核对：

```bash
(cd .local/delivery && shasum -a 256 source.tar web-dist.tar.gz > SHA256SUMS)
```

目标端运行 `sha256sum -c SHA256SUMS` 后解包。不要打包开发库、secret、CA 私钥和 node_modules。macOS 附加 ._ 文件会干扰迁移扫描，归档必须禁用附加元数据；目标 tar 使用 --no-same-owner。

当前 Dockerfile 会在 Maven builder 中重新编译 JAR，不是消费本地 build:release JAR；因此目标镜像中的 JAR 摘要必须单独记录并与目标源码对应，不能宣称两次构建字节必然相同。proxy 镜像不包含 dist，需同时保全对应 dist 包。至少记录：源码 SHA、JAR SHA256、前端 manifest/入口摘要、app/proxy/migrate 镜像 ID、PostgreSQL RepoDigest、Compose/环境非敏感版本、schema版本。

现有默认镜像标签可变，不能用 my-bill-app 代替版本证据；发布前为上一版本保存专用标签并保留镜像。若接入 registry，需新增登录 secret、目标平台构建、不可变提交标签/digest、签名或来源证明、扫描门禁和拉取策略；这些当前未实现。

## 发布职责与失败处理

开发负责候选、契约/迁移兼容性、测试与摘要；运维负责主机、秘密、入口、备份和实例执行；验收负责真实 HTTPS、角色/租户、PWA、恢复与告警。没有完整证据不得把计划状态更新为完成。

失败按最早关卡停止：检查失败不出候选；校验失败不解包；迁移失败不启动新 app；健康/安全失败不放入口。回退依赖旧制品和 schema兼容性，见部署手册；不要通过跳过测试、关闭TLS/CSRF/RLS或删除数据库“修复发布”。

验证记录必须区分本地检查、远端CI、镜像扫描和部署验收，并关联同一候选。历史命令结果见[验收记录](../pre-release-test-report.md)，目标环境结果见[案例](cases/README.md)；没有执行的关卡保持未验证。
