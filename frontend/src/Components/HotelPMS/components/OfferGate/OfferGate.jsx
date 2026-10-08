import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../auth/AuthContext';
import { acceptOffer, getOfferStatus } from '../../../../api/tenant';
import { PRIVACY_URL } from '../../../../privacy';

/* ОФЕРТА PMS С ПОРУЧЕНИЕМ (152-ФЗ, Р-29, Р-06; план 13.11).
 *
 * Пока оферта не опубликована (версия 0) — ничего не показывает. Опубликовали:
 * владелец, вошедший сам, не продолжит работу, пока не примет её и не укажет
 * контакт для уведомления об инциденте; остальным (и диспетчеру «от имени») —
 * полоса «владелец ещё не принял», работа не блокируется. */
export default function OfferGate() {
  const { user, isImpersonating } = useAuth();
  const qc = useQueryClient();
  const { data: offer } = useQuery({ queryKey: ['tenant', 'offer'], queryFn: getOfferStatus, staleTime: 60_000 });
  const [contact, setContact] = useState({ name: '', phone: '', email: '' });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!offer?.required) return null;

  const isOwner = user?.roleCode === 'OWNER' && !isImpersonating;
  if (!isOwner) {
    return (
      <div style={{ padding: '8px 16px', background: '#fff7ed', borderBottom: '1px solid #fed7aa', fontSize: 13, color: '#9a3412' }}>
        Владелец гостиницы ещё не принял условия работы с персональными данными (оферта, версия {offer.version}).
      </div>
    );
  }

  const set = (k) => (e) => setContact((c) => ({ ...c, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await acceptOffer({ version: offer.version, incidentContact: contact });
      await qc.invalidateQueries({ queryKey: ['tenant', 'offer'] });
    } catch (err) {
      setError(err?.response?.data?.message ?? 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const input = { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={submit} style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 480, display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Условия работы с персональными данными</h2>
        <p style={{ margin: 0, fontSize: 14, color: '#374151' }}>
          В кабинете хранятся данные гостей вашей гостиницы. Kars Avia обрабатывает их по вашему поручению — на условиях
          оферты (версия {offer.version}).{' '}
          {offer.url && <a href={offer.url} target="_blank" rel="noreferrer">Текст оферты</a>}
          {offer.url && ' · '}
          <a href={PRIVACY_URL} target="_blank" rel="noreferrer">Политика обработки ПДн</a>
        </p>
        <div style={{ fontSize: 13, color: '#6b7280' }}>Кому сообщить, если с данными что-то случится:</div>
        <input style={input} placeholder="ФИО ответственного" value={contact.name} onChange={set('name')} required />
        <input style={input} placeholder="Телефон" value={contact.phone} onChange={set('phone')} required />
        <input style={input} placeholder="E-mail" type="email" value={contact.email} onChange={set('email')} required />
        <label style={{ display: 'flex', gap: 8, fontSize: 14, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>Я прочитал(а) оферту и принимаю её от имени гостиницы</span>
        </label>
        {error && <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div>}
        <button type="submit" disabled={!agreed || saving} style={{ padding: '10px 14px', borderRadius: 8, border: 0, background: agreed ? '#2563eb' : '#93c5fd', color: '#fff', fontSize: 14 }}>
          {saving ? 'Сохраняем…' : 'Принять'}
        </button>
      </form>
    </div>
  );
}
