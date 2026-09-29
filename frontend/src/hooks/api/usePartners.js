import { useQuery } from '@tanstack/react-query';
import { listPartners } from '../../api/partners';

/* Справочник партнёра меняется на его стороне (новая авиакомпания, новое
   юрлицо) — редко, поэтому держим подольше и не дёргаем сервер на каждый
   заход в «Тарифы». */
export function usePartners() {
  return useQuery({ queryKey: ['partners'], queryFn: listPartners, staleTime: 5 * 60_000 });
}
