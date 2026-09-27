import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '../types/types';
import { invoke } from '@tauri-apps/api/core';
const isTauri = typeof window !== 'undefined' && (('__TAURI__' in window) || ('__TAURI_INTERNALS__' in window));

/**
 * The web preview (`npm run dev` in a browser) has no Rust backend, so accounts
 * cannot be verified there. It runs as a single local guest instead of blocking
 * on a login the preview can never satisfy; the desktop build is unaffected and
 * still authenticates against the backend.
 */
const previewUser = (username: string): User => ({
  username: username.trim() || 'preview',
  lastBackup: new Date().toISOString(),
});

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
          set({ user: previewUser(username) });
          return;
        }
        const result = await invoke<{ username: string }>('login_user', { username, password: password || '' });
        set({ user: { username: result.username, lastBackup: new Date().toISOString() } });
      },
      register: async (username, password) => {
        if (!isTauri) {
          set({ user: previewUser(username) });
          return;
        }
        const result = await invoke<{ username: string }>('register_user', { username, password });
        set({ user: { username: result.username, lastBackup: new Date().toISOString() } });
      },
      logout: () => set({ user: null }),
    }),
    {
      name: 'media-tracker-auth',
      onRehydrateStorage: () => (state) => {
        // Web preview: seat the guest up front so the login gate never blocks
        // reviewing the UI.
        if (state && !isTauri && !state.user) {
          state.login('preview', '');
        }
      },
    }
  )
);
