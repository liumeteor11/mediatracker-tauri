import React, { useState, useEffect, useMemo } from 'react';
import { Search, Loader2, TrendingUp, AlertCircle, RefreshCw, Edit, X, Save, RotateCcw } from 'lucide-react';
import { searchMedia, getTrendingMedia } from '../services/aiService';
import { MediaItem, CollectionCategory, MediaType } from '../types/types';
import { MediaCard } from '../components/MediaCard';
import { useCollectionStore } from '../store/useCollectionStore';
import { useAIStore } from '../store/useAIStore';
import { toast } from 'react-toastify';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

export const SearchPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { trendingPrompt, setConfig } = useAIStore();
  const [query, setQuery] = useState('');
  const [selectedType, setSelectedType] = useState<MediaType | 'All'>('All');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTrending, setIsTrending] = useState(true);
  
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [tempPrompt, setTempPrompt] = useState('');

  const { addToCollection } = useCollectionStore();

  const filters = useMemo(() => [
    { label: t('search_page.filter_all'), value: 'All' },
    { label: t('search_page.filter_movies'), value: MediaType.MOVIE },
    { label: t('search_page.filter_tv'), value: MediaType.TV_SERIES },
    { label: t('search_page.filter_books'), value: MediaType.BOOK },
    { label: t('search_page.filter_comics'), value: MediaType.COMIC },
    { label: t('search_page.filter_short_dramas'), value: MediaType.SHORT_DRAMA },
    { label: t('search_page.filter_music'), value: MediaType.MUSIC },
    { label: t('search_page.filter_other'), value: MediaType.OTHER },
  ], [t]);

  useEffect(() => {
    loadTrending();
  }, []);

  const loadTrending = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    
    try {
      // 1. Check local storage if not forcing refresh
      if (!forceRefresh) {
        const cachedData = localStorage.getItem('media_tracker_trending_data');
        const cachedTs = localStorage.getItem('media_tracker_trending_ts');
        
        if (cachedData && cachedTs) {
            const now = Date.now();
            const lastRefresh = parseInt(cachedTs, 10);
            const sevenDays = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
            
            if (now - lastRefresh < sevenDays) {
                try {
                    const parsedData = JSON.parse(cachedData);
                    if (Array.isArray(parsedData) && parsedData.length > 0) {
                         setResults(parsedData);
                         setIsTrending(true);
                         setLoading(false);
                         return;
                    }
                } catch (e) {
                    console.error("Cache parse error", e);
                }
            }
        }
      }

      // 2. Fetch new data
      const trending = await getTrendingMedia();
      
      // 3. Save to local storage
      if (trending.length > 0) {
        setResults(trending);
        setIsTrending(true);
        localStorage.setItem('media_tracker_trending_data', JSON.stringify(trending));
        localStorage.setItem('media_tracker_trending_ts', Date.now().toString());
        if (forceRefresh) {
             toast.success(t('search_page.trending_updated'));
        }
      } else {
         const cachedData = localStorage.getItem('media_tracker_trending_data');
         if (cachedData) {
            try {
                const parsedData = JSON.parse(cachedData);
                if (Array.isArray(parsedData) && parsedData.length > 0) {
                    setResults(parsedData);
                    setIsTrending(true);
                    if (forceRefresh) toast.error(t('search_page.trending_refresh_failed'));
                } else {
                    if (forceRefresh) setError(t('search_page.trending_refresh_failed'));
                }
            } catch {
                if (forceRefresh) setError(t('search_page.trending_refresh_failed'));
            }
         } else {
            if (forceRefresh) setError(t('search_page.trending_refresh_failed'));
         }
      }
      
    } catch (err) {
      setError(t('search_page.trending_load_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setIsTrending(false);
    
    try {
      const data = await searchMedia(query, selectedType);
      setResults(data);
      if (data.length === 0) {
        setError(t('search_page.no_results_found'));
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`${t('search_page.search_error')} ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const onAddToCollection = (item: MediaItem, category: CollectionCategory) => {
    addToCollection(item, category);
    toast.success(t('search_page.added_to_collection', { title: item.title, category }));
  };

  const openPromptModal = () => {
      if (trendingPrompt && trendingPrompt.trim()) {
          setTempPrompt(trendingPrompt);
      } else {
          setTempPrompt(t('search_page.default_prompt'));
      }
      setIsPromptModalOpen(true);
  };

  const savePrompt = async () => {
      let finalPrompt = tempPrompt;
      
      // Removed translation logic as requested
      setConfig({ trendingPrompt: finalPrompt });
      setIsPromptModalOpen(false);
      toast.success(t('common.save_success') || "Saved");
      // Reload trending with new prompt
      loadTrending(true);
  };

  const restoreDefault = () => {
      // Set empty to clear custom prompt
      setTempPrompt('');
      // Also update the textarea visual to the default text immediately so they see what "Default" means? 
      // No, standard behavior for "Restore Default" in a modal is usually to reset the form value to the default value.
      // Here the "default value" for the CONFIG is "", but the visual representation is the default text.
      // Let's set it to the default text, but if they save, we should maybe save ""?
      // Actually, saving the default text explicitly is fine too.
      // But to be cleaner, let's just set it to the default text.
      setTempPrompt(t('search_page.default_prompt'));
  };

  return (
    <div className="space-y-8 relative">
       {/* Spotlight Effect */}
       <div className="absolute top-[-100px] left-1/2 transform -translate-x-1/2 w-[600px] h-[600px] rounded-full blur-[100px] opacity-30 pointer-events-none bg-theme-accent" />

      {/* Search Header */}
      <div className="text-center mb-12 space-y-6 relative z-10">
        <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-theme-accent to-theme-accent-hover">
          {t('search_page.title')}
        </h1>
        <p className="text-lg max-w-2xl mx-auto text-theme-subtext">
          {t('search_page.subtitle')}
        </p>
        
        <form onSubmit={handleSearch} className="max-w-xl mx-auto relative group">
          <div className="absolute -inset-0.5 rounded-full blur opacity-30 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 bg-gradient-to-r from-theme-accent to-theme-accent-hover"></div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search_page.input_placeholder')}
            className="relative w-full pl-12 pr-32 py-4 rounded-full border-2 focus:outline-none focus:ring-2 shadow-xl text-lg transition-all bg-theme-surface border-theme-border text-theme-text focus:border-theme-accent focus:ring-theme-accent/20 placeholder-theme-subtext"
          />
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-6 h-6 text-theme-subtext" />
          <button 
            type="submit"
            disabled={loading || !query.trim()}
            className="absolute right-2 top-2 bottom-2 px-6 rounded-full font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 bg-theme-accent text-theme-bg hover:bg-theme-accent-hover hover:shadow-lg"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('search_page.search_btn')}
          </button>
        </form>

        <div className="flex flex-wrap justify-center gap-2 mt-6 max-w-2xl mx-auto">
          {filters.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setSelectedType(filter.value as MediaType | 'All')}
              className={clsx(
                "px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 border",
                selectedType === filter.value
                  ? "bg-theme-accent text-theme-bg border-theme-accent shadow-md"
                  : "bg-theme-surface text-theme-subtext border-theme-border hover:border-theme-accent/50 hover:text-theme-text"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results Section */}
      <div className="space-y-6">
        <div className="flex items-center gap-2 mb-6 border-b pb-4 border-theme-border">
            {isTrending ? (
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2 font-bold text-xl text-theme-accent">
                        <TrendingUp className="w-6 h-6" />
                        <h2>{t('search_page.trending_title')}</h2>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        <button
                            onClick={openPromptModal}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all bg-theme-surface text-theme-text border border-theme-border hover:bg-theme-bg"
                            title={t('search_page.edit_prompt')}
                        >
                            <Edit className="w-4 h-4" />
                            <span className="hidden sm:inline">{t('search_page.edit_prompt')}</span>
                        </button>

                        <button
                            onClick={() => loadTrending(true)}
                            disabled={loading}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all bg-theme-surface text-theme-accent hover:bg-theme-bg disabled:opacity-50"
                            title={t('search_page.refresh_tooltip')}
                        >
                            <RefreshCw className={clsx("w-4 h-4", loading && "animate-spin")} />
                            <span>{loading ? t('search_page.refreshing') : t('search_page.refresh')}</span>
                        </button>
                    </div>
                </div>
            ) : (
                <h2 className="text-xl font-bold text-theme-text">
                    {results.length > 0 ? `${t('search_page.results_for')} "${query}"` : ''}
                </h2>
            )}
        </div>

        {error && (
            <div className="flex items-center justify-center p-8 rounded-xl border text-red-600 bg-red-50 border-red-100">
                <AlertCircle className="w-6 h-6 mr-2" />
                {error}
            </div>
        )}

        {loading ? (
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-xl aspect-[1/1.48] animate-pulse border p-4 bg-theme-surface border-theme-border">
                    <div className="w-full h-2/3 rounded-lg mb-4 bg-theme-bg"></div>
                    <div className="h-4 rounded w-3/4 mb-2 bg-theme-bg"></div>
                    <div className="h-4 rounded w-1/2 bg-theme-bg"></div>
                </div>
              ))}
           </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-y-8 gap-x-6">
            {results.map((item, index) => (
              <MediaCard 
                key={item.id} 
                item={item} 
                onAction={onAddToCollection}
                index={index}
              />
            ))}
          </div>
        )}
      </div>

      {/* Edit Prompt Modal */}
      {isPromptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-theme-surface border border-theme-border rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b border-theme-border">
                <h3 className="text-lg font-bold text-theme-text">{t('search_page.prompt_modal_title')}</h3>
                <button onClick={() => setIsPromptModalOpen(false)} className="p-1 hover:bg-theme-bg rounded-full transition-colors">
                <X className="w-5 h-5 text-theme-subtext" />
                </button>
            </div>
            
            <div className="p-4 flex-1 overflow-y-auto">
                <textarea
                value={tempPrompt}
                onChange={(e) => setTempPrompt(e.target.value)}
                className="w-full h-64 p-3 rounded-lg bg-theme-bg border border-theme-border text-theme-text focus:ring-2 focus:ring-theme-accent focus:border-transparent resize-none font-mono text-sm"
                placeholder={t('search_page.prompt_placeholder')}
                />
            </div>

            <div className="p-4 border-t border-theme-border flex justify-between items-center bg-theme-surface rounded-b-xl">
                <button
                onClick={restoreDefault}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-theme-subtext hover:text-theme-text hover:bg-theme-bg transition-colors"
                >
                <RotateCcw className="w-4 h-4" />
                {t('search_page.restore_default')}
                </button>
                <div className="flex gap-2">
                    <button
                    onClick={() => setIsPromptModalOpen(false)}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-theme-text hover:bg-theme-bg transition-colors"
                    >
                    {t('common.cancel')}
                    </button>
                    <button
                    onClick={savePrompt}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-theme-accent text-theme-bg hover:bg-theme-accent-hover transition-colors"
                    >
                    <Save className="w-4 h-4" />
                    {t('search_page.save_prompt')}
                    </button>
                </div>
            </div>
            </div>
        </div>
        )}
    </div>
  );
};
