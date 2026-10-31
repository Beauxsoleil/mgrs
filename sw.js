const SHELL='shell-v4',TILES='tiles-v1';
const ASSETS=['./','index.html','maplibre-gl.js','maplibre-gl.css','mgrs.js','wmm2025.js','print-export.js','field-ui.css','field-ui.js','manifest.webmanifest'];
const isTile=u=>/basemap\.nationalmap\.gov|tile\.openstreetmap\.org|elevation-tiles-prod/.test(u.hostname+u.pathname);
self.addEventListener('install',e=>{e.waitUntil(caches.open(SHELL).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('shell-')&&k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;
  const u=new URL(req.url);
  if(isTile(u)){
    e.respondWith(caches.match(req,{ignoreVary:true}).then(hit=>hit||fetch(req).then(res=>{
      if(res.ok){const cp=res.clone();caches.open(TILES).then(c=>c.put(req,cp))}return res})));
    return;
  }
  if(u.origin===location.origin){
    e.respondWith(fetch(req).then(res=>{
      if(res.ok){const cp=res.clone();caches.open(SHELL).then(c=>c.put(req,cp))}return res})
      .catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>r||caches.match('index.html'))));
  }
});
