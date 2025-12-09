import React from 'react';
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
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const loginSchema = z.object({
    username: z.string().min(3, t('login.username_error')),
    password: z.string().min(6, t('login.password_error')),
  });
  
  type LoginForm = z.infer<typeof loginSchema>;
  
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    login(data.username);
    navigate('/');
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
          <h2 className="text-2xl font-bold text-theme-text">{t('login.welcome')}</h2>
          <p className="mt-2 text-theme-subtext">{t('login.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-1 text-theme-text">{t('login.username_label')}</label>
            <input
              {...register('username')}
              type="text"
              className="w-full px-4 py-2 rounded-lg border outline-none transition-all bg-theme-bg border-theme-border text-theme-text focus:border-theme-accent focus:ring-1 focus:ring-theme-accent placeholder-theme-subtext"
              placeholder={t('login.username_placeholder')}
            />
            {errors.username && (
              <p className="mt-1 text-sm text-red-600">{errors.username.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-theme-text">{t('login.password_label')}</label>
            <input
              {...register('password')}
              type="password"
              className="w-full px-4 py-2 rounded-lg border outline-none transition-all bg-theme-bg border-theme-border text-theme-text focus:border-theme-accent focus:ring-1 focus:ring-theme-accent placeholder-theme-subtext"
              placeholder="••••••••"
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 font-medium rounded-lg transition-all shadow-lg disabled:opacity-70 disabled:cursor-not-allowed bg-theme-accent text-theme-bg hover:bg-theme-accent-hover"
          >
            {isSubmitting ? t('login.signing_in') : t('login.sign_in_btn')}
          </button>
          
          <p className="text-xs text-center mt-4 text-theme-subtext">
            {t('login.demo_note')}
          </p>
        </form>
      </div>
    </div>
  );
};
