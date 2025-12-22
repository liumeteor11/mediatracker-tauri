import { Plugin, PluginResult } from '../types/plugin';

interface PluginContext {
    fetch: typeof fetch;
    console: Console;
}

export class PluginExecutor {
    private plugin: Plugin;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    async executeSearch(query: string): Promise<PluginResult[]> {
        try {
            // Create a safe-ish context
            const context: PluginContext = {
                fetch: window.fetch.bind(window),
                console: window.console,
            };

            // Wrap the script in an async function that returns the interface
            // The user script is expected to return an object with a search method
            const scriptBody = `
                "use strict";
                try {
                    ${this.plugin.script}
                } catch (e) {
                    console.error("Plugin execution error:", e);
                    throw e;
                }
            `;

            const factory = new Function('context', scriptBody);
            const instance = await factory(context);

            if (!instance || typeof instance.search !== 'function') {
                console.error(`Plugin ${this.plugin.name} does not export a search function.`);
                return [];
            }

            const results = await instance.search(query);
            return Array.isArray(results) ? results : [];

        } catch (e) {
            console.error(`Error executing plugin ${this.plugin.name}:`, e);
            return [];
        }
    }
}

export const executeAllPlugins = async (plugins: Plugin[], query: string): Promise<PluginResult[]> => {
    const promises = plugins.map(async (plugin) => {
        const executor = new PluginExecutor(plugin);
        const results = await executor.executeSearch(query);
        // Tag results with source
        return results.map(r => ({ ...r, source: `Plugin: ${plugin.name}` }));
    });

    const resultsArray = await Promise.all(promises);
    return resultsArray.flat();
};
