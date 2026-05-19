import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import classes from './Sidebar.module.css';
import { NAV_ITEMS } from '../../constants';
import { useAuth } from '../../../../auth/AuthContext';

const ROLE_LABELS = {
  OWNER: 'Владелец',
  MANAGER: 'Управляющий',
  FRONT_DESK: 'Служба приёма',
  HOUSEKEEPING: 'Горничная',
  ACCOUNTANT: 'Бухгалтер',
  CHANNEL_MANAGER: 'Менеджер каналов',
  READ_ONLY: 'Только просмотр',
};

const ICONS = {
  dashboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  timeline: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="18" rx="2" />
      <line x1="2" y1="9" x2="22" y2="9" /><line x1="2" y1="15" x2="22" y2="15" />
      <line x1="8" y1="3" x2="8" y2="21" />
    </svg>
  ),
  bookings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  ),
  rooms: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9,22 9,12 15,12 15,22" />
    </svg>
  ),
  housekeeping: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
      <path d="M8 12l2.5 2.5L16 9" />
    </svg>
  ),
  tariffs: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  revenue: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  reports: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ),
};

function Sidebar({ hotel }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const activeSection = location.pathname.slice(1) || 'dashboard';

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // logout is best-effort; even on network error the local session clears
    }
  };

  return (
    <div className={classes.sidebar}>
      <div className={classes.logo}>
        <div className={classes.logoTitle}>{hotel?.name || 'Управление отелем'}</div>
        <div className={classes.logoSubtitle}>{hotel?.city} · {hotel?.address}</div>
        <div className={classes.logoStars}>{'★'.repeat(hotel?.stars || 3)}</div>
      </div>

      <nav className={classes.nav}>
        {NAV_ITEMS.map((item, i) => (
          <React.Fragment key={item.id}>
            {i === NAV_ITEMS.length - 2 && <div className={classes.divider} />}
            <div
              className={`${classes.navItem} ${activeSection === item.id ? classes.active : ''}`}
              onClick={() => navigate(`/${item.id}`)}
            >
              <span className={classes.navIcon}>{ICONS[item.icon]}</span>
              <span className={classes.navLabel}>{item.label}</span>
            </div>
          </React.Fragment>
        ))}
      </nav>

      <div className={classes.footer}>
        {user && (
          <div className={classes.user}>
            <div className={classes.userName} title={user.email}>{user.fullName || user.email}</div>
            <div className={classes.userRole}>{ROLE_LABELS[user.roleCode] || user.roleCode}</div>
          </div>
        )}
        <button type="button" className={classes.logoutBtn} onClick={handleLogout}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Выйти
        </button>
        <div className={classes.version}>PMS v1.0 · Beta</div>
      </div>
    </div>
  );
}

export default Sidebar;
