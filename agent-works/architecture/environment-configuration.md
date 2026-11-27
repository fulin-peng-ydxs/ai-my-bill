# 环境与配置加载

## 范围与加载模型

仅面向随包运行的 iPhone App 和本地验证工具。工具链由 `.nvmrc`、根/App package.json 与 Xcode 工程锁定；根 Shell 入口使用 scripts/toolchain.sh 解析已安装的 Node，不安装或检查 Java、PostgreSQL、Docker，不修改全局 xcode-select。本地夹具、资源和安全检查还使用 Python 3 标准库。

App 配置位于 app/capacitor.config.ts，资源来自本包 dist，不配置远程 server.url 或热更新服务。正式偏好、默认项、草稿和数据管理状态保存在原生 SQLite，按账本数据集隔离；配置保护与升级规则见[总体架构](architecture-decisions.md)。根 `.env` 和旧 `.local/web` 不参与 App 配置加载，运行不需要业务服务器。

## 开发与工具链变量

| 输入 | 作用与加载边界 |
| --- | --- |
| `.nvmrc`、package.json | Node 24.11.1、npm 11.6.2；命令解析已安装版本，不自动下载 |
| `DEVELOPER_DIR` | 本次 Xcode 选择；本地允许明确安装路径，远端固定 Xcode 27.0 并核验 SDK，不改全局选择 |
| `IOS_NATIVE_EVIDENCE`、`IOS_TOUCH_EVIDENCE` | 对应局部运行产生的 EVIDENCE 路径；完整验收仍核对来源、范围、时序及失败锁，不能以环境变量代替授权或成功证据 |
| `.local/ios/` | App 缓存、合成测试数据与证据；不与旧 Web 私密资料共用 |

`VITEST_MAX_WORKERS` 由锁定的 Vitest 读取，仅控制本次 App 单测并行数；未设置时沿工具默认，常规覆盖率命令显式使用两 worker。本机资源受限的局部检查可显式设为 `2`，不加载到 App，也不改变测试/原生阶段时限。

## 离线 App 原生测试配置

CI 规划消费 GITHUB_EVENT_PATH、GITHUB_EVENT_NAME、GITHUB_RUN_ID、GITHUB_RUN_ATTEMPT 和 GITHUB_OUTPUT；PR 提供 base/head，手动提供 verification/base_revision，schedule 固定依赖审计。IOS_CI_RESULTS、IOS_CI_GROUP、IOS_CI_ATTEMPT 分别绑定结果目录、平台组与 attempt；IOS_CI_PLAN_STATUS、IOS_CI_CHECKS_STATUS 绑定实际作业，PR 另通过 IOS_CI_IS_PR=true 和 IOS_CI_LOCAL_STATUS 核验回执作业，缺失/失败不能回退成功。普通本地命令使用 --results/--group，不需要 Actions 变量，不加载 `.local/web`。

本地 hook 的仓库/目标分支/原 hook/公钥信息位于 Git 私有目录 `codex/local-gate.json`，其中 hooksPath/hooksState/hookActivation 保存转发目录、内容快照及未完成切换意图；core.hooksPath 指向完整发布的 `.git/codex/hooks-*`，版本化入口仍在 `.githooks`，保留及恢复规则见统一验证策略。私钥仅在 macOS 钥匙串的随机 com.mybill.local-evidence 服务项；本地尝试索引和报告位于 `.local/ios/tmp/ai-agent/`，不进入 App。仓库变量 IOS_LOCAL_EVIDENCE_SIGNERS 是 keyId 到 PEM 公钥的 JSON 映射，不含私钥；IOS_EVIDENCE_HEAD/BASE 用于 PR 只读核验，可信工作流通过 IOS_EVIDENCE_PR 和 IOS_EVIDENCE_PUBLISH=true 读取实际 PR 并发布状态。该可信任务独享 GH_TOKEN 的 contents/pull-requests 只读及 statuses 写权限，普通 PR 代码不得接触写令牌。回执通过 refs/notes/ios-local-evidence 发布，字段及信任边界见[统一验证策略](../testing/guide.md#统一套件按需-ci-与最终验收)。

安全工具固定缓存为 `.local/ios/tools`，下载沿用系统 curl 的 TLS 校验。macOS 远端常规组固定 DEVELOPER_DIR=/Applications/Xcode_27.app/Contents/Developer（Xcode 27.0），运行前核验 SDK，不修改全局选择，不启动模拟器。日常本地按变更选择独立模拟器，远端只做常规/回执/日审计，最终集中本地与真机验收；准确操作、失效及受阻规则统一见上述验证策略。

[进程清理器](../../scripts/lib/ios-processes.mjs)内部传递 `MYBILL_PROCESS_SCOPE`，绑定本次命令树的私有目录、随机令牌和父登记 ID；目录及成员校验由[归属登记](../../scripts/lib/ios-process-scope.mjs)统一处理。它由执行器生成并随子进程环境继承，不从开发配置加载，也不参与验收授权。登记目录为 `.local/ios/tmp/ai-agent/ios-process-*`（700），文件为 600；仅记录 PID 和父子归属，不承载账本、安装回执或缓存。补偿命令经内部启动管道确认登记后才执行；正常关闭回收目录，清理失败保留诊断，不能手工复用旧范围。执行预算和清理规则见[验证策略](../testing/guide.md#统一套件按需-ci-与最终验收)。

原生测试清单 `test-context.json` 由[完整流程](../../scripts/lib/ios-app-full.sh)在 `.local/ios/tmp/ai-agent/native-*` 创建，或由[调度器](../../scripts/ios-app.mjs)在显式创建的 `ios-debug-*` 会话目录维护，文件权限为 600。共同字段为 simulatorId、随机 runId 与固定 appId；局部清单另有 kind/schema/state/name 及运行时可选 scenario，测试方法在设备校验后读取场景，缓存 xctestrun 仍引用该会话清单。

| 配置项 | 来源、传递与消费 | 生效与拒绝边界 |
| --- | --- | --- |
| `MYBILL_TEST_CONTEXT_FILE` | 脚本传给 xcodebuild 的绝对路径构建设置，经两个 scheme 的 TestAction 环境进入测试进程 | [隔离守卫](../../app/ios/App/NativeTests/OwnedSimulatorTestContext.swift)限制清单路径、大小和结构，缺失、损坏、不匹配或非模拟器环境拒绝测试；手工 Xcode 测试不能借用其他会话或已关闭的清单 |
| `SIMULATOR_UDID` | 模拟器测试进程的系统环境，由守卫与清单 simulatorId 比较 | 不是用户指定测试设备的配置入口；设备须由受管命令创建或复用 |
| `MYBILL_FULL_ATTEMPT` | 调度器向内部 Shell 传递当前活动许可及阶段进度目录，common/ios-build 和完整原生入口均消费 | 子流程在生成资源前核对许可与工作区命令锁；外部提供同名变量不能替代有效许可 |
| `MYBILL_FULL_SESSION` | 完整 simulator/touch 显式选择 `--session` 后，调度器传递已校验会话路径，子脚本在重置前再次校验设备 | 未选择会话时调度器清空该内部变量，不接受外部环境注入；借用与新建设备的生命周期按验证规范执行 |
| `MYBILL_APP_ID` / `MYBILL_APP_NAME` | Xcode App 构建设置，默认 `com.mybill.offline` / `我的账单`；Capacity 构建显式传入独立 Bundle / 名称 | Capacity 两个测试 target 的构建前置和运行守卫只接受 `com.mybill.offline.capacity`，不放宽 NativeTests/DictionaryUITests 的模拟器守卫；显示名称用于区分验收 App |
| `MYBILL_CAPACITY_CONTEXT` | 每次容量运行生成 JSON，经临时 xctestrun 传入：runId、mode、deviceId、count、sourceHash、artifactHash，页面/冷启动另绑定 datasetId | 最大 4096 字节，规模仅 10000/100000；测试核对 Bundle、环境和模拟器 UDID。device 模式仅供连接目标手机的可信 Mac；报告继续核对 Release、签名及完整采样，不接受模拟器代跑 |

测试上下文配置不进入 Run/Archive 环境或正式 App 资源；App 身份/显示名构建设置除外，也不读取 `.local/web`。失败锁、证据与阶段预算、分层缓存、安装/沙盒迁移及会话清理的完整规则统一见[原生局部调试与完整验收](../testing/guide.md#原生局部调试与完整验收)；清单缺失负例及实际数据未写入判据见[工程检查](../testing/guide.md#工程检查)。
