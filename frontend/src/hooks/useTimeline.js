import { useState, useEffect, useCallback, useRef } from 'react';
import { format, addDays } from 'date-fns';
import { getTimeline } from '../api/timeline';
import { io } from 'socket.io-client';
import { useAuth } from '../auth/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const WS_BASE_URL = API_BASE_URL.replace('/api', '');

/**
 * Transform the API timeline response into the shape
 * that the existing Timeline.jsx component expects.
 */
function transformTimeline(data) {
  const categories = [];
  const rooms = [];
  const bookings = [];

  for (const rt of data.roomTypes) {
    categories.push({ id: rt.id, name: rt.name, code: rt.code, basePrice: Number(rt.basePrice) || 0 });

    for (const room of rt.rooms) {
      const hkMap = {
        DIRTY: 'dirty',
        CLEANING: 'cleaning',
        INSPECTED: 'checking',
        CLEAN: 'clean',
        READY: 'ready',
        OUT_OF_ORDER: 'dirty',
        OUT_OF_SERVICE: 'dirty',
      };

      rooms.push({
        id: room.id,
        number: room.number,
        floor: room.floor,
        categoryId: rt.id,
        capacity: room.capacity ?? 1,
        hk: hkMap[room.status] ?? 'clean',
      });

      for (const res of room.reservations) {
        const statusMap = {
          NEW: 'new',
          CONFIRMED: 'confirmed',
          CHECKED_IN: 'checked_in',
          CHECKED_OUT: 'checked_out',
          CANCELLED: 'cancelled',
          NO_SHOW: 'no_show',
        };

        bookings.push({
          id: res.id,
          roomId: room.id,
          guestName: res.guestName,
          phone: res.phone ?? '',
          email: res.email ?? '',
          checkIn: res.checkIn,
          checkOut: res.checkOut,
          status: statusMap[res.status] ?? res.status.toLowerCase(),
          adults: res.adults,
          children: res.children,
          notes: res.notes ?? '',
          totalPrice: res.totalPrice ? Number(res.totalPrice) : 0,
          source: res.source?.toLowerCase() ?? 'direct',
          channelManaged: res.channelManaged ?? false,
          version: res.version,
          placeNumber: res.placeNumber ?? 1,
        });
      }
    }
  }

  return { categories, rooms, bookings };
}

/**
 * Hook that fetches timeline data from the API and keeps it in sync
 * via WebSocket real-time events.
 *
 * @param {Date} viewStart - first visible date
 * @param {number} daysCount - number of days to load
 */
export function useTimeline(viewStart, daysCount) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const socketRef = useRef(null);

  const from = format(viewStart, 'yyyy-MM-dd');
  const to   = format(addDays(viewStart, daysCount - 1), 'yyyy-MM-dd');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const raw = await getTimeline(from, to);
      setData(transformTimeline(raw));
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.message ?? e.message ?? 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  // Always keep a ref to the latest load so the WS handler never goes stale
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  // Load on mount and whenever dates change
  useEffect(() => {
    load();
  }, [load]);

  // WebSocket: subscribe once per tenantId — use loadRef to avoid recreating
  // the socket every time `load` gets a new reference due to re-renders.
  useEffect(() => {
    if (!user?.tenantId) return;

    // Connect to /timeline namespace.
    // Start with polling (always works), then upgrade to WS.
    // This prevents the "WebSocket closed before connection established" spam
    // caused by trying WebSocket first before the HTTP handshake is complete.
    const socket = io(`${WS_BASE_URL}/timeline`, {
      transports: ['polling', 'websocket'],
      auth: { tenantId: user.tenantId },
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });

    socket.on('timeline:update', () => {
      // Use ref so this callback always calls the latest load(), even if
      // viewStart/daysCount changed while the socket was connected.
      loadRef.current();
    });

    socket.on('connect_error', (err) => {
      // Suppress expected transport errors (polling fallback handles them)
      if (import.meta.env.DEV) {
        console.debug('[WS] connect_error (will retry):', err.message);
      }
    });

    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user?.tenantId]); // ← no `load` in deps — use loadRef instead

  return { data, loading, error, reload: load };
}
