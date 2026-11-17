// オフラインでも開けるように、アプリのファイルを手元に保存しておく（PWA）。
// ネットにつながるときは毎回新しい版を取りに行き、つながらないとき（3秒たっても返事がないとき）だけ保存した版を使う。
// FILES を変えたときは CACHE の番号を上げる
const CACHE = 'six-second-reading-v1';
const FILES = ['./', 'index.html', 'texts.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];
const WAIT_MS = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const net = fetch(req);
  // 取れた新しい版は保存しておく（clone は、ページが中身を読み始める前に済ませる）
  e.waitUntil(net.then(res => {
    if (!res.ok) return undefined;
    const copy = res.clone();
    return caches.open(CACHE).then(c => c.put(req, copy));
  }).catch(() => {}));
  e.respondWith((async () => {
    try {
      const res = await Promise.race([net, new Promise(r => setTimeout(r, WAIT_MS))]);
      if (res) return res;
    } catch { /* オフライン */ }
    const hit = await caches.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await caches.match('./') : undefined);
    // 保存した版もなければ、ネットの返事をそのまま待つ
    return hit || net;
  })());
});
