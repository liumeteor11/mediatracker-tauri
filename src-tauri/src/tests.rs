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
        kind: "Movie".to_string(),
        is_ongoing: false,
        latest_update_info: None,
        category: None,
        saved_at: None,
        poster_url: None,
        rating: None,
        cast: None,
        tmdb_id: None,
        tmdb_media_type: None,
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
        is_pinned: Some(true),
    };

    let json = serde_json::to_string(&item).unwrap();
    assert!(json.contains("\"title\":\"Test Movie\""));
    assert!(json.contains("\"type\":\"Movie\""));
    assert!(json.contains("\"isPinned\":true"));
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

#[test]
fn test_distilled_character_serialization() {
    use crate::models::{CharacterCorrection, DistilledCharacter, ExpressionDNA};

    let character = DistilledCharacter {
        id: "char-1".to_string(),
        name: "Sherlock".to_string(),
        aliases: vec!["Holmes".to_string()],
        source_title: "A Study in Scarlet".to_string(),
        source_media_id: Some("media-9".to_string()),
        source_type: Some("Book".to_string()),
        tagline: Some("Consulting detective".to_string()),
        appearance: None,
        personality: vec!["observant".to_string()],
        mental_models: vec!["deduction first".to_string()],
        decision_heuristics: vec![],
        interpersonal: None,
        boundaries: vec![],
        background: None,
        expression: Some(ExpressionDNA {
            tone: Some("sharp".to_string()),
            formality: 3,
            catchphrases: vec!["Elementary".to_string()],
            vocabulary: vec![],
            sentence_style: None,
            example_lines: vec!["When you have eliminated the impossible...".to_string()],
        }),
        relationships: vec![],
        quotes: vec!["Data! Data! Data!".to_string()],
        external_views: vec![],
        timeline: vec![],
        corrections: vec![CharacterCorrection {
            scene: "greeting a client".to_string(),
            wrong: "coldly ignores them".to_string(),
            correct: "politely asks for details".to_string(),
            created_at: 100.0,
        }],
        version: 2,
        avatar_url: None,
        greeting: Some("The game is afoot!".to_string()),
        created_at: 1.0,
        updated_at: 2.0,
    };

    let json = serde_json::to_string(&character).unwrap();
    assert!(json.contains("\"sourceTitle\":\"A Study in Scarlet\""));
    assert!(json.contains("\"mentalModels\":[\"deduction first\"]"));
    assert!(json.contains("\"sentenceStyle\":null"));
    assert!(json.contains("\"createdAt\":100.0"));

    // Round-trip: missing optional/default fields must deserialize cleanly
    // (older frontend payloads / hand-written JSON).
    let minimal: DistilledCharacter = serde_json::from_str(
        r#"{"id":"c2","name":"Rin","sourceTitle":"Fate","createdAt":1.0,"updatedAt":1.0}"#,
    )
    .unwrap();
    assert_eq!(minimal.version, 0);
    assert!(minimal.aliases.is_empty());
    assert!(minimal.corrections.is_empty());
    assert!(minimal.expression.is_none());
}

#[test]
fn test_chat_session_serialization() {
    use crate::models::{ChatMessage, ChatSession};

    let session = ChatSession {
        id: "s-1".to_string(),
        character_id: "char-1".to_string(),
        title: "First talk".to_string(),
        summary: Some("Earlier they discussed the case.".to_string()),
        summarized_up_to: 4,
        messages: vec![ChatMessage {
            id: "m-1".to_string(),
            role: "user".to_string(),
            content: "Hello".to_string(),
            created_at: 5.0,
        }],
        created_at: 1.0,
        updated_at: 6.0,
    };

    let json = serde_json::to_string(&session).unwrap();
    assert!(json.contains("\"characterId\":\"char-1\""));
    assert!(json.contains("\"summarizedUpTo\":4"));

    let parsed: ChatSession = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.messages.len(), 1);
    assert_eq!(parsed.summarized_up_to, 4);

    // Minimal payload without optional fields (summary/messages default).
    let minimal: ChatSession = serde_json::from_str(
        r#"{"id":"s2","characterId":"c","title":"t","createdAt":1.0,"updatedAt":1.0}"#,
    )
    .unwrap();
    assert!(minimal.messages.is_empty());
    assert_eq!(minimal.summarized_up_to, 0);
}

#[test]
fn test_split_search_keys() {
    // The UI advertises multi-key search credentials separated by ; or ；.
    assert_eq!(
        crate::split_search_keys(Some("key-a; key-b； key-c ;; ")),
        vec!["key-a".to_string(), "key-b".to_string(), "key-c".to_string()]
    );
    assert!(crate::split_search_keys(None).is_empty());
    assert!(crate::split_search_keys(Some("   ")).is_empty());
    assert_eq!(
        crate::split_search_keys(Some("single")),
        vec!["single".to_string()]
    );
}

#[tokio::test]
async fn test_search_with_key_rotation() {
    let item = || crate::SearchResultItem {
        title: "t".to_string(),
        snippet: "s".to_string(),
        link: "https://example.com".to_string(),
        image: None,
        metadata: None,
    };

    // A rejected key rotates to the next one instead of failing the search.
    let items = crate::search_with_key_rotation(
        vec!["rejected".to_string(), "accepted".to_string()],
        |key| async move {
            if key == "accepted" {
                Ok(vec![item()])
            } else {
                Err("API key not valid".to_string())
            }
        },
    )
    .await
    .expect("second key should be used");
    assert_eq!(items.len(), 1);

    // Every key rejected -> the provider's error is surfaced.
    let err = crate::search_with_key_rotation(vec!["a".to_string()], |_key| async move {
        Err::<Vec<crate::SearchResultItem>, String>("quota".to_string())
    })
    .await
    .expect_err("all keys failed");
    assert_eq!(err, "quota");

    // An accepted-but-empty response outranks a later key's error.
    let items = crate::search_with_key_rotation(
        vec!["empty".to_string(), "rejected".to_string()],
        |key| async move {
            if key == "empty" {
                Ok(Vec::new())
            } else {
                Err("boom".to_string())
            }
        },
    )
    .await
    .expect("accepted key wins");
    assert!(items.is_empty());
}

#[test]
fn test_ai_timeouts_allow_reasoning_models() {
    // Reasoning models can think for minutes before the first byte, so the AI
    // request budget must stay well above the old 120 s that killed desktop
    // replies (and distillations) while the browser build succeeded.
    assert!(
        crate::AI_TOTAL_TIMEOUT_SECS >= 300,
        "AI total timeout is {}s — reasoning-model replies need several minutes",
        crate::AI_TOTAL_TIMEOUT_SECS
    );
    assert!(crate::AI_READ_TIMEOUT_SECS >= 60, "per-read guard must still catch stalls");
    assert!(
        crate::AI_READ_TIMEOUT_SECS <= crate::AI_TOTAL_TIMEOUT_SECS,
        "the per-read guard cannot exceed the total budget"
    );
    assert!(crate::AI_CONNECT_TIMEOUT_SECS <= 60, "connects should fail fast");
}
