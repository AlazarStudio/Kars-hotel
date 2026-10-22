import { ConnectivityService } from './connectivity.service';

/* Свободен ли номер для партнёра — правилом мест (room-places.ts), а не
 * суммой людей всех пересекающихся броней (23.10.2026). Случай из жизни:
 * «Апартаменты сети Карс Авиа», № 22 Партсъезда 64 кв 46, два места.
 *   место 1 — Смирнов 21–24.10;
 *   место 2 — Кулигин 21–27.10, затем Сидоров 28.10–13.11.
 * Новый гость 24.10–08.11 помещается на место 1. Сумма людей давала «2 из 2»
 * и прятала номер как занятый. */

type Res = { room_id: string; place_number: number; adults: number; children: number | null; check_in: string; check_out: string };

const ROOM = { id: 'r46', room_type_id: 'rt', number: '22 Партсъезда 64 кв 46', floor: 1, capacity: 2, bed_type: 'TWIN', view: 'NONE', partner_hold: 'NONE' };
const RES: Res[] = [
  { room_id: 'r46', place_number: 1, adults: 1, children: 0, check_in: '2026-10-21', check_out: '2026-10-24' },
  { room_id: 'r46', place_number: 2, adults: 1, children: 0, check_in: '2026-10-21', check_out: '2026-10-27' },
  { room_id: 'r46', place_number: 2, adults: 1, children: 0, check_in: '2026-10-28', check_out: '2026-11-13' },
];

function make(multiPlace: boolean, reservations: Res[] = RES) {
  const svc = Object.create(ConnectivityService.prototype) as ConnectivityService;
  /* $queryRaw — тег шаблона: первый аргумент — части строки, дальше значения.
     Запрос номеров отдаёт ROOM, запрос броней — пересекающиеся с периодом. */
  const queryRaw = jest.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.join('?');
    if (sql.includes('FROM reservation')) {
      const [, checkOut, checkIn] = values as [string[], string, string];
      return reservations.filter((r) => r.check_in < checkOut && r.check_out > checkIn);
    }
    return [ROOM];
  });
  const tx = { $queryRaw: queryRaw };
  const prisma = {
    forTenantExplicit: jest.fn(async (_id: string, cb: (t: typeof tx) => unknown) => cb(tx)),
    admin: { tenant: { findUnique: jest.fn(async () => ({ multiPlaceEnabled: multiPlace })) } },
  };
  Object.assign(svc, { prisma });
  return svc as unknown as {
    listRoomsForCategory: (t: string, rt: string, i: string, o: string) => Promise<{ available: boolean }[]>;
    pickAvailableRoom: (t: string, rt: string, i: string, o: string, g?: number) => Promise<string | null>;
    resolvePinnedRoom: (t: string, r: string, rt: string, i: string, o: string, g?: number) => Promise<string>;
  };
}

describe('номер свободен по местам, а не по сумме людей', () => {
  it('место 1 свободно с 24.10 — номер свободен, хотя на месте 2 двое по очереди', async () => {
    const svc = make(true);
    const [room] = await svc.listRoomsForCategory('t', 'rt', '2026-10-24', '2026-11-08');
    expect(room.available).toBe(true);
    expect(await svc.pickAvailableRoom('t', 'rt', '2026-10-24', '2026-11-08')).toBe('r46');
    await expect(svc.resolvePinnedRoom('t', 'r46', 'rt', '2026-10-24', '2026-11-08')).resolves.toBe('r46');
  });

  it('оба места заняты весь период — номер НЕ свободен', async () => {
    const svc = make(true);
    const [room] = await svc.listRoomsForCategory('t', 'rt', '2026-10-22', '2026-10-23');
    expect(room.available).toBe(false);
  });

  it('на двоих — НЕ помещается, если свободно одно место', async () => {
    const svc = make(true);
    expect(await svc.pickAvailableRoom('t', 'rt', '2026-10-24', '2026-11-08', 2)).toBeNull();
  });

  it('без продажи по местам номер занят целиком любой бронью', async () => {
    const svc = make(false);
    const [room] = await svc.listRoomsForCategory('t', 'rt', '2026-10-24', '2026-11-08');
    expect(room.available).toBe(false);
  });

  it('выезд 24-го и заезд 24-го не пересекаются', async () => {
    const svc = make(false, [RES[0]]);
    const [room] = await svc.listRoomsForCategory('t', 'rt', '2026-10-24', '2026-10-26');
    expect(room.available).toBe(true);
  });
});
