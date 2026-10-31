const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../print-export.js'),'utf8');
// Exercise the real compositor with deterministic raster-image and DOM adapters.
async function run(failTiles=false){
 const elements={},draws=[];let printed=0;
 class El{
  constructor(id=''){this.id=id;this.children=[];this.hidden=false;this.value='';this.style={};this.disabled=false;this.inert=false;this._html='';}
  set innerHTML(v){this._html=v;for(const m of v.matchAll(/id="([^"]+)"/g))elements[m[1]]=new El(m[1]);}
  get innerHTML(){return this._html}setAttribute(){}removeAttribute(){}addEventListener(){}focus(){}scrollIntoView(){}append(e){this.children.push(e)}
  querySelector(s){if(s==='.print-map')return {decode:async()=>{}};return this.toolbar||(this.toolbar=new El());}
  getContext(){return new Proxy({drawImage:(...a)=>draws.push(a),measureText:()=>({width:20})},{get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>(o[k]=v,true)})}
  toDataURL(){return 'data:image/png;base64,TEST'}
 }
 for(const id of ['printStatus','printSelect','printMode','printScale','printDecl','base','gridT','printExport','msg','hud','panel','menuToggle'])elements[id]=new El(id);
 elements.printMode.value='view';elements.printScale.value='fit';elements.base.value='topo';elements.msg.textContent='';elements.gridT.checked=true;
 const body=new El(),head=new El();const document={body,head,activeElement:new El(),getElementById:id=>elements[id],createElement:tag=>new El(tag),querySelectorAll:()=>[]};
 class Image{set src(v){if(v)queueMicrotask(()=>{if(failTiles)this.onerror?.();else this.onload?.()})}}
 const context={document,Image,AbortController,DOMException,console,setTimeout,clearTimeout,queueMicrotask,Date,Math,Number,Error,Promise,window:{addEventListener(){},print(){printed++}},map:{on(){},getBounds:()=>({getWest:()=>-115,getEast:()=>-114,getSouth:()=>42,getNorth:()=>43})},wps:[],legs:[],prof:[],BASES:{topo:['https://example.test/{z}/{x}/{y}']},fmtMGRS:()=> '11T TEST',updateHud(){}};
 vm.createContext(context);
 const app=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');vm.runInContext(app.slice(app.indexOf('const A_='),app.indexOf('/* ---------- MGRS grid overlay')),context);
 vm.runInContext(source,context);
 await elements.printExport.onclick();
 assert.equal(elements.printExport.disabled,false);
 const preview=body.children[0];assert.equal(preview.hidden,false);
 if(failTiles){assert.match(elements.printContent.textContent,/could not load/);assert.equal(elements.printNow.onclick,undefined);return;}
 assert.match(elements.printContent.innerHTML,/MGRS FIELD MAP/);assert.match(elements.printContent.innerHTML,/Magnetic declination unavailable/);assert.match(elements.printContent.innerHTML,/USGS/);assert.match(elements.printContent.innerHTML,/km grid/);assert(draws.length>0&&draws.length<=100);assert.equal(elements.printNow.disabled,false);elements.printNow.onclick();assert.equal(printed,1);
 elements.printScale.value='50000';await elements.printExport.onclick();assert.match(elements.printStatus.textContent,/does not fit/);
 elements.printMode.value='route';await elements.printExport.onclick();assert.match(elements.printStatus.textContent,/No route yet/);
 elements.printMode.value='selection';await elements.printExport.onclick();assert.match(elements.printStatus.textContent,/two opposite corners/);
}
(async()=>{await run();await run(true);console.log('PASS: no-waypoint current-view preview, large-area fit, tile compositing, print action, optional magnetic model, fixed-scale feedback, missing route/selection, tile failure without blank print.');})().catch(e=>{console.error(e);process.exitCode=1});
