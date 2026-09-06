// animations.js - Анимации с использованием GSAP

var Animations = (function () {
    'use strict';

    // Конфигурация анимаций
    var config = {
        duration: {
            fast: 0.15,
            normal: 0.25,
            slow: 0.4
        },
        ease: {
            bounce: "back.out(1.2)",
            elastic: "elastic.out(1, 0.5)",
            smooth: "power1.out",
            soft: "sine.inOut"
        }
    };

    // Инициализация плагинов gsap, если они подключены.
    // ScrollTrigger / ScrollToPlugin / EasePack убраны из index.html (тормозили
    // прокрутку), поэтому каждый проверяем отдельно: раньше ScrollToPlugin
    // регистрировался внутри проверки на ScrollTrigger.

    // Анимация появления карточек при загрузке

    // Анимация карточки при наведении (для мыши)

    // Анимация для фокуса (TV пульт)

    // ==================== ДЕТАЛЬНЫЙ ПРОСМОТР: ОТКРЫТИЕ / ЗАКРЫТИЕ ====================
    // Длительности подобраны «в меру»: видно, что экран проявляется и уходит,
    // но ждать не приходится.
    var DETAIL_FADE = {
        show: 0.32,          // появление #detail-view
        hide: 0.26,          // закрытие
        loader: 0.18,        // проявление/скрытие индикатора «Загрузка…»
        loaderDelayMs: 160,  // пауза перед показом индикатора: если всё из кэша, он не мигнёт
        loaderMaxMs: 4000,   // страховка — индикатор не должен зависнуть насовсем
        easeOut: 'cubic-bezier(0.22, 0.61, 0.36, 1)',   // аналог power2.out
        easeIn: 'cubic-bezier(0.55, 0.09, 0.68, 0.53)'  // аналог power2.in
    };

    var detailHideTween = null;        // текущее затухание при закрытии
    var detailLoaderEl = null;         // оверлей «Загрузка…» (в body, поверх карточки)
    var detailLoaderShowTimer = null;  // отложенный показ индикатора
    var detailLoaderMaxTimer = null;   // страховочное скрытие индикатора

    /**
     * Сброс сдвига и масштаба, оставшихся от прежних анимаций gsap.
     *
     * Раньше это делал gsap.set({y:0, scale:1}). Анимаций по y/scale в модуле
     * больше нет, так что сбрасывать, по сути, нечего — но инлайн мог остаться
     * от старой версии в уже открытой сессии, и снять его дешевле, чем
     * разбираться потом. Чистим и отдельные свойства transform: gsap разных
     * версий пишет то в transform, то в translate/scale.
     */
    function clearTransform(el) {
        if (!el || !el.style) return;
        el.style.transform = '';
        el.style.translate = '';
        el.style.scale = '';
    }

    // Снять незакончившееся затухание, оставив текущее значение прозрачности
    function stopFade(el) {
        if (el && el._fadeHandle) el._fadeHandle.kill();
    }

    /**
     * Плавное изменение прозрачности через CSS-переход.
     *
     * Раньше здесь был gsap.to(). Его тик живёт в основном потоке, а отрисовка
     * карточки (особенно из каталога) занимает поток надолго — переход не
     * доигрывал и экран оставался полупрозрачным (0.2…0.97). CSS-переход
     * считает композитор: он доводит прозрачность до конца независимо от того,
     * чем занят JS.
     *
     * Возвращает объект с kill() — совместимо с прежним тваном gsap.
     */
    function fadeElement(el, toOpacity, duration, ease, onComplete) {
        if (!el) return null;

        stopFade(el);   // остатки прежнего затухания; твинов gsap здесь больше нет

        var finished = false;
        var timer = null;

        function cleanup() {
            if (el.removeEventListener) el.removeEventListener('transitionend', onTransitionEnd, false);
            if (timer) { clearTimeout(timer); timer = null; }
            if (el._fadeHandle === handle) el._fadeHandle = null;
        }

        function finish() {
            if (finished) return;
            finished = true;
            cleanup();
            el.style.transition = '';
            el.style.opacity = String(toOpacity);
            if (onComplete) onComplete();
        }

        function onTransitionEnd(e) {
            // Переходы дочерних элементов всплывают сюда — они не наши
            if (e.target !== el || e.propertyName !== 'opacity') return;
            finish();
        }

        // Дошла ли прозрачность до цели (переход закончился или не запускался)
        function atTarget() {
            if (!window.getComputedStyle) return true;
            var now;
            try { now = parseFloat(window.getComputedStyle(el).opacity); } catch (err) { return true; }
            if (isNaN(now)) return true;
            return Math.abs(now - toOpacity) < 0.02;
        }

        // Страховка на случай, если transitionend не придёт (элемент скрыт,
        // переход не стартовал). Проверяем реальное значение: пока поток был
        // занят отрисовкой, переход мог даже не начаться — тогда ждём ещё круг,
        // иначе страховка сама превратила бы плавное появление в резкое.
        var attempts = 0;
        function tick() {
            timer = null;
            if (attempts++ < 3 && !atTarget()) {
                timer = setTimeout(tick, Math.round(duration * 1000) + 150);
                return;
            }
            finish();
        }

        var handle = {
            to: toOpacity,   // чтобы повторный вызов не перезапускал ту же анимацию
            kill: function () {
                if (finished) return;
                finished = true;
                // Фиксируем текущее значение, иначе снятие transition доведёт
                // прозрачность до конечной — следующая анимация задаст своё
                var current = null;
                if (window.getComputedStyle) {
                    try { current = window.getComputedStyle(el).opacity; } catch (err) { current = null; }
                }
                if (current !== null && current !== '') el.style.opacity = current;
                el.style.transition = '';
                cleanup();
            }
        };

        el._fadeHandle = handle;

        // Начальное значение должно попасть в стиль до включения перехода,
        // иначе браузер сразу применит конечное. offsetWidth форсирует пересчёт.
        void el.offsetWidth;

        el.style.transition = 'opacity ' + duration + 's ' + (ease || 'ease');
        el.style.opacity = String(toOpacity);

        if (el.addEventListener) el.addEventListener('transitionend', onTransitionEnd, false);

        timer = setTimeout(tick, Math.round(duration * 1000) + 150);

        return handle;
    }


    // Оверлей «Загрузка…» создаём один раз и держим в body — не внутри
    // #detail-view: пока карточка проявляется, её opacity близка к нулю, и
    // вложенный индикатор был бы не виден именно тогда, когда он нужен.
    // z-index 120 — выше #detail-view (100) и ниже остальных оверлеев (200+).
    // Стили инлайном: css/styles.css не трогаем. inset не используем — Chrome 66 его не знает.
    // Спиннер и подпись — уже существующие классы из styles.css.
    function getDetailLoader(create) {
        if (detailLoaderEl && detailLoaderEl.parentNode) return detailLoaderEl;
        if (!create) return null;

        var host = document.body || getEl('detail-view');
        if (!host) return null;

        detailLoaderEl = document.createElement('div');
        detailLoaderEl.id = 'detail-loading';
        detailLoaderEl.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
            'display:none;flex-direction:column;align-items:center;justify-content:center;' +
            'background:rgba(0,0,0,0.75);z-index:120;opacity:0;pointer-events:none;';
        detailLoaderEl.innerHTML = '<div class="loading-spinner"></div>' +
            '<div class="loading-text">Загрузка...</div>';
        host.appendChild(detailLoaderEl);

        return detailLoaderEl;
    }

    function clearDetailLoaderTimers() {
        if (detailLoaderShowTimer) {
            clearTimeout(detailLoaderShowTimer);
            detailLoaderShowTimer = null;
        }
        if (detailLoaderMaxTimer) {
            clearTimeout(detailLoaderMaxTimer);
            detailLoaderMaxTimer = null;
        }
    }

    // Показ с задержкой: если содержимое уже в кэше и отрисовалось за пару кадров,
    // индикатор вообще не появится — мигать зря не нужно.
    function showDetailLoading() {
        clearDetailLoaderTimers();

        detailLoaderShowTimer = setTimeout(function () {
            detailLoaderShowTimer = null;

            var el = getDetailLoader(true);
            if (!el) return;

            el.style.display = 'flex';
            fadeElement(el, 1, DETAIL_FADE.loader, DETAIL_FADE.easeOut);
        }, DETAIL_FADE.loaderDelayMs);

        detailLoaderMaxTimer = setTimeout(function () {
            detailLoaderMaxTimer = null;
            hideDetailLoading();
        }, DETAIL_FADE.loaderMaxMs);
    }

    function hideDetailLoading(immediate) {
        clearDetailLoaderTimers();

        var el = getDetailLoader(false);
        if (!el) return;

        if (immediate) {
            stopFade(el);
            el.style.transition = '';
            el.style.opacity = '0';
            el.style.display = 'none';
            return;
        }

        fadeElement(el, 0, DETAIL_FADE.loader, DETAIL_FADE.easeIn, function () {
            el.style.display = 'none';
        });
    }

    // Прерываем незакончившееся закрытие: иначе оно доведёт opacity до нуля
    // и поставит display:none уже поверх нового открытия.
    function cancelDetailHide(detailView) {
        if (detailHideTween) {
            if (typeof detailHideTween.kill === 'function') detailHideTween.kill();
            detailHideTween = null;
        }
        if (detailView) stopFade(detailView);
        if (detailView && detailView.dataset) delete detailView.dataset.hiding;
    }

    function finishDetailHide(detailView, keepContent) {
        detailView.style.display = 'none';
        detailView.style.pointerEvents = 'none';
        if (detailView.dataset) delete detailView.dataset.hiding;

        // Готовим элемент к следующему открытию — он должен быть непрозрачным
        // и без перехода, чтобы новое открытие начиналось с чистого состояния
        detailView.style.transition = '';
        detailView.style.opacity = '1';
        clearTransform(detailView);

        // Фон карточки сбрасываем только теперь. Если делать это в момент нажатия
        // «назад» (как было в app.js), подложка пропадала до затухания — и закрытие
        // снова выглядело резким.
        //
        // keepContent — карточку прячут «на время»: она уже отрисована и ждёт
        // возврата (выход из деталей торрента в поиск торрентов, см.
        // finishSearchRestore в app.js). Чистить её в этом случае нельзя:
        // resetDetailBackground выгрызает заголовок, подзаголовок и ряд актёров,
        // и на возврате из поиска (hideSearchResults, ветка returnTo === 'detail')
        // показывалась половина карточки — описание, кнопки, фон и похожие есть,
        // остального нет.
        if (!keepContent && typeof window.resetDetailBackground === 'function') {
            try { window.resetDetailBackground(); } catch (e) { }
        }
    }

    // Анимация появления детального просмотра
    function animateDetailShow() {
        var detailView = getEl('detail-view');
        if (!detailView) return null;

        cancelDetailHide(detailView);

        detailView.style.display = 'block';
        detailView.style.zIndex = '100';
        detailView.style.pointerEvents = 'auto';

        // Убираем остатки прошлых анимаций (сдвиг/масштаб), прозрачность ведём
        // сами — CSS-переходом в fadeElement
        {
            clearTransform(detailView);
            detailView.style.backgroundColor = 'rgb(0, 0, 0)';
        }
        detailView.style.transition = '';
        detailView.style.opacity = '0';

        // «Загрузка…» — до вызова detailContentReady() из torrents.js / catalog.js
        showDetailLoading();

        return fadeElement(detailView, 1, DETAIL_FADE.show, DETAIL_FADE.easeOut);
    }

    // Содержимое отрисовано — снимаем индикатор
    function detailContentReady() {
        hideDetailLoading();

        // Страховка от полупрозрачного экрана: если появление уже не идёт
        // (переход снят или не стартовал), карточка обязана быть непрозрачной
        var detailView = getEl('detail-view');
        if (detailView && !detailView._fadeHandle && !detailHideTween &&
            detailView.style.display !== 'none') {
            detailView.style.transition = '';
            detailView.style.opacity = '1';
        }
    }

    /**
     * Мгновенно вернуть уже отрисованный detail-view (выход из плеера, закрытие
     * поиска). Без затухания и без «Загрузка…»: содержимое на месте, показывать
     * индикатор нечего. Главное — снять недоигранное закрытие, иначе экран
     * останется с opacity 0 или получит display:none поверх восстановления.
     */
    function ensureDetailVisible() {
        var detailView = getEl('detail-view');
        if (!detailView) return null;

        cancelDetailHide(detailView);
        hideDetailLoading(true);

        detailView.style.display = 'block';
        detailView.style.zIndex = '100';
        detailView.style.pointerEvents = 'auto';

        clearTransform(detailView);
        detailView.style.transition = '';
        detailView.style.opacity = '1';

        return detailView;
    }

    /**
     * Анимация скрытия детального просмотра.
     *
     * display:none ставит сама анимация, когда затухание закончится. Раньше
     * вызывающий код прятал элемент сразу, а animateDetailHide отрабатывал уже
     * по скрытому — поэтому закрытие было мгновенным.
     *
     * opts.keepContent — прячем «на время», содержимое карточки не чистим
     * (подробности в finishDetailHide).
     */
    function animateDetailHide(onDone, opts) {
        var keepContent = !!(opts && opts.keepContent);
        var detailView = getEl('detail-view');
        if (!detailView) {
            if (onDone) onDone();
            return null;
        }

        hideDetailLoading(true);

        // Закрытие уже идёт — второй вызов ничего не перезапускает
        if (detailHideTween) return detailHideTween;

        if (detailView.style.display === 'none' || !detailView.style.display) {
            // Уже скрыт (display ставит animateDetailShow, поэтому пустое значение
            // тоже означает «не показан») — анимировать нечего
            finishDetailHide(detailView, keepContent);
            if (onDone) onDone();
            return null;
        }

        // Для навигации экран уже «не существует» (control.js: _isScreenVisible),
        // хотя физически ещё виден: иначе нажатия пульта во время затухания уйдут
        // в detail, а не в список под ним.
        detailView.dataset.hiding = '1';
        detailView.style.pointerEvents = 'none';

        detailHideTween = fadeElement(detailView, 0, DETAIL_FADE.hide, DETAIL_FADE.easeIn, function () {
            detailHideTween = null;
            finishDetailHide(detailView, keepContent);
            if (onDone) onDone();
        });

        return detailHideTween;
    }

    // ==================== ПЛАВНОЕ ПОЯВЛЕНИЕ / ЗАТУХАНИЕ ЭКРАНОВ ====================
    // Тот же приём, что и у detail-view: CSS-переход считает композитор, поэтому
    // он доигрывает до конца, даже когда основной поток занят отрисовкой списков.
    var UI_FADE = {
        screen: 0.36,    // переключение вкладок «Каталог» / «Мои торренты»
        overlay: 0.2,    // оверлей поиска
        content: 0.24    // подмена содержимого (возврат из категории каталога в ряды)
    };

    // Элемент спрятан любым из принятых в проекте способов
    function isElementHidden(el) {
        if (!el) return true;
        if (el.hidden) return true;
        if (el.classList && el.classList.contains('hidden')) return true;
        if (el.style.display === 'none') return true;
        return false;
    }

    // Снять недоигранное затухание и вернуть элемент к «чистому» состоянию:
    // inline-прозрачность и переход убираем, дальше решает CSS
    function resetFade(el) {
        if (!el) return;
        stopFade(el);
        el.style.transition = '';
        el.style.opacity = '';
        if (el.dataset) delete el.dataset.hiding;
    }

    /**
     * Плавно показать элемент.
     * options: duration, ease, display (строка — будет выставлена в style.display),
     *          onDone.
     * Спрятанный элемент проявляется с нуля, уже видимый — с текущей прозрачности,
     * чтобы прерванное затухание не мигало.
     */
    function fadeIn(el, options) {
        if (!el) return null;
        options = options || {};

        // Уже проявляется — не перезапускаем (иначе повторный вызов дёрнет анимацию)
        if (!options.onDone && el._fadeHandle && el._fadeHandle.to === 1) return el._fadeHandle;

        var wasHidden = isElementHidden(el);
        stopFade(el);
        if (el.dataset) delete el.dataset.hiding;
        if (el.classList) el.classList.remove('hidden');
        if (el.hidden) el.hidden = false;
        if (typeof options.display === 'string') el.style.display = options.display;

        var from = 0;
        if (!wasHidden && window.getComputedStyle) {
            try { from = parseFloat(getComputedStyle(el).opacity); } catch (err) { from = 1; }
            if (isNaN(from)) from = 1;
        }

        if (from >= 0.999) {
            // Полностью видим — анимировать нечего
            el.style.transition = '';
            el.style.opacity = '';
            if (options.onDone) options.onDone();
            return null;
        }

        el.style.transition = '';
        el.style.opacity = String(from);

        var duration = typeof options.duration === 'number' ? options.duration : UI_FADE.screen;
        return fadeElement(el, 1, duration, options.ease || DETAIL_FADE.easeOut, function () {
            // Возвращаем управление CSS: inline opacity < 1 создаёт контекст наложения
            el.style.opacity = '';
            if (options.onDone) options.onDone();
        });
    }

    /**
     * Плавно скрыть элемент. По-настоящему прятать (display / hidden / .hidden)
     * можно только после затухания — display:none обрывает переход мгновенно.
     * options: duration, ease, display, addHidden, hiddenAttr, keepFaded, onDone.
     * keepFaded — оставить элемент на месте с прозрачностью 0: так в невидимую
     * сетку каталога можно записать новое содержимое и проявить её обратно.
     */
    function fadeOut(el, options) {
        options = options || {};

        function applyHidden() {
            if (!el) return;
            if (typeof options.display === 'string') el.style.display = options.display;
            if (options.addHidden && el.classList) el.classList.add('hidden');
            if (options.hiddenAttr) el.hidden = true;
            el.style.transition = '';
            if (!options.keepFaded) el.style.opacity = '';
            if (el.dataset) delete el.dataset.hiding;
        }

        if (!el || isElementHidden(el)) {
            if (el) { stopFade(el); applyHidden(); }
            if (options.onDone) options.onDone();
            return null;
        }

        // Для навигации элемент уже «не существует»: control.js (_isScreenVisible)
        // игнорирует dataset.hiding, иначе кнопки пульта уйдут в уходящий экран
        if (el.dataset) el.dataset.hiding = '1';

        var duration = typeof options.duration === 'number' ? options.duration : UI_FADE.screen;
        return fadeElement(el, 0, duration, options.ease || DETAIL_FADE.easeIn, function () {
            applyHidden();
            if (options.onDone) options.onDone();
        });
    }

    // Анимация загрузки (спиннер)

    // Анимация скрытия загрузки

    /* ==================== ПАНЕЛЬ УПРАВЛЕНИЯ ПЛЕЕРА ====================
     *
     * Последняя анимация, что оставалась на gsap. Переведена на CSS по той же
     * причине, что и затухание карточки (см. fadeElement): opacity и transform
     * браузер умеет крутить в композиторе, без главного потока. Панель как раз
     * появляется в момент, когда поток занят — плеер стартует, тянет манифест,
     * раскладывает элементы, — и анимация на gsap там дёргалась.
     *
     * Классы .controls-anim-hidden / .controls-anim-shown и переход по ним
     * лежат в styles.css. clearProps из gsap-версии не нужен: инлайновых
     * стилей мы не пишем вовсе.
     */
    function animateControlsShow() {
        var controls = getEl('controls-container');
        if (!controls) return;

        controls.classList.add('controls-anim');
        controls.classList.add('controls-anim-hidden');
        // Стартовое состояние должно попасть в стиль до включения перехода,
        // иначе браузер сразу применит конечное — тот же приём, что в fadeElement
        void controls.offsetWidth;
        controls.classList.remove('controls-anim-hidden');
    }

    function animateControlsHide() {
        var controls = getEl('controls-container');
        if (!controls) return;

        controls.classList.add('controls-anim');
        controls.classList.add('controls-anim-hidden');
    }

    // Анимация для кнопок

    // Анимация для файлов в детальном просмотре (горизонтальный скролл)

    // Анимация уведомления (хинта)

    // Анимация для панели серий/аудио

    // Анимация для панели (скрытие)

    // Анимация прогресс-бара

    // Анимация для постера при загрузке

    // Анимация для поисковой строки

    // Пульсирующая анимация для элемента

    // Анимация перехода между экранами

    // Обновление всех анимаций при изменении контента

    // Быстрая прокрутка элемента в зону видимости
    // Проверка, находится ли элемент полностью в зоне видимости контейнера
    function isElementInView(element, container) {
        if (!element) return false;

        var elRect = element.getBoundingClientRect();
        var containerRect = (container === window || !container)
            ? { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }
            : container.getBoundingClientRect();

        if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) return false;

        // По горизонтали проверяем только там, где контейнер реально прокручивается
        // (ряды каталога, горизонтальные списки актёров и т.п.). Для #main-container
        // с overflow-x: hidden scrollWidth === clientWidth, и проверка не включается —
        // прежнее поведение вертикальных списков не меняется.
        if (canScrollX(container)) {
            if (elRect.left < containerRect.left || elRect.right > containerRect.right) return false;
        }

        return true;
    }

    function canScrollX(el) {
        return !!el && el !== window && el.scrollWidth > el.clientWidth + 1;
    }

    function canScrollY(el) {
        return !!el && el !== window && el.scrollHeight > el.clientHeight + 1;
    }

    /* ==================== ТВИН ПРОКРУТКИ ====================
     *
     * Прокрутка — единственная анимация приложения, которой нужен точный
     * контроль над временем: от него зависит и скорость движения
     * (SCROLL_SMOOTH в control.js считает длительность из расстояния), и весь
     * пейсинг загрузки постеров, который ждёт ответа «доехали?». Поэтому здесь
     * свой маленький движок на requestAnimationFrame, а не gsap.
     *
     * Тянуть надо одно число — scrollTop или scrollLeft — по линейной кривой.
     * Это ровно `el.scrollTop = from + (to - from) * p`, и gsap с его разбором
     * свойств, плагинами и общим тикером на такую задачу не нужен. Взамен мы
     * получаем собственный признак «идёт прокрутка»: у gsap.isTweening он
     * залипал навсегда, если кадры переставали идти (приложение свернули, ТВ
     * ушёл в заставку), — незавершённый твин так и оставался «в полёте», а на
     * этом ответе висит вся придержка постеров. Здесь у каждого твина есть срок
     * по стенным часам, и просроченный больше не считается идущим.
     *
     * CSS-переходами это не заменить: scroll-behavior: smooth не даёт задать ни
     * длительность, ни кривую, распространяется и на мгновенные присваивания
     * позиции, а узнать его окончание нечем — scrollend появился только
     * в Chrome 114.
     */
    var scrollTweens = [];
    var scrollTweenRaf = 0;

    /** Индекс активного твина этого контейнера, -1 если его нет */
    function scrollTweenIndex(container) {
        for (var i = 0; i < scrollTweens.length; i++) {
            if (scrollTweens[i].el === container) return i;
        }
        return -1;
    }

    /** Снимает твин, оставляя позицию там, докуда доехали (перебивающий жест) */
    function stopScrollTween(container) {
        var i = scrollTweenIndex(container);
        if (i !== -1) scrollTweens.splice(i, 1);
    }

    /**
     * Идёт ли прокрутка контейнера.
     *
     * Просрочку (endAt) проверяем отдельно от самого факта наличия твина: если
     * кадры не идут, твин никуда не двигается и висит в списке, но движением
     * это уже не является — иначе постеры ждали бы его вечно.
     */
    function isScrollTweening(container) {
        var i = scrollTweenIndex(container);
        return i !== -1 && Date.now() < scrollTweens[i].endAt;
    }

    function scrollTweenStep(now) {
        scrollTweenRaf = 0;

        for (var i = scrollTweens.length - 1; i >= 0; i--) {
            var t = scrollTweens[i];

            // Первый кадр только засекает старт: между созданием твина и этим
            // кадром проходит неизвестное время (на слабом ТВ — десятки мс), и
            // отсчёт от момента создания съедал бы начало движения.
            if (!t.start) { t.start = now; continue; }

            var p = (now - t.start) / t.dur;
            if (p > 1) p = 1;

            for (var j = 0; j < t.props.length; j++) {
                var pr = t.props[j];
                // На финише присваиваем цель как есть: накопленная за кадры
                // дробная погрешность иначе оставляла бы контейнер в паре
                // пикселей от места, и проверки «уже на месте» не срабатывали
                t.el[pr.name] = (p === 1) ? pr.to : (pr.from + (pr.to - pr.from) * p);
            }

            if (p === 1 || !t.el.isConnected) scrollTweens.splice(i, 1);
        }

        if (scrollTweens.length) scrollTweenRaf = requestAnimationFrame(scrollTweenStep);
    }

    /**
     * Плавная прокрутка контейнера по scrollTop / scrollLeft.
     *
     * @param {Element} container контейнер с прокруткой
     * @param {Object}  vars      scrollTop и/или scrollLeft — цель в пикселях
     * @param {Object}  [options] duration в секундах (0 — мгновенно). Кривая
     *                            всегда линейная: скорость движения в приложении
     *                            единая, и любое торможение у цели её ломает.
     */
    function tweenScroll(container, vars, options) {
        if (!container || !vars) return;
        options = options || {};
        var duration = typeof options.duration === 'number' ? options.duration : 0.3;

        var hasTop = typeof vars.scrollTop === 'number';
        var hasLeft = typeof vars.scrollLeft === 'number';
        if (!hasTop && !hasLeft) return;

        // Новая цель отменяет прежнюю: движение продолжается с текущего места,
        // а не с начала прежнего пути
        stopScrollTween(container);

        if (duration <= 0 || typeof requestAnimationFrame !== 'function') {
            if (hasTop) {
                container.scrollTop = vars.scrollTop;
                container._navPendTop = null;
                container._navPendTopUntil = 0;
            }
            if (hasLeft) container.scrollLeft = vars.scrollLeft;
            return;
        }

        // Помечаем цель твина: пока он в полёте, getBoundingClientRect отдаёт
        // позицию «на полпути», и проверки видимости в control.js врут —
        // быстрые короткие нажатия то запускали прокрутку, то нет. Читается
        // через pendingScrollDelta (control.js).
        if (hasTop) {
            container._navPendTop = vars.scrollTop;
            container._navPendTopUntil = Date.now() + Math.round(duration * 1000) + 50;
        }

        var props = [];
        if (hasTop) props.push({ name: 'scrollTop', from: container.scrollTop, to: vars.scrollTop });
        if (hasLeft) props.push({ name: 'scrollLeft', from: container.scrollLeft, to: vars.scrollLeft });

        scrollTweens.push({
            el: container,
            props: props,
            start: 0,
            dur: duration * 1000,
            // Запас на кадр-другой: признак «идёт» не должен гаснуть раньше,
            // чем твин успеет доехать
            endAt: Date.now() + Math.round(duration * 1000) + 50
        });

        if (!scrollTweenRaf) scrollTweenRaf = requestAnimationFrame(scrollTweenStep);
    }

    // Проверка видимости и прокрутка к элементу, если он не виден
    function scrollToIfNotVisible(element, container, options) {
        if (!element) return;

        // Если элемент уже виден, прокрутка не требуется
        if (isElementInView(element, container)) {
            return;
        }

        options = options || {};
        // typeof, а не `||`: duration: 0 — это «мгновенно, без твана»
        // (быстрая навигация по пульту), и его нельзя подменять на 0.15
        var duration = typeof options.duration === 'number' ? options.duration : 0.15;
        var ease = options.ease || "power1.out";
        var offset = options.offset || 10;
        var direction = options.direction || null; //Добавляем параметр направления
        var targetContainer = container || window;

        if (targetContainer !== window && targetContainer.scrollTop !== undefined) {
            var rect = element.getBoundingClientRect();
            var containerRect = targetContainer.getBoundingClientRect();
            var vars = {};

            if (canScrollY(targetContainer)) {
                var targetTop;

                // Разная логика в зависимости от направления
                if (direction === 'down') {
                    // При навигации вниз - прижимаем элемент к НИЖНЕМУ краю
                    targetTop = targetContainer.scrollTop + (rect.bottom - containerRect.bottom) + offset;
                } else if (direction === 'up') {
                    // При навигации вверх - прижимаем элемент к ВЕРХНЕМУ краю
                    targetTop = targetContainer.scrollTop + (rect.top - containerRect.top) - offset;
                } else {
                    // По умолчанию - прижимаем к нижнему краю (старая логика)
                    targetTop = targetContainer.scrollTop + (rect.bottom - containerRect.bottom) + offset;
                }

                // Ограничиваем значения, чтобы не выйти за пределы скролла
                vars.scrollTop = Math.max(0, Math.min(targetContainer.scrollHeight - containerRect.height, targetTop));
            }

            // Горизонтальные списки (ряды каталога): раньше функция знала только про
            // вертикаль, а isElementInView для ряда всегда возвращал true — карточка
            // по вертикали внутри своего же viewport'а. Скролл ряда просто не работал.
            if (canScrollX(targetContainer)) {
                var targetLeft;
                if (direction === 'left') {
                    targetLeft = targetContainer.scrollLeft + (rect.left - containerRect.left) - offset;
                } else if (direction === 'right') {
                    targetLeft = targetContainer.scrollLeft + (rect.right - containerRect.right) + offset;
                } else {
                    targetLeft = targetContainer.scrollLeft + (rect.left - containerRect.left)
                        - (containerRect.width / 2) + (rect.width / 2);
                }
                vars.scrollLeft = Math.max(0, Math.min(targetContainer.scrollWidth - containerRect.width, targetLeft));
            }

            tweenScroll(targetContainer, vars, { duration: duration, ease: ease });
        } else {
            // Для окна браузера логика аналогичная
            var targetY;
            if (direction === 'down') {
                targetY = window.scrollY + (element.getBoundingClientRect().bottom - window.innerHeight) + offset;
            } else if (direction === 'up') {
                targetY = window.scrollY + element.getBoundingClientRect().top - offset;
            } else {
                targetY = window.scrollY + (element.getBoundingClientRect().bottom - window.innerHeight) + offset;
            }
            targetY = Math.max(0, targetY);

            // Раньше здесь был gsap.to(window, {scrollTo: {y}}) — это ScrollToPlugin,
            // которого больше нет. Тван по scrollTop корневого элемента даёт то же,
            // но обходится без плагина.
            var root = document.scrollingElement || document.documentElement;
            if (root) tweenScroll(root, { scrollTop: targetY }, { duration: duration, ease: ease });
            else window.scrollTo(0, targetY);
        }
    }

    // Публичное API
    return {
        // Регистрировать больше нечего: плагины gsap убраны из index.html давно,
        // а сам gsap в анимациях этого модуля почти не участвует. Метод оставлен
        // — его зовут снизу этого же файла на готовности DOM.
        init: function () { },

        // Основные анимации
        animateDetailShow: animateDetailShow,
        animateDetailHide: animateDetailHide,
        ensureDetailVisible: ensureDetailVisible,
        detailContentReady: detailContentReady,
        showDetailLoading: showDetailLoading,
        hideDetailLoading: hideDetailLoading,

        // Плавные переходы экранов: вкладки, оверлей поиска, подмена сетки каталога
        fadeIn: fadeIn,
        fadeOut: fadeOut,
        resetFade: resetFade,
        UI_FADE: UI_FADE,
        animateControlsShow: animateControlsShow,
        animateControlsHide: animateControlsHide,
        isElementInView: isElementInView,
        scrollToIfNotVisible: scrollToIfNotVisible,
        tweenScroll: tweenScroll,
        // Признак «идёт прокрутка» и снятие твина — вместо gsap.isTweening /
        // gsap.killTweensOf, которые больше не знают про прокрутку
        isScrollTweening: isScrollTweening,
        stopScrollTween: stopScrollTween,

        // Конфигурация
        config: config
    };
})();

// Автоматическая инициализация
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        Animations.init();
    });
} else {
    Animations.init();
}

// Делаем доступным глобально
window.Animations = Animations;
