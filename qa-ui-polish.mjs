import * as vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readFileSync('D:/Z/yige/forum-novel-editor/index.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const [script1, script2Raw] = blocks;
const script2 = script2Raw.replace(/\bimport\(/g, '__import(');

/* ---------- DOM stub (from qa-boot) ---------- */
class TextNode { constructor(t) { this.nodeType = 3; this._text = String(t); this.parentNode = null; } get text() { return this._text; } set text(v) { this._text = String(v); } get textContent() { return this._text; } set textContent(v) { this._text = String(v); } }
class Element {
  constructor(tag) { this.tagName = tag; this.childNodes = []; this.parentNode = null; this.attributes = {}; this._class = ''; this._classes = new Set(); this._styleText = ''; this.listeners = {}; this.value = ''; this.checked = false; this.disabled = false; this.files = []; this._text = ''; this._innerHTML = ''; }
  get className() { return this._class; } set className(v) { this._class = v || ''; this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get style() { const s = this; return { get cssText() { return s._styleText; }, set cssText(v) { s._styleText = v || ''; }, get display() { const m = (s._styleText || '').match(/display\s*:\s*([^;]+)/); return m ? m[1].trim() : ''; }, set display(v) { s._styleText = (s._styleText || '').replace(/display\s*:\s*[^;]+;?/g, '') + (v ? 'display:' + v + ';' : ''); } }; }
  get classList() { const s = this; return { add: c => s._classes.add(c), remove: c => s._classes.delete(c), toggle: (c, f) => { if (f === undefined) { s._classes.has(c) ? s._classes.delete(c) : s._classes.add(c); } else { f ? s._classes.add(c) : s._classes.delete(c); } }, contains: c => s._classes.has(c) }; }
  get id() { return this.attributes.id; } setAttribute(k, v) { this.attributes[k] = v; if (k === 'id') this.attributes.id = v; } getAttribute(k) { return (k in this.attributes) ? this.attributes[k] : null; } removeAttribute(k) { delete this.attributes[k]; }
  appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c; } prepend(c) { c.parentNode = this; this.childNodes.unshift(c); return c; } removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; } remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); } removeEventListener(t, fn) { const a = this.listeners[t]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } } click() { (this.listeners['click'] || []).forEach(fn => fn({ target: this, preventDefault() { }, stopPropagation() { } })); }
  get textContent() { let o = ''; const w = n => { if (n instanceof TextNode) o += n.text; else if (n instanceof Element) { if (n._text) o += n._text; n.childNodes.forEach(w); } }; w(this); return o; } set textContent(v) { this._text = String(v); this.childNodes = []; }
  get innerHTML() { return this._innerHTML; } set innerHTML(v) { this._innerHTML = v; if (v === '') this.childNodes = []; }
  _match(sel) { if (sel.startsWith('#')) return this.attributes.id === sel.slice(1); if (sel.startsWith('.')) return this._classes.has(sel.slice(1)); return this.tagName === sel; }
  querySelector(sel) { return this._findAll(sel)[0] || null; } querySelectorAll(sel) { return this._findAll(sel); }
  _findAll(sel) { const r = []; const w = n => { if (n instanceof Element) { if (n._match(sel)) r.push(n); n.childNodes.forEach(w); } }; this.childNodes.forEach(w); return r; }
  _findById(id) { if (this.attributes.id === id) return this; for (const c of this.childNodes) { if (c instanceof Element) { const x = c._findById(id); if (x) return x; } } return null; }
}

const body = new Element('body');
const appEl = new Element('div'); appEl.setAttribute('id', 'app'); body.appendChild(appEl);
const mr = new Element('div'); mr.setAttribute('id', 'modal-root'); body.appendChild(mr);
const documentStub = { readyState: 'complete', body, createElement: t => new Element(t), createTextNode: t => new TextNode(t), getElementById: id => body._findById(id), querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s), addEventListener: () => { }, removeEventListener: () => { } };
const windowStub = { addEventListener: () => { }, removeEventListener: () => { }, innerWidth: 1200, location: { origin: 'https://zhongzhuoran.github.io', pathname: '/Interface_Fiction_Toolkit/' } };
const navigatorStub = { onLine: true }; const locationStub = { origin: 'https://zhongzhuoran.github.io', pathname: '/Interface_Fiction_Toolkit/' };

const FAKE_SB = {
  auth: {
    onAuthStateChange(cb) { setTimeout(() => { try { cb('INITIAL_SESSION', null); } catch (e) { } }, 5); return { data: { subscription: { unsubscribe() { } } } }; },
    getSession() { return Promise.resolve({ data: { session: null } }); },
  },
  from() { return { upsert() { return Promise.resolve({ error: null }); }, delete() { return Promise.resolve({ error: null }); }, select() { return Promise.resolve({ data: [], error: null }); }, eq() { return this; }, maybeSingle() { return Promise.resolve({ data: null, error: null }); } }; },
  channel() { return { on() { return this; }, subscribe() { return this; } }; },
  removeChannel() { return Promise.resolve(); }
};
const __import = async (url) => ({ createClient: () => FAKE_SB });

class FakeOS {
  constructor(tx) { this.tx = tx; }
  getAll() { const r = { result: [] }; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; }
  get() { const r = { result: null }; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; }
  put() { setTimeout(() => this.tx.oncomplete && this.tx.oncomplete(), 0); return { onsuccess: null, onerror: null }; }
  delete() { setTimeout(() => this.tx.oncomplete && this.tx.oncomplete(), 0); return { onsuccess: null, onerror: null }; }
}
class FakeTx { constructor() { this.oncomplete = null; this.onerror = null; } objectStore() { return new FakeOS(this); } }
const fakeIndexedDB = {
  open() {
    const req = { result: { createObjectStore() { return {}; }, transaction() { return new FakeTx(); } }, onupgradeneeded: null, onsuccess: null, onerror: null };
    setTimeout(() => { if (req.onupgradeneeded) req.onupgradeneeded(); if (req.onsuccess) req.onsuccess(); }, 0); return req;
  }
};

const sandbox = { document: documentStub, window: windowStub, navigator: navigatorStub, location: locationStub, indexedDB: fakeIndexedDB, localStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { }, clear: () => { } }, FileReader: class { readAsDataURL() { this.result = 'data:image/png;base64,STUB'; if (this.onload) this.onload(); } }, console, setTimeout, clearTimeout, Promise, __import };
const ctx = vm.createContext(sandbox);

vm.runInContext(script1, ctx, { filename: 's1.js' });
vm.runInContext(script2, ctx, { filename: 's2.js' });

const ev = (c) => vm.runInContext(c, ctx, { filename: 't.js' });
const evA = async (c) => { try { return await vm.runInContext('(async()=>{' + c + '})()', ctx, { filename: 't.js' }); } catch (e) { console.log('evA err:', e.message); throw e; } };

function assert(cond, msg) { console.log(cond ? 'PASS: ' + msg : 'FAIL: ' + msg); }

// Wait for async init + initSync to settle, then test UI
await new Promise(r => setTimeout(r, 300));

const project = {
  id: 'p1', type: 'forum', title: '测试', updatedAt: Date.now(), data: {
    cover: { title: '', body: '', images: [], author: '', avatar: null },
    floors: [
      { id: 'f1', author: 'A', content: '一楼', quote: null, images: [], isOP: false },
      { id: 'f2', author: 'B', content: '二楼', quote: 'f1', images: [], isOP: false },
    ],
    coverImage: null,
    settings: { showTime: false, pageRatio: '9:16', pageHeightPx: null },
  }
};
ctx.p1 = project;

// Switch to editor and render
ev('state.currentProject = p1; state.view = "editor"; renderEditor();');

const editorContent = ev('document.getElementById("editor-content")');
assert(!!editorContent, '#editor-content rendered');

const appText = ev('document.getElementById("app").textContent');
console.log('app text sample:', JSON.stringify(appText.slice(0, 200)));
const iconCount = ev('document.querySelectorAll(".icon-svg").length');
assert(iconCount >= 4, 'editor contains icon-svg icons (' + iconCount + ')');

const dropdownCount = ev('document.querySelectorAll(".quote-dropdown").length');
assert(dropdownCount === 2, 'exactly two quote dropdowns rendered (' + dropdownCount + ')');

const firstDropdown = ev('document.querySelector(".quote-dropdown")');
if (firstDropdown) {
  const btn = firstDropdown.querySelector('.quote-dropdown-btn');
  const menu = firstDropdown.querySelector('.quote-dropdown-menu');
  assert(!!btn && !!menu, 'dropdown has button and menu');
  if (btn) {
    btn.click();
    assert(menu.style.display === 'block', 'clicking dropdown opens menu');
  }
} else {
  assert(false, 'first quote dropdown found');
}

const settings = ev('buildSettings()');
assert(!!settings, 'buildSettings returns a node');
const labelText = settings.textContent;
assert(labelText.includes('上传封面图'), 'settings panel contains "上传封面图" label');
const dangerBtns = settings.querySelectorAll('.btn-danger');
assert(dangerBtns.length === 0, 'settings panel without coverImage has no danger delete button');

// Test danger trash icon when coverImage exists
ctx.p2 = { ...project, data: { ...project.data, coverImage: { id: 'c1', dataUrl: 'data:image/png;base64,STUB', name: 'cover' } } };
const settingsWithCover = ev('(state.currentProject = p2, buildSettings())');
const dangerTrash = settingsWithCover.querySelector('.btn-danger');
assert(!!dangerTrash, 'settings with coverImage has danger delete button');
const trashSvg = ev('ICON_SVG.trash');
assert(trashSvg.includes('fill="currentColor"'), 'trash svg uses currentColor to inherit red');

console.log('ERRORS:', (ctx.errors && ctx.errors.length) ? ctx.errors : 'none');
console.log('ALL UI POLISH TESTS COMPLETE');
