import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import * as superAdminApi from '../../api/superadmin';
import classes from './AdminPanel.module.css';
import JournalSection from './JournalSection';
import ConfirmDialog from '../HotelPMS/shared/ConfirmDialog';
import { TenantDeleteModal, TenantEditModal } from './TenantDialogs';
import { CURRENCIES, PLANS, TIMEZONES, errorText } from './tenant-options';

// ─── Icons ────────────────────────────────────────────────────────────────────

const ICONS = {
  overview: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  hotels: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9,22 9,12 15,12 15,22"/>
    </svg>
  ),
  users: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  create: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  journal: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/><polyline points="12,7 12,12 15,14"/>
    </svg>
  ),
  logout: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
};

const NAV_ITEMS = [
  { id: 'overview',  label: 'Обзор',          icon: 'overview',  path: '/admin' },
  { id: 'hotels',    label: 'Отели',           icon: 'hotels',    path: '/admin/hotels' },
  { id: 'features',  label: 'Функции гостиниц', icon: 'settings', path: '/admin/features' },
  { id: 'journal',   label: 'Журнал действий', icon: 'journal',   path: '/admin/journal' },
  { id: 'users',     label: 'Пользователи',    icon: 'users',     path: '/admin/users' },
  { id: 'create',    label: 'Добавить отель',  icon: 'create',    path: '/admin/create' },
  { id: 'settings',  label: 'Настройки',       icon: 'settings',  path: '/admin/settings' },
];

// divider before last item
const DIVIDER_BEFORE = 'create';

// ─── Sidebar ──────────────────────────────────────────────────────────────────

/* Диспетчеру Kars Avia (152-ФЗ, Р-34; план 13.3) — обзор и отели со входом
   «от имени»: сотрудники гостиниц и настройки платформы — суперадмину
   (сервер отвечает ему 403). Функции гостиниц массово — и диспетчеру (решение
   владельца 22.10.2026); заведение, правка, выключение и удаление гостиниц —
   тоже (решение владельца 25.10.2026). */
const DISPATCHER_SECTIONS = ['overview', 'hotels', 'features', 'journal', 'create'];

function AdminSidebar({ activeId }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className={classes.sidebar}>
      <div className={classes.logo}>
        <div className={classes.logoBadge}>SA</div>
        <div className={classes.logoTexts}>
          <div className={classes.logoTitle}>Kars Hotel</div>
          <div className={classes.logoSubtitle}>{user?.isDispatcher ? 'Диспетчер Kars Avia' : 'Super Admin'}</div>
        </div>
      </div>

      <nav className={classes.nav}>
        {NAV_ITEMS.filter((item) => !user?.isDispatcher || DISPATCHER_SECTIONS.includes(item.id)).map((item) => (
          <React.Fragment key={item.id}>
            {item.id === DIVIDER_BEFORE && <div className={classes.divider} />}
            <div
              className={`${classes.navItem} ${activeId === item.id ? classes.active : ''}`}
              onClick={() => navigate(item.path)}
            >
              <span className={classes.navIcon}>{ICONS[item.icon]}</span>
              <span className={classes.navLabel}>{item.label}</span>
            </div>
          </React.Fragment>
        ))}
      </nav>

      <div className={classes.footer}>
        {user && (
          <div className={classes.user}>
            <div className={classes.userName} title={user.email}>{user.fullName || user.email}</div>
            <div className={classes.userRole}>{user?.isDispatcher ? 'Администратор' : 'Суперадминистратор'}</div>
          </div>
        )}
        <button type="button" className={classes.logoutBtn} onClick={logout}>
          {ICONS.logout} Выйти
        </button>
        <div className={classes.version}>Platform v1.0</div>
      </div>
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewSection() {
  const { data: stats } = useQuery({ queryKey: ['admin', 'stats'], queryFn: superAdminApi.getStats });
  const { data: tenants = [] } = useQuery({ queryKey: ['admin', 'tenants'], queryFn: superAdminApi.listTenants });
  const navigate = useNavigate();

  const recent = [...tenants].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);

  return (
    <div className={classes.page}>
      <div className={classes.pageHeader}>
        <h1 className={classes.pageTitle}>Обзор платформы</h1>
      </div>

      <div className={classes.statsGrid}>
        <StatCard label="Всего отелей"  value={stats?.totalTenants ?? '—'}  color="#3b82f6"
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>}
        />
        <StatCard label="Активных"      value={stats?.activeTenants ?? '—'} color="#10b981"
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>}
        />
        <StatCard label="Пользователей" value={stats?.totalUsers ?? '—'}    color="#f59e0b"
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
        />
      </div>

      <div className={classes.card}>
        <div className={classes.cardHeader}>
          <h2 className={classes.cardTitle}>Последние отели</h2>
          <button className={classes.btnLink} onClick={() => navigate('/admin/hotels')}>Все отели →</button>
        </div>
        <table className={classes.table}>
          <thead>
            <tr><th>Название</th><th>Город</th><th>Тариф</th><th>Статус</th><th>Создан</th></tr>
          </thead>
          <tbody>
            {recent.map((t) => (
              <tr key={t.id}>
                <td className={classes.bold}>{t.name}</td>
                <td className={classes.muted}>{t.city ?? '—'}</td>
                <td><PlanBadge plan={t.plan} /></td>
                <td><StatusBadge active={t.isActive} /></td>
                <td className={classes.muted}>{fmt(t.createdAt)}</td>
              </tr>
            ))}
            {recent.length === 0 && <tr><td colSpan={5} className={classes.empty}>Отелей ещё нет</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Hotels ───────────────────────────────────────────────────────────────────

/* Гостиницы (решение владельца 25.10.2026): заведение, правка, выключение и
   удаление — суперадмину и диспетчеру Kars Avia. Удаление: пустую (без
   броней) — сразу, с бронями — по акту 152-ФЗ (выключить → выгрузить →
   ввести код); окно `TenantDeleteModal` само выбирает путь. */
function HotelsSection() {
  const { impersonate } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [impersonatingId, setImpersonatingId] = React.useState(null);
  // Храним id, а не объект: после выключения строка списка обновится, и окно увидит новое состояние.
  const [editId, setEditId] = React.useState(null);
  const [deleteId, setDeleteId] = React.useState(null);
  // Снимок на случай, когда гостиница уже удалена и из списка пропала, а окно ещё показывает «удалена».
  const [deleteSnap, setDeleteSnap] = React.useState(null);
  const [toggleId, setToggleId] = React.useState(null);

  const { data: tenants = [], isLoading } = useQuery({ queryKey: ['admin', 'tenants'], queryFn: superAdminApi.listTenants });
  const byId = (id) => tenants.find((t) => t.id === id) ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });

  async function toggleTenant(tenant) {
    await superAdminApi.toggleTenantActive(tenant.id);
    await refresh();
  }

  const filtered = tenants.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.city ?? '').toLowerCase().includes(search.toLowerCase())
  );

  /* Уход гостиницы (152-ФЗ, план 13.8): выгрузка — отдельной кнопкой и
     вторым шагом в окне удаления. */
  async function handleExport(tenant) {
    try {
      await superAdminApi.exportTenant(tenant.id);
    } catch (err) {
      alert('Ошибка выгрузки: ' + errorText(err));
    }
  }

  async function handleImpersonate(tenant) {
    setImpersonatingId(tenant.id);
    try {
      await impersonate(tenant);
      navigate('/dashboard');
    } catch (err) {
      alert('Ошибка: ' + (err?.response?.data?.message ?? err.message));
    } finally {
      setImpersonatingId(null);
    }
  }

  return (
    <div className={classes.page}>
      <div className={classes.pageHeader}>
        <h1 className={classes.pageTitle}>Отели ({filtered.length})</h1>
        <div className={classes.headerActions}>
          <div className={classes.searchWrap}>
            <svg className={classes.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input className={classes.searchInput} placeholder="Поиск…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className={classes.btnPrimary} onClick={() => navigate('/admin/create')}>+ Добавить отель</button>
        </div>
      </div>

      <div className={classes.card}>
        {isLoading ? <div className={classes.loading}>Загрузка…</div> : (
          <table className={classes.table}>
            <thead>
              <tr><th>Название</th><th>Город</th><th>Тариф</th><th>Польз.</th><th>Статус</th><th>Создан</th><th>Действия</th></tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className={!t.isActive ? classes.rowInactive : ''}>
                  <td className={classes.bold}>{t.name}</td>
                  <td className={classes.muted}>{t.city ?? '—'}</td>
                  <td><PlanBadge plan={t.plan} /></td>
                  <td className={classes.muted}>{t.usersCount}</td>
                  <td><StatusBadge active={t.isActive} /></td>
                  <td className={classes.muted}>{fmt(t.createdAt)}</td>
                  <td>
                    <div className={classes.rowActions}>
                      <button className={classes.btnAction} onClick={() => handleImpersonate(t)} disabled={!t.isActive || impersonatingId === t.id} title="Войти от имени">
                        {impersonatingId === t.id ? '…' : 'Войти'}
                      </button>
                      <button className={classes.btnAction} onClick={() => setEditId(t.id)} title="Изменить карточку гостиницы">
                        Править
                      </button>
                      <button
                        className={`${classes.btnAction} ${t.isActive ? classes.btnActionOff : classes.btnActionOn}`}
                        onClick={() => (t.isActive ? setToggleId(t.id) : toggleTenant(t).catch((err) => alert(errorText(err))))}
                      >
                        {t.isActive ? 'Откл.' : 'Вкл.'}
                      </button>
                      <button className={classes.btnAction} onClick={() => handleExport(t)} title="Выгрузить все данные гостиницы">
                        Выгрузить
                      </button>
                      <button
                        className={`${classes.btnAction} ${classes.btnActionOff}`}
                        onClick={() => {
                          setDeleteId(t.id);
                          setDeleteSnap(t);
                        }}
                        title="Удалить гостиницу"
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className={classes.empty}>{search ? 'Ничего не найдено' : 'Отелей нет'}</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      <TenantEditModal tenant={byId(editId)} open={!!editId} onClose={() => setEditId(null)} onSaved={refresh} />
      <TenantDeleteModal
        tenant={byId(deleteId) ?? (deleteSnap?.id === deleteId ? deleteSnap : null)}
        open={!!deleteId}
        onClose={() => {
          setDeleteId(null);
          setDeleteSnap(null);
        }}
        onDone={refresh}
        onToggleActive={toggleTenant}
      />
      {/* Выключение — с предупреждением: гостиница выпадает целиком, вместе со входом сотрудников. */}
      <ConfirmDialog
        open={!!toggleId}
        title={`Выключить «${byId(toggleId)?.name ?? ''}»?`}
        message="Сотрудники гостиницы не смогут войти в PMS, а Kars Avia перестанет её видеть и бронировать. Данные сохранятся — гостиницу можно включить обратно."
        confirmLabel="Выключить"
        danger
        onClose={() => setToggleId(null)}
        onConfirm={() => toggleTenant(byId(toggleId))}
      />
    </div>
  );
}

// ─── Функции гостиниц (массово) ───────────────────────────────────────────────

/* Включить функцию (например, многоместные номера) сразу у многих гостиниц:
   выбрать нужные или «Выбрать все» и применить. Сами гостиницы по-прежнему
   могут переключить её у себя в «Настройки → Функции». */
function FeaturesSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'features'], queryFn: superAdminApi.listFeatures });
  const features = data?.features ?? [];
  const tenants = data?.tenants ?? [];
  const [featureKey, setFeatureKey] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [state, setState] = React.useState('all'); // all | on | off
  const [selected, setSelected] = React.useState(() => new Set());
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState(null);

  const feature = features.find((f) => f.key === featureKey) ?? features[0];
  const isOn = (t) => feature && t.features?.[feature.key] === true;
  const onCount = tenants.filter(isOn).length;

  const q = search.trim().toLowerCase();
  const shown = tenants.filter(
    (t) =>
      (!q || t.name.toLowerCase().includes(q) || (t.city ?? '').toLowerCase().includes(q)) &&
      (state === 'all' || (state === 'on') === isOn(t)),
  );
  const allShownSelected = shown.length > 0 && shown.every((t) => selected.has(t.id));

  const toggle = (id) =>
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAllShown = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      for (const t of shown) allShownSelected ? next.delete(t.id) : next.add(t.id);
      return next;
    });

  const apply = useMutation({
    mutationFn: (enabled) => superAdminApi.applyFeature(feature.key, enabled, [...selected]),
    onSuccess: (r) => {
      setError(null);
      setResult(r);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['admin', 'features'] });
    },
    onError: (err) => {
      setResult(null);
      const msg = err?.response?.data?.message ?? err.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg);
    },
  });

  const run = (enabled) => {
    const verb = enabled ? 'Включить' : 'Выключить';
    if (!window.confirm(`${verb} «${feature.label}» у выбранных гостиниц (${selected.size})?`)) return;
    apply.mutate(enabled);
  };

  return (
    <div className={classes.page}>
      <div className={classes.pageHeader}>
        <h1 className={classes.pageTitle}>Функции гостиниц</h1>
      </div>

      {isLoading ? <div className={classes.loading}>Загрузка…</div> : (
        <>
          <div className={classes.featureList}>
            {features.map((f) => {
              const n = tenants.filter((t) => t.features?.[f.key] === true).length;
              return (
                <button
                  type="button"
                  key={f.key}
                  className={`${classes.featureCard} ${feature?.key === f.key ? classes.featureCardActive : ''}`}
                  onClick={() => { setFeatureKey(f.key); setResult(null); }}
                >
                  <div className={classes.featureTitle}>{f.label}</div>
                  <div className={classes.featureDesc}>{f.description}</div>
                  <div className={classes.featureCount}>Включено у {n} из {tenants.length}</div>
                </button>
              );
            })}
          </div>

          {feature && (
            <div className={classes.card}>
              <div className={classes.featureToolbar}>
                <div className={classes.searchWrap}>
                  <svg className={classes.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input className={classes.searchInput} placeholder="Поиск: название, город" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className={classes.segTabs}>
                  {[['all', `Все · ${tenants.length}`], ['on', `Включено · ${onCount}`], ['off', `Выключено · ${tenants.length - onCount}`]].map(([v, label]) => (
                    <button type="button" key={v} className={`${classes.segTab} ${state === v ? classes.segTabActive : ''}`} onClick={() => setState(v)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className={classes.featureActions}>
                  <span className={classes.muted}>Выбрано: {selected.size}</span>
                  <button className={classes.btnPrimary} disabled={selected.size === 0 || apply.isPending} onClick={() => run(true)}>
                    Включить у выбранных
                  </button>
                  <button className={classes.btnAction} disabled={selected.size === 0 || apply.isPending} onClick={() => run(false)}>
                    Выключить у выбранных
                  </button>
                </div>
              </div>
              {result && (
                <div className={classes.formSuccess} style={{ margin: '0 20px 12px' }}>
                  {result.enabled ? 'Включено' : 'Выключено'} у {result.changed} из {result.requested} выбранных
                  {result.changed < result.requested ? ' (у остальных уже было так)' : ''}.
                </div>
              )}
              {error && <div className={classes.formError} style={{ margin: '0 20px 12px' }}>{error}</div>}
              <table className={classes.table}>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>
                      <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} title="Выбрать все показанные" aria-label="Выбрать все" />
                    </th>
                    <th>Название</th><th>Город</th><th>Статус</th><th>{feature.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id} className={!t.isActive ? classes.rowInactive : ''} onClick={() => toggle(t.id)} style={{ cursor: 'pointer' }}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} aria-label={t.name} />
                      </td>
                      <td className={classes.bold}>{t.name}</td>
                      <td className={classes.muted}>{t.city ?? '—'}</td>
                      <td><StatusBadge active={t.isActive} /></td>
                      <td><span className={isOn(t) ? classes.statusOn : classes.muted}>{isOn(t) ? 'Включено' : 'Выключено'}</span></td>
                    </tr>
                  ))}
                  {shown.length === 0 && <tr><td colSpan={5} className={classes.empty}>Ничего не найдено</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Users ────────────────────────────────────────────────────────────────────

function UsersSection() {
  const qc = useQueryClient();
  const [search, setSearch] = React.useState('');
  const { data: users = [], isLoading } = useQuery({ queryKey: ['admin', 'users'], queryFn: superAdminApi.listUsers });

  const toggleActive = useMutation({
    mutationFn: (id) => superAdminApi.toggleUserActive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const filtered = users.filter((u) =>
    !search ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.fullName.toLowerCase().includes(search.toLowerCase()) ||
    u.tenant.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className={classes.page}>
      <div className={classes.pageHeader}>
        <h1 className={classes.pageTitle}>Пользователи ({filtered.length})</h1>
        <div className={classes.searchWrap}>
          <svg className={classes.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input className={classes.searchInput} placeholder="Поиск по имени, email, отелю…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className={classes.card}>
        {isLoading ? <div className={classes.loading}>Загрузка…</div> : (
          <table className={classes.table}>
            <thead>
              <tr><th>Имя</th><th>Email</th><th>Отель</th><th>Роль</th><th>Статус</th><th>Последний вход</th><th>Действие</th></tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className={!u.isActive ? classes.rowInactive : ''}>
                  <td className={classes.bold}>{u.fullName}</td>
                  <td className={classes.muted}>{u.email}</td>
                  <td>{u.tenant.name}</td>
                  <td><span className={classes.roleBadge}>{u.role}</span></td>
                  <td><StatusBadge active={u.isActive} /></td>
                  <td className={classes.muted}>{u.lastLoginAt ? fmt(u.lastLoginAt) : '—'}</td>
                  <td>
                    <button
                      className={`${classes.btnAction} ${u.isActive ? classes.btnActionOff : classes.btnActionOn}`}
                      onClick={() => toggleActive.mutate(u.id)}
                      disabled={toggleActive.isPending}
                    >
                      {u.isActive ? 'Откл.' : 'Вкл.'}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className={classes.empty}>{search ? 'Ничего не найдено' : 'Пользователей нет'}</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Create hotel ─────────────────────────────────────────────────────────────

/* Заведение гостиницы (решение владельца 25.10.2026): учётка владельца — по
   желанию; гостиница с тем же названием в том же городе — предупреждение
   сервера (409 DUPLICATE_HOTEL) и «Всё равно создать». */
const EMPTY_HOTEL = {
  hotelName: '', city: '', address: '', phone: '', email: '',
  timezone: 'Europe/Moscow', currency: 'RUB', plan: 'LITE',
  ownerFullName: '', ownerEmail: '', ownerPassword: '',
};

function CreateSection() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = React.useState(EMPTY_HOTEL);
  const [withOwner, setWithOwner] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');
  const [duplicate, setDuplicate] = React.useState(null); // { message, duplicates }

  const create = useMutation({
    mutationFn: superAdminApi.createTenant,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setDuplicate(null);
  }

  async function submit(allowDuplicate) {
    setError(''); setSuccess('');
    const payload = Object.fromEntries(
      Object.entries(form).filter(([k, v]) => v.trim() !== '' && (withOwner || !k.startsWith('owner'))),
    );
    try {
      const res = await create.mutateAsync({ ...payload, ...(allowDuplicate ? { allowDuplicate: true } : {}) });
      setSuccess(
        `Отель «${res.name}» создан (код ${res.slug}).` +
          (res.withOwner ? ' Владелец может входить.' : ' Учётки владельца нет — пригласите его позже.'),
      );
      setForm(EMPTY_HOTEL);
      setDuplicate(null);
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === 'DUPLICATE_HOTEL') setDuplicate(data);
      else setError(errorText(err, 'Ошибка при создании'));
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    submit(false);
  }

  return (
    <div className={classes.page}>
      <div className={classes.pageHeader}>
        <h1 className={classes.pageTitle}>Добавить отель</h1>
      </div>
      <div className={classes.formCard}>
        <form onSubmit={handleSubmit}>
          <div className={classes.formSectionTitle}>Информация об отеле</div>
          <div className={classes.formGrid}>
            <label className={classes.formLabel}>Название <span className={classes.req}>*</span>
              <input className={classes.formInput} name="hotelName" value={form.hotelName} onChange={handleChange} required minLength={2} maxLength={200} placeholder="Гранд Отель Москва" />
            </label>
            <label className={classes.formLabel}>Город
              <input className={classes.formInput} name="city" value={form.city} onChange={handleChange} maxLength={100} placeholder="Москва" />
            </label>
            <label className={classes.formLabel}>Адрес
              <input className={classes.formInput} name="address" value={form.address} onChange={handleChange} maxLength={300} placeholder="ул. Тверская, 1" />
            </label>
            <label className={classes.formLabel}>Телефон
              <input className={classes.formInput} name="phone" value={form.phone} onChange={handleChange} maxLength={50} placeholder="+7 900 000-00-00" />
            </label>
            <label className={classes.formLabel}>Почта гостиницы
              <input className={classes.formInput} name="email" type="email" value={form.email} onChange={handleChange} placeholder="info@hotel.ru" />
            </label>
            <label className={classes.formLabel}>Тарифный план
              <select className={classes.formSelect} name="plan" value={form.plan} onChange={handleChange}>
                {PLANS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className={classes.formLabel}>Часовой пояс
              <select className={classes.formSelect} name="timezone" value={form.timezone} onChange={handleChange}>
                {TIMEZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className={classes.formLabel}>Валюта
              <select className={classes.formSelect} name="currency" value={form.currency} onChange={handleChange}>
                {CURRENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>

          <div className={classes.formDivider} />

          <div className={classes.formSectionTitle}>Аккаунт владельца</div>
          <label className={classes.formLabel} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={withOwner} onChange={(e) => setWithOwner(e.target.checked)} />
            Сразу завести учётку владельца
          </label>
          {!withOwner && (
            <div className={classes.muted} style={{ fontSize: 13, margin: '6px 0 0' }}>
              Гостиница появится без кабинета — владельца можно пригласить позже.
            </div>
          )}
          {withOwner && (
            <div className={classes.formGrid}>
              <label className={classes.formLabel}>Имя и фамилия <span className={classes.req}>*</span>
                <input className={classes.formInput} name="ownerFullName" value={form.ownerFullName} onChange={handleChange} required placeholder="Иванов Иван" />
              </label>
              <label className={classes.formLabel}>Email для входа <span className={classes.req}>*</span>
                <input className={classes.formInput} name="ownerEmail" type="email" value={form.ownerEmail} onChange={handleChange} required placeholder="owner@hotel.ru" />
              </label>
              <label className={classes.formLabel}>Пароль <span className={classes.req}>*</span>
                <input className={classes.formInput} name="ownerPassword" type="password" value={form.ownerPassword} onChange={handleChange} required minLength={8} placeholder="Минимум 8 символов" />
              </label>
            </div>
          )}

          {duplicate && (
            <div className={classes.formWarn}>
              <div>{duplicate.message}</div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {(duplicate.duplicates ?? []).map((d) => (
                  <li key={d.id}>«{d.name}»{d.city ? `, ${d.city}` : ''}{d.isActive ? '' : ' (выключена)'}</li>
                ))}
              </ul>
            </div>
          )}
          {error && <div className={classes.formError}>{error}</div>}
          {success && <div className={classes.formSuccess}>{success}</div>}

          <div className={classes.formActions}>
            <button type="button" className={classes.btnSecondary} onClick={() => navigate('/admin/hotels')}>Отмена</button>
            {duplicate ? (
              <button type="button" className={classes.btnPrimary} disabled={create.isPending} onClick={() => submit(true)}>
                {create.isPending ? 'Создание…' : 'Всё равно создать'}
              </button>
            ) : (
              <button type="submit" className={classes.btnPrimary} disabled={create.isPending}>
                {create.isPending ? 'Создание…' : 'Создать отель'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function SettingsSection() {
  const { user } = useAuth();
  const [pwd, setPwd] = React.useState({ current: '', next: '', confirm: '' });
  const [pwdError, setPwdError] = React.useState('');
  const [pwdSuccess, setPwdSuccess] = React.useState('');

  const changePwd = useMutation({ mutationFn: (p) => superAdminApi.changeAdminPassword(p) });

  async function handlePwdSubmit(e) {
    e.preventDefault();
    setPwdError(''); setPwdSuccess('');
    if (pwd.next.length < 8) { setPwdError('Минимум 8 символов'); return; }
    if (pwd.next !== pwd.confirm) { setPwdError('Пароли не совпадают'); return; }
    try {
      await changePwd.mutateAsync(pwd.next);
      setPwdSuccess('Пароль успешно изменён');
      setPwd({ current: '', next: '', confirm: '' });
    } catch (err) {
      setPwdError(err?.response?.data?.message ?? 'Ошибка при смене пароля');
    }
  }

  return (
    <div className={classes.page}>
      <div className={classes.pageHeader}>
        <h1 className={classes.pageTitle}>Настройки платформы</h1>
      </div>

      <div className={classes.settingsLayout}>
        {/* Account info */}
        <div className={classes.formCard}>
          <div className={classes.formSectionTitle}>Учётная запись</div>
          <div className={classes.settingsInfo}>
            <div className={classes.settingsRow}><span>Email</span><strong>{user?.email}</strong></div>
            <div className={classes.settingsRow}><span>Имя</span><strong>{user?.fullName}</strong></div>
            <div className={classes.settingsRow}><span>Роль</span><strong>{user?.isDispatcher ? 'Администратор' : 'Суперадминистратор'}</strong></div>
          </div>

          <div className={classes.formDivider} />

          <div className={classes.formSectionTitle}>Сменить пароль</div>
          <form onSubmit={handlePwdSubmit}>
            <div className={classes.settingsFields}>
              <label className={classes.formLabel}>Новый пароль
                <input className={classes.formInput} type="password" value={pwd.next} onChange={(e) => setPwd((p) => ({ ...p, next: e.target.value }))} placeholder="Минимум 8 символов" required minLength={8} />
              </label>
              <label className={classes.formLabel}>Повторите пароль
                <input className={classes.formInput} type="password" value={pwd.confirm} onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))} placeholder="Повторите новый пароль" required />
              </label>
            </div>
            {pwdError && <div className={classes.formError}>{pwdError}</div>}
            {pwdSuccess && <div className={classes.formSuccess}>{pwdSuccess}</div>}
            <div className={classes.formActions}>
              <button type="submit" className={classes.btnPrimary} disabled={changePwd.isPending}>
                {changePwd.isPending ? 'Сохранение…' : 'Сменить пароль'}
              </button>
            </div>
          </form>
        </div>

        {/* Platform info */}
        <div className={classes.formCard}>
          <div className={classes.formSectionTitle}>О платформе</div>
          <div className={classes.settingsInfo}>
            <div className={classes.settingsRow}><span>Версия PMS</span><strong>1.0 Beta</strong></div>
            <div className={classes.settingsRow}><span>База данных</span><strong>PostgreSQL + RLS</strong></div>
            <div className={classes.settingsRow}><span>Архитектура</span><strong>Multi-tenant SaaS</strong></div>
            <div className={classes.settingsRow}><span>Аутентификация</span><strong>JWT + httpOnly cookie</strong></div>
            <div className={classes.settingsRow}><span>Тарифные планы</span><strong>Lite / Standart / Premium</strong></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

function StatCard({ label, value, color, icon }) {
  return (
    <div className={classes.statCard}>
      <div className={classes.statIcon} style={{ background: color + '18', color }}>{icon}</div>
      <div>
        <div className={classes.statValue}>{value}</div>
        <div className={classes.statLabel}>{label}</div>
      </div>
    </div>
  );
}

function PlanBadge({ plan }) {
  const colors = { LITE: '#6366f1', STANDART: '#0891b2', PREMIUM: '#d97706' };
  const c = colors[plan] ?? '#64748b';
  return <span className={classes.planBadge} style={{ color: c, background: c + '18' }}>{plan}</span>;
}

function StatusBadge({ active }) {
  return <span className={active ? classes.statusOn : classes.statusOff}>{active ? 'Активен' : 'Откл.'}</span>;
}

function fmt(dateStr) {
  return new Date(dateStr).toLocaleDateString('ru-RU');
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function AdminPanel() {
  const location = useLocation();
  const { user } = useAuth();
  const parts = location.pathname.split('/').filter(Boolean); // ['admin', 'hotels']
  const requested = parts[1] || 'overview';
  const activeId = user?.isDispatcher && !DISPATCHER_SECTIONS.includes(requested) ? 'overview' : requested;

  function renderContent() {
    switch (activeId) {
      case 'hotels':   return <HotelsSection />;
      case 'features': return <FeaturesSection />;
      case 'journal':  return <JournalSection />;
      case 'users':    return <UsersSection />;
      case 'create':   return <CreateSection />;
      case 'settings': return <SettingsSection />;
      default:         return <OverviewSection />;
    }
  }

  return (
    <div className={classes.root}>
      <AdminSidebar activeId={activeId} />
      <main className={classes.content}>
        {renderContent()}
      </main>
    </div>
  );
}
