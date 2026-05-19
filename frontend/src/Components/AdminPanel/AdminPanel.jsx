import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import * as superAdminApi from '../../api/superadmin';
import classes from './AdminPanel.module.css';

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
  { id: 'users',     label: 'Пользователи',    icon: 'users',     path: '/admin/users' },
  { id: 'create',    label: 'Добавить отель',  icon: 'create',    path: '/admin/create' },
  { id: 'settings',  label: 'Настройки',       icon: 'settings',  path: '/admin/settings' },
];

// divider before last item
const DIVIDER_BEFORE = 'create';

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function AdminSidebar({ activeId }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className={classes.sidebar}>
      <div className={classes.logo}>
        <div className={classes.logoBadge}>SA</div>
        <div className={classes.logoTexts}>
          <div className={classes.logoTitle}>Kars Hotel</div>
          <div className={classes.logoSubtitle}>Super Admin</div>
        </div>
      </div>

      <nav className={classes.nav}>
        {NAV_ITEMS.map((item) => (
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
            <div className={classes.userRole}>Суперадминистратор</div>
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

function HotelsSection() {
  const { impersonate } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [impersonatingId, setImpersonatingId] = React.useState(null);

  const { data: tenants = [], isLoading } = useQuery({ queryKey: ['admin', 'tenants'], queryFn: superAdminApi.listTenants });

  const toggleActive = useMutation({
    mutationFn: (id) => superAdminApi.toggleTenantActive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });

  const filtered = tenants.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.city ?? '').toLowerCase().includes(search.toLowerCase())
  );

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
                      <button className={`${classes.btnAction} ${t.isActive ? classes.btnActionOff : classes.btnActionOn}`} onClick={() => toggleActive.mutate(t.id)} disabled={toggleActive.isPending}>
                        {t.isActive ? 'Откл.' : 'Вкл.'}
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

function CreateSection() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = React.useState({ hotelName: '', email: '', password: '', fullName: '', timezone: 'Europe/Moscow', currency: 'RUB', plan: 'LITE' });
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const create = useMutation({
    mutationFn: superAdminApi.createTenant,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });

  function handleChange(e) { setForm((f) => ({ ...f, [e.target.name]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await create.mutateAsync(form);
      setSuccess(`Отель «${form.hotelName}» успешно создан!`);
      setForm({ hotelName: '', email: '', password: '', fullName: '', timezone: 'Europe/Moscow', currency: 'RUB', plan: 'LITE' });
    } catch (err) {
      const msg = err?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Ошибка при создании'));
    }
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
              <input className={classes.formInput} name="hotelName" value={form.hotelName} onChange={handleChange} required placeholder="Гранд Отель Москва" />
            </label>
            <label className={classes.formLabel}>Тарифный план
              <select className={classes.formSelect} name="plan" value={form.plan} onChange={handleChange}>
                <option value="LITE">Lite — базовый</option>
                <option value="STANDART">Standart — стандартный</option>
                <option value="PREMIUM">Premium — расширенный</option>
              </select>
            </label>
            <label className={classes.formLabel}>Часовой пояс
              <select className={classes.formSelect} name="timezone" value={form.timezone} onChange={handleChange}>
                <option value="Europe/Kaliningrad">Калининград (UTC+2)</option>
                <option value="Europe/Moscow">Москва (UTC+3)</option>
                <option value="Europe/Samara">Самара (UTC+4)</option>
                <option value="Asia/Yekaterinburg">Екатеринбург (UTC+5)</option>
                <option value="Asia/Novosibirsk">Новосибирск (UTC+7)</option>
                <option value="Asia/Vladivostok">Владивосток (UTC+10)</option>
                <option value="UTC">UTC</option>
              </select>
            </label>
            <label className={classes.formLabel}>Валюта
              <select className={classes.formSelect} name="currency" value={form.currency} onChange={handleChange}>
                <option value="RUB">RUB — Рубль</option>
                <option value="USD">USD — Доллар</option>
                <option value="EUR">EUR — Евро</option>
                <option value="KZT">KZT — Тенге</option>
              </select>
            </label>
          </div>

          <div className={classes.formDivider} />

          <div className={classes.formSectionTitle}>Аккаунт владельца</div>
          <div className={classes.formGrid}>
            <label className={classes.formLabel}>Имя и фамилия <span className={classes.req}>*</span>
              <input className={classes.formInput} name="fullName" value={form.fullName} onChange={handleChange} required placeholder="Иванов Иван" />
            </label>
            <label className={classes.formLabel}>Email <span className={classes.req}>*</span>
              <input className={classes.formInput} name="email" type="email" value={form.email} onChange={handleChange} required placeholder="owner@hotel.ru" />
            </label>
            <label className={classes.formLabel}>Пароль <span className={classes.req}>*</span>
              <input className={classes.formInput} name="password" type="password" value={form.password} onChange={handleChange} required minLength={8} placeholder="Минимум 8 символов" />
            </label>
          </div>

          {error && <div className={classes.formError}>{error}</div>}
          {success && <div className={classes.formSuccess}>{success}</div>}

          <div className={classes.formActions}>
            <button type="button" className={classes.btnSecondary} onClick={() => navigate('/admin/hotels')}>Отмена</button>
            <button type="submit" className={classes.btnPrimary} disabled={create.isPending}>
              {create.isPending ? 'Создание…' : 'Создать отель'}
            </button>
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
            <div className={classes.settingsRow}><span>Роль</span><strong>Суперадминистратор</strong></div>
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
  const parts = location.pathname.split('/').filter(Boolean); // ['admin', 'hotels']
  const activeId = parts[1] || 'overview';

  function renderContent() {
    switch (activeId) {
      case 'hotels':   return <HotelsSection />;
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
