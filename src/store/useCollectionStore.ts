import { create } from 'zustand';
import { MediaItem, CollectionCategory } from '../types/types';
import { fetchCover } from '../services/coverService';
import { invoke } from '@tauri-apps/api/core';
import { useAuthStore } from './useAuthStore';
import { v4 as uuidv4 } from 'uuid';

const isTauri = typeof window !== 'undefined' && (('__TAURI__' in window) || ('__TAURI_INTERNALS__' in window));

interface CollectionState {
  collection: MediaItem[];
  isLoading: boolean;
  initialized: boolean;
  initialize: () => Promise<void>;
  addToCollection: (item: MediaItem, category: CollectionCategory) => void;
  removeFromCollection: (id: string) => void;
  updateItem: (id: string, updates: Partial<MediaItem>) => void;
  moveCategory: (id: string, category: CollectionCategory) => void;
  createCollection: (primaryItem: MediaItem, selectedItems: MediaItem[]) => void;
  importCollection: (items: MediaItem[]) => void;
  reorderCollection: (newOrder: MediaItem[]) => void;
  exportCollection: (targetDir?: string, redactSensitive?: boolean) => Promise<string | null>;
  getStats: () => { total: number; watched: number; toWatch: number; favorites: number };
  refreshForUser: () => Promise<void>;
  clear: () => void;
}

export const useCollectionStore = create<CollectionState>((set, get) => ({
  collection: [],
  isLoading: false,
  initialized: false,

  initialize: async () => {
    if (get().initialized) return;
    set({ isLoading: true });
    try {
        if (isTauri) {
            const username = useAuthStore.getState().user?.username || 'guest';
            const items = await invoke<MediaItem[]>('get_collection', { username });
            set({ collection: items, initialized: true, isLoading: false });
        } else {
            // Fallback to localStorage for Web Mode
            const saved = localStorage.getItem('media-tracker-collection');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    // Handle zustand persist structure { state: { collection: [...] }, version: 0 }
                    if (parsed.state && Array.isArray(parsed.state.collection)) {
                        set({ collection: parsed.state.collection, initialized: true, isLoading: false });
                    } else {
                         set({ collection: [], initialized: true, isLoading: false });
                    }
                } catch (e) {
                    console.error("Failed to load local storage", e);
                    set({ collection: [], initialized: true, isLoading: false });
                }
            } else {
                 set({ collection: [], initialized: true, isLoading: false });
            }
        }
    } catch (e) {
        console.error("Failed to initialize collection store", e);
        set({ isLoading: false });
    }
  },

  refreshForUser: async () => {
    set({ initialized: false });
    await get().initialize();
  },

  clear: () => {
    set({ collection: [], initialized: false });
  },

  importCollection: (items) => {
      // Optimistic update
      set((state) => {
        const existingIds = new Set(state.collection.map(i => i.id));
        const newItems = items.filter(i => !existingIds.has(i.id));
        const updatedCollection = [...newItems, ...state.collection];
        
        // Persist
        if (isTauri) {
            const username = useAuthStore.getState().user?.username || 'guest';
            invoke('import_collection', { username, items: newItems }).catch(console.error);
        } else {
            localStorage.setItem('media-tracker-collection', JSON.stringify({ state: { collection: updatedCollection }, version: 0 }));
        }
        
        return { collection: updatedCollection };
      });
  },

  reorderCollection: (newOrder) => {
      set({ collection: newOrder });
      
      if (isTauri) {
          const username = useAuthStore.getState().user?.username || 'guest';
          const ids = newOrder.map(i => i.id);
          invoke('reorder_collection', { username, ids }).catch(console.error);
      } else {
          localStorage.setItem('media-tracker-collection', JSON.stringify({ state: { collection: newOrder }, version: 0 }));
      }
  },

  exportCollection: async (targetPath?: string, redactSensitive: boolean = true) => {
    try {
      if (!isTauri) {
        console.warn('Export not available in web preview');
        return null;
      }
      const username = useAuthStore.getState().user?.username || 'guest';
      const path = await invoke<string>('export_collection', { username, targetPath, redactSensitive });
      return path;
    } catch (e) {
      console.error('Export collection failed', e);
      return null;
    }
  },

  addToCollection: (item, category) => {
    set((state) => {
        const exists = state.collection.find(c => c.title === item.title && c.type === item.type);
        let updatedCollection;
        let newItem;

        if (exists) {
            newItem = { ...exists, category, savedAt: Date.now() };
            updatedCollection = state.collection.map(c => c.id === exists.id ? newItem : c);
        } else {
            newItem = { ...item, category, savedAt: Date.now() };
            updatedCollection = [ newItem, ...state.collection ];
        }

        // Persist
        if (isTauri) {
            const username = useAuthStore.getState().user?.username || 'guest';
            invoke('save_item', { username, item: newItem }).catch(console.error);
        } else {
            localStorage.setItem('media-tracker-collection', JSON.stringify({ state: { collection: updatedCollection }, version: 0 }));
        }

        // Trigger background cover fetch if missing
        // This is async and might update the item later
        if (newItem && !newItem.posterUrl) {
             setTimeout(() => {
                fetchCover(newItem).then((url) => {
                    if (url) {
                        get().updateItem(newItem.id, { posterUrl: url });
                    }
                });
             }, 0);
        }

        return { collection: updatedCollection };
    });
  },

  removeFromCollection: (id) => set((state) => {
    const updatedCollection = state.collection.filter((item) => item.id !== id);
    
    if (isTauri) {
        const username = useAuthStore.getState().user?.username || 'guest';
        invoke('remove_item', { username, id }).catch(console.error);
    } else {
        localStorage.setItem('media-tracker-collection', JSON.stringify({ state: { collection: updatedCollection }, version: 0 }));
    }

    return { collection: updatedCollection };
  }),

  updateItem: (id, updates) => set((state) => {
    let updatedItem: MediaItem | undefined;
    const updatedCollection = state.collection.map((item) => {
      if (item.id === id) {
          updatedItem = { ...item, ...updates };
          return updatedItem;
      }
      return item;
    });

    if (isTauri && updatedItem) {
        const username = useAuthStore.getState().user?.username || 'guest';
        invoke('save_item', { username, item: updatedItem }).catch(console.error);
    } else {
        localStorage.setItem('media-tracker-collection', JSON.stringify({ state: { collection: updatedCollection }, version: 0 }));
    }

    return { collection: updatedCollection };
  }),

  moveCategory: (id, category) => set((state) => {
    let updatedItem: MediaItem | undefined;
    const updatedCollection = state.collection.map((item) => {
        if (item.id === id) {
            updatedItem = { ...item, category };
            return updatedItem;
        }
        return item;
    });

    if (isTauri && updatedItem) {
        const username = useAuthStore.getState().user?.username || 'guest';
        invoke('save_item', { username, item: updatedItem }).catch(console.error);
    } else {
        localStorage.setItem('media-tracker-collection', JSON.stringify({ state: { collection: updatedCollection }, version: 0 }));
    }

    return { collection: updatedCollection };
  }),

  createCollection: (primaryItem, selectedItems) => set((state) => {
      const collectionId = uuidv4();
      // Create the collection container item
      const collectionItem: MediaItem = {
          ...primaryItem,
          id: collectionId,
          title: primaryItem.title, // Keep original title or maybe append (Collection)?
          isCollection: true,
          parentCollectionId: undefined, // Top level
          savedAt: Date.now()
      };

      // Items to be updated (primary + selected)
      const itemsToUpdate = [primaryItem, ...selectedItems].map(item => ({
          ...item,
          parentCollectionId: collectionId
      }));

      // Update collection state
      // 1. Add collectionItem
      // 2. Update existing items with parentCollectionId
      
      const updatedCollection = state.collection.map(item => {
          const foundUpdate = itemsToUpdate.find(u => u.id === item.id);
          return foundUpdate || item;
      });
      
      // Add the new collection item
      const finalCollection = [collectionItem, ...updatedCollection];

      // Persist
      if (isTauri) {
          const username = useAuthStore.getState().user?.username || 'guest';
          // Save collection item
          invoke('save_item', { username, item: collectionItem }).catch(console.error);
          // Save updated children
          itemsToUpdate.forEach(item => {
              invoke('save_item', { username, item }).catch(console.error);
          });
      } else {
          localStorage.setItem('media-tracker-collection', JSON.stringify({ state: { collection: finalCollection }, version: 0 }));
      }

      return { collection: finalCollection };
  }),

  getStats: () => {
    const { collection } = get();
    return {
      total: collection.length,
      watched: collection.filter(c => c.category === CollectionCategory.WATCHED).length,
      toWatch: collection.filter(c => c.category === CollectionCategory.TO_WATCH).length,
      favorites: collection.filter(c => c.category === CollectionCategory.FAVORITES).length,
    };
  }
}));

// Auto-refresh collection when auth user changes
useAuthStore.subscribe((state, prev) => {
  const newUser = state.user?.username || null;
  const oldUser = prev.user?.username || null;
  if (newUser !== oldUser) {
    if (!newUser) {
      useCollectionStore.getState().clear();
    } else {
      useCollectionStore.getState().refreshForUser();
    }
  }
});
