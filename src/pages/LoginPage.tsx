import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuthStore } from '../store/useAuthStore';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

export const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const { login, register } = useAuthStore();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [serverError, setServerError] = useState<string | null>(null);

  const loginSchema = z.object({
    username: z.string().min(3, t('login.username_error')),
    password: z.string().min(6, t('login.password_error')),
  });
  const registerSchema = z.object({
    username: z.string().min(3, t('login.username_error')),
    password: z.string().min(6, t('login.password_error')),
    confirmPassword: z.string().min(6, t('login.password_error')),
  }).refine((data) => data.password === data.confirmPassword, {
    message: t('login.password_confirm_error'),
    path: ['confirmPassword'],
  });
  
  type LoginForm = z.infer<typeof loginSchema>;
  type RegisterForm = z.infer<typeof registerSchema>;
  
  const loginForm = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });
  const registerForm = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  const onLogin = async (data: LoginForm) => {
    setServerError(null);
    try {
      await login(data.username, data.password);
      navigate('/');
    } catch (e: any) {
      setServerError(e?.message || t('login.invalid_credentials'));
    }
  };
  const onRegister = async (data: RegisterForm) => {
    setServerError(null);
    try {
      await register(data.username, data.password);
      navigate('/');
    } catch (e: any) {
      setServerError(e?.message || t('login.user_exists'));
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 relative">
       {/* Background Glow */}
       <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[100px] opacity-20 pointer-events-none bg-theme-accent" />

      <div className="max-w-md w-full rounded-2xl shadow-xl border p-8 relative z-10 transition-colors duration-300 bg-theme-surface border-theme-border">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4 bg-theme-bg text-theme-accent">
            <LogIn className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-theme-text">{mode === 'login' ? t('login.welcome') : t('login.register_title')}</h2>
          <p className="mt-2 text-theme-subtext">{mode === 'login' ? t('login.subtitle') : t('login.register_subtitle')}</p>
        </div>

        {serverError && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 text-red-600 border border-red-200">
            {serverError}
          </div>
        )}

        {mode === 'login' ? (
        <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-1 text-theme-text">{t('login.username_label')}</label>
            <input
              {...loginForm.register('username')}
              type="text"
              className="w-full px-4 py-2 rounded-lg border outline-none transition-all bg-theme-bg border-theme-border text-theme-text focus:border-theme-accent focus:ring-1 focus:ring-theme-accent placeholder-theme-subtext"
              placeholder={t('login.username_placeholder')}
            />
            {loginForm.formState.errors.username && (
              <p className="mt-1 text-sm text-red-600">{loginForm.formState.errors.username.message as string}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-theme-text">{t('login.password_label')}</label>
            <input
              {...loginForm.register('password')}
              type="password"
              className="w-full px-4 py-2 rounded-lg border outline-none transition-all bg-theme-bg border-theme-border text-theme-text focus:border-theme-accent focus:ring-1 focus:ring-theme-accent placeholder-theme-subtext"
              placeholder="••••••••"
            />
            {loginForm.formState.errors.password && (
              <p className="mt-1 text-sm text-red-600">{loginForm.formState.errors.password.message as string}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loginForm.formState.isSubmitting}
            className="w-full py-3 font-medium rounded-lg transition-all shadow-lg disabled:opacity-70 disabled:cursor-not-allowed bg-theme-accent text-theme-bg hover:bg-theme-accent-hover"
          >
            {loginForm.formState.isSubmitting ? t('login.signing_in') : t('login.sign_in_btn')}
          </button>
          <div className="mt-4 text-center">
            <button type="button" className="text-theme-accent hover:underline" onClick={() => setMode('register')}>
              {t('login.switch_to_register')}
            </button>
          </div>
        </form>
        ) : (
        <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-1 text-theme-text">{t('login.username_label')}</label>
            <input
              {...registerForm.register('username')}
              type="text"
              className="w-full px-4 py-2 rounded-lg border outline-none transition-all bg-theme-bg border-theme-border text-theme-text focus:border-theme-accent focus:ring-1 focus:ring-theme-accent placeholder-theme-subtext"
              placeholder={t('login.username_placeholder')}
            />
            {registerForm.formState.errors.username && (
              <p className="mt-1 text-sm text-red-600">{registerForm.formState.errors.username.message as string}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-theme-text">{t('login.password_label')}</label>
            <input
              {...registerForm.register('password')}
              type="password"
              className="w-full px-4 py-2 rounded-lg border outline-none transition-all bg-theme-bg border-theme-border text-theme-text focus:border-theme-accent focus:ring-1 focus:ring-theme-accent placeholder-theme-subtext"
              placeholder="••••••••"
            />
            {registerForm.formState.errors.password && (
              <p className="mt-1 text-sm text-red-600">{registerForm.formState.errors.password.message as string}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-theme-text">{t('login.password_confirm_label')}</label>
            <input
              {...registerForm.register('confirmPassword')}
              type="password"
              className="w-full px-4 py-2 rounded-lg border outline-none transition-all bg-theme-bg border-theme-border text-theme-text focus:border-theme-accent focus:ring-1 focus:ring-theme-accent placeholder-theme-subtext"
              placeholder="••••••••"
            />
            {registerForm.formState.errors.confirmPassword && (
              <p className="mt-1 text-sm text-red-600">{registerForm.formState.errors.confirmPassword.message as string}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={registerForm.formState.isSubmitting}
            className="w-full py-3 font-medium rounded-lg transition-all shadow-lg disabled:opacity-70 disabled:cursor-not-allowed bg-theme-accent text-theme-bg hover:bg-theme-accent-hover"
          >
            {registerForm.formState.isSubmitting ? t('login.registering') : t('login.register_btn')}
          </button>

          <div className="mt-4 text-center">
            <button type="button" className="text-theme-accent hover:underline" onClick={() => setMode('login')}>
              {t('login.switch_to_login')}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
};
