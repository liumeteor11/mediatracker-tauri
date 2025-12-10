import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '../types/types';
import { invoke } from '@tauri-apps/api/core';
const isTauri = typeof window !== 'undefined' && (('__TAURI__' in window) || ('__TAURI_INTERNALS__' in window));

interface AuthState {
  user: User | null;
  login: (username: string, password?: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      login: async (username, password) => {
        if (!isTauri) {
          throw new Error('Login not available in web preview');
        }
        const result = await invoke<{ username: string }>('login_user', { username, password: password || '' });
        set({ user: { username: result.username, lastBackup: new Date().toISOString() } });
      },
      register: async (username, password) => {
        if (!isTauri) {
          throw new Error('Register not available in web preview');
        }
        const result = await invoke<{ username: string }>('register_user', { username, password });
        set({ user: { username: result.username, lastBackup: new Date().toISOString() } });
      },
      logout: () => set({ user: null }),
    }),
    {
      name: 'media-tracker-auth',
    }
  )
);
