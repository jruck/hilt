use crate::services::PtyManager;
use std::sync::Mutex;
use tauri::{AppHandle, State};

/// Spawn a new terminal
#[tauri::command]
pub async fn spawn_terminal(
    app: AppHandle,
    terminal_id: String,
    session_id: String,
    project_path: String,
    is_new: bool,
    initial_prompt: Option<String>,
    pty_manager: State<'_, Mutex<PtyManager>>,
) -> Result<(), String> {
    let manager = pty_manager.lock().map_err(|e| e.to_string())?;
    manager.spawn(
        &app,
        &terminal_id,
        &session_id,
        &project_path,
        is_new,
        initial_prompt,
    )
}

/// Write data to a terminal
#[tauri::command]
pub async fn write_terminal(
    terminal_id: String,
    data: String,
    pty_manager: State<'_, Mutex<PtyManager>>,
) -> Result<(), String> {
    let manager = pty_manager.lock().map_err(|e| e.to_string())?;
    manager.write(&terminal_id, &data)
}

/// Resize a terminal
#[tauri::command]
pub async fn resize_terminal(
    terminal_id: String,
    cols: u16,
    rows: u16,
    pty_manager: State<'_, Mutex<PtyManager>>,
) -> Result<(), String> {
    let manager = pty_manager.lock().map_err(|e| e.to_string())?;
    manager.resize(&terminal_id, cols, rows)
}

/// Kill a terminal
#[tauri::command]
pub async fn kill_terminal(
    terminal_id: String,
    pty_manager: State<'_, Mutex<PtyManager>>,
) -> Result<(), String> {
    let manager = pty_manager.lock().map_err(|e| e.to_string())?;
    manager.kill(&terminal_id)
}

/// Get all active terminal IDs
#[tauri::command]
pub async fn get_active_terminals(
    pty_manager: State<'_, Mutex<PtyManager>>,
) -> Result<Vec<String>, String> {
    let manager = pty_manager.lock().map_err(|e| e.to_string())?;
    Ok(manager.get_all_ids())
}

/// Check if a terminal exists
#[tauri::command]
pub async fn has_terminal(
    terminal_id: String,
    pty_manager: State<'_, Mutex<PtyManager>>,
) -> Result<bool, String> {
    let manager = pty_manager.lock().map_err(|e| e.to_string())?;
    Ok(manager.has(&terminal_id))
}
