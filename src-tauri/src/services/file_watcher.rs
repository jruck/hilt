use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// File watcher for monitoring Claude sessions and other files
pub struct FileWatcher {
    watcher: Option<RecommendedWatcher>,
    watching_paths: Arc<Mutex<Vec<PathBuf>>>,
}

impl Default for FileWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl FileWatcher {
    pub fn new() -> Self {
        Self {
            watcher: None,
            watching_paths: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Start watching Claude projects directory for session changes
    pub fn watch_sessions(&mut self, app: &AppHandle) -> Result<(), String> {
        let claude_dir = dirs::home_dir()
            .ok_or("Could not find home directory")?
            .join(".claude")
            .join("projects");

        if !claude_dir.exists() {
            return Err(format!("Claude projects directory not found: {:?}", claude_dir));
        }

        let (tx, rx) = channel();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = tx.send(event);
                }
            },
            Config::default().with_poll_interval(Duration::from_secs(2)),
        )
        .map_err(|e| e.to_string())?;

        watcher
            .watch(&claude_dir, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;

        self.watching_paths.lock().unwrap().push(claude_dir.clone());

        // Start event processing thread
        let app_handle = app.clone();
        thread::spawn(move || {
            Self::process_events(rx, &app_handle);
        });

        self.watcher = Some(watcher);
        log::info!("Started watching Claude sessions at {:?}", claude_dir);

        Ok(())
    }

    /// Watch a specific folder for changes (e.g., Todo.md)
    pub fn watch_folder(&mut self, path: PathBuf, app: &AppHandle) -> Result<(), String> {
        if !path.exists() {
            return Err(format!("Path does not exist: {:?}", path));
        }

        // If we already have a watcher, add this path to it
        if let Some(ref mut watcher) = self.watcher {
            watcher
                .watch(&path, RecursiveMode::NonRecursive)
                .map_err(|e| e.to_string())?;
            self.watching_paths.lock().unwrap().push(path.clone());
            log::info!("Added watch for {:?}", path);
        } else {
            // Create a new watcher
            let (tx, rx) = channel();

            let mut watcher = RecommendedWatcher::new(
                move |res: Result<Event, notify::Error>| {
                    if let Ok(event) = res {
                        let _ = tx.send(event);
                    }
                },
                Config::default().with_poll_interval(Duration::from_secs(1)),
            )
            .map_err(|e| e.to_string())?;

            watcher
                .watch(&path, RecursiveMode::NonRecursive)
                .map_err(|e| e.to_string())?;

            self.watching_paths.lock().unwrap().push(path.clone());

            let app_handle = app.clone();
            thread::spawn(move || {
                Self::process_events(rx, &app_handle);
            });

            self.watcher = Some(watcher);
            log::info!("Started watching {:?}", path);
        }

        Ok(())
    }

    /// Process file system events and emit to frontend
    fn process_events(rx: Receiver<Event>, app: &AppHandle) {
        // Debounce events
        let mut last_emit = std::time::Instant::now();
        let debounce_duration = Duration::from_millis(500);

        loop {
            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(event) => {
                    let now = std::time::Instant::now();
                    if now.duration_since(last_emit) < debounce_duration {
                        continue;
                    }
                    last_emit = now;

                    // Determine event type
                    let event_type = match event.kind {
                        notify::EventKind::Create(_) => "created",
                        notify::EventKind::Modify(_) => "modified",
                        notify::EventKind::Remove(_) => "removed",
                        _ => continue,
                    };

                    // Get affected paths
                    let paths: Vec<String> = event
                        .paths
                        .iter()
                        .map(|p| p.to_string_lossy().to_string())
                        .collect();

                    // Determine what kind of file changed
                    let file_type = if paths.iter().any(|p| p.ends_with(".jsonl")) {
                        "session"
                    } else if paths.iter().any(|p| p.contains("Todo.md")) {
                        "todo"
                    } else if paths.iter().any(|p| p.contains("inbox.json")) {
                        "inbox"
                    } else if paths.iter().any(|p| p.ends_with(".md")) {
                        "plan"
                    } else {
                        "other"
                    };

                    // Emit event to frontend
                    let _ = app.emit(
                        "file-changed",
                        serde_json::json!({
                            "type": event_type,
                            "fileType": file_type,
                            "paths": paths,
                        }),
                    );

                    log::debug!("File {} event: {:?}", event_type, paths);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Just continue, this is expected
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    log::info!("File watcher channel disconnected");
                    break;
                }
            }
        }
    }

    /// Stop watching all paths
    pub fn stop(&mut self) {
        if let Some(ref mut watcher) = self.watcher {
            let paths = self.watching_paths.lock().unwrap();
            for path in paths.iter() {
                let _ = watcher.unwatch(path);
            }
        }
        self.watcher = None;
        self.watching_paths.lock().unwrap().clear();
        log::info!("Stopped all file watchers");
    }
}

/// Watch the plans directory for new/updated plans
pub fn watch_plans_directory(app: &AppHandle) -> Result<(), String> {
    let plans_dir = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .join(".claude")
        .join("plans");

    if !plans_dir.exists() {
        // Create the directory if it doesn't exist
        std::fs::create_dir_all(&plans_dir).map_err(|e| e.to_string())?;
    }

    let (tx, rx) = channel();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        Config::default().with_poll_interval(Duration::from_secs(1)),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&plans_dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    let app_handle = app.clone();
    thread::spawn(move || {
        // Keep watcher alive
        let _watcher = watcher;

        loop {
            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(event) => {
                    // Only care about .md files
                    let md_paths: Vec<&std::path::Path> = event
                        .paths
                        .iter()
                        .filter(|p| p.extension().is_some_and(|ext| ext == "md"))
                        .map(|p| p.as_path())
                        .collect();

                    if md_paths.is_empty() {
                        continue;
                    }

                    for path in md_paths {
                        let slug = path
                            .file_stem()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_default();

                        let event_name = match event.kind {
                            notify::EventKind::Create(_) => "created",
                            notify::EventKind::Modify(_) => "updated",
                            notify::EventKind::Remove(_) => "removed",
                            _ => continue,
                        };

                        // Read content for create/modify
                        let content = if event_name != "removed" {
                            std::fs::read_to_string(path).ok()
                        } else {
                            None
                        };

                        let _ = app_handle.emit(
                            "plan-changed",
                            serde_json::json!({
                                "event": event_name,
                                "slug": slug,
                                "path": path.to_string_lossy(),
                                "content": content,
                            }),
                        );

                        log::info!("Plan {} {}", slug, event_name);
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    break;
                }
            }
        }
    });

    log::info!("Started watching plans directory at {:?}", plans_dir);
    Ok(())
}
