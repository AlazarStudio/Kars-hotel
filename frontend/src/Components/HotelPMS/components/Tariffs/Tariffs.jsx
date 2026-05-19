import React, { useState } from 'react';
import classes from './Tariffs.module.css';

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function TariffForm({ tariff, categories, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(tariff);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className={classes.overlay} onClick={onClose}>
      <div className={classes.modal} onClick={e => e.stopPropagation()}>
        <div className={classes.modalHeader}>
          <div className={classes.modalTitle}>{form.id ? 'Редактировать тариф' : 'Новый тариф'}</div>
          <button className={classes.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={classes.formGrid}>
          <div className={classes.formGroup}>
            <label>Название</label>
            <input className={classes.input} value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div className={classes.formGroup}>
            <label>Категория</label>
            <select className={classes.input} value={form.categoryId} onChange={e => set('categoryId', e.target.value)}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className={classes.formGroup}>
            <label>Цена за ночь, ₽</label>
            <input className={classes.input} type="number" value={form.price} onChange={e => set('price', +e.target.value)} />
          </div>
          <div className={classes.formGroup}>
            <label>Мин. проживание (ночей)</label>
            <input className={classes.input} type="number" min="1" value={form.minStay} onChange={e => set('minStay', +e.target.value)} />
          </div>
          <div className={classes.formGroup} style={{ gridColumn: '1/-1' }}>
            <label>Дни недели</label>
            <div className={classes.daysRow}>
              {DAYS.map((d, i) => (
                <button
                  key={i}
                  className={`${classes.dayBtn} ${form.days?.includes(i) ? classes.dayActive : ''}`}
                  onClick={() => {
                    const days = form.days || [];
                    set('days', days.includes(i) ? days.filter(x => x !== i) : [...days, i]);
                  }}
                >{d}</button>
              ))}
            </div>
          </div>
          <div className={classes.formGroup} style={{ gridColumn: '1/-1' }}>
            <label>Описание</label>
            <textarea className={classes.textarea} rows={3} value={form.description || ''} onChange={e => set('description', e.target.value)} />
          </div>
          <div className={classes.formGroup}>
            <label>Статус</label>
            <select className={classes.input} value={form.active ? 'active' : 'inactive'} onChange={e => set('active', e.target.value === 'active')}>
              <option value="active">Активен</option>
              <option value="inactive">Неактивен</option>
            </select>
          </div>
        </div>

        <div className={classes.modalFooter}>
          {form.id && <button className={classes.btnDelete} onClick={() => onDelete(form.id)}>Удалить</button>}
          <div style={{ flex: 1 }} />
          <button className={classes.btnCancel} onClick={onClose}>Отмена</button>
          <button className={classes.btnSave} onClick={() => onSave(form)}>Сохранить</button>
        </div>
      </div>
    </div>
  );
}

let _id = 100;
const uid = () => `t${_id++}`;

function Tariffs({ tariffs: initTariffs, setTariffs, categories }) {
  const [tariffs, setLocal] = useState(initTariffs);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(null);

  const save = (data) => {
    let next;
    if (data.id) {
      next = tariffs.map(t => t.id === data.id ? data : t);
    } else {
      next = [...tariffs, { ...data, id: uid() }];
    }
    setLocal(next);
    if (setTariffs) setTariffs(next);
    setShowForm(false);
  };

  const del = (id) => {
    const next = tariffs.filter(t => t.id !== id);
    setLocal(next);
    if (setTariffs) setTariffs(next);
    setShowForm(false);
  };

  const openNew = () => {
    setFormData({ name: '', categoryId: categories[0]?.id, price: 0, minStay: 1, days: [0,1,2,3,4,5,6], active: true });
    setShowForm(true);
  };

  const getCatName = (id) => categories.find(c => c.id === id)?.name || '';

  return (
    <div className={classes.root}>
      <div className={classes.pageHeader}>
        <div className={classes.pageTitle}>Тарифы</div>
        <button className={classes.btnAdd} onClick={openNew}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Новый тариф
        </button>
      </div>

      <div className={classes.grid}>
        {tariffs.map(t => (
          <div key={t.id} className={`${classes.card} ${!t.active ? classes.inactive : ''}`} onClick={() => { setFormData({ ...t }); setShowForm(true); }}>
            <div className={classes.cardTop}>
              <div className={classes.tariffName}>{t.name}</div>
              <div className={`${classes.statusDot} ${t.active ? classes.dotActive : classes.dotInactive}`} />
            </div>
            <div className={classes.catLabel}>{getCatName(t.categoryId)}</div>
            <div className={classes.price}>{t.price.toLocaleString('ru-RU')} <span>₽/ночь</span></div>
            {t.minStay > 1 && <div className={classes.minStay}>мин. {t.minStay} ночи</div>}
            <div className={classes.daysRow}>
              {DAYS.map((d, i) => (
                <span key={i} className={`${classes.dayChip} ${t.days?.includes(i) ? classes.dayChipOn : ''}`}>{d}</span>
              ))}
            </div>
            {t.description && <div className={classes.desc}>{t.description}</div>}
          </div>
        ))}
      </div>

      {showForm && formData && (
        <TariffForm
          tariff={formData}
          categories={categories}
          onSave={save}
          onDelete={del}
          onClose={() => { setShowForm(false); setFormData(null); }}
        />
      )}
    </div>
  );
}

export default Tariffs;
