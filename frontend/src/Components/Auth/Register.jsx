import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import classes from './Auth.module.css';
import { useAuth } from '../../auth/AuthContext';
import PasswordInput from './PasswordInput';

const schema = z.object({
  hotelName: z.string().min(2, 'Минимум 2 символа').max(120, 'Слишком длинно'),
  fullName: z.string().min(2, 'Минимум 2 символа'),
  email: z.string().email('Неверный email'),
  password: z.string().min(8, 'Минимум 8 символов'),
});

export default function Register() {
  const { registerTenant } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { hotelName: '', fullName: '', email: '', password: '' },
  });

  const onSubmit = async (values) => {
    setServerError(null);
    try {
      await registerTenant(values);
      navigate('/', { replace: true });
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        (typeof err?.response?.data === 'string' ? err.response.data : null) ||
        'Не удалось создать отель. Проверьте данные.';
      setServerError(Array.isArray(msg) ? msg.join(', ') : msg);
    }
  };

  return (
    <div className={classes.page}>
      <div className={classes.card}>
        <div className={classes.header}>
          <div className={classes.brand}>KarsHotel PMS</div>
          <h1 className={classes.title}>Регистрация отеля</h1>
          <div className={classes.subtitle}>
            После регистрации вы становитесь владельцем (OWNER) с полным доступом.
          </div>
        </div>
        <form className={classes.body} onSubmit={handleSubmit(onSubmit)} noValidate>
          {serverError && <div className={classes.alert}>{serverError}</div>}

          <div className={classes.field}>
            <label className={classes.label} htmlFor="hotelName">
              Название отеля
            </label>
            <input
              id="hotelName"
              className={classes.input}
              type="text"
              placeholder='например «Отель Парковый»'
              aria-invalid={errors.hotelName ? 'true' : 'false'}
              {...register('hotelName')}
            />
            {errors.hotelName && <div className={classes.fieldError}>{errors.hotelName.message}</div>}
          </div>

          <div className={classes.field}>
            <label className={classes.label} htmlFor="fullName">
              Ваше ФИО
            </label>
            <input
              id="fullName"
              className={classes.input}
              type="text"
              placeholder="Иванов Иван Иванович"
              autoComplete="name"
              aria-invalid={errors.fullName ? 'true' : 'false'}
              {...register('fullName')}
            />
            {errors.fullName && <div className={classes.fieldError}>{errors.fullName.message}</div>}
          </div>

          <div className={classes.row}>
            <div className={classes.field}>
              <label className={classes.label} htmlFor="email">
                Email для входа
              </label>
              <input
                id="email"
                className={classes.input}
                type="email"
                autoComplete="email"
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
                placeholder="Минимум 8 символов"
                autoComplete="new-password"
                invalid={!!errors.password}
                {...register('password')}
              />
              {errors.password && <div className={classes.fieldError}>{errors.password.message}</div>}
            </div>
          </div>

          <div className={classes.submitRow}>
            <button className={classes.submit} type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Создаём…' : 'Создать отель'}
            </button>
          </div>
        </form>
        <div className={classes.footer}>
          Уже зарегистрированы?
          <Link to="/login" className={classes.footerLink}>
            Войти
          </Link>
        </div>
      </div>
    </div>
  );
}
