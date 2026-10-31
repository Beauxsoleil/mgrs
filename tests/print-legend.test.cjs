const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {scaleBar,conversion,build}=require('../print-legend.js');
for(const scale of [10000,25000,50000,100000,347000])for(const unit of [1,1609.344]){
 const b=scaleBar(scale,unit);assert(b.segmentPixels*5<=480+.001);
 const mm=b.segmentPixels/1350*225;
 assert(Math.abs(mm*scale/1000-b.segment*unit)<1e-8);
}
assert(Math.abs(1000/scaleBar(50000).metersPerPixel/1350*225-20)<1e-10);
let c=conversion(12,2);assert.equal(c.gm,10);assert.match(c.gridToMag,/SUBTRACT 10.00/);assert.match(c.magToGrid,/ADD 10.00/);
c=conversion(-8,2);assert.equal(c.gm,-10);assert.match(c.gridToMag,/ADD 10.00/);assert.match(c.magToGrid,/SUBTRACT 10.00/);
assert.match(conversion(2,2).gridToMag,/no correction/);
const base={scale:50000,convergence:2,declination:12,zone:11,model:'NOAA WMM2025',date:'2026-10-31'};
let svg=build(base);for(const term of ['TN','GN','MN','178 mils','meters','miles'])assert(svg.includes(term));
assert.match(svg,/stroke-dasharray/);assert.match(svg,/ANGLES NOT TO SCALE/);
svg=build({...base,declination:null});assert.match(svg,/G–M ANGLE UNAVAILABLE/);assert(!svg.includes('SUBTRACT'));assert(!svg.includes('>MN<'));
svg=build({...base,declination:0,convergence:0});assert.match(svg,/TN\/GN\/MN/);
assert.match(build({...base,model:'<script>'}),/&lt;script&gt;/);
// GN bearing comes from the same projected grid as the map, not a reversed convention.
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),context={};vm.createContext(context);
vm.runInContext(html.slice(html.indexOf('const A_='),html.indexOf('/* ---------- MGRS grid overlay')),context);
const world=p=>[(p[0]+180)/360,(1-Math.log(Math.tan(Math.PI/4+p[1]*Math.PI/360))/Math.PI)/2];
for(const [lon,expectedSign] of [[-114,1],[-120,-1],[-117,0]]){
 const u=context.toUTM(lon,42,11),a=world(context.fromUTM(u.e,u.n-1,11)),b=world(context.fromUTM(u.e,u.n+1,11));
 const gamma=Math.atan2(b[0]-a[0],a[1]-b[1])*180/Math.PI;
 if(expectedSign)assert.equal(Math.sign(gamma),expectedSign);else assert(Math.abs(gamma)<.0001);
}
console.log('PASS: metric/mile bar lengths at five scales, 1 km = 20 mm at 1:50,000, east/west/zero G–M conversion, mils, missing model, coincident rays, escaping, grid convergence sign.');
