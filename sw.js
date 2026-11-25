/* 오프라인 캐시. 앱 파일을 바꿔서 배포할 때마다 VERSION을 올린다.
   같은 출처 파일: 저장본을 먼저 보여 주고 뒤에서 새 버전을 받아 둔다(다음 실행부터 반영).
   서체(CDN): 한 번 받으면 저장본만 쓴다. */
const VERSION = 'shift-v18';
const SHELL = [
  './', 'index.html', 'styles.css', 'calc.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'moon/p0l.webp', 'moon/p0d.webp', 'moon/p1l.webp', 'moon/p1d.webp', 'moon/p2l.webp', 'moon/p2d.webp',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('index.html') : null);
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || new Response('오프라인이에요', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open(VERSION + '-cdn').then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
  }
});
