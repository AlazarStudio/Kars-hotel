/* Редирект на главный живой адрес PMS (20.11.2026, как у Авии).
 *
 * Адреса — по убыванию приоритета, список отдаёт сервер (`KARS_ORIGINS`,
 * `/api/domains`): основной, резервный, зеркало. Не-основной адрес при
 * загрузке спрашивает тех, кто главнее, и уходит на первый живой с тем же
 * путём: основной жив — на основной; лежит — зеркало уходит на резервный.
 * Основной и адрес вне списка (разработка, IP) никого не спрашивают.
 * Вход у PMS свой на каждом адресе: после перехода человек входит заново. */

const PROBE_TIMEOUT_MS = 3000;

/** Адреса главнее текущего; текущего нет в списке — никто. */
export function higherPriority(origins, current) {
  const i = origins.indexOf(current);
  return i < 0 ? [] : origins.slice(0, i);
}

export async function firstAlive(candidates, probe) {
  for (const origin of candidates) if (await probe(origin)) return origin;
  return null;
}

/* Жив — API и база отвечают. Без cookie: ответ одинаков всем. */
export async function probeOrigin(origin, fetchImpl = fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${origin}/api/domains`, { credentials: 'omit', cache: 'no-store', signal: ctrl.signal });
    return res.ok && (await res.json())?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Куда уйти с этой страницы; null — оставаться. */
export async function failoverTarget(current, fetchImpl = fetch) {
  let origins = [];
  try {
    const res = await fetchImpl('/api/domains', { cache: 'no-store' });
    if (res.ok) origins = (await res.json())?.origins ?? [];
  } catch {
    return null;
  }
  return firstAlive(higherPriority(origins, current), (o) => probeOrigin(o, fetchImpl));
}

/** true — уходим (страницу не рисовать), false — остаёмся. */
export async function redirectToPrimary(loc = window.location) {
  const target = await failoverTarget(loc.origin);
  if (!target) return false;
  loc.replace(target + loc.pathname + loc.search + loc.hash);
  return true;
}
