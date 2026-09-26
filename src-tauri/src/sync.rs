use axum::{routing::get, Router, Json, extract::State, http::{HeaderMap, StatusCode}};
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::collections::HashMap;
use crate::database::Database;
use mdns_sd::{ServiceDaemon, ServiceInfo, ServiceEvent};
use local_ip_address::local_ip;
use serde::{Deserialize, Serialize};

use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone)]
pub struct SyncState {
    pub db: Arc<Database>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PeerInfo {
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub last_seen: u64,
}

#[derive(Clone)]
pub struct SyncService {
    mdns: ServiceDaemon,
    port: u16,
    peers: Arc<RwLock<HashMap<String, PeerInfo>>>,
    running: Arc<AtomicBool>,
}

impl SyncService {
    pub fn new() -> Self {
        let mdns = ServiceDaemon::new().expect("Failed to create mdns daemon");
        Self {
            mdns,
            port: 14567,
            peers: Arc::new(RwLock::new(HashMap::new())),
            running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn start_server(&self, db: Arc<Database>) {
        if self.running.load(Ordering::SeqCst) {
            println!("Sync server already running");
            return;
        }
        
        let state = SyncState { db };

        let app = Router::new()
            .route("/sync/data", get(get_data).post(receive_data))
            .with_state(state);

        let ip = local_ip().unwrap_or("0.0.0.0".parse().unwrap());
        let addr = SocketAddr::from((ip, self.port));
        
        println!("Starting Sync Server on {}", addr);
        
        // Announce via mDNS
        let hostname = get_hostname();
        let service_type = "_mediatrove._tcp.local.";
        let instance_name = format!("MediaTrove_{}", hostname);
        let host_ipv4 = ip.to_string();

        let service_info = ServiceInfo::new(
            service_type,
            &instance_name,
            &format!("{}.local.", hostname),
            &host_ipv4,
            self.port,
            [("version", "1")].as_slice()
        ).expect("Valid service info");
        
        if let Err(e) = self.mdns.register(service_info) {
            eprintln!("Failed to register mDNS: {}", e);
        }

        // Start Discovery in background
        self.start_discovery();

        // Run server
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                self.running.store(true, Ordering::SeqCst);
                if let Err(e) = axum::serve(listener, app).await {
                    eprintln!("Server error: {}", e);
                }
                self.running.store(false, Ordering::SeqCst);
            },
            Err(e) => eprintln!("Failed to bind sync port: {}", e),
        }
    }

    fn start_discovery(&self) {
        let mdns = self.mdns.clone();
        let peers = self.peers.clone();
        let service_type = "_mediatrove._tcp.local.";

        std::thread::spawn(move || {
            let receiver = mdns.browse(service_type).expect("Failed to browse");
            while let Ok(event) = receiver.recv() {
                match event {
                    ServiceEvent::ServiceResolved(info) => {
                         let fullname = info.get_fullname().to_string();
                         // Ignore self if possible, but IP check is easier later
                         let ip = info.get_addresses().iter().next().map(|ip| ip.to_string()).unwrap_or_default();
                         let port = info.get_port();
                         let hostname = info.get_hostname().to_string();
                         
                         if !ip.is_empty() {
                             let p = PeerInfo { 
                                 name: hostname, 
                                 ip, 
                                 port,
                                 last_seen: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
                             };
                             if let Ok(mut guard) = peers.write() {
                                 guard.insert(fullname, p);
                             }
                         }
                    },
                    ServiceEvent::ServiceRemoved(_type, fullname) => {
                        if let Ok(mut guard) = peers.write() {
                            guard.remove(&fullname);
                        }
                    }
                    _ => {}
                }
            }
        });
    }

    pub fn get_known_peers(&self) -> Vec<PeerInfo> {
        if let Ok(guard) = self.peers.read() {
            guard.values().cloned().collect()
        } else {
            Vec::new()
        }
    }
}

fn get_hostname() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Unknown".to_string())
}

fn check_auth(headers: &HeaderMap, state: &SyncState) -> Result<(), StatusCode> {
    let expected = state.db.get_sync_token();
    if expected.is_empty() {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    match headers.get(axum::http::header::AUTHORIZATION) {
        Some(v) if v.to_str().map(|s| s == format!("Bearer {}", expected)).unwrap_or(false) => Ok(()),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

async fn get_data(headers: HeaderMap, State(state): State<SyncState>, axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>) -> Result<Json<serde_json::Value>, StatusCode> {
    check_auth(&headers, &state)?;
    let username = params.get("user").cloned().unwrap_or_default();
    if username.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let items = state.db.get_user_items(&username).unwrap_or_default();
    Ok(Json(serde_json::json!({ "items": items })))
}

async fn receive_data(headers: HeaderMap, State(state): State<SyncState>, Json(payload): Json<serde_json::Value>) -> Result<Json<serde_json::Value>, StatusCode> {
    check_auth(&headers, &state)?;
    let username = payload.get("user").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    if username.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let items: Vec<crate::models::MediaItem> = serde_json::from_value(
        payload.get("items").cloned().unwrap_or(serde_json::Value::Null)
    ).map_err(|_| StatusCode::BAD_REQUEST)?;
    state.db.merge_user_items(&username, items).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({"ok": true})))
}
