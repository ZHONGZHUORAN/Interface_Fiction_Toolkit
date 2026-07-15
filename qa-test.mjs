// ============================================================
// qa-test.mjs — 论坛体小说编辑器 纯函数单测 + JS 语法检查
// 运行: node qa-test.mjs   (在 D:\Z\yige\forum-novel-editor\ 下)
// 环境: Node 内置能力，无第三方依赖
// ============================================================
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// ---------- B. 提取内联 <script> 内容 ----------
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('ERROR: 未找到 <script> 块'); process.exit(2); }
const js = m[1];

// ---------- B. JS 语法检查 (node --check) ----------
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

// ---------- C. 在 vm 中加载纯函数 ----------
// 仅提供最小 DOM/全局桩，使整段脚本可被求值（顶层不调用 DOM 逻辑）。
const sandbox = {
  document: {
    readyState: 'loading',
    addEventListener() {},
    createElement() { return { style: {}, appendChild() {}, setAttribute() {}, addEventListener() {} }; },
    getElementById() { return null; },
    querySelectorAll() { return []; },
    body: { appendChild() {} },
    documentElement: { outerHTML: '' }
  },
  window: {},
  console,
  indexedDB: {},
  URL: { createObjectURL() {}, revokeObjectURL() {} },
  Image: function () {},
  setTimeout,
  clearTimeout
};
// 让 globalThis 指向上下文全局，便于导出测试符号
sandbox.globalThis = sandbox;
const shim = '\n;globalThis.__TEST__ = { renumber, resolveQuote, splitPages, PAGE_PAD, GAP, PAGE_W, DPR };';
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

// ================= renumber =================
console.log('\n[renumber]');
{
  const A = { id: 'a' }, B = { id: 'b' }, C = { id: 'c' };
  const r1 = T.renumber([A, B, C]);
  check('顺序 A,B,C -> #1,#2,#3', r1.get('a') === 1 && r1.get('b') === 2 && r1.get('c') === 3);
  const r2 = T.renumber([C, B, A]);
  check('乱序 C,B,A -> #N 连续(1,2,3)', r2.get('c') === 1 && r2.get('b') === 2 && r2.get('a') === 3);
  const vals = [...T.renumber([A, B, C]).values()].sort((x, y) => x - y);
  check('#N 连续无空缺', JSON.stringify(vals) === '[1,2,3]', JSON.stringify(vals));
  // 注: renumber 在 vm 上下文内构造 Map，与外层 realm 的 Map 非同一构造器，故用鸭子类型而非 instanceof
  const r0 = T.renumber([]);
  check('空数组安全返回 Map', r0 && typeof r0.get === 'function' && r0.size === 0);
  const rU = T.renumber(undefined);
  check('undefined 安全返回空 Map', rU && typeof rU.get === 'function' && rU.size === 0);
}

// ================= resolveQuote =================
console.log('\n[resolveQuote]');
{
  const cover = { title: '我的小说', body: '这是楼主帖正文', images: [] };

  // ① 引用 cover
  const fCover = { id: 'q', quote: 'cover', author: '', content: 'x' };
  const rc = T.resolveQuote(fCover, [fCover], cover);
  check('cover: found=true', rc.found === true);
  check('cover: type=cover', rc.type === 'cover');
  check('cover: 解析楼主帖内容', rc.content === '这是楼主帖正文');
  check('cover: 身份=楼主帖(渲染层显示 楼主帖)', rc.type === 'cover');

  // ② 引用某 floor.id
  const A = { id: 'a', author: 'Bob', content: '第一楼内容', time: '', images: [], quote: null };
  const B = { id: 'b', author: '', content: '第二楼内容', time: '', images: [], quote: null };
  const allFloors = [A, B];
  const q1 = { id: 'q1', quote: 'a' };
  const r1 = T.resolveQuote(q1, allFloors, cover);
  check('floor: found=true', r1.found === true);
  check('floor: type=floor', r1.type === 'floor');
  check('floor: 解析身份 author=Bob', r1.author === 'Bob');
  check('floor: #N=1(当前顺序)', r1.floorNumber === 1);
  check('floor: 解析内容', r1.content === '第一楼内容');
  const q2 = { id: 'q2', quote: 'b' };
  const r2 = T.resolveQuote(q2, allFloors, cover);
  check('floor: #N=2', r2.floorNumber === 2);
  check('floor: 空 author 显示「匿名用户」', (r2.author || '匿名用户') === '匿名用户');

  // 拖动重排后 #N 重算（用稳定 id 查映射）
  const reordered = [B, A];
  const r1b = T.resolveQuote(q1, reordered, cover);
  check('重排后 quote a -> #N=2 重算', r1b.floorNumber === 2);

  // ③ 引用目标不存在/被删 -> 返回空不报错
  const qMiss = { id: 'q3', quote: 'deleted' };
  const rMiss = T.resolveQuote(qMiss, allFloors, cover);
  check('引用被删目标 -> found=false(不崩)', rMiss.found === false);
  check('quote=null -> found=false', T.resolveQuote({ id: 'q4', quote: null }, allFloors, cover).found === false);
  check('quote 空串 -> found=false', T.resolveQuote({ id: 'q5', quote: '' }, allFloors, cover).found === false);
}

// ================= splitPages =================
console.log('\n[splitPages]');
{
  const measure = b => b.h;

  // 三块 300, pageHeight=747 -> 应分 2 页
  const pagesA = T.splitPages([{ h: 300 }, { h: 300 }, { h: 300 }], 747, measure);
  check('三块300 -> 2页', pagesA.length === 2, 'got ' + pagesA.length);
  check('三块300 -> 页1含2块', pagesA[0].length === 2);
  check('三块300 -> 页2含1块', pagesA[1].length === 1);

  // 单块超高 -> 1 页占满（允许超页）
  const pagesB = T.splitPages([{ h: 1000 }], 747, measure);
  check('单块超高 -> 1页', pagesB.length === 1);
  check('单块超高 -> 整块不截断', pagesB[0][0].h === 1000);

  // 超高块夹中间 -> 独立成页
  const pagesC = T.splitPages([{ h: 200 }, { h: 1000 }, { h: 200 }], 747, measure);
  check('超高块独立成页 -> 3页', pagesC.length === 3, 'got ' + pagesC.length);
  check('超高块独立成页 -> 每页1块', pagesC.every(p => p.length === 1));

  // 两块 300 实际可放下(used=646<=747) -> 1 页（不提前翻页）
  const pagesD = T.splitPages([{ h: 300 }, { h: 300 }], 747, measure);
  check('两块300 -> 1页(不提前翻页)', pagesD.length === 1, 'got ' + pagesD.length);

  // 两块 350：本次 UI 改造把 GAP 从 14 改为 16（index.html L773），写死期望值会再次过期。
  // 故用真实 GAP/PAGE_PAD 动态判定期望页数：真实占用 = 2*PAGE_PAD + 2*350 + GAP（两块间只有 1 个间距）。
  // GAP=16 时 used=2*16+700+16=748>747 => 应 2 页（源码行为正确，旧测试期望值才过时）。
  const usedTwo350 = 2 * T.PAGE_PAD + 2 * 350 + T.GAP;
  const expectedTwo350 = usedTwo350 <= 747 ? 1 : 2;
  const pagesEdge = T.splitPages([{ h: 350 }, { h: 350 }], 747, measure);
  check('两块350(动态期望 ' + expectedTwo350 + '页)', pagesEdge.length === expectedTwo350,
    'got ' + pagesEdge.length + ' (used=' + usedTwo350 + ', GAP=' + T.GAP + ')');

  // 整块不跨页: 每块仅出现在恰好一页
  const many = [{ h: 120 }, { h: 400 }, { h: 250 }, { h: 600 }, { h: 90 }, { h: 300 }, { h: 500 }];
  const pagesE = T.splitPages(many, 747, measure);
  const pageOf = new Map();
  let split = false;
  pagesE.forEach(pg => pg.forEach(b => { if (pageOf.has(b)) split = true; pageOf.set(b, 1); }));
  check('整块不跨页: 每块只出现在一页', !split);
  check('整块不跨页: 块总数不变', pageOf.size === many.length);

  // 首块不提前翻页 (curY>0 才翻页)
  const pagesF = T.splitPages([{ h: 500 }], 747, measure);
  check('首块不提前翻页', pagesF.length === 1);
}

// ---------- 汇总 ----------
console.log('\n========================================');
console.log('JS 语法检查: ' + (syntaxOk ? 'PASS' : 'FAIL'));
if (!syntaxOk) console.log(syntaxMsg);
console.log(`纯函数单测: 通过 ${pass} / 失败 ${fail}`);
if (fail) { console.log('失败项:'); fails.forEach(f => console.log('  - ' + f)); }
console.log('========================================');

const summary = { syntaxOk, syntaxMsg, pass, fail, fails, pad: T.PAGE_PAD, gap: T.GAP };
fs.writeFileSync(path.join(__dirname, '.qa-result.json'), JSON.stringify(summary, null, 2));

process.exit(fail || !syntaxOk ? 1 : 0);
