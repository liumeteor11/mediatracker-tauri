import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import CryptoJS from 'crypto-js';

// Simple encryption key (In a real app, this should not be hardcoded or should be user-provided)
// For this requirement, we use a static key to satisfy "encrypted storage" vs plain text in localStorage
const SECRET_KEY = import.meta.env.VITE_SECRET_KEY || 'media-tracker-ai-config-secret';


export type AIProvider = 'moonshot' | 'openai' | 'deepseek' | 'qwen' | 'google' | 'mistral' | 'custom';
export type SearchProvider = 'google' | 'serper' | 'yandex';

interface AIConfigState {
  provider: AIProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  // Search Configuration
  enableSearch: boolean;
  searchProvider: SearchProvider;
  googleSearchApiKey: string;
  googleSearchCx: string;
  serperApiKey: string;
  yandexSearchApiKey: string;
  yandexSearchLogin: string;
  trendingPrompt: string;
  lastSearchDurationMs: number | null;
  lastSearchAt: string | null;
  lastSearchQuery: string | null;
  
  // Proxy Configuration
  useSystemProxy: boolean;
  proxyProtocol: 'http' | 'socks5';
  proxyHost: string;
  proxyPort: string;
  proxyUsername: string;
  proxyPassword: string;
  
  // Cache for trending media to allow "partial" updates
  trendingCache: any[];
  setTrendingCache: (items: any[]) => void;
  
  setProvider: (provider: AIProvider) => void;
  setConfig: (config: Partial<Omit<AIConfigState, 'setProvider' | 'setConfig' | 'getDecryptedApiKey' | 'getDecryptedGoogleKey' | 'getDecryptedSerperKey' | 'getDecryptedYandexKey'>>) => void;
  getDecryptedApiKey: () => string;
  getDecryptedGoogleKey: () => string;
  getDecryptedSerperKey: () => string;
  getDecryptedYandexKey: () => string;
  getProxyUrl: () => string;
}

const encrypt = (text: string) => {
  if (!text) return '';
  return CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
};

const decrypt = (ciphertext: string) => {
  if (!ciphertext) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    return '';
  }
};

export const useAIStore = create<AIConfigState>()(
  persist(
    (set, get) => ({
      provider: 'moonshot',
      apiKey: '', // Stores encrypted key
      model: 'kimi-latest',
      baseUrl: 'https://api.moonshot.cn/v1',
      temperature: 0.7,
      maxTokens: 2000,
      systemPrompt: `You are a helpful media encyclopedia and curator. 
When searching or recommending, you must return a VALID JSON array of objects.
Do not wrap the JSON in markdown code blocks. Just return the raw JSON array.
Each object must have the following fields:
- title: string
- directorOrAuthor: string
- cast: string[] (max 5 main actors, empty for books if not applicable)
- description: string (approx 150 words, covering theme and background)
- releaseDate: string (YYYY-MM-DD preferred, or YYYY)
- type: one of ["Book", "Movie", "TV Series", "Comic", "Short Drama", "Other"]
- isOngoing: boolean
- latestUpdateInfo: string (empty if completed)
- rating: string (e.g. "8.5/10")

Ensure data is accurate.`,
    enableSearch: true,
      searchProvider: 'google',
      googleSearchApiKey: '',
      googleSearchCx: '',
      serperApiKey: '',
      yandexSearchApiKey: '',
      yandexSearchLogin: '',
      trendingPrompt: '',
      lastSearchDurationMs: null,
      lastSearchAt: null,
      lastSearchQuery: null,
      useSystemProxy: true,
      proxyProtocol: 'http',
      proxyHost: '',
      proxyPort: '',
      proxyUsername: '',
      proxyPassword: '',
      trendingCache: [],
      
      setTrendingCache: (items) => set({ trendingCache: items }),

      setProvider: (provider) => {
        let defaultBaseUrl = '';
        let defaultModel = '';
        
        switch (provider) {
          case 'moonshot':
            defaultBaseUrl = 'https://api.moonshot.cn/v1';
            defaultModel = 'kimi-latest';
            break;
          case 'openai':
            defaultBaseUrl = 'https://api.openai.com/v1';
            defaultModel = 'gpt-4o';
            break;
          case 'deepseek':
            defaultBaseUrl = 'https://api.deepseek.com/v1';
            defaultModel = 'deepseek-chat';
            break;
          case 'qwen':
            defaultBaseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
            defaultModel = 'qwen-max';
            break;
          case 'google':
            defaultBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/';
            defaultModel = 'gemini-2.5-flash';
            break;
          case 'mistral':
            defaultBaseUrl = 'https://api.mistral.ai/v1';
            defaultModel = 'mistral-large-latest';
            break;
          case 'custom':
            defaultBaseUrl = '';
            defaultModel = '';
            break;
        }
        
        set({ provider, baseUrl: defaultBaseUrl, model: defaultModel });
      },
      setConfig: (config) => {
        const state = get();
        const updates: any = { ...config };
        const sanitizeBaseUrl = (url: string) => {
          if (!url) return '';
          return url.trim().replace(/[\s)]+$/g, '').replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
        };
        
        // Encrypt keys if they are being updated
        if (config.apiKey) updates.apiKey = encrypt(config.apiKey);
        if (config.googleSearchApiKey) updates.googleSearchApiKey = encrypt(config.googleSearchApiKey);
        if (config.serperApiKey) updates.serperApiKey = encrypt(config.serperApiKey);
        if (config.yandexSearchApiKey) updates.yandexSearchApiKey = encrypt(config.yandexSearchApiKey);
        if (config.proxyPassword) updates.proxyPassword = encrypt(config.proxyPassword);
        
        if (typeof config.baseUrl !== 'undefined') {
          updates.baseUrl = sanitizeBaseUrl(config.baseUrl || '');
        }
        set((state) => ({ ...state, ...updates }));
      },
      getDecryptedApiKey: () => decrypt(get().apiKey),
      getDecryptedGoogleKey: () => decrypt(get().googleSearchApiKey),
      getDecryptedSerperKey: () => decrypt(get().serperApiKey),
      getDecryptedYandexKey: () => decrypt(get().yandexSearchApiKey),
      // Helper getters
      // Note: username stored in plain (non-sensitive), password encrypted
      getProxyUrl: (): string => {
        const s = get();
        if (!s.proxyHost || !s.proxyPort) return '';
        const proto = s.proxyProtocol || 'http';
        const user = s.proxyUsername?.trim();
        const pass = decrypt(s.proxyPassword);
        const auth = user ? `${encodeURIComponent(user)}${pass ? ':' + encodeURIComponent(pass) : ''}@` : '';
        return `${proto}://${auth}${s.proxyHost}:${s.proxyPort}`;
      }
    }),
    {
      name: 'ai-config-storage',
      version: 3,
      storage: createJSONStorage(() => {
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            const k = '__ai_store_test__';
            window.localStorage.setItem(k, '1');
            window.localStorage.removeItem(k);
            return window.localStorage;
          }
        } catch {}
        const mem: Record<string, string> = {};
        return {
          getItem: (name: string) => (name in mem ? mem[name] : null),
          setItem: (name: string, value: string) => { mem[name] = value; },
          removeItem: (name: string) => { delete mem[name]; }
        } as any;
      }),
      migrate: (persistedState: any, version: number) => {
        try {
          if (persistedState && typeof persistedState === 'object') {
            const sanitizeBaseUrl = (url: string) => {
              if (!url) return '';
              return url.trim().replace(/[\s)]+$/g, '').replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
            };
            persistedState.baseUrl = sanitizeBaseUrl(persistedState.baseUrl || '');
            if (persistedState.searchProvider === 'duckduckgo') {
              persistedState.searchProvider = 'google';
            }
            const prov = persistedState.provider;
            const url: string = persistedState.baseUrl || '';
            const ensureV1 = (u: string) => u.endsWith('/v1') || u.includes('/v1/') ? u : (u.endsWith('/') ? `${u}v1` : `${u}/v1`);
            if (prov === 'deepseek' && url && !url.includes('/openai/')) {
              persistedState.baseUrl = ensureV1(url);
            }
            if (prov === 'openai' && url && !url.includes('/openai/')) {
              persistedState.baseUrl = ensureV1(url);
            }
            if (prov === 'mistral' && url && !url.includes('/openai/')) {
              persistedState.baseUrl = ensureV1(url);
            }
            if (prov === 'moonshot' && url && !url.includes('/openai/')) {
              persistedState.baseUrl = ensureV1(url);
            }
          }
        } catch {}
        return persistedState;
      },
      partialize: (state) => ({ 
        provider: state.provider,
        apiKey: state.apiKey, 
        model: state.model,
        baseUrl: state.baseUrl,
        temperature: state.temperature,
        maxTokens: state.maxTokens,
        systemPrompt: state.systemPrompt,
        enableSearch: state.enableSearch,
        searchProvider: state.searchProvider,
        googleSearchApiKey: state.googleSearchApiKey,
        googleSearchCx: state.googleSearchCx,
        serperApiKey: state.serperApiKey,
        yandexSearchApiKey: state.yandexSearchApiKey,
        yandexSearchLogin: state.yandexSearchLogin,
        lastSearchDurationMs: state.lastSearchDurationMs,
        lastSearchAt: state.lastSearchAt,
        lastSearchQuery: state.lastSearchQuery,
        useSystemProxy: state.useSystemProxy,
        proxyProtocol: state.proxyProtocol,
        proxyHost: state.proxyHost,
        proxyPort: state.proxyPort,
        proxyUsername: state.proxyUsername,
        proxyPassword: state.proxyPassword
      }),
    }
  )
);
