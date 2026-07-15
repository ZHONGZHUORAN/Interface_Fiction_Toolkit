// ============================================================================
// qa-sync-test.mjs
// 单文件小说编辑器「邮箱登录 + Supabase 云同步」增量模块 —— 自动化测试
//
// 测试策略：
//   用 Node `vm` 模块加载 index.html 中【真实的两段 <script> 代码】，
//   在受控沙箱中运行（不复制业务函数，测的是真代码）。
//   沙箱提供：轻量 DOM stub、navigator、内存版 localStorage、fake Supabase 客户端
//   （__import 桩替换真实的 esm.sh 动态导入），从而可对纯逻辑做断言，
//   并对 LWW 冲突策略预设云端返回值。
//
// 被测逻辑重点：toCloudRow / fromCloudRow / 往返 / OfflineQueue /
//   validateEmail / translateAuthError / LWW(pullAllAndMerge / pullLatest) /
//   加载与渲染无回归冒烟。
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
    // 真正执行发生在被 await 时（调用 then）。因此这里让 builder 实现 then 来作为终止点。
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
// 3) 轻量 DOM / 浏览器环境 stub
// ---------------------------------------------------------------------------
function makeEl(tag) {
  const children = []; const attrs = {}; const classes = new Set(); const listeners = {};
  const el = {
    tagName: tag, children, attrs, listeners,
    style: {},
    value: '', checked: false, selected: false, disabled: false, files: [],
    _className: '',
    get className() { return this._className; },
    set className(v) { this._className = v || ''; classes.clear(); String(v || '').split(/\s+/).forEach(c => { if (c) classes.add(c); }); },
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = v; if (v === '') children.length = 0; },
    _text: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; },
    setAttribute(k, v) { attrs[k] = v; },
    getAttribute(k) { return attrs[k]; },
    appendChild(c) { children.push(c); return c; },
    removeChild(c) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); return c; },
    remove() {},
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    get classList() { return { add: c => classes.add(c), remove: c => classes.delete(c), toggle: (c, f) => { if (f === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else { f ? classes.add(c) : classes.delete(c); } }, contains: c => classes.has(c) }; },
    replaceWith() {}, focus() {}, select() {}, click() {}, removeAttribute() {}, contains() { return false; }
  };
  return el;
}
const appEl = makeEl('div');
const documentStub = {
  readyState: 'loading',           // 关键：让首屏 bootstrap 仅注册 DOMContentLoaded 监听，不直接跑 init，便于受控测试
  body: makeEl('body'),
  createElement: (t) => makeEl(t),
  createTextNode: (t) => ({ nodeType: 3, text: String(t) }),
  getElementById: (id) => (id === 'app' ? appEl : null),
  querySelector: () => null,
  querySelectorAll: () => [],
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
  catch (e) { assert(name + '（未抛异常）', false, '抛出异常: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
}

// ---------------------------------------------------------------------------
// 6) 测试用例
// ---------------------------------------------------------------------------
if (loadError) {
  assert('脚本加载不抛未捕获异常', false, String(loadError && loadError.stack || loadError));
} else {
  await test('SMOKE-加载与 initSync 无回归', async () => {
    // 加载即不抛错，且被测函数均为可调用的函数对象
    assert('toCloudRow 为函数', typeof ev('toCloudRow') === 'function');
    assert('fromCloudRow 为函数', typeof ev('fromCloudRow') === 'function');
    assert('OfflineQueue 为对象', typeof ev('OfflineQueue') === 'object' && ev('OfflineQueue') !== null);
    assert('validateEmail 为函数', typeof ev('validateEmail') === 'function');
    assert('translateAuthError 为函数', typeof ev('translateAuthError') === 'function');
    assert('pullAllAndMerge 为函数', typeof ev('pullAllAndMerge') === 'function');
    assert('pullLatest 为函数', typeof ev('pullLatest') === 'function');

    // 运行真实 initSync（包裹原函数 + 初始化 state 新增字段 + 懒加载 supabase 桩）
    await evAsync('initSync()');
    const s = getState();
    assert('augmentState 初始化新增 sync 字段', s.hasSyncFields);
    assert('state.syncStatus 初始 idle', s.syncStatus === 'idle');
    assert('state.isOnline 初始 true', s.isOnline === true);
    assert('state.userId 初始 null', s.userId === null);
    assert('wrapRender 已包裹 render', typeof ev('render') === 'function');

    // 关键回归：包裹后 render() 正常渲染首页不抛错，且不破坏既有字段
    try {
      ev('state.view="home"; state.projects=[]; state.userId="smoke-user"; render();');
      assert('render() 包裹后渲染空首页不抛错', true);
    } catch (e) { assert('render() 包裹后渲染空首页不抛错', false, String(e)); }
    // 渲染含项目卡片
    try {
      ev(`state.projects=[{id:"hp1",title:"冒烟小说",type:"forum",createdAt:${Date.now()},updatedAt:${Date.now()},data:{coverImage:{dataUrl:"data:image/png;base64,AAA",name:"c.png"},cover:{title:"",body:"",images:[],author:"",avatar:null},floors:[],settings:{showTime:false,pageRatio:"9:16",pageHeightPx:null}}}]; render();`);
      assert('render() 含项目卡片不抛错', true);
    } catch (e) { assert('render() 含项目卡片不抛错', false, String(e)); }
    const s2 = getState();
    assert('既有字段未被破坏（view 仍为 home）', s2.view === 'home');
    assert('既有字段未被破坏（projects 仍为数组）', Array.isArray(s2.projects));
  });

  await test('toCloudRow-字段映射', async () => {
    const p = { id: 'p1', title: '小说A', type: 'forum', createdAt: 1000, updatedAt: 2000, data: { coverImage: { dataUrl: 'durl', name: 'n' }, cover: {}, floors: [], settings: {} } };
    const r = ev(`toCloudRow(${JSON.stringify(p)}, "user-xyz")`);
    assert('id 正确', r.id === 'p1');
    assert('owner_id 正确', r.owner_id === 'user-xyz');
    assert('type 正确', r.type === 'forum');
    assert('title 正确', r.title === '小说A');
    assert('cover_image 取自 data.coverImage', r.cover_image && r.cover_image.dataUrl === 'durl');
    assert('data 正确（深比较一致）', JSON.stringify(r.data) === JSON.stringify(p.data));
    assert('updated_at 为 ISO 且等于 2000ms', r.updated_at === new Date(2000).toISOString());
  });

  await test('toCloudRow-默认值与 null cover', async () => {
    const p = { id: 'p2', data: {} };
    const r = ev(`toCloudRow(${JSON.stringify(p)}, "u2")`);
    assert('title 默认 未命名小说', r.title === '未命名小说');
    assert('type 默认 forum', r.type === 'forum');
    assert('cover_image 为 null 当无 coverImage', r.cover_image === null);
    assert('updated_at 用 Date.now 兜底', typeof r.updated_at === 'string' && !isNaN(Date.parse(r.updated_at)));
  });

  await test('fromCloudRow-时间回转与默认值', async () => {
    const iso = '2024-01-02T03:04:05.678Z';
    const ms = Date.parse(iso);
    const row = { id: 'r1', title: '云小说', type: 'pickup', created_at: iso, updated_at: iso, data: { x: 1 } };
    const p = ev(`fromCloudRow(${JSON.stringify(row)})`);
    assert('id 正确', p.id === 'r1');
    assert('title 正确', p.title === '云小说');
    assert('type 正确', p.type === 'pickup');
    assert('createdAt 回转毫秒', p.createdAt === ms);
    assert('updatedAt 回转毫秒', p.updatedAt === ms);
    assert('data 正确', p.data && p.data.x === 1);

    const row2 = { id: 'r2' };
    const p2 = ev(`fromCloudRow(${JSON.stringify(row2)})`);
    assert('缺 type 默认 forum', p2.type === 'forum');
    assert('缺 created_at 兜底 Date.now', typeof p2.createdAt === 'number' && p2.createdAt > 0);
    assert('缺 updated_at 兜底 Date.now', typeof p2.updatedAt === 'number' && p2.updatedAt > 0);
    assert('缺 data 默认 {}', p2.data && typeof p2.data === 'object');
  });

  await test('roundtrip-toCloudRow/fromCloudRow', async () => {
    const p = { id: 'rt1', title: '往返小说', type: 'forum', createdAt: 111, updatedAt: 222, data: { coverImage: { dataUrl: 'du', name: 'n' }, cover: {}, floors: [], settings: {} } };
    const back = ev(`fromCloudRow(toCloudRow(${JSON.stringify(p)}, "u"))`);
    assert('id 一致', back.id === p.id);
    assert('title 一致', back.title === p.title);
    assert('type 一致', back.type === p.type);
    assert('data 一致', JSON.stringify(back.data) === JSON.stringify(p.data));
    assert('updatedAt 一致(容差<2ms)', Math.abs(back.updatedAt - p.updatedAt) < 2);
    // 设计说明：toCloudRow 不携带 created_at，故往返后 createdAt 走兜底（符合架构约定，非 Bug）
  });

  await test('OfflineQueue-去重/计数/移除/持久化', async () => {
    localStorageStub.clear();
    ev('OfflineQueue.enqueue({op:"push", id:"a"})');
    ev('OfflineQueue.enqueue({op:"push", id:"a"})');             // 同 id+op 去重
    assert('同 id+op 去重后 pendingCount=1', ev('OfflineQueue.pendingCount()') === 1);
    ev('OfflineQueue.enqueue({op:"delete", id:"a"})');          // 不同 op 不视作重复
    assert('不同 op 计入 → pendingCount=2', ev('OfflineQueue.pendingCount()') === 2);
    ev('OfflineQueue.remove("a")');
    assert('remove(id) 清除该 id 全部 → pendingCount=0', ev('OfflineQueue.pendingCount()') === 0);

    ev('OfflineQueue.enqueue({op:"push", id:"b"})');
    const raw = localStorageStub.getItem('__sync_queue__');
    assert('localStorage 持久化写入 __sync_queue__', !!raw && JSON.parse(raw).some(x => x.id === 'b'));
    const reloaded = ev('OfflineQueue.load()');
    assert('重载后 load 可读到 b', reloaded.some(x => x.id === 'b'));
    assert('重载后 pendingCount 仍为 1', ev('OfflineQueue.pendingCount()') === 1);
    localStorageStub.clear();
  });

  await test('validateEmail', async () => {
    assert('合法 a@b.com', ev('validateEmail("a@b.com")') === true);
    assert('合法 x.y@sub.domain.io', ev('validateEmail("x.y@sub.domain.io")') === true);
    assert('非法 无@', ev('validateEmail("abc")') === false);
    assert('非法 无点', ev('validateEmail("a@b")') === false);
    assert('非法 空格', ev('validateEmail("a b@c.com")') === false);
    assert('非法 空串', ev('validateEmail("")') === false);
  });

  await test('translateAuthError', async () => {
    const f = (m) => ev(`translateAuthError(${JSON.stringify({ message: m })})`);
    assert('invalid credentials → 邮箱或密码错误', f('Invalid login credentials').includes('邮箱或密码错误'));
    assert('already registered → 已注册提示', f('User already registered').includes('已注册'));
    assert('email not confirmed → 未验证', f('Email not confirmed').includes('未验证'));
    assert('password too short → 至少 6 位', f('Password should be at least 6 characters').includes('至少 6 位'));
    assert('network error → 网络异常', f('Failed to fetch / network error').includes('网络异常'));
    assert('invalid email → 邮箱格式', f('Unable to validate email address').includes('格式不正确'));
    assert('offline → 离线', f('offline').includes('离线'));
    assert('默认分支 → 操作失败', f('some weird error').startsWith('操作失败'));
    assert('空消息默认兜底', f('').includes('未知错误') || f('').startsWith('操作失败'));
  });

  // ---------------- LWW: pullAllAndMerge ----------------
  await test('LWW-pullAllAndMerge-云新覆盖本地', async () => {
    mem.clear();
    configSb({ list: [{ id: 'a', title: 'Cloud', type: 'forum', created_at: new Date(1000).toISOString(), updated_at: new Date(5000).toISOString(), data: {} }] });
    setField('userId', 'u-lww'); setField('isOnline', true);
    setProjects([{ id: 'a', title: 'Local', type: 'forum', createdAt: 1000, updatedAt: 1000, data: {} }]);
    await evAsync('pullAllAndMerge()');
    await new Promise(r => setTimeout(r, 0));
    const s = getState();
    const a = s.projects.find(x => x.id === 'a');
    assert('云较新 → merged 含 a 且 updatedAt≈5000', a && Math.abs(a.updatedAt - 5000) < 2);
    assert('云较新 → 不向云推送 a', !hasUpsert('a'));
  });

  await test('LWW-pullAllAndMerge-本地新推云', async () => {
    mem.clear();
    configSb({ list: [{ id: 'a', title: 'Cloud', type: 'forum', created_at: new Date(1000).toISOString(), updated_at: new Date(1000).toISOString(), data: {} }] });
    setField('userId', 'u-lww'); setField('isOnline', true);
    setProjects([{ id: 'a', title: 'Local', type: 'forum', createdAt: 5000, updatedAt: 5000, data: {} }]);
    await evAsync('pullAllAndMerge()');
    await new Promise(r => setTimeout(r, 0));
    const s = getState();
    const a = s.projects.find(x => x.id === 'a');
    assert('本地较新 → merged 含 a 且 updatedAt≈5000', a && Math.abs(a.updatedAt - 5000) < 2);
    assert('本地较新 → 向云推送 a', hasUpsert('a'));
  });

  await test('LWW-pullAllAndMerge-本地独有推云', async () => {
    mem.clear();
    configSb({ list: [] });
    setField('userId', 'u-lww'); setField('isOnline', true);
    setProjects([{ id: 'b', title: 'OnlyLocal', type: 'forum', createdAt: 3000, updatedAt: 3000, data: {} }]);
    await evAsync('pullAllAndMerge()');
    await new Promise(r => setTimeout(r, 0));
    const s = getState();
    assert('本地独有 → merged 含 b', s.projects.some(x => x.id === 'b'));
    assert('本地独有 → 向云推送 b', hasUpsert('b'));
  });

  await test('LWW-pullAllAndMerge-云独有并入', async () => {
    mem.clear();
    configSb({ list: [{ id: 'c', title: 'OnlyCloud', type: 'forum', created_at: new Date(2000).toISOString(), updated_at: new Date(2000).toISOString(), data: {} }] });
    setField('userId', 'u-lww'); setField('isOnline', true);
    setProjects([]);
    await evAsync('pullAllAndMerge()');
    await new Promise(r => setTimeout(r, 0));
    const s = getState();
    assert('云独有 → merged 含 c', s.projects.some(x => x.id === 'c'));
    assert('云独有 → 不向云推送 c', !hasUpsert('c'));
  });

  // ---------------- LWW: pullLatest ----------------
  await test('pullLatest-云新覆盖本地', async () => {
    mem.clear();
    const cloudRow = { id: 'x', title: 'CloudX', type: 'forum', created_at: new Date(1000).toISOString(), updated_at: new Date(5000).toISOString(), data: { k: 'v' } };
    configSb({ single: cloudRow });
    setField('userId', 'u-pl'); setField('isOnline', true);
    setProjects([]);
    setCurrent({ id: 'x', title: 'LocalX', type: 'forum', createdAt: 1000, updatedAt: 1000, data: {} });
    const res = await evAsync('pullLatest("x")');
    await new Promise(r => setTimeout(r, 0));
    assert('返回云端版本', res && Math.abs(res.updatedAt - 5000) < 2);
    const s = getState();
    assert('state.currentProject 已被云端覆盖', s.currentProject && Math.abs((s.currentProject.updatedAt || 0) - 5000) < 2);
    assert('云新不向云推送', !hasUpsert('x'));
    assert('idbPut(cloud) 已持久化到本地缓存', mem.has('x'));
  });

  await test('pullLatest-本地新推云', async () => {
    mem.clear();
    const cloudRow = { id: 'x', title: 'CloudX', type: 'forum', created_at: new Date(1000).toISOString(), updated_at: new Date(1000).toISOString(), data: {} };
    configSb({ single: cloudRow });
    setField('userId', 'u-pl'); setField('isOnline', true);
    setProjects([]);
    setCurrent({ id: 'x', title: 'LocalX', type: 'forum', createdAt: 5000, updatedAt: 5000, data: {} });
    const res = await evAsync('pullLatest("x")');
    await new Promise(r => setTimeout(r, 0));
    assert('返回本地版本', res && Math.abs(res.updatedAt - 5000) < 2);
    assert('本地新 → 向云推送 x', hasUpsert('x'));
  });

  await test('pullLatest-云缺失返回 null', async () => {
    mem.clear();
    configSb({ single: null });
    setField('userId', 'u-pl'); setField('isOnline', true);
    setProjects([]); setCurrent(null);
    const res = await evAsync('pullLatest("nope")');
    assert('云返回 null → pullLatest 返回 null', res === null);
  });

  await test('pullLatest-离线/无用户返回 null', async () => {
    mem.clear();
    configSb({ single: { id: 'x', updated_at: new Date(5000).toISOString(), data: {} } });
    setField('userId', null); setField('isOnline', false);
    const res = await evAsync('pullLatest("x")');
    assert('无 userId/离线 → 返回 null 不抛错', res === null);
  });
}

// ---------------------------------------------------------------------------
// 7) 汇总报告
// ---------------------------------------------------------------------------
const total = results.length;
const passed = results.filter(r => r.pass).length;
const failed = total - passed;
console.log('\n==================================================');
console.log(`# 测试报告 — 邮箱登录 + Supabase 云同步增量模块`);
console.log(`总用例(断言): ${total} | 通过: ${passed} | 失败: ${failed}`);
if (loadError) console.log('加载阶段错误：已拦截未捕获异常（见上）。');
if (failed > 0) {
  console.log('\n失败明细：');
  results.filter(r => !r.pass).forEach(r => console.log(`  - ${r.name} ${r.detail ? '(' + r.detail + ')' : ''}`));
}
console.log('==================================================');

const exitCode = failed > 0 ? 1 : 0;
process.exit(exitCode);
