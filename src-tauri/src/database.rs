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
        list.insert(0, item);
        drop(data);
        self.save()
    }

    pub fn reorder_items_for_user(&self, username: &str, new_order_ids: Vec<String>) -> Result<(), String> {
        let mut data = self.cache.lock().map_err(|e| e.to_string())?;
        if let Some(list) = data.items_by_user.get_mut(username) {
            let mut id_map: std::collections::HashMap<String, MediaItem> = list.drain(..).map(|item| (item.id.clone(), item)).collect();
            let mut new_list = Vec::new();
            
            for id in new_order_ids {
                if let Some(item) = id_map.remove(&id) {
                    new_list.push(item);
                }
            }
            
            // Append any remaining items that were not in new_order_ids (just in case)
            // Ideally this shouldn't happen if the frontend sends all IDs, but safety first.
            // Or maybe we should put them at the end?
            // If the user drags items, they should be sending the full list of IDs.
            // If some are missing, they might get deleted if we don't handle them.
            // Let's assume new_order_ids is the FULL list.
            // But if id_map is not empty, it means some items were missed. We should add them back.
            // However, since we used a HashMap, the order is lost for remaining items.
            // Let's re-iterate the original list? No, we drained it.
            // Let's just append remaining items.
             for (_, item) in id_map {
                new_list.push(item);
            }
            
            *list = new_list;
        }
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

    pub fn get_full_data(&self) -> Result<CollectionData, String> {
        let data = self.cache.lock().map_err(|e| e.to_string())?;
        Ok(data.clone())
    }

    pub fn merge_full_data(&self, incoming: CollectionData) -> Result<(), String> {
        let mut data = self.cache.lock().map_err(|e| e.to_string())?;
        
        // Merge Users
        for user in incoming.users {
            if !data.users.iter().any(|u| u.username == user.username) {
                data.users.push(user);
            }
        }

        // Merge Items per User
        for (username, incoming_items) in incoming.items_by_user {
            let local_items = data.items_by_user.entry(username).or_default();
            
            for item in incoming_items {
                if let Some(existing_idx) = local_items.iter().position(|i| i.id == item.id) {
                    // Update if incoming is newer (naive check: always update or check timestamps if available)
                    // Assuming last_edited_at exists
                    let existing = &local_items[existing_idx];
                    let incoming_ts = item.last_edited_at.unwrap_or(0);
                    let existing_ts = existing.last_edited_at.unwrap_or(0);
                    
                    if incoming_ts > existing_ts {
                        local_items[existing_idx] = item;
                    }
                } else {
                    local_items.push(item);
                }
            }
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
