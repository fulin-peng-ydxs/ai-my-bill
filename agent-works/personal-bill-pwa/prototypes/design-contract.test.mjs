import assert from "node:assert/strict";
import { css, htmlFiles, readProjectFile, readPrototype } from "./contract-test.helpers.mjs";

const design = readProjectFile("DESIGN.md");
const expenseEntry = readPrototype("expense-entry.html");
const billDetails = readPrototype("bill-details.html");
const reports = readPrototype("reports.html");
const profileSettings = readPrototype("profile-settings.html");
const prototypeJs = readPrototype("prototype.js");
const allPrototypeHtml = htmlFiles.map(readPrototype).join("\n");

const lightThemeCss = css.slice(0, css.indexOf(':root[data-theme="dark"]'));
const darkThemeCss = css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

function readToken(block, name) {
  const value = block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  assert(value, `缺少主题 token：${name}`);
  return value;
}

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map(value => Number.parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function assertTextContrast(theme, foreground, backgrounds) {
  for (const background of backgrounds) {
    const ratio = contrastRatio(readToken(theme, foreground), readToken(theme, background));
    assert(ratio >= 4.5, `${foreground} 与 ${background} 的对比度 ${ratio.toFixed(2)} 未达到 4.5:1`);
  }
}

const cssContracts = [
  ["font-size: 17px", "正文基准字号必须为 17px"],
  ["--font:", "必须维护共享正文字体栈"],
  ["--display:", "必须维护共享展示字体栈"],
  ['"SF Pro Text"', "正文优先使用 SF Pro Text"],
  ['"SF Pro Display"', "标题优先使用 SF Pro Display"],
  ["--radius-xs: 5px", "图形圆角必须包含 5px"],
  ["--radius-sm: 8px", "按钮圆角必须包含 8px"],
  ["--radius-md: 11px", "控件圆角必须包含 11px"],
  ["--radius-lg: 18px", "卡片圆角必须包含 18px"],
  ["--radius-pill: 9999px", "胶囊控件必须使用全圆角"],
  ["--primary: #0066cc", "浅色主操作色必须为 #0066cc"],
  ["--focus: #0071e3", "浅色焦点色必须为 #0071e3"],
  ["--primary: #2997ff", "深色主操作色必须为 #2997ff"],
  ["--income-accent: #ff3b30", "收入强调色必须为固定红色"],
  ["--expense-accent: #34c759", "支出强调色必须为固定绿色"],
  [".entry-type-segment button.income.active { color: var(--income-text); }", "收入类型选中态必须消费可读文字 token"],
  [".entry-type-segment button.expense.active { color: var(--expense-text); }", "支出类型选中态必须消费可读文字 token"],
  ["backdrop-filter: saturate(180%) blur(20px)", "固定栏必须使用共享毛玻璃效果"],
  [".balance-summary > button:last-of-type:nth-of-type(odd)", "奇数金额摘要的末项必须自动通栏"],
];

for (const [fragment, message] of cssContracts) {
  assert(css.toLowerCase().includes(fragment.toLowerCase()), message);
}

assert.equal((css.match(/--income-accent:\s*#ff3b30/gi) ?? []).length, 2, "收入强调色必须在浅色与深色主题中保持一致");
assert.equal((css.match(/--expense-accent:\s*#34c759/gi) ?? []).length, 2, "支出强调色必须在浅色与深色主题中保持一致");

for (const token of ["income-text", "expense-text", "muted", "placeholder", "success", "warning", "danger"]) {
  assertTextContrast(lightThemeCss, token, ["bg", "surface"]);
  assertTextContrast(darkThemeCss, token, ["bg", "surface"]);
}
for (const theme of [lightThemeCss, darkThemeCss]) {
  const buttonRatio = contrastRatio(readToken(theme, "on-primary"), readToken(theme, "primary"));
  const disabledRatio = contrastRatio(readToken(theme, "on-disabled"), readToken(theme, "primary-disabled"));
  assert(buttonRatio >= 4.5, `主按钮文字对比度 ${buttonRatio.toFixed(2)} 未达到 4.5:1`);
  assert(disabledRatio >= 4.5, `禁用按钮文字对比度 ${disabledRatio.toFixed(2)} 未达到 4.5:1`);
}
assert(!/gradient\s*\(/i.test(css), "工具型页面不得使用装饰性渐变");
assert(!/font-weight:\s*500\b/.test(css), "不得使用不稳定的 500 字重");

for (const fragment of ["fontSize: 17px", "收入强调色 `#FF3B30`", "支出强调色 `#34C759`", "44×44px", "WCAG AA"]) {
  assert(design.includes(fragment), `DESIGN.md 缺少稳定契约：${fragment}`);
}
assert(design.includes('business-contract.test.mjs'), 'DESIGN.md 必须登记业务闭环契约测试');

assert(design.includes("`FormSection`"), "DESIGN.md 必须登记长表单分组组件");
for (const component of ["`GlobalLedgerSearch`", "`AppliedFilterBar`", "`SegmentedControl`", "`SettingsDisclosureList`", "`DailyEntryPicker`", "`LedgerContextActions`", "`IncrementalLedgerList`"]) {
  assert(design.includes(component), `DESIGN.md 必须登记交互层级组件：${component}`);
}
assert(css.includes(".form-section + .form-section"), "长表单分组必须共享留白与分隔线样式");
assert(css.includes(".segmented-control"), "少量互斥视图必须共享分段控件样式");
assert(css.includes(".setting-row.disclosure::after"), "设置入口必须共享披露指示样式");
assert(/\.setting-row\s*\{[^}]*text-decoration:\s*none/s.test(css), "设置列表链接不得显示浏览器默认下划线");
assert.equal((expenseEntry.match(/class="panel entry-form"/g) ?? []).length, 2, "支出与收入必须共享长表单容器样式");
assert.equal((expenseEntry.match(/class="form-section"/g) ?? []).length, 7, "记账页必须包含支出四组、收入三组");
assert.equal((billDetails.match(/class="form-section"/g) ?? []).length, 7, "编辑抽屉必须复用支出四组、收入三组");
assert.equal((billDetails.match(/class="sheet entry-form"/g) ?? []).length, 2, "收支编辑抽屉必须共享长表单容器样式");
for (const title of ["商品信息", "金额信息", "渠道与场景", "时间与备注", "收入信息", "金额与收款"]) {
  assert(expenseEntry.includes(`>${title}</h2>`), `记账页缺少业务分组：${title}`);
}

assert(!allPrototypeHtml.includes('class="prototype-note"'), "可交付业务界面不得显示原型验证批注");
assert.equal((reports.match(/data-open="filter-sheet"/g) ?? []).length, 1, "报表页只能保留一个筛选入口");
assert.equal((billDetails.match(/data-open="detail-filter"/g) ?? []).length, 1, "明细页只能保留一个筛选入口");
assert.equal((billDetails.match(/data-export-csv="current-ledger"/g) ?? []).length, 1, "明细页只能保留一个当前结果导出入口");
assert(/<header class="page-head">[\s\S]*?data-export-csv="current-ledger"[\s\S]*?data-icon="download"[\s\S]*?<\/header>/.test(billDetails), "当前结果导出必须使用页头下载图标");
assert(!/<button[^>]*class="btn text"[^>]*data-export-csv="current-ledger"/.test(billDetails), "当前结果导出不得回到底部文字按钮");
assert(prototypeJs.includes("download: '<svg"), "共享图标事实源必须提供下载图标");
assert(prototypeJs.includes("button.__cancelExport") && prototypeJs.includes("button.innerHTML = icons.close"), "页头导出必须原位提供取消操作");
assert(prototypeJs.includes("link.hidden = true") && prototypeJs.includes("link.click()"), "导出完成后必须直接下载，不得追加第二个可见下载入口");
assert(reports.includes("data-report-dimension-select"), "报表分析维度必须使用明确选择器");
assert(!reports.includes("data-report-dimensions"), "报表不得恢复高密度横向维度胶囊列表");
assert(reports.includes('value="all">全部账目</option>'), "不限类型必须使用清晰的‘全部账目’文案");
assert(profileSettings.includes('data-open="dictionary-index-sheet"'), "设置首页必须将八类字典收拢为单一管理入口");
const profileHome = profileSettings.slice(0, profileSettings.indexOf('<div class="overlay"'));
assert(!profileHome.includes("data-dictionary="), "设置首页不得直接堆叠八类字典入口");
const dataSecuritySection = profileHome.match(/<section class="setting-group"><h2 class="setting-group-title">数据与安全<\/h2>[\s\S]*?<\/section>/)?.[0] ?? "";
assert(dataSecuritySection.includes('data-open="dictionary-index-sheet"'), "个人字典入口必须并入数据与安全分组");
assert(!dataSecuritySection.includes("退出登录") && !dataSecuritySection.includes("注销账号"), "退出与注销不得继续混在数据与安全分组");
assert(/<section class="setting-group account-actions">[\s\S]*?退出登录[\s\S]*?注销账号[\s\S]*?<\/section>/.test(profileHome), "退出与注销必须归入独立账号操作分组");
assert(!allPrototypeHtml.includes("复制上一笔"), "日常收支模板已替代复制上一笔入口");
assert(expenseEntry.includes('data-open="daily-entry-sheet"'), "记账页必须提供日常收支入口");
assert(expenseEntry.includes('data-daily-template-type="expense"') && expenseEntry.includes('data-daily-template-type="income"'), "日常模板抽屉必须同时承载支出与收入");
assert.equal((billDetails.match(/data-add-daily-template=/g) ?? []).length, 0, "编辑抽屉不得重复提供常驻日常操作");
assert.equal((billDetails.match(/data-daily-source/g) ?? []).length, 3, "每条示例有效收支必须可作为日常模板来源");
assert(css.includes(".daily-template-row"), "日常模板列表必须消费共享行样式");
assert(billDetails.includes('id="ledger-actions-sheet"') && billDetails.includes('data-ledger-action="daily"'), "加入日常必须收进统一账单上下文面板");
assert(prototypeJs.includes("bindLedgerItemGestures") && prototypeJs.includes("event.key === 'F10'"), "上下文面板必须同时支持触摸手势和键盘入口");
assert(!css.includes(".daily-favorite-toggle"), "账单列表和编辑抽屉不得残留常驻收藏图标");
assert(/\.filter-summary \[data-return-reports\]\s*\{[^}]*white-space:\s*nowrap/s.test(css), "返回报表按钮必须保持单行");
assert(/\.filter-summary strong\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s.test(css), "移动端下钻与筛选摘要必须自然换行");
assert(profileSettings.includes('class="account-session-action"') && profileSettings.includes('class="account-danger-action"'), "退出与注销必须使用独立语义色");
assert(profileSettings.includes('<a class="setting-row" href="login.html">'), "退出登录必须复用无下划线的设置行链接");
assert(/\.account-actions \.setting-row\s*\{[^}]*justify-content:\s*center[^}]*text-align:\s*center/s.test(css), "账号操作必须复用设置行并居中展示");
assert.equal((billDetails.match(/data-type-tag/g) ?? []).length, 7, "所有静态明细类型必须使用统一标签锚点");
assert(prototypeJs.includes('list.dataset.typeScope = filters.type'), "明细类型标签必须消费当前已应用页签");
assert(/\[data-type-scope="expense"\][\s\S]*?\[data-type-scope="income"\][\s\S]*?\[data-type-tag\]\s*\{\s*display:\s*none;/s.test(css), "支出和收入单一页签必须隐藏重复类型标签");
assert(/\.item-title \[data-type-tag\]\s*\{[^}]*border:\s*1px solid var\(--border-strong\)[^}]*background:\s*var\(--surface-2\)/s.test(css), "其他明细页签的类型必须使用统一描边标签");
assert(design.includes("LedgerContextActions"), "DESIGN 必须登记账单上下文共享动作");
assert(!css.includes(".balance-summary .balance-total { grid-column"), "结余卡片不得固定跨列并制造空位");
assert(prototypeJs.includes("normalizeDailyTemplateKey") && prototypeJs.includes("normalize('NFKC')"), "日常模板必须复用名称规范化规则");
assert(prototypeJs.includes("createDailyTemplateFromSourceRow") && prototypeJs.includes("upsertDailyTemplate"), "从明细加入日常必须复用模板领域逻辑");
assert(prototypeJs.includes("timeZone: 'Asia/Shanghai'"), "日常模板回填时间必须显式使用上海时区");
assert(prototypeJs.includes("select.dataset.required = ''"), "资金渠道下拉必须进入统一必填校验");
assert(!prototypeJs.includes("data-copy-entry"), "旧复制上一笔交互逻辑必须完全移除");
assert(prototypeJs.includes("function initFormAccessibility()") && prototypeJs.includes("aria-labelledby"), "动态表单与芯片组必须补齐可访问名称");
assert(prototypeJs.includes("beforeinstallprompt") && prototypeJs.includes("data-install-state=\"detecting\"") && prototypeJs.includes("data-install-state=\"unsupported\""), "PWA 安装必须区分检测、可安装与平台引导分支");
assert(profileSettings.includes("data-install-trigger"), "“我的”页面必须继承 PWA 安装帮助职责");

console.log("Design contract: OK");
