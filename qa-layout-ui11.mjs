// qa-layout-ui11.mjs — UI11 静态断言 (Alex / Engineer)
// 验证目标：D:\Z\yige\forum-novel-editor\index.html （单文件、内联 CSS+JS、零依赖）
//
// 覆盖：
//   1) 返回列表按钮：桌面或聊天列表页一次点击即 goHome()；仅移动端聊天详情页先回聊天列表。
//   2) buildHomeCard 不再为捡手机取 chatAvatar 作为封面（统一走 coverImage / buildThumbPlaceholder）。
//   3) buildThumbPlaceholder 捡手机分支返回 p.title || 未命名捡手机，不再调用 buildThumbChatPreview。
//   4) newProject / newPickupProject 的 data 含 coverImage: null。
//   5) normalizeData / normalizePickup 含 coverImage 字段处理。
//   6) buildSettings / buildPickupSettings 含「项目封面图」设置行。
//   7) 首页标题含「我的捡手机项目」。
//   8) 新建弹窗按钮含「论坛体」「聊天体」，不含「论坛体小说」「捡手机文学」。
//   9) 空状态提示含「还没有项目」。
//
// 说明：封面图上传后的真实渲染、返回按钮交互属浏览器真实行为，需在浏览器由用户最终确认；
//       本脚本仅做静态源码断言。

import { readFileSync } from 'node:fs';

const path = 'D:\\Z\\yige\\forum-novel-editor\\index.html';
const html = readFileSync(path, 'utf8');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name); }
}

/* ---------- 工具：提取顶层 function 完整花括号块 ---------- */
function fnBody(name) {
  const at = html.indexOf('function ' + name + '(');
  if (at < 0) return '';
  const open = html.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0, i = open;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(at, i);
}

console.log('\n[UI11-1] 返回列表按钮：桌面/聊天列表页一次回首页');
const pickupBlock = fnBody('renderPickup');
ok(/back\.addEventListener\('click', \(\)=>\{/.test(pickupBlock),
  'UI11-1a: renderPickup 中 back 按钮绑定了 click 处理');
ok(/if\(isDesktop\(\) \|\| state\.pickupView==='chatlist'\)\{ goHome\(\); \}/.test(pickupBlock),
  'UI11-1b: 桌面宽屏或聊天列表页直接 goHome()（一键回首页）');
ok(/else \{ state\.pickupView='chatlist'; renderPickup\(\); \}/.test(pickupBlock),
  'UI11-1c: 仅移动端聊天详情页先回聊天列表（二次点击才回首页）');

console.log('\n[UI11-2] buildHomeCard 封面策略（不再为捡手机取 chatAvatar）');
const homeBlock = fnBody('buildHomeCard');
ok(!/chatAvatar/.test(homeBlock),
  'UI11-2a: buildHomeCard 不再引用 chatAvatar 作为封面来源');
ok(/p\.data\.coverImage/.test(homeBlock),
  'UI11-2b: buildHomeCard 优先使用项目级 coverImage');
ok(/buildThumbPlaceholder\(p, isPickup\)/.test(homeBlock),
  'UI11-2c: 无封面图时统一走 buildThumbPlaceholder');

console.log('\n[UI11-3] buildThumbPlaceholder 捡手机分支（不再调用对话预览缩略图）');
const phBlock = fnBody('buildThumbPlaceholder');
ok(/未命名捡手机/.test(phBlock),
  'UI11-3a: 捡手机分支 fallback 到项目标题（未命名捡手机）');
ok(/if\(isPickup\)/.test(phBlock),
  'UI11-3b: 仍保留 isPickup 分支');
ok(!/buildThumbChatPreview/.test(phBlock),
  'UI11-3c: 捡手机分支不再调用 buildThumbChatPreview（统一走封面图/项目名）');
ok(!/p\.data\.chats/.test(phBlock),
  'UI11-3d: 占位逻辑不再依赖 p.data.chats（不再做聊天预览）');

console.log('\n[UI11-4] newProject / newPickupProject 的 data 含 coverImage: null');
const npBlock = fnBody('newProject');
const nppBlock = fnBody('newPickupProject');
ok(/coverImage:null/.test(npBlock),
  'UI11-4a: newProject (forum) 的 data 含 coverImage: null');
ok(/coverImage:null/.test(nppBlock),
  'UI11-4b: newPickupProject 的 data 含 coverImage: null');

console.log('\n[UI11-5] normalizeData / normalizePickup 含 coverImage 字段处理');
const ndBlock = fnBody('normalizeData');
const ndpBlock = fnBody('normalizePickup');
ok(/coverImage:/.test(ndBlock),
  'UI11-5a: normalizeData 返回含 coverImage 字段');
ok(/coverImage:\(d\.coverImage && d\.coverImage\.dataUrl\)\?d\.coverImage:null/.test(ndBlock),
  'UI11-5b: normalizeData 的 coverImage 带 dataUrl 校验');
ok(/coverImage:/.test(ndpBlock),
  'UI11-5c: normalizePickup 返回含 coverImage 字段');
ok(/coverImage:\(d\.coverImage && d\.coverImage\.dataUrl\)\?d\.coverImage:null/.test(ndpBlock),
  'UI11-5d: normalizePickup 的 coverImage 带 dataUrl 校验');

console.log('\n[UI11-6] 项目封面图设置行（论坛体 buildSettings + 捡手机体 buildPickupSettings）');
const bsBlock = fnBody('buildSettings');
const bpsBlock = fnBody('buildPickupSettings');
ok(/项目封面图/.test(bsBlock),
  'UI11-6a: buildSettings 含「项目封面图」设置行');
ok(/项目封面图/.test(bpsBlock),
  'UI11-6b: buildPickupSettings 含「项目封面图」设置行');
ok(/accept:'image\/\*'/.test(bsBlock) && /accept:'image\/\*'/.test(bpsBlock),
  'UI11-6c: 两处均提供 image/* 文件选择输入');
ok(/fileToDataURL/.test(bsBlock) && /fileToDataURL/.test(bpsBlock),
  'UI11-6d: 两处上传均调用 fileToDataURL 转 dataUrl 存入 coverImage');

console.log('\n[UI11-7] 首页标题含「我的捡手机项目」');
ok(html.includes('我的捡手机项目'),
  'UI11-7a: renderHome 标题已改为「我的捡手机项目」');

console.log('\n[UI11-8] 新建弹窗按钮：论坛体 / 聊天体（不再 论坛体小说 / 捡手机文学）');
const modalBlock = fnBody('openNewProjectModal');
ok(/'论坛体'/.test(modalBlock),
  'UI11-8a: 新建弹窗含「论坛体」按钮');
ok(/'聊天体'/.test(modalBlock),
  'UI11-8b: 新建弹窗含「聊天体」按钮');
ok(!modalBlock.includes('论坛体小说'),
  'UI11-8c: 新建弹窗不再含「论坛体小说」');
ok(!modalBlock.includes('捡手机文学'),
  'UI11-8d: 新建弹窗不再含「捡手机文学」');

console.log('\n[UI11-9] 空状态提示含「还没有项目」');
ok(html.includes('还没有项目'),
  'UI11-9a: 首页空状态提示已改为「还没有项目，点“新建项目”开始」');
ok(!html.includes('还没有小说'),
  'UI11-9b: 已无「还没有小说」旧文案');

console.log(`\n===== UI11 静态断言验证: ${pass} pass / ${fail} fail =====`);
console.log(fail === 0
  ? '结论: 所有 ui11 静态断言通过（返回按钮一键回首页 + 封面统一策略 coverImage + 封面图上传 UI + 文案统一均已落地）。\n注意: 封面图上传后的真实渲染效果、返回按钮交互需在浏览器由用户最终确认。'
  : '结论: 存在失败项，需回修后再跑本脚本。');

process.exit(fail === 0 ? 0 : 1);
