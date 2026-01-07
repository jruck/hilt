use crate::types::{Session, SessionStatus, StoredSessionStatus};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

/// Session status database - persists kanban column assignments
pub struct SessionStatusDb {
    path: PathBuf,
    data: Mutex<HashMap<String, StoredSessionStatus>>,
}

impl SessionStatusDb {
    pub fn new(data_dir: &PathBuf) -> Self {
        let path = data_dir.join("session-status.json");
        let data = if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default()
        } else {
            HashMap::new()
        };

        Self {
            path,
            data: Mutex::new(data),
        }
    }

    pub fn get(&self, session_id: &str) -> Option<StoredSessionStatus> {
        self.data.lock().unwrap().get(session_id).cloned()
    }

    pub fn update(
        &self,
        session_id: &str,
        status: Option<SessionStatus>,
        sort_order: Option<i32>,
        starred: Option<bool>,
    ) {
        let mut data = self.data.lock().unwrap();
        let entry = data
            .entry(session_id.to_string())
            .or_insert_with(StoredSessionStatus::default);

        if let Some(s) = status {
            entry.status = Some(s.to_string());
        }
        if let Some(o) = sort_order {
            entry.sort_order = Some(o);
        }
        if let Some(s) = starred {
            entry.starred = Some(s);
        }

        self.save(&data);
    }

    pub fn merge_with_sessions(&self, sessions: &mut [Session]) {
        let data = self.data.lock().unwrap();
        for session in sessions.iter_mut() {
            if let Some(stored) = data.get(&session.id) {
                if let Some(ref status_str) = stored.status {
                    session.status = match status_str.as_str() {
                        "inbox" => SessionStatus::Inbox,
                        "active" => SessionStatus::Active,
                        _ => SessionStatus::Recent,
                    };
                }
                session.sort_order = stored.sort_order;
                session.starred = stored.starred;
            }

            // Auto-promote running sessions to active
            if session.is_running == Some(true) && session.status == SessionStatus::Recent {
                session.status = SessionStatus::Active;
            }
        }
    }

    fn save(&self, data: &HashMap<String, StoredSessionStatus>) {
        // Ensure parent directory exists
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(data) {
            let _ = fs::write(&self.path, json);
        }
    }
}

/// Get the data directory for the app
pub fn get_data_dir() -> PathBuf {
    // Check for DATA_DIR environment variable first
    if let Ok(dir) = std::env::var("DATA_DIR") {
        return PathBuf::from(dir);
    }

    // Use app data directory
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("claude-kanban")
}
