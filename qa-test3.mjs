// ============================================================
// qa-test3.mjs — 「捡手机文学(pickup)」核心逻辑/状态测试
// 运行: node qa-test3.mjs   (在 D:\Z\yige\forum-novel-editor\ 下)
// 环境: Node 内置能力，无第三方依赖
//
// 复用 qa-test2.mjs 的 DOM mock 思路，但增强了：
//   - El.appendChild 设置 parentNode，remove() 可真正从父节点摘除
//     （使 openModal 的 closeFn 能清理 modal-root，菜单可反复重建）
//   - El 记录事件监听并支持 click() 触发（用于"点击"气泡操作菜单按钮）
//   - document.getElementById 对任意 id 返回持久 El（供 openModal 挂载）
//   - setTimeout/clearTimeout 置为 no-op，避免 scheduleSave 触发 IndexedDB
//
// 覆盖项（任务书 Section B 1~7）：
//   B1 数据工厂 newPickupProject/newChat/newMember/newMessage
//   B2 归一化 normalizePickup 补齐缺省字段
//   B3 旧 forum 数据兼容（无 type → forum）
//   B4 序列化往返 serialize/deserialize/normalizePickup 无损
//   B5 手动分页 splitByManualBreaks（breakAfter 切页 + 高度退化）
//   B6 状态转移（功能性）：撤回/拉黑/拍一拍/引用（经 openBubbleMenu）
//   B7 语音开关复位（sendFromInput 发语音后 voiceOn=false）
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
// 增强版 DOM 模拟
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
// 让 compressDataUrl 可被真实(同步)调用：Image 设置 src 即触发 onload；canvas 返回伪 toDataURL
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
    readyState: 'loading',            // 关键：阻止脚本末尾 init() 触发真实渲染
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
  setTimeout: () => 0,        // no-op：避免 scheduleSave 触发 IndexedDB
  clearTimeout: () => {}
};
sandbox.globalThis = sandbox;

const shim = `
;globalThis.__TEST__ = {
  newPickupProject, newChat, newMember, newMessage,
  normalizeProject, normalizePickup, normalizeChat, normalizeMember, normalizeMessage,
  serialize, deserialize,
  splitByManualBreaks, splitPages,
  sendFromInput, openBubbleMenu,
  state,
  PAGE_PAD, GAP, PAGE_W
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

// 重置 modal 容器，保证每次菜单从干净状态构建
function resetModal() { modalRoot.children = []; }

// ============================================================
// B1) 数据工厂
// ============================================================
console.log('\n[B1 数据工厂]');
{
  const p = T.newPickupProject();
  check('newPickupProject: type==="pickup"', p.type === 'pickup', 'got ' + p.type);
  check('newPickupProject: data.chats 空数组', Array.isArray(p.data.chats) && p.data.chats.length === 0);
  check('newPickupProject: data.settings 存在', !!p.data.settings);
  check('newPickupProject: 含 id/时间', !!p.id && typeof p.createdAt === 'number' && typeof p.updatedAt === 'number');

  const chat = T.newChat('某群');
  check('newChat: 单聊 name 默认空(自动取对方昵称)', chat.name === '');
  check('newChat: 默认 2 成员', chat.members.length === 2, 'got ' + chat.members.length);
  check('newChat: 恰一名 isMe', chat.members.filter(x => x.isMe).length === 1, 'got ' + chat.members.filter(x => x.isMe).length);
  check('newChat: 默认 type 由成员数推导(single)', chat.type === 'single');

  const mem = T.newMember('张三', false);
  check('newMember: name 正确', mem.name === '张三');
  check('newMember: isMe===false', mem.isMe === false);
  check('newMember: avatar===null', mem.avatar === null);
  check('newMember: blocked===false', mem.blocked === false);
  check('newMember: 字段齐全(id/name/avatar/isMe/blocked)', ['id', 'name', 'avatar', 'isMe', 'blocked'].every(k => k in mem));

  const msg = T.newMessage({ type: 'text', senderId: 'u1', text: 'hi' });
  check('newMessage: id 存在', !!msg.id);
  check('newMessage: time 为数字', typeof msg.time === 'number');
  check('newMessage: type/text/senderId 正确', msg.type === 'text' && msg.text === 'hi' && msg.senderId === 'u1');
  check('newMessage: withdrawn 默认 false', msg.withdrawn === false);
  check('newMessage: pageBreak 默认 false', msg.pageBreak === false);
  check('newMessage: isSystem 默认 false', msg.isSystem === false);
  check('newMessage: voice/quote/nudge 默认 null', msg.voice === null && msg.quote === null && msg.nudge === null);
}

// ============================================================
// B2) 归一化（缺省安全补齐）
// ============================================================
console.log('\n[B2 归一化 normalizePickup]');
{
  const dirty = {
    data: {
      settings: {},   // 缺 showTime/theme/pageRatio
      chats: [
        { name: '两人', members: [{ name: 'A' }, { name: 'B' }], messages: [{ type: 'text', text: 'x' }] },
        { name: '三人', members: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], messages: [{ type: 'img', image: { dataUrl: 'u' }, text: '' }] }
      ]
    }
  };
  const n = T.normalizePickup(dirty);
  check('normalizePickup: type==="pickup"', n.type === 'pickup');
  check('normalizePickup: settings.showTime 缺省补 true', n.data.settings.showTime === true, 'got ' + n.data.settings.showTime);
  check('normalizePickup: settings.theme 缺省 wechat', n.data.settings.theme === 'wechat');
  check('normalizePickup: settings.pageRatio 缺省 9:16', n.data.settings.pageRatio === '9:16');

  check('normalizePickup: 2人 chat.type=single', n.data.chats[0].type === 'single', 'got ' + n.data.chats[0].type);
  check('normalizePickup: 3人 chat.type=group', n.data.chats[1].type === 'group', 'got ' + n.data.chats[1].type);

  const m0 = n.data.chats[0].messages[0];
  check('normalizePickup: message.voice 缺省 null', m0.voice === null);
  check('normalizePickup: message.quote 缺省 null', m0.quote === null);
  check('normalizePickup: message.withdrawn 缺省 false', m0.withdrawn === false);
  check('normalizePickup: message.nudge 缺省 null', m0.nudge === null);
  check('normalizePickup: message.pageBreak 缺省 false', m0.pageBreak === false);
  check('normalizePickup: message.isSystem 缺省 false', m0.isSystem === false);

  const mem0 = n.data.chats[0].members[0];
  check('normalizePickup: member.blocked 缺省 false', mem0.blocked === false);
  check('normalizePickup: 无 isMe 时自动补一名 isMe', n.data.chats[0].members.filter(x => x.isMe).length === 1);
  check('normalizePickup: member.avatar 缺默认 null', mem0.avatar === null);
}

// ============================================================
// B3) 旧 forum 数据兼容（无 type）
// ============================================================
console.log('\n[B3 旧 forum 兼容]');
{
  const legacy = { title: '老小说', data: { cover: { title: 'T' }, floors: [{ content: 'x' }] } };
  const np = T.normalizeProject(legacy);
  check('normalizeProject(无type): type==="forum"', np.type === 'forum', 'got ' + np.type);
  check('normalizeProject(无type): forum 路径内嵌归一化', np.data && Array.isArray(np.data.floors) && np.data.floors.length === 1);
  check('normalizeProject: pickup 仍走 pickup 分支', T.normalizeProject({ type: 'pickup', data: { chats: [] } }).type === 'pickup');
}

// ============================================================
// B4) 序列化往返（导出 JSON 再导入无损）
// ============================================================
console.log('\n[B4 序列化往返]');
{
  const p = T.newPickupProject();
  const chat = T.newChat('测试群');
  const me = chat.members.find(x => x.isMe);
  const other = chat.members.find(x => !x.isMe);
  const m1 = T.newMessage({ type: 'text', senderId: other.id, text: '你好世界' });
  const m2 = T.newMessage({ type: 'voice', voice: { durationSec: 5, transcript: '语音内容' }, senderId: me.id });
  chat.messages.push(m1, m2);
  p.data.chats.push(chat);

  const json = T.serialize(p);
  check('serialize: 含 version 字段', JSON.parse(json).version === 1);
  const back = T.deserialize(json);
  const norm = T.normalizePickup(back);

  check('roundtrip: chats 数量保留', norm.data.chats.length === 1);
  check('roundtrip: members 数量保留', norm.data.chats[0].members.length === 2);
  check('roundtrip: messages 数量保留', norm.data.chats[0].messages.length === 2);

  const r1 = norm.data.chats[0].messages.find(x => x.text === '你好世界');
  check('roundtrip: 文本消息 type/senderId/text 一致', !!r1 && r1.type === 'text' && r1.senderId === other.id);
  const r2 = norm.data.chats[0].messages.find(x => x.type === 'voice');
  check('roundtrip: 语音消息 durationSec/transcript 一致', !!r2 && r2.voice.durationSec === 5 && r2.voice.transcript === '语音内容' && r2.senderId === me.id);
}

// ============================================================
// B5) 手动分页 splitByManualBreaks
// ============================================================
console.log('\n[B5 手动分页 splitByManualBreaks]');
{
  const measure = b => b.h;

  // 场景 A：第 2 块(id1)标 breakAfter → 该块作为当前页(页1)最后一条，其后另起一页；若无断点则 4 块可同页
  const blocksA = [
    { id: 0, h: 100 },
    { id: 1, h: 100, breakAfter: true },
    { id: 2, h: 100 },
    { id: 3, h: 100 }
  ];
  const pagesA = T.splitByManualBreaks(blocksA, 1000, measure);
  check('splitByManualBreaks: 有 breakAfter → 2 页', pagesA.length === 2, 'got ' + pagesA.length);
  check('splitByManualBreaks: 带 breakAfter 的块作为当前页末条(页1含 id0,id1)', pagesA[0].length === 2 && pagesA[0].map(b => b.id).join(',') === '0,1', 'got ' + JSON.stringify(pagesA[0].map(b => b.id)));
  check('splitByManualBreaks: 其余块落入页2', pagesA[1].length === 2 && pagesA[1].map(b => b.id).join(',') === '2,3', 'got ' + JSON.stringify(pagesA[1].map(b => b.id)));

  // 对照：去掉 breakAfter → 高度足够则 1 页（证明上面 2 页是断点所致，非高度）
  const blocksNoBreak = blocksA.map(b => { const c = Object.assign({}, b); delete c.breakAfter; return c; });
  const pagesNoBreak = T.splitByManualBreaks(blocksNoBreak, 1000, measure);
  check('splitByManualBreaks: 无断点且高度足够 → 1 页', pagesNoBreak.length === 1, 'got ' + pagesNoBreak.length);

  // 场景 B：无 breakAfter，高度不足 → 按 pageHeight 切（至少一页，且不丢块）
  const blocksB = [{ id: 0, h: 300 }, { id: 1, h: 300 }, { id: 2, h: 300 }];
  const pagesB = T.splitByManualBreaks(blocksB, 400, measure);
  check('splitByManualBreaks: 无断点高度不足 → 退化为按高度切(≥1页)', pagesB.length >= 1, 'got ' + pagesB.length);
  const allIds = pagesB.reduce((acc, pg) => acc.concat(pg.map(b => b.id)), []);
  check('splitByManualBreaks: 块总数不丢失', allIds.length === 3 && new Set(allIds).size === 3);

  // 场景 C：末端 breakAfter 不产生空页
  const blocksC = [{ id: 0, h: 100, breakAfter: true }, { id: 1, h: 100 }];
  const pagesC = T.splitByManualBreaks(blocksC, 1000, measure);
  check('splitByManualBreaks: 末端 breakAfter 不产生空页', pagesC.every(pg => pg.length > 0) && pagesC.reduce((a, p) => a + p.length, 0) === 2);
}

// ============================================================
// B6) 状态转移（功能性，经 openBubbleMenu 真实点击）
// ============================================================
console.log('\n[B6 状态转移: 撤回/拉黑/拍一拍/引用]');
function setupBubble() {
  resetModal();
  const p = T.newPickupProject();
  const chat = T.newChat('群');
  const me = chat.members.find(x => x.isMe);
  const other = chat.members.find(x => !x.isMe);
  const msg = T.newMessage({ type: 'text', senderId: other.id, text: '在吗' });
  chat.messages.push(msg);
  p.data.chats.push(chat);
  T.state.currentProject = p;
  T.state.activeChatId = chat.id;
  T.state.pickupView = 'chatlist';     // 避免 refreshChatDetail 触发真实渲染
  T.state.activeSenderId = me.id;
  T.state.pendingQuote = null;
  return { p, chat, me, other, msg };
}

// —— 撤回 / 恢复 ——
{
  const { msg } = setupBubble();
  T.openBubbleMenu(msg);
  const wbtn = findButton(modalRoot, '撤回');
  check('B6-撤回: 撤回按钮存在', !!wbtn);
  wbtn && wbtn.click();
  check('B6-撤回: msg.withdrawn===true', msg.withdrawn === true);
  // 重新打开（此时 withdrawn=true → 出现「恢复」）
  T.openBubbleMenu(msg);
  const rbtn = findButton(modalRoot, '恢复');
  check('B6-撤回: 恢复按钮存在(撤回后出现)', !!rbtn);
  rbtn && rbtn.click();
  check('B6-撤回: msg.withdrawn 可恢复为 false', msg.withdrawn === false);
}
// —— 拉黑 / 取消拉黑 ——
{
  const { other, msg } = setupBubble();
  T.openBubbleMenu(msg);
  const bbtn = findButton(modalRoot, '拉黑');
  check('B6-拉黑: 拉黑按钮存在', !!bbtn);
  bbtn && bbtn.click();
  check('B6-拉黑: msg.blocked===true', msg.blocked === true);
  T.openBubbleMenu(msg);
  const ubtn = findButton(modalRoot, '取消拉黑');
  check('B6-拉黑: 取消拉黑按钮存在(拉黑后出现)', !!ubtn);
  ubtn && ubtn.click();
  check('B6-拉黑: msg.blocked 可复位 false', msg.blocked === false);
}
// —— 拍一拍（插入系统消息） ——
{
  const { chat, me, other, msg } = setupBubble();
  T.openBubbleMenu(msg);
  const nbtn = findButton(modalRoot, '拍一拍');
  check('B6-拍一拍: 拍一拍按钮存在', !!nbtn);
  const before = chat.messages.length;
  nbtn && nbtn.click();
  const last = chat.messages[chat.messages.length - 1];
  check('B6-拍一拍: 插入了新消息', chat.messages.length === before + 1);
  check('B6-拍一拍: 新消息 isSystem===true', last.isSystem === true);
  check('B6-拍一拍: nudge 含 fromId/toId 且方向正确', !!last.nudge && last.nudge.fromId === me.id && last.nudge.toId === other.id,
    'got ' + (last.nudge ? JSON.stringify(last.nudge) : 'null'));
}
// —— 引用（pendingQuote 结构） ——
{
  const { msg } = setupBubble();
  T.openBubbleMenu(msg);
  const qbtn = findButton(modalRoot, '引用');
  check('B6-引用: 引用按钮存在', !!qbtn);
  qbtn && qbtn.click();
  check('B6-引用: pendingQuote.messageId===msg.id', T.state.pendingQuote && T.state.pendingQuote.messageId === msg.id);
  check('B6-引用: pendingQuote.snippet 为文本前40字', T.state.pendingQuote && T.state.pendingQuote.snippet === (msg.text || '').slice(0, 40));

  // 补充：直接构造 nudge 消息的数据结构正确性（与 openBubbleMenu 产出一致）
  const nm = T.newMessage({ type: 'system', nudge: { fromId: me_id(), toId: other_id() } });
  function me_id() { return 'M'; } function other_id() { return 'O'; }
  check('B6-拍一拍(结构): newMessage system + nudge 正确', nm.isSystem === true && nm.nudge.fromId === 'M' && nm.nudge.toId === 'O' && nm.type === 'system');
}

// ============================================================
// B7) 语音开关复位（sendFromInput 发语音后 voiceOn=false）
// ============================================================
console.log('\n[B7 语音开关复位]');
{
  const { chat } = setupBubble();
  T.state.voiceOn = true;
  T.state.pendingImages = [];
  T.state.pendingQuote = null;
  const ta = new El('textarea');
  ta.value = '这是语音转文字';
  T.sendFromInput(chat, ta);   // 进入语音分支 → 打开时长弹窗
  const ok = findButton(modalRoot, '确定');
  check('B7-语音: 时长弹窗「确定」按钮存在', !!ok);
  ok && ok.click();            // 触发回调 → 推送语音消息 + voiceOn=false
  check('B7-语音: 发送后 state.voiceOn 复位 false', T.state.voiceOn === false, 'got ' + T.state.voiceOn);
  const last = chat.messages[chat.messages.length - 1];
  check('B7-语音: 推送了语音消息(type=voice)', !!last && last.type === 'voice');
  check('B7-语音: 语音 durationSec>=1 且 transcript 正确', !!last && last.voice && last.voice.durationSec >= 1 && last.voice.transcript === '这是语音转文字',
    'got ' + (last && last.voice ? JSON.stringify(last.voice) : 'null'));

  // 源码级佐证：sendFromInput 在 voice 分支内确实存在 voiceOn=false 复位赋值
  const srcReset = /if\s*\(state\.voiceOn\)[\s\S]*?state\.voiceOn\s*=\s*false/.test(js);
  check('B7-语音: 源码含 voiceOn 复位赋值(if voiceOn … voiceOn=false)', srcReset);
}

// ============================================================
// B8) 图片发送路径（验证 compressDataUrl 已被 await）
//     工程师修复的 bug：原 sendFromInput 调用 compressDataUrl(返回 Promise) 未 await，
//     导致 image.dataUrl 为 Promise 而非压缩结果。此处用伪 Image/canvas 让压缩同步 resolve，
//     断言落库 dataUrl === 'COMPRESSED'（而非 Promise）。
// ============================================================
async function testImageSend() {
  const { chat } = setupBubble();
  T.state.voiceOn = false;
  T.state.pendingImages = [{ id: 'im1', dataUrl: 'RAW', name: 'a.png' }];
  T.state.pendingQuote = null;
  const ta = new El('textarea');
  ta.value = '';
  T.sendFromInput(chat, ta);          // 进入图片分支 → await compressDataUrl
  await new Promise(r => setImmediate(r));   // 等待 async IIFE 完成
  await new Promise(r => setImmediate(r));
  const last = chat.messages[chat.messages.length - 1];
  check('B8-图片: 推送了图片消息(type=image)', !!last && last.type === 'image', 'got ' + (last && last.type));
  check('B8-图片: 图片 dataUrl 为压缩结果(证明 await 生效, 非 Promise)',
    !!last && last.image && last.image.dataUrl === 'COMPRESSED' && last.image.dataUrl !== '[object Promise]',
    'got ' + (last && last.image ? String(last.image.dataUrl) : 'null'));
  check('B8-图片: 发送后 pendingImages 已清空', T.state.pendingImages.length === 0);
}
await testImageSend();

// ============================================================
// 汇总
// ============================================================
console.log('\n========================================');
console.log('JS 语法检查: ' + (syntaxOk ? 'PASS' : 'FAIL'));
if (!syntaxOk) console.log(syntaxMsg);
console.log(`pickup 单测: 通过 ${pass} / 失败 ${fail}`);
if (fail) { console.log('失败项:'); fails.forEach(f => console.log('  - ' + f)); }
console.log('========================================');

const summary = { suite: 'qa-test3.mjs', syntaxOk, syntaxMsg, pass, fail, fails };
fs.writeFileSync(path.join(__dirname, '.qa-result3.json'), JSON.stringify(summary, null, 2));

process.exit(fail || !syntaxOk ? 1 : 0);
