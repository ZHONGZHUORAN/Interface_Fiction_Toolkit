// UI8 (ui8) 布局专项验证 —— Edward / QA
// 验证范围：分隔线常驻 + flex 比例修复 + scrollbar-gutter 稳定 + 窄屏隐藏竖线 + JS 插入与可见性控制。
// 说明：纯 CSS/flex 的视觉稳定性（滚动条是否真不抖动、竖线是否真常驻）需在浏览器由用户最终确认，
//       本文件只做“静态断言 + 逻辑验证”（正则提取内联 CSS/JS），不臆测视觉验收结果。
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => {
  if (c) { pass++; console.log('  PASS', m); }
  else { fail++; console.log('  FAIL', m); }
};

// 提取“平衡大括号”代码块（用于媒体查询 / 函数体）
function balanced(startIdx) {
  const open = html.indexOf('{', startIdx);
  if (open < 0) return '';
  let depth = 0, i = open;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(open, i);
}

// ---------- CSS 断言 ----------
const editBlock = html.match(/\.col-edit\{([^}]*)\}/);
const previewBlock = html.match(/\.col-preview\{([^}]*)\}/);
const dividerBlock = html.match(/\.col-divider\{([^}]*)\}/);

console.log('[CSS] 列布局 / 分隔线规则');
ok(!!editBlock, 'C1: 存在 .col-edit 规则块');
ok(!!editBlock && /flex:\s*7\s+0\s+0/.test(editBlock[1]), 'C1: .col-edit 含 flex:7 0 0（固定比例，不再 1 1 70%）');
ok(!!editBlock && /scrollbar-gutter:\s*stable/.test(editBlock[1]), 'C1: .col-edit 含 scrollbar-gutter:stable（滚动条占位恒定）');

ok(!!previewBlock, 'C2: 存在 .col-preview 规则块');
ok(!!previewBlock && /flex:\s*3\s+0\s+0/.test(previewBlock[1]), 'C2: .col-preview 含 flex:3 0 0（固定比例，不再 1 1 30%）');
ok(!!previewBlock && /scrollbar-gutter:\s*stable/.test(previewBlock[1]), 'C2: .col-preview 含 scrollbar-gutter:stable');

ok(!!dividerBlock, 'C3: 存在 .col-divider 规则块（常驻分隔线）');
ok(!!dividerBlock && /flex:\s*0\s+0\s+1px/.test(dividerBlock[1]), 'C3: .col-divider 含 flex:0 0 1px（常驻 1px，不随内容增减）');
ok(!!dividerBlock && /background:\s*var\(--border\)/.test(dividerBlock[1]), 'C3: .col-divider 含 background:var(--border)');
ok(!!dividerBlock && /align-self:\s*stretch/.test(dividerBlock[1]), 'C3: .col-divider 含 align-self:stretch（贯穿整栏高度）');
ok(!!dividerBlock && /min-width:\s*1px/.test(dividerBlock[1]), 'C3: .col-divider 含 min-width:1px（不被压缩为 0）');

// 窄屏媒体查询内必须隐藏竖线
const mqIdx = html.search(/@media[^{)]*max-width:\s*1023px/);
ok(mqIdx >= 0, 'C4: 存在 @media (max-width:1023px) 窄屏媒体查询');
if (mqIdx >= 0) {
  const mqBlock = balanced(mqIdx);
  ok(/\.col-divider\s*\{\s*display:\s*none/.test(mqBlock), 'C4: 窄屏媒体查询内 .col-divider{ display:none }（单栏不显示竖线）');
}
// 反向断言：全局（媒体查询之外）不应有 .col-divider{ display:none }
const mqBlockStr = mqIdx >= 0 ? balanced(mqIdx) : '';
const noneMatches = [...html.matchAll(/\.col-divider\s*\{\s*display:\s*none/g)].map(m => m.index);
ok(noneMatches.length >= 1 &&
    noneMatches.every(idx => idx >= mqIdx && idx < mqIdx + mqBlockStr.length),
    'C4: .col-divider{ display:none } 仅出现在窄屏媒体查询内（不在全局隐藏）');

// ---------- JS 断言 ----------
const recIdx = html.indexOf('function renderEditorContent()');
const recBlock = recIdx >= 0 ? balanced(recIdx) : '';
ok(recIdx >= 0, 'J1: 存在 renderEditorContent 函数');
ok(recBlock.includes("class:'col-divider'") || recBlock.includes('class:"col-divider"'),
    'J1: renderEditorContent 创建 col-divider 节点（class col-divider）');
ok(recBlock.includes("'aria-hidden':'true'") || recBlock.includes('"aria-hidden":"true"'),
    'J1: divider 节点带 aria-hidden="true"（装饰性，对辅助技术隐藏）');

// append 顺序：editCol -> divider -> previewCol
const i1 = recBlock.indexOf('appendChild(editCol)');
const i2 = recBlock.indexOf('appendChild(divider)');
const i3 = recBlock.indexOf('appendChild(previewCol)');
ok(i1 >= 0 && i2 >= 0 && i3 >= 0 && i1 < i2 && i2 < i3,
    'J2: 三栏按 editCol → divider → previewCol 顺序插入（竖线位于两栏之间）');
ok(recBlock.includes('applyModeVisibility()'),
    'J2: renderEditorContent 末尾调用 applyModeVisibility 同步可见性');

const visIdx = html.indexOf('function applyModeVisibility()');
const visBlock = visIdx >= 0 ? balanced(visIdx) : '';
ok(visIdx >= 0, 'J3: 存在 applyModeVisibility 函数');
ok(visBlock.includes("querySelector('.col-divider')"),
    'J3: applyModeVisibility 查询 .col-divider 节点');
ok(visBlock.includes("divider.style.display=''"),
    'J3: 宽屏双栏分支将 divider 显示（style.display=\'\'）');
ok(visBlock.includes("divider.style.display='none'"),
    'J3: 窄屏/预览单栏分支将 divider 隐藏（style.display=\'none\'）');
ok(visBlock.includes('showDivider()') && visBlock.includes('hideDivider()'),
    'J3: 存在 showDivider / hideDivider 两个可见性控制分支');

console.log(`\n===== UI8 布局专项验证: ${pass} pass / ${fail} fail =====`);
console.log(fail === 0
  ? '结论: 所有 ui8 静态断言通过（CSS 规则 + JS 插入/可见性逻辑均已落地）。\n注意: 滚动条是否真正不再抖动、竖线是否真正常驻，属视觉稳定性，需在浏览器由用户最终确认。'
  : '结论: 存在未满足的 ui8 断言，见上方 FAIL。');
process.exit(fail ? 1 : 0);
