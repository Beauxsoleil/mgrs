/* Mobile field interface; uses the planner's existing map and route state. */
(()=>{
const panel=$('panel');
function setPanel(open){panel.hidden=!open;$('menuToggle').setAttribute('aria-expanded',String(open));applyPad();if(open&&map.isStyleLoaded()){update();}}
$('menuToggle').onclick=()=>setPanel(panel.hidden);
$('pt').onclick=()=>{setPanel(false);$('menuToggle').focus()};
$('infoToggle').onclick=()=>{const visible=$('hud').hidden;$('hud').hidden=!visible;$('infoToggle').setAttribute('aria-pressed',String(visible));};
function focusMap(on){document.body.classList.toggle('map-focus',on);$('exitFocus').hidden=!on;$('focusMap').setAttribute('aria-pressed',String(on));applyPad();(on?$('exitFocus'):$('focusMap')).focus();}
$('focusMap').onclick=()=>focusMap(true);$('exitFocus').onclick=()=>focusMap(false);
$('quickLocate').onclick=()=>{if(gpsLast)$('gpsCenter').click();else{setPanel(true);gpsSection.open=true;$('gpsStart').click();$('gpsStart').scrollIntoView({block:'center'});}};
function section(id,title){const content=$(id).closest('#panel > div');const details=document.createElement('details');details.className='tool-section';const summary=document.createElement('summary');summary.textContent=title;content.before(details);details.append(summary,content);return details;}
section('bLos','Visibility & line of sight');section('oSave','Offline maps');const gpsSection=section('gpsStart','GPS & imported tracks');const printSection=section('printExport','Print map · 1:50,000');
// Keep advanced route options available without filling the mobile drawer.
const advanced=document.createElement('details');advanced.className='tool-section';advanced.innerHTML='<summary>Map & routing settings</summary>';
const first=$('base').closest('.row');first.before(advanced);let row=first;while(row&&row.id!=='wps'){const next=row.nextElementSibling;advanced.append(row);row=next;}
setPanel(innerWidth>720);
addEventListener('keydown',e=>{if(e.key==='Escape'){if(window.mgrsPrintSelecting){window.dispatchEvent(new Event('cancel-print-selection'));return;}if(document.body.classList.contains('map-focus'))focusMap(false);else if(!panel.hidden)setPanel(false);}});
const dialog=document.createElement('dialog');dialog.id='exportDialog';dialog.innerHTML=`<header><div><p class="eyebrow">TAKE YOUR PLAN WITH YOU</p><h2>Export route</h2></div><button id="closeExport" aria-label="Close export">×</button></header><label for="exportName">File name</label><input id="exportName" value="Idaho field route" maxlength="80"><label for="exportSource">What to export</label><select id="exportSource"><option value="route">Planned route & waypoints</option><option value="gps">Recorded GPS track</option></select><label for="exportFormat">File format</label><select id="exportFormat"><option value="gpx">GPX · GPS devices & mapping apps</option><option value="geojson">GeoJSON · GIS & mapping tools</option></select><p id="exportSummary" class="hint"></p><p id="exportStatus" role="status"></p><div class="row"><button id="downloadExport" class="p">Download file</button><button id="shareExport">Share file</button></div><button id="openPrint" style="width:100%;margin-top:10px">Print map / Save as PDF ↗</button><p class="hint">On iPhone, Share file lets you save to Files or send to another app. GPX includes coordinates; it does not include offline map tiles.</p>`;document.body.append(dialog);
function summary(){const gps=$('exportSource').value==='gps';$('exportSummary').textContent=gps?`${gpsTrack.length} recorded GPS points`:`${wps.length} waypoints · ${$('sD').textContent} · ${$('sT').textContent}`;$('exportStatus').textContent='';}
function open(source='route'){$('exportSource').value=source;summary();dialog.showModal();}
$('openExport').onclick=()=>open();$('gpx').onclick=()=>open();$('gpsExport').onclick=()=>open('gps');$('closeExport').onclick=()=>dialog.close();$('exportSource').onchange=summary;
$('openPrint').onclick=()=>{dialog.close();setPanel(true);printSection.open=true;$('printMode').scrollIntoView({block:'center'});};
const esc=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
function makeFile(){
 const gps=$('exportSource').value==='gps',name=$('exportName').value.trim()||'Field route';
 if(gps&&!gpsTrack.length)throw Error('No recorded track yet. Start GPS and enable Record track first.');
 if(!gps&&!wps.length)throw Error('Add at least one waypoint before exporting your route.');
 if(!gps&&$('msg').textContent.startsWith('Routing leg'))throw Error('Your route is still calculating. Wait for it to finish, then export.');
 const waypoints=gps?[]:wps.map((m,i)=>{const p=m.getLngLat();return{lon:p.lng,lat:p.lat,ele:elev(p),name:`WP${i+1} ${fmtMGRS(p.lng,p.lat)}`}});
 const points=gps?gpsTrack.map(p=>({...p})):prof.map(q=>({lon:q.p[0],lat:q.p[1]}));
 const coord=p=>Number.isFinite(p.ele)?[p.lon,p.lat,p.ele]:[p.lon,p.lat];
 let body,type,ext=$('exportFormat').value;
 if(ext==='geojson'){
 const features=waypoints.map(p=>({type:'Feature',properties:{name:p.name},geometry:{type:'Point',coordinates:coord(p)}}));
 if(points.length>1)features.push({type:'Feature',properties:{name,source:gps?'Recorded GPS':'Planned route',...(gps?{times:points.map(p=>new Date(p.t).toISOString())}:{})},geometry:{type:'LineString',coordinates:points.map(coord)}});
 else if(gps)features.push({type:'Feature',properties:{name,time:new Date(points[0].t).toISOString()},geometry:{type:'Point',coordinates:coord(points[0])}});
 body=JSON.stringify({type:'FeatureCollection',features},null,2);type='application/geo+json';
 }else{
 const point=(p,tag)=>`<${tag} lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${Number.isFinite(p.ele)?`<ele>${p.ele.toFixed(1)}</ele>`:''}${p.t?`<time>${new Date(p.t).toISOString()}</time>`:''}${p.name?`<name>${esc(p.name)}</name>`:''}</${tag}>`;
 body=`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="MGRS Fieldwork" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${esc(name)}</name></metadata>${waypoints.map(p=>point(p,'wpt')).join('')}${points.length?`<trk><name>${esc(name)}</name><trkseg>${points.map(p=>point(p,'trkpt')).join('')}</trkseg></trk>`:''}</gpx>`;type='application/gpx+xml';
 }
 const safe=name.normalize('NFKD').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'').slice(0,60)||'field-route';
 return new File([body],`${safe}-${new Date().toISOString().slice(0,10)}.${ext}`,{type});
}
async function deliver(share){try{const file=makeFile();if(share){if(!navigator.canShare||!navigator.canShare({files:[file]}))throw Error('File sharing is unavailable here. Use Download file instead.');await navigator.share({files:[file],title:$('exportName').value});$('exportStatus').textContent='File shared.';}else{const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);$('exportStatus').textContent='Download started: '+file.name;}}catch(e){$('exportStatus').textContent=e.name==='AbortError'?'Sharing cancelled. Your route is unchanged.':e.message;}}
$('downloadExport').onclick=()=>deliver(false);$('shareExport').onclick=()=>deliver(true);
$('clear').onclick=()=>{if(wps.length&&confirm('Clear all planned waypoints?')){wps.forEach(m=>m.remove());wps=[];changed();}};
$('printSelect').addEventListener('click',()=>{setPanel(false);$('hud').hidden=false;$('infoToggle').setAttribute('aria-pressed','true');});
})();
