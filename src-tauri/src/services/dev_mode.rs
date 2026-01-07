use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// Dev mode manager for hot-reload development
pub struct DevModeManager {
    dev_server: Arc<Mutex<Option<Child>>>,
    is_enabled: Arc<Mutex<bool>>,
}

impl Default for DevModeManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DevModeManager {
    pub fn new() -> Self {
        Self {
            dev_server: Arc::new(Mutex::new(None)),
            is_enabled: Arc::new(Mutex::new(false)),
        }
    }

    /// Check if dev mode is currently enabled
    pub fn is_enabled(&self) -> bool {
        *self.is_enabled.lock().unwrap()
    }

    /// Toggle dev mode on/off
    pub fn toggle(&self, app: &AppHandle) -> Result<bool, String> {
        let is_enabled = self.is_enabled();
        if is_enabled {
            self.stop(app)?;
        } else {
            self.start(app)?;
        }
        Ok(!is_enabled)
    }

    /// Start the dev server
    pub fn start(&self, app: &AppHandle) -> Result<(), String> {
        if self.is_enabled() {
            return Ok(());
        }

        // Get the app's resource directory to find the project root
        let resource_path = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?;

        // In dev mode, we're running from the project directory
        // In production, we'd need to handle this differently
        let project_root = if cfg!(debug_assertions) {
            std::env::current_dir().map_err(|e| e.to_string())?
        } else {
            resource_path
        };

        log::info!("Starting dev server in {:?}", project_root);

        // Start the Next.js dev server
        let child = Command::new("npm")
            .arg("run")
            .arg("dev")
            .current_dir(&project_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start dev server: {}", e))?;

        *self.dev_server.lock().unwrap() = Some(child);
        *self.is_enabled.lock().unwrap() = true;

        // Emit event to frontend
        let _ = app.emit("dev-mode-changed", serde_json::json!({ "enabled": true }));

        log::info!("Dev server started");
        Ok(())
    }

    /// Stop the dev server
    pub fn stop(&self, app: &AppHandle) -> Result<(), String> {
        if !self.is_enabled() {
            return Ok(());
        }

        let mut server = self.dev_server.lock().unwrap();
        if let Some(ref mut child) = *server {
            // Kill the process and all children
            #[cfg(target_os = "macos")]
            {
                let pid = child.id();
                // Kill the process group
                let _ = Command::new("kill")
                    .args(["-TERM", "-", &pid.to_string()])
                    .spawn();
            }

            let _ = child.kill();
            let _ = child.wait();
        }
        *server = None;
        *self.is_enabled.lock().unwrap() = false;

        // Emit event to frontend
        let _ = app.emit(
            "dev-mode-changed",
            serde_json::json!({ "enabled": false }),
        );

        log::info!("Dev server stopped");
        Ok(())
    }
}

impl Drop for DevModeManager {
    fn drop(&mut self) {
        // Clean up dev server on drop
        let mut server = self.dev_server.lock().unwrap();
        if let Some(ref mut child) = *server {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Build the Developer menu for macOS
#[cfg(target_os = "macos")]
pub fn build_dev_menu(
    is_dev_mode: bool,
) -> tauri::menu::Submenu<tauri::Wry> {
    use tauri::menu::{MenuBuilder, SubmenuBuilder, CheckMenuItemBuilder, MenuItemBuilder};

    // This will be called from the setup function where we have access to the app handle
    // For now, return a placeholder that will be built properly in main.rs
    unimplemented!("Dev menu should be built in main.rs with app handle")
}

/// Create the dev mode menu item
pub fn create_dev_mode_menu_item(app: &AppHandle, is_checked: bool) -> Result<tauri::menu::CheckMenuItem<tauri::Wry>, String> {
    use tauri::menu::CheckMenuItemBuilder;

    CheckMenuItemBuilder::new("Dev Mode (Hot Reload)")
        .id("dev_mode_toggle")
        .checked(is_checked)
        .accelerator("CmdOrCtrl+Shift+D")
        .build(app)
        .map_err(|e| e.to_string())
}

/// Handle dev mode menu events
pub fn handle_dev_mode_event(
    app: &AppHandle,
    dev_manager: &DevModeManager,
    menu_item: &tauri::menu::CheckMenuItem<tauri::Wry>,
) -> Result<(), String> {
    let new_state = dev_manager.toggle(app)?;
    menu_item.set_checked(new_state).map_err(|e| e.to_string())?;

    // Show notification
    let message = if new_state {
        "Dev mode enabled - hot reload active"
    } else {
        "Dev mode disabled"
    };

    log::info!("{}", message);
    Ok(())
}
