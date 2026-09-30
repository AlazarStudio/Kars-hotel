import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useParams } from 'react-router-dom';
import classes from './Auth.module.css';
import { useAuth } from '../../auth/AuthContext';
import { peekOwnerInvite } from '../../api/auth';
import PasswordInput from './PasswordInput';

/* ПРИГЛАШЕНИЕ ВЛАДЕЛЬЦА В КАБИНЕТ (30.09.2026, Э10).
 *
 * Гостиницу завёл партнёр, и её кабинет до сих пор вёл он. По этой ссылке
 * владелец получает свой вход: пароль он задаёт здесь сам — партнёру он не
 * известен и через него не проходит. Ссылка одноразовая и со сроком. */

const schema = z
  .object({
    password: z.string().min(8, 'Минимум 8 символов'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Пароли не совпадают', path: ['confirm'] });

const errorText = (err, fallback) => {
  const msg = err?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : msg || fallback;
};

export default function InviteAccept() {
  const { token } = useParams();
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [serverError, setServerError] = useState(null);

  useEffect(() => {
    let alive = true;
    peekOwnerInvite(token)
      .then((data) => alive && setInvite(data))
      .catch((err) => alive && setLoadError(errorText(err, 'Приглашение не найдено')));
    return () => {
      alive = false;
    };
  }, [token]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), mode: 'onBlur', defaultValues: { password: '', confirm: '' } });

  const onSubmit = async (values) => {
    setServerError(null);
    try {
      await acceptInvite(token, values.password);
      navigate('/tariffs', { replace: true });
    } catch (err) {
      setServerError(errorText(err, 'Не удалось принять приглашение'));
    }
  };

  return (
    <div className={classes.page}>
      <div className={classes.card}>
        <div className={classes.header}>
          <div className={classes.brand}>KarsHotel PMS</div>
          <h1 className={classes.title}>Кабинет гостиницы</h1>
          <div className={classes.subtitle}>
            {invite
              ? `«${invite.hotelName}» — приглашение для ${invite.fullName}`
              : 'Приглашение владельца'}
          </div>
        </div>

        {loadError ? (
          <div className={classes.body}>
            <div className={classes.alert}>{loadError}</div>
            <div className={classes.footer}>
              <Link to="/login" className={classes.footerLink}>Войти по паролю</Link>
            </div>
          </div>
        ) : !invite ? (
          <div className={classes.body}>Проверяем приглашение…</div>
        ) : (
          <form className={classes.body} onSubmit={handleSubmit(onSubmit)} noValidate>
            {serverError && <div className={classes.alert}>{serverError}</div>}
            <div className={classes.field}>
              <label className={classes.label}>Email для входа</label>
              <input className={classes.input} value={invite.email} readOnly />
            </div>
            <div className={classes.field}>
              <label className={classes.label} htmlFor="password">Придумайте пароль</label>
              <PasswordInput
                id="password"
                placeholder="Не короче 8 символов"
                autoComplete="new-password"
                invalid={!!errors.password}
                {...register('password')}
              />
              {errors.password && <div className={classes.fieldError}>{errors.password.message}</div>}
            </div>
            <div className={classes.field}>
              <label className={classes.label} htmlFor="confirm">Повторите пароль</label>
              <PasswordInput
                id="confirm"
                placeholder="Ещё раз"
                autoComplete="new-password"
                invalid={!!errors.confirm}
                {...register('confirm')}
              />
              {errors.confirm && <div className={classes.fieldError}>{errors.confirm.message}</div>}
            </div>
            <div className={classes.submitRow}>
              <button className={classes.submit} type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Создаём кабинет…' : 'Войти в кабинет'}
              </button>
            </div>
            <div className={classes.subtitle} style={{ marginTop: 8 }}>
              Ссылка действует до {new Date(invite.expiresAt).toLocaleDateString('ru-RU')} и срабатывает один раз.
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
