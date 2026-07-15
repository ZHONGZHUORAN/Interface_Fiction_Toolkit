// UI8b (ui8b) 捡手机体分隔线专项验证 —— Alex / Engineer
// 验证范围：捡手机体（pickup）编辑区与预览区中间的常驻实体分隔线
//   - 新增 .wx-col-divider 实体分隔线（宽屏常驻、窄屏隐藏）
//   - 移除 .wx-col-edit 上的 border-right（避免与实体分隔线重叠成双线）
//   - renderPickupDesktop / renderChatDetail 宽屏分支均插入 .wx-col-divider
//     使两条渲染路径 DOM 结构一致 → 首次进入即有线、发消息重渲染后仍有线。
// 说明：纯 CSS/flex 的视觉稳定性（竖线是否真常驻、不随内容/状态变化）需在浏览器由用户最终确认，
//       本文件只做“静态断言”（正则提取内联 CSS/JS），不臆测视觉验收结果。
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => {
  if (c) { pass++; console.log('  PASS', m); }
  else { fail++; console.log('  FAIL', m); }
};

// 提取“平衡大括号”代码块（用于媒体查询 / 函数体 / 分支块）
// 所有索引均为“绝对 html 索引”，调用方需传入基于 html 的字符串索引。
function balancedFrom(absStartIdx) {
  const open = html.indexOf('{', absStartIdx);
  if (open < 0) return '';
  let depth = 0, i = open;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(open, i);
}

// 取某函数（以 needle 首次出现定位）的函数体（平衡大括号块），返回 {absOpen, block}
function extractFn(needle) {
  const absStart = html.indexOf(needle);
  if (absStart < 0) return { absStart, absOpen: -1, block: '' };
  const absOpen = html.indexOf('{', absStart);
  return { absStart, absOpen, block: absOpen < 0 ? '' : balancedFrom(absOpen) };
}

// 在某函数体 block（html.slice(absOpen, ...)）中，取相对偏移处的平衡块（返回绝对索引开始的块）
function subBlock(block, absOpen, relNeedle) {
  const abs = absOpen + relNeedle;
  return balancedFrom(abs);
}

// ---------- CSS 断言 ----------

// C1: .wx-col-divider 实体分隔线规则（宽屏常驻）
const dividerBlock = html.match(/\.wx-col-divider\{([^}]*)\}/);
console.log('[CSS] 实体分隔线 .wx-col-divider');
ok(!!dividerBlock, 'C1: 存在 .wx-col-divider 规则块（常驻分隔线）');
ok(!!dividerBlock && /flex:\s*0\s+0\s+1px/.test(dividerBlock[1]),
    'C1: .wx-col-divider 含 flex:0 0 1px（常驻 1px，不随内容增减）');
ok(!!dividerBlock && /align-self:\s*stretch/.test(dividerBlock[1]),
    'C1: .wx-col-divider 含 align-self:stretch（贯穿整栏高度）');
ok(!!dividerBlock && /min-width:\s*1px/.test(dividerBlock[1]),
    'C1: .wx-col-divider 含 min-width:1px（不被压缩为 0）');
ok(!!dividerBlock && /background:\s*#d9d9d9/.test(dividerBlock[1]),
    'C1: .wx-col-divider 含 background:#d9d9d9（与论坛体 .col-divider 同色思路）');

// C2: .wx-col-edit 不再带 border-right（避免与实体分隔线重叠）
// 仅取“基础定义”的第一次出现（媒体查询内另有一处 border-right:none，与本次无关）。
const editBlock = html.match(/\.wx-col-edit\{([^}]*)\}/);
console.log('[CSS] .wx-col-edit 去 border-right');
ok(!!editBlock, 'C2: 存在基础 .wx-col-edit 规则块（首次出现）');
ok(!!editBlock && !/border-right/.test(editBlock[1]),
    'C2: 基础 .wx-col-edit 定义不再含 border-right（避免与 .wx-col-divider 重叠成双线）');

// C3: 窄屏媒体查询内必须隐藏竖线
const mqIdx = html.search(/@media[^{]*max-width:\s*760px/);
const mqBlockStr = mqIdx >= 0 ? balancedFrom(mqIdx) : '';
console.log('[CSS] 窄屏隐藏竖线');
ok(mqIdx >= 0, 'C3: 存在 @media (max-width:760px) 窄屏媒体查询');
ok(mqIdx >= 0 && /\.wx-col-divider\s*\{\s*display:\s*none/.test(mqBlockStr),
    'C3: 窄屏媒体查询内 .wx-col-divider{ display:none }（单栏不显示竖线）');

// 反向断言：全局（媒体查询之外）不应有 .wx-col-divider{ display:none }
const noneMatches = [...html.matchAll(/\.wx-col-divider\s*\{\s*display:\s*none/g)].map(m => m.index);
ok(noneMatches.length >= 1 &&
    noneMatches.every(idx => idx >= mqIdx && idx < mqIdx + mqBlockStr.length),
    'C3: .wx-col-divider{ display:none } 仅出现在窄屏媒体查询内（不在全局隐藏）');

// ---------- JS 断言 ----------

// J1: renderPickupDesktop 创建并插入 .wx-col-divider（两条路径：有 chat / 空）
const pick = extractFn('function renderPickupDesktop(');
const pickBlock = pick.block;
console.log('[JS] renderPickupDesktop 插入分隔线');
ok(pick.absStart >= 0, 'J1: 存在 renderPickupDesktop 函数');
ok(pickBlock.includes("class:'wx-col-divider'") || pickBlock.includes('class:"wx-col-divider"'),
    'J1: renderPickupDesktop 创建 .wx-col-divider 节点（class wx-col-divider）');
const p1 = pickBlock.indexOf("appendChild(editCol)");
// ui9 修复后 divider 以内联 el('div',{class:'wx-col-divider'}) 形式插入，无独立 divider 变量名
const p2 = pickBlock.indexOf("wx-col-divider", p1 >= 0 ? p1 + 1 : 0);
const p3 = pickBlock.indexOf("appendChild(prevCol)");
ok(p1 >= 0 && p2 >= 0 && p3 >= 0 && p1 < p2 && p2 < p3,
    'J1: 有 chat 时按 editCol → divider → prevCol 顺序插入（竖线位于两栏之间）');

// 空 chat 分支：取函数体内 "else {" 之后的平衡块，单独检验插入顺序
const relElse = pickBlock.indexOf('} else {');
if (relElse >= 0) {
  const elseBlock = subBlock(pickBlock, pick.absOpen, relElse);
  const e1 = elseBlock.indexOf("appendChild(emptyEdit)");
  const e2 = elseBlock.indexOf("wx-col-divider");
  const e3 = elseBlock.indexOf("appendChild(emptyPrev)");
  ok(e1 >= 0 && e2 >= 0 && e3 >= 0 && e1 < e2 && e2 < e3,
      'J1: 空 chat 时按 emptyEdit → divider → emptyPrev 顺序插入（结构保持一致）');
} else {
  ok(false, 'J1: 未找到空 chat 的 else 分支');
}

// J2: renderChatDetail 宽屏分支（wide 为 true 的块）创建并插入 .wx-col-divider
const rc = extractFn('function renderChatDetail(');
const rcBlock = rc.block;
console.log('[JS] renderChatDetail 宽屏分支插入分隔线');
ok(rc.absStart >= 0, 'J2: 存在 renderChatDetail 函数');
const relWide = rcBlock.indexOf('if(wide)');
ok(relWide >= 0, 'J2: renderChatDetail 存在 if(wide) 宽屏分支');
if (relWide >= 0) {
  const wideBlock = subBlock(rcBlock, rc.absOpen, relWide);
  ok(wideBlock.includes("class:'wx-col-divider'") || wideBlock.includes('class:"wx-col-divider"'),
      'J2: 宽屏分支内创建 .wx-col-divider 节点');
  const w1 = wideBlock.indexOf("appendChild(left)");
  const w2 = wideBlock.indexOf("appendChild(editCol)");
  const w3 = wideBlock.indexOf("appendChild(divider)");
  const w4 = wideBlock.indexOf("appendChild(prevCol)");
  ok(w1 >= 0 && w2 >= 0 && w3 >= 0 && w4 >= 0 && w1 < w2 && w2 < w3 && w3 < w4,
      'J2: 宽屏分支按 left → editCol → divider → prevCol 顺序插入（竖线位于两栏之间）');
} else {
  ok(false, 'J2: 未找到 if(wide) 宽屏分支');
}

console.log(`\n===== UI8b 捡手机体分隔线验证: ${pass} pass / ${fail} fail =====`);
console.log(fail === 0
  ? '结论: 所有 ui8b 静态断言通过（.wx-col-divider 实体分隔线 + 两渲染路径一致插入均已落地）。\n注意: 竖线是否真正常驻、不随内容/状态变化，属纯 CSS/flex 视觉稳定性，需在浏览器由用户最终确认。'
  : '结论: 存在未满足的 ui8b 断言，见上方 FAIL。');
process.exit(fail ? 1 : 0);
