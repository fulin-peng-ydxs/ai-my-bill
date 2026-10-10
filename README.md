# 我的账单

个人收支管理 PWA。普通用户录入支出/收入、管理个人字典和日常模板、查询明细、处理退款报销、查看报表和导出；系统管理员管理账号、默认字典、运行概况与审计，不能读取个人账目。

一期使用内网 IP + HTTPS。实际地址、服务器和上线验收状态见[内网案例](agent-works/deployment/cases/intranet-single-host/README.md)。系统不提供账户余额、转账和离线记账。

手机安装使用 PWA 的“添加到主屏幕”，无需下载 IPA/APK；操作见下节，实际地址、证书指纹及历史验收结果见[内网案例](agent-works/deployment/cases/intranet-single-host/README.md)。

## 手机安装与使用

以下适用于使用项目内部 CA 的 iPhone/iPad。手机需连接能够访问目标环境的内网；先向运维取得该环境的 HTTPS 地址、根公钥证书 `ca.crt` 和 SHA-256 指纹。不要用本地 HTTP 开发地址安装，也不要从旧案例照搬另一环境的地址或证书。

1. 运维通过受控方式分发 `ca.crt`；使用 Mac 时可选中文件，右键“共享 → 隔空投送”发送到自己的设备。只发送公钥证书，不发送 `ca.key`、服务器私钥或整个证书目录。核对证书来源及本环境指纹，不能只凭相同证书名称判断。
2. 接收并打开证书后，进入“设置 → 已下载描述文件”；没有该入口时查看“设置 → 通用 → VPN 与设备管理”。选择已核对的根证书，点击“安装”，按系统提示输入设备锁屏密码并确认；证书来源或信息不符时停止。
3. 进入“设置 → 通用 → 关于本机 → 证书信任设置”，为该根证书开启完全信任并确认。安装描述文件本身不会自动取得 SSL/TLS 信任，见 [Apple 说明](https://support.apple.com/zh-cn/102390)；列表中没有证书时先核对安装是否完成。
4. 关闭原页面，用 Safari 重新打开本环境 HTTPS 地址，应无证书警告。仍有警告时检查设备日期、安装及完全信任状态，并由运维核对叶证书有效期和 IP SAN；不能以“继续访问”作为通过证据。
5. 在 Safari 点击“分享 → 添加到主屏幕”；系统若显示“作为网页 App 打开”，保持启用。从“我的账单”图标启动，检查独立窗口、登录和基本操作。菜单随系统版本可能不同，见 [Apple 安装说明](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/27/ios/27)。

网页可以直接使用，安装不提供离线记账能力。安装或发布后的离线、版本更新、横竖屏和软键盘验收按[页面复测](#页面复测方式与选择)执行并记录设备及版本；安装成功本身不能证明这些行为通过。证书签发、续期或更换 CA 由运维按[部署手册](agent-works/deployment/runbook.md#3-凭据tls-与终端信任)处理。

登录后在“记一笔”选择支出或收入填写。管理候选可点页头“选项管理”，或进入“我的 → 数据与安全 → 选项管理”；关闭后回原入口。各类管理列表每页最多 20 项，可滑动浏览；顶部显示本页范围与总量，列表末尾可翻页，也可搜索名称定位。底部导航切换保留填写与筛选，刷新和退出仍有未保存保护。

## 快速开始

### 1. 先理解本地会启动什么

开发环境不使用部署服务器，也不要求启动 Docker。`npm run dev` 是总启动命令，由 `scripts/dev.sh` 启动下面三个进程：

| 进程 | 做什么 | 默认入口/数据 | 日志在哪里 |
|---|---|---|---|
| PostgreSQL | 保存本地账号、账目、字典、任务等数据 | 127.0.0.1:54329；库 my_bill_dev；数据目录 .local/postgres | .local/logs/postgres/postgres.*.log；复用已有进程时沿用其日志 |
| Spring Boot 后端 | 登录鉴权、业务校验、数据库读写、后台任务 | http://127.0.0.1:8080/api/v1 | 启动终端及 `.local/logs/backend/application.log`；启动输出见 `launcher.*.log` |
| Vite 前端开发服务器 | 编译 Vue 页面并热更新；代理浏览器 API 请求 | 本机 http://127.0.0.1:5174；同一局域网设备访问 `http://<本机局域网 IP>:5174` | 同一启动终端及 `.local/logs/frontend/dev.*.log` |

本地总启动和单独 `dev:backend` / `dev:frontend` 均自动保存日志。应用日志由 Logback 按 10MB、7 天、归档总量 200MB 轮转；启动器、Vite 与 PostgreSQL 输出按 10MB 分片，各最多 100MB、7 天（启动及写入时清理）。`launcher` 包含 Maven 和应用控制台输出，用于应用尚未启动的失败诊断；它不是另一份长期应用档案。同类本地服务同一日志目录只允许一个启动器，避免application.log多进程冲突；启动失败/退出时回收本次子进程。日志目录权限受本地启动器的 `umask 077` 保护。配置及生产日志入口见[环境架构](agent-works/architecture/environment-configuration.md#日志配置)。

通过 **5174 的页面** 使用账单功能。浏览器请求 `/api/v1` 时，Vite 转给 8080 的 Java 后端，后端再访问 54329 的数据库；浏览器不直接连接数据库。8080 的健康接口用于检查后端，不是前端页面地址。

开发前端默认监听 `0.0.0.0`，方便同一局域网的手机访问；只允许本机访问时，使用 `MY_BILL_WEB_HOST=127.0.0.1 npm run dev`。手机和电脑需连接同一网络，电脑防火墙需允许 5174 端口。此 HTTP 开发入口不能用于手机 PWA 安装；安装使用内网 HTTPS 地址。

记账草稿用于在当前浏览器恢复尚未提交的输入，不等于离线提交账目，默认保留 7 天。手机通过局域网 HTTP 测试地址访问时，浏览器可能不支持账号隔离所需的本地备份能力；本地存储被限制或写入失败时也会提示“草稿自动备份暂不可用”。此时输入仍在当前页面，可直接保存账目，但刷新或关闭后可能无法恢复。请使用正式 HTTPS 入口；可恢复的临时故障可点击“重试备份”。

```mermaid
flowchart LR
  Browser[浏览器 5174] --> Vite[Vite 页面与开发代理]
  Vite -->|/api/v1| Java[Java 后端 8080]
  Java --> PG[(本地 PostgreSQL 54329)]
```

### 2. 检查环境并安装依赖

从仓库根目录执行命令，要求：

- Node.js 24.11.1（见 .nvmrc）、npm 11.6.2；现有脚本会查找当前 Node 或已安装的对应 nvm 版本。
- 完整 Java 21 **JDK**，包含 java、javac；Maven 使用仓库 `mvnw`，不需要另装系统 Maven。找不到 JDK 时设置 JAVA_HOME 指向安装目录。
- PostgreSQL 16+ 可执行工具位于 PATH，包括 initdb、postgres、pg_ctl、pg_isready、createdb、psql、dropdb。不需要预先运行系统的 PostgreSQL 服务。
- 本地首次账号初始化需要 OpenSSL；数据库集成验证还需 Python3。无需 Redis 或其他项目的数据库。

#### macOS 安装示例

以下示例使用 Homebrew 和 nvm；已由公司工具链统一安装时，只需保证后面的版本检查通过，不要重复安装：

```bash
brew install nvm openjdk@21 postgresql@16 openssl@3 python@3
mkdir -p "$HOME/.nvm"
export NVM_DIR="$HOME/.nvm"
source "$(brew --prefix nvm)/nvm.sh"
nvm install 24.11.1
nvm use 24.11.1
npm install --global npm@11.6.2
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
export PATH="$(brew --prefix postgresql@16)/bin:$JAVA_HOME/bin:$PATH"
```

Apple Silicon 与 Intel Homebrew 路径不同，因此使用 `brew --prefix`，不要把 `/opt/homebrew` 写死。需要每次打开终端自动生效时，将 NVM_DIR、nvm加载、JAVA_HOME 和 PATH 配置放入自己的Shell启动文件；先在当前终端验证无误再持久化。

#### Ubuntu 24.04 安装示例

Ubuntu 24.04 官方仓库提供本项目所需的Java21和PostgreSQL16。先按 nvm 官方或组织批准方式安装 nvm，再执行：

```bash
sudo apt-get update
sudo apt-get install --yes openjdk-21-jdk postgresql-16 postgresql-client-16 openssl python3
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm install 24.11.1
nvm use 24.11.1
npm install --global npm@11.6.2
export PATH="/usr/lib/postgresql/16/bin:$PATH"
```

Ubuntu 22.04、Debian及其他发行版若默认仓库没有Java21或PostgreSQL16，应使用该系统官方支持的仓库或组织镜像；不要为了通过检查降级版本。安装后统一核对：

```bash
node --version
npm --version
java -version
javac -version
postgres --version
pg_ctl --version
openssl version
python3 --version
```

安装公开依赖可使用以下已验证方式，单次隔离用户级npm源/代理，不修改全局设置：

```bash
NPM_CONFIG_USERCONFIG=/dev/null npm_config_registry=https://registry.npmjs.org npm run bootstrap
```

bootstrap解析Node/Java工具链，然后执行 `npm --prefix web ci`，按web/package-lock.json安装前端依赖。后端依赖在首次Maven启动时下载，因此第一次启动会更慢。根目录不需要单独npm install。

若已正确配置npm，或环境必须使用组织代理/私有仓库，保留该配置执行 `npm run bootstrap`。registry是包仓库，不是HTTP CONNECT代理；不要把仓库地址直接填为proxy。包下载仍遵循锁文件URL，不关闭TLS或完整性校验。

### 3. 一条命令启动前后端

```bash
npm run dev
```

脚本依次完成：

1. 校验工具链、数据库主机/端口/库名；开发数据库只允许本机。
2. 没有 `.local/postgres` 时初始化本项目集群；数据库端口没有服务时启动它。端口已有 PG 时，检查它的数据目录确实属于本项目才复用。
3. 创建开发库和独立的迁移/应用角色；Flyway 迁移角色负责建表，应用角色负责业务读写。
4. 执行 `./mvnw -q -pl server spring-boot:run` 启动后端，执行 `npm --prefix web run dev -- --host "${MY_BILL_WEB_HOST:-0.0.0.0}"` 启动前端。**这两条已由总脚本执行，不要再重复启动同端口进程。**
5. 后端通过 Flyway 校验/升级开发库，成功后接受 API 请求。任一前后端进程退出，总脚本关闭它启动的其他进程。

在另一个终端检查：

```bash
curl --fail http://127.0.0.1:8080/api/v1/health
```

看到 `status: UP`，并能打开 http://127.0.0.1:5174/login，表示基础服务就绪。Vite 端口冲突可能顺延，实际地址以终端输出为准；不要把“前端 ready”当成后端已启动。

按 Ctrl+C 停止开发环境：脚本停止自己启动的前后端及 PG，保留运行前就存在的 PG，不删除数据库。终端的中断退出码不代表数据库已删除；不要为了重新启动删除 `.local/postgres`。

### 4. 首次如何获得可登录账号

空开发库没有默认密码，不会自动创建业务账号。先让上述开发环境完成建库/迁移并保持运行，再在**第二个终端的项目根目录**执行一次本地初始化。此方式只适用于自己的本机开发库，不连接部署服务器：

```bash
bash
set -euo pipefail
PROJECT_ROOT="$PWD"
source scripts/toolchain.sh
resolve_java
umask 077
# 目录已存在时停止，避免覆盖之前交付的凭据。
mkdir .local/dev-bootstrap
openssl rand -base64 32 > .local/dev-bootstrap/password
openssl rand -base64 32 > .local/dev-bootstrap/pepper
MY_BILL_DB_NAME=my_bill_dev \
MY_BILL_AUTH_RATE_LIMIT_PEPPER_FILE="$PWD/.local/dev-bootstrap/pepper" \
MY_BILL_BOOTSTRAP_USERNAME=admin \
MY_BILL_BOOTSTRAP_PASSWORD_FILE="$PWD/.local/dev-bootstrap/password" \
./mvnw -q -pl server spring-boot:run \
  -Dspring-boot.run.arguments="--bootstrap-admin --server.address=127.0.0.1 --server.port=0"
exit
```

若开发服务使用了自定义库名/PG端口，在该终端同步 MY_BILL_DB_NAME、MY_BILL_DB_PORT；不能只改前端地址。该命令使用本地 trust 连接和已经迁移好的库，临时启动仅监听本机随机端口的初始化进程。初始化入口复用prod配置，因此需提供专用pepper文件；这些前缀变量只影响此次初始化，不会改变已运行开发后端的配置。创建 admin 后自行退出，不取代正在运行的后端。账号库非空则拒绝，不会重置已有账号。

在本地编辑器打开 `.local/dev-bootstrap/password` 获取临时密码（不要提交或贴到日志），访问登录页登录 admin，24 小时内完成首次改密；随后从管理页创建普通用户，用普通账号进入“记一笔”。改密成功后删除本地临时密码文件。服务器的首管理员流程另见[部署初始化](agent-works/deployment/runbook.md#4-镜像迁移和首管理员)，不能复用开发凭据。

### 5. 更换端口或开发库

根 `.env.example` 只是变量示例，`dev.sh` **不会自动加载 .env**。在启动命令前传入环境变量，例如以下组合用于独立调试：

```bash
MY_BILL_DB_NAME=my_bill_docs_debug \
MY_BILL_SERVER_PORT=18080 \
MY_BILL_WEB_PORT=15174 \
npm run dev
```

此时页面为 http://127.0.0.1:15174，API 代理和后端一起改为18080；PG仍是54329，但使用另一个数据库。选用的库名会持久保存，不是每次退出就销毁。旧库校验和错误时，另建空库只能帮助区分环境与代码问题，不能替代分析原库结构，禁止直接 Flyway repair 或清空旧库。

全部变量的消费者、默认值和生效时机见[配置架构](agent-works/architecture/environment-configuration.md)。

## 日常开发与调试

### 前端修改如何生效

保持 `npm run dev` 运行，修改 web/src 下的 Vue、TypeScript 或样式；Vite 会热更新页面。改 Vite 配置、环境变量或依赖后应重启开发命令。日常改页面不需要先 build，也不需要把 web/dist 复制到服务器。

浏览器开发者工具的 Network 页检查 `/api/v1` 请求：先看 URL/状态码，再看响应的 code、message、fieldErrors 和 traceId。Sources 页可在源码映射的 `.vue/.ts` 中设置断点；Console 用于查看前端异常。session store 管登录状态，api/http.ts 统一处理 Cookie、CSRF 和超时，勿在页面另写一套请求方式。

只有想单独运行前端、且后端/数据库已经由其他受控方式运行时才执行：

```bash
npm run dev:frontend
```

该命令只起 Vite，不建库、不起 Java。若 Java 用非默认端口，调用前传相同 MY_BILL_SERVER_PORT。与总启动命令二选一，避免重复占端口；Ctrl+C 只停止该前端。

### 分开启动数据库、后端和前端

需要在IDE中只重启Java，或希望前后端使用不同终端时，可以使用三个独立入口。三个终端必须传入相同的数据库名、数据库端口和后端端口；默认配置可直接执行：

```bash
# 终端1：初始化并后台启动本项目的本地数据库；重复执行安全复用同一集群。
npm run dev:db -- start
npm run dev:db -- status

# 终端2：以前台进程启动后端；Ctrl+C 只停止后端。
npm run dev:backend

# 终端3：以前台进程启动前端；Ctrl+C 只停止前端。
npm run dev:frontend
```

结束调试后，如不再需要数据库进程：

```bash
npm run dev:db -- stop
```

数据库管理脚本只操作 `.local/postgres`，停止不会删除数据；若配置端口被其他PostgreSQL集群占用会拒绝操作。`dev:backend` 不会隐式启动或停止数据库，数据库未就绪时后端会启动失败。仍推荐日常完整联调使用 `npm run dev`，它会在退出时停止本次启动的前后端，以及本次新启动的数据库；运行前已经存在的本项目数据库会保留。

### 后端断点调试

停止原有开发前后端后，可用同一个总脚本加上 Maven JVM 参数启动调试。下例保留独立调试库/端口，Java 调试端口只监听本机5005：

```bash
MY_BILL_DB_NAME=my_bill_docs_debug \
MY_BILL_SERVER_PORT=18080 \
MY_BILL_WEB_PORT=15174 \
MAVEN_ARGS='-Dspring-boot.run.jvmArguments=-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=127.0.0.1:5005' \
npm run dev
```

在 IntelliJ IDEA 中以 Maven 项目打开根 pom.xml，项目 SDK 选择 Java21；新建 **Remote JVM Debug / Attach**，Host=127.0.0.1、Port=5005，然后连接。VS Code 可使用 Java 调试器的 attach 配置连接同一地址。入口是 com.mybill.MyBillApplication，断点可先放 Controller 再逐层到 Service/Mapper。

`suspend=n` 表示不等待调试器也会启动；连接后从15174页面触发对应操作。只验证调试连接可使用 JDWP 握手；IDE按钮布局随版本不同，IDE界面操作需在自己的环境验证。调试端口不得发布到公网或部署环境。

当前开发依赖未提供 Spring Boot DevTools 自动重启。修改 Java 后最稳妥的方式是 Ctrl+C 再启动；IDE 热替换能否处理某次修改由 JVM/IDE 决定，不能假设所有修改即时生效。断点暂停整个 JVM 会导致前端15秒请求超时、任务租约到期或健康检查失败，只在自己的开发库调试任务。

### 接口和数据库如何排查

正常业务调试从浏览器页面触发，确保 Cookie 和 XSRF 由统一客户端携带。401通常是未登录/会话过期，403要区分角色拒绝与CSRF，409检查幂等键/版本冲突，500结合traceId查后端日志。不要为方便调试关闭鉴权或RLS。

本地数据库连接信息是127.0.0.1:54329，库名以启动时配置为准。`my_bill_dev`负责建库管理，`my_bill_migration`负责迁移，`my_bill_app`负责运行。管理账号查询“看得到数据”不能证明租户接口正确；应用角色缺少事务租户上下文时查不到租户数据是隔离设计，验证应通过真实用户API或隔离数据库测试。

## 架构与代码结构

```text
.
├── web/
│   ├── package.json、vite.config.ts   前端命令、开发代理与构建
│   ├── public/                       manifest、图标等直接发布资源
│   ├── src/
│   │   ├── main.ts                   Vue/Pinia/Router装配入口
│   │   ├── app/                      页面元数据登记与契约
│   │   ├── router/                   路由、角色与会话守卫、导航
│   │   ├── views/                    页面：录入、明细、报表、个人设置
│   │   │   ├── admin/                用户、默认字典、概况、审计页面
│   │   │   └── me/dictionaries/       个人字典页面
│   │   ├── components/               可复用表单、列表、抽屉、图表与状态块
│   │   ├── composables/              共享交互/请求状态与未保存提醒
│   │   ├── domain/                   精确金额、筛选、日期、表单与幂等规则
│   │   ├── api/                      各领域请求与统一http客户端
│   │   │   └── generated/            OpenAPI生成类型，禁止手改
│   │   ├── stores/                   唯一session、preferences、theme状态
│   │   ├── storage/                  按账号隔离的本地草稿存储
│   │   ├── auth/、theme/、pwa/        密码规则、主题和安装/缓存策略
│   │   ├── styles/                   设计token及公共样式
│   │   └── sw.ts                     Service Worker入口
│   ├── e2e/                          隔离浏览器关键链路
│   └── dist/                         构建产物，不是开发源码
├── server/
│   ├── pom.xml                       后端依赖、插件与测试开关
│   ├── src/main/java/com/mybill/
│   │   ├── MyBillApplication.java     Spring Boot/独立管理员初始化入口
│   │   ├── auth/                     登录、会话、CSRF、角色与租户事务
│   │   ├── ledger/                   收支、调整、模板、回收站、导出
│   │   ├── dictionary/、preference/   个人字典与偏好
│   │   ├── report/                   摘要、时间趋势和维度聚合
│   │   ├── admin/                    user/dictionary/overview/audit管理能力
│   │   ├── account/                  账号注销、匿名审计、离线恢复重放与文件补偿
│   │   ├── job/                      数据库任务领取、租约、重试与调度
│   │   ├── persistence/              实体映射、MyBatis配置、schema门禁
│   │   └── shared/                   API错误、时间范围、事务/Mapper工具
│   ├── src/main/resources/
│   │   ├── application*.yml           开发基线与生产覆盖配置
│   │   ├── mapper/com/mybill/         各领域运行SQL，Java通过Mapper调用
│   │   └── db/migration/、db/rollback/ schema升级与受控回退材料
│   ├── src/test/                      Java单元、HTTP、数据库/架构测试
│   └── target/                        Maven生成的classes/JAR/测试报告
├── contracts/openapi.yaml             API契约事实源
├── scripts/                          本地启动、工具链、分层检查、候选构建
├── deploy/
│   ├── compose*.yaml                 服务编排、内网覆盖、一次性管理员初始化
│   ├── Caddyfile、Dockerfile.proxy    HTTPS/静态资源/API代理
│   ├── env/、postgres/               非密钥配置模板与数据库角色初始化
│   ├── host-profiles/、profiles/      宿主变更策略与部署模式契约
│   ├── scripts/                      预检、容器入口、备份/隔离恢复、证书激活与巡检
│   ├── tls/、systemd/、monitoring/     CA签发、备份/巡检定时、本机告警与可选监控规则
├── agent-works/
│   ├── initial-development/          初始需求、计划、原型、截图及历史验收（归档）
│   ├── architecture/                 当前技术与环境配置说明
│   ├── deployment/                   通用部署架构、手册、构建、恢复
│   │   └── cases/                    具体环境的服务器/路径/证据
└── .local/                           本地数据、凭据、测试/发布临时产物，不入库
```

### 修改一个功能时从哪里开始

例如“保存支出”：ExpenseEntryForm收集输入 → web/src/api/expenses.ts通过api/http发送 → ExpenseController解析请求 → ExpenseService校验金额、字典归属与幂等 → 租户事务 → ExpenseRepository/ExpenseRepositoryMapper → 对应XML写数据库 → 返回结果并由页面显示成功/字段错误。

新增字段需要同步OpenAPI、生成类型、表单/domain校验、Controller契约、Service、Mapper及相关测试；只有真实存储结构改变时才新增Flyway迁移。修改页面布局查DESIGN和共享组件，修改金额算法先查domain/BigDecimal规则，修改后台任务查job与对应JobDefinition，不在Controller内写长循环。各模块完整机制见[架构索引](agent-works/architecture/README.md)。

## 开发与验证

| 命令（根目录） | 何时使用 | 做什么 |
|---|---|---|
| npm run check | 需要完整工程基线时 | 前端检查/构建、Maven verify、临时PG集成 |
| bash scripts/run-frontend.sh check | 前端完整验证 | 类型、lint、Vitest、OpenAPI漂移和生产构建 |
| npm run check:server | 后端改动 | Java编译/单元/架构测试；默认跳过需独立数据库的用例 |
| npm run check:database | SQL/权限/业务接口链路 | 新建临时PG运行HTTP、迁移、RLS等，结束清理 |
| npm run check:performance | 查询/批处理容量风险 | 临时PG代表性规模数据；不连开发库 |
| npm run check:security | 依赖/安全门禁 | secret与依赖OSV扫描；需网络，不包含容器OS包 |
| npm run check:e2e | 浏览器独有关键链路 | 隔离库与Chromium；需匹配版本浏览器，不使用生产账号 |
| npm run check:ios:simulator | 日常 iOS 模拟器结构与状态检查 | 与真机共用脚本；完整键盘、原生操作和 PWA 须按改动补验 |
| npm run check:ios | 真机触发或发布前的自动检查基线 | 连接与范围见[页面复测](#页面复测方式与选择)；按风险补直接操作与安装版检查 |
| npm run check:deployment | 部署脚本、profile或目标字段变更 | Shell语法、严格字面解析和部署配置负例 |

常规局部修改选择最低充分检查，不默认每次全跑。历史验证证据见[归档验收记录](agent-works/initial-development/pre-release-test-report.md)，不代替当前版本检查；脚本存在与实际执行结果分开说明。构建产物web/dist用于发布，server/target下JAR用于打包，不手工编辑。

### 页面复测方式与选择

页面复测检查真正运行的界面与操作结果；typecheck、lint、Vitest、契约检查和构建属于工程检查，不能代替页面验收。大多数日常复测由 AI 在本机完成，以内置浏览器初筛和 iOS 模拟器为主，不逐次占用用户手机。最低充分验证、真机触发及发布前集中验收的强制条件见 [AGENTS](AGENTS.md#页面改动的复测选择)，布局、主题和关键视口以 [DESIGN §8](DESIGN.md#8-responsive-behavior) 为准。以下方式按改动组合，局部改动不默认检查全页或全部视口。

#### 方式选择

| 方式与入口 | 用途与选择条件 | 能证明什么／证据边界 |
|---|---|---|
| AI 内置浏览器，打开本地实际 Vue 页面并调整视口 | 布局与交互初筛：字号、间距、溢出、响应式、明暗主题、加载/空/错误状态；共享组件检查相关消费者 | 当前浏览器下的页面表现；桌面手机尺寸不能证明 iOS 原生控件、完整键盘或触摸流程 |
| Chromium E2E：根目录 `npm run check:e2e` | 低层测试不能充分证明的稳定关键业务链路；使用脚本创建的隔离数据库与账号 | 以 `web/e2e` 实际用例为准，未覆盖的保存流程不能声称通过；局部样式不新增长期 E2E，Chromium 通过不代表 iOS 通过 |
| iOS 模拟器 Safari WebDriver：`npm run check:ios:simulator` | 日常 iOS 结构与状态检查；操作见[模拟器连接与复测](#模拟器连接与复测) | 只证明脚本覆盖项；模拟器模式使用 DOM 事件检查布局、聚焦、取消和关闭状态，不证明原生触摸命中、完整键盘或安装版 |
| iOS 模拟器 Safari／主屏幕 PWA 原生直接操作 | 输入、候选、原生选择器、滚动和手势；涉及独立窗口时从 PWA 图标启动本次生产构建 | 实际键盘占屏、输入、点选、收起和相应原生控件；符合本阶段要求时可完成日常页面验收，仍须记录设备、runtime 和覆盖范围 |
| 实体 iPhone Safari WebDriver：`npm run check:ios`，结合直接操作 | AGENTS 的真机条件触发或发布前集中验收；连接见[真机连接与自动化](#真机连接与自动化) | 自动检查只证明脚本覆盖项，输入、手势及遗漏行为须直接补验；镜像可辅助，但仅显示电脑键盘工具栏不能证明完整软键盘 |
| 实体 iPhone 主屏幕 PWA，运行本次版本 | 真机问题涉及独立窗口，以及发布前对候选受影响项集中验收；发布后按部署手册核验实际终端 | 真实终端的独立窗口、系统信任及生命周期；旧安装版、Safari 地址栏或模拟器 localhost 不能证明对应版本与部署终端通过，验证不隐含发布授权 |

#### 执行与证据

1. 列出受影响的路由、共享组件消费者、角色、状态和终端行为，按 AGENTS 判断是否触发真机。局部修改检查自身及同类受影响位置；断点变化检查边界两侧，全局样式选择有代表性的表单、列表、报表或管理页面。纯文案等低风险改动不机械增加设备测试。
2. 检查已有服务及端口，在实际页面上按需做内置浏览器初筛，再在模拟器复测，优先匹配目标尺寸与 iOS 版本；默认不请求手机。服务未启动时按本 README 启动，仅停止自己启动的进程，不把调窗口高度当作软键盘。目标版本未覆盖时记录差异；仅本次改动存在对应版本兼容风险且无法用模拟器验证时触发真机，不因版本矩阵不完整阻塞所有日常改动。
3. 明确数据环境：模拟 API/组件夹具适合长名称、大量候选、空态、错误和延迟响应，只证明前端状态；真实接口闭环使用隔离环境和测试账号，确认请求、响应、回显及实际持久化，不用个人或生产数据做破坏性测试。临时夹具与测试数据用完清理或恢复。
4. 按风险运行既有 E2E 和 iOS 自动检查，对脚本未覆盖的变更路由和行为直接补验。普通迭代完成本阶段要求即可；发布前汇总待补的真机检查，对最终候选集中执行，不能用历史版本结果替代。较大改动或真机特有缺陷按触发条件及时补验，并说明具体行为与模拟器证据缺口；提交、预览构建及不影响页面/PWA/终端环境的文档或工具发布不机械触发手机复测。
5. 输入与候选检查：默认展开是否需要键盘、主动搜索是否唤起完整键盘且无意外缩放、候选可见/滚动/点选、选中回显与收起、外部点击/取消/主动收起键盘/重复展开、切下个字段时焦点与草稿、取消是否保留原值、折叠项错误是否自动展开；涉及中文输入时补组合输入及候选确认。原生日期、底部动作和横竖屏按改动检查操作与遮挡。共享弹层检查完整打开、候选展开后一次关闭、未保存确认、取消保留和重复打开，不能塌成横线或留下残余内容。
6. 涉及独立窗口时在模拟器从主屏幕进入本次生产构建，检查相应布局、键盘、安全区；缓存/离线/后台恢复改动检查更新、断网提示、联网恢复和重新进入。发布前真机 PWA 集中验收使用已授权提供同一候选的测试 HTTPS 入口，核对实际加载版本；该入口未就绪时记录候选验收缺口，不用旧生产版本代替，也不为验收自动发布。发布后实际部署地址的终端信任、版本和受影响 PWA 行为按[部署手册](agent-works/deployment/runbook.md#5-验收与观测)核验。缓存命中、SW 接管或安装成功均不能单独记为完整生命周期通过。

回复中记录：**本次源码/构建版本（含未提交变更）、环境与页面 URL、真实接口或模拟数据、操作者/工具、模拟器或真机及系统版本、浏览器/独立窗口、实际步骤、预期与观察结果、通过/失败/未验证及原因**。模拟器自动检查、模拟器原生操作、真机工具实测和用户确认分别标注；只列命令或截图不等于证明操作闭环。最终源码变化时重查受影响项。截图及诊断放 Git 忽略的 `.local`，避开凭据和真实敏感数据；仅在明确要求时维护验证文档，不自动新建报告或续写初始开发资料。

工具受限时先完成 AI 能自主操作的部分，再说明具体缺口；不能因为暂时没有手机而把未触发真机的普通任务整体阻塞，也不能用 DOM、焦点或工具栏推断完整键盘通过。需要真机时仅请求必要的解锁、授权或实体操作，不把整套复测转交用户。锁屏/断连先检查一次可修复前置条件，未恢复时停止重复连接。缺少本阶段必需证据时明确未验证范围，不声称对应验收完成。

#### 模拟器连接与复测

Mac 安装与系统兼容的完整 Xcode，用户完成首次启动许可及必要系统授权，安装目标 iOS runtime，并在 Xcode Device Hub（较旧版本为 Simulator）创建 iPhone 模拟器。Xcode 非默认路径时设置 `DEVELOPER_DIR` 指向其 `Contents/Developer`；脚本在全局仅选中 Command Line Tools 时会为本次进程选择 `/Applications/Xcode.app`，不修改全局 `xcode-select`，不自动接受许可或下载 runtime。

凭据复用下节的 `.local/real-device-test/accounts.md`。在 `.local/simulator-test/config.json` 保存 `deviceUDID` 和可选的 `baseUrl`；默认页面地址为 `http://127.0.0.1:5174`，环境变量 `MY_BILL_IOS_BASE_URL` 可覆盖地址。脚本接受本机、私有/共享 IPv4 或 `.local` 主机的 HTTP 地址及明确端口，真机入口固定为 5174；地址校验不证明后端及数据库属于测试环境，执行前仍须核对代理、数据源和测试账号，禁止指向生产。HTTPS 候选及实际部署地址的 PWA 由直接操作检查。配置优先级见[环境架构](agent-works/architecture/environment-configuration.md#ios-复测配置)。目录权限为 `700`、配置及账号文件为 `600`。在根目录查看可用设备：

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun simctl list devices available
```

复制目标 iPhone 的 UUID 写入配置（占位符须替换），不要把 runtime UUID 当作设备 UUID：

```json
{
  "deviceUDID": "<iPhone 模拟器 UUID>",
  "baseUrl": "http://127.0.0.1:5174"
}
```

前后端及 `/api/v1/health` 就绪后，在根目录执行；脚本校验并启动指定的可用 iPhone 模拟器，保留其他设备与开发服务：

```bash
npm run check:ios:simulator
MY_BILL_IOS_ACCOUNT=admin npm run check:ios:simulator
```

成功判据为退出码 `0`、输出实际设备/系统及 `useSimulator=true`，相应检查通过并生成 `.local/simulator-test/` 截图；不能据此声称原生操作或 PWA 通过。脚本结束后保留模拟器供直接操作，停止自己创建的驱动并删除本次自动化会话。

完整键盘须在 WebDriver 会话结束后检查，在 Device Hub 的 Device → Keyboard（旧版本菜单可能不同）关闭 **Simulate Hardware Keyboard／Connect Hardware Keyboard**，实际点击输入框确认完整键盘出现；直接点屏幕按键、候选和取消/完成，观察视口、焦点及草稿。需要时检查中文输入法，不能把英文输入结果推断为中文组合输入通过。UI 工具可以直接控制模拟器；无法操作的具体项才交给用户。原生点击、滑动及截图证据与 DOM 自动检查分别记录。

独立窗口使用生产构建；普通 `npm run dev` 不注册生产 SW。已有正确预览可复用，否则先启动本地后端并检查预览端口，再在根目录运行：

```bash
MY_BILL_BUILD_ID="simulator-$(date +%s)" bash scripts/run-frontend.sh build -- --outDir ../.local/simulator-test/web-dist
bash scripts/run-frontend.sh preview -- --outDir ../.local/simulator-test/web-dist --host 127.0.0.1 --port 15174 --strictPort
```

预览同源 `/api/v1` 代理到本地后端；模拟器 Safari 打开 `http://127.0.0.1:15174`，通过分享菜单“添加到主屏幕”，从图标启动并确认独立窗口及本次构建。记录对应源码（含未提交变更）和唯一构建标识，通过 Web Inspector 中实际 SW/缓存版本核对；旧页面可能持有旧资源，不能只凭图标或 SW 已接管判定版本。自动结构检查这个地址时使用 `MY_BILL_IOS_BASE_URL=http://127.0.0.1:15174 npm run check:ios:simulator`。localhost 生产预览可用于模拟器 PWA，但不证明真实手机的 HTTPS、证书信任或网络可达。停止预览使用所在终端的 Ctrl+C，仅关闭本次服务；不清空已有 PG、不删除用户安装或草稿。

#### 真机连接与自动化

仅在 AGENTS 的真机条件触发或发布前集中验收时执行本节。将 iPhone 解锁连接 Mac，在手机「设置 → App → Safari → 高级」打开「网页检查器」和「远程自动化」。Mac Safari 的开发菜单应看到该 iPhone；首次配对在手机上信任 Mac。保持亮屏及本地前后端运行，确认手机可访问本机前端地址；Mac `safaridriver` 启动独立测试会话。需要启用远程自动化时由用户完成对应系统授权。排查参考 Apple 的[真机检查](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios)和[远程自动化](https://developer.apple.com/documentation/safari-developer-tools/ios-enabling-webdriver)。

将 `admin` 和 `pengfulin` 的测试密码保存在 `.local/real-device-test/accounts.md`（用户名与密码两列表格）；凭据只从该文件读取，不写入仓库、命令输出或日志。`.local/real-device-test/config.json` 保存手机可访问的 `baseUrl`（`http://<本机地址>:5174`）及可选实体手机 `deviceUDID`；运行前确认地址可达，不沿用历史地址。目录权限 `700`、文件权限 `600`，在根目录执行：

```bash
npm run check:ios
MY_BILL_IOS_ACCOUNT=admin npm run check:ios
```

成功判据为退出码 `0`、输出实际设备/系统及 `useSimulator=false`，相应检查通过并生成 `.local/real-device-test/` 截图。真机入口不能退回模拟器冒充通过；按改动补直接操作与安装版 PWA。镜像与 WebDriver 分开操作，镜像结束后重新确认解锁；电脑键盘模式可能只有输入工具栏，完整软键盘必须实际出现并操作。QuickTime 预览可观察实体操作，不能替代触摸或输入。

两个入口共用 `scripts/check-ios.mjs`：普通账号检查支出/收入横向溢出、日期控件边界，以及支出分类候选边界、240px 高度上限、重复点击收起、主动搜索聚焦、16px 输入字号、可见区域、取消与外部关闭；管理员检查用户页加载及宽度。搜索记录视口状态，仍须单独验完整键盘；[WebKit 说明](https://webkit.org/blog/9395/webdriver-is-coming-to-safari-in-ios-13/)指出 Safari 自动化会话抑制软件键盘。脚本不保存账目，会临时切换测试账号最近记账类型，在成功及可执行清理的失败退出前尝试恢复；强制终止、设备断连或服务不可达时不保证恢复，须在测试账号页面核对，检查不能记为完成。结束时删除本次会话，仅停止自己创建的驱动；断连或远程自动化关闭按受限规则说明具体缺口。

## 部署与排查

开发的Vite不用于正式部署。生产只有三个常驻容器：Caddy提供前端文件/HTTPS并转发API，Java执行后端，PostgreSQL保存数据。角色初始化、迁移、首管理员是一次性工具；备份是宿主定时任务，具体区别见[部署架构](agent-works/deployment/architecture.md)。

### 新服务器如何初始化

从一台已安装受支持Linux、可由root通过严格主机密钥校验登录的服务器开始，可使用交互式入口准备宿主并完成首次部署：

```bash
npm run environment -- configure intranet-main
npm run environment -- inspect intranet-main
npm run environment -- host-plan intranet-main
npm run environment -- host-apply intranet-main
npm run environment -- host-verify intranet-main
npm run environment -- plan intranet-main
npm run environment -- preflight intranet-main
npm run environment -- bootstrap intranet-main
npm run environment -- verify intranet-main
```

向导以安装程序式问答收集宿主模式、软件源、机器、路径、网段和TLS来源，不要求输入生产密码。`managed-linux` 安装缺失的基础工具和Docker/Compose，`existing-linux` 只检查既有或共享主机；两者都不安装操作系统、创建云资源或接管防火墙。初始化入口随后自动运行持续构建、生成服务器secret、建立数据库角色/schema/首管理员、启动服务并配置备份巡检。失败可用同一提交 `resume`，完成首登改密后用 `finalize` 删除服务器初始密码副本。详见[宿主环境准备](agent-works/deployment/host-preparation.md)和[首次环境初始化自动化](agent-works/deployment/environment-bootstrap.md)。

### 前后端代码更新如何发布

当前采用“CI门禁 + 本地持续构建更新入口”。GitHub Actions 仍只做检查，不会自动连接服务器；经授权的运维人员在本机显式执行发布入口：

1. 提交推送后，GitHub Actions执行前端检查/构建、后端验证、临时数据库、性能、安全和浏览器关键链路；通过只代表候选具备发布资格，不会自动部署。
2. 在干净HEAD执行 `npm run release -- build`。入口自动执行完整检查、候选构建、白名单归档和摘要，生成 `.local/releases/<提交>/`；已校验的同提交制品会直接复用。
3. 具体机器只在本机 `.local/deploy-targets/<目标>.env` 描述。先用 `npm run release -- plan intranet-main` 查看无敏感值的计划，用 `npm run release -- deploy intranet-main` 更新一个位置，也可列出多个目标或使用 `--all` 串行更新。
4. 更新入口自动上传并校验同一候选，在目标机保留旧目录/旧镜像、执行维护前备份，构建 app/migrate/proxy，停止入口和应用，执行迁移，原子切换 `current`，依次启动 app/proxy 并验证 HTTPS。升级不执行 provision、首管理员初始化或数据库镜像替换。
5. `npm run release -- status intranet-main` 只读查看版本、Compose状态和HTTPS健康。任一目标失败后不会继续后续位置；迁移已尝试时不会盲目自动回滚，须按迁移兼容性和恢复手册判断。
6. 前端由宿主 `web/dist` 只读挂载到proxy，后端在app镜像内；发布通过重建容器应用新版本，不只替换符号链接或重启旧容器。

该入口只负责已有环境的持续构建更新，不安装Docker、不创建运行配置/secret/TLS/首管理员，也不把当前内网方案扩展成公网部署。目标配置契约见 [`deploy/targets`](deploy/targets/README.md)。详细机制见[持续构建与发布](agent-works/deployment/continuous-delivery.md)、[首次部署、升级与运维手册](agent-works/deployment/runbook.md)和[部署支持边界](agent-works/deployment/architecture.md#10-支持范围与待验收边界)。当前不承诺零停机或数据库自动回滚。

### 日常运维、备份和恢复演练

已初始化环境使用统一入口，不需要复制手册中的长命令：

```bash
npm run ops -- status intranet-main
npm run ops -- health intranet-main
npm run ops -- backup intranet-main
npm run ops -- recovery-drill intranet-main YYYY-MM-DD
```

`backup` 会在服务器生成并校验加密归档，再拉取异机副本；解密私钥首次托管必须单独执行并继续转存组织密钥库。日志可用 `npm run ops -- logs <目标> --service app --since 30m` 查询、`logs-export <目标>` 压缩导出；发布前快照及过程记录用 `logs <目标> --archive latest` 查看。启停、日志、历史副本、校验和安全边界见[统一运维入口](agent-works/deployment/operations.md)，生产覆盖恢复仍按[备份与恢复](agent-works/deployment/backup-recovery.md)的受控流程执行。

公网部署当前仍会被脚本拒绝，不可把内网配置直接开放到互联网；直连域名与可信边缘两种后续模式、必需安全门禁和实现顺序见[公网部署演进](agent-works/deployment/public-deployment.md)。

| 现象 | 检查顺序 |
|---|---|
| 前端ready但登录页请求失败 | 后端日志 → health → Vite代理目标端口；页面就绪不等于后端就绪 |
| 地址/端口与预期不同 | 终端实际地址、端口占用、两侧MY_BILL_SERVER_PORT；不要杀未知进程 |
| npm校验或501错误 | 用户.npmrc源/代理、锁文件版本/URL/摘要，不删除integrity |
| Flyway checksum失败 | 目标库是否选对、迁移源码与历史是否一致；保留旧库分析，不自动repair |
| 账号初始化失败 | 开发服务是否已完成迁移、库是否为空、密码文件是否可读；不要重跑以重置已有账号 |
| 调试断点不命中 | 5005监听、IDE连接的进程、源码是否与运行版本一致、请求是否通过角色/CSRF |
| HTTPS警告或备份状态疑问 | [实际案例](agent-works/deployment/cases/intranet-single-host/README.md)的证书/定时任务证据 |

## 文档导航

[完整目录与维护职责](agent-works/README.md)是文档总索引。常用入口如下：

| 想了解 | 文档 |
|---|---|
| AI协作规则 | [AGENTS](AGENTS.md)、[Claude入口](CLAUDE.md) |
| 一期业务基线与历史开发资料 | [初始开发资料](agent-works/initial-development/README.md)，不追加后续任务 |
| 技术架构 | [架构索引](agent-works/architecture/README.md) |
| 环境变量/secret | [配置架构](agent-works/architecture/environment-configuration.md) |
| 页面规范/接口 | [DESIGN](DESIGN.md)、[OpenAPI](contracts/openapi.yaml) |
| 可复用部署方案 | [部署架构与手册](agent-works/deployment/README.md) |
| 当前服务器与部署结果 | [案例索引](agent-works/deployment/cases/README.md) |
| 历史部署前验证 | [归档验收记录](agent-works/initial-development/pre-release-test-report.md)、[性能](agent-works/initial-development/performance-test.md)、[安全](agent-works/initial-development/security-test.md) |
