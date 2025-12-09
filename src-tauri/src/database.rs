use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use crate::models::{MediaItem, CollectionData};
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

    pub fn get_all(&self) -> Result<Vec<MediaItem>, String> {
        let data = self.cache.lock().map_err(|e| e.to_string())?;
        Ok(data.items.clone())
    }

    pub fn add_item(&self, item: MediaItem) -> Result<(), String> {
        let mut data = self.cache.lock().map_err(|e| e.to_string())?;
        // Remove existing if any (update logic)
        data.items.retain(|i| i.id != item.id);
        data.items.push(item);
        drop(data); // unlock before save
        self.save()
    }

    pub fn remove_item(&self, id: &str) -> Result<(), String> {
        let mut data = self.cache.lock().map_err(|e| e.to_string())?;
        data.items.retain(|i| i.id != id);
        drop(data);
        self.save()
    }
    
    #[allow(dead_code)]
    pub fn update_item(&self, item: MediaItem) -> Result<(), String> {
        self.add_item(item)
    }
    
    // Bulk import
    pub fn import(&self, items: Vec<MediaItem>) -> Result<(), String> {
         let mut data = self.cache.lock().map_err(|e| e.to_string())?;
         // Merge logic: Add if ID doesn't exist
         let existing_ids: Vec<String> = data.items.iter().map(|i| i.id.clone()).collect();
         for item in items {
             if !existing_ids.contains(&item.id) {
                 data.items.push(item);
             }
         }
         drop(data);
         self.save()
    }
}
