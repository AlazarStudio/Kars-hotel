import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import classes from './ImpersonationBanner.module.css';

export default function ImpersonationBanner() {
  const { impersonatedTenant, exitImpersonation } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);

  if (!impersonatedTenant) return null;

  async function handleExit() {
    setLoading(true);
    try {
      await exitImpersonation();
      qc.clear(); // drop all cached data so admin queries re-fetch with fresh token
      navigate('/admin');
    } catch {
      navigate('/login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={classes.banner}>
      <span className={classes.icon}>👁</span>
      <span className={classes.text}>
        Вы работаете от имени <strong>{impersonatedTenant.name}</strong>
      </span>
      <button className={classes.exitBtn} onClick={handleExit} disabled={loading}>
        {loading ? 'Выход…' : 'Выйти из режима'}
      </button>
    </div>
  );
}
