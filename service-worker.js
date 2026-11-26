/*
 * Service Worker — مقرأة أبو نجيب السلمي
 * تخزين التطبيق والبيانات والصوتيات التي يطلبها المستخدم.
 */
'use strict';

const CACHE_VERSION = 'maqraa-al-sulami-v1.0.1';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const QURAN_DATA_CACHE = `${CACHE_VERSION}-quran-data`;
const AUDIO_MEDIA_CACHE = `${CACHE_VERSION}-audio-media`;
const CACHE_PREFIX = 'maqraa-al-sulami-';

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'api.alquran.cloud',
  'cdn.islamic.network',
  'server8.mp3quran.net',
  'server10.mp3quran.net',
  'server11.mp3quran.net',
  'server12.mp3quran.net',
  'server13.mp3quran.net',
  'server6.mp3quran.net',
  'everyayah.com'
]);

// لا نطلب ملفات صور PNG غير الموجودة في المستودع.
const CORE_ASSETS = ['./', './index.html', './service-worker.js', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_SHELL_CACHE);
    await Promise.allSettled(CORE_ASSETS.map(async (asset) => {
      try {
        const response = await fetch(new Request(asset, { cache: 'reload' }));
        if (response.ok) await cache.put(asset, response);
      } catch (_) {
        // فشل أصل واحد لا يمنع تثبيت بقية التطبيق.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) &&
        ![APP_SHELL_CACHE, QURAN_DATA_CACHE, AUDIO_MEDIA_CACHE].includes(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING') self.skipWaiting();

  if (data.type === 'CLEAR_AUDIO_CACHE') {
    event.waitUntil((async () => {
      await caches.delete(AUDIO_MEDIA_CACHE);
      if (event.source) event.source.postMessage({ type: 'AUDIO_CACHE_CLEARED' });
    })());
  }
});

function isAllowedUrl(url) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  return url.origin === self.location.origin || ALLOWED_EXTERNAL_HOSTS.has(url.hostname);
}

async function cacheResponse(cacheName, request, response) {
  if (!response || !response.ok || response.status !== 200 || response.type === 'opaque') return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch (_) {
    // امتلاء التخزين أو رفض المتصفح للتخزين لا يعطل الاستجابة الشبكية.
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (_) { return; }
  if (!isAllowedUrl(url)) return;

  const isNavigation = request.mode === 'navigate';
  const isAudio = request.destination === 'audio' || /\.(mp3|ogg|m4a|wav)(\?|$)/i.test(request.url);

  if (isNavigation) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) await cacheResponse(APP_SHELL_CACHE, './index.html', response);
        return response;
      } catch (_) {
        return (await caches.match('./index.html')) ||
          (await caches.match('./')) ||
          new Response(
            '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>مقرأة أبو نجيب السلمي</title><body style="font-family:sans-serif;text-align:center;padding:2rem"><h2>مقرأة أبو نجيب السلمي</h2><p>لا يوجد اتصال، ولم يتم حفظ نسخة من الصفحة بعد. افتح الموقع مرة واحدة أثناء الاتصال ثم أعد المحاولة.</p></body></html>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
      }
    })());
    return;
  }

  if (isAudio) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) await cacheResponse(AUDIO_MEDIA_CACHE, request, response);
        return response;
      } catch (_) {
        return new Response('', { status: 504, statusText: 'Offline Audio Unavailable' });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      const cacheName = url.origin === self.location.origin ? APP_SHELL_CACHE : QURAN_DATA_CACHE;
      if (response.ok) await cacheResponse(cacheName, request, response);
      return response;
    } catch (_) {
      return new Response(JSON.stringify({ error: 'offline', message: 'المحتوى غير محفوظ على هذا الجهاز' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
  })());
});
