import { api } from './client';

/** Раскладка питания одной брони: дни × завтрак/обед/ужин + итоги. */
export const getReservationMeals = (reservationId) =>
  api.get(`/reservations/${reservationId}/meals`).then((r) => r.data);

/** Что готовить на день по всей гостинице. @param {string} date – 'YYYY-MM-DD' */
export const getMealsForDay = (date) =>
  api.get(`/reservations/meals?date=${date}`).then((r) => r.data);
