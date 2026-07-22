const CACHE='meridian-v1';
const ASSETS=['./','./index.html','./manifest.webmanifest'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  // never cache the Pantry API — always go to network for sync
  if(url.hostname.includes('getpantry.cloud')||url.hostname.includes('anthropic.com')) return;
  // app shell: cache-first, fall back to network
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
    if(e.request.method==='GET' && resp.ok){ const cp=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)); }
    return resp;
  }).catch(()=>caches.match('./index.html'))));
});
