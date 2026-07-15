// ============================================================================
// qa-sync-bugfix.mjs
// 单文件小说编辑器 —— 「登录后首次迁移弹窗『跳过』导致同步条(#sync-out)消失」Bug 的
// 独立回归测试。
//
// 测试策略（复用 qa-sync-test.mjs 的沙箱手法）：
//   用 Node `vm` 加载 index.html 中【真实的两段 <script> 代码】，在受控沙箱中运行
//   （不复制业务函数，测的是真代码）。沙箱提供：faithful 轻量 DOM 实现、navigator、
//   内存版 localStorage、fake Supabase 客户端（__import 桩替换真实 esm.sh 动态导入）、
//   内存版 IndexedDB 桩。
//
// 修复点（已在 index.html 落地，仅验证、不修改源码）：
//   1) 第 3037 行 MigrationUI.show 中 openModal(body, ()=> injectSyncBars())
//      —— 弹窗关闭回调重新注入同步条（含「退出」按钮 #sync-out）。
//   2) 第 3098 行 handleSignedIn 末尾（无条件分支）新增 injectSyncBars() 双保险兜底。
//
// 覆盖场景：
//   A 基线：登录后 #sync-bar 存在且含 #sync-out；迁移弹窗出现（含"发现本地作品"）。
//   B 核心回归：点「跳过」→ 弹窗关闭 → #sync-bar 与 #sync-out 仍存在。
//   C 全部迁移上云：点「全部迁移上云」→ setTimeout(900) 关闭 → #sync-bar 与 #sync-out 仍存在。
//   D 兜底：弹出期间手动移除同步条 → 点「跳过」经 onClose 重注入 → 同步条重新出现。
//   E 无回归：未登录( userId=null )调 injectSyncBars 不注入；既有纯函数断言仍通过。
//   X 对照：用 openModal(无 onClose) 模拟修复前行为 → 移除后点跳过 → 同步条保持消失（即旧 Bug）。
//
// 运行：C:\Users\zhh50\.workbuddy\binaries\node\versions\22.22.2\node.exe qa-sync-bugfix.mjs
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
// 2) Fake Supabase 客户端（可脚本化、可预设返回值、记录调用）
// ---------------------------------------------------------------------------
function makeFakeClient() {
  const calls = [];
  let responder = (op) => ({ data: null, error: null });
  const client = {
    __calls: calls,
    __setResponder(fn) { responder = fn; },
    channel() { return { on() { return this; }, subscribe() { return Promise.resolve(); }, unsubscribe() {} }; },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({ data: { session: {}, user: {} }, error: null }),
      signUp: async () => ({ data: { session: null, user: {} }, error: null }),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getUser: async () => ({ data: { user: null }, error: null }),
      updateUser: async () => ({ data: {}, error: null }),
    },
    // 真实 @supabase/supabase-js 的查询构造器是「可 thenable」的：每个方法返回自身，
    // 真正执行发生在被 await 时（调用 then）。
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
  return client;
}
const FAKE = makeFakeClient();
const fakeModule = { createClient: () => FAKE };

// ---------------------------------------------------------------------------
// 3) Faithful 轻量 DOM / 浏览器环境 stub
//    （相比 qa-sync-test.mjs 的极简 stub，这里实现可遍历的树 + querySelector/All，
//      以便真实验证 #sync-bar / #sync-out 在 DOM 中的存在与弹窗开关。）
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
  querySelector(sel) {
    const found = this._findAll(sel);
    return found.length ? found[0] : null;
  }
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

// 文档骨架：body 内含 modal-root（弹窗容器）、topbar（顶部操作条容器）、app（主内容）
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

// 用内存版 IndexedDB 替换真实 idb（Node 无 IndexedDB，这是测试桩而非改源码）
const mem = new Map();
ctx.idbGetAll = async () => [...mem.values()];
ctx.idbGet = async (id) => (mem.has(id) ? mem.get(id) : null);
ctx.idbPut = async (p) => { mem.set(p.id, p); };
ctx.idbDelete = async (id) => { mem.delete(id); };

// ---------------------------------------------------------------------------
// 5) 测试工具
// ---------------------------------------------------------------------------
const ev = (code) => vm.runInContext(code, ctx, { filename: 'test.js' });
const evAsync = (code) => vm.runInContext(code, ctx, { filename: 'test.js' });
const setField = (k, v) => ev(`state.${k} = ${JSON.stringify(v)}`);
const setState = (obj) => ev(`Object.assign(state, ${JSON.stringify(obj)})`);
const setProjects = (arr) => ev(`state.projects = ${JSON.stringify(arr)}`);
const setCurrent = (p) => ev(`state.currentProject = ${p === null ? 'null' : JSON.stringify(p)}`);
function getState() {
  return ev(`({view:state.view, userId:state.userId, isOnline:state.isOnline, syncStatus:state.syncStatus, hasSyncFields:("cloudTimer" in state)&&("syncStatus" in state)&&("isOnline" in state)&&("userId" in state)&&("pendingSync" in state), projects:(state.projects||[]).map(p=>({id:p.id,updatedAt:p.updatedAt})), currentProject: state.currentProject?{id:state.currentProject.id,updatedAt:state.currentProject.updatedAt}:null})`);
}
function configSb(opts) {
  FAKE.__calls.length = 0;
  FAKE.__setResponder((op) => {
    if (op.kind === 'select' && op.hasMaybeSingle) return { data: (opts.single !== undefined ? opts.single : null), error: null };
    if (op.kind === 'select') return { data: opts.list || [], error: null };
    return { error: null };
  });
}
const hasUpsert = (id) => FAKE.__calls.some(c => c.kind === 'upsert' && c.payload && c.payload.id === id);

// ---- bugfix 专用辅助 ----
function collectText(node) {
  if (!node) return '';
  let out = '';
  const walk = (n) => {
    if (n instanceof TextNode) out += n.text;
    else if (n instanceof Element) { if (n._text) out += n._text; n.childNodes.forEach(walk); }
  };
  walk(node);
  return out;
}
function getSyncBar() { return documentStub.getElementById('sync-bar'); }
function getSyncOut() { return documentStub.getElementById('sync-out'); }
function findButtonByText(root, text) {
  return root.querySelectorAll('button').find(b => (b.textContent || '').trim() === text) || null;
}
function resetState() {
  ev(`Object.assign(state, { userId:null, userEmail:null, session:null, offlineMode:false, view:'home', isOnline:true, syncStatus:'idle', pendingSync:0, currentProject:null, projects:[] });`);
  ev('__migrationDone = false; __authReady = false;');
}
function resetDom() {
  modalRoot.childNodes.length = 0;
  topbar.childNodes.length = 0;
  appEl.childNodes.length = 0;
}
function seedLocalProjects() {
  const base = {
    type: 'forum', createdAt: 1000, updatedAt: 1000,
    data: { coverImage: { dataUrl: 'data:image/png;base64,AAA', name: 'c.png' }, cover: { title: '', body: '', images: [], author: '', avatar: null }, floors: [], settings: { showTime: false, pageRatio: '9:16', pageHeightPx: null } }
  };
  const p1 = JSON.parse(JSON.stringify(base)); p1.id = 'lp1'; p1.title = '本地小说一';
  const p2 = JSON.parse(JSON.stringify(base)); p2.id = 'lp2'; p2.title = '本地小说二';
  ev(`state.projects = ${JSON.stringify([p1, p2])}`);
}
function configMigrationResponder() {
  FAKE.__calls.length = 0;
  FAKE.__setResponder((op) => {
    if (op.kind === 'select') return { data: [], error: null }; // pullAll 返回空 → 本地项目均触发迁移
    return { error: null }; // upsert/push 等成功
  });
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
// 6) 初始化（与真实应用一致地走 initSync，但不挂 DOMContentLoaded 自动触发，
//    并设置 state.isEmbedded 以避免联网/定时器副作用）
// ---------------------------------------------------------------------------
if (!loadError) {
  try {
    ev('state.isEmbedded = true;');
    await evAsync('initSync()');
  } catch (e) {
    loadError = e;
  }
}

// ---------------------------------------------------------------------------
// 7) 测试用例
// ---------------------------------------------------------------------------
if (loadError) {
  assert('脚本加载 / initSync 不抛未捕获异常', false, String(loadError && loadError.stack || loadError));
} else {

  // ---------------- A. 基线 ----------------
  await test('A-基线-登录后同步条存在且迁移弹窗出现', async () => {
    resetState(); resetDom(); seedLocalProjects(); configMigrationResponder();
    const session = { user: { id: 'u-base', email: 'base@e.com' } };
    await evAsync('handleSignedIn(' + JSON.stringify(session) + ')');

    const bar = getSyncBar();
    assert('登录后 #sync-bar 存在', !!bar);
    assert('登录后 #sync-bar 含 #sync-out 退出按钮', !!(bar && bar.querySelector('#sync-out')));
    const txt = collectText(modalRoot);
    assert('迁移弹窗出现（含"发现本地作品"）', txt.includes('发现本地作品'));
    assert('迁移弹窗提示本地有 2 个项目', txt.includes('2 个项目') || txt.includes('2'));
  });

  // ---------------- B. 核心回归：点「跳过」 ----------------
  await test('B-核心回归-点"跳过"后同步条仍存在', async () => {
    resetState(); resetDom(); seedLocalProjects(); configMigrationResponder();
    const session = { user: { id: 'u-skip', email: 's@e.com' } };
    await evAsync('handleSignedIn(' + JSON.stringify(session) + ')');

    assert('基线: 登录后 #sync-bar 存在', !!getSyncBar());
    const skipBtn = findButtonByText(modalRoot, '跳过');
    assert('迁移弹窗含"跳过"按钮', !!skipBtn);

    skipBtn.click();

    assert('点跳过后弹窗关闭（modal-root 不再含"发现本地作品"）', !collectText(modalRoot).includes('发现本地作品'));
    const bar = getSyncBar();
    assert('点跳过后 #sync-bar 仍存在（修复前会消失）', !!bar);
    assert('点跳过后 #sync-out 仍存在', !!(bar && bar.querySelector('#sync-out')));
  });

  // ---------------- C. 全部迁移上云 ----------------
  await test('C-全部迁移上云-关闭后同步条仍存在', async () => {
    resetState(); resetDom(); seedLocalProjects(); configMigrationResponder();
    const session = { user: { id: 'u-all', email: 'a@e.com' } };
    await evAsync('handleSignedIn(' + JSON.stringify(session) + ')');

    const allBtn = findButtonByText(modalRoot, '全部迁移上云');
    assert('迁移弹窗含"全部迁移上云"按钮', !!allBtn);

    allBtn.click();
    await new Promise(r => setTimeout(r, 1100)); // 等待循环 pushProject + setTimeout(900) 关闭

    assert('迁移完成弹窗关闭', !collectText(modalRoot).includes('发现本地作品'));
    const bar = getSyncBar();
    assert('全部迁移上云后 #sync-bar 仍存在', !!bar);
    assert('全部迁移上云后 #sync-out 仍存在', !!(bar && bar.querySelector('#sync-out')));
  });

  // ---------------- D. 兜底：弹窗期间同步条被移除后经 onClose 重注入 ----------------
  await test('D-兜底-弹窗期间同步条被移除后经onClose重注入', async () => {
    resetState(); resetDom(); seedLocalProjects(); configMigrationResponder();
    const session = { user: { id: 'u-d', email: 'd@e.com' } };
    await evAsync('handleSignedIn(' + JSON.stringify(session) + ')');

    assert('基线: #sync-bar 存在', !!getSyncBar());

    // 模拟弹窗打开期间同步条被移除（如发生重渲染/Realtime 事件）
    ev("document.querySelectorAll('#sync-bar').forEach(n=> n.remove())");
    assert('模拟移除后 #sync-bar 已消失', !getSyncBar());

    const skipBtn = findButtonByText(modalRoot, '跳过');
    skipBtn.click();

    const bar = getSyncBar();
    assert('点跳过后经 onClose 回调 #sync-bar 重新出现', !!bar);
    assert('重新出现后 #sync-out 也存在', !!(bar && bar.querySelector('#sync-out')));
  });

  // ---------------- X. 对照：修复前行为（openModal 不传 onClose）会丢同步条 ----------------
  await test('X-对照-旧行为(弹窗关闭不重注入)同步条会消失', async () => {
    resetState(); resetDom();
    setState({ userId: 'u-x', offlineMode: false, view: 'home' });
    ev('injectSyncBars()');
    assert('对照: 注入后有 #sync-bar', !!getSyncBar());

    // 旧行为：openModal 不传 onClose（模拟修复前 MigrationUI.show 的写法）
    const closeFn = ev(`(function(){ const body=el('div',{},'旧弹窗'); return openModal(body); })()`);
    assert('对照: openModal(无onClose) 返回函数', typeof closeFn === 'function');

    // 模拟弹窗打开期间同步条被移除
    ev("document.querySelectorAll('#sync-bar').forEach(n=> n.remove())");
    assert('对照: 移除后同步条已消失', !getSyncBar());

    // 用户点跳过（仅 closeFn，无重注入）
    closeFn();
    assert('对照: 旧行为下点击跳过 → 同步条保持消失（即修复前的 Bug）', !getSyncBar());
  });

  // ---------------- E. 无回归：未登录不注入 + 既有纯函数断言 ----------------
  await test('E-无回归-未登录不注入 & 既有纯函数断言', async () => {
    // E1: 未登录不注入
    resetState(); resetDom();
    setState({ userId: null, offlineMode: false });
    ev('injectSyncBars()');
    assert('未登录(state.userId=null) 调 injectSyncBars 不注入同步条', !getSyncBar());

    // E2: 复用既有纯函数断言（与 qa-sync-test.mjs 一致），确认未破坏核心逻辑
    assert('toCloudRow 为函数', typeof ev('toCloudRow') === 'function');
    assert('fromCloudRow 为函数', typeof ev('fromCloudRow') === 'function');
    assert('OfflineQueue 为对象', typeof ev('OfflineQueue') === 'object' && ev('OfflineQueue') !== null);
    assert('validateEmail 为函数', typeof ev('validateEmail') === 'function');
    assert('translateAuthError 为函数', typeof ev('translateAuthError') === 'function');
    assert('pullAllAndMerge 为函数', typeof ev('pullAllAndMerge') === 'function');
    assert('pullLatest 为函数', typeof ev('pullLatest') === 'function');

    // toCloudRow
    const p = { id: 'p1', title: '小说A', type: 'forum', createdAt: 1000, updatedAt: 2000, data: { coverImage: { dataUrl: 'durl', name: 'n' }, cover: {}, floors: [], settings: {} } };
    const r = ev(`toCloudRow(${JSON.stringify(p)}, "user-xyz")`);
    assert('toCloudRow.id 正确', r.id === 'p1');
    assert('toCloudRow.owner_id 正确', r.owner_id === 'user-xyz');
    assert('toCloudRow.cover_image 取自 data.coverImage', r.cover_image && r.cover_image.dataUrl === 'durl');
    assert('toCloudRow.updated_at 为 ISO 且等于 2000ms', r.updated_at === new Date(2000).toISOString());

    // fromCloudRow
    const iso = '2024-01-02T03:04:05.678Z'; const ms = Date.parse(iso);
    const row = { id: 'r1', title: '云小说', type: 'pickup', created_at: iso, updated_at: iso, data: { x: 1 } };
    const pf = ev(`fromCloudRow(${JSON.stringify(row)})`);
    assert('fromCloudRow.id 正确', pf.id === 'r1');
    assert('fromCloudRow.updatedAt 回转毫秒', pf.updatedAt === ms);
    assert('fromCloudRow.data 正确', pf.data && pf.data.x === 1);

    // roundtrip
    const pr = { id: 'rt1', title: '往返小说', type: 'forum', createdAt: 111, updatedAt: 222, data: { coverImage: { dataUrl: 'du', name: 'n' }, cover: {}, floors: [], settings: {} } };
    const back = ev(`fromCloudRow(toCloudRow(${JSON.stringify(pr)}, "u"))`);
    assert('roundtrip.id 一致', back.id === pr.id);
    assert('roundtrip.data 一致', JSON.stringify(back.data) === JSON.stringify(pr.data));

    // OfflineQueue
    localStorageStub.clear();
    ev('OfflineQueue.enqueue({op:"push", id:"a"})');
    ev('OfflineQueue.enqueue({op:"push", id:"a"})');
    assert('OfflineQueue 同 id+op 去重后 pendingCount=1', ev('OfflineQueue.pendingCount()') === 1);
    ev('OfflineQueue.remove("a")');
    assert('OfflineQueue.remove(id) 后 pendingCount=0', ev('OfflineQueue.pendingCount()') === 0);
    localStorageStub.clear();

    // validateEmail
    assert('validateEmail 合法 a@b.com', ev('validateEmail("a@b.com")') === true);
    assert('validateEmail 非法 无@', ev('validateEmail("abc")') === false);
    assert('validateEmail 非法 空串', ev('validateEmail("")') === false);

    // translateAuthError
    const f = (m) => ev(`translateAuthError(${JSON.stringify({ message: m })})`);
    assert('translateAuthError invalid credentials', f('Invalid login credentials').includes('邮箱或密码错误'));
    assert('translateAuthError already registered', f('User already registered').includes('已注册'));
    assert('translateAuthError network', f('Failed to fetch').includes('网络异常'));
    assert('translateAuthError 默认分支', f('some weird error').startsWith('操作失败'));

    // LWW: pullAllAndMerge 云新覆盖本地
    mem.clear(); configSb({ list: [{ id: 'a', title: 'Cloud', type: 'forum', created_at: new Date(1000).toISOString(), updated_at: new Date(5000).toISOString(), data: {} }] });
    setField('userId', 'u-lww'); setField('isOnline', true);
    setProjects([{ id: 'a', title: 'Local', type: 'forum', createdAt: 1000, updatedAt: 1000, data: {} }]);
    await evAsync('pullAllAndMerge()');
    await new Promise(r => setTimeout(r, 0));
    let s = getState(); const a = s.projects.find(x => x.id === 'a');
    assert('LWW 云较新 → merged 含 a 且 updatedAt≈5000', a && Math.abs(a.updatedAt - 5000) < 2);
    assert('LWW 云较新 → 不向云推送 a', !hasUpsert('a'));

    // LWW: pullAllAndMerge 本地新推云
    mem.clear(); configSb({ list: [{ id: 'a', title: 'Cloud', type: 'forum', created_at: new Date(1000).toISOString(), updated_at: new Date(1000).toISOString(), data: {} }] });
    setField('userId', 'u-lww'); setField('isOnline', true);
    setProjects([{ id: 'a', title: 'Local', type: 'forum', createdAt: 5000, updatedAt: 5000, data: {} }]);
    await evAsync('pullAllAndMerge()');
    await new Promise(r => setTimeout(r, 0));
    s = getState(); const a2 = s.projects.find(x => x.id === 'a');
    assert('LWW 本地较新 → merged 含 a 且 updatedAt≈5000', a2 && Math.abs(a2.updatedAt - 5000) < 2);
    assert('LWW 本地较新 → 向云推送 a', hasUpsert('a'));

    // LWW: pullAllAndMerge 云独有并入
    mem.clear(); configSb({ list: [{ id: 'c', title: 'OnlyCloud', type: 'forum', created_at: new Date(2000).toISOString(), updated_at: new Date(2000).toISOString(), data: {} }] });
    setField('userId', 'u-lww'); setField('isOnline', true);
    setProjects([]);
    await evAsync('pullAllAndMerge()');
    await new Promise(r => setTimeout(r, 0));
    s = getState();
    assert('LWW 云独有 → merged 含 c', s.projects.some(x => x.id === 'c'));
    assert('LWW 云独有 → 不向云推送 c', !hasUpsert('c'));

    // pullLatest 云新覆盖本地
    mem.clear();
    const cloudRow = { id: 'x', title: 'CloudX', type: 'forum', created_at: new Date(1000).toISOString(), updated_at: new Date(5000).toISOString(), data: { k: 'v' } };
    configSb({ single: cloudRow });
    setField('userId', 'u-pl'); setField('isOnline', true);
    setProjects([]); setCurrent({ id: 'x', title: 'LocalX', type: 'forum', createdAt: 1000, updatedAt: 1000, data: {} });
    const res = await evAsync('pullLatest("x")');
    await new Promise(r => setTimeout(r, 0));
    assert('pullLatest 云新返回云端版本', res && Math.abs(res.updatedAt - 5000) < 2);
    assert('pullLatest 云新不向云推送', !hasUpsert('x'));
    assert('pullLatest 云新持久化到本地缓存 idbPut', mem.has('x'));

    // pullLatest 云缺失返回 null
    mem.clear(); configSb({ single: null });
    setField('userId', 'u-pl'); setField('isOnline', true);
    setProjects([]); setCurrent(null);
    const resNull = await evAsync('pullLatest("nope")');
    assert('pullLatest 云返回 null → 返回 null', resNull === null);
  });
}

// ---------------------------------------------------------------------------
// 8) 汇总报告 + 路由判定
// ---------------------------------------------------------------------------
const total = results.length;
const passed = results.filter(r => r.pass).length;
const failed = total - passed;
const failedCases = results.filter(r => !r.pass);

console.log('\n==================================================');
console.log('# 回归测试报告 — 登录后「首次迁移」弹窗跳过导致同步条消失 (Bug 修复验证)');
console.log(`总断言: ${total} | 通过: ${passed} | 失败: ${failed}`);
if (loadError) console.log('加载阶段错误：已拦截未捕获异常（见上）。');
if (failed > 0) {
  console.log('\n失败明细：');
  failedCases.forEach(r => console.log(`  - ${r.name} ${r.detail ? '(' + r.detail + ')' : ''}`));
}

// 路由判定：源码 Bug → Engineer；测试代码问题 → QA（此处不自行改，交由说明）；全部通过 → NoOne
let routing;
if (failed > 0) {
  routing = 'Engineer（疑似源码 Bug：附失败断言，需工程师排查）';
} else {
  routing = 'NoOne（全部通过：确认修复有效，未引入回归）';
}

console.log('\n路由判定: ' + routing);
console.log('是否复现/确认修复: ' + (failed > 0 ? '未能全部通过（见失败明细）' : '已确认修复 — 场景 B/D 点「跳过」后 #sync-bar 与 #sync-out 仍存在；对照 X 证明旧行为会丢条'));
console.log('是否发现源码 Bug: ' + (failed > 0 ? '是（见失败明细，待工程师核实）' : '否'));
console.log('==================================================');

const exitCode = failed > 0 ? 1 : 0;
process.exit(exitCode);
