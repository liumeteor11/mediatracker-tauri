export interface Plugin {
    id: string;
    name: string;
    version: string;
    author: string;
    description: string;
    script: string;
    enabled: boolean;
    createdAt: number;
    updatedAt: number;
}

export interface PluginResult {
    title: string;
    year?: string;
    poster?: string;
    description?: string;
    rating?: string;
    link?: string;
    type?: string;
    directorOrAuthor?: string;
    cast?: string[];
}
