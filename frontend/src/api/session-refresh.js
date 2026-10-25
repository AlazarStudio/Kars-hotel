/* ПРОДЛЕНИЕ ВХОДА — ТОЛЬКО СВОЕГО (25.10.2026).
 *
 * Вход кабинета живёт во ВКЛАДКЕ (`sessionStorage`), а продление — по куке
 * браузера. Пока кука была одна на браузер, вход по ссылке из Kars Avia в
 * другую гостиницу в соседней вкладке переписывал её, и продление этой
 * вкладки молча получало токен ЧУЖОЙ гостиницы — запрос повторялся уже от её
 * имени. На бою 25.10.2026 так шахматка «Апартаментов» отмечала выезд гостя
 * от имени «Европы» и получала «Reservation not found»: под RLS чужая бронь не
 * видна. Смены гостиницы на экране человек не видел.
 *
 * Два замка:
 * 1. Вход в гостиницу по ссылке продлевается СВОЕЙ кукой — у каждой гостиницы
 *    своя, на пути `/auth/hotel/<id>` (`sessionCookiePath`), и сервер
 *    продлевает по ней только вход в эту гостиницу. Вкладки разных гостиниц
 *    друг другу не мешают.
 * 2. Новый токен принимается, только если это ТОТ ЖЕ вход: та же гостиница,
 *    тот же человек, то же «от имени». Общую куку по-прежнему делят вход
 *    паролем и панель диспетчера — расхождение там останавливает вкладку.
 *
 * Остановленная вкладка токен не принимает, запрос не повторяет и больше не
 * ходит продлевать, пока в ней не появится новый вход. Вход в гостиницу, чья
 * кука кончилась (срок, выход в соседней вкладке той же гостиницы), тоже
 * останавливается — с подсказкой открыть гостиницу заново из Kars Avia, а не
 * формой пароля, которого у диспетчера нет. Вкладка без входа (только что
 * открытая) берёт вход браузера, как и раньше, — если за время продления в
 * ней не появился свой: ответ продления новый вход не затирает.
 *
 * Модуль без зависимостей: сеть и хранилище подаёт `client.js`. */

export const SESSION_STOPPED = 'SESSION_STOPPED';

export function isSessionStopped(err) {
  return err?.code === SESSION_STOPPED;
}

const STOP_TEXT = {
  displaced: 'Вход в браузере сменился на другую гостиницу. Работа в этой вкладке остановлена — откройте гостиницу заново из Kars Avia.',
  ended: 'Вход в гостиницу в этой вкладке закончился. Откройте её заново из Kars Avia.',
};

function stoppedError(reason) {
  return Object.assign(new Error(STOP_TEXT[reason]), { code: SESSION_STOPPED, reason });
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

/** Ручки куки этого входа: вход «от имени» в гостиницу — её собственные,
 *  остальные — общие. Вход «от имени» из панели платформы своей куки не
 *  имеет и сюда не ходит: он не продлевается, а выходит общей (`client.js`). */
export function sessionCookiePath(session) {
  return session?.imp ? `/auth/hotel/${encodeURIComponent(session.tid)}` : '/auth';
}

/**
 * Продление и повтор запроса после 401.
 *
 * @param post        запрос продления (путь от API) → новый access-токен
 * @param retry       повтор исходного запроса
 * @param getToken    токен вкладки
 * @param setToken    принять токен во вкладку
 * @param canRefresh  можно ли продлевать сейчас (вход «от имени» из панели — нельзя)
 * @param onStopped   вкладку остановили: вход браузера чужой или вход в гостиницу кончился
 */
export function createSessionRefresh({ post, retry, getToken, setToken, canRefresh, onStopped }) {
  let inFlight = null;
  /* Токен, на котором вкладку остановили. Пока он во вкладке, продление не
     ходит на сервер: каждый поход заново крутил бы чужую куку. */
  let stoppedOn = null;
  let stoppedReason = null;

  function stop(held, reason) {
    stoppedOn = held;
    stoppedReason = reason;
    const err = stoppedError(reason);
    onStopped(err);
    return err;
  }

  function refresh() {
    const held = getToken();
    if (held && held === stoppedOn) return Promise.reject(stoppedError(stoppedReason));
    // Двойной маунт StrictMode шлёт два продления сразу: второе получило бы
    // 401 на уже повёрнутой куке и выбросило бы человека.
    if (inFlight) return inFlight;
    const before = sessionOf(held);
    inFlight = post(`${sessionCookiePath(before)}/refresh`)
      .then(
        (token) => {
          /* Пока продление шло, во вкладке появился новый вход (ссылка,
             пароль) — ответ устарел и его не затирает. Иначе вкладка,
             открытая ссылкой в гостиницу Б, получала токен гостиницы А из
             куки и работала в ней под баннером Б. */
          const now = getToken();
          if (now !== held) return now;
          /* Токен вкладки при остановке НЕ сбрасываем: по нему и перезагрузка
             поймёт, что вход браузера чужой. Сброс стёр бы запись вкладки, и
             после F5 она молча открылась бы в чужой гостинице. */
          if (before && !isSameSession(before, sessionOf(token))) throw stop(held, 'displaced');
          setToken(token);
          return token;
        },
        (err) => {
          if (getToken() !== held) throw err;
          /* Вход в гостиницу без своей куки — остановка с подсказкой, а не
             форма пароля. Сбой сети — не конец входа: токен остаётся, и
             следующий 401 попробует снова. */
          if (before?.imp) {
            if (err?.response?.status === 401) throw stop(held, 'ended');
            throw err;
          }
          setToken(null);
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
      throw isSessionStopped(refreshErr) ? refreshErr : err;
    }
    original._retried = true;
    original.headers = original.headers || {};
    original.headers.Authorization = `Bearer ${token}`;
    return retry(original);
  }

  return { refresh, onAuthError };
}
