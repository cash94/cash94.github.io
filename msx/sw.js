// sw.js - Service Worker для PWA

const CACHE_NAME = 'torrstream-v1.0.0';
const OFFLINE_URL = '/offline.html';

// Файлы для кэширования
const urlsToCache = [
    '/',
    'https://cash94.github.io/msx/index.html',
    'https://cash94.github.io/msx/manifest.json',
    'https://cash94.github.io/msx/css/styles.css',
    'https://cash94.github.io/msx/js/config.js',
    'https://cash94.github.io/msx/js/tmdb.js',
    'https://cash94.github.io/msx/js/torrents.js',
    'https://cash94.github.io/msx/js/catalog.js',
    'https://cash94.github.io/msx/js/player.js',
    'https://cash94.github.io/msx/js/control.js',
    'https://cash94.github.io/msx/js/donate.js',
    'https://cash94.github.io/msx/js/app.js',
    'https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.min.js',
    'https://fonts.googleapis.com/css2?family=Bitcount+Prop+Double:wght@100..900&display=swap',
    'https://cash94.github.io/msx/css/uicons-regular-rounded.css',
    'https://cash94.github.io/msx/css/uicons-thin-rounded.css',
    'https://cash94.github.io/msx/css/uicons-thin-chubby.css'
];

// Установка Service Worker
self.addEventListener('install', event => {
    console.log('[SW] Установка');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Кэширование файлов');
                return cache.addAll(urlsToCache);
            })
            .then(() => self.skipWaiting())
    );
});

// Активация Service Worker
self.addEventListener('activate', event => {
    console.log('[SW] Активация');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Удаление старого кэша:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Стратегия: Stale-While-Revalidate для API, Cache-First для статики
self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);

    // API запросы - Network First
    if (requestUrl.pathname.startsWith('/api/') ||
        requestUrl.pathname.startsWith('/hls/') ||
        requestUrl.hostname.includes('torrserver') ||
        requestUrl.hostname === 'jac.red') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Кэшируем успешные ответы API для оффлайн режима
                    if (response && response.status === 200 && requestUrl.pathname.startsWith('/api/')) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Если сеть недоступна, пробуем кэш
                    return caches.match(event.request);
                })
        );
        return;
    }

    // Статические файлы - Cache First
    if (requestUrl.pathname.match(/\.(css|js|json|png|jpg|jpeg|gif|svg|ico)$/)) {
        event.respondWith(
            caches.match(event.request)
                .then(response => {
                    if (response) {
                        return response;
                    }
                    return fetch(event.request)
                        .then(response => {
                            if (!response || response.status !== 200) {
                                return response;
                            }
                            const responseClone = response.clone();
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(event.request, responseClone);
                            });
                            return response;
                        });
                })
        );
        return;
    }

    // HTML и навигация - Network First с fallback на кэш
    if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html' ||
        event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response && response.status === 200) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseClone);
                        });
                        return response;
                    }
                    return caches.match(event.request);
                })
                .catch(() => {
                    return caches.match(OFFLINE_URL);
                })
        );
        return;
    }

    // Остальные запросы - Cache First
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});

// Фоновая синхронизация для сохранения таймкодов
self.addEventListener('sync', event => {
    if (event.tag === 'sync-timecodes') {
        event.waitUntil(syncTimecodes());
    }
});

async function syncTimecodes() {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();

    for (const request of requests) {
        if (request.url.includes('/api/timecode/save')) {
            const response = await cache.match(request);
            if (response) {
                const data = await response.json();
                try {
                    await fetch('/api/timecode/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    await cache.delete(request);
                } catch (e) {
                    console.error('Ошибка синхронизации таймкода:', e);
                }
            }
        }
    }
}

// Push уведомления (опционально)
self.addEventListener('push', event => {
    const options = {
        body: event.data ? event.data.text() : 'Новое обновление!',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        vibrate: [200, 100, 200],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        }
    };

    event.waitUntil(
        self.registration.showNotification('TorrStream', options)
    );
});