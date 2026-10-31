/* 1:50,000 print export. Requires global map, wps, legs, mgrs, maplibregl. */
(()=>{
const W=1200,H=850,PRINT_W=225,PRINT_H=170,SCALE=50000;
let selection=null, selecting=false, first=null, markers=[];
const $=id=>document.getElementById(id);
const status=t=>$('printStatus').textContent=t;
const rad=x=>x*Math.PI/180;
const meters=(a,b)=>{const la=rad((a[1]+b[1])/2);return [Math.abs(a[0]-b[0])*111320*Math.cos(la),Math.abs(a[1]-b[1])*111132]};
const mid=b=>[(b[0][0]+b[1][0])/2,(b[0][1]+b[1][1])/2];
const bounds=pts=>[[Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1]))],[Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))]];
function getBounds(){
 const mode=$('printMode').value;
 if(mode==='selection'){if(!selection)throw Error('Select an area first: tap two opposite corners on the map.');return selection}
 if(mode==='view'){const b=map.getBounds();return [[b.getWest(),b.getSouth()],[b.getEast(),b.getNorth()]]}
 const pts=wps.map(p=>{const ll=p.getLngLat();return [ll.lng,ll.lat]}).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
 for(const leg of legs)if(Array.isArray(leg))for(const p of leg)if(Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0]))pts.push(p);
 if(!pts.length)throw Error('Add route waypoints first, or choose Current view.');
 const b=bounds(pts),c=mid(b),dx=0.6/111320/Math.cos(rad(c[1])),dy=0.6/111132;
 return [[b[0][0]-dx,b[0][1]-dy],[b[1][0]+dx,b[1][1]+dy]];
}
function diagram(lat,lon,decl){
 const zone=Math.floor((lon+180)/6)+1,central=(zone-1)*6-180+3;
 const gamma=Math.atan(Math.tan(rad(lon-central))*Math.sin(rad(lat)))*180/Math.PI;
 const arms=[['TN',0,'#111'],['GN',gamma,'#2563eb'],['MN',decl,'#b45309']];
 const rays=arms.map(([label,angle,color])=>{const a=rad(angle),x=105+Math.sin(a)*65,y=90-Math.cos(a)*65;return '<line x1="105" y1="90" x2="'+x+'" y2="'+y+'" stroke="'+color+'" stroke-width="2.5"/><circle cx="'+x+'" cy="'+y+'" r="3" fill="'+color+'"/><text x="'+(x+5)+'" y="'+(y-3)+'" font-size="11" fill="'+color+'">'+label+'</text>'}).join('');
 return {gamma,svg:'<svg xmlns="http://www.w3.org/2000/svg" width="210" height="112" viewBox="0 0 210 112"><circle cx="105" cy="90" r="3" fill="#111"/>'+rays+'</svg>'};
}
function endSelection(){
 selecting=false;window.mgrsPrintSelecting=false;map.getCanvas().style.cursor='';status(selection?'Area selected. Ready to export.':'Selection cancelled.');
}
$('printSelect').onclick=()=>{selection=null;first=null;selecting=true;window.mgrsPrintSelecting=true;$('printMode').value='selection';map.getCanvas().style.cursor='crosshair';status('Tap the first corner, then the opposite corner.');};
map.on('click',e=>{if(!selecting)return;const p=e.lngLat.toArray();if(!first){first=p;status('Tap the opposite corner.');return;}selection=bounds([first,p]);endSelection();});
$('printExport').onclick=async()=>{
 let b,c;
 try{b=getBounds();c=mid(b);if(!Number.isFinite(c[0])||Math.abs(c[1])>80)throw Error('Invalid map extent.')}catch(e){status(e.message);return;}
 const dims=meters(b[0],b[1]),maxW=PRINT_W/1000*SCALE,maxH=PRINT_H/1000*SCALE;
 if(dims[0]>maxW||dims[1]>maxH){status('Area is '+(dims[0]/1000).toFixed(1)+' × '+(dims[1]/1000).toFixed(1)+' km; one 1:50,000 sheet holds 11.25 × 8.5 km. Reduce the area or split into sheets.');return;}
 const decl=Number($('printDecl').value);
 if(!Number.isFinite(decl)||$('printDecl').value.trim()===''){status('Enter current magnetic declination in degrees east (+) or west (-).');return;}
 const popup=window.open('','_blank');if(!popup){status('Allow pop-ups for this site to export.');return;}
 popup.document.write('<!doctype html><title>Preparing 1:50,000 map</title><p>Rendering map. Please wait…</p>');
 status('Rendering 1:50,000 map…');
 const host=document.createElement('div');host.style.cssText='position:fixed;left:-10000px;top:0;width:'+W+'px;height:'+H+'px;pointer-events:none';document.body.appendChild(host);
 let printMap;
 try{
  const style=JSON.parse(JSON.stringify(map.getStyle()));
  // GeoJSON features in the current style are included; source data can also be runtime-updated.
  for(const [name,source] of Object.entries(style.sources||{})){
    const live=map.getSource(name);
    if(source.type==='geojson'&&live&&live._data)source.data=live._data;
  }
  const zoom=Math.log2((W/maxW)*40075016.686*Math.cos(rad(c[1]))/512);
  printMap=new maplibregl.Map({container:host,style,center:c,zoom,pitch:0,bearing:0,interactive:false,attributionControl:false,preserveDrawingBuffer:true,fadeDuration:0});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Map tiles timed out. Try a cached area.')),20000);printMap.once('idle',()=>{clearTimeout(timer);resolve();});printMap.once('error',e=>{if(e.error)console.warn('Export map tile:',e.error.message)});});
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');ctx.drawImage(printMap.getCanvas(),0,0);
  wps.forEach((wp,i)=>{const ll=wp.getLngLat(),p=printMap.project([ll.lng,ll.lat]);if(p.x<0||p.x>W||p.y<0||p.y>H)return;ctx.beginPath();ctx.arc(p.x,p.y,10,0,Math.PI*2);ctx.fillStyle='#f2a33a';ctx.fill();ctx.strokeStyle='#111';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#111';ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),p.x,p.y);});
  const image=canvas.toDataURL('image/png');
  const d=diagram(c[1],c[0],decl);
  const mgrsText=typeof mgrs!=='undefined'?mgrs.forward(c,5):c.map(v=>v.toFixed(5)).join(', ');
  const escape=x=>String(x).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const stamp=new Date().toISOString().slice(0,10);
  const doc='<!doctype html><html><head><meta charset="utf-8"><title>1:50,000 MGRS map</title><style>@page{size:letter landscape;margin:8mm}body{font:11px Arial,sans-serif;margin:0;color:#111}header{display:flex;justify-content:space-between;align-items:center;height:10mm}h1{font-size:15px;margin:0}.sheet{display:flex;gap:4mm}.map{width:225mm;height:170mm;border:1px solid #111;box-sizing:border-box}.side{width:24mm;overflow:visible;font-size:10px}.side svg{width:24mm;height:auto;overflow:visible}.foot{font-size:10px;margin-top:2mm}.notice{font-weight:bold}button{margin:10px;padding:8px}@media print{button{display:none}} </style></head><body><header><h1>MGRS FIELD MAP — 1:50,000</h1><span>'+stamp+'</span></header><div class="sheet"><img class="map" src="'+image+'"><aside class="side"><b>NORTH</b>'+d.svg+'<p>Declination: '+escape(decl.toFixed(2))+'° (user entered)</p><p>Grid convergence: '+d.gamma.toFixed(2)+'°</p><p>Grid to magnetic: '+(decl-d.gamma).toFixed(2)+'°</p><p>Center:<br>'+escape(mgrsText)+'</p></aside></div><div class="foot"><b>1:50,000 at 100% print size</b> · 1 cm = 500 m · 1 km = 20 mm · Print on US Letter landscape, actual size (no fit/shrink). <span class="notice">Magnetic declination must be checked against a current authoritative source. Verify scale with a ruler before navigation.</span></div><button onclick="window.print()">Print / Save as PDF</button></body></html>';
  popup.document.open();popup.document.write(doc);popup.document.close();status('Export ready. Print at 100% / Actual size; verify with ruler.');
 }catch(e){popup.document.body.textContent='Export failed: '+e.message;status('Export failed: '+e.message)}
 finally{if(printMap)printMap.remove();host.remove();}
};
})();