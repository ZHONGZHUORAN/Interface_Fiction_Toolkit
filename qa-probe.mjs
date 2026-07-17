import * as vm from 'node:vm';
import { readFileSync } from 'node:fs';
const html = readFileSync('D:/Z/yige/forum-novel-editor/index.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const [script1, script2Raw] = blocks;
const script2 = script2Raw.replace(/\bimport\(/g, '__import(');
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
const body=new Element('body'); const mr=new Element('div'); mr.setAttribute('id','modal-root'); body.appendChild(mr);
const documentStub={readyState:'loading',body,createElement:t=>new Element(t),createTextNode:t=>new TextNode(t),getElementById:id=>body._findById(id),querySelector:s=>body.querySelector(s),querySelectorAll:s=>body.querySelectorAll(s),addEventListener:()=>{},removeEventListener:()=>{}};
const windowStub={addEventListener:()=>{},removeEventListener:()=>{},innerWidth:1200,location:{origin:'http://localhost',pathname:'/'}};
const navigatorStub={onLine:true}; const locationStub={origin:'http://localhost',pathname:'/'};
function FakeFileReader(){this.result=null;this.onload=null;} FakeFileReader.prototype.readAsDataURL=function(){this.result='data:image/png;base64,STUB';if(typeof this.onload==='function')this.onload();};
const sandbox={document:documentStub,window:windowStub,navigator:navigatorStub,location:locationStub,localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{},clear:()=>{}},FileReader:FakeFileReader,console,setTimeout,clearTimeout,__import:async()=>({createClient:()=>null})};
const ctx=vm.createContext(sandbox);
vm.runInContext(script1,ctx,{filename:'s1.js'}); vm.runInContext(script2,ctx,{filename:'s2.js'});
const mem=new Map(); ctx.idbGetAll=async()=>[...mem.values()]; ctx.idbGet=async id=>mem.get(id)||null; ctx.idbPut=async p=>{mem.set(p.id,p);}; ctx.idbDelete=async id=>{mem.delete(id);};
const ev=(c)=>vm.runInContext(c,ctx,{filename:'t.js'});
try{ev('augmentState(); wrapRender();');}catch(e){console.log('init err',e.message);}
// PROBE: el with 4th arg text
ev("const __b=el('button',{class:'btn btn-primary'}, iconSvg('plus'), ' 新建作品');");
const probe=ev('__b');
console.log('PROBE newBtn textContent =', JSON.stringify(probe.textContent));
console.log('PROBE newBtn childNodes count =', probe.childNodes.length);
console.log('PROBE newBtn innerHTML =', JSON.stringify(probe.innerHTML));
// back button
ev("const __b2=el('button',{class:'btn btn-ghost'}, iconSvg('back'), ' 返回列表');");
const p2=ev('__b2');
console.log('PROBE backBtn textContent =', JSON.stringify(p2.textContent));
console.log('PROBE backBtn childNodes count =', p2.childNodes.length);
// iconSvg structure
ev("const __i=iconSvg('back');");
const i=ev('__i');
console.log('PROBE iconSvg tag =', i.tagName, 'className =', i.className, 'innerHTML has <svg =', i.innerHTML.includes('<svg'), 'has <path =', i.innerHTML.includes('<path'));
