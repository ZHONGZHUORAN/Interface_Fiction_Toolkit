// ============================================================================
// qa-account-panel.mjs
// 单文件小说编辑器 —— 「首页常驻头像按钮 + 账号管理面板」改动的独立回归测试。
//
// 测试策略（复用 qa-newproj-bugfix.mjs / qa-sync-test.mjs 的沙箱手法）：
//   用 Node `vm` 加载 index.html 中【真实的两段 <script> 代码】，在受控沙箱中运行
//   （不复制业务函数，测的是真代码）。
//   沙箱提供：
//     - faithful 轻量 DOM 实现（可遍历 + querySelector/All + getElementById）
//     - navigator / 内存版 localStorage
//     - __import 桩：createClient 返回值由 sbReturn 控制（FAKE=在线可用 / null=离线）
//     - fake Supabase 客户端（auth.signInWithPassword/signUp/signOut/onAuthStateChange/
//       updateUser/getSession/getUser/resetPasswordForEmail、from/channel/subscribe 等），
//       并支持 onAuthStateChange 回调节点、记录 updateUser 调用
//     - FileReader 桩（readAsDataURL 同步触发 onload）
//
// 覆盖场景（≥40 条结构化断言）：
//   1 初始未登录/online：renderHome 后 #account-btn 存在，按钮内为人像 SVG（无绿点）
//   2 模拟登录：state.userId 设值 + refreshAccountBtn → 首字母彩底 + 绿点(.account-online)
//   3 离线模式：state.offlineMode=true → 人像 + 灰点(.account-offline-dot)
//   4 删/建项目多次重渲染后 #account-btn 始终存在（核心历史 bug 回归）
//   5 打开面板 saveAccountPanel：保存用户名写入 localStorage fn_account_profile.username；
//     getDisplayName 返回新名；面板 .account-display 刷新；#account-btn 仍存在
//   6 更换头像：fileInput.change + FileReader 桩 → localStorage avatarDataUrl 写入；
//     面板大头像与首页按钮更新为 <img>
//   7 改密码：登录态下 合法/不一致/过短/离线 四种分支的文案与 updateUser 调用判定
//   8 退出登录：confirmDialog 桩返回 true → authSignOut → onAuthStateChange SIGNED_OUT →
//     handleSignedOut 清空 state.userId；面板关闭
//   9 未登录点登录 → showLoginOverlay（loginVisible 为 true）
//   10 syncStatusText 在 离线模式/未登录/离线/同步中/待同步N项/在线已同步 各状态文案正确
//   11 全文件不再存在 #sync-bar 节点（断言 getElementById('sync-bar') 为 null）
//
// 运行：C:\Users\zhh50\.workbuddy\binaries\node\versions\22.22.2\node.exe qa-account-panel.mjs
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
// 2) Fake Supabase 客户端（可脚本化、记录 auth 调用、支持 onAuthStateChange 回调）
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
      // signOut 触发已注册的 onAuthStateChange 回调（真实 supabase 行为：登出后回调 SIGNED_OUT）
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
          if (kind === 'upsert' || kind === 'insert') { op.payload = ops.find(o => o[0] === kind)[1][0]; }
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
// __import 桩：createClient 返回值由 sbReturn 控制（FAKE=在线可用 / null=离线）
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
  readyState: 'loading',           // 让首屏 bootstrap 仅注册 DOMContentLoaded 监听，不直接跑 init，便于受控测试
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

// FileReader 桩：readAsDataURL 同步设置 result 并触发 onload（模拟浏览器行为）
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
const getState = () => ev('({view:state.view, userId:state.userId, userEmail:state.userEmail, isOnline:state.isOnline, offlineMode:state.offlineMode, syncStatus:state.syncStatus})');

// 在线/离线模式切换（控制 getSb 的返回值）
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
  // 清理可能遗留的 body 级节点（toast / login-overlay）
  const keep = new Set([modalRoot, topbar, appEl]);
  body.childNodes = body.childNodes.filter(n => keep.has(n));
  ev('__loginOverlay = null;');
  ev('__toastEl = null;');
  localStorageStub.clear();
  FAKE.__authCalls.length = 0;
}
function makeProject(id, title) {
  return {
    id: id, title: title || ('项目' + id), type: 'forum', createdAt: 1000, updatedAt: 1000,
    data: { coverImage: null, cover: { title: '', body: '', images: [], author: '', avatar: null }, floors: [], settings: { showTime: false, pageRatio: '9:16', pageHeightPx: null } }
  };
}
function getAccountProfileRaw() {
  const s = localStorageStub.getItem('fn_account_profile');
  return s ? JSON.parse(s) : null;
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

// ---------------------------------------------------------------------------
// 6) 测试用例
// ---------------------------------------------------------------------------
if (loadError) {
  assert('脚本加载不抛未捕获异常', false, String(loadError && loadError.stack || loadError));
} else {

  // 初始化真实 augmentState + wrapRender，建立贴近真实的运行环境
  try { ev('augmentState(); wrapRender();'); }
  catch (e) { assert('augmentState + wrapRender 初始化不抛错', false, String(e)); }

  // ---------------- 1. 初始未登录/online：#account-btn 存在 + 人像 SVG（无绿点） ----------------
  await test('1-初始-未登录-online-首页常驻头像按钮', async () => {
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: null, userEmail: null, offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('renderHome()');
    await tick();

    const btn = documentStub.getElementById('account-btn');
    assert('1: 渲染后 #account-btn 存在', !!btn);
    assert('1: 按钮内包含人像 SVG（.account-person）', !!btn.querySelector('.account-person'));
    assert('1: 未登录无绿点（无 .account-online）', !btn.querySelector('.account-online'));
    assert('1: 非离线模式无灰点（无 .account-offline-dot）', !btn.querySelector('.account-offline-dot'));
    const st = getState();
    assert('1: 状态符合预期（未登录/online）', st.userId === null && st.isOnline === true);
    assert('1: getDisplayName 未登录返回"未登录"', ev('getDisplayName()') === '未登录');
  });

  // ---------------- 2. 模拟登录：首字母彩底 + 绿点(.account-online) ----------------
  await test('2-登录态-首字母彩底+绿点', async () => {
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: null, userEmail: null, offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('renderHome()');
    await tick();
    // 模拟登录：设置 userId + userEmail，再调用 refreshAccountBtn 重绘
    setState({ userId: 'user-abc', userEmail: 'me@example.com' });
    ev('refreshAccountBtn()');
    await tick();

    const btn = documentStub.getElementById('account-btn');
    assert('2: #account-btn 仍存在', !!btn);
    assert('2: 登录态显示绿点（.account-online）', !!btn.querySelector('.account-online'));
    assert('2: 登录态显示首字母彩底（.account-initial）', !!btn.querySelector('.account-initial'));
    assert('2: 登录态不再显示人像 SVG（无 .account-person）', !btn.querySelector('.account-person'));
    assert('2: 登录态不显示灰点（无 .account-offline-dot）', !btn.querySelector('.account-offline-dot'));
    assert('2: getDisplayName 返回邮箱（未设用户名时）', ev('getDisplayName()') === 'me@example.com');
  });

  // ---------------- 3. 离线模式：人像 + 灰点(.account-offline-dot) ----------------
  await test('3-离线模式-人像+灰点', async () => {
    resetDom();
    setSb('online'); // 离线模式仅由 state.offlineMode 决定按钮外观，不依赖 getSb
    setState({ view: 'home', projects: [], userId: null, userEmail: null, offlineMode: true, isOnline: false, syncStatus: 'idle', currentProject: null });
    ev('renderHome()');
    await tick();

    const btn = documentStub.getElementById('account-btn');
    assert('3: #account-btn 存在', !!btn);
    assert('3: 离线模式显示灰点（.account-offline-dot）', !!btn.querySelector('.account-offline-dot'));
    assert('3: 离线态显示人像 SVG（.account-person）', !!btn.querySelector('.account-person'));
    assert('3: 离线态不显示绿点（无 .account-online）', !btn.querySelector('.account-online'));
  });

  // ---------------- 4. 核心历史 bug 回归：删/建项目多次重渲染后 #account-btn 始终存在 ----------------
  await test('4-核心回归-删建项目多次重渲染后#account-btn始终存在', async () => {
    resetDom();
    setSb('online');
    setState({ view: 'home', userId: null, userEmail: null, offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });

    ev('render()');                                  // 空首页
    await tick();
    assert('4: 初始 render 后 #account-btn 存在', !!documentStub.getElementById('account-btn'));

    setState({ projects: [makeProject('p1', '小说A')] });
    ev('render()'); await tick();                    // 模拟"新建项目"
    assert('4: 新建项目后 render → #account-btn 存在', !!documentStub.getElementById('account-btn'));

    setState({ projects: [] });
    ev('render()'); await tick();                    // 模拟"删除项目"
    assert('4: 删除项目后 render → #account-btn 存在', !!documentStub.getElementById('account-btn'));

    setState({ projects: [makeProject('p2', '小说B'), makeProject('p3', '小说C')] });
    ev('render()'); await tick();                    // 再次新建多个
    assert('4: 再次新建多个后 render → #account-btn 存在', !!documentStub.getElementById('account-btn'));

    setState({ projects: [makeProject('p3', '小说C')] });
    ev('render()'); await tick();                    // 再删一个
    assert('4: 再删除后 render → #account-btn 存在', !!documentStub.getElementById('account-btn'));

    // 连续 3 次删建循环，断言每次都重生
    let okAll = true;
    for (let i = 0; i < 3; i++) {
      setState({ projects: [makeProject('c' + i, '循环' + i)] });
      ev('render()'); await tick();
      const b = documentStub.getElementById('account-btn');
      if (!b) okAll = false;
    }
    assert('4: 连续 3 次删建重渲染循环后 #account-btn 始终存在（根治偶发消失 bug）', okAll);
  });

  // ---------------- 5. 打开面板 + 保存用户名：localStorage / getDisplayName / 面板刷新 ----------------
  await test('5-面板-保存用户名写入localStorage并刷新', async () => {
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: null, userEmail: null, offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('renderHome()');
    await tick();

    ev('openAccountPanel()');
    await tick();
    const panel = modalRoot.querySelector('.account-panel');
    assert('5: 打开面板后 DOM 含账号面板节点（.account-panel）', !!panel);

    const nameInput = panel.querySelectorAll('input').find(i => i.attributes.type === 'text');
    assert('5: 面板含用户名输入框（type=text）', !!nameInput);
    const saveBtn = findBtnByText(panel, '保存');
    assert('5: 面板含"保存"按钮', !!saveBtn);

    nameInput.value = '测试用户小明';
    saveBtn.click();
    await tick();

    const prof = getAccountProfileRaw();
    assert('5: 用户名写入 localStorage fn_account_profile.username', prof && prof.username === '测试用户小明');
    assert('5: getDisplayName() 返回新用户名', ev('getDisplayName()') === '测试用户小明');
    const disp = panel.querySelector('.account-display');
    assert('5: 面板显示名(.account-display)已刷新为新用户名', disp && disp.textContent === '测试用户小明');

    const btn = documentStub.getElementById('account-btn');
    assert('5: refreshAccountBtn 后首页 #account-btn 仍存在', !!btn);
  });

  // ---------------- 6. 更换头像：fileInput.change + FileReader 桩 → <img> 更新 ----------------
  await test('6-面板-更换头像写入localStorage并刷新为img', async () => {
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: null, userEmail: null, offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('renderHome()');
    await tick();

    ev('openAccountPanel()');
    await tick();
    const panel = modalRoot.querySelector('.account-panel');
    const fileInput = panel.querySelectorAll('input').find(i => i.attributes.type === 'file');
    assert('6: 面板含隐藏头像文件输入（type=file）', !!fileInput);

    fileInput.files = [{ name: 'avatar.png' }];
    fileInput.fire('change', { target: fileInput });
    await tick();

    const prof = getAccountProfileRaw();
    assert('6: 头像 dataURL 写入 localStorage fn_account_profile.avatarDataUrl', prof && prof.avatarDataUrl === 'data:image/png;base64,STUBAVATAR');

    const ava = panel.querySelector('.account-head-av');
    assert('6: 面板大头像更新为 <img>（.account-avatar-lg-img）', ava && !!ava.querySelector('.account-avatar-lg-img'));

    const btn = documentStub.getElementById('account-btn');
    assert('6: 首页 #account-btn 更新为 <img>（含头像）', btn && !!btn.querySelector('img'));
  });

  // ---------------- 7. 改密码：合法/不一致/过短/离线 四种分支 ----------------
  await test('7-面板-修改密码四分支', async () => {
    // 7a 合法（≥6 位且两次一致）→ updateUser 被调用 + "密码已修改"
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: 'user-x', userEmail: 'x@e.com', offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('renderHome()'); await tick();
    ev('openAccountPanel()'); await tick();
    let panel = modalRoot.querySelector('.account-panel');
    let pwdInputs = panel.querySelectorAll('input').filter(i => i.attributes.type === 'password');
    assert('7a: 登录态面板含两个密码输入框', pwdInputs.length === 2);
    let pwdMsg = panel.querySelector('.account-pwd-msg');
    let pwdSave = findBtnByText(panel, '保存新密码');
    assert('7a: 面板含"保存新密码"按钮', !!pwdSave);

    pwdInputs[0].value = 'secret1';
    pwdInputs[1].value = 'secret1';
    FAKE.__authCalls.length = 0;
    pwdSave.click();
    await tick(); await tick(); await tick();
    assert('7a: 合法密码 → updateUser 被调用', FAKE.__authCalls.some(c => c.op === 'updateUser'));
    assert('7a: 合法密码 → 面板显示"密码已修改"', pwdMsg.textContent === '密码已修改');

    // 7b 不一致 → 报错且不调用 updateUser
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: 'user-x', userEmail: 'x@e.com', offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('renderHome()'); await tick();
    ev('openAccountPanel()'); await tick();
    panel = modalRoot.querySelector('.account-panel');
    pwdInputs = panel.querySelectorAll('input').filter(i => i.attributes.type === 'password');
    pwdMsg = panel.querySelector('.account-pwd-msg');
    pwdSave = findBtnByText(panel, '保存新密码');
    FAKE.__authCalls.length = 0;
    pwdInputs[0].value = 'secret1';
    pwdInputs[1].value = 'secret2';
    pwdSave.click();
    await tick(); await tick(); await tick();
    assert('7b: 两次不一致 → 显示"两次输入不一致"', pwdMsg.textContent === '两次输入不一致');
    assert('7b: 两次不一致 → 不调用 updateUser', !FAKE.__authCalls.some(c => c.op === 'updateUser'));

    // 7c 过短（<6 位）→ 报错且不调用 updateUser
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: 'user-x', userEmail: 'x@e.com', offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('renderHome()'); await tick();
    ev('openAccountPanel()'); await tick();
    panel = modalRoot.querySelector('.account-panel');
    pwdInputs = panel.querySelectorAll('input').filter(i => i.attributes.type === 'password');
    pwdMsg = panel.querySelector('.account-pwd-msg');
    pwdSave = findBtnByText(panel, '保存新密码');
    FAKE.__authCalls.length = 0;
    pwdInputs[0].value = 'abc';
    pwdInputs[1].value = 'abc';
    pwdSave.click();
    await tick(); await tick(); await tick();
    assert('7c: 过短 → 显示"密码至少 6 位"', pwdMsg.textContent === '密码至少 6 位');
    assert('7c: 过短 → 不调用 updateUser', !FAKE.__authCalls.some(c => c.op === 'updateUser'));

    // 7d 离线（getSb 返回 null）→ 提示需联网且不调用 updateUser
    resetDom();
    setSb('offline'); // 关键：getSb 返回 null
    setState({ view: 'home', projects: [], userId: 'user-x', userEmail: 'x@e.com', offlineMode: false, isOnline: false, syncStatus: 'idle', currentProject: null });
    ev('renderHome()'); await tick();
    ev('openAccountPanel()'); await tick();
    panel = modalRoot.querySelector('.account-panel');
    pwdInputs = panel.querySelectorAll('input').filter(i => i.attributes.type === 'password');
    pwdMsg = panel.querySelector('.account-pwd-msg');
    pwdSave = findBtnByText(panel, '保存新密码');
    FAKE.__authCalls.length = 0;
    pwdInputs[0].value = 'secret1';
    pwdInputs[1].value = 'secret1';
    pwdSave.click();
    await tick(); await tick(); await tick();
    assert('7d: 离线 → 显示"当前离线，需联网后修改密码"', pwdMsg.textContent === '当前离线，需联网后修改密码');
    assert('7d: 离线 → 不调用 updateUser', !FAKE.__authCalls.some(c => c.op === 'updateUser'));
  });

  // ---------------- 8. 退出登录：confirmDialog 桩 true → authSignOut → handleSignedOut 清空 userId ----------------
  await test('8-退出登录-清空userId并关闭面板', async () => {
    resetDom();
    setSb('online');
    // 注册真实 onAuthStateChange 回调（由 setupAuthListener 注册，登出时 signOut 触发 SIGNED_OUT）
    setState({ view: 'home', projects: [], userId: 'user-x', userEmail: 'x@e.com', offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('setupAuthListener()');
    await tick(); await tick();

    // 桩 confirmDialog 返回 true（模拟用户确认退出）
    ev('confirmDialog = async () => true;');

    ev('renderHome()'); await tick();
    assert('8: 退出前 #account-btn 存在且已登录', !!documentStub.getElementById('account-btn') && ev('state.userId') === 'user-x');

    ev('openAccountPanel()'); await tick();
    const panel = modalRoot.querySelector('.account-panel');
    assert('8: 登录态面板打开', !!panel);
    const logoutBtn = findBtnByText(panel, '退出登录');
    assert('8: 面板含"退出登录"按钮', !!logoutBtn);

    logoutBtn.click();
    await tick(); await tick(); await tick(); await tick();

    assert('8: 退出登录后 state.userId 被清空', ev('state.userId') === null);
    assert('8: 退出登录后 state.userEmail 被清空', ev('state.userEmail') === null);
    assert('8: 退出登录后面板已关闭（modal-root 无 .account-panel）', modalRoot.querySelectorAll('.account-panel').length === 0);
  });

  // ---------------- 9. 未登录点登录 → showLoginOverlay ----------------
  await test('9-未登录-点登录显示登录浮层', async () => {
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: null, userEmail: null, offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('renderHome()'); await tick();
    ev('openAccountPanel()'); await tick();
    const panel = modalRoot.querySelector('.account-panel');
    assert('9: 未登录面板打开', !!panel);
    const loginBtn = findBtnByText(panel, '登录');
    assert('9: 面板含"登录"按钮', !!loginBtn);

    loginBtn.click();
    await tick();
    assert('9: 点击"登录"后 showLoginOverlay 生效（loginVisible 为 true）', ev('loginVisible()') === true);
    assert('9: 点击"登录"后登录浮层节点存在（#login-overlay）', !!documentStub.getElementById('login-overlay'));
    // 面板应被关闭（点击登录会先 closeFn 关闭面板）
    assert('9: 点击登录后账号面板已关闭', modalRoot.querySelectorAll('.account-panel').length === 0);
  });

  // ---------------- 10. syncStatusText 各状态文案 ----------------
  await test('10-syncStatusText各状态文案', async () => {
    resetDom();
    setSb('online');

    setState({ userId: null, userEmail: null, offlineMode: true, isOnline: true, syncStatus: 'idle' });
    assert('10: 离线模式 → "离线模式（本地数据）"', ev('syncStatusText()') === '离线模式（本地数据）');

    setState({ userId: null, userEmail: null, offlineMode: false, isOnline: true, syncStatus: 'idle' });
    assert('10: 未登录 → "未登录"', ev('syncStatusText()') === '未登录');

    setState({ userId: 'u', userEmail: 'u@e.com', offlineMode: false, isOnline: false, syncStatus: 'idle' });
    assert('10: 离线（isOnline=false）→ "离线"', ev('syncStatusText()') === '离线');

    setState({ userId: 'u', userEmail: 'u@e.com', offlineMode: false, isOnline: true, syncStatus: 'syncing' });
    assert('10: 同步中 → "同步中…"', ev('syncStatusText()') === '同步中…');

    setState({ userId: 'u', userEmail: 'u@e.com', offlineMode: false, isOnline: true, syncStatus: 'idle' });
    ev('OfflineQueue.enqueue({op:"push", id:"s1"});');
    assert('10: 待同步 1 项 → "待同步 1 项"', ev('syncStatusText()') === '待同步 1 项');
    ev('OfflineQueue.remove("s1");');

    setState({ userId: 'u', userEmail: 'u@e.com', offlineMode: false, isOnline: true, syncStatus: 'idle' });
    assert('10: 在线已同步 → "在线 · 已同步"', ev('syncStatusText()') === '在线 · 已同步');
  });

  // ---------------- 11. 旧 #sync-bar 节点已彻底移除 ----------------
  await test('11-旧sync-bar节点已移除', async () => {
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: 'user-x', userEmail: 'x@e.com', offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('render()');
    await tick();
    // 触发可能引用 sync-bar 的路径（refreshSyncBar 在登录态会查找 #sync-bar，应安全 no-op）
    ev('refreshSyncBar();');
    await tick();
    assert('11: 渲染后全文件不再存在 #sync-bar 节点（getElementById 为 null）', documentStub.getElementById('sync-bar') === null);
    // 静态确认源码里没有创建 sync-bar 的 el('...',{id:"sync-bar"}) 或类似注入
    const html2 = readFileSync(HTML_PATH, 'utf8');
    assert('11: 源码中无 el(...,{id:"sync-bar"}) 创建节点', !/id:\s*['"]sync-bar['"]/.test(html2));
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
console.log('# 回归测试报告 — 首页常驻头像按钮 + 账号管理面板');
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
  const coreFail = failedCases.some(r => r.name.startsWith('1:') || r.name.startsWith('2:') || r.name.startsWith('3:') || r.name.startsWith('4:') || r.name.startsWith('11:'));
  routing = coreFail
    ? 'Engineer（核心场景 1/2/3/4/11 失败：疑似源码 Bug，附失败断言与上下文待工程师排查）'
    : 'QA（非核心场景失败：疑似测试桩/断言问题，需修测试代码）';
  foundBug = coreFail;
} else {
  routing = 'NoOne（全部通过：确认改动有效，未引入回归）';
  foundBug = false;
}

console.log('\n路由判定: ' + routing);
console.log('是否发现源码 Bug: ' + (foundBug ? '是（见失败明细，待工程师核实）' : '否'));
console.log('==================================================');

const exitCode = failed > 0 ? 1 : 0;
process.exit(exitCode);
