/* FOSSGIS public OSRM service: https://routing.openstreetmap.de/about.html
   User-triggered requests only; at most one request per 1.1 seconds per client. */
(function(root){
'use strict';
function urlFor(mode,points){
 if(!['foot','car'].includes(mode))throw Error('Choose walking or driving.');
 if(points.length<2||points.length>25)throw Error('Road routing needs 2–25 waypoints.');
 if(!points.every(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85))throw Error('Invalid waypoint coordinates.');
 return `https://routing.openstreetmap.de/routed-${mode}/route/v1/driving/${points.map(p=>p.slice(0,2).map(v=>v.toFixed(6)).join(',')).join(';')}?overview=full&geometries=geojson&steps=false&generate_hints=false&radiuses=${points.map(()=>250).join(';')}`;
}
function parse(data,count){
 if(data.code!=='Ok')throw Error(data.code==='NoSegment'?'A waypoint is more than 250 m from a routable road or path. Move it closer.':data.code==='NoRoute'?'No connected route was found between these waypoints.':'The routing service could not calculate this route.');
 const r=data.routes?.[0],p=r?.geometry?.coordinates;
 if(r?.geometry?.type!=='LineString'||!Array.isArray(p)||p.length<2||p.length>150000||!p.every(q=>Array.isArray(q)&&q.length>=2&&q.slice(0,2).every(Number.isFinite)&&Math.abs(q[0])<=180&&Math.abs(q[1])<=90)||!Number.isFinite(r.distance)||r.distance<0||!Number.isFinite(r.duration)||r.duration<0||data.waypoints?.length!==count)throw Error('Invalid route returned by the service. Try again.');
 return {coordinates:p.map(q=>q.slice(0,2)),distance:r.distance,duration:r.duration,snaps:data.waypoints.map(w=>Number.isFinite(w.distance)?Math.round(w.distance):null)};
}
function createClient(fetcher){
 let nextStart=0;
 return async(mode,points,signal)=>{
  const url=urlFor(mode,points);
  const start=Math.max(Date.now(),nextStart);nextStart=start+1100;
  await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(t);reject(new DOMException('Cancelled','AbortError'))};const t=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},Math.max(0,start-Date.now()));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()});
  const response=await fetcher(url,{signal,referrerPolicy:'strict-origin-when-cross-origin'});
  if(response.status===429)throw Error('Routing service is busy. Wait a moment, then calculate again.');
  if(!response.ok&&response.status!==400)throw Error('Road routing unavailable. Check your connection and try again.');
  return parse(await response.json(),points.length);
 };
}
const api={urlFor,parse,createClient};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RoadRouting=api;
})(typeof window!=='undefined'?window:globalThis);
