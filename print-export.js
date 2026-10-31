/* Raster print compositor: no popup, second WebGL context, or terrain downloads. */
(()=>{
'use strict';
const W=1350,H=810,PRINT_W=225,PRINT_H=135;
const $=id=>document.getElementById(id);
const rad=x=>x*Math.PI/180;
const world=p=>[(p[0]+180)/360,(1-Math.log(Math.tan(Math.PI/4+rad(p[1])/2))/Math.PI)/2];
const unworld=p=>[p[0]*360-180,Math.atan(Math.sinh(Math.PI*(1-2*p[1])))*180/Math.PI];
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bounds=pts=>pts.reduce((b,p)=>[[Math.min(b[0][0],p[0]),Math.min(b[0][1],p[1])],[Math.max(b[1][0],p[0]),Math.max(b[1][1],p[1])]],[[Infinity,Infinity],[-Infinity,-Infinity]]);
let selection=null,first=null,selecting=false,job=null,returnFocus=null;
const status=t=>{$('printStatus').textContent=t};
function getBounds(){
 if($('printMode').value==='selection'){
  if(!selection)throw Error('Choose Select area, then tap two opposite corners on the map.');
  return selection;
 }
 if($('printMode').value==='view'){
  const b=map.getBounds();return [[b.getWest(),b.getSouth()],[b.getEast(),b.getNorth()]];
 }
 const pts=wps.map(p=>p.getLngLat().toArray());
 for(const leg of legs)if(leg)for(const q of leg)if(q.p)pts.push(q.p);
 if(!pts.length)throw Error('No route yet. Choose Current map view to print without waypoints.');
 return bounds(pts);
}
function layout(b,choice){
 if(!b.flat().every(Number.isFinite)||b[1][0]-b[0][0]>180||b[0][0]<-180||b[1][0]>180||Math.max(Math.abs(b[0][1]),Math.abs(b[1][1]))>80)throw Error('Choose an area within one hemisphere and between 80° south and north.');
 const nw=world([b[0][0],b[1][1]]),se=world([b[1][0],b[0][1]]);
 const centerWorld=[(nw[0]+se[0])/2,(nw[1]+se[1])/2],center=unworld(centerWorld);
 const circumference=40075016.686*Math.cos(rad(center[1]));
 const needed=Math.max((se[0]-nw[0])*circumference/(PRINT_W/1000),(se[1]-nw[1])*circumference/(PRINT_H/1000))*1.06;
 const scale=choice==='fit'?Math.max(10000,Math.ceil(needed/1000)*1000):Number(choice);
 if(!Number.isFinite(scale)||scale<=0)throw Error('Choose a valid print scale.');
 if(choice!=='fit'&&needed>scale)throw Error('This area does not fit at 1:'+scale.toLocaleString()+'. Choose Fit area to one sheet, or select a smaller area.');
 const spanX=PRINT_W/1000*scale/circumference,spanY=spanX*H/W;
 const left=centerWorld[0]-spanX/2,top=centerWorld[1]-spanY/2;
 if(left<0||left+spanX>1||top<0||top+spanY>1)throw Error('Select a smaller area away from the map edge.');
 return {center,scale,left,top,spanX,spanY,project:p=>{const q=world(p);return[(q[0]-left)/spanX*W,(q[1]-top)/spanY*H]}};
}
const preview=document.createElement('section');preview.id='printPreview';preview.hidden=true;preview.setAttribute('role','dialog');preview.setAttribute('aria-modal','true');preview.setAttribute('aria-label','Printable map preview');document.body.append(preview);
const css=document.createElement('style');css.textContent=`
#printPreview{position:fixed;inset:0;z-index:100;background:#e8ece7;color:#15251e;overflow:auto;padding:calc(16px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom));font:14px/1.4 system-ui,sans-serif}
#printPreview[hidden]{display:none!important}#printPreview .print-toolbar{position:sticky;top:0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;max-width:1050px;margin:0 auto 16px;background:#e8ece7;padding:8px;z-index:1}#printPreview button,#printPreview a{padding:12px 16px;min-height:44px;border-radius:9px;border:1px solid #71877c;background:#173d2e;color:white;text-decoration:none;font:600 14px system-ui}#printPreview button:disabled{opacity:.45}#printPreview .print-sheet{background:white;padding:16px;margin:auto;max-width:1050px;color:#111}#printPreview h2{font:700 18px system-ui;margin:0 0 8px}#printPreview .print-map{display:block;width:100%;height:auto;outline:1px solid #333}#printPreview .print-meta{font:12px/1.5 system-ui;margin-top:12px}#printPreview .print-help{max-width:1050px;margin:12px auto}#printPreview .print-progress{padding:40px 0;text-align:center}#printPreview .print-sheet header{display:flex;justify-content:space-between;gap:12px;align-items:center}#printPreview .calibration{border:solid #111;border-width:0 1px 2px;width:50mm;height:3mm;margin-top:3mm}
@media print{
 @page{size:letter landscape;margin:8mm}
 html,body{height:auto!important;min-height:0!important;overflow:visible!important;background:white!important;margin:0!important;padding:0!important}
 body>*:not(#printPreview){display:none!important}
 #printPreview:not([hidden]){display:block!important;position:static!important;overflow:visible!important;background:white!important;padding:0!important;color:black!important}
 #printPreview .print-toolbar,#printPreview .print-help{display:none!important}
 #printPreview .print-sheet{padding:0!important;margin:0!important;width:253mm!important;max-width:none!important;break-inside:avoid}
 #printPreview .print-sheet header{height:8mm}#printPreview h2{font-size:12pt;margin:0}
 #printPreview .print-map{width:225mm!important;height:175mm!important;max-width:none!important;margin:0 auto;print-color-adjust:exact;-webkit-print-color-adjust:exact}
 #printPreview .print-meta{font:8pt/1.25 Arial,sans-serif;margin-top:2mm}#printPreview .calibration{margin-top:2mm}
}`;document.head.append(css);
function closePreview(){if(job)job.abort();preview.hidden=true;document.querySelectorAll('[data-print-inert]').forEach(el=>{el.inert=false;el.removeAttribute('data-print-inert')});if(returnFocus)returnFocus.focus();}
function showPreview(){returnFocus=document.activeElement;preview.hidden=false;for(const el of document.body.children)if(el!==preview&&!el.inert){el.inert=true;el.setAttribute('data-print-inert','')};preview.innerHTML='<div class="print-toolbar"><button id="printClose">Back to map</button><button id="printNow" disabled>Print / Save as PDF</button></div><div id="printContent" class="print-sheet"><p class="print-progress" role="status">Preparing your map…</p></div><p class="print-help">Print on US Letter, landscape, at 100% / Actual size. On iPhone, use the print preview’s Share option to save a PDF. Disable browser headers and footers.</p>';$('printClose').onclick=closePreview;$('printClose').focus();}
preview.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();closePreview()}if(e.key==='Tab'){const els=[...preview.querySelectorAll('button:not(:disabled),a[href]')];const a=els[0],b=els[els.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();b.focus()}else if(!e.shiftKey&&document.activeElement===b){e.preventDefault();a.focus()}}});
function loadTile(url,signal){return new Promise((resolve,reject)=>{
 const img=new Image();img.crossOrigin='anonymous';
 const done=(err)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);img.onload=img.onerror=null;if(err){img.src='';reject(err)}else resolve(img)};
 const abort=()=>done(new DOMException('Cancelled','AbortError'));
 const timer=setTimeout(()=>done(Error('A map tile timed out. Save this area offline or try again with a connection.')),15000);
 img.onload=()=>done();img.onerror=()=>done(Error('Map tiles could not load. Connect to the internet or choose an area saved offline.'));
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return}img.src=url;
});}
async function render(L,snapshot,signal){
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H+window.MGRSPrintLegend.HEIGHT;const ctx=canvas.getContext('2d');
 ctx.save();ctx.beginPath();ctx.rect(0,0,W,H);ctx.clip();
 let z=Math.min(snapshot.base==='osm'?19:16,Math.max(0,Math.ceil(Math.log2(W/L.spanX/256))));
 const range=z=>{const n=2**z;return{x0:Math.floor(L.left*n),x1:Math.ceil((L.left+L.spanX)*n)-1,y0:Math.floor(L.top*n),y1:Math.ceil((L.top+L.spanY)*n)-1,n}};
 let r=range(z);while((r.x1-r.x0+1)*(r.y1-r.y0+1)>100&&z>0)r=range(--z);
 const tasks=[];for(let y=r.y0;y<=r.y1;y++)for(let x=r.x0;x<=r.x1;x++)tasks.push({x,y});
 let next=0,done=0;const size=W/(L.spanX*r.n);
 await Promise.all(Array.from({length:Math.min(6,tasks.length)},async()=>{while(next<tasks.length){if(signal.aborted)throw new DOMException('Cancelled','AbortError');const {x,y}=tasks[next++];const url=snapshot.template.replace('{z}',z).replace('{x}',x).replace('{y}',y);const img=await loadTile(url,signal);ctx.drawImage(img,(x/r.n-L.left)/L.spanX*W,(y/r.n-L.top)/L.spanY*H,size+.5,size+.5);done++;$('printContent').textContent=`Preparing map tiles ${done} of ${tasks.length}…`;}}));
 const stroke=(points,color,width)=>{ctx.beginPath();points.forEach((p,i)=>{const q=L.project(p);if(i)ctx.lineTo(...q);else ctx.moveTo(...q)});ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke()};
 // Rebuild the print grid at its own extent, including labels (screen labels are DOM markers).
 let gridNote='Grid off';
 if(snapshot.grid){
 const zone=Math.min(60,Math.floor((L.center[0]+180)/6)+1),corners=[[L.left,L.top],[L.left+L.spanX,L.top],[L.left,L.top+L.spanY],[L.left+L.spanX,L.top+L.spanY]].map(unworld);
 const u=corners.map(p=>toUTM(p[0],p[1],zone)),e0=Math.min(...u.map(p=>p.e)),e1=Math.max(...u.map(p=>p.e)),n0=Math.min(...u.map(p=>p.n)),n1=Math.max(...u.map(p=>p.n));
 let step=1000;while(Math.max(e1-e0,n1-n0)/step>30)step*=10;
 ctx.font='bold 15px monospace';ctx.textBaseline='top';ctx.textAlign='left';
 const label=(text,x,y)=>{ctx.lineWidth=4;ctx.strokeStyle='white';ctx.strokeText(text,x,y);ctx.fillStyle='#9b2020';ctx.fillText(text,x,y)};
 for(let e=Math.ceil(e0/step)*step;e<=e1;e+=step){const ps=Array.from({length:25},(_,i)=>fromUTM(e,n0+(n1-n0)*i/24,zone));stroke(ps,'rgba(160,30,30,.7)',1.2);const candidates=ps.map(L.project).filter(p=>p[0]>8&&p[0]<W-80&&p[1]>=4&&p[1]<=H-20);if(candidates.length){const q=candidates.reduce((a,b)=>a[1]<b[1]?a:b);label(String(Math.round(e/1000))+'E',q[0]+3,q[1]);}}
 for(let n=Math.ceil(n0/step)*step;n<=n1;n+=step){const ps=Array.from({length:25},(_,i)=>fromUTM(e0+(e1-e0)*i/24,n,zone));stroke(ps,'rgba(160,30,30,.7)',1.2);const candidates=ps.map(L.project).filter(p=>p[0]>=4&&p[0]<W-80&&p[1]>24&&p[1]<H-20);if(candidates.length){const q=candidates.reduce((a,b)=>a[0]<b[0]?a:b);label(String(Math.round(n/1000))+'N',q[0],q[1]+3);}}
 gridNote=`${step/1000} km grid · UTM zone ${zone} reference`;
 }
 if(snapshot.route.length>1){stroke(snapshot.route,'white',7);stroke(snapshot.route,'#c44b0b',4)}
 snapshot.waypoints.forEach((p,i)=>{const q=L.project(p);ctx.beginPath();ctx.arc(...q,12,0,Math.PI*2);ctx.fillStyle='#f2b657';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#111';ctx.stroke();ctx.fillStyle='#111';ctx.font='bold 14px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),...q)});
 ctx.fillStyle='white';ctx.fillRect(W-68,10,58,63);ctx.fillStyle='#111';ctx.font='bold 18px sans-serif';ctx.textAlign='center';ctx.fillText('N ↑',W-39,40);
 ctx.restore();
 const u=toUTM(L.center[0],L.center[1],snapshot.zone);
 const a=world(fromUTM(u.e,u.n-1,snapshot.zone)),b=world(fromUTM(u.e,u.n+1,snapshot.zone));
 const convergence=Math.atan2(b[0]-a[0],a[1]-b[1])*180/Math.PI;
 const svg=window.MGRSPrintLegend.build({scale:L.scale,convergence,declination:snapshot.declination,model:snapshot.model,date:snapshot.date,zone:snapshot.zone});
 const legend=await loadTile('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),signal);
 ctx.drawImage(legend,0,H,W,window.MGRSPrintLegend.HEIGHT);
 return {image:canvas.toDataURL('image/png'),gridNote};
}
function endSelection(){selecting=false;window.mgrsPrintSelecting=false;map.getCanvas().style.cursor='';$('printSelect').textContent='Select area';updateHud();}
window.addEventListener('cancel-print-selection',()=>{selection=null;endSelection();status('Selection cancelled.')});
$('printSelect').onclick=()=>{if(selecting){endSelection();status('Selection cancelled.');return}selection=null;first=null;selecting=true;window.mgrsPrintSelecting=true;$('printSelect').textContent='Cancel selection';$('printMode').value='selection';map.getCanvas().style.cursor='crosshair';status('Tap two opposite corners on the map.');$('hud').textContent='Print area: tap the first corner.';};
map.on('click',e=>{if(!selecting)return;const p=e.lngLat.toArray();if(!first){first=p;$('hud').textContent='Print area: tap the opposite corner.';return}selection=bounds([first,p]);endSelection();status('Area selected. Choose Preview printable map.');if($('panel').hidden)$('menuToggle').click();$('printStatus').scrollIntoView({block:'center'});});
$('printExport').onclick=async()=>{
 if(job)return;
 let L,snapshot;
 try{
  L=layout(getBounds(),$('printScale').value);
  snapshot={base:$('base').value,template:BASES[$('base').value][0],grid:$('gridT').checked,waypoints:wps.map(m=>m.getLngLat().toArray()),route:prof.map(q=>q.p.slice())};
  snapshot.date=new Date().toISOString().slice(0,10);
  snapshot.zone=Math.min(60,Math.floor((L.center[0]+180)/6)+1);
  snapshot.declination=null;snapshot.model='Unavailable';
  try{const override=$('printDecl').value.trim(),d=override?Number(override):window.WMM2025.declination(L.center[1],L.center[0],new Date());if(!Number.isFinite(d)||Math.abs(d)>180)throw Error('Invalid declination');snapshot.declination=d;snapshot.model=override?'Manual override':'NOAA WMM2025';}catch(e){}
  if($('msg').textContent.startsWith('Routing leg'))throw Error('Wait for the route calculation to finish before printing.');
 }catch(e){status(e.message);return}
 const controller=new AbortController();job=controller;$('printExport').disabled=true;showPreview();status('Preparing printable map…');
 try{
  const {image,gridNote}=await render(L,snapshot,controller.signal);if(controller.signal.aborted)return;
  const declination=Number.isFinite(snapshot.declination)?`Magnetic declination ${Math.abs(snapshot.declination).toFixed(2)}° ${snapshot.declination>=0?'E':'W'}`:'Magnetic declination unavailable';
  const scaleText='1:'+L.scale.toLocaleString(),stamp=snapshot.date,credit=snapshot.base==='osm'?'© OpenStreetMap contributors':'USGS National Map';
  $('printContent').innerHTML=`<header><h2>MGRS FIELD MAP · ${scaleText}</h2><span>${stamp}</span></header><img class="print-map" alt="North-up map with route, waypoints, metric and mile bar scales, and true/grid/magnetic north declination diagram" src="${image}"><div class="print-meta"><b>${scaleText} at sheet center, 100% print size.</b> ${escape(gridNote)} · ${escape(credit)}<br>Center: ${escape(fmtMGRS(...L.center))} · ${escape(declination)}<br>Route and numbered waypoints included. Terrain and visibility overlays are omitted. Verify scale: the line below must measure 50 mm.<div class="calibration"></div></div>`;
  const img=preview.querySelector('.print-map');if(img.decode)await img.decode();if(controller.signal.aborted)return;
  $('printNow').disabled=false;$('printNow').onclick=()=>window.print();
  const download=document.createElement('a');download.textContent='Save map image';download.href=image;download.download=`mgrs-map-${stamp}.png`;preview.querySelector('.print-toolbar').append(download);
  status('Print preview ready. Choose Print / Save as PDF.');
 }catch(e){controller.abort();if(e.name!=='AbortError'){status(e.message);$('printContent').textContent=e.message+' Go back to the map and try again.';}}
 finally{job=null;$('printExport').disabled=false;}
};
})();
