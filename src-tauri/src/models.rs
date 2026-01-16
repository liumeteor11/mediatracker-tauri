use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CollectionData {
    pub users: Vec<UserRecord>,
    pub items_by_user: HashMap<String, Vec<MediaItem>>,
    // Legacy field for compatibility
    #[serde(default)]
    pub items: Vec<MediaItem>,
    pub ai_config: Option<AIConfig>,
    pub theme_config: Option<ThemeConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRecord {
    pub username: String,
    pub password_hash: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPublic {
    pub username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaItem {
    pub id: String,
    pub title: String,
    #[serde(rename = "directorOrAuthor")]
    pub director_or_author: String,
    pub description: String,
    #[serde(rename = "releaseDate")]
    pub release_date: String,
    #[serde(rename = "type")]
    pub kind: String, 
    #[serde(rename = "isOngoing")]
    pub is_ongoing: bool,
    #[serde(rename = "latestUpdateInfo")]
    pub latest_update_info: Option<String>,
    pub category: Option<String>,
    #[serde(rename = "savedAt")]
    pub saved_at: Option<u64>,
    #[serde(rename = "posterUrl")]
    pub poster_url: Option<String>,
    pub rating: Option<String>,
    pub cast: Option<Vec<String>>,
    #[serde(rename = "tmdbId")]
    pub tmdb_id: Option<i32>,
    #[serde(rename = "tmdbMediaType")]
    pub tmdb_media_type: Option<String>,
    #[serde(rename = "userProgress")]
    pub user_progress: Option<String>,
    #[serde(rename = "notificationEnabled")]
    pub notification_enabled: Option<bool>,
    #[serde(rename = "lastCheckedAt")]
    pub last_checked_at: Option<u64>,
    #[serde(rename = "hasNewUpdate")]
    pub has_new_update: Option<bool>,
    #[serde(rename = "userReview")]
    pub user_review: Option<String>,
    #[serde(rename = "customPosterUrl")]
    pub custom_poster_url: Option<String>,
    #[serde(rename = "lastEditedAt")]
    pub last_edited_at: Option<u64>,
    pub status: Option<String>,
    #[serde(rename = "addedAt")]
    pub added_at: Option<String>,
    #[serde(rename = "userRating")]
    pub user_rating: Option<f32>,
    #[serde(rename = "parentCollectionId")]
    pub parent_collection_id: Option<String>,
    #[serde(rename = "isCollection")]
    pub is_collection: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeConfig {
    pub theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIConfig {
    pub provider: String,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    pub model: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    pub temperature: f32,
    #[serde(rename = "maxTokens")]
    pub max_tokens: i32,
    #[serde(rename = "systemPrompt")]
    pub system_prompt: String,
    #[serde(rename = "enableSearch")]
    pub enable_search: bool,
    #[serde(rename = "searchProvider")]
    pub search_provider: String,
    #[serde(rename = "googleSearchApiKey")]
    pub google_search_api_key: String,
    #[serde(rename = "googleSearchCx")]
    pub google_search_cx: String,
    #[serde(rename = "serperApiKey")]
    pub serper_api_key: String,
    #[serde(rename = "yandexSearchApiKey")]
    pub yandex_search_api_key: String,
    #[serde(rename = "yandexSearchLogin")]
    pub yandex_search_login: String,
    #[serde(rename = "omdbApiKey")]
    pub omdb_api_key: String,
    #[serde(rename = "tmdbApiKey")]
    pub tmdb_api_key: String,
    #[serde(rename = "bangumiToken")]
    pub bangumi_token: String,
    #[serde(rename = "enableTmdb")]
    pub enable_tmdb: bool,
    #[serde(rename = "enableBangumi")]
    pub enable_bangumi: bool,
    #[serde(rename = "enableNetworking")]
    pub enable_networking: bool,
    #[serde(rename = "enableDeepThinking")]
    pub enable_deep_thinking: bool,
    #[serde(rename = "enableTrending")]
    pub enable_trending: bool,
    #[serde(rename = "trendingPrompt")]
    pub trending_prompt: String,
    #[serde(rename = "useSystemProxy")]
    pub use_system_proxy: bool,
    #[serde(rename = "proxyProtocol")]
    pub proxy_protocol: String,
    #[serde(rename = "proxyHost")]
    pub proxy_host: String,
    #[serde(rename = "proxyPort")]
    pub proxy_port: String,
    #[serde(rename = "proxyUsername")]
    pub proxy_username: String,
    #[serde(rename = "proxyPassword")]
    pub proxy_password: String,
    #[serde(rename = "authoritativeDomains")]
    pub authoritative_domains: AuthoritativeDomains,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthoritativeDomains {
    pub movie_tv: Vec<String>,
    pub book: Vec<String>,
    pub comic: Vec<String>,
    pub music: Vec<String>,
    pub poster: Vec<String>,
}
