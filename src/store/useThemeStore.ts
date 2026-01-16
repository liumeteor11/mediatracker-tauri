import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

export type Theme = 'doraemon' | 'cyberpunk' | 'scandinavian' | 'gradient';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  initialize: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'doraemon',
      setTheme: (theme) => set({ theme }),
      initialize: async () => {
        const isTauri = typeof window !== 'undefined' && (('__TAURI__' in window) || ('__TAURI_INTERNALS__' in window));
        if (!isTauri) return;
        try {
            const [_, themeConfig] = await invoke<[any, any]>('get_app_configs');
            if (themeConfig && themeConfig.theme) {
                set({ theme: themeConfig.theme });
            }
        } catch (e) {
            console.error("Failed to load Theme config from backend", e);
        }
      }
    }),
    {
      name: 'media-tracker-theme',
    }
  )
);

// Auto-save to backend
useThemeStore.subscribe((state) => {
    const isTauri = typeof window !== 'undefined' && (('__TAURI__' in window) || ('__TAURI_INTERNALS__' in window));
    if (isTauri) {
        invoke('save_theme_config', { config: { theme: state.theme } }).catch(e => console.error("Failed to save theme config", e));
    }
});
