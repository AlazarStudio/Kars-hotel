import { Navigate, useLocation } from 'react-router-dom';
import { AUTH_STATUS, useAuth } from './AuthContext';

export default function ProtectedRoute({ children, requireSuperAdmin = false }) {
  const { status, isSuperAdmin, isImpersonating, user } = useAuth();
  /* Панель платформы: суперадмин или диспетчер Kars Avia вне гостиницы. У
     диспетчера своя роль (не суперадмин, план 13.3) — пускает его этот признак. */
  const isPlatform = isSuperAdmin || (user?.isDispatcher === true && !isImpersonating);
  const location = useLocation();

  if (status === AUTH_STATUS.LOADING) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#6b7280',
          fontSize: 14,
        }}
      >
        Загрузка…
      </div>
    );
  }

  if (status === AUTH_STATUS.UNAUTHENTICATED) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Super-admin accessing a regular PMS route (not impersonating) → redirect to admin panel
  if (isPlatform && !isImpersonating && !requireSuperAdmin) {
    return <Navigate to="/admin" replace />;
  }

  // Regular user (or impersonator) trying to access super-admin area → forbidden
  if (requireSuperAdmin && !isPlatform) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
