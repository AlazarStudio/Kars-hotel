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
  photos?: string[];
}

/**
 * Hotel-level profile for the demo tenant. These are the fields partners (e.g.
 * Kars Avia) read over the connectivity API — name/stars/address/contacts live
 * on the `tenant` row, so a complete demo means a fully-populated profile here.
 */
export interface DemoProfileSeed {
  city: string;
  address: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  stars: number;
  description: string;
  logoUrl: string;
  /** Hotel hero gallery shown as a slider to partners (first = cover). */
  galleryPhotos: string[];
  checkInTime: string;
  checkOutTime: string;
}

export const DEMO_PROFILE: DemoProfileSeed = {
  city: 'Москва',
  address: 'Ленинградский проспект, 37к9',
  country: 'RU',
  phone: '+7 495 120-45-67',
  email: 'reception@demo-hotel.ru',
  website: 'https://demo-hotel.ru',
  stars: 4,
  description:
    'Современный бизнес-отель в 10 минутах от аэропорта. 21 номер четырёх ' +
    'категорий, круглосуточная стойка регистрации, завтрак «шведский стол», ' +
    'бесплатный Wi-Fi и парковка. Удобен для экипажей и командировок.',
  logoUrl:
    'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&q=80',
  galleryPhotos: [
    'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1600&q=80',
    'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=1600&q=80',
    'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=1600&q=80',
    'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=1600&q=80',
  ],
  checkInTime: '14:00',
  checkOutTime: '12:00',
};

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
    photos: [
      'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&q=80',
      'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=1200&q=80',
    ],
  },
  {
    code: 'DLX',
    name: 'Делюкс',
    baseOccupancy: 2,
    maxOccupancy: 2,
    basePrice: 5900,
    sortOrder: 2,
    description: 'Просторный номер повышенной комфортности.',
    photos: [
      'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1200&q=80',
      'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=1200&q=80',
    ],
  },
  {
    code: 'SEMI',
    name: 'Полулюкс',
    baseOccupancy: 2,
    maxOccupancy: 3,
    basePrice: 8500,
    sortOrder: 3,
    description: 'Зона гостиной + отдельная спальня.',
    photos: [
      'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=1200&q=80',
      'https://images.unsplash.com/photo-1591088398332-8a7791972843?w=1200&q=80',
    ],
  },
  {
    code: 'LUX',
    name: 'Люкс',
    baseOccupancy: 2,
    maxOccupancy: 4,
    basePrice: 13000,
    sortOrder: 4,
    description: 'Двухкомнатные апартаменты, лучший выбор отеля.',
    photos: [
      'https://images.unsplash.com/photo-1444201983204-c43cbd584d93?w=1200&q=80',
      'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=1200&q=80',
    ],
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
