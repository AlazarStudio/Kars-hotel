/* ПРОДЛЕНИЕ ВХОДА — ТОЛЬКО СВОЕГО (25.10.2026).
 *
 * Вход кабинета живёт во ВКЛАДКЕ (`sessionStorage`), а refresh-кука — одна на
 * БРАУЗЕР, и вход по ссылке из Kars Avia её тоже ставит. Диспетчер открывает
 * в соседней вкладке другую гостиницу — кука теперь её. Истекает токен этой
 * вкладки, и продление молча получало токен ЧУЖОЙ гостиницы, а запрос
 * повторялся уже от её имени. На бою 25.10.2026 так шахматка «Апартаментов»
 * отмечала выезд гостя от имени «Европы» и получала «Reservation not found»:
 * под RLS чужая бронь не видна. Смены гостиницы на экране человек не видел.
 *
 * Поэтому новый токен принимается, только если это ТОТ ЖЕ вход: та же
 * гостиница, тот же человек, то же «от имени». Иначе вкладка останавливается:
 * токен не принимается, запрос не повторяется, продление больше не ходит на
 * сервер, пока во вкладке не появится новый вход. Вкладка без входа (только
 * что открытая) берёт вход браузера, как и раньше, — если за время продления
 * в ней не появился свой: ответ продления новый вход не затирает.
 *
 * Модуль без зависимостей: сеть и хранилище подаёт `client.js`. */

export const SESSION_DISPLACED = 'SESSION_DISPLACED';

export function isSessionDisplaced(err) {
  return err?.code === SESSION_DISPLACED;
}

function displacedError() {
  return Object.assign(
    new Error('Вход в браузере сменился на другую гостиницу. Работа в этой вкладке остановлена — откройте гостиницу заново из Kars Avia.'),
    { code: SESSION_DISPLACED },
  );
}

function payloadOf(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** Чей вход несёт токен: гостиница, человек, от чьего имени. Подпись не
 *  проверяется — это сверка двух токенов, выданных сервером, а не допуск. */
export function sessionOf(token) {
  const p = token ? payloadOf(token) : null;
  return p?.tid && p?.sub ? { tid: p.tid, sub: p.sub, imp: p.imp ?? null } : null;
}

export function isSameSession(a, b) {
  return !!a && !!b && a.tid === b.tid && a.sub === b.sub && a.imp === b.imp;
}

/**
 * Продление и повтор запроса после 401.
 *
 * @param post        запрос продления кукой → новый access-токен
 * @param retry       повтор исходного запроса
 * @param getToken    токен вкладки
 * @param setToken    принять токен во вкладку
 * @param canRefresh  можно ли продлевать сейчас (вход «от имени» из панели — нельзя)
 * @param onDisplaced вкладку остановили: вход браузера чужой
 */
export function createSessionRefresh({ post, retry, getToken, setToken, canRefresh, onDisplaced }) {
  let inFlight = null;
  /* Токен, на котором вкладку остановили. Пока он во вкладке, продление не
     ходит на сервер: каждый поход заново крутил бы куку соседней вкладки. */
  let stoppedOn = null;

  function refresh() {
    const held = getToken();
    if (held && held === stoppedOn) return Promise.reject(displacedError());
    // Двойной маунт StrictMode шлёт два продления сразу: второе получило бы
    // 401 на уже повёрнутой куке и выбросило бы человека.
    if (inFlight) return inFlight;
    const before = sessionOf(held);
    inFlight = post()
      .then(
        (token) => {
          /* Пока продление шло, во вкладке появился новый вход (ссылка,
             пароль) — ответ устарел и его не затирает. Иначе вкладка,
             открытая ссылкой в гостиницу Б, получала токен гостиницы А из
             куки и работала в ней под баннером Б. */
          const now = getToken();
          if (now !== held) return now;
          if (before && !isSameSession(before, sessionOf(token))) {
            /* Токен вкладки НЕ сбрасываем: по нему и перезагрузка поймёт, что
               вход браузера чужой. Сброс стёр бы запись вкладки, и после F5
               она молча открылась бы в чужой гостинице. */
            stoppedOn = held;
            const err = displacedError();
            onDisplaced(err);
            throw err;
          }
          setToken(token);
          return token;
        },
        (err) => {
          if (getToken() === held) setToken(null);
          throw err;
        },
      )
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  /** Обработчик ошибки ответа: на 401 — ОДНО продление и повтор. */
  async function onAuthError(err) {
    const original = err.config;
    if (!original || original._retried) throw err;
    const url = original.url || '';
    if (err.response?.status !== 401 || url.includes('/auth/') || !canRefresh()) throw err;
    let token;
    try {
      token = await refresh();
    } catch (refreshErr) {
      throw isSessionDisplaced(refreshErr) ? refreshErr : err;
    }
    original._retried = true;
    original.headers = original.headers || {};
    original.headers.Authorization = `Bearer ${token}`;
    return retry(original);
  }

  return { refresh, onAuthError };
}
