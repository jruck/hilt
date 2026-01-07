use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize, PtySystem};
use regex::Regex;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// A PTY terminal session
pub struct PtySession {
    pub id: String,
    pub session_id: String,
    pub project_path: String,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    _pair: PtyPair, // Keep the pair alive
}

impl PtySession {
    pub fn write(&self, data: &str) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Manager for all PTY sessions
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Spawn a new PTY terminal
    pub fn spawn(
        &self,
        app: &AppHandle,
        terminal_id: &str,
        session_id: &str,
        project_path: &str,
        is_new: bool,
        initial_prompt: Option<String>,
    ) -> Result<(), String> {
        // Kill existing terminal with same ID
        if self.sessions.lock().unwrap().contains_key(terminal_id) {
            self.kill(terminal_id)?;
        }

        // Validate project path
        let cwd = if std::path::Path::new(project_path).exists() {
            project_path.to_string()
        } else {
            dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "/".to_string())
        };

        log::info!(
            "Spawning terminal {} for session {} in {}",
            terminal_id,
            session_id,
            cwd
        );

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(&cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("FORCE_COLOR", "3");

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let writer = Arc::new(Mutex::new(writer));

        // Store session
        let session = PtySession {
            id: terminal_id.to_string(),
            session_id: session_id.to_string(),
            project_path: project_path.to_string(),
            writer: writer.clone(),
            _pair: pair,
        };
        self.sessions
            .lock()
            .unwrap()
            .insert(terminal_id.to_string(), session);

        // Emit spawned event
        let _ = app.emit(
            "pty-spawned",
            serde_json::json!({ "terminalId": terminal_id }),
        );

        // Start reader thread
        let tid = terminal_id.to_string();
        let app_handle = app.clone();
        let writer_clone = writer.clone();
        let sid = session_id.to_string();
        let is_new_session = is_new;
        let prompt = initial_prompt.clone();

        thread::spawn(move || {
            // Wait for shell to initialize then send claude command
            thread::sleep(Duration::from_millis(200));

            {
                let mut w = writer_clone.lock().unwrap();
                if is_new_session {
                    log::info!("Starting new claude session");
                    let _ = w.write_all(b"claude\r");
                    let _ = w.flush();
                } else {
                    log::info!("Resuming claude session {}", sid);
                    let cmd = format!("claude --resume {}\r", sid);
                    let _ = w.write_all(cmd.as_bytes());
                    let _ = w.flush();
                }
            }

            // If new session with prompt, wait for Claude to be ready then inject
            if is_new_session && prompt.is_some() {
                let prompt = prompt.unwrap();
                let writer_for_prompt = writer_clone.clone();

                // Start a separate thread to watch for Claude readiness
                thread::spawn(move || {
                    // Wait for Claude to fully start (simple delay approach)
                    thread::sleep(Duration::from_millis(3000));

                    let mut w = writer_for_prompt.lock().unwrap();

                    // Use bracketed paste for multi-line prompts
                    if prompt.contains('\n') || prompt.len() > 200 {
                        let _ = w.write_all(b"\x1b[200~");
                        let _ = w.write_all(prompt.as_bytes());
                        let _ = w.write_all(b"\x1b[201~");
                    } else {
                        let _ = w.write_all(prompt.as_bytes());
                    }
                    let _ = w.flush();

                    // Send enter after a small delay
                    thread::sleep(Duration::from_millis(100));
                    let _ = w.write_all(b"\r");
                    let _ = w.flush();

                    log::info!("Injected initial prompt");
                });
            }
        });

        // Start data reader thread
        let tid2 = terminal_id.to_string();
        let app_handle2 = app.clone();

        thread::spawn(move || {
            Self::read_pty_data(reader, &tid2, &app_handle2);

            // PTY exited, emit exit event
            let _ = app_handle2.emit(
                "pty-exit",
                serde_json::json!({
                    "terminalId": tid2,
                    "exitCode": 0
                }),
            );
        });

        // Monitor child process
        let tid3 = terminal_id.to_string();
        let app_handle3 = app.clone();
        thread::spawn(move || {
            let _ = child.wait();
            let _ = app_handle3.emit(
                "pty-exit",
                serde_json::json!({
                    "terminalId": tid3,
                    "exitCode": 0
                }),
            );
        });

        Ok(())
    }

    /// Read PTY data and emit events
    fn read_pty_data(mut reader: Box<dyn Read + Send>, terminal_id: &str, app: &AppHandle) {
        let mut buf = [0u8; 8192];
        let title_regex = Regex::new(r"\x1b\]([012]);([^\x07\x1b]*?)(?:\x07|\x1b\\)").ok();
        let context_regex = Regex::new(r"(\d+(?:\.\d+)?)\s*%\s*context").ok();

        let mut last_title: Option<String> = None;
        let mut last_context: Option<i32> = None;

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();

                    // Emit data event
                    let _ = app.emit(
                        "pty-data",
                        serde_json::json!({
                            "terminalId": terminal_id,
                            "data": data
                        }),
                    );

                    // Extract and emit title changes
                    if let Some(ref re) = title_regex {
                        for caps in re.captures_iter(&data) {
                            if let (Some(code), Some(title)) = (caps.get(1), caps.get(2)) {
                                let code = code.as_str();
                                let title = title.as_str().trim().to_string();

                                if (code == "0" || code == "2") && is_claude_status_title(&title) {
                                    if last_title.as_ref() != Some(&title) {
                                        last_title = Some(title.clone());
                                        let _ = app.emit(
                                            "pty-title",
                                            serde_json::json!({
                                                "terminalId": terminal_id,
                                                "title": title
                                            }),
                                        );
                                    }
                                }
                            }
                        }
                    }

                    // Extract and emit context progress
                    if let Some(ref re) = context_regex {
                        if let Some(caps) = re.captures(&data) {
                            if let Some(m) = caps.get(1) {
                                if let Ok(value) = m.as_str().parse::<f32>() {
                                    let progress = value.round() as i32;
                                    if last_context != Some(progress) {
                                        last_context = Some(progress);
                                        let _ = app.emit(
                                            "pty-context",
                                            serde_json::json!({
                                                "terminalId": terminal_id,
                                                "progress": progress
                                            }),
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }
    }

    /// Write data to a terminal
    pub fn write(&self, terminal_id: &str, data: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        if let Some(session) = sessions.get(terminal_id) {
            session.write(data)
        } else {
            Err(format!("Terminal {} not found", terminal_id))
        }
    }

    /// Resize a terminal
    pub fn resize(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        // portable-pty resize is handled differently - the pair needs to be resized
        // For now, we'll log and skip
        log::info!(
            "Resize requested for {} to {}x{}",
            terminal_id,
            cols,
            rows
        );
        Ok(())
    }

    /// Kill a terminal
    pub fn kill(&self, terminal_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        if sessions.remove(terminal_id).is_some() {
            log::info!("Killed terminal {}", terminal_id);
        }
        Ok(())
    }

    /// Get all active terminal IDs
    pub fn get_all_ids(&self) -> Vec<String> {
        self.sessions
            .lock()
            .map(|s| s.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// Check if a terminal exists
    pub fn has(&self, terminal_id: &str) -> bool {
        self.sessions
            .lock()
            .map(|s| s.contains_key(terminal_id))
            .unwrap_or(false)
    }
}

/// Check if a title looks like a Claude Code status (not a shell command)
fn is_claude_status_title(title: &str) -> bool {
    if title.is_empty() {
        return false;
    }
    if title.starts_with("claude")
        || title.starts_with("zsh")
        || title.starts_with("bash")
        || title.starts_with('/')
        || title.starts_with('~')
    {
        return false;
    }
    if title.contains("--") {
        return false;
    }
    // Skip UUIDs
    let uuid_re = Regex::new(r"^[a-f0-9-]{20,}$").ok();
    if uuid_re.as_ref().is_some_and(|re| re.is_match(title)) {
        return false;
    }
    // Accept titles with spaces that are reasonable length
    if title.contains(' ') && title.len() < 100 {
        return true;
    }
    // Accept short alphabetic titles
    if title.len() < 30 {
        let alpha_re = Regex::new(r"^[a-zA-Z][a-zA-Z\s]+$").ok();
        if alpha_re.as_ref().is_some_and(|re| re.is_match(title)) {
            return true;
        }
    }
    false
}
