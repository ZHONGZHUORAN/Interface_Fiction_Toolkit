// ============================================================================
// qa-avatar-round.mjs
// 单文件小说编辑器 —— 头像按钮「圆形」修复的独立回归测试：
//
//   被测改动：给 .account-initial CSS 规则追加 border-radius:50%，
//   解决 .account-btn 因 overflow:visible 导致内部蓝色首字母背景溢出、看起来是方形的问题。
//
// 测试策略（复用 qa-avatar-ui.mjs 的 vm 沙箱范式）：
//   用 Node `vm` 加载 index.html 里【真实的两段 <script> 代码】，在受控沙箱中运行
//   （不复制业务函数，测的是真代码）。提供轻量 DOM/localStorage 桩 + fake Supabase 客户端
//   （getSb() 默认 online 返回 fake client）。全程 fake Supabase + 内存 DOM/localStorage 桩。
//
// 覆盖点（≥6 条断言）：
//   1) 源码 <style> 文本中 .account-initial 规则含 border-radius:50%。
//   2) 渲染首页后 #account-btn 存在，且 .account-initial 元素携带 class account-initial
//      （其 CSS 规则含 border-radius:50%，即圆形）。
//   3) 渲染编辑器后 #editor-account-btn 存在，且 .account-initial 含圆角样式。
//   4) 登录态（state.userId='u1'; refreshAccountBtn()）后，.account-btn 仍为圆形
//      （.account-initial 仍存在且 CSS 圆角存在），且 .account-online 圆点存在
//      （确认 overflow:visible 未被改回）。
//   5) 旧 #sync-bar 节点不存在（无回归）。
//   6) 首页与编辑器头像按钮都能通过 querySelectorAll('.account-btn') 被 refreshAccountBtn 同时刷新。
//
// 运行：C:\Users\zhh50\.workbuddy\binaries\node\versions\22.22.2\node.exe qa-avatar-round.mjs
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

// 判断一个 .account-btn 内是否含有「圆形首字母」节点：
//   - 元素携带 class account-initial（其 CSS 声明 border-radius:50%）
//   - 且 .account-initial 源码规则确实含 border-radius:50%
// 说明：测试中无真实 CSS 引擎，computed style 不可用，故按任务允许「检查 class 字符串 + 源码规则」方式验证圆角。
function accountInitialRound(btn) {
  if (!btn) return { ok: false, el: null };
  const el = btn.querySelector('.account-initial');
  if (!el) return { ok: false, el: null };
  const hasClass = el._classes.has('account-initial');
  const rule = cssRule('.account-initial');
  const ruleHasRadius = !!rule && rule.includes('border-radius:50%');
  return { ok: hasClass && ruleHasRadius, el, hasClass, ruleHasRadius };
}

const LOGGED_IN = { view: 'home', projects: [], userId: 'u1', userEmail: 'a@b.com', offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null };

// ---------------------------------------------------------------------------
// 6) 测试用例
// ---------------------------------------------------------------------------
if (loadError) {
  assert('脚本加载不抛未捕获异常', false, String(loadError && loadError.stack || loadError));
} else {

  // 初始化真实 augmentState + wrapRender，建立贴近真实的运行环境
  try { ev('augmentState(); wrapRender();'); }
  catch (e) { assert('augmentState + wrapRender 初始化不抛错', false, String(e)); }

  // ---------------- 1. 源码 CSS 规则：.account-initial 含 border-radius:50% ----------------
  await test('1-源码CSS-.account-initial含border-radius:50%', async () => {
    const rule = cssRule('.account-initial');
    assert('1: 源码 <style> 含 .account-initial 规则', !!rule, rule || '未找到 .account-initial 规则');
    assert('1: .account-initial 规则含 border-radius:50%',
      !!rule && rule.includes('border-radius:50%'),
      rule || '未找到 .account-initial 规则');
    // 顺带确认 .account-btn 自身也是圆形，作为对照（修复前提：父级 overflow:visible 让首字母溢出）
    const btnRule = cssRule('.account-btn');
    assert('1: 对照 .account-btn 规则含 border-radius:50%',
      !!btnRule && btnRule.includes('border-radius:50%'),
      btnRule || '未找到 .account-btn 规则');
  });

  // ---------------- 2. 渲染首页后 #account-btn 含圆形首字母 ----------------
  await test('2-首页-#account-btn含圆形首字母', async () => {
    resetDom();
    setSb('online');
    // 登录态、无自定义头像：accountAvatarNode 返回 .account-initial 首字母 span
    localStorageStub.removeItem('fn_account_profile');
    setState(Object.assign({}, LOGGED_IN));
    ev('renderHome()');
    await tick();

    const btn = documentStub.getElementById('account-btn');
    assert('2: 渲染首页后 #account-btn 存在', !!btn);

    const r = accountInitialRound(btn);
    assert('2: #account-btn 内含 .account-initial 首字母元素', !!r.el);
    assert('2: .account-initial 元素携带 class account-initial', r.hasClass === true);
    assert('2: .account-initial 元素对应 CSS 规则含 border-radius:50%（圆形）', r.ruleHasRadius === true);
    assert('2: 综合判定 #account-btn 首字母为圆形（无方形溢出）', r.ok === true);
  });

  // ---------------- 3. 渲染编辑器后 #editor-account-btn 含圆形首字母 ----------------
  await test('3-编辑器-#editor-account-btn含圆形首字母', async () => {
    resetDom();
    setSb('online');
    localStorageStub.removeItem('fn_account_profile');
    // 编辑器视图需要一个有效 currentProject（renderEditor 读取 currentProject.title）
    setState(Object.assign({}, LOGGED_IN, {
      view: 'editor', editorKind: 'forum', mode: 'edit',
      currentProject: makeProject('e1', '测试小说')
    }));
    let threw = false;
    try { ev('renderEditor()'); }
    catch (e) { threw = true; /* 即便 renderEditorContent 抛错，#editor-account-btn 已在抛错前构建入 app */ }
    await tick();

    const btn = documentStub.getElementById('editor-account-btn');
    assert('3: 渲染编辑器后 #editor-account-btn 存在', !!btn,
      threw ? '（renderEditorContent 抛错，但按钮已在抛错前构建）' : '');

    const r = accountInitialRound(btn);
    assert('3: #editor-account-btn 内含 .account-initial 首字母元素', !!r.el);
    assert('3: .account-initial 元素携带 class account-initial', r.hasClass === true);
    assert('3: .account-initial 元素对应 CSS 规则含 border-radius:50%（圆形）', r.ruleHasRadius === true);
    assert('3: 综合判定 #editor-account-btn 首字母为圆形（无方形溢出）', r.ok === true);
  });

  // ---------------- 4. 登录态 refreshAccountBtn 后圆形 + 在线绿点（overflow:visible 未被改回）----------------
  await test('4-登录态refresh后圆形+在线绿点', async () => {
    resetDom();
    setSb('online');
    localStorageStub.removeItem('fn_account_profile');
    setState(Object.assign({}, LOGGED_IN));
    ev('refreshAccountBtn()');   // state.userId='u1'，直接刷新（按钮已 build 在 render 之前也可不依赖 render）
    // 先通过 render 建立首页按钮，再刷新一次，确保是刷新路径覆盖
    ev('renderHome()');
    await tick();
    ev('refreshAccountBtn()');
    await tick();

    const btn = documentStub.getElementById('account-btn');
    assert('4: 登录态 refreshAccountBtn 后 #account-btn 仍存在', !!btn);

    const r = accountInitialRound(btn);
    assert('4: 刷新后 #account-btn 仍含 .account-initial 圆形首字母', r.ok === true,
      r.el ? ('hasClass=' + r.hasClass + ', ruleHasRadius=' + r.ruleHasRadius) : '无 .account-initial');

    // 在线绿点存在 → 确认 .account-btn 的 overflow:visible 未被改回（否则绿点会被裁掉）
    assert('4: 登录态 #account-btn 内含 .account-online 在线绿点', btn && !!btn.querySelector('.account-online'));
    const btnRule = cssRule('.account-btn');
    assert('4: 源码 .account-btn 规则仍含 overflow:visible（未被改回，绿点方可溢出到圆外）',
      !!btnRule && btnRule.includes('overflow:visible'),
      btnRule || '未找到 .account-btn 规则');
  });

  // ---------------- 5. 回归：旧 #sync-bar 节点不存在 ----------------
  await test('5-回归-旧sync-bar节点已移除', async () => {
    resetDom();
    setSb('online');
    setState(Object.assign({}, LOGGED_IN));
    ev('render()');
    await tick();
    ev('refreshSyncBar();');   // 登录态曾查找 #sync-bar，应安全 no-op
    await tick();
    assert('5: 渲染后全文件不再存在 #sync-bar 节点（getElementById 为 null）', documentStub.getElementById('sync-bar') === null);
    assert('5: 源码中无 id:"sync-bar" 创建节点', !/id:\s*['"]sync-bar['"]/.test(html));
  });

  // ---------------- 6. 首页与编辑器头像按钮同时被 refreshAccountBtn 刷新 ----------------
  await test('6-两按钮同时被refreshAccountBtn刷新', async () => {
    resetDom();
    setSb('online');
    localStorageStub.removeItem('fn_account_profile');
    setState(Object.assign({}, LOGGED_IN));

    // 手动构建首页按钮与编辑器按钮（不同 id），同时挂到 app，模拟两者并存
    const homeBtn = ev('buildAccountBtn()');
    const editorBtn = ev('buildAccountBtn({id:"editor-account-btn"})');
    appEl.appendChild(homeBtn);
    appEl.appendChild(editorBtn);
    await tick();

    let beforeHome = accountInitialRound(homeBtn).ok;
    let beforeEditor = accountInitialRound(editorBtn).ok;
    assert('6: 前置——首页 #account-btn 含圆形首字母', beforeHome === true);
    assert('6: 前置——编辑器 #editor-account-btn 含圆形首字母', beforeEditor === true);

    // 关键：refreshAccountBtn 通过 querySelectorAll('.account-btn') 同时刷新两个按钮
    ev('refreshAccountBtn()');
    await tick();

    const allBtns = documentStub.querySelectorAll('.account-btn');
    assert('6: querySelectorAll(".account-btn") 能同时选中两个按钮（数量=2）', allBtns.length === 2,
      '实际数量=' + allBtns.length);

    const afterHome = accountInitialRound(homeBtn).ok;
    const afterEditor = accountInitialRound(editorBtn).ok;
    assert('6: 刷新后首页 #account-btn 仍含圆形首字母', afterHome === true);
    assert('6: 刷新后编辑器 #editor-account-btn 仍含圆形首字母', afterEditor === true);
    assert('6: 两个头像按钮均被 refreshAccountBtn 同时刷新（圆形无回归）',
      afterHome === true && afterEditor === true);
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
console.log('# 回归测试报告 — 头像按钮圆形修复（.account-initial border-radius:50%）');
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
  const coreFail = failedCases.some(r => /^([1-6]):/.test(r.name));
  routing = coreFail
    ? 'Engineer（核心场景失败：疑似源码 Bug，附失败断言与上下文待工程师排查）'
    : 'QA（非核心场景失败：疑似测试桩/断言问题，需修测试代码）';
  foundBug = coreFail;
} else {
  routing = 'NoOne（全部通过：确认 .account-initial 圆角修复有效，未引入回归）';
  foundBug = false;
}

console.log('\n路由判定: ' + routing);
console.log('是否发现源码 Bug: ' + (foundBug ? '是（见失败明细，待工程师核实）' : '否'));
console.log('==================================================');

const exitCode = failed > 0 ? 1 : 0;
process.exit(exitCode);
