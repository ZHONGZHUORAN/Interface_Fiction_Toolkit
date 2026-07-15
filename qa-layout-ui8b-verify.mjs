// qa-layout-ui8b-verify.mjs — UI8b 捡手机体分隔线 独立复核（Edward / QA）
// 目的：与 qa-layout-ui8b.mjs 拉开方法差异，用任务书给定的 5 组断言独立复核
//       「实体 .wx-col-divider + 双渲染路径一致插入」。
// 说明：纯 CSS/flex 视觉稳定性（竖线是否真常驻、窄屏是否真隐藏）属浏览器真实渲染范畴，
//       本环境仅做静态断言，最终需在浏览器由用户目检确认。
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
let pass = 0, fail = 0;
const fails = [];
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL', name + (detail ? ' — ' + detail : '')); }
};

// 取首个匹配的平衡大括号块（从 startIdx 处的 { 开始）
function balancedFrom(text, startIdx) {
  const open = text.indexOf('{', startIdx);
  if (open < 0) return '';
  let depth = 0, i = open;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return text.slice(open, i);
}

// 切出 <style>...</style> 内联 CSS
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const css = styleMatch ? styleMatch[1] : '';
ok(!!styleMatch, 'CSS: 存在 <style> 内联样式块');

// 取某规则块内容（传入真实选择器，如 '.wx-col-divider'，函数内部做正则转义）
function ruleBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped + '\\{([^}]*)\\}');
  const m = css.match(re);
  return m ? m[1] : null;
}

// 1) .wx-col-divider 实体分隔线规则
console.log('[CSS-1] .wx-col-divider 实体分隔线');
const div = ruleBlock('.wx-col-divider');
ok(div !== null, 'C1: 存在 .wx-col-divider 规则块');
ok(div !== null && /flex:\s*0\s+0\s+1px/.test(div), 'C1: 含 flex:0 0 1px');
ok(div !== null && /align-self:\s*stretch/.test(div), 'C1: 含 align-self:stretch');
ok(div !== null && /min-width:\s*1px/.test(div), 'C1: 含 min-width:1px');
ok(div !== null && /background:\s*#d9d9d9/.test(div), 'C1: 含 background:#d9d9d9');

// 2) 窄屏媒体查询内仅含 .wx-col-divider{display:none}，全局其它位置不隐藏
//    所有索引统一基于 html（避免 css/html 索引错位）。
console.log('[CSS-2] 窄屏隐藏竖线');
const mqAt = html.search(/@media[^{]*max-width:\s*760px/);
ok(mqAt >= 0, 'C2: 存在 @media (max-width:760px) 窄屏媒体查询');
const mqBlock = mqAt >= 0 ? balancedFrom(html, mqAt) : '';
ok(mqAt >= 0 && /\.wx-col-divider\s*\{\s*display:\s*none/.test(mqBlock),
    'C2: 窄屏媒体查询内 .wx-col-divider{display:none}');
const noneIdxs = [...html.matchAll(/\.wx-col-divider\s*\{\s*display:\s*none/g)].map(m => m.index);
ok(noneIdxs.length >= 1 &&
    noneIdxs.every(idx => idx >= mqAt && idx < mqAt + mqBlock.length),
    'C2: .wx-col-divider{display:none} 仅出现在窄屏媒体查询内（全局其它位置不隐藏）');

// 3) 基础 .wx-col-edit 不再含 border-right；.wx-col-list 仍含 border-right（未被误删）
console.log('[CSS-3] .wx-col-edit 去 border-right / .wx-col-list 保留 border-right');
const edit = ruleBlock('.wx-col-edit');
const list = ruleBlock('.wx-col-list');
ok(edit !== null && !/border-right/.test(edit), 'C3: 基础 .wx-col-edit 不含 border-right');
ok(list !== null && /border-right:1px solid/.test(list), 'C3: 基础 .wx-col-list 仍含 border-right（未误删）');

// ---------- JS：用函数名切片函数体 ----------
function fnBody(name) {
  const at = html.indexOf('function ' + name + '(');
  if (at < 0) return { at, body: '' };
  const body = balancedFrom(html, at);
  return { at, body };
}

// 4) renderPickupDesktop 创建并插入 .wx-col-divider（有 chat / 空 chat 两分支）
console.log('[JS-4] renderPickupDesktop 插入分隔线');
const pick = fnBody('renderPickupDesktop');
ok(pick.at >= 0, 'J1: 存在 renderPickupDesktop 函数');
ok(pick.body.includes("'wx-col-divider'") || pick.body.includes('"wx-col-divider"'),
    'J1: 函数体内创建 .wx-col-divider 节点');
const a1 = pick.body.indexOf('appendChild(editCol)');
// ui9 修复后 divider 以内联 el('div',{class:'wx-col-divider'}) 形式插入，无独立 divider 变量名
const a2 = pick.body.indexOf('wx-col-divider', a1 >= 0 ? a1 + 1 : 0);
const a3 = pick.body.indexOf('appendChild(prevCol)');
ok(a1 >= 0 && a2 >= 0 && a3 >= 0 && a1 < a2 && a2 < a3,
    'J1: 有 chat 时按 editCol → divider → prevCol 顺序插入');
const eAt = pick.body.indexOf('} else {');
if (eAt >= 0) {
  const elseBody = balancedFrom(pick.body, eAt);
  const e1 = elseBody.indexOf('appendChild(emptyEdit)');
  const e2 = elseBody.indexOf('wx-col-divider');
  const e3 = elseBody.indexOf('appendChild(emptyPrev)');
  ok(e1 >= 0 && e2 >= 0 && e3 >= 0 && e1 < e2 && e2 < e3,
      'J1: 空 chat 时按 emptyEdit → divider → emptyPrev 顺序插入');
} else {
  ok(false, 'J1: 未找到空 chat 的 else 分支');
}

// 5) renderChatDetail 宽屏分支 if(wide) 创建并插入 .wx-col-divider
console.log('[JS-5] renderChatDetail 宽屏分支插入分隔线');
const rc = fnBody('renderChatDetail');
ok(rc.at >= 0, 'J2: 存在 renderChatDetail 函数');
const wAt = rc.body.indexOf('if(wide)');
ok(wAt >= 0, 'J2: 存在 if(wide) 宽屏分支');
if (wAt >= 0) {
  const wideBody = balancedFrom(rc.body, wAt);
  ok(wideBody.includes("'wx-col-divider'") || wideBody.includes('"wx-col-divider"'),
      'J2: 宽屏分支内创建 .wx-col-divider 节点');
  const w1 = wideBody.indexOf('appendChild(left)');
  const w2 = wideBody.indexOf('appendChild(editCol)');
  const w3 = wideBody.indexOf('appendChild(divider)');
  const w4 = wideBody.indexOf('appendChild(prevCol)');
  ok(w1 >= 0 && w2 >= 0 && w3 >= 0 && w4 >= 0 && w1 < w2 && w2 < w3 && w3 < w4,
      'J2: 宽屏分支按 left → editCol → divider → prevCol 顺序插入');
} else {
  ok(false, 'J2: 未找到 if(wide) 宽屏分支');
}

console.log(`\n===== UI8b 独立复核(verify): ${pass} pass / ${fail} fail =====`);
if (fails.length) { console.log('失败:'); fails.forEach(f => console.log('  - ' + f)); }
console.log(fail === 0
  ? '结论: 独立复核全部通过 —— 实体 .wx-col-divider 已落地，且两条渲染路径结构一致（list → editCol → divider → prevCol）。\n注: 竖线是否真常驻/窄屏是否真隐藏属浏览器真实渲染，需用户最终目检。'
  : '结论: 存在未满足断言，见上方 FAIL。');
process.exit(fail ? 1 : 0);
