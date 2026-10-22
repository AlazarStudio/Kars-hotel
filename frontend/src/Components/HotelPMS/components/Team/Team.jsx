import { useState } from 'react';
import { useTenantUsers, useDeleteUser, useResetUserPassword } from '../../../../hooks/api/useTenantUsers';
import InviteUserModal from './InviteUserModal';
import Modal from '../../shared/Modal';
import formClasses from '../../shared/Form.module.css';
import classes from './Team.module.css';

const ROLE_LABELS = {
  OWNER: 'Владелец',
  MANAGER: 'Менеджер',
  FRONT_DESK: 'Портье',
  HOUSEKEEPING: 'Горничная',
  ACCOUNTANT: 'Бухгалтер',
  CHANNEL_MANAGER: 'Channel Manager',
  READ_ONLY: 'Только чтение',
};

export default function Team() {
  const { data: users = [], isLoading } = useTenantUsers();
  const deleteMutation = useDeleteUser();
  const resetMutation = useResetUserPassword();
  const [showInvite, setShowInvite] = useState(false);
  const [reset, setReset] = useState(null);

  const handleReset = async (user) => {
    if (!window.confirm(`Сбросить пароль сотрудника ${user.email}? Его текущие входы завершатся.`)) return;
    try {
      setReset(await resetMutation.mutateAsync(user.id));
    } catch (err) {
      window.alert(err.response?.data?.message ?? 'Не удалось сбросить пароль');
    }
  };

  const handleDeactivate = async (userId) => {
    if (!window.confirm('Деактивировать сотрудника?')) return;
    await deleteMutation.mutateAsync(userId);
  };

  if (isLoading) return <div className={classes.loading}>Загрузка...</div>;

  return (
    <div className={classes.root}>
      <div className={classes.pageHeader}>
        <h1 className={classes.pageTitle}>Команда</h1>
        <button type="button" onClick={() => setShowInvite(true)} className={formClasses.btnPrimary}>
          + Пригласить сотрудника
        </button>
      </div>

      <div className={classes.card}>
        <table className={classes.table}>
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th>Email</th>
              <th>Роль</th>
              <th>Статус</th>
              <th>Последний вход</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className={classes.name}>{user.fullName}</td>
                <td className={classes.muted}>{user.email}</td>
                <td>
                  <span className={classes.roleBadge}>{ROLE_LABELS[user.role.code] ?? user.role.name}</span>
                </td>
                <td>
                  <span className={user.isActive ? classes.statusOn : classes.statusOff}>
                    {user.isActive ? 'Активен' : 'Деактивирован'}
                  </span>
                </td>
                <td className={classes.muted}>
                  {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString('ru-RU') : '—'}
                </td>
                <td className={classes.actions}>
                  {user.role.code !== 'OWNER' && user.isActive && (
                    <>
                      <button type="button" onClick={() => handleReset(user)} className={classes.linkBtn}>
                        Сбросить пароль
                      </button>
                      <button type="button" onClick={() => handleDeactivate(user.id)} className={`${classes.linkBtn} ${classes.linkDanger}`}>
                        Деактивировать
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className={classes.empty}>Сотрудников пока нет — пригласите первого.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showInvite && <InviteUserModal onClose={() => setShowInvite(false)} />}
      {reset && (
        <Modal
          open
          title="Пароль сброшен"
          onClose={() => setReset(null)}
          width="sm"
          footer={
            <button type="button" className={formClasses.btnPrimary} onClick={() => setReset(null)}>
              Закрыть
            </button>
          }
        >
          <p><strong>Email:</strong> {reset.email}</p>
          <div className={classes.secret}>
            <div className={classes.secretLabel}>Временный пароль (показывается один раз):</div>
            <code className={classes.secretValue}>{reset.temporaryPassword}</code>
          </div>
          <p className={formClasses.hint}>Передайте его сотруднику лично. Прежние входы сотрудника завершены.</p>
        </Modal>
      )}
    </div>
  );
}
