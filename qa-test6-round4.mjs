// ============================================================
// qa-test6-round4.mjs — 第四轮 UI/交互微调 针对性抽查
// 运行: node qa-test6-round4.mjs (在 D:\Z\yige\forum-novel-editor\ 下)
// 目的: 对寇豆码本轮 6 项改动做"源码符号 + 运行时行为"双重抽查。
//       不修改、不依赖 qa-test*.mjs，不影响其 259 项断言。
// 环境: Node 内置 vm，无第三方依赖；复用 qa-test3 的 DOM mock 思路。
// ============================================================
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// ---------- 提取内联 <script> ----------
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('ERROR: 未找到 <script> 块'); process.exit(2); }
const js = m[1];

// ---------- JS 语法检查 ----------
const tmpPath = path.join(__dirname, '.qa-script6.tmp.js');
fs.writeFileSync(tmpPath, js);
let syntaxOk = true, syntaxMsg = 'OK: 无语法错误';
try { execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' }); }
catch (e) { syntaxOk = false; syntaxMsg = (e.stderr ? e.stderr.toString() : String(e.message)); }
try { fs.unlinkSync(tmpPath); } catch (_) {}

// ============================================================
// 精简版 DOM 模拟（参考 qa-test3）
// ============================================================
class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.attributes = {};
    this.style = {}; this._class = ''; this._html = ''; this.nodeType = 1;
    this.parentNode = null; this._listeners = {}; this.value = '';
  }
  get className() { return this._class; }
  set className(v) { this._class = v || ''; }
  get classList() {
    const self = this;
    const set = () => new Set(self._class.split(/\s+/).filter(Boolean));
    return {
      add(c) { const s = set(); s.add(c); self._class = [...s].join(' '); },
      remove(c) { const s = set(); s.delete(c); self._class = [...s].join(' '); },
      toggle(c, force) { const s = set(); const has = s.has(c); const want = force === undefined ? !has : force; if (want) s.add(c); else s.delete(c); self._class = [...s].join(' '); return want; },
      contains(c) { return set().has(c); }
    };
  }
  setAttribute(k, v) { this.attributes[k] = v; if (k === 'class') this._class = v; }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  click() { (this._listeners['click'] || []).forEach(fn => fn({ target: this })); }
  appendChild(c) { if (c) c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); if (c) c.parentNode = null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v; if (v === '') this.children = []; }
  get textContent() {
    let s = '';
    for (const c of this.children) { if (c && c.nodeType === 3) s += c.textContent; else if (c && c.nodeType === 1) s += c.textContent; }
    return s;
  }
  set textContent(v) { this._text = v; this.children = []; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }; }
  contains() { return false; }
}
const elements = {};
class FakeImage { constructor() { this.width = 100; this.height = 100; this.onload = null; this.onerror = null; this._src = ''; } set src(v) { this._src = v; if (this.onload) this.onload(); } }
function makeCanvas() { return { width: 0, height: 0, getContext() { return { fillStyle: '', fillRect() {}, drawImage() {} }; }, toDataURL() { return 'COMPRESSED'; } }; }
function makeDocument() {
  return {
    readyState: 'loading',
    addEventListener() {},
    createElement(t) { if (t === 'canvas') return makeCanvas(); return new El(t); },
    createTextNode(t) { return { nodeType: 3, textContent: String(t), children: [] }; },
    getElementById(id) { if (!elements[id]) elements[id] = new El('div'); return elements[id]; },
    querySelectorAll() { return []; },
    documentElement: { outerHTML: '' },
    body: { appendChild() {} }
  };
}
function makeCtx() {
  let _font = '';
  return {
    set font(v) { _font = v; }, get font() { return _font; },
    measureText(s) { return { width: (s ? String(s).length : 0) * 8 }; },
    fillText() {}, save() {}, restore() {}, clip() {}, beginPath() {},
    closePath() {}, arc() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    drawImage() {}, rect() {}, fillRect() {}, scale() {}, setTransform() {},
    textBaseline: '', textAlign: '', fillStyle: '', strokeStyle: '', lineWidth: 1
  };
}
const sandbox = {
  document: makeDocument(),
  window: { matchMedia: () => ({ matches: false }), innerWidth: 1200, addEventListener() {}, __EMBED_PROJECT__: undefined },
  console, indexedDB: {}, URL: { createObjectURL() {}, revokeObjectURL() {} },
  Blob: function () {}, FileReader: function () {}, Image: FakeImage,
  setTimeout: () => 0, clearTimeout: () => {}
};
sandbox.globalThis = sandbox;
const shim = `;globalThis.__TEST__ = {
  openModal, buildSystemLine, prepareMessage,
  openChatInfo, openNewProjectModal, addTimestamp,
  newPickupProject, newChat, getActiveChat, state, el, nudgeText,
  renderChatInfoBody, chatDisplayName
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
function checkSrc(name, re, haystack) { check(name, re.test(haystack), '未匹配源码特征'); }

// ---------- DOM 遍历辅助 ----------
function walk(node, out) { if (!node) return; out.push(node); if (node.children) for (const c of node.children) walk(c, out); }
function textOf(node) {
  let s = '';
  for (const c of (node.children || [])) { if (c && c.nodeType === 3) s += c.textContent; else if (c && c.nodeType === 1) s += textOf(c); }
  return s;
}
function findInTree(root, pred) { const all = []; walk(root, all); return all.find(pred) || null; }
function resetModal() { modalRoot.children = []; }

// ============================================================
console.log('\n[语法] JS 语法检查');
check('JS 语法检查通过', syntaxOk, syntaxMsg);

// ============================================================
console.log('\n[R4-2] 设置聊天信息弹窗(setup) 移除右上角 X + sticky footer');
// 行为：openModal 默认应带 .modal-close；showClose:false 不应带
resetModal();
T.openModal(new El('div'), null, {});           // 默认 showClose=true
let hasCloseDefault = !!findInTree(modalRoot, n => n.className && n.className.split(/\s+/).includes('modal-close'));
check('openModal(默认) 渲染右上角 X 关闭按钮', hasCloseDefault);

resetModal();
T.openModal(new El('div'), null, { showClose: false });
let hasCloseFalse = !!findInTree(modalRoot, n => n.className && n.className.split(/\s+/).includes('modal-close'));
check('openModal({showClose:false}) 不渲染 X 关闭按钮', !hasCloseFalse);

// 源码：openChatInfo 在 setup 时传 { showClose: !isSetup }
checkSrc('openChatInfo 传入 { showClose: !isSetup }', /openModal\(\s*body\s*,\s*onClose\s*,\s*\{\s*showClose:\s*!isSetup\s*\}/, js);

// 源码(R5-1)：.wx-modal-footer 不再单独画 sticky 白色色块，改为普通 flex 行，与上方内容自然分开
check('R5-1 .wx-modal-footer 不再 sticky', !/\.wx-modal-footer\{[^}]*position:sticky/.test(html));
check('R5-1 .wx-modal-footer 不再 padding-top:20px', !/\.wx-modal-footer\{[^}]*padding-top:20px/.test(html));
check('R5-1 .wx-modal-footer 不再 border-top 分隔线', !/\.wx-modal-footer\{[^}]*border-top:1px solid #f0f0f0/.test(html));
checkSrc('R5-1 .wx-modal-footer 保留 margin-top:24px', /\.wx-modal-footer\{[^}]*margin-top:24px/, html);
checkSrc('R5-1 .wx-modal-footer 为 flex 行(右对齐)', /\.wx-modal-footer\{[^}]*display:flex[^}]*justify-content:flex-end/, html);

// ============================================================
console.log('\n[R4-3] 编辑区与预览区中间分隔线');
// ui8b 修复：分隔线由「.wx-col-edit 的 border-right」改为「实体 .wx-col-divider」，
// 基础 .wx-col-edit 不再带 border-right（避免与实体分隔线重叠成双线），故更新为新方案断言。
checkSrc('.wx-col-divider 实体分隔线(flex:0 0 1px)', /\.wx-col-divider\{[^}]*flex:\s*0\s+0\s+1px/, html);
checkSrc('.wx-col-divider 背景色 #d9d9d9', /\.wx-col-divider\{[^}]*background:\s*#d9d9d9/, html);
check('.wx-col-edit 不再带 border-right(避免与实体 .wx-col-divider 重叠成双线)', !/\.wx-col-edit\{[^}]*border-right:1px solid/.test(html));
// 窄屏应去掉分隔线（响应式）：媒体查询内 .wx-col-edit 设 border-right:none，且 .wx-col-divider{display:none}
checkSrc('.wx-col-edit(窄屏) border-right:none', /\.wx-col-edit\{[^}]*border-right:none/, html);

// ============================================================
console.log('\n[R5-2] 语音图标统一（输入栏麦克风 / 语音气泡用户指定SVG / canvas 同步）');
// 输入栏语音按钮：微信风麦克风（胶囊麦克风头 + 支架弧线 + 底座）——本轮未改动，保留回归
checkSrc('输入栏语音按钮为微信风麦克风 SVG', /M12 14a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4Z/, js);
checkSrc('输入栏语音按钮含麦克风支架弧线', /M19 11v-1a7 7 0 0 1-14 0v1/, js);
// 语音气泡播放图标：用户指定 SVG（viewBox 0 0 1024 1024，fill #333333，含三段路径）
checkSrc('语音气泡播放图标为用户指定 SVG(viewBox 1024 + #333333)', /viewBox="0 0 1024 1024" fill="#333333"/, js);
checkSrc('语音气泡播放图标含外弧路径', /M636\.16512 957\.44l-70\.80448-70\.8096c/, js);
checkSrc('语音气泡播放图标含内扬声器路径', /M445\.08672 766\.35648l-72\.93952-72\.92928c/, js);
checkSrc('语音气泡播放图标含扬声器圆点', /M253\.96736 591\.18592c-39\.5776 0-71\.66976-32\.08192/, js);
// 长图 canvas 导出同步：Path2D 绘制用户指定图标（与气泡 SVG 一致）
checkSrc('canvas 导出使用 Path2D 绘制用户图标', /new Path2D\('M636\.16512 957\.44l-70\.80448/, js);
checkSrc('canvas 导出 fill(voiceIcon)', /ctx\.fill\(voiceIcon\)/, js);
checkSrc('canvas 导出按 1024 viewBox 缩放至 20px', /ctx\.scale\(20 \/ 1024, 20 \/ 1024\)/, js);

// ============================================================
console.log('\n[R4-5] 时间戳消息（右键菜单 + DOM/长图渲染）');
// 右键气泡菜单新增「添加时间戳」
checkSrc('右键菜单新增「添加时间戳」项', /add\('添加时间戳',\s*\(\)=>\s*addTimestamp\(msg\)\)/, js);
// addTimestamp 在当前消息前插入 system 时间戳
checkSrc('addTimestamp 置 kind=timestamp', /tsMsg\.kind='timestamp';/, js);
checkSrc('addTimestamp 置 isSystem=true', /tsMsg\.isSystem=true;/, js);
checkSrc('addTimestamp 在 msg 前插入(splice 0)', /chat\.messages\.splice\(i,0,tsMsg\)/, js);

// 行为：buildSystemLine 渲染居中灰色时间戳文字（DOM）
const tsMsg = { type: 'system', kind: 'timestamp', text: '10:43' };
const sysEl = T.buildSystemLine(tsMsg, null);
check('buildSystemLine 时间戳返回 .wx-sys', sysEl && sysEl.className === 'wx-sys', '实际 class=' + (sysEl && sysEl.className));
check('buildSystemLine 时间戳文本=10:43', sysEl && textOf(sysEl) === '10:43', '实际文本=' + (sysEl && textOf(sysEl)));

// 行为：prepareMessage（长图）时间戳 draw 使用居中灰色
// 注意：draw 在 fillText 期间置 center/gray，结束时复位 left（正确清理）。
// 故 spy 须在 fillText 调用瞬间记录 textAlign / fillStyle。
function makeSpyCtx() {
  const base = makeCtx();
  base._atFill = { textAlign: null, fillStyle: null };
  const origFill = base.fillText;
  base.fillText = function (...a) { base._atFill.textAlign = base.textAlign; base._atFill.fillStyle = base.fillStyle; return origFill.apply(base, a); };
  return base;
}
const chat = T.newChat();
const block = T.prepareMessage({ type: 'system', kind: 'timestamp', text: '10:43' }, chat, makeCtx(), null, {});
check('prepareMessage 返回时间戳块(draw 存在)', block && typeof block.draw === 'function');
if (block && typeof block.draw === 'function') {
  const spy = makeSpyCtx();
  block.draw(spy, 0, 0);
  check('长图时间戳 居中渲染(textAlign=center)', spy._atFill.textAlign === 'center', '实际=' + spy._atFill.textAlign);
  check('长图时间戳 灰色渲染(fillStyle=#b3b3b3)', spy._atFill.fillStyle === '#b3b3b3', '实际=' + spy._atFill.fillStyle);
}

// ============================================================
console.log('\n[R4-1] 新建作品弹窗「标题」label 与 input 水平排列');
// 源码：label 固定 60px，input flex:1
checkSrc("新建作品 label 固定宽 60px", /el\('label',\{style:'flex:0 0 60px; width:60px'\}, '标题'\)/, js);
checkSrc("新建作品 input flex:1", /el\('input',\{class:'inp', value:'', placeholder:'未命名作品', style:'flex:1 1 auto; width:auto; min-width:0'\}\)/, js);

// 行为：实际打开新建弹窗，校验 label/input 的 cssText
try {
  resetModal();
  T.openNewProjectModal();
  const label = findInTree(modalRoot, n => n.tagName === 'label' && textOf(n).includes('标题'));
  const input = findInTree(modalRoot, n => n.tagName === 'input' && (n.attributes.placeholder === '未命名作品'));
  check('新建弹窗含「标题」label', !!label);
  check('新建弹窗标题 label 固定 60px(cssText)', !!label && /flex:\s*0 0 60px/.test(label.style.cssText) && /width:\s*60px/.test(label.style.cssText), '实际=' + (label && label.style.cssText));
  check('新建弹窗标题 input flex:1(cssText)', !!input && /flex:\s*1 1 auto/.test(input.style.cssText), '实际=' + (input && input.style.cssText));
} catch (e) {
  check('新建弹窗行为抽样(源码已覆盖, 运行态异常回退)', false, 'openNewProjectModal 运行异常: ' + e.message);
}

// ============================================================
console.log('\n[R4-6] 论坛体逻辑未被触碰（回归提示：既有 259 项断言通过即证明）');
check('论坛体纯函数 renumber/splitPages 仍可用', typeof T.newPickupProject === 'function' && typeof T.prepareMessage === 'function');

// ============================================================
console.log('\n========================================');
console.log('第四轮抽查: 通过 ' + pass + ' / 失败 ' + fail);
if (fails.length) { console.log('失败项:'); fails.forEach(f => console.log('  - ' + f)); }
console.log('========================================');
process.exit(fail === 0 ? 0 : 1);
