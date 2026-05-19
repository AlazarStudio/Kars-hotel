import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import classes from './Auth.module.css';
import { useAuth } from '../../auth/AuthContext';
import PasswordInput from './PasswordInput';

const schema = z.object({
  email: z.string().email('Неверный email'),
  password: z.string().min(8, 'Минимум 8 символов'),
});

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values) => {
    setServerError(null);
    try {
      await login(values);
      const redirect = location.state?.from?.pathname || '/';
      navigate(redirect, { replace: true });
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        (typeof err?.response?.data === 'string' ? err.response.data : null) ||
        'Не удалось войти. Проверьте данные.';
      setServerError(Array.isArray(msg) ? msg.join(', ') : msg);
    }
  };

  return (
    <div className={classes.page}>
      <div className={classes.card}>
        <div className={classes.header}>
          <div className={classes.brand}>KarsHotel PMS</div>
          <h1 className={classes.title}>Вход в систему</h1>
          <div className={classes.subtitle}>Управление отелем для администраторов и менеджеров</div>
        </div>
        <form className={classes.body} onSubmit={handleSubmit(onSubmit)} noValidate>
          {serverError && <div className={classes.alert}>{serverError}</div>}

          <div className={classes.field}>
            <label className={classes.label} htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className={classes.input}
              type="email"
              autoComplete="email"
              placeholder="manager@hotel.ru"
              aria-invalid={errors.email ? 'true' : 'false'}
              {...register('email')}
            />
            {errors.email && <div className={classes.fieldError}>{errors.email.message}</div>}
          </div>

          <div className={classes.field}>
            <label className={classes.label} htmlFor="password">
              Пароль
            </label>
            <PasswordInput
              id="password"
              placeholder="Введите пароль"
              autoComplete="current-password"
              invalid={!!errors.password}
              {...register('password')}
            />
            {errors.password && <div className={classes.fieldError}>{errors.password.message}</div>}
          </div>

          <div className={classes.submitRow}>
            <button className={classes.submit} type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Входим…' : 'Войти'}
            </button>
          </div>
        </form>
        <div className={classes.footer}>
          Нет аккаунта?
          <Link to="/register" className={classes.footerLink}>
            Зарегистрировать отель
          </Link>
        </div>
      </div>
    </div>
  );
}
