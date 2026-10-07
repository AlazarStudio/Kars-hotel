/* НА БОЮ — ТОЛЬКО HTTPS (152-ФЗ, Р-10; план 12.1).
 *
 * Бой работал по HTTP на голом IP, и связь PMS ↔ Kars Avia шла так же:
 * секрет вебхуков, ключ гостиницы и брони с ФИО ехали открытым текстом.
 * Теперь в production PMS не стартует, если адрес наружу — `http://`:
 * свой адрес (PUBLIC_URL; `http://…` — режим без TLS) и адреса партнёра.
 *
 * Внутренние адреса не в счёт: имя без точки — служба docker-сети,
 * localhost — та же машина.
 *
 * Временный режим без доменов — только явным решением в .env:
 * ALLOW_INSECURE_HTTP=yes. Тогда при каждом старте — предупреждение. */

const NAMES = ['PUBLIC_URL', 'PARTNER_WEBHOOK_URL', 'PARTNER_REPORTS_URL'] as const;

function insecure(url: string | undefined): boolean {
  if (!url || !url.startsWith('http://')) return false;
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
  // Имя без точки (и не IPv6) — служба docker-сети.
  return host.includes('.') || host.includes(':');
}

/** Переменные, где на бою стоит `http://` наружу. */
export function insecureTransport(env: NodeJS.ProcessEnv = process.env): string[] {
  return NAMES.filter((n) => insecure(env[n]));
}

/** Вызывается до старта приложения. Вне production — ничего не проверяет. */
export function assertSecureTransport(
  env: NodeJS.ProcessEnv = process.env,
  warn: (m: string) => void = console.warn,
): void {
  if (env.NODE_ENV !== 'production') return;
  const bad = insecureTransport(env);
  if (!bad.length) return;
  const list = bad.map((n) => `${n}=${env[n]}`).join(', ');
  if (env.ALLOW_INSECURE_HTTP === 'yes') {
    warn(`ВНИМАНИЕ: production работает по HTTP (${list}) — разрешено ALLOW_INSECURE_HTTP=yes. Данные идут открытым текстом.`);
    return;
  }
  throw new Error(
    `В production адреса наружу — только https:// (152-ФЗ, план 12.1): ${list}. ` +
      'Временный режим без доменов — ALLOW_INSECURE_HTTP=yes в .env, осознанно.',
  );
}
