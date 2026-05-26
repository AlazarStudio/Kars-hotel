import { useState } from 'react';
import { useCreateUser, useTenantRoles } from '../../../../hooks/api/useTenantUsers';

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
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl space-y-3">
          <h2 className="text-lg font-semibold">Сотрудник добавлен</h2>
          <p><strong>Email:</strong> {result.email}</p>
          {result.temporaryPassword && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-sm font-medium text-yellow-800">Временный пароль (показывается один раз):</p>
              <code className="text-lg font-mono text-yellow-900">{result.temporaryPassword}</code>
            </div>
          )}
          <p className="text-sm text-gray-500">Передайте эти данные сотруднику.</p>
          <button onClick={onClose} className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg">
            Закрыть
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Пригласить сотрудника</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email *</label>
            <input
              type="email" required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="portye@hotel.ru"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Имя и фамилия *</label>
            <input
              type="text" required
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Иван Петров"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Роль *</label>
            <select
              required
              value={form.roleId}
              onChange={(e) => setForm({ ...form, roleId: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Выберите роль...</option>
              {roles.filter(r => r.code !== 'OWNER').map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg text-sm">
              Отмена
            </button>
            <button type="submit" disabled={createMutation.isPending} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
              {createMutation.isPending ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
