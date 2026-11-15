export const RATE_PLANS_KEY = ['ratePlans'];
export const CONTRACT_PRICES_KEY = ['contract-prices'];

export function invalidateRatePlanQueries(client, planId) {
  return Promise.all([
    client.invalidateQueries({ queryKey: RATE_PLANS_KEY }),
    client.invalidateQueries({ queryKey: [...CONTRACT_PRICES_KEY, planId] }),
  ]);
}
