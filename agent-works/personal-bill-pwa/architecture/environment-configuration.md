# 环境变量与配置加载架构

## 范围与加载模型

本文说明环境变量从哪里读取、如何进入进程、何时生效，以及密钥如何分发和轮换。开发使用Shell变量与application.yml，部署使用Compose配置和secret文件；用户偏好另存业务数据库，不属于基础设施配置。

```mermaid
flowchart TD
  Shell[Shell 已导出的变量] --> Dev[scripts/dev.sh]
  Dev --> Vite[Vite process.env]
  Dev --> Spring[application.yml 占位符]
  Env[显式 --env-file] --> Compose[Compose 插值与 environment 白名单]
  Compose --> Entry[run-app / run-flyway]
  Secret[宿主机 secret 文件] --> Entry
  Entry --> Prod[prod profile 与数据源环境]
  Preference[(user_preference)] --> UI[用户界面偏好]
```

| 来源 | 谁加载 | 生效与优先级 |
|---|---|---|
| 根 .env.example | 无，纯模板 | 复制成 .env 不会自动使 dev.sh 或 Spring 读取；需调用前显式 export |
| Shell 环境 | dev.sh、工具链、Vite process.env、Spring | 启动时读取；脚本默认值仅在变量缺失/空值时回退，具体以代码为准 |
| application.yml | Spring Boot | 非生产默认、占位符与配置结构；标准 Spring 属性覆盖仍存在，不应手工注入绕过安全配置 |
| application-prod.yml | run-app 强制 prod | 关闭内嵌 Flyway、开启 schema 012 校验、Secure Cookie、文件 pepper；并非任意 Spring 覆盖均有代码硬拦截 |
| production.env.example | 无，纯 Compose 模板 | 必须复制到受控路径并通过 --env-file 指定；当前模板含内网案例值，换实例必须替换 |
| Compose 插值 | docker compose | 当前 shell 同名变量可覆盖 --env-file；environment 只透传列出的字段，env 文件不是整体进入容器 |
| /run/secrets/* | 启动脚本/认证属性 | 文件挂载；run-app 派生 SPRING_DATASOURCE_*，run-flyway 派生 FLYWAY_*，不输出值 |
| user_preference、个人字典 | 业务服务 | 当前账号数据，不覆盖基础设施参数，不构成全局环境变量管理中心 |

`web/vite.config.ts` 直接读取 process.env，不调用 loadEnv 加载根目录模板。前端没有自定义 VITE_* 密钥/连接配置；API 固定同源 /api/v1。MY_BILL_BUILD_ID 只决定构建缓存名，不能运行时通过服务器 env 改已构建资源。

## 用两个例子理解配置实际如何生效

### 开发端口

调用 `MY_BILL_SERVER_PORT=18080 MY_BILL_WEB_PORT=15174 npm run dev` 时，Shell把两个变量传给dev.sh；脚本启动的Maven/Java和npm/Vite继承环境。Java从application.yml占位符取得18080，Vite从process.env取得同一个18080作为代理目标，前端开发命令使用15174。只修改浏览器URL不能修改Java端口；只在某个独立前端终端设置变量，也不会改变已经运行的后端。

### 生产数据库密码

`MY_BILL_APP_DB_PASSWORD_HOST_FILE=/etc/my-bill/secrets/app_db_password` 是宿主路径；Compose把该文件挂到app里的 `/run/secrets/app_db_password`。run-app.sh根据容器内的MY_BILL_APP_DB_PASSWORD_FILE读取内容，再向Java子进程提供SPRING_DATASOURCE_PASSWORD。Java连接数据库，浏览器和proxy都拿不到该密码。

因此有三个不同的值：配置里的宿主路径、容器看到的路径、文件内真正的密码。env示例只保存路径；不能把密码写进“路径变量”，也不能把宿主路径原样当作容器路径。secret名称本身不会加密宿主文件，文件权限和Docker管理权限仍然关键。

### 修改后需要做什么

| 改动 | 需要的动作 | 原因 |
|---|---|---|
| 开发Shell变量 | 停止并重新启动对应进程 | 已启动进程不会读取另一个终端的新环境 |
| Compose env/挂载参数 | config校验后重新创建受影响容器 | restart复用原容器配置，不重新装配environment |
| 数据库密码文件 | 先协调数据库角色密码，再替换文件并重建消费者 | 文件内容和数据库实际密码必须一致；现有连接池可能暂时掩盖不一致 |
| TLS叶证书 | 校验新文件、替换、Caddy reload并从客户端核验 | 文件更新不代表进程已经加载 |
| MY_BILL_BUILD_ID | 重新构建并交付前端 | 这是构建时缓存版本，不是运行期网页参数 |
| 用户偏好 | 通过本人偏好API保存 | 属于业务数据，按业务请求读取，不重启服务 |

操作前后要核对受影响消费者，而不是只确认“文件已经改了”。

## 开发与工具链变量

以下为脚本直接支持的配置；本地连接为开发用途，不将空密码/trust 用于生产。

| 变量 | 默认/约束 | 消费位置与生效 |
|---|---|---|
| JAVA_HOME | 自动查找完整 Java 21 JDK，缺失失败 | scripts/toolchain.sh，启动/检查时 |
| MY_BILL_SERVER_PORT | 8080 | application.yml 与 Vite API proxy；两侧必须一致 |
| MY_BILL_WEB_PORT | 5174 | web/package.json dev；Vite 端口占用可能顺延，核对实际输出 |
| MY_BILL_DB_HOST | 127.0.0.1；dev 只允许本机 | dev.sh 与 application.yml |
| MY_BILL_DB_PORT | 54329，1–65535 | 同上；复用前校验 data_directory 属于本仓库 |
| MY_BILL_DB_NAME | my_bill_dev，受限标识符 | dev.sh 创建目标库；设置新名字不删除旧库 |
| MY_BILL_DB_ADMIN_USER | my_bill_dev | dev.sh 建库建角，不给应用使用 |
| MY_BILL_DB_MIGRATION_USER | my_bill_migration，dev 固定 | 内嵌 Flyway 用户 |
| MY_BILL_DB_MIGRATION_PASSWORD | 空，仅本机 trust | 内嵌 Flyway，不用于生产 migrate 容器 |
| MY_BILL_DB_MIGRATION_URL | 缺省回退应用 datasource URL | application.yml 的 Flyway URL；dev.sh 不验证这个覆盖值，开发时不要指向外部库 |
| MY_BILL_DB_APP_USER | my_bill_app，dev 固定 | 应用连接用户 |
| MY_BILL_DB_APP_PASSWORD | 空，仅本机 trust | application.yml；生产由文件派生 Spring 密码覆盖 |
| MY_BILL_AUTH_RATE_LIMIT_PEPPER | 本地专用弱默认 | 仅非 prod 开发；生产 rate-limit-pepper 置空并读文件 |
| MY_BILL_BUILD_ID | npm_package_version，最终 local | Vite 构建静态缓存名；发布应设置提交号 |

工具链 Node 精确匹配 .nvmrc 的 24.11.1，npm 声明 11.6.2；不是随意用当前 shell Node。工具脚本会查已安装版本，不自动下载。Python 用于验证/备份辅助，未作为独立业务服务。

## 生产 Compose 配置

除标记为宿主配置者，其余通过 Compose environment 进入指定容器；变更后执行 config --quiet 再重建受影响服务，单纯 restart 不重新装配容器环境。

| 变量 | 默认/要求 | 消费者 |
|---|---|---|
| POSTGRES_DB | my_bill；现有备份脚本固定此库名，改名需同时改脚本 | db、provision |
| MY_BILL_MIGRATION_DB_URL | jdbc:postgresql://db:5432/my_bill | migrate；必须与目标库一致 |
| MY_BILL_MIGRATION_DB_USERNAME | my_bill_migration；角色 SQL 固定 | migrate |
| MY_BILL_APP_DB_URL | jdbc:postgresql://db:5432/my_bill | app、bootstrap-admin |
| MY_BILL_APP_DB_USERNAME | my_bill_app；角色 SQL 固定 | app、bootstrap-admin |
| MY_BILL_POSTGRES_ADMIN_PASSWORD_HOST_FILE | 必填宿主文件路径 | postgres_admin_password secret → db/provision |
| MY_BILL_MIGRATION_DB_PASSWORD_HOST_FILE | 必填宿主文件路径 | migration_db_password secret → provision/migrate |
| MY_BILL_APP_DB_PASSWORD_HOST_FILE | 必填宿主文件路径 | app_db_password secret → provision/app/bootstrap |
| MY_BILL_AUTH_RATE_LIMIT_PEPPER_HOST_FILE | 必填宿主文件路径 | auth_rate_limit_pepper secret → app/bootstrap |
| MY_BILL_BIND_IP | 必填本机内网 IPv4，无通用默认 | proxy 发布地址、preflight 参数另行传入 |
| MY_BILL_HTTPS_PORT | 18443 | proxy 宿主端口 → 容器 8443 |
| MY_BILL_ALLOWED_CIDRS | 必填，以空格分隔 CIDR | Caddy remote_ip 来源校验，非登录权限 |
| MY_BILL_WEB_DIST | 必填宿主静态产物目录 | proxy → /srv，只读 |
| MY_BILL_TLS_DIRECTORY | 必填宿主叶证书目录 | proxy → /etc/my-bill/tls，只读 |
| MY_BILL_SERVER_PORT | 8080 | app、proxy 上游与健康检查 |
| MY_BILL_DB_POOL_MAX_SIZE | 5 | app Hikari 最大连接数 |
| MY_BILL_DB_POOL_MIN_IDLE | 1 | app Hikari 最小空闲数 |
| MY_BILL_DB_CONNECTION_TIMEOUT_MS | 5000 | app Hikari 借连接超时 |
| MY_BILL_AUTH_MAX_SOURCE_LOGIN_FAILURES | 50 | app 来源失败限额；当前代理下共享来源 |
| MY_BILL_JOB_POLL_DELAY_MS | 5000 | app 轮询间隔 |
| MY_BILL_JOB_MAX_TASKS_PER_POLL | 20，1–100 | app 单轮任务数 |
| MY_BILL_EXPORT_DIRECTORY | /var/lib/my-bill/exports | app；若改容器路径必须同时调整 volume、备份和恢复脚本 |
| MY_BILL_EXPORT_RETENTION | PT24H | app ISO-8601 Duration，导出保留期 |
| JAVA_OPTS | 内网覆盖固定 -Xms128m -Xmx512m -XX:MaxDirectMemorySize=128m | run-app；在 env 文件改值不会覆盖 Compose 的固定值，需改受控覆盖文件 |
| TZ | 内网覆盖固定 Asia/Shanghai | db/app；与业务显式时区一致，不替代主机 timer 时区 |

MY_BILL_*_PASSWORD_FILE（容器路径）与 *_PASSWORD_HOST_FILE（宿主路径）不能混用。compose.yaml 把容器路径固定为 /run/secrets/{secret 名}；模板中的 MY_BILL_APP_DB_PASSWORD_FILE、MY_BILL_MIGRATION_DB_PASSWORD_FILE 不参与该插值，改模板这些行不会换挂载点。

## 内部变量、一次性配置与测试开关

| 变量/配置 | 入口与作用 | 边界 |
|---|---|---|
| MY_BILL_POSTGRES_HOST、MY_BILL_POSTGRES_ADMIN_USERNAME、MY_BILL_POSTGRES_ADMIN_PASSWORD_FILE | run-roles，缺省 db/my_bill_admin/管理员 secret | provision 短生命周期 |
| MY_BILL_ROLE_MIGRATION_PASSWORD、MY_BILL_ROLE_APP_PASSWORD、PGPASSWORD | run-roles 从文件派生给 psql | 不写入 env 模板、日志或命令参数 |
| MY_BILL_MIGRATION_DB_PASSWORD_FILE、FLYWAY_URL/USER/PASSWORD/LOCATIONS | run-flyway 读迁移 secret 并派生 | 仅 migrate；常驻 app 拒绝 MY_BILL_MIGRATION_DB_* |
| MY_BILL_APP_DB_PASSWORD_FILE、SPRING_DATASOURCE_URL/USERNAME/PASSWORD | run-app 读文件派生 | 常驻进程需要，但禁止输出整个进程环境/完整 docker inspect Environment |
| MY_BILL_AUTH_RATE_LIMIT_PEPPER_FILE | app/bootstrap 认证文件 | 常驻 app 可读，其他不相关服务不可挂载 |
| MY_BILL_BOOTSTRAP_USERNAME、MY_BILL_BOOTSTRAP_PASSWORD_FILE | compose.bootstrap 固定 admin 与 initial_admin_password 文件 | 只在空账号库初始化；常驻 app 拒绝 MY_BILL_BOOTSTRAP_* |
| MY_BILL_ALLOW_EOL_CENTOS7 | preflight 无默认放行 | 唯一已授权实例例外，见案例；不是通用部署开关 |
| MY_BILL_DATABASE_TEST_SUITE | test-database.sh：regression/e2e/performance | 隔离集群测试分支，不进入运行 app |
| MY_BILL_E2E_WRITE、MY_BILL_E2E_EXPECTED_DB_FINGERPRINT | 隔离 E2E seed 写入授权与库指纹 | 错误指纹拒绝写；生产 run-app 拒绝全部 MY_BILL_E2E_* |
| MY_BILL_E2E_BASE_URL | Playwright 临时服务地址 | 只指向受控测试环境，禁止生产 |

YAML 中未额外定义专名环境变量的固定属性包括会话 Cookie 名/12h 时长、BCrypt strength 12、限流15min、任务租约30s、schema 012。Spring 标准属性绑定虽可覆盖，不等于项目批准提供运行时管理入口；修改需代码/配置审查及测试，不绕过 prod 安全基线。

## npm源与代理

安装还受用户级 `~/.npmrc` 影响。registry是包仓库，不是HTTP CONNECT代理，不能把仓库服务地址直接填入proxy/https-proxy。单次命令 `NPM_CONFIG_USERCONFIG=/dev/null npm_config_registry=https://registry.npmjs.org npm run bootstrap` 可隔离用户配置而不修改全局设置。组织网络需要真实代理时由运维提供受控配置，不一律删除用户设置。

锁文件的version、resolved目标版本和integrity必须对应同一发布包。先比对可信HTTPS源元数据，不能靠清缓存或删integrity掩盖源包不一致。

## 文件权限、轮换与故障定位

secret 文件模式 0600；app/migrate 使用 UID/GID 10001，文件属主必须可供其读取。Compose 文件 secret 是绑定挂载，不能靠 uid/gid/mode 声明替代宿主权限。CA 私钥仅留签发端，TLS 叶私钥与备份解密私钥分离。

数据库密码轮换必须同时更新数据库角色和相应文件，并按迁移/应用依赖重建容器；只替换文件可能令连接池后续重连失败。pepper 变更重建 app；叶证书更新需 Caddy reload；备份密钥轮换保留旧解密密钥到旧副本全部过期，不能简单覆盖。操作步骤见 [部署手册](../deployment/runbook.md) 和 [备份恢复](../deployment/backup-recovery.md)。

| 现象 | 排查顺序 |
|---|---|
| 修改 env 没生效 | 是否显式 --env-file → shell 同名覆盖 → Compose 是否透传 → 容器是否重建 |
| secret 不可读 | 宿主文件存在/属主/模式 → 挂载路径 → 容器 UID；不 cat 秘密到终端 |
| prod 启动失败 | 禁止变量 → secret → DB 连通 → schema 版本；不关闭校验绕过 |
| 本地启动 checksum 错误 | 比对迁移历史和源码，另建临时空库验证；禁止自动 repair 旧库 |

## 验证边界

配置验证分三层：静态检查变量是否被入口消费；在隔离环境测试实际生效与拒绝路径；在目标实例核验挂载/权限/启动结果。既有执行证据见验收记录与部署案例，不能用变量表存在代替轮换演练。备份脚本硬编码数据库/容器/路径，迁移到新模式时必须逐项核对，不能只换 env 就声称支持。

## 备份运行状态

`MY_BILL_BACKUP_STATUS_FILE` 指向宿主原子发布的 `backup.properties`；默认空值表示未配置。内网 Compose 将 `/var/lib/my-bill/operations` 只读挂到 `/run/my-bill-operations`，只包含状态与时间，不包含归档、私钥或 Docker socket。生产者使用 UTC 时间，运行概况最多读 4KiB；缺失/损坏返回 UNAVAILABLE，成功超过 26 小时或运行超过 1 小时返回 STALE，最近失败不得被历史成功覆盖。配置修改后重建 app 容器，状态文件更新无需重启。
