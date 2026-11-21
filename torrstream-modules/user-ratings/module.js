// module.js — Оценки зрителей (user-ratings)
//
// Кнопки в карточке фильма/сериала: «Огонь», «Лайк», «Дизлайк», «Какашка».
// Оценки видят все, кто ходит на этот сервер; ставят только вошедшие в
// аккаунт (ctx.auth), один раз на фильм — передумать нельзя.
//
// Хранение — ctx.db (БД сервера, с TorrStream 1.0.66):
//   v:<type>:<id>:<userId>  → { r: 'fire', t: <время>[, txt] } голос (+ отзыв)
//   c:<type>:<id>           → { fire, like, dislike, poo } счётчики фильма
// Голос и счётчик пишутся в одной транзакции: «один раз» держит add() —
// второй голос того же пользователя не запишется, счётчик не сдвинется.
//
// Маршруты:
//   GET  /api/user-ratings?type=movie&id=550 → { success, counts, total,
//        score, rating, mine, signedIn }
//   POST /api/user-ratings  { type, id, rating } → то же после голоса;
//        401 login_required — не вошёл; 409 already_voted — уже голосовал
//   Сервер без ctx.db (до 1.0.66) → 501 server_update_required: фронт прячет
//   блок, как и при 404 (модуля нет).
//
// Оценка зрителей: score — сумма баллов (огонь +2, лайк +1, дизлайк −1,
// какашка −2), rating — она же по 10-балльной шкале с десятыми. Средний балл
// голоса (−2…+2) переводится линейно в 0…10: (score / total + 2) × 2,5 —
// одни «огни» 10.0, одни лайки 7.5, одни дизлайки 2.5, одни «какашки» 0.0.
// Голосов нет — rating: null. Фронт показывает её плашкой рядом с IMDb.
//
// Задел на отзывы: короткий текст лежит в том же голосе (поле txt), отдельной
// таблицы нет — один пользователь, один фильм, одна запись. Длина режется до
// REVIEW_MAX символов, чтобы база не росла. Пока REVIEWS_ENABLED = false,
// присланный review молча отбрасывается, и отзывы нигде не отдаются. Когда
// включим: POST принимает { review }, а для отзыва к уже поставленной оценке
// понадобится свой маршрут (голос менять нельзя, отзыв дописать — можно).

var RATINGS = ['fire', 'like', 'dislike', 'poo'];
var SCORE = { fire: 2, like: 1, dislike: -1, poo: -2 };
var REVIEWS_ENABLED = false;
var REVIEW_MAX = 300;

/**
 * Текст отзыва для записи: без управляющих символов и лишних пробелов, не
 * длиннее REVIEW_MAX. Пустой или выключенный — null (поле не пишется).
 */
function normalizeReview(text) {
    if (!REVIEWS_ENABLED || typeof text !== 'string') return null;
    var clean = text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!clean) return null;
    return clean.length > REVIEW_MAX ? clean.slice(0, REVIEW_MAX) : clean;
}

var db = null;
var auth = null;

function emptyCounts() {
    return { fire: 0, like: 0, dislike: 0, poo: 0 };
}

/** type и id из запроса: { type, id } или null */
function parseTarget(type, id) {
    type = String(type || '');
    id = String(id || '');
    if (type !== 'movie' && type !== 'tv') return null;
    if (!/^\d{1,10}$/.test(id)) return null;
    return { type: type, id: id };
}

function countsKey(t) {
    return 'c:' + t.type + ':' + t.id;
}

function voteKey(t, userId) {
    return 'v:' + t.type + ':' + t.id + ':' + userId;
}

function readCounts(t) {
    var stored = db.get(countsKey(t));
    var out = emptyCounts();
    if (stored) {
        for (var i = 0; i < RATINGS.length; i++) {
            var n = Number(stored[RATINGS[i]]);
            out[RATINGS[i]] = n > 0 ? Math.floor(n) : 0;
        }
    }
    return out;
}

function summary(t, user) {
    var counts = readCounts(t);
    var total = 0, score = 0;
    for (var i = 0; i < RATINGS.length; i++) {
        total += counts[RATINGS[i]];
        score += counts[RATINGS[i]] * SCORE[RATINGS[i]];
    }
    // Округление через целые: (score / total + 2) × 2,5 с десятыми
    var rating = total ? Math.round((score / total + 2) * 25) / 10 : null;
    var mine = null;
    if (user) {
        var vote = db.get(voteKey(t, user.id));
        if (vote && SCORE.hasOwnProperty(vote.r)) mine = vote.r;
    }
    return { success: true, counts: counts, total: total, score: score, rating: rating, mine: mine, signedIn: Boolean(user) };
}

/** Записать голос. true — записан, false — пользователь уже голосовал */
function castVote(t, user, rating, review) {
    var vote = { r: rating, t: Date.now() };
    if (review) vote.txt = review;
    return db.transaction(function () {
        if (!db.add(voteKey(t, user.id), vote)) return false;
        var counts = readCounts(t);
        counts[rating] += 1;
        db.set(countsKey(t), counts);
        return true;
    });
}

// ==================== МОДУЛЬ ====================

module.exports = {
    name: 'user-ratings',
    version: '1.0.1',

    init: function (app, ctx) {
        var log = ctx.log;
        db = ctx.db || null;
        auth = ctx.auth || null;

        function currentUser(req) {
            try { return auth ? auth.user(req) : null; } catch (e) { return null; }
        }

        function noStore(res) {
            return res.status(501).json({ success: false, code: 'server_update_required', error: 'Оценкам нужен сервер TorrStream 1.0.66 или новее' });
        }

        app.get('/api/user-ratings', function (req, res) {
            if (!db) return noStore(res);
            var t = parseTarget(req.query.type, req.query.id);
            if (!t) return res.status(400).json({ success: false, error: 'type: movie|tv, id: число' });
            try {
                res.json(summary(t, currentUser(req)));
            } catch (e) {
                log.error('чтение', t.type, t.id, e.message);
                res.status(500).json({ success: false, error: 'Оценки не прочитались' });
            }
        });

        app.post('/api/user-ratings', function (req, res) {
            if (!db) return noStore(res);
            var body = req.body || {};
            var t = parseTarget(body.type, body.id);
            if (!t) return res.status(400).json({ success: false, error: 'type: movie|tv, id: число' });
            var rating = String(body.rating || '');
            if (!SCORE.hasOwnProperty(rating)) return res.status(400).json({ success: false, error: 'rating: fire|like|dislike|poo' });
            var user = currentUser(req);
            if (!user) return res.status(401).json({ success: false, code: 'login_required', error: 'Оценки ставят только вошедшие в аккаунт' });
            try {
                if (!castVote(t, user, rating, normalizeReview(body.review))) {
                    var already = summary(t, user);
                    already.success = false;
                    already.code = 'already_voted';
                    already.error = 'Вы уже оценили';
                    return res.status(409).json(already);
                }
                res.json(summary(t, user));
            } catch (e) {
                log.error('голос', t.type, t.id, e.message);
                res.status(500).json({ success: false, error: 'Оценка не сохранилась' });
            }
        });

        log.log(db ? 'Оценки зрителей включены' : 'Оценки зрителей: у сервера нет ctx.db — нужен TorrStream 1.0.66+');
        return { ready: true };
    },

    destroy: function () {
        db = null;
        auth = null;
    }
};
