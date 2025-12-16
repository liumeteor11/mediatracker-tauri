export enum MediaType {
  BOOK = 'Book',
  MOVIE = 'Movie',
  TV_SERIES = 'TV Series',
  COMIC = 'Comic',
  SHORT_DRAMA = 'Short Drama',
  MUSIC = 'Music',
  OTHER = 'Other'
}

export enum CollectionCategory {
  FAVORITES = 'Favorites',
  TO_WATCH = 'To Watch',
  WATCHED = 'Watched'
}

export interface MediaItem {
  id: string; // generated UUID or unique ID from AI
  title: string;
  directorOrAuthor: string;
  description: string;
  releaseDate: string;
  type: MediaType;
  isOngoing: boolean;
  latestUpdateInfo?: string; // e.g., "Chapter 105" or "Season 3 Episode 2"
  category?: CollectionCategory; // Local state property
  savedAt?: number;
  posterUrl?: string; // URL for the poster image
  rating?: string; // e.g., "8.5/10"
  cast?: string[]; // Main actors (max 5)
  
  // Tracking fields
  userProgress?: string; // e.g. "S1E5" or "Chapter 10"
  notificationEnabled?: boolean;
  lastCheckedAt?: number;
  hasNewUpdate?: boolean; // New field for tracking updates

  // Customization fields
  userReview?: string; // Rich text content for user review
  customPosterUrl?: string; // User uploaded poster URL
  lastEditedAt?: number; // Timestamp of last edit

  // Backend-aligned fields
  status?: string;
  addedAt?: string;
  userRating?: number;
}

export interface User {
  username: string;
  githubToken?: string;
  lastBackup?: string;
}

export type IOChannel = 'ai' | 'search';
export interface AIIOLogEntry {
  id: string;
  ts: number;
  channel: IOChannel;
  provider?: string;
  query?: string;
  request?: any;
  response?: any;
  durationMs?: number;
  searchType?: 'text' | 'image';
  model?: string;
  baseURL?: string;
}
