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
 setAttribute(k,v){this.attributes[k]=v;if(k==='id')this.attributes.id=v;} getAttribute(k){return (k in this.attributes)?this.attributes[k]:null;} removeAttribute(k){delete this.attributes[k];}
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

/* ---------- fake Supabase that returns success ---------- */
function fakeSupabase(){
  return {
    from(table){
      return {
        upsert(){ return {error:null}; },
        delete(){ return {eq(){ return {eq(){ return {error:null}; }}; }}; },
        select(){ return {eq(){ return {eq(){ return {maybeSingle(){ return {data:null,error:null}; }}; }}; }}; },
      };
    },
    auth:{ getSession(){ return {data:{session:null},error:null}; }, onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}},error:null}; }, signOut(){ return {error:null}; } },
    channel(){ return { on(){ return this; }, subscribe(){ return this; } }; },
    removeChannel(){},
  };
}

const sandbox={document:documentStub,window:windowStub,navigator:navigatorStub,location:locationStub,indexedDB:fakeIndexedDB,localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{},clear:()=>{}},FileReader:FakeFileReader,console,setTimeout,clearTimeout,__import:async()=>({createClient:()=>fakeSupabase()})};
const ctx=vm.createContext(sandbox);
vm.runInContext(script1,ctx,{filename:'s1.js'}); vm.runInContext(script2,ctx,{filename:'s2.js'});
const ev=(c)=>vm.runInContext(c,ctx,{filename:'t.js'});
const evA=async(c)=>{ try{ return await vm.runInContext('(async()=>{'+c+'})()',ctx,{filename:'t.js'}); }catch(e){ console.log('evA err:',e.message); throw e; } };
const tick=async()=>{ await evA('await new Promise(r=>setTimeout(r,40))'); };
const log=(...a)=>console.log(...a);
let failed=0;
function assert(cond,msg){ if(cond) log('  PASS',msg); else { log('  FAIL',msg); failed++; } }

(async ()=>{
  log('\n=== SETUP: init + login ===');
  await evA('await init()');
  await evA('await handleSignedIn({user:{id:"u1",email:"a@b.com"}})');
  assert(ev('state.userId')==='u1', 'logged in');

  log('\n=== TEST 1: pushProject records own push timestamp ===');
  const now = Date.now();
  ctx.now = now;
  await evA(`
    const p = {id:'p1', title:'1', updatedAt: ${now}, type:'novel', data:{floors:[]}, createdAt: ${now}};
    state.currentProject = p;
    state.__ownPushes = new Map();
    await pushProject(p);
  `);
  const hasOwn = ev('state.__ownPushes.has("p1")');
  const ownTs = ev('state.__ownPushes.get("p1")');
  assert(hasOwn && typeof ownTs === 'number' && ownTs > 0, 'ownPush timestamp recorded (got '+ownTs+')');

  log('\n=== TEST 2: own UPDATE event does NOT open modal ===');
  ev('modalCount = 0; openModal = function(){ modalCount++; return function(){}; };');
  await evA(`
    await handleRealtimeEvent({eventType:'UPDATE', new:{id:'p1', title:'1', updated_at:new Date(${now}).toISOString(), owner_id:'u1', data_json:'{}'}});
  `);
  await tick();
  const ownModal = ev('modalCount');
  assert(ownModal === 0, 'own UPDATE ignored, no modal (modalCount='+ownModal+')');

  log('\n=== TEST 3: other device UPDATE still opens modal ===');
  ev('modalCount = 0; state.__ownPushes = new Map(); state.projects=[{id:"p1",title:"1",updatedAt:'+now+',type:"novel",data:{floors:[]}}];');
  // 真正弹窗的 Promise 会等待用户点击，这里不 await，只检查 openModal 是否被调用到。
  ev(`handleRealtimeEvent({eventType:'UPDATE', new:{id:'p1', title:'1', updated_at:new Date(${now}+100000).toISOString(), owner_id:'u1', data_json:'{}'}});`);
  await tick();
  const otherModal = ev('modalCount');
  assert(otherModal === 1, 'other device UPDATE opens modal (modalCount='+otherModal+')');

  log('\n=== RESULT ===');
  log(failed===0 ? 'ALL PASS — own push loopback ignored, real remote update still prompts' : (failed+' assertion(s) FAILED'));
  process.exit(failed===0?0:1);
})();
