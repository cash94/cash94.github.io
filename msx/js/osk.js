// osk.js — встроенная экранная клавиатура (On-Screen Keyboard)
//
// Включается настройкой «Использовать встроенную клавиатуру» (Настройки →
// Прочее, AppState.builtinKeyboard). Зачем своя: системная клавиатура на
// телевизорах своя у каждой платформы, на части из них пультом почти не
// управляется, а на Vidaa/Tizen иногда не появляется вовсе.
//
// Как устроено
// ------------
// Поле ввода остаётся полем: .focused (фокус пульта) на нём, значение пишется
// в него же, и на каждое нажатие уходит событие input — поэтому всё, что
// слушает поле (проверка адреса TorrServer, код синхронизации), работает как
// при обычном наборе. Нативный фокус с поля снимается: иначе поверх нашей
// вылезла бы системная клавиатура.
//
// Когда открывается
//  - ОК пультом на текстовом поле с фокусом (перехват keydown в capture-фазе
//    на window — раньше control.js, который иначе дал бы полю нативный фокус);
//  - нативный фокус на поле сразу после действия человека: клик мышью, тап,
//    или код приложения, вызвавший focus() в ответ на нажатие (например,
//    открытие экрана поиска). Фокус без действия человека (autofocus при
//    загрузке) клавиатуру НЕ открывает.
//
// Когда закрывается
//  - «Готово» — с отправкой: change и Enter на поле (поиск по Enter запускает
//    поиск, как с настоящей клавиатуры);
//  - «Назад» на пульте, «вверх» с верхнего ряда клавиш, клик мимо клавиатуры —
//    без отправки, введённое остаётся в поле;
//  - поле пропало с экрана (сменили экран) — само.
//
// Пока клавиатура открыта, все клавиши пульта принадлежат ей: обработчик в
// capture-фазе гасит событие, и control.js его не видит.
//
// Курсор. Клавиши ◀ ▶ после «Пробела» двигают место набора по строке: букву,
// «⌫» и «Пробел» кладут/стирают у курсора, а не в конце. Ошибку в середине
// адреса так правят, не стирая всё, что после неё. Открывается клавиатура с
// курсором в конце строки.
//
// Совместимость: ES5 (Chrome 66 на телевизорах), flex без gap.

var OSK = (function () {
    'use strict';

    // Буквенные раскладки — три ряда. В английскую добавлены знаки, без
    // которых не набрать адрес (: / . -): иначе на каждый символ URL пришлось
    // бы переключаться в «123».
    var LAYOUTS = {
        ru: [
            ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
            ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э', 'ё'],
            ['я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', '.', ',', '-']
        ],
        en: [
            ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '-', '_'],
            ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ':', '/', '@'],
            ['z', 'x', 'c', 'v', 'b', 'n', 'm', '.', ',', '?', '&', '=']
        ],
        // Цифры и символы
        sym: [
            ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
            ['-', '_', '.', ',', ':', '/', '@', '?', '&', '='],
            ['!', '#', '%', '+', '*', '(', ')', "'", '"', ';']
        ]
    };

    var LANG_LABEL = { ru: 'RU', en: 'EN' };
    // Сколько после действия человека нативный фокус считаем «его» — см. шапку
    var USER_GESTURE_MS = 1500;
    var WATCH_MS = 400;

    var root = null, previewLabel = null, previewText = null, previewAfter = null, rowsEl = null;
    var target = null;           // поле, в которое печатаем
    var value = '';
    var caret = 0;               // позиция курсора в value: 0 … value.length
    var lang = 'ru';
    var mode = 'letters';        // letters | sym
    var shift = false;
    var rows = [];               // [[{el, key}]]
    var cur = { r: 0, c: 0 };
    var lastUserInputAt = 0;
    var watchTimer = null;
    var swallowKeyupOk = false;  // keyup того ОК, которым клавиатуру открыли

    function isEnabled() {
        return !!(window.AppState && AppState.builtinKeyboard);
    }

    function isOpen() {
        return !!(root && target && !root.classList.contains('hidden'));
    }

    var TEXT_TYPES = ['text', 'search', 'url', 'email', 'password', 'tel', 'number', ''];

    function isTextField(el) {
        if (!el || !el.tagName) return false;
        if (el.readOnly || el.disabled) return false;
        if (el.tagName === 'TEXTAREA') return true;
        if (el.tagName !== 'INPUT') return false;
        return TEXT_TYPES.indexOf((el.getAttribute('type') || '').toLowerCase()) !== -1;
    }

    // ---------- DOM ----------

    function ensureDom() {
        if (root) return;
        root = document.createElement('div');
        root.id = 'osk';
        root.className = 'osk hidden';
        root.innerHTML =
            '<div class="osk-panel" role="dialog" aria-label="Экранная клавиатура">' +
            '<div class="osk-preview"><span class="osk-preview-label"></span>' +
            '<span class="osk-preview-text"></span><span class="osk-caret"></span>' +
            '<span class="osk-preview-after"></span></div>' +
            '<div class="osk-rows"></div>' +
            '</div>';
        document.body.appendChild(root);
        previewLabel = root.querySelector('.osk-preview-label');
        previewText = root.querySelector('.osk-preview-text');
        previewAfter = root.querySelector('.osk-preview-after');
        rowsEl = root.querySelector('.osk-rows');

        // Мышь и тач: нажатие по клавише. mousedown гасим, чтобы клик по
        // клавиатуре не отнимал ничего у страницы и не считался «кликом мимо».
        root.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
        root.addEventListener('click', function (e) {
            e.stopPropagation();
            var keyEl = e.target.closest ? e.target.closest('.osk-key') : null;
            if (!keyEl) return;
            var rc = keyEl.getAttribute('data-rc').split(',');
            cur = { r: +rc[0], c: +rc[1] };
            paintCurrent();
            pressCurrent();
        });
    }

    function charRows() {
        if (mode === 'sym') return LAYOUTS.sym;
        return LAYOUTS[lang];
    }

    function controlRow() {
        return [
            { type: 'shift', label: '⇧', wide: 1, hidden: mode === 'sym' },
            { type: 'lang', label: lang === 'ru' ? 'EN' : 'RU', wide: 1, hidden: mode === 'sym' },
            { type: 'mode', label: mode === 'sym' ? 'АБВ' : '123', wide: 1 },
            { type: 'space', label: 'Пробел', wide: 3 },
            { type: 'left', label: '◀', wide: 1 },
            { type: 'right', label: '▶', wide: 1 },
            { type: 'back', label: '⌫', wide: 1 },
            { type: 'clear', label: 'Очистить', wide: 2 },
            { type: 'done', label: 'Готово', wide: 2 }
        ].filter(function (k) { return !k.hidden; });
    }

    function render() {
        var layout = charRows();
        var all = [];
        for (var r = 0; r < layout.length; r++) {
            all.push(layout[r].map(function (ch) {
                return { type: 'char', value: ch, label: shift ? ch.toUpperCase() : ch, wide: 1 };
            }));
        }
        all.push(controlRow());

        var html = '';
        for (var i = 0; i < all.length; i++) {
            html += '<div class="osk-row' + (i === all.length - 1 ? ' osk-row-controls' : '') + '">';
            for (var j = 0; j < all[i].length; j++) {
                var k = all[i][j];
                var cls = 'osk-key osk-key-' + k.type + (k.type === 'shift' && shift ? ' osk-on' : '');
                html += '<div class="' + cls + '" data-rc="' + i + ',' + j + '" style="-webkit-box-flex:' + k.wide + ';flex-grow:' + k.wide + '">' +
                    escapeKey(k.label) + '</div>';
            }
            html += '</div>';
        }
        rowsEl.innerHTML = html;

        rows = [];
        var rowEls = rowsEl.querySelectorAll('.osk-row');
        for (var a = 0; a < rowEls.length; a++) {
            var keyEls = rowEls[a].querySelectorAll('.osk-key');
            var row = [];
            for (var b = 0; b < keyEls.length; b++) row.push({ el: keyEls[b], key: all[a][b] });
            rows.push(row);
        }
        if (cur.r >= rows.length) cur.r = rows.length - 1;
        if (cur.c >= rows[cur.r].length) cur.c = rows[cur.r].length - 1;
        paintCurrent();
    }

    function escapeKey(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }

    function paintCurrent() {
        var old = rowsEl.querySelector('.osk-current');
        if (old) old.classList.remove('osk-current');
        var k = rows[cur.r] && rows[cur.r][cur.c];
        if (k) k.el.classList.add('osk-current');
    }

    function paintPreview() {
        var shown = target && target.type === 'password' ? value.replace(/./g, '•') : value;
        // Текст до курсора и после — разными блоками: у длинной строки виден
        // конец того, что до курсора, и начало того, что после (см. styles.css)
        previewText.textContent = shown.slice(0, caret);
        previewAfter.textContent = shown.slice(caret);
        previewText.classList.toggle('osk-preview-empty', !shown);
        if (!shown) previewText.textContent = (target && target.getAttribute('placeholder')) || '';
    }

    function setCaret(pos) {
        caret = Math.max(0, Math.min(value.length, pos));
        paintPreview();
    }

    /** Стереть символ перед курсором */
    function backspace() {
        if (caret <= 0) return;
        value = value.slice(0, caret - 1) + value.slice(caret);
        caret--;
        writeToField();
    }

    // Подпись над строкой: .field-label рядом с полем, иначе placeholder
    function fieldLabel(el) {
        var field = el.closest ? el.closest('.settings-field') : null;
        var lbl = field ? field.querySelector('.field-label') : null;
        if (lbl && lbl.textContent) return lbl.textContent;
        if (el.id === 'search-query') return 'Поиск';
        return '';
    }

    // ---------- Ввод ----------

    function writeToField() {
        if (!target) return;
        target.value = value;
        fire(target, 'input');
        paintPreview();
    }

    function fire(el, type) {
        var ev;
        try { ev = new Event(type, { bubbles: true }); }
        catch (e) { ev = document.createEvent('Event'); ev.initEvent(type, true, true); }
        el.dispatchEvent(ev);
    }

    function insert(ch) {
        var max = target && target.maxLength > 0 ? target.maxLength : 0;
        if (max && value.length >= max) return;
        value = value.slice(0, caret) + ch + value.slice(caret);
        caret += ch.length;
        writeToField();
    }

    function pressCurrent() {
        var k = rows[cur.r] && rows[cur.r][cur.c];
        if (!k) return;
        var key = k.key;
        if (key.type === 'char') {
            insert(shift ? key.value.toUpperCase() : key.value);
            // Шифт — на одну букву, как на телефоне
            if (shift) { shift = false; render(); }
            return;
        }
        if (key.type === 'space') return insert(' ');
        if (key.type === 'back') return backspace();
        if (key.type === 'left') return setCaret(caret - 1);
        if (key.type === 'right') return setCaret(caret + 1);
        if (key.type === 'clear') { value = ''; caret = 0; return writeToField(); }
        if (key.type === 'shift') { shift = !shift; return render(); }
        if (key.type === 'lang') {
            lang = lang === 'ru' ? 'en' : 'ru';
            try { localStorage.setItem('oskLang', lang); } catch (e) { }
            return render();
        }
        if (key.type === 'mode') {
            mode = mode === 'sym' ? 'letters' : 'sym';
            shift = false;
            // Ряд управляющих клавиш меняет состав — встаём на ту же кнопку
            render();
            focusControl('mode');
            return;
        }
        if (key.type === 'done') return close(true);
    }

    function focusControl(type) {
        var last = rows[rows.length - 1];
        for (var i = 0; i < last.length; i++) {
            if (last[i].key.type === type) { cur = { r: rows.length - 1, c: i }; break; }
        }
        paintCurrent();
    }

    // ---------- Навигация ----------

    function centerX(el) {
        var b = el.getBoundingClientRect();
        return b.left + b.width / 2;
    }

    function move(dir) {
        if (dir === 'left') { if (cur.c > 0) cur.c--; return paintCurrent(); }
        if (dir === 'right') { if (cur.c < rows[cur.r].length - 1) cur.c++; return paintCurrent(); }
        // Вверх с верхнего ряда — выход из клавиатуры обратно к полю
        if (dir === 'up' && cur.r === 0) return close(false);
        var nr = dir === 'up' ? cur.r - 1 : cur.r + 1;
        if (nr < 0 || nr >= rows.length) return;
        // Ряды разной длины и ширины: в соседнем ряду берём клавишу, ближайшую
        // по горизонтали, — как глаз ожидает, а не по номеру
        var x = centerX(rows[cur.r][cur.c].el);
        var best = 0, bestD = Infinity;
        for (var i = 0; i < rows[nr].length; i++) {
            var d = Math.abs(centerX(rows[nr][i].el) - x);
            if (d < bestD) { bestD = d; best = i; }
        }
        cur = { r: nr, c: best };
        paintCurrent();
    }

    // ---------- Открытие / закрытие ----------

    function initialLayout(el) {
        var forced = el.getAttribute('data-osk-layout');
        if (forced === 'sym' || el.type === 'number' || el.type === 'tel') return { lang: lang, mode: 'sym' };
        if (forced === 'en' || forced === 'ru') return { lang: forced, mode: 'letters' };
        // Адреса, логины, пароли — латиница
        if (el.type === 'url' || el.type === 'email' || el.type === 'password' ||
            ['torrserver-url', 'jacred-url', 'auth-login'].indexOf(el.id) !== -1) {
            return { lang: 'en', mode: 'letters' };
        }
        var saved = null;
        try { saved = localStorage.getItem('oskLang'); } catch (e) { }
        return { lang: saved === 'en' ? 'en' : 'ru', mode: 'letters' };
    }

    function open(el) {
        if (!isEnabled() || !isTextField(el)) return false;
        ensureDom();
        target = el;
        value = String(el.value || '');
        caret = value.length;
        var init = initialLayout(el);
        lang = init.lang;
        mode = init.mode;
        shift = false;
        cur = { r: 0, c: 0 };

        // Нативный фокус снимаем — иначе вылезет системная клавиатура
        if (document.activeElement === el) { try { el.blur(); } catch (e) { } }
        // Фокус пульта — на поле: после закрытия навигация продолжится от него
        if (typeof focusEl === 'function' && !el.classList.contains('focused')) focusEl(el);

        previewLabel.textContent = fieldLabel(el);
        render();
        paintPreview();
        root.classList.remove('hidden');
        document.body.classList.add('osk-open');

        if (watchTimer) clearInterval(watchTimer);
        watchTimer = setInterval(function () {
            // Поле ушло с экрана (сменили экран, закрыли оверлей) — прячемся
            if (!target || target.isConnected === false || target.offsetParent === null) close(false);
        }, WATCH_MS);
        return true;
    }

    function close(submit) {
        if (!root) return;
        var el = target;
        root.classList.add('hidden');
        document.body.classList.remove('osk-open');
        if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
        target = null;
        if (!el) return;
        fire(el, 'change');
        if (submit) {
            // Enter — как с настоящей клавиатуры. Не всплывает: обработчики на
            // самом поле (поиск по Enter) его получат, а document-слушатели
            // control.js — нет, иначе они приняли бы его за ОК пульта.
            var ev;
            try { ev = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: false, cancelable: true }); }
            catch (e) { ev = document.createEvent('Event'); ev.initEvent('keypress', false, true); ev.key = 'Enter'; ev.keyCode = 13; }
            el.dispatchEvent(ev);
        }
        // Фокус пульта оставляем на поле, если оно ещё на экране
        if (el.isConnected !== false && el.offsetParent !== null && typeof focusEl === 'function') {
            if (!document.querySelector('.focused')) focusEl(el);
        }
    }

    // ---------- Клавиши ----------

    function stop(e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    }

    function onKeyDown(e) {
        lastUserInputAt = Date.now();
        var kc = e.keyCode || e.which;

        if (!isOpen()) {
            // ОК на текстовом поле с фокусом пульта — наша клавиатура вместо
            // нативного фокуса, который дал бы полю control.js
            if (!isEnabled() || typeof isOkKey !== 'function' || !isOkKey(kc)) return;
            var f = document.querySelector('.focused');
            if (!isTextField(f)) return;
            stop(e);
            swallowKeyupOk = true;
            open(f);
            return;
        }

        stop(e);
        // Физическая клавиатура: Backspace стирает, а не закрывает. Проверяем
        // по e.key, а не по коду: код 8 у части пультов значит «назад»
        if (e.key === 'Backspace') return backspace();
        // «Назад» — раньше стрелок, в том же порядке, что и control.js: код
        // 10009 есть и в LEFT, и в BACK, а на Tizen это именно «назад»
        if (typeof isBackKey === 'function' ? isBackKey(kc) : kc === 27) return close(false);
        var dir = typeof arrowDir === 'function' ? arrowDir(kc) : null;
        if (dir) return move(dir);
        if (typeof isOkKey === 'function' ? isOkKey(kc) : kc === 13) return pressCurrent();
        // Физическая клавиатура: печатаемый символ — прямо в поле
        if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) insert(e.key);
    }

    function onKeyUp(e) {
        if (isOpen() || swallowKeyupOk) {
            swallowKeyupOk = false;
            stop(e);
        }
    }

    function onFocusIn(e) {
        var el = e.target;
        if (!isEnabled() || !isTextField(el)) return;
        if (root && root.contains(el)) return;
        // Уже печатаем в это поле — просто снова снимаем нативный фокус
        // (control.js при открытии поиска зовёт focus() несколько раз подряд)
        if (isOpen() && target === el) { try { el.blur(); } catch (err) { } return; }
        if (Date.now() - lastUserInputAt > USER_GESTURE_MS) return;
        open(el);
    }

    function onPointerDown(e) {
        lastUserInputAt = Date.now();
        if (isOpen() && root && !root.contains(e.target) && e.target !== target) close(false);
    }

    /** Настройку выключили — открытая клавиатура закрывается. */
    function applySetting() {
        if (!isEnabled() && isOpen()) close(false);
    }

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('touchstart', onPointerDown, true);

    return {
        open: open,
        close: close,
        isOpen: isOpen,
        applySetting: applySetting
    };
})();

window.OSK = OSK;
