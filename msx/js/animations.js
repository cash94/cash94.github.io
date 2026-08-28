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
    function initScrollTrigger() {
        if (typeof gsap === 'undefined' || !gsap.registerPlugin) return;
        if (typeof ScrollTrigger !== 'undefined') {
            gsap.registerPlugin(ScrollTrigger);
            console.log('✅ ScrollTrigger инициализирован');
        }
        if (typeof ScrollToPlugin !== 'undefined') {
            gsap.registerPlugin(ScrollToPlugin);
        }
    }

    // Анимация появления карточек при загрузке
    function animateCardsAppear(containerSelector, cardSelector) {
        var cards = document.querySelectorAll(cardSelector);
        if (!cards.length) return;

        // Скрываем карточки перед анимацией
        gsap.set(cards, {
            opacity: 0,
            y: 30,
            scale: 0.95
        });

        // Анимируем появление с задержкой
        gsap.to(cards, {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: config.duration.normal,
            ease: config.ease.smooth,
            stagger: {
                amount: 0.3,
                from: "start"
            },
            delay: 0.1
        });
    }

    // Анимация карточки при наведении (для мыши)
    function addCardHoverAnimation(cardSelector) {
        var cards = document.querySelectorAll(cardSelector);

        cards.forEach(function (card) {
            card.addEventListener('mouseenter', function () {
                gsap.to(card, {
                    scale: 1.03,
                    y: -5,
                    duration: config.duration.fast,
                    ease: config.ease.smooth,
                    boxShadow: "0 10px 30px rgba(0,0,0,0.3)"
                });
            });

            card.addEventListener('mouseleave', function () {
                gsap.to(card, {
                    scale: 1,
                    y: 0,
                    duration: config.duration.fast,
                    ease: config.ease.smooth,
                    boxShadow: "none"
                });
            });
        });
    }

    // Анимация для фокуса (TV пульт)
    function animateFocus(element) {
        if (!element) return;

        // Останавливаем текущие анимации
        gsap.killTweensOf(element);

        // Только рамка, без изменения размера
        gsap.to(element, {
            boxShadow: "0 0 0 3px #ff8c00, 0 0 0 6px rgba(255,140,0,0.3)",
            ease: config.ease.smooth,
            clearProps: "boxShadow" // очистит после потери фокуса
        });

        return null;
    }

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

        // Остатки прежних анимаций на этом элементе
        if (typeof gsap !== 'undefined') gsap.killTweensOf(el);
        stopFade(el);

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
            if (typeof gsap !== 'undefined') gsap.killTweensOf(el);
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

    function finishDetailHide(detailView) {
        detailView.style.display = 'none';
        detailView.style.pointerEvents = 'none';
        if (detailView.dataset) delete detailView.dataset.hiding;

        // Готовим элемент к следующему открытию — он должен быть непрозрачным
        // и без перехода, чтобы новое открытие начиналось с чистого состояния
        detailView.style.transition = '';
        detailView.style.opacity = '1';
        if (typeof gsap !== 'undefined') gsap.set(detailView, { y: 0, scale: 1 });

        // Фон карточки сбрасываем только теперь. Если делать это в момент нажатия
        // «назад» (как было в app.js), подложка пропадала до затухания — и закрытие
        // снова выглядело резким.
        if (typeof window.resetDetailBackground === 'function') {
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

        // Убираем остатки прошлых анимаций (сдвиг/масштаб от gsap), прозрачность
        // ведём сами — CSS-переходом в fadeElement
        if (typeof gsap !== 'undefined') {
            gsap.killTweensOf(detailView);
            gsap.set(detailView, {
                y: 0,
                scale: 1,
                backgroundColor: 'rgb(0, 0, 0)',
                force3D: false
            });
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

        if (typeof gsap !== 'undefined') {
            gsap.killTweensOf(detailView);
            gsap.set(detailView, { y: 0, scale: 1, force3D: false });
        }
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
     */
    function animateDetailHide(onDone) {
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
            finishDetailHide(detailView);
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
            finishDetailHide(detailView);
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
    function animateLoading(overlayId) {
        var overlay = getEl(overlayId);
        if (!overlay) return;

        var spinner = overlay.querySelector('.loading-spinner, .playback-spinner, .loading-player-spinner');
        if (!spinner) return;

        // Бесконечная анимация вращения
        gsap.to(spinner, {
            rotation: 360,
            duration: 1,
            repeat: -1,
            ease: "none",
            transformOrigin: "center center"
        });

        // Анимация появления оверлея
        gsap.fromTo(overlay,
            { opacity: 0, autoAlpha: 0 },
            { opacity: 1, autoAlpha: 1, duration: 0.2, display: "flex" }
        );
    }

    // Анимация скрытия загрузки
    function animateLoadingHide(overlayId) {
        var overlay = getEl(overlayId);
        if (!overlay) return;

        return gsap.to(overlay, {
            opacity: 0,
            autoAlpha: 0,
            duration: 0.2,
            onComplete: function () {
                overlay.style.display = 'none';
            }
        });
    }

    // Анимация для элементов управления плеера
    function animateControlsShow() {
        var controls = getEl('controls-container');
        if (!controls) return;

        gsap.killTweensOf(controls);

        gsap.fromTo(controls,
            { opacity: 0, y: 20 },
            {
                opacity: 1,
                y: 0,
                duration: 0.3,
                ease: config.ease.smooth,
                clearProps: "all"
            }
        );
    }

    // Анимация для элементов управления плеера (скрытие)
    function animateControlsHide() {
        var controls = getEl('controls-container');
        if (!controls) return;

        gsap.to(controls, {
            opacity: 0,
            y: 20,
            duration: 0.3,
            ease: config.ease.smooth
        });
    }

    // Анимация для кнопок
    function animateButtonPress(button) {
        if (!button) return;

        gsap.to(button, {
            scale: 0.95,
            duration: 0.1,
            ease: "power1.in",
            yoyo: true,
            repeat: 1
        });
    }

    // Анимация для файлов в детальном просмотре (горизонтальный скролл)
    function animateFilesList() {
        var filesList = getEl('files-list');
        if (!filesList) return;

        var files = filesList.querySelectorAll('.file-item');

        gsap.fromTo(files,
            { opacity: 0, x: 50, scale: 0.9 },
            {
                opacity: 1,
                x: 0,
                scale: 1,
                duration: config.duration.normal,
                stagger: 0.05,
                ease: config.ease.smooth
            }
        );
    }

    // Анимация уведомления (хинта)
    function animateHint(message, duration) {
        if (duration === undefined) duration = 2000;
        var hint = getEl('player-hint');
        if (!hint) return;

        hint.textContent = message;

        gsap.killTweensOf(hint);

        gsap.fromTo(hint,
            { opacity: 0, y: 20 },
            {
                opacity: 1,
                y: 0,
                duration: 0.3,
                ease: config.ease.smooth,
                onComplete: function () {
                    gsap.to(hint, {
                        opacity: 0,
                        y: -20,
                        duration: 0.3,
                        delay: (duration - 400) / 1000,
                        ease: config.ease.smooth
                    });
                }
            }
        );
    }

    // Анимация для панели серий/аудио
    function animatePanelShow(panel) {
        if (!panel) return;

        gsap.killTweensOf(panel);

        gsap.fromTo(panel,
            { opacity: 0, scale: 0.9, y: 20 },
            {
                opacity: 1,
                scale: 1,
                y: 0,
                duration: 0.25,
                ease: config.ease.elastic,
                clearProps: "all"
            }
        );
    }

    // Анимация для панели (скрытие)
    function animatePanelHide(panel) {
        if (!panel) return;

        gsap.to(panel, {
            opacity: 0,
            scale: 0.9,
            y: 20,
            duration: 0.2,
            ease: config.ease.smooth
        });
    }

    // Анимация прогресс-бара
    function animateProgressBar(element, targetPercent, duration) {
        if (duration === undefined) duration = 0.5;
        if (!element) return;

        gsap.to(element, {
            width: targetPercent + '%',
            duration: duration,
            ease: config.ease.smooth
        });
    }

    // Анимация для постера при загрузке
    function animatePosterLoad(posterElement, imageUrl) {
        if (!posterElement) return;

        // Создаем временное изображение для предзагрузки
        var tempImg = new Image();
        tempImg.onload = function () {
            gsap.to(posterElement, {
                opacity: 0,
                duration: 0.1,
                onComplete: function () {
                    posterElement.innerHTML = '<img src="' + imageUrl + '" style="width:100%;height:100%;object-fit:cover;">';
                    gsap.fromTo(posterElement,
                        { opacity: 0, scale: 0.95 },
                        { opacity: 1, scale: 1, duration: 0.4, ease: config.ease.elastic }
                    );
                }
            });
        };
        tempImg.src = imageUrl;
    }

    // Анимация для поисковой строки
    function animateSearchFocus(inputElement) {
        if (!inputElement) return;

        gsap.to(inputElement, {
            boxShadow: "0 0 0 2px #4a9eff, 0 0 0 4px rgba(74,158,255,0.3)",
            duration: 0.2,
            yoyo: true,
            repeat: 1
        });
    }

    // Пульсирующая анимация для элемента
    function animatePulse(element, repeatCount) {
        if (repeatCount === undefined) repeatCount = 3;
        if (!element) return;

        gsap.to(element, {
            scale: 1.05,
            duration: 0.3,
            repeat: repeatCount,
            yoyo: true,
            ease: "power1.inOut"
        });
    }

    // Анимация перехода между экранами
    function animateScreenTransition(fromScreen, toScreen, onComplete) {
        var fromEl = getEl(fromScreen);
        var toEl = getEl(toScreen);

        if (!fromEl || !toEl) {
            if (onComplete) onComplete();
            return;
        }

        var tl = gsap.timeline({
            onComplete: onComplete
        });

        tl.to(fromEl, {
            opacity: 0,
            scale: 0.95,
            duration: 0.2,
            ease: config.ease.smooth,
            onComplete: function () {
                fromEl.style.display = 'none';
            }
        });

        tl.set(toEl, { display: 'block', opacity: 0, scale: 0.95 });
        tl.to(toEl, {
            opacity: 1,
            scale: 1,
            duration: 0.3,
            ease: config.ease.elastic
        });

        return tl;
    }

    // Обновление всех анимаций при изменении контента
    function refreshAnimations() {
        // Анимация для сетки торрентов
        var torrentsGrid = getEl('torrents-grid');
        if (torrentsGrid && torrentsGrid.children.length > 0) {
            animateCardsAppear('#torrents-grid', '.torrent-card');
        }

        // Анимация для каталога
        var catalogCards = document.querySelectorAll('#catalog-grid .catalog-card, #catalog-grid .catalog-folder-card');
        if (catalogCards.length > 0) {
            animateCardsAppear('#catalog-grid', '.catalog-card, .catalog-folder-card');
        }
    }

    // Быстрая прокрутка элемента в зону видимости
    function quickScrollTo(element, container, options) {
        if (!element) return;
        options = options || {};
        var duration = options.duration || 0.2;
        var ease = options.ease || "power2.out";
        var offset = options.offset || 0;

        if (container && container.scrollTop !== undefined) {
            var rect = element.getBoundingClientRect();
            var containerRect = container.getBoundingClientRect();
            var targetTop = container.scrollTop + (rect.top - containerRect.top) - offset;
            targetTop = Math.max(0, Math.min(container.scrollHeight - containerRect.height, targetTop));

            tweenScroll(container, { scrollTop: targetTop }, { duration: duration, ease: ease });
        } else if (container === window || !container) {
            var targetY = window.scrollY + element.getBoundingClientRect().top - offset;
            targetY = Math.max(0, targetY);

            // Без ScrollToPlugin окно тянем через scrollTop корневого элемента
            var root = document.scrollingElement || document.documentElement;
            if (root) tweenScroll(root, { scrollTop: targetY }, { duration: duration, ease: ease });
            else window.scrollTo(0, targetY);
        }
    }
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

    /**
     * Плавная прокрутка контейнера тваном по scrollTop / scrollLeft.
     *
     * ScrollToPlugin для этого не нужен: gsap тянет scrollTop и scrollLeft как любое
     * числовое свойство DOM-элемента. Плагин (вместе с ScrollTrigger и EasePack) убран
     * из index.html — он тормозил прокрутку, — поэтому весь плавный скролл приложения
     * идёт через эту функцию.
     *
     * @param {Element} container контейнер с прокруткой
     * @param {Object}  vars      свойства для твана: scrollTop / scrollLeft
     *                            (можно добавить любые gsap-свойства, например backgroundColor)
     * @param {Object}  [options] duration в секундах (0 или отсутствие gsap — мгновенно), ease
     */
    function tweenScroll(container, vars, options) {
        if (!container || !vars) return;
        options = options || {};
        var duration = typeof options.duration === 'number' ? options.duration : 0.3;
        var ease = options.ease || 'power1.out';

        if (typeof gsap === 'undefined' || duration <= 0) {
            // Мгновенно: остальные свойства (тот же backgroundColor) без твана не нужны
            if (typeof vars.scrollTop === 'number') {
                container.scrollTop = vars.scrollTop;
                container._navPendTop = null;
                container._navPendTopUntil = 0;
            }
            if (typeof vars.scrollLeft === 'number') container.scrollLeft = vars.scrollLeft;
            return;
        }

        // Помечаем цель твина: пока он в полёте, getBoundingClientRect отдаёт
        // позицию «на полпути», и проверки видимости в control.js врут —
        // быстрые короткие нажатия то запускали прокрутку, то нет. Читается
        // через pendingScrollDelta (control.js).
        if (typeof vars.scrollTop === 'number') {
            container._navPendTop = vars.scrollTop;
            container._navPendTopUntil = Date.now() + Math.round(duration * 1000) + 50;
        }

        gsap.killTweensOf(container);

        var tween = {};
        for (var k in vars) {
            if (Object.prototype.hasOwnProperty.call(vars, k)) tween[k] = vars[k];
        }
        tween.duration = duration;
        tween.ease = ease;
        tween.overwrite = true;
        gsap.to(container, tween);
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
        init: function () {
            initScrollTrigger();
            console.log('🎬 GSAP анимации инициализированы');
        },

        // Основные анимации
        animateCardsAppear: animateCardsAppear,
        addCardHoverAnimation: addCardHoverAnimation,
        animateFocus: animateFocus,
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

        animateLoading: animateLoading,
        animateLoadingHide: animateLoadingHide,
        animateControlsShow: animateControlsShow,
        animateControlsHide: animateControlsHide,
        animateButtonPress: animateButtonPress,
        animateFilesList: animateFilesList,
        animateHint: animateHint,
        animatePanelShow: animatePanelShow,
        animatePanelHide: animatePanelHide,
        animateProgressBar: animateProgressBar,
        animatePosterLoad: animatePosterLoad,
        animateSearchFocus: animateSearchFocus,
        animatePulse: animatePulse,
        animateScreenTransition: animateScreenTransition,
        refreshAnimations: refreshAnimations,
        quickScrollTo: quickScrollTo,
        isElementInView: isElementInView,
        scrollToIfNotVisible: scrollToIfNotVisible,
        tweenScroll: tweenScroll,

        // Конфигурация
        config: config,

        // GSAP объект для прямого доступа
        gsap: gsap
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
