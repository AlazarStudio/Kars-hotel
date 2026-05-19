import { useMemo } from 'react';
import { subDays, addDays } from 'date-fns';
import { useTimeline } from './useTimeline';

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

/**
 * Fetches a wide date window so the dashboard can compute:
 * - today's arrivals / departures
 * - currently checked-in guests
 * - occupancy per category
 */
export function useDashboard() {
  // -60 days to catch long-stay guests, +90 days for future stats
  const from = subDays(TODAY, 60);
  const days  = 150;

  const { data, loading, error } = useTimeline(from, days);

  const result = useMemo(() => {
    if (!data) return null;
    return {
      bookings:   data.bookings,
      rooms:      data.rooms,
      categories: data.categories,
    };
  }, [data]);

  return { data: result, loading, error };
}
