/* ОПИСАНИЕ ГОСТИНИЦЫ ПО РАЗДЕЛАМ — проверки (перенос тестов старой системы
 * на текстовый формат PMS, 01.10.2026).
 *
 * Запуск: `npm test` (встроенный `node --test`, без зависимостей).
 *
 * Разбор ломается молча: лишняя галка припишет гостинице бассейн, потерянный
 * кусок исчезнет из описания при первом же сохранении. Поэтому главное здесь —
 * «ничего не угадано» и «ничего не потеряно» (цикл «разобрал → собрал →
 * разобрал» сходится). */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aboutLocationLine,
  buildHotelAboutText,
  emptyHotelAbout,
  infrastructureTags,
  parseHotelAbout,
} from './hotelAbout.js';

// «Азия» старой системы — теперь текстом, как лежит в PMS.
const AZIA = [
  'Название гостиницы: Азия 4*',
  'Локация: Абакан, ул. Кирова, 114.',
  'Инфраструктура: Парк, магазин Альпина маркет, Красное и Белое, кафе Кира, Чайхана, Мадрид.',
  'Оснащение объекта: На территории отеля есть ресторан «Food&Bar 114», лобби-бар, тренажёрный зал, сауна с бассейном.',
  'Оснащение номерного фонда: Удобная, эргономичная мебель, система кондиционирования, спутниковое телевидение, высокоскоростной Wi-Fi, мини-бар, сейф, принадлежности для чая и кофе – во всех номерах отеля.',
  'Услуги прачечной/глажки: Услуги прачечной предоставляются/глажка - на каждом этаже гладильная комната.',
].join('\n');

const PALLADA = [
  'Название гостиницы: Паллада',
  'Локация: г.Новокузнецк, ул. Лазов, 18.',
  'Оснащение объекта: Спортивный зал, сауна с бассейном, салон красоты и здоровья, конференц-зал, парковка, лифт, комната отдыха.',
  'Оснащение номерного фонда: Кровать, постельное белье, санузел, раковина, шторы black-out, тумбочки, шкаф, вешалки, письменный стол, кресла, светильник, Wi-Fi, спутниковое телевидение, душевая кабина.',
].join('\n');

// Варианты лейблов, чужой раздел и строка без лейбла.
const PLAIN = [
  'Название объекта: Волна',
  'Локация: ',
  'Оснащение номеров: Фен, чайник',
  'Услуги прачечной/стирки: На территории гостиницы есть прачечная, так же предоставляют услуги глажки.',
  'Проживание с животными: разрешено',
  'Описание',
].join('\n');

// Реальное описание из PMS (01.10.2026): разделы и рекламный абзац после пустой строки.
const SKYLINE = [
  'Название гостиницы: Skyline',
  'Локация:Томск',
  'Инфраструктура: аэропорт в 5 минутах пешком',
  'Оснащение объекта: кондиционер, светонепроницаемые шторы и шумоизоляция, Wi-Fi',
  'Оснащение номерного фонда:ортопедический матрас, телевизор, WIFI, тапочки, одноразовые принадлежности, питьевая вода.',
  'Услуги прачечной/стирки:согласно договору',
  '',
  'Отель «Skyline» - современный отель, расположенный на 4 этаже нового здания.',
].join('\n');

const EMPTY_TEMPLATE = [
  'Название гостиницы: ',
  'Локация: ',
  'Инфраструктура: ',
  'Оснащение объекта: ',
  'Оснащение номерного фонда: ',
  'Услуги прачечной/глажки: ',
].join('\n');

test('«Азия»: галки — только целые совпадения, остальное дословно', () => {
  assert.deepEqual(parseHotelAbout(AZIA), {
    infrastructure: {
      checked: ['park'],
      extra: 'Магазин Альпина маркет, Красное и Белое, кафе Кира, Чайхана, Мадрид.',
    },
    facility: {
      checked: ['bar', 'gym'],
      extra: 'На территории отеля есть ресторан «Food&Bar 114», сауна с бассейном.',
    },
    rooms: {
      checked: ['wifi', 'tv', 'airConditioning', 'minibar', 'safe'],
      extra: 'Удобная, эргономичная мебель, принадлежности для чая и кофе – во всех номерах отеля.',
    },
    laundry: {
      laundry: false,
      ironing: false,
      extra: 'Услуги прачечной предоставляются/глажка - на каждом этаже гладильная комната.',
    },
    other: '',
  });
});

test('«Паллада»: синонимы сводятся к пунктам, порядок — словаря', () => {
  const state = parseHotelAbout(PALLADA);
  assert.deepEqual(state.facility, {
    checked: ['parking', 'conference', 'elevator', 'gym'],
    extra: 'сауна с бассейном, салон красоты и здоровья, комната отдыха.',
  });
  assert.deepEqual(state.rooms.checked, [
    'bed', 'wardrobe', 'nightstands', 'desk', 'armchairs', 'hangers',
    'wifi', 'tv', 'bathroom', 'shower', 'sink', 'linen', 'blackout', 'lamps',
  ]);
  assert.equal(state.rooms.extra, '');
});

test('варианты лейблов; чужие разделы и строки без лейбла — в «Прочее»', () => {
  const state = parseHotelAbout(PLAIN);
  assert.deepEqual(state.rooms, { checked: ['kettle', 'hairdryer'], extra: '' });
  assert.deepEqual(state.laundry, { laundry: true, ironing: true, extra: '' });
  assert.equal(state.other, 'Проживание с животными: разрешено\nОписание');
  assert.deepEqual(state.infrastructure, { checked: [], extra: '' });
});

test('реальное описание PMS: лейбл без пробела, рекламный абзац уходит в «Прочее» целиком', () => {
  const state = parseHotelAbout(SKYLINE);
  assert.deepEqual(state.infrastructure, { checked: [], extra: 'Аэропорт в 5 минутах пешком' });
  assert.deepEqual(state.rooms, {
    checked: ['orthoMattress', 'wifi', 'tv', 'slippers', 'water'],
    extra: 'одноразовые принадлежности',
  });
  assert.equal(state.laundry.extra, 'Согласно договору');
  assert.equal(state.other, 'Отель «Skyline» - современный отель, расположенный на 4 этаже нового здания.');
});

test('незаполненный шаблон — пустое состояние; пустые разделы не пишутся', () => {
  assert.deepEqual(parseHotelAbout(EMPTY_TEMPLATE), emptyHotelAbout());
  assert.equal(
    buildHotelAboutText(parseHotelAbout(EMPTY_TEMPLATE), { name: 'Сочи', location: '' }),
    'Название гостиницы: Сочи',
  );
});

test('прачечная «отсутствуют» — переключатели выключены, раздел не пишется', () => {
  const state = parseHotelAbout('Название гостиницы: Х\nУслуги прачечной/глажки: отсутствуют');
  assert.deepEqual(state.laundry, { laundry: false, ironing: false, extra: '' });
  assert.equal(buildHotelAboutText(state, { name: 'Х' }), 'Название гостиницы: Х');
});

test('сборка: порядок разделов, текстовый вид галок, «Прочее» абзацем без лейбла', () => {
  const state = {
    ...emptyHotelAbout(),
    facility: { checked: ['parking', 'wifi'], extra: 'бильярдная комната' },
    laundry: { laundry: true, ironing: false, extra: 'круглосуточно' },
    other: 'Рядом море.',
  };
  assert.equal(
    buildHotelAboutText(state, { name: 'Паллада', location: 'Новокузнецк, ул. Лазо, 18' }),
    [
      'Название гостиницы: Паллада',
      'Локация: Новокузнецк, ул. Лазо, 18',
      'Оснащение объекта: парковка, Wi-Fi, бильярдная комната',
      'Услуги прачечной/глажки: есть прачечная. Круглосуточно',
      '',
      'Рядом море.',
    ].join('\n'),
  );
});

test('перевод строки в поле раздела НЕ разрывает строку раздела', () => {
  const state = { ...emptyHotelAbout(), facility: { checked: [], extra: 'бар\nбассейн' } };
  assert.equal(buildHotelAboutText(state), 'Оснащение объекта: бар бассейн');
});

test('цикл: разобранное после сборки читается тем же', () => {
  const meta = { name: 'Гостиница', location: 'Город, улица, 1' };
  for (const text of [AZIA, PALLADA, PLAIN, SKYLINE, EMPTY_TEMPLATE]) {
    const first = parseHotelAbout(text);
    assert.deepEqual(parseHotelAbout(buildHotelAboutText(first, meta)), first);
  }
});

test('прачечная: частые фразы включают переключатели', () => {
  const on = parseHotelAbout('Услуги прачечной/глажки: Услуги прачечной и глажки предоставляются.');
  assert.deepEqual(on.laundry, { laundry: true, ironing: true, extra: '' });
  const off = parseHotelAbout('Услуги прачечной/глажки: не предоставляют');
  assert.deepEqual(off.laundry, { laundry: false, ironing: false, extra: '' });
});

test('оснащение объекта и номерной фонд: добранные синонимы', () => {
  assert.deepEqual(
    parseHotelAbout(
      'Оснащение объекта: Телефон, массажный кабинет, spa-центр, предоставление ланч-боксов, кафе-бар, кулеры на этажах, летняя веранда.',
    ).facility,
    { checked: ['bar', 'spa', 'cooler', 'terrace', 'phone', 'massage', 'lunchbox'], extra: '' },
  );
  assert.deepEqual(
    parseHotelAbout(
      'Оснащение номерного фонда: Гигиенические средства, набор полотенец, стаканы, ковровое покрытие, подушки, банный халат, журнальный столик, тумба, утюг, шкаф/гардероб, настенное зеркало.',
    ).rooms,
    {
      checked: [
        'wardrobe', 'nightstands', 'mirror', 'coffeeTable', 'iron',
        'towels', 'bathrobes', 'toiletries', 'glassware', 'carpet', 'pillows',
      ],
      extra: '',
    },
  );
});

test('пустое и не-строка — пустое состояние', () => {
  assert.deepEqual(parseHotelAbout(''), emptyHotelAbout());
  assert.deepEqual(parseHotelAbout(null), emptyHotelAbout());
  assert.deepEqual(parseHotelAbout(undefined), emptyHotelAbout());
});

test('локация — город и адрес карточки; теги инфраструктуры — подписи отмеченного', () => {
  assert.equal(aboutLocationLine({ city: 'Абакан', address: 'ул. Кирова, 114' }), 'Абакан, ул. Кирова, 114');
  assert.equal(aboutLocationLine({ city: '', address: 'ул. Мира, 1' }), 'ул. Мира, 1');
  assert.equal(aboutLocationLine(undefined), '');
  assert.deepEqual(
    infrastructureTags({ ...emptyHotelAbout(), infrastructure: { checked: ['park', 'pharmacy'], extra: '' } }),
    ['Аптека', 'Парк / сквер'],
  );
});
