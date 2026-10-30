const CACHE_NAME='hyosan-lpl-v127';
const APP_SHELL=['./','./index.html','./manifest.webmanifest','./mobile.webmanifest','./assets/hyosan-app-icon.svg','./assets/hyosan-lpl-logo-full.svg','./assets/hyosan-app-icon-192.png','./assets/hyosan-app-icon-512.png'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    // 새 화면을 먼저 받되, 휴대폰 네트워크가 느려 3초 안에 오지 않으면 저장해 둔 화면으로 바로 연다(받아 온 새 화면은 다음에 쓰도록 저장)
    const network=fetch(request),saved=network.then(response=>{if(!response.ok)return;const copy=response.clone();return caches.open(CACHE_NAME).then(cache=>cache.put('./index.html',copy))}).catch(()=>{});
    event.waitUntil(saved);
    event.respondWith(caches.match('./index.html').then(cached=>cached?Promise.race([network.catch(()=>cached),new Promise(resolve=>setTimeout(()=>resolve(cached),3000))]):network));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(request,copy))}return response})));
});
