// animations.js - Анимации с использованием GSAP

var Animations = (function () {
    'use strict';

    // Конфигурация анимаций
    var config = {
        duration: {
            fast: 0.3,
            normal: 0.5,
            slow: 0.8
        },
        ease: {
            bounce: "back.out(1.2)",
            elastic: "elastic.out(1, 0.5)",
            smooth: "power2.out",
            soft: "sine.inOut"
        }
    };

    // Инициализация ScrollTrigger
    function initScrollTrigger() {
        if (typeof ScrollTrigger !== 'undefined') {
            gsap.registerPlugin(ScrollTrigger);
            console.log('✅ ScrollTrigger инициализирован');
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
            duration: 0.15,
            ease: config.ease.smooth,
            clearProps: "boxShadow" // очистит после потери фокуса
        });

        return null;
    }

    // Анимация появления детального просмотра
    function animateDetailShow() {
        var detailView = document.getElementById('detail-view');
        if (!detailView) return;

        // Сначала делаем видимым
        detailView.style.display = 'block';
        detailView.style.zIndex = '100';
        detailView.style.pointerEvents = 'auto';
        

        // Устанавливаем начальные значения
        gsap.set(detailView, {
            opacity: 0,
            scale: 0.95
        });

        var tl = gsap.timeline();

        tl.to(detailView, {
            opacity: 1,
            scale: 1,
            duration: config.duration.fast,
            ease: config.ease.smooth,
            //clearProps: "all"
        });

        // Анимация заголовка
        var title = detailView.querySelector('.detail-title');
        if (title) {
            gsap.set(title, { x: -30, opacity: 0 });
            tl.to(title, {
                x: 0,
                opacity: 1,
                duration: 0.4,
                ease: config.ease.smooth
            }, "-=0.2");
        }

        // Анимация постера
        var poster = detailView.querySelector('.detail-poster');
        if (poster) {
            gsap.set(poster, { scale: 0.9, opacity: 0 }); // Убрал rotation, уменьшил scale
            tl.to(poster, {
                scale: 1,
                opacity: 1,
                duration: 0.35,  // Чуть дольше
                ease: "back.out(0.4)"  // Мягкий вылет, почти незаметный
            }, "-=0.2");
        }

        return tl;
    }

    // Анимация скрытия детального просмотра
    function animateDetailHide() {
        var detailView = document.getElementById('detail-view');
        if (!detailView) return;

        return gsap.to(detailView, {
            opacity: 0,
            scale: 0.95,
            duration: config.duration.fast,
            ease: config.ease.smooth
        });
    }

    // Анимация загрузки (спиннер)
    function animateLoading(overlayId) {
        var overlay = document.getElementById(overlayId);
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
        var overlay = document.getElementById(overlayId);
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
        var controls = document.getElementById('controls-container');
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
        var controls = document.getElementById('controls-container');
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
        var filesList = document.getElementById('files-list');
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
        var hint = document.getElementById('player-hint');
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
        var fromEl = document.getElementById(fromScreen);
        var toEl = document.getElementById(toScreen);

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
        var torrentsGrid = document.getElementById('torrents-grid');
        if (torrentsGrid && torrentsGrid.children.length > 0) {
            animateCardsAppear('#torrents-grid', '.torrent-card');
        }

        // Анимация для каталога
        var catalogCards = document.querySelectorAll('.catalog-card, .catalog-folder-card');
        if (catalogCards.length > 0) {
            animateCardsAppear('#torrents-grid', '.catalog-card, .catalog-folder-card');
        }
    }

    function animateScrollTo(element, container, options) {
        if (!element || !container) return null;

        var defaults = {
            duration: 0.4,
            ease: "power2.out",
            offsetX: 0,
            offsetY: 0,
            smooth: true
        };

        var opts = Object.assign({}, defaults, options);

        // Определяем тип контейнера (горизонтальный или вертикальный)
        var isHorizontal = container.id === 'catalog-detail-actors' ||
            container.id === 'catalog-detail-recommendations' ||
            container.id === 'catalog-detail-trailers' ||
            container.id === 'files-list';

        var elementRect = element.getBoundingClientRect();
        var containerRect = container.getBoundingClientRect();

        if (isHorizontal) {
            // Горизонтальный скролл
            var targetScrollLeft = container.scrollLeft +
                (elementRect.left - containerRect.left) -
                (containerRect.width / 2) +
                (elementRect.width / 2) +
                opts.offsetX;

            targetScrollLeft = Math.max(0, Math.min(targetScrollLeft, container.scrollWidth - container.clientWidth));

            if (!opts.smooth) {
                container.scrollLeft = targetScrollLeft;
                return null;
            }

            // Используем GSAP для плавной анимации
            return gsap.to(container, {
                scrollLeft: targetScrollLeft,
                duration: opts.duration,
                ease: opts.ease,
                overwrite: true
            });

        } else {
            // Вертикальный скролл
            var targetScrollTop = 0;
            var needsScroll = false;

            // Проверяем, нужно ли скроллить
            if (elementRect.top < containerRect.top + 50) {
                targetScrollTop = container.scrollTop + (elementRect.top - containerRect.top) - 20 + opts.offsetY;
                needsScroll = true;
            } else if (elementRect.bottom > containerRect.bottom - 50) {
                targetScrollTop = container.scrollTop + (elementRect.bottom - containerRect.bottom) + 20 + opts.offsetY;
                needsScroll = true;
            }

            // Проверка горизонтальной видимости для inline элементов
            var needsInlineScroll = false;
            var targetScrollLeft = container.scrollLeft;

            if (elementRect.left < containerRect.left + 30) {
                targetScrollLeft = container.scrollLeft + (elementRect.left - containerRect.left) - 10;
                needsInlineScroll = true;
            } else if (elementRect.right > containerRect.right - 30) {
                targetScrollLeft = container.scrollLeft + (elementRect.right - containerRect.right) + 10;
                needsInlineScroll = true;
            }

            if (!needsScroll && !needsInlineScroll) return null;

            if (!opts.smooth) {
                if (needsScroll) container.scrollTop = Math.max(0, Math.min(targetScrollTop, container.scrollHeight - container.clientHeight));
                if (needsInlineScroll) container.scrollLeft = Math.max(0, Math.min(targetScrollLeft, container.scrollWidth - container.clientWidth));
                return null;
            }

            // Создаем таймлайн для одновременной анимации обоих направлений
            var tl = gsap.timeline();

            if (needsScroll) {
                targetScrollTop = Math.max(0, Math.min(targetScrollTop, container.scrollHeight - container.clientHeight));
                tl.to(container, {
                    scrollTop: targetScrollTop,
                    duration: opts.duration,
                    ease: opts.ease,
                    overwrite: true
                }, 0);
            }

            if (needsInlineScroll) {
                targetScrollLeft = Math.max(0, Math.min(targetScrollLeft, container.scrollWidth - container.clientWidth));
                tl.to(container, {
                    scrollLeft: targetScrollLeft,
                    duration: opts.duration,
                    ease: opts.ease,
                    overwrite: true
                }, 0);
            }

            return tl;
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
        animateScrollTo: animateScrollTo,

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
