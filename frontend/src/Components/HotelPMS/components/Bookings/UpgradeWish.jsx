import { useState } from 'react';
import { offerUpgrade } from '../../../../api/reservations';

/** 5.10 · Отметка «Хочет номер выше» на брони и предложение пассажиру. */
export default function UpgradeWish({ booking }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [rub, setRub] = useState('');
  const [offer, setOffer] = useState(booking.upgradeOffer ?? null);
  const [error, setError] = useState(null);

  const send = async (e) => {
    e.stopPropagation();
    setError(null);
    const surcharge = Math.round(Number(rub.replace(',', '.')) * 100);
    try {
      await offerUpgrade(booking.id, category.trim(), surcharge);
      setOffer({ category: category.trim(), surcharge });
      setOpen(false);
    } catch (err) {
      setError(err?.response?.data?.message || 'Не удалось отправить предложение');
    }
  };

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ fontSize: 11, marginTop: 3 }}>
      <span style={{ fontWeight: 600 }}>Хочет номер выше</span>
      {offer ? (
        <span> · предложено: {offer.category}, {(offer.surcharge / 100).toLocaleString('ru-RU')} ₽</span>
      ) : (
        <button style={{ marginLeft: 6 }} onClick={() => setOpen((v) => !v)}>Предложить номер выше</button>
      )}
      {open && (
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <input aria-label="Категория" placeholder="Категория" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input aria-label="Доплата, ₽" placeholder="Доплата, ₽" inputMode="decimal" value={rub} onChange={(e) => setRub(e.target.value)} />
          <button disabled={!category.trim() || !rub.trim()} onClick={send}>Отправить</button>
        </div>
      )}
      {error && <div>{error}</div>}
    </div>
  );
}
