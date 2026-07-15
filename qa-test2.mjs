// ============================================================
// qa-test2.mjs — 论坛体小说编辑器 综合测试套件（独立验证）
// 运行: node qa-test2.mjs   (在 D:\Z\yige\forum-novel-editor\ 下)
// 环境: Node 内置能力，无第三方依赖
//
// 覆盖范围（在 qa-test.mjs 仅测 3 个纯函数基础上扩展）：
//   1) 数据模型 newProject / newFloor / normalizeData / normalizeProject
//   2) 序列化 serialize / deserialize 往返
//   3) 工具函数 safeName / formatDate / formatTime / uid
//   4) 纯函数回归 renumber / resolveQuote / splitPages
//   5) 预览 DOM 构建 buildPreview / buildFloorPreview / buildCoverPreview
//      —— 验证 10 项 UI 改造的“结构行为”：#N、匿名只显示#N、引用标签+50字摘要+省略号、
//         <hr> 分隔线、时间仅 showTime 且有 time 才渲染、isOP「楼主」标签
//   6) 编辑 DOM 构建 buildFloorEdit / buildEditorEdit
//      —— 验证操作行顺序、id 输入框 placeholder、textarea rows:1、showTime 时 datetime-local
//   7) 长图 canvas 逻辑 prepareFloor / prepareCover（高度计算 + 引用摘要）
//   8) 文本/图片工具 wrapText / collectImages
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
// 轻量 DOM 模拟（支持 el() 构造器与可检查结构）
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
  addEventListener() {}
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); }
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
  click() {}
  remove() {}
}

function makeDocument() {
  return {
    readyState: 'loading',            // 关键：阻止脚本末尾 init() 触发真实渲染
    addEventListener() {},
    createElement(t) { return new El(t); },
    createTextNode(t) { return { nodeType: 3, textContent: String(t), children: [] }; },
    getElementById() { return null; },
    querySelectorAll() { return []; },
    documentElement: { outerHTML: '' },
    body: { appendChild() {} }
  };
}

function makeCtx(charW = 8) {
  let _font = '';
  return {
    set font(v) { _font = v; },
    get font() { return _font; },
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
  Image: function () {},
  setTimeout, clearTimeout
};
sandbox.globalThis = sandbox;

const shim = `
;globalThis.__TEST__ = {
  renumber, resolveQuote, splitPages,
  newProject, newFloor, normalizeData, normalizeProject,
  serialize, deserialize, safeName, formatDate, formatTime, uid,
  wrapText, collectImages,
  buildPreview, buildFloorPreview, buildCoverPreview,
  buildFloorEdit, buildEditorEdit,
  prepareFloor, prepareCover,
  state,
  PAGE_W, PAGE_PAD, GAP, DPR, CONTENT_W, TITLE_LH, BODY_LH, AUTHOR_LH, TIME_LH, QUOTE_LH, BLOCK_TOP, FONT
};`;
const context = vm.createContext(sandbox);
vm.runInContext(js + shim, context, { filename: 'index-inline.js' });
const T = sandbox.__TEST__;

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
function findByClass(node, cls) {
  const all = []; walk(node, all);
  return all.filter(n => n.tagName && (n.className || '').split(/\s+/).includes(cls));
}
function findByTag(node, tag) {
  const all = []; walk(node, all);
  return all.filter(n => n.tagName === tag);
}
function findByAttr(node, tag, attr, val) {
  const all = []; walk(node, all);
  return all.filter(n => n.tagName === tag && n.getAttribute && n.getAttribute(attr) === val);
}
function textOf(node) {
  let s = '';
  for (const c of (node.children || [])) {
    if (c && c.nodeType === 3) s += c.textContent;
    else if (c && c.nodeType === 1) s += textOf(c);
  }
  return s;
}

// ============================================================
// 1) 数据模型
// ============================================================
console.log('\n[数据模型]');
{
  const p = T.newProject();
  check('newProject: 结构含 id/title/data', !!p.id && p.title === '未命名小说' && p.data && Array.isArray(p.data.floors));
  check('newProject: cover 空结构', p.data.cover && p.data.cover.title === '' && p.data.cover.images.length === 0);
  check('newProject: settings.showTime 默认 false', p.data.settings.showTime === false);
  check('newProject: settings.pageRatio 默认 9:16', p.data.settings.pageRatio === '9:16');
  check('newProject: 时间字段为数字(timestamp)', typeof p.createdAt === 'number' && typeof p.updatedAt === 'number');

  const f = T.newFloor();
  check('newFloor: 默认匿名/空内容/非楼主', f.author === '' && f.content === '' && f.isOP === false && f.quote === null);

  // normalizeData：补齐缺失字段、quote undefined→null、isOP 强制布尔
  const nd = T.normalizeData(undefined);
  check('normalizeData(null): 返回空安全结构', nd && nd.floors.length === 0 && nd.cover.images.length === 0);
  const legacy = { cover: { title: 'T' }, floors: [{ content: 'hi' }, { isOP: 'yes' }, { isOP: true }] };
  const nrm = T.normalizeData(legacy);
  check('normalizeData: 缺 id 自动补', nrm.floors[0].id && nrm.floors[0].id.length > 0);
  check('normalizeData: quote undefined→null', nrm.floors[0].quote === null);
  check('normalizeData: isOP 缺失→false(布尔)', nrm.floors[0].isOP === false && typeof nrm.floors[0].isOP === 'boolean');
  check('normalizeData: isOP 非严格true→false(布尔)', nrm.floors[1].isOP === false && typeof nrm.floors[1].isOP === 'boolean');
  check('normalizeData: isOP 严格true→保留', nrm.floors[2].isOP === true);
  check('normalizeData: 缺失数组退化为 []', Array.isArray(nrm.cover.images));

  // normalizeProject：补齐项目级字段
  const np = T.normalizeProject({ title: 'X', data: { cover: { title: 'Y' }, floors: [] } });
  check('normalizeProject: 缺 id/title/时间补齐', !!np.id && np.title === 'X' && typeof np.createdAt === 'number');
  check('normalizeProject: 内嵌 normalizeData', np.data.cover.title === 'Y' && np.data.floors.length === 0);
}

// ============================================================
// 2) 序列化往返
// ============================================================
console.log('\n[序列化]');
{
  const p = T.newProject();
  p.title = '测试小说';
  p.data.floors.push({ id: 'a', author: 'Bob', content: '内容', time: '', images: [], quote: null, isOP: false });
  const json = T.serialize(p);
  check('serialize: 含 version 字段', JSON.parse(json).version === 1);
  const back = T.deserialize(json);
  check('deserialize: 还原 project', back && back.title === '测试小说' && back.data.floors.length === 1);
  check('deserialize: 容错裸对象', T.deserialize(JSON.stringify({ id: 'z', title: 'T' })).id === 'z');
}

// ============================================================
// 3) 工具函数
// ============================================================
console.log('\n[工具函数]');
{
  check('safeName: 非法字符转 _', T.safeName('a/b:c*?') === 'a_b_c__');
  check('safeName: 空串回退未命名', T.safeName('') === '未命名小说' || T.safeName(null) === '未命名小说');
  check('safeName: 超长截断至 50', T.safeName('x'.repeat(100)).length === 50);

  // formatDate 固定时间戳
  const d = new Date(2024, 0, 5, 9, 7); // 2024-01-05 09:07
  const fd = T.formatDate(d.getTime());
  check('formatDate: 格式 YYYY-MM-DD HH:MM', fd === '2024-01-05 09:07', 'got ' + fd);

  check('formatTime: T→空格', T.formatTime('2024-01-05T09:07') === '2024-01-05 09:07');
  check('formatTime: 空→空', T.formatTime('') === '');
  check('formatTime: 缺省 undefined→空', T.formatTime(undefined) === '');

  const u = T.uid();
  check('uid: v4 格式', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u), u);
  check('uid: 两次不同', T.uid() !== T.uid());
}

// ============================================================
// 4) 纯函数回归（独立快速校验，非重复 32 用例）
// ============================================================
console.log('\n[纯函数回归]');
{
  check('renumber: 连续编号', T.renumber([{ id: 'a' }, { id: 'b' }]).get('b') === 2);
  check('renumber: 空安全', (() => { const r = T.renumber([]); return r && r.size === 0; })());

  const cover = { title: '楼主帖', body: '正文', images: [] };
  check('resolveQuote: cover', T.resolveQuote({ quote: 'cover' }, [], cover).type === 'cover');
  check('resolveQuote: floor #N', T.resolveQuote({ quote: 'a' }, [{ id: 'a', author: 'Bob', content: 'x' }], cover).floorNumber === 1);
  check('resolveQuote: 缺失→found=false', T.resolveQuote({ quote: 'x' }, [], cover).found === false);

  const pages = T.splitPages([{ h: 300 }, { h: 300 }, { h: 300 }], 747, b => b.h);
  check('splitPages: 三块300→2页', pages.length === 2);
  check('splitPages: 整块不跨页', (() => { const seen = new Set(); for (const pg of pages) for (const b of pg) { if (seen.has(b)) return false; seen.add(b); } return seen.size === 3; })());
}

// ============================================================
// 5) 预览 DOM 构建 —— 验证 10 项 UI 改造的结构行为
// ============================================================
console.log('\n[预览 DOM: buildFloorPreview / buildCoverPreview]');
{
  const cover = { title: '我的小说', body: '这是楼主帖正文', images: [], author: '楼主Alice', avatar: null };
  const f1 = { id: 'f1', author: 'Bob', content: '第一楼内容', time: '2024-01-05T09:07', images: [], quote: null, isOP: false };
  const f2 = { id: 'f2', author: '', content: '匿名楼正文', time: '', images: [], quote: 'f1', isOP: true };

  // —— 改造#4：楼层首行 #N 谁；匿名(author 空)→只显示 #N ——
  const e1 = T.buildFloorPreview(f1, 1, [f1, f2], cover, true);
  const num1 = findByClass(e1, 'pv-num')[0];
  check('UI#4: 楼显示 #N', num1 && textOf(num1) === '#1');
  check('UI#4: 有作者显示 pv-author2', findByClass(e1, 'pv-author2').length === 1);
  check('UI#4: 含正文 pv-body', findByClass(e1, 'pv-body').length === 1);

  const e2 = T.buildFloorPreview(f2, 2, [f1, f2], cover, true);
  check('UI#4: 匿名楼无 pv-author2(只显#N)', findByClass(e2, 'pv-author2').length === 0);
  const num2 = findByClass(e2, 'pv-num')[0];
  check('UI#4: 匿名楼 #N 仍渲染', num2 && textOf(num2) === '#2');

  // —— 改造#5：时间仅当 showTime 且本楼有 time 时右对齐 ——
  check('UI#5: showTime+time → 渲染 pv-time2', findByClass(e1, 'pv-time2').length === 1);
  const t1 = findByClass(e1, 'pv-time2')[0];
  check('UI#5: 时间内容含 HH:MM', t1 && textOf(t1).includes('09:07'), textOf(t1));
  const e2off = T.buildFloorPreview(f2, 2, [f1, f2], cover, false);
  check('UI#5: showTime=false → 不渲染时间', findByClass(e2off, 'pv-time2').length === 0);
  const e1notime = T.buildFloorPreview({ ...f1, time: '' }, 1, [f1, f2], cover, true);
  check('UI#5: 无 time → 不渲染时间', findByClass(e1notime, 'pv-time2').length === 0);

  // —— 改造#6：引用渲染浅色小字「引用 @作者 (#N)：前50字」；目标缺失优雅跳过 ——
  const q = findByClass(e2, 'pv-quote2')[0];
  check('UI#6: 引用块存在', !!q);
  check('UI#6: 引用标签格式 引用 @Bob (#1)：', q && textOf(q).startsWith('引用 @Bob (#1)：'), textOf(q));
  check('UI#6: 引用展示被引内容摘要', q && textOf(q).includes('第一楼内容'), textOf(q));

  // 长内容 → 50 字 + 省略号
  const fLong = { id: 'fl', author: 'Carol', content: 'y'.repeat(80), time: '', images: [], quote: null, isOP: false };
  const fQ = { id: 'fq', author: '', content: '', time: '', images: [], quote: 'fl', isOP: false };
  const eQlong = T.buildFloorPreview(fQ, 2, [fLong, fQ], cover, true);
  const qLong = findByClass(eQlong, 'pv-quote2')[0];
  check('UI#6: 超 50 字截断并省略', qLong && textOf(qLong).slice(-1) === '…' && textOf(qLong).includes('y'.repeat(50)), textOf(qLong).length + '');
  // 引用目标不存在 → 不渲染引用块（不崩）
  const eMiss = T.buildFloorPreview({ id: 'fm', author: '', content: 'x', quote: 'deleted' }, 1, [f1, f2], cover, true);
  check('UI#6: 引用缺失目标 → 不渲染引用块', findByClass(eMiss, 'pv-quote2').length === 0);

  // —— 改造#1/#3：封面扁平 ——
  const ce = T.buildCoverPreview(cover);
  check('UI#1/#3: 封面含标题 pv-cover-title', findByClass(ce, 'pv-cover-title').length === 1);
  check('UI#1/#3: 封面含正文 pv-body', findByClass(ce, 'pv-body').length === 1);
  const ceNoHead = T.buildCoverPreview({ title: 'T', body: 'B', images: [], author: '', avatar: null });
  check('UI#3: 无作者/头像 → 无 pv-cover-head', findByClass(ceNoHead, 'pv-cover-head').length === 0);

  // —— 改造#10 衍生：isOP 显示「楼主」标签 ——
  check('UI#10: isOP → 渲染 楼主 标签', findByClass(e2, 'pv-op-tag').length === 1 && textOf(findByClass(e2, 'pv-op-tag')[0]).includes('楼主'));
}

// ============================================================
// 6) 预览流 —— buildPreview 分隔线 / 顺序
// ============================================================
console.log('\n[预览 DOM: buildPreview]');
{
  const cover = { title: 'C', body: 'b', images: [], author: '', avatar: null };
  const f1 = { id: 'f1', author: 'Bob', content: 'x', time: '', images: [], quote: null, isOP: false };
  const f2 = { id: 'f2', author: '', content: 'y', time: '', images: [], quote: null, isOP: false };
  T.state.currentProject = { data: { cover, floors: [f1, f2], settings: { showTime: false, pageRatio: '9:16', pageHeightPx: null } } };
  const pv = T.buildPreview();
  check('UI: 顶层 phone-frame', findByClass(pv, 'phone-frame').length === 1);
  const feed = findByClass(pv, 'feed')[0];
  check('UI: feed 存在', !!feed);
  // 改造#2：块间用 <hr> 分隔
  const hrs = feed.children.filter(c => c.tagName === 'hr' && (c.className || '').includes('pv-hr'));
  check('UI#2: 2 楼 → 2 条分隔线', hrs.length === 2, 'got ' + hrs.length);
  check('UI#2: 首块为 pv-cover', feed.children[0] && feed.children[0].className === 'pv-cover');
  check('UI#2: 第二块为 pv-floor', feed.children[2] && feed.children[2].className === 'pv-floor');
}

// ============================================================
// 7) 编辑 DOM 构建 —— 操作行顺序 / placeholder / rows:1
// ============================================================
console.log('\n[编辑 DOM: buildFloorEdit / buildEditorEdit]');
{
  const floor = { id: 'fX', author: 'Bob', content: 'c', time: '', images: [], quote: null, isOP: true };
  const e = T.buildFloorEdit(floor, 3, [floor], true);
  // 操作行 op 子元素顺序：handle, num, id-inp, imgBtn, fileInput, quoteSel, opToggle, up, down, del
  const op = findByClass(e, 'floor-op')[0];
  const kids = op ? op.children.map(c => ({ cls: c.className || '', tag: c.tagName, ph: c.getAttribute ? c.getAttribute('placeholder') : null })) : [];
  check('UI#8: 操作行含拖拽手柄', kids.some(k => (k.cls || '').includes('drag-handle')));
  check('UI#8: 操作行含 #N 编号', kids.some(k => (k.cls || '').includes('floor-num')));
  // UI#8：id 输入框 placeholder「id（可空）」
  const idInp = findByAttr(e, 'input', 'placeholder', 'id（可空）');
  check('UI#8: id 输入框 placeholder=id（可空）', idInp.length === 1);
  const btns = findByClass(e, 'btn-mini');
  check('UI#8: 操作行按钮 +图/楼主/↑/↓/删', ['+图', '楼主', '↑', '↓', '删'].every(t => btns.some(b => textOf(b) === t)));
  const sel = findByTag(e, 'select');
  check('UI#8: 引用选择框含「引用▾」选项', sel.length >= 1 && textOf(sel[0]).includes('引用▾'));
  // UI#9：正文 textarea rows:1
  const ta = findByTag(e, 'textarea').filter(t => (t.className || '').includes('content-ta'))[0];
  check('UI#9: 正文 textarea rows=1', ta && String(ta.getAttribute('rows')) === '1');
  // UI#9：showTime 时操作行下方出现 datetime-local
  check('UI#9: showTime=true → datetime-local 输入', findByAttr(e, 'input', 'type', 'datetime-local').length === 1);
  const eOff = T.buildFloorEdit(floor, 3, [floor], false);
  check('UI#9: showTime=false → 无 datetime-local', findByAttr(eOff, 'input', 'type', 'datetime-local').length === 0);

  // 编辑外壳：封面 id placeholder「楼主 id（可空）」 + 添加楼层按钮
  T.state.currentProject = { data: { cover: { title: '', body: '', images: [], author: '', avatar: null }, floors: [floor], settings: { showTime: false } } };
  const ed = T.buildEditorEdit();
  check('UI#8: 封面 id placeholder=楼主 id（可空）', findByAttr(ed, 'input', 'placeholder', '楼主 id（可空）').length === 1);
  check('UI#8: 含 + 添加楼层 按钮', findByClass(ed, 'btn-block').some(b => textOf(b).includes('添加楼层')));
}

// ============================================================
// 8) 长图 canvas 逻辑（高度计算 + 引用摘要，不真正绘制）
// ============================================================
console.log('\n[长图 canvas: prepareFloor / prepareCover]');
{
  const ctx = makeCtx(8);
  const cover = { title: '我的小说', body: '正文内容', images: [], author: 'Alice', avatar: null };
  const pc = T.prepareCover(cover, ctx, new Map());
  check('prepareCover: 有 title → titleLines≥1', pc.titleLines && pc.titleLines.length >= 1);
  check('prepareCover: 高度为正有限数', typeof pc.height === 'number' && pc.height > 0 && isFinite(pc.height));
  const pcEmpty = T.prepareCover({ title: '', body: '', images: [], author: '', avatar: null }, ctx, new Map());
  check('prepareCover: 空封面 titleLines=0', pcEmpty.titleLines.length === 0);

  const f1 = { id: 'f1', author: 'Bob', content: '第一楼内容', time: '', images: [], quote: null, isOP: false };
  const f2 = { id: 'f2', author: '', content: '匿名', time: '', images: [], quote: 'f1', isOP: true };
  const pf = T.prepareFloor(f2, 2, [f1, f2], cover, ctx, new Map(), true);
  check('prepareFloor: 引用有效 → quote 非空', !!pf.quote && Array.isArray(pf.quote.sumLines));
  check('prepareFloor: 引用摘要含「引用 @Bob (#1)：」', pf.quote.sumLines.join('').includes('引用 @Bob (#1)：'), pf.quote.sumLines.join(''));
  check('prepareFloor: 高度为正有限数', typeof pf.height === 'number' && pf.height > 0 && isFinite(pf.height));
  // 引用目标缺失 → quote 为 null（优雅）
  const pfMiss = T.prepareFloor({ id: 'fm', author: '', content: 'x', quote: 'gone' }, 1, [f1, f2], cover, ctx, new Map(), true);
  check('prepareFloor: 引用缺失 → quote=null', pfMiss.quote === null);
}

// ============================================================
// 9) 文本 / 图片工具
// ============================================================
console.log('\n[工具: wrapText / collectImages]');
{
  const ctx = makeCtx(8); // 每字符 8px，maxW=40 → 5 字符/行
  const w = T.wrapText(ctx, 'a'.repeat(12), 40);
  check('wrapText: 长单行被分行', Array.isArray(w) && w.length > 1, 'lines=' + w.length);
  check('wrapText: 字符总数守恒', w.join('').length === 12);
  const wBlank = T.wrapText(ctx, '', 40);
  check('wrapText: 空串返回单空行', wBlank.length === 1 && wBlank[0] === '');
  const wNl = T.wrapText(ctx, 'line1\nline2', 400);
  check('wrapText: 换行符切分', wNl.length === 2 && wNl[0] === 'line1' && wNl[1] === 'line2');

  const im1 = { id: 'i1', dataUrl: 'd1' }, im2 = { id: 'i2', dataUrl: 'd2' };
  const project = {
    data: {
      cover: { images: [im1], avatar: { id: 'av', dataUrl: 'da' } },
      floors: [{ id: 'f1', images: [im2] }, { id: 'f2', images: [] }]
    }
  };
  const imgs = T.collectImages(project);
  check('collectImages: 收集 cover图+头像+floor图', imgs.length === 3 && imgs.includes(im1) && imgs.includes(im2) && imgs.some(i => i.id === 'av'), 'got ' + imgs.length);
}

// ============================================================
// 汇总
// ============================================================
console.log('\n========================================');
console.log('JS 语法检查: ' + (syntaxOk ? 'PASS' : 'FAIL'));
if (!syntaxOk) console.log(syntaxMsg);
console.log(`综合单测: 通过 ${pass} / 失败 ${fail}`);
if (fail) { console.log('失败项:'); fails.forEach(f => console.log('  - ' + f)); }
console.log('========================================');

const summary = { suite: 'qa-test2.mjs', syntaxOk, syntaxMsg, pass, fail, fails };
fs.writeFileSync(path.join(__dirname, '.qa-result2.json'), JSON.stringify(summary, null, 2));

process.exit(fail || !syntaxOk ? 1 : 0);
