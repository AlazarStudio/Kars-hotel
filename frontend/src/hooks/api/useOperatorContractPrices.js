import { useQuery } from '@tanstack/react-query';
import { fetchOperatorContractPrices } from '../../api/pricing';

/* Цены договора с оператором. Меняются редко — раз в приложение, — поэтому
   держим их дольше обычного и не дёргаем сервер на каждый заход в «Тарифы». */
export function useOperatorContractPrices() {
  return useQuery({
    queryKey: ['operator-contract-prices'],
    queryFn: fetchOperatorContractPrices,
    staleTime: 5 * 60_000,
  });
}
