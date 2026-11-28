const V='s7stl-v1.9.1';
const FILES=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all(FILES.map(f=>fetch(new Request(f,{cache:'reload'})).then(r=>{if(!r.ok)throw new Error(f);return c.put(f,r);})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const q=e.request;if(q.method!=='GET')return;
const html=q.mode==='navigate'||(q.headers.get('accept')||'').includes('text/html');
if(html){e.respondWith(fetch(new Request(q.url,{cache:'no-cache'})).then(res=>{const cp=res.clone();caches.open(V).then(c=>c.put('./index.html',cp));return res;}).catch(()=>caches.match('./index.html')));return;}
e.respondWith(caches.match(q,{ignoreSearch:true}).then(r=>r||fetch(q).then(res=>{const cp=res.clone();caches.open(V).then(c=>c.put(q,cp));return res;}).catch(()=>caches.match('./index.html'))));});
