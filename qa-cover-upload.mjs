// 轻量验证：设置面板封面图上传 UI 调整为 icon 按钮 + 横排文字
import fs from 'fs';
import vm from 'vm';
import path from 'path';

const file = 'D:/Z/yige/forum-novel-editor/index.html';
const html = fs.readFileSync(file, 'utf8');

// 提取两段 <script> 内容
function extractScripts(h){
  const re = /<script>([\s\S]*?)<\/script>/g;
  const out = []; let m;
  while((m = re.exec(h)) !== null) out.push(m[1]);
  return out;
}
const scripts = extractScripts(html);
console.log('script blocks:', scripts.length);

// ---- 最小 DOM 桩 ----
function makeEl(tag){
  const node = {
    tagName: (tag||'').toUpperCase(),
    nodeType: 1,
    children: [],
    childNodes: [],
    attributes: {},
    style: {},
    _text: '',
    appendChild(n){ this.children.push(n); this.childNodes.push(n); return n; },
    setAttribute(k,v){ this.attributes[k]=v; if(k==='class'){ this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean)); } },
    getAttribute(k){ return this.attributes[k]; },
    addEventListener(){},
    removeEventListener(){},
    click(){ this._clicked = true; },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    set innerHTML(v){ this._html = v; },
    get innerHTML(){ return this._html || ''; },
    classList: {
      _set: new Set(),
      add(c){ this._set.add(c); },
      contains(c){ return this._set.has(c); },
      remove(c){ this._set.delete(c); },
      toggle(c){ if(this._set.has(c)){ this._set.delete(c); return false; } this._set.add(c); return true; }
    },
  };
  Object.defineProperty(node, 'className', {
    get(){ return this.attributes.class || ''; },
    set(v){ this.setAttribute('class', v); }
  });
  Object.defineProperty(node, 'textContent', {
    get(){ return this._text; },
    set(v){ this._text = v; }
  });
  return node;
}

const documentStub = {
  createElement: makeEl,
  createTextNode: (t)=>({ nodeType:3, textContent:String(t), _text:String(t) }),
  querySelector: ()=>null,
  querySelectorAll: ()=>[],
  addEventListener(){},
  body: makeEl('body'),
  documentElement: makeEl('html'),
};

const sandbox = {
  console,
  document: documentStub,
  navigator: { userAgent: 'node' },
  localStorage: { getItem(){return null;}, setItem(){}, removeItem(){} },
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set,
  fetch: async ()=>({ ok:true, json: async()=>({}) }),
  indexedDB: undefined,
  HTMLElement: function(){},
  FileReader: function(){},
  crypto: { getRandomValues: (a)=>a },
};
// window = sandbox 自身，提供常用全局 API
const windowStub = sandbox;
windowStub.window = windowStub;
windowStub.globalThis = windowStub;
windowStub.addEventListener = function(){};
windowStub.removeEventListener = function(){};
windowStub.dispatchEvent = function(){};
sandbox.window = windowStub;

const ctx = vm.createContext(sandbox);

// 运行 script1（含 state / buildSettings / buildPickupSettings / el / iconSvg 等）
let syntaxOk = true;
try {
  vm.runInContext(scripts[0], ctx, { filename:'script1.js' });
  console.log('PASS 检查1: script1 编译+运行无语法/运行时错误');
} catch(e){
  syntaxOk = false;
  console.log('FAIL 检查1: script1 运行报错:', e.message);
}

// 辅助：递归查找带某 class 的节点
function findByClass(node, cls, acc){
  acc = acc || [];
  if(node && node.classList && node.classList.contains(cls)) acc.push(node);
  if(node && node.children){
    for(const c of node.children) findByClass(c, cls, acc);
  }
  return acc;
}
function findText(node, txt, acc){
  acc = acc || [];
  if(node && node._text === txt) acc.push(node);
  if(node && node.children){
    for(const c of node.children) findText(c, txt, acc);
  }
  return acc;
}

let pass2 = false, pass3 = false, pass4 = false, pass5 = false;
try {
  // 构造论坛体无封面状态，并通过 runInContext 调用（const state 不暴露到 sandbox 顶层）
  const box = vm.runInContext(
    `state.currentProject = { type:'forum', data:{ coverImage:null, settings:{ showTime:false, pageRatio:'9:16', pageHeightPx:null } } };
     buildSettings();`,
    ctx
  );
  const rows = findByClass(box, 'cover-upload-row');
  const labels = findText(box, '上传封面图');
  const btns = findByClass(box, 'cover-upload-btn');
  const files = rows.flatMap(r=>r.children.filter(c=>c.tagName==='INPUT' && c.attributes.type==='file'));

  pass2 = rows.length >= 1;
  pass3 = labels.length >= 1 && labels[0]._text === '上传封面图';
  pass4 = btns.length >= 1 && btns[0].children.some(c=>c._html && c._html.includes('<svg'));
  pass5 = files.length === 1;
  console.log(`检查2(含.cover-upload-row): ${pass2?'PASS':'FAIL'} (count=${rows.length})`);
  console.log(`检查3(文字"上传封面图"横排存在): ${pass3?'PASS':'FAIL'}`);
  console.log(`检查4(含.upload svg 按钮): ${pass4?'PASS':'FAIL'}`);
  console.log(`检查5(隐藏的 file input=1): ${pass5?'PASS':'FAIL'}`);
} catch(e){
  console.log('FAIL 检查2-5: buildSettings 报错:', e.message);
}

let pass6 = false;
try {
  const box2 = vm.runInContext(
    `state.currentProject = { type:'pickup', data:{ coverImage:null, settings:{ showTime:false, pageRatio:'9:16', pageHeightPx:null } } };
     buildPickupSettings();`,
    ctx
  );
  const rows2 = findByClass(box2, 'cover-upload-row');
  const btns2 = findByClass(box2, 'cover-upload-btn');
  pass6 = rows2.length >= 1 && btns2.length >= 1;
  console.log(`检查6(聊天体 pickup 同样结构): ${pass6?'PASS':'FAIL'}`);
} catch(e){
  console.log('FAIL 检查6: buildPickupSettings 报错:', e.message);
}

let pass7 = false;
try {
  const box3 = vm.runInContext(
    `state.currentProject = { type:'forum', data:{ coverImage:{ id:'x', dataUrl:'data:image/png;base64,aaa', name:'c' }, settings:{ showTime:false, pageRatio:'9:16', pageHeightPx:null } } };
     buildSettings();`,
    ctx
  );
  const rows3 = findByClass(box3, 'cover-upload-row');
  pass7 = rows3.length === 0;
  console.log(`检查7(已有封面不出现上传行): ${pass7?'PASS':'FAIL'}`);
} catch(e){
  console.log('FAIL 检查7:', e.message);
}

const allPass = syntaxOk && pass2 && pass3 && pass4 && pass5 && pass6 && pass7;
console.log('\n=== VERDICT: ' + (allPass ? 'PASS' : 'FAIL') + ' ===');
process.exit(allPass ? 0 : 1);
