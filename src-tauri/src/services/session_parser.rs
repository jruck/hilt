use crate::types::{Session, SessionStatus};
use chrono::{DateTime, Utc};
use regex::Regex;
use serde::Deserialize;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Get the Claude projects directory
pub fn get_claude_projects_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("projects")
}

/// Get the Claude plans directory
pub fn get_claude_plans_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("plans")
}

/// Check if a session is currently running (modified within 30 seconds)
const RUNNING_THRESHOLD_MS: u128 = 30_000;

pub fn is_session_running(path: &Path) -> bool {
    if let Ok(metadata) = fs::metadata(path) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = modified.elapsed() {
                return duration.as_millis() < RUNNING_THRESHOLD_MS;
            }
        }
    }
    false
}

/// Get the file modification time in milliseconds since epoch
pub fn get_file_mtime_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

/// Decode a project path from Claude's encoded format
/// Claude encodes paths by replacing / with -
/// e.g., "-Users-jruck-Work-Code" -> "/Users/jruck/Work/Code"
pub fn decode_project_path(encoded: &str) -> String {
    if encoded.starts_with('-') {
        // Leading dash represents root /
        let rest = &encoded[1..];
        format!("/{}", rest.replace('-', "/"))
    } else {
        encoded.replace('-', "/")
    }
}

/// Encode a project path to Claude's format
pub fn encode_project_path(path: &str) -> String {
    path.replace('/', "-")
}

/// JSONL entry types from Claude session files
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum JsonlEntry {
    #[serde(rename = "summary")]
    Summary {
        summary: String,
        #[serde(rename = "leafUuid")]
        leaf_uuid: Option<String>,
    },
    #[serde(rename = "user")]
    User {
        timestamp: String,
        message: UserMessage,
        #[serde(rename = "gitBranch")]
        git_branch: Option<String>,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
        cwd: Option<String>,
    },
    #[serde(rename = "assistant")]
    Assistant {
        timestamp: String,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
        #[serde(rename = "gitBranch")]
        git_branch: Option<String>,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct UserMessage {
    content: String,
}

/// Parse a single session JSONL file
pub fn parse_session_file(path: &Path) -> Option<Session> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    let filename = path.file_stem()?.to_str()?;
    let id = filename.to_string();

    let mut summaries: Vec<String> = Vec::new();
    let mut last_timestamp: Option<DateTime<Utc>> = None;
    let mut message_count = 0u32;
    let mut git_branch: Option<String> = None;
    let mut first_prompt: Option<String> = None;
    let mut last_prompt: Option<String> = None;
    let mut slugs: Vec<String> = Vec::new();

    // Regex to extract slug from session ID like "session-name-abc123"
    let slug_regex = Regex::new(r"^([a-z]+-[a-z]+-[a-z]+)-").ok()?;

    for line in reader.lines().flatten() {
        if let Ok(entry) = serde_json::from_str::<JsonlEntry>(&line) {
            match entry {
                JsonlEntry::Summary { summary, .. } => {
                    summaries.push(summary);
                }
                JsonlEntry::User {
                    timestamp,
                    message,
                    git_branch: branch,
                    session_id,
                    ..
                } => {
                    message_count += 1;
                    if first_prompt.is_none() {
                        first_prompt = Some(message.content.clone());
                    }
                    last_prompt = Some(message.content);
                    if let Ok(ts) = timestamp.parse::<DateTime<Utc>>() {
                        last_timestamp = Some(ts);
                    }
                    if branch.is_some() {
                        git_branch = branch;
                    }
                    // Extract slug from session_id if present
                    if let Some(sid) = session_id {
                        if let Some(caps) = slug_regex.captures(&sid) {
                            if let Some(slug) = caps.get(1) {
                                let slug_str = slug.as_str().to_string();
                                if !slugs.contains(&slug_str) {
                                    slugs.push(slug_str);
                                }
                            }
                        }
                    }
                }
                JsonlEntry::Assistant { timestamp, git_branch: branch, .. } => {
                    message_count += 1;
                    if let Ok(ts) = timestamp.parse::<DateTime<Utc>>() {
                        last_timestamp = Some(ts);
                    }
                    if branch.is_some() {
                        git_branch = branch;
                    }
                }
                JsonlEntry::Other => {}
            }
        }
    }

    // Use most recent summary as title, or fall back to first prompt
    let title = summaries.last().cloned().unwrap_or_else(|| {
        first_prompt
            .clone()
            .map(|p| p.chars().take(100).collect())
            .unwrap_or_else(|| "Untitled Session".to_string())
    });

    // Derive project path from parent directory
    let parent = path.parent()?;
    let project = parent.file_name()?.to_str()?.to_string();
    let project_path = decode_project_path(&project);

    // Get current slug (last one in list)
    let slug = slugs.last().cloned();

    // Check for plan files
    let plans_dir = get_claude_plans_dir();
    let plan_slugs: Vec<String> = slugs
        .iter()
        .filter(|s| plans_dir.join(format!("{}.md", s)).exists())
        .cloned()
        .collect();

    // Format timestamp as ISO string
    let updated_at = last_timestamp
        .unwrap_or_else(Utc::now)
        .to_rfc3339();

    Some(Session {
        id,
        title,
        project,
        project_path: Some(project_path),
        updated_at,
        message_count,
        git_branch,
        first_prompt,
        last_prompt,
        slug,
        slugs,
        status: SessionStatus::Recent,
        sort_order: None,
        starred: None,
        is_running: Some(is_session_running(path)),
        plan_slugs: if plan_slugs.is_empty() { None } else { Some(plan_slugs) },
        terminal_id: None,
    })
}

/// Get all sessions, optionally filtered by scope
pub fn get_all_sessions(scope: Option<&str>) -> Result<Vec<Session>, String> {
    let projects_dir = get_claude_projects_dir();
    let mut sessions = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    let entries = fs::read_dir(&projects_dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Ok(files) = fs::read_dir(&path) {
                for file in files.flatten() {
                    let file_path = file.path();
                    if file_path.extension().is_some_and(|e| e == "jsonl") {
                        if let Some(mut session) = parse_session_file(&file_path) {
                            // Skip duplicates
                            if seen_ids.contains(&session.id) {
                                continue;
                            }
                            seen_ids.insert(session.id.clone());

                            // Apply scope filter (exact match for board mode)
                            if let Some(scope) = scope {
                                if !scope.is_empty() {
                                    if let Some(ref project_path) = session.project_path {
                                        if project_path != scope {
                                            continue;
                                        }
                                    } else {
                                        continue;
                                    }
                                }
                            }

                            // Update running status
                            session.is_running = Some(is_session_running(&file_path));
                            sessions.push(session);
                        }
                    }
                }
            }
        }
    }

    // Sort by updated_at descending
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(sessions)
}

/// Get a session by ID
pub fn get_session_by_id(session_id: &str) -> Option<Session> {
    let projects_dir = get_claude_projects_dir();

    if let Ok(entries) = fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let session_path = path.join(format!("{}.jsonl", session_id));
                if session_path.exists() {
                    return parse_session_file(&session_path);
                }
            }
        }
    }
    None
}

/// Get all project folders that have sessions
pub fn get_project_folders(scope: Option<&str>) -> Vec<String> {
    let projects_dir = get_claude_projects_dir();
    let mut folders = std::collections::HashSet::new();

    if let Ok(entries) = fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    let decoded = decode_project_path(name);

                    // Apply scope filter
                    if let Some(scope) = scope {
                        if !scope.is_empty() && !decoded.starts_with(scope) {
                            continue;
                        }
                    }

                    folders.insert(decoded);
                }
            }
        }
    }

    let mut result: Vec<String> = folders.into_iter().collect();
    result.sort();
    result
}
