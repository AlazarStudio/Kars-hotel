/* ОПИСАНИЕ ГОСТИНИЦЫ ПО РАЗДЕЛАМ (перенос из старой системы, 9e542a73 +
 * b5ad8515; сверка 01.10.2026).
 *
 * Описание хранится по-прежнему одним текстом в `tenant.description` —
 * строками «Лейбл: значение», которыми размечены почти все перенесённые
 * описания (замер 01.10.2026: 362 из 364). Его же показывает Kars Avia в
 * карточке гостиницы, поэтому формат хранения не меняется: модуль разбирает
 * текст в состояние редактора и собирает обратно.
 *
 * Главное правило разбора — ничего не угадывать и ничего не терять: кусок
 * текста становится галкой, только если целиком совпал с пунктом словаря или
 * его синонимом. Всё остальное дословно остаётся в «Другое»/«Уточнение», а
 * строки без знакомого лейбла (рекламный абзац, «Проживание с животными: …») —
 * в «Прочее».
 *
 * Словари — из старой системы, слово в слово: синонимы собраны по реальным
 * описаниям, и их расхождение молча превратило бы галку в «Другое».
 */

export const ABOUT_LABELS = {
  name: 'Название гостиницы',
  location: 'Локация',
  infrastructure: 'Инфраструктура',
  facility: 'Оснащение объекта',
  rooms: 'Оснащение номерного фонда',
  laundry: 'Услуги прачечной/глажки',
  other: 'Прочее',
};

// Пункт словаря: подпись на чипе, вид в тексте описания и синонимы из
// реальных описаний. Подпись и вид в тексте тоже считаются синонимами.
const item = (key, label, text, synonyms = []) => ({ key, label, text, synonyms });

export const INFRASTRUCTURE_ITEMS = [
  item('pharmacy', 'Аптека', 'аптека', ['аптеки']),
  item('supermarket', 'Супермаркет', 'супермаркет', ['супермаркеты', 'гипермаркет', 'продуктовый магазин', 'продуктовые магазины']),
  item('shops', 'Магазины', 'магазины', ['магазин']),
  item('mall', 'Торговый центр', 'торговый центр', ['тц', 'трц', 'торговые центры', 'торгово-развлекательный центр']),
  item('cafe', 'Кафе и рестораны', 'кафе и рестораны', ['кафе', 'ресторан', 'рестораны', 'кафе и ресторан', 'столовая', 'столовые']),
  item('bank', 'Банк / банкомат', 'банк и банкоматы', ['банк', 'банки', 'банкомат', 'банкоматы', 'отделение банка']),
  item('transport', 'Остановка транспорта', 'остановка общественного транспорта', ['остановка', 'остановки', 'остановка транспорта', 'остановки общественного транспорта']),
  item('railway', 'Ж/д вокзал', 'железнодорожный вокзал', ['вокзал', 'жд вокзал', 'ж/д вокзал', 'ж/д станция']),
  item('busStation', 'Автовокзал', 'автовокзал'),
  item('airport', 'Аэропорт', 'аэропорт'),
  item('park', 'Парк / сквер', 'парк', ['сквер', 'парки', 'городской парк']),
  item('beach', 'Пляж / набережная', 'пляж и набережная', ['пляж', 'набережная', 'море']),
  item('hospital', 'Больница / поликлиника', 'больница', ['поликлиника', 'травмпункт']),
  item('beauty', 'Салон красоты', 'салон красоты', ['парикмахерская']),
  item('sights', 'Достопримечательности', 'достопримечательности', ['музей', 'музеи', 'театр']),
  item('cityCentre', 'Центр города', 'центр города'),
];

export const FACILITY_ITEMS = [
  item('parking', 'Парковка', 'парковка', ['автостоянка', 'стоянка', 'паркинг', 'бесплатная парковка', 'охраняемая парковка', 'парковочные места']),
  item('conference', 'Конференц-зал', 'конференц-зал', ['конференц зал', 'конференц-залы', 'конференц залы', 'переговорная']),
  item('luggage', 'Камера хранения', 'камера хранения багажа', ['камера хранения', 'хранение багажа']),
  item('elevator', 'Лифт', 'лифт', ['лифты']),
  item('restaurant', 'Ресторан', 'ресторан'),
  item('cafe', 'Кафе / столовая', 'кафе', ['столовая']),
  item('bar', 'Бар / лобби-бар', 'лобби-бар', ['бар', 'лобби бар', 'кафе-бар']),
  item('wifi', 'Wi-Fi', 'Wi-Fi', ['wifi', 'wi fi', 'вай-фай', 'вай фай', 'бесплатный wi-fi']),
  item('sauna', 'Сауна', 'сауна'),
  item('bathhouse', 'Баня / хамам', 'баня', ['хамам', 'турецкая баня', 'русская баня']),
  item('pool', 'Бассейн', 'бассейн'),
  item('gym', 'Тренажёрный зал', 'тренажёрный зал', ['тренажерный зал', 'фитнес зал', 'фитнес-зал', 'спортзал', 'спортивный зал', 'фитнес-центр', 'фитнес центр']),
  item('spa', 'СПА', 'спа', ['spa', 'спа-центр', 'spa-центр', 'spa центр', 'спа центр']),
  item('banquet', 'Банкетный зал', 'банкетный зал'),
  item('reception24', 'Круглосуточная стойка регистрации', 'круглосуточная стойка регистрации', ['круглосуточный ресепшн', 'круглосуточная регистрация']),
  item('cooler', 'Кулер на этажах', 'кулер на этажах', ['кулер на этаже', 'кулер', 'кулер с водой', 'кулеры на этажах', 'кулеры']),
  item('sharedFridge', 'Общий холодильник', 'холодильник', ['общий холодильник']),
  item('airConditioning', 'Кондиционирование', 'сплит-система', ['кондиционер', 'кондиционирование']),
  item('souvenirs', 'Сувенирный магазин', 'сувенирный магазин', ['сувенирная лавка']),
  item('shoeShine', 'Чистка обуви', 'чистка обуви'),
  item('sewing', 'Швейные принадлежности', 'швейные принадлежности', ['предоставление швейных принадлежностей']),
  item('concierge', 'Услуги консьержа', 'услуги консьержа', ['консьерж']),
  item('excursions', 'Экскурсии', 'экскурсии'),
  item('billiards', 'Бильярд', 'бильярд', ['бильярдная']),
  item('tableTennis', 'Настольный теннис', 'настольный теннис'),
  item('beauty', 'Салон красоты', 'салон красоты', ['парикмахерская']),
  item('playground', 'Детская площадка', 'детская площадка'),
  item('terrace', 'Терраса', 'терраса', ['веранда', 'летняя веранда', 'летняя терраса']),
  item('library', 'Библиотека', 'библиотека'),
  item('phone', 'Телефон', 'телефон'),
  item('laundry', 'Прачечная', 'прачечная'),
  item('electronicLocks', 'Электронные замки', 'электронные замки', ['электронный замок']),
  item('massage', 'Массаж', 'массажный кабинет', ['массаж', 'массажные услуги']),
  item('kitchen', 'Общая кухня', 'общая кухня', ['кухня']),
  item('lunchbox', 'Ланч-боксы', 'ланч-боксы', ['ланч боксы', 'ланчбоксы', 'предоставление ланч-боксов', 'предоставление ланч боксов']),
  item('businessCentre', 'Бизнес-центр', 'бизнес-центр', ['бизнес центр']),
  item('microwave', 'Микроволновая печь', 'микроволновая печь', ['микроволновка']),
  item('atm', 'Банкомат', 'банкомат', ['банкомат на территории отеля', 'банкомат на территории']),
  item('bikeRental', 'Прокат велосипедов', 'прокат велосипедов'),
  item('roomService', 'Доставка еды в номер', 'доставка еды и напитков в номер', ['доставка еды в номер', 'обслуживание номеров', 'рум-сервис']),
  item('dietMenu', 'Диетическое меню', 'диетическое меню по запросу', ['диетическое меню', 'специальное диетическое меню по запросу']),
  item('kidsMenu', 'Детское меню', 'детское меню'),
  item('jacuzzi', 'Джакузи', 'гидромассажная ванна/джакузи', ['джакузи', 'гидромассажная ванна']),
  item('solarium', 'Солярий', 'солярий'),
  item('relaxZone', 'Зона отдыха', 'зона отдыха'),
  item('boardGames', 'Настольные игры', 'настольные игры', ['настольные игры/пазлы']),
  item('babyCot', 'Детская кроватка', 'детская кровать', ['детская кроватка']),
];

export const ROOM_GROUPS = [
  {
    title: 'Мебель',
    items: [
      item('bed', 'Кровать', 'кровать', ['кровати', 'двуспальная кровать', 'односпальная кровать', 'двуспальные кровати', 'односпальные кровати']),
      item('sofa', 'Диван', 'диван'),
      item('wardrobe', 'Шкаф', 'шкаф', ['шкаф для одежды', 'гардероб', 'платяной шкаф', 'шкаф/гардероб']),
      item('nightstands', 'Прикроватные тумбы', 'прикроватные тумбы', ['прикроватные тумбочки', 'прикроватная тумба', 'тумбочки', 'тумбочка', 'тумбы', 'тумба']),
      item('desk', 'Рабочий стол', 'рабочий стол', ['письменный стол', 'стол']),
      item('chairs', 'Стулья', 'стулья', ['стул']),
      item('armchairs', 'Кресла', 'кресла', ['кресло']),
      item('hangers', 'Вешалки', 'вешалки', ['вешалка', 'плечики']),
      item('mirror', 'Зеркало', 'зеркало', ['настенное зеркало']),
      item('coffeeTable', 'Журнальный столик', 'журнальный столик'),
      item('orthoMattress', 'Ортопедический матрас', 'ортопедический матрас'),
    ],
  },
  {
    title: 'Техника',
    items: [
      item('wifi', 'Wi-Fi', 'Wi-Fi', ['wifi', 'wi fi', 'вай-фай', 'вай фай', 'бесплатный wi-fi', 'высокоскоростной wi-fi']),
      item('tv', 'Телевизор', 'телевизор', ['тв', 'телевизор с плоским экраном', 'жк-телевизор', 'спутниковое телевидение', 'кабельное телевидение', 'жк телевизор']),
      item('airConditioning', 'Кондиционер', 'кондиционер', ['сплит-система', 'кондиционирование', 'система кондиционирования']),
      item('fridge', 'Холодильник', 'холодильник', ['мини-холодильник']),
      item('minibar', 'Мини-бар', 'мини-бар', ['минибар']),
      item('kettle', 'Чайник', 'чайник', ['электрический чайник', 'электрочайник']),
      item('phone', 'Телефон', 'телефон'),
      item('safe', 'Сейф', 'сейф'),
      item('hairdryer', 'Фен', 'фен'),
      item('heating', 'Отопление', 'отопление'),
      item('electronicLocks', 'Электронные замки', 'электронные замки', ['электронный замок']),
      item('soundproofing', 'Звукоизоляция', 'звукоизоляция', ['звуконепроницаемые стены и окна', 'шумоизоляция']),
      item('iron', 'Утюг', 'утюг', ['утюг и гладильная доска', 'гладильная доска', 'гладильные принадлежности']),
      item('ventilation', 'Вентиляция', 'система вентиляции', ['вентиляция', 'вентилятор']),
      item('alarmClock', 'Будильник', 'будильник'),
    ],
  },
  {
    title: 'Ванная',
    items: [
      item('bathroom', 'Санузел', 'санузел', ['ванная комната', 'собственная ванная комната', 'туалет']),
      item('shower', 'Ванна или душ', 'ванна или душевая кабина', ['душевая кабина', 'душ', 'ванна', 'ванна или душ', 'душевая']),
      item('sink', 'Раковина', 'раковина'),
      item('towels', 'Полотенца', 'полотенца', ['банные полотенца', 'набор полотенец']),
      item('bathrobes', 'Халаты', 'халаты', ['халат', 'банный халат', 'банные халаты']),
      item('slippers', 'Тапочки', 'тапочки', ['тапки']),
      item('toiletries', 'Гигиенические принадлежности', 'гигиенические принадлежности', ['косметические принадлежности', 'туалетные принадлежности', 'средства гигиены', 'гигиенические средства', 'туалетно-косметические принадлежности']),
    ],
  },
  {
    title: 'Прочее',
    items: [
      item('teaSet', 'Чайный набор', 'чайный набор', ['принадлежности для чая и кофе', 'набор для чая', 'чайная станция', 'чай/кофе']),
      item('water', 'Питьевая вода', 'бутилированная вода', ['питьевая вода', 'вода']),
      item('linen', 'Постельное бельё', 'постельное бельё'),
      item('blackout', 'Шторы блэкаут', 'шторы блэкаут', ['шторы black-out', 'шторы blackout', 'шторы блэк-аут', 'светонепроницаемые шторы']),
      item('lamps', 'Светильники', 'светильники', ['светильник', 'настольные лампы', 'настольная лампа']),
      item('glassware', 'Посуда', 'посуда', ['стаканы', 'стакан', 'набор посуды', 'чашки']),
      item('carpet', 'Ковровое покрытие', 'ковровое покрытие'),
      item('pillows', 'Подушки и одеяла', 'подушки и одеяла', ['подушки', 'одеяла', 'подушка', 'одеяло']),
      item('mosquitoNet', 'Москитная сетка', 'москитная сетка'),
      item('balcony', 'Балкон', 'балкон'),
    ],
  },
];

export const ROOM_ITEMS = ROOM_GROUPS.flatMap((group) => group.items);

const DICTIONARIES = {
  infrastructure: INFRASTRUCTURE_ITEMS,
  facility: FACILITY_ITEMS,
  rooms: ROOM_ITEMS,
};

// Варианты лейблов из реальных описаний → раздел (ключи нормализованы).
const LABEL_ALIASES = {
  'название гостиницы': 'name',
  'название объекта': 'name',
  'название': 'name',
  'гостиница': 'name',
  'локация': 'location',
  'расположение': 'location',
  'адрес': 'location',
  'инфраструктура': 'infrastructure',
  'оснащение объекта': 'facility',
  'оснащение гостиницы': 'facility',
  'оснащение номерного фонда': 'rooms',
  'оснащение номеров': 'rooms',
  'оснащение номероы': 'rooms',
  'услуги прачечной/глажки': 'laundry',
  'услуги прачечной/стирки': 'laundry',
  'услуги прачечной': 'laundry',
  'услуги прачечной и глажки': 'laundry',
  'прочее': 'other',
};

// Шаблонные фразы раздела прачечной. Переключатели ставятся ТОЛЬКО по ним:
// если бы их включали слова в комментарии («гладильная комната»), глажка
// включалась бы при каждом перечитывании и цикл «собрал → разобрал» не сходился.
const LAUNDRY_ON = { laundry: true };
const IRONING_ON = { ironing: true };
const BOTH_ON = { laundry: true, ironing: true };
const BOTH_OFF = { laundry: false, ironing: false };
const LAUNDRY_PHRASES = new Map([
  ...[
    'есть прачечная',
    'на территории гостиницы есть прачечная',
    'на территории есть прачечная',
    'прачечная есть',
    'прачечная имеется',
    'имеется прачечная',
    'прачечная',
    'прачечная на территории',
    'услуги прачечной',
    'стирка',
    'стирка и сушка белья и одежды',
    'предоставляются услуги прачечной',
    'услуги прачечной предоставляются',
    'услуги прачечной имеются',
  ].map((phrase) => [phrase, LAUNDRY_ON]),
  ...[
    'есть услуги глажки',
    'так же предоставляют услуги глажки',
    'также предоставляют услуги глажки',
    'предоставляют услуги глажки',
    'услуги глажки',
    'глажка',
    'глажение',
    'глажка на территории',
    'гладильная на территории',
    'гладильная на этаже',
    'гладильная комната',
    'имеется гладильная комната',
    'так же предоставляются услуги глажки',
    'также предоставляются услуги глажки',
    'гладильные услуги',
    'глажка есть',
    'предоставляется утюг и гладильная доска',
  ].map((phrase) => [phrase, IRONING_ON]),
  ...[
    'предоставляются',
    'есть',
    'имеются',
    'предоставляют услуги прачечной и глажки',
    'есть прачечная и глажка',
    'прачечная и глажка',
    'услуги прачечной и глажки предоставляются',
    'предоставляются услуги прачечной и глажки',
    'услуги прачечной и глажки',
  ].map((phrase) => [phrase, BOTH_ON]),
  ...[
    'нет',
    'отсутствуют',
    'отсутствует',
    'не предоставляются',
    'услуги не предоставляются',
    'не оказываются',
    'не предоставляют',
  ].map((phrase) => [phrase, BOTH_OFF]),
]);

// Лейбл — текст до первого двоеточия в начале строки.
const LABEL_RE = /^([^:\n]{2,60}):[ \t]*(.*)$/;

export function emptyHotelAbout() {
  return {
    infrastructure: { checked: [], extra: '' },
    facility: { checked: [], extra: '' },
    rooms: { checked: [], extra: '' },
    laundry: { laundry: false, ironing: false, extra: '' },
    other: '',
  };
}

function normalizePhrase(text) {
  return String(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"“”„]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—•·*]+/, '')
    .replace(/[\s.;:!]+$/, '')
    .trim();
}

function normalizeLabel(text) {
  return normalizePhrase(text).replace(/\s*\/\s*/g, '/');
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function buildMatcher(items) {
  const byPhrase = new Map();
  for (const entry of items) {
    for (const phrase of [entry.label, entry.text, ...entry.synonyms]) {
      const normalized = normalizePhrase(phrase);
      if (normalized && !byPhrase.has(normalized)) byPhrase.set(normalized, entry.key);
    }
  }
  return byPhrase;
}

const MATCHERS = Object.fromEntries(
  Object.entries(DICTIONARIES).map(([section, items]) => [section, buildMatcher(items)]),
);

// Куски значения со своими разделителями: «a, b. c» → a|", " b|". " c|"".
function tokenize(text) {
  const parts = text.split(/(\s*[,;]\s*|\.\s+|\n+)/);
  const tokens = [];
  for (let i = 0; i < parts.length; i += 2) {
    tokens.push({ text: parts[i], sep: parts[i + 1] ?? '' });
  }
  return tokens;
}

// Несъеденные куски — с их собственными разделителями, без висячих краёв.
function joinLeftover(tokens) {
  return tokens
    .map((token) => token.text + token.sep)
    .join('')
    .replace(/^[\s,;.]+/, '')
    .replace(/[\s,;]+$/, '')
    .trim();
}

function readList(value, matcher) {
  const found = new Set();
  const kept = [];
  for (const token of tokenize(value)) {
    const key = matcher.get(normalizePhrase(token.text));
    if (key) found.add(key);
    else if (token.text.trim()) kept.push(token);
  }
  return { found, extra: joinLeftover(kept) };
}

function readLaundry(value) {
  const flags = {};
  const kept = [];
  for (const token of tokenize(value)) {
    const effect = LAUNDRY_PHRASES.get(normalizePhrase(token.text));
    if (effect) Object.assign(flags, effect);
    else if (token.text.trim()) kept.push(token);
  }
  return { flags, extra: joinLeftover(kept) };
}

/** «Прочее»: строки дословно, пустые между абзацами схлопываются в одну. */
function tidyOther(lines) {
  return lines
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Текст описания → состояние редактора. Название и локация не читаются —
 * при сборке они берутся из карточки гостиницы.
 */
export function parseHotelAbout(text) {
  const state = emptyHotelAbout();
  if (typeof text !== 'string' || !text.trim()) return state;

  const found = { infrastructure: new Set(), facility: new Set(), rooms: new Set() };
  const extras = { infrastructure: [], facility: [], rooms: [], laundry: [] };
  const otherLines = [];

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/ /g, ' ').trim();
    const match = LABEL_RE.exec(line);
    const section = match ? LABEL_ALIASES[normalizeLabel(match[1])] : undefined;
    if (!section) {
      otherLines.push(line);
      continue;
    }

    const value = match[2].trim();
    if (!value || section === 'name' || section === 'location') continue;

    if (section === 'other') {
      otherLines.push(value);
    } else if (section === 'laundry') {
      const { flags, extra } = readLaundry(value);
      Object.assign(state.laundry, flags);
      if (extra) extras.laundry.push(extra);
    } else {
      const { found: keys, extra } = readList(value, MATCHERS[section]);
      keys.forEach((key) => found[section].add(key));
      if (extra) extras[section].push(extra);
    }
  }

  for (const section of ['infrastructure', 'facility', 'rooms']) {
    state[section] = {
      checked: DICTIONARIES[section]
        .filter((entry) => found[section].has(entry.key))
        .map((entry) => entry.key),
      // Уточнение инфраструктуры в тексте идёт отдельным предложением.
      extra:
        section === 'infrastructure'
          ? capitalize(extras[section].join('. '))
          : extras[section].join(', '),
    };
  }
  state.laundry.extra = capitalize(extras.laundry.join('. '));
  state.other = tidyOther(otherLines);
  return state;
}

const oneLine = (value) => String(value || '').replace(/\s*\n+\s*/g, ' ').trim();

function listText(items, section, sentenceExtra) {
  const checked = new Set(section?.checked || []);
  const head = items
    .filter((entry) => checked.has(entry.key))
    .map((entry) => entry.text)
    .join(', ');
  const extra = oneLine(section?.extra);
  if (!extra) return head;
  if (!head) return sentenceExtra ? capitalize(extra) : extra;
  return sentenceExtra ? `${head}. ${capitalize(extra)}` : `${head}, ${extra}`;
}

function laundryText(laundry) {
  const parts = [];
  if (laundry?.laundry) parts.push('есть прачечная');
  if (laundry?.ironing) parts.push('есть услуги глажки');
  const head = parts.join(', ');
  const extra = capitalize(oneLine(laundry?.extra));
  if (!extra) return head;
  return head ? `${head}. ${extra}` : extra;
}

/**
 * Состояние редактора → текст описания: строки «Лейбл: значение», раздел без
 * содержимого не пишется; «Прочее» — абзацем без лейбла после пустой строки,
 * как рекламный текст в перенесённых описаниях (иначе первое же сохранение
 * переписало бы его вид).
 */
export function buildHotelAboutText(state, { name = '', location = '' } = {}) {
  const about = state || emptyHotelAbout();
  const rows = [
    [ABOUT_LABELS.name, oneLine(name)],
    [ABOUT_LABELS.location, oneLine(location)],
    [ABOUT_LABELS.infrastructure, listText(INFRASTRUCTURE_ITEMS, about.infrastructure, true)],
    [ABOUT_LABELS.facility, listText(FACILITY_ITEMS, about.facility, false)],
    [ABOUT_LABELS.rooms, listText(ROOM_ITEMS, about.rooms, false)],
    [ABOUT_LABELS.laundry, laundryText(about.laundry)],
  ];
  const head = rows
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
  const other = tidyOther(String(about.other || '').split('\n'));
  return [head, other].filter(Boolean).join('\n\n');
}

/** Локация для описания — город и адрес карточки. */
export function aboutLocationLine(hotel) {
  return [hotel?.city, hotel?.address]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
}

/** Подписи отмеченной инфраструктуры — теги «рядом» в карточке Kars Avia. */
export function infrastructureTags(state) {
  const checked = new Set(state?.infrastructure?.checked || []);
  return INFRASTRUCTURE_ITEMS.filter((entry) => checked.has(entry.key)).map((entry) => entry.label);
}
