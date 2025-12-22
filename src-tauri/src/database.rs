use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use crate::models::{MediaItem, CollectionData, UserRecord};
use std::sync::Mutex;

pub struct Database {
    path: PathBuf,
    cache: Mutex<CollectionData>,
}

impl Database {
    pub fn new(app_handle: &AppHandle) -> Self {
        let app_dir = app_handle.path().app_data_dir().expect("Failed to get app data dir");
        if !app_dir.exists() {
            fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
        }
        let path = app_dir.join("collection.json");
        
        let data = if path.exists() {
            let content = fs::read_to_string(&path).unwrap_or_else(|_| "{}".to_string());
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            CollectionData::default()
        };

        Database {
            path,
            cache: Mutex::new(data),
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let data = self.cache.lock().map_err(|e| e.to_string())?;
        let content = serde_json::to_string_pretty(&*data).map_err(|e| e.to_string())?;
        fs::write(&self.path, content).map_err(|e| e.to_string())?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn get_all(&self) -> Result<Vec<MediaItem>, String> {
        let data = self.cache.lock().map_err(|e| e.to_string())?;
        Ok(data.items.clone())
    }

    pub fn get_all_for_user(&self, username: &str) -> Result<Vec<MediaItem>, String> {
        let data = self.cache.lock().map_err(|e| e.to_string())?;
        Ok(data.items_by_user.get(username).cloned().unwrap_or_default())
    }

    pub fn add_item_for_user(&self, username: &str, item: MediaItem) -> Result<(), String> {
        let mut data = self.cache.lock().map_err(|e| e.to_string())?;
        let list = data.items_by_user.entry(username.to_string()).or_default();
        list.retain(|i| i.id != item.id);
        list.push(item);
        drop(data);
        self.save()
    }

    pub fn remove_item_for_user(&self, username: &str, id: &str) -> Result<(), String> {
        let mut data = self.cache.lock().map_err(|e| e.to_string())?;
        if let Some(list) = data.items_by_user.get_mut(username) {
            list.retain(|i| i.id != id);
        }
        drop(data);
        self.save()
    }
    
    #[allow(dead_code)]
    pub fn update_item(&self, _item: MediaItem) -> Result<(), String> {
        Err("update_item deprecated; use per-user methods".to_string())
    }
    
    // Bulk import
    pub fn import_for_user(&self, username: &str, items: Vec<MediaItem>) -> Result<(), String> {
         let mut data = self.cache.lock().map_err(|e| e.to_string())?;
         let list = data.items_by_user.entry(username.to_string()).or_default();
         let existing_ids: Vec<String> = list.iter().map(|i| i.id.clone()).collect();
         for item in items {
             if !existing_ids.contains(&item.id) {
                 list.push(item);
             }
         }
         drop(data);
         self.save()
    }

    // --- Auth helpers ---
    pub fn find_user(&self, username: &str) -> Option<UserRecord> {
        let data = self.cache.lock().ok()?;
        data.users.iter().find(|u| u.username == username).cloned()
    }

    pub fn add_user(&self, user: UserRecord) -> Result<(), String> {
        let mut data = self.cache.lock().map_err(|e| e.to_string())?;
        if data.users.iter().any(|u| u.username == user.username) {
            return Err("User already exists".to_string());
        }
        data.users.push(user);
        drop(data);
        self.save()
    }
}
