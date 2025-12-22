import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Plugin } from '../types/plugin';
import { v4 as uuidv4 } from 'uuid';

interface PluginState {
    plugins: Plugin[];
    addPlugin: (plugin: Omit<Plugin, 'id' | 'createdAt' | 'updatedAt' | 'enabled'>) => void;
    updatePlugin: (id: string, plugin: Partial<Plugin>) => void;
    removePlugin: (id: string) => void;
    togglePlugin: (id: string) => void;
    getEnabledPlugins: () => Plugin[];
}

export const usePluginStore = create<PluginState>()(
    persist(
        (set, get) => ({
            plugins: [],
            addPlugin: (pluginData) => set((state) => ({
                plugins: [...state.plugins, {
                    ...pluginData,
                    id: uuidv4(),
                    enabled: true,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                }]
            })),
            updatePlugin: (id, data) => set((state) => ({
                plugins: state.plugins.map(p => 
                    p.id === id ? { ...p, ...data, updatedAt: Date.now() } : p
                )
            })),
            removePlugin: (id) => set((state) => ({
                plugins: state.plugins.filter(p => p.id !== id)
            })),
            togglePlugin: (id) => set((state) => ({
                plugins: state.plugins.map(p => 
                    p.id === id ? { ...p, enabled: !p.enabled } : p
                )
            })),
            getEnabledPlugins: () => get().plugins.filter(p => p.enabled)
        }),
        {
            name: 'plugin-storage',
        }
    )
);
