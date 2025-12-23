import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import CryptoJS from 'crypto-js';
import { AIIOLogEntry } from '../types/types';

// Simple encryption key (In a real app, this should not be hardcoded or should be user-provided)
// For this requirement, we use a static key to satisfy "encrypted storage" vs plain text in localStorage
const SECRET_KEY = import.meta.env.VITE_SECRET_KEY || 'media-tracker-ai-config-secret';


export type AIProvider = 'moonshot' | 'openai' | 'deepseek' | 'qwen' | 'google' | 'mistral' | 'custom';
export type SearchProvider = 'google' | 'serper' | 'yandex' | 'duckduckgo';

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
  omdbApiKey: string;
  tmdbApiKey: string;
  bangumiToken: string;
  enableTmdb: boolean;
  enableBangumi: boolean;
  trendingPrompt: string;
  lastSearchDurationMs: number | null;
  lastSearchAt: string | null;
  lastSearchQuery: string | null;
  authoritativeDomains: {
    movie_tv: string[];
    book: string[];
    comic: string[];
    music: string[];
    poster: string[];
  };
  
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
  setAuthoritativeDomains: (domains: Partial<AIConfigState['authoritativeDomains']>) => void;
  addDomain: (type: 'movie_tv' | 'book' | 'comic' | 'music' | 'poster', domain: string) => void;
  removeDomain: (type: 'movie_tv' | 'book' | 'comic' | 'music' | 'poster', domain: string) => void;
  
  setProvider: (provider: AIProvider) => void;
  setConfig: (config: Partial<Omit<AIConfigState, 'setProvider' | 'setConfig' | 'getDecryptedApiKey' | 'getDecryptedGoogleKey' | 'getDecryptedSerperKey' | 'getDecryptedYandexKey' | 'getDecryptedOmdbKey' | 'getDecryptedTmdbKey' | 'getDecryptedBangumiToken'>>) => void;
  getDecryptedApiKey: () => string;
  getDecryptedGoogleKey: () => string;
  getDecryptedSerperKey: () => string;
  getDecryptedYandexKey: () => string;
  getDecryptedOmdbKey: () => string;
  getDecryptedTmdbKey: () => string;
  getDecryptedBangumiToken: () => string;
  getProxyUrl: () => string;
  logs: AIIOLogEntry[];
  appendLog: (entry: AIIOLogEntry) => void;
  clearLogs: () => void;
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
      omdbApiKey: '',
      tmdbApiKey: '',
      bangumiToken: '',
      enableTmdb: true,
      enableBangumi: true,
      trendingPrompt: '',
      lastSearchDurationMs: null,
      lastSearchAt: null,
      lastSearchQuery: null,
      authoritativeDomains: {
        movie_tv: ['imdb.com','themoviedb.org','tvmaze.com','wikipedia.org','zh.wikipedia.org','douban.com'],
        book: ['goodreads.com','wikipedia.org','zh.wikipedia.org','douban.com'],
        comic: ['bgm.tv','bangumi.tv','wikipedia.org','zh.wikipedia.org'],
        music: ['discogs.com','musicbrainz.org','wikipedia.org','zh.wikipedia.org'],
        poster: ['moviepostersgallery.com','impawards.com','goldposter.com']
      },
      useSystemProxy: true,
      proxyProtocol: 'http',
      proxyHost: '',
      proxyPort: '',
      proxyUsername: '',
      proxyPassword: '',
      trendingCache: [],
      logs: [],
      
      setTrendingCache: (items) => set({ trendingCache: items }),
      setAuthoritativeDomains: (domains) => {
        const current = get().authoritativeDomains;
        set({ authoritativeDomains: { ...current, ...domains } });
      },
      addDomain: (type, domain) => {
        const raw = domain.trim().replace(/^site:/i,'');
        if (!raw) return;
        let d = raw.toLowerCase();
        if (d.includes('://')) {
          try {
            const u = new URL(raw);
            d = (u.hostname || '').toLowerCase();
          } catch {}
        }
        d = d.replace(/^www\./,'').split('/')[0].trim();
        if (!d) return;
        const cur = get().authoritativeDomains;
        const arr = cur[type] || [];
        if (arr.includes(d)) return;
        const next = { ...cur, [type]: [...arr, d] };
        set({ authoritativeDomains: next });
      },
      removeDomain: (type, domain) => {
        const raw = domain.trim().replace(/^site:/i,'');
        if (!raw) return;
        let d = raw.toLowerCase();
        if (d.includes('://')) {
          try {
            const u = new URL(raw);
            d = (u.hostname || '').toLowerCase();
          } catch {}
        }
        d = d.replace(/^www\./,'').split('/')[0].trim();
        const cur = get().authoritativeDomains;
        const arr = cur[type] || [];
        const next = { ...cur, [type]: arr.filter(x => x !== d) };
        set({ authoritativeDomains: next });
      },

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
        if (config.omdbApiKey) updates.omdbApiKey = encrypt(config.omdbApiKey);
        if (config.tmdbApiKey) updates.tmdbApiKey = encrypt(config.tmdbApiKey);
        if (config.bangumiToken) updates.bangumiToken = encrypt(config.bangumiToken);
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
      getDecryptedOmdbKey: () => decrypt(get().omdbApiKey),
      getDecryptedTmdbKey: () => decrypt(get().tmdbApiKey),
      getDecryptedBangumiToken: () => decrypt(get().bangumiToken),
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
      },
      appendLog: (entry: AIIOLogEntry) => {
        const current = get().logs || [];
        const next = [entry, ...current].slice(0, 200);
        set({ logs: next });
      },
      clearLogs: () => set({ logs: [] })
    }),
    {
      name: 'ai-config-storage',
      version: 4,
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
            if (persistedState.searchProvider === 'metaso') {
              persistedState.searchProvider = 'google';
            }
            if ('metasoApiKey' in persistedState) {
              try { delete persistedState.metasoApiKey; } catch {}
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
        omdbApiKey: state.omdbApiKey,
        tmdbApiKey: state.tmdbApiKey,
        bangumiToken: state.bangumiToken,
        enableTmdb: state.enableTmdb,
        enableBangumi: state.enableBangumi,
        lastSearchDurationMs: state.lastSearchDurationMs,
        lastSearchAt: state.lastSearchAt,
        lastSearchQuery: state.lastSearchQuery,
        authoritativeDomains: state.authoritativeDomains,
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
