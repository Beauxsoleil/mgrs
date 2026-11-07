const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const init=html.slice(html.indexOf('let view3D='),html.indexOf('const E0='));
const logic=html.slice(html.indexOf('function saveViewMode()'),html.indexOf('/* ---------- UTM math'));
function setup(saved,reduced=false){let pitch=57,max=85,attrs={},duration;const memory={'mgrs-3d':saved},events={},button={setAttribute:(k,v)=>attrs[k]=v};const ctx={SV:null,$:()=>button,localStorage:{getItem:k=>memory[k]||null,setItem:(k,v)=>memory[k]=v},window:{matchMedia:()=>({matches:reduced})},map:{stop(){},getPitch:()=>pitch,setMaxPitch:v=>{max=v;if(pitch>max)pitch=max},easeTo:o=>{pitch=o.pitch;duration=o.duration},on:(e,f)=>events[e]=f}};vm.createContext(ctx);vm.runInContext(init+logic,ctx);return{ctx,button,attrs,memory,events,get:()=>({pitch,max,duration}),setPitch:v=>pitch=v};}
let s=setup();assert.equal(s.attrs['aria-checked'],'true');s.button.onclick();assert.equal(s.get().pitch,0);assert.equal(s.get().max,0);assert.equal(s.attrs['aria-checked'],'false');s.button.onclick();assert.equal(s.get().pitch,57);assert.equal(s.get().max,85);
s.setPitch(72);s.events.pitchend();s.button.onclick();const saved=s.memory['mgrs-3d'];s=setup(saved,true);assert.equal(s.attrs['aria-checked'],'false');s.button.onclick();assert.equal(s.get().pitch,72);assert.equal(s.get().duration,0);
s=setup('{broken');assert.equal(s.attrs['aria-checked'],'true');
assert(html.includes('pitch:view3D?view3DPitch:0'));assert(html.includes('maxPitch:view3D?85:0'));
console.log('PASS: flat view, pitch lock, tilt restoration, remembered preference, reduced motion, malformed storage');
