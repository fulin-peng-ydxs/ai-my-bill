import assert from "node:assert/strict";
import { css, readProjectFile } from "./contract-test.helpers.mjs";

const design = readProjectFile("DESIGN.md");

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
  ["--income: #ff3b30", "收入语义色必须为固定红色"],
  ["--expense: #34c759", "支出语义色必须为固定绿色"],
  ["backdrop-filter: saturate(180%) blur(20px)", "固定栏必须使用共享毛玻璃效果"],
];

for (const [fragment, message] of cssContracts) {
  assert(css.toLowerCase().includes(fragment.toLowerCase()), message);
}

assert.equal((css.match(/--income:\s*#ff3b30/gi) ?? []).length, 2, "收入色必须在浅色与深色主题中保持一致");
assert.equal((css.match(/--expense:\s*#34c759/gi) ?? []).length, 2, "支出色必须在浅色与深色主题中保持一致");
assert(!/gradient\s*\(/i.test(css), "工具型页面不得使用装饰性渐变");
assert(!/font-weight:\s*500\b/.test(css), "不得使用不稳定的 500 字重");

for (const fragment of ["fontSize: 17px", "收入固定 `#FF3B30`", "支出固定 `#34C759`", "44×44px"]) {
  assert(design.includes(fragment), `DESIGN.md 缺少稳定契约：${fragment}`);
}

console.log("Design contract: OK");
