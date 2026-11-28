# 我的账单

仅供 iPhone 安装的离线账单 App，使用 Vue 3 + Capacitor + 原生 SQLite。收支录入、字典、模板、草稿、调整、明细、报表及备份恢复均在本机运行，不需要账号、网站或业务服务器。保留原页面布局和交互；当前免费签名 Release 版已由用户完成真机功能验收，量化性能与覆盖升级的专项结论、签名交付范围见[开发计划](agent-works/offline-ios-app/plan.md#t17签名安装升级与最终交付)。

## 离线 iOS App 开发入口

在仓库根目录使用 `.nvmrc` 的 Node 24.11.1 / npm 11.6.2；本地夹具与安全检查使用 Python 3 标准库；原生检查还需要完整 Xcode 27、iOS 27 SDK 及 iOS 27.0 simulator runtime。无需启动旧 Web、Spring Boot 或 PostgreSQL。

首次在仓库根目录安装锁定依赖（也可运行 `npm run bootstrap`）：

```bash
npm --prefix app ci --ignore-scripts
```

日常定位先使用 `npm run debug:ios-app -- list`，按[局部调试流程](agent-works/testing/guide.md#原生局部调试与完整验收)选择最低层检查、单用例或场景。纯逻辑优先 `npm run debug:ios-app -- check --check app-tests --file src/domain/money.spec.ts`；编译与资源问题可单独 check，恢复问题使用 `interruption-阶段` 成对场景。局部验证通过后，仅在影响范围必要时选择下列完整检查；三个原生入口已经包含 check:app，无需为同一轮再单独重复运行它。`IOS_NATIVE_EVIDENCE` / `IOS_TOUCH_EVIDENCE` 必须取自对应局部成功命令输出的 `EVIDENCE=` 路径；多故障修复可重复传入 `--from` 合并独立回执，逐目标检查修复时序；缺少、失效、未覆盖实际失败场景或重复无变化验收会在启动前被拒绝。模拟器和触摸完整检查可按规范借用本轮受管会话，仍重建当前资源、重置合成 App 数据并执行全部门禁。

```bash
npm run check:app
npm run build:ios-app
npm run check:ios-app:simulator -- --from "$IOS_NATIVE_EVIDENCE"
npm run check:ios-app:touch -- --from "$IOS_TOUCH_EVIDENCE"
```

iOS 集中复核可在同一受管会话选择 `ios-review`、`ios-interaction` 或更小的 `ios-candidates`；容量使用独立验收 App 的 `scale-10000` / `scale-100000` 及其子阶段，不替换普通调试账本。范围、预算和真机证明边界见[交互与容量复核](agent-works/testing/guide.md#ios-交互与容量复核)。

依赖由 app/package-lock.json 固定。`check:app` 在同次测试中采集覆盖率并完成类型、随包构建和资源门禁；`build:ios-app` 生成未签名 iPhone Release。所有入口及证据边界见[开发验证规范](agent-works/testing/guide.md#工程检查)，不启动旧 Web/PG。

日常本地优先，模拟器只按变更命中的专项执行；`npm run setup:local -- --base codex/offline-ios-app` 安装本仓库 hook，`verify:local` 只补缺失本地专项，`push:local` 核验证据并发布签名回执。提交与推送不会自行启动模拟器。PR 自动执行固定基础及命中的常规检查，以 `CI common result` 和 `Local evidence result` 作为合并门禁；远端不启动模拟器。定时仅审计 App npm/Swift 锁定依赖，最终候选再集中完成本地完整及指定 iPhone 真机验收。套件登记、生成文档、回执与失败处理的唯一操作说明见[统一验证策略](agent-works/testing/guide.md#统一套件按需-ci-与最终验收)。旧 Web、Java/PG、OpenAPI 和服务器发布入口已退役。

每轮原生日志位于 .local/ios/tmp/ai-agent/native-*，分阶段耗时 timings.json 位于对应的 ios-full-*、调试会话 run-* 或 common/ios-build 的 ios-command-*，分别记录构建、安装和测试；失败先查对应阶段，诊断结束后可删除不再需要的日志，工作区验证状态须保留。`ios-invocation-*` 记录包含工具链前置检查的总预算和耗时，阶段修复后的缓存恢复不解除完整失败锁；详见[局部调试流程](agent-works/testing/guide.md#原生局部调试与完整验收)。增量构建与依赖缓存在 .local/ios/DerivedData、.local/ios/SourcePackages。脚本只为本次命令选择完整 Xcode，不修改全局 xcode-select；非默认安装位置可设置 DEVELOPER_DIR。不要把凭据、真实账本或 Web 本地配置复制到这些测试目录。

签名安装及到期维护见下方[首次使用](#签名安装与首次使用)。当前 Release 0.1.0/build3 已安装于 iPhone 14 Pro Max / iOS 27.2.1，并经用户确认真机功能验收通过；保留制品的签名及摘要已核对，后续改动仅涉及工具回归及文档，App 代码与原生工程保持一致。当前可以调试四个原页面入口、主题、缓存草稿，以及“我的 → 选项管理”中的八类字典与商品合并；这些字典修改跨重启保留，默认清单只写入新账本。支出/收入可保存、连续录入、从原明细入口编辑并撤销适用的本次保存，账目和历史名称快照跨重启保留；明细支持本地组合筛选、快照搜索及每批 20 笔的分组加载，编辑返回保留当前查询和位置。支出/收入草稿按本地数据集分别保存在 SQLite，250ms 合并输入，切后台落盘并跨重启恢复，默认保留 7 天；偏好和主题跨重启恢复，恢复默认不会清除草稿或账目。有效收支可保存为日常模板，同名更新、选择仅回填且清空备注并使用当前时间，失效字段提示后重新选择，移除不删除来源。退款/报销、回收站及有界到期清理已接通；收支总览和日/周/月/季/年时间趋势使用本地统计，支持补零、累计、比较原因及原页面下钻返回；五种粒度及九类支出、五类收入多维报表已在独立模拟器通过对应局部验收，包含价格/频次分析、只读质量线索和原页面下钻返回；数据导出、完整备份、整库恢复和本机清空通过下述本地入口使用；用户真机功能验收不代替量化容量、独立新装及有数据覆盖升级的专项报告，具体交付边界见开发计划。原生装配机制见[总体架构](agent-works/architecture/architecture-decisions.md#离线-ios-原生入口)。

日常先选局部测试；`app-common` 是常用固定工程集合，`pull-request` 自动按变更选择专项并列出延期的容量检查，`change` 为显式变更验收，`app`/`final` 是各自固定的集成/完整候选范围，不会每次提交都全跑。定义及触发见[统一套件与按需 CI](agent-works/testing/guide.md#统一套件按需-ci-与最终验收)，无需设备、独立模拟器及必要/最终真机的选择见[离线 App 设备选择](agent-works/testing/guide.md#离线-app-设备选择)。

原生回归统一从上述根目录命令启动。局部调试使用 `npm run debug:ios-app -- list` 查看单用例和场景，按[局部调试流程](agent-works/testing/guide.md#原生局部调试与完整验收)创建、复用及关闭本轮独立模拟器；局部通过后按必要影响选择完整检查，不因局部绿色自动全跑。日常 NativeTests / DictionaryUITests 仅允许受管模拟器，测试前校验本轮设备归属清单；容量使用独立 Release 的 Capacity scheme，支持模拟器观测及最终目标 iPhone 验收，详见[容量验证规则](agent-works/testing/guide.md#ios-交互与容量复核)。未提供各自有效测试上下文时拒绝探针和页面操作。正式 App 的运行、签名与安装不需要测试清单，详见[测试隔离规则](agent-works/testing/guide.md#工程检查)。

### 本机导出与备份

“明细”的导出图标保存当前筛选 CSV，“我的 → 数据与安全 → 导出全部数据”保存全部 CSV；CSV 用于查看，不用于恢复完整账本。创建完整备份时输入至少 8 个字符的密码，再在系统“文件”选择保存位置。取消保存可重新保存，不改变账本；请另行保管密码，忘记后无法恢复该文件。

从文件恢复时选择 `.mybill` 并输入密码，校验后查看账目、调整和草稿范围，再确认整库替换。备份后的新增/修改不会合并；错误密码或文件校验失败时保留当前账本。清空本机数据需要危险确认，会删除账目、个人配置、草稿、回收站及内部快照，使用当前默认配置创建新账本；已主动保存到“文件”的副本保留。可在“最近数据管理结果”查看状态。

账本与内部快照排除系统备份，换机需依靠已导出的副本。选择“我的 iPhone → 我的账单”仅把导出副本放在本 App 的 Documents，App 内清空保留它，卸载仍会随沙盒删除；需要长期保留时请在“文件”复制到其他位置。格式、文件保护和原子切换机制见[数据管理架构](agent-works/architecture/architecture-decisions.md#离线-ios-原生入口)。

## 签名安装与首次使用

在 Mac 上安装匹配的 Xcode 和 iOS SDK 后，运行 `npm run ios:open`，也可直接打开 `app/ios/App/App.xcodeproj`。在 App → Signing & Capabilities 中选择自己的 Team，连接并解锁 iPhone、完成系统要求的信任与开发者模式，然后由 Xcode 构建安装。账号、密码和系统授权只在 Apple/Xcode 界面操作。免费签名用于开发验证，日常签名及最终交付按当前账号能力维护；`build:ios-app` 生成未签名产物，不能直接安装。

本机签名候选及其安装包、校验值位于 `.local/ios/releases/`，与 Git 源码和原始备份分开保存，不上传凭据或设备描述文件。开发签名包只适用于描述文件覆盖的设备及有效期；重新构建后核对 Bundle ID 与 Team，优先覆盖安装保留容器。到期无法打开时，在 Mac/Xcode 完成有效签名后覆盖安装，不通过卸载解决；签名身份改变时先使用外部完整备份走迁移恢复。免费账号的有效期以实际 profile 为准，不能假定每次构建都会自动延长。

从图标进入后先等待本地账本初始化，成功后显示“记一笔、报表、明细、我的”。新账本可从“选项管理”维护字典，再录入一笔收支并在明细中核对。打开失败保留原账本，沿页面提示重试；不删除数据库解决版本不兼容。

## 代码入口与文档导航

| 入口 | 职责 |
| --- | --- |
| `app/src/views`、`components`、`composables` | 原页面、共享交互与请求状态 |
| `app/src/api`、`domain`、`data` | 本地应用调用、账本类型/精度规则及 SQLite 事务/迁移/查询 |
| `app/src/platform`、`app/ios/App/App` | 原生桥接、生命周期、文件与外观能力 |
| `app/test-support`、`native-tests`、`app/ios/App/NativeTests`、`UITests` | 隔离合成场景、原生 SQLite 与 XCUITest；不进入生产包 |
| `scripts`、`config/ios-ci.json`、`.github/workflows` | 本地工具、套件登记与远端常规/可信回执门禁 |
| [总体架构](agent-works/architecture/architecture-decisions.md) | 本地数据和服务闭环 |
| [环境配置](agent-works/architecture/environment-configuration.md) | 工具链、测试配置、缓存和证据位置 |
| [开发验证规范](agent-works/testing/guide.md) | 最低充分选测、失败处理及模拟器/真机边界 |
| [DESIGN](DESIGN.md)、[AGENTS](AGENTS.md)、[文档索引](agent-works/README.md) | 设计契约、协作要求及历史来源导航 |

`.local/ios/` 保存本地工具缓存与证据；旧 `.local/web/` 和 `server/.local/web/` 私密资料仅保留，不被 App 加载。不要提交真实账本、证书、凭据或备份。原生日志与关闭规则见上述验证规范，失败先缩小到对应阶段，不反复完整运行。

本仓库未声明项目开源许可证；第三方依赖的许可证按锁定依赖及其自带 LICENSE 保留和遵守，不因旧工程退役删除 App 所需许可材料。
