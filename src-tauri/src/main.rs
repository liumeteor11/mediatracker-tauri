#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod models;
mod database;
#[cfg(test)]
mod tests;

use tauri::{command, State, Manager};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use reqwest::Client;
use std::error::Error;
use database::Database;
use models::MediaItem;
use quick_xml::events::Event;
use quick_xml::Reader;

struct AppState {
    proxy_client: Client,  // For Google/Serper/Images (Needs Proxy)
    direct_client: Client, // For Moonshot/Domestic APIs (No Proxy)
}

#[derive(Debug, Serialize, Deserialize)]
struct SearchConfig {
    provider: String,
    api_key: Option<String>,
    cx: Option<String>,
    user: Option<String>,
    search_type: Option<String>, // "text" or "image"
}

#[derive(Debug, Serialize, Deserialize)]
struct AIChatConfig {
    model: Option<String>,
    #[serde(rename = "baseURL")]
    base_url: Option<String>,
    #[serde(rename = "apiKey")]
    api_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SearchResultItem {
    title: String,
    snippet: String,
    link: String,
    image: Option<String>,
    metadata: Option<Value>, // Extra metadata (e.g. pagemap from Google)
}

// --- Search Logic (Same as before) ---

async fn google_search(client: &Client, query: &str, api_key: &str, cx: &str, search_type: Option<&str>) -> Result<Vec<SearchResultItem>, Box<dyn Error>> {
    let mut url = format!(
        "https://www.googleapis.com/customsearch/v1?key={}&cx={}&q={}",
        api_key,
        cx,
        urlencoding::encode(query)
    );
    
    if let Some("image") = search_type {
        url.push_str("&searchType=image");
    }
    
    let resp = client.get(&url).send().await?.json::<Value>().await?;
    
    let mut results = Vec::new();
    if let Some(items) = resp["items"].as_array() {
        for item in items {
            let title = item["title"].as_str().unwrap_or("").to_string();
            let snippet = item["snippet"].as_str().unwrap_or("").to_string();
            let link = item["link"].as_str().unwrap_or("").to_string();
            
            // For image search, 'link' is often the image URL, or it's in 'link' field of the item
            let mut image = item["pagemap"]["cse_image"][0]["src"].as_str().map(|s| s.to_string());
            
            // If explicit image search, try to get high res image from 'link' if it looks like an image, or use thumbnail
            if search_type == Some("image") {
                 if let Some(l) = item["link"].as_str() {
                     if l.ends_with(".jpg") || l.ends_with(".png") || l.ends_with(".jpeg") {
                         image = Some(l.to_string());
                     }
                 }
            }

            let metadata = item["pagemap"].clone().into(); 
            
            results.push(SearchResultItem {
                title,
                snippet,
                link,
                image,
                metadata: Some(metadata),
            });
        }
    }
    Ok(results)
}

async fn serper_search(client: &Client, query: &str, api_key: &str, search_type: Option<&str>) -> Result<Vec<SearchResultItem>, Box<dyn Error>> {
    let url = if search_type == Some("image") {
        "https://google.serper.dev/images"
    } else {
        "https://google.serper.dev/search"
    };

    let resp = client
        .post(url)
        .header("X-API-KEY", api_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "q": query }))
        .send()
        .await?
        .json::<Value>()
        .await?;
        
    let mut results = Vec::new();
    
    if search_type == Some("image") {
        if let Some(images) = resp["images"].as_array() {
            for img in images {
                let title = img["title"].as_str().unwrap_or("").to_string();
                let snippet = img["domain"].as_str().unwrap_or("").to_string(); // Serper images don't have snippets usually
                let link = img["link"].as_str().unwrap_or("").to_string();
                let image_url = img["imageUrl"].as_str().map(|s| s.to_string());
                
                results.push(SearchResultItem {
                    title,
                    snippet,
                    link,
                    image: image_url,
                    metadata: None,
                });
            }
        }
    } else {
        if let Some(organic) = resp["organic"].as_array() {
            for item in organic {
                let title = item["title"].as_str().unwrap_or("").to_string();
                let snippet = item["snippet"].as_str().unwrap_or("").to_string();
                let link = item["link"].as_str().unwrap_or("").to_string();
                let date = item["date"].as_str().map(|s| s.to_string());
                let attributes = item["attributes"].clone();
                
                let mut metadata = serde_json::Map::new();
                if let Some(d) = date {
                    metadata.insert("date".to_string(), Value::String(d));
                }
                if let Some(attrs) = attributes.as_object() {
                    for (k, v) in attrs {
                        metadata.insert(k.clone(), v.clone());
                    }
                }
                
                results.push(SearchResultItem {
                    title,
                    snippet,
                    link,
                    image: None,
                    metadata: Some(Value::Object(metadata)),
                });
            }
        }
    }
    Ok(results)
}

async fn yandex_search(client: &Client, query: &str, user: &str, api_key: &str) -> Result<Vec<SearchResultItem>, Box<dyn Error>> {
    let url = format!(
        "https://yandex.com/search/xml?user={}&key={}&l10n=en&filter=none&query={}",
        urlencoding::encode(user),
        urlencoding::encode(api_key),
        urlencoding::encode(query)
    );

    let resp = client.get(&url).send().await?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Yandex API Error: {}", text).into());
    }

    let text = resp.text().await?;
    let mut results = Vec::new();

    let mut reader = Reader::from_str(&text);
    reader.trim_text(true);
    let mut buf = Vec::new();

    let mut in_doc = false;
    let mut in_title = false;
    let mut in_url = false;
    let mut in_passage = false;

    let mut title = String::new();
    let mut link = String::new();
    let mut snippet = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name: Vec<u8> = e.name().as_ref().to_vec();
                if name.as_slice() == b"doc" { in_doc = true; }
                else if name.as_slice() == b"title" && in_doc { in_title = true; }
                else if name.as_slice() == b"url" && in_doc { in_url = true; }
                else if name.as_slice() == b"passage" && in_doc { in_passage = true; }
            }
            Ok(Event::Text(t)) => {
                let val = t.unescape().unwrap_or_default().to_string();
                if in_title { title = val; }
                else if in_url { link = val; }
                else if in_passage && snippet.is_empty() { snippet = val; }
            }
            Ok(Event::End(e)) => {
                let name: Vec<u8> = e.name().as_ref().to_vec();
                if name.as_slice() == b"title" { in_title = false; }
                else if name.as_slice() == b"url" { in_url = false; }
                else if name.as_slice() == b"passage" { in_passage = false; }
                else if name.as_slice() == b"doc" {
                    if !title.is_empty() || !link.is_empty() {
                        results.push(SearchResultItem {
                            title: title.clone(),
                            snippet: snippet.clone(),
                            link: link.clone(),
                            image: None,
                            metadata: None,
                        });
                    }
                    in_doc = false;
                    title.clear();
                    link.clear();
                    snippet.clear();
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(results)
}

#[command]
async fn web_search(query: String, config: SearchConfig, state: State<'_, AppState>) -> Result<String, String> {
    println!("Rust web_search called. Query: {}, Provider: {}, Type: {:?}", query, config.provider, config.search_type);
    
    // Use proxy_client for web search
    let client = &state.proxy_client;
    let search_type = config.search_type.as_deref();
    
    let result = match config.provider.as_str() {
        "google" => {
            if let (Some(key), Some(cx)) = (&config.api_key, &config.cx) {
                google_search(client, &query, key, cx, search_type).await
            } else {
                return Err("Missing Google API Key or CX".to_string());
            }
        },
        "serper" => {
            if let Some(key) = &config.api_key {
                serper_search(client, &query, key, search_type).await
            } else {
                return Err("Missing Serper API Key".to_string());
            }
        },
        "yandex" => {
            if search_type == Some("image") {
                return Err("Yandex image search not supported".to_string());
            }
            if let (Some(key), Some(user)) = (&config.api_key, &config.user) {
                yandex_search(client, &query, user, key).await
            } else {
                return Err("Missing Yandex API Key or User".to_string());
            }
        },
        _ => Err("Unsupported search provider".into()),
    };

    match result {
        Ok(items) => serde_json::to_string(&items).map_err(|e| e.to_string()),
        Err(e) => {
            println!("Search error (Provider: {}): {:?}", config.provider, e);
            Err(format!("Search failed: {}", e))
        }
    }
}

#[command]
async fn ai_chat(messages: Vec<Value>, temperature: f32, config: AIChatConfig, state: State<'_, AppState>) -> Result<String, String> {
    let start = std::time::Instant::now();
    let api_key = config.api_key.ok_or("Missing API Key")?;
    let base_url = config.base_url.unwrap_or("https://api.moonshot.cn/v1".to_string());
    
    // INTELLIGENT CLIENT SELECTION
    // If the URL contains "api.moonshot.cn" or other domestic domains, use direct_client.
    // Otherwise, use proxy_client (e.g. OpenAI).
    let use_direct = base_url.contains("moonshot.cn") 
        || base_url.contains("aliyun") 
        || base_url.contains("baidu")
        || base_url.contains("deepseek")
        || base_url.contains("volcengine")
        || base_url.contains("tencent")
        || base_url.contains("localhost")
        || base_url.contains("127.0.0.1");
        
    let client = if use_direct {
        &state.direct_client
    } else {
        &state.proxy_client
    };
    
    let client_type = if use_direct { "Direct" } else { "Proxy" };

    let model = config.model.unwrap_or("moonshot-v1-8k".to_string());
    
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": temperature,
    });

    let url = if base_url.ends_with('/') {
        format!("{}chat/completions", base_url)
    } else {
        format!("{}/chat/completions", base_url)
    };

    println!("AI Request Start: {} (Client: {})", url, client_type);

    // Force IPv4 if possible to avoid IPv6 timeouts on some networks
    let resp = client.post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    println!("AI Request Sent (Headers Received), Duration: {:?}", start.elapsed());

    if !resp.status().is_success() {
        let error_text = resp.text().await.unwrap_or_default();
        return Err(format!("API Error: {}", error_text));
    }

    let json_resp: Value = resp.json().await.map_err(|e| format!("Failed to parse JSON: {}", e))?;
    
    println!("AI Request Complete, Total Duration: {:?}", start.elapsed());
    
    Ok(json_resp.to_string())
}

// --- Database Commands ---

#[command]
fn get_collection(db: State<Database>) -> Result<Vec<MediaItem>, String> {
    db.get_all()
}

#[command]
fn save_item(item: MediaItem, db: State<Database>) -> Result<(), String> {
    db.add_item(item)
}

#[command]
fn remove_item(id: String, db: State<Database>) -> Result<(), String> {
    db.remove_item(&id)
}

#[command]
fn import_collection(items: Vec<MediaItem>, db: State<Database>) -> Result<(), String> {
    db.import(items)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let db = Database::new(app.handle());
            app.manage(db);
            
            // 1. Proxy Client (System Proxy Enabled) - For Google, Serper, etc.
            let proxy_client = Client::builder()
                .tcp_nodelay(true)
                .user_agent("MediaTracker/1.0")
                .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::new(0, 0, 0, 0)))
                .connect_timeout(std::time::Duration::from_secs(10))
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap_or_else(|_| Client::new());

            // 2. Direct Client (NO PROXY) - For Moonshot, Aliyun, Domestic Services
            let direct_client = Client::builder()
                .tcp_nodelay(true)
                .user_agent("MediaTracker/1.0")
                .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::new(0, 0, 0, 0)))
                .no_proxy() // <--- CRITICAL: Bypass system proxy
                .connect_timeout(std::time::Duration::from_secs(5)) // Fast fail
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap_or_else(|_| Client::new());
            
            app.manage(AppState { proxy_client, direct_client });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            web_search, 
            ai_chat,
            get_collection,
            save_item,
            remove_item,
            import_collection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
