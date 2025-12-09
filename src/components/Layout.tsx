import React, { useEffect } from 'react';
import { useThemeStore } from '../store/useThemeStore';
import { Navbar } from './Navbar';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { theme } = useThemeStore();
  const { t } = useTranslation();

  useEffect(() => {
    const root = window.document.documentElement;
    root.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className="min-h-screen flex flex-col transition-colors duration-300 bg-theme-bg text-theme-text font-theme">
      <Navbar />
      <main className="flex-grow container mx-auto px-[3%] md:px-[5%] py-8">
        {children}
      </main>
      <footer className="py-8 mt-auto border-t transition-colors duration-300 bg-theme-surface border-theme-border text-theme-subtext">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm">
          <p>Author: liumeteor11@github</p>
        </div>
      </footer>
    </div>
  );
};
