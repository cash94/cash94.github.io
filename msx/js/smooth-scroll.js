// smooth-scroll.js - Плавный скролл с оптимизацией для слабых устройств

var SmoothScroll = (function () {
    'use strict';

    // Конфигурация
    var config = {
        enabled: true,
        duration: 0.4,          // длительность анимации (сек)
        easing: "power2.out",   // easing для GSAP
        wheelMultiplier: 1,     // множитель скорости колеса
        touchMultiplier: 1.2,   // множитель для тач-устройств
        maxScrollSpeed: 800,    // максимальная скорость скролла (пикселей в сек)
        minScrollDelta: 10,     // минимальная дельта для обработки
        passiveEvents: true,    // использовать passive события
        performanceMode: true   // режим производительности
    };

    // Состояние
    var activeScrollers = new Map();    // {element: {scrollTop, animating}}
    var wheelHandlerAttached = false;
    var performanceCheck = null;
    var lowPerformanceMode = false;

    // Проверка производительности устройства
    function checkPerformance() {
        if (!config.performanceMode) return;

        // Проверяем FPS через requestAnimationFrame
        var frames = 0;
        var lastTime = performance.now();

        function testFrame() {
            frames++;
            var now = performance.now();
            if (now - lastTime >= 1000) {
                var fps = frames;
                lowPerformanceMode = fps < 30;

                if (lowPerformanceMode) {
                    config.duration = 0.25;
                    config.easing = "linear";
                    console.log('📱 Низкая производительность, уменьшена длительность анимаций');
                }
                return;
            }
            requestAnimationFrame(testFrame);
        }

        requestAnimationFrame(testFrame);
    }

    // Получить скроллируемый элемент
    function getScrollableElement(target) {
        // Проверяем элемент на скроллируемость
        if (!target || target === document.body || target === document.documentElement) {
            return window;
        }

        var style = window.getComputedStyle(target);
        var overflowY = style.overflowY;
        var canScroll = (overflowY === 'auto' || overflowY === 'scroll') &&
            target.scrollHeight > target.clientHeight;

        if (canScroll) return target;

        // Ищем родителя
        return getScrollableElement(target.parentElement);
    }

    // Остановка текущей анимации
    function killScrollAnimation(element) {
        var scroller = activeScrollers.get(element);
        if (scroller && scroller.animation) {
            scroller.animation.kill();
            scroller.animation = null;
        }
        if (scroller) {
            scroller.animating = false;
        }
    }

    // Плавная прокрутка
    function smoothScrollTo(element, targetScrollTop, onComplete) {
        if (!element) return;

        // Если элемент - window, используем document.documentElement
        var scrollElement = (element === window) ? document.documentElement : element;
        var currentScroll = (element === window) ? window.scrollY : element.scrollTop;

        // Проверяем разницу
        var delta = targetScrollTop - currentScroll;
        if (Math.abs(delta) < config.minScrollDelta) {
            if (onComplete) onComplete();
            return;
        }

        // Ограничиваем максимальную скорость
        var maxDelta = config.maxScrollSpeed * config.duration;
        if (Math.abs(delta) > maxDelta) {
            targetScrollTop = currentScroll + (delta > 0 ? maxDelta : -maxDelta);
        }

        // Ограничиваем границы
        var maxScroll = (element === window)
            ? document.documentElement.scrollHeight - window.innerHeight
            : element.scrollHeight - element.clientHeight;
        targetScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));

        // Останавливаем текущую анимацию
        killScrollAnimation(element);

        // В low performance режиме используем родной скролл
        if (lowPerformanceMode && Math.abs(delta) > 200) {
            if (element === window) {
                window.scrollTo(0, targetScrollTop);
            } else {
                element.scrollTop = targetScrollTop;
            }
            if (onComplete) onComplete();
            return;
        }

        // Создаем анимацию
        var animation = gsap.to(scrollElement, {
            scrollTop: targetScrollTop,
            duration: config.duration,
            ease: config.easing,
            overwrite: true,
            onUpdate: function () {
                // Синхронизируем scrollTop для window
                if (element === window) {
                    window.scrollTo(0, scrollElement.scrollTop);
                }
            },
            onComplete: function () {
                var scroller = activeScrollers.get(element);
                if (scroller) {
                    scroller.animating = false;
                    scroller.animation = null;
                }
                if (onComplete) onComplete();
            }
        });

        activeScrollers.set(element, {
            animation: animation,
            animating: true
        });
    }

    // Обработчик колесика мыши
    function onWheel(e) {
        if (!config.enabled) return;

        var target = e.target;
        var scrollable = getScrollableElement(target);

        // Определяем дельту
        var deltaY = e.deltaY;
        if (e.deltaMode === 1) { // LINE
            deltaY *= 30;
        } else if (e.deltaMode === 2) { // PAGE
            deltaY *= (scrollable === window ? window.innerHeight : scrollable.clientHeight);
        }

        // Применяем множители
        deltaY *= config.wheelMultiplier;

        if (Math.abs(deltaY) < config.minScrollDelta) return;

        // Получаем текущую позицию
        var currentScroll = (scrollable === window) ? window.scrollY : scrollable.scrollTop;
        var targetScroll = currentScroll + deltaY;

        // Ограничиваем
        var maxScroll = (scrollable === window)
            ? document.documentElement.scrollHeight - window.innerHeight
            : scrollable.scrollHeight - scrollable.clientHeight;
        targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));

        // Плавная прокрутка
        smoothScrollTo(scrollable, targetScroll);

        // Предотвращаем стандартное поведение
        if (e.cancelable) {
            e.preventDefault();
        }
    }

    // Обработчик для тач-устройств (с инерцией)
    var touchStartY = 0;
    var touchStartTime = 0;
    var touchVelocity = 0;
    var touchScrolling = false;
    var touchScrollable = null;

    function onTouchStart(e) {
        if (!config.enabled) return;

        var touch = e.touches[0];
        touchStartY = touch.clientY;
        touchStartTime = Date.now();
        touchVelocity = 0;

        var target = e.target;
        touchScrollable = getScrollableElement(target);

        // Останавливаем текущую анимацию
        killScrollAnimation(touchScrollable);
    }

    function onTouchMove(e) {
        if (!config.enabled || !touchScrollable) return;

        var touch = e.touches[0];
        var deltaY = (touchStartY - touch.clientY) * config.touchMultiplier;

        if (Math.abs(deltaY) < 5) return;

        touchScrolling = true;

        // Вычисляем скорость
        var now = Date.now();
        var timeDelta = Math.max(16, now - touchStartTime);
        touchVelocity = deltaY / timeDelta;

        // Применяем прокрутку
        var currentScroll = (touchScrollable === window) ? window.scrollY : touchScrollable.scrollTop;
        var targetScroll = currentScroll + deltaY;

        var maxScroll = (touchScrollable === window)
            ? document.documentElement.scrollHeight - window.innerHeight
            : touchScrollable.scrollHeight - touchScrollable.clientHeight;
        targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));

        if (touchScrollable === window) {
            window.scrollTo(0, targetScroll);
        } else {
            touchScrollable.scrollTop = targetScroll;
        }

        touchStartY = touch.clientY;
        touchStartTime = now;

        if (e.cancelable) {
            e.preventDefault();
        }
    }

    function onTouchEnd(e) {
        if (!config.enabled || !touchScrolling) {
            touchScrolling = false;
            return;
        }

        touchScrolling = false;

        // Инерция
        var velocity = Math.min(3, Math.abs(touchVelocity)) * 800;
        if (velocity > 50 && touchScrollable) {
            var currentScroll = (touchScrollable === window) ? window.scrollY : touchScrollable.scrollTop;
            var direction = touchVelocity > 0 ? 1 : -1;
            var targetScroll = currentScroll + (velocity * direction);

            var maxScroll = (touchScrollable === window)
                ? document.documentElement.scrollHeight - window.innerHeight
                : touchScrollable.scrollHeight - touchScrollable.clientHeight;
            targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));

            smoothScrollTo(touchScrollable, targetScroll);
        }

        touchScrollable = null;
        touchVelocity = 0;
    }

    // Инициализация скролла для элемента
    function initScrollForElement(element) {
        if (!element || element._smoothScrollInited) return;
        element._smoothScrollInited = true;

        // Для горизонтальных контейнеров
        if (element.classList && (
            element.classList.contains('files-list') ||
            element.classList.contains('catalog-detail-actors-grid') ||
            element.classList.contains('catalog-detail-recommendations-grid')
        )) {
            initHorizontalScroll(element);
        }
    }

    // Горизонтальный скролл
    function initHorizontalScroll(element) {
        var isHorizontal = true;

        function onWheelHorizontal(e) {
            if (!config.enabled) return;

            var deltaX = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;

            if (Math.abs(deltaX) < config.minScrollDelta) return;

            var currentScroll = element.scrollLeft;
            var targetScroll = currentScroll + deltaX;
            var maxScroll = element.scrollWidth - element.clientWidth;
            targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));

            // Используем GSAP для плавности
            gsap.to(element, {
                scrollLeft: targetScroll,
                duration: lowPerformanceMode ? 0.2 : config.duration,
                ease: lowPerformanceMode ? "linear" : config.easing,
                overwrite: true
            });

            if (e.cancelable) {
                e.preventDefault();
            }
        }

        element.addEventListener('wheel', onWheelHorizontal, { passive: false });
        element._smoothScrollCleanup = function () {
            element.removeEventListener('wheel', onWheelHorizontal);
        };
    }

    // Наблюдатель за новыми элементами
    var observer = null;

    function initMutationObserver() {
        if (observer) return;

        observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.nodeType === 1) { // Element
                        // Проверяем сам элемент
                        if (node.classList && (
                            node.classList.contains('files-list') ||
                            node.classList.contains('catalog-detail-actors') ||
                            node.classList.contains('catalog-detail-recommendations') ||
                            node.classList.contains('catalog-detail-trailers')
                        )) {
                            initScrollForElement(node);
                        }
                        // Проверяем дочерние элементы
                        var children = node.querySelectorAll('.files-list, .catalog-detail-actors-grid, .catalog-detail-recommendations-grid');
                        children.forEach(initScrollForElement);
                    }
                });
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Обновление всех скроллов
    function refresh() {
        var containers = document.querySelectorAll(
            '.files-list, ' +
            '.catalog-detail-actors-grid, ' +
            '.catalog-detail-recommendations-grid, ' +
            '#detail-view, ' +
            '#main-container, ' +
            '#search-results, ' +
            '#torrents-grid'
        );

        containers.forEach(initScrollForElement);
    }

    // Включение/выключение
    function enable() {
        config.enabled = true;
        if (!wheelHandlerAttached) {
            window.addEventListener('wheel', onWheel, { passive: false });
            window.addEventListener('touchstart', onTouchStart, { passive: false });
            window.addEventListener('touchmove', onTouchMove, { passive: false });
            window.addEventListener('touchend', onTouchEnd);
            wheelHandlerAttached = true;
        }
    }

    function disable() {
        config.enabled = false;
        if (wheelHandlerAttached) {
            window.removeEventListener('wheel', onWheel);
            window.removeEventListener('touchstart', onTouchStart);
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', onTouchEnd);
            wheelHandlerAttached = false;
        }

        // Очищаем все анимации
        activeScrollers.forEach(function (scroller, element) {
            killScrollAnimation(element);
        });
        activeScrollers.clear();
    }

    // Настройка конфигурации
    function setConfig(newConfig) {
        Object.assign(config, newConfig);

        if (lowPerformanceMode) {
            config.duration = 0.25;
            config.easing = "linear";
        }
    }

    // Инициализация
    function init() {
        checkPerformance();
        enable();
        initMutationObserver();
        setTimeout(refresh, 500);
        console.log('✨ Плавный скролл инициализирован' + (lowPerformanceMode ? ' (режим производительности)' : ''));
    }

    // Публичное API
    return {
        init: init,
        enable: enable,
        disable: disable,
        refresh: refresh,
        setConfig: setConfig,
        smoothScrollTo: smoothScrollTo,
        isLowPerformance: function () { return lowPerformanceMode; }
    };
})();

// Автоматическая инициализация
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        SmoothScroll.init();
    });
} else {
    SmoothScroll.init();
}

window.SmoothScroll = SmoothScroll;
