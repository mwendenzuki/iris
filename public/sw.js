const C='iris-v3';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/index.html','/manifest.json','/icon.svg'])));self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(clients.claim()));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url),same=u.origin===location.origin;
 if(e.request.method!=='GET')return;
 if(same){ // app shell: network first so updates arrive, cache as offline fallback
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)));return}
 if(/jsdelivr|storage\.googleapis|tfhub|kaggle|fonts\.(googleapis|gstatic)/.test(u.host))
  e.respondWith(caches.match(e.request).then(h=>h||fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r})));
});
