import React, { useState, useEffect, useCallback } from 'react';
import s from './Settings.module.css';
import f from '../../shared/Form.module.css';
import { useTenantSettings, useUpdateTenantSettings } from '../../../../hooks/api/useTenantSettings';

// ─── Nav sections ─────────────────────────────────────────────────────────────

const NAV_SECTIONS = [
  {
    id: 'general',
    label: 'Основная информация',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9,22 9,12 15,12 15,22" />
      </svg>
    ),
  },
  {
    id: 'region',
    label: 'Регион и валюта',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    id: 'taxes',
    label: 'Налоги и сборы',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    id: 'policies',
    label: 'Политики заезда',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    id: 'features',
    label: 'Функции',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
      </svg>
    ),
  },
];

const COUNTRIES = [
  { value: 'RU', label: 'Россия' },
  { value: 'KZ', label: 'Казахстан' },
  { value: 'UZ', label: 'Узбекистан' },
  { value: 'OTHER', label: 'Другая' },
];

const TIMEZONES = [
  { value: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { value: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { value: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { value: 'Asia/Yakutsk', label: 'Якутск (UTC+9)' },
  { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { value: 'Asia/Magadan', label: 'Магадан (UTC+11)' },
  { value: 'Asia/Kamchatka', label: 'Камчатка (UTC+12)' },
  { value: 'Asia/Almaty', label: 'Алматы (UTC+6)' },
  { value: 'Asia/Tashkent', label: 'Ташкент (UTC+5)' },
];

const CURRENCIES = [
  { value: 'RUB', label: 'RUB — Российский рубль' },
  { value: 'USD', label: 'USD — Доллар США' },
  { value: 'EUR', label: 'EUR — Евро' },
  { value: 'KZT', label: 'KZT — Казахстанский тенге' },
  { value: 'UZS', label: 'UZS — Узбекский сум' },
];

// ─── Toggle component ──────────────────────────────────────────────────────────

function Toggle({ checked, onChange }) {
  return (
    <label className={s.toggle}>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span className={s.toggleSlider} />
    </label>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <>
      {[80, 55, 70, 90, 40].map((w, i) => (
        <div key={i} className={s.skeleton}>
          <div className={s.skeletonLine} style={{ width: `${w}%` }} />
          <div className={s.skeletonLine} style={{ width: '100%', height: 40 }} />
          <div className={s.skeletonLine} style={{ width: '60%' }} />
        </div>
      ))}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Settings() {
  const { data: settings, isLoading } = useTenantSettings();
  const updateMutation = useUpdateTenantSettings();

  const [activeSection, setActiveSection] = useState('general');
  const [form, setForm] = useState(null);
  const [savedSection, setSavedSection] = useState(null);
  const [saveError, setSaveError] = useState(null);

  // Populate form from loaded settings
  useEffect(() => {
    if (settings && !form) {
      setForm({
        name:              settings.name              ?? '',
        address:           settings.address           ?? '',
        city:              settings.city              ?? '',
        country:           settings.country           ?? 'RU',
        phone:             settings.phone             ?? '',
        website:           settings.website           ?? '',
        email:             settings.email             ?? '',
        stars:             settings.stars             ?? null,
        description:       settings.description       ?? '',
        logoUrl:           settings.logoUrl           ?? '',
        timezone:          settings.timezone          ?? 'Europe/Moscow',
        currency:          settings.currency          ?? 'RUB',
        vatPayer:          settings.vatPayer          ?? false,
        vatRate:           settings.vatRate           ?? 20,
        touristTax:        settings.touristTax        ?? false,
        touristTaxAmount:  settings.touristTaxAmount  ?? '',
        checkInTime:       settings.checkInTime       ?? '14:00',
        checkOutTime:      settings.checkOutTime      ?? '12:00',
        cancellationHours: settings.cancellationHours ?? 24,
        multiPlaceEnabled: settings.multiPlaceEnabled ?? false,
      });
    }
  }, [settings, form]);

  const set = useCallback((field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!form) return;
    setSaveError(null);
    try {
      const payload = {
        name:              form.name              || undefined,
        address:           form.address           || undefined,
        city:              form.city              || undefined,
        country:           form.country           || undefined,
        phone:             form.phone             || undefined,
        website:           form.website           || undefined,
        email:             form.email             || undefined,
        stars:             form.stars             ? Number(form.stars) : undefined,
        description:       form.description       || undefined,
        logoUrl:           form.logoUrl           || undefined,
        timezone:          form.timezone          || undefined,
        currency:          form.currency          || undefined,
        vatPayer:          form.vatPayer,
        vatRate:           form.vatPayer ? Number(form.vatRate) : undefined,
        touristTax:        form.touristTax,
        touristTaxAmount:  form.touristTax && form.touristTaxAmount !== ''
                             ? Number(form.touristTaxAmount)
                             : undefined,
        checkInTime:       form.checkInTime       || undefined,
        checkOutTime:      form.checkOutTime      || undefined,
        cancellationHours: Number(form.cancellationHours),
        multiPlaceEnabled: form.multiPlaceEnabled,
      };
      await updateMutation.mutateAsync(payload);
      setSavedSection(activeSection);
      setTimeout(() => setSavedSection(null), 3000);
    } catch (err) {
      const msg = err?.response?.data?.message ?? err.message ?? 'Ошибка сохранения';
      setSaveError(Array.isArray(msg) ? msg.join('; ') : msg);
    }
  }, [form, activeSection, updateMutation]);

  if (isLoading || !form) {
    return (
      <div className={s.root}>
        <aside className={s.nav}>
          <div className={s.navHeader}>Настройки</div>
          {NAV_SECTIONS.map(sec => (
            <div key={sec.id} className={`${s.navItem} ${activeSection === sec.id ? s.active : ''}`} onClick={() => setActiveSection(sec.id)}>
              <span className={s.navIcon}>{sec.icon}</span>
              {sec.label}
            </div>
          ))}
        </aside>
        <div className={s.content}><Skeleton /></div>
      </div>
    );
  }

  const isSaving = updateMutation.isPending;

  return (
    <div className={s.root}>
      {/* Left nav */}
      <aside className={s.nav}>
        <div className={s.navHeader}>Настройки</div>
        {NAV_SECTIONS.map(sec => (
          <div
            key={sec.id}
            className={`${s.navItem} ${activeSection === sec.id ? s.active : ''}`}
            onClick={() => setActiveSection(sec.id)}
          >
            <span className={s.navIcon}>{sec.icon}</span>
            {sec.label}
          </div>
        ))}
      </aside>

      {/* Main content */}
      <div className={s.content}>
        <div className={s.pageHeader}>
          <div className={s.pageTitle}>
            {NAV_SECTIONS.find(x => x.id === activeSection)?.label}
          </div>
          <div className={s.saveBar}>
            {savedSection === activeSection && (
              <span className={s.successMsg}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Сохранено
              </span>
            )}
            <button
              className={f.btnPrimary}
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </div>

        {saveError && (
          <div className={s.errorBanner}>{saveError}</div>
        )}

        {/* ── General ── */}
        {activeSection === 'general' && (
          <>
            <div className={s.section}>
              <div className={s.sectionHeader}>
                <div className={s.sectionTitle}>Основные данные</div>
                <div className={s.sectionDesc}>Название отеля, контактная информация и категория</div>
              </div>
              <div className={s.sectionBody}>
                <div className={f.field}>
                  <label className={f.label}>Название отеля *</label>
                  <input
                    className={f.input}
                    value={form.name}
                    onChange={e => set('name', e.target.value)}
                    placeholder="Гостиница «Центральная»"
                  />
                </div>
                <div className={f.row}>
                  <div className={f.field}>
                    <label className={f.label}>Телефон</label>
                    <input
                      className={f.input}
                      value={form.phone}
                      onChange={e => set('phone', e.target.value)}
                      placeholder="+7 (800) 000-00-00"
                    />
                  </div>
                  <div className={f.field}>
                    <label className={f.label}>Email</label>
                    <input
                      className={f.input}
                      type="email"
                      value={form.email}
                      onChange={e => set('email', e.target.value)}
                      placeholder="info@hotel.ru"
                    />
                  </div>
                </div>
                <div className={f.field}>
                  <label className={f.label}>Сайт</label>
                  <input
                    className={f.input}
                    value={form.website}
                    onChange={e => set('website', e.target.value)}
                    placeholder="https://hotel.ru"
                  />
                </div>
                <div className={f.field}>
                  <label className={f.label}>Категория (звёзды)</label>
                  <div className={s.starsRow}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <button
                        key={n}
                        type="button"
                        className={`${s.starBtn} ${form.stars >= n ? s.starActive : ''}`}
                        onClick={() => set('stars', form.stars === n ? null : n)}
                        title={`${n} звезд${n === 1 ? 'а' : n < 5 ? 'ы' : ''}`}
                      >
                        ★
                      </button>
                    ))}
                    {form.stars && (
                      <span style={{ fontSize: 12, color: '#6B7280', marginLeft: 4 }}>
                        {form.stars} звезд{form.stars === 1 ? 'а' : form.stars < 5 ? 'ы' : ''}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className={s.section}>
              <div className={s.sectionHeader}>
                <div className={s.sectionTitle}>Адрес</div>
                <div className={s.sectionDesc}>Расположение объекта</div>
              </div>
              <div className={s.sectionBody}>
                <div className={f.row}>
                  <div className={f.field}>
                    <label className={f.label}>Город</label>
                    <input
                      className={f.input}
                      value={form.city}
                      onChange={e => set('city', e.target.value)}
                      placeholder="Москва"
                    />
                  </div>
                  <div className={f.field}>
                    <label className={f.label}>Страна</label>
                    <select
                      className={f.select}
                      value={form.country}
                      onChange={e => set('country', e.target.value)}
                    >
                      {COUNTRIES.map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={f.field}>
                  <label className={f.label}>Адрес</label>
                  <input
                    className={f.input}
                    value={form.address}
                    onChange={e => set('address', e.target.value)}
                    placeholder="ул. Тверская, д. 1"
                  />
                </div>
              </div>
            </div>

            <div className={s.section}>
              <div className={s.sectionHeader}>
                <div className={s.sectionTitle}>Дополнительно</div>
                <div className={s.sectionDesc}>Описание и логотип</div>
              </div>
              <div className={s.sectionBody}>
                <div className={f.field}>
                  <label className={f.label}>Описание</label>
                  <textarea
                    className={f.textarea}
                    value={form.description}
                    onChange={e => set('description', e.target.value)}
                    placeholder="Краткое описание отеля..."
                    rows={4}
                  />
                </div>
                <div className={f.field}>
                  <label className={f.label}>URL логотипа</label>
                  <input
                    className={f.input}
                    value={form.logoUrl}
                    onChange={e => set('logoUrl', e.target.value)}
                    placeholder="https://cdn.hotel.ru/logo.png"
                  />
                  <div className={f.hint}>Прямая ссылка на изображение логотипа</div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Region ── */}
        {activeSection === 'region' && (
          <div className={s.section}>
            <div className={s.sectionHeader}>
              <div className={s.sectionTitle}>Регион и валюта</div>
              <div className={s.sectionDesc}>Часовой пояс и основная валюта расчётов</div>
            </div>
            <div className={s.sectionBody}>
              <div className={f.field}>
                <label className={f.label}>Часовой пояс</label>
                <select
                  className={f.select}
                  value={form.timezone}
                  onChange={e => set('timezone', e.target.value)}
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </div>
              <div className={f.field}>
                <label className={f.label}>Валюта</label>
                <select
                  className={f.select}
                  value={form.currency}
                  onChange={e => set('currency', e.target.value)}
                >
                  {CURRENCIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* ── Taxes ── */}
        {activeSection === 'taxes' && (
          <div className={s.section}>
            <div className={s.sectionHeader}>
              <div className={s.sectionTitle}>Налоги и сборы</div>
              <div className={s.sectionDesc}>Настройка НДС и туристического налога</div>
            </div>
            <div className={s.sectionBody}>
              <div className={s.toggleRow}>
                <div className={s.toggleInfo}>
                  <div className={s.toggleLabel}>Плательщик НДС</div>
                  <div className={s.toggleDesc}>Отель является плательщиком НДС — налог будет включён в стоимость</div>
                </div>
                <Toggle checked={form.vatPayer} onChange={v => set('vatPayer', v)} />
              </div>
              {form.vatPayer && (
                <div className={s.subField}>
                  <div className={f.field} style={{ marginBottom: 0 }}>
                    <label className={f.label}>Ставка НДС (%)</label>
                    <input
                      className={f.input}
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={form.vatRate}
                      onChange={e => set('vatRate', e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className={s.toggleRow}>
                <div className={s.toggleInfo}>
                  <div className={s.toggleLabel}>Туристический налог</div>
                  <div className={s.toggleDesc}>Курортный или туристический сбор с гостей</div>
                </div>
                <Toggle checked={form.touristTax} onChange={v => set('touristTax', v)} />
              </div>
              {form.touristTax && (
                <div className={s.subField}>
                  <div className={f.field} style={{ marginBottom: 0 }}>
                    <label className={f.label}>Сумма сбора с гостя (₽/ночь)</label>
                    <input
                      className={f.input}
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.touristTaxAmount}
                      onChange={e => set('touristTaxAmount', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Policies ── */}
        {activeSection === 'policies' && (
          <div className={s.section}>
            <div className={s.sectionHeader}>
              <div className={s.sectionTitle}>Политики заезда и отмены</div>
              <div className={s.sectionDesc}>Стандартное время заезда/выезда и условия отмены</div>
            </div>
            <div className={s.sectionBody}>
              <div className={f.row}>
                <div className={f.field}>
                  <label className={f.label}>Время заезда (check-in)</label>
                  <input
                    className={f.input}
                    type="time"
                    value={form.checkInTime}
                    onChange={e => set('checkInTime', e.target.value)}
                  />
                </div>
                <div className={f.field}>
                  <label className={f.label}>Время выезда (check-out)</label>
                  <input
                    className={f.input}
                    type="time"
                    value={form.checkOutTime}
                    onChange={e => set('checkOutTime', e.target.value)}
                  />
                </div>
              </div>
              <div className={f.field}>
                <label className={f.label}>Бесплатная отмена до (часов)</label>
                <input
                  className={f.input}
                  type="number"
                  min="0"
                  value={form.cancellationHours}
                  onChange={e => set('cancellationHours', e.target.value)}
                />
                <div className={f.hint}>0 = невозвратная бронь</div>
              </div>
            </div>
          </div>
        )}

        {/* ── Features ── */}
        {activeSection === 'features' && (
          <div className={s.section}>
            <div className={s.sectionHeader}>
              <div className={s.sectionTitle}>Функции системы</div>
              <div className={s.sectionDesc}>Дополнительные возможности PMS</div>
            </div>
            <div className={s.sectionBody}>
              <div className={s.toggleRow}>
                <div className={s.toggleInfo}>
                  <div className={s.toggleLabel}>Многоместные номера</div>
                  <div className={s.toggleDesc}>
                    Позволяет расселять гостей по местам внутри одного номера.
                    При включении в шахматке появятся места (Место 1, Место 2…) и кнопка разворачивания номера.
                  </div>
                </div>
                <Toggle
                  checked={form.multiPlaceEnabled}
                  onChange={v => set('multiPlaceEnabled', v)}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
