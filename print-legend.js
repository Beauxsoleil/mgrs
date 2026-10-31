/* Shared print marginalia. Distances use the map's center scale; NATO mils = 6400/turn.
   Conversion convention: USMC B181996 Direction, grid/magnetic azimuth conversion.
   https://www.trngcmd.marines.mil/Portals/207/Docs/TBS/B181996%20Direction.pdf */
(function(root){
'use strict';
const WIDTH=1350,HEIGHT=240;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed=a=>((a+180)%360+360)%360-180;
const angle=a=>`${Math.abs(a).toFixed(2)}°${Math.abs(a)<.005?'':a>0?' E':' W'}`;
const mils=a=>Math.round(Math.abs(a)*6400/360);
function niceFloor(value){const p=10**Math.floor(Math.log10(value));return [5,2.5,2,1].find(n=>n*p<=value)*p;}
function scaleBar(scale,unitMeters=1){
 const metersPerPixel=scale*.225/WIDTH;
 const segment=niceFloor(480*metersPerPixel/(5*unitMeters));
 return {segment,segmentPixels:segment*unitMeters/metersPerPixel,metersPerPixel};
}
function conversion(declination,convergence){
 const gm=signed(declination-convergence),amount=Math.abs(gm).toFixed(2)+'°';
 return {gm,gridToMag:Math.abs(gm)<.005?'Grid → magnetic: no correction':`Grid → magnetic: ${gm>0?'SUBTRACT':'ADD'} ${amount}`,magToGrid:Math.abs(gm)<.005?'Magnetic → grid: no correction':`Magnetic → grid: ${gm>0?'ADD':'SUBTRACT'} ${amount}`};
}
function build({scale,convergence,declination=null,model='Unavailable',date='',zone}){
 if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(convergence))throw Error('Invalid print legend scale or grid convergence');
 const text=(x,y,s,size=18,weight='normal',anchor='start')=>`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${esc(s)}</text>`;
 const line=(x,y,a,b,extra='')=>`<line x1="${x}" y1="${y}" x2="${a}" y2="${b}" stroke="#111" stroke-width="2" ${extra}/>`;
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="1350" height="240" fill="white"/><g font-family="Arial, sans-serif" fill="#111">${line(0,1,1350,1)}${text(24,30,'DISTANCE SCALE · 1:'+scale.toLocaleString('en-US'),21,'bold')}`;
 function bar(y,unitMeters){
  const {segment,segmentPixels:p}=scaleBar(scale,unitMeters),x=28;
  const metric=unitMeters===1,divisor=metric&&segment>=1000?1000:1;
  const unit=metric?(divisor===1000?'kilometers':'meters'):'miles';
  const num=n=>Number((n/divisor).toPrecision(4)).toString();
  let s='';
  for(let i=0;i<5;i++)s+=`<rect x="${x+i*p/5}" y="${y}" width="${p/5}" height="14" fill="${i%2?'white':'#111'}" stroke="#111" stroke-width="1"/>`;
  for(let i=0;i<4;i++)s+=`<rect x="${x+(i+1)*p}" y="${y}" width="${p}" height="14" fill="${i%2?'#111':'white'}" stroke="#111" stroke-width="1"/>`;
  s+=text(x,y-8,num(segment),17,'normal','middle');
  for(let i=0;i<=4;i++)s+=text(x+(i+1)*p,y-8,num(i*segment),17,'normal','middle');
  s+=text(x+5*p+16,y+12,unit,18);
  return s;
 }
 svg+=bar(77,1)+bar(143,1609.344)+text(24,188,'Left division is split into fifths for short distances.',17)+text(24,215,'Distances reference the sheet center; measure along the map.',17);
 // Keep rays visibly separated while retaining their correct left/right order.
 const rays=[{name:'TN',angle:0},{name:'GN',angle:convergence}];
 const hasMag=Number.isFinite(declination);if(hasMag)rays.push({name:'MN',angle:declination});
 const unique=[...new Set(rays.map(r=>Math.round(r.angle*10000)/10000))].sort((a,b)=>a-b),trueIndex=unique.indexOf(0);
 const cx=760,cy=182,length=109;
 svg+=text(760,29,'DECLINATION',20,'bold','middle');
 for(const ray of rays){
  const key=Math.round(ray.angle*10000)/10000,display=(unique.indexOf(key)-trueIndex)*24,a=display*Math.PI/180;
  const x=cx+Math.sin(a)*length,y=cy-Math.cos(a)*length;
  svg+=line(cx,cy,x,y);
  if(ray.name==='TN'){
   const star=[];for(let i=0;i<10;i++){const t=-Math.PI/2+i*Math.PI/5,r=i%2?4:10;star.push(`${x+Math.cos(t)*r},${y+Math.sin(t)*r}`)}
   svg+=`<polygon points="${star.join(' ')}"/>`;
  }else if(ray.name==='MN'){
   svg+=`<path d="M ${x} ${y} L ${x-Math.sin(a)*17+Math.cos(a)*9} ${y+Math.cos(a)*17+Math.sin(a)*9} L ${x-Math.sin(a)*13} ${y+Math.cos(a)*13} Z" fill="#111"/>`;
  }
  const same=rays.filter(r=>Math.abs(r.angle-ray.angle)<.00005);
  if(same[0]===ray)svg+=text(x,y-16,same.map(r=>r.name).join('/'),18,'bold','middle');
 }
 if(hasMag&&Math.abs(declination-convergence)>.0001){
  const da=value=>(unique.indexOf(Math.round(value*10000)/10000)-trueIndex)*24*Math.PI/180;
  const g=da(convergence),m=da(declination),r=53;
  svg+=`<path d="M ${cx+Math.sin(g)*r} ${cy-Math.cos(g)*r} A ${r} ${r} 0 0 ${m>g?1:0} ${cx+Math.sin(m)*r} ${cy-Math.cos(m)*r}" fill="none" stroke="#111" stroke-width="1.5" stroke-dasharray="4 3"/>`;
 }
 svg+=`<circle cx="${cx}" cy="${cy}" r="3"/>`+text(760,215,'ANGLES NOT TO SCALE',15,'normal','middle');
 const gm=hasMag?conversion(declination,convergence):null;
 svg+=text(940,30,gm?`G–M ANGLE ${angle(gm.gm)} / ${mils(gm.gm)} mils`:'G–M ANGLE UNAVAILABLE',20,'bold');
 svg+=text(940,59,`Grid convergence: ${angle(convergence)}`,17);
 svg+=text(940,85,hasMag?`Magnetic declination: ${angle(declination)}`:'Magnetic declination unavailable',17);
 svg+=text(940,116,gm?gm.gridToMag:'MN ray omitted; no conversion given.',18,'bold');
 svg+=text(940,144,gm?gm.magToGrid:'Enter a verified declination override.',18,'bold');
 svg+=text(940,171,'Wrap azimuths to 0–360°. Mils: 6400/turn.',16);
 svg+=text(940,197,`${date} · ${model}`,16);
 svg+=text(940,222,`At map center · UTM zone ${zone}`,16);
 return svg+'</g></svg>';
}
const api={WIDTH,HEIGHT,scaleBar,conversion,build};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MGRSPrintLegend=api;
})(typeof window!=='undefined'?window:globalThis);
