import { searchTMDB, getTMDBDetails, getTMDBPosterUrl } from './tmdbService';
import { searchBangumi } from './bangumiService';
import { usePluginStore } from '../store/usePluginStore';
import { PluginExecutor } from './pluginService';
import OpenAI from "openai";
import { MediaType, MediaItem } from "../types/types";
import { v4 as uuidv4 } from 'uuid';
import { useAIStore } from "../store/useAIStore";
import i18n from '../i18n';
import type { AIProvider } from '../store/useAIStore';
import { invoke } from "@tauri-apps/api/core";
import { toast } from 'react-toastify';

// Define Window interface to include Tauri API check
declare global {
  interface Window {
    __TAURI__?: any;
  }
}

let lastQuotaErrorTs = 0;
const showQuotaError = (msg: string) => {
    if (msg.includes("Quota Exceeded") || msg.includes("429")) {
        const now = Date.now();
        if (now - lastQuotaErrorTs > 60000) {
            toast.error(i18n.t('ai_config.search_quota_exceeded') || "Google Search Quota Exceeded. Please check your API key billing/quota.");
            lastQuotaErrorTs = now;
        }
    }
};

const isTauriEnv = typeof window !== 'undefined' && (
  ('__TAURI__' in window) || ('__TAURI_INTERNALS__' in window) ||
  (typeof window.location !== 'undefined' && (
    window.location.protocol === 'tauri:' ||
    (typeof window.location.origin === 'string' && window.location.origin.startsWith('http://tauri.localhost'))
  ))
);

type TauriSearchProvider = 'google' | 'serper' | 'yandex' | 'duckduckgo';

const normalizeTauriSearchProvider = (sp: any): TauriSearchProvider => {
  const v = String(sp || '').toLowerCase();
  return (v === 'google' || v === 'serper' || v === 'yandex') ? (v as any) : 'duckduckgo';
};

const resolveTauriSearchProvider = (input: {
  provider: any;
  googleKey?: string;
  googleCx?: string;
  serperKey?: string;
  yandexKey?: string;
  yandexUser?: string;
}): { provider: TauriSearchProvider; apiKey?: string; cx?: string; user?: string } => {
  const clean = (v?: string): string | undefined => {
    const s = (v ?? '').trim();
    if (!s) return undefined;
    const l = s.toLowerCase();
    if (l === 'undefined' || l === 'null') return undefined;
    return s;
  };

  const requested = normalizeTauriSearchProvider(input.provider);
  const googleKey = clean(input.googleKey);
  const googleCx = clean(input.googleCx);
  const serperKey = clean(input.serperKey);
  const yandexKey = clean(input.yandexKey);
  const yandexUser = clean(input.yandexUser);

  const candidates: TauriSearchProvider[] = [requested, 'serper', 'yandex', 'duckduckgo'];
  const uniq = Array.from(new Set(candidates));

  for (const p of uniq) {
    if (p === 'google') {
      if (googleKey && googleCx) return { provider: 'google', apiKey: googleKey, cx: googleCx };
      continue;
    }
    if (p === 'serper') {
      if (serperKey) return { provider: 'serper', apiKey: serperKey };
      continue;
    }
    if (p === 'yandex') {
      if (yandexKey && yandexUser) return { provider: 'yandex', apiKey: yandexKey, user: yandexUser };
      continue;
    }
    return { provider: 'duckduckgo' };
  }

  return { provider: 'duckduckgo' };
};

const resolveTauriSearchProviderList = (input: {
  provider: any;
  googleKey?: string;
  googleCx?: string;
  serperKey?: string;
  yandexKey?: string;
  yandexUser?: string;
}): Array<{ provider: TauriSearchProvider; apiKey?: string; cx?: string; user?: string }> => {
  const clean = (v?: string): string | undefined => {
    const s = (v ?? '').trim();
    if (!s) return undefined;
    const l = s.toLowerCase();
    if (l === 'undefined' || l === 'null') return undefined;
    return s;
  };

  const requested = normalizeTauriSearchProvider(input.provider);
  const googleKey = clean(input.googleKey);
  const googleCx = clean(input.googleCx);
  const serperKey = clean(input.serperKey);
  const yandexKey = clean(input.yandexKey);
  const yandexUser = clean(input.yandexUser);

  const candidates: TauriSearchProvider[] = [requested, 'google', 'serper', 'yandex', 'duckduckgo'];
  const uniq = Array.from(new Set(candidates));

  const out: Array<{ provider: TauriSearchProvider; apiKey?: string; cx?: string; user?: string }> = [];
  for (const p of uniq) {
    if (p === 'google') {
      if (googleKey && googleCx) out.push({ provider: 'google', apiKey: googleKey, cx: googleCx });
      continue;
    }
    if (p === 'serper') {
      if (serperKey) out.push({ provider: 'serper', apiKey: serperKey });
      continue;
    }
    if (p === 'yandex') {
      if (yandexKey && yandexUser) out.push({ provider: 'yandex', apiKey: yandexKey, user: yandexUser });
      continue;
    }
    out.push({ provider: 'duckduckgo' });
  }

  if (out.length === 0) return [{ provider: 'duckduckgo' }];
  return out;
};

const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit & { timeoutMs?: number } = {}) => {
  const ms = init.timeoutMs ?? 12000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort('timeout'), ms);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
};

const searchCache = new Map<string, { ts: number; data: any }>();
const CACHE_TTL = 1000 * 60 * 60 * 2; // 2 hours
const testConnectionCache = new Map<string, { ts: number; res: any }>();
const TEST_CACHE_TTL = 60 * 1000; // 1 minute

// Simple Semaphore to limit concurrent API calls
class Semaphore {
    private max: number;
    private counter: number;
    private waiting: { resolve: () => void, reject: (err: any) => void }[];

    constructor(max: number) {
        this.max = max;
        this.counter = 0;
        this.waiting = [];
    }

    acquire() {
        if (this.counter < this.max) {
            this.counter++;
            return Promise.resolve();
        } else {
            return new Promise<void>((resolve, reject) => {
                this.waiting.push({ resolve, reject });
            });
        }
    }

    release() {
        this.counter--;
        if (this.waiting.length > 0) {
            this.counter++;
            const { resolve } = this.waiting.shift()!;
            resolve();
        }
    }
}

// Limit concurrent requests to avoid rate limits
const apiLimiter = new Semaphore(2);
const searchLimiter = new Semaphore(4);

const OMDB_API_KEY = import.meta.env.VITE_OMDB_API_KEY;

// A curated list of placeholders to serve as "Posters" when real ones aren't found
const getPlaceholder = (type: string = 'Media') => {
  return `https://placehold.co/600x900/1a1a1a/FFF?text=${encodeURIComponent(type)}`;
};

const normalizeImageUrl = (value: any): string | undefined => {
  let s = String(value ?? '').trim();
  if (!s) return undefined;
  s = s
    .replace(/^[<("'“‘\[]+/g, '')
    .replace(/[>"'”’\].,;:)]+$/g, '')
    .trim();
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower === 'n/a' || lower === 'na' || lower === 'null' || lower === 'undefined') return undefined;
  if (lower.includes('m.media-amazon.com/')) return undefined;
  if (lower.includes('i.ebayimg.com/') || lower.includes('ebayimg.com/')) return undefined;
  if (lower.startsWith('data:') || lower.startsWith('blob:')) return s;
  if (lower.startsWith('http://') || lower.startsWith('https://')) return s;
  if (s.startsWith('//')) return `https:${s}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return `https://${s}`;
  return s;
};

const isBlockedPosterUrl = (value?: string): boolean => {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return true;
  if (s.includes('placehold.co') || s.includes('no+image') || s.includes('image+error')) return true;
  if (s.includes('m.media-amazon.com/')) return true;
  return false;
};

const FRANCHISE_ALIASES: Record<string, string[]> = {
  '疯狂动物城': ['动物方城市', 'Zootopia', 'Zootropolis'],
  'Zootopia': ['疯狂动物城', 'Zootropolis'],
  'Zootropolis': ['Zootopia', '疯狂动物城'],
  '速度与激情': ['速激', 'Fast & Furious', 'The Fast and the Furious'],
  'Fast & Furious': ['Fast and Furious', 'The Fast and the Furious', '速度与激情', '速激'],
  '复仇者联盟': ["Avengers", "Marvel's The Avengers"],
  'Avengers': ['复仇者联盟', "Marvel's The Avengers"],
  '哈利·波特': ['哈利波特', 'Harry Potter'],
  'Harry Potter': ['哈利·波特', '哈利波特'],
  '蜘蛛侠': ['Spiderman', 'Spider-Man'],
  'Spider-Man': ['蜘蛛侠', 'Spiderman'],
  '玩具总动员': ['Toy Story'],
  'Toy Story': ['玩具总动员']
};

const prefetchedImages = new Map<string, string>();

const checkImage = async (url: string): Promise<boolean> => {
    if (!url) return false;
    return new Promise((resolve) => {
        const img = new Image();
        let timer: any = null;
        img.onload = () => {
            if (timer) clearTimeout(timer);
            resolve(true);
        };
        img.onerror = () => {
            if (timer) clearTimeout(timer);
            resolve(false);
        };
        timer = setTimeout(() => {
            img.src = "";
            resolve(false);
        }, 5000);
        img.src = url;
    });
};

const fetchPosterFromOMDB = async (title: string, year: string): Promise<string | undefined> => {
  const s = useAIStore.getState();
  const key = (s.getDecryptedOmdbKey && s.getDecryptedOmdbKey()) || OMDB_API_KEY;
  if (!key) return undefined;
  try {
    const cleanYear = year ? year.split('-')[0].trim() : '';
    const url = `https://www.omdbapi.com/?t=${encodeURIComponent(title)}&y=${cleanYear}&apikey=${key}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.Response === "True" && data.Poster && data.Poster !== "N/A") {
      const poster = normalizeImageUrl(data.Poster);
      if (!poster) return undefined;
      const isValid = await checkImage(poster);
      if (isValid) return poster;
    }
  } catch (error) {}
  return undefined;
};

const isSafeContent = (_text: string): boolean => true;

export const performClientSideSearch = async (
    query: string,
    force: boolean = false,
    preferredType?: MediaType | 'All'
): Promise<string> => {
    const normalizeProvider = (sp: any): string => {
        const v = String(sp || '').toLowerCase();
        return (v === 'google' || v === 'serper' || v === 'yandex') ? v : 'duckduckgo';
    };
    const { 
        enableSearch, 
        searchProvider, 
        getDecryptedGoogleKey, 
        googleSearchCx,
        getDecryptedSerperKey,
        getDecryptedYandexKey,
        yandexSearchLogin
    } = useAIStore.getState();

    if (!enableSearch && !force) return "";

    const searchConfig = {
        enabled: true,
        provider: searchProvider,
        apiKey: searchProvider === 'google' ? getDecryptedGoogleKey() : 
                searchProvider === 'serper' ? getDecryptedSerperKey() :
                searchProvider === 'yandex' ? getDecryptedYandexKey() : 
                undefined,
        cx: googleSearchCx,
        user: yandexSearchLogin
    };

    try {
        const isChinese = i18n.language.startsWith('zh');
        const shortOrNumeric = query.trim().length < 3 || /^[0-9\s]+$/.test(query.trim());
        const base = query.trim();

        const inferType = (): MediaType | 'All' => {
            if (preferredType) return preferredType as MediaType | 'All';
            const l = base.toLowerCase();
            const zhMovieTv = ['电影','电视剧','短剧','第','季','集'];
            const enMovieTv = ['movie','film','tv series','season','episode','s1','s2','s3'];
            const zhBook = ['小说','书','书籍'];
            const enBook = ['novel','book'];
            const zhComic = ['漫画'];
            const enComic = ['comic','manga'];
            const zhMusic = ['专辑','音乐'];
            const enMusic = ['album','music'];
            const hasAny = (arr: string[]) => arr.some(k => l.includes(k));
            if (hasAny(isChinese ? zhMovieTv : enMovieTv)) return MediaType.TV_SERIES; // prefer series when season cues present
            if (hasAny(['movie','film','电影'])) return MediaType.MOVIE;
            if (hasAny(isChinese ? zhBook : enBook)) return MediaType.BOOK;
            if (hasAny(isChinese ? zhComic : enComic)) return MediaType.COMIC;
            if (hasAny(isChinese ? zhMusic : enMusic)) return MediaType.MUSIC;
            return 'All';
        };

        const effType = inferType();
        const domsFromStore = (() => {
            const s = useAIStore.getState();
            if (effType === MediaType.MOVIE || effType === MediaType.TV_SERIES) return s.authoritativeDomains.movie_tv || [];
            if (effType === MediaType.BOOK) return s.authoritativeDomains.book || [];
            if (effType === MediaType.COMIC) return s.authoritativeDomains.comic || [];
            if (effType === MediaType.MUSIC) return s.authoritativeDomains.music || [];
            return [];
        })();
        const precisionDomains = domsFromStore.map(d => `site:${d}`);
        const isEnglishUI = (typeof i18n?.language === 'string') && i18n.language.startsWith('en');

        const englishTypeTerm = (t: MediaType | 'All') => {
            switch (t) {
                case MediaType.MOVIE: return 'movie';
                case MediaType.TV_SERIES: return 'tv series';
                case MediaType.BOOK: return 'novel';
                case MediaType.COMIC: return 'comic';
                case MediaType.MUSIC: return 'album';
                case MediaType.SHORT_DRAMA: return 'short drama';
                default: return '';
            }
        };

        const qList = [base]; 
        // Add type-specific query to improve results (especially for DuckDuckGo fallback)
        if (effType !== 'All') {
            const typeHint = englishTypeTerm(effType);
            if (typeHint) qList.push(`${base} ${typeHint}`);
        }
        
        // Precision queries disabled to save quota
        const precisionQueries: string[] = [];
        const toEnglishBase = (text: string) => {
            const t = text.trim();
            const aliases = FRANCHISE_ALIASES[t] || [];
            const enAlias = aliases.find(a => /[a-z]/i.test(a));
            return enAlias || t;
        };
        // Precision queries logic disabled for quota control
        /*
        const precisionQueries: string[] = [];
        for (const d of precisionDomains) {
            // ... (original logic)
            const englishDomain = d.includes('imdb.com') || d.includes('themoviedb.org') || d.includes('tvmaze.com') || (d.includes('wikipedia.org') && !d.includes('zh.wikipedia.org')) || d.includes('goodreads.com') || d.includes('discogs.com') || d.includes('musicbrainz.org');
            if (englishDomain && !isEnglishUI) {
                const baseEn = toEnglishBase(base);
                if (effType === 'All') {
                    const hints = ['movie','tv series','novel','comic','album'];
                    for (const h of hints) {
                        precisionQueries.push(`${d} ${baseEn} ${h}`);
                    }
                } else {
                    const typeHint = englishTypeTerm(effType);
                    const q = typeHint ? `${baseEn} ${typeHint}` : baseEn;
                    precisionQueries.push(`${d} ${q}`);
                }
            } else {
                precisionQueries.push(`${d} ${base}`);
            }
        }
        */

        const isMediaCandidate = (title: string, snippet: string): boolean => {
            const text = `${title} ${snippet}`.toLowerCase();
            const positives = isChinese 
                ? ['电影','电视剧','短剧','漫画','小说','书籍','专辑','音乐','原声','ost','动漫','动画','综艺','纪录片','剧集','番剧']
                : ['movie','film','tv series','season','episode','novel','book','comic','manga','album','music','soundtrack','ost','anime','animation','documentary','drama'];
            if (effType === 'All') {
                // Stricter check: require at least one media keyword even if a year is present.
                // This prevents generic year-based results (e.g. "2025 Trends") from being treated as media.
                return positives.some(k => text.includes(k));
            }
            return positives.some(k => text.includes(k));
        };

        // Tauri Mode
        if (isTauriEnv) {
            try {
                // Map config to Rust struct naming conventions
                const { useSystemProxy, getProxyUrl } = useAIStore.getState();
                const providerList = resolveTauriSearchProviderList({
                    provider: searchProvider,
                    googleKey: getDecryptedGoogleKey(),
                    googleCx: googleSearchCx,
                    serperKey: getDecryptedSerperKey(),
                    yandexKey: getDecryptedYandexKey(),
                    yandexUser: yandexSearchLogin
                });
                const providers = providerList.slice(0, 3);
                
                const topN = (effType === MediaType.MOVIE || effType === MediaType.TV_SERIES) ? 3 : 2;
                const ordered = [...precisionQueries.slice(0, topN), ...qList];
                const uniq = new Map<string, any>();
                
                const makeRustConfig = (
                  p: { provider: TauriSearchProvider; apiKey?: string; cx?: string; user?: string },
                  search_type: 'text' | 'image'
                ) => ({
                  provider: p.provider,
                  api_key: p.apiKey,
                  cx: p.cx,
                  user: p.user,
                  search_type,
                  proxy_url: getProxyUrl(),
                  use_system_proxy: useSystemProxy
                });

                const runTauriSearch = async (
                  p: { provider: TauriSearchProvider; apiKey?: string; cx?: string; user?: string },
                  qv: string
                ): Promise<any[]> => {
                  const cacheKey = `tauri_${p.provider}_${p.cx || ''}_${p.user || ''}_${qv}`;
                  const cached = searchCache.get(cacheKey);
                  if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
                    if (Array.isArray(cached.data)) return cached.data;
                  }

                  const rustConfig = makeRustConfig(p, 'text');
                  const start = performance.now();
                  let resultStr = "";
                  await searchLimiter.acquire();
                  try {
                    for (let i = 0; i < 2; i++) {
                      try {
                        resultStr = await invoke<string>("web_search", { query: qv, config: rustConfig });
                        if (resultStr) break;
                      } catch (e: any) {
                        const errStr = e?.message || String(e);
                        if (errStr.includes("429")) {
                          showQuotaError("Quota Exceeded");
                          throw e;
                        }
                        if (i === 1) {
                          try {
                            useAIStore.getState().appendLog({
                              id: uuidv4(),
                              ts: Date.now(),
                              channel: 'search',
                              provider: rustConfig.provider,
                              query: qv,
                              request: { config: { provider: rustConfig.provider, cx: rustConfig.cx, user: rustConfig.user, search_type: rustConfig.search_type } },
                              response: { error: errStr },
                              durationMs: Math.round(performance.now() - start),
                              searchType: 'text'
                            });
                          } catch {}
                          return [];
                        }
                        await new Promise(r => setTimeout(r, 800));
                      }
                    }
                  } finally {
                    searchLimiter.release();
                  }

                  try {
                    useAIStore.getState().appendLog({
                      id: uuidv4(),
                      ts: Date.now(),
                      channel: 'search',
                      provider: rustConfig.provider,
                      query: qv,
                      request: { config: { provider: rustConfig.provider, cx: rustConfig.cx, user: rustConfig.user, search_type: rustConfig.search_type } },
                      response: resultStr,
                      durationMs: Math.round(performance.now() - start),
                      searchType: 'text'
                    });
                  } catch {}

                  if (!resultStr) return [];
                  try {
                    const arr = JSON.parse(resultStr);
                    if (Array.isArray(arr)) {
                      searchCache.set(cacheKey, { ts: Date.now(), data: arr });
                      return arr;
                    }
                  } catch {}
                  return [];
                };

                const tasks: Array<{ p: { provider: TauriSearchProvider; apiKey?: string; cx?: string; user?: string }, qv: string }> = [];
                const primary = providers[0] || { provider: 'duckduckgo' as const };
                for (const qv of ordered) tasks.push({ p: primary, qv });
                for (const p of providers.slice(1)) {
                  tasks.push({ p, qv: base });
                  if (qList.length > 1) tasks.push({ p, qv: qList[1] });
                }

                const taskUniq = new Map<string, { p: any, qv: string }>();
                for (const tsk of tasks) {
                  const k = `${tsk.p.provider}|${tsk.p.cx || ''}|${tsk.p.user || ''}|${tsk.qv}`;
                  if (!taskUniq.has(k)) taskUniq.set(k, tsk);
                }

                const limitedTasks = Array.from(taskUniq.values()).slice(0, 6);
                const resultsArrays = await Promise.all(limitedTasks.map(t => runTauriSearch(t.p, t.qv)));
                const allResults = resultsArrays.flat();

                const candidateStep = (effType === 'All') ? allResults : allResults.filter((it: any) => isMediaCandidate(it.title || '', it.snippet || ''));
                
                // Process and Score Results
                const scoredResults = candidateStep.map((it: any) => {
                    const pr = processSearchResult(it.title || '', it.snippet || '');
                    let score = 0;
                    // Exact title match bonus
                    if (pr.title.toLowerCase().includes(base.toLowerCase())) score += 10;
                    if (pr.title.toLowerCase() === base.toLowerCase()) score += 20;
                    // Year presence bonus
                    if (pr.year) score += 5;
                    // Authoritative domain bonus (simple check)
                    if (it.link && precisionDomains.some(d => it.link.includes(d.replace('site:', '')))) score += 15;
                    
                    return { ...it, processed: pr, score };
                });
                
                // Sort by score descending
                scoredResults.sort((a: any, b: any) => b.score - a.score);

                for (const it of scoredResults) {
                    const pr = it.processed;
                    const key = `${pr.title}|${pr.year}`;
                    if (!uniq.has(key)) uniq.set(key, { title: pr.title, snippet: it.snippet, link: it.link, image: it.image });
                    if (uniq.size >= 8) break;
                }
                
                const out = Array.from(uniq.values());
                if (out.length > 0) return JSON.stringify(out);
                
                // Fallback to DuckDuckGo if no results
                const ddgConfig = {
                    provider: 'duckduckgo',
                    api_key: undefined,
                    cx: undefined,
                    user: undefined,
                    search_type: "text",
                    proxy_url: useAIStore.getState().getProxyUrl(),
                    use_system_proxy: useAIStore.getState().useSystemProxy
                };
                
                const ddgPromises = ordered.map(async (qv) => {
                    const start = performance.now();
                    try {
                        const resultStr = await invoke<string>("web_search", { query: qv, config: ddgConfig });
                         try {
                            useAIStore.getState().appendLog({
                                id: uuidv4(),
                                ts: Date.now(),
                                channel: 'search',
                                provider: 'duckduckgo',
                                query: qv,
                                request: { config: { provider: ddgConfig.provider, search_type: ddgConfig.search_type } },
                                response: resultStr || "",
                                durationMs: Math.round(performance.now() - start),
                                searchType: 'text'
                            });
                        } catch {}
                        if (resultStr) {
                             const arr = JSON.parse(resultStr);
                             if (Array.isArray(arr)) return arr;
                        }
                    } catch {}
                    return [];
                });

                const ddgResultsArrays = await Promise.all(ddgPromises);
                const allDDGResults = ddgResultsArrays.flat();
                
                const filteredDDG = (effType === 'All') ? allDDGResults : allDDGResults.filter((it: any) => isMediaCandidate(it.title || '', it.snippet || ''));
                
                 const scoredDDG = filteredDDG.map((it: any) => {
                    const pr = processSearchResult(it.title || '', it.snippet || '');
                    let score = 0;
                    if (pr.title.toLowerCase().includes(base.toLowerCase())) score += 10;
                    if (pr.title.toLowerCase() === base.toLowerCase()) score += 20;
                    if (pr.year) score += 5;
                    return { ...it, processed: pr, score };
                });
                scoredDDG.sort((a: any, b: any) => b.score - a.score);

                const uniqD = new Map<string, any>();
                for (const it of scoredDDG) {
                    const pr = it.processed;
                    const key = `${pr.title}|${pr.year}`;
                    if (!uniqD.has(key)) uniqD.set(key, { title: pr.title, snippet: it.snippet, link: it.link, image: it.image });
                    if (uniqD.size >= 8) break;
                }
                const outD = Array.from(uniqD.values());
                if (outD.length > 0) return JSON.stringify(outD);

            } catch (tauriError) {
                console.error("Tauri search failed:", tauriError);
                showQuotaError(String(tauriError || ''));
                try {
                    useAIStore.getState().appendLog({
                        id: uuidv4(),
                        ts: Date.now(),
                        channel: 'search',
                        provider: searchProvider,
                        query: base,
                        request: { config: { provider: searchProvider, cx: googleSearchCx, user: yandexSearchLogin, search_type: "text" } },
                        response: { error: (tauriError as any)?.message || String(tauriError) },
                        durationMs: undefined,
                        searchType: 'text'
                    });
                } catch {}
                // Fall through to web-mode Wikipedia fallback
                return "";
            }
        }
        
        // Web Mode (Limited)
        if (searchProvider === 'google') {
            const apiKey = getDecryptedGoogleKey();
            if (apiKey && googleSearchCx) {
            let merged: any[] = [];
            const topN = (effType === MediaType.MOVIE || effType === MediaType.TV_SERIES) ? 3 : 2;
            const ordered = [...precisionQueries.slice(0, topN), ...qList];
            const uniq = new Map<string, any>();
            for (const qv of ordered) {
                const start = performance.now();
                const cacheKey = `google_${googleSearchCx}_${qv}`;
                const cached = searchCache.get(cacheKey);
                let data: any = null;
                let status: any = 200;
                let fromCache = false;

                if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
                    data = cached.data;
                    fromCache = true;
                    status = 'cached';
                } else {
                    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${googleSearchCx}&q=${encodeURIComponent(qv)}&num=8&safe=off`;
                    let res;
                    try {
                         // Optional: Add small delay to avoid burst
                         await new Promise(r => setTimeout(r, 200));
                         res = await fetchWithTimeout(url, { timeoutMs: 12000 });
                    } catch (e) {
                         res = { ok: false, status: 500 } as any;
                    }
                    
                    status = res.status;

                    if (res.status === 429) {
                        console.warn("Google Search 429 (Too Many Requests).");
                        showQuotaError("Quota Exceeded");
                        if (cached) {
                            data = cached.data;
                            fromCache = true;
                            status = '429_cached_fallback';
                        } else {
                            break;
                        }
                    } else if (res.ok) {
                        data = await res.json();
                        searchCache.set(cacheKey, { ts: Date.now(), data });
                    }
                }

                if (data && data.items) {
                    merged = merged.concat(data.items.map((item: any) => ({
                        title: item.title,
                        snippet: item.snippet,
                        link: item.link,
                        image: item.pagemap?.cse_image?.[0]?.src
                    })));
                }
                try {
                    useAIStore.getState().appendLog({
                        id: uuidv4(),
                        ts: Date.now(),
                        channel: 'search',
                        provider: 'google',
                        query: qv,
                        request: { url: `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(qv)}&num=8` },
                        response: data ? (data.items || []).slice(0, 8) : { status },
                        durationMs: Math.round(performance.now() - start),
                        searchType: 'text'
                    });
                } catch {}
                const filteredStep = merged.filter((it: any) => isMediaCandidate(it.title, it.snippet));
                for (const it of filteredStep) {
                    const pr = processSearchResult(it.title || '', it.snippet || '');
                    const key = `${pr.title}|${pr.year}`;
                    if (!uniq.has(key)) uniq.set(key, { title: pr.title, snippet: it.snippet, link: it.link, image: it.image });
                }
                if (uniq.size >= 8) break;
            }
            const out = Array.from(uniq.values()).slice(0, 8);
            if (out.length > 0) return JSON.stringify(out);
            }
        }

    // Serper (Web Mode)
    if (searchProvider === 'serper') {
        const apiKey = getDecryptedSerperKey();
        if (apiKey) {
            let merged: any[] = [];
            const topN = (effType === MediaType.MOVIE || effType === MediaType.TV_SERIES) ? 3 : 2;
            const ordered = [...precisionQueries.slice(0, topN), ...qList];
            const uniq = new Map<string, any>();
            for (const qv of ordered) {
                const start = performance.now();
                const response = await fetchWithTimeout('https://google.serper.dev/search', {
                    method: 'POST',
                    headers: {
                        'X-API-KEY': apiKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ q: qv, num: 8, safe: "off" })
                , timeoutMs: 12000 });
                if (response.status === 429) {
                    console.warn("Serper Search 429 (Too Many Requests). Stopping.");
                    showQuotaError("Quota Exceeded");
                    break;
                }
                if (response.ok) {
                    const data = await response.json();
                    if (data.organic) {
                        merged = merged.concat(data.organic.map((item: any) => ({
                            title: item.title,
                            snippet: item.snippet,
                            link: item.link,
                            image: undefined
                        })));
                    }
                }
                try {
                    useAIStore.getState().appendLog({
                        id: uuidv4(),
                        ts: Date.now(),
                        channel: 'search',
                        provider: 'serper',
                        query: qv,
                        request: { body: { q: qv, num: 8 } },
                        response: merged.slice(-Math.max(0, Math.min(10, merged.length))),
                        durationMs: Math.round(performance.now() - start),
                        searchType: 'text'
                    });
                } catch {}
                const filteredStep = merged.filter((it: any) => isMediaCandidate(it.title, it.snippet));
                for (const it of filteredStep) {
                    const pr = processSearchResult(it.title || '', it.snippet || '');
                    const key = `${pr.title}|${pr.year}`;
                    if (!uniq.has(key)) uniq.set(key, { title: pr.title, snippet: it.snippet, link: it.link, image: it.image });
                }
                if (uniq.size >= 8) break;
            }
            const out = Array.from(uniq.values()).slice(0, 8);
            if (out.length > 0) return JSON.stringify(out);
        }
    }

    // Fallback: DuckDuckGo (Web Mode Only - Tauri handles this above via Rust to avoid CORS)
    if (!isTauriEnv) {
        try {
            let mergedDDG: any[] = [];
            const orderedD = [...precisionQueries.slice(0, 3), ...qList];
            const uniqD = new Map<string, any>();
            for (const qv of orderedD) {
                const start = performance.now();
                let items: any[] = [];
                try {
                    // Note: This often fails due to CORS if not proxied
                    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(qv)}&format=json&no_redirect=1&no_html=1`;
                    const res = await fetchWithTimeout(url, { timeoutMs: 8000 });
                    if (res.ok) {
                        const data = await res.json();
                        const rt = Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : [];
                        const results = Array.isArray(data?.Results) ? data.Results : [];
                        for (const r of results) {
                            const t = r?.Text || '';
                            const u = r?.FirstURL || '';
                            if (t && u) items.push({ title: t, snippet: t, link: u, image: undefined });
                        }
                        for (const r of rt) {
                            const t = r?.Text || '';
                            const u = r?.FirstURL || '';
                            if (t && u) items.push({ title: t, snippet: t, link: u, image: undefined });
                        }
                    }
                } catch {}
                mergedDDG = mergedDDG.concat(items);
                try {
                    useAIStore.getState().appendLog({
                        id: uuidv4(),
                        ts: Date.now(),
                        channel: 'search',
                        provider: 'duckduckgo',
                        query: qv,
                        request: { url: 'https://api.duckduckgo.com', params: { q: qv } },
                        response: mergedDDG.slice(-Math.max(0, Math.min(10, mergedDDG.length))),
                        durationMs: Math.round(performance.now() - start),
                        searchType: 'text'
                    });
                } catch {}
                const filteredD = (effType === 'All') ? mergedDDG : mergedDDG.filter((it: any) => isMediaCandidate(it.title, it.snippet));
                for (const it of filteredD) {
                    const pr = processSearchResult(it.title || '', it.snippet || '');
                    const key = `${pr.title}|${pr.year}`;
                    if (!uniqD.has(key)) uniqD.set(key, { title: pr.title, snippet: it.snippet, link: it.link, image: it.image });
                }
                if (uniqD.size >= 8) break;
            }
            const outD = Array.from(uniqD.values()).slice(0, 8);
            if (outD.length > 0) return JSON.stringify(outD);
        } catch {}
    }
        
        
    } catch (e) {
        console.warn("Search failed", e);
    }
    return "";
};

export const testAuthoritativeDomain = async (domain: string, sampleQuery: string = 'test'): Promise<{ ok: boolean; count: number; items: any[]; error?: string }> => {
    const { 
        enableSearch,
        searchProvider,
        getDecryptedGoogleKey,
        googleSearchCx,
        getDecryptedSerperKey,
        getDecryptedYandexKey,
        yandexSearchLogin
    } = useAIStore.getState();
    const normalizeProvider = (sp: any): string => {
        const v = String(sp || '').toLowerCase();
        return (v === 'google' || v === 'serper' || v === 'yandex') ? v : 'duckduckgo';
    };
    if (!enableSearch) return { ok: false, count: 0, items: [], error: 'search_disabled' };
    const d = domain.trim().toLowerCase().replace(/^site:/,'');
    const query = `site:${d} ${sampleQuery}`;
    try {
        if (isTauriEnv) {
            const { useSystemProxy, getProxyUrl } = useAIStore.getState();
            const eff = resolveTauriSearchProvider({
                provider: searchProvider,
                googleKey: getDecryptedGoogleKey(),
                googleCx: googleSearchCx,
                serperKey: getDecryptedSerperKey(),
                yandexKey: getDecryptedYandexKey(),
                yandexUser: yandexSearchLogin
            });
            const rustConfig = {
                provider: eff.provider,
                api_key: eff.apiKey,
                cx: eff.cx,
                user: eff.user,
                search_type: 'text',
                proxy_url: getProxyUrl(),
                use_system_proxy: useSystemProxy
            };
            const resultStr = await invoke<string>('web_search', { query, config: rustConfig });
            try {
                const arr = JSON.parse(resultStr);
                const items = Array.isArray(arr) ? arr : [];
                return { ok: items.length > 0, count: items.length, items };
            } catch {
                return { ok: false, count: 0, items: [], error: 'parse_failed' };
            }
        }
        if (searchProvider === 'google') {
            const apiKey = getDecryptedGoogleKey();
            if (apiKey && googleSearchCx) {
                const cacheKey = `google_${googleSearchCx}_${query}`;
                const cached = searchCache.get(cacheKey);
                if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
                     const data = cached.data;
                     const items = Array.isArray(data.items) ? data.items.slice(0, 4).map((item: any) => ({
                        title: item.title,
                        snippet: item.snippet,
                        link: item.link
                    })) : [];
                    return { ok: items.length > 0, count: items.length, items };
                }

                const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${googleSearchCx}&q=${encodeURIComponent(query)}&num=4`;
                let res;
                try {
                    await apiLimiter.acquire();
                    res = await fetchWithTimeout(url, { timeoutMs: 12000 });
                } finally {
                    apiLimiter.release();
                }
                if (!res || !res.ok) {
                     if (res && res.status === 429 && cached) {
                         const data = cached.data;
                         const items = Array.isArray(data.items) ? data.items.slice(0, 4).map((item: any) => ({
                            title: item.title,
                            snippet: item.snippet,
                            link: item.link
                        })) : [];
                        return { ok: items.length > 0, count: items.length, items };
                     }
                     if (res && res.status === 429) {
                         return { ok: false, count: 0, items: [], error: 'Quota Exceeded (429)' };
                     }
                     return { ok: false, count: 0, items: [], error: res ? String(res.status) : 'network_error' };
                }
                const data = await res.json();
                if (data && Array.isArray(data.items)) data.items = data.items.slice(0, 4);
                searchCache.set(cacheKey, { ts: Date.now(), data });

                const items = Array.isArray(data.items) ? data.items.map((item: any) => ({
                    title: item.title,
                    snippet: item.snippet,
                    link: item.link
                })) : [];
                return { ok: items.length > 0, count: items.length, items };
            }
        }
        if (searchProvider === 'serper') {
            const apiKey = getDecryptedSerperKey();
            if (apiKey) {
                const response = await fetchWithTimeout('https://google.serper.dev/search', {
                    method: 'POST',
                    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: query }),
                    timeoutMs: 12000
                });
                if (!response.ok) {
                    if (response.status === 429) return { ok: false, count: 0, items: [], error: 'Quota Exceeded (429)' };
                    return { ok: false, count: 0, items: [], error: String(response.status) };
                }
                const data = await response.json();
                const items = Array.isArray(data.organic) ? data.organic.slice(0, 4).map((item: any) => ({
                    title: item.title,
                    snippet: item.snippet,
                    link: item.link
                })) : [];
                return { ok: items.length > 0, count: items.length, items };
            }
        }
        return { ok: false, count: 0, items: [], error: 'unsupported_provider_or_missing_key' };
    } catch (e: any) {
        return { ok: false, count: 0, items: [], error: e?.message || 'error' };
    }
};

export const runBackgroundSearch = async (query: string, type?: MediaType | 'All'): Promise<void> => {
    const q = (query || '').trim();
    if (!q) return;
    const t: MediaType | 'All' = type || 'All';
    const start = performance.now();
    try {
        const items = await searchMedia(q, t);
        const enriched = [] as MediaItem[];
        for (const it of items) {
            try {
                const year = it.releaseDate ? it.releaseDate.split('-')[0] : '';
                const url = await fetchPosterFromSearch(it.title, year, it.type);
                if (url && (!it.customPosterUrl)) {
                    enriched.push({ ...it, posterUrl: url });
                } else {
                    enriched.push(it);
                }
            } catch {
                enriched.push(it);
            }
        }
        try {
            const langKey = i18n.language.split('-')[0];
            const key = `media_tracker_search_${langKey}_${t}_${q.toLowerCase()}`;
            const tsKey = `${key}_ts`;
            localStorage.setItem(key, JSON.stringify(enriched));
            localStorage.setItem(tsKey, Date.now().toString());
        } catch {}
        const duration = Math.round(performance.now() - start);
        useAIStore.getState().setConfig({ lastSearchDurationMs: duration, lastSearchAt: new Date().toISOString(), lastSearchQuery: q });
    } catch {}
};

export const refreshTrendingCache = async (): Promise<void> => {
    try {
        const trending = await getTrendingMedia();
        if (Array.isArray(trending) && trending.length > 0) {
            try {
                localStorage.setItem('media_tracker_trending_data', JSON.stringify(trending));
                localStorage.setItem('media_tracker_trending_ts', Date.now().toString());
                try {
                    const s = useAIStore.getState();
                    const langKey = i18n.language.split('-')[0];
                    const promptKey = (s.trendingPrompt || '').trim();
                    localStorage.setItem('media_tracker_trending_prompt_key', `${langKey}::${promptKey}`);
                } catch {}
            } catch {}
            useAIStore.getState().setTrendingCache(trending as any[]);
        }
    } catch {}
};

export const callAI = async (messages: any[], temperature: number = 0.7, options: { forceSearch?: boolean; configOverride?: { baseURL?: string; apiKey?: string; model?: string; provider?: AIProvider } } = {}): Promise<string> => {
    const state = useAIStore.getState();
    const { 
        provider,
        baseUrl: storeBaseURL, 
        model: storeModel, 
        enableSearch,
        searchProvider,
        getDecryptedGoogleKey,
        googleSearchCx,
        getDecryptedSerperKey,
        getDecryptedYandexKey,
        yandexSearchLogin
    } = state;

    const override = options.configOverride || {};
    const effProvider: AIProvider = (override.provider as AIProvider) ?? (provider as AIProvider);
    const baseURL = override.baseURL ?? storeBaseURL;
    const model = override.model ?? storeModel;

    let apiKey = override.apiKey ?? state.getDecryptedApiKey();

    if (!apiKey) {
        try {
            const envKey = (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_MOONSHOT_API_KEY) ? (import.meta as any).env.VITE_MOONSHOT_API_KEY : undefined;
            if (envKey && envKey !== 'undefined') {
                apiKey = String(envKey);
            }
        } catch {}
    }

    const isTauri = typeof window !== 'undefined' && (
        ('__TAURI__' in window) || ('__TAURI_INTERNALS__' in window) ||
        (typeof window.location !== 'undefined' && (
            window.location.protocol === 'tauri:' ||
            (typeof window.location.origin === 'string' && window.location.origin.startsWith('http://tauri.localhost'))
        ))
    );

    // Web Mode (Direct API Call) OR Tauri Mode (Custom Client)
    if (!apiKey) {
        return "";
    }

    let finalBaseURL = (baseURL || "https://api.moonshot.cn/v1")
        .trim()
        .replace(/[\s)]+$/g, "")
        .replace(/[()]/g, "")
        .replace(/^"+|"+$/g, "")
        .replace(/^'+|'+$/g, "");

    const ensureV1IfNeeded = (prov: AIProvider, url: string) => {
        const hasV1 = url.endsWith('/v1') || url.includes('/v1/');
        const isGoogleOpenAI = url.includes('/openai/');
        if (isGoogleOpenAI) return url;
        if ((prov === 'openai' || prov === 'deepseek' || prov === 'mistral' || prov === 'moonshot') && !hasV1) {
            return url.endsWith('/') ? `${url}v1` : `${url}/v1`;
        }
        return url;
    };
    finalBaseURL = ensureV1IfNeeded(effProvider as AIProvider, finalBaseURL);

    // Proxy handling for Web Mode to avoid CORS (only in local dev)
    const isLocalDev = typeof window !== 'undefined' && /^https?:\/\/(localhost|127\.|0\.0\.0\.0)/.test(window.location.origin || '');
    if (!isTauri && isLocalDev && finalBaseURL.includes('api.moonshot.cn')) {
        finalBaseURL = `${window.location.origin}/api/moonshot/v1`;
    } else if (!isTauri && isLocalDev && finalBaseURL.startsWith('/')) {
        finalBaseURL = `${window.location.origin}${finalBaseURL}`;
    }

    // Abstract the "completion" call
    const createCompletion = async (msgs: any[], tools: any[], baseURLOverride?: string) => {
        const effBaseURL = (baseURLOverride || finalBaseURL || '').trim();
        if (isTauri) {
             const { useSystemProxy, getProxyUrl } = useAIStore.getState();
            const rustConfig = {
                model,
                baseURL: effBaseURL,
                apiKey,
                proxy_url: getProxyUrl(),
                use_system_proxy: useSystemProxy
            };
            // Call Rust
            const resultJson = await invoke<string>("ai_chat", { 
                messages: msgs, 
                temperature, 
                tools, 
                config: rustConfig 
            });
            
            // Parse result to match OpenAI structure
            try {
                const response = JSON.parse(resultJson);
                return response;
            } catch(e) {
                console.error("Failed to parse Rust AI response", e);
                throw e;
            }
        } else {
            // Web Mode
             const client = new OpenAI({
                apiKey: apiKey,
                baseURL: effBaseURL,
                dangerouslyAllowBrowser: true
            });
            
            return await client.chat.completions.create({
                model: model || (effProvider === 'moonshot' ? "kimi-latest" : "gpt-3.5-turbo"),
                messages: msgs,
                temperature: temperature,
                tools: tools.length > 0 ? tools : undefined,
                tool_choice: tools.length > 0 ? "auto" : undefined,
            });
        }
    };

    try {
        let tools: any[] = [];
        const shouldSearch = enableSearch || options.forceSearch;
        const supportsTools = effProvider === 'moonshot';
        if (shouldSearch && supportsTools) {
            tools = [
                {
                    type: "function",
                    function: {
                        name: "web_search",
                        description: "Search the internet for real-time information. Use this to get the latest media releases, news, and updates.",
                        parameters: {
                            type: "object",
                            properties: {
                                query: {
                                    type: "string",
                                    description: "The search query"
                                }
                            },
                            required: ["query"]
                        }
                    }
                }
            ];
        }

        let currentMessages = [...messages];
        let turnCount = 0;
        const MAX_TURNS = 2;

        while (turnCount < MAX_TURNS) {
            let completion;
            const startTs = performance.now();
            
            // Retry logic with Semaphore and Exponential Backoff
            const MAX_RETRIES = 3;
            let attempt = 0;
            let webBaseURLOverride: string | undefined = undefined;
            let switchedOffMoonshotProxy = false;

            while (attempt < MAX_RETRIES) {
                try {
                    await apiLimiter.acquire();
                    try {
                         completion = await createCompletion(currentMessages, tools, webBaseURLOverride);
                    } finally {
                        apiLimiter.release();
                    }
                    break; // Success
                } catch (apiError: any) {
                    console.error(`AI Chat API failed (Attempt ${attempt + 1}/${MAX_RETRIES})`, apiError);
                    const status = (apiError && typeof apiError.status === 'number') ? apiError.status : (apiError?.response?.status);
                    const msg = String(apiError?.message || '');
                    const is5xx = typeof status === 'number' && status >= 500 && status < 600;
                    const is429 = status === 429;
                    const isConnectionError =
                        apiError?.name === 'APIConnectionError' ||
                        msg.toLowerCase().includes('connection error') ||
                        msg.toLowerCase().includes('failed to fetch') ||
                        msg.toLowerCase().includes('network error');
                    const looksServiceUnavailable = msg.includes('503') || msg.toLowerCase().includes('service unavailable');

                    if (!isTauri && !switchedOffMoonshotProxy && (effProvider === 'moonshot') && isConnectionError) {
                        const usingMoonshotDevProxy = (finalBaseURL || '').includes('/api/moonshot/');
                        if (usingMoonshotDevProxy) {
                            switchedOffMoonshotProxy = true;
                            webBaseURLOverride = 'https://api.moonshot.cn/v1';
                            continue;
                        }
                    }

                    if (is429 || is5xx || looksServiceUnavailable || isConnectionError) {
                        attempt++;
                        if (attempt < MAX_RETRIES) {
                            const delay = 2000 * Math.pow(2, attempt - 1);
                            await new Promise(resolve => setTimeout(resolve, delay));
                            continue;
                        }
                    }
                    throw apiError;
                }
            }

            const normalizeAssistantMessage = (c: any): any => {
                try {
                    if (!c) return { content: "" };
                    if (typeof c === 'string') return { content: c };
                    // OpenAI/Moonshot style
                    if (Array.isArray(c.choices)) {
                        if (c.choices.length > 0) {
                            return c.choices[0].message ?? c.choices[0].delta ?? c.choices[0];
                        }
                        return { content: "" };
                    }
                    // Common wrappers
                    if (c.result) return normalizeAssistantMessage(c.result);
                    if (c.data) return normalizeAssistantMessage(c.data);
                    if (c?.message) return c.message;
                    if (typeof c?.output_text === 'string') return { content: c.output_text };
                    if (typeof c?.content === 'string') return { content: c.content };
                    if (Array.isArray(c?.content)) return { content: c.content.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('') };
                    return { content: "" };
                } catch {
                    return { content: "" };
                }
            };
            const message = normalizeAssistantMessage(completion);
            try {
                useAIStore.getState().appendLog({
                    id: uuidv4(),
                    ts: Date.now(),
                    channel: 'ai',
                    provider: effProvider,
                    model,
                    baseURL: finalBaseURL,
                    request: { messages: currentMessages, temperature, tools },
                    response: completion,
                    durationMs: Math.round(performance.now() - startTs)
                });
            } catch {}

            // If the model wants to call a tool
            const toolCalls = (message && (message.tool_calls || (message.function_call ? [{ type: 'function', id: 'fn', function: message.function_call }] : []))) || [];
            if (toolCalls && toolCalls.length > 0) {
                currentMessages.push(message); // Add assistant's tool call message

                // Execute tool calls
                for (const toolCall of toolCalls) {
                    if (toolCall.type === 'function' && toolCall.function.name === '$web_search') {
                        let query = "";
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            query = args.query || args.q || "";
                        } catch (parseError) {
                            console.warn("Failed to parse $web_search args", parseError);
                        }
                        if (query) {
                            const searchResult = await performClientSideSearch(query, options.forceSearch);
                            currentMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                name: "$web_search",
                                content: searchResult || "No relevant results found."
                            });
                            try {
                                useAIStore.getState().appendLog({
                                    id: uuidv4(),
                                    ts: Date.now(),
                                    channel: 'search',
                                    provider: useAIStore.getState().searchProvider,
                                    query,
                                    request: {},
                                    response: searchResult || "",
                                    durationMs: undefined,
                                    searchType: 'text'
                                });
                            } catch {}
                            continue;
                        } else {
                            currentMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                name: "$web_search",
                                content: "Error: Missing query parameter."
                            });
                            continue;
                        }
                    }

                    // Standard Web Search Handling
                    if (toolCall.type === 'function' && toolCall.function.name === 'web_search') {
                        let query = "";
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            query = args.query;
                        } catch (parseError) {
                            console.warn("Failed to parse tool arguments", parseError);
                        }

                        if (query) {
                            const searchResult = await performClientSideSearch(query, options.forceSearch);
                            currentMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: searchResult || "No relevant results found."
                            });
                            try {
                                useAIStore.getState().appendLog({
                                    id: uuidv4(),
                                    ts: Date.now(),
                                    channel: 'search',
                                    provider: searchProvider,
                                    query,
                                    request: {},
                                    response: searchResult || "",
                                    durationMs: undefined,
                                    searchType: 'text'
                                });
                            } catch {}
                        } else {
                             currentMessages.push({
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: "Error: Missing query parameter."
                            });
                        }
                    }
                }
                turnCount++;
            } else {
                // No tool calls, return final response
                const content = message && typeof message.content === 'string' 
                    ? message.content 
                    : Array.isArray(message?.content) 
                        ? message.content.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('') 
                        : '';
                return content || "";
            }
        }
        
        return ""; // Exceeded max turns
    } catch (e) {
        console.error("Direct AI Chat failed:", e);
        try {
            useAIStore.getState().appendLog({
                id: uuidv4(),
                ts: Date.now(),
                channel: 'ai',
                provider: (useAIStore.getState().provider as any),
                model: useAIStore.getState().model,
                baseURL: useAIStore.getState().baseUrl,
                request: { messages, temperature },
                response: { error: e?.message || String(e) },
                durationMs: undefined
            });
        } catch {}
        return "";
    }
};

const normalizeMediaItem = (item: any): any => {
    const s = (v: any) => String(v || '').trim();
    
    // Map director/author
    let directorOrAuthor = s(item.directorOrAuthor);
    if (!directorOrAuthor || directorOrAuthor.toLowerCase() === 'unknown') {
        const alt = s(item.director || item.Director || item.author || item.Author || item.creator || item.Creator || item.artist || item.Artist);
        if (alt) directorOrAuthor = alt;
    }
    
    // Map releaseDate
    let releaseDate = s(item.releaseDate);
    if (!releaseDate || releaseDate.toLowerCase() === 'unknown') {
        const alt = s(item.release_date || item.ReleaseDate || item.publishedDate || item.year || item.Year || item.date || item.Date || item.first_air_date);
        if (alt) releaseDate = alt;
    }
    
    // Map description
    let description = s(item.description);
    if (!description || description.toLowerCase() === 'unknown') {
        const alt = s(item.desc || item.Description || item.summary || item.Summary || item.plot || item.Plot || item.overview || item.Overview || item.intro || item.synopsis);
        if (alt) description = alt;
    }
    
    // Map cast
    let cast = item.cast;
    if (!cast || !Array.isArray(cast) || cast.length === 0) {
        const c = item.cast || item.Cast || item.actors || item.Actors || item.starring || item.Starring;
        if (Array.isArray(c)) cast = c;
        else if (typeof c === 'string') cast = c.split(/[,;]/).map((x: string) => x.trim()).filter((x: string) => x);
    }
    
    return {
        ...item,
        directorOrAuthor,
        releaseDate,
        description,
        cast
    };
};

export const searchMedia = async (query: string, type?: MediaType | 'All'): Promise<MediaItem[]> => {
  if (!query.trim()) return [];

  const langKey = i18n.language.split('-')[0];
  const cacheKey = `media_tracker_search_${langKey}_${type || 'All'}_${query.trim().toLowerCase()}`;
  const cacheTsKey = `${cacheKey}_ts`;
  try {
    const cachedData = localStorage.getItem(cacheKey);
    const cachedTs = localStorage.getItem(cacheTsKey);
    if (cachedData && cachedTs) {
      const now = Date.now();
      const last = parseInt(cachedTs, 10);
      const ttl = 2 * 60 * 60 * 1000;
      if (now - last < ttl) {
        const parsed = JSON.parse(cachedData);
        if (Array.isArray(parsed)) return parsed as MediaItem[];
      }
    }
  } catch {}

  const isChinese = i18n.language.startsWith('zh');

  // Parallel Execution: TMDB, Bangumi, Plugins, and AI Search Context
  const [tmdbRes, bangumiRes, pluginRes, searchContext] = await Promise.all([
      // TMDB Search
      (async () => {
          try {
              if (!type || type === 'All' || type === MediaType.MOVIE || type === MediaType.TV_SERIES) {
                  const t = (type === MediaType.MOVIE) ? 'movie' : (type === MediaType.TV_SERIES) ? 'tv' : 'multi';
                  return await searchTMDB(query, t as any);
              }
          } catch {}
          return [];
      })(),
      // Bangumi Search
      (async () => {
           try {
               let bType = undefined;
               // Bangumi types: 1=book, 2=anime(tv), 3=music, 4=game, 6=real
               if (type === MediaType.BOOK) bType = 1;
               if (type === MediaType.TV_SERIES || type === MediaType.COMIC) bType = 2; 
               if (type === MediaType.MUSIC) bType = 3;
               return await searchBangumi(query, bType);
           } catch {}
           return [];
      })(),
      // Plugin Search
      (async () => {
          try {
              const { getEnabledPlugins } = usePluginStore.getState();
              const plugins = getEnabledPlugins();
              if (plugins.length === 0) return [];
              
              const results = await Promise.all(plugins.map(async p => {
                  try {
                      const executor = new PluginExecutor(p);
                      return await executor.executeSearch(query);
                  } catch (e) {
                      console.error(`Plugin ${p.name} failed:`, e);
                      return [];
                  }
              }));
              return results.flat();
          } catch (e) {
              console.error("Plugin search error:", e);
              return [];
          }
      })(),
      // AI Search Context
      (async () => {
          try {
            return await performClientSideSearch(query, true, type);
          } catch { return ""; }
      })()
  ]);

  // Convert Plugin Results
  const pluginItems: MediaItem[] = pluginRes.map((item: any) => {
      const normalizeType = (t: string | undefined): MediaType => {
          const s = (t || '').toLowerCase();
          if (s.includes('movie') || s.includes('film')) return MediaType.MOVIE;
          if (s.includes('tv') || s.includes('series')) return MediaType.TV_SERIES;
          if (s.includes('book') || s.includes('novel')) return MediaType.BOOK;
          if (s.includes('comic') || s.includes('manga')) return MediaType.COMIC;
          if (s.includes('music') || s.includes('album')) return MediaType.MUSIC;
          if (s.includes('short')) return MediaType.SHORT_DRAMA;
          return MediaType.OTHER;
      };

      return {
          id: uuidv4(),
          title: item.title,
          directorOrAuthor: item.directorOrAuthor || "",
          description: item.description || "",
          releaseDate: item.year || "",
          type: normalizeType(item.type),
          isOngoing: false,
          posterUrl: normalizeImageUrl(item.poster),
          rating: item.rating,
          status: 'To Watch',
          addedAt: new Date().toISOString()
      };
  });

  // Convert TMDB Results
  const tmdbItems: MediaItem[] = tmdbRes
    .filter((item: any) => item.media_type !== 'person')
    .map((item: any) => ({
      id: uuidv4(),
      title: item.title || item.name || query,
      directorOrAuthor: "", 
      description: item.overview || "",
      releaseDate: item.release_date || item.first_air_date || "",
      type: item.media_type === 'movie' ? MediaType.MOVIE : MediaType.TV_SERIES,
      isOngoing: false,
      posterUrl: getTMDBPosterUrl(item.poster_path) || undefined,
      tmdbId: typeof item.id === 'number' ? item.id : undefined,
      tmdbMediaType: item.media_type === 'movie' || item.media_type === 'tv' ? item.media_type : undefined,
      rating: item.vote_average ? `${item.vote_average.toFixed(1)}/10` : undefined,
      status: 'To Watch',
      addedAt: new Date().toISOString()
  }));

  // Convert Bangumi Results
  const bangumiItems: MediaItem[] = bangumiRes.map((item: any) => {
      let mType = MediaType.OTHER;
      if (item.type === 1) mType = MediaType.BOOK;
      else if (item.type === 2) mType = MediaType.TV_SERIES; 
      else if (item.type === 3) mType = MediaType.MUSIC;
      else if (item.type === 6) mType = MediaType.TV_SERIES;

      const releaseDate = String(item.date || item.air_date || '').trim();
      const rawPoster = String(item.images?.large || item.images?.common || '').trim();
      const posterUrl = rawPoster ? normalizeImageUrl(rawPoster.replace(/^http:\/\//i, 'https://')) : undefined;
      const score = (typeof item.score === 'number' ? item.score : (typeof item.rating?.score === 'number' ? item.rating.score : undefined));
      
      return {
          id: uuidv4(),
          title: item.name_cn || item.name,
          directorOrAuthor: "",
          description: item.summary || "",
          releaseDate,
          type: mType,
          isOngoing: false,
          posterUrl,
          rating: (typeof score === 'number' && !Number.isNaN(score)) ? `${score}/10` : undefined,
          status: 'To Watch',
          addedAt: new Date().toISOString()
      };
  });

  // Prefetch images from search context
  try {
    if (searchContext) {
      const parsedSC = JSON.parse(searchContext);
      if (Array.isArray(parsedSC)) {
        parsedSC.forEach((item: any) => {
          if (item.title && item.image) {
            const img = normalizeImageUrl(item.image);
            if (!img) return;
            if (img.toLowerCase().includes('tiktok.com/api/img')) return;
            if (img.toLowerCase().includes('m.media-amazon.com')) return;
            prefetchedImages.set(item.title.toLowerCase(), img);
            const { title } = processSearchResult(item.title, item.snippet || "");
            prefetchedImages.set(title.toLowerCase(), img);
          }
        });
      }
    }
  } catch {}
  
  const { systemPrompt, provider } = useAIStore.getState();
  
  let userPrompt = "";

  if (provider === 'moonshot') {
      if (isChinese) {
          userPrompt = `搜索符合以下查询的媒体作品: "${query}"。`;
          if (type && type !== 'All') {
              userPrompt += ` 严格限制结果类型为: "${type}"。`;
          } else {
              userPrompt += ` (包括书籍、电影、电视剧、漫画、短剧)`;
          }
          userPrompt += `\n[限制] 仅返回作品（小说、电影、电视剧、短剧、漫画、音乐专辑）。严禁返回新闻、产品评测、对比、参数、价格、手机/电子产品相关条目。`;
          userPrompt += `\n[系列] 若查询为系列作品（如第一部/第二部/续集），请分别返回各部作品，并给出准确年份。`;
          userPrompt += `\n[优先] 使用联网搜索工具 (web_search) 获取最新信息；如网络不可用或搜索无结果，请基于已有知识返回有效 JSON：\n${searchContext}\n请尽力补全缺失的元数据（导演、主演、简介（尽量详细，不少于50字）、上映日期）。若无法确认具体日期，可返回年份。`;
      } else {
          userPrompt = `Search for media works matching the query: "${query}".`;
          if (type && type !== 'All') {
              userPrompt += ` Strictly limit results to type: "${type}".`;
          } else {
              userPrompt += ` (books, movies, TV series, comics, short dramas)`;
          }
          userPrompt += `\n[Constraint] Only return works (novels, movies, TV series, short dramas, comics, music albums). Do NOT include news, product reviews, comparisons, specs, prices, or phone/electronics items.`;
          userPrompt += `\n[PREFER] Use the web search tool; if unavailable or no results, rely on your internal knowledge to return a valid JSON array:\n${searchContext}\nPlease do your best to fill in missing metadata (Director, Cast, Description (detailed, >50 words), Release Date). If exact date is unknown, year is acceptable.`;
      }
  } else {
      if (isChinese) {
          userPrompt = `搜索符合以下查询的媒体作品: "${query}"。`;
          if (type && type !== 'All') {
              userPrompt += ` 严格限制结果类型为: "${type}"。`;
          } else {
              userPrompt += ` (包括书籍、电影、电视剧、漫画、短剧)`;
          }
          userPrompt += `\n[系列] 若查询为系列作品（如第一部/第二部/续集），请分别返回各部作品，并给出准确年份。`;
          userPrompt += `\n请利用你的联网搜索工具或参考以下搜索结果来获取准确信息：\n${searchContext}\n如搜索结果不足，请使用你的内部知识补全信息（导演、主演、简介）。请务必返回有效JSON数组。`;
      } else {
          userPrompt = `Search for media works matching the query: "${query}".`;
          if (type && type !== 'All') {
              userPrompt += ` Strictly limit results to type: "${type}".`;
          } else {
              userPrompt += ` (books, movies, TV series, comics, short dramas)`;
          }
          userPrompt += `\nUse your web search tool or refer to the following search results to verify info:\n${searchContext}\nIf search results are insufficient, please use your internal knowledge to complete the metadata (especially detailed description). Return ONLY a valid JSON array.`;
      }
  }

  const messages = [
    { role: "system", content: systemPrompt + (isChinese ? " 请务必使用JSON格式返回。不要使用Markdown代码块。只返回JSON数组。" : " Please return strictly valid JSON. Do not use markdown code blocks. Return ONLY a JSON array.") },
    ...(searchContext ? [{ role: "user", content: searchContext }] : []),
    { role: "user", content: userPrompt }
  ];

  let aiItems: MediaItem[] = [];
  try {
    const text = await callAI(messages, 0.1, { forceSearch: true });
    if (text) {
        let jsonStr = "";
        const jsonArrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonArrayMatch) {
            jsonStr = jsonArrayMatch[0];
        } else {
            jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        }

        let rawData: any[] = [];
        if (jsonStr.startsWith('[') || jsonStr.startsWith('{')) {
            try {
                rawData = JSON.parse(jsonStr);
            } catch (e) {
                const lastBracket = jsonStr.lastIndexOf('}');
                if (lastBracket > 0) {
                    try {
                        rawData = JSON.parse(jsonStr.substring(0, lastBracket + 1) + ']');
                    } catch {}
                }
            }
        }

        if (rawData.length > 0) {
             aiItems = rawData.map((rawItem) => {
                const item = normalizeMediaItem(rawItem);
                const id = uuidv4();
                const placeholder = getPlaceholder(item.type || 'Media');
                const posterUrl = prefetchedImages.get(item.title.toLowerCase()) || undefined;
                const normalizeType = (v: any, title: string, desc?: string): MediaType => {
                    const s = String(v || '').toLowerCase();
                    if (s.includes('novel') || s.includes('book') || s.includes('小说') || s.includes('书')) return MediaType.BOOK;
                    if (s.includes('album') || s.includes('music') || s.includes('专辑') || s.includes('音乐')) return MediaType.MUSIC;
                    if (s.includes('tv') || s.includes('series') || s.includes('season') || s.includes('电视剧') || s.includes('剧集')) return MediaType.TV_SERIES;
                    if (s.includes('comic') || s.includes('manga') || s.includes('漫画')) return MediaType.COMIC;
                    if (s.includes('short') || s.includes('短剧')) return MediaType.SHORT_DRAMA;
                    if (s.includes('movie') || s.includes('film') || s.includes('电影')) return MediaType.MOVIE;
                    const inferred = processSearchResult(title, desc || '');
                    return inferred.type || MediaType.MOVIE;
                };
                const normalizedType = normalizeType((item as any).type, item.title, (item as any).description);
                return {
                    ...item,
                    type: normalizedType,
                    id,
                    posterUrl: posterUrl || placeholder,
                    userRating: 0,
                    status: 'To Watch',
                    addedAt: new Date().toISOString()
                } as MediaItem;
            });
        }
    }
    
    if (aiItems.length === 0) {
        try {
            aiItems = await createFallbackItemsFromContext(searchContext) as MediaItem[];
        } catch {}
    }
  } catch (e) {
      console.error("AI Search Failed", e);
  }

  const norm = (v?: string) => String(v || '').trim();
  const isUnknownText = (v?: string) => {
      const s = norm(v);
      if (!s) return true;
      const low = s.toLowerCase();
      return low === 'unknown' || s === '未知' || low === 'n/a' || low === 'na' || s === '-';
  };
  const isFullDate = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(norm(v));
  const dateScore = (v?: string) => {
      const s = norm(v);
      if (!s || isUnknownText(s)) return 0;
      if (/^\d{4}$/.test(s)) return 1;
      if (/^\d{4}-\d{2}$/.test(s)) return 2;
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 3;
      if (s.length >= 10) return 2;
      if (s.length >= 4) return 1;
      return 0;
  };
  const pickBetterDate = (a?: string, b?: string) => {
      const sa = dateScore(a);
      const sb = dateScore(b);
      if (sb > sa) return norm(b);
      return norm(a);
  };
  const pickText = (a?: string, b?: string) => {
      const sa = norm(a);
      const sb = norm(b);
      if (isUnknownText(sa) && !isUnknownText(sb)) return sb;
      if (!isUnknownText(sa) && isUnknownText(sb)) return sa;
      if (!isUnknownText(sa) && !isUnknownText(sb)) {
          if (sb.length > sa.length) return sb;
          return sa;
      }
      return '';
  };
  const pickCast = (a?: string[], b?: string[]) => {
      const ca = Array.isArray(a) ? a.filter(Boolean) : [];
      const cb = Array.isArray(b) ? b.filter(Boolean) : [];
      if (cb.length > ca.length) return cb.slice(0, 5);
      return ca.slice(0, 5);
  };
  const mergeMediaItems = (base: MediaItem, incoming: MediaItem): MediaItem => {
      const merged: MediaItem = { ...base };
      merged.releaseDate = pickBetterDate(base.releaseDate, incoming.releaseDate);
      merged.directorOrAuthor = pickText(base.directorOrAuthor, incoming.directorOrAuthor);

      const incomingIsTMDB = !!incoming.tmdbId || incoming.tmdbMediaType === 'movie' || incoming.tmdbMediaType === 'tv';
      if (incomingIsTMDB && !isUnknownText(incoming.description)) {
          merged.description = isUnknownText(base.description) ? incoming.description : base.description;
      } else {
          merged.description = pickText(base.description, incoming.description);
      }

      const basePoster = norm(base.posterUrl);
      const incomingPoster = norm(incoming.posterUrl);
      const basePosterMissing = isBlockedPosterUrl(basePoster);
      const incomingPosterMissing = isBlockedPosterUrl(incomingPoster);
      merged.posterUrl = (basePosterMissing && !incomingPosterMissing) ? incoming.posterUrl : (base.posterUrl || incoming.posterUrl);
      merged.rating = base.rating || incoming.rating;
      merged.cast = pickCast(base.cast, incoming.cast);
      merged.tmdbId = merged.tmdbId ?? incoming.tmdbId;
      merged.tmdbMediaType = merged.tmdbMediaType ?? incoming.tmdbMediaType;
      return merged;
  };

  // Merge Priority: Plugins > TMDB > Bangumi > AI (but fill gaps from lower-priority sources)
  const allItems = [...pluginItems, ...tmdbItems, ...bangumiItems, ...aiItems];
  const uniqueItems = new Map<string, MediaItem>();

  for (const item of allItems) {
      const normTitle = item.title.trim().toLowerCase();
      let key = normTitle;
      if (item.releaseDate && item.releaseDate.length >= 4) {
          key = `${normTitle}|${item.releaseDate.substring(0, 4)}`;
      }

      const prev = uniqueItems.get(key);
      if (!prev) uniqueItems.set(key, item);
      else uniqueItems.set(key, mergeMediaItems(prev, item));
  }

  let filtered = Array.from(uniqueItems.values()).filter(r => {
      const allowedTypes = new Set<string>(Object.values(MediaType).filter((t) => t !== MediaType.OTHER));
      return allowedTypes.has(r.type);
  });

  const enrichWithTMDB = async (items: MediaItem[]): Promise<MediaItem[]> => {
      const wantsFullDate = (t: MediaType) => t === MediaType.MOVIE || t === MediaType.TV_SERIES || t === MediaType.SHORT_DRAMA;
      const needsEnrich = (it: MediaItem) => {
          if (!(it.type === MediaType.MOVIE || it.type === MediaType.TV_SERIES)) return false;
          if (!it.tmdbId || !(it.tmdbMediaType === 'movie' || it.tmdbMediaType === 'tv')) return false;
          const dateNeeded = wantsFullDate(it.type) && !isFullDate(it.releaseDate);
          const directorNeeded = isUnknownText(it.directorOrAuthor);
          const descNeeded = isUnknownText(it.description) || norm(it.description).length < 60;
          const castNeeded = !it.cast || it.cast.length === 0;
          return dateNeeded || directorNeeded || descNeeded || castNeeded;
      };
      const toPatch = items.filter(needsEnrich).slice(0, 10);
      if (toPatch.length === 0) return items;

      const byId = new Map(items.map(i => [i.id, i]));
      const queue = [...toPatch];

      const applyTMDBDetails = async (it: MediaItem) => {
          const tmdbId = it.tmdbId;
          const tmdbMediaType: 'movie' | 'tv' = it.tmdbMediaType as any;
          if (!tmdbId) return;

          let details = await getTMDBDetails(tmdbId, tmdbMediaType, 'zh-CN');
          if (details && isUnknownText(details.overview)) {
              const en = await getTMDBDetails(tmdbId, tmdbMediaType, 'en-US');
              if (en && !isUnknownText(en.overview)) details = { ...details, overview: en.overview };
          }
          if (!details) return;

          const next: Partial<MediaItem> = { tmdbId, tmdbMediaType };

          const rel = norm(details.release_date || details.first_air_date);
          if (rel && (isUnknownText(it.releaseDate) || (wantsFullDate(it.type) && !isFullDate(it.releaseDate)) || dateScore(rel) > dateScore(it.releaseDate))) {
              next.releaseDate = rel;
          }

          if (isUnknownText(it.directorOrAuthor)) {
              if (tmdbMediaType === 'movie') {
                  const crew = Array.isArray(details.credits?.crew) ? details.credits.crew : [];
                  const directors = crew.filter((c: any) => c && c.job === 'Director' && c.name).map((c: any) => String(c.name));
                  if (directors.length > 0) next.directorOrAuthor = directors.slice(0, 2).join(' / ');
              } else {
                  const createdBy = Array.isArray(details.created_by) ? details.created_by : [];
                  const creators = createdBy.filter((c: any) => c && c.name).map((c: any) => String(c.name));
                  if (creators.length > 0) next.directorOrAuthor = creators.slice(0, 2).join(' / ');
              }
          }

          const overview = norm(details.overview);
          if (overview && (isUnknownText(it.description) || norm(it.description).length < 60)) {
              next.description = overview;
          }

          if (!it.cast || it.cast.length === 0) {
              const cast = Array.isArray(details.credits?.cast) ? details.credits.cast : [];
              const names = cast.filter((c: any) => c && c.name).map((c: any) => String(c.name)).slice(0, 5);
              if (names.length > 0) next.cast = names;
          }

          const poster = getTMDBPosterUrl(details.poster_path) || undefined;
          if (poster && (!it.posterUrl || it.posterUrl.includes('placehold.co') || it.posterUrl.includes('No+Image') || it.posterUrl.includes('Image+Error'))) {
              next.posterUrl = poster;
          }

          if (Object.keys(next).length <= 2) return;
          byId.set(it.id, { ...it, ...next });
      };

      const worker = async () => {
          while (queue.length > 0) {
              const it = queue.shift();
              if (!it) return;
              try { await applyTMDBDetails(it); } catch {}
          }
      };

      await Promise.all([worker(), worker(), worker()]);
      return items.map(i => byId.get(i.id) || i);
  };

  filtered = await enrichWithTMDB(filtered);

  try {
    localStorage.setItem(cacheKey, JSON.stringify(filtered));
    localStorage.setItem(cacheTsKey, Date.now().toString());
  } catch {}
  return filtered;
};

export const checkUpdates = async (items: MediaItem[]): Promise<{ id: string; latestUpdateInfo: string; isOngoing: boolean }[]> => {
  if (items.length === 0) return [];
  
  // Create a mapping of title -> id to map results back
  const titleToId = new Map(items.map(i => [i.title.toLowerCase(), i.id]));
  
  const queryList = items.map(i => `"${i.title}" (${i.type})`).join(', ');
  const isChinese = i18n.language.startsWith('zh');
  let userPrompt = "";
  
  if (isChinese) {
      userPrompt = `请提供以下作品的最新更新状态: ${queryList}。
      请提供截至今天的最新一集/一章信息。
      返回一个包含以下对象的JSON数组:
      - title: 字符串 (完全匹配)
      - latestUpdateInfo: 字符串 (例如 "第4季 第8集" 或 "第1052章")
      - isOngoing: 布尔值 (如果仍在更新则为 true)

      [注意] 如果联网搜索失败或没有找到相关结果，请利用你的内部知识库来判断并提供可能的最准确信息。即便信息不是最新的，也比返回空好。
      `;
  } else {
      userPrompt = `Please check the latest status for: ${queryList}. 
      Provide the absolute latest episode/chapter as of today.
      Return a JSON array with objects containing:
      - title: string (exact match)
      - latestUpdateInfo: string (e.g. "Season 4 Episode 8" or "Chapter 1052")
      - isOngoing: boolean (true if still updating)

      [Note] If web search fails or yields no results, please use your internal knowledge base to provide the most accurate information possible. Even if the info is not real-time, it is better than returning nothing.
      `;
  }

  const messages = [
    { role: "system", content: isChinese ? "你是一个媒体更新追踪助手。仅返回原始JSON数组。不要使用Markdown。" : "You are a media update tracker. Return ONLY raw JSON array. No markdown." },
    { role: "user", content: userPrompt }
  ];

  const text = await callAI(messages, 0.1);
  if (!text) return [];

  // Improved JSON extraction
  let jsonStr = "";
  const jsonArrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (jsonArrayMatch) {
      jsonStr = jsonArrayMatch[0];
  } else {
      jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
  }

  let updates: any[] = [];

  if (!jsonStr.startsWith('[') && !jsonStr.startsWith('{')) {
      console.warn("AI returned non-JSON response (updates):", text);
      return [];
  }

  try {
      updates = JSON.parse(jsonStr);
  } catch (e) {
      console.error("Failed to parse updates JSON", e);
      return [];
  }

  // Map back to IDs
  const results = updates.map(u => {
      const id = titleToId.get(u.title.toLowerCase());
      if (!id) return null;
      return {
          id,
          latestUpdateInfo: u.latestUpdateInfo,
          isOngoing: u.isOngoing
      };
  }).filter(Boolean) as { id: string; latestUpdateInfo: string; isOngoing: boolean }[];

  return results;
};

export const repairMediaItem = async (item: MediaItem): Promise<Partial<MediaItem> | null> => {
    const norm = (v?: string) => (v || '').trim();
    const isUnknownText = (v?: string) => {
        const s = norm(v);
        if (!s) return true;
        const low = s.toLowerCase();
        return low === 'unknown' || s === '未知' || low === 'n/a' || low === 'na' || s === '-';
    };
    const isFullDate = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(norm(v));
    const wantsFullDate = item.type === MediaType.MOVIE || item.type === MediaType.TV_SERIES;

    const isPosterMissing = isBlockedPosterUrl(item.posterUrl);
    const isDateMissing = wantsFullDate ? !isFullDate(item.releaseDate) : isUnknownText(item.releaseDate);
    const isDirectorMissing = isUnknownText(item.directorOrAuthor);
    const currentDesc = norm(item.description);
    const isDescShort = !isUnknownText(currentDesc) && currentDesc.length < 50;
    const isDescMissing = isUnknownText(currentDesc) || isDescShort;
    const isCastMissing = !item.cast || item.cast.length === 0;

    if (!isPosterMissing && !isDateMissing && !isDirectorMissing && !isDescMissing && !isCastMissing) return null;

    let updates: Partial<MediaItem> = {};

    if (isPosterMissing) {
        const year = !isUnknownText(item.releaseDate) ? item.releaseDate.split('-')[0] : '';
        const url = await fetchPosterFromSearch(item.title, year, item.type);
        if (url && !url.includes('placehold.co')) {
            updates.posterUrl = url;
        }
    }

    if (item.type === MediaType.MOVIE || item.type === MediaType.TV_SERIES) {
        try {
            const mapType: 'movie' | 'tv' =
                (item.tmdbMediaType === 'movie' || item.tmdbMediaType === 'tv')
                    ? item.tmdbMediaType
                    : (item.type === MediaType.TV_SERIES ? 'tv' : 'movie');

            let tmdbId = item.tmdbId;
            let tmdbMediaType: 'movie' | 'tv' = mapType;

            if (!tmdbId) {
                const candidates = await searchTMDB(item.title, mapType);
                const year = norm(item.releaseDate).slice(0, 4);
                const best = (year && /^\d{4}$/.test(year))
                    ? candidates.find(c => (c.release_date || c.first_air_date || '').startsWith(year))
                    : candidates[0];
                if (best && typeof best.id === 'number') {
                    tmdbId = best.id;
                    tmdbMediaType = best.media_type === 'tv' ? 'tv' : 'movie';
                }
            }

            if (tmdbId) {
                let details = await getTMDBDetails(tmdbId, tmdbMediaType, 'zh-CN');
                if (details && isUnknownText(details.overview)) {
                    const en = await getTMDBDetails(tmdbId, tmdbMediaType, 'en-US');
                    if (en && !isUnknownText(en.overview)) details = { ...details, overview: en.overview };
                }
                if (details) {
                    updates.tmdbId = tmdbId;
                    updates.tmdbMediaType = tmdbMediaType;

                    const rel = norm(details.release_date || details.first_air_date);
                    if (rel && (!isFullDate(item.releaseDate) || isUnknownText(item.releaseDate))) {
                        updates.releaseDate = rel;
                    }

                    if (isUnknownText(item.directorOrAuthor)) {
                        if (tmdbMediaType === 'movie') {
                            const crew = Array.isArray(details.credits?.crew) ? details.credits.crew : [];
                            const directors = crew
                                .filter((c: any) => c && c.name && (c.job === 'Director' || String(c.job || '').toLowerCase().includes('director')))
                                .map((c: any) => String(c.name));
                            if (directors.length > 0) updates.directorOrAuthor = directors.slice(0, 2).join(' / ');
                        } else {
                            const createdBy = Array.isArray(details.created_by) ? details.created_by : [];
                            const creators = createdBy.filter((c: any) => c && c.name).map((c: any) => String(c.name));
                            if (creators.length > 0) updates.directorOrAuthor = creators.slice(0, 2).join(' / ');
                            else {
                                const crew = Array.isArray(details.credits?.crew) ? details.credits.crew : [];
                                const directors = crew
                                    .filter((c: any) => c && c.name && String(c.job || '').toLowerCase().includes('director'))
                                    .map((c: any) => String(c.name));
                                if (directors.length > 0) updates.directorOrAuthor = directors.slice(0, 2).join(' / ');
                            }
                        }
                    }

                    const overview = norm(details.overview);
                    if (overview && (isUnknownText(item.description) || currentDesc.length < 60)) {
                        updates.description = overview;
                    }

                    if (!item.cast || item.cast.length === 0) {
                        const cast = Array.isArray(details.credits?.cast) ? details.credits.cast : [];
                        const names = cast.filter((c: any) => c && c.name).map((c: any) => String(c.name)).slice(0, 5);
                        if (names.length > 0) updates.cast = names;
                    }

                    const poster = getTMDBPosterUrl(details.poster_path) || undefined;
                    if (poster && isPosterMissing && !updates.posterUrl) updates.posterUrl = poster;
                }
            }
        } catch {}
    }

    const effective = { ...item, ...updates } as MediaItem;

    const shouldSearch =
        (wantsFullDate ? !isFullDate(effective.releaseDate) : isUnknownText(effective.releaseDate)) ||
        isUnknownText(effective.directorOrAuthor) ||
        isUnknownText(effective.description) ||
        (norm(effective.description).length > 0 && norm(effective.description).length < 50) ||
        (!effective.cast || effective.cast.length === 0) ||
        (isPosterMissing && !updates.posterUrl);

    if (shouldSearch) {
        try {
            const results = await searchMedia(item.title, item.type);
            const exact = results.find(r => r.title.toLowerCase() === item.title.toLowerCase());
            const match = exact || results[0];
            if (match) {
                if ((wantsFullDate ? !isFullDate(effective.releaseDate) : isUnknownText(effective.releaseDate)) && !isUnknownText(match.releaseDate)) {
                    updates.releaseDate = match.releaseDate;
                }
                if ((isPosterMissing && !updates.posterUrl) && match.posterUrl && !match.posterUrl.includes('placehold.co')) {
                    updates.posterUrl = match.posterUrl;
                }
                if (isUnknownText(effective.directorOrAuthor) && !isUnknownText(match.directorOrAuthor)) {
                    updates.directorOrAuthor = match.directorOrAuthor;
                }
                if ((isUnknownText(effective.description) || norm(effective.description).length < 60) && !isUnknownText(match.description)) {
                    updates.description = match.description;
                }
                if ((!effective.cast || effective.cast.length === 0) && match.cast && match.cast.length > 0) {
                    updates.cast = match.cast;
                }
            }
        } catch {}
    }

    return Object.keys(updates).length > 0 ? updates : null;
};



// New Helper: Fetch Poster from Search
export const fetchPosterFromSearch = async (title: string, year: string, type: string = 'movie'): Promise<string | undefined> => {
    const { 
        enableSearch, 
        searchProvider, 
        getDecryptedGoogleKey, 
        googleSearchCx, 
        getDecryptedSerperKey,
        getDecryptedYandexKey,
        yandexSearchLogin
    } = useAIStore.getState();
    const normalizeProvider = (sp: any): string => {
        const v = String(sp || '').toLowerCase();
        return (v === 'google' || v === 'serper' || v === 'yandex') ? v : 'duckduckgo';
    };
    if (!enableSearch) {
        return await fetchPosterFromOMDB(title, year);
    }
    
    if (searchProvider === 'yandex') {
        try {
            const first = await fetchPosterFromOMDB(title, year);
            if (first) return first;
            const langZh = i18n.language.startsWith('zh');
            if (isTauriEnv) {
                const jsonStr = await invoke<string>('wiki_pageimages', { title, lang_zh: langZh });
                const data = JSON.parse(jsonStr);
                if (data?.query?.pages) {
                    const pages = Object.values(data.query.pages);
                    if (pages.length > 0) {
                        const p: any = pages[0];
                        const img = p?.thumbnail?.source || p?.original?.source;
                        if (typeof img === 'string' && img.length > 0) return img;
                    }
                }
            } else {
                const api = langZh ? 'https://zh.wikipedia.org/w/api.php' : 'https://en.wikipedia.org/w/api.php';
                const res = await fetchWithTimeout(`${api}?action=query&prop=pageimages&piprop=thumbnail|original&pithumbsize=1024&format=json&origin=*&titles=${encodeURIComponent(title)}`, { timeoutMs: 8000 });
                if (res.ok) {
                    const data = await res.json();
                    if (data?.query?.pages) {
                        const pages = Object.values(data.query.pages);
                        if (pages.length > 0) {
                            const p: any = pages[0];
                            const img = p?.thumbnail?.source || p?.original?.source;
                            if (typeof img === 'string' && img.length > 0) return img;
                        }
                    }
                }
            }
        } catch {}
        return await fetchPosterFromOMDB(title, year);
    }

    const yearToken = (() => {
        const y = String(year || '').trim().slice(0, 4);
        return /^\d{4}$/.test(y) ? y : '';
    })();

    // Construct a more specific query
    const isChinese = i18n.language.startsWith('zh');
    let query = "";
    
    if (isChinese) {
        // Localized query for better results with Chinese titles
        // Simplified queries to reduce latency and noise
        let typeTerm = "海报 竖版";
        switch(type.toLowerCase()) {
            case 'movie': case '电影': typeTerm = "电影海报 竖版"; break;
            case 'tv series': case '电视剧': typeTerm = "电视剧海报 竖版"; break;
            case 'book': case '书籍': typeTerm = "书封面"; break;
            case 'comic': case '漫画': typeTerm = "漫画封面"; break;
            case 'music': case '音乐': typeTerm = "专辑封面"; break;
            case 'short drama': case '短剧': typeTerm = "短剧海报 竖版"; break;
        }
        query = `${title} ${yearToken ? `${yearToken} ` : ''}${typeTerm}`; 
    } else {
        query = `"${title}" ${yearToken ? `${yearToken} ` : ''}${type} poster`;
    }
    
    // ...

    try {
        const posterDomains = (() => {
            const s = useAIStore.getState();
            const arr = (s as any)?.authoritativeDomains?.poster;
            if (Array.isArray(arr) && arr.length > 0) return arr;
            return ['moviepostersgallery.com', 'impawards.com', 'goldposter.com'];
        })();
        const queryVariants = [query, ...posterDomains.map(d => `${query} site:${d}`)];

        const normalizeHost = (u: string): string => {
            try {
                return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
            } catch {
                const s = String(u || '').toLowerCase();
                const m = s.match(/^https?:\/\/([^\/?#]+)/);
                if (m && m[1]) return m[1].replace(/^www\./, '');
                return s.replace(/^www\./, '').split('/')[0];
            }
        };
        const isImageUrl = (u: string) => {
            const normalized = normalizeImageUrl(u);
            if (!normalized) return false;
            return /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(normalized);
        };
        const isPosterDetailLink = (u: string): boolean => {
            const host = normalizeHost(u);
            if (!host) return false;
            return posterDomains.some(d => {
                const dom = String(d || '').toLowerCase().replace(/^www\./, '').split('/')[0];
                return host === dom || host.endsWith(`.${dom}`) || u.toLowerCase().includes(dom);
            });
        };

        const pickFromResults = async (arr: any[]): Promise<string | undefined> => {
            if (!Array.isArray(arr) || arr.length === 0) return undefined;
            const scoreDomain = (u: string) => {
                const url = u.toLowerCase();
                if (url.includes('image.tmdb.org') || url.includes('themoviedb.org')) return 100;
                if (url.includes('doubanio.com') || url.includes('douban.com')) return 90;
                if (url.includes('wikimedia.org') || url.includes('wikipedia.org')) return 85;
                if (url.includes('goldposter.com')) return 82;
                if (url.includes('impawards.com')) return 80;
                if (url.includes('moviepostersgallery.com')) return 78;
                if (url.includes('imdb.com')) return 70;
                if (url.includes('pinterest.com')) return 40;
                return 50;
            };
            const scoreSizeHint = (u: string) => {
                const url = u.toLowerCase();
                if (url.includes('image.tmdb.org/t/p/original')) return 60;
                if (url.includes('/t/p/w780')) return 40;
                if (url.includes('/t/p/w500')) return 25;
                if (url.includes('doubanio.com') && (url.includes('/l/') || url.includes('large'))) return 35;
                const wm = url.match(/\/(\d{3,5})px\-/);
                if (url.includes('wikimedia.org') && wm) {
                    const n = parseInt(wm[1], 10);
                    if (!isNaN(n) && n >= 1080) return 45;
                }
                const am = url.match(/UY(\d{3,4})/i);
                if (url.includes('m.media-amazon.com') && am) {
                    const n = parseInt(am[1], 10);
                    if (!isNaN(n) && n >= 1080) return 40;
                }
                return 0;
            };

            const candidates = arr
                .flatMap((r: any) => {
                    const out: string[] = [];
                    if (typeof r?.image === 'string') out.push(r.image);
                    const l = r?.link;
                    if (typeof l === 'string' && isImageUrl(l)) out.push(l);
                    return out;
                })
                .filter((u: any) => typeof u === 'string')
                .filter((u: string) => {
                    const url = u.toLowerCase();
                    if (url.includes('instagram.com') || url.includes('facebook.com') || url.includes('twitter.com') || url.includes('x.com')) return false;
                    if (url.includes('tiktok.com/api/img')) return false;
                    if (url.includes('m.media-amazon.com')) return false;
                    if (url.includes('i.ebayimg.com') || url.includes('ebayimg.com')) return false;
                    return true;
                })
                .sort((a: string, b: string) => (scoreDomain(b) + scoreSizeHint(b)) - (scoreDomain(a) + scoreSizeHint(a)));

            if (candidates.length === 0) return undefined;

            for (const url of candidates) {
                const normalized = normalizeImageUrl(url);
                if (normalized && await checkImage(normalized)) return normalized;
            }
            return undefined;
        };

        const tryPickOgImageFromPages = async (arr: any[]): Promise<string | undefined> => {
            if (!isTauriEnv) return undefined;
            if (!Array.isArray(arr) || arr.length === 0) return undefined;
            const pages = Array.from(new Set(
                arr
                    .map((r: any) => r?.link)
                    .filter((l: any) => typeof l === 'string')
                    .filter((l: string) => !isImageUrl(l))
                    .filter((l: string) => isPosterDetailLink(l))
            ));
            if (pages.length === 0) return undefined;

            const { useSystemProxy, getProxyUrl } = useAIStore.getState();
            for (const pageUrl of pages.slice(0, 4)) {
                try {
                    const t0 = performance.now();
                    const out = await invoke<string>('fetch_og_image', {
                        url: pageUrl,
                        config: { proxy_url: getProxyUrl(), use_system_proxy: useSystemProxy }
                    });
                    try {
                        useAIStore.getState().appendLog({
                            id: uuidv4(),
                            ts: Date.now(),
                            channel: 'search',
                            provider: 'og_image',
                            query: pageUrl,
                            request: { url: pageUrl },
                            response: out,
                            durationMs: Math.round(performance.now() - t0),
                            searchType: 'image'
                        });
                    } catch {}
                    let parsed: any = null;
                    try { parsed = JSON.parse(out); } catch {}
                    const img = parsed?.ok ? parsed?.image : undefined;
                    if (typeof img === 'string' && img.length > 0) {
                        if (await checkImage(img)) return img;
                    }
                } catch {}
            }
            return undefined;
        };

        if (isTauriEnv) {
            const { useSystemProxy, getProxyUrl } = useAIStore.getState();
            const googleKey = getDecryptedGoogleKey();
            const serperKey = getDecryptedSerperKey();
            const yandexKey = getDecryptedYandexKey();
            const yandexUser = yandexSearchLogin;

            const baseConfig = {
                proxy_url: getProxyUrl(),
                use_system_proxy: useSystemProxy
            };

            const providerList = (() => {
                const out: Array<{ provider: TauriSearchProvider; api_key?: string; cx?: string; user?: string }> = [];
                if (googleKey && googleSearchCx) out.push({ provider: 'google', api_key: googleKey, cx: googleSearchCx });
                if (serperKey) out.push({ provider: 'serper', api_key: serperKey });
                if (yandexKey && yandexUser) out.push({ provider: 'yandex', api_key: yandexKey, user: yandexUser });
                out.push({ provider: 'duckduckgo' });
                return out;
            })();

            const imageProviders = providerList.filter(p => p.provider === 'google' || p.provider === 'serper');

            const runWebSearch = async (qv: string, p: { provider: TauriSearchProvider; api_key?: string; cx?: string; user?: string }, search_type: 'image' | 'text') => {
                const rustConfig = {
                    provider: p.provider,
                    api_key: p.api_key,
                    cx: p.cx,
                    user: p.user,
                    search_type,
                    ...baseConfig
                };
                const start = performance.now();
                const resultStr = await invoke<string>("web_search", { query: qv, config: rustConfig });
                try {
                    useAIStore.getState().appendLog({
                        id: uuidv4(),
                        ts: Date.now(),
                        channel: 'search',
                        provider: rustConfig.provider,
                        query: qv,
                        request: { config: { provider: rustConfig.provider, cx: rustConfig.cx, user: rustConfig.user, search_type: rustConfig.search_type } },
                        response: resultStr,
                        durationMs: Math.round(performance.now() - start),
                        searchType: search_type
                    });
                } catch {}
                let parsed: any[] = [];
                try {
                    const v = JSON.parse(resultStr);
                    if (Array.isArray(v)) parsed = v;
                } catch {}
                return parsed;
            };

            for (const qv of queryVariants) {
                for (const p of imageProviders) {
                    try {
                        const parsed = await runWebSearch(qv, p, 'image');
                        const picked = await pickFromResults(parsed);
                        if (picked) return picked;
                        const ogPicked = await tryPickOgImageFromPages(parsed);
                        if (ogPicked) return ogPicked;
                    } catch {}
                }
            }

            const textQueryVariants = (() => {
                const base = isChinese ? `${title} 海报` : `"${title}" poster`;
                const byDomain = posterDomains.map(d => `${base} site:${String(d).trim()}`);
                const all = [...byDomain, ...queryVariants];
                return Array.from(new Set(all)).slice(0, 10);
            })();

            const textProviders = providerList;
            for (const qv of textQueryVariants) {
                for (const p of textProviders) {
                    try {
                        const parsed = await runWebSearch(qv, p, 'text');
                        const picked = await pickFromResults(parsed);
                        if (picked) return picked;
                        const ogPicked = await tryPickOgImageFromPages(parsed);
                        if (ogPicked) return ogPicked;
                    } catch {}
                }
            }

            try {
                const kind = String(type || '').toLowerCase();
                const t0 = performance.now();
                const outD = await invoke<string>("douban_cover", { title, kind });
                try {
                    useAIStore.getState().appendLog({
                        id: uuidv4(),
                        ts: Date.now(),
                        channel: 'search',
                        provider: 'douban',
                        query: title,
                        request: { title, kind },
                        response: outD,
                        durationMs: Math.round(performance.now() - t0),
                        searchType: 'image'
                    });
                } catch {}
                try {
                    const v = JSON.parse(outD || '{}');
                    if (v && v.image) return v.image;
                } catch {}
            } catch {}
        }
        else {
            for (const qv of queryVariants) {
                let results: any[] = [];
                if (searchProvider === 'google') {
                    const apiKey = getDecryptedGoogleKey();
                    if (apiKey && googleSearchCx) {
                        const cacheKey = `google_img_${googleSearchCx}_${qv}`;
                        const cached = searchCache.get(cacheKey);
                        let data: any = null;
                        if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
                            data = cached.data;
                        } else {
                            const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${googleSearchCx}&q=${encodeURIComponent(qv)}&searchType=image&safe=active&imgType=photo&num=6`;
                            let res;
                            try {
                                await apiLimiter.acquire();
                                res = await fetchWithTimeout(url, { timeoutMs: 10000 });
                            } finally {
                                apiLimiter.release();
                            }
                            if (res.status === 429) {
                                console.warn("Google Custom Search quota exceeded (429).");
                                showQuotaError("Quota Exceeded");
                                if (cached) data = cached.data;
                            } else if (res.ok) {
                                data = await res.json();
                                searchCache.set(cacheKey, { ts: Date.now(), data });
                            }
                        }
                        if (data && data.items) {
                            results = data.items.map((item: any) => {
                                const img = item?.link || item?.image?.thumbnailLink || item?.pagemap?.cse_image?.[0]?.src;
                                return { image: img, link: item?.link };
                            });
                        }
                    }
                }

                if (results.length === 0 && searchProvider === 'serper') {
                    const apiKey = getDecryptedSerperKey();
                    if (apiKey) {
                        try {
                            const response = await fetchWithTimeout('https://google.serper.dev/images', {
                                method: 'POST',
                                headers: {
                                    'X-API-KEY': apiKey,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ q: qv, num: 6 })
                            , timeoutMs: 12000 });
                            if (response.status === 403) {
                                console.error("Serper API 403 Forbidden: Invalid API Key or Quota Exceeded.");
                            } else if (response.status === 429) {
                                console.warn("Serper API 429 (Too Many Requests).");
                                showQuotaError("Quota Exceeded");
                            } else if (response.ok) {
                                const data = await response.json();
                                if (data.images) {
                                    results = data.images.map((img: any) => ({ image: img.imageUrl }));
                                }
                            }
                        } catch (e) {
                            console.warn("Client-side Serper image search failed", e);
                        }
                    }
                }

                const picked = await pickFromResults(results);
                if (picked) return picked;
            }
        }

        try {
            const langZh = i18n.language.startsWith('zh');
            if (isTauriEnv) {
                const jsonStr = await invoke<string>('wiki_pageimages', { title, lang_zh: langZh });
                const data = JSON.parse(jsonStr);
                if (data?.query?.pages) {
                    const pages = Object.values(data.query.pages);
                    if (pages.length > 0) {
                        const p: any = pages[0];
                        const img = p?.thumbnail?.source || p?.original?.source;
                        if (typeof img === 'string' && img.length > 0) return img;
                    }
                }
            } else {
                const api = langZh ? 'https://zh.wikipedia.org/w/api.php' : 'https://en.wikipedia.org/w/api.php';
                const res = await fetchWithTimeout(`${api}?action=query&prop=pageimages&piprop=thumbnail|original&pithumbsize=1024&format=json&origin=*&titles=${encodeURIComponent(title)}`, { timeoutMs: 8000 });
                if (res.ok) {
                    const data = await res.json();
                    if (data?.query?.pages) {
                        const pages = Object.values(data.query.pages);
                        if (pages.length > 0) {
                            const p: any = pages[0];
                            const img = p?.thumbnail?.source || p?.original?.source;
                            if (typeof img === 'string' && img.length > 0) return img;
                        }
                    }
                }
            }
        } catch {}

    } catch (e) {
        console.warn(`Failed to fetch poster from search for ${title}`, e);
    }

    // Final fallback: Try OMDB if available
    return await fetchPosterFromOMDB(title, year);
};

export const testSearchConnection = async (
    provider?: string,
    configOverride?: {
        googleSearchApiKey?: string;
        googleSearchCx?: string;
        serperApiKey?: string;
        yandexSearchApiKey?: string;
        yandexSearchLogin?: string;
    }
): Promise<{ ok: boolean; latency_ms?: number; provider?: string; count?: number; error?: string }> => {
    const s = useAIStore.getState();
    const effProvider = provider || s.searchProvider;
    const normalizeProvider = (sp: any): string => {
        const v = String(sp || '').toLowerCase();
        return (v === 'google' || v === 'serper' || v === 'yandex') ? v : 'duckduckgo';
    };
    const effGoogleKey = configOverride?.googleSearchApiKey || s.getDecryptedGoogleKey();
    const effGoogleCx = configOverride?.googleSearchCx || s.googleSearchCx;
    const effSerperKey = configOverride?.serperApiKey || s.getDecryptedSerperKey();
    const effYandexKey = configOverride?.yandexSearchApiKey || s.getDecryptedYandexKey();
    const effYandexLogin = configOverride?.yandexSearchLogin || s.yandexSearchLogin;
    const effUseSystemProxy = s.useSystemProxy;

    // Check cache
    const cacheKey = `test_conn:${effProvider}:${effGoogleKey || ''}:${effGoogleCx || ''}:${effSerperKey || ''}:${effYandexKey || ''}:${effYandexLogin || ''}`;
    const cached = testConnectionCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts < TEST_CACHE_TTL)) {
        return cached.res;
    }

    if (isTauriEnv) {
        let apiKey: string | undefined = undefined;
        switch (effProvider) {
            case 'google': apiKey = effGoogleKey; break;
            case 'serper': apiKey = effSerperKey; break;
            case 'yandex': apiKey = effYandexKey; break;
            default: apiKey = undefined;
        }

        const rustConfig = {
            provider: normalizeProvider(effProvider),
            api_key: apiKey,
            cx: effGoogleCx,
            user: effYandexLogin,
            search_type: 'text',
            proxy_url: s.getProxyUrl(),
            use_system_proxy: effUseSystemProxy
        };
        try {
            const out = await invoke<string>('test_search_provider', { config: rustConfig });
            const res = JSON.parse(out);
            if (res.ok || (res.error && res.error.includes("429"))) {
                 testConnectionCache.set(cacheKey, { ts: Date.now(), res });
            }
            return res;
        } catch (e: any) {
            const errRes = { ok: false, error: e?.message || String(e) };
            if (errRes.error && errRes.error.includes("429")) {
                 testConnectionCache.set(cacheKey, { ts: Date.now(), res: errRes });
            }
            return errRes;
        }
    } else {
        try {
            if (effProvider === 'google') {
                if (!effGoogleKey || !effGoogleCx) return { ok: false, error: 'missing_google_config' };
                const url = `https://www.googleapis.com/customsearch/v1?key=${effGoogleKey}&cx=${effGoogleCx}&q=test&num=1`;
                const res = await fetchWithTimeout(url, { timeoutMs: 15000 });
                if (res.status === 429) {
                     return { ok: false, provider: 'google', error: 'Quota Exceeded (429)' };
                }
                const ok = res.ok;
                return { ok, provider: 'google' };
            }
            if (effProvider === 'serper') {
                if (!effSerperKey) return { ok: false, error: 'missing_serper_key' };
                const res = await fetchWithTimeout('https://google.serper.dev/search', { method: 'POST', headers: { 'X-API-KEY': effSerperKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'test' }), timeoutMs: 15000 });
                if (res.status === 429) {
                     return { ok: false, provider: 'serper', error: 'Quota Exceeded (429)' };
                }
                return { ok: res.ok, provider: 'serper' };
            }
            if (effProvider === 'yandex') {
                return { ok: false, error: 'web_preview_not_supported' };
            }
            return { ok: false, error: 'unsupported_provider' };
        } catch (e: any) {
            if (e.name === 'AbortError' || e.message === 'timeout') {
                 return { ok: false, error: 'Connection Timed Out (Check Network/Proxy)' };
            }
            // Network errors often appear as TypeErrors in fetch
            if (e instanceof TypeError && e.message === 'Failed to fetch') {
                 return { ok: false, error: 'Network Error (Check Proxy/VPN/CORS)' };
            }
            return { ok: false, error: e?.message || String(e) };
        }
    }
};

export const testOmdbConnection = async (apiKeyOverride?: string): Promise<{ ok: boolean; status?: number; latency_ms?: number; poster?: string; error?: string }> => {
    const s = useAIStore.getState();
    const key = apiKeyOverride || (s.getDecryptedOmdbKey && s.getDecryptedOmdbKey()) || OMDB_API_KEY;
    if (!key) return { ok: false, error: 'missing_omdb_key' };
    if (isTauriEnv) {
        try {
            const out = await invoke<string>('test_omdb', { apiKey: key });
            return JSON.parse(out);
        } catch (e: any) {
            return { ok: false, error: e?.message || String(e) };
        }
    } else {
        try {
            const start = performance.now();
            const res = await fetchWithTimeout(`https://www.omdbapi.com/?t=${encodeURIComponent('Inception')}&y=2010&apikey=${key}`, { timeoutMs: 8000 });
            const latency = Math.round(performance.now() - start);
            const ok = res.ok;
            const status = res.status;
            let poster = '';
            if (ok) {
                const v = await res.json();
                poster = v?.Poster || '';
            }
            return { ok, status, latency_ms: latency, poster };
        } catch (e: any) {
            return { ok: false, error: e?.message || String(e) };
        }
    }
};
// Helper to clean title and extract year from search result
export const processSearchResult = (title: string, snippet: string): { title: string, year: string, type: MediaType } => {
    let cleanTitle = title
        .replace(/ - .*$/, '')
        .replace(/ \| .*$/, '')
        .replace(/_.*$/, '') // Remove underscores common in file names or titles
        .replace(/\.\.\.$/, '') // Remove trailing dots
        .trim();

    // Extract year (prioritize title, then snippet)
    let year = new Date().getFullYear().toString();
    const yearMatch = title.match(/\b(19\d{2}|20\d{2})\b/) || snippet.match(/\b(19\d{2}|20\d{2})\b/);
    if (yearMatch) {
        year = yearMatch[1];
        // Remove year from title if present in parentheses to clean it up
        cleanTitle = cleanTitle.replace(new RegExp(`\\(${year}\\)`), '').trim();
    }

    // Infer type
    let type: MediaType = MediaType.MOVIE; // Default
    const lowerText = (title + " " + snippet).toLowerCase();
    if (lowerText.includes('season') || lowerText.includes('series') || lowerText.includes('episode') || lowerText.includes('tv show') || lowerText.includes('电视剧') || lowerText.includes('剧集')) {
        type = MediaType.TV_SERIES;
    } else if (lowerText.includes('game') || lowerText.includes('游戏')) {
        type = MediaType.OTHER; // Games might be "Other" or new type, but let's stick to existing types
    } else if (lowerText.includes('book') || lowerText.includes('novel') || lowerText.includes('书籍') || lowerText.includes('小说')) {
        type = MediaType.BOOK;
    }

    return { title: cleanTitle, year, type };
};

const createFallbackItemsFromContext = async (searchContext: string, limit: number = 10): Promise<MediaItem[]> => {
    try {
        if (!searchContext || typeof searchContext !== 'string') return [];
        const trimmed = searchContext.trim();
        if (!trimmed || !(trimmed.startsWith('[') || trimmed.startsWith('{'))) return [];
        const arr = JSON.parse(trimmed);
        if (!Array.isArray(arr) || arr.length === 0) return [];
        
        const uniqueMap = new Map();
        arr.forEach((item: any) => {
            const { title, year } = processSearchResult(item.title || '', item.snippet || '');
            const key = `${title}|${year}`;
            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, item);
            }
        });
        
        const pick = Array.from(uniqueMap.values()).slice(0, limit);
        
        return pick.map((r: any) => {
            const { title, year, type } = processSearchResult(r.title || '', r.snippet || '');
            const id = uuidv4();
            return {
                id,
                title,
                directorOrAuthor: '',
                cast: [],
                description: r.snippet || '',
                releaseDate: year,
                type,
                isOngoing: type === MediaType.TV_SERIES,
                latestUpdateInfo: '',
                rating: '',
                posterUrl: getPlaceholder(type),
                userRating: 0,
                status: 'To Watch',
                addedAt: new Date().toISOString()
            } as MediaItem;
        });
    } catch (e) {
        console.debug("Fallback creation failed", e);
        return [];
    }
};

export const getTrendingMedia = async (): Promise<MediaItem[]> => {
  const { systemPrompt, trendingPrompt, provider } = useAIStore.getState();
  const dateObj = new Date();
  const today = dateObj.toISOString().split('T')[0];
  const currentYear = dateObj.getFullYear();
  const currentMonth = dateObj.getMonth() + 1;
  const monthStr = `${currentYear}年${currentMonth}月`;
  
  const isChinese = i18n.language.startsWith('zh');
  
  let searchContext = "";

  // 1. Perform Manual Search First (ONLY if no custom prompt is set)
    // If a custom prompt is set, we rely on the AI to call the search tool with relevant keywords
    if (!trendingPrompt || !trendingPrompt.trim()) {
        // Use Year+Month for broader hits, and specific "latest" keywords
        // Optimized to single query to save API quota
        const query = isChinese 
            ? `最新热门电影电视剧 ${monthStr}`
            : `trending movies tv shows ${monthStr} ${currentYear}`;

        try {
            // Search for the first query
            const searchResult = await performClientSideSearch(query, true);
            if (searchResult) {
                searchContext = searchResult;
            }
        } catch (e) {
            console.warn("Manual search in getTrendingMedia failed", e);
        }
    }

  

  let userPrompt = "";

  if (trendingPrompt && trendingPrompt.trim()) {
      userPrompt = trendingPrompt;
      userPrompt += isChinese 
        ? `\n\n[系统提示] 当前日期: ${today}。请优先使用提供的联网搜索工具 (web_search) 获取最新信息；若不可用，可先基于已有知识快速返回，再进行校验。`
        : `\n\n[System Note] Today's Date: ${today}. Prefer using the provided 'web_search' tool to fetch the latest information; if unavailable, return quickly based on internal knowledge and verify later.`;
  } else if (provider === 'moonshot') {
     // For Moonshot, we use our manual "web_search" tool
     searchContext = "";
     if (isChinese) {
         userPrompt = `今天是 ${today}。请推荐4部在最近2个月内更新或上映的热门电影、电视剧或动漫。
         
         [优先] 请优先使用提供的联网搜索工具 (web_search) 获取最新信息；若不可用，可先基于已有知识返回，再进行校验。请搜索关键词: "最新热门电影电视剧 ${monthStr}"。
         
         要求：
         1. 必须是 **最近2个月内** (例如 ${monthStr} 或上个月) 有更新或上映的作品。
         2. **必须** 基于联网搜索结果进行推荐。
         3. 严禁推荐几年前的老片，除非它最近有新季度更新。
         4. releaseDate 字段必须准确。如果是电视剧，请填写 **最新一季** 的首播日期。
         5. 返回字段中的 latestUpdateInfo 必须准确（例如 "第2季 第5集" 或 "已完结"）。
         6. 确保上映日期真实准确，不要捏造未来的日期，除非确有官方定档信息。`;
     } else {
         userPrompt = `Today is ${today}. Recommend 4 trending movies, TV series, or dramas that have been updated or released within the last 2 months.
         
         [PREFER] Prefer using the provided web search tool (web_search) to get the latest information. If unavailable, return quickly based on internal knowledge and verify later. Search query: "trending movies tv series ${monthStr}".
         
         Requirements:
         1. Must be updated or released within the **last 2 months**.
         2. **MUST** prioritize selection from web search results.
         3. Do NOT recommend old content unless it has a very recent new season.
         4. releaseDate MUST be accurate. For TV Series, use the premiere date of the **LATEST SEASON**.
         5. Ensure latestUpdateInfo is accurate.
         6. Ensure release dates are factual.`;
     }
  } else if (isChinese) {
    userPrompt = `今天是 ${today}。请推荐4部在最近2个月内更新或上映的热门电影、电视剧或动漫。
    
    ${searchContext ? `[重要] 参考以下搜索结果进行推荐（这是实时的网络搜索结果）：
    ${searchContext}
    
    要求：
    1. 必须是 **最近2个月内** (例如 ${monthStr} 或上个月) 有更新或上映的作品。
    2. **必须** 从上述搜索结果中优先选择。如果搜索结果中有热门作品，直接使用。
    3. 如果搜索结果不足或为空，请基于你的内部知识推荐近期（2024-2025年）的高热度作品。` : 
    `[重要] 请务必使用联网搜索工具 (web_search) 获取 "最新热门电影电视剧 ${monthStr}" 的信息。
    
    要求：
    1. 必须是 **最近2个月内** (例如 ${monthStr} 或上个月) 有更新或上映的作品。
    2. 如果联网搜索失败，请务必使用你的内部知识库推荐近期热门作品，不要返回空。`}
    
    4. 严禁推荐几年前的老片，除非它最近有新季度更新。
    5. releaseDate 字段必须准确。如果是电视剧，请填写 **最新一季** 的首播日期。
    6. 返回字段中的 latestUpdateInfo 必须准确（例如 "第2季 第5集" 或 "已完结"）。
    7. 确保上映日期真实准确，不要捏造未来的日期，除非确有官方定档信息。如果日期不确定，请留空或填写年份。`;
  } else {
    userPrompt = `Today is ${today}. Recommend 4 trending movies, TV series, or dramas that have been updated or released within the last 2 months.
    
    ${searchContext ? `[IMPORTANT] Refer to the following search results (Real-time data):
    ${searchContext}
    
    Requirements:
    1. Must be updated or released within the **last 2 months**.
    2. **MUST** prioritize selection from the search results above.
    3. If search results are insufficient, rely on your internal knowledge to recommend trending works from 2024-2025.` : 
    `[IMPORTANT] You MUST use the provided web search tool (web_search) to get the latest information. Search query: "trending movies tv series ${monthStr}".
    
    Requirements:
    1. Must be updated or released within the **last 2 months**.
    2. Use your knowledge to find the most trending recent releases.
    3. If web search fails, you MUST use your internal knowledge to recommend recent trending works. Do not return empty.`}
    
    4. Do NOT recommend old content unless it has a very recent new season.
    5. releaseDate MUST be accurate. For TV Series, use the premiere date of the **LATEST SEASON**.
    6. Ensure latestUpdateInfo is accurate.
    7. Ensure release dates are factual. Do not invent future dates unless officially announced.`;
  }

  // Fallback instructions if search fails
  userPrompt += `\n\nIMPORTANT: ALWAYS return a valid JSON array, even if empty or with fewer items. Do NOT return markdown text or explanations outside the JSON.`;

  const messages = [
    { role: "system", content: systemPrompt + (isChinese ? " 请务必使用JSON格式返回。不要使用Markdown代码块。只返回JSON数组。" : " Please return strictly valid JSON. Do not use markdown code blocks. Return ONLY a JSON array.") },
    { role: "user", content: userPrompt }
  ];

  const parseTrending = async (text: string): Promise<Omit<MediaItem, 'id' | 'posterUrl'>[]> => {
      if (!text) return [];
      let jsonStr = "";
      const jsonArrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonArrayMatch) {
          jsonStr = jsonArrayMatch[0];
      } else {
          jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
      }
      if (!jsonStr.startsWith('[') && !jsonStr.startsWith('{')) return [];
      try {
          const parsed = JSON.parse(jsonStr);
          return Array.isArray(parsed) ? parsed : [];
      } catch {
          const lastBracket = jsonStr.lastIndexOf('}');
          if (lastBracket > 0) {
              try {
                  const recovered = jsonStr.substring(0, lastBracket + 1) + ']';
                  const parsed = JSON.parse(recovered);
                  return Array.isArray(parsed) ? parsed : [];
              } catch {
                  return [];
              }
          }
          return [];
      }
  };

  const text = await callAI(messages, 0.1, { forceSearch: true }); 
  let rawData = await parseTrending(text || "");
  if (rawData.length > 4) rawData = rawData.slice(0, 4);
  if (rawData.length < 4 && searchContext) {
      try {
          const fb = await createFallbackItemsFromContext(searchContext, 4);
          const uniq = new Map<string, Omit<MediaItem, 'id' | 'posterUrl'>>();
          for (const it of rawData) {
              if (it && (it as any).title) uniq.set(String((it as any).title).toLowerCase(), it);
          }
          for (const it of fb) {
              if (!it || !it.title) continue;
              const k = it.title.toLowerCase();
              if (!uniq.has(k)) {
                  const { id, posterUrl, ...rest } = it as any;
                  uniq.set(k, rest as any);
              }
              if (uniq.size >= 4) break;
          }
          rawData = Array.from(uniq.values()).slice(0, 4);
      } catch {}
  }

  // Enhance with IDs and Posters
  // Strategy: 
  // 1. Map rawData to MediaItems with placeholders.
  // 2. Fetch posters in parallel, but with a strict timeout to ensure the UI isn't blocked for too long.
  // 3. If a poster search times out, we fallback to the placeholder, allowing the text to show up.
  
  const results = rawData.map((item) => {
    const id = uuidv4();
    const placeholder = getPlaceholder(item.type || 'Media');
    return {
      ...item,
      id,
      posterUrl: placeholder,
      userRating: 0,
      status: 'To Watch',
      addedAt: new Date().toISOString()
    } as MediaItem;
  });

  if (results.length === 0) {
      return await createFallbackItemsFromContext(searchContext);
  }
  const norm = (v?: string) => String(v || '').trim();
  const isUnknownText = (v?: string) => {
      const s = norm(v);
      if (!s) return true;
      const low = s.toLowerCase();
      return low === 'unknown' || s === '未知' || low === 'n/a' || low === 'na' || s === '-';
  };
  const isFullDate = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(norm(v));
  const shouldEnrich = (it: MediaItem) => {
      if (!(it.type === MediaType.MOVIE || it.type === MediaType.TV_SERIES)) return false;
      const dateNeeded = !isFullDate(it.releaseDate);
      const directorNeeded = isUnknownText(it.directorOrAuthor);
      const descNeeded = isUnknownText(it.description) || norm(it.description).length < 60;
      const castNeeded = !it.cast || it.cast.length === 0;
      const posterNeeded = !it.posterUrl || it.posterUrl.includes('placehold.co') || it.posterUrl.includes('No+Image') || it.posterUrl.includes('Image+Error');
      return dateNeeded || directorNeeded || descNeeded || castNeeded || posterNeeded;
  };

  const toPatch = results.filter(shouldEnrich);
  if (toPatch.length === 0) return results;

  const byId = new Map(results.map(r => [r.id, r]));
  const queue = [...toPatch];

  const applyTMDBDetails = async (it: MediaItem) => {
      const tmdbType: 'movie' | 'tv' = it.type === MediaType.TV_SERIES ? 'tv' : 'movie';
      const candidates = await searchTMDB(it.title, tmdbType);
      if (!candidates || candidates.length === 0) return;

      const year = norm(it.releaseDate).slice(0, 4);
      const best = (year && /^\d{4}$/.test(year))
          ? candidates.find(c => (c.release_date || c.first_air_date || '').startsWith(year))
          : candidates[0];
      if (!best || typeof best.id !== 'number') return;

      let details = await getTMDBDetails(best.id, tmdbType, 'zh-CN');
      if (details && isUnknownText(details.overview)) {
          const en = await getTMDBDetails(best.id, tmdbType, 'en-US');
          if (en && !isUnknownText(en.overview)) details = { ...details, overview: en.overview };
      }
      if (!details) return;

      const patch: Partial<MediaItem> = {
          tmdbId: best.id,
          tmdbMediaType: tmdbType
      };

      const rel = norm(details.release_date || details.first_air_date);
      if (rel && !isFullDate(it.releaseDate)) patch.releaseDate = rel;

      if (isUnknownText(it.directorOrAuthor)) {
          if (tmdbType === 'movie') {
              const crew = Array.isArray(details.credits?.crew) ? details.credits.crew : [];
              const directors = crew
                  .filter((c: any) => c && c.name && (c.job === 'Director' || String(c.job || '').toLowerCase().includes('director')))
                  .map((c: any) => String(c.name));
              if (directors.length > 0) patch.directorOrAuthor = directors.slice(0, 2).join(' / ');
          } else {
              const createdBy = Array.isArray(details.created_by) ? details.created_by : [];
              const creators = createdBy.filter((c: any) => c && c.name).map((c: any) => String(c.name));
              if (creators.length > 0) patch.directorOrAuthor = creators.slice(0, 2).join(' / ');
          }
      }

      const overview = norm(details.overview);
      if (overview && (isUnknownText(it.description) || norm(it.description).length < 60)) patch.description = overview;

      if (!it.cast || it.cast.length === 0) {
          const cast = Array.isArray(details.credits?.cast) ? details.credits.cast : [];
          const names = cast.filter((c: any) => c && c.name).map((c: any) => String(c.name)).slice(0, 5);
          if (names.length > 0) patch.cast = names;
      }

      const poster = getTMDBPosterUrl(details.poster_path) || undefined;
      if (poster && (!it.posterUrl || it.posterUrl.includes('placehold.co') || it.posterUrl.includes('No+Image') || it.posterUrl.includes('Image+Error'))) {
          patch.posterUrl = poster;
      }

      if (Object.keys(patch).length <= 2) return;
      byId.set(it.id, { ...it, ...patch });
  };

  const worker = async () => {
      while (queue.length > 0) {
          const it = queue.shift();
          if (!it) return;
          try { await applyTMDBDetails(it); } catch {}
      }
  };

  await Promise.all([worker(), worker()]);

  const afterTmdb = results.map(r => byId.get(r.id) || r);
  const isPosterPlaceholder = (u?: string) => {
      const s = String(u || '').trim().toLowerCase();
      if (!s) return true;
      if (s.includes('placehold.co')) return true;
      if (s.includes('no+image')) return true;
      if (s.includes('image+error')) return true;
      if (s.includes('m.media-amazon.com')) return true;
      if (s.includes('i.ebayimg.com') || s.includes('ebayimg.com')) return true;
      return false;
  };

  const typeToPosterQuery = (t: MediaType) => {
      switch (t) {
          case MediaType.TV_SERIES: return 'tv series';
          case MediaType.SHORT_DRAMA: return 'short drama';
          case MediaType.BOOK: return 'book';
          case MediaType.COMIC: return 'comic';
          case MediaType.MUSIC: return 'music';
          case MediaType.MOVIE:
          default:
              return 'movie';
      }
  };

  const withTimeout = async <T,>(p: Promise<T>, ms: number): Promise<T | undefined> => {
      let timer: any = null;
      try {
          return await Promise.race([
              p,
              new Promise<T | undefined>((resolve) => {
                  timer = setTimeout(() => resolve(undefined), ms);
              })
          ]);
      } finally {
          if (timer) clearTimeout(timer);
      }
  };

  const needPoster = afterTmdb.filter(it => isPosterPlaceholder(it.posterUrl));
  if (needPoster.length === 0) return afterTmdb;

  const patched = new Map(afterTmdb.map(r => [r.id, r]));
  await Promise.all(
      needPoster.map(async (it) => {
          try {
              const year = norm(it.releaseDate).slice(0, 4);
              const poster = await withTimeout(
                  fetchPosterFromSearch(it.title, year, typeToPosterQuery(it.type)),
                  9000
              );
              if (poster) patched.set(it.id, { ...it, posterUrl: poster });
          } catch {}
      })
  );

  return afterTmdb.map(r => patched.get(r.id) || r);
};

export const getAIDate = async (): Promise<string> => {
    const today = new Date().toISOString().split('T')[0];
    const currentLang = i18n.language.split('-')[0]; // 'en' or 'zh'
    const cacheKeyDate = `media_tracker_ai_date_${currentLang}`;
    const cacheKeyContent = `media_tracker_ai_date_content_${currentLang}`;
    
    const cachedDate = localStorage.getItem(cacheKeyDate);
    const cachedContent = localStorage.getItem(cacheKeyContent);

    if (cachedDate === today && cachedContent) {
        console.log("[getAIDate] Using cached date:", cachedContent);
        return cachedContent;
    }

    const isChinese = currentLang === 'zh';
    const systemPrompt = isChinese ? "你是一个报时助手。" : "You are a time announcement assistant.";
    const userPrompt = isChinese 
        ? `今天是 ${today}。请告诉我今天的日期，并附带一句简短的关于电影或生活的美好寄语（20字以内）。格式：YYYY年MM月DD日 | 寄语`
        : `Today is ${today}. Please tell me today's date followed by a very short inspiring quote about movies or life (max 10 words). Format: YYYY-MM-DD | Quote`;

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
    ];

    try {
        console.log("[getAIDate] Calling AI...");
        const text = await callAI(messages, 0.7);
        if (text) {
            const cleanText = text.replace(/"/g, '').trim();
            console.log("[getAIDate] Success:", cleanText);
            localStorage.setItem(cacheKeyDate, today);
            localStorage.setItem(cacheKeyContent, cleanText);
            return cleanText;
        }
    } catch (e) {
        console.warn("[getAIDate] Failed to get AI date", e);
    }
    
    return today;
};
