/*
 * Service Worker — مقرأة أبو نجيب السلمي لتحفيظ القرآن الكريم
 * يدعم العمل دون إنترنت (Offline-First للتطبيق والملفات الثابتة، وCache-First للمصادر القرآنية والصوتية المحفوظة)
 */

const CACHE_VERSION = 'maqraa-al-sulami-v1.0.0';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const QURAN_DATA_CACHE = `${CACHE_VERSION}-quran-data`;
const AUDIO_MEDIA_CACHE = `${CACHE_VERSION}-audio-media`;

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'api.alquran.cloud',
  'cdn.islamic.network',
  'server8.mp3quran.net',
  'server12.mp3quran.net',
  'server6.mp3quran.net',
  'everyayah.com'
]);

const CORE_ASSETS = [
  './',
  './index.html',
  './service-worker.js',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      return Promise.allSettled(
        CORE_ASSETS.map((asset) =>
          cache.add(new Request(asset, { cache: 'reload' })).catch(() => null)
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => ![APP_SHELL_CACHE, QURAN_DATA_CACHE, AUDIO_MEDIA_CACHE].includes(key))
          .map((oldKey) => caches.delete(oldKey))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (data.type === 'CLEAR_AUDIO_CACHE') {
    event.waitUntil(
      caches.delete(AUDIO_MEDIA_CACHE).then(() => {
        if (event.source) {
          event.source.postMessage({ type: 'AUDIO_CACHE_CLEARED' });
        }
      })
    );
  }
});

function isAllowedUrl(urlObj) {
  if (!urlObj || (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:')) {
    return false;
  }
  if (urlObj.origin === self.location.origin) {
    return true;
  }
  return ALLOWED_EXTERNAL_HOSTS.has(urlObj.hostname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!isAllowedUrl(url)) {
    return;
  }

  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.ok) {
            const copy = networkRes.clone();
            caches.open(APP_SHELL_CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          }
          return networkRes;
        })
        .catch(async () => {
          const cachedShell = await caches.match('./index.html') || await caches.match('./');
          if (cachedShell) return cachedShell;
          return new Response(
            '<html lang="ar" dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:2rem;"><h2>مقرأة أبو نجيب السلمي لتحفيظ القرآن الكريم</h2><p>أنت حالياً دون اتصال بالإنترنت. يرجى إعادة فتح التطبيق بعد التحميل المسبق.</p></body></html>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  const isAudioRequest = req.destination === 'audio' || /\.(mp3|ogg|m4a|wav)$/i.test(url.pathname);
  if (isAudioRequest) {
    event.respondWith(
      caches.match(req).then(async (cachedAudio) => {
        if (cachedAudio) return cachedAudio;
        try {
          const networkAudio = await fetch(req);
          if (networkAudio && networkAudio.status === 200) {
            const cloneForCache = networkAudio.clone();
            caches.open(AUDIO_MEDIA_CACHE).then((c) => c.put(req, cloneForCache)).catch(() => {});
          }
          return networkAudio;
        } catch (err) {
          return new Response('', { status: 504, statusText: 'Offline Audio Unavailable' });
        }
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cachedRes) => {
      const fetchPromise = fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.ok && networkRes.status === 200) {
            const targetCache = url.origin === self.location.origin ? APP_SHELL_CACHE : QURAN_DATA_CACHE;
            const resClone = networkRes.clone();
            caches.open(targetCache).then((c) => c.put(req, resClone)).catch(() => {});
          }
          return networkRes;
        })
        .catch(() => cachedRes || new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        }));

      return cachedRes || fetchPromise;
    })
  );
});
