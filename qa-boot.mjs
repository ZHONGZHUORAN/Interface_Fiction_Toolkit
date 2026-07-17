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
const windowStub={addEventListener:()=>{},removeEventListener:()=>{},innerWidth:1200,location:{origin:'https://zhongzhuoran.github.io',pathname:'/Interface_Fiction_Toolkit/'}};
const navigatorStub={onLine:true}; const locationStub={origin:'https://zhongzhuoran.github.io',pathname:'/Interface_Fiction_Toolkit/'};

/* ---------- realistic supabase mock (mimics real browser path) ---------- */
function makeFakeSb(){
  const handlers=[];
  return {
    auth:{
      onAuthStateChange(cb){ handlers.push(cb); 
        // mimic supabase: fire INITIAL_SESSION asynchronously
        setTimeout(()=>{ try{ cb('INITIAL_SESSION', null); }catch(e){ console.log('AUTH_CB_THROW:', e.stack||e.message); } }, 5);
        return { data:{ subscription:{ unsubscribe(){} } } };
      },
      getSession(){ return Promise.resolve({ data:{ session:null } }); },
      signInWithPassword(){ return Promise.resolve({ data:{ session:null }, error:null }); },
      signUp(){ return Promise.resolve({ data:{ session:null }, error:null }); },
      signOut(){ return Promise.resolve({ error:null }); },
      resetPasswordForEmail(){ return Promise.resolve({ error:null }); }
    },
    from(){ return { upsert(){return Promise.resolve({error:null});}, delete(){return Promise.resolve({error:null});}, select(){return Promise.resolve({data:[],error:null});}, eq(){return this;}, maybeSingle(){return Promise.resolve({data:null,error:null});} }; },
    channel(){ return { on(){return this;}, subscribe(){return this;} }; },
    removeChannel(){ return Promise.resolve(); }
  };
}
const FAKE_SB = makeFakeSb();
const __import = async (url)=>({ createClient: ()=>FAKE_SB });

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

const MEM = !!process.env.MEM;
console.log('=== MODE:', MEM ? 'MEMORY FALLBACK (indexedDB unavailable)' : 'real IndexedDB stub', '===');

const errors=[];
process.on('unhandledRejection', e=>{ errors.push('UNHANDLED_REJECTION: '+(e&&e.stack||e)); });

const sandbox={document:documentStub,window:windowStub,navigator:navigatorStub,location:locationStub,indexedDB: MEM ? undefined : fakeIndexedDB,localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{},clear:()=>{}},FileReader:class{readAsDataURL(){this.result='data:image/png;base64,STUB';if(this.onload)this.onload();}},console,setTimeout,clearTimeout,Promise,__import};
const ctx=vm.createContext(sandbox);

console.log('=== running scripts (real boot auto-runs: init().then(initSync)) ===');
try{ vm.runInContext(script1,ctx,{filename:'s1.js'}); }catch(e){ errors.push('SCRIPT1 THROW: '+(e.stack||e.message)); }
try{ vm.runInContext(script2,ctx,{filename:'s2.js'}); }catch(e){ errors.push('SCRIPT2 THROW: '+(e.stack||e.message)); }

const ev=(c)=>vm.runInContext(c,ctx,{filename:'t.js'});
const evA=async(c)=>{ try{ return await vm.runInContext('(async()=>{'+c+'})()',ctx,{filename:'t.js'}); }catch(e){ console.log('evA err:',e.message); throw e; } };

// wait for init + initSync + auth callback + 1500ms setTimeout
await new Promise(r=>setTimeout(r, 2200));

console.log('\n=== after full boot ===');
console.log('state.view        =', ev('state.view'));
console.log('state.userId      =', ev('state.userId'));
console.log('loginVisible()    =', ev('loginVisible()'));
console.log('#app childNodes   =', ev('document.getElementById("app").childNodes.length'));
console.log('#app textContent  =', JSON.stringify(ev('document.getElementById("app").textContent').slice(0,120)));
console.log('login-overlay?    =', ev('!!document.getElementById("login-overlay")'));
console.log('overlay text      =', JSON.stringify(ev('(document.getElementById("login-overlay")||{textContent:""}).textContent').slice(0,120)));

console.log('\n=== ERRORS CAPTURED ('+errors.length+') ===');
for(const e of errors) console.log(e);
if(errors.length===0) console.log('NONE');

/* ---------- create-project round trip ---------- */
console.log('\n=== create-project round trip ===');
const appEl2 = ev('document.querySelector("#app")');
const newBtn = appEl2 ? appEl2.querySelector('.btn-primary') : null;
console.log('found 新建作品 btn:', !!newBtn, '| label:', JSON.stringify(newBtn && newBtn.textContent));
if(newBtn){ newBtn.click(); }
await new Promise(r=>setTimeout(r,30));
const okBtn = ev('document.querySelector("#modal-root").querySelectorAll("button")').find ? null : null;
const modalBtns = ev('document.querySelector("#modal-root").querySelectorAll("button")');
const createBtn = modalBtns.find ? modalBtns.find(b=>(b.textContent||'').includes('创建')) : null;
console.log('found 创建 btn:', !!createBtn);
if(createBtn){ createBtn.click(); }
await new Promise(r=>setTimeout(r,60));
const idbLen = await evA('const a=await idbGetAll(); return a.length;');
const cards = ev('document.querySelectorAll(".proj-card").length');
const view = ev('state.view');
console.log('after create -> idb length:', idbLen, '| cards rendered:', cards, '| view:', view);
// 新建成功后会跳转到 editor 视图，此时首页 .proj-card 自然为 0；以 idb 落库 + 视图切换判定成功
console.log(idbLen>=1 && (cards>=1 || view==='editor') ? 'PASS: project created & persisted' : 'FAIL: project not persisted');

