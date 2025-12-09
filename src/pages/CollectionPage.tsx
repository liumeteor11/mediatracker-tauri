import React, { useState, useEffect } from 'react';
import { useCollectionStore } from '../store/useCollectionStore';
import { MediaCard } from '../components/MediaCard';
import { CollectionCategory, MediaItem } from '../types/types';
import { Filter, Search as SearchIcon, X, Download, Upload, MoreHorizontal } from 'lucide-react';
import { toast } from 'react-toastify';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

export const CollectionPage: React.FC = () => {
  const { t } = useTranslation();
  const { collection, moveCategory, importCollection } = useCollectionStore();
  const [filter, setFilter] = useState<CollectionCategory | 'All'>('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
        case 'All': return t('search_page.filter_all');
        case 'To Watch': return t('dashboard.to_watch');
        case 'Watched': return t('dashboard.status_watched');
        case 'Favorites': return t('dashboard.status_favorites');
        default: return cat;
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedId(null);
        setShowMenu(false);
      }
    };
    
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const filteredCollection = collection.filter(item => {
    const matchesCategory = filter === 'All' || item.category === filter;
    const matchesSearch = item.title.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleMove = (item: MediaItem, category: CollectionCategory) => {
    moveCategory(item.id, category);
    toast.success(t('collection.moved_toast', { title: item.title, category: getCategoryLabel(category) }));
  };

  const handleExport = () => {
    if (collection.length === 0) {
      toast.info(t('collection.export_empty'));
      return;
    }
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(collection, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `media-collection-${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    toast.success(t('collection.export_success'));
    setShowMenu(false);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = event.target?.result as string;
        const items = JSON.parse(json);
        
        if (!Array.isArray(items)) {
          throw new Error("Invalid format");
        }

        // Basic validation
        const validItems = items.filter((item: any) => item.id && item.title && item.type);
        
        if (validItems.length === 0) {
           toast.error(t('collection.import_invalid'));
           return;
        }

        importCollection(validItems);
        toast.success(t('collection.import_success', { count: validItems.length }));
      } catch (error) {
        console.error('Import error:', error);
        toast.error(t('collection.import_error'));
      } finally {
        // Reset input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
        setShowMenu(false);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
            <h1 className="text-3xl font-bold text-theme-accent">{t('collection.title')}</h1>
            <p className="mt-1 text-theme-subtext">{t('collection.subtitle')}</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
             <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-subtext" />
                <input 
                    type="text" 
                    placeholder={t('collection.filter_placeholder')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 pr-4 py-2 rounded-lg border focus:ring-2 outline-none w-full sm:w-64 transition-all bg-theme-surface border-theme-border text-theme-text focus:border-theme-accent focus:ring-theme-accent/20 placeholder-theme-subtext"
                />
            </div>
            
            <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0 no-scrollbar">
                {(['All', ...Object.values(CollectionCategory)] as const).map((cat) => (
                    <button
                        key={cat}
                        onClick={() => setFilter(cat)}
                        className={clsx(
                          "px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors",
                          filter === cat 
                            ? "bg-theme-accent text-theme-bg"
                            : "bg-theme-surface border border-theme-border text-theme-text hover:bg-theme-bg"
                        )}
                    >
                        {getCategoryLabel(cat)}
                    </button>
                ))}
            </div>
            
            <div className="flex gap-2 items-center border-l border-theme-border pl-4 relative" ref={menuRef}>
               <button
                 onClick={() => setShowMenu(!showMenu)}
                 className="p-2 rounded-lg bg-theme-surface border border-theme-border text-theme-subtext hover:text-theme-accent hover:border-theme-accent transition-colors"
                 title={t('collection.import_export_tooltip')}
               >
                 <MoreHorizontal className="w-5 h-5" />
               </button>

               {showMenu && (
                 <div className="absolute right-0 top-full mt-2 w-48 bg-theme-surface border border-theme-border rounded-lg shadow-lg z-50 overflow-hidden">
                   <button
                     onClick={handleExport}
                     className="w-full text-left px-4 py-2 hover:bg-theme-bg transition-colors flex items-center gap-2 text-theme-text"
                   >
                     <Download className="w-4 h-4" />
                     {t('collection.export_tooltip')}
                   </button>
                   <button
                     onClick={() => fileInputRef.current?.click()}
                     className="w-full text-left px-4 py-2 hover:bg-theme-bg transition-colors flex items-center gap-2 text-theme-text"
                   >
                     <Upload className="w-4 h-4" />
                     {t('collection.import_tooltip')}
                   </button>
                 </div>
               )}

               <input
                 type="file"
                 ref={fileInputRef}
                 onChange={handleImport}
                 accept=".json"
                 className="hidden"
               />
            </div>
        </div>
      </div>

      {collection.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border border-dashed bg-theme-surface border-theme-border">
            <Filter className="w-12 h-12 mx-auto mb-4 text-theme-subtext" />
            <h3 className="text-lg font-medium text-theme-text">{t('collection.empty_title')}</h3>
            <p className="mb-6 text-theme-subtext">{t('collection.empty_text')}</p>
        </div>
      ) : (
        <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5 gap-y-8 gap-x-6">
            <AnimatePresence>
                {filteredCollection.map((item, index) => (
                    <MediaCard 
                        key={item.id} 
                        item={item} 
                        layoutId={item.id}
                        onClick={() => setSelectedId(item.id)}
                        onAction={handleMove}
                        index={index}
                        variant="collection"
                    />
                ))}
            </AnimatePresence>
        </motion.div>
      )}

      {filteredCollection.length === 0 && collection.length > 0 && (
          <div className="text-center py-12">
              <p className="text-theme-subtext">{t('collection.no_matches')}</p>
          </div>
      )}

      <AnimatePresence>
        {selectedId && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-[60] backdrop-blur-sm"
              onClick={() => setSelectedId(null)}
            />
            <div className="fixed inset-0 grid place-items-center z-[70] pointer-events-none p-4 md:p-8">
               <div className="pointer-events-auto h-[85vh] aspect-[1/1.48] shadow-2xl relative max-w-full">
                  {collection.find(item => item.id === selectedId) && (
                     <MediaCard
                        item={collection.find(item => item.id === selectedId)!}
                        layoutId={selectedId}
                        onAction={handleMove}
                        showActions={true}
                        className="w-full h-full"
                        variant="collection"
                     />
                  )}
                  <button
                    onClick={() => setSelectedId(null)}
                    className="absolute -top-12 right-0 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                  >
                    <X className="w-6 h-6" />
                  </button>
               </div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
