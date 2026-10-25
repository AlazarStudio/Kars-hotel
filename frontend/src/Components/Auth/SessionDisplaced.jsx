import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

/**
 * Вкладка остановлена: вход в браузере сменился на другую гостиницу или
 * учётку (api/session-refresh.js). Работать дальше здесь — значит сохранять
 * изменения не в ту гостиницу, поэтому экран только объясняет, что делать.
 */
export default function SessionDisplaced() {
  const { impersonatedTenant, dropTabSession } = useAuth();
  const name = impersonatedTenant?.name;

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      fontFamily: 'system-ui, sans-serif',
      color: '#334',
    }}>
      <div style={{ fontSize: 18, fontWeight: 600 }}>Работа в этой вкладке остановлена</div>
      <div style={{ maxWidth: 460, textAlign: 'center', lineHeight: 1.5 }}>
        {name
          ? `Вкладка открыта в гостинице «${name}», а вход в браузере уже сменился на другую гостиницу — её открыли в соседней вкладке.`
          : 'Вход в браузере сменился: в соседней вкладке вошли в другую гостиницу или под другой учёткой.'}
        {' '}Чтобы изменения не ушли не туда, здесь больше ничего не сохраняется.
      </div>
      <div style={{ maxWidth: 460, textAlign: 'center', lineHeight: 1.5 }}>
        {name
          ? `Откройте «${name}» заново из Kars Avia, а эту вкладку закройте.`
          : 'Войдите заново, а эту вкладку закройте.'}
      </div>
      <Link to="/login" onClick={dropTabSession}>Перейти ко входу</Link>
    </div>
  );
}
