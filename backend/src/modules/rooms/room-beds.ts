import { BedType } from '@prisma/client';

/** Кровати номера числами (27.10.2026). */
export interface RoomBeds {
  singleBeds: number;
  doubleBeds: number;
  sofas: number;
  extraBeds: number;
}

/* Прежний вид кровати → числа. Та же раскладка, что в миграции
   20261027180000_room_bed_counts: клиент API, который ещё шлёт bedType, должен
   получить тот же номер, что и перенесённые. */
const FROM_TYPE: Record<BedType, Omit<RoomBeds, 'extraBeds'>> = {
  SINGLE: { singleBeds: 1, doubleBeds: 0, sofas: 0 },
  DOUBLE: { singleBeds: 0, doubleBeds: 1, sofas: 0 },
  TWIN: { singleBeds: 2, doubleBeds: 0, sofas: 0 },
  THREE_SINGLE: { singleBeds: 3, doubleBeds: 0, sofas: 0 },
  FOUR_SINGLE: { singleBeds: 4, doubleBeds: 0, sofas: 0 },
  FIVE_SINGLE: { singleBeds: 5, doubleBeds: 0, sofas: 0 },
  TWO_DOUBLE: { singleBeds: 0, doubleBeds: 2, sofas: 0 },
  DOUBLE_SINGLE: { singleBeds: 1, doubleBeds: 1, sofas: 0 },
  KING: { singleBeds: 0, doubleBeds: 1, sofas: 0 },
  QUEEN: { singleBeds: 0, doubleBeds: 1, sofas: 0 },
  SOFA: { singleBeds: 0, doubleBeds: 0, sofas: 1 },
};

type BedsInput = Partial<RoomBeds> & { bedType?: BedType };

const KEYS = ['singleBeds', 'doubleBeds', 'sofas'] as const;

/** Кровати нового номера: числа, если прислали хоть одно, иначе — из вида. */
export function bedsForCreate(dto: BedsInput): RoomBeds {
  if (KEYS.some((k) => dto[k] != null)) {
    return {
      singleBeds: dto.singleBeds ?? 0,
      doubleBeds: dto.doubleBeds ?? 0,
      sofas: dto.sofas ?? 0,
      extraBeds: dto.extraBeds ?? 0,
    };
  }
  return { ...FROM_TYPE[dto.bedType ?? 'DOUBLE'], extraBeds: dto.extraBeds ?? 0 };
}

/** Правка: меняем только присланное; прислали один вид — числа из него. */
export function bedsForUpdate(dto: BedsInput): Partial<RoomBeds> {
  if (KEYS.some((k) => dto[k] != null)) {
    return {
      singleBeds: dto.singleBeds ?? undefined,
      doubleBeds: dto.doubleBeds ?? undefined,
      sofas: dto.sofas ?? undefined,
      extraBeds: dto.extraBeds ?? undefined,
    };
  }
  return {
    ...(dto.bedType ? FROM_TYPE[dto.bedType] : {}),
    extraBeds: dto.extraBeds ?? undefined,
  };
}
