// nav.js — стек переходов: откуда пришли и куда вернёт «назад»
//
// Зачем. «Назад» решался десятком разрозненных флагов (searchReturnTo,
// configReturnTo, detailHistory, personTrail, detailFromHome, returnToSearchResults…),
// и каждый экран помнил «откуда пришли» по-своему. Большинство ошибок возврата —
// рассинхрон этих флагов. Здесь один стек: идём вперёд — кладём запись, «назад» —
// снимаем верхнюю и возвращаемся к предыдущей.
//
// Кто открывает экран, тот кладёт запись (push); кто закрывает — снимает её
// (pop) и возвращается туда, куда указывает новая верхняя (returnTarget).
// Разделы (вкладки шапки) начинают стек заново (reset). Полный стек пишется в
// консоль с ?navdebug=1; window.Nav.dump() — текущий стек строкой.
//
// Запись: { screen, data, restore }
//   screen — разделы (дно стека): 'home' | 'catalog' | 'torrents';
//            поверх них: 'grid' (категория или фильмография актёра), 'detail',
//            'torrent-detail', 'search', 'config', 'donate', 'player'
//   data   — что это за экземпляр: data.key для склейки повторов, data.label
//            для лога, для карточки — item и index (по ним её открывают снова),
//            для раздачи — torrent, для поиска TMDB — query
//   restore — снимок экрана на момент ухода из него (Nav.register): прокрутка
//            раздела, категория/актёр и позиция сетки
var Nav = (function () {
    'use strict';

    var MAX_DEPTH = 40;
    var SECTIONS = { home: 1, catalog: 1, torrents: 1 };

    var stack = [];
    var handlers = {};
    var debug = /[?&]navdebug=1/.test(String(window.location && window.location.search));

    function describe(e) {
        if (!e) return '∅';
        var label = e.data && e.data.label;
        return e.screen + (label ? '(' + label + ')' : '');
    }

    function dump() {
        var out = [];
        for (var i = 0; i < stack.length; i++) out.push(describe(stack[i]));
        return out.join(' → ');
    }

    function log() {
        if (!debug) return;
        var args = ['🧭'];
        for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
        console.log.apply(console, args);
    }

    function top() { return stack[stack.length - 1] || null; }
    function prev() { return stack[stack.length - 2] || null; }
    function depth() { return stack.length; }

    function find(screen) {
        for (var i = stack.length - 1; i >= 0; i--) if (stack[i].screen === screen) return stack[i];
        return null;
    }

    function register(screen, h) { handlers[screen] = h || {}; }

    function currentSection() {
        var s = window.AppState && AppState.currentScreen;
        return SECTIONS[s] ? s : 'home';
    }

    /** Смена раздела: стек начинается заново с него */
    function reset(section, data) {
        if (!SECTIONS[section]) section = currentSection();
        stack = [{ screen: section, data: data || {}, restore: null }];
        log('reset', dump());
    }

    function snapshotTop() {
        var t = top();
        if (!t) return;
        var h = handlers[t.screen];
        if (h && typeof h.snapshot === 'function') {
            try { t.restore = h.snapshot(t); } catch (e) { t.restore = null; }
        }
    }

    /**
     * Шаг вперёд. Повтор той же записи (тот же screen и data.key) не кладём:
     * одно и то же открытие бывает вызвано дважды (дребезг OK, повторная
     * отрисовка после возврата), а «назад» должен отматывать шаги, а не вызовы.
     */
    function push(screen, data) {
        data = data || {};
        if (!stack.length) reset(currentSection());
        var t = top();
        if (t && t.screen === screen && (data.key === undefined || t.data.key === data.key)) {
            if (data.label) t.data = data;
            log('push (повтор, пропущен)', dump());
            return t;
        }
        snapshotTop();
        var e = { screen: screen, data: data, restore: null };
        stack.push(e);
        // Переполнение: выкидываем самые старые шаги над разделом
        while (stack.length > MAX_DEPTH) stack.splice(1, 1);
        log('push', dump());
        return e;
    }

    /**
     * Шаг назад. Снимает верхнюю запись, если это screen, и возвращает новую
     * верхнюю — место возврата.
     * null — наверху не он (экран не открывали через стек): вызывающий
     * решает сам, как раньше.
     */
    function pop(screen) {
        var t = top();
        if (!t || t.screen !== screen || stack.length <= 1) return null;
        stack.pop();
        log('pop:', describe(t), '⇒', describe(top()), '|', dump());
        return top();
    }

    /**
     * Имя экрана возврата в словаре старого кода (restoreFocusAfterNavigation,
     * hideSearchResults): 'home' | 'catalog' | 'torrents' | 'detail' | 'search'.
     */
    function returnTarget(entry) {
        if (!entry) return null;
        switch (entry.screen) {
            case 'grid': return 'catalog';
            case 'torrent-detail': return 'detail';
            case 'home': case 'catalog': case 'torrents': case 'detail': case 'search': return entry.screen;
            default: return null;
        }
    }

    /**
     * Свободный поиск, открытый поверх карточки: после своего запроса карточка
     * ни при чём (searchTorrents, torrents.js), и «назад» из поиска ведёт туда,
     * откуда её открыли — на главную, в категорию, в фильмографию. Снимаем
     * записи карточек прямо под поиском; если под ними ещё один поиск (карточку
     * открыли из выдачи), он сливается с верхним — оверлей один и тот же.
     */
    function dropDetailsUnderTop(reason) {
        var t = stack.pop();
        if (!t) return;
        while (stack.length > 1) {
            var s = stack[stack.length - 1].screen;
            if (s !== 'detail' && s !== 'torrent-detail' && !(s === t.screen && s === 'search')) break;
            stack.pop();
        }
        stack.push(t);
        log('drop (' + (reason || '') + ')', dump());
    }

    /**
     * data для записи карточки TMDB: ключ склейки повторов, подпись для лога,
     * сам элемент и его позиция — по ним «назад» откроет карточку снова.
     */
    function detailData(item, index) {
        item = item || {};
        return {
            index: index || 0,
            key: 'd:' + (item.id || item.tmdbId || '') + ':' + (item.media_type || ''),
            label: item.title || item.name || item.original_title ||
                (item.torrent && item.torrent[0] && item.torrent[0].name) || String(item.id || ''),
            item: item
        };
    }

    return {
        detailData: detailData,
        dropDetailsUnderTop: dropDetailsUnderTop,
        pop: pop,
        returnTarget: returnTarget,
        register: register,
        reset: reset,
        push: push,
        top: top,
        prev: prev,
        depth: depth,
        find: find,
        dump: dump
    };
})();

window.Nav = Nav;
