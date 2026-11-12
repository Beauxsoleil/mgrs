const assert=require('node:assert/strict'),W=require('../wildlife.js');
const cs=10,N=120;
function grid(f){const el=new Float32Array(N*N);for(let y=0;y<N;y++)for(let x=0;x<N;x++)el[y*N+x]=f(x,y);return{el,W:N,H:N,cs}}
const at=(a,x,y)=>a[y*N+x];
// Two peaks with a saddle between them: travel score should peak at the saddle, not on a hillside.
const g=(x,y,cx,cy)=>Math.exp(-(((x-cx)**2+(y-cy)**2)/(2*18**2)));
const sad=grid((x,y)=>1000+350*(g(x,y,30,60)+g(x,y,90,60)));
let r=W.compute(sad,{species:'elk',season:'early',time:'dawn',wx:'mild'});
let near=0;for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++)near=Math.max(near,at(r.travel,60+dx,60+dy));
assert(near>.5,'saddle travel score '+near);
assert(at(r.travel,20,30)<near,'hillside travel should be below saddle');
// Aspect: hot weather summer beds prefer north-facing (y grows south, so elevation rising with y faces north).
const t=Math.tan(20*Math.PI/180)*cs;
const nf=grid((x,y)=>1000+y*t),sf=grid((x,y)=>1000+(N-y)*t);
const o={species:'elk',season:'summer',time:'midday',wx:'hot'};
const bn=at(W.compute(nf,o).bed,60,60),bs=at(W.compute(sf,o).bed,60,60);
assert(bn>bs,`hot: north ${bn} should beat south ${bs}`);
const w={...o,season:'winter',wx:'cold'};
assert(at(W.compute(sf,w).bed,60,60)>at(W.compute(nf,w).bed,60,60),'winter prefers south');
// Feeding favors gentle ground over steep.
const flat=grid(()=>1000);r=W.compute(flat,{species:'elk',season:'early',time:'dusk',wx:'mild'});
assert(at(r.feed,60,60)>at(W.compute(nf,{species:'elk',season:'early',time:'dusk',wx:'mild'}).feed,60,60));
// Time of day shifts the dominant behavior: midday highlights bedding, dusk highlights feeding.
const mix=grid((x,y)=>1000+y*Math.tan(15*Math.PI/180)*cs);
const mid=W.compute(mix,{species:'elk',season:'early',time:'midday',wx:'mild'}).stats,dusk=W.compute(mix,{species:'elk',season:'early',time:'dusk',wx:'mild'}).stats;
assert(mid.bed>dusk.bed);
assert(W.compute(flat,{species:'mule',season:'rut',time:'night',wx:'cold'}).rgba.length===N*N*4);
console.log('PASS: saddle travel, aspect by weather/winter, gentle-ground feeding, time-of-day shift');

// ---- Live conditions ----
const H=3600000;
// Sun: Twin Falls ID. Summer solstice day length ~15.4 h, winter ~9.1 h; solar noon ~19:38 UTC in June.
let sun=W.sunTimes(42.56,-114.46,Date.UTC(2026,5,21,18));
let dl=(sun.set-sun.rise)/H;assert(dl>15.2&&dl<15.7,'June day length '+dl);
assert(Math.abs(new Date(sun.transit).getUTCHours()*60+new Date(sun.transit).getUTCMinutes()-(19*60+38))<12,'solar noon');
sun=W.sunTimes(42.56,-114.46,Date.UTC(2026,11,21,18));dl=(sun.set-sun.rise)/H;assert(dl>8.9&&dl<9.4,'Dec day length '+dl);
// Time classes around Nov 11 sunrise/sunset.
sun=W.sunTimes(42.56,-114.46,Date.UTC(2026,10,11,19));
assert.equal(W.timeClass(sun.rise,sun),'dawn');assert.equal(W.timeClass(sun.rise+4*H,sun),'midday');
assert.equal(W.timeClass(sun.set-30*60000,sun),'dusk');assert.equal(W.timeClass(sun.set+4*H,sun),'night');
assert.equal(W.timeClass(sun.rise-5*H,sun),'night');
// Moon: new moon at 2000-01-06 18:14 UTC, full ~14.77 days later.
let m=W.moonPhase(Date.UTC(2000,0,6,18,14));assert(m.illum<.01&&m.name==='New moon');
m=W.moonPhase(Date.UTC(2000,0,6,18,14)+14.765*86400000);assert(m.illum>.99&&m.name==='Full moon');
// Weather row selection (local-time strings + utc offset) and derived signals.
const hours=[];for(let k=0;k<72;k++)hours.push(new Date(Date.UTC(2026,10,10,7)+k*H).toISOString().slice(0,16));
const wx={utc_offset_seconds:-25200,hourly:{time:hours.map(t=>new Date(Date.parse(t+'Z')-25200000).toISOString().slice(0,16)),
 temperature_2m:hours.map((_,k)=>50-k*.3),wind_speed_10m:hours.map(()=>8),wind_direction_10m:hours.map(()=>225),cloud_cover:hours.map(()=>40),
 precipitation:hours.map(()=>0),snow_depth:hours.map(()=>0),surface_pressure:hours.map((_,k)=>1015-k*.8)}};
const tgt=Date.UTC(2026,10,11,12);
const c=W.conditionsAt(wx,tgt);assert(Math.abs(c.windFrom-225)<1&&c.dP6<-4,'pressure falling '+c.dP6);
assert.throws(()=>W.conditionsAt(wx,Date.UTC(2026,10,20,12)),/cover/);
let lo=W.liveOptions({species:'elk',season:'early',time:'dawn',wx:'mild'},{...c,snowM:0,tempF:80,windMph:5,precipMm:0,tempDrop12:0,dP6:-4});
assert.equal(lo.opts.wx,'hot');assert(lo.opts.activity>1.1&&lo.notes.some(n=>/Pressure/.test(n)));
lo=W.liveOptions({species:'elk',season:'early',time:'dawn',wx:'mild'},{tempF:20,windMph:30,windFrom:0,precipMm:0,snowM:.4,dP6:0,tempDrop12:0});
assert.equal(lo.opts.season,'winter');assert.equal(lo.opts.wx,'cold');assert(lo.opts.activity<1);
lo=W.liveOptions({species:'elk',season:'rut',time:'dawn',wx:'mild'},{tempF:40,windMph:5,windFrom:0,precipMm:0,snowM:.15,dP6:0,tempDrop12:0});
assert.equal(lo.opts.season,'late');
// Activity scales feeding/travel but not bedding; leeward slopes bed better in wind.
const a0=W.compute(flat,{species:'elk',season:'early',time:'dusk',wx:'mild'}),a1=W.compute(flat,{species:'elk',season:'early',time:'dusk',wx:'mild',activity:1.2});
assert(a1.stats.feed>=a0.stats.feed);
// North-facing slope (downslope faces north). Wind from the south blows toward north => leeward => better bedding.
const wo={species:'elk',season:'summer',time:'midday',wx:'mild',windMph:20};
const leeN=at(W.compute(nf,{...wo,windFrom:180}).bed,60,60),windN=at(W.compute(nf,{...wo,windFrom:0}).bed,60,60);
assert(leeN>windN,`leeward ${leeN} should beat windward ${windN}`);
console.log('PASS: sunrise/sunset, time classes, moon phase, forecast row + derived signals, snow/front/wind rules, leeward bedding');

// ---- IDFG layer helpers ----
const L=[{id:0,name:'Mule Deer Winter Range'},{id:1,name:'Mule Deer Summer Range'},{id:2,name:'Elk Migration Routes'}];
assert.deepEqual(W.pickLayers(L,['winter']).map(l=>l.id),[0]);
assert.deepEqual(W.pickLayers(L,['winter','summer']).map(l=>l.id),[0,1]);
assert.deepEqual(W.pickLayers(L,['migration']).map(l=>l.id),[2]);
assert.deepEqual(W.pickLayers(undefined,['winter']),[]);
assert.deepEqual(W.idfgWanted('auto','summer'),['summer']);assert.deepEqual(W.idfgWanted('auto','winter'),['winter']);
assert.deepEqual(W.idfgWanted('auto','rut'),['winter','summer']);assert.deepEqual(W.idfgWanted('migration','winter'),['migration']);
assert(W.idfgTiles('Elk_Seasonal_Ranges',[3,4]).includes('{bbox-epsg-3857}')&&W.idfgTiles('Elk_Seasonal_Ranges',[3,4]).endsWith('layers=show:3,4'));
console.log('PASS: IDFG layer name matching, season-to-layer choice, tile URL template');

// ---- Roads, access, hunting season ----
const wm=W.rasterizeLines([[[10.5,0.5],[10.5,N-0.5]]],N,N);
let cnt=0;for(const v of wm)cnt+=v;assert(cnt>=N-2&&at(wm,10,60)===1&&at(wm,11,60)===0,'vertical road rasterized');
const dist=W.chamfer(wm,N,N,cs);assert(Math.abs(at(dist,20,60)-100)<8,'distance ~100 m '+at(dist,20,60));assert(at(dist,10,60)===0);
assert(W.chamfer(new Uint8Array(N*N),N,N,cs)[0]===1e6,'no roads = far');
const sq=W.fillPolygons([[[[10,10],[30,10],[30,30],[10,30],[10,10]],[[15,15],[25,15],[25,25],[15,25],[15,15]]]],N,N); // square with hole
let f=0;for(const v of sq)f+=v;assert.equal(f,400-100,'even-odd hole');
assert.equal(at(sq,12,12),1);assert.equal(at(sq,20,20),0);assert.equal(at(sq,40,40),0);
// Rifle season: cells far from roads score better than cells near roads; effect grows from off-season to rifle.
const rd=new Float32Array(N*N);for(let y=0;y<N;y++)for(let x=0;x<N;x++)rd[y*N+x]=x*cs*3; // 0..3.6 km
const base={species:'elk',season:'early',time:'midday',wx:'mild'};
const rifle=W.compute(nf,{...base,roadDist:rd,hunt:'rifle'}).bed,arch=W.compute(nf,{...base,roadDist:rd,hunt:'archery'}).bed;
assert(at(rifle,100,60)>at(rifle,20,60),'rifle: far beats near');
const ratio=(a)=>at(a,30,60)/at(a,100,60);assert(ratio(rifle)<ratio(arch),'rifle penalizes road proximity more than archery');
// Elk are more road-averse than whitetail.
const wt=W.compute(nf,{...base,species:'white',roadDist:rd,hunt:'rifle'}).bed;assert(ratio(rifle)<ratio(wt),'elk lose more near roads than whitetail');
// Access: in rifle season public land is penalized (animals shift to restricted land); off-season no access effect.
const ac=new Uint8Array(N*N);for(let y=0;y<N;y++)for(let x=0;x<60;x++)ac[y*N+x]=1; // west half public
const R=W.compute(nf,{...base,access:ac,hunt:'rifle'}).bed,Off=W.compute(nf,{...base,access:ac,hunt:'off'}).bed,None=W.compute(nf,base).bed;
assert(at(R,40,60)<at(R,80,60),'rifle: private beats public');assert(Math.abs(at(Off,40,60)-at(None,40,60))<1e-6,'no access effect off-season');
assert(W.roadsQuery([-114.5,42.5],[-114.4,42.6]).includes('(42.50000,-114.50000,42.60000,-114.40000)'));
assert(W.padusUrl([-114.5,42.5],[-114.4,42.6],true).includes('f=geojson')&&W.padusUrl([-114.5,42.5],[-114.4,42.6],false).includes('1%3D1'));
console.log('PASS: road raster + distance, polygon fill with holes, rifle/archery road effect, access effect, query builders');
