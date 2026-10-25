import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

/**
 * Вкладка остановлена (api/session-refresh.js): вход в гостиницу по ссылке
 * кончился, или вход в браузере сменился на другую гостиницу либо учётку.
 * Работать дальше здесь — значит сохранять изменения не туда, поэтому экран
 * только объясняет, что делать.
 */
export default function SessionStopped() {
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
          ? `Вход в гостиницу «${name}» в этой вкладке больше не действует.`
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
