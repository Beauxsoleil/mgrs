const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const R=require('../road-routing.js');
const pts=[[-114.46,42.56],[-114.45,42.57]];
const response={code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[pts[0],[-114.455,42.568],pts[1]]},distance:1750,duration:1200}],waypoints:[{distance:5},{distance:20}]};
assert.match(R.urlFor('foot',pts),/routed-foot\/route\/v1\/driving/);assert.match(R.urlFor('car',pts),/routed-car/);assert.match(R.urlFor('foot',pts),/radiuses=250;250/);
assert.throws(()=>R.urlFor('foot',[]),/2–25/);assert.throws(()=>R.urlFor('car',Array(26).fill(pts[0])),/2–25/);assert.throws(()=>R.urlFor('car',[[NaN,42],pts[1]]),/Invalid/);
assert.equal(R.parse(response,2).distance,1750);assert.throws(()=>R.parse({code:'NoRoute'},2),/No connected/);assert.throws(()=>R.parse({code:'NoSegment'},2),/250 m/);assert.throws(()=>R.parse({...response,routes:[]},2),/Invalid/);
(async()=>{
 const starts=[];const client=R.createClient(async()=>{starts.push(Date.now());return{ok:true,json:async()=>response}});
 await Promise.all([client('foot',pts,new AbortController().signal),client('car',pts,new AbortController().signal)]);assert(starts[1]-starts[0]>=1050);
 const ac=new AbortController();ac.abort();await assert.rejects(client('foot',pts,ac.signal),{name:'AbortError'});
 const limited=R.createClient(async()=>({status:429}));await assert.rejects(limited('car',pts,new AbortController().signal),/busy/);
 // Exercise application state changes while a route response is in flight.
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const block=html.slice(html.indexOf('let roadResult='),html.indexOf('\nsyncRouteControls();',html.indexOf('let roadResult='))+21);
 const elements={};for(const id of ['routeMode','roadOptions','auto','maxs','wm','fl','pace','prof','roadCalculate','roadCancel','sD','sT','sG','sL'])elements[id]={value:'',disabled:false};elements.routeMode.value='foot';elements.pace.value='1.3';
 let resolveRequest,rendered,msg='';const context={RoadRouting:{urlFor:R.urlFor,createClient:()=>()=>new Promise(r=>resolveRequest=r)},$:id=>elements[id],wps:pts.map(p=>({getLngLat:()=>({toArray:()=>p})})),token:0,prof:[],AbortController,setTimeout,clearTimeout,fetch(){},map:{getSource:()=>({setData:d=>rendered=d})},E0:()=>({features:[]}),hav:()=>100,updatePt(){},setMsg:t=>msg=t,changed(){},update:()=>context.updateRoad()};vm.createContext(context);vm.runInContext(block,context);
 const pending=elements.roadCalculate.onclick();assert.match(context.routeExportError(),/calculating/);resolveRequest(R.parse(response,2));await pending;assert.equal(context.routeExportError(),'');assert.equal(elements.sT.textContent,'0 h 26 m');assert.equal(rendered.geometry.coordinates.length,3);
 elements.routeMode.value='car';context.updateRoad();assert.equal(elements.sT.textContent,'0 h 20 m');
 const stale=elements.roadCalculate.onclick();elements.roadCancel.onclick();resolveRequest(R.parse(response,2));await stale;assert.match(context.routeExportError(),/Calculate/);assert.match(msg,/cancelled/);assert.equal(elements.roadCalculate.disabled,false);
 console.log('PASS: separate modes, request limits/rate, route validation, no-route/no-segment/429, aborted requests, road geometry, walking pace vs vehicle ETA, stale/cancelled results and export guards.');
})().catch(e=>{console.error(e);process.exitCode=1});
