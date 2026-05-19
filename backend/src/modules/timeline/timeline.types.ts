// Timeline domain types — defined manually because Prisma client
// hasn't been regenerated yet (DLL locked by OS at dev time).

export type ReservationStatus =
  | 'NEW'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'CANCELLED'
  | 'NO_SHOW';

export type ReservationSource =
  | 'DIRECT'
  | 'PHONE'
  | 'ONLINE'
  | 'OTA'
  | 'CORPORATE';

export type RoomStatus =
  | 'DIRTY'
  | 'CLEANING'
  | 'INSPECTED'
  | 'CLEAN'
  | 'READY'
  | 'OUT_OF_ORDER'
  | 'OUT_OF_SERVICE';

/** One reservation as returned by the CTE query. */
export interface TimelineReservation {
  id: string;
  roomId: string;
  guestName: string;
  phone: string | null;
  email: string | null;
  checkIn: string;   // ISO date 'YYYY-MM-DD'
  checkOut: string;
  status: ReservationStatus;
  adults: number;
  children: number;
  notes: string | null;
  totalPrice: string | null;
  source: ReservationSource;
  ratePlanId: string | null;
  version: number;
}

/** One room row in the timeline grid. */
export interface TimelineRoom {
  id: string;
  number: string;
  floor: number;
  status: RoomStatus;
  reservations: TimelineReservation[];
}

/** One room-type group containing its rooms. */
export interface TimelineRoomType {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  basePrice: string;
  rooms: TimelineRoom[];
}

/** Full timeline response. */
export interface TimelineResponse {
  from: string;
  to: string;
  roomTypes: TimelineRoomType[];
  /** Seconds remaining before cache expires (0 = fresh). */
  cacheTtl: number;
}
