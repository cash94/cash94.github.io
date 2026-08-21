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

    // Анимация появления детального просмотра
    function animateDetailShow() {
        var detailView = getEl('detail-view');
        if (!detailView) return;

        // Убиваем все предыдущие анимации на этом элементе
        gsap.killTweensOf(detailView);

        detailView.style.display = 'block';
        detailView.style.zIndex = '100';
        detailView.style.pointerEvents = 'auto';

        // Сбрасываем свойства до начальных
        gsap.set(detailView, {
            opacity: 1,
            y: 0,
            scale: 1,
            backgroundColor: 'rgb(0, 0, 0)',
            force3D: false
        });

        // Ждем следующего кадра для применения стилей
        requestAnimationFrame(function () {
            var tl = gsap.timeline({
                defaults: {
                    duration: 0.5,
                    opacity: 1,
                    backgroundColor: 'rgb(0, 0, 0)',
                    ease: "power1.out"
                }
            });

            tl.to(detailView, {
                opacity: 1,
                backgroundColor: 'rgb(0, 0, 0)',
                y: 0,
                scale: 1,
                duration: 0.35
            }, 0);

            return tl;
        });
    }

    // Анимация скрытия детального просмотра
    function animateDetailHide() {
        var detailView = getEl('detail-view');
        if (!detailView) return;

        return gsap.to(detailView, {
            opacity: 0,
            scale: 0.95,
            duration: 0.5,
            ease: "power1.out"
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
            if (typeof vars.scrollTop === 'number') container.scrollTop = vars.scrollTop;
            if (typeof vars.scrollLeft === 'number') container.scrollLeft = vars.scrollLeft;
            return;
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
        var duration = options.duration || 0.15;
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
