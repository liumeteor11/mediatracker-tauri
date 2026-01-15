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

#[test]
fn test_duckduckgo_parsing() {
    let html = r#"
    <!DOCTYPE html>
    <html>
    <body>
        <div class="result results_links_deep highlight_d">
            <div class="result__body">
                <h2 class="result__title">
                    <a class="result__a" href="https://example.com/movie">Test Movie (2024)</a>
                </h2>
                <div class="result__snippet">This is a description of the test movie.</div>
            </div>
        </div>
        <div class="result results_links_deep highlight_d">
            <div class="result__body">
                <h2 class="result__title">
                    <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fother.com%2Ffoo">Redirected Link</a>
                </h2>
                <div class="result__snippet">Redirect test</div>
            </div>
        </div>
    </body>
    </html>
    "#;

    let results = crate::parse_duckduckgo_response_body(html);
    
    assert_eq!(results.len(), 2);
    
    assert_eq!(results[0].title, "Test Movie (2024)");
    assert_eq!(results[0].link, "https://example.com/movie");
    assert_eq!(results[0].snippet, "This is a description of the test movie.");
    
    // Check uddg decoding
    assert_eq!(results[1].title, "Redirected Link");
    assert_eq!(results[1].link, "https://other.com/foo"); 
}
