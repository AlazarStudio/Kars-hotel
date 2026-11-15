import { useQuery } from '@tanstack/react-query';
import { listPartners } from '../../api/partners';

export const PARTNERS_KEY = ['partners'];

/* В «Тарифах» справочник обновляется после чтения договоров. Для остальных
   экранов он остаётся свежим пять минут. */
export function usePartners() {
  return useQuery({ queryKey: PARTNERS_KEY, queryFn: listPartners, staleTime: 5 * 60_000 });
}
