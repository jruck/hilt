pub mod commands;
pub mod services;
pub mod types;

use commands::*;
use services::{DevModeManager, FileWatcher, PtyManager, SessionStatusDb};
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Initialize logging
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize dialog plugin for folder picker
            app.handle().plugin(tauri_plugin_dialog::init())?;

            // Initialize services
            let data_dir = services::get_data_dir();
            let session_db = SessionStatusDb::new(&data_dir);
            let pty_manager = PtyManager::new();
            let dev_manager = DevModeManager::new();
            let mut file_watcher = FileWatcher::new();

            // Start watching Claude sessions
            if let Err(e) = file_watcher.watch_sessions(app.handle()) {
                log::warn!("Failed to start session watcher: {}", e);
            }

            // Start watching plans directory
            if let Err(e) = services::watch_plans_directory(app.handle()) {
                log::warn!("Failed to start plans watcher: {}", e);
            }

            // Store services in app state
            app.manage(Mutex::new(session_db));
            app.manage(Mutex::new(pty_manager));
            app.manage(Mutex::new(dev_manager));
            app.manage(Mutex::new(file_watcher));

            // Build developer menu
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, CheckMenuItemBuilder};

                let dev_mode_item = CheckMenuItemBuilder::new("Dev Mode (Hot Reload)")
                    .id("dev_mode_toggle")
                    .accelerator("CmdOrCtrl+Shift+D")
                    .build(app)?;

                let reload_item = MenuItemBuilder::new("Reload Window")
                    .id("reload_window")
                    .accelerator("CmdOrCtrl+R")
                    .build(app)?;

                let dev_tools_item = MenuItemBuilder::new("Toggle Developer Tools")
                    .id("toggle_devtools")
                    .accelerator("CmdOrCtrl+Option+I")
                    .build(app)?;

                let developer_menu = SubmenuBuilder::new(app, "Developer")
                    .item(&dev_mode_item)
                    .separator()
                    .item(&reload_item)
                    .item(&dev_tools_item)
                    .build()?;

                let menu = MenuBuilder::new(app)
                    .item(&developer_menu)
                    .build()?;

                app.set_menu(menu)?;

                // Handle menu events
                app.on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "dev_mode_toggle" => {
                            let dev_manager = app.state::<Mutex<DevModeManager>>();
                            let result = dev_manager.lock().map(|manager| {
                                manager.toggle(app)
                            });
                            if let Ok(Err(e)) = result {
                                log::error!("Failed to toggle dev mode: {}", e);
                            }
                        }
                        "reload_window" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.eval("window.location.reload()");
                            }
                        }
                        "toggle_devtools" => {
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_devtools_open() {
                                    window.close_devtools();
                                } else {
                                    window.open_devtools();
                                }
                            }
                        }
                        _ => {}
                    }
                });
            }

            log::info!("Claude Kanban initialized");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Session commands
            get_sessions,
            get_session,
            update_session_status,
            get_home_dir,
            // Inbox commands
            get_inbox,
            add_inbox_item,
            update_inbox_item,
            delete_inbox_item,
            move_inbox_item,
            // Folder commands
            get_subfolders,
            list_directory,
            path_exists,
            create_directory,
            get_claude_dir,
            // Plan commands
            get_plans,
            get_plan,
            update_plan,
            delete_plan,
            create_plan,
            // Terminal commands
            spawn_terminal,
            write_terminal,
            resize_terminal,
            kill_terminal,
            get_active_terminals,
            has_terminal,
            // Dev mode commands
            toggle_dev_mode,
            is_dev_mode_enabled,
            start_dev_mode,
            stop_dev_mode,
            // Shell commands
            reveal_in_finder,
            open_path,
            pick_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
