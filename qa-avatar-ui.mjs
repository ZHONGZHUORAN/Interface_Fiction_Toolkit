// ============================================================================
// qa-avatar-ui.mjs
// 单文件小说编辑器 —— 四处 UI 细节修复的独立回归测试：
//   1) 保存按钮横排（.account-row .btn 不再被挤压成竖排）
//   2) 同步状态前加绿色在线圆点（.account-sync-status-wrap / .account-sync-dot）
//   3) 头像在线圆点移到头像圆外（.account-btn overflow:visible + .account-online top/right:-2px）
//   4) 默认头像改为蓝色（avatarBgColor('') 返回 #3b82f6；已设用户名仍返回 HSL）
//   5) 回归：登录后 #account-btn 含首字母彩底 + 绿点；删/建项目多次重渲染后仍在
//   6) 回归：旧 #sync-bar 节点仍不存在
//
// 测试策略（复用 qa-account-panel.mjs / qa-newproj-bugfix.mjs 的 vm 沙箱范式）：
//   用 Node `vm` 加载 index.html 里【真实的两段 <script> 代码】，在受控沙箱中运行
//   （不复制业务函数，测的是真代码）。提供轻量 DOM/localStorage 桩 + fake Supabase 客户端
//   （getSb() 默认 online 返回 fake client）。全程 fake Supabase + 内存 DOM/localStorage 桩。
//
// 运行：C:\Users\zhh50\.workbuddy\binaries\node\versions\22.22.2\node.exe qa-avatar-ui.mjs
// 退出码 0 表示全部通过。
// ============================================================================

import * as vm from 'node:vm';
import { readFileSync } from 'node:fs';

const HTML_PATH = 'D:/Z/yige/forum-novel-editor/index.html';

// ---------------------------------------------------------------------------
// 1) 读取 HTML 并提取两个 <script> 块（真实交付物，不复制函数）
// ---------------------------------------------------------------------------
let html;
try {
  html = readFileSync(HTML_PATH, 'utf8');
} catch (e) {
  console.error('无法读取 index.html：', e.message);
  process.exit(2);
}
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (blocks.length !== 2) {
  console.error(`期望提取到 2 个 script 块，实际 ${blocks.length} 个`);
  process.exit(2);
}
const [script1, script2Raw] = blocks;
// 将动态 import() 替换为沙箱内的 __import 桩（仅改导入名，被测逻辑一行未动）
const script2 = script2Raw.replace(/\bimport\(/g, '__import(');

// ---------------------------------------------------------------------------
// 2) Fake Supabase 客户端（auth 相关方法 + onAuthStateChange 回调支持）
// ---------------------------------------------------------------------------
function makeFakeClient() {
  const authCalls = [];
  let responder = (op) => ({ data: null, error: null });
  const client = {
    __authCalls: authCalls,
    __setResponder(fn) { responder = fn; },
    channel() { return { on() { return this; }, subscribe() { return Promise.resolve(); }, unsubscribe() {} }; },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({ data: { session: {}, user: {} }, error: null }),
      signUp: async () => ({ data: { session: null, user: {} }, error: null }),
      signOut: async () => {
        const cb = client.auth.__authCb;
        if (typeof cb === 'function') cb('SIGNED_OUT', null);
        return { error: null };
      },
      resetPasswordForEmail: async () => ({ error: null }),
      onAuthStateChange: (cb) => { client.auth.__authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      getUser: async () => ({ data: { user: null }, error: null }),
      updateUser: async (updater) => { authCalls.push({ op: 'updateUser', args: [updater] }); return { data: {}, error: null }; }
    },
    from(table) {
      const self = this;
      const ops = [];
      const b = {
        _ops: ops,
        select() { ops.push(['select', [...arguments]]); return this; },
        insert() { ops.push(['insert', [...arguments]]); return this; },
        update() { ops.push(['update', [...arguments]]); return this; },
        upsert() { ops.push(['upsert', [...arguments]]); return this; },
        delete() { ops.push(['delete', [...arguments]]); return this; },
        eq() { ops.push(['eq', [...arguments]]); return this; },
        neq() { ops.push(['neq', [...arguments]]); return this; },
        order() { ops.push(['order', [...arguments]]); return this; },
        maybeSingle() { ops.push(['maybeSingle', []]); return this; },
        single() { ops.push(['single', []]); return this; },
        then(resolve, reject) {
          const kind = ops.some(o => o[0] === 'upsert') ? 'upsert'
            : ops.some(o => o[0] === 'insert') ? 'insert'
            : ops.some(o => o[0] === 'update') ? 'update'
            : ops.some(o => o[0] === 'delete') ? 'delete'
            : 'select';
          const op = { table, kind, hasMaybeSingle: ops.some(o => o[0] === 'maybeSingle'), ops: ops.map(o => [o[0], o[1]]) };
          if (kind === 'upsert' || kind === 'insert' || kind === 'update') { op.payload = ops.find(o => o[0] === kind)[1][0]; }
          self.__calls.push(op);
          let r;
          try { r = responder(op); } catch (e) { return Promise.reject(e); }
          return Promise.resolve(r).then(resolve, reject);
        }
      };
      return b;
    }
  };
  client.__calls = [];
  return client;
}
const FAKE = makeFakeClient();
// __import 桩：createClient 返回值由 sbReturn 控制（默认 online 返回 FAKE）
let sbReturn = FAKE;
const fakeModule = { createClient: () => sbReturn };

// ---------------------------------------------------------------------------
// 3) Faithful 轻量 DOM / 浏览器环境 stub（可遍历 + querySelector/All）
// ---------------------------------------------------------------------------
class TextNode {
  constructor(text) { this.nodeType = 3; this._text = String(text); this.parentNode = null; }
  get text() { return this._text; }
  set text(v) { this._text = String(v); }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
}
class Element {
  constructor(tag) {
    this.tagName = tag;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = {};
    this._class = '';
    this._classes = new Set();
    this.listeners = {};
    this.style = {};
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.files = [];
    this._text = '';
    this._innerHTML = '';
  }
  get className() { return this._class; }
  set className(v) {
    this._class = v || '';
    this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean));
  }
  get classList() {
    const self = this;
    return {
      add: c => self._classes.add(c),
      remove: c => self._classes.delete(c),
      toggle: (c, f) => { if (f === undefined) { self._classes.has(c) ? self._classes.delete(c) : self._classes.add(c); } else { f ? self._classes.add(c) : self._classes.delete(c); } },
      contains: c => self._classes.has(c)
    };
  }
  get id() { return this.attributes.id; }
  setAttribute(k, v) { this.attributes[k] = v; if (k === 'id') this.attributes.id = v; }
  getAttribute(k) { return (k in this.attributes) ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; }
  prepend(child) { child.parentNode = this; this.childNodes.unshift(child); return child; }
  removeChild(child) { const i = this.childNodes.indexOf(child); if (i >= 0) this.childNodes.splice(i, 1); child.parentNode = null; return child; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceWith(node) { if (this.parentNode) { const i = this.parentNode.childNodes.indexOf(this); if (i >= 0) { node.parentNode = this.parentNode; this.parentNode.childNodes[i] = node; } this.parentNode = null; } }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { const arr = this.listeners[type]; if (arr) { const i = arr.indexOf(fn); if (i >= 0) arr.splice(i, 1); } }
  click() { (this.listeners['click'] || []).forEach(fn => fn({ target: this, preventDefault() {}, stopPropagation() {} })); }
  fire(type, evObj) { (this.listeners[type] || []).forEach(fn => fn(evObj || { target: this })); }
  get textContent() {
    let out = '';
    const walk = (n) => {
      if (n instanceof TextNode) out += n.text;
      else if (n instanceof Element) { if (n._text) out += n._text; n.childNodes.forEach(walk); }
    };
    walk(this);
    return out;
  }
  set textContent(v) { this._text = String(v); this.childNodes = []; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; if (v === '') this.childNodes = []; }
  _match(sel) {
    if (sel.startsWith('#')) return this.attributes.id === sel.slice(1);
    if (sel.startsWith('.')) return this._classes.has(sel.slice(1));
    return this.tagName === sel;
  }
  querySelector(sel) { const found = this._findAll(sel); return found.length ? found[0] : null; }
  querySelectorAll(sel) { return this._findAll(sel); }
  _findAll(sel) {
    const res = [];
    const walk = (n) => {
      if (n instanceof Element) {
        if (n._match(sel)) res.push(n);
        n.childNodes.forEach(walk);
      }
    };
    this.childNodes.forEach(walk);
    return res;
  }
  _findById(id) {
    if (this.attributes.id === id) return this;
    for (const c of this.childNodes) {
      if (c instanceof Element) { const r = c._findById(id); if (r) return r; }
    }
    return null;
  }
  contains(node) { let cur = node; while (cur) { if (cur === this) return true; cur = cur.parentNode; } return false; }
  focus() {} select() {} containsNode() { return false; }
}

// 文档骨架：body 内含 modal-root（弹窗容器）、topbar、app（主内容）
const body = new Element('body');
const modalRoot = new Element('div'); modalRoot.setAttribute('id', 'modal-root');
const topbar = new Element('div'); topbar.className = 'topbar';
const appEl = new Element('div'); appEl.setAttribute('id', 'app');
body.appendChild(modalRoot); body.appendChild(topbar); body.appendChild(appEl);

const documentStub = {
  readyState: 'loading',
  body,
  createElement: (t) => new Element(t),
  createTextNode: (t) => new TextNode(t),
  getElementById: (id) => body._findById(id),
  querySelector: (sel) => body.querySelector(sel),
  querySelectorAll: (sel) => body.querySelectorAll(sel),
  addEventListener: () => {},
  removeEventListener: () => {}
};
const windowStub = { addEventListener: () => {}, removeEventListener: () => {}, innerWidth: 1200, location: { origin: 'http://localhost', pathname: '/' } };
const navigatorStub = { onLine: true };
const locationStub = { origin: 'http://localhost', pathname: '/' };

// FileReader 桩：readAsDataURL 同步设置 result 并触发 onload
function FakeFileReader() { this.result = null; this.onload = null; this.onerror = null; }
FakeFileReader.prototype.readAsDataURL = function () {
  this.result = 'data:image/png;base64,STUBAVATAR';
  if (typeof this.onload === 'function') this.onload();
};

const __store = {};
const localStorageStub = {
  getItem: (k) => (k in __store ? __store[k] : null),
  setItem: (k, v) => { __store[k] = String(v); },
  removeItem: (k) => { delete __store[k]; },
  clear: () => { for (const k in __store) delete __store[k]; }
};

const sandbox = {
  document: documentStub,
  window: windowStub,
  navigator: navigatorStub,
  location: locationStub,
  localStorage: localStorageStub,
  FileReader: FakeFileReader,
  console,
  setTimeout,
  clearTimeout,
  __import: async () => fakeModule
};
const ctx = vm.createContext(sandbox);

// ---------------------------------------------------------------------------
// 4) 运行真实代码
// ---------------------------------------------------------------------------
let loadError = null;
try {
  vm.runInContext(script1, ctx, { filename: 'script1.js' });
  vm.runInContext(script2, ctx, { filename: 'script2.js' });
} catch (e) {
  loadError = e;
}

// 用内存版 IndexedDB 替换真实 idb（Node 无 IndexedDB；这是测试桩而非改源码）
const mem = new Map();
ctx.idbGetAll = async () => [...mem.values()];
ctx.idbGet = async (id) => (mem.has(id) ? mem.get(id) : null);
ctx.idbPut = async (p) => { mem.set(p.id, p); };
ctx.idbDelete = async (id) => { mem.delete(id); };

// ---------------------------------------------------------------------------
// 5) 测试工具
// ---------------------------------------------------------------------------
const ev = (code) => vm.runInContext(code, ctx, { filename: 'test.js' });
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const setState = (obj) => ev('Object.assign(state, ' + JSON.stringify(obj) + ')');

// 在线/离线模式切换（控制 getSb 的返回值；默认 online）
function setSb(mode) {
  sbReturn = (mode === 'online') ? FAKE : null;
  ev('__sb=null; __sbFailed=false; __sbPromise=null;');
}

function findBtnByText(root, text) {
  return root.querySelectorAll('button').find(b => (b.textContent || '').trim() === text) || null;
}
function resetDom() {
  modalRoot.childNodes.length = 0;
  topbar.childNodes.length = 0;
  appEl.childNodes.length = 0;
  const keep = new Set([modalRoot, topbar, appEl]);
  body.childNodes = body.childNodes.filter(n => keep.has(n));
  ev('__loginOverlay = null;');
  ev('__toastEl = null;');
  ev('__accountPanelSync = null;');
  localStorageStub.clear();
  FAKE.__authCalls.length = 0;
}
function makeProject(id, title) {
  return {
    id: id, title: title || ('项目' + id), type: 'forum', createdAt: 1000, updatedAt: 1000,
    data: { coverImage: null, cover: { title: '', body: '', images: [], author: '', avatar: null }, floors: [], settings: { showTime: false, pageRatio: '9:16', pageHeightPx: null } }
  };
}

// CSS 规则提取：从 <style> 文本中按选择器取出整条声明块（不嵌套花括号，[^{]*} 即可）
function cssRule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = html.match(new RegExp(esc + '\\{[^}]*\\}'));
  return m ? m[0] : null;
}
function getPanel() { return documentStub.querySelector('.account-panel'); }

const results = [];
function assert(name, cond, detail) {
  const pass = !!cond;
  results.push({ name, pass, detail: detail || '' });
  if (!pass) console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''));
  else console.log('  ✓ ' + name);
}
async function test(name, fn) {
  console.log('\n▶ ' + name);
  try { await fn(); }
  catch (e) { assert(name + '（未抛异常）', false, '抛出异常: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
}

// ---------------------------------------------------------------------------
// 6) 测试用例
// ---------------------------------------------------------------------------
if (loadError) {
  assert('脚本加载不抛未捕获异常', false, String(loadError && loadError.stack || loadError));
} else {

  // 初始化真实 augmentState + wrapRender，建立贴近真实的运行环境
  try { ev('augmentState(); wrapRender();'); }
  catch (e) { assert('augmentState + wrapRender 初始化不抛错', false, String(e)); }

  // ---------------- 1. 保存按钮横排（改动 #1）----------------
  await test('1-保存按钮横排-account-row内btn不竖排', async () => {
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: null, userEmail: null, offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('renderHome()');
    await tick();

    ev('openAccountPanel()');
    await tick();
    const panel = getPanel();
    assert('1: 打开面板后 DOM 含账号面板节点（.account-panel）', !!panel);

    const saveBtn = findBtnByText(panel, '保存');
    assert('1: 面板含「保存」按钮', !!saveBtn);
    assert('1: 「保存」按钮文本为「保存」', saveBtn && (saveBtn.textContent || '').trim() === '保存');
    assert('1: 「保存」按钮带有 .btn 类（位于 .account-row 内）', saveBtn && saveBtn._classes.has('btn'));
    const row = saveBtn ? saveBtn.parentNode : null;
    assert('1: 「保存」按钮的父节点是 .account-row', !!row && row._classes.has('account-row'));

    // CSS 规则断言（颜色字面量在 <style> 中）
    const rule = cssRule('.account-row .btn');
    assert('1: 源码 CSS 含规则 .account-row .btn{ white-space:nowrap; flex:0 0 auto; }',
      !!rule && rule.includes('white-space:nowrap') && rule.includes('flex:0 0 auto'),
      rule || '未找到 .account-row .btn 规则');
  });

  // ---------------- 2. 同步状态前加绿色在线圆点（改动 #2）----------------
  await test('2-同步状态绿点-容器含dot且CSS为绿色', async () => {
    resetDom();
    setSb('online');
    // 登录 + 在线 + 已同步：syncStatusText() 应为「在线 · 已同步」
    setState({ view: 'home', projects: [], userId: 'u1', userEmail: 'a@b.com', offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('renderHome()');
    await tick();

    ev('openAccountPanel()');
    await tick();
    const panel = getPanel();
    assert('2: 打开面板后 DOM 含账号面板节点', !!panel);

    const wrap = panel.querySelector('.account-sync-status-wrap');
    assert('2: 同步状态容器 .account-sync-status-wrap 存在', !!wrap);
    const dot = wrap ? wrap.querySelector('.account-sync-dot') : null;
    assert('2: 同步状态容器含子元素 span.account-sync-dot', !!dot);

    // CSS 颜色字面量断言
    const dotRule = cssRule('.account-sync-dot');
    assert('2: CSS .account-sync-dot 规则含 background:#2ba24a（绿色）',
      !!dotRule && dotRule.includes('background:#2ba24a'),
      dotRule || '未找到 .account-sync-dot 规则');

    // 文本等于 syncStatusText() 当前返回值
    const textSpan = panel.querySelector('.account-sync-text');
    const expected = ev('syncStatusText()');
    assert('2: syncStatusText() 当前返回「在线 · 已同步」', expected === '在线 · 已同步', '实际: ' + expected);
    assert('2: .account-sync-text 文本等于 syncStatusText()', textSpan && textSpan.textContent === expected);

    // refreshAccountPanelSync() 只更新 status.textContent，不应覆盖/移除圆点
    const dotBefore = wrap.querySelector('.account-sync-dot');
    ev('refreshAccountPanelSync()');
    await tick();
    const dotAfter = wrap.querySelector('.account-sync-dot');
    assert('2: refreshAccountPanelSync() 后仍保留绿点（未被移除/重建）', !!dotAfter && dotAfter === dotBefore);
    assert('2: refreshAccountPanelSync() 后文本仍等于 syncStatusText()', textSpan && textSpan.textContent === ev('syncStatusText()'));
  });

  // ---------------- 3. 头像在线圆点移到头像圆外（改动 #3）----------------
  await test('3-在线圆点在头像外-CSSoverflow与定位', async () => {
    // CSS 规则断言（无需 DOM 渲染）
    const btnRule = cssRule('.account-btn');
    assert('3: CSS .account-btn 规则含 overflow:visible（圆点可溢出到圆外）',
      !!btnRule && btnRule.includes('overflow:visible'),
      btnRule || '未找到 .account-btn 规则');

    const onlineRule = cssRule('.account-online');
    assert('3: CSS .account-online 规则含 top:-2px',
      !!onlineRule && onlineRule.includes('top:-2px'),
      onlineRule || '未找到 .account-online 规则');
    assert('3: CSS .account-online 规则含 right:-2px',
      !!onlineRule && onlineRule.includes('right:-2px'),
      onlineRule || '未找到 .account-online 规则');
    // 顺带确认离线灰点也移到了圆外（同定位）
    const offRule = cssRule('.account-offline-dot');
    assert('3: CSS .account-offline-dot 规则也含 top:-2px; right:-2px',
      !!offRule && offRule.includes('top:-2px') && offRule.includes('right:-2px'),
      offRule || '未找到 .account-offline-dot 规则');

    // 集成验证：登录后首页按钮内含 .account-online 圆点
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: 'u1', userEmail: 'a@b.com', offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('renderHome()');
    await tick();
    const btn = documentStub.getElementById('account-btn');
    assert('3: 登录态 #account-btn 存在', !!btn);
    assert('3: 登录态 #account-btn 内含 .account-online 圆点', btn && !!btn.querySelector('.account-online'));
  });

  // ---------------- 4. 默认头像改为蓝色（改动 #4）----------------
  await test('4-默认头像蓝色-avatarBgColor空种子返回蓝', async () => {
    // 直接验证函数契约：空种子返回蓝色字面量
    const emptyColor = ev('avatarBgColor("")');
    assert('4: avatarBgColor("") 返回 "#3b82f6"（蓝色默认）', emptyColor === '#3b82f6', '实际: ' + emptyColor);

    // 已设用户名仍返回 HSL 彩色（哈希）
    const hslColor = ev('avatarBgColor("张三")');
    assert('4: avatarBgColor("张三") 以 "hsl(" 开头（保留彩色哈希）', typeof hslColor === 'string' && hslColor.startsWith('hsl('), '实际: ' + hslColor);

    // 空种子不应返回 HSL（确认确实走蓝色分支）
    assert('4: avatarBgColor("") 不返回 hsl（确认走蓝色分支）', emptyColor !== hslColor && !String(emptyColor).startsWith('hsl('));

    // 集成验证：登录但无用户名（localStorage 无 profile）时，首字母头像节点仍生成彩色 span（不回退成人像 SVG，无回归）
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: 'u1', userEmail: 'a@b.com', offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    const node = ev('accountAvatarNode("sm")');
    assert('4: accountAvatarNode("sm") 返回 span 元素', !!node && node.tagName === 'span');
    assert('4: 无用户名登录态返回首字母彩底 span（.account-initial，非人像 SVG）', node && node._classes.has('account-initial'));
    assert('4: 首字母 span 已设置非空背景色（彩色头像，无回归）', node && !!node.style.background,
      node ? ('background=' + node.style.background) : 'node=null');

    // 说明性观察（不计入失败）：无用户名但 email 存在时，getDisplayName() 仍回退为邮箱（见下条断言）；
    // 但 accountAvatarNode 现已在「无自定义用户名」时强制蓝色头像（见 4b 场景），不再回退为 email 哈希的 HSL。
    const dn = ev('getDisplayName()');
    assert('4: 无用户名时 getDisplayName() 回退为邮箱（"a@b.com"）', dn === 'a@b.com', '实际: ' + dn);
  });

  // ---------------- 4b. 补充：未设用户名登录态首字母头像强制蓝色（改动 #4 边界修复）----------------
  await test('4b-未设用户名登录态头像强制蓝色+对照彩色哈希', async () => {
    // 场景 A：已登录 + 清空 profile（无自定义用户名）→ 背景强制 #3b82f6
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: 'u1', userEmail: 'a@b.com', offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    localStorageStub.removeItem('fn_account_profile');   // 确保 getAccountProfile() 为 null
    const nodeA = ev('accountAvatarNode("sm")');
    assert('4b: 已登录无用户名 → accountAvatarNode("sm") 返回 .account-initial 首字母 span（非 SVG/非 img）',
      !!nodeA && nodeA.tagName === 'span' && nodeA._classes.has('account-initial'));
    assert('4b: 已登录无用户名 → 首字母 span 背景强制为 #3b82f6（蓝色）',
      !!nodeA && nodeA.style.background === '#3b82f6', nodeA ? ('background=' + nodeA.style.background) : 'node=null');

    // 场景 B（对照）：设自定义用户名后 → 背景回到 hsl 彩色哈希
    localStorageStub.setItem('fn_account_profile', JSON.stringify({ username: '张三' }));
    const nodeB = ev('accountAvatarNode("sm")');
    assert('4b: 设自定义用户名 → 仍返回 .account-initial 首字母 span',
      !!nodeB && nodeB.tagName === 'span' && nodeB._classes.has('account-initial'));
    assert('4b: 设自定义用户名 → 背景以 "hsl(" 开头（彩色哈希仍生效）',
      !!nodeB && typeof nodeB.style.background === 'string' && nodeB.style.background.startsWith('hsl('),
      nodeB ? ('background=' + nodeB.style.background) : 'node=null');
  });

  // ---------------- 5. 回归：登录后 #account-btn + 删建项目多次重渲染（改动 #5）----------------
  await test('5-回归-登录态按钮+删建重渲染后始终存在', async () => {
    resetDom();
    setSb('online');
    setState({ view: 'home', userId: 'u1', userEmail: 'a@b.com', offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });

    ev('render()');
    await tick();
    const btn0 = documentStub.getElementById('account-btn');
    assert('5: 登录态初始 render → #account-btn 存在', !!btn0);
    assert('5: #account-btn 含首字母彩底（.account-initial）', btn0 && !!btn0.querySelector('.account-initial'));
    assert('5: #account-btn 含在线绿点（.account-online）', btn0 && !!btn0.querySelector('.account-online'));

    setState({ projects: [makeProject('p1', '小说A')] });
    ev('render()'); await tick();
    assert('5: 新建项目后 render → #account-btn 存在', !!documentStub.getElementById('account-btn'));

    setState({ projects: [] });
    ev('render()'); await tick();
    assert('5: 删除项目后 render → #account-btn 存在', !!documentStub.getElementById('account-btn'));

    setState({ projects: [makeProject('p2', '小说B'), makeProject('p3', '小说C')] });
    ev('render()'); await tick();
    assert('5: 再次新建多个后 render → #account-btn 存在', !!documentStub.getElementById('account-btn'));

    setState({ projects: [makeProject('p3', '小说C')] });
    ev('render()'); await tick();
    assert('5: 再删除后 render → #account-btn 存在', !!documentStub.getElementById('account-btn'));

    let okAll = true;
    for (let i = 0; i < 3; i++) {
      setState({ projects: [makeProject('c' + i, '循环' + i)] });
      ev('render()'); await tick();
      if (!documentStub.getElementById('account-btn')) okAll = false;
    }
    assert('5: 连续 3 次删建重渲染循环后 #account-btn 始终存在（根治偶发消失 bug）', okAll);
  });

  // ---------------- 6. 回归：旧 #sync-bar 节点仍不存在（改动 #6）----------------
  await test('6-回归-旧sync-bar节点已移除', async () => {
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: 'u1', userEmail: 'a@b.com', offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('render()');
    await tick();
    ev('refreshSyncBar();');   // 登录态曾查找 #sync-bar，应安全 no-op
    await tick();
    assert('6: 渲染后全文件不再存在 #sync-bar 节点（getElementById 为 null）', documentStub.getElementById('sync-bar') === null);
    assert('6: 源码中无 id:"sync-bar" 创建节点', !/id:\s*['"]sync-bar['"]/.test(html));
  });
}

// ---------------------------------------------------------------------------
// 7) 汇总报告 + 路由判定
// ---------------------------------------------------------------------------
const total = results.length;
const passed = results.filter(r => r.pass).length;
const failed = total - passed;
const failedCases = results.filter(r => !r.pass);

console.log('\n==================================================');
console.log('# 回归测试报告 — 四处 UI 细节修复（头像/账号面板）');
console.log(`总断言: ${total} | 通过: ${passed} | 失败: ${failed}`);
if (loadError) console.log('加载阶段错误：已拦截未捕获异常（见上）。');
if (failed > 0) {
  console.log('\n失败明细：');
  failedCases.forEach(r => console.log(`  - ${r.name} ${r.detail ? '(' + r.detail + ')' : ''}`));
}

// 路由判定：源码 Bug → Engineer；测试代码问题 → QA 自查；全部通过 → NoOne
let routing, foundBug;
if (loadError) {
  routing = 'QA（加载/初始化阶段异常，疑似测试环境或桩问题，需排查沙箱）';
  foundBug = false;
} else if (failed > 0) {
  const coreFail = failedCases.some(r => r.name.startsWith('1:') || r.name.startsWith('2:') || r.name.startsWith('3:') || r.name.startsWith('4:') || r.name.startsWith('5:') || r.name.startsWith('6:'));
  routing = coreFail
    ? 'Engineer（核心场景失败：疑似源码 Bug，附失败断言与上下文待工程师排查）'
    : 'QA（非核心场景失败：疑似测试桩/断言问题，需修测试代码）';
  foundBug = coreFail;
} else {
  routing = 'NoOne（全部通过：确认 4 处改动有效，未引入回归）';
  foundBug = false;
}

console.log('\n路由判定: ' + routing);
console.log('是否发现源码 Bug: ' + (foundBug ? '是（见失败明细，待工程师核实）' : '否'));
console.log('==================================================');

const exitCode = failed > 0 ? 1 : 0;
process.exit(exitCode);
