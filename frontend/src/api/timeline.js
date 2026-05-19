import { api } from './client';

/**
 * Fetch timeline data for a date range.
 * @param {string} from - 'YYYY-MM-DD'
 * @param {string} to   - 'YYYY-MM-DD'
 * @returns {Promise<import('./timeline.types').TimelineResponse>}
 */
export async function getTimeline(from, to) {
  const { data } = await api.get('/timeline', { params: { from, to } });
  return data;
}
