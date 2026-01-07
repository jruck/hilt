use crate::services::{get_all_sessions, SessionStatusDb};
use crate::types::{Session, SessionCounts, SessionStatus, SessionsResponse};
use std::sync::Mutex;
use tauri::State;

/// Get all sessions, optionally filtered by scope
#[tauri::command]
pub async fn get_sessions(
    scope: Option<String>,
    db: State<'_, Mutex<SessionStatusDb>>,
) -> Result<SessionsResponse, String> {
    let mut sessions = get_all_sessions(scope.as_deref())?;

    // Merge with stored status from DB
    {
        let db = db.lock().map_err(|e| e.to_string())?;
        db.merge_with_sessions(&mut sessions);
    }

    // Sort sessions by status and then by updated time
    sessions.sort_by(|a, b| {
        // First by status priority (active > inbox > recent)
        let status_order = |s: &Session| match s.status {
            SessionStatus::Active => 0,
            SessionStatus::Inbox => 1,
            SessionStatus::Recent => 2,
        };
        let status_cmp = status_order(a).cmp(&status_order(b));
        if status_cmp != std::cmp::Ordering::Equal {
            return status_cmp;
        }

        // Then by sort_order if set
        match (a.sort_order, b.sort_order) {
            (Some(a_order), Some(b_order)) => a_order.cmp(&b_order),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => {
                // Finally by updated time (newest first)
                b.updated_at.cmp(&a.updated_at)
            }
        }
    });

    // Calculate counts
    let counts = SessionCounts {
        inbox: sessions
            .iter()
            .filter(|s| s.status == SessionStatus::Inbox)
            .count() as i32,
        active: sessions
            .iter()
            .filter(|s| s.status == SessionStatus::Active)
            .count() as i32,
        recent: sessions
            .iter()
            .filter(|s| s.status == SessionStatus::Recent)
            .count() as i32,
        running: sessions.iter().filter(|s| s.is_running == Some(true)).count() as i32,
    };

    Ok(SessionsResponse { sessions, counts })
}

/// Update a session's status
#[tauri::command]
pub async fn update_session_status(
    session_id: String,
    status: Option<String>,
    sort_order: Option<i32>,
    starred: Option<bool>,
    db: State<'_, Mutex<SessionStatusDb>>,
) -> Result<(), String> {
    let status = status.map(|s| match s.as_str() {
        "inbox" => SessionStatus::Inbox,
        "active" => SessionStatus::Active,
        _ => SessionStatus::Recent,
    });

    let db = db.lock().map_err(|e| e.to_string())?;
    db.update(&session_id, status, sort_order, starred);

    Ok(())
}

/// Get a single session by ID
#[tauri::command]
pub async fn get_session(
    session_id: String,
    db: State<'_, Mutex<SessionStatusDb>>,
) -> Result<Option<Session>, String> {
    let mut sessions = get_all_sessions(None)?;

    // Find the session
    let session = sessions.iter_mut().find(|s| s.id == session_id);

    if let Some(session) = session {
        // Merge with stored status
        let db = db.lock().map_err(|e| e.to_string())?;
        if let Some(stored) = db.get(&session_id) {
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
        Ok(Some(session.clone()))
    } else {
        Ok(None)
    }
}

/// Get home directory path
#[tauri::command]
pub fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not find home directory".to_string())
}
