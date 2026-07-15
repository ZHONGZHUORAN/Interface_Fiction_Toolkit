// ============================================================================
// qa-newproj-bugfix.mjs
// 单文件小说编辑器 —— 「离线模式（file:// 下 getSb()=null → offlineMode=true）新建项目
// 后返回首页，新项目不出现在列表（老项目正常）」Bug 的独立回归测试。
//
// 测试策略（复用 qa-sync-test.mjs / qa-sync-bugfix.mjs 的沙箱手法）：
//   用 Node `vm` 加载 index.html 中【真实的两段 <script> 代码】，在受控沙箱中运行
//   （不复制业务函数，测的是真代码）。
//   沙箱提供：
//     - faithful 轻量 DOM 实现（可遍历、支持 querySelector/All，验证 .proj-card 真实存在）
//     - navigator / 内存版 localStorage
//     - __import 桩：createClient 可脚本化为 null（离线）或 FAKE 客户端（在线）→ 控制 getSb()
//     - 内存版 IndexedDB 桩（可控 idbGetAll，用于确定性复现 file:// 读回时序边角）
//
// 修复点（已在 index.html 落地，仅验证、不修改源码）：
//   1) openNewProjectModal 的 ok 回调（约 1658 行）：await idbPut(p) 之后新增
//        if(!state.projects.some(x=>x.id===p.id)) state.projects.push(p);
//        state.projects.sort(...) —— 新建立即进内存列表（幂等）。
//   2) goHome()（约 817 行）：将盲覆盖改为按 id 合并 —— 索引读回优先建 Map，
//      再把内存 state.projects 中未被读回覆盖的项目并入（兜底）。
//
// 覆盖场景：
//   A 主路径·离线：新建→idbGetAll=3、state.projects=3→goHome→首页 .proj-card=3（含新项目）。
//   B 读回缺失·离线（核心回归，确定性复现用户现象）：令 idbGetAll 本次不返回刚写入新项目，
//     因修复点1 新项目已在 state.projects 且修复点2 合并兜底，goHome 后仍显示 3 张卡片、不丢。
//   C 在线/登录模式：getSb 返回可用 fake 客户端，新建→goHome→列表=3、含新建（合并幂等）。
//   D 无回归·删除：goHome 合并后删除某老项目→renderHome 卡片正确减少且不“假复活”。
//   E 无回归·导入：triggerImport 路径 push+renderHome，导入项目出现在列表（不被 goHome 合并冲掉）。
//   F 无回归·既有纯函数：复用 toCloudRow/fromCloudRow/OfflineQueue/validateEmail/
//     translateAuthError/LWW 断言，确认同步逻辑未回归。
//
// 运行：C:\Users\zhh50\workbuddy\binaries\node\versions\22.22.2\node.exe qa-newproj-bugfix.mjs
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

// __import 桩：createClient 返回值由 sbMode 控制（null=离线、FAKE=在线可用）
let sbReturn = null;
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

// ---------------------------------------------------------------------------
// 5) 真实 IndexedDB 由内存桩替代（Node 无 IndexedDB；这是测试桩而非改源码）
//    - laggedIds：模拟 file:// 下“刚写入记录尚未被索引读回可见”的时序边角。
//      idbGetAll 在场景 B 中据此过滤，确定性复现用户现象。
// ---------------------------------------------------------------------------
const mem = new Map();
let laggedIds = new Set();
ctx.idbGetAll = async () => [...mem.values()].filter(p => !laggedIds.has(p.id));
ctx.idbGet = async (id) => (mem.has(id) ? mem.get(id) : null);
ctx.idbPut = async (p) => { mem.set(p.id, p); };
ctx.idbDelete = async (id) => { mem.delete(id); };

// ---------------------------------------------------------------------------
// 6) 测试工具
// ---------------------------------------------------------------------------
const ev = (code) => vm.runInContext(code, ctx, { filename: 'test.js' });
const evA = (code) => vm.runInContext(code, ctx, { filename: 'test.js' });  // 可 await（返回 Promise）
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const setField = (k, v) => ev(`state.${k} = ${JSON.stringify(v)}`);
const setProjects = (arr) => ev(`state.projects = ${JSON.stringify(arr)}`);

function configSb(opts) {
  FAKE.__calls.length = 0;
  FAKE.__setResponder((op) => {
    if (op.kind === 'select' && op.hasMaybeSingle) return { data: (opts.single !== undefined ? opts.single : null), error: null };
    if (op.kind === 'select') return { data: opts.list || [], error: null };
    return { error: null };
  });
}
const hasUpsert = (id) => FAKE.__calls.some(c => c.kind === 'upsert' && c.payload && c.payload.id === id);

// ---- 离线/在线模式切换（控制 getSb 的返回值）----
function setSbMode(mode) {
  sbReturn = (mode === 'online') ? FAKE : null;
  ev('__sb=null; __sbFailed=false; __sbPromise=null;');
}

// ---- bugfix 专用辅助 ----
function findButtonByText(root, text) {
  return root.querySelectorAll('button').find(b => (b.textContent || '').trim() === text) || null;
}
function resetDom() {
  modalRoot.childNodes.length = 0;
  topbar.childNodes.length = 0;
  appEl.childNodes.length = 0;
  // 清理 triggerImport 可能遗留的 file input
  body.querySelectorAll('input').forEach(n => n.remove());
}
function makeSeed(i) {
  const base = {
    type: 'forum', createdAt: 1000, updatedAt: 1000,
    data: { coverImage: null, cover: { title: '', body: '', images: [], author: '', avatar: null }, floors: [], settings: { showTime: false, pageRatio: '9:16', pageHeightPx: null } }
  };
  const p = JSON.parse(JSON.stringify(base));
  p.id = 'old' + i;
  p.title = '老项目' + i;
  return p;
}
function seedOld(n = 2) {
  mem.clear();
  laggedIds = new Set();
  const arr = [];
  for (let i = 1; i <= n; i++) {
    const p = makeSeed(i);
    mem.set(p.id, p);
    arr.push(p);
  }
  setProjects(arr);
}
function getCards() { return appEl.querySelectorAll('.proj-card'); }
function cardTitleSet() {
  return new Set(getCards().map(c => {
    const t = c.querySelector('.proj-title');
    return t ? (t.textContent || '').trim() : '';
  }));
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
// 7) 测试用例
// ---------------------------------------------------------------------------
if (loadError) {
  assert('脚本加载不抛未捕获异常', false, String(loadError && loadError.stack || loadError));
} else {

  // ---------------- A. 主路径·离线：新建后返回首页列表含新项目 ----------------
  await test('A-主路径-离线新建后返回首页列表含新项目', async () => {
    seedOld(2);
    setSbMode('offline');
    setField('offlineMode', true);
    setField('view', 'home');

    ev('openNewProjectModal()');
    const okBtn = findButtonByText(modalRoot, '创建');
    assert('A: 新建弹窗含"创建"按钮', !!okBtn);
    okBtn.click();
    await tick(); await tick();

    // 注意：vm.runInContext 不支持顶层 await，故用 .then 取结果
    const idbLen = await evA('idbGetAll().then(a=>a.length)');
    assert('A: 新建后 idbGetAll 数量=3（含新项目，idbPut 已落盘）', idbLen === 3);
    const inMem = ev('state.projects.length');
    assert('A: 修复点1 生效 — state.projects.length=3（修复前为 2）', inMem === 3);
    const newInMem = ev('state.projects.some(p=>p.title==="未命名小说")');
    assert('A: 新建默认标题"未命名小说"已在内存列表', newInMem === true);

    ev('goHome()');
    await tick(); await tick();
    const cards = getCards();
    assert('A: goHome 后首页 .proj-card 数量=3', cards.length === 3);
    assert('A: 首页卡片含新建项目', cardTitleSet().has('未命名小说'));
    assert('A: 首页卡片含老项目1', cardTitleSet().has('老项目1'));
    assert('A: 首页卡片含老项目2', cardTitleSet().has('老项目2'));
  });

  // ---------------- B. 读回缺失·离线：核心回归（确定性复现用户现象）----------------
  await test('B-核心回归-idbGetAll读回缺失时新项目不丢', async () => {
    seedOld(2);
    setSbMode('offline');
    setField('offlineMode', true);
    setField('view', 'home');

    ev('openNewProjectModal()');
    const okBtn = findButtonByText(modalRoot, '创建');
    okBtn.click();
    await tick(); await tick();

    // 此刻内存列表已含新项目（修复点1）。人为让本次 idbGetAll 不返回刚写入的新项目，
    // 模拟 file:// 下索引读回时序未返回刚写入记录。
    const newIds = ev('state.projects.filter(p=>!["old1","old2"].includes(p.id)).map(p=>p.id)');
    assert('B: 新建后内存列表确含新项目(待测试项)', Array.isArray(newIds) && newIds.length === 1);
    laggedIds = new Set(newIds);

    const idbLenLagged = await evA('idbGetAll().then(a=>a.length)');
    assert('B: 模拟 file:// 时序 —— 本次 idbGetAll 仅=2（新项目暂不可见）', idbLenLagged === 2);
    const inMemBefore = ev('state.projects.length');
    assert('B: 修复点1 保证内存列表仍=3', inMemBefore === 3);

    ev('goHome()');
    await tick(); await tick();

    const idbLenAfter = await evA('idbGetAll().then(a=>a.length)');
    assert('B: goHome 后 idbGetAll 仍=2（读回未变，仅为对照）', idbLenAfter === 2);
    const inMemAfter = ev('state.projects.length');
    assert('B: 修复点2 合并兜底 —— goHome 后内存列表仍=3（新项目未丢）', inMemAfter === 3);
    const cards = getCards();
    assert('B: 核心断言 —— goHome 后首页仍显示 3 张卡片（修复前为 2）', cards.length === 3);
    assert('B: 首页卡片含新建项目（未被覆盖丢失）', cardTitleSet().has('未命名小说'));
    assert('B: 首页卡片含老项目1', cardTitleSet().has('老项目1'));
  });

  // ---------------- C. 在线/登录模式：合并逻辑幂等，行为不变 ----------------
  await test('C-在线模式-新建后列表=3且合并逻辑幂等', async () => {
    seedOld(2);
    setSbMode('online');
    setField('offlineMode', false);
    setField('view', 'home');
    configSb({ list: [] });  // pullAll 返回空数组
    const sb = await evA('getSb()');
    assert('C: getSb 返回可用 fake 客户端', sb === FAKE);

    ev('openNewProjectModal()');
    const okBtn = findButtonByText(modalRoot, '创建');
    okBtn.click();
    await tick(); await tick();

    const inMem = ev('state.projects.length');
    assert('C: 在线新建后 state.projects.length=3', inMem === 3);
    const idbLen = await evA('idbGetAll().then(a=>a.length)');
    assert('C: 在线新建后 idbGetAll=3', idbLen === 3);

    ev('goHome()');
    await tick(); await tick();
    const cards = getCards();
    assert('C: goHome 后首页 .proj-card 数量=3', cards.length === 3);
    assert('C: 首页卡片含新建项目', cardTitleSet().has('未命名小说'));
  });

  // ---------------- D. 无回归·删除：goHome 合并后删除某老项目不假复活 ----------------
  await test('D-无回归-删除老项目后不假复活', async () => {
    seedOld(2);
    setSbMode('offline');
    setField('offlineMode', true);
    setField('view', 'home');
    ev('renderHome()');
    await tick();

    let cardsBefore = getCards();
    assert('D: 删除前首页卡片=2', cardsBefore.length === 2);

    // 点击第一张卡片的"删除"按钮 → 弹出 confirmDialog → 点击确认"删除"
    const firstCard = cardsBefore[0];
    const delBtn = firstCard.querySelectorAll('button').find(b => (b.textContent || '').trim() === '删除');
    assert('D: 卡片含"删除"按钮', !!delBtn);
    delBtn.click();
    await tick(); await tick();  // confirmDialog 打开

    const dialogOk = findButtonByText(modalRoot, '删除');
    assert('D: confirmDialog 出现确认"删除"按钮', !!dialogOk);
    dialogOk.click();
    await tick(); await tick();  // 确认删除：idbDelete + state.projects filter + renderHome

    const inMemAfterDel = ev('state.projects.length');
    assert('D: 删除后内存列表=1', inMemAfterDel === 1);
    const idbAfterDel = await evA('idbGetAll().then(a=>a.length)');
    assert('D: 删除后 idb=1', idbAfterDel === 1);
    const cardsAfterDel = getCards();
    assert('D: 删除后 renderHome 卡片=1', cardsAfterDel.length === 1);

    // 调用 goHome —— 合并逻辑不应让已删项目"假复活"
    ev('goHome()');
    await tick(); await tick();
    const inMemHome = ev('state.projects.length');
    assert('D: goHome 后内存列表仍=1（未假复活）', inMemHome === 1);
    const cardsHome = getCards();
    assert('D: goHome 后首页卡片仍=1（已删项目未复活）', cardsHome.length === 1);
    assert('D: 首页卡片为剩余的老项目', cardTitleSet().has('老项目2') && !cardTitleSet().has('老项目1'));
  });

  // ---------------- E. 无回归·导入：导入项目出现在列表，不被 goHome 合并冲掉 ----------------
  await test('E-无回归-导入项目出现在列表且不被合并冲掉', async () => {
    seedOld(2);
    setSbMode('offline');
    setField('offlineMode', true);
    setField('view', 'home');

    // 触发导入（triggerImport 会创建 file input 并注册 change 监听，然后调用 inp.click()=no-op）
    ev('renderHome()');
    await tick();
    ev('triggerImport()');
    await tick();

    const fileInput = body.querySelectorAll('input').find(i => i.attributes.type === 'file');
    assert('E: triggerImport 已创建 file input', !!fileInput);
    const imp = { id: 'imp-seed', title: '导入小说', type: 'forum', createdAt: 5000, updatedAt: 5000,
      data: { coverImage: null, cover: { title: '导入小说', body: '', images: [], author: '', avatar: null }, floors: [], settings: { showTime: false, pageRatio: '9:16', pageHeightPx: null } } };
    fileInput.files = [{ text: async () => JSON.stringify(imp) }];
    (fileInput.listeners['change'] || []).forEach(fn => fn({ target: fileInput }));
    await tick(); await tick();

    const inMem = ev('state.projects.length');
    assert('E: 导入后内存列表=3（2 老 + 1 导入，导入会重新分配 uid → 以标题识别）', inMem === 3);
    const hasImported = ev('state.projects.some(p=>p.title==="导入小说")');
    assert('E: 导入项目已加入内存列表', hasImported === true);
    const idbLen = await evA('idbGetAll().then(a=>a.length)');
    assert('E: 导入后 idb=3', idbLen === 3);
    assert('E: 导入后 renderHome 卡片=3', getCards().length === 3);

    // 关键：goHome 合并不应把导入项目冲掉
    ev('goHome()');
    await tick(); await tick();
    const inMemHome = ev('state.projects.length');
    assert('E: goHome 合并后列表仍=3', inMemHome === 3);
    assert('E: goHome 后导入项目仍在列表', cardTitleSet().has('导入小说'));
  });

  // ---------------- F. 无回归·既有纯函数（同步逻辑） ----------------
  await test('F-无回归-既有纯函数断言(toCloudRow/fromCloudRow/OfflineQueue/validateEmail/translateAuthError/LWW)', async () => {
    assert('F: toCloudRow 为函数', typeof ev('toCloudRow') === 'function');
    assert('F: fromCloudRow 为函数', typeof ev('fromCloudRow') === 'function');
    assert('F: OfflineQueue 为对象', typeof ev('OfflineQueue') === 'object' && ev('OfflineQueue') !== null);
    assert('F: validateEmail 为函数', typeof ev('validateEmail') === 'function');
    assert('F: translateAuthError 为函数', typeof ev('translateAuthError') === 'function');
    assert('F: pullAllAndMerge 为函数', typeof ev('pullAllAndMerge') === 'function');
    assert('F: pullLatest 为函数', typeof ev('pullLatest') === 'function');

    // toCloudRow
    const p = { id: 'p1', title: '小说A', type: 'forum', createdAt: 1000, updatedAt: 2000, data: { coverImage: { dataUrl: 'durl', name: 'n' }, cover: {}, floors: [], settings: {} } };
    const r = ev(`toCloudRow(${JSON.stringify(p)}, "user-xyz")`);
    assert('F: toCloudRow.id 正确', r.id === 'p1');
    assert('F: toCloudRow.owner_id 正确', r.owner_id === 'user-xyz');
    assert('F: toCloudRow.cover_image 取自 data.coverImage', r.cover_image && r.cover_image.dataUrl === 'durl');
    assert('F: toCloudRow.updated_at 为 ISO 且等于 2000ms', r.updated_at === new Date(2000).toISOString());

    // fromCloudRow
    const iso = '2024-01-02T03:04:05.678Z'; const ms = Date.parse(iso);
    const row = { id: 'r1', title: '云小说', type: 'pickup', created_at: iso, updated_at: iso, data: { x: 1 } };
    const pf = ev(`fromCloudRow(${JSON.stringify(row)})`);
    assert('F: fromCloudRow.id 正确', pf.id === 'r1');
    assert('F: fromCloudRow.updatedAt 回转毫秒', pf.updatedAt === ms);
    assert('F: fromCloudRow.data 正确', pf.data && pf.data.x === 1);

    // roundtrip
    const pr = { id: 'rt1', title: '往返小说', type: 'forum', createdAt: 111, updatedAt: 222, data: { coverImage: { dataUrl: 'du', name: 'n' }, cover: {}, floors: [], settings: {} } };
    const back = ev(`fromCloudRow(toCloudRow(${JSON.stringify(pr)}, "u"))`);
    assert('F: roundtrip.id 一致', back.id === pr.id);
    assert('F: roundtrip.data 一致', JSON.stringify(back.data) === JSON.stringify(pr.data));

    // OfflineQueue
    localStorageStub.clear();
    ev('OfflineQueue.enqueue({op:"push", id:"a"})');
    ev('OfflineQueue.enqueue({op:"push", id:"a"})');
    assert('F: OfflineQueue 同 id+op 去重后 pendingCount=1', ev('OfflineQueue.pendingCount()') === 1);
    ev('OfflineQueue.remove("a")');
    assert('F: OfflineQueue.remove(id) 后 pendingCount=0', ev('OfflineQueue.pendingCount()') === 0);
    localStorageStub.clear();

    // validateEmail
    assert('F: validateEmail 合法 a@b.com', ev('validateEmail("a@b.com")') === true);
    assert('F: validateEmail 非法 无@', ev('validateEmail("abc")') === false);
    assert('F: validateEmail 非法 空串', ev('validateEmail("")') === false);

    // translateAuthError
    const f = (m) => ev(`translateAuthError(${JSON.stringify({ message: m })})`);
    assert('F: translateAuthError invalid credentials', f('Invalid login credentials').includes('邮箱或密码错误'));
    assert('F: translateAuthError already registered', f('User already registered').includes('已注册'));
    assert('F: translateAuthError network', f('Failed to fetch').includes('网络异常'));
    assert('F: translateAuthError 默认分支', f('some weird error').startsWith('操作失败'));

    // LWW: pullAllAndMerge 云新覆盖本地
    // 关键：pullAll/pullLatest/pushProject 在 getSb()=null（离线）时会提前返回 []/null/enqueue，
    // 必须用在线模式（getSb 返回 FAKE）才能走真实合并/推送分支。
    setSbMode('online');
    mem.clear(); configSb({ list: [{ id: 'a', title: 'Cloud', type: 'forum', created_at: new Date(1000).toISOString(), updated_at: new Date(5000).toISOString(), data: {} }] });
    setField('userId', 'u-lww'); setField('isOnline', true);
    setProjects([{ id: 'a', title: 'Local', type: 'forum', createdAt: 1000, updatedAt: 1000, data: {} }]);
    await evA('pullAllAndMerge()');
    await tick();
    let s = ev('state.projects.map(p=>({id:p.id,updatedAt:p.updatedAt}))');
    const a = s.find(x => x.id === 'a');
    assert('F: LWW 云较新 → merged 含 a 且 updatedAt≈5000', a && Math.abs(a.updatedAt - 5000) < 2);
    assert('F: LWW 云较新 → 不向云推送 a', !hasUpsert('a'));

    // LWW: pullAllAndMerge 本地新推云
    mem.clear(); configSb({ list: [{ id: 'a', title: 'Cloud', type: 'forum', created_at: new Date(1000).toISOString(), updated_at: new Date(1000).toISOString(), data: {} }] });
    setField('userId', 'u-lww'); setField('isOnline', true);
    setProjects([{ id: 'a', title: 'Local', type: 'forum', createdAt: 5000, updatedAt: 5000, data: {} }]);
    await evA('pullAllAndMerge()');
    await tick();
    s = ev('state.projects.map(p=>({id:p.id,updatedAt:p.updatedAt}))');
    const a2 = s.find(x => x.id === 'a');
    assert('F: LWW 本地较新 → merged 含 a 且 updatedAt≈5000', a2 && Math.abs(a2.updatedAt - 5000) < 2);
    assert('F: LWW 本地较新 → 向云推送 a', hasUpsert('a'));

    // LWW: pullAllAndMerge 云独有并入
    mem.clear(); configSb({ list: [{ id: 'c', title: 'OnlyCloud', type: 'forum', created_at: new Date(2000).toISOString(), updated_at: new Date(2000).toISOString(), data: {} }] });
    setField('userId', 'u-lww'); setField('isOnline', true);
    setProjects([]);
    await evA('pullAllAndMerge()');
    await tick();
    s = ev('state.projects.map(p=>({id:p.id}))');
    assert('F: LWW 云独有 → merged 含 c', s.some(x => x.id === 'c'));
    assert('F: LWW 云独有 → 不向云推送 c', !hasUpsert('c'));

    // pullLatest 云新覆盖本地
    mem.clear();
    const cloudRow = { id: 'x', title: 'CloudX', type: 'forum', created_at: new Date(1000).toISOString(), updated_at: new Date(5000).toISOString(), data: { k: 'v' } };
    configSb({ single: cloudRow });
    setField('userId', 'u-pl'); setField('isOnline', true);
    setProjects([]); ev('state.currentProject = ' + JSON.stringify({ id: 'x', title: 'LocalX', type: 'forum', createdAt: 1000, updatedAt: 1000, data: {} }));
    const res = await evA('pullLatest("x")');
    await tick();
    assert('F: pullLatest 云新返回云端版本', res && Math.abs(res.updatedAt - 5000) < 2);
    assert('F: pullLatest 云新不向云推送', !hasUpsert('x'));
    assert('F: pullLatest 云新持久化到本地缓存 idbPut', mem.has('x'));

    // pullLatest 云缺失返回 null
    mem.clear(); configSb({ single: null });
    setField('userId', 'u-pl'); setField('isOnline', true);
    setProjects([]); ev('state.currentProject = null');
    const resNull = await evA('pullLatest("nope")');
    assert('F: pullLatest 云返回 null → 返回 null', resNull === null);
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
console.log('# 回归测试报告 — 离线模式新建项目返回首页丢失 (Bug 修复验证)');
console.log(`总断言: ${total} | 通过: ${passed} | 失败: ${failed}`);
if (loadError) console.log('加载阶段错误：已拦截未捕获异常（见上）。');
if (failed > 0) {
  console.log('\n失败明细：');
  failedCases.forEach(r => console.log(`  - ${r.name} ${r.detail ? '(' + r.detail + ')' : ''}`));
}

// 路由判定：源码 Bug → Engineer；测试代码问题 → QA（此处不自行改，交说明）；全部通过 → NoOne
let routing, confirmedFix, foundBug;
if (loadError) {
  routing = 'QA（加载/初始化阶段异常，疑似测试环境或桩问题，需排查沙箱）';
  confirmedFix = '未能完成（加载失败）';
  foundBug = false;
} else if (failed > 0) {
  // 区分：若失败出现在 A/B（新建主路径与核心回归）→ 高度疑似源码 Bug；否则可能是测试桩问题
  const coreFail = failedCases.some(r => r.name.startsWith('A:') || r.name.startsWith('B:'));
  routing = coreFail
    ? 'Engineer（核心场景 A/B 失败：疑似源码 Bug，附失败断言与行号待工程师排查）'
    : 'QA（非核心场景失败：疑似测试桩/断言问题，需修测试代码）';
  confirmedFix = '未能全部通过（见失败明细）';
  foundBug = coreFail;
} else {
  routing = 'NoOne（全部通过：确认修复有效，未引入回归）';
  confirmedFix = '已确认修复 — 场景 B 在 idbGetAll 读回缺失时首页仍显示 3 张卡片；场景 A/C 新建后列表=3；D/E 删除/导入无假复活/冲掉';
  foundBug = false;
}

console.log('\n路由判定: ' + routing);
console.log('是否确认修复: ' + confirmedFix);
console.log('是否发现源码 Bug: ' + (foundBug ? '是（见失败明细，待工程师核实）' : '否'));
console.log('==================================================');

const exitCode = failed > 0 ? 1 : 0;
process.exit(exitCode);
