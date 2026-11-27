/*
 * Прямой файл через WASM (msx/js/wasm-playback.js): воркер и сборка libav.js
 * под старые браузеры.
 *
 *   worker.src.js → msx/js/wasm-audio-worker.js
 *     Исходник на async/await. Воркеры правило зеркала (tools/legacy-build)
 *     не пересобирает и требует от них ES2016 — Babel под Chrome 53 переводит
 *     async в генераторы.
 *
 *   libav-<ver>-torrstream.wasm.src.js → msx/js/wasm-audio/libav-<ver>-torrstream.wasm.js
 *     Фабрика Emscripten (ES2022). Свежий Emscripten не берёт
 *     MIN_CHROME_VERSION ниже 85, а WASM есть с Chrome 57 (VIDAA ниже 9.5) —
 *     синтаксис опускает Babel под Chrome 57, globalThis (Chrome 71) — заглушка.
 *
 * Остальное в msx/js/wasm-audio/ — как вышло из сборки: фронтенд
 * libav-<ver>-torrstream.js (ES2015) и сам .wasm.wasm.
 *
 * Откуда сборка libav.js: VPS ~/wasm-build — emsdk latest + libav.js
 * v6.11.9.0.2 (ffmpeg 9.0.2), конфиг torrstream:
 *   cd libav.js/configs && node mkconfig.js torrstream '["avformat","avcodec",
 *   "zlib","demuxer-webm","demuxer-mp4","demuxer-mpegts","demuxer-avi","muxer-mp4",
 *   "parser-h264","parser-hevc","parser-av1","parser-vp9","parser-mpeg4video",
 *   "parser-ac3","parser-aac","parser-aac_latm","parser-dca","parser-mlp",
 *   "parser-mpegaudio","parser-flac","parser-opus","parser-vorbis",
 *   "decoder-h264","decoder-hevc","decoder-ac3","decoder-eac3","decoder-dca",
 *   "decoder-truehd","decoder-mlp","decoder-aac","decoder-aac_latm","decoder-mp3",
 *   "decoder-mp2","decoder-flac","decoder-opus","decoder-vorbis","decoder-alac",
 *   "decoder-pcm_s16le","decoder-pcm_s24le","decoder-pcm_s16be","decoder-pcm_s24be",
 *   "decoder-pcm_bluray","decoder-pcm_dvd","decoder-pcm_f32le","encoder-aac","encoder-ac3",
 *   "bsf-aac_adtstoasc","bsf-extract_extradata"]'
 *   cd .. && make -j2 dist/libav-6.11.9.0.2-torrstream.js dist/libav-6.11.9.0.2-torrstream.wasm.js
 * (только эти цели: build-<вариант> собирает ещё thr/asm/dbg). h264/hevc —
 * демуксеру для DTS при B-кадрах, видео не перекодируется.
 *
 * Две сборки .wasm одного кода, воркер берёт одну (wasmBulkMemory в worker.src.js):
 *   libav-…-torrstream.wasm.wasm — быстрая, как вышла из make (bulk memory —
 *     memory.copy/fill и секция DataCount, Chrome 75+);
 *   libav-…-torrstream.mvp.wasm — только базовый WebAssembly (Chrome 57–74):
 *     Chrome 68 (VIDAA ниже 9.5) быструю не открывал — «Wasm decoding failed:
 *     unexpected section: Code». Клей .wasm.js у них общий (wasm-opt меняет
 *     только код, импорты/экспорты те же). Отладка на ПК: ?wasm=mvp у страницы.
 * Совместимая — после make, на VPS:
 *   B=~/wasm-build/emsdk/upstream/bin; W=dist/libav-6.11.9.0.2-torrstream.wasm.wasm
 *   $B/wasm-opt $W --enable-bulk-memory --enable-sign-ext --enable-nontrapping-float-to-int \
 *     --enable-mutable-globals --llvm-memory-copy-fill-lowering --signext-lowering \
 *     --llvm-nontrapping-fptoint-lowering -o step1.wasm
 *   $B/wasm-opt step1.wasm --mvp-features -o libav-mvp.wasm   (заодно проверка: только MVP)
 * и libav-mvp.wasm → msx/js/wasm-audio/libav-6.11.9.0.2-torrstream.mvp.wasm.
 * Секций должно быть 1–7, 9–11, без 12 (DataCount). Цена — ~16 % скорости
 * воркера на ПК (×7,4 вместо ×8,8 на 1080p 40 Мбит/с), запас всё равно большой.
 *
 * Запуск: node tools/wasm-audio/build.js, потом tools/legacy-build (ASSET_V).
 */
'use strict';
var fs = require('fs');
var path = require('path');
var babel = require(path.join(__dirname, '../legacy-build/node_modules/@babel/core'));
var presetEnv = path.join(__dirname, '../legacy-build/node_modules/@babel/preset-env');

var ROOT = path.resolve(__dirname, '../..');
var VER = '6.11.9.0.2';

function build(src, out, chrome, banner, prefix) {
  var code = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n');
  var res = babel.transformSync(code, {
    filename: path.basename(src), babelrc: false, configFile: false, sourceType: 'script', compact: false,
    presets: [[presetEnv, { targets: { chrome: String(chrome) }, modules: false, bugfixes: true, useBuiltIns: false }]]
  });
  fs.writeFileSync(out, banner + (prefix || '') + res.code + '\n');
  console.log(path.relative(ROOT, out) + ': ' + Math.round(res.code.length / 1024) + ' КБ (Chrome ' + chrome + ')');
}

build(path.join(__dirname, 'worker.src.js'), path.join(ROOT, 'msx/js/wasm-audio-worker.js'), 53,
  '/* Сборка из tools/wasm-audio/worker.src.js (tools/wasm-audio/build.js) — руками не править. */\n');

build(path.join(__dirname, 'libav-' + VER + '-torrstream.wasm.src.js'),
  path.join(ROOT, 'msx/js/wasm-audio/libav-' + VER + '-torrstream.wasm.js'), 57,
  '/* libav.js ' + VER + ' (torrstream), фабрика Emscripten под Chrome 57 — tools/wasm-audio/build.js. */\n',
  'if (typeof globalThis === "undefined") self.globalThis = self;\n');
