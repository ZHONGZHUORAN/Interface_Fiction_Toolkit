import * as vm from 'node:vm';
import { readFileSync } from 'node:fs';
const html = readFileSync('D:/Z/yige/forum-novel-editor/index.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const [script1, script2Raw] = blocks;
const script2 = script2Raw.replace(/\bimport\(/g, '__import(');

/* ---------- DOM stub ---------- */
class TextNode { constructor(t){this.nodeType=3;this._text=String(t);this.parentNode=null;} get text(){return this._text;} set text(v){this._text=String(v);} get textContent(){return this._text;} set textContent(v){this._text=String(v);} }
class Element { constructor(tag){this.tagName=tag;this.childNodes=[];this.parentNode=null;this.attributes={};this._class='';this._classes=new Set();this.listeners={};this.style={};this.value='';this.checked=false;this.disabled=false;this.files=[];this._text='';this._innerHTML='';}
 get className(){return this._class;} set className(v){this._class=v||'';this._classes=new Set(String(v||'').split(/\s+/).filter(Boolean));}
 get classList(){const s=this;return{add:c=>s._classes.add(c),remove:c=>s._classes.delete(c),toggle:(c,f)=>{if(f===undefined){s._classes.has(c)?s._classes.delete(c):s._classes.add(c);}else{f?s._classes.add(c):s._classes.delete(c);}},contains:c=>s._classes.has(c)};}
 get id(){return this.attributes.id;} setAttribute(k,v){this.attributes[k]=v;if(k==='id')this.attributes.id=v;} getAttribute(k){return (k in this.attributes)?this.attributes[k]:null;} removeAttribute(k){delete this.attributes[k];}
 appendChild(c){c.parentNode=this;this.childNodes.push(c);return c;} prepend(c){c.parentNode=this;this.childNodes.unshift(c);return c;} removeChild(c){const i=this.childNodes.indexOf(c);if(i>=0)this.childNodes.splice(i,1);c.parentNode=null;return c;} remove(){if(this.parentNode)this.parentNode.removeChild(this);}
 addEventListener(t,fn){(this.listeners[t]=this.listeners[t]||[]).push(fn);} removeEventListener(t,fn){const a=this.listeners[t];if(a){const i=a.indexOf(fn);if(i>=0)a.splice(i,1);}} click(){(this.listeners['click']||[]).forEach(fn=>fn({target:this,preventDefault(){},stopPropagation(){}}));}
 get textContent(){let o='';const w=n=>{if(n instanceof TextNode)o+=n.text;else if(n instanceof Element){if(n._text)o+=n._text;n.childNodes.forEach(w);}};w(this);return o;} set textContent(v){this._text=String(v);this.childNodes=[];}
 get innerHTML(){return this._innerHTML;} set innerHTML(v){this._innerHTML=v;if(v==='')this.childNodes=[];}
 _match(sel){if(sel.startsWith('#'))return this.attributes.id===sel.slice(1);if(sel.startsWith('.'))return this._classes.has(sel.slice(1));return this.tagName===sel;}
 querySelector(sel){return this._findAll(sel)[0]||null;} querySelectorAll(sel){return this._findAll(sel);}
 _findAll(sel){const r=[];const w=n=>{if(n instanceof Element){if(n._match(sel))r.push(n);n.childNodes.forEach(w);}};this.childNodes.forEach(w);return r;}
 _findById(id){if(this.attributes.id===id)return this;for(const c of this.childNodes){if(c instanceof Element){const x=c._findById(id);if(x)return x;}}return null;}
}
const body=new Element('body');
const appEl=new Element('div'); appEl.setAttribute('id','app'); body.appendChild(appEl);
const mr=new Element('div'); mr.setAttribute('id','modal-root'); body.appendChild(mr);
const documentStub={readyState:'complete',body,createElement:t=>new Element(t),createTextNode:t=>new TextNode(t),getElementById:id=>body._findById(id),querySelector:s=>body.querySelector(s),querySelectorAll:s=>body.querySelectorAll(s),addEventListener:()=>{},removeEventListener:()=>{}};
const windowStub={addEventListener:()=>{},removeEventListener:()=>{},innerWidth:1200,location:{origin:'http://localhost',pathname:'/'}};
const navigatorStub={onLine:true}; const locationStub={origin:'http://localhost',pathname:'/'};
function FakeFileReader(){this.result=null;this.onload=null;} FakeFileReader.prototype.readAsDataURL=function(){this.result='data:image/png;base64,STUB';if(typeof this.onload==='function')this.onload();};

/* ---------- in-memory IndexedDB fake ---------- */
const _store=new Map();
class FakeOS{ constructor(tx){this.tx=tx;}
 getAll(){const r={result:[..._store.values()]};setTimeout(()=>r.onsuccess&&r.onsuccess(),0);return r;}
 get(id){const r={result:_store.get(id)||null};setTimeout(()=>r.onsuccess&&r.onsuccess(),0);return r;}
 put(p){_store.set(p.id,p);setTimeout(()=>this.tx.oncomplete&&this.tx.oncomplete(),0);return {onsuccess:null,onerror:null};}
 delete(id){_store.delete(id);setTimeout(()=>this.tx.oncomplete&&this.tx.oncomplete(),0);return {onsuccess:null,onerror:null};}
}
class FakeTx{ constructor(){this.oncomplete=null;this.onerror=null;} objectStore(){return new FakeOS(this);} }
const fakeIndexedDB={ open(){ const req={result:{createObjectStore(){return {};},transaction(){return new FakeTx();}},onupgradeneeded:null,onsuccess:null,onerror:null}; setTimeout(()=>{if(req.onupgradeneeded)req.onupgradeneeded();if(req.onsuccess)req.onsuccess();},0); return req; } };

const sandbox={document:documentStub,window:windowStub,navigator:navigatorStub,location:locationStub,indexedDB:fakeIndexedDB,localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{},clear:()=>{}},FileReader:FakeFileReader,console,setTimeout,clearTimeout,__import:async()=>({createClient:()=>null})};
const ctx=vm.createContext(sandbox);
vm.runInContext(script1,ctx,{filename:'s1.js'}); vm.runInContext(script2,ctx,{filename:'s2.js'});
const ev=(c)=>vm.runInContext(c,ctx,{filename:'t.js'});
const evA=async(c)=>{ try{ return await vm.runInContext('(async()=>{'+c+'})()',ctx,{filename:'t.js'}); }catch(e){ console.log('evA err:',e.message); throw e; } };
const tick=async()=>{ await evA('await new Promise(r=>setTimeout(r,40))'); };
const log=(...a)=>console.log(...a);
let failed=0;
function assert(cond,msg){ if(cond) log('  PASS',msg); else { log('  FAIL',msg); failed++; } }
async function findBtnByText(rootSel, text){
  const root = ev(`document.querySelector('${rootSel}')`);
  const btns = root ? root.querySelectorAll('button') : [];
  for(const b of btns){ if((b.textContent||'').includes(text)) return b; }
  return null;
}
(async ()=>{
  log('\n=== STEP 1: init() (no login, empty idb) ===');
  try{ await evA('await init()'); }catch(e){ log('  init err:', e.message); }
  assert(ev('state.view')==='home', 'view is home after init');
  assert(ev('state.projects.length')===0, 'projects empty after init');
  assert(ev('document.querySelectorAll(".proj-card").length')===0, 'no cards rendered at start');

  log('\n=== STEP 2: simulate LOGIN (empty cloud) ===');
  try{ await evA('await handleSignedIn({user:{id:"u1",email:"a@b.com"}})'); }catch(e){ log('  login err:', e.message); }
  assert(ev('state.userId')==='u1', 'userId set after login');
  assert(ev('state.projects.length')===0, 'projects still empty after login (new user)');
  { const dump = ev('(document.querySelector("#app")?document.querySelector("#app").querySelectorAll("button").map(b=>b.textContent):"NO #app")'); log('  DEBUG home buttons:', JSON.stringify(dump)); }

  log('\n=== STEP 3: click 新建作品 -> open modal -> click 创建 ===');
  const appEl2 = ev('document.querySelector("#app")');
  const newBtn = appEl2 ? appEl2.querySelector('.btn-primary') : null;
  assert(!!newBtn, 'found 新建作品 button on home (by .btn-primary)');
  assert(!!newBtn && (newBtn.textContent||'').includes('新建作品'), '新建作品 TEXT LABEL restored on home button (got '+JSON.stringify(newBtn&&newBtn.textContent)+')');
  if(newBtn) newBtn.click();
  await tick();
  const okBtn = await findBtnByText('#modal-root', '创建');
  assert(!!okBtn, 'found 创建 button in modal');
  if(okBtn){ okBtn.click(); await tick(); await tick(); }

  assert(ev('state.currentProject != null'), 'currentProject created after 创建');
  assert(ev('state.projects.length')===1, 'project added to state.projects (got '+ev('state.projects.length')+')');
  const idbLen = await evA('const a=await idbGetAll(); return a.length;');
  assert(idbLen===1, 'project persisted to idb (got '+idbLen+')');
  assert(ev('state.view')==='editor', 'view switched to editor after create');

  log('\n=== STEP 4: click 返回列表 (goHome) ===');
  const backBtn = await findBtnByText('#app', '返回列表');
  assert(!!backBtn, 'found 返回列表 button in editor');
  assert(!!backBtn && (backBtn.textContent||'').includes('返回列表'), '返回列表 TEXT LABEL restored on editor back button (got '+JSON.stringify(backBtn&&backBtn.textContent)+')');
  if(backBtn){ backBtn.click(); await tick(); await tick(); }
  assert(ev('state.view')==='home', 'view back to home');
  assert(ev('state.projects.length')===1, 'project still in state.projects after goHome (got '+ev('state.projects.length')+')');
  const cards = ev('document.querySelectorAll(".proj-card").length');
  assert(cards===1, 'project card RENDERED on home after goHome (got '+cards+')');

  log('\n=== RESULT ===');
  log(failed===0 ? 'ALL PASS — create->list works in current code' : (failed+' assertion(s) FAILED'));
  process.exit(failed===0?0:1);
})();
