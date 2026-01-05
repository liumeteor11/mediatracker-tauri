#[cfg(test)]
mod tests {
    // Removed unused imports and tempfile dependency
}

#[test]
fn test_media_item_serialization() {
    let item = crate::models::MediaItem {
        id: "123".to_string(),
        title: "Test Movie".to_string(),
        director_or_author: "Director".to_string(),
        description: "Desc".to_string(),
        release_date: "2024".to_string(),
        media_type: crate::models::MediaType::Movie,
        is_ongoing: false,
        latest_update_info: None,
        category: None,
        saved_at: None,
        poster_url: None,
        rating: None,
        cast: None,
        user_progress: None,
        notification_enabled: None,
        last_checked_at: None,
        has_new_update: None,
        user_review: None,
        custom_poster_url: None,
        last_edited_at: None,
        status: None,
        added_at: None,
        user_rating: None,
        parent_collection_id: None,
        is_collection: None,
    };

    let json = serde_json::to_string(&item).unwrap();
    assert!(json.contains("\"title\":\"Test Movie\""));
    assert!(json.contains("\"type\":\"Movie\""));
}
