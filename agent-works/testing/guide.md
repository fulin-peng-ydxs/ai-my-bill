# 开发验证规范

按改动风险选择最低充分检查，覆盖实际入口、处理、结果和适用失败边界。命令均在仓库根目录执行，先满足 [README 工具链前提](../../README.md#2-检查环境并安装依赖)。页面开发前读取本文页面复测部分和 [DESIGN 响应式契约](../../DESIGN.md#8-responsive-behavior)。

本分支仅保留离线 iOS 的按需 CI；日常 push/PR 不自动运行远端验证。旧 Web/服务端的 release-gate（含 PostgreSQL、Java、浏览器及服务器部署检查）已撤下，不再安装 PostgreSQL 16。仓库通用 secret 检查拆出为 scripts/check-secrets.sh，由离线流水线保留，不依赖 Java 或旧端依赖。下表旧端命令仅供手工回溯现有源码；它们不是离线 App 的构建或交付依赖。

## 工程检查

| 命令（根目录） | 何时使用 | 做什么 |
|---|---|---|
| npm run check:app | 离线 App 入口、依赖或资源变更 | Node 24：领域、队列、初始化状态、字典/合并 SQL、组件四态及设计契约测试、类型检查、Vite 构建、Capacitor sync、生成 SPM 兼容适配及资源门禁正反例；不启动 Web/PG |
| npm run build:ios-app | 原生工程/依赖或安装候选资源变更 | Xcode 27 / iOS 27 SDK：未签名真机架构 Release 编译与产物资源检查；不证明签名/可安装 |
| npm run check:ios-app:simulator | 原生 SQLite 桥、外壳及导航变更 | Xcode 27 / iOS 27.0 runtime：独立 iPhone 14 Pro Max 模拟器，hosted XCTest 验随包入口、原生事务/精度/聚合溢出拒绝、正式初始化/升级/seed 保护、八类字典和合并/模板事务、原页面操作、进程中断重开及排除系统备份；清理本轮设备 |
| npm run check:ios-app:touch | 影响跨场景原生交互、夹具隔离或完整触摸编排时；单页定位先选对应局部场景 | 独立 iPhone 14 Pro Max 模拟器；外部 XCUITest 对 Release App 依次验证字典与末页治理、收支保存/编辑/重启、草稿/偏好/模板、调整/回收站、明细筛选/搜索/分页、总览/五种时间粒度及九类支出/五类收入报表；各组准备专用合成夹具并只读回验 SQLite，包含隔离拒绝负例与设备清理；不替代真机交付 |
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

App 检查统一从 [ios-app.sh](../../scripts/ios-app.sh) 进入 [命令调度器](../../scripts/ios-app.mjs)，完整检查委托 [完整流程](../../scripts/lib/ios-app-full.sh)，需先按 [README](../../README.md#离线-ios-app-开发入口) 安装 app 锁定依赖。各入口只证明本次回执中实际执行的范围；基础 sqliteProbe 使用受控实验数据，不能代替正式记账、完整升级/恢复、容量或真机验证。金额、时间及文本实现统一位于 app/src/domain；旧 Web 对应模块仅重导出，兼容回归无需启动旧服务。模拟器入口通过 test bundle 调用正式 LedgerDatabase.open→upgrade，在保护快照完成、迁移 SQL/履历已写但事务未提交、升级事务已提交三个阶段分别挂起；脚本动态定位本轮沙盒，观察到匹配阶段信号后仅终止本 App。每次故障步骤须返回预期 65，恢复 XCTest 必须核对已提交基线、版本/结构/履历及重试结果，并回读保护快照排除标记。另外通过原生文件守卫用例验证完整头中 magic 清零的非热 journal 可保留（包括其余头字段仍有值的情况），热 journal、短头和非空 WAL 拒绝复制；正式中断重试用例必须能重新生成快照。原始 SQLite 事务探针不能代替这组正式流程验证；模拟器不验证实体文件保护等级。

App 设计门禁由 [designContract.spec.ts](../../app/src/app/designContract.spec.ts) 经 check:app 同一入口执行：Vue/TypeScript 解析真实导入和模板消费，核对九个核心组件登记、个人页面的唯一角色/路径及实际路由，拒绝私有颜色、注释假导入、缺登记与重复角色反例。21 个关键共享组件模板及三份全局样式的 SHA 基线来自准备提交 6419b93；已登记的搜索输入绑定及横屏键盘样式适配均须可逆还原并匹配原摘要，例外不豁免其他布局变化；未作为检查目标的业务消费者仍须按改动复核。四态及初始化重试由组件/状态测试覆盖，不用它们证明原生呈现。

[关闭重试回归](../../app/src/data/ledgerDatabase.spec.ts) 经 check:app 执行，在原生桥边界注入失败，覆盖关闭后禁止读写、保留所有权、重复关闭、直接重开及打开/校验与关闭同时失败的原因链；它不模拟真实 SQL 持久化。check:ios-app:simulator 的 lifecycleProbe 在真实原生库上补充注入关闭拒绝，恢复后调用真实关闭/重开，核对数据集、已提交金额和同名账本交接；故障包装仅存在于 test bundle，finally 恢复，不进入生产入口。

原生 [shellProbe](../../app/native-tests/shellProbe.ts) 在实际 WKWebView 中检查四导航、原图标、切页草稿、主题及抽屉焦点返回。嵌套放弃/取消使用 test bundle 内共享组件夹具，验证父子层与未保存作用域，不冒充账目编辑链路。探针不进入生产资源。主题选择接 SQLite 后，探针在每次点击前等待上一笔保存结束、控件恢复可用，不能把对禁用控件的 DOM 点击当作已执行。页面复测按[离线 App 设备选择](#离线-app-设备选择)覆盖受影响的导航、表单、完整软键盘、原生选择器、主题、方向及减少动态效果；小/默认/大 iPhone 的完整适配矩阵在首次适配、相关布局/响应式契约变化或最终集中复核时执行，纯数据或工具改动不机械重复全部设备矩阵；记录原页面操作和各自边界，不将脚本派发事件当成触摸验证。未接通功能应显示明确不可用而非假成功。

[字典场景](../../app/test-support/dictionaryScenarios.ts)与[升级场景](../../app/test-support/dictionaryUpgradeScenario.ts)由 Node SQLite 测试及原生 dictionaryProbe 共用，覆盖八类字典、规范化唯一键、两级分类、有界分页、排序故障回滚、类型/引用保护、历史快照、模板冲突（含相同时间下 UUID 有符号高/低位的取舍）、合并幂等及 v1→v2 升级。Node 测试只在原生桥边界换成临时文件 SQLite，不证明 iOS 文件策略，也不进入生产包；原生测试经正式生命周期核验相同 SQL/事务及快照。seed A/B 样本核对用户改名/停用/排序、删除项及 false/0/空值不被新版清单覆盖，并验证必需数据迁移冲突的拒绝、回滚与重试。

[字典详情组件回归](../../app/src/views/me/dictionaries/DictionaryDetailView.spec.ts)挂载正式页面，在 API 边界控制响应顺序，检查末页收敛、补读失败后的重试，以及旧补读晚于新搜索翻页返回时不覆盖新结果或页码；它不替代原生 SQLite 与触摸验证。

[dictionaryUiProbe](../../app/native-tests/dictionaryUiProbe.ts)驱动正式页面与原生 API，核验八类入口、新增/重名保留输入/改名/停用/恢复、预览取消不写入及确认合并。历史账目和模板仅在隔离测试沙盒经原生连接准备，合并后直接读回金额和快照；该字典探针不操作账目保存、明细或模板 UI，这些消费者按对应业务场景另验。派发事件证据还须配合模拟器图标启动后的实际触摸、键盘和页面核验。

NativeTests 与 DictionaryUITests 只支持 simulator SDK，并由共享 [OwnedSimulatorTestContext](../../app/ios/App/NativeTests/OwnedSimulatorTestContext.swift) 在注入探针或启动 UI 操作前核对本轮设备；物理设备测试编译直接拒绝。生产 App 不编译守卫、不读取清单。清单来源及传递见[环境架构](../architecture/environment-configuration.md#离线-app-原生测试配置)，不手工绕过 Xcode 直接测试的拒绝。原生守卫用例覆盖平台、缺失/不匹配设备、路径、App ID、大小及无效内容；touch 脚本另在本轮空模拟器对两个入口去掉清单，要求具体用例以隔离守卫错误失败、xcodebuild 返回 65，再只读确认业务行未增加。普通测试失败返回 65 不能充当该负例成功。

脚本先构建、安装并等待专用模拟器正式账本完成初始化，结束宿主后再执行测试，以分离首次运行时准备；准备有界等待不属于冷启动性能测量，也不改变原生入口 20 秒等待和普通单用例 60 秒预算。局部入口的启动、账本就绪和结束宿主分别保留 initialize-launch.log、initialize.log、stop-initialize.log；启动/终止输出直接写文件，以命令退出状态判断完成，避免辅助进程继承输出管道导致已退出命令仍等待 EOF。缺少就绪标记或终止失败仍拒绝准备夹具，整个初始化阶段继续受同一 60 秒预算约束。自动回归的 TestAction 不挂载调试器，日常 Run 调试设置保持；正式性能验收仍按目标真机 Release 规则执行。

[原生触摸用例](../../app/ios/App/UITests/DictionaryTouchTests.swift)由独立 DictionaryTouch scheme 执行，使用 XCUITest 的 tap/typeText/原生选择器操作 Release App，不注入 JavaScript、不替换业务 API。与 hosted XCTest 的 DOM 事件场景分别记录，不将两者混称为真实触摸。check:ios-app:touch 先验证正式初始化并结束宿主，再用[受限夹具](../../scripts/fixtures/dictionary-touch.py)准备本轮空模拟器账本的历史引用；夹具拒绝已有自定义数据，不清空、不连接真机。缺少归属清单的预期拒绝完成后，先重启同一受管模拟器以释放 UI runner 会话，再准备正例夹具；设备 UUID、账本和清单保留。原有 11 项 UI 用例顺序共用本轮交互会话，各用例保留截图，最后验证重启；回读后追加 21 项商品/单位夹具，以另 4 项用例验证搜索末页合并、启用筛选末页停用后的有效页回退及条件保留，再只读核验结果。脚本结束 App 后回读稳定 ID、引用、模板、行版本、金额、名称快照、事件和幂等回执，执行完整性及外键检查；用例按操作链路拆分并保留原 60 秒执行预算配置，不上调超时；改名与局部键盘准备输入后以 3 秒有界等待核对 AX 精确值，不重放输入或改写页面；搜索收键盘只选择当前可触摸的“完成”按钮，并断言键盘消失，拒绝遗留的同名 AX 节点；合并保留商品的“请选择”提示值不依赖 AX label，以截图定位后原生触摸；触摸定位仍可用本机 Vision OCR 定位截图文字，再由 XCUITest 坐标触摸，不将 OCR 通过作为无障碍验收。此流程只证明开发模拟器的页面链路，不代替目标真机性能和最终交付。

资源门禁使用锁定的 TypeScript 解析器检查 JS/MJS/CJS 及内联脚本，拒绝已知 IndexedDB、Web Storage、WebSQL、WASM 的直接标识符、别名来源与静态括号访问；合法注释及文案不作为调用。该静态检查不证明所有动态间接访问不可达，正式数据入口仍须通过原生集成验证。正反例通过同一门禁入口执行。

每轮 build.log/test.log、interruption-阶段/recovery-阶段 日志、阶段回执及 xcresult 位于 .local/ios/tmp/ai-agent/native-*；失败不冒充成功，模拟器清理失败也返回失败。原生缓存与产物留在 .local/ios，不复用 .local/web。既有 check:ios 与 check:ios:simulator 仍是旧 Web/Safari 路径，不应用来代替这组原生测试。

设备选择、提前使用真机的条件及最终候选范围见[离线 App 设备选择](#离线-app-设备选择)。模拟器开发观测不能替代目标真机 Release 的约定容量采样、辅助功能及硬件复核；执行器或必要实测尚未完成时保留待验证。

### 原生局部调试与完整验收

日常开发、局部修复及阶段推进以本地最低充分验证为准：先执行目标文件或用例，只有风险确实跨越该层才扩大。下面的场景表决定本轮必需范围；必要局部检查失败仍须修复，不能将实际失败记为计费问题。远端计费、额度、排队或平台故障单独记为“远端受阻/未验证”，保留已完成的本地结论，不阻塞不依赖远端机制的开发、提交与推送，不触发自动重跑或扩大验收。涉及 GitHub 特有触发、权限或 runner 行为的结论须保留远端待验，最终交付前补齐。选择依据、命令和结论边界写在交付回复，不新增过程台账。

| 场景 | 首选方案与扩大条件 |
| --- | --- |
| 金额、日期、SQL、迁移、队列或业务状态 | 先选文件，例如 `npm run debug:ios-app -- check --check app-tests --file src/domain/money.spec.ts`，可追加已有 `--name` 过滤；仅原生桥或文件策略无法由 Node SQLite 证明时补对应 hosted XCTest，不因 SQL 文件变化默认运行触摸套件 |
| Vue 请求时序、搜索、草稿、错误与取消 | 对应真实组件或组合函数的 Vitest；纯事件调度未改呈现或原生机制时复用范围匹配的页面证据。键盘、选择器、滚动或实际触摸命中变化再选原生 UI 单例 |
| 验证脚本、缓存、安装与夹具隔离 | Node 脚本测试、受控 CLI 和真实 SQLite 文件故障注入。仅回执、失败目标、CI 策略或目录替换状态变化时，验证对应允许/拒绝和恢复路径；未改实际构建参数、安装方式、UI 驱动或原生桥，可沿用范围匹配的原生证据。实际包/资源或原生编排机制变化再用同一独立模拟器做冷准备与热复用小场景，不重复完整 touch |
| Swift 原生逻辑或 UI 定位器 | 协调器或桥接变化选对应 hosted XCTest；仅触摸定位器变化选相应 UI 单例及显式必要前置。利用分层缓存保留未变资源、App 安装和本轮设备 |
| 多步骤状态依赖或跨页面链路 | 单项稳定后运行对应 `--scenario` 小组合一次；失败立即缩回目标。只有局部不能证明影响范围或候选集中验收需要时才进入既有完整入口，并满足下表证据锁 |
| 首次安装、升级中断、签名、离线、容量与硬件 | 首次初始化和完整升级入口保留冷路径，不能以基线恢复冒充；中断使用成对场景。模拟器无法覆盖的签名、硬件及最终 Release 性能按既定真机条件验证，不把调试缓存耗时当作冷启动性能 |

失败先依据 result.json 的 failure.stage、timings.json 和对应日志区分构建、安装、初始化、测试及回读。初始化卡住时先保留会话和制品，核对启动回执及正式账本提交；需要时有界采样本轮进程，随后只恢复同一 UUID、执行最小相关用例。不得仅因初始化超时执行 close/create、删除 DerivedData 或重跑完整构建；真正的包变化或产物损坏才使构建或安装失效，实际设备丢失或损坏须先有证据再另建。中途暂停用 suspend，全部定位与复验结束才 close。

先在能证明问题的最低层定位：纯领域、组件与执行器问题先用 Node/Vitest；桥接或页面触摸问题再运行对应原生单用例/场景。局部通过且相关源码稳定后，仅在影响范围确有必要时执行一次完整验收；共享脚本变化不自动要求重跑全部页面。以下规则由 [ios-verification.mjs](../../scripts/lib/ios-verification.mjs) 与根目录统一入口强制执行，适用于本机和 CI，不提供 force/skip/CI 环境变量绕过：

| 条件 | 实际执行约束 |
| --- | --- |
| 首次启动 simulator/touch 完整验收 | 必须提供 `--from RUN_DIRECTORY`，指向本工作区受管局部运行的当前版本成功回执（ios-check-* 或会话 run-*）；先校验回执、实际用例通过日志、范围、完成时间及输入摘要，再允许生成资源和启动完整工作 |
| 正例出现失败或执行时间告警 | 每 100ms 观察正例日志；发现首个失败立即终止本次进程组并执行清理，不继续后续测试阶段；记录失败用例及日志路径，下一步只能先局部定位 |
| 完整验收失败、取消或宿主中断 | 工作区状态保留失败/未完成锁；旧回执、失败之前的回执、无关用例以及改跑另一完整套件均拒绝。失败的用例、具体场景、Vitest 精确目标、资源目标或构建/安装阶段必须由新局部成功证据覆盖；首次完整验证及完整失败后的局部新故障也须有相关修复证据；当前输入的各套件结论从完整历史取得，不能以其他输入后来通过覆盖旧输入的失败；不将无用例名称的失败降级成任意原生烟测，缺入口先补入口 |
| 同一输入复验再次失败 | 每个输入和故障事件只允许初验加一次相关局部证据解锁的复验；A→B→A 保留 A 的历史次数。再次失败/中断后须修正相关输入并重新局部验证，不能靠换输入再切回或刷绿色重置次数 |
| 完整验收已通过且输入未变 | 默认拒绝再次启动。若通过后实际观察到同输入的新局部失败，须记录真实失败事件，并在其后取得覆盖全部相关目标的新成功回执，才开放该故障事件的复验；空匹配、取消、旧证据或无故重跑绿色不能解锁。README、规范措辞和生成物不使完整证据失效 |
| 分阶段超时 | 所有根目录入口（含 common / ios-build）的单次构建 10 分钟、显式安装 2 分钟、设备启动 2 分钟、初始化 1 分钟、非原生检查 5 分钟；build-for-testing、simctl install 和 test-without-building 分开计时并写 timings.json。测试启动/用例交接等待 180 秒，普通单用例仍为 60 秒（容量 native/pages 的明确例外见下节）；预期中断准备为 120 秒。XCTest 可能再次校验或安装 runner，其耗时属于测试准备，不包含编译 |
| 整轮超预算 | 调度器从入口建立单调时钟截止时间，SDK、runtime、Xcode 查询、证据检查及后续构建/执行共用剩余预算，不在进入验收体时重新计时。debug 局部调试与 ios-smoke 为 15 分钟；覆盖字典、收支、个人状态、生命周期、明细、报表及数据管理的 ios-touch 独立为 40 分钟，common / ios-build 仍为 40 分钟。预算由 totalBudgetFor 同时供入口截止时间和完整子流程使用，不受命令参数或环境变量覆写。CI `checks` 矩阵中的原生组全部步骤共用外层 45 分钟，脚本/通用组为 10 分钟。其中每个构建/检查阶段仍分别受 10/5 分钟限制，单条工具链查询最多 5 分钟，实际取阶段/子命令上限与整轮剩余时间的较小值。超时终止后最多再给清理 10 秒；各阶段和单用例预算仍独立生效；完整触摸的总预算匹配多阶段范围，不把局部调试、单用例或初始化故障改成更长等待 |

输入摘要覆盖 App、测试/探针、Vitest 执行配置、工程、依赖锁、Node、宿主系统/架构，以及执行器、夹具和资源门禁；原生证据另绑定 Xcode、iOS SDK 与模拟器 runtime build，Node 检查不要求安装 Xcode。局部构建缓存与执行证据摘要分别维护，不因夹具修改无谓重编原生包。`.local/ios/tmp/ai-agent/ios-verification-state.json` 与 `ios-full-*/result.json` 保存尝试、来源证据、失败锁和次数；schema 2 保留全部历史及新局部失败事件，从 v1 合并已有逐轮回执并保留次数，不因关闭调试会话删除。禁止删除状态、换会话/工作目录或直接调用内部 Shell 规避限制，也不得用无关注释/格式改动刷摘要重置次数；内部 Shell 在生成资源前核对调度器活动许可。进程被 SIGKILL 留下 running 状态时按未完成处理，不自动放行。

UI 局部运行的设备恢复同时追溯最近的实际测试和未完成的 App 启动请求。`initialize-launch.log` 已创建但初始化失败或无最终回执时，即使还没有 `test.log`，下一轮也须重启同一受管设备以释放遗留桥接会话，保留 UUID、构建产物和完整失败锁；后续构建/安装失败不能遮蔽该记录。未发起启动的故障、已进入夹具后的拒绝不新增恢复需求，成功测试才解除历史自动化恢复需求。初始化超时先区分启动回执与正式账本提交，按需对本轮进程做有界采样；若采样显示可访问性处理且连接了本轮 Device Hub 显示，可先隔离显示连接再从最小启动用例复验，不据此推断所有超时的唯一原因。已有制品只可辅助诊断，不能替代当前源码的正式局部回执，不为定位重复完整构建或验收。恢复判定的局部回归使用 `node --test --test-name-pattern '恢复需求|初始化启动|未启动原生' scripts/tests/ios-debug.test.mjs`，CI 的 check:app 执行同一文件。

完整检查不接受单用例过滤，仍重新生成资源、执行原范围与门禁；默认新建独立模拟器，也可通过 `--session` 借用本轮受管设备。局部证据只用于启动资格，不替代完整结果，也不消费旧测试结果。多个故障分别修复时，可以重复传入 --from（1 至 32 份）；每份回执均须匹配当前输入及适用环境，重复路径、失败/过期回执拒绝。覆盖按每个目标自己的最近失败时间判断，允许先修 A 再修 B，无须因 B 后来失败而重跑已修复的 A；不能用无关新回执搭配目标的旧回执解锁。CI 按需的原生分支使用同一约束：先执行最低层 App 测试取得新回执，再进入原生完整验收并 finally 关闭会话；失败时按对应目标局部修复，不增加无关原生烟测。

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
- 原生字典场景由 [scenarios.json](../../app/native-tests/scenarios.json) 列出，复用同一 dictionaryProbe 与 SQL 场景，只执行指定组；选择保存在已校验测试清单中，不为生产 App 添加参数。`paging-merge`、`paging-disable` 各执行两项业务触摸及一项键盘就绪前置；前置在原明细搜索输入短文本、核对后通过真实退格清空并断言空输入，通过原生“完成”按钮收起软键盘后再返回“记一笔”，不保存业务数据。`merge-relaunch` 执行对应两项触摸，`merge-cycle` 连续验证取消、确认和重启三项触摸。选择依赖页面状态的单用例 test10/test12/test14 时，也显式携带 test09/test11/test13 前置；新增/改名用例 test01–test05、搜索用例 test11/test13 及其依赖链都先执行键盘就绪前置。输出与回执列出实际执行项，其余触摸用例通过共用夹具准备必要数据。
- 多维报表复用 `ReportDimensionPanel`，不改模板/样式。Node 的 `app/src/data/reports/dimensionReports.spec.ts` 与原生单用例 `NativeTests/NativeSqliteTests/testOfflineDimensionReports` 使用同一业务场景：九类支出、五类收入、量价/单位/空分组、180 天/3 样本/50%/10 分钟边界及 v7→v8 索引升级。Node 另核验未舍入排行、截断、旧响应/失败保护和缺失资料，不把模拟器小样本当容量验收。
- 质量历史查询的局部入口为 `npm run debug:ios-app -- check --check app-tests --file src/data/reports/dimensionReports.spec.ts`，定位扫描问题可加 `--name '质量历史实际'`。候选商品只从本次快照提取一次，每组最多 128 个商品、每次最多 256 条历史；完整尾游标续读当前商品，再合并后续商品索引流，禁止逐页重跑候选子查询。回归捕获真实 `ReportQueryService.snapshot` SQL，在 Node SQLite 检查实际 EXPLAIN，再用本机 `python3` 标准库只读重放同一受控数据库、检查计划与返回条数，并按每条 SQLite VM 指令计工作量；文件由原夹具 dispose 回收，不使用用户账本。两种引擎都须命中 `ledger_report_history`，不得出现历史全扫、候选子查询或临时排序；覆盖单商品/129 商品的同时间 ID 分页、512→1024 个不同商品、窗外及无关商品噪声、分页取消和跨商品批次的全局时间过窗。2048→4096 条或候选商品翻倍时 VM 指令增长须小于 2.6 倍；分别增加 4096 条同商品窗外记录和无关商品记录时须小于原工作量的 1.1 倍。查询次数仅作批量读取辅助断言，不能替代实际计划与扫描工作量；这些结构门禁不替代 D07 真机耗时/内存验收。现有 `app-common` 自动发现上述单测，源文件变更沿既有报表专项分流，无须新增套件或默认启动模拟器/远端 CI。
- 多维原生触摸使用 `report-dimensions`，可分别选择 `report-expense-groups`、`report-expense-analysis`、`report-income-dimensions`、`report-quality`；`report-dimension-details` 只组合频次、质量及五类收入，基础分组和习惯/价格不在该组合内；仅当它们已有覆盖当前改动且仍有效的成功证据时，才可用此较小组合补验，否则选择对应分组或完整多维场景。单用例入口携带 `test00PrepareDimensionReport`：通过原页面应用固定 JSON 日期和专用渠道，准备与业务用例分别遵守原 60 秒上限，每个业务用例最多两种维度；不在每个业务用例重复日期操作。排行定位核对真实分组；WKWebView 的 isHittable 不能单独证明未被固定底栏遮挡，触摸前须把排行行的点击中心滚入内容视口；不要求页面底部的整行全部露出。下钻逐维断言预期组成条数及返回后的维度，不假定有占比的行也显示“查看明细”。新增字典、单位和质量样本使用合法 UUID，避免路由校验丢弃条件后误通过。夹具与总览/时间报表隔离，报表金额按原 MoneyValue 精确节点核对；明细行合并 AX 文本时，沿既有编辑入口核对精确实付并关闭，不猜独立金额节点、不修改或保存账目。回读验证整个账本未被分析改写；专项 `ui-report-dimensions` 与最终完整触摸共用相同用例/夹具，最终报告必须有 `touch-dimensions` 测试和原生回读阶段。日常仍先局部定位，不因新专项自动运行远端或完整验收。
- 会话只绑定 create 新建的 iPhone 14 Pro Max / iOS 27.0。每次运行及关闭前都核对会话真实路径、清单权限、UUID、runtime、型号、名称和可用状态；不接管已有设备，不自动换设备。局部失败保留本轮设备、日志和失败回执，可以修复后在同一会话重试；追溯最近一次实际进入测试的运行，若失败或未写完执行回执，下一次显式触摸运行先重启同一 UUID 的设备以清除遗留自动化进程，继续复用原构建。其后的构建、安装或初始化失败不能遮住该历史记录，只有后续成功测试才解除这一恢复要求。局部与完整原生入口都不收集耗时的 sysdiagnose，仍保留日志、截图、xcresult 和原断言；完整验收前可 suspend 关闭本轮设备的运行但保留缓存，需要回查时 run 恢复；本轮全部工作结束必须 close，关闭后再次运行明确拒绝。close 重复执行安全，只删除该会话设备和专用构建缓存，保留必要证据。
- 原生探针使用随机数据库并自行回收。UI/Release 与 App/Debug 局部共用安装登记和宿主空账本隔离：首次安装、App 包变化或方案切换需要更换包时，经冷安装和正式初始化生成新数据集；停止宿主后由[基线工具](../../scripts/fixtures/ios-ui-baseline.py)捕获 SQLite 一致性备份。ui-install.json 保留历史文件名，统一登记两种方案已核验的本会话 runId、设备 UUID、App ID、实际沙盒路径和 App 包摘要，ui-baseline/receipt.json 另绑定 schema、datasetId 和备份摘要。捕获须拒绝自定义字典、账目、模板、调整、草稿和幂等回执。后续先核验归属及安装，再成功终止宿主、完整校验基线，通过下述受限重置日志替换该沙盒的 Library/OfflineLedger；偏好、草稿、维护状态及内部快照一并恢复初态，替换失败回滚原目录，不能延续上一轮业务终态。每轮仍重新调用[受限夹具](../../scripts/fixtures/dictionary-touch.py)准备所选场景并生成本轮 fixture.json，再真实执行用例和只读回验；不缓存通过结果或预写待验收终态。恢复/清空造成的合法数据集切换按[数据管理验证](#导出完整备份与清空)的终态回执核验，不能将任意新数据集视为可重置夹具。篡改、符号链接或归属不符时拒绝恢复；不重置沙盒外路径，不在会话中输入或导入真实账本。旧脚本未登记的安装先做一次冷安装；切回已有方案复用对应构建产物，不将另一方案的数据终态用于新基线。完整入口维持正式初始化和拒绝覆盖既有数据的规则。
- [分层缓存](../../scripts/lib/ios-cache.mjs)将类型检查、前端打包/Capacitor 同步、hosted 探针、原生 build-for-testing 分开。各层以自己的输入、工具链及输出内容摘要判断，缺失、篡改或失败的层不能命中；原生层还绑定 scheme/configuration 和实际资源摘要。仅 Swift 定位器变化时只重编原生层；探针源变化不重打前端资源；仅脚本夹具变化不重编安装包，但会使执行证据失效。DictionaryTouch 不构建未消费的 hosted 探针。App 和 UI runner 分别比较已安装包与当前产物的内容摘要，测试定位器变化通常只更新 runner；App 包变化则冷安装并重建基线，不能把旧 schema 或默认配置基线用于新包。初始化失败不撤销正确构建和安装；原生构建、安装或初始化故障只强制重做相应阶段，局部修复后恢复缓存，完整失败锁及次数保持。缓存只省准备工作，每次仍核对真实执行数量、断言、完成信号和持久化结果；输入在构建或执行期间变化不得判为当前版本通过。完整验收仍按原范围重新生成资源，不消费局部缓存或旧测试结果。
- 完整流程先校验脚本语法，再执行启动时的不可变快照；执行期间脚本变化不破坏当前进程，但本轮不能认定当前脚本通过，需冻结后复验。所有入口共用工作区命令锁，避免同步资源和构建互相覆盖；并发调用明确拒绝。中断转发给本命令的子进程组并释放命令锁。若进程被 SIGKILL 或宿主崩溃导致锁遗留，先核实 `.local/ios/tmp/ai-agent/ios-command.lock/owner.json` 中 PID 已退出且无相应子进程，再移除该锁；禁止清空共享目录或接管其他任务。

除只读 list 外，命令入口另保存 ios-invocation-*/result.json（scope=invocation），记录包含前置检查的总预算、单调累计耗时、preflight/execution 位置及最终状态。前置检查超时也有证据；尚未取得有效工具链/证据时不创建完整尝试、不消耗完整复验次数。该回执不作为局部修复或完整验收资格。CI 各验证 job 均归档这组入口回执。

整轮预算回归位于 ios-verification.test.mjs，可先用 Node 24 的 `node --test --test-name-pattern '完整触摸.*预算|整轮预算|单调整轮|前置检查消耗' scripts/tests/ios-verification.test.mjs`。受控 CLI 只推进单调时钟，不编译或启动模拟器：验证完整触摸超过 15 分钟但仍在 40 分钟内可完成；前置检查和执行累计超过 40 分钟则失败，保留完整失败锁，旧成功回执不能重试解锁；原生烟测和局部仍按 15 分钟截止。另核对入口与子流程预算同源、阶段上限以及 CI job 的 45 分钟外层限制。统一 script-tests 与 CI 消费同一回归，不以虚拟时钟结果冒充页面或性能验收。

common / ios-build 的工程检查保存于 ios-command-*（scope=engineering），包含 result.json、progress.json 和 timings.json；独立活动许可绑定工作区命令锁及模式，不能直接调用内部 Shell 跳过阶段计时。这类结果不记为局部修复或完整验收，也不消耗完整尝试次数。CI 各验证 job 均归档对应阶段证据，job 超时仍是额外的外层限制。

XCTest 可能在安装校验时迁移数据沙盒 UUID。卸载前先核对原安装回执的会话、设备、沙盒路径及已安装包摘要；路径须属于该设备的 Application UUID 目录，拒绝错误层级、跨设备和符号链接。旧沙盒已搬走本身不算损坏，但实际路径变化须先停止宿主，以旧安装摘要校验来源基线和实际库的 schema/datasetId，全部一致才原子更新当前沙盒绑定；新候选包变化也不能跳过该步骤。同路径冷替换前也验证当前库与已有基线的数据集和 schema；validate 可恢复有效的目录替换断点，但不将旧终态重铺为基线。基线保留捕获来源路径。缺少基线、跨设备、不同数据集、损坏库或未确认重绑时拒绝卸载、清除基线和覆盖回执。随后仍恢复空基线并重新准备当前场景；合法新包变化才走原冷安装路径，重绑本身不修改业务数据，也不代表测试通过。

UI 重置在移动目录前以权限 600 写入本会话 ui-reset.json，绑定安装归属、基线摘要、schema/datasetId 和随机操作 UUID。重试先校验日志与基线：正式目录缺失时仅从该操作的原目录回滚；正式目录有效时完成该操作的残余清理，再按原规则重铺当前场景。两次移动之间、第二次移动后及部分清理被终止均可在同一会话恢复，连续中断不要求重建模拟器；日志篡改、跨数据集、链接或缺少唯一原目录时拒绝猜测并保留证据。不得在日志仍有效时提前删除其临时目录。新 App 包冷安装已卸载旧安装后清除旧断点，close 也回收断点，不影响完整失败锁。

局部安装阶段按 native-install/方案/配置/app 和 /runner 分别记录修复目标。两种方案在 App 安装成功且实际包一致后立即保存 ui-install.json，不能只登记 UI 而漏记探针替换；runner 失败不得撤销 App 回执或卸载有效 App；重试只重做对应组件。两组件共用原两分钟总安装预算，runner 阶段只取得剩余预算，并在 timings.json 分别记录。完整入口借用调试会话时也使用同一安装/数据集校验；仅在受管 App 卸载成功后失效旧安装登记、基线和重置日志，卸载失败保留它们。随后完整流程自行冷准备，返回局部时重新建立登记，不继承完整验收的数据终态。完整 UI 每组测试结束并成功停止宿主后，重新查询当前沙盒路径，再执行回读及下一组夹具准备；停止或查询失败必须阻断，不能沿用测试前路径。旧完整回执只有整体 native-install 键时，仍要求两组件实际重做后才补整体覆盖；仅 runner 通过不得冒充整体安装修复。局部修复只恢复缓存，完整失败及复验次数继续保留。

局部 UI 夹具完成且连接关闭后，以 simctl 预启动 App 并保持前台，使首屏渲染与 runner 准备并行；XCUITest 仍建立真实会话、执行原用例和断言，不延长单例 60 秒预算。正式初始化前的启动与该次预启动分别保留 initialize-launch.log、ui-launch.log；预启动失败同样恢复原 UUID，不撤销有效构建和安装。完整入口和用例内部主动重启保持原路径；预启动不计为首次安装或冷启动性能通过。installationReused 仅指跳过脚本显式安装，XCTest 自己的安装校验仍计入测试准备，不承诺消除系统开销。

局部 result.json 的 buildLayers 逐层记录命中；installationReused、runnerInstallationReused、fixtureBaselineReused 分别记录 App、runner 和空账本基线复用，containerRebound 记录已核验的沙盒搬迁，未执行的能力不计入本轮覆盖。会话 layer-*.json 仅保存准备层摘要，close 回收本会话 DerivedData、基线和安装回执，保留日志、xcresult 及工作区失败锁。缓存与数据隔离优先执行 `node --test scripts/tests/ios-cache.test.mjs`，覆盖输入/产物缺失与篡改、失败不缓存、依赖传播、App/runner 独立核验、跨场景重铺、偏好/草稿/快照隔离、归属/摘要/链接拒绝、沙盒搬迁、替换失败回滚与四处终止后的连续恢复；统一 CLI 的初始化失败后缓存恢复、卸载前错误回执拒绝与合法新包迁移、UI/Release→App/Debug→UI/Release 切换及安装失败重试、完整借用重置/卸载失败、跨组沙盒迁移后回读路径刷新及完整失败锁回归位于 ios-verification.test.mjs。真实 SQLite 的新包数据集隔离及冷替换前跨数据集拒绝位于 ios-cache.test.mjs。登记的工具回归和 App 工程套件与 `debug check --check script-tests` 纳入同一文件，原生 job 归档分层回执。不为脚本回归额外启动完整原生验收。

SPM 准备机制见[构建架构](../architecture/architecture-decisions.md#离线-ios-原生入口)。ios-cache.test.mjs 的干净检出场景在临时工程中使用真实 native:sync、锁定 Capacitor CLI 和独立插件副本；仅将未受影响的 Vue 编译替换为最小资源准备，不调用 Xcode、模拟器或网络包解析。断言首次无 CapApp-SPM/Podfile 时同步成功、生成 Swift target 源与 iOS 27.0 清单、重复同步与缺失骨架恢复不覆盖项目，并拒绝链接写入。该结果证明 SPM 初始化和同步，不代表原生编译或页面验收。统一 script-tests 在 Linux/macOS 消费同一场景；局部分层构建在 sync 前另记录 spm-prepare.log，沿用原构建阶段预算。

#### iOS 交互与容量复核

沿用 `npm run debug:ios-app -- run --session <本轮独立会话>`，单例选 `--case`，场景选 `--scenario`。`ios-review` 核查六个实际页面在 360×800、390×844、430×932、844×390 下的名称、溢出和网络资源，以及状态栏、Dynamic Type 通知和原外壳。`ios-interaction` 分成三个 XCUITest：横竖屏中文/数值键盘、保存可达与草稿保持，竖屏候选搜索/原生日期，横屏候选选择与收键盘后的页头恢复；`ios-candidates` 仅组合后两项，保留前一项已选分类的真实前置。仅低高度“记一笔”键盘状态临时让出固定页头，短屏候选工具条允许随列表滚动，避免工具条独占可见区；正常页面与样式仍按原基线；hosted DOM 证据与原生触摸分开登记；不声称模拟器执行了 VoiceOver 或真机硬件检查。合法备份密码字段不属于登录入口，外壳守卫按真实登录/组织/管理路由及入口拒绝。

容量采用 `--scenario scale-10000` / `scale-100000`，支持 `-prepare`、`-native`、`-pages`、`-cold` 子阶段；冷启动定位可用 `-cold-01` 至 `-cold-05` 仅运行对应单例，例如 `--scenario scale-10000-cold-02`。单例回执标明样本序号并明确不采 RSS，避免调试时引入无关进程观测；只能作为局部修复证据，完整专项仍须同轮五份样本，不拼接单例成功。完整场景按准备、原生服务、页面、冷启动执行；局部失败仅复验目标子阶段，不重复完整验收；冷启动自动化故障按既有恢复规则仅重启本轮设备，保留 UUID、数据与有效构建缓存。Capacity-Release 独立缓存与 Bundle 不替换普通调试 App；安装绑定本轮设备、会话和新旧制品。夹具在检查摘要、schema、数量、datasetId、完整性/FK 后才原子安装至隔离 App 的动态沙盒；外部安装、错误回执和未关闭旁路文件拒绝接管。已验证兼容的夹具可复用，测量仍绑定新运行/源码/制品，不拼接多轮局部成功。 换库前在受管容量沙盒内先登记精确操作，绑定会话、设备、独立 Bundle 与操作 UUID；先写权限 600 的会话/设备专属临时登记，完整写入、刷新并关闭后原子发布正式登记，发布前不复制数据库。未发布的空/半写入文件只在受管沙盒的精确专属路径清理，并校验文件类型、所有者、权限、链接数及大小；其他会话文件和非法正式登记不自动删除。登记失败不复制，复制/权限/校验/提交失败清理本次暂存文件并保留原库，清理失败保留主失败与登记。下轮先停止容量 App、重验安装和沙盒归属，再清理登记的残留；原子重命名后中断只清登记，不回滚已提交主库。跨会话/设备、非法登记及链接拒绝，未知文件不按前缀删除。

合成夹具经正式迁移/服务生成，含两类收支、365 天、退款与约 10% 回收站（保留原始支出用于编辑），500 条有界批次；回收期限从执行时计算。服务阶段观测真实 SQLite 与加密备份/保护恢复；页面阶段通过正式路由、表单和桥调用测量明细/筛选、保存、总览、五种时间粒度、九类支出和五类收入，等待当前查询与渲染、回读精确金额，不能以旧快照或服务耗时代替页面。冷启动从进程退出计至可用表单，XCUITest 结果标为自动化保守上界；同一测试会话内执行五个独立用例，每例输出一份带序号的原始样本。汇总必须恰好收到本轮同源码/制品/设备/数据集的五份无重复样本，缺失或混轮拒绝，不拼接旧结果。模拟器记录基线提交、实际工作区源码摘要和 workingTree 标记，不把未提交源码冒充已验证提交；服务取 3 次、文件 1 次、页面各 1 次、冷启动 5 次，仅为开发观测；App 与唯一关联 WebContent 的 RSS 合计单列，不能混入其他任务或冒充真机门槛。

容量 native/pages 单例预算 600 秒，prepare/cold 及其他单例仍 60 秒；冷启动每例先终止目标 App，再测量真实启动，不预启动目标 App；每轮临时 xctestrun 将失败诊断策略设为 Never，与命令行选项一致；容量 UI target 的 PreferredScreenCaptureFormat 显式设为 screenshots，避免全程录屏竞争启动时的合成/GPU 资源，hosted target 与缓存原清单不改写，失败截图、原始日志及失败状态仍保留。每例单独计时，表单就绪等待使用从启动前起算的 55 秒剩余预算并预留 5 秒收尾，不在 60 秒单例外追加等待，也不扣除慢启动耗时；自动化启动和收尾各受既有 180 秒约束，不能把三段压成 90 秒命令上限，也不延长 900 秒局部整轮预算。收尾仅接纳正常退出，或退出码 3 且明确返回 found nothing to terminate 的已停止终态；该预期终态不先触发异常取消，其他退出、超时及取消仍失败，补偿异常保留具体原因。既有构建/安装/初始化预算累计、失败锁保持。普通 smoke 使用 App scheme 的 NativeTests，不加载 Capacity scheme，日常检查不暗中跑大数据。启动失败先对照 XCUITest launch/自动化会话、WebKit 进程启动/导航与 SQLite 就绪时间；必要时用同一隔离安装包直接启动并短时采样定位，诊断启动不计性能通过，不清空缓存或改变其他服务。冷启动清单/收尾回归由 ios-capacity.test.mjs 的“逐次测试清单”“容量收尾”“冷启动五单例”覆盖，共享执行器沿用 ios-ci.test.mjs 的超时/取消/嵌套清理回归。当前登记 `ui-ios-interaction`，规模专项已接入同一 CI 规划/对账入口，远端仍按需触发。

真机执行器为 `Capacity` Release scheme，两个测试 target 支持 iPhone SDK，原有模拟器守卫不放宽。可信 Mac 按[容量配置](../architecture/environment-configuration.md#离线-app-原生测试配置)设置独立 Bundle、名称及目标设备，签名后执行同组 XCTest，冷启动不挂调试器。`node scripts/ios-capacity-report.mjs receipt.json native-test.log report.json [device-capture.json]` 只消费一次真实成功输出，不触发重跑、不覆盖旧报告。device 报告必须绑定同一运行、源码、制品、夹具和设备，要求干净工作区的 Release 候选，包含端到端时间窗、至少 30 次交互/各 5 次重操作、完整窗口 App/WebView 组合内存与正确性结论；缺项、样本不足或环境不符拒绝通过。组合内存同样绑定运行、源码、制品、设备和规模；冷启动连续测量段的进程缺席必须显式标注，不能用零值掩盖其他操作缺测；MB 按十进制计。服务计时、协议单测和未签名编译不证明真机性能。V14 真机容量、VoiceOver、文件选择/分享、锁屏/重启等随 T17 最终候选集中执行，未完成前保持待验证。

局部 UI 预启动将 App 的原生 stdout/stderr 写入本轮 `app-stdout.log` / `app-stderr.log`（600）；只在受管模拟器及本机私有证据目录保留，不开启远程 Web Inspector。候选原生命中检查使用实际节点类型与可见区域，不能仅凭 WebKit 的 isHittable 点击被工具条或固定栏盖住的行。

协议/隔离回归用 `node --test scripts/tests/ios-capacity.test.mjs`；换库局部选 `--test-name-pattern '容量登记|容量换库'`，用真实 SQLite/文件及创建后写入前、半写入、发布前后、复制后、提交后的子进程强杀验证恢复，并覆盖部分写入与清理同时失败后的重试，不启动模拟器或重复规模观测。外观通知乱序与释放、容量夹具及原设计基线使用对应 App Vitest 局部文件。采样停止或部分证据落盘失败仍尝试停止隔离 App，保留主失败与补偿失败，不能改记测量成功。

#### 统一套件、按需 CI 与最终验收

[套件登记](../../config/ios-ci.json)统一维护本项目已有检查的执行类型、Linux/macOS 归属、固定范围、专项影响路径、测试文件排除及确有覆盖关系的去重。登记只接入离线 App 的现有执行器，不注册旧 Web、Java、PostgreSQL、服务器部署或尚未实现的真机性能能力。[CI 规划器](../../scripts/lib/ios-ci-plan.mjs)、[执行与对账](../../scripts/lib/ios-ci-run.mjs)由本地和远端同一入口调用；不查询历史绿色或计费，不继承旧提交的验收结论。

验证范围分为日常局部、固定集合和变更专项。日常局部用 `debug check --file/--name` 或原生 `--case/--scenario` 选择目标；固定集合定义该集合一旦执行就必须完成的内容，不表示每次保存、提交或推送都执行。`change` 则按本轮变更选择固定工程集合及必要专项；只规划不执行，须显式调用 `run` 才开始检查。

专项以套件为选择单位，不自动把所有套件缩成单文件。例如 App 改动通常会选中 `app-common`，它会运行全部 App 单测及工程检查；`.spec.ts` 变更不因此额外选中 UI 专项。需要快速定位时先用日常局部入口，不为生成正式 CI 报告重复已经充分且适用的局部验证。

| 范围 | 实际覆盖与使用条件 |
| --- | --- |
| `change` | 显式 base/head 的变更验收：基础 secret 检查，按登记追加 App 工程、原生、具体 UI 场景及依赖审计；同一专项合并多条理由，不自动运行完整 touch |
| `scripts` | Linux/macOS 验证工具回归与 secret 检查；不编译 App、不启动模拟器 |
| `app-common` | 常用固定工程套件（根目录 `npm run check:app`）：全部 App 单测及同次执行的 V8 覆盖率、验证工具回归、类型检查、随包资源与探针构建、资源/设计门禁；不启动模拟器 |
| `app` | App 工程、未签名 iPhone Release 构建及原生 SQLite 集成；不包含完整页面触摸 |
| `final` | App 工程、Release 构建、原生 SQLite、完整原页面触摸、两种规模模拟器专项及依赖审计；固定最小门禁不能被登记删除或由局部替代 |
| `recovery`、`scale-10000`、`scale-100000` | 本地单专项复用成对恢复或 Capacity 原执行器，远端也可显式请求同名单项，规模必须包含准备、原生、页面、冷启动及组合 RSS；缺阶段、混轮、少跑和错误指标拒绝。不是目标真机性能通过 |
| `install-gate` | 仅可信 Mac 显式提供安装材料时执行，未接入自动触发；缺手机/报告/签名或候选不符保持未完成，不能由工程绿色兜底 |
| `dependency-audit` 或其他登记套件名 | 本地可只规划单套件；远端除上述范围外仅提供独立依赖审计，避免引入多套入口 |

覆盖率随既有 App 测试一次采集，固定最多两个 worker 控制插桩并发开销，不延长单测默认时限，也不再单独重跑同一套测试；V8 provider 与 Vitest 同版本锁定。范围为 app/src 的可执行 TS/Vue，排除 spec、声明与生成 API 类型。覆盖率目录独立于执行日志，包含未导入源码；对账重新计算逐文件与总计、校验完整源码清单及摘要，缺文件、坏计数、映射缺失或整轮零执行点不能通过；纯类型文件可以没有执行点，真实 0% 基线仍保留，不用零采集伪装 100%。位置校验兼容 V8 的行尾 null、Vue 源映射逆序和隐含 else 空位置。当前先记录真实基线，不设虚构百分比阈值；原始 coverage-final/summary 与 proof 随同一 attempt 归档。ios-delivery.test.mjs 用真实局部 V8 采集及坏报告反例验证，不把协议夹具当成真机采样。

原生执行组可在本机 `run --group macos --session "$IOS_DEBUG_SESSION"` 显式复用已核验的本轮会话，结束只 suspend、保留缓存；未提供时创建本组设备并在结束 close。外部/闭合会话拒绝，失败与完整锁仍按原规则保留。性能页面、共享组件的所属规则同时登记 UI 与两种规模，命中 UI 不代表容量已覆盖；API、查询/报表组合逻辑、存储、启动和依赖按各自影响选择规模专项，单测、声明与生成类型排除，字典管理等无容量消费的页面不因此追加规模；无已知专项归属的 app/src 运行源码保守追加原生和两种规模，spec/声明/生成类型不走这条兜底。

本地完整规模在发布成功前与 CI 收集/汇总共用同一报告校验器，失败不登记绿色。规模对账核验冷启动设备、mode 与 automation-upper-bound 口径；页面/冷启动时间窗必须落在真实执行阶段内。RSS 报告由同一采样器绑定 runId、源码/制品、设备、规模、mode、datasetId 及 windowStart/windowEnd，时间必须有限、单调且位于本轮窗口，原生/页面/冷启动阶段均有实际观测，不以峰值自洽代替来源。新增字段缺失的历史报告仍是原版本证据，不能补字段后冒充当前完整规模汇总；需要新汇总时由原执行器采集。模拟器仍只作观测，不套用真机绝对门槛或要求真机连续采样。

CLI、局部回执、CI 汇总及完整失败锁共用 ios-errors.mjs 的有界原因链，主失败、嵌套 cause 与各补偿失败均保留；循环及过大链截断，不输出堆栈或任意对象属性，不改变失败/取消状态和清理预算。

可信手动交付入口（T17 实际签名候选才执行）：

```bash
npm run ci:ios-app -- signing-check --app "$IOS_SIGNED_APP" --candidate "$IOS_CANDIDATE" --output "$IOS_SIGNING_REPORT"
npm run ci:ios-app -- install-gate --input "$IOS_INSTALL_INPUT" --output "$IOS_INSTALL_REPORT"
```

以上变量为本次命令参数，不是 App 运行环境配置。candidate JSON 保存 source（同 CI 的 commit/hash）、configuration=Release、workingTree=false、debugger=false、正式 appId、artifactHash、capacityArtifactHash、measurementSourceHash、teamId、version、buildVersion、deviceId。正式 App 与独立容量 App 的制品摘要分开，测量源码、版本和 Team 必须一致。signing-check 在干净检出上核对实际 App 摘要、codesign、Info.plist 和描述文件的 Team/设备/有效期，并提取实际签名 entitlements 与叶证书：App ID 精确匹配或合法尾部通配、独立 App ID prefix、权限不超过 profile allowlist、实际证书在授权列表内；App 主动收窄布尔权限可以接纳。授权证据随 signature.authorization 保存，install-gate 使用同一校验器重新核验；缺少该证据的旧签名摘要须重新运行 signing-check，不能手填通过标记。临时描述文件及提取材料处理后回收，不生成或更新证书。签名检查不证明已安装或真实业务已验。

install-input JSON 的 ci/candidate/signature 为对应文件路径，devices 为两份 `{receipt, observation, capture}` 原始真机材料路径数组（含 1 万/10 万条）。ci 必须是现有结果目录的 ci-result.json，入口重新对账其计划、实际原报告及同源码完整候选；候选工作区不干净、签名过期、缺设备/指标、Debug、模拟器、错误候选及稳定性失败均拒绝。1 万条硬指标必须通过，10 万条仅性能超目标可观测；原始材料和逐项判定保留到 install-report.json。也可先 `plan install-gate`，在该结果目录显式放置 install-input.json 后运行 macos 组；不将它追加到普通 final 以自动索取手机/证书。真实性能、安装/升级及 VoiceOver 等仍按最终候选另验，协议测试不代跑。ios-delivery.test.mjs 覆盖空采集/合法零覆盖、性能专项分流、规模来源/窗口及落盘原因；ios-signing.test.mjs 用合成授权和受控 codesign/security/plutil 验证共享授权规则、真实 CLI 提取/拒绝接线和临时文件回收，Linux/macOS 均由普通工具回归自动发现。受控工具不证明真实签名或安装通过；失败锁原因链由 ios-verification.test.mjs 的 T15 用例核验。

日常定位仍先使用上面的 `debug check --file/--name`、原生单用例或小场景，不为取得新登记回执重复测试。需要有固定范围与正式报告的集中检查时，在仓库根目录执行：

```bash
npm run ci:ios-app -- check
npm run ci:ios-app -- list
npm run ci:ios-app -- plan change --base "$(git rev-parse HEAD^)"
# 使用 plan 输出的 directory；只执行其中实际存在的组，先 Linux/通用检查，再按必要性执行 macOS。
npm run ci:ios-app -- run --results "$IOS_CI_RESULTS" --group linux
npm run ci:ios-app -- run --results "$IOS_CI_RESULTS" --group macos
npm run ci:ios-app -- result --results "$IOS_CI_RESULTS"
```

`IOS_CI_RESULTS` 是本次 `plan` 输出的 `directory`（`.local/ios/tmp/ai-agent/ios-ci-*`），不是旧运行目录。固定或单套件范围如 `plan scripts`、`plan dependency-audit` 不要求 base；`change` 必须使用可核实的完整 SHA，head 默认且必须等于当前检出提交。规划按 `git diff --no-renames` 同时检查重命名旧、新路径，并包含本地未提交和新文件；已删除路径仍参与影响选择。范围未知时明确拒绝，不猜空变更、不强制扩大为全量。普通说明文档和旧端变更仅运行 App 适用的基础检查；作为程序或执行规则输入的 README、DESIGN、测试规范及 CI 配置按登记保留相关门禁。App 单测及纯数据/组合函数变化优先保留工程或必要原生集成，不因命中业务路径而额外启动所有 UI 场景。启动入口 `index.html`、`main.ts` 和 `stores/bootstrap.ts` 追加原生 SQLite 与原页面首屏专项；`App.vue` 在保留这组启动检查的同时，按共享根组件的缓存、路由出口、全局撤销与通知职责选择跨页 UI 专项，覆盖明细编辑返回和报表下钻返回，不降为仅首屏检查，也不自动改成完整 touch；通用组合框及全局状态组件按实际消费者覆盖相关页面，商品/名称输入控件限于录入和个人配置，字典筛选控件限于明细与报表，不因名称含 Dictionary 而附带字典维护专项。对应 `.spec.ts` 仍只走工程检查。新增共享入口、业务消费者或独立场景时须维护影响路径；自动选择不替代影响分析或页面呈现验收。

机器计划 `ci-plan.json`绑定源码内容、提交、登记、变更范围、必跑套件和命中理由；执行前后及总对账重新规划，拒绝删减必跑项、旧版本、参数变化或执行中修改源码。执行器复用原命令、受管模拟器和证据锁，同一 macOS 组复用其新建的独立设备，结束时关闭自己的会话。每套件保存运行/失败/完成回执和原报告副本与摘要，不能覆盖已有运行或失败现场；组清理失败也使整体未完成。跨主机只核验携带的原报告，不读取另一台机器的绝对沙盒路径。远端每组按 attempt 独立归档，重跑失败作业沿用原计划制品名；汇总仅采用每组最新 attempt，最新失败/缺失/错误计划不能回退旧绿色。未重跑的组保留同计划有效报告；job 本身失败或取消仍使整体未完成，历史归档不覆盖。

`result`逐项对账必跑与实际，生成 `ci-result.json/md`：缺项、失败、取消、额外套件、错误环境/版本/范围、原报告缺失或被篡改均不能通过。原生实际用例、App 单测数量和脚本回归摘要须与原报告对应。由 [报告校验器](../../scripts/lib/ios-test-reports.mjs) 按 mode 核对工程/资源、原生构建/安装/初始化及相应测试、恢复或回读的必需阶段和原日志；原生构建须有实际成功信号，缺少阶段不能靠重新计算摘要补足。脚本调试、完整入口和 CI 共用 TAP 执行与校验：必须有实际通过用例，失败、取消、TODO、空执行及计数不完整均拒绝；Linux 仅允许套件登记 `scriptSkips.linux` 中明确列出的 macOS 专用测试，逐项 SKIP 名称和数量必须对应，重复、未登记及错误平台跳过均拒绝，macOS 不允许跳过。独立脚本 runner 清除继承的 Node 测试上下文，输出上限 16 MiB，超出或执行失败不能取得成功回执。单组通过不代表整体完成；只有 `final` 全部必需项及组清理通过才输出完整候选标记。[共享进程清理器](../../scripts/lib/ios-processes.mjs) 同时供外层 CI 与内层 App 命令使用：每个外层命令建立独立的私有父子登记，内层启动时持续登记本分支进程组，取消后新建的补偿组也归属原调用。补偿工具须在进程组登记完成后才经内部管道放行；父进程在登记前后退出则管道关闭，实际工具不启动。超时/取消同时采集 PID/PPID/进程组快照以覆盖未使用执行器的现有后代，再通知直接进程组退出；最终清理先关闭当前登记分支，读取其中仍活动的组，再强杀内层和外层组。关闭标记写入失败仍继续读取并清理已登记组，同时保留清理失败；不增加等待或延长宽限。关闭后拒绝续建，其他分支和其他调用的范围不能混用。快照只读取进程标识，不读取命令参数，其中进程查询上限为 500 毫秒并计入既有 10 秒宽限；读取失败保留清理失败，不能判成功。重复停止不延长宽限，完成后迟到回调失效；已耗尽的创建补偿保持零宽限，不额外扫描或等待。正常完成仍保留原退出结果，不扫描进程树；仅回收当前命令自己遗留的直属/已登记组，不清理其他任务。活动索引在叶子完成后摘除，不逐轮扫描已完成的测试历史。私有登记位于 `.local/ios/tmp/ai-agent/ios-process-*`，仅含归属令牌、父子 ID 和 PID；正常关闭后回收，清理失败保留给既有 CI 诊断制品，不作为构建缓存或验收证据复用。JSON/Markdown 是工具本轮产物，不新增开发计划或阶段报告。

本节执行规则的局部回归运行 `node --test scripts/tests/ios-ci.test.mjs`，覆盖逐项缺少必需阶段、启动及共享组件分流、TODO/非法与合法平台跳过、真实临时进程的超时/取消清理、嵌套独立进程组及外层先强杀、取消后补偿新建组、关闭标记落盘失败后的登记组清理、登记前后中断的工具拒绝、慢预检就绪与独立预算、父子/跨调用隔离、正常命令与其他任务保护、迟到回调和快照失败、attempt 隔离与审计受阻；正式 `script-tests` 自动发现同一测试文件。调试单项可用 `--test-name-pattern`；嵌套清理场景还可用 `--test-skip-pattern` 排除其他子场景，例如只定位外层超时：`node --test --test-name-pattern 'CI 真实内外层' --test-skip-pattern 'outer-SIGTERM|outer-SIGINT|outer-force|inner-' scripts/tests/ios-ci.test.mjs`。不将过滤执行当成整套成功证据。进程回归将执行预算与清理宽限分别设置，不以全局毫秒匹配混改两类计时器；仅通过 `runCommand` 内部参数 `cleanupGraceMs` 将清理宽限缩至 0–10000 毫秒，正式调用仍默认 10 秒，没有 CLI 或环境覆盖入口。取消从创建进程的就绪信号后触发，慢预检超过缩短后的宽限仍须进入目标场景；真实超时仍由独立的执行预算触发，清理耗时不能从预检开始计算。这里只改变调度和报告契约时，无需构建 App 或启动模拟器；远端仍按需触发。

依赖审计复用 [OSV querybatch](https://google.github.io/osv.dev/post-v1-querybatch/)，仅收集 `app/package-lock.json` 的 npm 直接/传递/开发/可选依赖及 Xcode 提交的 `Package.resolved` 中 Swift URL+版本（无版本时使用锁定 revision）。锁损坏、空集合、不支持项、网络/HTTP/格式错误、返回缺项、循环分页或超出预算均保留未通过，已知漏洞直接阻断该套件；不自动升级依赖、接受风险或添加豁免。审计报告列出全部受检锁项、时间和发现；不证明操作系统、未锁定外部制品或所有原生代码无漏洞。依赖输入变化自动加入 `change`，`final`必跑，也可单独按需执行；不新增每日或定时远端任务。

[远端工作流](../../.github/workflows/offline-ios.yml)仅手动或专用标签触发，普通分支 push/PR 和普通标签不启动。计划生成 Linux/macOS 分组矩阵；各组读取同一计划并归档原报告，总结果 job 合并并对账，失败/取消 job 不能被报告绿色遮蔽。通用/脚本组沿用 10 分钟、原生组沿用 45 分钟外层预算；本地组执行也从前置检查累计同一预算，各阶段及单用例上限继续独立生效。普通请求标签为 `ios-ci/<scripts|app|final|dependency-audit>/<唯一名称>`；`change` 标签须写明起点：`ios-ci/change/<完整 base SHA>/<唯一名称>`。例如仅请求脚本回归：

```bash
IOS_CI_TAG="ios-ci/scripts/$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
git tag "$IOS_CI_TAG" HEAD
git push origin "refs/tags/$IOS_CI_TAG"
```

标签固定被测 SHA，不删除或重写既有请求标签。工作流位于默认分支后，也可在 Actions → offline-ios → Run workflow 选择分支及 `verification`（默认 `scripts`）；选择 `change` 时提供 `base_revision`。本地命令不会创建标签、发送 dispatch 或等待远端；远端计费、额度、排队或平台故障单独保留受阻/待验，不阻塞已有本地证据支持的开发、提交和推送，也不自动重跑或扩大范围。原有完整失败锁、缓存隔离和阶段/整轮超时继续生效，受阻不等于通过。

最终候选稳定后集中到一次 `final` 请求，不因提交、推送再本地全跑；远端受阻时可完成本地必需验证继续交付准备，远端运行能力仍待验。完整失败先回到相关局部修复，没有新证据不重复完整验收。指定 iPhone 的 Release 签名安装、断网冷启动、升级及 D07 容量性能仍独立验收，模拟器或完整候选标记不替代真机条件；未完成前不宣布最终交付通过。

普通工具回归按 `scripts/tests/ios-*.test.mjs` 自动发现，局部和完整入口共用同一叶子执行器与文件集合；新增文件同时使输入证据失效，不接入旧端测试。新增 UI 用例须同时接入现有选择器与单例/场景登记；未接入的 Swift UI 测试会被 check 拒绝。原生交互专项的源码通配路径排除 `**/*.spec.ts`；仅改 textScale、appearance 或 useKeyboardViewport 单测时只选 secrets/app-common，实现或混合变更仍选原生交互，分流回归位于 ios-ci.test.mjs 的 `T14 单测变更`。新增/调整套件须同步登记与影响路径、原执行器和报告语义，并先执行 `npm run ci:ios-app -- check` 及 ios-ci.test.mjs 中受影响的定向用例（`--test-name-pattern`）；共享协议受影响时再扩大范围。涉及原生编排且低层无法覆盖的变化才补相关独立模拟器局部场景。该回归经既有 `script-tests`、App common 及按需 CI 同源消费，覆盖改名双向路径、范围隔离、计划篡改、失败/缺失/空报告、跨目录对账、失败锁保护与依赖审计故障，不用受控执行器测试冒充 App 页面或远端验收。

非原生局部检查保存于 ios-check-*；原生局部运行在会话的 run-* 下保存独立日志、xcresult、SQLite 回读和 `result.json`，标明 scope=partial、所选/实际用例、构建与执行输入摘要、完成时间、缓存命中、状态及耗时，成功时输出 EVIDENCE=路径；局部绿色不更新完整验收状态。[脚本回归](../../scripts/tests/ios-debug.test.mjs) 经 check:app 执行，覆盖选择/前置、会话与设备拒绝、内容摘要失效、夹具拒绝与回读、命令锁与脚本快照边界；[执行约束回归](../../scripts/tests/ios-verification.test.mjs) 经同一入口检查缺少/失效证据、跨会话及跨版本/跨套件失败锁、A→B→A 历史次数、多份跨层证据及逐目标时序、具体场景隔离、common/ios-build 实际 CLI 阶段超时与许可、真实新故障复验、无关修复/空匹配拒绝、分阶段及入口累计时钟、前置检查超时/活动进程取消/创建失败补偿上限、修复后缓存恢复且失败锁仍保留、成对恢复、内部入口许可、首败取消与清理；测试使用隔离临时工程与可控子进程，不冒充 App 页面验收；成对恢复、普通场景、UI 安装/预启动及创建补偿 CLI 的受管模拟器分支回归仅在 macOS 执行，使用受控工具替身验证编排，Linux 的 common 检查明确跳过这些受管分支，macOS 验证 job 再执行。真实原生运行、设备复用及关闭仍需通过 CLI 在独立模拟器验证。新增入口及完整入口变更纳入同一 Actions 触发路径；不放宽原超时、断言或真机 Release 性能要求。

#### 收支保存与编辑

收支写入先运行 `debug check --check app-tests --file src/data/entries/entryService.spec.ts`；表单错误/冲突接入运行 `debug check --check app-tests --file src/components/entrySubmission.spec.ts`，失败可用 `--name` 仅选择对应用例。`testOfflineEntryWrites` 共用 [entryScenarios](../../app/test-support/entryScenarios.ts)，在原生 SQLite 验证精确量价、引用、幂等、旧编辑回放冲突、时钟回拨后重试、最终回执故障回滚、撤销和旧版升级。v3→v4 覆盖 205 条跨批次快照检索键回填、数据步骤故障时 DDL/数据/履历回滚、用户配置保护及数据步骤/算法摘要篡改拒绝。丢失确认场景丢弃原提交返回值、关闭并重开连接后使用原操作 ID 重试；实际 App 进程重启后回读另由 Release 触摸用例 test15 验证，不把连接重开写成进程杀停证据。

原页面触摸组合使用 `debug run --session "$IOS_DEBUG_SESSION" --scenario entry-cycle`：只带键盘就绪、test15 支出保存/重启/编辑回显和 test16 收入连续录入/另一类型草稿/备注编辑，三项在同一安装及自动化会话连续执行，test15 内部按用例重启 App，test15 结束与 test16 开始之间不额外重置；test15 结束须关闭编辑抽屉，不能让模态层挡住下一条导航。单独定位仍可用 `--case DictionaryUITests/DictionaryTouchTests/test15ExpenseWriteReopen` 或 `test16IncomeContinueEdit`。每次运行结束终止 App，只读 SQLite 回验金额、量价、名称快照和版本；entry-cycle 必须同时保留两笔结果，单收入场景还须确认没有误提交支出草稿。夹具只准备字典及过往名称，不替代待验收的页面提交。完整原生入口包含写入探针，完整触摸入口在字典/末页场景后追加独立收支夹具并连续运行相同两项用例，CI 复用该入口；单用例绿色不能代表组合通过。日常局部通过后不自动全跑，模拟器保存/重开耗时只作开发观测，约定的目标真机 Release 容量指标仍须单独验收。

#### 草稿、偏好与模板

草稿、偏好与模板变更先以 `debug check --check app-tests --file src/data/personal/personalState.spec.ts` 验证 SQL/事务/兼容，草稿调度和偏好竞态分别选择 `src/composables/useLedgerDraft.spec.ts`、`src/stores/preferences.spec.ts`，表单提交冻结复用 entrySubmission 回归。useLedgerDraft 的支出/收入参数化用例覆盖旧慢写失败后直接续写最新快照；连续失败按防抖已到期/尚未到期、续写期间有/无新输入组合验证。失败接管落盘时取消既有防抖，每轮最多一次失败续写；连续失败后推进计时器不得自动产生第三次写入，最新输入及失败提示保持，后续前后台落盘成功后才清除提示。定位遗留防抖时可在该文件使用 `--name '防抖到期=false'`。同组还覆盖清除/切换数据集后迟到失败不复活草稿。`testOfflinePersonalState` 共用 [personalScenarios](../../app/test-support/personalScenarios.ts)，在真实 SQLite 桥验证双草稿重开/过期/非法旧值与失败重试、偏好消费/重置、模板白名单/同名更新/改名合并/失效回退/来源删除、排队旧数据集拒绝，以及 v4→v5 故障回滚与仅补缺省；不能用这些内部场景代替实际页面操作。

草稿、偏好与模板页面局部入口为 `--scenario template-cycle`（键盘前置及 test17–21）和 `--scenario draft-relaunch`（键盘前置及 test22–25），组合 `personal-cycle` 连续执行全部。单个依赖用例显式补前置：test18 带 test17，test20 带 test17/19，test24 带 test22/23，test25 带 test22/23/24；其余只跑目标及必要键盘前置。test19 可单独执行 `--case DictionaryUITests/DictionaryTouchTests/test19DisableTemplateUnit`；单位停用先复用原“搜索单位”控件输入“日常份”、收起键盘，再操作管理行与原确认框，不依赖未筛选列表的首屏或滚动记忆。含 test19 的局部夹具额外准备 21 个 PageUnit 背景单位，使目标落在首屏外；这些背景项保持启用，回读拒绝未停用目标、误停用背景项或改动来源账目。完整流程复用前一分页阶段的长列表。检索/键盘辅助同时由既有末页用例消费，保持其分页与启用筛选断言。均使用本轮空沙盒的独立 t7 合成字典与有效来源，不预写被验收的模板、偏好或草稿；页面执行同名加入、选择/失效提示/移除、双类型输入、真实 Home/终止重启、主题和偏好重置。结束后只读回验对应范围的草稿/偏好/模板、来源账目金额/备注/版本及无额外入账。完整 touch 在收支写入组后准备同一 t7 来源并执行 test17–25，CI 调用相同入口；首次字典阶段显式排除这些依赖不同夹具的用例。新增脚本反例确保未执行、草稿串写或来源被改写均不能通过。上述局部场景不携带调整/回收站验收，不替代最终真机性能与交付。设置摘要按完整按钮可访问名称核对，标签和值可能合并；明细优先按按钮/标题定位，OCR 仅作后备。模板成功以子操作层关闭及 SQLite 版本/内容回读核验，不依赖短暂提示；移除核对目标消失并保留其他模板，不把“移除一项”等同于整个列表为空。

金额替换定位先用 `--case DictionaryUITests/DictionaryTouchTests/test22PrepareDualDrafts`，通过后需要验证重启链时再跑既有 `--scenario draft-relaunch`，复用本轮独立模拟器和分层缓存，不重复模板或完整 touch。金额/数量字段共用 replaceEntryField：先以控件点按聚焦并读取原值，再点按输入框右端内侧将光标移到末尾，经原生退格删除旧内容并输入新值；通过系统“完成”结束编辑后，以原有精确值断言核对完整新值，保留 3 秒上限，失败时记录实际值和类型，不重放输入；空框占位值退格安全，不把占位值当作实际旧金额。不依赖“全选”菜单，不用 JS 或改库代替输入。test22 分别经支出 0→77、收入 1234.56→222 覆盖空输入、零值和小数完整替换，再真实 Home/终止 App；test24/25 保留两类草稿重启恢复及偏好重置后不丢失断言。SQLite 回读须同时得到当前数据集的支出 77 和收入 222，且来源账目不变。金额步骤守卫和支出/收入参数化的单类型、旧金额拼接、跨数据集拒绝回归位于 ios-debug.test.mjs，先用 Node 24 的 `node --test --test-name-pattern T7 scripts/tests/ios-debug.test.mjs`；其中直接 SQL 仅用于检查器正反例，不作为页面证明。CI script-tests 与完整触摸调用同一回归和 test22–25，不增加自动重试或延长单例预算。

#### 退款报销与回收站

调整/生命周期变更先运行 `debug check --check app-tests --file src/data/entries/lifecycleService.spec.ts`：Node 与原生共用 lifecycleScenarios 的 5 组调整/生命周期、失败回滚、时钟与取消、批次上限、v5→v6 升级场景；平台事件合并另由 `src/platform/cleanupLifecycle.spec.ts` 验证。`testOfflineAdjustmentLifecycle` 在真实 SQLite 桥执行相同场景。自动清理每批合计最多 100 行、每个前台轮次最多 5 批；先清关联调整再清来源，任何中断均从剩余对象继续。时钟无基线/回退/漂移/跨启动长间隔只延期本轮，不循环重试；状态和最小断点与删除同事务，不能用失败批次冒充已删除进度。

清理收尾故障可先选 `--file src/data/entries/lifecycleService.spec.ts --name 最终状态`；需要联动回归时，按影响选择该文件的 6 项回归及 `src/platform/cleanupLifecycle.spec.ts` 的 14 项事件回归。共享 `cleanupFinalizationScenario` 注入最终成功状态写失败、失败状态再写失败及首批删除失败，验证已提交数量、通知、原因链、维护断点和后续恢复；原有批次故障另验证部分完成提示。原因链仅保留内存，不写入维护 JSON。原生局部入口为 `debug run --session "$IOS_DEBUG_SESSION" --case NativeTests/NativeSqliteTests/testOfflineCleanupFinalization`，只运行新增收尾场景，不隐式携带调整/生命周期的 5 组；完整原生和 CI 自动发现同一测试，日志摘要保留其完成信号。平台回归分别维护 DOM 可见性和原生状态，覆盖两种激活顺序及后台迟到就绪：`--file src/platform/cleanupLifecycle.spec.ts --name 反向乱序` 定位 DOM 可见先到但原生仍后台的两个分支，两路确认前均为零次，原生激活后恰好一次，重复事件不重试。整文件还覆盖原生激活先到、冷启动读到后台、迟到初态不得覆盖后来前台/后台事件、读取/订阅失败、DOM 隐藏通知迟到、取消期间再退后台及重复事件；两路均可执行且账本就绪才能启动。新增 `debug run --session "$IOS_DEBUG_SESSION" --case NativeTests/NativeSqliteTests/testOfflineCleanupForegroundState` 只读原生初态并对照 UIKit 当前状态，验证桥方法和正常冷启动；事件排列由上述平台回归证明，不以只读探针冒充全部生命周期实操。完整原生与 CI 发现该独立测试并保留完成信号。最终状态落盘失败不能吞掉已提交删除的刷新；提示须区分零提交、部分完成、取消和状态写失败，不宣称全部原数据保留。本轮不重试删除，只尽力补写一次失败状态；再次失败保留批次断点及两次原因，后续前台重检。只改变调度、收尾与既有提示数据时，以事件回归和原生单场景为最低充分范围，未改页面的历史触摸证据继续按范围沿用，不重复完整验收。

原生通知与草稿窗口分别验证：`LedgerLifecycleCoordinator` 对 App/Scene 同态通知去重，每次真实前后台迁移都通知 JS；旧窗口尚未释放或申请窗口失败均不得抑制后台通知。后台通知附带递增 generation，草稿完成回执携带同一代次；仅当前代次完成可释放复用窗口，旧完成、旧到期回调及句柄复用不能关闭新窗口，同态通知也不能重新申请已结束/到期窗口。`debug check --check app-tests --file src/platform/draftLifecycle.spec.ts` 通过真实 useLedgerDraft 的支出/收入参数化慢写、双次失败与快速两轮后台入口，验证在途合并、最新输入保持、重复/旧代次和遗留防抖不产生第三次写入，下一真实轮次才可恢复。按影响选择原 `src/composables/useLedgerDraft.spec.ts` 的 21 项调度回归及清理事件回归；不修改草稿已有有界续写策略。原生局部入口为 `debug run --session "$IOS_DEBUG_SESSION" --case NativeTests/NativeSqliteTests/testNativeLifecycleDraftWindow`：在独立模拟器运行生产协调器，使用私有 NotificationCenter 和可控窗口确定复现快切/慢写，核对 App/Scene 去重、两次后台通知、窗口复用、旧回执/到期回调拒绝、无预算仍通知和停止后的回收，并通过实际桥验证无关代次完成的幂等忽略。这是原生受控技术场景，不冒充实际系统到期时长或完整页面触摸；完整原生和 CI 自动发现同一方法并保留完成信号，不另重复运行整套验收。

调整/回收站页面使用 `--scenario lifecycle-cycle`（键盘前置及 test26–30），覆盖退款保存、累计/实付保护、来源冻结/恢复、明确连同删除的取消/确认及启动到期清理；需要定位时使用单用例，test27/test28 各补 test26，test29 补 test26/28，`cleanup-relaunch` 独立验证 test30。复用原明细、调整表单、回收站与危险确认，不增加测试业务入口；夹具只准备有效来源和到期/未到期合成样本，禁止预写被验收的调整、冻结和永久删除结果。结束后只读 SQLite 回验原额/收入、有效调整与状态/版本、关联删除、到期范围、完整性及外键。动态合并文案可按截图包含文本定位，金额仍由实际库核验；表单关闭须核对该表单控件消失，不能误匹配仍保留的同名上下文按钮。CI 原生入口包含相同探针，完整 touch 在草稿/偏好/模板组后追加同一生命周期夹具/用例/回读，首次字典阶段排除这些生命周期用例；局部已通过的步骤不因其他步骤定位失败而反复全跑；明细查询按其独立场景及受影响范围选择。

#### 明细查询与搜索

明细查询变更先选 `debug check --check app-tests --file src/data/entries/ledgerQuery.spec.ts`：Node/原生共用 ledgerQueryScenarios，覆盖多字段筛选、中文/Unicode 规范化、历史快照、字面百分号/下划线/反斜线/引号、按 Unicode 码点计数的 200 字符常驻搜索/收入精确名称及路由往返（中文、补充平面字符及 201 字符拒绝）、编辑后检索键更新、同时间跨日排序、20/20/5 分页、增删恢复、错误/跨数据集游标及实际查询索引。v6→v7 通过 205 行跨批回填、故障整体回滚、金额/版本/偏好保持、数据步骤摘要篡改和旧版拒绝新结构验证兼容；旧迁移不改写。搜索输入与取消先选 `debug check --check app-tests --file src/components/GlobalLedgerSearch.spec.ts`：真实 LedgerView + CachedPageView + memory router 验证清除全部条件、外部替换及 KeepAlive 离页取消，返回后正常查询；组件事件验证中文/补充平面字符 200 码点的输入、粘贴、选区替换、201 拒绝、IME 最终提交、同值上下文与正常回显、停用后迟到输入及显式 Enter/清空。IME 防抖时序可单选 `--name 'IME|KeepAlive 无活动'`：在合法输入后的 100ms 开始预编辑，分别取消至原值或提交第 201 码点，预编辑期间不发查询，结束后合法值只提交一次；对照已等待 300ms 完成提交的值，两种结束均不得重查。连续取消、成功提交与后续输入只取最新值；组合期间执行清除全部筛选、清空搜索、外部不同值/同值/无关键词条件替换和真实 KeepAlive 离页，迟到结束/最终 input 不得复活旧查询，后续正常输入仍可用。无活动状态注入的 KeepAlive 也须取消组合续发意图。DOM 点击触发导航时应等待 router.afterEach（含重复导航）再记录基线，不以固定 nextTick 次数冒充导航完成。JSDOM 事件回归不替代下述 WKWebView 实际键盘/剪贴板。请求竞态选 `src/composables/useIncrementalLedgerQuery.spec.ts`，位置恢复选 `src/composables/ledgerNavigationMemory.spec.ts`，路由兼容选 `src/domain/ledgerQuery.spec.ts`。按影响回归收支和生命周期服务；不为查询改动重复草稿、字典页面或完整验收。原生单入口 `debug run --session "$IOS_DEBUG_SESSION" --case NativeTests/NativeSqliteTests/testOfflineLedgerQuery` 执行同一 3 组共享场景。

游标恢复与累计快照先选 `debug check --check app-tests --file src/composables/useIncrementalLedgerQuery.spec.ts --name '跨午夜|游标|空分页'`，覆盖失效游标只自动重建一次、按已加载深度从首批读取并替换整份快照、成功后只用新游标；部分读取失败不发布半份结果，后续“重试”或“加载更多”仍从首批恢复，多页刷新自身再次跨午夜停止自动续发并保留可重试错误。普通条件错误、取消和过时响应不得触发当前条件重建。作用域销毁须先标记实例永久失活并撤销外层代次，再取消内层请求；恢复前、结果发布和各读取入口均检查存活/代次，增量与恢复的每页读取返回后检查取消信号。销毁回归单选 `debug check --check app-tests --file src/composables/useIncrementalLedgerQuery.spec.ts --name 销毁`：必须命中错误已发布但恢复尚未启动的时间窗；对照提前取消后迟到成功/游标错误、恢复第 1/2 页途中取消，以及销毁后 replace/more/refresh/retry。断言信号已中止、无新增读取或下一页、旧快照不变且加载锁释放；取消回调重入也不能重新启动读取。定位通过后运行该文件，原页面接入只选 `src/components/GlobalLedgerSearch.spec.ts --name '真实明细|真实 KeepAlive'`，核对活跃实例的失败重试与缓存返回保持可用，不重复无关页面或完整验收。请求成功快照与累计列表一致，空分页后的刷新失败保留原列表；仅成功读到真实空结果才切空态。SQL 日期边界单选 `src/data/entries/ledgerQuery.spec.ts --name 上海跨午夜`，验证上海 23:59:59→00:00:01 的 TODAY/THIS_MONTH 旧游标拒绝和新首批读取；原页面 DOM 接入选 `src/components/GlobalLedgerSearch.spec.ts --name 真实明细`，验证列表不被误隐藏、原重试按钮可用且不重发旧游标。定位通过后只跑受影响测试文件和类型/随包构建、源资源门禁；未改页面呈现或原生桥时沿用匹配的原生页面证据，不重复完整验收，不把 DOM 故障注入记为原生实操。

明细原页面局部场景为 `--scenario query-cycle`（键盘前置及 test31–33）；定位时分别选择 `test31LedgerPagingSearch`、`test32LedgerFilterReset` 或 `test33LedgerEditReturn`，均仅带键盘前置，不携带其他业务验收。专用 t9 夹具准备 24 笔合成记录（今天 23 笔，另一天 1 笔），有长名称及可选历史渠道，不预写编辑结果。先核对首批 20 和加载更多后的 23，再搜索长名称；底部导航使用现有可访问名称“收支明细”定位，不能仅依赖显示短文案“明细”；筛选抽屉组合日期/收入/资金渠道并核对空态与清除基线；编辑底部收入备注后保留加载深度，普通导航返回仍能查看原对象及已提交备注。脚本在停止 App 后只读核对全部 t9 记录金额、版本及唯一预期备注变更、检索键、完整性和外键，拒绝未编辑或额外改写。首次字典完整段排除 test31–35，后续单独准备/执行/回读明细组；CI 调用同一入口并保留日志。失败立即缩至目标用例，修复后仅补受影响部分，不重复已过场景。明细路由/位置回归与报表跨页下钻是不同证明范围，后者须执行下述报表下钻/返回场景，分别记录实际证据。

局部键盘前置 test00DebugKeyboardReady 直接在原明细搜索输入短文本，核对后通过真实退格清空并断言空输入，通过原生“完成”按钮收起软键盘后再返回“记一笔”，不绕行字典新增；各业务用例自行导航，不依赖前置留下的页面。搜索输入边界只跑 `--scenario query-input`（键盘前置及 test34/35），失败立即缩至 `test34LedgerUnicodeInput` 或 `test35LedgerUnicodePaste`，不携带 test31–33。Release WKWebView 分别以原生键盘输入 200 个补充平面码点、输入第 201 个字符，及系统剪贴板/编辑菜单粘贴 200 个混合码点、拒绝 201 码点粘贴；核对完整输入值和超限后原值。与 query-cycle 共用 t9 夹具及只读回验，输入用例不允许任何账目修改。首次运行复用本轮独立模拟器；真实键盘/粘贴缺口通过后不重复 query-cycle 或完整 touch。脚本局部回归使用 Node 24 的 `node --test --test-name-pattern T9 scripts/tests/ios-debug.test.mjs` 验证单用例/场景选择、完整入口隔离与只读夹具；`debug check --check script-tests` 不支持文件/名称筛选，仅确需该完整脚本检查证据时使用。CI 的 App 测试自动发现该组件回归，完整 touch 的明细专段明确包含 test34/35。 仅修改组合事件调度且普通输入/粘贴、页面结构及原生桥未变化时，以上述 DOM/真实路由时序回归、类型/随包构建和资源门禁验证，沿用范围匹配的普通 WKWebView 键盘/粘贴证据；DOM 时序证据不冒充原生输入法实操；确需原生定位时仅补对应单场景，不重复无关完整验收。

#### 导出、完整备份与清空

数据管理先选 `src/data/management/dataManagement.spec.ts`：真实 Node SQLite 核验 39 列 CSV、公式/转义/精确量价、分批一致性、完整清单、旧备份升级、不重铺 seed、数据集切换与摘要慢任务排空；关闭/重开失败后保留句柄及所有权，每次请求有界恢复，后续普通读取和维护重试均可成功，显式 open 后不重复建连接。CSV 使用实际生产 SQL 的 EXPLAIN QUERY PLAN 和 SQLite VM 指令计数，检查索引范围、每批最多 200 个键/正文、已耗尽流不重复读取，以及混合类型同时间分页无遗漏或重复；1000→2000 条扫描指令增长须小于 2.5 倍，不能只用输出行数替代扫描量断言。受控 v8→v9 验证索引迁移失败回滚、重试及用户配置/数据集保留。可用同一入口的 `--name 'CSV 实际'`、`--name '关闭|重开'` 缩至相应用例。文件替身只证明协调，不证明 iOS 加密或系统文件交互。导出任务、严格草稿、前台资格及缓存切换分别消费 exports、useLedgerDraft、backupLifecycle、bootstrap 的定向回归。核心数据库/写入服务变化再扩大到受影响的数据库和业务测试。

原生单用例 `NativeTests/NativeSqliteTests/testDataFileSecurityAndSwitchRecovery` 验证实际认证加密、多帧/错误密码/篡改/截断/恶意参数/空间不足/路径拒绝、切换提交点及清理中断恢复、7 份轮换、原子退役后递归删除中断续作、旧残缺副本隔离及健康主库就绪、清空隔离区和外部副本保留；故障由测试内依赖注入触发，不为生产 App 添加开关。`testOfflineDataManagement` 通过真实 SQLite 与同一服务验证 CSV、原生备份往返、两类草稿/偏好/对象数量、新数据集、每日有无变更/同日及跨日水位和受控 v5 备份恢复及 v8→v9 普通升级，共 10 组检查。两者只操作本轮随机库，不能清空正式探针宿主或其他会话数据；模拟器不证明实体文件保护、最终 Release 容量或签名。

页面专项 `--scenario data-cycle` 执行 test44–50（含分别计时的 test45DataBackupCancel/Save）：原设置导出 CSV、原生文件取消后重存加密备份、错误密码拒绝、原表单增加备份后差异、预览取消与确认恢复、清空取消/确认/重启、再从外部副本恢复。原生面板默认本机 Documents，保存以文件名控件、选择以本机文件提供器就绪为判据（各最多 20 秒），不假定首个导航栏或重启后的历史位置；这段准备仍计入原 60 秒单例上限，不另启动系统“文件”App。输入类场景再复用独立 test00DebugKeyboardReady，不将冷键盘准备挤入文件用例；创建后取消与重新保存分两项继续同一预览能力，不重做加密。`data-backup` 仅创建/取消/保存；`data-restore` 组合备份/拒绝/预览/确认；`data-clear` 组合备份/清空/外部恢复；`data-restore-clear` 只补备份、预览取消/恢复、清空和外部恢复，适用于 CSV/错误密码已有有效局部证据后的剩余链路。单选确认恢复必须携带备份及预览前置，单选清空后恢复必须携带备份/清空前置，选择器列出实际执行项；沿用单例 60 秒，不以参数顺序替代 XCTest 方法名顺序。通过原生键盘、原生文件面板及危险对话框操作，不注入 JS/不直接写恢复终态。合法恢复/清空会更换 datasetId：准备夹具后、启动测试前，先持久登记受管数据操作意图，绑定会话、设备、包、基线、来源数据集、夹具路径/摘要和实际选定用例。正常结束停止 App 后，完整回读匹配本会话来源的恢复或清空终态才登记换库回执；取消或整轮超时不追加越过预算的清理命令，而保留意图。下一次复用在安装、沙盒迁移和夹具重置前，先按原意图独立核验实际账本及真实外部副本；来源未变可安全解除意图，已换库仅接受获选用例允许的完整终态，先持久化回执再消费意图。回执写入后中断可幂等续作；意图/夹具/租约缺失、身份不符、额外数据或未知中间态均拒绝，不卸载或冷重置绕过。下轮迁移/重置仍核验来源和目标数据集及库摘要，登记后被改写的终态仍拒绝，重置完成才删除回执。失败锁不随意图或回执恢复清除，构建/安装/测试和整轮时间预算保持不变。专用夹具只准备合成来源、模板、草稿、偏好和回收站；本轮受管容器的 Documents 保存真实外部文件，停止 App 后核验 BOM/封装魔数、对象及精确值、关联/外键、新旧 datasetId、差异删除、清空后的空账本/内部快照范围，以及外部副本仍可恢复。换库中断回归分两层：ios-cache.test.mjs 用真实 SQLite、夹具摘要和文件回读验证终态/身份/迁移及回执落盘中断；ios-verification.test.mjs 的 T12 受控 CLI 在换库提交就绪信号后发送 SIGTERM，或仅推进单调整轮时钟，验证旧轮不再调用 settle-data、下一轮 resume-data 先于 restore/arm-data。后者使用工具替身，不编译或启动模拟器；仅因 CLI 原生入口要求 macOS 在 Linux 登记精确平台跳过，macOS 脚本套件必须执行。缺少真实保存文件即失败；准备拒绝重复覆盖夹具。文件位置与设备是否联网无关，日常只选本机位置，不将测试副本写入个人 iCloud。

清空终态使用同一安装正式初始化后的空账本参照，逐项比对默认字典全部字段和偏好的完整键值，不能只数 8 条字典。局部准备从受管空基线捕获参照，登记意图时还须与已校验的基线副本一致；完整触摸在任何业务夹具前通过 `capture-data-defaults` 保存参照，后续准备沿用，拒绝重复覆盖及来源数据集不符，不从已修改的偏好猜默认值，也不在 Python 复制 seed。恢复回读读取全部草稿，要求全部归属当前 datasetId、类型集合与来源一致，再核对字段。页面回读与 settle-data/resume-data 共用同一检查器；拒绝时不登记或覆盖换库回执、不消费意图、不改数据库、基线、外部文件和安装登记，保留失败锁。定向回归覆盖残留字典修改、额外偏好、跨数据集草稿，以及无回执/已有回执两种状态和异常修正后的正常续作；默认参照篡改、完整流程前置捕获及 CI 工具分流同属 T12 脚本回归，由现有 scripts/scripts-macos 自动发现，不新增远端触发条件。

统一登记 `ui-data-management` 与上述同一场景；原生源码、共享设置/弹层及数据管理入口变化选中相应专项，不自动触发远端。最终完整 touch 在多维报表后单独准备/执行/回读数据管理组，最初字典段排除 test44–50；报告必须包含 `touch-data` 和回读阶段。先用 Node 24 的 `node --test --test-name-pattern T12 scripts/tests/ios-debug.test.mjs scripts/tests/ios-cache.test.mjs scripts/tests/ios-verification.test.mjs scripts/tests/ios-ci.test.mjs` 检查选择依赖、夹具隔离、取消/超时后换库续作及缺失阶段拒绝，再按问题选择一个页面用例；初始化或系统面板定位失败不重复完整触摸、不重建模拟器。

#### 总览与时间报表

总览/时间统计变更先跑 `debug check --check app-tests --file src/data/reports/reportQuery.spec.ts`：Node 与原生共用 reportScenarios，冻结旧 ReportHttpIntegrationTest 的 250/100/30/70/180 以及比较额 30/130、变化率 500.00/38.46；验证五种粒度、补零/累计、相同已过天数、闰日/上海午夜/跨年、400/401 桶、超单笔上限/文本大数、受控真实 SQLite 溢出、零基期/覆盖缺口/损坏元信息/未来原因、冻结/撤销/删除恢复、同一次队列读隔离并发写入及 v6→v7 后统计兼容。月份/季度/年份使用日历边界，UTC 民用日期的日数差不受设备时区影响；history_start 只消费既有可信元信息，不由最早账目反推完整历史。旧 Web/PG 保持停止，以冻结的同口径输入/预期对照，不为验收启动旧日常库。

报表请求快照与真实路由分别选 `src/composables/useReportData.spec.ts`、`src/domain/reportQuery.spec.ts` 和 `src/views/ReportView.spec.ts`，覆盖晚响应、失败旧快照/禁止下钻/原重试、释放取消、200 码点往返、清除/替换/离页防抖、净支出时间下钻与范围/粒度/指标/搜索/位置返回、用户新滚动保护和账目变更刷新。总览快照连同实际 startDate/endDate 原子发布，下钻固定为该 CUSTOM 范围，返回报表保留原日期条件，相对范围按返回时日期重新读取；跨午夜、周/月/年切换不能用点击时的新日期替换已展示合计的范围。SQL 回归在读取排队期间推进时钟，核对边界与组成明细；DOM 经原总览指标进入明细并返回。五粒度均在三处金额仍相同的情况下挂起响应，再分别成功或拒绝/重试，核对旧时段保留、刷新/失败控件禁用及新时段成功发布，迟到快照也不能覆盖其日期边界。共享过滤提取后局部回归 `src/data/entries/ledgerQuery.spec.ts`，仅在共享查询影响需要时扩大明细回归，不因报表接入重复全部明细验收。原生单入口为 `debug run --session "$IOS_DEBUG_SESSION" --case NativeTests/NativeSqliteTests/testOfflineCoreReports`，执行同一五组 SQL/日历/精度/生命周期/升级场景，包含随机数据库和保护快照回收；不是容量性能验收。

总览/时间报表页面入口为 `--scenario report-cycle`（启动准备、总览、时间报表准备、两组时间粒度、编辑返回及比较，编辑仍携带原输入前置），也可单选 test36ReportOverview、test37ReportTimeGrains、test38ReportDrillReturn、test39ReportComparison、test37ReportTimeGrainsQuarterYear。只读总览/粒度/比较不携带明细搜索键盘前置；编辑及其他输入类场景的前置保持。单选总览显式带启动准备，避免冷启动和日期操作挤占同一项预算；单选任一粒度组、编辑或比较会显式带上 test00PrepareReportApp 和 test36ReportTimePreparation：前者优先等待原底栏“收支报表”链接后点按，冷 AX 时才使用既有“报表”文字截图后备，并强制核对真实维度控件存在且 enabled，不依赖可能被既有提示遮挡的页首标题；后者在原页面完成固定日期/渠道筛选、时间趋势和结余指标选择；后续用例复用已应用的同一绝对范围，避免重复操作日期控件，编辑再选净支出，比较再打开原弹窗，均须真实通过且保持同一次安装/会话。XCTest 采用方法名词典序，总览 test36ReportOverview 必须先于时间准备 test36ReportTimePreparation，再到 test37 两组粒度，最后才是 test38 编辑和 test39 比较；不以 CLI 参数顺序代替实际顺序。`--scenario report-overview-grains` 仅组合启动、总览、时间准备及两组粒度，共 5 项，用于组合前置或粒度断言变更后的最低充分原生复验，不携带编辑/比较或键盘前置；`report-grains` 适合已不涉及总览前置的独立粒度定位。

复用本轮独立模拟器；[报表触摸夹具](../../app/test-support/reportTouchFixture.json)是 Python 准备、XCUITest 资源与 SQL 回归共用的唯一日期来源：业务时间固定为 2026-11-18T04:00:00.000Z，范围为 2026-11-01 至 2026-11-18。原生测试通过既有“指定日期”和起止日期控件应用 CUSTOM 范围，选择实际输入而非同名标签组；控件已显示夹具指定年月时直接选日，否则通过原生滚轮选择绝对年/月，不按执行日期翻月循环，也不再取 Date() 或“本月”；日、周、月、季、年标签均从同一资源读取，测试资源只进入 UI 测试包。夹具准备 1000.00 收入、15.00 支出和 3.00 退款，以独立 UUID 资金渠道“报表现金”经原筛选抽屉隔离其他阶段样本，不清空其他数据、不预写报表结果或编辑终态。原页面核对总览五项金额，使用 staticTexts 的精确带符号标签 +¥1,000、-¥15、+¥3、-¥12、+¥988；编辑返回核对 -¥13，均不使用通用 Any 文本或 OCR 金额后备，以免正负号导致误拦。逐个切日/周/月/季/年，分别断言范围合计、所选时段当期及累计三处结余均为 988.00；日/周/月为 test37ReportTimeGrains，季/年为 test37ReportTimeGrainsQuarterYear，`report-grains` 只组合上述两项准备与两组粒度断言，分别受原有 60 秒用例预算约束；季/年方法排在 test38 改金额之前，避免组合运行读取已编辑终态；不放宽每项 60 秒预算；当前项检查原生 select 的 value；随后必须等“查看时段”精确匹配共享绝对范围按上海日历裁剪后的桶标签，同时确认时段选择器和该桶下钻按钮均 enabled，才断言三处原生可访问金额。只改选择器值、刷新中的旧金额或失败保留快照均不能放行；不得放宽等待预算或向生产页注入测试标记。净支出时间点下钻看到来源与调整两笔，原编辑表单将实付改为 16.00 后返回应刷新为 13.00，并保留原趋势上下文；对比弹窗明确提示历史不完整。App 停止后只读回验两笔来源账目及调整的金额/状态/版本，test38 未执行时不得出现编辑结果，执行后必须且仅有约定修改，拒绝错误退款或重复准备。CI 原生自动发现单场景，完整 touch 明确排除首次字典段的时间报表用例及其准备项，再单独准备/执行/回读时间报表组；脚本选择/夹具先用 `node --test --test-name-pattern T10 scripts/tests/ios-debug.test.mjs` 和 Shell 语法检查；影响同时涉及草稿、生命周期或明细时再扩大到 `'T[789]|T10'`。跨午夜回归在测试进程边界冻结 Python 夹具的准备/回读时钟，并在真实 SQLite 统计中将查询时钟推进至午夜后，覆盖普通日界、月界和年界；必须保持两笔来源及退款的同一业务日期、五种时段标签和三处 988.00。回读须拒绝仅日期漂移但金额/版本不变的反例，原生筛选不得回退为相对范围。排序回归按实际词典序检查局部场景及 CI 完整 touch 的同一前置链，旧准备名称作为拒绝反例；就绪守卫回归拒绝移除时段或 enabled 检查；金额定位回归拒绝改回 Any/OCR、去掉符号或跳过精确金额节点调用；启动守卫拒绝跳过真实导航等待或省略维度控件存在、enabled 断言；日期定位回归拒绝选回同名标签及无条件跳过绝对年月选择。原生触摸先选择 Button/Link 及有效 frame，再读取 isHittable，避免冷启动的同名 Any 占位节点使 XCTest 在截图定位后备之前直接失败；报表原生 select 按 Button 和精确 value 定位，不在启动时无条件输出整个 AX 树。失败立即缩至目标用例，不重复已通过项或完整验收；多维报表按本规范的多维专项独立验证，不混入时间粒度结果。模拟器证明随包本地统计与原交互，不声称执行 iPhone 蜂窝飞行模式；最终候选另按设备选择规则验证真机断网、签名与 Release 性能。

App 的 [Actions 工作流](../../.github/workflows/offline-ios.yml) 是本分支唯一保留的远端流水线，按[远端请求范围](#统一套件按需-ci-与最终验收)调用同一本地验证脚本；触发、范围及最终完成条件以该节为准，历史运行不代表当前候选通过。旧 Web/服务端流水线已移除，离线 App 的工程、原生、资源及失败锁门禁保留。真实 iPhone 的签名安装、飞行模式冷启动、正式业务及 Release 性能须对实际候选另验。模拟器、小样本耗时或 common 绿色不能替代这些条件，安装交付报告门禁见本规范的可信手动入口，目标真机实测仍未因此自动完成。

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

### 离线 App 设备选择

| 改动或验证目标 | 首选环境与扩大条件 |
| --- | --- |
| 文档、CI/验证脚本、金额/日期计算、SQL 与请求/草稿状态逻辑 | 文档静态检查或对应 Node/Vitest 局部回归，不默认编译 App 或启动设备；原生桥、文件策略或真实触摸存在覆盖缺口时，再补下列对应检查 |
| 原生 SQLite/桥接/文件协调，日常页面、键盘、选择器、滚动、导航与前后台交互 | 复用本轮独立 iPhone 模拟器，选对应 hosted XCTest、XCUITest 单用例/小场景或原生直接操作；冷初始化、覆盖升级与中断恢复保留真实冷路径，不用夹具恢复代替 |
| 仅真机可复现的问题、模拟器无法覆盖的 iOS 兼容性、文件保护/系统授权、硬件或系统资源行为 | 提前说明具体缺口及必要操作后，才补对应实体 iPhone 验证；不因改动行数多或修改共享组件就要求连接手机 |
| 最终安装与交付、D07 容量性能 | 在已确认的 iPhone 14 Pro Max / iOS 27.0.1 上使用实际 Release 候选，按已确认要求集中核验签名安装、覆盖升级、断网图标冷启动、完整恢复和性能；模拟器及未签名构建不替代这些结果 |

现有 NativeTests 与 DictionaryUITests 入口只接受受管模拟器；真机验证使用签名后的正式 App 和适用实测方式，不能把真机 UUID 填入模拟器测试命令。`final` 当前输出的是工程与模拟器完整候选结论，不会自动连接手机；安装交付另由可信手动入口消费真实证据后判断。模拟器所需项通过且未触发真机条件，可完成本次日常验证；必要真机条件未满足时，保留该项未验证及交付缺口。

### 旧 Web 页面复测条件

以下浏览器、Safari WebDriver 与主屏幕 PWA 说明保留为旧 Web 的手工回溯流程，不是离线 App 的设备验收入口；不得为 App 验证恢复已停止的 Web/PG 服务。

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
