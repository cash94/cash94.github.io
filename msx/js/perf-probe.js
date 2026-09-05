// perf-probe.js — измеритель длинных кадров. Включается только по ?perf=1.
//
// Зачем: микрофризы видно глазом, но не видно, чем они вызваны. Профилировщика
// на телевизоре нет, консоль недоступна, поэтому зонд считает всё сам и рисует
// итог поверх экрана — крупно, чтобы читалось с дивана.
//
// Что делает:
//   • меряет промежутки между кадрами (requestAnimationFrame) и считает,
//     сколько из них длиннее 32 и 50 мс — это и есть «микрофризы»;
//   • оборачивает подозреваемые функции таймером и копит, сколько миллисекунд
//     каждая съела и сколько раз вызвана;
//   • на длинном кадре запоминает, кто отработал прямо перед ним.
//
// Сам зонд стоит доли миллисекунды на кадр: одно вычитание и пара счётчиков.
// Обёртки добавляют вызов Date.now() на функцию — на фоне искомых десятков
// миллисекунд это шум, но держать зонд включённым постоянно всё равно незачем.
(function () {
    'use strict';

    if (location.search.indexOf('perf=1') === -1) return;
    if (window.__perfProbe) return;          // подключений две точки, зонд один
    window.__perfProbe = true;

    var LONG_FRAME_MS = 32;     // пропущенный кадр при 60 Гц
    var STALL_MS = 50;          // заметный глазу рывок

    // ==================== ОПЫТЫ ====================
    // Зонд умеет отвечать только за наш JS, а большая часть рывков приходится
    // на работу браузера, которую изнутри страницы не измерить. Зато её можно
    // выключить и сравнить счётчики — метод грубый, но однозначный.
    //
    //   ?perf=1&noposters=1 — постеры не попадают в DOM вообще (декод и
    //       отрисовка картинок исчезают, вся остальная логика цела);
    //   ?perf=1&nocv=1      — снят content-visibility с карточек сетки
    //       (тогда браузер рисует их заранее, а не в момент входа в кадр).
    //
    // Прогон делается тем же движением, что и обычный, и сравнивается строка
    // «рывков». Флаги только для замера — в бою не включать.
    var NO_POSTERS = location.search.indexOf('noposters=1') !== -1;
    var NO_CV = location.search.indexOf('nocv=1') !== -1;

    // ?perf=1&blink=1 — ловим МИГАНИЕ: кто именно убирает постер из DOM.
    //
    // MutationObserver для этого не годится: он приходит после задачи, и стека
    // вызова в нём уже нет. Поэтому подменяем сами removeChild и remove и
    // снимаем стек в момент удаления — так видно строку виновника, а не
    // последствие. Дорого, поэтому только по флагу.
    var BLINK = location.search.indexOf('blink=1') !== -1;
    var blinkLog = {};
    var blinkTotal = 0;

    var frames = 0, longFrames = 0, stalls = 0, worst = 0;
    var lastFrame = 0;
    var stats = {};             // имя -> { ms, calls }
    var recent = [];            // кто отработал с прошлого кадра
    var blame = {};             // имя -> сколько раз оказался перед длинным кадром

    function bucket(name) {
        if (!stats[name]) stats[name] = { ms: 0, calls: 0 };
        return stats[name];
    }

    /**
     * Оборачивает глобальную функцию таймером.
     *
     * Работает потому, что модули приложения — обычные классические скрипты:
     * объявленная в них функция живёт в window, и внутренние вызовы идут через
     * ту же глобальную привязку, которую мы подменяем.
     */
    function wrap(name) {
        var orig = window[name];
        if (typeof orig !== 'function' || orig.__probed) return false;

        var probed = function () {
            var t0 = Date.now();
            try {
                return orig.apply(this, arguments);
            } finally {
                var dt = Date.now() - t0;
                var b = bucket(name);
                b.ms += dt;
                b.calls++;
                if (dt >= 4) recent.push(name + ':' + dt);
            }
        };
        probed.__probed = true;
        window[name] = probed;
        return true;
    }

    // Подозреваемые: всё, что трогает DOM или обходит карточки пачкой.
    // Имён, которых в сборке нет, wrap просто не найдёт.
    var TARGETS = [
        'appendCatalogItems',        // догрузка страницы: создание 18–50 карточек разом
        'updatePosterObservers',     // полный обход сетки на каждую догрузку
        'updateGridVisibilityWindow',// ещё один полный обход
        'updateFocusableElements',   // обход с offsetParent — принудительный layout
        'rebuildChunkRanges',
        'hydrateChunk',              // разворот чанка: пересоздание карточек
        'dehydrateChunk',            // свёртка чанка: удаление карточек
        'trimGridChunks',
        'ensureChunksAroundFocus',
        'flushVisibilityToggles',
        'flushDeferredPosters',
        'updatePosterDOM',
        'loadPosterDirect',
        'createCatalogCard',
        'focusEl',
        'scrollToElementIfNeeded',
        'revealCatalogElement'
    ];

    var wrapped = [];
    function installWraps() {
        for (var i = 0; i < TARGETS.length; i++) {
            if (wrapped.indexOf(TARGETS[i]) === -1 && wrap(TARGETS[i])) {
                wrapped.push(TARGETS[i]);
            }
        }
        if (NO_POSTERS) installNoPosters();
    }

    /**
     * Опыт «без постеров»: подменяем сами вставки картинки пустышками.
     *
     * Именно вставки, а не загрузку: логика очередей, наблюдателей и придержки
     * продолжает работать ровно как в бою, а из кадра уходят только декод и
     * отрисовка изображений. Если рывки после этого почти исчезнут — виноваты
     * картинки; если останутся — дело в самой сетке.
     *
     * setRowPosterImg обязан вернуть промис: на нём висит счётчик
     * activeRowPosterLoads, и без него очередь рядов встанет намертво.
     */
    function installNoPosters() {
        if (typeof window.updatePosterDOM === 'function' && !window.updatePosterDOM.__neutered) {
            var f1 = function () { };
            f1.__neutered = true; f1.__probed = true;
            window.updatePosterDOM = f1;
        }
        if (typeof window.setRowPosterImg === 'function' && !window.setRowPosterImg.__neutered) {
            var f2 = function () {
                return (typeof Promise !== 'undefined') ? Promise.resolve() : null;
            };
            f2.__neutered = true; f2.__probed = true;
            window.setRowPosterImg = f2;
        }
    }

    /** Первый кадр стека, который не принадлежит самому зонду */
    function appFrame(stack) {
        var lines = String(stack || '').split('\n');
        for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            if (l.indexOf('perf-probe') !== -1) continue;
            if (l.indexOf('appFrame') !== -1 || l.indexOf('traceRemoval') !== -1) continue;
            var m = /at\s+([A-Za-z0-9_$.]+)\s/.exec(l);
            if (m && m[1] !== 'Object' && m[1] !== 'Function') return m[1];
            var m2 = /\/js\/([a-z-]+\.js).*?:(\d+):/.exec(l);
            if (m2) return m2[1] + ':' + m2[2];
        }
        return '?';
    }

    function traceRemoval(node) {
        if (!node || node.nodeType !== 1) return;
        var hit = false;
        if (node.tagName === 'IMG') {
            hit = node.className && node.className.indexOf('poster') !== -1;
        } else if (node.querySelector) {
            hit = !!node.querySelector('img.catalog-poster-img, .row-poster-img img');
        }
        if (!hit) return;
        blinkTotal++;
        var st;
        try { throw new Error('x'); } catch (e) { st = e.stack; }
        var who = appFrame(st);
        blinkLog[who] = (blinkLog[who] || 0) + 1;
    }

    function installBlinkTrace() {
        var origRemoveChild = Node.prototype.removeChild;
        Node.prototype.removeChild = function (n) {
            traceRemoval(n);
            return origRemoveChild.call(this, n);
        };
        if (Element.prototype.remove) {
            var origRemove = Element.prototype.remove;
            Element.prototype.remove = function () {
                traceRemoval(this);
                return origRemove.apply(this, arguments);
            };
        }
        // innerHTML тоже стирает содержимое — за ним следим отдельно
        try {
            var d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
            if (d && d.set) {
                Object.defineProperty(Element.prototype, 'innerHTML', {
                    configurable: true,
                    enumerable: d.enumerable,
                    get: d.get,
                    set: function (v) {
                        traceRemoval(this);
                        return d.set.call(this, v);
                    }
                });
            }
        } catch (e) { }
    }

    /** Опыт «без content-visibility»: перебиваем правило из styles.css */
    function installNoCv() {
        var st = document.createElement('style');
        st.textContent =
            '.torrent-card.catalog-card{content-visibility:visible !important;' +
            'contain-intrinsic-size:auto !important;}';
        document.head.appendChild(st);
    }

    // Длинные задачи главного потока — если браузер умеет о них рассказать
    var longTasks = 0, longTaskMs = 0;
    try {
        if (window.PerformanceObserver) {
            new PerformanceObserver(function (list) {
                var e = list.getEntries();
                for (var i = 0; i < e.length; i++) {
                    longTasks++;
                    longTaskMs += e[i].duration;
                }
            }).observe({ entryTypes: ['longtask'] });
        }
    } catch (e) { }

    function tick(now) {
        if (lastFrame) {
            var gap = now - lastFrame;
            frames++;
            if (gap > worst) worst = gap;
            if (gap >= LONG_FRAME_MS) {
                longFrames++;
                if (gap >= STALL_MS) stalls++;
                // Виноват тот, кто отработал прямо перед пропущенным кадром
                for (var i = 0; i < recent.length; i++) {
                    var nm = recent[i].split(':')[0];
                    blame[nm] = (blame[nm] || 0) + 1;
                }
            }
        }
        lastFrame = now;
        recent.length = 0;
        requestAnimationFrame(tick);
    }

    // ==================== ЭКРАН ====================
    var box = null;

    function ensureBox() {
        if (box && box.parentNode) return box;
        box = document.createElement('div');
        box.id = 'perf-probe';
        box.style.cssText = [
            'position:fixed', 'top:8px', 'right:8px', 'z-index:99999',
            'background:rgba(0,0,0,0.85)', 'color:#0f0', 'font:13px/1.35 monospace',
            'padding:8px 10px', 'border-radius:8px', 'white-space:pre',
            'pointer-events:none', 'max-width:46vw'
        ].join(';');
        document.body.appendChild(box);
        return box;
    }

    function top3(map, unit) {
        var keys = Object.keys(map);
        keys.sort(function (a, b) {
            return (map[b].ms !== undefined ? map[b].ms : map[b]) -
                (map[a].ms !== undefined ? map[a].ms : map[a]);
        });
        var out = [];
        for (var i = 0; i < keys.length && i < 3; i++) {
            var v = map[keys[i]];
            out.push('  ' + keys[i] + ' ' +
                (v.ms !== undefined ? (v.ms + unit + ' x' + v.calls) : v));
        }
        return out.length ? out.join('\n') : '  —';
    }

    function render() {
        var el = ensureBox();
        el.textContent =
            (NO_POSTERS ? 'ОПЫТ: без постеров\n' : '') +
            (NO_CV ? 'ОПЫТ: без content-visibility\n' : '') +
            'кадров: ' + frames + '\n' +
            'длинных (>' + LONG_FRAME_MS + 'мс): ' + longFrames + '\n' +
            'рывков (>' + STALL_MS + 'мс): ' + stalls + '\n' +
            'худший кадр: ' + Math.round(worst) + 'мс\n' +
            (longTasks ? ('long tasks: ' + longTasks + ' / ' + Math.round(longTaskMs) + 'мс\n') : '') +
            '\nпо времени:\n' + top3(stats, 'мс') +
            '\nперед рывками:\n' + top3(blame, '') +
            (BLINK ? ('\nпостер убрал (' + blinkTotal + '):\n' + top3(blinkLog, '')) : '');
    }

    function start() {
        if (NO_CV) installNoCv();
        if (BLINK) installBlinkTrace();
        installWraps();
        setInterval(installWraps, 2000);   // патчи догружаются позже основных модулей
        requestAnimationFrame(tick);
        setInterval(render, 500);
        console.log('[perf=1] зонд включён');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 1500); });
    } else {
        setTimeout(start, 1500);
    }

    // Сброс счётчиков — чтобы мерить один конкретный проход, а не всю сессию
    window.perfProbeReset = function () {
        frames = longFrames = stalls = 0; worst = 0;
        longTasks = 0; longTaskMs = 0;
        stats = {}; blame = {};
    };
})();
