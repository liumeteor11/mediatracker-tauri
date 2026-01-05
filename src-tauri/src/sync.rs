use axum::{routing::get, Router, Json, extract::State};
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::collections::HashMap;
use crate::database::Database;
use crate::models::CollectionData;
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
        
        // Enable CORS
        use tower_http::cors::CorsLayer;
        let cors = CorsLayer::permissive();

        let app = Router::new()
            .route("/sync/data", get(get_data).post(receive_data))
            .layer(cors)
            .with_state(state);

        let ip = local_ip().unwrap_or("0.0.0.0".parse().unwrap());
        let addr = SocketAddr::from((ip, self.port));
        
        println!("Starting Sync Server on {}", addr);
        
        // Announce via mDNS
        let hostname = get_hostname();
        let service_type = "_mediatracker._tcp.local.";
        let instance_name = format!("MediaTracker_{}", hostname);
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
        let service_type = "_mediatracker._tcp.local.";

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

async fn get_data(State(state): State<SyncState>) -> Json<CollectionData> {
    let data = state.db.get_full_data().unwrap_or_default();
    Json(data)
}

async fn receive_data(State(state): State<SyncState>, Json(payload): Json<CollectionData>) -> Json<serde_json::Value> {
    state.db.merge_full_data(payload).unwrap();
    Json(serde_json::json!({"ok": true}))
}
