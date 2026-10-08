import { useState } from 'react';
import { exportGuestData } from '../../../../api/reservations';

/* ВЫГРУЗКА ДАННЫХ ГОСТЯ ПО ЕГО ЗАПРОСУ (152-ФЗ, ст. 14, Г-22; план 13.7).
 * Только по точному телефону, почте или полному ФИО — «похожие» брони были бы
 * чужими данными. Файл — JSON со всеми бронями, начислениями и оплатами. */
export default function GuestExportModal({ onClose }) {
  const [q, setQ] = useState({ phone: '', email: '', name: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setQ((v) => ({ ...v, [k]: e.target.value }));
  const run = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const params = Object.fromEntries(Object.entries(q).filter(([, v]) => v.trim()));
      const data = await exportGuestData(params);
      setResult(data);
      if (data.reservations.length) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `guest-data-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (err) {
      setError(err?.response?.data?.message ?? 'Не удалось выгрузить');
    } finally {
      setBusy(false);
    }
  };

  const input = { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={run} style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 440, display: 'grid', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Данные гостя по его запросу</h2>
        <div style={{ fontSize: 13, color: '#6b7280' }}>Точный телефон, e-mail или полное ФИО — достаточно одного.</div>
        <input style={input} placeholder="Телефон" value={q.phone} onChange={set('phone')} />
        <input style={input} placeholder="E-mail" value={q.email} onChange={set('email')} />
        <input style={input} placeholder="ФИО полностью" value={q.name} onChange={set('name')} />
        {error && <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>}
        {result && (
          <div style={{ fontSize: 13 }}>
            {result.reservations.length ? `Найдено броней: ${result.reservations.length} — файл скачан.` : 'Броней с такими данными нет.'}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff' }}>Закрыть</button>
          <button type="submit" disabled={busy} style={{ padding: '8px 14px', borderRadius: 8, border: 0, background: '#2563eb', color: '#fff' }}>
            {busy ? 'Ищем…' : 'Выгрузить'}
          </button>
        </div>
      </form>
    </div>
  );
}
