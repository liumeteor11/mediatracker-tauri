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
use models::{MediaItem, UserPublic, UserRecord};
use quick_xml::events::Event;
use quick_xml::Reader;
use std::time::Duration;
#[cfg(target_os = "windows")]
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

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
    proxy_url: Option<String>,
    use_system_proxy: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AIChatConfig {
    model: Option<String>,
    #[serde(rename = "baseURL")]
    base_url: Option<String>,
    #[serde(rename = "apiKey")]
    api_key: Option<String>,
    proxy_url: Option<String>,
    use_system_proxy: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ProxyTestConfig {
    url: Option<String>,
    proxy_url: Option<String>,
    use_system_proxy: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SearchResultItem {
    title: String,
    snippet: String,
    link: String,
    image: Option<String>,
    metadata: Option<Value>, // Extra metadata (e.g. pagemap from Google)
}

fn client_with_proxy(proxy_url: Option<String>, use_system_proxy: Option<bool>) -> Option<Client> {
    if let Some(url) = proxy_url {
        if !url.is_empty() {
            let builder = Client::builder()
                .tcp_nodelay(true)
                .user_agent("MediaTracker/1.0")
                .connect_timeout(Duration::from_secs(7))
                .timeout(Duration::from_secs(20))
                .proxy(reqwest::Proxy::all(url).ok()?);
            return builder.build().ok();
        }
    }
    if use_system_proxy.unwrap_or(false) {
        let http = std::env::var("HTTP_PROXY").ok().or_else(|| std::env::var("http_proxy").ok());
        let https = std::env::var("HTTPS_PROXY").ok().or_else(|| std::env::var("https_proxy").ok());
        let all = std::env::var("ALL_PROXY").ok().or_else(|| std::env::var("all_proxy").ok());

        let mut builder = Client::builder()
            .tcp_nodelay(true)
            .user_agent("MediaTracker/1.0")
            .connect_timeout(Duration::from_secs(7))
            .timeout(Duration::from_secs(20));
        let mut any = false;
        if let Some(a) = all {
            if !a.is_empty() {
                if let Ok(p) = reqwest::Proxy::all(a) { builder = builder.proxy(p); any = true; }
            }
        } else {
            if let Some(h) = http { if !h.is_empty() { if let Ok(p) = reqwest::Proxy::http(h) { builder = builder.proxy(p); any = true; } } }
            if let Some(s) = https { if !s.is_empty() { if let Ok(p) = reqwest::Proxy::https(s) { builder = builder.proxy(p); any = true; } } }
        }
        if any {
            if let Ok(c) = builder.build() { return Some(c); }
        }

        #[cfg(target_os = "windows")]
        {
            if let Ok(internet_settings) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings") {
                let enabled: Result<u32, _> = internet_settings.get_value("ProxyEnable");
                if enabled.ok().unwrap_or(0) != 0 {
                    if let Ok(server) = internet_settings.get_value::<String, _>("ProxyServer") {
                        let mut http_u: Option<String> = None;
                        let mut https_u: Option<String> = None;
                        let mut socks_u: Option<String> = None;
                        if server.contains('=') {
                            for part in server.split(';') {
                                let mut kv = part.splitn(2, '=');
                                let k = kv.next().unwrap_or("").to_lowercase();
                                let v = kv.next().unwrap_or("");
                                let url = if v.starts_with("http://") || v.starts_with("https://") || v.starts_with("socks5://") { v.to_string() } else {
                                    match k.as_str() { "socks" => format!("socks5://{}", v), _ => format!("http://{}", v) }
                                };
                                match k.as_str() {
                                    "http" => http_u = Some(url),
                                    "https" => https_u = Some(url),
                                    "socks" => socks_u = Some(url),
                                    _ => {}
                                }
                            }
                        } else {
                            let v = server;
                            let url = if v.starts_with("http://") || v.starts_with("https://") || v.starts_with("socks5://") { v } else { format!("http://{}", v) };
                            http_u = Some(url.clone());
                            https_u = Some(url);
                        }
                        let mut builder = Client::builder()
                            .tcp_nodelay(true)
                            .user_agent("MediaTracker/1.0")
                            .connect_timeout(Duration::from_secs(7))
                            .timeout(Duration::from_secs(20));
                        let mut have = false;
                        if let Some(s) = socks_u { if let Ok(p) = reqwest::Proxy::all(s) { builder = builder.proxy(p); have = true; } }
                        else {
                            if let Some(h) = http_u { if let Ok(p) = reqwest::Proxy::http(h) { builder = builder.proxy(p); have = true; } }
                            if let Some(hs) = https_u { if let Ok(p) = reqwest::Proxy::https(hs) { builder = builder.proxy(p); have = true; } }
                        }
                        if have { if let Ok(c) = builder.build() { return Some(c); } }
                    }
                }
            }
        }
    }
    None
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
    
    let fut = client.get(&url).send();
    let resp = tokio::time::timeout(std::time::Duration::from_secs(12), fut)
        .await??
        .json::<Value>()
        .await?;
    
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

    let fut = client
        .post(url)
        .header("X-API-KEY", api_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "q": query }))
        .send();
    let resp = tokio::time::timeout(std::time::Duration::from_secs(12), fut)
        .await??
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

    let fut = client.get(&url).send();
    let resp = tokio::time::timeout(std::time::Duration::from_secs(12), fut).await??;
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

async fn duckduckgo_search(client: &Client, query: &str) -> Result<Vec<SearchResultItem>, Box<dyn Error>> {
    let url = format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_html=1&skip_disambig=1",
        urlencoding::encode(query)
    );
    let fut = client.get(&url).send();
    let resp = tokio::time::timeout(std::time::Duration::from_secs(8), fut)
        .await??
        .json::<Value>()
        .await?;

    let mut results = Vec::new();
    if let (Some(abstract_text), Some(abstract_url)) = (
        resp["AbstractText"].as_str(),
        resp["AbstractURL"].as_str(),
    ) {
        let title = resp["Heading"].as_str().unwrap_or(abstract_text).to_string();
        results.push(SearchResultItem {
            title,
            snippet: abstract_text.to_string(),
            link: abstract_url.to_string(),
            image: None,
            metadata: None,
        });
    }

    if let Some(related) = resp["RelatedTopics"].as_array() {
        for rt in related.iter().take(5) {
            let t = rt["Text"].as_str().unwrap_or("");
            let u = rt["FirstURL"].as_str().unwrap_or("");
            if !t.is_empty() && !u.is_empty() {
                results.push(SearchResultItem {
                    title: t.to_string(),
                    snippet: t.to_string(),
                    link: u.to_string(),
                    image: None,
                    metadata: None,
                });
            }
        }
    }

    Ok(results)
}

#[command]
async fn web_search(query: String, config: SearchConfig, state: State<'_, AppState>) -> Result<String, String> {
    println!("Rust web_search called. Query: {}, Provider: {}, Type: {:?}", query, config.provider, config.search_type);
    
    // Choose HTTP client
    let local_client = client_with_proxy(config.proxy_url.clone(), config.use_system_proxy.clone());
    let client = local_client.as_ref().unwrap_or(&state.proxy_client);
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
        "duckduckgo" => duckduckgo_search(client, &query).await,
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
async fn ai_chat(messages: Vec<Value>, temperature: f32, tools: Option<Value>, config: AIChatConfig, state: State<'_, AppState>) -> Result<String, String> {
    let start = std::time::Instant::now();
    let api_key = config.api_key.ok_or("Missing API Key")?;
    let raw_base = config.base_url.unwrap_or("https://api.moonshot.cn/v1".to_string());
    let mut base_url = raw_base.trim().trim_end_matches(')').trim_matches('"').trim_matches('\'').to_string();
    if base_url.is_empty() { base_url = "https://api.moonshot.cn/v1".to_string(); }
    let is_google_openai = base_url.contains("/openai/");
    let has_v1 = base_url.ends_with("/v1") || base_url.contains("/v1/");
    let need_v1 = (base_url.contains("openai.com") || base_url.contains("deepseek.com") || base_url.contains("mistral.ai") || base_url.contains("moonshot.cn")) && !is_google_openai && !has_v1;
    if need_v1 {
        if base_url.ends_with('/') { base_url.push_str("v1"); } else { base_url.push_str("/v1"); }
    }
    
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
        
    // Optional override via proxy_url
    let local_client = client_with_proxy(config.proxy_url.clone(), config.use_system_proxy.clone());
    let client = if let Some(c) = local_client.as_ref() {
        c
    } else if use_direct {
        &state.direct_client
    } else {
        &state.proxy_client
    };
    
    let client_type = if use_direct { "Direct" } else { "Proxy" };

    let model = config.model.unwrap_or("moonshot-v1-8k".to_string());
    
    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": temperature,
    });
    if let Some(t) = tools {
        body["tools"] = t;
        body["tool_choice"] = serde_json::Value::String("auto".to_string());
    }

    let url = if base_url.ends_with('/') {
        format!("{}chat/completions", base_url)
    } else {
        format!("{}/chat/completions", base_url)
    };

    println!("AI Request Start: {} (Client: {})", url, client_type);

    // Force IPv4 if possible to avoid IPv6 timeouts on some networks
    let max_retries = 3;
    for attempt in 0..max_retries {
        let resp = client.post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        println!("AI Request Sent (Headers Received), Duration: {:?}", start.elapsed());

        if resp.status().is_success() {
            let json_resp: Value = resp.json().await.map_err(|e| format!("Failed to parse JSON: {}", e))?;
            println!("AI Request Complete, Total Duration: {:?}", start.elapsed());
            return Ok(json_resp.to_string());
        } else {
            let status = resp.status().as_u16();
            let error_text = resp.text().await.unwrap_or_default();
            if status == 429 && attempt < max_retries - 1 {
                let delay_ms = 2000u64 * (1u64 << attempt); // 2000, 4000, 8000
                println!("Rate limited (429). Backing off for {} ms before retry {}...", delay_ms, attempt + 2);
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                continue;
            }
            return Err(format!("API Error ({}): {}", status, error_text));
        }
    }

    Err("API Error: exceeded retries".to_string())
}

#[command]
async fn test_proxy(config: ProxyTestConfig, state: State<'_, AppState>) -> Result<String, String> {
    let url = config
        .url
        .unwrap_or_else(|| "https://www.google.com/generate_204".to_string());

    let start = std::time::Instant::now();

    // Build optional client with explicit proxy
    let local_client = client_with_proxy(config.proxy_url.clone(), config.use_system_proxy.clone());

    let client = local_client.as_ref().unwrap_or(&state.proxy_client);

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Proxy request failed: {}", e))?;

    let elapsed = start.elapsed().as_millis() as u64;
    let ok = resp.status().is_success();
    let status = resp.status().as_u16();

    let body = serde_json::json!({
        "ok": ok,
        "status": status,
        "latency_ms": elapsed,
        "url": url,
    });
    Ok(body.to_string())
}

// --- Database Commands ---

#[command]
fn get_collection(username: String, db: State<Database>) -> Result<Vec<MediaItem>, String> {
    db.get_all_for_user(&username)
}

#[command]
fn save_item(username: String, item: MediaItem, db: State<Database>) -> Result<(), String> {
    db.add_item_for_user(&username, item)
}

#[command]
fn remove_item(username: String, id: String, db: State<Database>) -> Result<(), String> {
    db.remove_item_for_user(&username, &id)
}

#[command]
fn import_collection(username: String, items: Vec<MediaItem>, db: State<Database>) -> Result<(), String> {
    db.import_for_user(&username, items)
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
                .connect_timeout(std::time::Duration::from_secs(7))
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .unwrap_or_else(|_| Client::new());

            // 2. Direct Client (NO PROXY) - For Moonshot, Aliyun, Domestic Services
            let direct_client = Client::builder()
                .tcp_nodelay(true)
                .user_agent("MediaTracker/1.0")
                .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::new(0, 0, 0, 0)))
                .no_proxy() // <--- CRITICAL: Bypass system proxy
                .connect_timeout(std::time::Duration::from_secs(5))
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .unwrap_or_else(|_| Client::new());
            
            app.manage(AppState { proxy_client, direct_client });
            
            if std::env::var("TAURI_OPEN_DEVTOOLS").unwrap_or_default() == "true" {
                if let Some(w) = app.get_webview_window("main") {
                    w.open_devtools();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            web_search, 
            ai_chat,
            test_proxy,
            get_collection,
            save_item,
            remove_item,
            import_collection,
            register_user,
            login_user
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[command]
fn register_user(username: String, password: String, db: State<Database>) -> Result<UserPublic, String> {
    let u = username.trim();
    if u.len() < 3 { return Err("Username too short".to_string()); }
    if password.len() < 6 { return Err("Password too short".to_string()); }
    if db.find_user(u).is_some() {
        return Err("USER_EXISTS".to_string());
    }

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| e.to_string())?
        .to_string();

    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;

    let record = UserRecord { username: u.to_string(), password_hash: hash, created_at };
    db.add_user(record)?;
    Ok(UserPublic { username: u.to_string() })
}

#[command]
fn login_user(username: String, password: String, db: State<Database>) -> Result<UserPublic, String> {
    let u = username.trim();
    let record = db.find_user(u).ok_or_else(|| "INVALID_CREDENTIALS".to_string())?;

    let parsed = PasswordHash::new(&record.password_hash).map_err(|e| e.to_string())?;
    let argon2 = Argon2::default();
    match argon2.verify_password(password.as_bytes(), &parsed) {
        Ok(_) => Ok(UserPublic { username: u.to_string() }),
        Err(_) => Err("INVALID_CREDENTIALS".to_string()),
    }
}
// Password hashing (Argon2)
use argon2::{Argon2, PasswordHasher};
use argon2::password_hash::{PasswordHash, PasswordVerifier, SaltString};
use rand_core::OsRng;
