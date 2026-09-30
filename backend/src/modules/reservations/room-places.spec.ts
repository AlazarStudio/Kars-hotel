import { allocatePlace, placesOf } from './room-places';

/* Места в номере. Сформулировано отрицанием: «вот так в номер НЕ ложится».
   Дефект, ради которого написано: две брони по двое в одном двухместном. */

const couple = { adults: 2, children: 0 };
const single = { adults: 1, children: 0 };

describe('allocatePlace — обычная гостиница (продажа по местам выключена)', () => {
  it('вторая бронь НЕ ложится в номер, где уже живёт первая — даже одиночная в двухместный', () => {
    const others = [{ placeNumber: 1, adults: 1, children: 0 }];
    expect(allocatePlace({ capacity: 2, multiPlace: false, guests: single, others })).toBeNull();
  });

  it('две брони по двое в двухместном — НЕ ложатся (пилот, «Кавказ», номер 208)', () => {
    const others = [{ placeNumber: 1, adults: 2, children: 0 }];
    expect(allocatePlace({ capacity: 2, multiPlace: false, guests: couple, others })).toBeNull();
  });

  it('пустой номер — место 1', () => {
    expect(allocatePlace({ capacity: 2, multiPlace: false, guests: couple, others: [] })).toBe(1);
  });

  it('бронь занимает номер целиком', () => {
    expect(placesOf(single, 3, false)).toBe(3);
  });
});

describe('allocatePlace — койко-места (продажа по местам включена)', () => {
  it('бронь на двоих занимает два места: третьему в трёхместном место есть, двоим — нет', () => {
    const others = [{ placeNumber: 1, adults: 2, children: 0 }];
    expect(allocatePlace({ capacity: 3, multiPlace: true, guests: single, others })).toBe(3);
    expect(allocatePlace({ capacity: 3, multiPlace: true, guests: couple, others })).toBeNull();
  });

  it('ребёнок тоже занимает место', () => {
    const others = [{ placeNumber: 1, adults: 1, children: 1 }];
    expect(allocatePlace({ capacity: 2, multiPlace: true, guests: single, others })).toBeNull();
  });

  it('свободное место в середине находится', () => {
    const others = [
      { placeNumber: 1, adults: 1, children: 0 },
      { placeNumber: 3, adults: 1, children: 0 },
    ];
    expect(allocatePlace({ capacity: 3, multiPlace: true, guests: single, others })).toBe(2);
  });
});
