import { api } from './client';

/** Партнёры гостиницы с их справочником: юрлица и заказчики (29.09.2026). */
export async function listPartners() {
  const { data } = await api.get('/partners');
  return data;
}
