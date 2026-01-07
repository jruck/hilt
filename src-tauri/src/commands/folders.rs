use crate::services::get_all_sessions;
use crate::types::FoldersResponse;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

/// Get subfolders with sessions for a given scope
#[tauri::command]
pub async fn get_subfolders(scope: String) -> Result<FoldersResponse, String> {
    let sessions = get_all_sessions(None)?;

    // Get all unique project paths that start with the scope
    let mut subfolders: HashSet<String> = HashSet::new();

    for session in &sessions {
        if let Some(ref project_path) = session.project_path {
            if project_path.starts_with(&scope) && project_path != &scope {
                // Get the immediate subdirectory
                let relative = project_path.strip_prefix(&scope).unwrap_or(project_path);
                let relative = relative.trim_start_matches('/');

                if let Some(first_component) = relative.split('/').next() {
                    if !first_component.is_empty() {
                        let subfolder_path = format!("{}/{}", scope, first_component);
                        subfolders.insert(subfolder_path);
                    }
                }
            }
        }
    }

    let mut folders: Vec<String> = subfolders.into_iter().collect();
    folders.sort();

    Ok(FoldersResponse { folders })
}

/// Get all folders in a directory (file system based, not session based)
#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<String>, String> {
    let path = Path::new(&path);
    if !path.exists() {
        return Err(format!("Path does not exist: {:?}", path));
    }

    let mut entries: Vec<String> = Vec::new();

    let read_dir = fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        // Only include directories, skip hidden
        if path.is_dir() {
            if let Some(name) = path.file_name() {
                let name_str = name.to_string_lossy();
                if !name_str.starts_with('.') {
                    entries.push(path.to_string_lossy().to_string());
                }
            }
        }
    }

    entries.sort();
    Ok(entries)
}

/// Check if a path exists
#[tauri::command]
pub async fn path_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

/// Create a directory
#[tauri::command]
pub async fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Get the Claude projects directory
#[tauri::command]
pub fn get_claude_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.join(".claude").join("projects").to_string_lossy().to_string())
        .ok_or_else(|| "Could not find home directory".to_string())
}
