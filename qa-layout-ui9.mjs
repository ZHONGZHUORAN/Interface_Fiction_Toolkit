// qa-layout-ui9.mjs — UI9 两处布局/封面修正 静态断言 (Alex / Engineer)
// 验证目标：D:\Z\yige\forum-novel-editor\index.html （单文件、内联 CSS+JS、零依赖）
//
// 覆盖：
//   1) 项目卡片封面：删去「💬 捡手机」占位字；捡手机项目按有无聊天显示对话预览 / 项目名。
//   2) 分隔线位置稳定：renderPickupDesktop 的「有 chat / 空 chat」两分支均插入实体 .wx-col-divider，
//      CSS 保持 flex:0 0 1px / align-self:stretch / min-width:1px / background:#d9d9d9，
//      且 .wx-col-edit 不含 border-right（ui8b 修复未被回退）。
//
// 说明：纯 CSS/flex 视觉稳定性（封面预览图、分隔线是否真常驻不漂移）需在浏览器由用户最终确认，
//       本脚本仅做静态源码断言。

import { readFileSync } from 'node:fs';

const path = 'D:\\Z\\yige\\forum-novel-editor\\index.html';
const html = readFileSync(path, 'utf8');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name); }
}

/* ---------- 工具：提取顶层函数体 ---------- */
function fnBlock(name) {
  const re = new RegExp('function ' + name + '\\([\\s\\S]*?\\nfunction ');
  const m = html.match(re);
  if (m) return m[0];
  // 兜底：函数可能位于文件末尾（后接 comment 或 EOF）
  const re2 = new RegExp('function ' + name + '\\([\\s\\S]*$');
  const m2 = html.match(re2);
  return m2 ? m2[0] : '';
}

/* ===================================================================== */
console.log('\n[问题1] 项目卡片封面占位（捡手机 / 论坛体）');
console.log('------------------------------------------------------------');

// A1: 全局不应再出现「💬 捡手机」占位字
ok(!html.includes('💬 捡手机'),
  'A1: 源码中已无「💬 捡手机」占位字符串');

// A2: 封面占位逻辑（ui11 起：捡手机分支不再调用对话预览缩略图，统一走 coverImage/项目名）
const placeholderBlock = fnBlock('buildThumbPlaceholder');
ok(/未命名捡手机/.test(placeholderBlock),
  'A2: 捡手机分支 fallback 到项目标题（p.title || 未命名捡手机）');
ok(!/buildThumbChatPreview/.test(placeholderBlock),
  'A2: 捡手机分支不再调用对话预览缩略图（buildThumbChatPreview）— ui11 统一走封面图/项目名');
ok(/p\.title\s*\|\|\s*'未命名捡手机'/.test(placeholderBlock),
  'A2: 捡手机分支使用 p.title || 未命名捡手机 作为占位文本');

// A3: 论坛体保持原逻辑（未命名小说）
ok(/未命名小说/.test(placeholderBlock) && /!isPickup|if\(isPickup\)/.test(placeholderBlock),
  'A3: 论坛体分支仍 fallback 到「未命名小说」');

// A4: 对话预览缩略图函数存在，并取「最后一条聊天的最后一条消息」
const previewBlock = fnBlock('buildThumbChatPreview');
ok(previewBlock.includes('function buildThumbChatPreview'),
  'A4: buildThumbChatPreview 函数已定义');
ok(/chats\[chats\.length-1\]/.test(placeholderBlock) || /chatDisplayName/.test(previewBlock),
  'A4: 预览取最近一条聊天（chatDisplayName / 最后聊天）');
ok(/lastMessage\(chat\)/.test(previewBlock) && /messageSnippet/.test(previewBlock),
  'A4: 预览气泡内容取该聊天的最后一条消息（lastMessage + messageSnippet）');

// A5: buildHomeCard 的 else 分支改用 buildThumbPlaceholder（不再内联 isPickup?'💬 捡手机'）
const homeCardBlock = fnBlock('buildHomeCard');
ok(/buildThumbPlaceholder\(p, isPickup\)/.test(homeCardBlock),
  'A5: buildHomeCard 的封面占位改为调用 buildThumbPlaceholder(p, isPickup)');
ok(!/isPickup\?'💬 捡手机'/.test(homeCardBlock),
  'A5: buildHomeCard 内联分支已移除「💬 捡手机」字面量');

/* ===================================================================== */
console.log('\n[问题2] 分隔线位置稳定（renderPickupDesktop 两分支一致）');
console.log('------------------------------------------------------------');

// B1: .wx-col-divider 实体分隔线 CSS 四项属性完整保留
const dividerBlock = html.match(/\.wx-col-divider\{([^}]*)\}/);
ok(!!dividerBlock, 'B1: 存在 .wx-col-divider 规则块');
if (dividerBlock) {
  const b = dividerBlock[1];
  ok(/flex:\s*0\s+0\s+1px/.test(b), 'B1: .wx-col-divider 含 flex:0 0 1px');
  ok(/align-self:\s*stretch/.test(b), 'B1: .wx-col-divider 含 align-self:stretch');
  ok(/min-width:\s*1px/.test(b), 'B1: .wx-col-divider 含 min-width:1px');
  ok(/background:\s*#d9d9d9/.test(b), 'B1: .wx-col-divider 含 background:#d9d9d9');
}

// B2: renderPickupDesktop 的「有 chat」与「空 chat」两分支均插入 .wx-col-divider
const pickBlock = fnBlock('renderPickupDesktop');
const dividerOccurrences = (pickBlock.match(/wx-col-divider/g) || []).length;
ok(dividerOccurrences >= 2,
  'B2: renderPickupDesktop 两分支均插入 .wx-col-divider（出现 ' + dividerOccurrences + ' 次 ≥ 2）');

// B2b: 两分支各自的列均带稳定 flex（编辑 7 / 预览 3，basis:0 不随内容漂移）
ok(/wx-col-edit'[^)]*flex:7 0 0/.test(pickBlock),
  'B2: 编辑列使用 flex:7 0 0（basis:0，比例稳定）');
ok(/wx-col-preview'[^)]*flex:3 0 0/.test(pickBlock),
  'B2: 预览列使用 flex:3 0 0（basis:0，比例稳定）');
ok((pickBlock.match(/flex:7 0 0/g) || []).length >= 2 && (pickBlock.match(/flex:3 0 0/g) || []).length >= 2,
  'B2: 编辑/预览的稳定 flex 在「有 chat」「空 chat」两分支均落地（各 ≥2 处）');

// B3: .wx-col-edit 基础定义不含 border-right（ui8b 修复未被回退）
const editRule = html.match(/\.wx-col-edit\{[^}]*\}/);
ok(!!editRule && !/border-right/.test(editRule[0]),
  'B3: .wx-col-edit 基础规则不含 border-right（避免与 .wx-col-divider 重叠成双线）');

/* ===================================================================== */
console.log(`\n===== UI9 布局/封面修正验证: ${pass} pass / ${fail} fail =====`);
console.log(fail === 0
  ? '结论: 所有 ui9 静态断言通过（封面占位逻辑 + 分隔线两分支一致插入 + CSS 四项属性 + .wx-col-edit 无 border-right 均已落地）。\n注意: 封面预览图渲染、分隔线是否真常驻不漂移属纯 CSS/flex 视觉稳定性，需在浏览器由用户最终确认。'
  : '结论: 存在失败项，需回修后再跑本脚本。');

process.exit(fail === 0 ? 0 : 1);
