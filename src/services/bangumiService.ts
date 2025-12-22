import { useAIStore } from "../store/useAIStore";
import { invoke } from "@tauri-apps/api/core";

const isTauriEnv = typeof window !== 'undefined' && (
    '__TAURI__' in window ||
    '__TAURI_IPC__' in window ||
    (window as any).__TAURI_METADATA__ !== undefined
);

const BANGUMI_BASE_URL = 'https://api.bgm.tv';

export interface BangumiSubject {
    id: number;
    name: string;
    name_cn: string;
    summary: string;
    images: {
        large: string;
        common: string;
        medium: string;
        small: string;
        grid: string;
    };
    date: string; // Release date
    type: number; // 1: Book, 2: Anime, 3: Music, 4: Game, 6: Real (TV/Movie)
    score?: number;
}

export const searchBangumi = async (query: string, type?: number): Promise<BangumiSubject[]> => {
    try {
        const s = useAIStore.getState();
        const token = s.getDecryptedBangumiToken && s.getDecryptedBangumiToken();

        if (isTauriEnv) {
             const result = await invoke<string>('bangumi_search', { query, subjectType: type, token: token || null });
             const data = JSON.parse(result);
             return data.list || [];
        }

        let url = `${BANGUMI_BASE_URL}/search/subject/${encodeURIComponent(query)}?responseGroup=large`;
        if (type) {
            url += `&type=${type}`;
        }
        
        // Bangumi requires User-Agent: ProjectName/Version (Contact)
        const headers: Record<string, string> = {
            'User-Agent': 'MediaTracker-Rust/1.0 (https://github.com/yourrepo)',
            'Accept': 'application/json'
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`Bangumi Error: ${res.statusText}`);
        const data = await res.json();
        return data.list || [];
    } catch (error) {
        console.error("Bangumi Search Failed:", error);
        return [];
    }
};

export const getBangumiDetails = async (id: number): Promise<any> => {
    try {
        const s = useAIStore.getState();
        const token = s.getDecryptedBangumiToken && s.getDecryptedBangumiToken();

        if (isTauriEnv) {
             const result = await invoke<string>('bangumi_details', { id, token: token || null });
             return JSON.parse(result);
        }

        const url = `${BANGUMI_BASE_URL}/v0/subjects/${id}`;
        
        const headers: Record<string, string> = {
            'User-Agent': 'MediaTracker-Rust/1.0 (https://github.com/yourrepo)',
            'Accept': 'application/json'
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`Bangumi Error: ${res.statusText}`);
        return await res.json();
    } catch (error) {
        console.error("Bangumi Details Failed:", error);
        return null;
    }
};

export const testBangumiConnection = async (token?: string): Promise<{ ok: boolean; error?: string }> => {
    try {
        const headers: Record<string, string> = {
            'User-Agent': 'MediaTracker-Rust/1.0 (https://github.com/yourrepo)',
            'Accept': 'application/json'
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
            // If token provided, try to access user profile to verify token
            const url = `${BANGUMI_BASE_URL}/v0/me`;
            const res = await fetch(url, { headers });
            if (res.ok) {
                return { ok: true };
            } else {
                // If 401, token is invalid
                if (res.status === 401) {
                     return { ok: false, error: 'Invalid Access Token' };
                }
                 const data = await res.json().catch(() => ({}));
                 return { ok: false, error: data.description || res.statusText };
            }
        } else {
            // If no token, just test public search
            const url = `${BANGUMI_BASE_URL}/search/subject/test?responseGroup=small&max_results=1`;
            const res = await fetch(url, { headers });
            if (res.ok) {
                return { ok: true };
            } else {
                return { ok: false, error: res.statusText };
            }
        }
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};
