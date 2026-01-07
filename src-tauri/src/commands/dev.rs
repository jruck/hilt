use crate::services::DevModeManager;
use std::sync::Mutex;
use tauri::{AppHandle, State};

/// Toggle dev mode
#[tauri::command]
pub async fn toggle_dev_mode(
    app: AppHandle,
    dev_manager: State<'_, Mutex<DevModeManager>>,
) -> Result<bool, String> {
    let manager = dev_manager.lock().map_err(|e| e.to_string())?;
    manager.toggle(&app)
}

/// Check if dev mode is enabled
#[tauri::command]
pub async fn is_dev_mode_enabled(
    dev_manager: State<'_, Mutex<DevModeManager>>,
) -> Result<bool, String> {
    let manager = dev_manager.lock().map_err(|e| e.to_string())?;
    Ok(manager.is_enabled())
}

/// Start dev mode
#[tauri::command]
pub async fn start_dev_mode(
    app: AppHandle,
    dev_manager: State<'_, Mutex<DevModeManager>>,
) -> Result<(), String> {
    let manager = dev_manager.lock().map_err(|e| e.to_string())?;
    manager.start(&app)
}

/// Stop dev mode
#[tauri::command]
pub async fn stop_dev_mode(
    app: AppHandle,
    dev_manager: State<'_, Mutex<DevModeManager>>,
) -> Result<(), String> {
    let manager = dev_manager.lock().map_err(|e| e.to_string())?;
    manager.stop(&app)
}
