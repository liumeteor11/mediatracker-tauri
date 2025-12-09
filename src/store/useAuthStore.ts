import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '../types/types';

interface AuthState {
  user: User | null;
  login: (username: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      login: (username) => set({ user: { username, lastBackup: new Date().toISOString() } }),
      logout: () => set({ user: null }),
    }),
    {
      name: 'media-tracker-auth',
    }
  )
);
