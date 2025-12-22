
import { useAIStore } from "../store/useAIStore";

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export interface TMDBMedia {
  id: number;
  title?: string;
  name?: string; // for TV
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string; // for TV
  media_type: 'movie' | 'tv' | 'person';
  genre_ids: number[];
  vote_average: number;
}

export const searchTMDB = async (query: string, type: 'movie' | 'tv' | 'multi' = 'multi'): Promise<TMDBMedia[]> => {
  const s = useAIStore.getState();
  const key = s.getDecryptedTmdbKey && s.getDecryptedTmdbKey();
  
  if (!key) {
    console.warn("TMDB API Key is missing");
    return [];
  }

  try {
    const url = `${TMDB_BASE_URL}/search/${type}?api_key=${key}&query=${encodeURIComponent(query)}&language=zh-CN&include_adult=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB Error: ${res.statusText}`);
    const data = await res.json();
    return data.results || [];
  } catch (error) {
    console.error("TMDB Search Failed:", error);
    return [];
  }
};

export const getTMDBDetails = async (id: number, type: 'movie' | 'tv'): Promise<any> => {
    const s = useAIStore.getState();
    const key = s.getDecryptedTmdbKey && s.getDecryptedTmdbKey();
    if (!key) return null;

    try {
        const url = `${TMDB_BASE_URL}/${type}/${id}?api_key=${key}&language=zh-CN&append_to_response=credits,images`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`TMDB Error: ${res.statusText}`);
        return await res.json();
    } catch (error) {
        console.error("TMDB Details Failed:", error);
        return null;
    }
};

export const testTmdbConnection = async (apiKey: string): Promise<{ ok: boolean; error?: string }> => {
    try {
        const url = `${TMDB_BASE_URL}/authentication/token/new?api_key=${apiKey}`;
        const res = await fetch(url);
        if (res.ok) {
            return { ok: true };
        } else {
            const data = await res.json();
            return { ok: false, error: data.status_message || res.statusText };
        }
    } catch (e: any) {
        return { ok: false, error: e.message };
    }
};

export const getTMDBPosterUrl = (path: string | null, size: 'w500' | 'original' = 'w500') => {
    if (!path) return null;
    return `https://image.tmdb.org/t/p/${size}${path}`;
};
