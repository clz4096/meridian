const CACHE='meridian-v11';   // bump to invalidate old cached app shell
const ASSETS=['./','./index.html','./manifest.webmanifest'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;   // never intercept writes (Pantry POSTs)
  const url=new URL(e.request.url);
  if(url.hostname.includes('supabase.co')||url.hostname.includes('getpantry.cloud')) return; // never cache sync/AI (Supabase proxy + storage)
  // questions bank: network-first so new questions appear, cache as offline fallback
  if(url.pathname.includes('/questions/')){
    e.respondWith(fetch(e.request).then(resp=>{ if(resp.ok){ const cp=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)); } return resp; }).catch(()=>caches.match(e.request)));
    return;
  }
  const isShell = e.request.mode==='navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/meridian/') || url.pathname.endsWith('/');
  if(isShell){
    // NETWORK-FIRST for the app shell: always get the freshest HTML when online, cache as offline fallback
    e.respondWith(fetch(e.request).then(resp=>{ if(resp.ok){ const cp=resp.clone(); caches.open(CACHE).then(c=>c.put('./index.html',cp)); } return resp; }).catch(()=>caches.match('./index.html')));
    return;
  }
  // other GETs: cache-first is fine
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{ if(e.request.method==='GET'&&resp.ok){ const cp=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)); } return resp; })));
});
