import { BadRequestException } from '@nestjs/common';
import { planDirectorySync } from './partner-directory.service';

/* Справочник партнёра приходит целиком: что пропало — выключается, но не
   удаляется (на юрлицо и авиакомпанию ссылаются тарифы). */
describe('planDirectorySync — справочник партнёра целиком', () => {
  const existing = [
    { code: 'kars-avia', isActive: true },
    { code: 'ani-group', isActive: true },
    { code: 'old', isActive: false },
  ];

  it('пропавшее из набора выключается, уже выключенное не трогается', () => {
    const plan = planDirectorySync(existing, [{ code: 'kars-avia', name: 'Карс Авиа' }]);
    expect(plan.deactivate).toEqual(['ani-group']);
    expect(plan.upsert.map((r) => r.code)).toEqual(['kars-avia']);
  });

  it('вернувшееся в набор снова в работе (upsert включает)', () => {
    const plan = planDirectorySync(existing, [
      { code: 'kars-avia', name: 'Карс Авиа' },
      { code: 'ani-group', name: 'Ани Групп Аэро' },
      { code: 'old', name: 'Старое' },
    ]);
    expect(plan.deactivate).toEqual([]);
    expect(plan.upsert).toHaveLength(3);
  });

  it('один код дважды в наборе — отказ, а не «последний победил»', () => {
    expect(() =>
      planDirectorySync([], [
        { code: 'FV', name: 'Россия' },
        { code: ' FV ', name: 'Россия 2' },
      ]),
    ).toThrow(BadRequestException);
  });

  it('пустой набор законен: всё выключается', () => {
    expect(planDirectorySync(existing, []).deactivate).toEqual(['kars-avia', 'ani-group']);
  });
});
