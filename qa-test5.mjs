// ============================================================
// qa-test5.mjs — 本轮 5 处改动「最终验证」(Edward / QA)
// 运行: node qa-test5.mjs   (在 D:\Z\yige\forum-novel-editor\ 下)
// 环境: Node 内置能力，无第三方依赖
//
// 复用 qa-test3.mjs 的 DOM mock harness（El / makeDocument / vm eval），
// 对本轮 5 处改动逐条做 PASS/FAIL 行为验证：
//   改动1 设置面板「添加成员」按钮 margin-top:18px         → 测试3(bonus)
//   改动2 单聊自动用对方昵称 + newChat 不再预设「新聊天」   → 测试1/2
//   改动3 预览区标题栏纯装饰(无事件)                       → 测试4
//   改动4 删除聊天详情顶部整行返回栏(wx-navbar)             → 测试5
//   改动5 拉黑改为单条消息操作(气泡角标+拒收提示+菜单toggle)→ 测试6/7/8
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
// 增强版 DOM 模拟（与 qa-test3 一致）
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

function makeCtx(charW = 8) {
  let _font = '';
  return {
    set font(v) { _font = v; }, get font() { return _font; },
    measureText(s) { return { width: (s ? String(s).length : 0) * charW }; },
    fillText() {}, save() {}, restore() {}, clip() {}, beginPath() {},
    closePath() {}, arc() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    drawImage() {}, rect() {}, fillRect() {}, scale() {}, setTransform() {},
    textBaseline: '', textAlign: '', fillStyle: '', strokeStyle: '', lineWidth: 1
  };
}

// ---------- 在 vm 中加载全部被测符号 ----------
const sandbox = {
  document: makeDocument(),
  window: { matchMedia: () => ({ matches: false }), innerWidth: 1200, addEventListener() {}, __EMBED_PROJECT__: undefined },
  console,
  indexedDB: {},
  URL: { createObjectURL() {}, revokeObjectURL() {} },
  Blob: function () {},
  FileReader: function () {},
  Image: FakeImage,
  setTimeout: () => 0,
  clearTimeout: () => {}
};
sandbox.globalThis = sandbox;

const shim = `
;globalThis.__TEST__ = {
  newPickupProject, newChat, newMember, newMessage,
  chatDisplayName,
  renderChatInfoBody, buildChatDetailPreview, buildChatDetailEdit,
  buildMessageBubble,
  renderChatDetail, renderChatList,
  openBubbleMenu,
  state
};`;
const context = vm.createContext(sandbox);
vm.runInContext(js + shim, context, { filename: 'index-inline.js' });
const T = sandbox.__TEST__;
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
function findButton(root, label) {
  const all = []; walk(root, all);
  return all.find(n => n.tagName === 'button' && textOf(n).trim() === label)
      || all.find(n => n.tagName === 'button' && textOf(n).includes(label));
}
function findElByClass(root, cls) {
  const all = []; walk(root, all);
  return all.find(n => n.className && n.className.split(/\s+/).includes(cls));
}
function hasClassEl(root, cls) {
  const all = []; walk(root, all);
  return all.some(n => n.className && n.className.split(/\s+/).includes(cls));
}

// 重置 modal 容器，保证每次菜单从干净状态构建
function resetModal() { modalRoot.children = []; }

// 通用：构造一个含单聊的项目（供渲染/菜单类测试复用）
function setupChat() {
  const proj = T.newPickupProject();
  const chat = T.newChat('测试群');
  const me = chat.members.find(x => x.isMe);
  const other = chat.members.find(x => !x.isMe);
  proj.data.chats.push(chat);
  T.state.currentProject = proj;
  T.state.activeChatId = chat.id;
  T.state.activeSenderId = me.id;
  T.state.pickupView = 'chatlist';   // 避免菜单 toggle 的 afterMessageChange 触发真实渲染
  T.state.voiceOn = false;
  return { proj, chat, me, other };
}

// ============================================================
// 测试1) 单聊自动名 + newChat 不再预设「新聊天」
// ============================================================
console.log('\n[测试1 单聊自动名 / newChat 空名]');
{
  const single = T.newChat('x');           // 2 成员：我 / 对方
  const disp = T.chatDisplayName(single);
  check('T1-单聊名: chatDisplayName(单聊) === "对方"', disp === '对方', 'got ' + JSON.stringify(disp));
  check('T1-单聊结构: 恰 2 成员', single.members.length === 2, 'got ' + single.members.length);
  const nc = T.newChat('随便传参');
  check('T1-newChat: newChat(任意).name === "" (不再预设"新聊天")', nc.name === '', 'got ' + JSON.stringify(nc.name));
  check('T1-newChat: type === "single"', nc.type === 'single', 'got ' + nc.type);
}

// ============================================================
// 测试2) 群聊显示群名
// ============================================================
console.log('\n[测试2 群聊群名]');
{
  const group = T.newChat('测试群');        // 默认 2 成员、name:''
  group.name = '测试群';
  group.members.push(T.newMember('丙'));    // >=3 成员 → group
  group.type = 'group';
  const disp = T.chatDisplayName(group);
  check('T2-群聊名: chatDisplayName(群聊) === "测试群"', disp === '测试群', 'got ' + JSON.stringify(disp));
  check('T2-群聊结构: members.length >= 3', group.members.length >= 3, 'got ' + group.members.length);
  check('T2-群聊结构: type === "group"', group.type === 'group', 'got ' + group.type);
}

// ============================================================
// 测试3) 设置面板：单聊隐藏群名输入、群聊显示群名输入 + 改动1间距
// ============================================================
console.log('\n[测试3 设置面板 群名输入显隐 + 添加成员间距]');
{
  // —— 单聊：不应出现「群聊名称」label ——
  const bodyS = new El('div');
  const single = T.newChat('测试群');       // 2 成员
  T.renderChatInfoBody(bodyS, single, () => {}, true);
  let hasGroupLabelS = false;
  { const all = []; walk(bodyS, all); for (const n of all) if (n.tagName === 'label' && textOf(n).trim() === '群聊名称') hasGroupLabelS = true; }
  check('T3-单聊隐藏: DOM 不含「群聊名称」label', !hasGroupLabelS);

  // —— 群聊：应出现「群聊名称」label 且群名行内含 input ——
  const bodyG = new El('div');
  const group = T.newChat('测试群'); group.name = '测试群';
  group.members.push(T.newMember('丙'));
  group.type = 'group';
  T.renderChatInfoBody(bodyG, group, () => {}, true);
  let labelG = null;
  { const all = []; walk(bodyG, all); labelG = all.find(n => n.tagName === 'label' && textOf(n).trim() === '群聊名称') || null; }
  const nameRow = labelG ? labelG.parentNode : null;
  let hasNameInput = false;
  if (nameRow) { const c = []; walk(nameRow, c); hasNameInput = c.some(n => n.tagName === 'input'); }
  check('T3-群聊显示: DOM 含「群聊名称」label', !!labelG);
  check('T3-群聊显示: 群名行内含 input(群名输入)', hasNameInput);

  // —— 改动1: 「添加成员」按钮间距 margin-top:18px ——
  let addBtn = null;
  { const all = []; walk(bodyG, all); addBtn = all.find(n => n.tagName === 'button' && textOf(n).includes('添加成员')) || null; }
  check('T3-改动1: 添加成员按钮 style.cssText === "margin-top:18px"',
    !!addBtn && addBtn.style.cssText === 'margin-top:18px',
    'got ' + (addBtn ? JSON.stringify(addBtn.style) : 'no addBtn'));
}

// ============================================================
// 测试4) 预览栏纯装饰（无事件）/ 编辑栏对照（返回触发 pickupView）
// ============================================================
console.log('\n[测试4 预览栏装饰无事件 / 编辑栏对照]');
{
  setupChat();                                   // 保证 state.currentProject 等存在
  const barChat = T.newChat('测试群');           // 标题栏用 chatDisplayName

  // —— 预览栏 ——
  const previewWrap = T.buildChatDetailPreview(barChat);
  const barP = findElByClass(previewWrap, 'wx-detail-bar');
  check('T4-preview: 存在 .wx-detail-bar', !!barP);
  const backP = findButton(barP, '←');
  const gearP = findButton(barP, '⋯');
  check('T4-preview: 含返回「←」', !!backP);
  check('T4-preview: 含齿轮「⋯」(装饰)', !!gearP);
  check('T4-preview: 返回「←」无 click 监听', !backP._listeners.click || backP._listeners.click.length === 0);
  check('T4-preview: 齿轮「⋯」无 click 监听', !gearP._listeners.click || gearP._listeners.click.length === 0);
  // 点「←」不应改变 pickupView（无 listener）
  T.state.pickupView = 'chatdetail';
  backP.click();
  check('T4-preview: 点「←」不触发 pickupView 改变', T.state.pickupView === 'chatdetail', 'got ' + T.state.pickupView);

  // —— 编辑栏对照：返回「←」点击行为（桌面回到空三栏 / 移动回到 chatlist） ——
  const editWrap = T.buildChatDetailEdit(barChat);
  const barE = findElByClass(editWrap, 'wx-detail-bar');
  const backE = findButton(barE, '←');
  check('T4-edit对照: 存在 .wx-detail-bar 返回「←」', !!backE);
  check('T4-edit对照: 返回「←」有 click 监听', !!backE._listeners.click && backE._listeners.click.length > 0);
  function testBackE(label, width){
    sandbox.window.innerWidth = width;
    T.state.pickupView = 'chatdetail';
    T.state.activeChatId = (T.state.currentProject.data.chats[0] || {}).id || 'some-id';
    let threw = false;
    try { backE.click(); } catch (e) { threw = true; }   // renderPickup 在 mock 下安全；try/catch 兜底
    if (width >= 760){
      check('T4-edit对照['+label+'] 点「←」→ activeChatId 置空(桌面空三栏)', T.state.activeChatId === null,
        'got ' + T.state.activeChatId + (threw ? '(renderPickup 抛错)' : ''));
    } else {
      check('T4-edit对照['+label+'] 点「←」触发 pickupView="chatlist"', T.state.pickupView === 'chatlist',
        'got ' + T.state.pickupView + (threw ? '(renderPickup 抛错但 pickupView 已置位)' : ''));
    }
  }
  testBackE('桌面', 1200);
  testBackE('移动', 500);
  sandbox.window.innerWidth = 1200;
}

// ============================================================
// 测试5) renderChatDetail 无 wx-navbar / renderChatList 含 wx-navbar（源码+行为）
// ============================================================
console.log('\n[测试5 删除聊天详情整行返回栏]');
{
  // —— 源码级 ——
  const srcDetail = T.renderChatDetail.toString();
  const srcList = T.renderChatList.toString();
  check('T5-源码: renderChatDetail 函数体不含 "wx-navbar"', !srcDetail.includes('wx-navbar'));
  check('T5-源码: renderChatList 函数体含 "wx-navbar"', srcList.includes('wx-navbar'));

  // —— 行为级 ——
  const { chat } = setupChat();                  // 构造含 activeChat 的项目
  const contentD = new El('div');
  T.renderChatDetail(contentD);
  check('T5-行为: renderChatDetail 产出 DOM 无 .wx-navbar', !hasClassEl(contentD, 'wx-navbar'));

  const contentL = new El('div');
  T.renderChatList(contentL);
  check('T5-行为: renderChatList 产出 DOM 含 .wx-navbar', hasClassEl(contentL, 'wx-navbar'));
}

// ============================================================
// 测试6) 消息级拉黑渲染（拒收提示 + blocked 角标 + 原文本可见）
// ============================================================
console.log('\n[测试6 消息级拉黑渲染]');
{
  const { chat, other } = setupChat();
  const msg = T.newMessage({ type: 'text', senderId: other.id, text: '今晚一起吃饭吗' });
  msg.blocked = true;
  const node = T.buildMessageBubble(msg, { readonly: true, chat, onOp: null });

  const tip = findElByClass(node, 'wx-rejected-tip');
  check('T6-拒收提示: 存在 .wx-rejected-tip', !!tip);
  check('T6-拒收提示: 文本含「消息已发出，但被对方拒收了」',
    !!tip && textOf(tip).includes('消息已发出，但被对方拒收了'), 'got ' + (tip ? textOf(tip) : 'null'));

  const bubble = findElByClass(node, 'wx-bubble');
  check('T6-气泡角标: .wx-bubble 含 class "blocked"',
    !!bubble && (bubble.className || '').split(/\s+/).includes('blocked'), 'got ' + (bubble ? bubble.className : 'null'));

  check('T6-原文本: 节点文本含 msg.text(未隐藏消息内容)', textOf(node).includes(msg.text),
    'got ' + textOf(node));
}

// ============================================================
// 测试7) 气泡菜单 拉黑/取消拉黑 toggle（选项A 微信风）
// ============================================================
console.log('\n[测试7 气泡菜单 拉黑 toggle]');
{
  const { other } = setupChat();
  const chat = T.state.currentProject.data.chats[0];
  const msg = T.newMessage({ type: 'text', senderId: other.id, text: '在吗' });
  chat.messages.push(msg);

  // 拉黑
  resetModal();
  T.openBubbleMenu(msg);
  const lb = findButton(modalRoot, '拉黑');
  check('T7-拉黑: 存在「拉黑」按钮', !!lb);
  lb && lb.click();
  check('T7-拉黑: 点「拉黑」→ msg.blocked === true', msg.blocked === true, 'got ' + msg.blocked);

  // 取消拉黑
  resetModal();
  T.openBubbleMenu(msg);
  const ub = findButton(modalRoot, '取消拉黑');
  check('T7-取消拉黑: 存在「取消拉黑」按钮', !!ub);
  ub && ub.click();
  check('T7-取消拉黑: 点「取消拉黑」→ msg.blocked === false', msg.blocked === false, 'got ' + msg.blocked);
}

// ============================================================
// 测试8) 间距/拒收提示 CSS 样式存在
// ============================================================
console.log('\n[测试8 间距/拒收提示 CSS]');
{
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  const css = styleMatch ? styleMatch[1] : '';
  const rejRule = css.match(/\.wx-rejected-tip\s*\{[^}]*\}/);
  check('T8-CSS: .wx-rejected-tip 规则存在', !!rejRule);
  check('T8-CSS: .wx-rejected-tip 含 color:#b3b3b3', !!rejRule && rejRule[0].includes('color:#b3b3b3'),
    'got ' + (rejRule ? rejRule[0] : 'no rule'));

  const blockedRule = css.match(/\.wx-bubble\.blocked::after\s*\{[^}]*\}/);
  check('T8-CSS: .wx-bubble.blocked::after 规则存在', !!blockedRule);
  check('T8-CSS: .wx-bubble.blocked::after 含 background:#fa5151', !!blockedRule && blockedRule[0].includes('background:#fa5151'),
    'got ' + (blockedRule ? blockedRule[0] : 'no rule'));
}

// ============================================================
// 汇总
// ============================================================
console.log('\n========================================');
console.log('JS 语法检查: ' + (syntaxOk ? 'PASS' : 'FAIL'));
if (!syntaxOk) console.log(syntaxMsg);
console.log(`qa-test5 单测: 通过 ${pass} / 失败 ${fail}`);
if (fail) { console.log('失败项:'); fails.forEach(f => console.log('  - ' + f)); }
console.log('========================================');

const summary = { suite: 'qa-test5.mjs', syntaxOk, syntaxMsg, pass, fail, fails };
fs.writeFileSync(path.join(__dirname, '.qa-result5.json'), JSON.stringify(summary, null, 2));

process.exit(fail || !syntaxOk ? 1 : 0);
