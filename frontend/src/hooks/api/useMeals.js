import { useQuery } from '@tanstack/react-query';
import { getMealsForDay, getReservationMeals } from '../../api/meals';

export function useReservationMeals(reservationId) {
  return useQuery({
    queryKey: ['meals', reservationId],
    queryFn: () => getReservationMeals(reservationId),
    enabled: !!reservationId,
  });
}

export function useMealsForDay(date) {
  return useQuery({
    queryKey: ['meals-day', date],
    queryFn: () => getMealsForDay(date),
    enabled: !!date,
  });
}
