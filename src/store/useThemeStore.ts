import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'doraemon' | 'cyberpunk' | 'scandinavian' | 'gradient';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'doraemon',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'media-tracker-theme',
    }
  )
);
