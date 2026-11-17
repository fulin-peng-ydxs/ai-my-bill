# 开发验证规范

按改动风险选择最低充分检查，覆盖实际入口、处理、结果和适用失败边界。命令均在仓库根目录执行，先满足 [README 工具链前提](../../README.md#2-检查环境并安装依赖)。页面开发前读取本文页面复测部分和 [DESIGN 响应式契约](../../DESIGN.md#8-responsive-behavior)。

## 工程检查

| 命令（根目录） | 何时使用 | 做什么 |
|---|---|---|
| npm run check:app | 离线 App 入口、依赖或资源变更 | Node 24：领域、队列、初始化状态、字典/合并 SQL、组件四态及设计契约测试、类型检查、Vite 构建、Capacitor sync、生成 SPM 兼容适配及资源门禁正反例；不启动 Web/PG |
| npm run build:ios-app | 原生工程/依赖或安装候选资源变更 | Xcode 27 / iOS 27 SDK：未签名真机架构 Release 编译与产物资源检查；不证明签名/可安装 |
| npm run check:ios-app:simulator | 原生 SQLite 桥、外壳及导航变更 | Xcode 27 / iOS 27.0 runtime：独立 iPhone 14 Pro Max 模拟器，hosted XCTest 验随包入口、原生事务/精度/聚合溢出拒绝、正式初始化/升级/seed 保护、八类字典和合并/模板事务、原页面操作、进程中断重开及排除系统备份；清理本轮设备 |
| npm run check:ios-app:touch | 字典页面的原生触摸、键盘、选择器及缓存候选变更 | 独立 iPhone 14 Pro Max 模拟器；正式生命周期初始化后准备空账本专用合成引用，外部 XCUITest 对 Release App 触摸新增/改名/启停/合并及重启，再回读 SQLite；清理本轮设备 |
| npm run debug:ios-app -- list | 最低层检查、原生单用例或单场景定位 | 列出 check 白名单与可选用例/场景；create/run/suspend/close 显式管理本轮独立模拟器，按内容摘要复用构建，结果仅记局部验证 |
| npm run check | 需要完整工程基线时 | 开发配置加载器、部署工具检查、前端检查/构建、Maven verify、临时PG集成 |
| bash scripts/run-frontend.sh check | 前端完整验证 | 类型、lint、Vitest、OpenAPI漂移和生产构建 |
| npm run check:server | 后端改动 | Java编译/单元/架构测试；默认跳过需独立数据库的用例 |
| npm run check:database | SQL/权限/业务接口链路 | 新建临时PG运行HTTP、迁移、RLS等，结束清理 |
| npm run check:performance | 查询/批处理容量风险 | 临时PG代表性规模数据；不连开发库 |
| npm run check:security | 依赖/安全门禁 | secret与依赖OSV扫描；需网络，不包含容器OS包 |
| npm run check:e2e | 浏览器独有关键链路 | 隔离库与Chromium；需匹配版本浏览器，不使用生产账号 |
| npm run check:ios:simulator | 日常 iOS 模拟器结构与状态检查 | 与真机共用脚本；完整键盘、原生操作和 PWA 须按改动补验 |
| npm run check:ios | 真机触发或发布前的自动检查基线 | 连接与范围见[页面复测](#页面复测方式与选择)；按风险补直接操作与安装版检查 |
| npm run check:deployment | 部署脚本、profile或目标字段变更 | Shell语法、严格字面解析和部署配置负例 |

常规局部修改选择最低充分检查，不默认每次全跑；纯文档通常检查差异、引用与事实。检查以实际执行及退出状态判断，数据库测试被跳过不能记为通过。构建产物 web/dist 用于发布，server/target 下 JAR 用于打包，不手工编辑。

App 检查统一从 [ios-app.sh](../../scripts/ios-app.sh) 进入 [命令调度器](../../scripts/ios-app.mjs)，完整检查委托 [完整流程](../../scripts/lib/ios-app-full.sh)，需先按 [README](../../README.md#离线-ios-app-开发入口) 安装 app 锁定依赖。common、ios-build、ios-smoke、ios-touch 四个入口已经在本机 Node24.11.1 / npm11.6.2、Xcode27.0 / SDK27.0 执行通过；原生探针只有受控实验数据，不能证明正式记账、完整升级/恢复、容量或真机行为。金额、时间及文本实现统一位于 app/src/domain；旧 Web 对应模块仅重导出，兼容回归无需启动旧服务。模拟器入口通过 test bundle 调用正式 LedgerDatabase.open→upgrade，在保护快照完成、迁移 SQL/履历已写但事务未提交、升级事务已提交三个阶段分别挂起；脚本动态定位本轮沙盒，观察到匹配阶段信号后仅终止本 App。每次故障步骤须返回预期 65，恢复 XCTest 必须核对已提交基线、版本/结构/履历及重试结果，并回读保护快照排除标记。另外通过原生文件守卫用例验证完整头中 magic 清零的非热 journal 可保留（包括其余头字段仍有值的情况），热 journal、短头和非空 WAL 拒绝复制；正式中断重试用例必须能重新生成快照。原始 SQLite 事务探针不能代替这组正式流程验证；模拟器不验证实体文件保护等级。

App 设计门禁由 [designContract.spec.ts](../../app/src/app/designContract.spec.ts) 经 check:app 同一入口执行：Vue/TypeScript 解析真实导入和模板消费，核对九个核心组件登记、个人页面的唯一角色/路径及实际路由，拒绝私有颜色、注释假导入、缺登记与重复角色反例。21 个关键共享组件模板及三份全局样式的 SHA 基线来自准备提交 6419b93；未作为检查目标的业务消费者仍须按改动复核。四态及初始化重试由组件/状态测试覆盖，不用它们证明原生呈现。

[关闭重试回归](../../app/src/data/ledgerDatabase.spec.ts) 经 check:app 执行，在原生桥边界注入失败，覆盖关闭后禁止读写、保留所有权、重复关闭、直接重开及打开/校验与关闭同时失败的原因链；它不模拟真实 SQL 持久化。check:ios-app:simulator 的 lifecycleProbe 在真实原生库上补充注入关闭拒绝，恢复后调用真实关闭/重开，核对数据集、已提交金额和同名账本交接；故障包装仅存在于 test bundle，finally 恢复，不进入生产入口。

原生 [shellProbe](../../app/native-tests/shellProbe.ts) 在实际 WKWebView 中检查四导航、原图标、切页草稿、主题及抽屉焦点返回。业务尚未接通时，嵌套放弃/取消使用 test bundle 内共享组件夹具，验证父子层与未保存作用域，不冒充账目编辑链路。探针不进入生产资源。日常页面还须在独立小/默认/大 iPhone 模拟器，从 App 图标直接操作导航、表单、完整软键盘、原生选择器、明暗主题、横屏与减少动态效果；记录原页面操作和各自边界，不将脚本派发事件当成触摸验证。未接通功能应显示明确不可用而非假成功。

[字典场景](../../app/test-support/dictionaryScenarios.ts)与[升级场景](../../app/test-support/dictionaryUpgradeScenario.ts)由 Node SQLite 测试及原生 dictionaryProbe 共用，覆盖八类字典、规范化唯一键、两级分类、有界分页、排序故障回滚、类型/引用保护、历史快照、模板冲突（含相同时间下 UUID 有符号高/低位的取舍）、合并幂等及 v1→v2 升级。Node 测试只在原生桥边界换成临时文件 SQLite，不证明 iOS 文件策略，也不进入生产包；原生测试经正式生命周期核验相同 SQL/事务及快照。seed A/B 样本核对用户改名/停用/排序、删除项及 false/0/空值不被新版清单覆盖，并验证必需数据迁移冲突的拒绝、回滚与重试。

[字典详情组件回归](../../app/src/views/me/dictionaries/DictionaryDetailView.spec.ts)挂载正式页面，在 API 边界控制响应顺序，检查末页收敛、补读失败后的重试，以及旧补读晚于新搜索翻页返回时不覆盖新结果或页码；它不替代原生 SQLite 与触摸验证。

[dictionaryUiProbe](../../app/native-tests/dictionaryUiProbe.ts)驱动正式页面与原生 API，核验八类入口、新增/重名保留输入/改名/停用/恢复、预览取消不写入及确认合并。历史账目和模板仅在隔离测试沙盒经原生连接准备，合并后直接读回金额和快照；不启用尚未接通的账目保存、明细或模板 UI。派发事件证据还须配合模拟器图标启动后的实际触摸、键盘和页面核验。

NativeTests 与 DictionaryUITests 只支持 simulator SDK，并由共享 [OwnedSimulatorTestContext](../../app/ios/App/NativeTests/OwnedSimulatorTestContext.swift) 在注入探针或启动 UI 操作前核对本轮设备；物理设备测试编译直接拒绝。生产 App 不编译守卫、不读取清单。清单来源及传递见[环境架构](../architecture/environment-configuration.md#离线-app-原生测试配置)，不手工绕过 Xcode 直接测试的拒绝。原生守卫用例覆盖平台、缺失/不匹配设备、路径、App ID、大小及无效内容；touch 脚本另在本轮空模拟器对两个入口去掉清单，要求具体用例以隔离守卫错误失败、xcodebuild 返回 65，再只读确认业务行未增加。普通测试失败返回 65 不能充当该负例成功。

脚本先构建、安装并等待专用模拟器正式账本完成初始化，结束宿主后再执行测试，以分离首次运行时准备；准备有界等待不属于冷启动性能测量，也不改变原生入口 20 秒等待和单用例 60 秒预算。自动回归的 TestAction 不挂载调试器，日常 Run 调试设置保持；正式性能验收仍按目标真机 Release 规则执行。

[原生触摸用例](../../app/ios/App/UITests/DictionaryTouchTests.swift)由独立 DictionaryTouch scheme 执行，使用 XCUITest 的 tap/typeText/原生选择器操作 Release App，不注入 JavaScript、不替换业务 API。与 hosted XCTest 的 DOM 事件场景分别记录，不将两者混称为真实触摸。check:ios-app:touch 先验证正式初始化并结束宿主，再用[受限夹具](../../scripts/fixtures/dictionary-touch.py)准备本轮空模拟器账本的历史引用；夹具拒绝已有自定义数据，不清空、不连接真机。缺少归属清单的预期拒绝完成后，先重启同一受管模拟器以释放 UI runner 会话，再准备正例夹具；设备 UUID、账本和清单保留。原有 11 项 UI 用例顺序共用本轮交互会话，各用例保留截图，最后验证重启；回读后追加 21 项商品/单位夹具，以另 4 项用例验证搜索末页合并、启用筛选末页停用后的有效页回退及条件保留，再只读核验结果。脚本结束 App 后回读稳定 ID、引用、模板、行版本、金额、名称快照、事件和幂等回执，执行完整性及外键检查；用例按操作链路拆分并保留原 60 秒执行预算配置，不上调超时；改名与局部键盘准备输入后以 3 秒有界等待核对 AX 精确值，不重放输入或改写页面；搜索收键盘只选择当前可触摸的“完成”按钮，并断言键盘消失，拒绝遗留的同名 AX 节点；合并保留商品的“请选择”提示值不依赖 AX label，以截图定位后原生触摸；触摸定位仍可用本机 Vision OCR 定位截图文字，再由 XCUITest 坐标触摸，不将 OCR 通过作为无障碍验收。此流程只证明开发模拟器的页面链路，不代替目标真机性能和最终交付。

资源门禁使用锁定的 TypeScript 解析器检查 JS/MJS/CJS 及内联脚本，拒绝已知 IndexedDB、Web Storage、WebSQL、WASM 的直接标识符、别名来源与静态括号访问；合法注释及文案不作为调用。该静态检查不证明所有动态间接访问不可达，正式数据入口仍须通过原生集成验证。正反例通过同一门禁入口执行。

每轮 build.log/test.log、interruption-阶段/recovery-阶段 日志、阶段回执及 xcresult 位于 .local/ios/tmp/ai-agent/native-*；失败不冒充成功，模拟器清理失败也返回失败。原生缓存与产物留在 .local/ios，不复用 .local/web。既有 check:ios 与 check:ios:simulator 仍是旧 Web/Safari 路径，不应用来代替这组原生测试。

离线 App 日常调试与回归优先使用独立的 iPhone 模拟器，真实原生 SQLite 桥测试仍在 iOS 模拟器内执行。真机仅用于模拟器无法覆盖的必要问题及最终候选验收；必要提前验证须说明覆盖缺口。D07 的设备/Release/采样与硬指标保持不变，模拟器观测不替代最终真机结果。T14 先完成执行器与模拟器开发验证，真机容量及辅助功能/硬件复核集中在 T17，未执行前保留待验证。

### 原生局部调试与完整验收

先在能证明问题的最低层定位：纯领域、组件与执行器问题先用 Node/Vitest；桥接或页面触摸问题再运行对应原生单用例/场景。局部通过且相关源码稳定后，仅在影响范围确有必要时执行一次完整验收；共享脚本变化不自动要求重跑全部页面。以下规则由 [ios-verification.mjs](../../scripts/lib/ios-verification.mjs) 与根目录统一入口强制执行，适用于本机和 CI，不提供 force/skip/CI 环境变量绕过：

| 条件 | 实际执行约束 |
| --- | --- |
| 首次启动 simulator/touch 完整验收 | 必须提供 `--from RUN_DIRECTORY`，指向本工作区受管局部运行的当前版本成功回执（ios-check-* 或会话 run-*）；先校验回执、实际用例通过日志、范围、完成时间及输入摘要，再允许生成资源和启动完整工作 |
| 正例出现失败或执行时间告警 | 每 100ms 观察正例日志；发现首个失败立即终止本次进程组并执行清理，不继续后续测试阶段；记录失败用例及日志路径，下一步只能先局部定位 |
| 完整验收失败、取消或宿主中断 | 工作区状态保留失败/未完成锁；旧回执、失败之前的回执、无关用例以及改跑另一完整套件均拒绝。失败的用例、具体场景、Vitest 精确目标、资源目标或构建/安装阶段必须由新局部成功证据覆盖；首次完整验证及完整失败后的局部新故障也须有相关修复证据；当前输入的各套件结论从完整历史取得，不能以其他输入后来通过覆盖旧输入的失败；不将无用例名称的失败降级成任意原生烟测，缺入口先补入口 |
| 同一输入复验再次失败 | 每个输入和故障事件只允许初验加一次相关局部证据解锁的复验；A→B→A 保留 A 的历史次数。再次失败/中断后须修正相关输入并重新局部验证，不能靠换输入再切回或刷绿色重置次数 |
| 完整验收已通过且输入未变 | 默认拒绝再次启动。若通过后实际观察到同输入的新局部失败，须记录真实失败事件，并在其后取得覆盖全部相关目标的新成功回执，才开放该故障事件的复验；空匹配、取消、旧证据或无故重跑绿色不能解锁。README、规范措辞和生成物不使完整证据失效 |
| 分阶段超时 | 所有根目录入口（含 common / ios-build）的单次构建 10 分钟、显式安装 2 分钟、设备启动 2 分钟、初始化 1 分钟、非原生检查 5 分钟；build-for-testing、simctl install 和 test-without-building 分开计时并写 timings.json。测试启动/用例交接等待 180 秒，单用例仍为 60 秒；预期中断准备为 120 秒。XCTest 可能再次校验或安装 runner，其耗时属于测试准备，不包含编译 |
| 整轮超预算 | 调度器从入口建立单调时钟截止时间，SDK、runtime、Xcode 查询、证据检查及后续构建/执行共用剩余预算，不在进入验收体时重新计时。原生完整验收及 debug 调试命令为 15 分钟；common / ios-build 为 40 分钟。其中每个构建/检查阶段仍分别受 10/5 分钟限制，单条工具链查询最多 5 分钟，实际取阶段/子命令上限与整轮剩余时间的较小值。超时终止后最多再给清理 10 秒；各阶段预算仍独立生效，不延长预算换取绿色 |

输入摘要覆盖 App、测试/探针、工程、依赖锁、Node、宿主系统/架构，以及执行器、夹具和资源门禁；原生证据另绑定 Xcode、iOS SDK 与模拟器 runtime build，Node 检查不要求安装 Xcode。局部构建缓存与执行证据摘要分别维护，不因夹具修改无谓重编原生包。`.local/ios/tmp/ai-agent/ios-verification-state.json` 与 `ios-full-*/result.json` 保存尝试、来源证据、失败锁和次数；schema 2 保留全部历史及新局部失败事件，从 v1 合并已有逐轮回执并保留次数，不因关闭调试会话删除。禁止删除状态、换会话/工作目录或直接调用内部 Shell 规避限制，也不得用无关注释/格式改动刷摘要重置次数；内部 Shell 在生成资源前核对调度器活动许可。进程被 SIGKILL 留下 running 状态时按未完成处理，不自动放行。

完整检查不接受单用例过滤，仍重新生成资源、执行原范围与门禁；默认新建独立模拟器，也可通过 `--session` 借用本轮受管设备。局部证据只用于启动资格，不替代完整结果，也不消费旧测试结果。多个故障分别修复时，可以重复传入 --from（1 至 32 份）；每份回执均须匹配当前输入及适用环境，重复路径、失败/过期回执拒绝。覆盖按每个目标自己的最近失败时间判断，允许先修 A 再修 B，无须因 B 后来失败而重跑已修复的 A；不能用无关新回执搭配目标的旧回执解锁。CI 使用同一约束：先执行最低层 App 测试取得新回执，再进入原生完整验收并 finally 关闭会话；失败时按对应目标局部修复，不增加无关原生烟测。

无需模拟器的局部检查由 [ios-checks.mjs](../../scripts/lib/ios-checks.mjs) 白名单统一定义，命令、失败目标和证据校验同源：

```bash
npm run debug:ios-app -- list
npm run debug:ios-app -- check --check app-tests --file src/domain/money.spec.ts
# --name 为 Vitest 的 testNamePattern；必须实际命中并通过，不接受零用例
npm run debug:ios-app -- check --check app-tests --file src/domain/money.spec.ts --name 'multiplies price and quantity'
npm run debug:ios-app -- check --check script-tests
npm run debug:ios-app -- check --check app-build
npm run debug:ios-app -- check --check probe-build
npm run debug:ios-app -- check --check resources --target source
# simulator/device 资源检查需要对应 Release 产物；编译故障可不启动模拟器
npm run debug:ios-app -- check --check native-build --scheme App --configuration Debug
npm run debug:ios-app -- create
```

Vitest 精确修复回执只覆盖报告中实际通过的测试；只有无过滤且整组通过才覆盖 check/app-tests。资源检查区分 source/simulator/device；原生构建区分 App/Debug 与 DictionaryTouch/Release，安装与初始化故障通过相同目标的原生局部运行重做该阶段，不能仅用命中缓存代替修复证据；实际重做并通过后恢复局部缓存，故障记录仍保留用于判断必要复验。缓存恢复独立记录在 schema 2 的可选 cacheRepairs 中，按当前输入、原生环境及构建/安装/初始化阶段匹配；回执须晚于该阶段完整失败时间，旧输入、其他环境、错误阶段和工程检查均不能恢复缓存。再次完整失败会使此前缓存修复失效。恢复缓存不会修改完整失败状态、次数或跨套件限制；若后续局部命中缓存，应保留并通过 --from 提供之前真正重做失败阶段的回执，不能用缓存命中冒充新的阶段修复。

create 输出 `SESSION=...` 与本轮模拟器 UUID。将输出的绝对会话路径保存到当前终端变量 `IOS_DEBUG_SESSION`，再执行以下命令；不能填入用户已有设备或其他轮次的 native-* 目录。

```bash
npm run debug:ios-app -- run --session "$IOS_DEBUG_SESSION" --case NativeTests/NativeSqliteTests/testRejectUnownedTestContexts
npm run debug:ios-app -- run --session "$IOS_DEBUG_SESSION" --scenario template-tie
npm run debug:ios-app -- run --session "$IOS_DEBUG_SESSION" --scenario interruption-migration-recorded
npm run debug:ios-app -- run --session "$IOS_DEBUG_SESSION" --scenario paging-disable
npm run debug:ios-app -- suspend --session "$IOS_DEBUG_SESSION"
# 将对应局部成功命令输出的 EVIDENCE= 路径分别保存为这两个变量
# IOS_NATIVE_EVIDENCE=...；IOS_TOUCH_EVIDENCE=...
# 仅按必要影响执行；失败后须覆盖实际失败目标，普通绿色不自动要求全跑
npm run check:ios-app:simulator -- --from "$IOS_NATIVE_EVIDENCE" --session "$IOS_DEBUG_SESSION"
npm run check:ios-app:touch -- --from "$IOS_TOUCH_EVIDENCE" --session "$IOS_DEBUG_SESSION"
# 只有同时修复了不同层次故障时，合并各自的新成功证据；无需为凑单份回执扩大验证
npm run check:ios-app:simulator -- --from "$IOS_NATIVE_EVIDENCE" --from "$IOS_NODE_EVIDENCE" --session "$IOS_DEBUG_SESSION"
# 需要回查时 run 恢复；全部工作结束后清理
npm run debug:ios-app -- close --session "$IOS_DEBUG_SESSION"
```

- 单用例使用 list 输出的完整 `target/class/method`。原生普通用例只执行所选一项；三阶段中断的准备/恢复方法不能作为普通单用例启动，须用 interruption-snapshot-ready、interruption-migration-recorded、interruption-upgrade-committed 成对局部场景，或 interruption-all；复用完整流程的阶段信号、预期退出 65 和恢复断言，不允许只跑半流程。
- 原生字典场景使用独立的 scenario/…/场景名 覆盖键；失败锁、阶段元数据、回执及日志信号均核对场景名。crud 通过不能替代 template-tie 修复，只有方法名通过也不算场景通过。
- 原生字典场景由 [scenarios.json](../../app/native-tests/scenarios.json) 列出，复用同一 dictionaryProbe 与 SQL 场景，只执行指定组；选择保存在已校验测试清单中，不为生产 App 添加参数。`paging-merge`、`paging-disable` 各执行两项业务触摸及一项键盘就绪前置；前置打开原新增弹窗、输入后取消，不保存业务数据。`merge-relaunch` 执行对应两项触摸，`merge-cycle` 连续验证取消、确认和重启三项触摸。选择依赖页面状态的单用例 test10/test12/test14 时，也显式携带 test09/test11/test13 前置；新增/改名用例 test01–test05、搜索用例 test11/test13 及其依赖链都先执行键盘就绪前置。输出与回执列出实际执行项，其余触摸用例通过共用夹具准备必要数据。
- 会话只绑定 create 新建的 iPhone 14 Pro Max / iOS 27.0。每次运行及关闭前都核对会话真实路径、清单权限、UUID、runtime、型号、名称和可用状态；不接管已有设备，不自动换设备。局部失败保留本轮设备、日志和失败回执，可以修复后在同一会话重试；上次测试执行阶段失败或未写完执行回执时，下一次显式触摸运行先重启同一 UUID 的设备以清除遗留自动化进程，继续复用原构建。局部与完整原生入口都不收集耗时的 sysdiagnose，仍保留日志、截图、xcresult 和原断言；完整验收前可 suspend 关闭本轮设备的运行但保留缓存，需要回查时 run 恢复；本轮全部工作结束必须 close，关闭后再次运行明确拒绝。close 重复执行安全，只删除该会话设备和专用构建缓存，保留必要证据。
- 原生探针使用随机数据库并自行回收；每次局部触摸运行都卸载该会话模拟器中的测试 App，再安装并经正式初始化产生新账本，复用 [受限夹具](../../scripts/fixtures/dictionary-touch.py) 准备合成数据。此重置仅限本轮专用设备的合成测试数据，不能在会话内输入或导入真实账本；完整入口的夹具仍拒绝覆盖既有数据。结束 App 后只读回验目标写入、历史金额/快照、完整性与外键，不以页面提示代替持久化验证。
- 首次运行按 Debug/Release 分别 build-for-testing；之后核对源码、探针、工程、依赖锁、工具链及产物内容摘要，一致才使用 test-without-building。原生用例还核对已安装 App 与当前产物的内容摘要，一致时跳过重复安装和首次初始化准备。任何输入变化、产物缺失或内容变化都重新生成与构建；构建或测试期间源码变化不得判为当前版本通过。缓存只省准备工作，不复用旧的测试结果；每次仍执行目标断言、数量及完成信号检查。完整验收可复用已校验的设备，但不消费局部构建或旧测试结果。
- 完整流程先校验脚本语法，再执行启动时的不可变快照；执行期间脚本变化不破坏当前进程，但本轮不能认定当前脚本通过，需冻结后复验。所有入口共用工作区命令锁，避免同步资源和构建互相覆盖；并发调用明确拒绝。中断转发给本命令的子进程组并释放命令锁。若进程被 SIGKILL 或宿主崩溃导致锁遗留，先核实 `.local/ios/tmp/ai-agent/ios-command.lock/owner.json` 中 PID 已退出且无相应子进程，再移除该锁；禁止清空共享目录或接管其他任务。

除只读 list 外，命令入口另保存 ios-invocation-*/result.json（scope=invocation），记录包含前置检查的总预算、单调累计耗时、preflight/execution 位置及最终状态。前置检查超时也有证据；尚未取得有效工具链/证据时不创建完整尝试、不消耗完整复验次数。该回执不作为局部修复或完整验收资格。CI 两个 job 均归档这组入口回执。

common / ios-build 的工程检查保存于 ios-command-*（scope=engineering），包含 result.json、progress.json 和 timings.json；独立活动许可绑定工作区命令锁及模式，不能直接调用内部 Shell 跳过阶段计时。这类结果不记为局部修复或完整验收，也不消耗完整尝试次数。CI 两个 job 均归档对应阶段证据，job 超时仍是额外的外层限制。

非原生局部检查保存于 ios-check-*；原生局部运行在会话的 run-* 下保存独立日志、xcresult、SQLite 回读和 `result.json`，标明 scope=partial、所选/实际用例、构建与执行输入摘要、完成时间、缓存命中、状态及耗时，成功时输出 EVIDENCE=路径；局部绿色不更新完整验收状态。[脚本回归](../../scripts/tests/ios-debug.test.mjs) 经 check:app 执行，覆盖选择/前置、会话与设备拒绝、内容摘要失效、夹具拒绝与回读、命令锁与脚本快照边界；[执行约束回归](../../scripts/tests/ios-verification.test.mjs) 经同一入口检查缺少/失效证据、跨会话及跨版本/跨套件失败锁、A→B→A 历史次数、多份跨层证据及逐目标时序、具体场景隔离、common/ios-build 实际 CLI 阶段超时与许可、真实新故障复验、无关修复/空匹配拒绝、分阶段及入口累计时钟、前置检查超时/活动进程取消/创建失败补偿上限、修复后缓存恢复且失败锁仍保留、成对恢复、内部入口许可、首败取消与清理；测试使用隔离临时工程与可控子进程，不冒充 App 页面验收；成对恢复、普通场景及创建补偿 CLI 的受管模拟器分支回归仅在 macOS 执行，使用受控工具替身验证编排，Linux 的 common 检查明确跳过这三项，macOS 原生 CI 再执行。真实原生运行、设备复用及关闭仍需通过 CLI 在独立模拟器验证。新增入口及完整入口变更纳入同一 Actions 触发路径；不放宽原超时、断言或真机 Release 性能要求。

App 的最小 [Actions 工作流](../../.github/workflows/offline-ios.yml) 已定义自动触发和调用同一脚本，但尚无远端运行证据。真实 iPhone 的签名安装、飞行模式冷启动及 Release 性能另验；当前骨架已在指定真机完成签名安装与图标离线冷启动，正式业务及 Release 容量性能尚未验收。模拟器、小样本耗时或 common 绿色不能替代这些条件，当前也未实现完整性能交付门禁。

## 变更维护与验证

| 变更 | 同步维护 | 验证 |
| --- | --- | --- |
| 新页面 | 路由、页面登记、导航、权限、四态 | 关键视口、权限、键盘与返回链路 |
| 新主题 token | 明暗 token、PWA theme-color、图表主题 | 对比度、首屏防闪、两种模式截图 |
| 新复用组件 | 组件清单、至少一个真实消费页 | 组件状态、键盘、触摸和构建 |
| 新用户偏好 | 默认值、合法值、服务端落点、本地 fallback、真实消费 | 登录前后、跨设备、重置和非法值 |
| 新业务模板 | 稳定 ID、租户边界、业务唯一键、字段白名单、来源与失效回退 | 同键更新、跨租户、回填复验、移除和来源删除 |
| 新图表 | 色板、口径、下钻、空态和主题 | 小屏、夜晚、键盘与数据更新 |
| 新管理表格 | 列策略、滚动、操作承载和窄屏降级 | 1366/1440/1920 和长文本 |

| 后端或工程变更 | 同步维护与验证重点 |
|---|---|
| API、角色与租户 | OpenAPI、生成类型、API封装与调用者；默认拒绝、USER/ADMIN 边界、跨租户与复合归属负例；通过隔离数据库验证真实 HTTP 链路 |
| schema、SQL、迁移 | 新版本 migration、expected-version、Mapper、实体与契约；迁移/RLS/回滚边界与查询计划；不改已部署迁移校验和 |
| 任务、导出、注销 | 作用域、租约、批次幂等、取消/重试、文件补偿与审计重放；覆盖中断及重复执行，不能只验成功返回 |
| 金额、报表与批处理 | 精确十进制、时间范围、过滤和索引；规模风险运行 check:performance，不能用小夹具推断容量 |
| 配置、启动与部署工具 | 加载优先级、非法值拒绝、秘密隔离、进程/资源清理；check:deployment 只证明其覆盖项，目标宿主、镜像与恢复另验 |

### 专项入口

- 首管理员初始化：先用 `npm run check:server` 构建 JAR，再运行 `bash scripts/test-initial-admin.sh`，使用一次性数据库检查摘要、临时密码期限、审计与重复拒绝。
- 注销恢复链路：`bash scripts/test-recovery.sh` 编译后在一次性 PG 执行审计保全、全库恢复、账目/金额核对及重复重放；目标容器演练与真实事故恢复按[备份恢复](../deployment/backup-recovery.md)，本地通过不证明目标 RTO。
- 性能：`npm run check:performance` 运行 `PerformanceBaselineIntegrationTest`；样本、时限和索引断言以[当前测试](../../server/src/test/java/com/mybill/ledger/PerformanceBaselineIntegrationTest.java)为准，不能把历史耗时当作生产 SLA。

## 页面复测方式与选择

页面复测检查实际运行的界面与操作；类型、lint、单测、契约和构建不能代替页面验收。视口、主题与呈现判据见 [DESIGN](../../DESIGN.md#8-responsive-behavior)。

- 大多数日常页面复测由 AI 在本机完成，默认使用内置浏览器及 iOS 模拟器，不逐次要求用户提供手机。文案、注释和不改变运行逻辑的展示属性按最低充分验证处理；其他页面改动检查受影响页面及相关消费者。输入、候选、原生控件、滚动和手势须补原生直接操作；导航、安全区、软键盘或 PWA 生命周期改动还须检查运行本次生产构建的模拟器主屏幕 PWA。WebDriver 的 DOM/状态检查不能证明完整键盘与触摸流程。
- 真机按明确风险触发：修复真机特有问题、本次改动涉及的 iOS 版本兼容风险无法由模拟器覆盖、证书信任/真实手机网络/硬件/性能相关能力，以及全局导航结构、安全区处理、滚动容器或共享弹层焦点/关闭机制的较大调整，须补对应实体 iPhone 检查。触发时说明具体受影响行为及模拟器不能充分证明的部分，不因修改了共享文件或行数较多就要求手机。发布前集中验收本次候选受影响的实体 iPhone Safari 与主屏幕 PWA；发布后的实际终端核验按部署手册执行。提交、预览构建及不影响页面/PWA/终端环境的文档或工具发布不机械触发手机复测。安装、缓存更新、离线及后台恢复的日常检查可用模拟器。
- 按本阶段所需检查判断完成，分别标注模拟器、真机和未验证范围。未触发真机条件时，模拟器及相应直接操作通过可完成日常页面验收；触发条件、必需操作或版本证据缺失时，说明缺口与阻塞原因，不得声称对应验收完成。先完成 AI 能自主操作的部分，仅为确实必要的解锁、授权或实体操作请求用户介入。

### 方式选择

| 方式与入口 | 用途与选择条件 | 能证明什么／证据边界 |
|---|---|---|
| AI 内置浏览器，打开本地实际 Vue 页面并调整视口 | 布局与交互初筛：字号、间距、溢出、响应式、明暗主题、加载/空/错误状态；共享组件检查相关消费者 | 当前浏览器下的页面表现；桌面手机尺寸不能证明 iOS 原生控件、完整键盘或触摸流程 |
| Chromium E2E：根目录 `npm run check:e2e` | 低层测试不能充分证明的稳定关键业务链路；使用脚本创建的隔离数据库与账号 | 以 `web/e2e` 实际用例为准，未覆盖的保存流程不能声称通过；局部样式不新增长期 E2E，Chromium 通过不代表 iOS 通过 |
| iOS 模拟器 Safari WebDriver：`npm run check:ios:simulator` | 日常 iOS 结构与状态检查；操作见[模拟器连接与复测](#模拟器连接与复测) | 只证明脚本覆盖项；模拟器模式使用 DOM 事件检查布局、聚焦、取消和关闭状态，不证明原生触摸命中、完整键盘或安装版 |
| iOS 模拟器 Safari／主屏幕 PWA 原生直接操作 | 输入、候选、原生选择器、滚动和手势；涉及独立窗口时从 PWA 图标启动本次生产构建 | 实际键盘占屏、输入、点选、收起和相应原生控件；符合本阶段要求时可完成日常页面验收，仍须记录设备、runtime 和覆盖范围 |
| 实体 iPhone Safari WebDriver：`npm run check:ios`，结合直接操作 | 本节的真机条件触发或发布前集中验收；连接见[真机连接与自动化](#真机连接与自动化) | 自动检查只证明脚本覆盖项，输入、手势及遗漏行为须直接补验；镜像可辅助，但仅显示电脑键盘工具栏不能证明完整软键盘 |
| 实体 iPhone 主屏幕 PWA，运行本次版本 | 真机问题涉及独立窗口，以及发布前对候选受影响项集中验收；发布后按部署手册核验实际终端 | 真实终端的独立窗口、系统信任及生命周期；旧安装版、Safari 地址栏或模拟器 localhost 不能证明对应版本与部署终端通过，验证不隐含发布授权 |

### 执行与证据

1. 列出受影响的路由、共享组件消费者、角色、状态和终端行为，按本节判断是否触发真机。局部修改检查自身及同类受影响位置；断点变化检查边界两侧，全局样式选择有代表性的表单、列表、报表或管理页面。纯文案等低风险改动不机械增加设备测试。
2. 按[环境与服务保护](#环境与服务保护)检查端口和已有进程，服务未启动时按[README](../../README.md#快速开始)启动。内置浏览器初筛后，在匹配目标尺寸与 iOS 版本的模拟器复测；版本未覆盖时记录差异，按上文风险条件决定是否补真机，不因版本矩阵不完整阻塞所有日常改动。调整窗口高度不能模拟完整软键盘。
3. 明确数据环境：模拟 API/组件夹具适合长名称、大量候选、空态、错误和延迟响应，只证明前端状态；真实接口闭环使用隔离环境和测试账号，确认请求、响应、回显及实际持久化，不用个人或生产数据做破坏性测试。临时夹具与测试数据用完清理或恢复。
4. 按风险运行既有 E2E 和 iOS 自动检查，对未覆盖的变更路由和行为直接补验；按上文条件及时补真机，发布前对最终候选集中完成待验项，不能用历史版本结果替代。
5. 输入与候选检查：默认展开是否需要键盘、主动搜索是否唤起完整键盘且无意外缩放、候选可见/滚动/点选、选中回显与收起、外部点击/取消/主动收起键盘/重复展开、切下个字段时焦点与草稿、取消是否保留原值、折叠项错误是否自动展开；涉及中文输入时补组合输入及候选确认。原生日期、底部动作和横竖屏按改动检查操作与遮挡。共享弹层检查完整打开、候选展开后一次关闭、未保存确认、取消保留和重复打开，不能塌成横线或留下残余内容。
6. 涉及独立窗口时在模拟器从主屏幕进入本次生产构建，检查相应布局、键盘、安全区；缓存/离线/后台恢复改动检查更新、断网提示、联网恢复和重新进入。发布前真机 PWA 集中验收使用已授权提供同一候选的测试 HTTPS 入口，核对实际加载版本；该入口未就绪时记录候选验收缺口，不用旧生产版本代替，也不为验收自动发布。发布后实际部署地址的终端信任、版本和受影响 PWA 行为按[部署手册](../deployment/runbook.md#5-验收与观测)核验。缓存命中、SW 接管或安装成功均不能单独记为完整生命周期通过。

回复中记录：**本次源码/构建版本（含未提交变更）、环境与页面 URL、真实接口或模拟数据、操作者/工具、模拟器或真机及系统版本、浏览器/独立窗口、实际步骤、预期与观察结果、通过/失败/未验证及原因**。模拟器自动检查、模拟器原生操作、真机工具实测和用户确认分别标注；只列命令或截图不等于证明操作闭环。最终源码变化时重查受影响项。临时产物遵循全局协作规则；仅在明确要求时维护验证文档，不自动新建报告或续写初始开发资料。

工具受限仍按上文完成标准处理，不把整套复测转交用户；锁屏/断连先检查一次可修复前置条件，未恢复时停止重复连接。没有手机不阻塞未触发真机条件的任务，DOM、焦点或工具栏也不能替代完整键盘证据。

### 模拟器连接与复测

Mac 安装与系统兼容的完整 Xcode，用户完成首次启动许可及必要系统授权，安装目标 iOS runtime，并在 Xcode Device Hub（较旧版本为 Simulator）创建 iPhone 模拟器。Xcode 非默认路径时设置 `DEVELOPER_DIR` 指向其 `Contents/Developer`；脚本在全局仅选中 Command Line Tools 时会为本次进程选择 `/Applications/Xcode.app`，不修改全局 `xcode-select`，不自动接受许可或下载 runtime。

凭据复用下节的 `.local/web/real-device-test/accounts.md`。在 `.local/web/simulator-test/config.json` 保存 `deviceUDID` 和可选的 `baseUrl`；默认页面地址为 `http://127.0.0.1:5174`，环境变量 `MY_BILL_IOS_BASE_URL` 可覆盖地址。脚本接受本机、私有/共享 IPv4 或 `.local` 主机的 HTTP 地址及明确端口，真机入口固定为 5174；地址校验不证明后端及数据库属于测试环境，执行前仍须核对代理、数据源和测试账号，禁止指向生产。HTTPS 候选及实际部署地址的 PWA 由直接操作检查。配置优先级见[环境架构](../architecture/environment-configuration.md#ios-复测配置)。目录权限为 `700`、配置及账号文件为 `600`。在根目录查看可用设备：

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

成功判据为退出码 `0`、输出实际设备/系统及 `useSimulator=true`，相应检查通过并生成截图（系统临时目录，具体路径见命令输出）；不能据此声称原生操作或 PWA 通过。脚本结束后保留模拟器供直接操作，停止自己创建的驱动并删除本次自动化会话。

完整键盘须在 WebDriver 会话结束后检查，在 Device Hub 的 Device → Keyboard（旧版本菜单可能不同）关闭 **Simulate Hardware Keyboard／Connect Hardware Keyboard**，实际点击输入框确认完整键盘出现；直接点屏幕按键、候选和取消/完成，观察视口、焦点及草稿。需要时检查中文输入法，不能把英文输入结果推断为中文组合输入通过。UI 工具可以直接控制模拟器；无法操作的具体项才交给用户。原生点击、滑动及截图证据与 DOM 自动检查分别记录。

独立窗口使用生产构建；普通 `npm run dev` 不注册生产 SW。已有正确预览可复用，否则先启动本地后端并检查预览端口，再在根目录运行：

```bash
MY_BILL_BUILD_ID="simulator-$(date +%s)" bash scripts/run-frontend.sh build -- --outDir ../.local/web/simulator-test/web-dist
bash scripts/run-frontend.sh preview -- --outDir ../.local/web/simulator-test/web-dist --port 15174 --strictPort
```

预览沿用[开发监听配置](../architecture/environment-configuration.md#开发与工具链变量)，默认监听所有 IPv4 地址；需要仅限本机时显式传 `MY_BILL_WEB_HOST=127.0.0.1`。同源 `/api/v1` 代理到本地后端；模拟器 Safari 打开 `http://127.0.0.1:15174`，通过分享菜单“添加到主屏幕”，从图标启动并确认独立窗口及本次构建。记录对应源码（含未提交变更）和唯一构建标识，通过 Web Inspector 中实际 SW/缓存版本核对；旧页面可能持有旧资源，不能只凭图标或 SW 已接管判定版本。自动结构检查这个地址时使用 `MY_BILL_IOS_BASE_URL=http://127.0.0.1:15174 npm run check:ios:simulator`。localhost 生产预览可用于模拟器 PWA，但不证明真实手机的 HTTPS、证书信任或网络可达。停止预览使用所在终端的 Ctrl+C，仅关闭本次服务；不清空已有 PG、不删除用户安装或草稿。

### 真机连接与自动化

仅在上述真机条件触发或发布前集中验收时执行本节。将 iPhone 解锁连接 Mac，在手机「设置 → App → Safari → 高级」打开「网页检查器」和「远程自动化」。Mac Safari 的开发菜单应看到该 iPhone；首次配对在手机上信任 Mac。保持亮屏及本地前后端运行，确认手机可访问本机前端地址；Mac `safaridriver` 启动独立测试会话。需要启用远程自动化时由用户完成对应系统授权。排查参考 Apple 的[真机检查](https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios)和[远程自动化](https://developer.apple.com/documentation/safari-developer-tools/ios-enabling-webdriver)。

将 `admin` 和 `pengfulin` 的测试密码保存在 `.local/web/real-device-test/accounts.md`（用户名与密码两列表格）；凭据只从该文件读取，不写入仓库、命令输出或日志。`.local/web/real-device-test/config.json` 保存手机可访问的 `baseUrl`（`http://<本机地址>:5174`）及可选实体手机 `deviceUDID`；运行前确认地址可达，不沿用历史地址。目录权限 `700`、文件权限 `600`，在根目录执行：

```bash
npm run check:ios
MY_BILL_IOS_ACCOUNT=admin npm run check:ios
```

成功判据为退出码 `0`、输出实际设备/系统及 `useSimulator=false`，相应检查通过并生成截图（系统临时目录，具体路径见命令输出）。真机入口不能退回模拟器冒充通过；按改动补直接操作与安装版 PWA。镜像与 WebDriver 分开操作，镜像结束后重新确认解锁；电脑键盘模式可能只有输入工具栏，完整软键盘必须实际出现并操作。QuickTime 预览可观察实体操作，不能替代触摸或输入。

两个入口共用 `scripts/check-ios.mjs`：普通账号检查支出/收入横向溢出、日期控件边界，以及支出分类候选边界、240px 高度上限、重复点击收起、主动搜索聚焦、16px 输入字号、可见区域、取消与外部关闭；管理员检查用户页加载及宽度。搜索记录视口状态，仍须单独验完整键盘；[WebKit 说明](https://webkit.org/blog/9395/webdriver-is-coming-to-safari-in-ios-13/)指出 Safari 自动化会话抑制软件键盘。脚本不保存账目，会临时切换测试账号最近记账类型，在成功及可执行清理的失败退出前尝试恢复；强制终止、设备断连或服务不可达时不保证恢复，须在测试账号页面核对，检查不能记为完成。结束时删除本次会话，仅停止自己创建的驱动；断连或远程自动化关闭按受限规则说明具体缺口。

### 焦点与动效

焦点变化覆盖点击与键盘导航切换、原生选择打开/点选/取消、候选浏览→搜索→关闭/切字段、弹层初始与返回焦点，以及焦点与选中同时存在的状态；涉及手机输入时补完整键盘和独立窗口原生操作。

动效变化检查快速开关、嵌套返回、草稿/滚动保留、候选交接、软键盘和减少动态效果；不能用静态截图或 CSS 属性推断真实设备帧率。

## 环境与服务保护

默认开发端口前端5174、后端8080、PG54329；开始验证先检查占用，不终止用户已有进程。开发入口共用可选的 `.local/web/dev.env`，已导出的 Shell 变量优先；根 `.env` 不加载，生产发布与隔离检查不读取开发文件，详见[环境架构](../architecture/environment-configuration.md)。旧库迁移校验失败不得自动repair或清空，先核对差异，独立验证用临时数据库并仅清理自身资源。

数据库、性能、E2E 和恢复集成使用一次性 PG，不连接开发、生产或其他项目库。安全扫描需网络，容器 OS 扫描另计。实际运行、脚本存在与历史测试通过分别说明；用户实测、工具实测和隔离模拟不能相互替代。部署终端、续期及恢复/注销重放按[部署手册](../deployment/runbook.md#5-验收与观测)验收，不能以基础服务启动代替。
