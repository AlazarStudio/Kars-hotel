import { BedType, RoomStatus, RoomView } from '@prisma/client';

/**
 * Ported from the legacy frontend mock data:
 *   frontend/src/Components/HotelPMS/mockData/mock.js
 *
 * Used by POST /api/demo-seed to populate a fresh tenant with 4 categories,
 * 21 rooms and realistic housekeeping statuses, mirroring what the original
 * UI demo showed.
 */

export interface DemoCategorySeed {
  code: string;
  name: string;
  baseOccupancy: number;
  maxOccupancy: number;
  basePrice: number;
  sortOrder: number;
  description?: string;
}

export interface DemoRoomSeed {
  number: string;
  categoryCode: string;
  floor: number;
  status: RoomStatus;
  bedType: BedType;
  view?: RoomView;
  capacity?: number;
}

export const DEMO_CATEGORIES: DemoCategorySeed[] = [
  {
    code: 'STD',
    name: 'Стандарт',
    baseOccupancy: 2,
    maxOccupancy: 2,
    basePrice: 3800,
    sortOrder: 1,
    description: 'Уютный номер с двуспальной кроватью.',
  },
  {
    code: 'DLX',
    name: 'Делюкс',
    baseOccupancy: 2,
    maxOccupancy: 2,
    basePrice: 5900,
    sortOrder: 2,
    description: 'Просторный номер повышенной комфортности.',
  },
  {
    code: 'SEMI',
    name: 'Полулюкс',
    baseOccupancy: 2,
    maxOccupancy: 3,
    basePrice: 8500,
    sortOrder: 3,
    description: 'Зона гостиной + отдельная спальня.',
  },
  {
    code: 'LUX',
    name: 'Люкс',
    baseOccupancy: 2,
    maxOccupancy: 4,
    basePrice: 13000,
    sortOrder: 4,
    description: 'Двухкомнатные апартаменты, лучший выбор отеля.',
  },
];

export const DEMO_ROOMS: DemoRoomSeed[] = [
  // Стандарты — 1 этаж (TWIN rooms have 2 independently bookable beds)
  { number: '101', categoryCode: 'STD', floor: 1, status: 'DIRTY',     bedType: 'DOUBLE' },
  { number: '102', categoryCode: 'STD', floor: 1, status: 'CLEAN',     bedType: 'DOUBLE' },
  { number: '103', categoryCode: 'STD', floor: 1, status: 'READY',     bedType: 'DOUBLE' },
  { number: '104', categoryCode: 'STD', floor: 1, status: 'CLEANING',  bedType: 'TWIN', capacity: 2 },
  { number: '105', categoryCode: 'STD', floor: 1, status: 'READY',     bedType: 'DOUBLE' },
  { number: '106', categoryCode: 'STD', floor: 1, status: 'DIRTY',     bedType: 'DOUBLE' },
  { number: '107', categoryCode: 'STD', floor: 1, status: 'READY',     bedType: 'TWIN', capacity: 2 },
  { number: '108', categoryCode: 'STD', floor: 1, status: 'INSPECTED', bedType: 'DOUBLE' },

  // Делюкс — 2 этаж
  { number: '201', categoryCode: 'DLX', floor: 2, status: 'READY', bedType: 'QUEEN', view: 'CITY' },
  { number: '202', categoryCode: 'DLX', floor: 2, status: 'DIRTY', bedType: 'QUEEN', view: 'CITY' },
  { number: '203', categoryCode: 'DLX', floor: 2, status: 'CLEAN', bedType: 'KING', view: 'GARDEN' },
  { number: '204', categoryCode: 'DLX', floor: 2, status: 'READY', bedType: 'QUEEN', view: 'CITY' },
  { number: '205', categoryCode: 'DLX', floor: 2, status: 'READY', bedType: 'QUEEN', view: 'GARDEN' },
  { number: '206', categoryCode: 'DLX', floor: 2, status: 'CLEANING', bedType: 'KING', view: 'GARDEN' },

  // Полулюкс — 3 этаж
  { number: '301', categoryCode: 'SEMI', floor: 3, status: 'READY', bedType: 'KING', view: 'CITY' },
  { number: '302', categoryCode: 'SEMI', floor: 3, status: 'DIRTY', bedType: 'KING', view: 'GARDEN' },
  { number: '303', categoryCode: 'SEMI', floor: 3, status: 'READY', bedType: 'KING', view: 'CITY' },
  { number: '304', categoryCode: 'SEMI', floor: 3, status: 'CLEAN', bedType: 'KING', view: 'GARDEN' },

  // Люкс — 4 этаж
  { number: '401', categoryCode: 'LUX', floor: 4, status: 'READY', bedType: 'KING', view: 'CITY' },
  { number: '402', categoryCode: 'LUX', floor: 4, status: 'DIRTY', bedType: 'KING', view: 'CITY' },
  { number: '403', categoryCode: 'LUX', floor: 4, status: 'READY', bedType: 'KING', view: 'GARDEN' },
];
