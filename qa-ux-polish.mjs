// ============================================================================
// qa-ux-polish.mjs
// 单文件小说编辑器 —— 6 项 UI/UX 调整的独立回归测试。
//
// 测试策略（复用 qa-account-panel.mjs / qa-avatar-ui.mjs / qa-newproj-bugfix.mjs 的 vm 沙箱范式）：
//   用 Node `vm` 加载 index.html 里【真实的两段 <script> 代码】，在受控沙箱中运行
//   （不复制业务函数，测的是真代码）。提供轻量 DOM/localStorage 桩 + fake Supabase 客户端
//   （getSb() 默认 online 返回 fake client）。全程 fake Supabase + 内存 DOM/localStorage 桩。
//
// 覆盖场景（7 组，≥30 条断言）：
//   1 编辑器视图常驻头像按钮：renderEditor() 后 #editor-account-btn 存在且 class 含 account-btn、
//     点击触发 openAccountPanel（spy）；同时 renderHome() 后 #account-btn 仍存在（两视图并存）。
//   2 双按钮同步刷新：模拟登录后手动注入编辑器头像按钮，refreshAccountBtn() 两按钮都被刷出
//     .account-initial（首字母）与 .account-online（绿点）。
//   3 品牌名：源码 <title>=「捡文学编辑器」；buildLoginOverlay() 登录卡片 h2=「捡文学编辑器」。
//   4 主页文案：renderHome() 后 h1=「我的作品」、新建按钮=「+ 新建作品」、空状态含
//     「还没有作品，点"新建作品"开始」。
//   5 导入说明弹窗：triggerImport() 后出现含「导入作品」的 modal，含「选择文件」(btn-primary)
//     与「取消」(btn-ghost)；点击「选择文件」后 doPickFile() 创建 input[type=file] 于 body。
//   6 确认按钮文案：confirmDialog 不传 okText → 确定按钮=「删除」(btn-danger)；doLogout() 流程
//     传入 okText=「确认退出」（桩捕获参数 / 弹窗确定按钮文本）。
//   7 回归：删/建项目多次重渲染后首页 #account-btn 始终存在；旧 #sync-bar 节点不存在。
//
// 运行：C:\Users\zhh50\.workbuddy\binaries\node\versions\22.22.2\node.exe qa-ux-polish.mjs
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

function findModalBodyByText(text) {
  return modalRoot.querySelectorAll('.modal-body').find(m => (m.textContent || '').includes(text)) || null;
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

  // ---------------- 1. 编辑器视图常驻头像按钮 + 首页按钮并存 ----------------
  await test('1-编辑器头像按钮-常驻且点击打开账号面板+首页按钮并存', async () => {
    resetDom();
    setSb('online');
    const proj = makeProject('e1', '编辑器项目');
    setState({ view: 'editor', editorKind: 'forum', projects: [], userId: null, userEmail: null, offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: proj });

    // 先渲染首页，确认首页按钮始终存在（历史核心 bug 不回归）
    ev('renderHome()');
    await tick();
    const homeBtn = documentStub.getElementById('account-btn');
    assert('1: renderHome() 后首页 #account-btn 存在', !!homeBtn);
    assert('1: 首页 #account-btn 的 class 含 account-btn（两视图并存）', !!homeBtn && homeBtn._classes.has('account-btn'));

    // 再渲染编辑器视图，确认编辑器常驻头像按钮
    ev('renderEditor()');
    await tick();
    const edBtn = documentStub.getElementById('editor-account-btn');
    assert('1: renderEditor() 后 #editor-account-btn 存在', !!edBtn);
    assert('1: #editor-account-btn 的 class 含 account-btn', !!edBtn && edBtn._classes.has('account-btn'));
    assert('1: #editor-account-btn 是 button 元素', !!edBtn && edBtn.tagName === 'button');

    // spy 点击行为：替换 openAccountPanel 为计数器，点击编辑器头像按钮应触发
    ev('window.__openCalled = 0; openAccountPanel = function(){ window.__openCalled = (window.__openCalled||0) + 1; };');
    edBtn.click();
    await tick();
    assert('1: 点击 #editor-account-btn 触发 openAccountPanel（spy 计数=1）', ev('window.__openCalled') === 1);
  });

  // ---------------- 2. 双按钮同步刷新（querySelectorAll('.account-btn') 覆盖两视图）----------------
  await test('2-双按钮同步刷新-登录后两头像均刷出首字母+绿点', async () => {
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: 'u1', userEmail: 'a@b.com', offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('renderHome()');
    await tick();
    // 手动注入编辑器头像按钮（贴近“两视图可能同时存在于 DOM”的刷新路径）
    ev('document.body.appendChild(buildAccountBtn({id:"editor-account-btn"}));');
    await tick();

    const homeBtn = documentStub.getElementById('account-btn');
    const edBtn = documentStub.getElementById('editor-account-btn');
    assert('2: 首页 #account-btn 存在', !!homeBtn);
    assert('2: 编辑器 #editor-account-btn 存在', !!edBtn);

    // 模拟登录态刷新两按钮
    setState({ userId: 'u1', userEmail: 'a@b.com' });
    ev('refreshAccountBtn()');
    await tick();

    const h = documentStub.getElementById('account-btn');
    const e = documentStub.getElementById('editor-account-btn');
    assert('2: 首页按钮刷新后含首字母彩底（.account-initial）', !!h && !!h.querySelector('.account-initial'));
    assert('2: 首页按钮刷新后含在线绿点（.account-online）', !!h && !!h.querySelector('.account-online'));
    assert('2: 编辑器按钮刷新后含首字母彩底（.account-initial）', !!e && !!e.querySelector('.account-initial'));
    assert('2: 编辑器按钮刷新后含在线绿点（.account-online）', !!e && !!e.querySelector('.account-online'));
  });

  // ---------------- 3. 品牌名：<title> + 登录卡片 h2 ----------------
  await test('3-品牌名-title与登录卡片h2均为捡文学编辑器', async () => {
    resetDom();
    setSb('online');
    // 源码 <title> 文本
    assert('3: 源码 <title> 文本为「捡文学编辑器」', /<title>\s*捡文学编辑器\s*<\/title>/.test(html));
    // buildLoginOverlay 登录卡片 h2
    setState({ view: 'home', projects: [], userId: null, userEmail: null, offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('buildLoginOverlay()');
    await tick();
    const loginCard = documentStub.getElementById('login-overlay');
    const h2 = loginCard ? loginCard.querySelector('h2') : null;
    assert('3: 登录浮层存在', !!loginCard);
    assert('3: 登录卡片 h2 文本为「捡文学编辑器」', !!h2 && (h2.textContent || '').trim() === '捡文学编辑器');
  });

  // ---------------- 4. 主页文案：h1 / 新建按钮 / 空状态 ----------------
  await test('4-主页文案-h1与新建按钮与空状态', async () => {
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: null, userEmail: null, offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('renderHome()');
    await tick();

    const h1 = appEl.querySelector('h1');
    assert('4: 主页 h1 文本为「我的作品」', !!h1 && (h1.textContent || '').trim() === '我的作品');

    const newBtn = findBtnByText(appEl, '+ 新建作品');
    assert('4: 存在「+ 新建作品」新建按钮', !!newBtn);
    assert('4: 新建按钮文本为「+ 新建作品」', !!newBtn && (newBtn.textContent || '').trim() === '+ 新建作品');

    const empty = appEl.querySelector('.empty');
    const emptyText = empty ? (empty.textContent || '') : '';
    assert('4: 空状态节点存在且含「还没有作品」', !!empty && emptyText.includes('还没有作品'));
    assert('4: 空状态含「新建作品」提示', !!empty && emptyText.includes('新建作品'));
    assert('4: 空状态含「开始」提示', !!empty && emptyText.includes('开始'));
  });

  // ---------------- 5. 导入说明弹窗：triggerImport → openImportHelp ----------------
  await test('5-导入说明弹窗-含导入作品标题与选择文件按钮', async () => {
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: null, userEmail: null, offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });

    ev('triggerImport()');
    await tick();

    const modal = findModalBodyByText('导入作品');
    assert('5: triggerImport() 后出现含「导入作品」的 modal 节点', !!modal);
    assert('5: 弹窗含「选择文件」按钮', !!findBtnByText(modalRoot, '选择文件'));
    const pick = findBtnByText(modalRoot, '选择文件');
    assert('5: 「选择文件」按钮为 btn-primary', !!pick && pick._classes.has('btn-primary'));
    assert('5: 弹窗含「取消」按钮', !!findBtnByText(modalRoot, '取消'));
    const cancel = findBtnByText(modalRoot, '取消');
    assert('5: 「取消」按钮为 btn-ghost', !!cancel && cancel._classes.has('btn-ghost'));

    // 模拟点击「选择文件」→ closeFn() + doPickFile()（创建 input[type=file] 并 click）
    pick.click();
    await tick();
    const fileInput = body.querySelectorAll('input').find(i => i.attributes.type === 'file');
    assert('5: 点击「选择文件」后 doPickFile() 已创建 input[type=file]（挂载于 body）', !!fileInput);
    assert('5: 该 file input 的 accept 含 .json', !!fileInput && (fileInput.attributes.accept || '').includes('.json'));
  });

  // ---------------- 6. 确认按钮文案：默认「删除」 vs doLogout「确认退出」----------------
  await test('6-确认按钮文案-默认删除与退出登录确认退出', async () => {
    // 6a：confirmDialog 不传 okText → 确定按钮默认「删除」(btn-danger)
    resetDom();
    setSb('online');
    setState({ view: 'home', projects: [], userId: null, userEmail: null, offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('confirmDialog("确定删除该小说？")');
    await tick();
    const okDefault = findBtnByText(modalRoot, '删除');
    assert('6a: 不传 okText 时确定按钮文本为「删除」', !!okDefault && (okDefault.textContent || '').trim() === '删除');
    assert('6a: 不传 okText 时确定按钮带 btn-danger 类', !!okDefault && okDefault._classes.has('btn-danger'));

    // 6b：doLogout() 传入 okText='确认退出'，用桩捕获参数并验证弹窗确定按钮文本
    resetDom();
    setSb('online');
    ev('__origConfirmDialog = confirmDialog;');
    setState({ view: 'home', projects: [], userId: 'u-logout', userEmail: 'lo@b.com', offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });
    ev('confirmDialog = (msg, okText) => { window.__logoutMsg = msg; window.__logoutOkText = okText; window.__logoutCalled = true; return Promise.resolve(true); };');
    const p = ev('doLogout()');
    await p; // 等待异步登出流程完成（捕获参数在首个 await 前已同步发生）
    const okText = ev('window.__logoutOkText');
    assert('6b: doLogout() 向 confirmDialog 传入 okText=「确认退出」', okText === '确认退出');
    const msg = ev('window.__logoutMsg');
    assert('6b: doLogout() 传入的提示文案含「退出登录」', typeof msg === 'string' && msg.includes('退出登录'));
    // 用真实 confirmDialog 在 DOM 中验证确定按钮文本（桩仅捕获参数，下面用真函数再开一次）
    ev('confirmDialog = __origConfirmDialog;');
    resetDom();
    ev('doLogout()'); // 不 await，仅验证同步产生的弹窗确定按钮文本
    await tick();
    const logoutOk = findBtnByText(modalRoot, '确认退出');
    assert('6b: doLogout() 真实弹窗的确定按钮文本为「确认退出」', !!logoutOk && (logoutOk.textContent || '').trim() === '确认退出');
    assert('6b: 真实弹窗确定按钮带 btn-danger 类', !!logoutOk && logoutOk._classes.has('btn-danger'));
  });

  // ---------------- 7. 回归：删/建项目多次重渲染 #account-btn 始终存在 + 无 #sync-bar ----------------
  await test('7-回归-删建重渲染后首页头像按钮始终存在且无sync-bar', async () => {
    resetDom();
    setSb('online');
    setState({ view: 'home', userId: null, userEmail: null, offlineMode: false, isOnline: true, syncStatus: 'idle', currentProject: null });

    ev('render()');
    await tick();
    assert('7: 初始 render 后 #account-btn 存在', !!documentStub.getElementById('account-btn'));

    setState({ projects: [makeProject('p1', '小说A')] });
    ev('render()'); await tick();
    assert('7: 新建项目后 render → #account-btn 存在', !!documentStub.getElementById('account-btn'));

    setState({ projects: [] });
    ev('render()'); await tick();
    assert('7: 删除项目后 render → #account-btn 存在', !!documentStub.getElementById('account-btn'));

    setState({ projects: [makeProject('p2', '小说B'), makeProject('p3', '小说C')] });
    ev('render()'); await tick();
    assert('7: 再次新建多个后 render → #account-btn 存在', !!documentStub.getElementById('account-btn'));

    setState({ projects: [makeProject('p3', '小说C')] });
    ev('render()'); await tick();
    assert('7: 再删除后 render → #account-btn 存在', !!documentStub.getElementById('account-btn'));

    let okAll = true;
    for (let i = 0; i < 3; i++) {
      setState({ projects: [makeProject('c' + i, '循环' + i)] });
      ev('render()'); await tick();
      if (!documentStub.getElementById('account-btn')) okAll = false;
    }
    assert('7: 连续 3 次删建重渲染循环后 #account-btn 始终存在', okAll);

    ev('refreshSyncBar();');
    await tick();
    assert('7: 渲染后全文件不再存在 #sync-bar 节点（getElementById 为 null）', documentStub.getElementById('sync-bar') === null);
    assert('7: 源码中无 id:"sync-bar" 创建节点', !/id:\s*['"]sync-bar['"]/.test(html));
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
console.log('# 回归测试报告 — 6 项 UI/UX 调整（独立验证，vm 加载真实代码）');
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
  const coreFail = failedCases.some(r => r.name.startsWith('1:') || r.name.startsWith('2:') || r.name.startsWith('3:') || r.name.startsWith('4:') || r.name.startsWith('5:') || r.name.startsWith('6:') || r.name.startsWith('7:'));
  routing = coreFail
    ? 'Engineer（核心场景失败：疑似源码 Bug，附失败断言与上下文待工程师排查）'
    : 'QA（非核心场景失败：疑似测试桩/断言问题，需修测试代码）';
  foundBug = coreFail;
} else {
  routing = 'NoOne（全部通过：确认 6 项改动有效，未引入回归）';
  foundBug = false;
}

console.log('\n路由判定: ' + routing);
console.log('是否发现源码 Bug: ' + (foundBug ? '是（见失败明细，待工程师核实）' : '否'));
console.log('==================================================');

const exitCode = failed > 0 ? 1 : 0;
process.exit(exitCode);
