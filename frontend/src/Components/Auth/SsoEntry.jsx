import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';

/**
 * Вход по SSO-ссылке из диспетчерской Kars Avia: /sso?code=<одноразовый код>.
 * Обменивает код на access-токен собственной учётки диспетчера и уводит либо в
 * конкретную гостиницу (режим «от имени <name>»), либо в админ-панель.
 */
export default function SsoEntry() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { ssoEnter } = useAuth();
  const [error, setError] = useState(null);
  // StrictMode двойного маунта: код одноразовый, второй обмен вернул бы 401.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = params.get('code');
    if (!code) {
      setError('В ссылке нет кода входа.');
      return;
    }
    (async () => {
      try {
        const { mode } = await ssoEnter(code);
        navigate(mode === 'hotel' ? '/dashboard' : '/admin', { replace: true });
      } catch {
        setError('Ссылка недействительна или устарела. Вернитесь в Kars Avia и нажмите кнопку перехода ещё раз.');
      }
    })();
  }, [params, ssoEnter, navigate]);

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
      {error ? (
        <>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <div style={{ maxWidth: 420, textAlign: 'center', lineHeight: 1.5 }}>{error}</div>
          <Link to="/login">Войти по паролю</Link>
        </>
      ) : (
        <>
          <div style={{ fontSize: 40 }}>🔑</div>
          <div>Входим по ссылке из Kars Avia…</div>
        </>
      )}
    </div>
  );
}
