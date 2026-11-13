import { mergeContractList } from './contract-list';

/* «Реестр ∪ приложения»: гостиница не должна терять договор, о котором знает
 * только по ценам, и должна видеть договор, у которого цен ещё нет. */

const reg = (over: Record<string, unknown> = {}) => ({
  partnerId: 'p1',
  number: '205',
  accountCode: 'ani',
  accountName: 'Ани Групп Аэро',
  validFrom: new Date('2025-11-10T00:00:00.000Z'),
  validTo: null,
  isPrimary: true,
  state: 'ACTIVE',
  services: ['ACCOMMODATION'],
  sheetsCount: 1,
  receivedAt: new Date('2026-11-10T10:00:00.000Z'),
  ...over,
});

const doc = (over: Record<string, unknown> = {}) => ({
  partnerId: 'p1',
  contractNumber: '205',
  accountCode: 'ani',
  accountName: 'Ани Групп Аэро',
  service: 'ACCOMMODATION',
  receivedAt: new Date('2026-11-10T10:00:00.000Z'),
  fill: null,
  ...over,
});

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('mergeContractList', () => {
  it('договор без приложения виден: цен нет, но договор есть', () => {
    const [row] = mergeContractList([reg({ sheetsCount: 0 })], []);
    expect(row).toMatchObject({ number: '205', documents: 0, hasPrices: false });
    expect(row.services).toEqual(['ACCOMMODATION']);
  });

  it('договор, известный только по приложению, тоже виден (старая Авиа)', () => {
    const [row] = mergeContractList([], [doc()]);
    expect(row).toMatchObject({
      number: '205',
      documents: 1,
      hasPrices: true,
      state: 'ACTIVE',
      isPrimary: false,
    });
  });

  it('приложения обеих услуг считаются и складываются в набор услуг', () => {
    const [row] = mergeContractList(
      [reg({ services: [] })],
      [doc(), doc({ service: 'MEAL' }), doc({ service: 'ACCOMMODATION' })],
    );
    expect(row.documents).toBe(3);
    expect(row.services).toEqual(['ACCOMMODATION', 'MEAL']);
  });

  it('один номер в реестре и приложении — одна строка, поля реестра не перетираются', () => {
    const rows = mergeContractList(
      [reg({ sheetsCount: 3 })],
      [
        doc({
          accountCode: 'kars',
          accountName: 'Карс Авиа',
          receivedAt: new Date('2026-11-11T10:00:00.000Z'),
        }),
      ],
    );
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.account).toEqual({ code: 'ani', name: 'Ани Групп Аэро' });
    expect(row).toMatchObject({ isPrimary: true, state: 'ACTIVE' });
    expect(row.documents).toBe(3);
    expect(row.hasPrices).toBe(true);
    expect(row.receivedAt).toBe('2026-11-11T10:00:00.000Z');
  });

  it('юрлицо берётся из приложения, когда реестр пуст, а срок — из реестра', () => {
    const [row] = mergeContractList(
      [reg({ accountCode: null, accountName: null })],
      [doc({ accountCode: 'kars', accountName: 'Карс Авиа' })],
    );
    expect(row.account).toEqual({ code: 'kars', name: 'Карс Авиа' });
    expect(row.signedAt).toBe('2025-11-10T00:00:00.000Z');
  });

  it('приложения реестра считаются, даже когда строк цен нет', () => {
    const [row] = mergeContractList([reg({ sheetsCount: 2 })], []);
    expect(row).toMatchObject({ documents: 2, hasPrices: false });
    expect(row.receivedAt).toBe('2026-11-10T10:00:00.000Z');
  });

  it('срезы договора собираются из сеток и не повторяются', () => {
    const fill = [
      {
        from: '2026-01-01',
        slices: [
          { customer: null, guestKind: null, mealPlan: 'BB', cells: [] },
          { customer: 'cosmos', guestKind: 'CREW', mealPlan: 'BB', cells: [] },
        ],
      },
      {
        from: '2026-06-01',
        slices: [
          { customer: null, guestKind: null, mealPlan: 'BB', cells: [] },
          { customer: null, guestKind: null, mealPlan: 'HB', cells: [] },
        ],
      },
    ];
    const [row] = mergeContractList([reg({ sheetsCount: 2 })], [doc({ fill })]);
    expect(row.slices).toEqual([
      { customer: null, guestKind: null, mealPlan: 'BB' },
      { customer: null, guestKind: null, mealPlan: 'HB' },
      { customer: 'cosmos', guestKind: 'CREW', mealPlan: 'BB' },
    ]);
  });

  it('без сеток срезов нет, а не пустой срез', () => {
    const [row] = mergeContractList([reg()], [doc()]);
    expect(row.slices).toEqual([]);
  });

  it('битая сетка список не роняет, а незнакомые срезы отбрасываются', () => {
    /* fill — Json чужой системы: сетка может быть null, slices — не массивом,
       вид брони — незнакомым. Список договоров из-за этого падать не должен. */
    const fill = [
      null,
      { from: '2026-01-01', slices: 5 },
      {
        from: '2026-02-01',
        slices: [
          { customer: null, guestKind: 'SICK', mealPlan: 'BB', cells: [] },
          { customer: 7, guestKind: null, mealPlan: 'BB', cells: [] },
          { customer: 'cosmos', guestKind: 'CREW', mealPlan: 'HB', cells: [] },
        ],
      },
    ];
    const [row] = mergeContractList([reg()], [doc({ fill })]);
    expect(row.slices).toEqual([{ customer: 'cosmos', guestKind: 'CREW', mealPlan: 'HB' }]);
  });

  it('один срез из двух приложений договора не повторяется', () => {
    const fill = [
      {
        from: '2026-01-01',
        slices: [{ customer: null, guestKind: null, mealPlan: 'BB', cells: [] }],
      },
    ];
    const [row] = mergeContractList([reg()], [doc({ fill }), doc({ service: 'MEAL', fill })]);
    expect(row.documents).toBe(2);
    expect(row.slices).toEqual([{ customer: null, guestKind: null, mealPlan: 'BB' }]);
  });

  it('порядок: рабочий договор выше, затем по номеру', () => {
    const rows = mergeContractList(
      [reg({ number: '100', isPrimary: false }), reg({ number: '205', isPrimary: true })],
      [],
    );
    expect(rows.map((r) => r.number)).toEqual(['205', '100']);
  });

  it('номера сортируются числом: 9 раньше 10', () => {
    const rows = mergeContractList(
      [reg({ number: '10', isPrimary: false }), reg({ number: '9', isPrimary: false })],
      [],
    );
    expect(rows.map((r) => r.number)).toEqual(['9', '10']);
  });

  it('входные массивы не мутируются', () => {
    const registry = [
      reg({ services: ['ACCOMMODATION', 'MEAL'] }),
      reg({ number: '300', sheetsCount: 0 }),
    ];
    const docs = [doc(), doc({ contractNumber: '300', service: 'MEAL' })];
    const registryBefore = copy(registry);
    const docsBefore = copy(docs);

    mergeContractList(registry, docs);

    expect(copy(registry)).toEqual(registryBefore);
    expect(copy(docs)).toEqual(docsBefore);
  });
});
