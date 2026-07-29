// module.js — Модуль «Русские» (rus-catalog)
// Собирает элементы с countries=["RU"] из movie/tv/cartoons/cartoons_tv,
// сортирует по дате торрента и отдаёт как каталог «Русские».

var SOURCE_CATALOGS = ['movie', 'tv', 'cartoons', 'cartoons_tv'];
var UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;   // автообновление раз в 6 часов
var REQUEST_TIMEOUT = 15000;
var INIT_DELAY_MS = 8000;                        // задержка первой сборки
var MAX_RETRIES = 5;

var rusState = {
    items: [],
    allIndex: 0,
    lastUpdated: 0,
    building: false
};
var updateTimer = null;
var serverUrl = 'http://127.0.0.1:3000';

// ==================== УТИЛИТЫ ====================

// Дата формата DD.MM.YYYY → timestamp
function parseRuDate(dateStr) {
    if (!dateStr) return 0;
    var parts = String(dateStr).split('.');
    if (parts.length !== 3) return 0;
    var d = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    var y = parseInt(parts[2], 10);
    if (isNaN(d) || isNaN(m) || isNaN(y)) return 0;
    return new Date(y, m, d).getTime();
}

// Свежая дата среди всех торрентов элемента (fallback: release_date)
function getItemDate(item) {
    var maxDate = 0;
    if (item.torrent && Array.isArray(item.torrent)) {
        for (var i = 0; i < item.torrent.length; i++) {
            var t = parseRuDate(item.torrent[i] && item.torrent[i].date);
            if (t > maxDate) maxDate = t;
        }
    }
    if (maxDate === 0 && item.release_date) {
        maxDate = parseRuDate(item.release_date);
    }
    return maxDate;
}

// Элемент российский?
function isRussian(item) {
    if (!item || !item.countries || !Array.isArray(item.countries)) return false;
    for (var i = 0; i < item.countries.length; i++) {
        if (String(item.countries[i]).toUpperCase() === 'RU') return true;
    }
    return false;
}

// ==================== ЗАГРУЗКА ИСХОДНЫХ КАТАЛОГОВ ====================

// Способ 1: прямое чтение файла (нативный режим, не зависит от порта/готовности HTTP)
function loadItemsDirect(name) {
    if (typeof require === 'undefined') return null;
    try {
        var fs = require('fs');
        var path = require('path');
        var os = require('os');
        var filePath = path.join(os.homedir(), '.videoloop-server', 'catalog', name + '.json');
        var data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return (data && Array.isArray(data.items)) ? data.items : [];
    } catch (e) {
        return null;   // fs недоступен / файла нет → fallback на HTTP
    }
}

// Способ 2: внутренний HTTP API
async function loadItemsHttp(name, log) {
    var url = serverUrl + '/api/catalog/' + name + '/items?from=0&limit=100000';
    try {
        var resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var data = await resp.json();
        return (data && data.success && Array.isArray(data.items)) ? data.items : [];
    } catch (e) {
        log.error('[' + name + '] HTTP-загрузка: ' + e.message);
        return [];
    }
}

// Единая точка загрузки: сначала диск, потом HTTP
async function loadItems(name, log) {
    var direct = loadItemsDirect(name);
    if (direct !== null) return direct;
    return await loadItemsHttp(name, log);
}

// ==================== СБОРКА КАТАЛОГА ====================

async function buildRusCatalog(log, retryCount) {
    if (rusState.building) return;
    retryCount = retryCount || 0;
    rusState.building = true;
    log.log('Сборка каталога «Русские»...');
    try {
        var collected = [];
        for (var i = 0; i < SOURCE_CATALOGS.length; i++) {
            var items = await loadItems(SOURCE_CATALOGS[i], log);
            for (var j = 0; j < items.length; j++) {
                if (isRussian(items[j])) collected.push(items[j]);
            }
        }

        // Пусто и есть попытки — каталоги могли ещё не загрузиться, повторяем
        if (collected.length === 0 && retryCount < MAX_RETRIES) {
            rusState.building = false;
            log.log('Пусто, повтор через 10с (попытка ' + (retryCount + 1) + '/' + MAX_RETRIES + ')');
            setTimeout(function () { buildRusCatalog(log, retryCount + 1); }, 10000);
            return;
        }

        // Сортировка по дате торрента — новые сверху
        collected.sort(function (a, b) {
            return getItemDate(b) - getItemDate(a);
        });

        // Пересчёт индексов под новый каталог
        for (var k = 0; k < collected.length; k++) {
            collected[k].num_index = k;
        }

        rusState.items = collected;
        rusState.allIndex = collected.length;
        rusState.lastUpdated = Date.now();
        log.log('Каталог «Русские» собран: ' + collected.length + ' элементов');

        tryWriteRusJson(collected, log);
    } catch (e) {
        log.error('Ошибка сборки «Русские»: ' + e.message);
    } finally {
        rusState.building = false;
    }
}

// Опционально: физически записываем rus.json (только если доступен fs)
function tryWriteRusJson(items, log) {
    try {
        if (typeof require === 'undefined') return;
        var fs = require('fs');
        var path = require('path');
        var os = require('os');
        var filePath = path.join(os.homedir(), '.videoloop-server', 'catalog', 'rus.json');
        fs.writeFileSync(filePath, JSON.stringify({ all_index: items.length, items: items }, null, 2), 'utf8');
        log.log('rus.json записан: ' + filePath);
    } catch (e) {
        // песочница без fs — не критично, каталог отдаётся из памяти
    }
}

// ==================== МОДУЛЬ ====================

module.exports = {
    name: 'rus-catalog',
    version: '1.0.1',

    init: function (app, ctx) {
        var log = ctx.log;
        log.log('Инициализация модуля «Русские»...');

        // Базовый URL сервера (для HTTP-fallback)
        serverUrl = (ctx && ctx.serverUrl) ||
            (typeof process !== 'undefined' && process.env && process.env.PORT
                ? 'http://127.0.0.1:' + process.env.PORT
                : 'http://127.0.0.1:3000');

        // Элементы с пагинацией (формат совместим с /api/catalog/:name/items)
        app.get('/api/rus/items', function (req, res) {
            var from = parseInt(req.query.from, 10) || 0;
            var limit = parseInt(req.query.limit, 10) || 50;

            function respond() {
                var slice = rusState.items.slice(from, from + limit);
                res.json({
                    success: true,
                    items: slice,
                    pagination: {
                        from: from,
                        limit: limit,
                        returned: slice.length,
                        total: rusState.allIndex,
                        hasMore: from + slice.length < rusState.allIndex
                    }
                });
            }

            // Ленивая сборка при первом запросе
            if (rusState.items.length === 0 && !rusState.building) {
                buildRusCatalog(log, 0).then(respond);
            } else {
                respond();
            }
        });

        // Метаданные каталога
        app.get('/api/rus', function (req, res) {
            res.json({
                success: true,
                name: 'rus',
                displayName: 'Русские',
                itemsCount: rusState.allIndex,
                lastModified: rusState.lastUpdated,
                lastModifiedISO: rusState.lastUpdated ? new Date(rusState.lastUpdated).toISOString() : null
            });
        });

        // Принудительное обновление
        app.post('/api/rus/update', function (req, res) {
            buildRusCatalog(log, 0).then(function () {
                res.json({ success: true, count: rusState.allIndex });
            });
        });

        // Первая сборка (с задержкой — даём серверу загрузить исходные каталоги)
        setTimeout(function () { buildRusCatalog(log, 0); }, INIT_DELAY_MS);

        // Автообновление
        updateTimer = setInterval(function () { buildRusCatalog(log, 0); }, UPDATE_INTERVAL_MS);

        log.log('Модуль «Русские» зарегистрирован: /api/rus/items');
        return { ready: true };
    },

    destroy: function () {
        if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
        console.log('[rus-catalog] Уничтожение...');
    }
};
