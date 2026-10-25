import React from 'react';
import { useQuery } from '@tanstack/react-query';
import Modal from '../HotelPMS/shared/Modal';
import formClasses from '../HotelPMS/shared/Form.module.css';
import * as superAdminApi from '../../api/superadmin';
import classes from './TenantDialogs.module.css';
import {
  CURRENCIES,
  PLANS,
  TENANT_EMPTY_DELETE_ENABLED,
  TIMEZONES,
  bookings,
  errorText,
  withCurrent,
} from './tenant-options';

/* Гостиницы из панели платформы (решение владельца 25.10.2026): правка
   карточки и удаление — суперадмину и диспетчеру Kars Avia. Ограничения
   держит сервер (валюта при бронях, удаление гостиницы с бронями), окна их
   называют заранее, чтобы человек не узнавал о них из отказа. */

function useSummary(tenant, open) {
  return useQuery({
    queryKey: ['admin', 'tenant-summary', tenant?.id],
    queryFn: () => superAdminApi.getTenantSummary(tenant.id),
    enabled: !!open && !!tenant,
    staleTime: 0,
  });
}

// ─── Правка ───────────────────────────────────────────────────────────────────

const EDIT_FIELDS = ['name', 'city', 'address', 'phone', 'email', 'stars', 'timezone', 'currency', 'plan'];

function formOf(t) {
  return {
    name: t?.name ?? '',
    city: t?.city ?? '',
    address: t?.address ?? '',
    phone: t?.phone ?? '',
    email: t?.email ?? '',
    stars: t?.stars ?? '',
    timezone: t?.timezone ?? 'Europe/Moscow',
    currency: t?.currency ?? 'RUB',
    plan: t?.plan ?? 'LITE',
  };
}

export function TenantEditModal({ tenant, open, onClose, onSaved }) {
  const [form, setForm] = React.useState(formOf(tenant));
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const summary = useSummary(tenant, open);

  React.useEffect(() => {
    if (open) {
      setForm(formOf(tenant));
      setError(null);
    }
  }, [open, tenant]);

  if (!tenant) return null;
  const initial = formOf(tenant);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const reservations = summary.data?.reservations ?? 0;
  const currencyLocked = reservations > 0;
  const changed = EDIT_FIELDS.filter((k) => String(form[k]) !== String(initial[k]));

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.name.trim().length < 2) {
      setError('Название — не короче 2 символов');
      return;
    }
    if (changed.length === 0) {
      onClose?.();
      return;
    }
    const payload = Object.fromEntries(
      changed.map((k) => [k, k === 'stars' ? (form.stars === '' ? null : Number(form.stars)) : form[k]]),
    );
    setBusy(true);
    setError(null);
    try {
      await superAdminApi.updateTenant(tenant.id, payload);
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(errorText(err, 'Не удалось сохранить'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Гостиница «${tenant.name}»`}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" className={formClasses.btnSecondary} onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="submit" form="tenant-edit-form" className={formClasses.btnPrimary} disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </>
      }
    >
      <form id="tenant-edit-form" onSubmit={handleSubmit} noValidate>
        {error && <div className={formClasses.alert}>{error}</div>}

        <div className={formClasses.field}>
          <label className={formClasses.label}>Название</label>
          <input className={formClasses.input} value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} />
          <div className={formClasses.hint}>
            Код гостиницы <span className={classes.code}>{tenant.slug}</span> не меняется — связь с Kars Avia сохранится.
          </div>
        </div>

        <div className={formClasses.row}>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Город</label>
            <input className={formClasses.input} value={form.city} maxLength={100} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Звёзды</label>
            <select className={formClasses.select} value={form.stars} onChange={(e) => set('stars', e.target.value)}>
              <option value="">— без звёзд —</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={formClasses.field}>
          <label className={formClasses.label}>Адрес</label>
          <input className={formClasses.input} value={form.address} maxLength={300} onChange={(e) => set('address', e.target.value)} />
        </div>

        <div className={formClasses.row}>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Телефон</label>
            <input className={formClasses.input} value={form.phone} maxLength={50} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Почта гостиницы</label>
            <input className={formClasses.input} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
        </div>

        <div className={formClasses.row3}>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Часовой пояс</label>
            <select className={formClasses.select} value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {withCurrent(TIMEZONES, initial.timezone).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Валюта</label>
            <select
              className={formClasses.select}
              value={form.currency}
              onChange={(e) => set('currency', e.target.value)}
              disabled={currencyLocked}
              title={currencyLocked ? 'У гостиницы есть брони — валюту не сменить' : undefined}
            >
              {withCurrent(CURRENCIES, initial.currency).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Тариф</label>
            <select className={formClasses.select} value={form.plan} onChange={(e) => set('plan', e.target.value)}>
              {PLANS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
        </div>

        {currencyLocked && (
          <div className={formClasses.hint}>
            Валюту не сменить: у гостиницы {bookings(reservations)}, их суммы и счета — в {initial.currency}.
          </div>
        )}
        {form.timezone !== initial.timezone && (
          <div className={classes.warn}>
            Смена часового пояса сдвинет показ времени заезда, выезда и сроков во всех бронях гостиницы.
          </div>
        )}
      </form>
    </Modal>
  );
}

// ─── Удаление ─────────────────────────────────────────────────────────────────

/**
 * Пустую гостиницу (без броней) — удалить сразу, с подтверждением. С бронями —
 * только по акту (152-ФЗ, план 13.8): выключить → выгрузить → ввести код и
 * уничтожить. Окно показывает, какой путь у этой гостиницы, и ведёт по шагам.
 */
export function TenantDeleteModal({ tenant, open, onClose, onDone, onToggleActive }) {
  const summary = useSummary(tenant, open);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [exported, setExported] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [result, setResult] = React.useState(null);

  React.useEffect(() => {
    if (open) {
      setError(null);
      setExported(false);
      setCode('');
      setResult(null);
    }
  }, [open, tenant?.id]);

  if (!tenant) return null;

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const s = summary.data;
  // Пока удаление пустой выключено, и пустую гостиницу окно ведёт по акту.
  const empty = TENANT_EMPTY_DELETE_ENABLED && s && s.reservations === 0;
  const close = busy ? undefined : onClose;

  let body;
  let footer;
  if (result) {
    body = <div className={classes.success}>{result}</div>;
    footer = (
      <button type="button" className={formClasses.btnPrimary} onClick={onClose}>
        Готово
      </button>
    );
  } else if (summary.isLoading || !s) {
    body = summary.isError ? (
      <div className={formClasses.alert}>{errorText(summary.error, 'Не удалось проверить гостиницу')}</div>
    ) : (
      <div className={classes.text}>Проверяем, что есть в гостинице…</div>
    );
    footer = (
      <button type="button" className={formClasses.btnSecondary} onClick={onClose}>
        Отмена
      </button>
    );
  } else if (empty) {
    body = (
      <>
        <div className={classes.text}>
          Броней у гостиницы нет — её можно удалить сразу. Вместе с ней будут удалены:
        </div>
        <ul className={classes.counts}>
          <li>номеров — {s.rooms}</li>
          <li>категорий — {s.roomTypes}</li>
          <li>учёток сотрудников — {s.users}</li>
        </ul>
        <div className={classes.warn}>
          Восстановить гостиницу будет нельзя. Если она заведена в Kars Avia (код{' '}
          <span className={classes.code}>{tenant.slug}</span>), её карточка там останется без связи с PMS.
        </div>
      </>
    );
    footer = (
      <>
        <button type="button" className={formClasses.btnSecondary} onClick={onClose} disabled={busy}>
          Отмена
        </button>
        <button
          type="button"
          className={formClasses.btnDanger}
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await superAdminApi.deleteTenant(tenant.id);
              setResult(`Гостиница «${tenant.name}» удалена. Запись об удалении — акт ${r.actId}.`);
              onDone?.();
            })
          }
        >
          {busy ? '…' : 'Удалить гостиницу'}
        </button>
      </>
    );
  } else {
    const off = !tenant.isActive;
    const canDestroy = off && exported && code.trim() === tenant.slug;
    body = (
      <>
        <div className={classes.text}>
          У гостиницы {bookings(s.reservations)} — сразу её не удалить: на бронях держатся
          гости, счета и оплаты. Такую гостиницу удаляют по акту, в три шага.
        </div>
        <ol className={classes.steps}>
          <li className={`${classes.step} ${off ? classes.stepDone : ''}`}>
            <span className={classes.stepNo}>1</span>
            <span className={classes.stepBody}>
              Выключить гостиницу — сотрудники не смогут войти, Kars Avia перестанет её видеть.
            </span>
            {!off && (
              <span className={classes.stepAction}>
                <button type="button" className={formClasses.btnSecondary} disabled={busy} onClick={() => run(() => onToggleActive?.(tenant))}>
                  Выключить
                </button>
              </span>
            )}
          </li>
          <li className={`${classes.step} ${exported ? classes.stepDone : ''}`}>
            <span className={classes.stepNo}>2</span>
            <span className={classes.stepBody}>Выгрузить все данные гостиницы в файл (выгрузка действует 7 дней).</span>
            <span className={classes.stepAction}>
              <button
                type="button"
                className={formClasses.btnSecondary}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await superAdminApi.exportTenant(tenant.id);
                    setExported(true);
                  })
                }
              >
                {exported ? 'Ещё раз' : 'Выгрузить'}
              </button>
            </span>
          </li>
          <li className={classes.step}>
            <span className={classes.stepNo}>3</span>
            <span className={classes.stepBody}>
              Для подтверждения введите код гостиницы <span className={classes.code}>{tenant.slug}</span>
              <input
                className={formClasses.input}
                style={{ marginTop: 6 }}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={tenant.slug}
                disabled={!off}
              />
            </span>
          </li>
        </ol>
        <div className={classes.warn}>
          Брони, гости, счета, сотрудники, журнал и файлы будут стёрты безвозвратно. Если гостиница заведена в Kars Avia,
          её карточка там останется без связи с PMS.
        </div>
      </>
    );
    footer = (
      <>
        <button type="button" className={formClasses.btnSecondary} onClick={onClose} disabled={busy}>
          Отмена
        </button>
        <button
          type="button"
          className={formClasses.btnDanger}
          disabled={busy || !canDestroy}
          title={!canDestroy ? 'Сначала выполните шаги 1–3' : undefined}
          onClick={() =>
            run(async () => {
              const r = await superAdminApi.destroyTenant(tenant.id, code.trim());
              setResult(`Гостиница «${tenant.name}» уничтожена по акту ${r.actId}.`);
              onDone?.();
            })
          }
        >
          {busy ? '…' : 'Уничтожить по акту'}
        </button>
      </>
    );
  }

  return (
    <Modal open={open} title={result ? `«${tenant.name}»` : `Удалить «${tenant.name}»?`} onClose={close} footer={footer}>
      {error && <div className={formClasses.alert}>{error}</div>}
      {body}
    </Modal>
  );
}
