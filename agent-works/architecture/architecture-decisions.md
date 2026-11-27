# 总体架构与工程契约

## 范围与结论

面向离线 App 开发者，描述 iPhone 随包入口、本地账本、业务与文件闭环。旧 Web、Java/PG、OpenAPI 和服务器部署链路已退役；原需求及必要历史证据从[历史索引](../README.md#历史归档)追溯。本机私密资料保留，不是 App 运行依赖。

## 离线 iOS 原生入口

`app/` 是独立的 Vue 3 + Capacitor iPhone 工程，最低 iOS 27.0；`app/ios/App/App.xcodeproj` 的 `App` scheme 仅声明 iPhone 设备家族，关闭 Mac Catalyst、Mac 上的 iPhone/iPad 兼容运行和 visionOS 兼容运行。个人页面及共享组件已经沿原布局迁入 `app/src`，四个主导航及六个个人路由沿用原顺序和交互；旧 Web 与服务端源码已退役，历史实现从文档索引定位。启动由 bootstrap store 打开真实 LedgerDatabase，loading/error 时不挂载页面，成功后以 datasetId 隔离 KeepAlive。打开失败不重建库，仅可重试错误提供重试；本地业务与数据管理均经下述原生入口接入；最终签名交付和容量验收另行执行。

构建由 [ios-app.sh](../../scripts/ios-app.sh) 调用 app 的 `native:sync`：Vite 将 Vue 编译至 app/dist，Capacitor 将资源复制到原生 App/public，并生成配置和 CapApp-SPM 清单。配置不接受环境变量覆盖远程地址，未配置 `server.url`；WKWebView 从 `capacitor://localhost` 随包入口加载，HTML 的 CSP 将资源连接限制为自身。SwiftPM 清单由 CLI 生成，不维护另一份手工副本。[生成适配](../../scripts/normalize-capacitor-spm.mjs) 的 `--prepare` 在 sync 前从锁定 CLI 自带模板补齐缺失的 CapApp-SPM 文件（包含 Swift target 源），使干净检出也选择 SPM；已有工程与生成物不被准备阶段覆盖。普通构建和局部分层构建共用该入口。CLI 8.6.2 在 tools 5.9 清单中生成 `.iOS(.v27)`，sync 后同一脚本将这一已知形态转换为等价的 `.iOS("27.0")`；形态变化时明确失败，升级 CLI 时需重新评估。npm 依赖由 app/package-lock.json 锁定，原生远程依赖由 [Package.resolved](../../app/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved) 固定，禁止自动漂移。

[nativeConnection](../../app/src/infrastructure/database/nativeConnection.ts) 是最小原生连接边界：只允许 iOS 且必须存在 CapacitorSQLite 插件，拒绝浏览器替代存储。[nativeAdapter](../../app/src/infrastructure/database/nativeAdapter.ts) 只注册 CapacitorSQLite 原生插件并持有有界于实际连接数的注册表，不导入插件的 Web 实现；所有 SQL 操作仍委托锁定插件。正式账本经 createIosDatabase 创建并接管句柄后再打开，打开失败由同一生命周期释放；原生探针沿用 openIosDatabase 的独立打开/清理入口。插件配置将数据库放在沙盒 `Library/OfflineLedger`，并设置系统备份排除标记；该标记已经由模拟器上的原生测试读取确认。[LedgerDatabase](../../app/src/data/ledgerDatabase.ts) 在这一边界之上管理账本连接、生命周期与事务；启动和本地业务服务共用 appDatabase 单一所有者；页面不持有连接或执行 SQL。

App 的页面与本地服务共用本地 LedgerContracts 类型维持业务字段兼容；字典 API 与支出商品候选调用本地 DictionaryService/ProductService；收支 API 调用 EntryService，均不经过 HTTP。八类字典的新增、改名、停用/恢复、分页搜索、同级排序、引用保护及商品合并已经接通。全部生产 API 由本地应用服务承接，不保留 HTTP 兼容入口。localOperation 将未知存储错误包装为安全提示，保留内部原因；字典变更通知仅在事务提交后发布。运行期 Pinia 偏好和 useLedgerDraft 通过下述个人状态服务消费原生 SQLite，维持页面缓存与持久化状态；不使用浏览器持久化。账号、管理员和 PWA 入口不进入 App 路由。原 UI 的 PageWorkspace、AppDrawer/AppDialog、CachedPageView、键盘可见视口及未保存作用域继续复用，样式与模板基线由设计契约保护。图表与报表页面按需分包。 候选定位把可见视口偏移与文档滚动换算到同一 DOMRect 坐标，不重复叠加键盘平移；短屏编辑差异受 DESIGN 的可逆基线限制。

[LedgerAppearance](../../app/ios/App/App/LedgerAppearancePlugin.swift) 独立承接系统文字大小通知和状态栏明暗；前端共享入口先订阅再读取初态，拒绝迟到初态覆盖新通知，卸载释放监听。主题仍以原生 SQLite 偏好为源，系统模式不改写 UIKit 系统主题，桥失败不阻断账本。LedgerFiles 继续只负责原文件与生命周期职责，外观不复用草稿后台窗口。

`NativeTests` 是 hosted XCTest target，运行于真实 App 进程，通过 WKWebView 注入仅存在于 test bundle 的 [sqliteProbe](../../app/native-tests/sqliteProbe.ts)，再调用同一原生连接入口。探针以随机库名执行绑定、事务提交/回滚、关闭重开与最小升级，定点整数以字符串绑定并 `CAST(... AS TEXT)` 读取，避免桥接到 JavaScript Number 时丢失精度。探针消费 App 的权威金额函数，不调用旧 API，并验证 SQLite 64 位聚合溢出明确失败；实验结束关闭并删除本轮数据库，生产入口不含探针开关。该验证不替代正式迁移器、容量或真机验收。

[DictionaryTouch scheme](../../app/ios/App/App.xcodeproj/xcshareddata/xcschemes/DictionaryTouch.xcscheme)另建外部 UI 测试 runner，对随包 Release App 使用原生触摸和键盘，不导入 App 模块、不注入脚本或测试参数。局部入口允许同一显式会话复用脚本新建的模拟器、按内容摘要复用测试产物，完整入口默认新建设备，也可重新校验后借用同一会话设备，以全新合成 App 数据独立验收；两者共用脚本命令锁、测试源与夹具，具体操作见[开发验证规范](../testing/guide.md#原生局部调试与完整验收)。两个测试 target 仅允许 simulator SDK，并共用 [隔离守卫](../../app/ios/App/NativeTests/OwnedSimulatorTestContext.swift)：探针注入及 UI 启动前，校验脚本生成的设备清单与当前模拟器 UUID；缺少或不匹配即拒绝。测试源与 runner 不属于生产 target，正式 App 不读取清单；只有独立模拟器的空账本可准备合成历史引用，真实本地服务完成交互后再回读数据库核对持久化，机制和运行入口见开发验证规范。

精确金额、业务时间和文本纯函数统一位于 app/src/domain；所有运行消费者直接使用同一套本地领域实现。金额跨 SQLite 桥只接受规范十进制整数字符串，并校验 64 位整数边界。[SerialQueue](../../app/src/infrastructure/database/serialQueue.ts) 提供默认容量 32 的串行执行能力，排队取消释放名额，运行中的取消由事务安全边界处理；LedgerDatabase 的生命周期、读写和关闭均通过这一队列执行，事务在同一独占操作内提交或回滚。

[账本生命周期](../../app/src/data/ledgerDatabase.ts) 取得同名库的单一所有权后，校验原生外键及 schema/履历，初始化或升级成功且文件策略生效后才接受业务操作。结构链由 [migrations](../../app/src/data/migrations/index.ts) 维护，纯 SQL 迁移沿用原 SQL 的 SHA-256；含数据步骤的迁移将 SQL、数据步骤及其版本化算法源码一并计入摘要，DDL、数据回填和履历在同一事务提交；各版本同时维护完整结构清单，启动先按旧版本清单校验，再在迁移事务中按目标清单核对。结构检查比较表/索引/触发器的类型、归属和 SQL 词法单元，覆盖列类型、CHECK、外键及唯一性；只忽略语法外空白与注释，不忽略字符串内容或词边界。当前尚无正式发布的历史数据库版本，兼容测试使用受控旧版夹具。未知高版本、断档、历史摘要不符或不能解释的元信息缺失均拒绝，不删库重建。基础表承载元信息、字典标识、偏好、幂等结果及带定点金额/历史渠道快照的收支共同记录，类型专有字段和规则按相应功能追加迁移。

[编号迁移 0002](../../app/src/data/migrations/0002_dictionary_governance.sql) 在 v1 上追加 product_details、daily_entry_template、product_merge_event、账目字典引用/名称快照和引用索引；不改写 v1。触发器约束字典种类、两级分类、停用/恢复顺序及引用类型，外键保护已引用项；商品改名只联动当前模板，不覆盖账目历史快照。管理页包含停用项，新录入候选仅含启用项，每次打开重新读取有界候选，历史停用值经 ID 回显，不混入新候选。名称显示值与 NFKC 唯一键共用原有文本规范化规则。排序在单一事务内由 SQLite 重排同级序列，不把整库拉入 JS。

商品合并先读取预览，确认后将账目引用、模板冲突收敛、合并去向、事件及幂等回执在同一事务提交；账目金额/名称快照保持，行版本递增。模板冲突保留目标 ID，按最近使用时间、更新时间和 ID 选取内容；时间相同时，ID 沿用旧 Java UUID.compareTo 的两个有符号 64 位整数顺序；保留目标已有默认/最近值。源商品停用并标记去向，不再进入管理列表/候选，但保留名称唯一键和历史事件。链式合并更新当前去向，原事件不重写。同一对商品重试返回原回执；故障整体回滚。管理页刷新若发现当前页超出最后一页，在同一次可取消请求内最多补读一次有效末页，仅接纳当前代次结果，保持搜索与状态筛选。模板创建/选择/移除经 TemplateService 接通，和上述合并协调共用同一张表和队列；未根据旧版缺失字段猜测历史商品归属。

关闭失败时账本停止读写，保留连接引用与同名库所有权；只有原生关闭成功才释放两者。调用方可再次 close，或调用 open 先重试遗留连接的关闭；清理失败时不创建同名新连接。打开/校验与清理同时失败会保留两个原因，原生打开前已接管的句柄同样适用这组恢复规则。

[编号迁移 0003](../../app/src/data/migrations/0003_ledger_writes.sql) 追加收支量价、计算金额、收入名称、备注、更新时间和 payer_details；不修改 v1/v2 或重跑 seed，存量缺失字段保持 NULL。EntryService 统一校验精度/上限、Unicode 长度、上海业务日期及设备时间未来 5 分钟、启用字典与分类层级。金额/单价/数量以定点 INTEGER 存储并以字符串跨桥；量价计算与可手改实付独立保存。账目、商品/付款方最近值及规范化输入的幂等回执同事务提交，未知存储失败由 localOperation 安全封装，提交后才广播 ledger-changed。设备时钟的未来 5 分钟校验仅作用于首次执行，已提交回执不因时钟回拨被拒绝。首次执行和回放都在同一事务内检查结果是否仍有效：编辑回执对应的记录若已推进版本则返回 LEDGER_VERSION_CONFLICT，原回执保持不变；创建回执若已撤销则拒绝回放。编辑按 ID+预期版本条件写入；原表单继续提供保留输入重新确认/加载最新内容，操作 ID 同时绑定编辑版本。撤销需原创建回执、未编辑的有效记录、无模板引用且在 24 小时内；同一撤销可重试，创建回执保留，撤销后旧创建重试明确拒绝，不复活账目。撤销或编辑更换商品/付款方后回算原对象的最近值。撤销保护涵盖所有调整关联，实付编辑同时校验有效调整最低额。

[编号迁移 0004](../../app/src/data/migrations/0004_snapshot_search.sql) 追加历史商品名称的规范化检索键；[数据步骤](../../app/src/data/migrations/0004_snapshot_search.ts) 按稳定 ID 每批最多 200 条回填，和 DDL/履历共同提交或回滚，不改名称展示值、金额、行版本、字典及用户偏好。已有 v1—v3 SQL、结构清单和摘要规则保持；v4 将数据步骤及复用的 [名称算法 v1](../../app/src/domain/dictionaryNameV1.ts) 原文计入摘要。版本化算法只承载原有 NFKC、空白折叠及小写规则，由原 text 入口重导出；后续规则变化须新增版本及迁移，不改写历史源码。新建/编辑与旧数据回填使用同一算法，查询不再用 SQLite lower() 近似 Unicode 规范化。

[EntryReadbackQuery](../../app/src/data/entries/readbackQuery.ts) 统一支出、收入、有效调整及回收站的参数化查询；完整日期/类型/资金渠道、适用的专属维度与缺失条件在 SQLite 内过滤，周几和时段按上海口径。按业务日期、业务时间、创建时间及 ID 倒序，每次最多返回 20 笔及下一游标（内部多取一笔）；游标绑定数据集、筛选及已解析日期边界，错用或损坏明确拒绝。调整继承来源支出的维度，但不继承来源备注；冻结、撤销和删除项不进入有效明细，退款只冲减支出。筛选类型切换复用 ledgerQuery 的兼容条件清理；API 仍拒绝不适用组合，避免静默泄漏。App 精确收入名称和路由/下钻值支持 200 个 Unicode 码点，承接 S0 已冻结的长名称边界，不沿用旧 Web 部分查询的 100 字符限制。

[0007](../../app/src/data/migrations/0007_ledger_query.sql) 追加历史快照检索键和稳定排序索引。版本化 [ledgerSearchV1](../../app/src/domain/ledgerSearchV1.ts) 复用名称 v1 的 NFKC/空白折叠/小写规则，搜索名称、分类、付款方、渠道、地点及备注；instr 将百分号、下划线、引号和反斜线作为字面内容。v7 数据步骤按 ID 每批最多 200 行回填，与 DDL/履历同事务，摘要包含数据步骤及版本化算法；金额、名称展示、行版本、用户字典和偏好不变。正式创建/编辑在同一事务更新搜索键；字典改名/合并不覆盖历史名称。

[useIncrementalLedgerQuery](../../app/src/composables/useIncrementalLedgerQuery.ts) 复用请求代次/取消，只刷新已加载深度。条件替换撤下旧数据，读取失败区分当前条件错误与适用旧结果的过期提示；旧更多响应不能解除新更多的锁。明细的编辑/调整/生命周期变更保留加载深度，刷新不重新恢复旧滚动。ledgerNavigationMemory 以数据集和精确链路保存最多 100 个位置，查询恢复只执行一次，后续查询、离页及用户新滚动使旧恢复失效。原页面和筛选布局不变；报表使用下述同一过滤和上下文返回机制。

App 的 GlobalLedgerSearch 对输入、粘贴、选区替换及 IME 最终提交统一按 Unicode 码点检查，保留超限操作前的有效值；不使用按 UTF-16 计数的 HTML maxlength。明细上限 200，字典维护及合并搜索显式使用服务允许的 64。useDebouncedQuery 在缓存页停用/作用域销毁时取消计时器；搜索组件同时以页面活动状态、外部 modelValue 和 contextKey 取消过时任务，普通 v-model 回显不取消正常防抖。组合开始用 useDebouncedQuery.isPending 记录是否有尚未触发的防抖任务并暂停；组合结束值不变或超限回退时只恢复这份未提交任务，合法新值替换旧任务，已提交或仍在执行的查询不重发。外部取消和组件停用同时清除组合续发意图，未注入页面活动状态的 KeepAlive 也由组件自身停用钩子保护。明细清除全部条件显式取消搜索，离页回退到已提交关键词；路由写入检查当前活动页与精确链路，并明确指向 bill-details，避免隐藏实例改写其他页面。

[ReportQueryService](../../app/src/data/reports/reportQueryService.ts) 在同一次 LedgerDatabase 队列读中生成总览、时间桶、比较期及收支多维结果，正式写入不能插在各查询之间；API 的 getCoreReport/getDimensionReport 与 useReportData 一次发布过滤/呈现/摘要/趋势及实际日期边界 resolvedRange 的快照，失败保留旧成功快照并禁用下钻。总览和多维下钻使用该快照的绝对日期范围，避免跨上海午夜后相对日期重新解析而改变组成明细；返回报表保留原筛选条件，相对范围按返回时日期重新读取。共享 [querySql](../../app/src/data/entries/querySql.ts) 承接明细/报表的日期、有效状态、类型和历史快照过滤；EXPENSE_FLOW 包含支出及有效调整，调整按自身业务日期冲减，不计入收入。SQL 按类型或时间桶聚合，金额 SUM 明确 CAST 为 TEXT 跨桥，净额、结余、累计和比较使用 BigInt，不受单笔录入上限限制；SQLite 64 位 SUM 溢出返回安全的 REPORT_TOTAL_OVERFLOW，不能转浮点继续。图表数值转换只用于坐标，固定读数和下钻金额继续使用精确字符串。

[自然日历](../../app/src/domain/businessDates.ts) 统一上海日期边界与 UTC 日历运算，周一为周起点，支持日/周/月/季/年，首尾桶裁剪并补零，最多 400 桶。比较期沿用旧核心口径：结束日期超过今天时按已过天数构造等长环比和同比，闰日按 LocalDate 减年夹到二月末；变化率先六位 HALF_UP、再百分比两位 HALF_UP，分母取对比额绝对值。可信覆盖使用已有 ledger_meta.history_start（ISO 时刻转上海日期），不以最早一笔记录猜测完整历史，不修改初始化元信息；覆盖不足/损坏、零基期或尚未开始时返回明确不可计算原因。时间分析不新增存储字段，旧账本经既有迁移链升级后可直接统计。

ReportView 保留原模板/组件/样式，搜索与明细共用取消/IME 保护；路由写入检查活动实例和精确链路。账目变更及返回激活刷新报表，显式下钻返回只恢复一次位置，用户的新滚动取消旧恢复。总览原指标行与时间趋势的原“查看明细”下钻到相同过滤的真实账目，范围、搜索、粒度、指标和位置随返回上下文保留。全部维度由本地 getDimensionReport 返回同一摘要/排行/范围快照，getExpenseReport/getIncomeReport 保留类型化调用；不依赖旧 HTTP 服务。

[编号迁移 0005](../../app/src/data/migrations/0005_personal_state.sql) 追加按 datasetId/类型唯一的 ledger_draft，以及收入模板独立名称字段；只为真正缺失的偏好补默认，不重跑 seed。旧模板收入名称由已保存的展示名补齐，不依赖仍存在的来源。DDL、数据与迁移履历仍在原生命周期事务内提交或回滚；v1—v4 及其摘要不改写。

[DraftService / PreferenceService / TemplateService](../../app/src/data/personal/) 在实际队列读写及事务内核对 datasetId；新数据集的迟到恢复和旧任务均拒绝，原始非法/未知版本草稿保留供兼容恢复。双草稿采用 16 KiB/字段白名单、版本及 7 天有效期，允许不完整小数；useLedgerDraft 以 250ms 合并输入，最多一笔在途写入及一份最新编辑态。旧快照慢写失败且已有较新输入时，每轮最多立即续写最新快照一次；失败接管落盘时取消既有防抖，防止连续失败后遗留计时器再开一轮；再次失败保留最新输入和原备份失败提示，等待后续编辑、前后台落盘或重试入口再次提交，不循环重试。清除草稿或切换数据集后，旧失败不触发续写。缓存页停用、页面隐藏及原生 willResignActive 都请求同一落盘入口；原生提供到期必释放的后台完成窗口，不能保证操作系统直接杀进程前尚未送达的最后输入。提交前排空并冻结草稿写入，创建账目时在同一事务消费对应草稿；失败保留输入并允许重试，不把草稿存储失败伪装成账目保存失败。重置偏好不删除草稿、模板或账目。

偏好沿用既有 SQLite 存储键，统一默认、合法值与引用回退；无效值仅消费时回退，不覆盖原值。保存按字段排队、按字段代次接纳响应，失败的乐观输入保持，其他字段成功不会抹掉失败输入；重置失败保持原偏好。main 在首个 Vue 帧前等待 bootstrap 的偏好加载，ThemeModeControl、设置、最近类型、表单默认资金渠道及查询范围消费同一状态源；不使用 localStorage 首屏缓存。

TemplateService 只从有效且引用可用的收支生成定点字段白名单；按类型/规范化名称同键更新并保留 ID，查询按最近使用排序、最多 100 项。选择时复验字典及分类层级，只清除并提示失效字段，保留其余值；原表单负责使用当前时间、清空备注和继续普通校验，不自动入账。商品改名/合并复用字典应用服务的事务协调；来源删除以 SET NULL 保留模板，移除模板不改来源和金额。

[默认清单](../../app/src/data/seed/defaults.ts) 只对确认的新数据集写入，与 datasetId、schemaVersion、seedVersion 和初始化标记共同提交。现有清单采用已确认的八项收入分类；已有账本不随安装包 seed 变化更新，空字典也不补种。偏好以 JSON 原值保存，区分缺失与 false、0、空值。新数据集执行结构/必需数据迁移后，初始偏好由当前 seed 显式覆盖同键迁移缺省值；此覆盖仅存在于新装事务。存量升级不执行 seed，缺失字段只由相应迁移补齐，已有用户值继续保持。数据层 executeOnce 将业务写入和操作结果共同提交，相同操作名/ID/摘要回传已有结果，摘要不同拒绝；调用者仍须提供规范化业务输入摘要及领域校验。

升级前关闭原生连接，通过 [LedgerFilesPlugin](../../app/ios/App/App/LedgerFilesPlugin.swift) 检查空间、复制已关闭的数据库，以 128 KiB 分块计算并核对 SHA-256，写入清单后将临时目录原子改名为完成快照。文件能力只接受受限库标识，路径均由 App 私有目录派生；非空 WAL 及 magic 非零/日志头不完整的 journal 拒绝复制；SQLite 已失效的完整 journal 头（8 字节 magic 清零）可保留在原处，快照只复制已由 SQLite 校验并关闭的主库，普通快照不主动删除日志。私有目录、数据库及完成快照重新设置并回读系统备份排除标记；实体 iOS 构建还要求 completeUntilFirstUserAuthentication 文件保护回读成功。模拟器构建明确返回 protected=false、simulator=true，不把模拟器结果作为实体文件保护证据。快照的触发、轮换和数据集切换见下述数据管理机制。

[DataManagementService](../../app/src/data/management/dataManagement.ts) 统一协调 CSV、加密备份、临时库验证与整库替换；管理操作不并行。CSV 沿用 39 列、UTF-8 BOM、引号转义、前导空白公式防护和上海时间，当前筛选复用明细过滤，全部数据包含回收站及非生效调整。单个读事务内，账目和调整分别经 [0009 导出索引](../../app/src/data/migrations/0009_csv_export.sql) 按稳定游标读取最多 200 个键；合并至多 400 个缓冲键后，仅回读本批最多 200 个正文，已穷尽分支不重复扫描。按文本块追加原生临时文件，不将全账本放入 JS。原导出组件保留任务/取消交互，下载由原生文件保存面板承接；数据集切换使旧导出任务过期。

[LedgerDataFiles](../../app/ios/App/App/LedgerDataFiles.swift) 只接受受管 UUID/库名，路径从 Library/OfflineLedger 派生。外部 `.mybill` 格式版本为 1，无压缩、数据库最大 256 MiB：PBKDF2-HMAC-SHA256 固定 600000 次、随机 32 字节盐，派生 AES-256-GCM 密钥；256 KiB 认证帧绑定头和顺序，清单先认证，逐帧解密后再核对完整 SHA-256。算法使用系统 CryptoKit/CommonCrypto，密码不入偏好、日志或 Keychain。恢复在独立临时库检查格式、版本、元信息、表清单/数量、迁移履历、结构和外键，经同一 LedgerDatabase 迁移链升级，不重铺默认字典；候选库还拒绝超额/状态不符的调整和其他数据集草稿；确认替换前 remap 为新的 datasetId，保留原业务内容、seed 来源与历史覆盖。

备份、恢复保护和清空共用 LedgerDatabase.withClosed：同步关闭新受理窗口，排空已受理读写及摘要预处理，再关闭原生连接；关闭和文件操作失败共用有界恢复：保留原句柄及所有权，先释放再经同一校验入口重开，每个请求最多尝试一次恢复。仍失败时保留恢复资格，下一次普通读写或维护请求可再次恢复；显式 open 成功后清除恢复标记，不额外重开连接。普通写入的事务同时更新 maintenance_state 中的 backup_revision，回滚/幂等只读回放/仅清理时钟状态不更新；已安装账本缺少水位时只补运行期标记。前台维护复用 DOM/原生状态双重资格，先严格落盘双草稿；有业务变更时按上海日历每天最多一份常规快照。升级/恢复前额外保护，完成副本先校验并持久化再原子发布，正式账本合计最近 7 份，进行中保护快照不参与删除；快照失败不删除最后可用副本。轮换先原子改名为 retiring-UUID 再递归删除，重开继续回收；旧版残缺 UUID 副本移入私有 QuarantinedSnapshots，不将旧快照维护错误扩大为健康主库不可用。隔离区最多 7 份，达到上限停止新增快照；维护警告沿用“最近结果”显示，外部备份仍可使用。自动快照期间普通操作排队，手动替换窗口拒绝新操作。

替换先持久化旧副本、新副本及新旧摘要标记，再同文件系统原子 rename；冷启动据标记及实际文件摘要辨别提交点，正式库校验通过后才回收旧副本。清空使用当前 seed 创建新数据集，再清理内部快照（含隔离副本）、临时文件及旧数据；用户主动保存的文件不在清理范围。bootstrap 在切换前撤销页面/偏好的数据集和代次，重建缓存，旧草稿与响应不能落入新账本。原生“文件”提供导入和另存；UIFileSharing 只公开 Documents，账本与临时明文仍在私有 Library 并排除系统备份。保存到本 App Documents 的用户副本可经“文件”复制到其他位置；App 内清空保留它，卸载则遵循系统沙盒删除规则。最近结果只保存最小状态，文件操作中断在冷启动标为待核对，不以旧成功替代失败。

迁移阶段通过可注入的只读进度观察器报告 snapshot-ready、migration-recorded、upgrade-committed，不传出数据库连接。测试 bundle 在正式 open→upgrade 流程观察到指定阶段后挂起，隔离脚本再终止该 App；生产入口不读取测试请求文件，也没有启用故障的参数。提交前中断须恢复旧版完整结构/履历并可重试，提交后中断须保留新版且不重放迁移。

[offline-ios 工作流](../../.github/workflows/offline-ios.yml) 通过显式请求调用与本地相同的套件登记、规划、执行及结果对账器：Linux 执行适用工程检查，macOS 执行原生构建及模拟器测试，Xcode/SDK/runtime 条件由工具链入口核验。设备所有权校验限制新建、复用及清理范围，不接管用户已有模拟器；证据与缓存按端保存在 .local/ios。触发、套件和设备选择统一见[开发验证规范](../testing/guide.md#统一套件按需-ci-与最终验收)。未签名 Release 不能直接安装到真机，工程/模拟器结果也不能替代签名安装、真实文件策略或 Release 容量测量。

[编号迁移 0006](../../app/src/data/migrations/0006_adjustment_lifecycle.sql) 追加 expense_adjustment、到期索引与 maintenance_state，旧迁移保持不变。AdjustmentService/LifecycleService 在真实事务内核对 datasetId、版本、来源及有效累计；账目实付不得低于有效调整，创建回执已有后续关联时不能撤销。删除支出由同一 SQL 触发器冻结有效调整，恢复时重新校验并解冻；已撤销/单独删除的调整不复活。调整和账目操作与回执同事务，回放读取当前累计且拒绝已改变的版本/状态。永久删除有关联的来源必须由原确认弹窗明确传入连同删除，外键拒绝留下孤儿；模板来源仍按 SET NULL 保留。

CleanupService 在启动/回到前台执行一次有界轮次，最多 5 批，每批合计删除不超过 100 行；先删除到期来源的子调整，再删已无关联的来源。删除和最小进度状态同事务，已提交删除就是断点，重启重新选择剩余到期对象，不回放已删内容。持久化时钟样本、状态、批次数及最后处理 ID，不保存账目正文。无基线、回退超过 5 分钟、同进程墙钟/单调经过时间差超过 5 分钟、跨启动间隔达到 30 天均延期；本轮不重试，后续前台重新判定，显式永久删除不依赖此自动清理资格。DOM/原生事件合并，后台取消在事务边界生效；失败、取消和遗留 running 中断分别记录。原全局提示组件显示延期原因或失败状态；尚未完成的轮次不声称已清完。DOM 可见性和原生前后台状态分别维护，只有两路均确认可执行且账本就绪才启动；DOM 可见不能覆盖原生后台，并实时复核可见性以应对隐藏通知迟到；任一路退后台即取消，双方恢复只开启一个轮次。原生监听注册完成后，通过 LedgerFiles.getLifecycleState 在主线程只读当前活跃状态以补齐冷启动初态；查询期间的新原生事件优先，迟到响应不覆盖事件。初态未知或读取失败时暂停清理，后续原生激活可恢复；订阅失败则暂停至重新打开 App，不轮询重试。后台迟到的初始化不能启动新轮次。最终维护状态写失败返回已提交进度和运行期错误，由既有 mutateEntry 使页面缓存失效；不把状态保存失败当作业务删除回滚。部分失败提示明确已永久清理的行数，零提交不误报删除；失败状态仅补写一次，底层原因链只留内存，不进入维护 JSON，后续前台从已提交断点继续。

[LedgerLifecycleCoordinator](../../app/ios/App/App/LedgerFilesPlugin.swift) 将生命周期与后台写入窗口分别管理。App/Scene 同态通知只转发一次，真实后台迁移不受旧窗口是否结束影响；有窗口时复用，无预算时仍通知以取消清理。每次后台迁移产生当前 Native Bridge 生命周期内递增的 generation，通知、草稿回执和窗口所有权共同校验：只有当前代次完成才能释放窗口；到期回调还绑定申请该物理窗口的代次，忽略旧到期及句柄复用。观察者和窗口在停止/销毁时回收，不循环延长后台驻留。[draftLifecycle](../../app/src/platform/draftLifecycle.ts) 拒绝重复及旧代次，真实新轮次继续复用 flushDrafts/useLedgerDraft 的每类型在途合并和有界失败续写，不为通知另建写入队列，原生窗口完成以 generation 传入 finishBackground。


[多维聚合](../../app/src/data/reports/dimensionReports.ts) 覆盖九类支出及五类收入，使用同一有效账目过滤；可空二级分类/购买渠道/地点以稳定缺失标识下钻，不与用户同名字典混淆。商品与价格按商品＋单位分组，金额、数量、平均填写单价与平均实付单位成本分别计算；价格和均值排行先按未舍入结果排序，再格式化。历史 NULL 量价不回填为零，不拿较早单价冒充最近值；整组没有填写单价时，价格维度返回可行动空态。缺少必要分组资料的旧记录明确拒绝该维度，仍可查看总览或缩小筛选。频次保留最近记录、精确平均间隔和有效商品的长期未购线索；历史下钻使用其最近记录与绝对日期。

[精确报表数学](../../app/src/data/reports/reportMath.ts) 使用 BigInt 有理数、平衡均值合并及 Fenwick 滑窗中位数，不以浮点比较阈值。expense-quality-v1 保留过去 180 天、同商品同单位至少 3 条且严格早于当前时刻的样本，超过中位数 50% 才提示高价；同商品/实付/资金渠道的稳定前序记录在 10 分钟内（含边界）提示重复。同时间记录不互作价格历史，回收站/无效记录不参与，线索不改账。质量历史复用快照候选商品集合，每组最多 128 个商品，按商品/时间/创建时间/ID 游标读取，每次跨桥最多 256 条，不逐页重新查询候选账目。续页合并当前商品的完整尾游标与后续商品的时间范围两条索引流；当前商品不重复叠加原时间下界，以免同时间分页退化为前缀重扫。收集后按全局时间/创建时间/ID 重排，保持滑窗过期及稳定前序语义。普通维度与频次仍用日期/时间/创建时间/ID 游标；质量点最多 100、普通排行最多 50，并明确截断。既有 [v8 索引](../../app/src/data/migrations/0008_report_dimensions.sql) 服务同商品历史范围，读取策略无需新增迁移；不修改既有迁移、账目或用户配置，升级仍走已有保护快照与事务。

[Capacity scheme](../../app/ios/App/App.xcodeproj/xcshareddata/xcschemes/Capacity.xcscheme) 提供 Release hosted 页面/原生容量探针及外部冷启动 runner，单独使用 `com.mybill.offline.capacity`，编译和执行均拒绝正式 Bundle。测试代码和合成数据不进入生产资源；同一夹具由正式迁移/服务生成，模拟器脚本验证归属、摘要与数据集后仅替换隔离 App 沙盒。模拟器 RSS、服务计时与页面端到端计时分别登记，不能替代目标真机指标。执行入口、样本与报告拒绝规则统一见[验证规范](../testing/guide.md#ios-交互与容量复核)。

## 本地契约与开发入口

[LedgerContracts](../../app/src/domain/ledgerContracts.d.ts) 维护当前页面和应用服务实际使用的数据结构；金额、数量及时间继续遵守本地领域校验，不以 TypeScript 声明代替 SQLite 约束。原 OpenAPI 的 HTTP 路径、身份/管理员 DTO 和生成工具已移除。本地契约保留已有业务字段及精确字符串类型，类型调整须同步真实服务与消费方。

[本地调用边界](../../app/src/api) 只调用本机服务；[错误归一化](../../app/src/api/errors.ts)消费 LocalError、取消及运行失败，页面保留字段反馈、原因链与明确重试资格，不发身份或网络请求。原页面模板和样式仍由 DESIGN 及基线摘要保护。

工程检查与未签名编译由根 package.json 的 App 命令提供；模拟器、真机、完整候选和 CI 门禁的触发及证据边界统一见[验证规范](../testing/guide.md)。最终真机签名、覆盖升级及 Release 指标须对实际交付候选另验，常规绿色不能替代。
