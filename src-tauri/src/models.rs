use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum MediaType {
    #[serde(rename = "Book")]
    Book,
    #[serde(rename = "Movie")]
    Movie,
    #[serde(rename = "TV Series")]
    TvSeries,
    #[serde(rename = "Comic")]
    Comic,
    #[serde(rename = "Short Drama")]
    ShortDrama,
    #[serde(rename = "Music")]
    Music,
    #[serde(rename = "Other")]
    Other,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum CollectionCategory {
    #[serde(rename = "Favorites")]
    Favorites,
    #[serde(rename = "To Watch")]
    ToWatch,
    #[serde(rename = "Watched")]
    Watched,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub id: String,
    pub title: String,
    pub director_or_author: String,
    pub description: String,
    pub release_date: String,
    #[serde(rename = "type")]
    pub media_type: MediaType,
    pub is_ongoing: bool,
    pub latest_update_info: Option<String>,
    pub category: Option<CollectionCategory>,
    pub saved_at: Option<i64>,
    pub poster_url: Option<String>,
    pub rating: Option<String>,
    pub cast: Option<Vec<String>>,
    pub user_progress: Option<String>,
    pub notification_enabled: Option<bool>,
    pub last_checked_at: Option<i64>,
    pub has_new_update: Option<bool>, // New field
    pub user_review: Option<String>,
    pub custom_poster_url: Option<String>,
    pub last_edited_at: Option<i64>,
    pub status: Option<String>, // 'To Watch' etc, seems redundant with category but present in some parts
    pub added_at: Option<String>,
    pub user_rating: Option<f32>,
    pub parent_collection_id: Option<String>,
    pub is_collection: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CollectionData {
    #[serde(default)]
    pub items: Vec<MediaItem>,
    #[serde(default)]
    pub users: Vec<UserRecord>,
    #[serde(default)]
    pub items_by_user: HashMap<String, Vec<MediaItem>>, 
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserRecord {
    pub username: String,
    pub password_hash: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserPublic {
    pub username: String,
}
