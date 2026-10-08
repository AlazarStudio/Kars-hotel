import { useState } from 'react';
import { useTenantUsers, useDeleteUser, useResetUserPassword } from '../../../../hooks/api/useTenantUsers';
import InviteUserModal from './InviteUserModal';

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

  if (isLoading) return <div className="p-6">Загрузка...</div>;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Команда</h1>
        <button
          onClick={() => setShowInvite(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Пригласить сотрудника
        </button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Сотрудник</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Email</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Роль</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Статус</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Последний вход</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{user.fullName}</td>
                <td className="px-4 py-3 text-gray-600 text-sm">{user.email}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-700">
                    {ROLE_LABELS[user.role.code] ?? user.role.name}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs ${user.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {user.isActive ? 'Активен' : 'Деактивирован'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString('ru-RU') : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  {user.role.code !== 'OWNER' && user.isActive && (
                    <>
                      <button
                        onClick={() => handleReset(user)}
                        className="text-sm text-blue-600 hover:underline mr-4"
                      >
                        Сбросить пароль
                      </button>
                      <button
                        onClick={() => handleDeactivate(user.id)}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Деактивировать
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showInvite && <InviteUserModal onClose={() => setShowInvite(false)} />}
      {reset && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl space-y-3">
            <h2 className="text-lg font-semibold">Пароль сброшен</h2>
            <p><strong>Email:</strong> {reset.email}</p>
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-sm font-medium text-yellow-800">Временный пароль (показывается один раз):</p>
              <code className="text-lg font-mono text-yellow-900">{reset.temporaryPassword}</code>
            </div>
            <p className="text-sm text-gray-500">Передайте его сотруднику лично. Прежние входы сотрудника завершены.</p>
            <button onClick={() => setReset(null)} className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg">
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
