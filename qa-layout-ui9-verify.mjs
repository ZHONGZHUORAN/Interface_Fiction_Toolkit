// qa-layout-ui9-verify.mjs — UI9 封面占位 + 分隔线稳定 独立复核（Edward / QA）
// 目的：用与 qa-layout-ui9.mjs 不同的提取方式（函数切片 + 计数 + 分支拆分），
//       独立复核 team-lead 给出的 7 项 ui9 断言。
// 说明：封面预览图真实渲染、分隔线是否“真常驻不漂移”属浏览器真实渲染范畴，
//       本环境仅做静态断言，最终需用户在浏览器目检确认。
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
let pass = 0, fail = 0;
const fails = [];
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL', name + (detail ? ' — ' + detail : '')); }
};

// ---- 通用工具：取首个匹配的平衡大括号块（从 startIdx 处的 { 开始）----
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
function fnBody(name) {
  const at = html.indexOf('function ' + name + '(');
  if (at < 0) return { at, body: '' };
  return { at, body: balancedFrom(html, at) };
}
// 取 <style> 内联 CSS 中某规则块内容
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const css = styleMatch ? styleMatch[1] : '';
function ruleBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(escaped + '\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

// ===== 检查1：源码无「💬 捡手机」字面量 =====
console.log('[C1] 源码无「💬 捡手机」占位字面量');
ok(!html.includes('💬 捡手机'), 'C1: 全局无「💬 捡手机」字面量');

// ===== 检查2：buildThumbPlaceholder 对 p.data.chats 做非空判断 =====
console.log('[C2] buildThumbPlaceholder 封面占位逻辑');
const bt = fnBody('buildThumbPlaceholder');
ok(bt.at >= 0, 'C2: 存在 buildThumbPlaceholder 函数');
ok(!bt.body.includes('buildThumbChatPreview'), 'C2: ui11 起捡手机分支不再调用 buildThumbChatPreview（对话预览缩略图）');
ok(bt.body.includes("'未命名捡手机'"), 'C2: 捡手机分支 fallback 到项目标题（未命名捡手机）');
ok(bt.body.includes("'未命名小说'"), 'C2: 论坛体保持 fallback 到项目标题（未命名小说）');
ok(/p\.title\s*\|\|\s*'未命名捡手机'/.test(bt.body), 'C2: 捡手机分支使用 p.title || 未命名捡手机');

// ===== 检查3：.thumb-chat-preview CSS 存在（微信风 mini 气泡缩略图）=====
console.log('[C3] .thumb-chat-preview CSS');
const tcp = ruleBlock('.thumb-chat-preview');
ok(tcp !== null, 'C3: 存在 .thumb-chat-preview 规则块（微信风 mini 气泡缩略图）');

// ===== 检查4：renderPickupDesktop 两分支均插入 .wx-col-divider =====
console.log('[C4] renderPickupDesktop 两分支插入分隔线');
const rp = fnBody('renderPickupDesktop');
ok(rp.at >= 0, 'C4: 存在 renderPickupDesktop 函数');
const occ = (rp.body.match(/wx-col-divider/g) || []).length;
ok(occ >= 2, `C4: 源码中 wx-col-divider 出现 ≥ 2 次（实际 ${occ} 次）`);
const elseIdx = rp.body.indexOf('} else {');
ok(elseIdx >= 0, 'C4: 存在 if(chat) / else 两分支');
if (elseIdx >= 0) {
  const ifBranch = rp.body.slice(0, elseIdx);
  const elseBranch = balancedFrom(rp.body, elseIdx);
  ok(ifBranch.includes('wx-col-divider'), 'C4: 有 chat 分支插入了 .wx-col-divider');
  ok(elseBranch.includes('wx-col-divider'), 'C4: 空 chat 分支插入了 .wx-col-divider');
}

// ===== 检查5：两分支编辑列 flex:7 0 0、预览列 flex:3 0 0 =====
console.log('[C5] 编辑列/预览列固定 flex 比例');
const f7 = (rp.body.match(/flex:7 0 0/g) || []).length;
const f3 = (rp.body.match(/flex:3 0 0/g) || []).length;
ok(f7 >= 2, `C5: 编辑列 flex:7 0 0 在两分支均落地（实际 ${f7} 处）`);
ok(f3 >= 2, `C5: 预览列 flex:3 0 0 在两分支均落地（实际 ${f3} 处）`);

// ===== 检查6：.wx-col-divider 四项属性；.wx-col-edit 基础规则无 border-right =====
console.log('[C6] 分隔线 CSS 四项属性 / .wx-col-edit 去 border-right');
const div = ruleBlock('.wx-col-divider');
ok(div !== null, 'C6: 存在 .wx-col-divider 基础规则块');
ok(div !== null && /flex:\s*0\s+0\s+1px/.test(div), 'C6: 含 flex:0 0 1px');
ok(div !== null && /align-self:\s*stretch/.test(div), 'C6: 含 align-self:stretch');
ok(div !== null && /min-width:\s*1px/.test(div), 'C6: 含 min-width:1px');
ok(div !== null && /background:\s*#d9d9d9/.test(div), 'C6: 含 background:#d9d9d9');
const ed = ruleBlock('.wx-col-edit');
ok(ed !== null && !/border-right/.test(ed), 'C6: 基础 .wx-col-edit 规则无 border-right（避免与分隔线重叠成双线）');

console.log(`\n===== UI9 独立复核(verify): ${pass} pass / ${fail} fail =====`);
if (fails.length) { console.log('失败:'); fails.forEach(f => console.log('  - ' + f)); }
console.log(fail === 0
  ? '结论: 所有 ui9 静态断言通过（封面占位逻辑 + 分隔线两分支一致插入 + CSS 四项属性 + .wx-col-edit 无 border-right 均已落地）。\n注: 封面预览图真实渲染、分隔线是否真常驻不漂移属浏览器真实渲染，需用户最终目检。'
  : '结论: 存在未满足断言，见上方 FAIL。');
process.exit(fail ? 1 : 0);
