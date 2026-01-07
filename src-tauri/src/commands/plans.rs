use crate::types::PlanResponse;
use std::fs;
use std::path::PathBuf;

/// Get the plans directory path
fn get_plans_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|p| p.join(".claude").join("plans"))
        .ok_or_else(|| "Could not find home directory".to_string())
}

/// Get all plans
#[tauri::command]
pub async fn get_plans() -> Result<Vec<PlanResponse>, String> {
    let plans_dir = get_plans_dir()?;

    if !plans_dir.exists() {
        return Ok(Vec::new());
    }

    let mut plans: Vec<PlanResponse> = Vec::new();

    let read_dir = fs::read_dir(&plans_dir).map_err(|e| e.to_string())?;

    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.extension().is_some_and(|ext| ext == "md") {
            let slug = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;

            let metadata = fs::metadata(&path).ok();
            let modified_at = metadata
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    chrono::DateTime::<chrono::Utc>::from(t)
                        .to_rfc3339()
                })
                .unwrap_or_default();

            plans.push(PlanResponse {
                slug,
                path: path.to_string_lossy().to_string(),
                content,
                modified_at,
            });
        }
    }

    // Sort by modification time (newest first)
    plans.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

    Ok(plans)
}

/// Get a single plan by slug
#[tauri::command]
pub async fn get_plan(slug: String) -> Result<Option<PlanResponse>, String> {
    let plans_dir = get_plans_dir()?;
    let path = plans_dir.join(format!("{}.md", slug));

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;

    let metadata = fs::metadata(&path).ok();
    let modified_at = metadata
        .and_then(|m| m.modified().ok())
        .map(|t| {
            chrono::DateTime::<chrono::Utc>::from(t)
                .to_rfc3339()
        })
        .unwrap_or_default();

    Ok(Some(PlanResponse {
        slug,
        path: path.to_string_lossy().to_string(),
        content,
        modified_at,
    }))
}

/// Update a plan's content
#[tauri::command]
pub async fn update_plan(slug: String, content: String) -> Result<(), String> {
    let plans_dir = get_plans_dir()?;

    // Ensure directory exists
    fs::create_dir_all(&plans_dir).map_err(|e| e.to_string())?;

    let path = plans_dir.join(format!("{}.md", slug));
    fs::write(&path, content).map_err(|e| e.to_string())?;

    Ok(())
}

/// Delete a plan
#[tauri::command]
pub async fn delete_plan(slug: String) -> Result<(), String> {
    let plans_dir = get_plans_dir()?;
    let path = plans_dir.join(format!("{}.md", slug));

    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Create a new plan
#[tauri::command]
pub async fn create_plan(slug: String, content: String) -> Result<PlanResponse, String> {
    let plans_dir = get_plans_dir()?;

    // Ensure directory exists
    fs::create_dir_all(&plans_dir).map_err(|e| e.to_string())?;

    let path = plans_dir.join(format!("{}.md", slug));

    if path.exists() {
        return Err(format!("Plan {} already exists", slug));
    }

    fs::write(&path, &content).map_err(|e| e.to_string())?;

    let modified_at = chrono::Utc::now().to_rfc3339();

    Ok(PlanResponse {
        slug,
        path: path.to_string_lossy().to_string(),
        content,
        modified_at,
    })
}
