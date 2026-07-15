/**
 * qa-layout-ui11-verify.mjs
 * ui11 专项独立复核（QA 自行编写，与 qa-layout-ui11.mjs 互相印证）。
 * 使用 Node 内置正则 + 花括号配对扫描，从 index.html 的内联 JS 提取函数体做静态断言。
 * 不依赖产品源码运行，仅做静态结构断言；浏览器真实渲染效果不在本环境范畴。
 */
import { readFileSync } from 'node:fs';

const SRC = new URL('./index.html', import.meta.url);
const html = readFileSync(SRC, 'utf8');

let pass = 0, fail = 0;
const fails = [];

function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; fails.push(name); console.log(`  ❌ ${name}`); }
}

// 提取顶层函数体（尊重字符串字面量，避免误判花括号）
function extractFn(src, name) {
  const sig = 'function ' + name + '(';
  const start = src.indexOf(sig);
  if (start < 0) return null;
  let i = src.indexOf('{', start);
  if (i < 0) return null;
  let depth = 0, inStr = null, esc = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) { inStr = null; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return src.slice(start);
}

const renderPickup = extractFn(html, 'renderPickup');
const buildHomeCard = extractFn(html, 'buildHomeCard');
const buildThumbPlaceholder = extractFn(html, 'buildThumbPlaceholder');
const newProject = extractFn(html, 'newProject');
const newPickupProject = extractFn(html, 'newPickupProject');
const normalizeData = extractFn(html, 'normalizeData');
const normalizePickup = extractFn(html, 'normalizePickup');
const buildSettings = extractFn(html, 'buildSettings');
const buildPickupSettings = extractFn(html, 'buildPickupSettings');
const openNewProjectModal = extractFn(html, 'openNewProjectModal');

console.log('===== UI11 独立复核(verify) =====');

// 项1：renderPickup back 按钮 一键回首页
console.log('— 项1：返回列表一键回首页 —');
check('renderPickup 存在', !!renderPickup);
check("back 处理含 `isDesktop() || state.pickupView==='chatlist'` 直接 goHome()",
  !!renderPickup && /if\s*\(\s*isDesktop\(\)\s*\|\|\s*state\.pickupView\s*===\s*'chatlist'\s*\)\s*\{\s*goHome\(\)\s*;/.test(renderPickup));
check("仅移动端聊天详情页先回聊天列表（`state.pickupView='chatlist'`）",
  !!renderPickup && /else\s*\{\s*state\.pickupView\s*=\s*'chatlist'\s*;\s*renderPickup\(\)\s*;/.test(renderPickup));

// 项2：buildHomeCard 封面统一策略（优先 coverImage，不再用 chatAvatar）
console.log('— 项2：buildHomeCard 封面优先 coverImage —');
check('buildHomeCard 存在', !!buildHomeCard);
check('优先项目级 coverImage', !!buildHomeCard &&
  /p\.data\.coverImage\s*&&\s*p\.data\.coverImage\.dataUrl/.test(buildHomeCard));
check('非捡手机回退 cover.images[0]', !!buildHomeCard &&
  /!isPickup[\s\S]*p\.data\.cover\.images\s*&&\s*p\.data\.cover\.images\[0\]/.test(buildHomeCard));
check('不再引用 chatAvatar 作为封面来源', !!buildHomeCard && !/chatAvatar/.test(buildHomeCard));
check('不再调用 buildThumbChatPreview 作为封面', !!buildHomeCard && !/buildThumbChatPreview\s*\(/.test(buildHomeCard));

// 项3：buildThumbPlaceholder 捡手机分支 fallback 未命名捡手机，不调用 buildThumbChatPreview
console.log('— 项3：buildThumbPlaceholder 捡手机分支 —');
check('buildThumbPlaceholder 存在', !!buildThumbPlaceholder);
check("捡手机分支 fallback `p.title||'未命名捡手机'`", !!buildThumbPlaceholder &&
  /isPickup[\s\S]*p\.title\s*\|\|\s*'未命名捡手机'/.test(buildThumbPlaceholder));
check('不调用 buildThumbChatPreview', !!buildThumbPlaceholder && !/buildThumbChatPreview\s*\(/.test(buildThumbPlaceholder));

// 项4：项目级封面字段
console.log('— 项4：coverImage 字段 —');
check('newProject.data 含 coverImage:null', !!newProject && /coverImage\s*:\s*null/.test(newProject));
check('newPickupProject.data 含 coverImage:null', !!newPickupProject && /coverImage\s*:\s*null/.test(newPickupProject));
check('normalizeData 含 coverImage 处理（dataUrl 校验）',
  !!normalizeData && /coverImage\s*:\s*\(d\.coverImage\s*&&\s*d\.coverImage\.dataUrl\)\s*\?\s*d\.coverImage\s*:\s*null/.test(normalizeData));
check('normalizePickup 含 coverImage 处理（dataUrl 校验）',
  !!normalizePickup && /coverImage\s*:\s*\(d\.coverImage\s*&&\s*d\.coverImage\.dataUrl\)\s*\?\s*d\.coverImage\s*:\s*null/.test(normalizePickup));

// 项5：封面图上传 UI
console.log('— 项5：封面图上传 UI —');
// 说明：源码通过 el('input',{type:'file', accept:'image/*'}) 创建文件输入（非字面量 'input[type=file]' 选择器），
// 故断言以 `type:'file'`（el 属性）或 fileToDataURL 为准，避免正则过度严格产生误报。
check('buildSettings 含「项目封面图」文本', !!buildSettings && buildSettings.includes('项目封面图'));
check("buildSettings 含封面图上传（type:'file' 或 fileToDataURL）",
  !!buildSettings && (buildSettings.includes("type:'file'") || /input\[type=file\]/.test(buildSettings) || buildSettings.includes('fileToDataURL')));
check('buildPickupSettings 含「项目封面图」文本', !!buildPickupSettings && buildPickupSettings.includes('项目封面图'));
check("buildPickupSettings 含封面图上传（type:'file' 与 fileToDataURL）",
  !!buildPickupSettings && buildPickupSettings.includes("type:'file'") && buildPickupSettings.includes('fileToDataURL'));

// 项6：文案统一
console.log('— 项6：文案统一 —');
check('首页标题含「我的捡手机项目」', html.includes('我的捡手机项目'));
check('空状态含「还没有项目」', html.includes('还没有项目'));
check('已无旧首页标题「我的项目」', !html.includes("'我的项目'") && !html.includes('我的项目'));
check('已无旧空状态「还没有小说」', !html.includes('还没有小说'));

// 项7：新建弹窗
console.log('— 项7：新建弹窗按钮 —');
check('openNewProjectModal 存在', !!openNewProjectModal);
check('含「论坛体」按钮', !!openNewProjectModal && openNewProjectModal.includes('论坛体'));
check('含「聊天体」按钮', !!openNewProjectModal && openNewProjectModal.includes('聊天体'));
check('不含「论坛体小说」按钮文案（弹窗内）', !!openNewProjectModal && !openNewProjectModal.includes('论坛体小说'));
check('不含「捡手机文学」按钮文案（弹窗内）', !!openNewProjectModal && !openNewProjectModal.includes('捡手机文学'));

console.log(`\n===== UI11 独立复核(verify): ${pass} pass / ${fail} fail =====`);
if (fail) {
  console.log('失败项: ' + fails.join('; '));
  process.exit(1);
} else {
  console.log('结论: 独立复核全部通过 —— 返回按钮一键回首页 + 封面统一策略 coverImage + 封面图上传 UI + 文案统一均已落地。');
  console.log('注: 封面图上传后真实渲染、返回按钮交互(尤其 760px resize 边界)属浏览器真实渲染，需用户最终目检。');
  process.exit(0);
}
