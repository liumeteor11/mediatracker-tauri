#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod models;
mod database;
#[cfg(test)]
mod tests;

use tauri::{command, State, Manager};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use reqwest::Client;
use std::collections::HashMap;
use std::error::Error;
use database::Database;
use models::{MediaItem, UserPublic, UserRecord};
use quick_xml::events::Event;
use quick_xml::Reader;
use std::time::Duration;
use tokio::sync::RwLock;
#[cfg(target_os = "windows")]
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const SEARCH_CACHE_TTL_MS: u64 = 2 * 60 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES: usize = 512;

#[derive(Clone)]
struct SearchCacheEntry {
    ts_ms: u64,
    payload: String,
}

struct AppState {
    proxy_client: Client,  // For Google/Serper/Images (Needs Proxy)
    direct_client: Client, // For Moonshot/Domestic APIs (No Proxy)
    search_cache: RwLock<HashMap<String, SearchCacheEntry>>,
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

#[derive(Debug, Serialize, Deserialize)]
struct FetchPageConfig {
    proxy_url: Option<String>,
    use_system_proxy: Option<bool>,
}

fn client_with_proxy(proxy_url: Option<String>, use_system_proxy: Option<bool>) -> Option<Client> {
    if let Some(url) = proxy_url {
        if !url.is_empty() {
            let builder = Client::builder()
                .tcp_nodelay(true)
                .user_agent("MediaTracker/1.0")
                .connect_timeout(Duration::from_secs(20))
                .timeout(Duration::from_secs(120))
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
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(120));
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
                            .connect_timeout(Duration::from_secs(20))
                            .timeout(Duration::from_secs(120));
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

async fn google_search(client: &Client, query: &str, api_key: &str, cx: &str, search_type: Option<&str>) -> Result<Vec<SearchResultItem>, Box<dyn Error + Send + Sync>> {
    let mut url = format!(
        "https://www.googleapis.com/customsearch/v1?key={}&cx={}&q={}&safe=off&num=8",
        api_key,
        cx,
        urlencoding::encode(query)
    );
    
    if let Some("image") = search_type {
        url.push_str("&searchType=image");
    }
    
    let fut = client.get(&url).send();
    let resp = tokio::time::timeout(std::time::Duration::from_secs(30), fut)
        .await??;

    if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("Google Search Quota Exceeded (429). Please check your API key billing/quota.".into());
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Google API Error ({}): {}", status, text).into());
    }

    let resp = resp.json::<Value>().await?;
    
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

            let metadata = item["pagemap"].clone(); 
            
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

async fn serper_search(client: &Client, query: &str, api_key: &str, search_type: Option<&str>) -> Result<Vec<SearchResultItem>, Box<dyn Error + Send + Sync>> {
    let url = if search_type == Some("image") {
        "https://google.serper.dev/images"
    } else {
        "https://google.serper.dev/search"
    };

    let fut = client
        .post(url)
        .header("X-API-KEY", api_key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "q": query, "safe": "off", "num": 8 }))
        .send();
    let resp = tokio::time::timeout(std::time::Duration::from_secs(30), fut)
        .await??;

    if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("Serper Search Quota Exceeded (429). Please check your API key billing/quota.".into());
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Serper API Error ({}): {}", status, text).into());
    }

    let resp = resp.json::<Value>().await?;
        
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
    } else if let Some(organic) = resp["organic"].as_array() {
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
    Ok(results)
}


async fn yandex_search(client: &Client, query: &str, user: &str, api_key: &str) -> Result<Vec<SearchResultItem>, Box<dyn Error + Send + Sync>> {
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

async fn duckduckgo_search(client: &Client, query: &str) -> Result<Vec<SearchResultItem>, Box<dyn Error + Send + Sync>> {
    // Try API first (Instant Answer)
    let url = format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_html=1&skip_disambig=1",
        urlencoding::encode(query)
    );
    let fut = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send();
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
        for rt in related.iter().take(8) {
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

    let need_html = results.is_empty() || query.to_ascii_lowercase().contains("site:");
    if need_html {
        if let Ok(mut extra) = duckduckgo_html_search(client, query).await {
            let mut seen = std::collections::HashSet::<String>::new();
            for r in results.iter() {
                seen.insert(r.link.to_string());
            }
            extra.retain(|r| !r.link.is_empty() && !seen.contains(&r.link));
            results.extend(extra);
        }
    }

    Ok(results)
}

async fn duckduckgo_html_search(client: &Client, query: &str) -> Result<Vec<SearchResultItem>, Box<dyn Error + Send + Sync>> {
    let url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        urlencoding::encode(query)
    );
    let fut = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept-Language", "en-US,en;q=0.9")
        .header("Referer", "https://html.duckduckgo.com/")
        .send();
        
    let resp = tokio::time::timeout(std::time::Duration::from_secs(10), fut).await??;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("DuckDuckGo HTML Error ({}): {}", status, text).into());
    }
    let body = resp.text().await.unwrap_or_default();
    let lower = body.to_ascii_lowercase();

    let mut results = Vec::new();
    // Try multiple class names: result__a (old), result__url, or generic link finding
    // Simplified parsing: find blocks that look like results
    
    // Pattern 1: class="result__a" (classic)
    let mut pos: usize = 0;
    while results.len() < 10 {
        // Look for result title link
        let found = match lower[pos..].find("result__a") {
            Some(i) => pos + i,
            None => break,
        };
        
        let tail_lower = &lower[found..];
        let href_key = "href=\"";
        let href_start = match tail_lower.find(href_key) {
            Some(i) => found + i + href_key.len(),
            None => {
                pos = found + 10;
                continue;
            }
        };
        
        let rest = &body[href_start..];
        let end = rest.find('"').unwrap_or(rest.len());
        let href_raw = &rest[..end];

        // Decode DDG redirect (uddg=...)
        let link = if let Some(p) = href_raw.find("uddg=") {
            let rest2 = &href_raw[p + 5..];
            let end2 = rest2.find('&').unwrap_or(rest2.len());
            let enc = &rest2[..end2];
            urlencoding::decode(enc).unwrap_or_else(|_| enc.into()).to_string()
        } else if href_raw.starts_with("http://") || href_raw.starts_with("https://") {
            href_raw.to_string()
        } else {
            String::new()
        };

        if !link.is_empty() {
             // Try to find title
             let mut title = String::new();
             if let Some(gt) = rest[end..].find('>') {
                 let after_tag = &rest[end + gt + 1..];
                 if let Some(lt) = after_tag.find("</a>") {
                     title = after_tag[..lt].trim().to_string();
                     // Remove HTML tags from title if any
                     if let Some(idx) = title.find('<') {
                         title = title[..idx].to_string(); // Simple truncation
                     }
                 }
             }
             
             // Try to find snippet (result__snippet)
             let mut snippet = String::new();
             if let Some(snip_idx) = lower[href_start..].find("result__snippet") {
                 let snip_start = href_start + snip_idx;
                 let snip_rest = &body[snip_start..];
                 if let Some(gt) = snip_rest.find('>') {
                     let after_tag = &snip_rest[gt+1..];
                     if let Some(lt) = after_tag.find('<') {
                         snippet = after_tag[..lt].trim().to_string();
                     }
                 }
             }

            results.push(SearchResultItem {
                title,
                snippet,
                link,
                image: None,
                metadata: None,
            });
        }

        pos = href_start + end;
    }

    Ok(results)
}

fn extract_meta_image(body: &str) -> Option<String> {
    let lower = body.to_ascii_lowercase();
    let needles = [
        r#"property="og:image""#,
        r#"property='og:image'"#,
        r#"name="og:image""#,
        r#"name='og:image'"#,
        r#"property="og:image:url""#,
        r#"property='og:image:url'"#,
        r#"property="og:image:secure_url""#,
        r#"property='og:image:secure_url'"#,
        r#"name="twitter:image""#,
        r#"name='twitter:image'"#,
        r#"property="twitter:image""#,
        r#"property='twitter:image'"#,
    ];

    for needle in needles.iter() {
        if let Some(i) = lower.find(needle) {
            let meta_start = lower[..i].rfind("<meta").unwrap_or(i);
            let tail = &lower[meta_start..];
            let end_rel = tail.find('>').unwrap_or(tail.len());
            let tag_lower = &lower[meta_start..meta_start + end_rel];
            let tag = &body[meta_start..meta_start + end_rel];
            if let Some(v) = extract_meta_content(tag, tag_lower) {
                if !v.is_empty() {
                    return Some(v);
                }
            }
        }
    }
    None
}

fn extract_meta_content(tag: &str, tag_lower: &str) -> Option<String> {
    let k = "content=";
    let i = tag_lower.find(k)?;
    let mut rest = &tag[i + k.len()..];
    let mut rest_lower = &tag_lower[i + k.len()..];

    if rest.starts_with('"') || rest.starts_with('\'') {
        let q = rest.chars().next().unwrap();
        rest = &rest[1..];
        rest_lower = &rest_lower[1..];
        let end = rest_lower.find(q)?;
        return Some(rest[..end].to_string());
    }

    let mut end = rest_lower.len();
    for (idx, ch) in rest_lower.char_indices() {
        if ch.is_whitespace() || ch == '>' {
            end = idx;
            break;
        }
    }
    Some(rest[..end].trim().to_string())
}

fn resolve_url(base: &str, v: &str) -> String {
    let s = v.trim();
    if s.is_empty() {
        return String::new();
    }
    if s.starts_with("http://") || s.starts_with("https://") {
        return s.to_string();
    }
    if s.starts_with("//") {
        let scheme = if base.starts_with("http://") { "http:" } else { "https:" };
        return format!("{}{}", scheme, s);
    }
    if s.starts_with('/') {
        if let Some(p) = base.find("://") {
            let after = &base[p + 3..];
            let host_end = after.find('/').unwrap_or(after.len());
            let root = &base[..p + 3 + host_end];
            return format!("{}{}", root, s);
        }
        return format!("https://{}", s.trim_start_matches('/'));
    }
    if let Some(pos) = base.rfind('/') {
        return format!("{}{}", &base[..pos + 1], s);
    }
    s.to_string()
}

#[command]
async fn douban_cover(title: String, _kind: Option<String>, state: State<'_, AppState>) -> Result<String, String> {
    let q = urlencoding::encode(&title);
    // Prefer movie search, then book
    let urls = vec![
        format!("https://movie.douban.com/subject_search?search_text={}&cat=1002", q),
        format!("https://book.douban.com/subject_search?search_text={}&cat=1001", q),
        format!("https://www.douban.com/search?q={}", q)
    ];
    // Helper: extract first subject URL via simple patterns
    fn find_subject_url(body: &str) -> Option<String> {
        let keys = ["https://movie.douban.com/subject/", "https://book.douban.com/subject/"];
        for k in keys.iter() {
            if let Some(idx) = body.find(k) {
                // read until next quote
                let tail = &body[idx..];
                let end = tail.find('"').unwrap_or(tail.len());
                let url = &tail[..end];
                if url.contains("/subject/") { return Some(url.to_string()); }
            }
        }
        None
    }
    // Helper: parse og:image from subject page
    fn find_og_image(body: &str) -> Option<String> {
        let pat = r#"property="og:image""#;
        if let Some(i) = body.find(pat) {
            let tail = &body[i..];
            if let Some(ci) = tail.find("content=\"") {
                let rest = &tail[ci + 9..];
                if let Some(end) = rest.find('"') {
                    let img = &rest[..end];
                    if !img.is_empty() { return Some(img.to_string()); }
                }
            }
        }
        None
    }
    // 1) Fetch search page(s) using direct client (domestic)
    let mut subject_url: Option<String> = None;
    for u in urls {
        if subject_url.is_some() { break; }
        let fut = state.direct_client.get(&u).send();
        let res = tokio::time::timeout(std::time::Duration::from_secs(8), fut).await;
        if let Ok(Ok(resp)) = res {
            if let Ok(text) = resp.text().await {
                if let Some(su) = find_subject_url(&text) {
                    subject_url = Some(su);
                    break;
                }
            }
        }
    }
    // 2) Fetch subject page and extract og:image
    if let Some(su) = subject_url {
        let fut = state.direct_client.get(&su).send();
        if let Ok(Ok(resp)) = tokio::time::timeout(std::time::Duration::from_secs(8), fut).await {
            if let Ok(text) = resp.text().await {
                if let Some(img) = find_og_image(&text) {
                    let body = serde_json::json!({ "ok": true, "url": su, "image": img }).to_string();
                    return Ok(body);
                }
            }
        }
        let body = serde_json::json!({ "ok": false, "url": su }).to_string();
        return Ok(body);
    }
    Ok(serde_json::json!({ "ok": false }).to_string())
}

#[command]
async fn fetch_og_image(url: String, config: Option<FetchPageConfig>, state: State<'_, AppState>) -> Result<String, String> {
    let target = url.trim().to_string();
    if target.is_empty() {
        return Ok(serde_json::json!({ "ok": false, "error": "empty url" }).to_string());
    }

    let (proxy_url, use_system_proxy) = config
        .as_ref()
        .map(|c| (c.proxy_url.clone(), c.use_system_proxy))
        .unwrap_or((None, None));

    let local_client = client_with_proxy(proxy_url, use_system_proxy);
    let client = local_client.as_ref().unwrap_or(&state.proxy_client);

    let fut = client.get(&target).send();
    let resp = match tokio::time::timeout(std::time::Duration::from_secs(12), fut).await {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => {
            return Ok(serde_json::json!({ "ok": false, "url": target, "error": e.to_string() }).to_string());
        }
        Err(_) => {
            return Ok(serde_json::json!({ "ok": false, "url": target, "error": "timeout" }).to_string());
        }
    };

    let status = resp.status().as_u16();
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Ok(serde_json::json!({ "ok": false, "url": target, "status": status, "error": text }).to_string());
    }

    let body = resp.text().await.unwrap_or_default();
    if let Some(img) = extract_meta_image(&body) {
        let abs = resolve_url(&target, &img);
        if !abs.is_empty() {
            return Ok(serde_json::json!({ "ok": true, "url": target, "image": abs }).to_string());
        }
    }

    Ok(serde_json::json!({ "ok": false, "url": target }).to_string())
}


#[command]
async fn web_search(query: String, config: SearchConfig, state: State<'_, AppState>) -> Result<String, String> {
    println!("Rust web_search called. Provider: {}, Type: {:?}", config.provider, config.search_type);
    
    // Choose HTTP client
    let local_client = client_with_proxy(config.proxy_url.clone(), config.use_system_proxy);
    let client = local_client.as_ref().unwrap_or(&state.proxy_client);
    let search_type = config.search_type.as_deref();

    fn clean_opt(v: Option<&str>) -> Option<&str> {
        let s = v?.trim();
        if s.is_empty() {
            return None;
        }
        let l = s.to_ascii_lowercase();
        if l == "undefined" || l == "null" {
            return None;
        }
        Some(s)
    }

    let api_key = clean_opt(config.api_key.as_deref());
    let cx = clean_opt(config.cx.as_deref());
    let user = clean_opt(config.user.as_deref());

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let cache_key = format!(
        "p={};t={};cx={};u={};q={}",
        config.provider,
        search_type.unwrap_or("text"),
        cx.unwrap_or(""),
        user.unwrap_or(""),
        query.trim()
    );
    {
        let guard = state.search_cache.read().await;
        if let Some(hit) = guard.get(&cache_key) {
            if now_ms.saturating_sub(hit.ts_ms) <= SEARCH_CACHE_TTL_MS {
                return Ok(hit.payload.clone());
            }
        }
    }
    
    let result = match config.provider.as_str() {
        "google" => {
            if let (Some(key), Some(cx)) = (api_key, cx) {
                google_search(client, &query, key, cx, search_type).await
            } else if search_type == Some("image") {
                Ok(Vec::new())
            } else {
                duckduckgo_search(client, &query).await
            }
        },
        "serper" => {
            if let Some(key) = api_key {
                serper_search(client, &query, key, search_type).await
            } else if search_type == Some("image") {
                Ok(Vec::new())
            } else {
                duckduckgo_search(client, &query).await
            }
        },
        "yandex" => {
            if search_type == Some("image") {
                return Err("Yandex image search not supported".to_string());
            }
            if let (Some(key), Some(user)) = (api_key, user) {
                yandex_search(&state.direct_client, &query, user, key).await
            } else {
                duckduckgo_search(client, &query).await
            }
        },
        "duckduckgo" => duckduckgo_search(client, &query).await,
        _ => Err("Unsupported search provider".into()),
    };
    let result: Result<Vec<SearchResultItem>, String> = result.map_err(|e| e.to_string());

    match result {
        Ok(items) => {
            let payload = serde_json::to_string(&items).map_err(|e| e.to_string())?;
            {
                let mut guard = state.search_cache.write().await;
                guard.insert(cache_key, SearchCacheEntry { ts_ms: now_ms, payload: payload.clone() });
                if guard.len() > SEARCH_CACHE_MAX_ENTRIES {
                    let cutoff = now_ms.saturating_sub(SEARCH_CACHE_TTL_MS);
                    guard.retain(|_, v| v.ts_ms >= cutoff);
                    while guard.len() > SEARCH_CACHE_MAX_ENTRIES {
                        if let Some(k) = guard.keys().next().cloned() {
                            guard.remove(&k);
                        } else {
                            break;
                        }
                    }
                }
            }
            Ok(payload)
        },
        Err(msg) => {
            let provider = config.provider.clone();
            if search_type != Some("image")
                && config.provider.as_str() != "duckduckgo"
                && !msg.contains("429")
                && !msg.to_lowercase().contains("quota exceeded")
            {
                if let Ok(items) = duckduckgo_search(client, &query).await {
                    let payload = serde_json::to_string(&items).map_err(|e| e.to_string())?;
                    {
                        let mut guard = state.search_cache.write().await;
                        guard.insert(cache_key, SearchCacheEntry { ts_ms: now_ms, payload: payload.clone() });
                    }
                    return Ok(payload);
                }
            }
            println!("Search error (Provider: {}): {}", provider, msg);
            Err(format!("Search failed: {}", msg))
        }
    }
}

#[command]
async fn test_search_provider(config: SearchConfig, state: State<'_, AppState>) -> Result<String, String> {
    let start = std::time::Instant::now();
    
    // Use dynamic client based on config (like web_search)
    let local_client = client_with_proxy(config.proxy_url.clone(), config.use_system_proxy);
    let client = local_client.as_ref().unwrap_or(&state.proxy_client);

    let q = "test";
    let res = match config.provider.as_str() {
        "google" => {
            if let (Some(key), Some(cx)) = (&config.api_key, &config.cx) {
                google_search(client, q, key, cx, Some("text")).await
            } else { Err("Missing Google API Key or CX".into()) }
        },
        "serper" => {
            if let Some(key) = &config.api_key {
                serper_search(client, q, key, Some("text")).await
            } else { Err("Missing Serper API Key".into()) }
        },
        "yandex" => {
            if let (Some(key), Some(user)) = (&config.api_key, &config.user) {
                yandex_search(&state.direct_client, q, user, key).await
            } else { Err("Missing Yandex API Key or User".into()) }
        },
        _ => Err("Unsupported search provider".into()),
    };
    let elapsed = start.elapsed().as_millis() as u64;
    match res {
        Ok(items) => {
            let body = serde_json::json!({
                "ok": true,
                "latency_ms": elapsed,
                "provider": config.provider,
                "count": items.len()
            });
            Ok(body.to_string())
        },
        Err(e) => {
            let body = serde_json::json!({
                "ok": false,
                "latency_ms": elapsed,
                "provider": config.provider,
                "error": e.to_string()
            });
            Ok(body.to_string())
        }
    }
}

#[command]
async fn test_omdb(api_key: String, state: State<'_, AppState>) -> Result<String, String> {
    let start = std::time::Instant::now();
    let url = format!("https://www.omdbapi.com/?t={}&y={}&apikey={}", urlencoding::encode("Inception"), urlencoding::encode("2010"), urlencoding::encode(&api_key));
    let resp = state.direct_client.get(&url).send().await.map_err(|e| e.to_string())?;
    let elapsed = start.elapsed().as_millis() as u64;
    let ok = resp.status().is_success();
    let status = resp.status().as_u16();
    let mut poster = String::new();
    if ok {
        if let Ok(v) = resp.json::<Value>().await {
            poster = v.get("Poster").and_then(|x| x.as_str()).unwrap_or("").to_string();
        }
    }
    let body = serde_json::json!({
        "ok": ok,
        "status": status,
        "latency_ms": elapsed,
        "poster": poster
    });
    Ok(body.to_string())
}
#[command]
async fn wiki_pageimages(title: String, lang_zh: bool, state: State<'_, AppState>) -> Result<String, String> {
    let base = if lang_zh { "https://zh.wikipedia.org/w/api.php" } else { "https://en.wikipedia.org/w/api.php" };
    let url = format!(
        "{}?action=query&prop=pageimages&piprop=thumbnail|original&pithumbsize=1024&format=json&titles={}",
        base,
        urlencoding::encode(&title)
    );
    let fut1 = state.direct_client.get(&url).send();
    let try_direct = tokio::time::timeout(std::time::Duration::from_secs(8), fut1).await;
    if let Ok(Ok(resp)) = try_direct {
        let body = resp.text().await.map_err(|e| e.to_string())?;
        return Ok(body);
    }
    let fut2 = state.proxy_client.get(&url).send();
    let resp2 = tokio::time::timeout(std::time::Duration::from_secs(12), fut2)
        .await
        .map_err(|_| "Timeout".to_string())?
        .map_err(|e| e.to_string())?;
    let body2 = resp2.text().await.map_err(|e| e.to_string())?;
    Ok(body2)
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
    let local_client = client_with_proxy(config.proxy_url.clone(), config.use_system_proxy);
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
            // Capture status before consuming response
            let _status_ok = resp.status().as_u16();
            // Read bytes once; on failure, treat as transient and retry
            match resp.bytes().await {
                Ok(body_bytes) => {
                    match serde_json::from_slice::<Value>(&body_bytes) {
                        Ok(json_resp) => {
                            println!("AI Request Complete (JSON bytes), Total Duration: {:?}", start.elapsed());
                            return Ok(json_resp.to_string());
                        },
                        Err(parse_err) => {
                            println!("AI Response not JSON (bytes), wrapping as text. Err: {}", parse_err);
                            let body_text = String::from_utf8_lossy(&body_bytes).to_string();
                            let fallback = serde_json::json!({
                                "choices": [ { "message": { "content": body_text } } ]
                            });
                            return Ok(fallback.to_string());
                        }
                    }
                },
                Err(read_err) => {
                    if attempt < max_retries - 1 {
                        let delay_ms = 2000u64 * (1u64 << attempt);
                        println!("Body read failed. Backing off for {} ms before retry {}... Err: {}", delay_ms, attempt + 2, read_err);
                        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                        continue;
                    }
                    return Err(format!("Failed to read body bytes: {}", read_err));
                }
            }
        } else {
            let status = resp.status().as_u16();
            let err_body = match resp.bytes().await {
                Ok(b) => String::from_utf8_lossy(&b).to_string(),
                Err(_) => String::new(),
            };
            if (status == 429 || (500u16..600u16).contains(&status)) && attempt < max_retries - 1 {
                let delay_ms = 2000u64 * (1u64 << attempt); // 2000, 4000, 8000
                let reason = if status == 429 { "Rate limited (429)" } else { "Server error (5xx)" };
                println!("{} Backing off for {} ms before retry {}...", reason, delay_ms, attempt + 2);
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                continue;
            }
            return Err(format!("API Error ({}): {}", status, err_body));
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
    let local_client = client_with_proxy(config.proxy_url.clone(), config.use_system_proxy);

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

#[command]
fn export_collection(
    username: String,
    target_path: Option<String>,
    redact_sensitive: Option<bool>,
    db: State<Database>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let items = db.get_all_for_user(&username)?;
    let redact = redact_sensitive.unwrap_or(true);
    let mut export_items = Vec::new();
    if redact {
        for mut it in items.clone() {
            it.user_review = None;
            it.notification_enabled = None;
            export_items.push(it);
        }
    } else {
        export_items = items;
    }

    let out_path = if let Some(path) = target_path {
        std::path::PathBuf::from(path)
    } else {
        let base_dir = app.path()
            .document_dir()
            .map_err(|e| e.to_string())?;
        let out_dir = base_dir.join("MediaTracker").join(&username);
        std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
        out_dir.join("collection.json")
    };

    if let Some(parent) = out_path.parent() {
        if !parent.exists() {
             std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    let content = serde_json::to_string_pretty(&export_items).map_err(|e| e.to_string())?;
    std::fs::write(&out_path, content).map_err(|e| e.to_string())?;

    Ok(out_path.to_string_lossy().to_string())
}

#[command]
async fn bangumi_search(query: String, subject_type: Option<u32>, token: Option<String>, state: State<'_, AppState>) -> Result<String, String> {
    let mut url = format!("https://api.bgm.tv/search/subject/{}?responseGroup=large", urlencoding::encode(&query));
    if let Some(t) = subject_type {
        url.push_str(&format!("&type={}", t));
    }

    let mut builder = state.proxy_client.get(&url)
        .header("User-Agent", "MediaTracker-Rust/1.0 (https://github.com/yourrepo)")
        .header("Accept", "application/json");

    if let Some(tok) = token {
        if !tok.is_empty() {
            builder = builder.header("Authorization", format!("Bearer {}", tok));
        }
    }

    let resp = builder.send().await.map_err(|e| e.to_string())?;
    
    if !resp.status().is_success() {
        return Err(format!("Bangumi Error: {}", resp.status()));
    }
    
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(body)
}

#[command]
async fn bangumi_details(id: u64, token: Option<String>, state: State<'_, AppState>) -> Result<String, String> {
    let url = format!("https://api.bgm.tv/v0/subjects/{}", id);
    let mut builder = state.proxy_client.get(&url)
        .header("User-Agent", "MediaTracker-Rust/1.0 (https://github.com/yourrepo)")
        .header("Accept", "application/json");

    if let Some(tok) = token {
        if !tok.is_empty() {
            builder = builder.header("Authorization", format!("Bearer {}", tok));
        }
    }

    let resp = builder.send().await.map_err(|e| e.to_string())?;
    
    if !resp.status().is_success() {
        return Err(format!("Bangumi Error: {}", resp.status()));
    }
    
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(body)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db = Database::new(app.handle());
            app.manage(db);
            
            // 1. Proxy Client (System Proxy Enabled) - For Google, Serper, etc.
            let proxy_client = Client::builder()
                .tcp_nodelay(true)
                .user_agent("MediaTracker/1.0")
                .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::new(0, 0, 0, 0)))
                .connect_timeout(std::time::Duration::from_secs(10))
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap_or_else(|_| Client::new());

            // 2. Direct Client (NO PROXY) - For Moonshot, Aliyun, Domestic Services
            let direct_client = Client::builder()
                .tcp_nodelay(true)
                .user_agent("MediaTracker/1.0")
                .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::new(0, 0, 0, 0)))
                .no_proxy() // <--- CRITICAL: Bypass system proxy
                .connect_timeout(std::time::Duration::from_secs(5))
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap_or_else(|_| Client::new());
            
            app.manage(AppState { proxy_client, direct_client, search_cache: RwLock::new(HashMap::new()) });
            
            if std::env::var("TAURI_OPEN_DEVTOOLS").unwrap_or_default() == "true" {
                if let Some(w) = app.get_webview_window("main") {
                    w.open_devtools();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            web_search, 
            bangumi_search,
            bangumi_details,
            ai_chat,
            wiki_pageimages,
            douban_cover,
            fetch_og_image,
            test_proxy,
            test_search_provider,
            test_omdb,
            get_collection,
            save_item,
            remove_item,
            import_collection,
            export_collection,
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
