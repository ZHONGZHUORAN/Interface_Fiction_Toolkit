// 轻量验证：首页筛选器 + 卡片类型标签
import fs from 'fs';
import vm from 'vm';

const file = 'D:/Z/yige/forum-novel-editor/index.html';
const html = fs.readFileSync(file, 'utf8');

function extractScripts(h){
  const re = /<script>([\s\S]*?)<\/script>/g;
  const out = []; let m;
  while((m = re.exec(h)) !== null) out.push(m[1]);
  return out;
}
const scripts = extractScripts(html);

function makeEl(tag){
  const node = {
    tagName: (tag||'').toUpperCase(),
    nodeType: 1,
    children: [], childNodes: [],
    attributes: {}, style: {},
    _text: '',
    appendChild(n){ this.children.push(n); this.childNodes.push(n); return n; },
    setAttribute(k,v){ this.attributes[k]=v; if(k==='class'){ this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean)); } },
    getAttribute(k){ return this.attributes[k]; },
    addEventListener(){}, removeEventListener(){},
    click(){ this._clicked = true; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    set innerHTML(v){ this._html = v; this.children = []; }, get innerHTML(){ return this._html || ''; },
    classList: { _set:new Set(), add(c){this._set.add(c);}, contains(c){return this._set.has(c);}, remove(c){this._set.delete(c);}, toggle(c){if(this._set.has(c)){this._set.delete(c);return false;}this._set.add(c);return true;} }
  };
  Object.defineProperty(node, 'className', { get(){return this.attributes.class||'';}, set(v){this.setAttribute('class',v);} });
  Object.defineProperty(node, 'textContent', { get(){return this._text;}, set(v){this._text=v;} });
  return node;
}

let appStub = makeEl('div');
const documentStub = {
  createElement: makeEl,
  createTextNode: (t)=>({ nodeType:3, textContent:String(t), _text:String(t) }),
  querySelector: ()=>null, querySelectorAll: ()=>[],
  addEventListener(){}, body: makeEl('body'), documentElement: makeEl('html'),
  getElementById: ()=> appStub,
};

const sandbox = {
  console, document: documentStub,
  navigator: { userAgent:'node' },
  localStorage: { getItem(){return null;}, setItem(){}, removeItem(){} },
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set,
  fetch: async ()=>({ ok:true, json: async()=>({}) }),
  indexedDB: undefined, HTMLElement: function(){}, FileReader: function(){},
  crypto: { getRandomValues:(a)=>a },
};
const windowStub = sandbox;
windowStub.window = windowStub; windowStub.globalThis = windowStub;
windowStub.addEventListener=function(){}; windowStub.removeEventListener=function(){}; windowStub.dispatchEvent=function(){};
sandbox.window = windowStub;

const ctx = vm.createContext(sandbox);

let syntaxOk = true;
try { vm.runInContext(scripts[0], ctx, { filename:'script1.js' }); console.log('PASS 检查1: script1 编译+运行无语法/运行时错误'); }
catch(e){ syntaxOk = false; console.log('FAIL 检查1: script1 报错:', e.message); }

// buildAccountBtn 定义在 script2，renderHome 立即调用它；这里桩一个返回按钮的 stub 即可
vm.runInContext("globalThis.buildAccountBtn = function(){ return document.createElement('button'); };", ctx);

function findByClass(node, cls, acc){ acc=acc||[]; if(node&&node.classList){ const parts=cls.split(/\s+/); if(parts.every(p=>node.classList.contains(p))) acc.push(node); } if(node&&node.children) for(const c of node.children) findByClass(c,cls,acc); return acc; }
function findText(node, txt, acc){ acc=acc||[]; if(node&&node._text===txt) acc.push(node); if(node&&node.children) for(const c of node.children) findText(c,txt,acc); return acc; }

let pass2=false, pass3=false, pass4=false, pass5=false;
try {
  // 构造 forum + pickup 两个项目
  const code = `state.projects = [
    { id:'a', title:'论坛项目A', type:'forum', updatedAt:1700000000000, data:{ floors:[{id:'f1'}], coverImage:null, settings:{} } },
    { id:'b', title:'聊天项目B', type:'pickup', updatedAt:1700000000001, data:{ chats:[{id:'c1'}], coverImage:null, settings:{} } }
  ];
  state.homeFilter='all';
  renderHome();`;
  vm.runInContext(code, ctx);
  const headerRows = findByClass(appStub, 'home-filter');
  const sel = headerRows.length ? headerRows[0].children.find(c=>c.tagName==='SELECT') : null;
  const selVals = sel ? sel.children.map(o=>o.value).join(',') : 'NO_SEL';
  console.log('  [debug] home-filter count=', headerRows.length, ' sel vals=', selVals);
  pass2 = !!sel && sel.children.length===3 && selVals==='all,forum,pickup';
  console.log(`检查2(筛选器含3项 all/forum/pickup): ${pass2?'PASS':'FAIL'}`);

  // grid 卡片数量：默认全部 => 2 张
  const cardsAll = findByClass(appStub, 'proj-card');
  pass3 = cardsAll.length===2;
  console.log(`检查3(默认全部=2张卡): ${pass3?'PASS':'FAIL'} (count=${cardsAll.length})`);

  // 每张卡含 tag，forum=论坛体蓝，pickup=聊天体绿
  const forumCard = cardsAll.find(c=>findText(c,'论坛项目A').length>0);
  const pickupCard = cardsAll.find(c=>findText(c,'聊天项目B').length>0);
  const forumTag = forumCard ? findByClass(forumCard,'proj-type-tag')[0] : null;
  const pickupTag = pickupCard ? findByClass(pickupCard,'proj-type-tag')[0] : null;
  const forumText = forumTag && forumTag.children[0] ? forumTag.children[0]._text : '';
  const pickupText = pickupTag && pickupTag.children[0] ? pickupTag.children[0]._text : '';
  console.log('  [debug] forumTag text=', JSON.stringify(forumText), ' pickupTag text=', JSON.stringify(pickupText));
  pass4 = forumTag && forumText==='论坛体' && pickupTag && pickupText==='聊天体';
  console.log(`检查4(卡片tag 论坛体/聊天体 正确): ${pass4?'PASS':'FAIL'}`);
} catch(e){ console.log('FAIL 检查2-4:', e.message); }

try {
  // 切到 forum 筛选
  vm.runInContext("state.homeFilter='forum'; renderHome();", ctx);
  const cardsForum = findByClass(appStub, 'proj-card');
  const onlyForum = cardsForum.length===1 && findText(cardsForum[0],'论坛项目A').length>0;
  // 切到 pickup 筛选
  vm.runInContext("state.homeFilter='pickup'; renderHome();", ctx);
  const cardsPickup = findByClass(appStub, 'proj-card');
  const onlyPickup = cardsPickup.length===1 && findText(cardsPickup[0],'聊天项目B').length>0;
  pass5 = onlyForum && onlyPickup;
  console.log(`检查5(筛选forum仅论坛卡/pickup仅聊天卡): ${pass5?'PASS':'FAIL'}`);
} catch(e){ console.log('FAIL 检查5:', e.message); }

const allPass = syntaxOk && pass2 && pass3 && pass4 && pass5;
console.log('\n=== VERDICT: ' + (allPass?'PASS':'FAIL') + ' ===');
process.exit(allPass?0:1);
