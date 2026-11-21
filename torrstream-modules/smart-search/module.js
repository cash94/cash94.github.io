// module.js — Поиск по смыслу (smart-search)
//
// СОБИРАЕТСЯ из tools/smart-search/module.src.js (videoloop-server) скриптом
// tools/smart-search/build.js: тот подставляет словарь тем на место блока
// TOPICS ниже (между метками). Править исходник, а не собранный файл в зеркале.
//
// «Фильмы про гонки», «корейские сериалы про зомби», «комедии 90-х»,
// «лучшие ужасы 2023 года». TMDB ищет (search/movie, search/tv) только по
// названию, а по теме умеет фильтровать discover — по ключевым словам
// (with_keywords), жанрам, стране, году. Модуль разбирает текст запроса в
// такие фильтры и собирает выдачу через discover.
//
//   GET /api/smart-search?query=…
//     { success, smart: false }                    — это не поиск по смыслу,
//                                                    фронт ищет по названию сам
//     { success, smart: true, results, partial,    — выдача в формате
//       interpreted: { chips: ['гонки', …] } }       /api/tmdb/search/all
//
// Модуль, а не код сервера: так поиск обновляется вместе со словарём, без
// выпуска сервера. Фронт (public/js/torrents.js, searchTMDB) спрашивает
// модуль первым; 404 — модуля нет, ищет по названию как раньше.
//
// Без LLM: темы — словарь ниже, остальное — правила. Запрос, в котором после
// разбора остались непонятые слова, считаем названием (smart: false) — так
// «Фантастические твари» и «Бегущий по лезвию 2049» ищутся как раньше.
// Название, целиком похожее на запрос по смыслу («Про любовь»), всё равно
// встаёт первым: по названию модуль ищет всегда. Запрос в кавычках —
// только по названию.

// ==================== НАСТРОЙКИ ====================

// Выдача по набору фильтров живёт три дня, как подборки главной
var CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
var CACHE_MAX = 300;
var FETCH_TIMEOUT_MS = 15000;
// Сколько совпадений по названию ставить перед подборкой, когда запрос из
// одного слова («акулы», «Тачки») может быть и темой, и названием
var TITLE_HEAD_MAX = 5;
// Несколько тем ищутся вместе (И). Если таких фильмов мало — добавляем
// найденное по любой из тем (ИЛИ)
var AND_MIN_RESULTS = 10;
// По скольким ключевым словам темы строить отдельные списки для ранжирования
// (rankedTopicDiscover): по запросу к TMDB на слово и тип — не раздуваем
var KEYWORD_LISTS_MAX = 4;

// Зеркала TMDB на случай сервера без ctx.tmdbGet — тот же apiproxy.json,
// откуда их читает сервер (services/api-proxy.js)
var APIPROXY_URL = 'https://cash94.github.io/apiproxy.json';
var DEFAULT_TMDB_KEY = '064ea5b59beec7eccb3fe99059d58a50';
var DEFAULT_TMDB_MIRRORS = [
    { api: 'http://tsapi.torrstream.online', key: DEFAULT_TMDB_KEY },
    { api: 'http://nmapi.duckdns.org', key: DEFAULT_TMDB_KEY }
];

// ==================== СЛОВАРЬ ТЕМ ====================
//
// { id, label, match: [начала слов — регулярки], keywords: [{ id, name }] }.
// Порядок важен: тема, найденная раньше, «съедает» свои слова.

// <topics>
// Собрано автоматически из tools/smart-search/topics.src.js
var TOPICS = [
    {"id":"cold_war","label":"холодная война","match":["холодн[а-я]* войн"],"keywords":[{"id":2106,"name":"cold war"},{"id":156767,"name":"nuclear threat"}]},
    {"id":"civil_war_us","label":"Гражданская война в США","match":["гражданск[а-я]* войн[а-я]* в сша","войн[а-я]* севера и юга","конфедерац"],"keywords":[{"id":179585,"name":"american civil war"},{"id":192955,"name":"confederacy"}]},
    {"id":"civil_war_ru","label":"Гражданская война в России","match":["гражданск[а-я]* войн","белогвардей","красноармей","революци[а-я]* 1917","белы[ех] и красны"],"keywords":[{"id":158620,"name":"russian revolution (1917)"}]},
    {"id":"korean_war","label":"Корейская война","match":["корейск[а-я]* войн"],"keywords":[{"id":3264,"name":"korean war (1950-53)"}]},
    {"id":"abduction_alien","label":"похищения инопланетянами","match":["похищени[а-я]* (?:пришельц|инопланет)"],"keywords":[{"id":12553,"name":"alien abduction"}]},
    {"id":"first_love","label":"первая любовь","match":["перв[а-я]* любов"],"keywords":[{"id":157303,"name":"first love"},{"id":18425,"name":"teenage love"}]},
    {"id":"unlikely_friends","label":"неожиданная дружба","match":["необычн[а-я]* дружб","неожиданн[а-я]* дружб"],"keywords":[{"id":167982,"name":"unlikely friendship"},{"id":187376,"name":"odd couple"},{"id":15214,"name":"buddy"}]},
    {"id":"death_games","label":"игры на выживание","match":["игр[аы] на выживан","смертельн[а-я]* игр","королевск[а-я]* битв"],"keywords":[{"id":295702,"name":"death game"},{"id":220572,"name":"deadly game"},{"id":285633,"name":"battle royale"},{"id":227620,"name":"survival competition"}]},
    {"id":"submarines","label":"подводные лодки","match":["подводн[а-я]* лодк","подлодк","субмарин"],"keywords":[{"id":339,"name":"submarine"}]},
    {"id":"shipwreck","label":"кораблекрушения","match":["кораблекрушен","тонущ[а-я]* корабл","титаник"],"keywords":[{"id":2580,"name":"shipwreck"},{"id":180100,"name":"sinking ship"},{"id":4388,"name":"titanic"}]},
    {"id":"plane_crash","label":"авиакатастрофы","match":["авиакатастроф","крушени[а-я]* самолет","разбил[а-я]* самолет"],"keywords":[{"id":249530,"name":"plane crash"},{"id":12617,"name":"airplane crash"}]},
    {"id":"machines_rise","label":"восстание машин","match":["восстани[а-я]* (?:машин|робот)","бунт[а-я]* машин"],"keywords":[{"id":1373,"name":"killer robot"},{"id":310,"name":"artificial intelligence (a.i.)"}]},
    {"id":"magic_school","label":"школа магии","match":["школ[а-я]* (?:маги|волшеб|чародей)","магическ[а-я]* академ","академи[а-я]* маги"],"keywords":[{"id":291549,"name":"magic school"},{"id":177912,"name":"wizard"}]},
    {"id":"time_travel","label":"путешествия во времени","match":["путешестви[а-я]* во времени","машин[а-я]* времени","временн[а-я]* петл","петл[а-я]* времени"],"keywords":[{"id":4379,"name":"time travel"},{"id":10854,"name":"time loop"},{"id":5455,"name":"time machine"}]},
    {"id":"racing","label":"гонки","match":["гонк","гоноч","гонщик","формул[а-я]* 1","формул[аеуы]","ралли","дрифт","стритрейс","уличн[а-я]* гонк"],"keywords":[{"id":830,"name":"car race"},{"id":14725,"name":"race car driver"},{"id":9666,"name":"street race"},{"id":233981,"name":"formula one (f1)"},{"id":242128,"name":"motorsport"},{"id":302340,"name":"auto racing"},{"id":194988,"name":"drag racing"}]},
    {"id":"space","label":"космос","match":["космос","космич","космонавт","астронавт","марс[еау]?(?![а-я])","луну(?![а-я])","на луне"],"keywords":[{"id":9882,"name":"space"},{"id":252634,"name":"outer space"},{"id":14626,"name":"astronaut"},{"id":3801,"name":"space travel"},{"id":4040,"name":"space mission"},{"id":839,"name":"planet mars"},{"id":366632,"name":"mars mission"},{"id":305,"name":"moon"}]},
    {"id":"sharks","label":"акулы","match":["акул"],"keywords":[{"id":15097,"name":"shark"},{"id":2988,"name":"shark attack"},{"id":15098,"name":"great white shark"}]},
    {"id":"zombie","label":"зомби","match":["зомби"],"keywords":[{"id":12377,"name":"zombie"},{"id":186565,"name":"zombie apocalypse"}]},
    {"id":"vampire","label":"вампиры","match":["вампир"],"keywords":[{"id":3133,"name":"vampire"}]},
    {"id":"werewolf","label":"оборотни","match":["оборотн"],"keywords":[{"id":12564,"name":"werewolf"}]},
    {"id":"aliens","label":"инопланетяне","match":["инопланет","пришельц","нло(?![а-я])"],"keywords":[{"id":9951,"name":"alien"},{"id":14909,"name":"alien invasion"},{"id":9739,"name":"extraterrestrial"},{"id":9738,"name":"ufo"},{"id":160515,"name":"alien contact"}]},
    {"id":"dinosaurs","label":"динозавры","match":["динозавр"],"keywords":[{"id":12616,"name":"dinosaur"}]},
    {"id":"robots","label":"роботы и ИИ","match":["робот","искусственн[а-я]* интеллект","андроид","нейросет"],"keywords":[{"id":14544,"name":"robot"},{"id":310,"name":"artificial intelligence (a.i.)"},{"id":803,"name":"android"},{"id":679,"name":"cyborg"},{"id":10046,"name":"mecha"},{"id":10891,"name":"giant robot"}]},
    {"id":"heist","label":"ограбления","match":["ограблен","грабител","налет[а-я]* на банк","аферист","мошенни"],"keywords":[{"id":10051,"name":"heist"},{"id":15363,"name":"bank robbery"},{"id":642,"name":"robbery"},{"id":10453,"name":"con artist"},{"id":180250,"name":"swindle"}]},
    {"id":"prison","label":"тюрьма","match":["тюрьм","тюремн","заключенн","колони[а-я]* строгого"],"keywords":[{"id":378,"name":"prison"},{"id":9777,"name":"prison escape"},{"id":1563,"name":"prisoner"}]},
    {"id":"mafia","label":"мафия","match":["мафи","гангстер","бандит","якудз","наркокартел","наркобарон"],"keywords":[{"id":10391,"name":"mafia"},{"id":3149,"name":"gangster"},{"id":10291,"name":"organized crime"},{"id":1794,"name":"yakuza"},{"id":10175,"name":"drug cartel"}]},
    {"id":"spy","label":"шпионы","match":["шпион","разведчик","спецагент","секретн[а-я]* агент"],"keywords":[{"id":470,"name":"spy"},{"id":5265,"name":"espionage"},{"id":4289,"name":"secret agent"},{"id":383851,"name":"cia"},{"id":14555,"name":"mi6"}]},
    {"id":"ww2","label":"Вторая мировая","match":["втор[а-я]* миров","велик[а-я]* отечествен","вов(?![а-я])","нацист","холокост"],"keywords":[{"id":1956,"name":"world war ii"},{"id":2652,"name":"nazi"},{"id":1739,"name":"holocaust (shoah)"},{"id":336082,"name":"eastern front"}]},
    {"id":"ww1","label":"Первая мировая","match":["перв[а-я]* миров"],"keywords":[{"id":2504,"name":"world war i"}]},
    {"id":"vietnam","label":"война во Вьетнаме","match":["вьетнам"],"keywords":[{"id":2957,"name":"vietnam war"}]},
    {"id":"boxing","label":"бокс","match":["бокс(?![а-я])","боксер","боксе(?![а-я])","боксом"],"keywords":[{"id":209476,"name":"boxing"},{"id":2792,"name":"boxer"}]},
    {"id":"martial_arts","label":"единоборства","match":["единоборств","кунг[- ]?фу","карате","мма(?![а-я])","боев[а-я]* искусств","бои без правил"],"keywords":[{"id":779,"name":"martial arts"},{"id":780,"name":"kung fu"},{"id":384605,"name":"mixed martial arts"},{"id":3436,"name":"karate"}]},
    {"id":"football","label":"футбол","match":["футбол"],"keywords":[{"id":13042,"name":"football (soccer)"},{"id":244382,"name":"football (soccer) player"},{"id":579,"name":"american football"}]},
    {"id":"basketball","label":"баскетбол","match":["баскетбол"],"keywords":[{"id":6496,"name":"basketball"}]},
    {"id":"hockey","label":"хоккей","match":["хокке"],"keywords":[{"id":6483,"name":"ice hockey"}]},
    {"id":"sport","label":"спорт","match":["спорт","олимпи"],"keywords":[{"id":333328,"name":"sport"},{"id":6075,"name":"sports"},{"id":2070,"name":"olympic games"},{"id":240,"name":"underdog"}]},
    {"id":"school","label":"школа","match":["школ"],"keywords":[{"id":6270,"name":"high school"},{"id":10873,"name":"school"},{"id":10508,"name":"teacher"}]},
    {"id":"college","label":"студенты","match":["студент","колледж","универ"],"keywords":[{"id":3616,"name":"college"},{"id":13160,"name":"university"},{"id":285902,"name":"student"}]},
    {"id":"serial_killer","label":"маньяки","match":["маньяк","серийн[а-я]* убийц"],"keywords":[{"id":10714,"name":"serial killer"},{"id":6259,"name":"psychopath"}]},
    {"id":"superhero","label":"супергерои","match":["супергеро","по комикс","марвел","marvel"],"keywords":[{"id":9715,"name":"superhero"},{"id":9717,"name":"based on comic"},{"id":155030,"name":"superhero team"}]},
    {"id":"disaster","label":"катастрофы","match":["катастроф","землетрясен","цунами","извержен","стихийн"],"keywords":[{"id":10617,"name":"disaster"},{"id":5096,"name":"natural disaster"},{"id":3521,"name":"earthquake"},{"id":6941,"name":"tsunami"},{"id":3347,"name":"volcano"}]},
    {"id":"apocalypse","label":"апокалипсис","match":["апокалип","постапокалип","конец свет","конце свет"],"keywords":[{"id":4458,"name":"post-apocalyptic future"},{"id":12332,"name":"apocalypse"},{"id":10150,"name":"end of the world"},{"id":4565,"name":"dystopia"}]},
    {"id":"survival","label":"выживание","match":["выживан","выжить","необитаем[а-я]* остров"],"keywords":[{"id":10349,"name":"survival"},{"id":155746,"name":"deserted island"},{"id":9743,"name":"stranded"}]},
    {"id":"pirates","label":"пираты","match":["пират"],"keywords":[{"id":12988,"name":"pirate"}]},
    {"id":"medieval","label":"средневековье","match":["рыцар","средневеков"],"keywords":[{"id":10466,"name":"knight"},{"id":161257,"name":"medieval"},{"id":355987,"name":"middle ages"}]},
    {"id":"samurai","label":"самураи и ниндзя","match":["самура","ниндзя"],"keywords":[{"id":1462,"name":"samurai"},{"id":10278,"name":"ninja"}]},
    {"id":"vikings","label":"викинги","match":["викинг"],"keywords":[{"id":5895,"name":"vikings (norsemen)"},{"id":384863,"name":"viking"}]},
    {"id":"western","label":"Дикий Запад","match":["ковбо","дик[а-я]* запад"],"keywords":[{"id":155291,"name":"cowboy"},{"id":155573,"name":"wild west"}]},
    {"id":"dogs","label":"собаки","match":["собак","пес(?![а-я])","псах","щенк","щенок","псов"],"keywords":[{"id":15162,"name":"dog"},{"id":8841,"name":"puppy"}]},
    {"id":"cats","label":"кошки","match":["кошк","котик","котят","кот(?![а-я])","кота(?![а-я])","котов(?![а-я])","котах(?![а-я])"],"keywords":[{"id":977,"name":"cat"},{"id":156143,"name":"kitten"}]},
    {"id":"horses","label":"лошади","match":["лошад","кон(?:ь|я|ей|ях)(?![а-я])","скачк"],"keywords":[{"id":2673,"name":"horse"},{"id":643,"name":"horse race"}]},
    {"id":"animals","label":"животные","match":["животн","зверей","звери(?![а-я])"],"keywords":[{"id":361118,"name":"animal"},{"id":267848,"name":"talking animal"},{"id":9902,"name":"wildlife"}]},
    {"id":"music","label":"музыканты","match":["музыкант","рок[- ]?групп","рок[- ]?звезд","певиц","певец","певца","рэпер"],"keywords":[{"id":4048,"name":"musician"},{"id":18001,"name":"rock band"},{"id":2570,"name":"rock star"},{"id":10229,"name":"singer"},{"id":4562,"name":"rapper"}]},
    {"id":"dance","label":"танцы","match":["танц","балет","балерин"],"keywords":[{"id":246,"name":"dancing"},{"id":1691,"name":"dance"},{"id":10551,"name":"ballet"}]},
    {"id":"cooking","label":"кулинария","match":["повар","кулинар","ресторан","шеф[- ]?повар"],"keywords":[{"id":18293,"name":"chef"},{"id":1918,"name":"cooking"},{"id":1946,"name":"restaurant"}]},
    {"id":"doctors","label":"врачи","match":["врач","больниц","медик","хирург","медицин"],"keywords":[{"id":13005,"name":"doctor"},{"id":11612,"name":"hospital"},{"id":208788,"name":"medical drama"},{"id":3262,"name":"surgeon"}]},
    {"id":"lawyers","label":"юристы и суд","match":["адвокат","юрист","судебн","суд(?![а-я])","суде(?![а-я])","присяжн"],"keywords":[{"id":10909,"name":"lawyer"},{"id":33519,"name":"courtroom"},{"id":11038,"name":"trial"},{"id":222517,"name":"legal drama"}]},
    {"id":"police","label":"полиция","match":["полиц","коп(?:ы|ов|ах|а)?(?![а-я])","детектив[а-я]* полиц","следовател"],"keywords":[{"id":6149,"name":"police"},{"id":15090,"name":"police officer"},{"id":8015,"name":"cop"},{"id":15167,"name":"police detective"},{"id":5340,"name":"investigation"}]},
    {"id":"journalists","label":"журналисты","match":["журналист","репортер"],"keywords":[{"id":736,"name":"journalist"},{"id":917,"name":"journalism"},{"id":12193,"name":"reporter"}]},
    {"id":"hackers","label":"хакеры","match":["хакер","взлом","кибер(?!панк)"],"keywords":[{"id":2157,"name":"hacker"},{"id":12361,"name":"hacking"},{"id":6104,"name":"computer"}]},
    {"id":"cyberpunk","label":"киберпанк","match":["киберпанк","cyberpunk"],"keywords":[{"id":12190,"name":"cyberpunk"}]},
    {"id":"virtual","label":"виртуальная реальность","match":["виртуальн","видеоигр","компьютерн[а-я]* игр","геймер"],"keywords":[{"id":4563,"name":"virtual reality"},{"id":282,"name":"video game"},{"id":41645,"name":"based on video game"}]},
    {"id":"dystopia","label":"антиутопия","match":["антиутоп","тоталитар"],"keywords":[{"id":4565,"name":"dystopia"},{"id":2137,"name":"totalitarian regime"}]},
    {"id":"epidemic","label":"эпидемии","match":["вирус","эпидеми","пандеми","заражен"],"keywords":[{"id":188957,"name":"virus"},{"id":17995,"name":"epidemic"},{"id":188973,"name":"pandemic"},{"id":9744,"name":"outbreak"}]},
    {"id":"magic","label":"магия","match":["маги[яиюей](?![а-я])","волшебн","ведьм","колдун","чародей","маг(?:и|ов|ах)?(?![а-я])"],"keywords":[{"id":2343,"name":"magic"},{"id":616,"name":"witch"},{"id":177912,"name":"wizard"},{"id":40931,"name":"witchcraft"},{"id":5147,"name":"sorcery"}]},
    {"id":"dragons","label":"драконы","match":["дракон"],"keywords":[{"id":12554,"name":"dragon"}]},
    {"id":"ghosts","label":"призраки","match":["призрак","привиден","полтергейст"],"keywords":[{"id":162846,"name":"ghost"},{"id":3358,"name":"haunted house"},{"id":10224,"name":"haunting"},{"id":3350,"name":"poltergeist"}]},
    {"id":"demons","label":"демоны и одержимость","match":["демон","одержим","экзорц","изгнани[а-я]* дьявол","дьявол"],"keywords":[{"id":15001,"name":"demon"},{"id":2626,"name":"exorcism"},{"id":9712,"name":"possession"},{"id":161261,"name":"demonic possession"},{"id":14999,"name":"devil"}]},
    {"id":"clowns","label":"клоуны","match":["клоун"],"keywords":[{"id":3199,"name":"clown"},{"id":176691,"name":"killer clown"}]},
    {"id":"coming_of_age","label":"взросление","match":["подрост","взрослен","тинейдж"],"keywords":[{"id":10683,"name":"coming of age"},{"id":296608,"name":"teenager"},{"id":193400,"name":"teen drama"}]},
    {"id":"love","label":"любовь","match":["любов","влюбл"],"keywords":[{"id":9673,"name":"love"},{"id":13072,"name":"falling in love"},{"id":128,"name":"love triangle"},{"id":157303,"name":"first love"}]},
    {"id":"wedding","label":"свадьба","match":["свадьб","свадебн","невест"],"keywords":[{"id":13027,"name":"wedding"},{"id":3582,"name":"bride"}]},
    {"id":"christmas","label":"Рождество и Новый год","match":["рождеств","новый год","новогод","нового года","санта","дед[а-я]* мороз"],"keywords":[{"id":207317,"name":"christmas"},{"id":613,"name":"new year's eve"},{"id":1991,"name":"santa claus"},{"id":65,"name":"holiday"}]},
    {"id":"halloween","label":"Хэллоуин","match":["хэллоуин","хеллоуин"],"keywords":[{"id":3335,"name":"halloween"}]},
    {"id":"finance","label":"деньги и биржа","match":["бирж","уолл[- ]?стрит","трейдер","брокер","финансист","банкир"],"keywords":[{"id":5636,"name":"wall street"},{"id":177493,"name":"stock market"},{"id":10631,"name":"stockbroker"},{"id":246911,"name":"finance"},{"id":3515,"name":"banker"}]},
    {"id":"politics","label":"политика","match":["политик","президент","выбор(?:ы|ах|ов)(?![а-я])"],"keywords":[{"id":6078,"name":"politics"},{"id":8570,"name":"president"},{"id":15134,"name":"election"},{"id":264792,"name":"political"}]},
    {"id":"true_story","label":"реальные события","match":["реальн[а-я]* событи","реальн[а-я]* истори","основан[а-я]* на реальн","биограф"],"keywords":[{"id":9672,"name":"based on true story"},{"id":5565,"name":"biography"}]},
    {"id":"road_trip","label":"путешествия","match":["роуд[- ]?муви","путешеств","автопутешеств"],"keywords":[{"id":7312,"name":"road trip"},{"id":167043,"name":"road movie"},{"id":9935,"name":"travel"},{"id":189092,"name":"journey"}]},
    {"id":"sea","label":"море и корабли","match":["подводн[а-я]* лодк","подлодк","корабл","морск","моряк","океан"],"keywords":[{"id":339,"name":"submarine"},{"id":3799,"name":"ship"},{"id":41599,"name":"sailor"},{"id":270,"name":"ocean"},{"id":658,"name":"sea"},{"id":2580,"name":"shipwreck"}]},
    {"id":"aviation","label":"авиация","match":["самолет","летчик","пилот","авиа","авиакатастроф"],"keywords":[{"id":3800,"name":"airplane"},{"id":3203,"name":"pilot"},{"id":249530,"name":"plane crash"},{"id":10168,"name":"aviation"},{"id":2533,"name":"fighter pilot"}]},
    {"id":"trains","label":"поезда","match":["поезд","железн[а-я]* дорог"],"keywords":[{"id":13008,"name":"train"},{"id":282843,"name":"railway"}]},
    {"id":"mountains","label":"горы и альпинизм","match":["альпинис","гор(?:ы|ах|ам)(?![а-я])","эверест"],"keywords":[{"id":159212,"name":"mountain climbing"},{"id":1262,"name":"mountain"},{"id":192779,"name":"mount everest"}]},
    {"id":"army","label":"армия","match":["армия","армии","армейск","солдат","морпех","спецназ","десант"],"keywords":[{"id":13065,"name":"soldier"},{"id":162365,"name":"military"},{"id":15218,"name":"special forces"},{"id":6092,"name":"army"},{"id":11219,"name":"u.s. navy seal"},{"id":4405,"name":"marine corps"}]},
    {"id":"sniper","label":"снайперы","match":["снайпер"],"keywords":[{"id":1589,"name":"sniper"}]},
    {"id":"hitman","label":"наемные убийцы","match":["киллер","наемн[а-я]* убийц","ассасин"],"keywords":[{"id":2708,"name":"hitman"},{"id":782,"name":"assassin"},{"id":177964,"name":"contract killer"}]},
    {"id":"revenge","label":"месть","match":["мест(?:ь|и|ью)(?![а-я])","мстител(?!и)","отомст"],"keywords":[{"id":9748,"name":"revenge"},{"id":7002,"name":"vigilante"}]},
    {"id":"chess","label":"шахматы","match":["шахмат"],"keywords":[{"id":316,"name":"chess"}]},
    {"id":"cars","label":"автомобили","match":["автомобил","тачк","машин(?:ы|ах|ами)(?![а-я])"],"keywords":[{"id":310324,"name":"car"},{"id":999,"name":"sports car"},{"id":205399,"name":"muscle car"}]},
    {"id":"turtles","label":"черепахи","match":["черепах"],"keywords":[{"id":6362,"name":"turtle"}]},
    {"id":"bears","label":"медведи","match":["медвед"],"keywords":[{"id":10468,"name":"bear"}]},
    {"id":"insects","label":"насекомые и пауки","match":["паук","насеком","муравь","пчел"],"keywords":[{"id":3986,"name":"spider"},{"id":332,"name":"insect"},{"id":3888,"name":"giant spider"},{"id":3126,"name":"ant"},{"id":18379,"name":"bee"}]},
    {"id":"monsters","label":"монстры","match":["монстр","чудовищ","кайдзю","годзилл"],"keywords":[{"id":1299,"name":"monster"},{"id":11100,"name":"giant monster"},{"id":161791,"name":"kaiju"},{"id":13031,"name":"creature"}]},
    {"id":"treasure","label":"поиски сокровищ","match":["сокровищ","клад(?:а|ы|ов)?(?![а-я])","кладоиск"],"keywords":[{"id":6956,"name":"treasure hunt"},{"id":1454,"name":"treasure"},{"id":41586,"name":"archaeologist"}]},
    {"id":"mythology","label":"мифология","match":["миф","греческ[а-я]* бог","бог(?:и|ов|ах) олимп","египетск"],"keywords":[{"id":2036,"name":"greek mythology"},{"id":2035,"name":"mythology"},{"id":157894,"name":"ancient egypt"},{"id":179101,"name":"norse mythology"}]},
    {"id":"ancient_rome","label":"Древний Рим","match":["древн[а-я]* рим","гладиатор","римск[а-я]* импери"],"keywords":[{"id":5049,"name":"ancient rome"},{"id":1394,"name":"gladiator"},{"id":1405,"name":"roman empire"}]},
    {"id":"cults","label":"секты","match":["сект(?:а|ы|ах|е)(?![а-я])","культист"],"keywords":[{"id":6158,"name":"cult"},{"id":162766,"name":"religious cult"}]},
    {"id":"drugs","label":"наркотики","match":["наркотик","наркоман","наркодил"],"keywords":[{"id":14964,"name":"drugs"},{"id":1803,"name":"drug addiction"},{"id":2231,"name":"drug dealer"}]},
    {"id":"friendship","label":"дружба","match":["дружб","друзь"],"keywords":[{"id":6054,"name":"friendship"},{"id":12392,"name":"best friend"}]},
    {"id":"family","label":"семья","match":["семь(?:я|и|е|ю)(?![а-я])","родител","отц[а-я]* и сын","мать и доч"],"keywords":[{"id":18035,"name":"family"},{"id":240119,"name":"father son relationship"},{"id":240315,"name":"mother daughter relationship"},{"id":10235,"name":"family relationships"}]},
    {"id":"kidnapping","label":"похищения и заложники","match":["похищен","похитил","похитител","заложник"],"keywords":[{"id":1930,"name":"kidnapping"},{"id":1562,"name":"hostage"},{"id":235261,"name":"abduction"},{"id":18233,"name":"hostage situation"}]},
    {"id":"terrorism","label":"терроризм","match":["террорист","теракт","терроризм"],"keywords":[{"id":13015,"name":"terrorism"},{"id":158774,"name":"terrorist attack"},{"id":258,"name":"bomb"}]},
    {"id":"corruption","label":"коррупция","match":["коррупц","продажн[а-я]* полиц","оборотн[а-я]* в погон"],"keywords":[{"id":417,"name":"corruption"},{"id":11734,"name":"police corruption"},{"id":267608,"name":"corrupt cop"}]},
    {"id":"conspiracy","label":"заговоры","match":["заговор","конспиролог"],"keywords":[{"id":10410,"name":"conspiracy"},{"id":9665,"name":"cover-up"},{"id":181635,"name":"government conspiracy"}]},
    {"id":"gangs","label":"банды","match":["банд(?:а|ы|у|ой|ах|ам|ами)?(?![а-я])","группировк","бригад[аы](?![а-я])"],"keywords":[{"id":10726,"name":"gang"},{"id":542,"name":"street gang"},{"id":2987,"name":"gang war"}]},
    {"id":"bikers","label":"байкеры и мотоциклы","match":["байкер","мотоцикл","мото(?:гонк|клуб)"],"keywords":[{"id":6951,"name":"biker"},{"id":14735,"name":"motorcycle"},{"id":14736,"name":"motorcycle gang"}]},
    {"id":"undercover","label":"работа под прикрытием","match":["под прикрытием","внедрен[а-я]* агент"],"keywords":[{"id":1568,"name":"undercover"},{"id":11199,"name":"undercover cop"},{"id":14617,"name":"mole"}]},
    {"id":"fbi","label":"ФБР","match":["фбр","fbi"],"keywords":[{"id":1812,"name":"fbi"},{"id":272551,"name":"fbi agent"}]},
    {"id":"kgb","label":"КГБ и разведка СССР","match":["кгб","нквд","чекист","штирлиц"],"keywords":[{"id":3278,"name":"kgb"},{"id":217131,"name":"soviet spy"}]},
    {"id":"cartel","label":"наркокартели","match":["наркоторгов","картел"],"keywords":[{"id":10175,"name":"drug cartel"},{"id":2149,"name":"drug trafficking"},{"id":3391,"name":"drug smuggling"},{"id":18026,"name":"drug lord"}]},
    {"id":"escape","label":"побеги","match":["побег","сбежа","беглец","беглян"],"keywords":[{"id":10685,"name":"escape"},{"id":9777,"name":"prison escape"},{"id":10718,"name":"fugitive"},{"id":10562,"name":"on the run"}]},
    {"id":"murder_mystery","label":"расследование убийства","match":["расследован[а-я]* убийств","кто убийца","загадочн[а-я]* убийств"],"keywords":[{"id":161982,"name":"murder investigation"},{"id":12570,"name":"whodunit"},{"id":207046,"name":"murder mystery"}]},
    {"id":"death_penalty","label":"смертная казнь","match":["смертн[а-я]* казн","камер[а-я]* смертник"],"keywords":[{"id":2122,"name":"death penalty"},{"id":2501,"name":"death row"},{"id":13129,"name":"execution"}]},
    {"id":"revolution","label":"революции и восстания","match":["революц","восстан","бунт(?:а|ы|ов)?(?![а-я])"],"keywords":[{"id":2020,"name":"revolution"},{"id":11196,"name":"rebellion"},{"id":8862,"name":"uprising"}]},
    {"id":"napoleon","label":"эпоха Наполеона","match":["наполеон","бородин","войн[а-я]* 1812"],"keywords":[{"id":33384,"name":"napoleonic wars"},{"id":4381,"name":"napoleon bonaparte"}]},
    {"id":"stalin","label":"сталинская эпоха","match":["сталин","гулаг","репресси"],"keywords":[{"id":191543,"name":"stalinism"},{"id":14637,"name":"gulag"},{"id":6539,"name":"joseph stalin"},{"id":211362,"name":"political repression"}]},
    {"id":"ussr","label":"жизнь в СССР","match":["ссср","в совке","перестройк","застой"],"keywords":[{"id":2111,"name":"soviet union"},{"id":275067,"name":"ussr"}]},
    {"id":"afghan","label":"Афганистан","match":["афган"],"keywords":[{"id":3541,"name":"afghanistan"}]},
    {"id":"iraq","label":"война в Ираке","match":["ирак"],"keywords":[{"id":15087,"name":"iraq war"},{"id":5939,"name":"iraq"}]},
    {"id":"chechnya","label":"Чечня","match":["чечн","чеченск"],"keywords":[{"id":8780,"name":"chechnya"}]},
    {"id":"ancient_greece","label":"Древняя Греция","match":["древн[а-я]* греци","спарт","троян","троя(?![а-я])"],"keywords":[{"id":162861,"name":"ancient greece"},{"id":309489,"name":"sparta"},{"id":3265,"name":"trojan war"}]},
    {"id":"egypt","label":"Древний Египет","match":["фараон","древн[а-я]* египет","пирамид","мумии","мумия"],"keywords":[{"id":186939,"name":"pharaoh"},{"id":2904,"name":"mummy"},{"id":1949,"name":"pyramid"},{"id":157894,"name":"ancient egypt"}]},
    {"id":"royalty","label":"короли и королевы","match":["корол(?:ь|я|ей|и|ев|ям|ями|ях|ева|евы|еве|еву|евой)(?![а-я])","королевск[а-я]* (?:семь|двор|особ)","монарх","принцесс","принц(?:а|ы|ем|е)?(?![а-я])","царь","царица","император"],"keywords":[{"id":13084,"name":"king"},{"id":2011,"name":"queen"},{"id":7376,"name":"princess"},{"id":3071,"name":"prince"},{"id":9920,"name":"royalty"},{"id":2471,"name":"monarchy"},{"id":2280,"name":"emperor"}]},
    {"id":"native","label":"индейцы и древние цивилизации","match":["индейц","ацтек","майя(?![а-я])"],"keywords":[{"id":10322,"name":"native american"},{"id":5566,"name":"maya civilization"}]},
    {"id":"prehistoric","label":"первобытные времена","match":["первобытн","каменн[а-я]* век","пещерн[а-я]* люд","неандертал"],"keywords":[{"id":382214,"name":"prehistoric"},{"id":4428,"name":"stone age"},{"id":242244,"name":"caveman"}]},
    {"id":"parallel","label":"параллельные миры","match":["параллельн[а-я]* (?:мир|вселенн|реальност)","мультивселенн","друго[ей] измерени","портал[а-я]* в друг"],"keywords":[{"id":33465,"name":"parallel world"},{"id":336874,"name":"multiverse"},{"id":243230,"name":"parallel universe"},{"id":9820,"name":"alternate dimension"}]},
    {"id":"clones","label":"клоны и двойники","match":["клон(?:ы|ов|а|ирован)?(?![а-я])","клонирован","двойник","доппельгангер"],"keywords":[{"id":402,"name":"clone"},{"id":11628,"name":"cloning"},{"id":376610,"name":"doppelganger"},{"id":168266,"name":"double"}]},
    {"id":"superpowers","label":"суперспособности","match":["суперспособност","сверхспособност","телепат","телекинез","мутант"],"keywords":[{"id":1475,"name":"telepathy"},{"id":5086,"name":"telekinesis"},{"id":1852,"name":"mutant"}]},
    {"id":"immortality","label":"бессмертие","match":["бессмерт","вечн[а-я]* жизн"],"keywords":[{"id":4978,"name":"immortality"}]},
    {"id":"invisibility","label":"невидимки","match":["невидим"],"keywords":[{"id":189115,"name":"invisibility"},{"id":271162,"name":"invisible man"}]},
    {"id":"body_swap","label":"обмен телами","match":["обмен[а-я]* тел","поменял[а-я]* тел","в чужом тел","переселени[а-я]* душ"],"keywords":[{"id":33721,"name":"body swap"}]},
    {"id":"giants","label":"великаны и уменьшение","match":["уменьш","великан"],"keywords":[{"id":12101,"name":"miniaturization"},{"id":189099,"name":"giant"},{"id":6380,"name":"shrinking"}]},
    {"id":"simulation","label":"симуляция реальности","match":["симуляц","иллюзи[а-я]* реальност"],"keywords":[{"id":4563,"name":"virtual reality"}]},
    {"id":"dreams","label":"сны и кошмары","match":["сновиден","во сне","кошмар(?:ы|ов|ах)?(?![а-я])","осознанн[а-я]* сн"],"keywords":[{"id":346773,"name":"dream"},{"id":3030,"name":"nightmare"},{"id":10597,"name":"lucid dreaming"},{"id":186789,"name":"dream world"}]},
    {"id":"mind_control","label":"контроль разума","match":["контрол[а-я]* разум","гипноз","промывк[а-я]* мозг"],"keywords":[{"id":9678,"name":"mind control"},{"id":3363,"name":"hypnosis"},{"id":12400,"name":"brainwashing"}]},
    {"id":"spaceships","label":"космические корабли и станции","match":["космическ[а-я]* (?:станци|корабл)","звездолет","орбитальн"],"keywords":[{"id":156039,"name":"space station"},{"id":252937,"name":"spaceship"},{"id":1612,"name":"spacecraft"}]},
    {"id":"colonization","label":"колонизация планет","match":["колонизац","други[ех] планет","чуж[а-я]* планет"],"keywords":[{"id":3388,"name":"space colony"},{"id":10158,"name":"alien planet"},{"id":1613,"name":"terraforming"}]},
    {"id":"asteroid","label":"астероиды и кометы","match":["астероид","комет(?:а|ы|у)(?![а-я])","метеорит"],"keywords":[{"id":1423,"name":"asteroid"},{"id":4803,"name":"comet"},{"id":5404,"name":"meteor"}]},
    {"id":"black_hole","label":"черные дыры","match":["черн[а-я]* дыр","кротов[а-я]* нор"],"keywords":[{"id":4380,"name":"black hole"},{"id":3417,"name":"wormhole"}]},
    {"id":"steampunk","label":"стимпанк","match":["стимпанк","steampunk"],"keywords":[{"id":10028,"name":"steampunk"}]},
    {"id":"curse","label":"проклятия","match":["проклят"],"keywords":[{"id":10541,"name":"curse"},{"id":209528,"name":"cursed"}]},
    {"id":"occult","label":"оккультизм и ритуалы","match":["оккульт","ритуал","сатанист","жертвоприношен"],"keywords":[{"id":156174,"name":"occult"},{"id":4720,"name":"ritual"},{"id":3099,"name":"satanism"},{"id":10864,"name":"human sacrifice"}]},
    {"id":"slasher","label":"слэшеры","match":["слэшер","слешер","резн[яи](?![а-я])"],"keywords":[{"id":12339,"name":"slasher"},{"id":305666,"name":"masked killer"}]},
    {"id":"cannibals","label":"каннибалы","match":["каннибал","людоед"],"keywords":[{"id":14895,"name":"cannibal"},{"id":278235,"name":"cannibalism"}]},
    {"id":"sea_monsters","label":"морские чудовища","match":["морск[а-я]* чудовищ","кракен","осьминог","кальмар"],"keywords":[{"id":33696,"name":"sea monster"},{"id":161171,"name":"kraken"},{"id":2771,"name":"octopus"}]},
    {"id":"snakes","label":"змеи","match":["змей(?![а-я])","зме(?:и|я|ю|ев|ям|ями|ях)(?![а-я])","анаконд","питон"],"keywords":[{"id":1585,"name":"snake"},{"id":3891,"name":"giant snake"},{"id":158233,"name":"anaconda"}]},
    {"id":"crocodiles","label":"крокодилы","match":["крокодил","аллигатор"],"keywords":[{"id":3185,"name":"crocodile"},{"id":3184,"name":"alligator"}]},
    {"id":"wolves","label":"волки","match":["волк(?:и|ов|ах|ами|а)?(?![а-я])","волчиц"],"keywords":[{"id":1994,"name":"wolf"},{"id":185653,"name":"wolf pack"}]},
    {"id":"apes","label":"обезьяны","match":["обезьян","горилл","шимпанз","кинг[- ]?конг"],"keywords":[{"id":14759,"name":"ape"},{"id":690,"name":"gorilla"},{"id":2552,"name":"chimpanzee"},{"id":15149,"name":"monkey"}]},
    {"id":"birds","label":"птицы","match":["птиц","попуга","пингвин"],"keywords":[{"id":277462,"name":"bird"},{"id":3028,"name":"penguin"},{"id":3478,"name":"parrot"}]},
    {"id":"fairy_tales","label":"сказки","match":["сказк","сказочн"],"keywords":[{"id":3205,"name":"fairy tale"},{"id":179411,"name":"based on fairy tale"}]},
    {"id":"elves","label":"эльфы, гномы и тролли","match":["эльф","гном","хоббит","тролл(?:и|ей|ь)(?![а-я])","орк(?:и|ов)(?![а-я])"],"keywords":[{"id":603,"name":"elves"},{"id":604,"name":"dwarf"},{"id":11173,"name":"troll"}]},
    {"id":"mermaids","label":"русалки","match":["русал"],"keywords":[{"id":5938,"name":"mermaid"}]},
    {"id":"fairies","label":"феи","match":["фея(?![а-я])","фе(?:и|й|ями|ях)(?![а-я])"],"keywords":[{"id":2710,"name":"fairy"}]},
    {"id":"angels","label":"ангелы","match":["ангел"],"keywords":[{"id":290,"name":"angel"},{"id":184559,"name":"guardian angel"},{"id":4116,"name":"heaven"}]},
    {"id":"afterlife","label":"загробная жизнь","match":["загробн","после смерти","чистилищ"],"keywords":[{"id":6155,"name":"afterlife"},{"id":190287,"name":"life after death"},{"id":10448,"name":"purgatory"},{"id":6154,"name":"hell"}]},
    {"id":"reincarnation","label":"перерождение и попаданцы","match":["перерожден","реинкарнац","переродил","попаданц","исекай"],"keywords":[{"id":5484,"name":"reincarnation"},{"id":237451,"name":"isekai"}]},
    {"id":"gods","label":"боги","match":["бог(?:и|ов|ами)(?![а-я])","божеств"],"keywords":[{"id":9649,"name":"god"},{"id":377662,"name":"deity"}]},
    {"id":"religion","label":"вера и религия","match":["религи","священник","монах","монахин","монастыр","церков","библейск","иисус"],"keywords":[{"id":11001,"name":"religion"},{"id":10093,"name":"priest"},{"id":745,"name":"nun"},{"id":41592,"name":"monastery"},{"id":230097,"name":"jesus christ"},{"id":3036,"name":"bible"}]},
    {"id":"teachers","label":"учителя","match":["учител","преподавател","педагог"],"keywords":[{"id":10508,"name":"teacher"},{"id":41355,"name":"teacher student relationship"}]},
    {"id":"scientists","label":"ученые и гении","match":["учен(?:ый|ые|ых|ого|ым)(?![а-я])","изобретател","гени(?:й|и|ев|я)(?![а-я])","вундеркинд"],"keywords":[{"id":14760,"name":"scientist"},{"id":1436,"name":"inventor"},{"id":6257,"name":"genius"},{"id":10125,"name":"mad scientist"},{"id":5561,"name":"child prodigy"}]},
    {"id":"writers","label":"писатели","match":["писател","поэт","литератор"],"keywords":[{"id":13028,"name":"writer"},{"id":155251,"name":"novelist"},{"id":5933,"name":"poet"}]},
    {"id":"artists","label":"художники","match":["художник","живопис"],"keywords":[{"id":437,"name":"painter"},{"id":2679,"name":"artist"},{"id":5918,"name":"painting"}]},
    {"id":"filmmaking","label":"кино изнутри","match":["съемк[а-я]* (?:фильм|кино)","актер","актрис","киностуди"],"keywords":[{"id":12396,"name":"hollywood"},{"id":257714,"name":"actor"},{"id":295902,"name":"actress"},{"id":886,"name":"movie business"}]},
    {"id":"fashion","label":"мода","match":["мод(?:а|ы|е|у)(?![а-я])","модел(?:ь|и|ей)(?![а-я])","подиум","кутюр"],"keywords":[{"id":15479,"name":"fashion"},{"id":7024,"name":"fashion designer"},{"id":275133,"name":"fashion model"},{"id":236197,"name":"fashion industry"}]},
    {"id":"firefighters","label":"пожарные","match":["пожарн","пожар(?:ы|ов|а|е)?(?![а-я])"],"keywords":[{"id":192094,"name":"firefighter"},{"id":657,"name":"fire"},{"id":241961,"name":"wildfire"}]},
    {"id":"rescuers","label":"спасатели","match":["спасател","спасательн"],"keywords":[{"id":10084,"name":"rescue"},{"id":11107,"name":"rescue mission"},{"id":160961,"name":"lifeguard"}]},
    {"id":"miners","label":"шахтеры","match":["шахтер","шахт(?:а|е|ы|у)(?![а-я])","рудник"],"keywords":[{"id":4781,"name":"miner"},{"id":6015,"name":"mining"},{"id":1960,"name":"mine"}]},
    {"id":"truckers","label":"дальнобойщики","match":["дальнобой","грузовик","фур(?:а|ы|у)(?![а-я])"],"keywords":[{"id":155497,"name":"truck driver"},{"id":9276,"name":"truck"}]},
    {"id":"taxi","label":"таксисты","match":["такси"],"keywords":[{"id":444,"name":"taxi"},{"id":1749,"name":"taxi driver"}]},
    {"id":"bars","label":"бары","match":["бармен","бар(?:е|ы|ах)(?![а-я])","паб(?:е|ы)?(?![а-я])"],"keywords":[{"id":3458,"name":"bartender"},{"id":277050,"name":"bar"}]},
    {"id":"hotel","label":"отели","match":["отел(?:ь|е|я|и|ях)(?![а-я])","гостиниц"],"keywords":[{"id":612,"name":"hotel"},{"id":2669,"name":"motel"}]},
    {"id":"office","label":"офис и работа","match":["офис","корпорац","начальник","коллег"],"keywords":[{"id":1438,"name":"office"},{"id":6282,"name":"workplace"},{"id":188950,"name":"corporation"},{"id":5306,"name":"boss"}]},
    {"id":"business","label":"бизнес и стартапы","match":["бизнес","стартап","предпринимател","миллиардер","олигарх"],"keywords":[{"id":12094,"name":"business"},{"id":171068,"name":"entrepreneur"},{"id":185507,"name":"startup"},{"id":12547,"name":"billionaire"}]},
    {"id":"rich_poor","label":"богатые и бедные","match":["богат(?:ые|ых|ый|ая)","бедн(?:ые|ых|ость|ости|ый|ая)","нищет","бездомн"],"keywords":[{"id":220487,"name":"rich vs poor"},{"id":12987,"name":"poverty"},{"id":2981,"name":"homelessness"},{"id":10329,"name":"wealth"},{"id":14514,"name":"class differences"}]},
    {"id":"immigrants","label":"эмигранты и беженцы","match":["эмигр","иммигр","мигрант","беженц"],"keywords":[{"id":2356,"name":"immigrant"},{"id":1900,"name":"immigration"},{"id":972,"name":"refugee"}]},
    {"id":"pregnancy","label":"беременность","match":["беременн","младен","роды(?![а-я])"],"keywords":[{"id":3725,"name":"pregnancy"},{"id":1009,"name":"baby"},{"id":173490,"name":"unwanted pregnancy"},{"id":227873,"name":"newborn baby"}]},
    {"id":"adoption","label":"приемные дети и сироты","match":["усыновл","удочер","приемн[а-я]* (?:дет|ребен|сем|родит)","сирот","детск[а-я]* дом"],"keywords":[{"id":2393,"name":"adoption"},{"id":13014,"name":"orphan"},{"id":208400,"name":"foster care"},{"id":6783,"name":"orphanage"}]},
    {"id":"divorce","label":"развод","match":["развод(?:е|а|ы|ом)?(?![а-я])","разводятся"],"keywords":[{"id":15160,"name":"divorce"},{"id":4056,"name":"custody battle"}]},
    {"id":"cheating","label":"измена","match":["измен(?:а|ы|у|ой|е|ил|ял)(?![а-я])","изменяет","любовниц","любовник","неверн"],"keywords":[{"id":1326,"name":"infidelity"},{"id":596,"name":"adultery"},{"id":34094,"name":"extramarital affair"}]},
    {"id":"old_age","label":"старость","match":["старост","пенсионер","стари(?:к|ки|ков|ках)(?![а-я])","бабуш","бабул","дедуш","пожил"],"keywords":[{"id":298930,"name":"old age"},{"id":172971,"name":"elderly"},{"id":164039,"name":"grandmother"},{"id":4412,"name":"grandfather"},{"id":4948,"name":"retirement"}]},
    {"id":"siblings","label":"братья и сестры","match":["брат(?:ья|ьев|а|ом)?(?![а-я])","сестр(?:ы|а|ами|ах)?(?![а-я])","близнец","близняш"],"keywords":[{"id":243959,"name":"brother brother relationship"},{"id":241738,"name":"sister sister relationship"},{"id":240485,"name":"brother sister relationship"},{"id":15016,"name":"twins"},{"id":375255,"name":"siblings"}]},
    {"id":"fathers","label":"отцы и дети","match":["отц[а-я]* и (?:дет|сын|доч)","отцовств","папа(?![а-я])","папы(?![а-я])"],"keywords":[{"id":240119,"name":"father son relationship"},{"id":240303,"name":"father daughter relationship"},{"id":33479,"name":"single father"},{"id":970,"name":"parent child relationship"}]},
    {"id":"mothers","label":"матери и дети","match":["материнств","мам(?:а|ы)(?![а-я])","мать[- ]одиночк","матер(?:и|ей)(?![а-я])"],"keywords":[{"id":240237,"name":"mother son relationship"},{"id":240315,"name":"mother daughter relationship"},{"id":14768,"name":"single mother"}]},
    {"id":"disability","label":"инвалидность","match":["инвалид","слеп(?:ой|ая|ые|ых|ота)","глух(?:ой|ая|ие|их|ота)","аутизм","аутист","парализ","колясочник"],"keywords":[{"id":162735,"name":"disability"},{"id":164092,"name":"blindness"},{"id":321269,"name":"deafness"},{"id":1646,"name":"autism"},{"id":2564,"name":"wheelchair"},{"id":5859,"name":"paralysis"}]},
    {"id":"illness","label":"тяжелая болезнь","match":["онколог","смертельн[а-я]* болезн","неизлечим","рак(?:ом)?(?![а-я])"],"keywords":[{"id":10163,"name":"cancer"},{"id":6564,"name":"terminal illness"},{"id":14673,"name":"disease"},{"id":40895,"name":"illness"}]},
    {"id":"mental","label":"психические расстройства","match":["психическ","психиатр","психбольниц","шизофрен","безуми","сумасшеств","сумасшедш","раздвоени[а-я]* личност","депресс"],"keywords":[{"id":41329,"name":"mental illness"},{"id":10323,"name":"psychiatric hospital"},{"id":222,"name":"schizophrenia"},{"id":6255,"name":"insanity"},{"id":169411,"name":"multiple personality"},{"id":894,"name":"depression"}]},
    {"id":"addiction","label":"алкоголь и зависимость","match":["алкогол","пьянств","зависимост","запой"],"keywords":[{"id":7464,"name":"alcoholism"},{"id":6782,"name":"addiction"},{"id":40956,"name":"recovering alcoholic"}]},
    {"id":"suicide","label":"суицид","match":["суицид","самоубийств"],"keywords":[{"id":236,"name":"suicide"},{"id":1252,"name":"suicide attempt"}]},
    {"id":"amnesia","label":"потеря памяти","match":["амнези","потер[а-я]* памят","потерял[а-я]* памят"],"keywords":[{"id":1453,"name":"amnesia"},{"id":11469,"name":"memory loss"}]},
    {"id":"lgbt","label":"ЛГБТ","match":["лгбт","гей(?:и|ев)?(?![а-я])","лесби","однопол","квир","трансгендер"],"keywords":[{"id":158718,"name":"lgbt"},{"id":258533,"name":"gay theme"},{"id":9833,"name":"lesbian relationship"},{"id":290527,"name":"transgender"}]},
    {"id":"strong_women","label":"сильные женщины","match":["феминиз","сильн[а-я]* женщин","женск[а-я]* (?:судьб|истори)"],"keywords":[{"id":2383,"name":"feminism"},{"id":2660,"name":"strong woman"},{"id":11322,"name":"female protagonist"},{"id":212915,"name":"women's rights"}]},
    {"id":"racism","label":"расизм и рабство","match":["расизм","расов","сегрегац","рабств","раб(?:ы|ов)(?![а-я])","чернокож"],"keywords":[{"id":12425,"name":"racism"},{"id":2831,"name":"slavery"},{"id":233016,"name":"segregation"},{"id":4098,"name":"civil rights"},{"id":190675,"name":"black history"}]},
    {"id":"bullying","label":"травля","match":["травл","буллинг","издевательств"],"keywords":[{"id":6733,"name":"bullying"}]},
    {"id":"loneliness","label":"одиночество","match":["одиночеств","одинок"],"keywords":[{"id":9957,"name":"loneliness"},{"id":1533,"name":"isolation"}]},
    {"id":"midlife","label":"кризис среднего возраста","match":["кризис[а-я]* средн[а-я]* возраст"],"keywords":[{"id":1599,"name":"midlife crisis"}]},
    {"id":"grief","label":"утрата","match":["утрат","смерт[а-я]* близк","потер[а-я]* (?:близк|ребенк|мужа|жен)"],"keywords":[{"id":9872,"name":"grief"},{"id":253411,"name":"death of a child"},{"id":697,"name":"loss of loved one"},{"id":208397,"name":"death of wife"},{"id":175421,"name":"death of husband"}]},
    {"id":"second_chance","label":"второй шанс","match":["втор[а-я]* шанс","начать (?:жизнь )?заново","с чистого лист"],"keywords":[{"id":34004,"name":"second chance"},{"id":208476,"name":"starting over"},{"id":11436,"name":"redemption"}]},
    {"id":"underdog","label":"путь к успеху","match":["пут[ьи] к успех","аутсайдер","из грязи в князи","мотивирующ","вдохновляющ","мотиваци"],"keywords":[{"id":240,"name":"underdog"},{"id":5626,"name":"rags to riches"},{"id":281585,"name":"inspirational"},{"id":340575,"name":"overcoming adversity"}]},
    {"id":"extreme","label":"серфинг и экстрим","match":["серф","скейт","сноуборд","экстрим","паркур","парашют"],"keywords":[{"id":5349,"name":"surfing"},{"id":390,"name":"skateboarding"},{"id":2006,"name":"extreme sports"},{"id":6955,"name":"parkour"},{"id":10287,"name":"skydiving"}]},
    {"id":"tennis","label":"теннис","match":["теннис"],"keywords":[{"id":1488,"name":"tennis"}]},
    {"id":"golf","label":"гольф","match":["гольф"],"keywords":[{"id":2702,"name":"golf"}]},
    {"id":"baseball","label":"бейсбол","match":["бейсбол"],"keywords":[{"id":1480,"name":"baseball"}]},
    {"id":"wrestling","label":"борьба","match":["рестлинг","борц","сумо"],"keywords":[{"id":5970,"name":"wrestling"},{"id":331674,"name":"professional wrestling"},{"id":168929,"name":"sumo"}]},
    {"id":"running","label":"бег и марафоны","match":["марафон","бегун","легкоатлет"],"keywords":[{"id":7248,"name":"marathon"},{"id":319785,"name":"running"},{"id":187901,"name":"track and field"}]},
    {"id":"cycling","label":"велоспорт","match":["велосипед","велогон","велоспорт"],"keywords":[{"id":3797,"name":"bicycle"},{"id":180491,"name":"cycling"}]},
    {"id":"swimming","label":"плавание и дайвинг","match":["плаван","пловц","пловчих","дайвинг","дайвер","аквалангист"],"keywords":[{"id":15058,"name":"swimming"},{"id":269,"name":"diving"},{"id":10503,"name":"scuba diving"}]},
    {"id":"skating","label":"фигурное катание","match":["фигурн[а-я]* катан","фигурист","конькобеж","на коньках"],"keywords":[{"id":10671,"name":"figure skating"},{"id":157168,"name":"ice skating"}]},
    {"id":"gambling","label":"азартные игры","match":["покер","казино","азартн","игроман","шулер"],"keywords":[{"id":383,"name":"poker"},{"id":585,"name":"casino"},{"id":395,"name":"gambling"},{"id":220315,"name":"gambling addiction"}]},
    {"id":"fishing","label":"рыбалка","match":["рыбалк","рыбак","рыболов"],"keywords":[{"id":1495,"name":"fishing"},{"id":5420,"name":"fisherman"}]},
    {"id":"hunting","label":"охота","match":["охот(?:а|ы|е|у|ой)(?![а-я])","охотник"],"keywords":[{"id":33688,"name":"hunting"},{"id":414,"name":"hunter"},{"id":226499,"name":"manhunt"}]},
    {"id":"forest","label":"лес и походы","match":["поход(?:е|ы|ах)?(?![а-я])","в лесу","лес(?:а|ах)?(?![а-я])","кемпинг","палатк"],"keywords":[{"id":1890,"name":"camping"},{"id":5774,"name":"forest"},{"id":9720,"name":"woods"},{"id":5827,"name":"hiking"}]},
    {"id":"summer_camp","label":"летний лагерь","match":["летн[а-я]* лагер","пионерлагер","лагер(?:ь|е|я)(?![а-я])"],"keywords":[{"id":5767,"name":"summer camp"}]},
    {"id":"vacation","label":"отпуск и пляж","match":["пляж","отпуск","курорт","каникул"],"keywords":[{"id":966,"name":"beach"},{"id":6876,"name":"vacation"},{"id":10793,"name":"resort"}]},
    {"id":"theater","label":"театр","match":["театр","спектакл","бродве"],"keywords":[{"id":284103,"name":"theatre"},{"id":156028,"name":"broadway"},{"id":195729,"name":"stage play"}]},
    {"id":"circus","label":"цирк и фокусники","match":["цирк","фокусник","иллюзионист"],"keywords":[{"id":291,"name":"circus"},{"id":236458,"name":"magician"},{"id":210730,"name":"illusionist"},{"id":172365,"name":"magic trick"}]},
    {"id":"comedians","label":"стендап и комики","match":["стендап","стэндап","комик(?:и|ов|а)?(?![а-я])","юморист"],"keywords":[{"id":9716,"name":"stand-up comedy"},{"id":3485,"name":"comedian"}]},
    {"id":"singing","label":"пение и конкурсы талантов","match":["вокал","пени(?:е|я)(?![а-я])","хор(?:е|а|ом)?(?![а-я])","конкурс[а-я]* талант","евровидени"],"keywords":[{"id":12990,"name":"singing"},{"id":2318,"name":"choir"},{"id":186120,"name":"singing competition"},{"id":8290,"name":"talent show"}]},
    {"id":"music_genres","label":"джаз, рок и хип-хоп","match":["джаз","рок[- ]?н[- ]?ролл","хип[- ]?хоп","рэп(?![а-я])","панк(?![а-я])","металлист"],"keywords":[{"id":1416,"name":"jazz"},{"id":898,"name":"hip-hop"},{"id":897,"name":"rap music"},{"id":4470,"name":"punk rock"},{"id":5540,"name":"heavy metal"}]},
    {"id":"parties","label":"вечеринки и клубы","match":["вечеринк","тусовк","клуб(?:е|ы|ах)?(?![а-я])","диджей","рейв"],"keywords":[{"id":286407,"name":"party"},{"id":2334,"name":"nightclub"},{"id":186117,"name":"dj"},{"id":3221,"name":"rave"}]},
    {"id":"esports","label":"киберспорт","match":["киберспорт","стример"],"keywords":[{"id":166939,"name":"esports"},{"id":10439,"name":"gamer"}]},
    {"id":"tv_shows","label":"телевидение и реалити","match":["телешоу","реалити","телевидени"],"keywords":[{"id":308291,"name":"television"},{"id":291807,"name":"reality show"},{"id":4325,"name":"game show"}]},
    {"id":"helicopters","label":"вертолеты","match":["вертолет"],"keywords":[{"id":720,"name":"helicopter"}]},
    {"id":"tanks","label":"танки","match":["танк(?:и|ов|ах|ист|исты)?(?![а-я])"],"keywords":[{"id":11117,"name":"tank"},{"id":193042,"name":"tank battle"}]},
    {"id":"nuclear","label":"ядерная угроза и радиация","match":["ядерн","атомн","чернобыл","радиаци"],"keywords":[{"id":677,"name":"nuclear war"},{"id":160381,"name":"nuclear weapons"},{"id":4368,"name":"nuclear power plant"},{"id":1618,"name":"radiation"}]},
    {"id":"internet","label":"интернет и соцсети","match":["интернет","соцсет","социальн[а-я]* сет","блогер","инстаграм","тикток"],"keywords":[{"id":11615,"name":"internet"},{"id":176834,"name":"social media"},{"id":182195,"name":"online dating"},{"id":357090,"name":"influencer"},{"id":237646,"name":"cyberbullying"}]},
    {"id":"surveillance","label":"слежка","match":["слежк","камер[а-я]* наблюден","большой брат","прослушк"],"keywords":[{"id":18420,"name":"surveillance"},{"id":159433,"name":"surveillance camera"},{"id":165038,"name":"wiretapping"},{"id":178649,"name":"voyeurism"}]},
    {"id":"new_york","label":"Нью-Йорк","match":["нью[- ]?йорк","манхэттен","бруклин"],"keywords":[{"id":242,"name":"new york city"},{"id":168346,"name":"manhattan, new york city"},{"id":41523,"name":"brooklyn, new york city"}]},
    {"id":"los_angeles","label":"Лос-Анджелес","match":["лос[- ]?андж"],"keywords":[{"id":12670,"name":"los angeles, california"}]},
    {"id":"las_vegas","label":"Лас-Вегас","match":["лас[- ]?вегас","вегас"],"keywords":[{"id":14570,"name":"las vegas"}]},
    {"id":"paris","label":"Париж","match":["париж"],"keywords":[{"id":90,"name":"paris, france"}]},
    {"id":"london","label":"Лондон","match":["лондон"],"keywords":[{"id":212,"name":"london, england"}]},
    {"id":"tokyo","label":"Токио","match":["токио"],"keywords":[{"id":12369,"name":"tokyo, japan"}]},
    {"id":"moscow","label":"Москва","match":["москв"],"keywords":[{"id":186450,"name":"moscow, russia"}]},
    {"id":"petersburg","label":"Петербург","match":["петербург","ленинград"],"keywords":[{"id":332178,"name":"leningrad"}]},
    {"id":"italy_places","label":"Рим и Венеция","match":["рим(?:е|а|у)?(?![а-я])","венеци","сицили","тоскан"],"keywords":[{"id":588,"name":"rome, italy"},{"id":110,"name":"venice, italy"},{"id":629,"name":"sicily, italy"},{"id":131,"name":"italy"}]},
    {"id":"africa","label":"Африка","match":["африк","сафари","саванн"],"keywords":[{"id":409,"name":"africa"},{"id":3513,"name":"safari"},{"id":7323,"name":"savannah"}]},
    {"id":"jungle","label":"джунгли","match":["джунгл","тропическ[а-я]* лес","амазон"],"keywords":[{"id":10787,"name":"jungle"},{"id":180550,"name":"rainforest"},{"id":5968,"name":"amazon rainforest"}]},
    {"id":"desert","label":"пустыня","match":["пустын"],"keywords":[{"id":18034,"name":"desert"}]},
    {"id":"polar","label":"Арктика и Антарктида","match":["арктик","антаркт","северн[а-я]* полюс","южн[а-я]* полюс","полярн"],"keywords":[{"id":288649,"name":"arctic"},{"id":14728,"name":"antarctica"},{"id":34154,"name":"north pole"},{"id":257360,"name":"polar expedition"}]},
    {"id":"island","label":"острова","match":["остров"],"keywords":[{"id":2041,"name":"island"},{"id":155746,"name":"deserted island"},{"id":157524,"name":"tropical island"}]},
    {"id":"caves","label":"пещеры и подземелья","match":["пещер","подземель","катакомб","подземн[а-я]* (?:город|мир|туннел)"],"keywords":[{"id":1964,"name":"cave"},{"id":1353,"name":"underground"},{"id":4194,"name":"catacombs"},{"id":158018,"name":"caving"}]},
    {"id":"village","label":"деревня и глубинка","match":["деревн","сел(?:о|е)(?![а-я])","глубинк","ферм"],"keywords":[{"id":5331,"name":"village"},{"id":4932,"name":"farm"},{"id":267422,"name":"rural setting"},{"id":154846,"name":"farmer"}]},
    {"id":"small_town","label":"маленький город","match":["маленьк[а-я]* город","провинци","городок"],"keywords":[{"id":1415,"name":"small town"},{"id":301206,"name":"small town life"}]},
    {"id":"big_city","label":"мегаполис","match":["мегаполис","больш[а-я]* город"],"keywords":[{"id":12401,"name":"big city"},{"id":206671,"name":"city life"}]},
    {"id":"suburbs","label":"пригород","match":["пригород","спальн[а-я]* район"],"keywords":[{"id":14632,"name":"suburb"},{"id":10532,"name":"suburbia"}]},
    {"id":"emergency","label":"скорая помощь","match":["скор[а-я]* помощ","реанимаци"],"keywords":[{"id":177127,"name":"emergency room"},{"id":41603,"name":"paramedic"},{"id":1546,"name":"ambulance"}]},
    {"id":"castles","label":"замки и дворцы","match":["замк(?:и|ов|е|ах)(?![а-я])","замок(?![а-я])","дворц","дворец"],"keywords":[{"id":3098,"name":"castle"},{"id":3998,"name":"palace"}]},
    {"id":"museums","label":"музеи и библиотеки","match":["музе(?:й|я|е|и|ях)(?![а-я])","библиотек","книжн[а-я]* магазин"],"keywords":[{"id":2598,"name":"museum"},{"id":295,"name":"library"},{"id":317704,"name":"bookstore"}]},
    {"id":"zoo","label":"зоопарк","match":["зоопарк"],"keywords":[{"id":2172,"name":"zoo"}]},
    {"id":"shops","label":"магазины","match":["торгов[а-я]* центр","супермаркет","магазин(?:е|а|ы)?(?![а-я])"],"keywords":[{"id":6490,"name":"shopping mall"},{"id":1545,"name":"supermarket"},{"id":294446,"name":"store"}]},
    {"id":"confined","label":"замкнутое пространство","match":["замкнут[а-я]* пространств","в одной комнат","в лифте","заперт[а-я]* в"],"keywords":[{"id":2147,"name":"claustrophobia"},{"id":18029,"name":"trapped"},{"id":368386,"name":"single location"},{"id":193110,"name":"locked room"}]},
    {"id":"valentines","label":"День святого Валентина","match":["святого валентин","день влюбленн"],"keywords":[{"id":160404,"name":"valentine's day"}]},
    {"id":"thanksgiving","label":"День благодарения","match":["день благодарен","дня благодарен"],"keywords":[{"id":4543,"name":"thanksgiving"}]},
    {"id":"easter","label":"Пасха","match":["пасх"],"keywords":[{"id":9921,"name":"easter"}]},
    {"id":"birthday","label":"день рождения","match":["(?:день|дне|днем|дня) рождени"],"keywords":[{"id":1421,"name":"birthday"},{"id":5732,"name":"birthday party"}]},
    {"id":"prom","label":"выпускной","match":["выпускн"],"keywords":[{"id":10266,"name":"prom"},{"id":3687,"name":"graduation"}]},
    {"id":"olympics","label":"Олимпиада","match":["олимпиад"],"keywords":[{"id":2070,"name":"olympic games"}]},
    {"id":"world_cup","label":"чемпионат мира","match":["чемпионат[а-я]* мира","кубок мира"],"keywords":[{"id":1477,"name":"world cup"}]},
    {"id":"scams","label":"аферы и обман","match":["афер(?:а|ы|ист)","обманщик","кидал"],"keywords":[{"id":10453,"name":"con artist"},{"id":11454,"name":"scam"},{"id":180250,"name":"swindle"},{"id":3202,"name":"con man"}]},
    {"id":"buddy_cop","label":"напарники","match":["напарник"],"keywords":[{"id":167316,"name":"buddy cop"},{"id":9104,"name":"partner"}]},
    {"id":"chase","label":"погони","match":["погон(?:я|и|ей|ях)(?![а-я])","преследован","автопогон"],"keywords":[{"id":3713,"name":"chase"},{"id":382327,"name":"car chase"},{"id":15290,"name":"pursuit"},{"id":15076,"name":"cat and mouse"}]},
    {"id":"lone_hero","label":"герой-одиночка","match":["один против всех","одиночк[а-я]* против"],"keywords":[{"id":13116,"name":"one man army"},{"id":3568,"name":"lone wolf"}]},
    {"id":"bodyguard","label":"телохранители","match":["телохранител","охранник"],"keywords":[{"id":3088,"name":"bodyguard"},{"id":41180,"name":"security guard"}]},
    {"id":"mercenaries","label":"наемники","match":["наемник","частн[а-я]* военн"],"keywords":[{"id":3070,"name":"mercenary"},{"id":250163,"name":"private military company"}]},
    {"id":"ex_soldier","label":"бывший спецназовец","match":["бывш[а-я]* (?:спецназ|агент|военн|морпех|киллер)","отставн[а-я]* (?:агент|военн)"],"keywords":[{"id":18115,"name":"retired"},{"id":303928,"name":"former soldier"}]},
    {"id":"wilderness","label":"дикая природа","match":["дик[а-я]* природ","в тайге","тайг"],"keywords":[{"id":3593,"name":"wilderness"},{"id":18330,"name":"nature"},{"id":223620,"name":"lost in the woods"}]},
    {"id":"extinction","label":"гибель человечества","match":["конец цивилизац","гибел[а-я]* человечеств","вымирани"],"keywords":[{"id":10150,"name":"end of the world"},{"id":156803,"name":"extinction"},{"id":4458,"name":"post-apocalyptic future"}]},
    {"id":"invasion","label":"вторжение","match":["вторжен","нападени[а-я]* на землю","оккупац"],"keywords":[{"id":4278,"name":"invasion"},{"id":14909,"name":"alien invasion"},{"id":200400,"name":"occupation"}]},
    {"id":"experiments","label":"генетика и эксперименты","match":["генетик","генн[а-я]* инженер","эксперимент","мутаци","лаборатори"],"keywords":[{"id":163561,"name":"genetic engineering"},{"id":1706,"name":"experiment"},{"id":2766,"name":"mutation"},{"id":10124,"name":"laboratory"},{"id":386317,"name":"human experimentation"}]},
    {"id":"parody","label":"пародии","match":["пароди"],"keywords":[{"id":9755,"name":"parody"},{"id":11931,"name":"spoof"}]},
    {"id":"found_footage","label":"псевдодокументальное","match":["псевдодокумент","найденн[а-я]* пленк","мокьюментари"],"keywords":[{"id":11800,"name":"mockumentary"},{"id":163053,"name":"found footage"}]},
    {"id":"books","label":"экранизации книг","match":["экранизац","по книг","по роман","по мотивам (?:книг|роман)"],"keywords":[{"id":818,"name":"based on novel or book"},{"id":246466,"name":"based on young adult novel"}]},
    {"id":"games_adapt","label":"экранизации игр","match":["по (?:видео)?игр"],"keywords":[{"id":41645,"name":"based on video game"}]},
    {"id":"manga","label":"по манге","match":["манг(?:а|е|и|у)(?![а-я])"],"keywords":[{"id":13141,"name":"based on manga"},{"id":295446,"name":"manga"}]},
    {"id":"remake","label":"ремейки","match":["ремейк","римейк"],"keywords":[{"id":9714,"name":"remake"}]},
    {"id":"twist","label":"неожиданная концовка","match":["неожиданн[а-я]* (?:концовк|финал)","твист","взрыв[а-я]* мозг","вынос[а-я]* мозг","запутанн"],"keywords":[{"id":275311,"name":"plot twist"},{"id":326438,"name":"twist ending"},{"id":157171,"name":"nonlinear timeline"},{"id":335567,"name":"surprise ending"}]},
    {"id":"feelgood","label":"добрые и уютные","match":["добр(?:ые|ое|ый|ых)(?![а-я])","уютн","позитивн","для настроени","жизнеутвержд"],"keywords":[{"id":319357,"name":"heartwarming"},{"id":326774,"name":"cozy"}]},
    {"id":"sad","label":"грустные","match":["грустн","печальн","до слез","трагич"],"keywords":[{"id":276222,"name":"sad"},{"id":10614,"name":"tragedy"},{"id":156924,"name":"tearjerker"},{"id":370245,"name":"heartbreaking"}]},
    {"id":"satire","label":"сатира и черный юмор","match":["сатир","черн[а-я]* (?:юмор|комеди)","абсурд"],"keywords":[{"id":8201,"name":"satire"},{"id":10123,"name":"dark comedy"},{"id":383021,"name":"black comedy"},{"id":214655,"name":"absurdism"}]},
    {"id":"noir","label":"нуар","match":["нуар","неонуар"],"keywords":[{"id":9807,"name":"film noir"},{"id":207268,"name":"neo-noir"}]},
    {"id":"psychological","label":"психологические","match":["психологическ"],"keywords":[{"id":12565,"name":"psychological thriller"},{"id":272553,"name":"psychological"},{"id":295907,"name":"psychological horror"}]},
    {"id":"erotic","label":"эротика","match":["эротик","эротич","страстн"],"keywords":[{"id":190370,"name":"erotic movie"},{"id":41260,"name":"sensuality"},{"id":207767,"name":"erotic thriller"}]},
    {"id":"black_white","label":"немое и черно-белое кино","match":["нем(?:ое|ые|ых) кино","черно[- ]?бел"],"keywords":[{"id":154802,"name":"silent film"},{"id":12999,"name":"black and white"}]},
    {"id":"stop_motion","label":"кукольная анимация","match":["кукольн","пластилин","стоп[- ]?моушн"],"keywords":[{"id":10121,"name":"stop motion"},{"id":197065,"name":"claymation"},{"id":6300,"name":"puppet"}]},
    {"id":"toys","label":"игрушки и куклы","match":["игрушк","кукл(?:а|ы|у|ой)(?![а-я])","лего"],"keywords":[{"id":265589,"name":"toy"},{"id":33630,"name":"doll"},{"id":210090,"name":"lego"}]},
    {"id":"transformers","label":"трансформеры","match":["трансформер"],"keywords":[{"id":339148,"name":"transformers"},{"id":10891,"name":"giant robot"}]},
    {"id":"talking_animals","label":"говорящие животные","match":["говорящ[а-я]* (?:животн|звер|собак|кот)"],"keywords":[{"id":267848,"name":"talking animal"},{"id":11477,"name":"anthropomorphism"}]},
    {"id":"pets","label":"домашние питомцы","match":["питом","домашн[а-я]* животн"],"keywords":[{"id":2551,"name":"pet"},{"id":15162,"name":"dog"},{"id":977,"name":"cat"}]},
    {"id":"nature","label":"природа","match":["природ(?:а|у|е|ы)(?![а-я])","планет[аеуы] земл"],"keywords":[{"id":18330,"name":"nature"},{"id":9902,"name":"wildlife"},{"id":239155,"name":"planet earth"},{"id":33480,"name":"environmental"}]},
    {"id":"ecology","label":"экология и климат","match":["экологи","изменени[а-я]* климат","глобальн[а-я]* потеплен","загрязнен"],"keywords":[{"id":2210,"name":"climate change"},{"id":156388,"name":"environmentalism"},{"id":5769,"name":"global warming"},{"id":6305,"name":"pollution"}]},
    {"id":"food","label":"еда и вино","match":["ед(?:а|ы|у|ой)(?![а-я])","вин(?:о|а)(?![а-я])","винодел","пицц","кофе","пекар","кондитер"],"keywords":[{"id":10637,"name":"food"},{"id":6563,"name":"wine"},{"id":182282,"name":"baking"},{"id":2439,"name":"coffee"},{"id":4735,"name":"pizza"}]},
    {"id":"villains","label":"антигерои и злодеи","match":["антигеро","злоде(?:й|и|ев)(?![а-я])","суперзлоде"],"keywords":[{"id":2095,"name":"anti hero"},{"id":194404,"name":"supervillain"},{"id":3289,"name":"villain"}]}
];
// </topics>

// ==================== ПРАВИЛА РАЗБОРА ====================

// Слово в запросе начинается не с середины другого слова
var WORD_START = '(?<![а-яa-z0-9])';
var WORD_END = '(?![а-яa-z0-9])';

// Жанры TMDB: id для фильмов и для сериалов (у сериалов свой набор; null —
// такого жанра у сериалов нет). Порядок важен: «мелодрама» раньше «драмы».
var GENRES = [
    { name: 'мелодрама', match: ['мелодрам', 'романтич', 'романтик'], movie: 10749, tv: null },
    { name: 'мультфильм', match: ['мультипликац', 'анимац', 'анимацион'], movie: 16, tv: 16 },
    { name: 'боевик', match: ['боевик', 'экшн', 'экшен'], movie: 28, tv: 10759 },
    { name: 'приключения', match: ['приключен'], movie: 12, tv: 10759 },
    { name: 'комедия', match: ['комеди', 'комедийн', 'смешн', 'ржачн', 'угарн'], movie: 35, tv: 35 },
    { name: 'криминал', match: ['криминал'], movie: 80, tv: 80 },
    { name: 'документальное', match: ['документал', 'докуме'], movie: 99, tv: 99 },
    { name: 'драма', match: ['драм(?:а|ы|у|ой|ах|ам|ами)?' + WORD_END, 'драматич'], movie: 18, tv: 18 },
    { name: 'семейное', match: ['семейн', 'детск', 'для детей', 'для всей семьи'], movie: 10751, tv: 10751 },
    { name: 'фэнтези', match: ['фэнтез', 'фентез'], movie: 14, tv: 10765 },
    { name: 'история', match: ['историческ'], movie: 36, tv: null },
    { name: 'ужасы', match: ['ужас', 'хоррор', 'страшн', 'ужастик', 'жутк'], movie: 27, tv: null },
    { name: 'музыка', match: ['мюзикл', 'музыкальн'], movie: 10402, tv: null },
    { name: 'детектив', match: ['детектив'], movie: 9648, tv: 9648 },
    { name: 'фантастика', match: ['научн[а-я]* фантаст', 'фантастик', 'фантастич', 'sci-fi', 'сай[- ]?фай'], movie: 878, tv: 10765 },
    { name: 'триллер', match: ['триллер'], movie: 53, tv: null },
    { name: 'военное', match: ['военн', 'войн(?:а|е|ы|у|ой)' + WORD_END], movie: 10752, tv: 10768 },
    { name: 'вестерн', match: ['вестерн'], movie: 37, tv: 37 }
];

var COUNTRIES = [
    { name: 'Скандинавия', match: ['скандинавск'], codes: ['SE', 'DK', 'NO', 'FI', 'IS'] },
    { name: 'Корея', match: ['южнокорейск', 'корейск', 'дорам'], codes: ['KR'] },
    { name: 'Япония', match: ['японск'], codes: ['JP'] },
    { name: 'Китай', match: ['китайск'], codes: ['CN'] },
    { name: 'Гонконг', match: ['гонконгск'], codes: ['HK'] },
    { name: 'Индия', match: ['индийск', 'болливуд'], codes: ['IN'] },
    { name: 'Турция', match: ['турецк'], codes: ['TR'] },
    { name: 'Франция', match: ['французск'], codes: ['FR'] },
    { name: 'Италия', match: ['итальянск'], codes: ['IT'] },
    { name: 'Испания', match: ['испанск'], codes: ['ES'] },
    { name: 'Германия', match: ['немецк'], codes: ['DE'] },
    { name: 'Великобритания', match: ['британск', 'английск'], codes: ['GB'] },
    { name: 'США', match: ['американск', 'голливуд'], codes: ['US'] },
    { name: 'СССР', match: ['советск'], codes: ['SU'] },
    { name: 'Россия', match: ['российск', 'русск', 'отечествен'], codes: ['RU'] },
    { name: 'Швеция', match: ['шведск'], codes: ['SE'] },
    { name: 'Дания', match: ['датск'], codes: ['DK'] },
    { name: 'Норвегия', match: ['норвежск'], codes: ['NO'] },
    { name: 'Финляндия', match: ['финск'], codes: ['FI'] },
    { name: 'Австралия', match: ['австралийск'], codes: ['AU'] },
    { name: 'Канада', match: ['канадск'], codes: ['CA'] },
    { name: 'Мексика', match: ['мексиканск'], codes: ['MX'] },
    { name: 'Бразилия', match: ['бразильск'], codes: ['BR'] },
    { name: 'Таиланд', match: ['тайск', 'тайланд'], codes: ['TH'] },
    { name: 'Польша', match: ['польск'], codes: ['PL'] },
    { name: 'Украина', match: ['украинск'], codes: ['UA'] },
    { name: 'Казахстан', match: ['казахск'], codes: ['KZ'] },
    { name: 'Беларусь', match: ['белорусск'], codes: ['BY'] },
    { name: 'Ирландия', match: ['ирландск'], codes: ['IE'] },
    { name: 'Бельгия', match: ['бельгийск'], codes: ['BE'] },
    { name: 'Аргентина', match: ['аргентинск'], codes: ['AR'] },
    { name: 'Иран', match: ['иранск'], codes: ['IR'] }
];

// Слова, которые смысла не несут: после разбора их не считаем «остатком»
var FILLER = new Set(('про о об обо и или с со в во на по для за из от до где как что чтобы это мне нам ' +
    'хочу хочется посоветуй посоветуйте найди найти покажи подбери порекомендуй какие какой какое какую ' +
    'нибудь какие-нибудь что-нибудь что-то какой-нибудь хорошие хороший хорошее хорошую интересные интересный ' +
    'интересное крутые крутой классные годов годы года году год лет х е the a about смотреть посмотреть ' +
    'онлайн бесплатно все всё ещё еще типа вроде жанр жанре жанра жанру тему теме тематику тематике сюжет ' +
    'сюжетом был были есть очень супер кино кинофильмы кинофильм вечер вечерок вечером выходные выходных вдвоем').split(' '));

function normalizeQuery(query) {
    return String(query || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[«»"'“”„!?.,;:()[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Скомпилированные регулярки: строим один раз, а не на каждый запрос
var reCache = new Map();
function wordRe(pattern) {
    var re = reCache.get(pattern);
    if (!re) {
        // Совпадение продлеваем до конца слова: «гонк» съедает «гонки» целиком
        re = new RegExp(WORD_START + '(?:' + pattern + ')[а-яa-z0-9-]*', 'g');
        reCache.set(pattern, re);
    }
    re.lastIndex = 0;
    return re;
}

/**
 * Найти и «вырезать» из строки совпадения с началами слов из patterns.
 * Вырезанное заменяется пробелом: следующие правила по этим словам уже не
 * сработают.
 */
function consume(state, patterns) {
    var found = false;
    for (var i = 0; i < patterns.length; i++) {
        state.text = state.text.replace(wordRe(patterns[i]), function () { found = true; return ' '; });
    }
    return found;
}

function consumeFirst(state, re) {
    var m = state.text.match(re);
    if (!m) return null;
    state.text = state.text.slice(0, m.index) + ' ' + state.text.slice(m.index + m[0].length);
    return m;
}

function decadeStart(digits) {
    if (digits.length === 4) return Number(digits);
    var d = Number(digits);
    // «00-х», «10-х», «20-х» — нынешний век, остальное — прошлый
    return d <= 20 ? 2000 + d : 1900 + d;
}

/**
 * Разобрать запрос. null — это не поиск по смыслу, искать по названию.
 * explicit — «фильмы…», «про…»: так названия не пишут, искать по названию
 * незачем. Одно слово («акулы», «комедии») может быть и названием.
 */
function parseSmartQuery(query, now) {
    var year = (now || new Date()).getFullYear();
    var state = { text: ' ' + normalizeQuery(query) + ' ' };
    if (state.text.trim().length < 3) return null;

    var hasPro = /(?<![а-яa-z0-9])(?:про|о|об|обо)(?![а-яa-z0-9])/.test(state.text);
    var chips = [];

    // 1. Темы — первыми: «машина времени» не должна стать «машинами»,
    //    а «Великая Отечественная» — российским кино
    var topics = [];
    for (var t = 0; t < TOPICS.length; t++) {
        if (consume(state, TOPICS[t].match)) topics.push(TOPICS[t]);
    }

    // 2. Тип: мультфильм / мультсериал / аниме / фильм / сериал
    var wantMovie = false, wantTv = false, typeWord = false, language = null;
    var genres = [];
    var animation = GENRES[1];
    function addAnimation() { if (genres.indexOf(animation) === -1) genres.push(animation); }
    if (consume(state, ['мультсериал'])) { wantTv = true; typeWord = true; addAnimation(); chips.push('мультсериалы'); }
    if (consume(state, ['мультфильм'])) { wantMovie = true; typeWord = true; addAnimation(); chips.push('мультфильмы'); }
    if (consume(state, ['мультик', 'мульт' + WORD_END])) { typeWord = true; addAnimation(); if (!chips.length) chips.push('мультфильмы'); }
    if (consume(state, ['аниме', 'anime'])) { typeWord = true; language = 'ja'; addAnimation(); chips.push('аниме'); }
    if (consume(state, ['фильм', 'фильмец', 'кинох', 'кинофильм', 'movie'])) { wantMovie = true; typeWord = true; chips.push('фильмы'); }
    if (consume(state, ['сериал', 'сериальчик', 'series', 'шоу' + WORD_END])) { wantTv = true; typeWord = true; chips.push('сериалы'); }
    if (/(?<![а-яa-z0-9])кино(?![а-яa-z0-9])/.test(state.text)) typeWord = true;
    var animationByType = genres.length > 0;

    // 3. Жанры
    for (var g = 0; g < GENRES.length; g++) {
        if (consume(state, GENRES[g].match) && genres.indexOf(GENRES[g]) === -1) genres.push(GENRES[g]);
    }
    for (var gi = 0; gi < genres.length; gi++) {
        if (genres[gi] === animation && animationByType) continue;
        chips.push(genres[gi].name);
    }

    // 4. Страны
    var countries = [];
    for (var c = 0; c < COUNTRIES.length; c++) {
        if (consume(state, COUNTRIES[c].match)) {
            for (var k = 0; k < COUNTRIES[c].codes.length; k++) {
                if (countries.indexOf(COUNTRIES[c].codes[k]) === -1) countries.push(COUNTRIES[c].codes[k]);
            }
            chips.push(COUNTRIES[c].name);
        }
    }

    // 5. Годы
    var years = null, sort = 'votes', fresh = false;
    var decade = consumeFirst(state, /(?<![0-9])(\d{2}|\d{3}0)[- ]?(?:х|е|ые|ых|ым|ом)(?![а-яa-z0-9])/);
    if (decade) {
        var from = decadeStart(decade[1]);
        years = { from: from, to: from + 9 };
        chips.push(from + '-е');
    } else {
        var exact = consumeFirst(state, /(?<![0-9])(19\d\d|20\d\d)(?![0-9])/);
        if (exact) { years = { from: Number(exact[1]), to: Number(exact[1]) }; chips.push(exact[1]); }
    }
    if (consume(state, ['этого года', 'этом году'])) { years = { from: year, to: year }; chips.push(String(year)); }
    else if (consume(state, ['прошлого года', 'прошлом году'])) { years = { from: year - 1, to: year - 1 }; chips.push(String(year - 1)); }
    if (consume(state, ['нов(?:ые|ое|ый|ая|ых|инк|еньк)', 'свеж', 'последн'])) {
        fresh = true;
        if (!years) years = { from: year - 1, to: year };
        sort = 'new';
        chips.push('новинки');
    }

    // 6. Сортировка
    if (consume(state, ['лучш', 'топ' + WORD_END, 'сам(?:ые|ых|ое|ый)' + WORD_END, 'шедевр', 'классик', 'высок[а-я]* рейтинг', 'культов'])) {
        sort = 'rating';
        chips.push('лучшие');
    }

    // Что осталось непонятым
    var leftover = state.text.split(' ').filter(function (w) { return w && !FILLER.has(w) && !/^[-–—]+$/.test(w); });

    var hasFilter = topics.length || genres.length || countries.length || language ||
        (years && (typeWord || fresh));
    if (!hasFilter) return null;
    // Непонятые слова — значит, это скорее название. Исключение — «про <тема>
    // …»: «фильмы про гонки в Монако» всё равно про гонки
    if (leftover.length && !(hasPro && topics.length)) return null;

    var types;
    if (wantMovie && !wantTv) types = ['movie'];
    else if (wantTv && !wantMovie) types = ['tv'];
    else types = ['movie', 'tv'];

    // Темы — в начало подписи: они главное в запросе
    for (var ti = topics.length - 1; ti >= 0; ti--) chips.unshift(topics[ti].label);

    return {
        types: types,
        topics: topics,
        genres: genres,
        countries: countries,
        language: language,
        years: years,
        sort: sort,
        explicit: Boolean(typeWord || hasPro || countries.length || years),
        chips: chips
    };
}

// ==================== ЗАПРОСЫ К DISCOVER ====================

// Сколько страниц discover на тип. Фронт рисует не больше 40 карточек
var PAGES_ONE_TYPE = 2;
var PAGES_MOVIE_OF_TWO = 2;
var PAGES_TV_OF_TWO = 1;

function topicKeywordIds(topic) {
    return topic.keywords.map(function (k) { return k.id; });
}

/**
 * with_keywords для набора тем. Одна тема — любое из её слов (ИЛИ, «|»).
 * Несколько — все темы сразу (И, «,»), по главному слову каждой: TMDB не
 * понимает смешения «,» и «|» в одном параметре (проверено: «a|b,c» — то же,
 * что «a,b,c»). mode: 'and' | 'or'.
 */
function keywordsParam(topics, mode) {
    if (topics.length === 1 || mode === 'or') {
        var ids = [];
        topics.forEach(function (t) {
            topicKeywordIds(t).forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
        });
        return ids.join('|');
    }
    return topics.map(function (t) { return t.keywords[0].id; }).join(',');
}

/**
 * Запросы к discover: [{ type, path }], path — без api_key. Жанр, которого у
 * сериалов нет (ужасы, триллер), убирает сериалы из выдачи — если только их
 * не просили явно: тогда этот жанр для сериалов просто пропускаем.
 */
function buildDiscoverRequests(parsed, keywordMode, opts) {
    opts = opts || {};
    var requests = [];
    var types = parsed.types.slice();
    if (types.length === 2 && parsed.genres.some(function (g) { return g.tv == null; })) types = ['movie'];

    types.forEach(function (type) {
        var p = new URLSearchParams();
        p.set('language', 'ru-RU');
        p.set('include_adult', 'false');
        if (opts.keywords) p.set('with_keywords', opts.keywords);
        else if (parsed.topics.length) p.set('with_keywords', keywordsParam(parsed.topics, keywordMode));
        var genreIds = parsed.genres.map(function (g) { return type === 'tv' ? g.tv : g.movie; })
            .filter(function (id) { return id != null; });
        if (genreIds.length) p.set('with_genres', genreIds.join(','));
        if (parsed.countries.length) p.set('with_origin_country', parsed.countries.join('|'));
        if (parsed.language) p.set('with_original_language', parsed.language);
        if (parsed.years) {
            var field = type === 'tv' ? 'first_air_date' : 'primary_release_date';
            p.set(field + '.gte', parsed.years.from + '-01-01');
            p.set(field + '.lte', parsed.years.to + '-12-31');
        }
        if (parsed.sort === 'rating') {
            p.set('sort_by', 'vote_average.desc');
            p.set('vote_count.gte', type === 'tv' ? '150' : '300');
        } else if (parsed.sort === 'new') {
            p.set('sort_by', 'popularity.desc');
            p.set('vote_count.gte', '5');
        } else {
            p.set('sort_by', 'vote_count.desc');
            p.set('vote_count.gte', '20');
        }
        var pages = opts.pages || (types.length === 1 ? PAGES_ONE_TYPE : (type === 'movie' ? PAGES_MOVIE_OF_TWO : PAGES_TV_OF_TWO));
        for (var page = 1; page <= pages; page++) {
            requests.push({ type: type, path: 'discover/' + type + '?' + p.toString() + '&page=' + page });
        }
    });
    return requests;
}

function cacheKey(parsed) {
    return JSON.stringify([
        parsed.types,
        parsed.topics.map(function (t) { return t.id; }),
        parsed.genres.map(function (g) { return g.movie; }),
        parsed.countries, parsed.language, parsed.years, parsed.sort
    ]);
}

/**
 * Насколько работа известна: средняя оценка, взвешенная числом голосов —
 * как rankCredit в routes/tmdb.js и ранжирование подборок у парсера.
 */
function rankItem(item) {
    var avg = typeof item.vote_average === 'number' ? item.vote_average : 0;
    var count = typeof item.vote_count === 'number' ? item.vote_count : 0;
    if (avg <= 0 || count <= 0) return 0;
    return avg * Math.log(count + 1);
}

function sortResults(items, sort) {
    var copy = items.slice();
    if (sort === 'rating') {
        copy.sort(function (a, b) { return (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0); });
    } else if (sort === 'new') {
        copy.sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); });
    } else {
        copy.sort(function (a, b) { return rankItem(b) - rankItem(a); });
    }
    return copy;
}

// ==================== TMDB ====================

var serverTmdbGet = null;
var mirrorList = null;
var destroyed = false;

function fetchJson(url) {
    return new Promise(function (resolve, reject) {
        var done = false;
        var timer = setTimeout(function () {
            if (done) return;
            done = true;
            reject(new Error('timeout'));
        }, FETCH_TIMEOUT_MS);
        fetch(url).then(function (res) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (!res.ok) return reject(new Error('HTTP ' + res.status));
            res.json().then(resolve, reject);
        }, function (err) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            reject(err);
        });
    });
}

function getMirrors() {
    if (mirrorList) return Promise.resolve(mirrorList);
    return fetchJson(APIPROXY_URL + '?t=' + Date.now()).then(function (cfg) {
        var list = [];
        var raw = (cfg && Array.isArray(cfg.tmdb)) ? cfg.tmdb : [];
        for (var i = 0; i < raw.length; i++) {
            if (raw[i] && typeof raw[i].api === 'string' && raw[i].api) {
                list.push({ api: raw[i].api.replace(/\/+$/, ''), key: raw[i].key || DEFAULT_TMDB_KEY });
            }
        }
        mirrorList = list.length ? list : DEFAULT_TMDB_MIRRORS;
        return mirrorList;
    }, function () {
        mirrorList = DEFAULT_TMDB_MIRRORS;
        return mirrorList;
    });
}

function tmdbJsonOwn(pathAndQuery) {
    return getMirrors().then(function (mirrors) {
        function attempt(i) {
            var m = mirrors[i];
            var sep = pathAndQuery.indexOf('?') === -1 ? '?' : '&';
            return fetchJson(m.api + '/' + pathAndQuery + sep + 'api_key=' + encodeURIComponent(m.key))
                .catch(function (e) {
                    if (destroyed || i + 1 >= mirrors.length) throw e;
                    return attempt(i + 1);
                });
        }
        return attempt(0);
    });
}

/** GET к TMDB: зеркалами сервера (ctx.tmdbGet), при сбое — своими */
function tmdbJson(pathAndQuery) {
    if (serverTmdbGet) {
        return Promise.resolve(serverTmdbGet(pathAndQuery)).then(function (r) {
            if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : '?'));
            return r.json();
        }).catch(function () {
            if (destroyed) throw new Error('модуль остановлен');
            return tmdbJsonOwn(pathAndQuery);
        });
    }
    return tmdbJsonOwn(pathAndQuery);
}

/** Фильм/сериал TMDB → элемент выдачи, как в /api/tmdb/search/all */
function pickItem(item, mediaType) {
    var isTv = mediaType === 'tv';
    var title = isTv ? item.name : item.title;
    var out = {
        id: item.id,
        media_type: mediaType,
        title: title,
        name: title,
        vote_average: item.vote_average,
        vote_count: item.vote_count,
        overview: item.overview,
        poster_path: item.poster_path,
        backdrop_path: item.backdrop_path
    };
    if (isTv) out.first_air_date = item.first_air_date;
    else out.release_date = item.release_date;
    return out;
}

function itemKey(item) {
    return item.media_type + ':' + item.id;
}

/** Склеить списки без повторов, в порядке списков */
function mergeUnique(lists) {
    var seen = new Set();
    var out = [];
    lists.forEach(function (list) {
        list.forEach(function (item) {
            var key = itemKey(item);
            if (!seen.has(key)) { seen.add(key); out.push(item); }
        });
    });
    return out;
}

/** Выполнить запросы discover: { ok, items, partial } или { ok: false, reason } */
function runDiscover(requests) {
    return Promise.all(requests.map(function (r) {
        return tmdbJson(r.path).then(function (data) {
            var list = (data && Array.isArray(data.results)) ? data.results : [];
            return {
                ok: true,
                items: list.map(function (i) {
                    var out = pickItem(i, r.type);
                    out.popularity = i.popularity;
                    return out;
                })
            };
        }, function (e) {
            return { ok: false, reason: e && e.message };
        });
    })).then(function (pages) {
        var okPages = pages.filter(function (p) { return p.ok; });
        if (!okPages.length) return { ok: false, reason: pages[0] ? pages[0].reason : 'нет запросов' };
        return {
            ok: true,
            items: mergeUnique(okPages.map(function (p) { return p.items; })),
            partial: okPages.length < pages.length
        };
    });
}

// ==================== ВЫДАЧА ====================

var cache = new Map(); // key → { ts, results }

function cacheGet(key) {
    var hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
    // Свежее использование — в конец (Map хранит порядок вставки)
    cache.delete(key);
    cache.set(key, hit);
    return hit.results;
}

function cacheSet(key, results) {
    cache.set(key, { ts: Date.now(), results: results });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

/**
 * Одна тема с несколькими ключевыми словами — по списку на каждое слово, и
 * выше то, что нашлось в нескольких списках или стоит высоко в своём.
 *
 * Общий запрос «любое из слов» (with_keywords=a|b|c) сортируется только по
 * голосам, и наверх вылезает самое известное кино, где хоть одно слово
 * стоит мимоходом: «Назад в будущее» первым в «фильмах про любовь», «Тачки»
 * в «фильмах про бабушек». Фильм про тему обычно помечен несколькими её
 * словами — «Ford против Ferrari» есть и в «car race», и в «race car driver»,
 * и в «motorsport».
 *
 * Очки в списке: 1 / (1 + место / 10) — первое место 1, двадцатое ≈ 0,34.
 * Их сумма по спискам и есть порядок; при равенстве — rankItem.
 */
function rankedTopicDiscover(parsed) {
    var topic = parsed.topics[0];
    var ids = topicKeywordIds(topic).slice(0, KEYWORD_LISTS_MAX);
    var requests = [];
    ids.forEach(function (id) {
        buildDiscoverRequests(parsed, 'or', { keywords: String(id), pages: 1 }).forEach(function (r) { requests.push(r); });
    });
    return Promise.all(requests.map(function (r) {
        return tmdbJson(r.path).then(function (data) {
            var list = (data && Array.isArray(data.results)) ? data.results : [];
            return list.map(function (i) { return pickItem(i, r.type); });
        }, function () { return null; });
    })).then(function (lists) {
        var okLists = lists.filter(Boolean);
        if (!okLists.length) return { ok: false, reason: 'TMDB не ответил' };
        var score = new Map();
        var items = new Map();
        okLists.forEach(function (list) {
            list.forEach(function (item, pos) {
                var key = itemKey(item);
                if (!items.has(key)) items.set(key, item);
                score.set(key, (score.get(key) || 0) + 1 / (1 + pos / 10));
            });
        });
        var results = Array.from(items.values());
        results.sort(function (a, b) {
            return (score.get(itemKey(b)) - score.get(itemKey(a))) || (rankItem(b) - rankItem(a));
        });
        return { ok: true, items: results, partial: okLists.length < lists.length, presorted: true };
    });
}

/** Выдача discover по разобранному запросу, с кэшем */
function smartDiscover(parsed) {
    var key = cacheKey(parsed);
    var hit = cacheGet(key);
    if (hit) return Promise.resolve({ ok: true, results: hit, partial: false });

    var firstPass = (parsed.topics.length === 1 && parsed.topics[0].keywords.length > 1)
        ? rankedTopicDiscover(parsed)
        : runDiscover(buildDiscoverRequests(parsed, 'and'));
    return firstPass.then(function (first) {
        // Несколько тем вместе дали мало — добираем по любой из них
        if (parsed.topics.length > 1 && (!first.ok || first.items.length < AND_MIN_RESULTS)) {
            return runDiscover(buildDiscoverRequests(parsed, 'or')).then(function (wide) {
                if (!first.ok) return wide;
                if (!wide.ok) return first;
                return {
                    ok: true,
                    // Найденное по всем темам сразу — впереди, остальное — после
                    items: sortResults(first.items, parsed.sort).concat(sortResults(wide.items, parsed.sort)),
                    partial: first.partial || wide.partial,
                    presorted: true
                };
            });
        }
        return first;
    }).then(function (res) {
        if (!res.ok) return res;
        var results = res.presorted ? mergeUnique([res.items]) : sortResults(res.items, parsed.sort);
        results.forEach(function (item) { delete item.popularity; });
        // Неполную выдачу не кэшируем: следующий запрос соберёт целую
        if (!res.partial) cacheSet(key, results);
        return { ok: true, results: results, partial: res.partial };
    });
}

/** Поиск по названию — фильмы и сериалы, как /api/tmdb/search/all */
function searchByTitle(query) {
    var q = encodeURIComponent(query);
    return Promise.all(['movie', 'tv'].map(function (type) {
        return tmdbJson('search/' + type + '?query=' + q + '&language=ru-RU').then(function (data) {
            var list = (data && Array.isArray(data.results)) ? data.results : [];
            return list.map(function (i) { return pickItem(i, type); });
        }, function () { return null; });
    })).then(function (parts) {
        if (!parts[0] && !parts[1]) return null;
        var all = (parts[0] || []).concat(parts[1] || []);
        all.sort(function (a, b) { return (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0); });
        return all;
    });
}

/** Название начинается с запроса целым словом: «Тачки 2» для «тачки», но не «Тачкиада» */
function titleStartsWith(title, query) {
    var t = normalizeQuery(title);
    var q = normalizeQuery(query);
    return t === q || (t.indexOf(q) === 0 && !/[а-яa-z0-9]/.test(t.charAt(q.length)));
}

/** Запрос в кавычках — «точно по названию»: смысл не ищем */
function isQuoted(query) {
    return /^\s*["«“„'][^"«»“”„']+["»”'“]\s*$/.test(String(query || ''));
}

function handleSearch(query, log) {
    if (isQuoted(query)) return Promise.resolve({ success: true, smart: false });
    var parsed = parseSmartQuery(query);
    if (!parsed) return Promise.resolve({ success: true, smart: false });
    log.log('«' + query + '»: ' + parsed.chips.join(' · '));

    // По названию ищем всегда, даже для «фильмы про…»: бывают названия,
    // целиком похожие на запрос по смыслу, — «Про любовь», «Ужасы», «Пираты»
    return Promise.all([
        smartDiscover(parsed),
        searchByTitle(query)
    ]).then(function (both) {
        var found = both[0];
        var byTitle = both[1];
        // discover не ответил — пусть фронт ищет по названию сам
        if (!found.ok) {
            log.warn('«' + query + '»: ' + found.reason + ' — отдаём поиску по названию');
            return { success: true, smart: false };
        }
        var lists = [found.results];
        if (byTitle) {
            var q = normalizeQuery(query);
            var head, tail;
            if (parsed.explicit) {
                // «Фильмы про гонки»: наверх — только точное совпадение
                // названия («Про любовь»), остальные совпадения по названию
                // («Королевские гонки») в такой выдаче — шум
                head = byTitle.filter(function (item) { return normalizeQuery(item.title) === q; });
                tail = [];
            } else {
                // Одно слово («Тачки», «акулы»): наверх — названия, которые с
                // него начинаются, затем подборка по теме, остальное — в конец
                head = byTitle.filter(function (item) { return titleStartsWith(item.title, query); }).slice(0, TITLE_HEAD_MAX);
                tail = byTitle.filter(function (item) { return head.indexOf(item) === -1; });
            }
            lists = [head, found.results, tail];
        }
        return {
            success: true,
            smart: true,
            results: mergeUnique(lists),
            partial: found.partial,
            interpreted: { chips: parsed.chips }
        };
    });
}

// ==================== МОДУЛЬ ====================

module.exports = {
    name: 'smart-search',
    version: '1.0.0',

    init: function (app, ctx) {
        var log = ctx.log;
        destroyed = false;
        mirrorList = null;
        serverTmdbGet = typeof ctx.tmdbGet === 'function' ? ctx.tmdbGet : null;

        app.get('/api/smart-search', function (req, res) {
            var query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
            if (!query || query.length > 200) return res.status(400).json({ success: false, error: 'query: 1–200 символов' });
            handleSearch(query, log).then(function (out) {
                res.json(out);
            }, function (e) {
                log.error('«' + query + '»:', e && e.message);
                res.json({ success: true, smart: false });
            });
        });

        // Что модуль понял бы в запросе — для отладки словаря, без TMDB
        app.get('/api/smart-search/parse', function (req, res) {
            var query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
            var parsed = parseSmartQuery(query);
            res.json({
                success: true,
                smart: Boolean(parsed),
                chips: parsed ? parsed.chips : [],
                topics: parsed ? parsed.topics.map(function (t) { return t.id; }) : [],
                requests: parsed ? buildDiscoverRequests(parsed, 'and').map(function (r) { return r.path; }) : []
            });
        });

        ctx.onDestroy(function () { destroyed = true; });

        log.log('Поиск по смыслу: ' + TOPICS.length + ' тем');
        return { ready: true };
    },

    destroy: function () {
        destroyed = true;
        serverTmdbGet = null;
        cache.clear();
        console.log('[smart-search] Уничтожение...');
    }
};
