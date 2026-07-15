// ============================================================
// qa-test4.mjs — 「捡手机文学(pickup)」三处 UI 修正 结构性/行为验证
// 运行: node qa-test4.mjs   (在 D:\Z\yige\forum-novel-editor\ 下)
// 环境: Node 内置能力，无第三方依赖
//
// 复用 qa-test3.mjs 的增强版 DOM mock（El 支持 parentNode / 事件监听 /
// click() 触发；getElementById 对任意 id 返回持久节点；setTimeout no-op），
// 并额外用 shim 包裹 openChatInfo / renderPickup 以捕获调用参数。
//
// 验证目标（工程师在 index.html 的三处修正）：
//   A) createNewChat 后先弹 openChatInfo(chat, true) 设置面板，保存/取消后才进详情
//   B) 聊天详情编辑区/预览区顶部加微信式标题栏 buildDetailBar（含 .wx-db-title）
//   C) 小三角从头像容器移到气泡：.wx-bubble.me::before(右缘绿) /
//      .wx-bubble.other::before(左缘白)；.wx-avatar 上无 ::before；.wx-tri 无残留
//
// 说明：A/C 为"真跑了"（调用函数 / 读取 <style> 文本断言）；B 为结构+文本核对
//      （buildChatDetailEdit/Preview 真实返回 DOM 并遍历断言）。
// ============================================================
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// ---------- 提取内联 <script> 内容 ----------
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('ERROR: 未找到 <script> 块'); process.exit(2); }
const js = m[1];

// ---------- JS 语法检查 (node --check) ----------
const tmpPath = path.join(__dirname, '.qa-script.tmp.js');
fs.writeFileSync(tmpPath, js);
let syntaxOk = true;
let syntaxMsg = 'OK: 无语法错误';
try {
  execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
} catch (e) {
  syntaxOk = false;
  syntaxMsg = (e.stderr ? e.stderr.toString() : String(e.message));
}
try { fs.unlinkSync(tmpPath); } catch (_) {}

// ============================================================
// 增强版 DOM 模拟（同 qa-test3.mjs）
// ============================================================
class El {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.style = {};
    this._class = '';
    this._html = '';
    this.nodeType = 1;
    this.parentNode = null;
    this._listeners = {};
    this.value = '';
  }
  get className() { return this._class; }
  set className(v) { this._class = v || ''; }
  get classList() {
    const self = this;
    const set = () => new Set(self._class.split(/\s+/).filter(Boolean));
    return {
      add(c) { const s = set(); s.add(c); self._class = [...s].join(' '); },
      remove(c) { const s = set(); s.delete(c); self._class = [...s].join(' '); },
      toggle(c, force) {
        const s = set(); const has = s.has(c);
        const want = force === undefined ? !has : force;
        if (want) s.add(c); else s.delete(c);
        self._class = [...s].join(' '); return want;
      },
      contains(c) { return set().has(c); }
    };
  }
  setAttribute(k, v) { this.attributes[k] = v; if (k === 'class') this._class = v; }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  click() { (this._listeners['click'] || []).forEach(fn => fn({ target: this })); }
  appendChild(c) { if (c) c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); if (c) c.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v; if (v === '') this.children = []; }
  get textContent() {
    let s = '';
    for (const c of this.children) {
      if (c && c.nodeType === 3) s += c.textContent;
      else if (c && c.nodeType === 1) s += c.textContent;
    }
    return s;
  }
  set textContent(v) { this._text = v; this.children = []; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }; }
  contains() { return false; }
}

const elements = {};
class FakeImage {
  constructor() { this.width = 100; this.height = 100; this.onload = null; this.onerror = null; this._src = ''; }
  set src(v) { this._src = v; if (this.onload) this.onload(); }
}
function makeCanvas() {
  return {
    width: 0, height: 0,
    getContext() { return { fillStyle: '', fillRect() {}, drawImage() {} }; },
    toDataURL() { return 'COMPRESSED'; }
  };
}
function makeDocument() {
  return {
    readyState: 'loading',            // 阻止脚本末尾 init() 触发真实渲染
    addEventListener() {},
    createElement(t) { if (t === 'canvas') return makeCanvas(); return new El(t); },
    createTextNode(t) { return { nodeType: 3, textContent: String(t), children: [] }; },
    getElementById(id) { if (!elements[id]) elements[id] = new El('div'); return elements[id]; },
    querySelectorAll() { return []; },
    documentElement: { outerHTML: '' },
    body: { appendChild() {} }
  };
}

// ---------- 在 vm 中加载被测符号 + 捕获包装 ----------
const sandbox = {
  document: makeDocument(),
  window: { matchMedia: () => ({ matches: false }), innerWidth: 1200, addEventListener() {}, __EMBED_PROJECT__: undefined },
  console,
  indexedDB: {},
  URL: { createObjectURL() {}, revokeObjectURL() {} },
  Blob: function () {},
  FileReader: function () {},
  Image: FakeImage,
  setTimeout: () => 0,        // no-op：避免 scheduleSave 触发 IndexedDB
  clearTimeout: () => {}
};
sandbox.globalThis = sandbox;

// 暴露被测符号；并用 shim 在顶层作用域内重新绑定 openChatInfo / renderPickup
// 以捕获调用参数（函数声明是可变绑定，运行时按名解析 → 包裹生效）。
const shim = `
;globalThis.__TEST__ = {
  createNewChat, openChatInfo, openChat,
  buildChatDetailEdit, buildChatDetailPreview, buildDetailBar,
  chatDisplayName, state,
  newChat, newPickupProject, newMember
};
;globalThis.__capture = { openChatInfoCalls: [], renderPickupCalls: 0 };
;(function(){
  const _origOCI = openChatInfo;
  openChatInfo = function(chat, isSetup){
    globalThis.__capture.openChatInfoCalls.push({ chat: chat, isSetup: isSetup });
    return _origOCI(chat, isSetup);
  };
  const _origRP = renderPickup;
  renderPickup = function(){
    globalThis.__capture.renderPickupCalls++;
    // 仅记录调用，不委托：避免重写整棵 DOM 影响测试隔离
  };
})();`;
const context = vm.createContext(sandbox);
vm.runInContext(js + shim, context, { filename: 'index-inline.js' });
const T = sandbox.__TEST__;
const CAP = sandbox.__capture;
const modalRoot = sandbox.document.getElementById('modal-root');

// ---------- 测试框架 ----------
let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; fails.push(name + (detail ? (' — ' + detail) : '')); console.log('  FAIL  ' + name + (detail ? (' — ' + detail) : '')); }
}

// ---------- DOM 遍历辅助 ----------
function walk(node, out) {
  if (!node) return;
  out.push(node);
  if (node.children) for (const c of node.children) walk(c, out);
}
function textOf(node) {
  let s = '';
  for (const c of (node.children || [])) {
    if (c && c.nodeType === 3) s += c.textContent;
    else if (c && c.nodeType === 1) s += textOf(c);
  }
  return s;
}
function findByClass(node, cls) {
  const all = []; walk(node, all);
  return all.filter(n => n.tagName && (n.className || '').split(/\s+/).includes(cls));
}
function findByTag(node, tag) {
  const all = []; walk(node, all);
  return all.filter(n => n.tagName === tag);
}
function findButton(root, label) {
  const all = []; walk(root, all);
  return all.find(n => n.tagName === 'button' && textOf(n).trim() === label)
      || all.find(n => n.tagName === 'button' && textOf(n).includes(label));
}
function resetModal() { modalRoot.children = []; }
function resetCapture() { CAP.openChatInfoCalls = []; CAP.renderPickupCalls = 0; }

// 提取全部 <style> 文本
const styleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(x => x[1]).join('\n');

// ============================================================
// A) 新建聊天先弹设置面板（createNewChat → openChatInfo(chat, true)）
// ============================================================
console.log('\n[A 创建先弹设置面板]');
{
  resetModal(); resetCapture();
  // 准备一个 pickup 工程，作为 createNewChat 的挂载点
  T.state.currentProject = T.newPickupProject();
  T.state.pickupView = 'chatlist';
  T.state.activeChatId = null;
  const beforeCount = T.state.currentProject.data.chats.length;

  // —— 真跑：调用新建入口 createNewChat() ——
  T.createNewChat();

  // 1) openChatInfo 被调用，且 isSetup === true（捕获到调用参数）
  check('A: openChatInfo 被调用 1 次', CAP.openChatInfoCalls.length === 1, 'got ' + CAP.openChatInfoCalls.length);
  check('A: openChatInfo 传入 isSetup=true', CAP.openChatInfoCalls.length === 1 && CAP.openChatInfoCalls[0].isSetup === true);
  const setupChat = CAP.openChatInfoCalls[0] && CAP.openChatInfoCalls[0].chat;
  check('A: openChatInfo 传入的 chat 已加入 chats', !!setupChat && T.state.currentProject.data.chats.includes(setupChat));

  // 2) 弹出的 modal 标题为「设置聊天信息」（证明走 isSetup 分支）
  const h3s = findByTag(modalRoot, 'h3');
  const setupTitle = h3s.find(h => textOf(h).trim() === '设置聊天信息');
  check('A: modal 含标题「设置聊天信息」', !!setupTitle, h3s.map(h => textOf(h)).join('|'));

  // 3) 仅 isSetup 时才有「保存并进入聊天」「取消」按钮
  const saveBtn = findButton(modalRoot, '保存并进入聊天');
  const cancelBtn = findButton(modalRoot, '取消');
  check('A: 含「保存并进入聊天」按钮(isSetup 专用)', !!saveBtn);
  check('A: 含「取消」按钮', !!cancelBtn);

  // 4) 未直接进入聊天详情：pickupView 仍是 chatlist，且未设置 activeChatId
  check('A: 未进入详情(pickupView 仍为 chatlist)', T.state.pickupView === 'chatlist', 'got ' + T.state.pickupView);
  check('A: 未设置 activeChatId(openChat 未触发)', T.state.activeChatId === null, 'got ' + T.state.activeChatId);

  // 5) chat 确实被创建并 push
  check('A: chats 数量 +1', T.state.currentProject.data.chats.length === beforeCount + 1,
    'before=' + beforeCount + ' after=' + T.state.currentProject.data.chats.length);

  // 6) 点击「保存并进入聊天」→ 才真正进入详情（onClose=openChat）
  if (saveBtn) {
    const targetChat = T.state.currentProject.data.chats[T.state.currentProject.data.chats.length - 1];
    saveBtn.click();
    check('A: 保存后才进入详情(pickupView=chatdetail)', T.state.pickupView === 'chatdetail', 'got ' + T.state.pickupView);
    check('A: 保存后 activeChatId 指向新 chat', T.state.activeChatId === targetChat.id, 'got ' + T.state.activeChatId);
  } else {
    check('A: 保存后才进入详情(pickupView=chatdetail)', false, '无保存按钮可点');
  }
}

// ============================================================
// B) 标题栏存在（buildChatDetailEdit / buildChatDetailPreview 含 .wx-detail-bar）
// ============================================================
console.log('\n[B 标题栏存在 .wx-detail-bar]');
{
  // 准备 project，保证 buildMessageBubble 读取 settings 不崩
  T.state.currentProject = T.newPickupProject();

  // —— 群聊（有 name）：标题显示群名 ——
  const groupChat = T.newChat('测试群');
  groupChat.type = 'group';
  groupChat.members.push(T.newMember('张三'));
  T.state.currentProject.data.chats.push(groupChat);

  const editNode = T.buildChatDetailEdit(groupChat);
  const prevNode = T.buildChatDetailPreview(groupChat);

  for (const [label, node] of [['编辑区', editNode], ['预览区', prevNode]]) {
    const bars = findByClass(node, 'wx-detail-bar');
    check('B[' + label + ']: 含 .wx-detail-bar 子节点', bars.length === 1, 'got ' + bars.length);
    const titleNode = bars[0] && findByClass(bars[0], 'wx-db-title')[0];
    const titleText = titleNode ? textOf(titleNode).trim() : '';
    const expected = T.chatDisplayName(groupChat);
    check('B[' + label + ']: .wx-db-title 文本 === chatDisplayName(群名)', titleText === expected,
      'got "' + titleText + '" expect "' + expected + '"');
  }

  // —— 单聊（无 name）：标题显示对方昵称 ——
  const singleChat = T.newChat('');     // newChat('') → name 回退 '新聊天'
  singleChat.name = '';                 // 显式清空 name 以走 other 昵称分支
  singleChat.members[1].name = '小美';  // 对方昵称
  T.state.currentProject.data.chats.push(singleChat);

  const editNode2 = T.buildChatDetailEdit(singleChat);
  const prevNode2 = T.buildChatDetailPreview(singleChat);
  for (const [label, node] of [['编辑区', editNode2], ['预览区', prevNode2]]) {
    const bars = findByClass(node, 'wx-detail-bar');
    const titleNode = bars[0] && findByClass(bars[0], 'wx-db-title')[0];
    const titleText = titleNode ? textOf(titleNode).trim() : '';
    const expected = T.chatDisplayName(singleChat);   // → '小美'
    check('B[' + label + '](单聊): .wx-db-title === 对方昵称「小美」', titleText === expected,
      'got "' + titleText + '" expect "' + expected + '"');
  }
  check('B: chatDisplayName(单聊无name) 返回对方昵称', T.chatDisplayName(singleChat) === '小美',
    'got ' + T.chatDisplayName(singleChat));
}

// ============================================================
// C) 齿轮与返回（.wx-db-gear → openChatInfo(chat,false)；.wx-db-back → 回 chatlist）
// ============================================================
console.log('\n[C 齿轮与返回]');
{
  T.state.currentProject = T.newPickupProject();
  const chat = T.newChat('齿轮测试群');
  T.state.currentProject.data.chats.push(chat);
  resetModal(); resetCapture();

  const bar = T.buildDetailBar(chat);
  const gear = findByClass(bar, 'wx-db-gear')[0];
  const back = findByClass(bar, 'wx-db-back')[0];

  check('C: 标题栏含 .wx-db-gear', !!gear);
  check('C: 标题栏含 .wx-db-back', !!back);

  // 齿轮点击 → openChatInfo(chat, false)
  if (gear) {
    gear.click();
    check('C: 齿轮点击触发 openChatInfo', CAP.openChatInfoCalls.length === 1, 'got ' + CAP.openChatInfoCalls.length);
    check('C: 齿轮点击传入 isSetup=false', CAP.openChatInfoCalls.length === 1 && CAP.openChatInfoCalls[0].isSetup === false);
    check('C: 齿轮点击传入同一 chat 对象', CAP.openChatInfoCalls.length === 1 && CAP.openChatInfoCalls[0].chat === chat);
    const infoTitle = findByTag(modalRoot, 'h3').map(h => textOf(h).trim());
    check('C: 齿轮打开「聊天信息（单聊）」(非设置)', infoTitle.includes('聊天信息（单聊）') || infoTitle.includes('聊天信息（群聊）'),
      infoTitle.join('|'));
  } else {
    check('C: 齿轮点击触发 openChatInfo', false, '无 .wx-db-gear');
  }

  // 返回点击 → 桌面端回到"未选中聊天"(activeChatId=null，重渲染三栏空态)；移动端回到 chatlist
  function testBack(label, width){
    sandbox.window.innerWidth = width;
    resetModal(); resetCapture();
    T.state.pickupView = 'chatdetail';    // 模拟当前在详情
    T.state.activeChatId = chat.id;
    const rpBefore = CAP.renderPickupCalls;
    if (back) back.click();
    if (width >= 760){
      check('C['+label+'] 桌面端返回 → activeChatId 置空(空三栏)', T.state.activeChatId === null, 'got ' + T.state.activeChatId);
    } else {
      check('C['+label+'] 移动端返回 → pickupView=chatlist', T.state.pickupView === 'chatlist', 'got ' + T.state.pickupView);
    }
    check('C['+label+'] 返回点击触发 renderPickup', CAP.renderPickupCalls === rpBefore + 1, 'got ' + CAP.renderPickupCalls);
  }
  testBack('桌面', 1200);
  testBack('移动', 500);
  sandbox.window.innerWidth = 1200;
}

// ============================================================
// D) 三角在气泡不在头像（CSS 文本核对）
// ============================================================
console.log('\n[D 三角在气泡不在头像 (CSS 核对)]');
{
  const meBlock = styleBlocks.match(/\.wx-bubble\.me::before\s*\{[^}]*\}/);
  const otherBlock = styleBlocks.match(/\.wx-bubble\.other::before\s*\{[^}]*\}/);

  check('D: 存在 .wx-bubble.me::before 规则', !!meBlock);
  if (meBlock) {
    const b = meBlock[0];
    check('D: me 三角在右缘 (right:-7px 或负 right)', /right:\s*-7px/.test(b) || /right:\s*-\d/.test(b), b);
    check('D: me 三角为绿色 (border-left + #95EC69)', /border-left/.test(b) && /#95EC69/i.test(b), b);
  }

  check('D: 存在 .wx-bubble.other::before 规则', !!otherBlock);
  if (otherBlock) {
    const b = otherBlock[0];
    check('D: other 三角在左缘 (left:-7px 或负 left)', /left:\s*-7px/.test(b) || /left:\s*-\d/.test(b), b);
    check('D: other 三角为白色 (border-right + #fff)', /border-right/.test(b) && /#fff/i.test(b), b);
  }

  // .wx-avatar 上无 ::before 三角选择器
  check('D: .wx-avatar 无 ::before 三角选择器', !/\.wx-avatar::before/.test(styleBlocks));
  // 进一步：.wx-avatar{...} 块内不含 ::before 三角（仅几何/圆角）
  const avatarBlock = styleBlocks.match(/\.wx-avatar\s*\{[^}]*\}/);
  check('D: .wx-avatar{...} 块内不含 ::before', !avatarBlock || !/::before/.test(avatarBlock[0]), avatarBlock ? avatarBlock[0] : 'n/a');

  // .wx-tri 在整个文件（JS+CSS）无残留
  const triMatches = [...html.matchAll(/wx-tri/gi)].map(x => x[0]);
  check('D: 全文件无 .wx-tri 残留引用', triMatches.length === 0, 'matches=' + triMatches.length);
}

// ============================================================
// E) 回归说明（qa-test3.mjs 75/75 独立运行验证，见任务运行步骤）
// ============================================================
console.log('\n[E 回归说明]');
{
  // qa-test4 与 qa-test3 是互相独立的文件，本文件新增的 shim 包裹不影响 qa-test3。
  // 真正回归验证在任务运行阶段单独跑 qa-test3.mjs（应 75/75）。此处仅冒烟验证
  // 本 harness 复用的 pickup 核心函数仍可正常构造（证明 mock 未破坏既有能力）。
  const p = T.newPickupProject();
  const c = T.newChat('回归群');
  check('E(冒烟): newPickupProject/newChat 可用', p.type === 'pickup' && c.name === '');
  check('E(冒烟): chatDisplayName(单聊) 返回对方昵称', T.chatDisplayName(c) === '对方');
}

// ============================================================
// 汇总
// ============================================================
console.log('\n========================================');
console.log('JS 语法检查: ' + (syntaxOk ? 'PASS' : 'FAIL'));
if (!syntaxOk) console.log(syntaxMsg);
console.log(`三处修正验证: 通过 ${pass} / 失败 ${fail}`);
if (fail) { console.log('失败项:'); fails.forEach(f => console.log('  - ' + f)); }
console.log('========================================');

const summary = { suite: 'qa-test4.mjs', syntaxOk, syntaxMsg, pass, fail, fails };
fs.writeFileSync(path.join(__dirname, '.qa-result4.json'), JSON.stringify(summary, null, 2));

process.exit(fail || !syntaxOk ? 1 : 0);
