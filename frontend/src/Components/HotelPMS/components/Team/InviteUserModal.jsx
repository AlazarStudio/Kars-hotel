import { useState } from 'react';
import Modal from '../../shared/Modal';
import formClasses from '../../shared/Form.module.css';
import classes from './Team.module.css';
import { useCreateUser, useTenantRoles } from '../../../../hooks/api/useTenantUsers';

/* Окно и поля — общие компоненты кабинета (Modal, Form.module.css). Раньше
   здесь стояли классы Tailwind, которого в кабинете нет: окно не всплывало
   поверх экрана, а разваливалось прямо в странице (23.10.2026). */
export default function InviteUserModal({ onClose }) {
  const { data: roles = [] } = useTenantRoles();
  const createMutation = useCreateUser();
  const [form, setForm] = useState({ email: '', fullName: '', roleId: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const data = await createMutation.mutateAsync(form);
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.message ?? 'Ошибка при создании пользователя');
    }
  };

  if (result) {
    return (
      <Modal
        open
        title="Сотрудник добавлен"
        onClose={onClose}
        width="sm"
        footer={
          <button type="button" className={formClasses.btnPrimary} onClick={onClose}>
            Закрыть
          </button>
        }
      >
        <p><strong>Email:</strong> {result.email}</p>
        {result.temporaryPassword && (
          <div className={classes.secret}>
            <div className={classes.secretLabel}>Временный пароль (показывается один раз):</div>
            <code className={classes.secretValue}>{result.temporaryPassword}</code>
          </div>
        )}
        <p className={formClasses.hint}>Передайте эти данные сотруднику.</p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      title="Пригласить сотрудника"
      onClose={onClose}
      width="sm"
      footer={
        <>
          <button type="button" className={formClasses.btnSecondary} onClick={onClose}>
            Отмена
          </button>
          <button type="submit" form="invite-user-form" className={formClasses.btnPrimary} disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Создание...' : 'Создать'}
          </button>
        </>
      }
    >
      <form id="invite-user-form" onSubmit={handleSubmit}>
        {error && <div className={formClasses.alert}>{error}</div>}
        <div className={formClasses.field}>
          <label className={formClasses.label}>Email *</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className={formClasses.input}
            placeholder="portye@hotel.ru"
          />
        </div>
        <div className={formClasses.field}>
          <label className={formClasses.label}>Имя и фамилия *</label>
          <input
            type="text"
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            className={formClasses.input}
            placeholder="Иван Петров"
          />
        </div>
        <div className={formClasses.field}>
          <label className={formClasses.label}>Роль *</label>
          <select
            required
            value={form.roleId}
            onChange={(e) => setForm({ ...form, roleId: e.target.value })}
            className={formClasses.select}
          >
            <option value="">Выберите роль...</option>
            {roles.filter((r) => r.code !== 'OWNER').map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      </form>
    </Modal>
  );
}
