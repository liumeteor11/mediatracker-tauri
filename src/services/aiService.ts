import OpenAI from "openai";
import { MediaType, MediaItem } from "../types/types";
import { v4 as uuidv4 } from 'uuid';
import { useAIStore } from "../store/useAIStore";
import i18n from '../i18n';
import { invoke } from "@tauri-apps/api/core";

// Define Window interface to include Tauri API check
declare global {
  interface Window {
    __TAURI__?: any;
  }
}

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

const OMDB_API_KEY = import.meta.env.VITE_OMDB_API_KEY;

// A curated list of placeholders to serve as "Posters" when real ones aren't found
const getPlaceholder = (type: string = 'Media') => {
  return `https://placehold.co/600x900/1a1a1a/FFF?text=${encodeURIComponent(type)}`;
};

const prefetchedImages = new Map<string, string>();

const fetchPosterFromOMDB = async (title: string, year: string): Promise<string | undefined> => {
  if (!OMDB_API_KEY) return undefined;

  try {
    const cleanYear = year ? year.split('-')[0].trim() : '';
    const url = `https://www.omdbapi.com/?t=${encodeURIComponent(title)}&y=${cleanYear}&apikey=${OMDB_API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (data.Response === "True" && data.Poster && data.Poster !== "N/A") {
      return data.Poster;
    }
  } catch (error) {
    console.warn(`Failed to fetch poster for ${title} from OMDB`, error);
  }
  return undefined;
};

export const performClientSideSearch = async (query: string, force: boolean = false): Promise<string> => {
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
                searchProvider === 'yandex' ? getDecryptedYandexKey() : undefined,
        cx: googleSearchCx,
        user: yandexSearchLogin
    };

    try {
        const isChinese = i18n.language.startsWith('zh');
        const shortOrNumeric = query.trim().length < 3 || /^[0-9\s]+$/.test(query.trim());
        let q = query;
        if (shortOrNumeric) {
            q = isChinese 
                ? `${query} 电影 OR 电视剧 OR 小说 OR 漫画 OR 专辑 -新闻 -评测 -发布会 -价格 -手机 -iPhone -Apple -三星 -华为`
                : `${query} movie OR tv series OR novel OR comic OR album -news -review -price -iphone -apple -samsung -huawei`;
        }
        const isMediaCandidate = (title: string, snippet: string): boolean => {
            const text = `${title} ${snippet}`.toLowerCase();
            const positives = isChinese 
                ? ['电影','电视剧','短剧','漫画','小说','书籍','专辑','音乐','原声','ost']
                : ['movie','film','tv series','season','episode','novel','book','comic','manga','album','music','soundtrack','ost'];
            const negatives = ['iphone','apple','samsung','huawei','vs','review','price','spec','launch','press','event','news','新闻','发布会','评测','开箱','手机','参数','报价','rumor','快讯'];
            return positives.some(k => text.includes(k)) && !negatives.some(k => text.includes(k));
        };

        // Tauri Mode
        if (window.__TAURI__) {
            try {
                // Map config to Rust struct naming conventions
                const { useSystemProxy, getProxyUrl } = useAIStore.getState();
                const rustConfig = {
                    provider: searchProvider,
                    api_key: searchConfig.apiKey,
                    cx: googleSearchCx,
                    user: yandexSearchLogin,
                    search_type: "text",
                    proxy_url: getProxyUrl(),
                    use_system_proxy: useSystemProxy
                };
                
                const resultStr = await invoke<string>("web_search", { query, config: rustConfig });
                return resultStr; // Rust returns JSON string directly
            } catch (tauriError) {
                console.error("Tauri search failed:", tauriError);
                return "[]";
            }
        }
        
        // Web Mode (Limited)
        if (searchProvider === 'google') {
            const apiKey = getDecryptedGoogleKey();
            if (apiKey && googleSearchCx) {
            const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${googleSearchCx}&q=${encodeURIComponent(q)}`;
            const res = await fetchWithTimeout(url, { timeoutMs: 12000 });
            if (res.ok) {
                const data = await res.json();
                if (data.items) {
                    const mapped = data.items.map((item: any) => ({
                        title: item.title,
                        snippet: item.snippet,
                        link: item.link,
                        image: item.pagemap?.cse_image?.[0]?.src
                    })).filter((it: any) => isMediaCandidate(it.title, it.snippet)).slice(0, 5);
                    if (mapped.length > 0) return JSON.stringify(mapped);
                }
            }
        }
    }

    // Serper (Web Mode)
    if (searchProvider === 'serper') {
        const apiKey = getDecryptedSerperKey();
        if (apiKey) {
            const response = await fetchWithTimeout('https://google.serper.dev/search', {
                method: 'POST',
                headers: {
                    'X-API-KEY': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ q })
            , timeoutMs: 12000 });

            if (response.ok) {
                const data = await response.json();
                if (data.organic) {
                        const mapped = data.organic.map((item: any) => ({
                            title: item.title,
                            snippet: item.snippet,
                            link: item.link,
                            image: undefined // Serper organic usually doesn't have image
                        })).filter((it: any) => isMediaCandidate(it.title, it.snippet)).slice(0, 5);
                        if (mapped.length > 0) return JSON.stringify(mapped);
                }
            }
        }
    }

    try {
        const res = await fetchWithTimeout(`https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&utf8=&format=json&origin=*`, { timeoutMs: 8000 });
        if (res.ok) {
            const data = await res.json();
            const items = Array.isArray(data?.query?.search) ? data.query.search.slice(0, 5).map((s: any) => ({
                title: s.title,
                snippet: (s.snippet || '').replace(/<[^>]+>/g, ''),
                link: `https://zh.wikipedia.org/wiki/${encodeURIComponent(s.title)}`,
                image: undefined
            })).filter((it: any) => isMediaCandidate(it.title, it.snippet)) : [];
            if (items.length > 0) return JSON.stringify(items);
        }
    } catch {}
    
        
    } catch (e) {
        console.warn("Search failed", e);
    }
    return "";
};

const callAI = async (messages: any[], temperature: number = 0.7, options: { forceSearch?: boolean } = {}): Promise<string> => {
    const state = useAIStore.getState();
    const { 
        provider,
        baseUrl: baseURL, 
        model, 
        enableSearch,
        searchProvider,
        getDecryptedGoogleKey,
        googleSearchCx,
        getDecryptedSerperKey,
        getDecryptedYandexKey,
        yandexSearchLogin
    } = state;

    // Decrypt the API Key
    let apiKey = state.getDecryptedApiKey();

    // Fallback to env var if not set in store (Development convenience)
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

    // Proxy handling for Web Mode to avoid CORS (only in local dev)
    const isLocalDev = typeof window !== 'undefined' && /^https?:\/\/(localhost|127\.|0\.0\.0\.0)/.test(window.location.origin || '');
    if (!isTauri && isLocalDev && finalBaseURL.includes('api.moonshot.cn')) {
        finalBaseURL = `${window.location.origin}/api/moonshot/v1`;
    } else if (!isTauri && isLocalDev && finalBaseURL.startsWith('/')) {
        finalBaseURL = `${window.location.origin}${finalBaseURL}`;
    }

    // Abstract the "completion" call
    const createCompletion = async (msgs: any[], tools: any[]) => {
        if (isTauri) {
             const { useSystemProxy, getProxyUrl } = useAIStore.getState();
            const rustConfig = {
                model,
                baseURL: finalBaseURL,
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
                baseURL: finalBaseURL,
                dangerouslyAllowBrowser: true
            });
            
            return await client.chat.completions.create({
                model: model || (provider === 'moonshot' ? "kimi-latest" : "gpt-3.5-turbo"),
                messages: msgs,
                temperature: temperature,
                tools: tools.length > 0 ? tools : undefined,
                tool_choice: tools.length > 0 ? "auto" : undefined,
            });
        }
    };

    try {
        // Define tools based on provider
        let tools: any[] = [];
        const shouldSearch = enableSearch || options.forceSearch;

        if (shouldSearch) {
            // Unified Search Tool Strategy
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
            
            // Retry logic with Semaphore and Exponential Backoff
            const MAX_RETRIES = 3;
            let attempt = 0;

            while (attempt < MAX_RETRIES) {
                try {
                    await apiLimiter.acquire();
                    try {
                         completion = await createCompletion(currentMessages, tools);
                    } finally {
                        apiLimiter.release();
                    }
                    break; // Success
                } catch (apiError: any) {
                    console.error(`AI Chat API failed (Attempt ${attempt + 1}/${MAX_RETRIES})`, apiError);
                    
                    if (apiError.status === 429) {
                        attempt++;
                        if (attempt < MAX_RETRIES) {
                            const delay = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, ...
                            console.warn(`Rate limit hit, waiting ${delay}ms...`);
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

            // If the model wants to call a tool
            const toolCalls = (message && (message.tool_calls || (message.function_call ? [{ type: 'function', id: 'fn', function: message.function_call }] : []))) || [];
            if (toolCalls && toolCalls.length > 0) {
                currentMessages.push(message); // Add assistant's tool call message

                // Execute tool calls
                for (const toolCall of toolCalls) {
                    if (toolCall.type === 'function' && toolCall.function.name === '$web_search') {
                        // For Kimi's $web_search, we simply echo the arguments back to the model
                        currentMessages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            name: "$web_search",
                            content: toolCall.function.arguments 
                        });
                        continue;
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
        return "";
    }
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

  let searchContext = "";
  try {
    searchContext = await performClientSideSearch(query, true);
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
          userPrompt += `\n[优先] 使用联网搜索工具 (web_search) 获取最新信息；如网络不可用，请基于以下候选搜索结果或已有知识返回有效 JSON：\n${searchContext}\n仅从可靠信息中选择并返回有效 JSON 数组。检查 metadata/pagemap 获取准确上映日期；若无匹配请返回空数组。`;
      } else {
          userPrompt = `Search for media works matching the query: "${query}".`;
          if (type && type !== 'All') {
              userPrompt += ` Strictly limit results to type: "${type}".`;
          } else {
              userPrompt += ` (books, movies, TV series, comics, short dramas)`;
          }
          userPrompt += `\n[Constraint] Only return works (novels, movies, TV series, short dramas, comics, music albums). Do NOT include news, product reviews, comparisons, specs, prices, or phone/electronics items.`;
          userPrompt += `\n[PREFER] Use the web search tool; if unavailable, rely on the following candidate search results or internal knowledge to return a valid JSON array:\n${searchContext}\nReturn ONLY a valid JSON array. Check metadata/pagemap for accurate dates. If nothing matches, return an empty array.`;
      }
  } else {
      // Standard prompt for other providers
      if (isChinese) {
          userPrompt = `搜索符合以下查询的媒体作品: "${query}"。`;
          if (type && type !== 'All') {
              userPrompt += ` 严格限制结果类型为: "${type}"。`;
          } else {
              userPrompt += ` (包括书籍、电影、电视剧、漫画、短剧)`;
          }
          userPrompt += `\n请利用你的联网搜索工具或参考以下搜索结果来获取准确信息：\n${searchContext}\n仅从搜索结果中选择并返回有效JSON数组。请仔细检查搜索结果中的 metadata/pagemap 信息以获取准确的上映日期。如果没有匹配项，请返回空数组。确保上映日期准确。`;
      } else {
          userPrompt = `Search for media works matching the query: "${query}".`;
          if (type && type !== 'All') {
              userPrompt += ` Strictly limit results to type: "${type}".`;
          } else {
              userPrompt += ` (books, movies, TV series, comics, short dramas)`;
          }
          userPrompt += `\nUse your web search tool or refer to the following search results to verify info:\n${searchContext}\nReturn ONLY a valid JSON array. Check metadata/pagemap for dates. If nothing matches, return an empty array. Ensure release dates are accurate.`;
      }
  }

  const messages = [
    { role: "system", content: systemPrompt + (isChinese ? " 请务必使用JSON格式返回。不要使用Markdown代码块。只返回JSON数组。" : " Please return strictly valid JSON. Do not use markdown code blocks. Return ONLY a JSON array.") },
    { role: "user", content: userPrompt }
  ];

  // Force search to allow the AI to verify dates if needed
  const text = await callAI(messages, 0.1, { forceSearch: true });
  if (!text) return [];

  // Improved JSON extraction
  let jsonStr = "";
  const jsonArrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (jsonArrayMatch) {
      jsonStr = jsonArrayMatch[0];
  } else {
      jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
  }

  let rawData: Omit<MediaItem, 'id' | 'posterUrl'>[] = [];

  // Quick check if it looks like JSON
  if (!jsonStr.startsWith('[') && !jsonStr.startsWith('{')) {
      console.warn("AI returned non-JSON response:", text);
      return [];
  }

  try {
      rawData = JSON.parse(jsonStr);
  } catch (e) {
      console.error("Failed to parse JSON:", e);
      // Attempt to recover if it's a truncated JSON array
      const lastBracket = jsonStr.lastIndexOf('}');
      if (lastBracket > 0) {
        try {
          const recovered = jsonStr.substring(0, lastBracket + 1) + ']';
          rawData = JSON.parse(recovered);
        } catch (retryError) {
          console.error("Failed to recover JSON:", retryError);
          return [];
        }
      } else {
        return [];
      }
  }

  const results = rawData.map((item) => {
    const id = uuidv4();
    const placeholder = getPlaceholder(item.type || 'Media');
    const posterUrl = prefetchedImages.get(item.title.toLowerCase()) || undefined;
    return {
      ...item,
      id,
      posterUrl: posterUrl || placeholder,
      userRating: 0,
      status: 'To Watch',
      addedAt: new Date().toISOString()
    } as MediaItem;
  });

  const allowedTypes = new Set(["Book","Movie","TV Series","Comic","Short Drama","Music"]);
  const negatives = ['iphone','apple','samsung','huawei','vs','review','price','spec','launch','press','event','news','新闻','发布会','评测','开箱','手机','参数','报价','rumor','快讯'];
  const filtered = results.filter(r => allowedTypes.has(r.type) && !negatives.some(k => (r.title + ' ' + (r.description || '')).toLowerCase().includes(k)));

  if (filtered.length === 0) {
      return await createFallbackItemsFromContext(searchContext);
  }
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
      `;
  } else {
      userPrompt = `Please check the latest status for: ${queryList}. 
      Provide the absolute latest episode/chapter as of today.
      Return a JSON array with objects containing:
      - title: string (exact match)
      - latestUpdateInfo: string (e.g. "Season 4 Episode 8" or "Chapter 1052")
      - isOngoing: boolean (true if still updating)
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

    if (!enableSearch) return undefined;
    
    if (searchProvider === 'yandex') {
        return undefined;
    }

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
        // Simplified: Title + Type Term only
        query = `${title} ${typeTerm}`; 
    } else {
        query = `"${title}" ${type} poster`;
    }
    
    // ...

    try {
        let results: any = [];

        // Tauri Mode
        if (window.__TAURI__) {
            try {
                const apiKey = searchProvider === 'google' ? getDecryptedGoogleKey() : 
                               searchProvider === 'serper' ? getDecryptedSerperKey() :
                               searchProvider === 'yandex' ? getDecryptedYandexKey() : undefined;

                const rustConfig = {
                    provider: searchProvider,
                    api_key: apiKey,
                    cx: googleSearchCx,
                    user: yandexSearchLogin,
                    search_type: "image"
                };
                
                const resultStr = await invoke<string>("web_search", { query, config: rustConfig });
                
                try {
                    const parsed = JSON.parse(resultStr);
                    if (Array.isArray(parsed)) {
                        results = parsed;
                    }
                } catch (e) {
                    console.error("Failed to parse Tauri search result", e);
                }
            } catch (tauriError) {
                console.error("Tauri search failed:", tauriError);
            }
        }
        else {
            // Web Mode
            if (searchProvider === 'google') {
                const apiKey = getDecryptedGoogleKey();
                if (apiKey && googleSearchCx) {
                    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${googleSearchCx}&q=${encodeURIComponent(query)}`;
                    const res = await fetchWithTimeout(url, { timeoutMs: 10000 });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.items) {
                            results = data.items.map((item: any) => ({
                                image: item.pagemap?.cse_image?.[0]?.src
                            }));
                        }
                    }
                }
            }
            
            // Serper (Web Mode)
            if (searchProvider === 'serper') {
                 const apiKey = getDecryptedSerperKey();
                 if (apiKey) {
                     try {
                        const response = await fetchWithTimeout('https://google.serper.dev/images', {
                            method: 'POST',
                            headers: {
                                'X-API-KEY': apiKey,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ q: query, num: 10 })
                        , timeoutMs: 12000 });
                        
                        if (response.status === 403) {
                             console.error("Serper API 403 Forbidden: Invalid API Key or Quota Exceeded.");
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
        }

        if (Array.isArray(results)) {
             // Filter for valid image URLs and avoid known blocking domains
             const validImage = results.find((r: any) => {
                 if (!r.image) return false;
                 const url = r.image.toLowerCase();
                 // Filter out social media pages that are not direct images
                 if (url.includes('instagram.com') || url.includes('facebook.com') || url.includes('twitter.com') || url.includes('x.com')) {
                     return false;
                 }
                 // Allow Pinterest as it often has good posters, but try to prefer others if possible?
                 // For now, let's allow it as it's better than nothing.
                 return true;
             });
             if (validImage) return validImage.image;
        }

        // Fallback: If localized search failed, try generic English search
        if (isChinese) {
            console.log(`Localized poster search failed for "${title}", trying generic search...`);
            // const genericQuery = `"${title}" ${type} poster high resolution`;
            // ... (Skipping full duplication for brevity)
        }

    } catch (e) {
        console.warn(`Failed to fetch poster from search for ${title}`, e);
    }

    // Final fallback: Try OMDB if available
    return await fetchPosterFromOMDB(title, year);
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
        
        // Deduplicate by title roughly
        const uniqueMap = new Map();
        arr.forEach((item: any) => {
            const { title } = processSearchResult(item.title || '', '');
            if (!uniqueMap.has(title)) {
                uniqueMap.set(title, item);
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
                isOngoing: type === 'TV Series',
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
      const searchQueries = isChinese 
          ? [`最新上映电影电视剧排行榜 ${monthStr}`, `最近热门影视作品推荐 ${currentYear}`]
          : [`new movie releases ${monthStr} ${currentYear}`, `best new tv shows ${monthStr} ${currentYear}`];

      try {
          // Search for the first query
          const searchResult = await performClientSideSearch(searchQueries[0], true);
          if (searchResult) {
              searchContext = searchResult;
          } else {
               // Fallback to second query if first returns nothing
               const secondResult = await performClientSideSearch(searchQueries[1], true);
               if (secondResult) searchContext = secondResult;
          }
      } catch (e) {
          console.warn("Manual search in getTrendingMedia failed", e);
      }
  }

  // AI Processing RE-ENABLED
  let prefetchedImages = new Map<string, string>();
  try {
      if (searchContext) {
          const parsedSC = JSON.parse(searchContext);
          if (Array.isArray(parsedSC)) {
              parsedSC.forEach((item: any) => {
                  if (item.title && item.image) {
                       prefetchedImages.set(item.title.toLowerCase(), item.image);
                       // Also store by cleaned title
                       const { title } = processSearchResult(item.title, item.snippet || "");
                       prefetchedImages.set(title.toLowerCase(), item.image);
                  }
              });
          } else {
              searchContext = "";
          }
      }
  } catch {
      searchContext = "";
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
    2. **必须** 从上述搜索结果中优先选择。如果搜索结果中有热门作品，直接使用。` : 
    `[重要] 请务必使用联网搜索工具 (web_search) 获取 "最新热门电影电视剧 ${monthStr}" 的信息。
    
    要求：
    1. 必须是 **最近2个月内** (例如 ${monthStr} 或上个月) 有更新或上映的作品。`}
    3. 如果搜索结果不足，请确保你推荐的作品确实是近期（2024-2025年）的高热度作品。
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
    2. **MUST** prioritize selection from the search results above.` : 
    `[IMPORTANT] You MUST use the provided web search tool (web_search) to get the latest information. Search query: "trending movies tv series ${monthStr}".
    
    Requirements:
    1. Must be updated or released within the **last 2 months**.
    2. Use your knowledge to find the most trending recent releases.`}
    3. If search results are insufficient, ensure recommendations are genuinely recent (2024-2025) and trending.
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

  const text = await callAI(messages, 0.1, { forceSearch: true }); 
  if (!text) {
    try {
      if (searchContext) {
        const fb = await createFallbackItemsFromContext(searchContext);
        if (fb.length > 0) return fb;
      }
    } catch {}
    return [];
  }

  // Improved JSON extraction
  let jsonStr = "";
  const jsonArrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (jsonArrayMatch) {
      jsonStr = jsonArrayMatch[0];
  } else {
      jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
  }

  let rawData: Omit<MediaItem, 'id' | 'posterUrl'>[] = [];

  // Quick check if it looks like JSON
  if (!jsonStr.startsWith('[') && !jsonStr.startsWith('{')) {
      const fb = await createFallbackItemsFromContext(searchContext);
      if (fb.length > 0) return fb;
      return [];
  }

  try {
      rawData = JSON.parse(jsonStr);
  } catch (e) {
      console.error("Failed to parse JSON:", e);
      // Attempt to recover if it's a truncated JSON array
      const lastBracket = jsonStr.lastIndexOf('}');
      if (lastBracket > 0) {
        try {
          const recovered = jsonStr.substring(0, lastBracket + 1) + ']';
          rawData = JSON.parse(recovered);
        } catch (retryError) {
          console.error("Failed to recover JSON:", retryError);
          return [];
        }
      } else {
        const fb = await createFallbackItemsFromContext(searchContext);
        if (fb.length > 0) return fb;
        return [];
      }
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
  return results;
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
