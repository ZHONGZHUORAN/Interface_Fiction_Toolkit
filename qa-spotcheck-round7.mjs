// ============================================================
// qa-spotcheck-round7.mjs — 第七轮 8 项改动「针对性行为抽查」
// 运行: node qa-spotcheck-round7.mjs (在 D:\Z\yige\forum-novel-editor\ 下)
// 目的: 对第 5/6/7 项(及附带 8 项)做「运行时行为」双重验证。
//       不修改、不依赖 qa-test*.mjs，不影响其 297 项断言。
// 环境: Node 内置 vm，无第三方依赖；复用 qa-test3 的 DOM mock 思路。
// ============================================================
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// ---------- 提取内联 <script> ----------
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('ERROR: 未找到 <script> 块'); process.exit(2); }
const js = m[1];

// ---------- JS 语法检查 ----------
const tmpPath = path.join(__dirname, '.qa-script7.tmp.js');
fs.writeFileSync(tmpPath, js);
let syntaxOk = true, syntaxMsg = 'OK: 无语法错误';
try { execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' }); }
catch (e) { syntaxOk = false; syntaxMsg = (e.stderr ? e.stderr.toString() : String(e.message)); }
try { fs.unlinkSync(tmpPath); } catch (_) {}
console.log('语法检查: ' + (syntaxOk ? 'PASS' : 'FAIL') + ' — ' + syntaxMsg);

// ============================================================
// DOM 模拟（与 qa-test3 一致）
// ============================================================
class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.attributes = {};
    this.style = {}; this._class = ''; this._html = ''; this.nodeType = 1;
    this.parentNode = null; this._listeners = {}; this.value = '';
  }
  get className() { return this._class; }
  set className(v) { this._class = v || ''; }
  get classList() {
    const self = this;
    const set = () => new Set(self._class.split(/\s+/).filter(Boolean));
    return {
      add(c) { const s = set(); s.add(c); self._class = [...s].join(' '); },
      remove(c) { const s = set(); s.delete(c); self._class = [...s].join(' '); },
      toggle(c, force) { const s = set(); const has = s.has(c); const want = force === undefined ? !has : force; if (want) s.add(c); else s.delete(c); self._class = [...s].join(' '); return want; },
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
  return { width: 0, height: 0, getContext() { return { fillStyle: '', fillRect() {}, drawImage() {} }; }, toDataURL() { return 'COMPRESSED'; } };
}
function makeDocument() {
  return {
    readyState: 'loading',
    addEventListener() {},
    createElement(t) { if (t === 'canvas') return makeCanvas(); return new El(t); },
    createTextNode(t) { return { nodeType: 3, textContent: String(t), children: [] }; },
    getElementById(id) { if (!elements[id]) elements[id] = new El('div'); return elements[id]; },
    querySelectorAll() { return []; },
    documentElement: { outerHTML: '' },
    body: { appendChild() {} }
  };
}
const sandbox = {
  document: makeDocument(),
  window: { matchMedia: () => ({ matches: false }), innerWidth: 1200, addEventListener() {}, __EMBED_PROJECT__: undefined },
  console,
  indexedDB: {},
  URL: { createObjectURL() {}, revokeObjectURL() {} },
  Blob: function () {}, FileReader: function () {}, Image: FakeImage,
  setTimeout: () => 0, clearTimeout: () => {}
};
sandbox.globalThis = sandbox;

const shim = `
;globalThis.__TEST__ = {
  el, openModal, openBubbleMenu, addTimestamp, editTimestamp,
  renderPickup, isDesktop, buildChatItem, buildDetailBar,
  getActiveChat, chatDisplayName, state,
  newPickupProject, newChat, newMember, newMessage, normalizePickup,
  refreshChatDetail, renderChatDetail
};`;
const context = vm.createContext(sandbox);
vm.runInContext(js + shim, context, { filename: 'index-inline.js' });
const T = sandbox.__TEST__;
const modalRoot = sandbox.document.getElementById('modal-root');
const app = sandbox.document.getElementById('app');

// ---------- 测试框架 ----------
let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; fails.push(name + (detail ? (' — ' + detail) : '')); console.log('  FAIL  ' + name + (detail ? (' — ' + detail) : '')); }
}

// ---------- DOM 遍历辅助 ----------
function walk(node, out) { if (!node) return; out.push(node); if (node.children) for (const c of node.children) walk(c, out); }
function findAll(root) { const out = []; walk(root, out); return out; }
function findModal(root) {
  for (const n of findAll(root)) { if ((n._class || '').split(/\s+/).includes('modal')) return n; }
  return null;
}
function findButton(root, label) {
  for (const n of findAll(root)) { if (n.tagName === 'button' && (n.textContent || '').trim() === label) return n; }
  return null;
}
function findTextarea(root) { for (const n of findAll(root)) { if (n.tagName === 'textarea') return n; } return null; }
function hasClassAnywhere(root, cls) { return findAll(root).some(n => (n._class || '').split(/\s+/).includes(cls)); }
function hasTextAnywhere(root, txt) { return findAll(root).some(n => (n.textContent || '').includes(txt)); }

// ============================================================
// 测试 #7 — 弹窗绿色作用域（仅 pickup 加 .wx-modal-pickup）
// ============================================================
console.log('\n[#7 弹窗绿色作用域]');
function setupPickupProject() {
  const p = T.newPickupProject();
  p.title = '测试作品';
  const chat = T.newChat('小美');
  chat.name = '小美';
  const me = chat.members.find(x => x.isMe);
  const other = chat.members.find(x => !x.isMe);
  other.name = '小美';
  chat.messages = [ T.newMessage({ type: 'text', text: '在吗？', senderId: other.id }) ];
  p.data.chats = [chat];
  T.state.currentProject = p;
  T.state.activeChatId = chat.id;
  T.state.activeSenderId = me ? me.id : null;
  T.state.pickupView = undefined; // 避免 refreshChatDetail 触发重渲染
  return { p, chat, me, other };
}

// 7a) pickup 弹窗应带 wx-modal-pickup
modalRoot.innerHTML = '';
setupPickupProject();
let dummy = T.el('div', {}, '内容');
T.openModal(dummy);
let modal = findModal(modalRoot);
check('7a pickup 弹窗含 .wx-modal-pickup 类', !!modal && (modal._class || '').includes('wx-modal-pickup'), modal ? modal._class : 'no modal');

// 7b) forum 弹窗不应带 wx-modal-pickup（保持蓝色作用域）
modalRoot.innerHTML = '';
const forumP = T.newPickupProject ? null : null;
// 构造一个 forum 工程：借用 newPickupProject 后改 type 为 forum
const fp = T.newPickupProject(); fp.type = 'forum'; fp.data = { chats: [] };
T.state.currentProject = fp; T.state.activeChatId = null;
dummy = T.el('div', {}, '内容');
T.openModal(dummy);
modal = findModal(modalRoot);
check('7b forum 弹窗不含 .wx-modal-pickup 类（保持蓝）', !!modal && !(modal._class || '').includes('wx-modal-pickup'), modal ? modal._class : 'no modal');

// ============================================================
// 测试 #5 — 时间戳 添加 / 编辑 / 删除（经 openBubbleMenu）
// ============================================================
console.log('\n[#5 时间戳 添加/编辑/删除]');
modalRoot.innerHTML = '';
const ctx = setupPickupProject();
const chat5 = ctx.chat;
const msg5 = chat5.messages[0]; // 普通文本消息
check('5-前置 当前只有 1 条消息', chat5.messages.length === 1, 'len=' + chat5.messages.length);

// 5a) 无前置时间戳 -> 菜单出现「添加时间戳」
T.openBubbleMenu(msg5);
let menu = findModal(modalRoot);
let addBtn = findButton(menu, '添加时间戳');
let editBtn = findButton(menu, '编辑时间戳');
check('5a 菜单显示「添加时间戳」', !!addBtn);
check('5a 菜单尚无「编辑时间戳」', !editBtn);

// 5b) 点击「添加时间戳」-> 填值 -> 保存 -> 时间戳插入 msg 之前
modalRoot.innerHTML = '';
T.openBubbleMenu(msg5);
menu = findModal(modalRoot);
addBtn = findButton(menu, '添加时间戳');
check('5b 再次打开含「添加时间戳」', !!addBtn);
addBtn.click(); // 关闭菜单并打开 addTimestamp 弹窗
let addModal = findModal(modalRoot);
let ta = findTextarea(addModal);
check('5b addTimestamp 弹窗含 textarea', !!ta);
if (ta) {
  ta.value = '10:43';
  let saveBtn = findButton(addModal, '添加');
  check('5b addTimestamp 弹窗含「添加」按钮', !!saveBtn);
  if (saveBtn) saveBtn.click();
}
check('5b 时间戳已插入到 msg 之前', chat5.messages.length === 2 && chat5.messages[0].kind === 'timestamp' && chat5.messages[0].text === '10:43' && chat5.messages[1] === msg5,
  'msgs=' + JSON.stringify(chat5.messages.map(x => ({ kind: x.kind, text: x.text }))));

// 5c) 此时再开菜单 -> 应显示「编辑时间戳」而非「添加时间戳」
modalRoot.innerHTML = '';
T.openBubbleMenu(msg5);
menu = findModal(modalRoot);
addBtn = findButton(menu, '添加时间戳');
editBtn = findButton(menu, '编辑时间戳');
check('5c 菜单显示「编辑时间戳」', !!editBtn);
check('5c 菜单不再显示「添加时间戳」', !addBtn);

// 5d) 点击「编辑时间戳」-> 删除 -> 时间戳被移除
modalRoot.innerHTML = '';
T.openBubbleMenu(msg5);
menu = findModal(modalRoot);
editBtn = findButton(menu, '编辑时间戳');
check('5d 可打开「编辑时间戳」', !!editBtn);
editBtn.click(); // 关闭菜单并打开 editTimestamp 弹窗
let editModal = findModal(modalRoot);
let delBtn = findButton(editModal, '删除时间戳');
check('5d editTimestamp 弹窗含「删除时间戳」', !!delBtn);
if (delBtn) delBtn.click();
check('5d 时间戳已删除（恢复 1 条）', chat5.messages.length === 1 && chat5.messages[0] !== undefined && chat5.messages[0].kind !== 'timestamp',
  'len=' + chat5.messages.length);

// ============================================================
// 测试 #6 — 桌面横屏固定左侧会话列表（三栏 + active + 返回）
// ============================================================
console.log('\n[#6 桌面三栏 / active / 返回]');
// 6a) isDesktop 阈值
sandbox.window.innerWidth = 1200;
check('6a innerWidth=1200 -> isDesktop()=true', T.isDesktop() === true);
sandbox.window.innerWidth = 500;
check('6a innerWidth=500 -> isDesktop()=false', T.isDesktop() === false);
sandbox.window.innerWidth = 1200;

// 6b) 桌面 + 未选会话 -> 三栏：列表 + 两空态
app.innerHTML = '';
ctx.p.data.chats = [chat5];
T.state.currentProject = ctx.p;
T.state.activeChatId = null;
T.state.pickupView = undefined;
try {
  T.renderPickup();
  check('6b 桌面渲染含 .wx-shell', hasClassAnywhere(app, 'wx-shell'));
  check('6b 桌面渲染含 .wx-cols（三栏容器）', hasClassAnywhere(app, 'wx-cols'));
  check('6b 桌面渲染含 .wx-col-list（左列表）', hasClassAnywhere(app, 'wx-col-list'));
  check('6b 未选会话显示编辑空态', hasTextAnywhere(app, '选择一个聊天以开始编辑'));
  check('6b 未选会话显示预览空态', hasTextAnywhere(app, '选择一个聊天以预览'));
} catch (e) {
  check('6b 桌面三栏渲染不抛异常', false, String(e && e.stack || e));
}

// 6c) 桌面 + 已选会话 -> 三栏：列表 + 编辑(wx-chatdetail) + 预览(wx-chatdetail)
app.innerHTML = '';
T.state.activeChatId = chat5.id;
try {
  T.renderPickup();
  const chatDetails = findAll(app).filter(n => (n._class || '').split(/\s+/).includes('wx-chatdetail'));
  check('6c 已选会话渲染两个 .wx-chatdetail（编辑+预览）', chatDetails.length === 2, 'count=' + chatDetails.length);
  check('6c 编辑列含输入栏 .wx-input', hasClassAnywhere(app, 'wx-input'));
  check('6c 编辑列含详情栏 .wx-detail-bar', hasClassAnywhere(app, 'wx-detail-bar'));
} catch (e) {
  check('6c 已选会话三栏渲染不抛异常', false, String(e && e.stack || e));
}

// 6d) buildChatItem 选中项加 .active
T.state.activeChatId = chat5.id;
let itemActive = T.buildChatItem(chat5);
check('6d 选中项 buildChatItem 含 .active', (itemActive._class || '').includes('active'));
T.state.activeChatId = '__none__';
let itemInactive = T.buildChatItem(chat5);
check('6d 未选中项 buildChatItem 不含 .active', !(itemInactive._class || '').includes('active'));

// 6e) 详情栏返回按钮：桌面下置 activeChatId=null 并重渲染
T.state.activeChatId = chat5.id;
sandbox.window.innerWidth = 1200; // 桌面
let bar = T.buildDetailBar(chat5, 'edit');
let backBtn = findButton(bar, '←');
check('6e 详情栏含返回按钮「←」', !!backBtn);
if (backBtn) {
  backBtn.click();
  check('6e 桌面点返回 -> activeChatId=null', T.state.activeChatId === null, 'activeChatId=' + T.state.activeChatId);
}
sandbox.window.innerWidth = 500; // 复位为手机

// ============================================================
// 汇总
// ============================================================
console.log('\n========================================');
console.log('第七轮针对性行为抽查: 通过 ' + pass + ' / 失败 ' + fail);
if (fail > 0) { console.log('失败项:'); fails.forEach(f => console.log('  - ' + f)); }
console.log('========================================');
process.exit(fail > 0 ? 1 : 0);
