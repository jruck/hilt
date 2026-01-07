use crate::types::{InboxItem, InboxResponse, InboxSection};
use std::fs;
use std::path::PathBuf;

/// Get the inbox file path for a scope
fn get_inbox_path(scope: &str) -> PathBuf {
    PathBuf::from(scope).join("docs").join("inbox.json")
}

/// Load inbox items from file
fn load_inbox(scope: &str) -> Result<Vec<InboxSection>, String> {
    let path = get_inbox_path(scope);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let sections: Vec<InboxSection> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(sections)
}

/// Save inbox items to file
fn save_inbox(scope: &str, sections: &[InboxSection]) -> Result<(), String> {
    let path = get_inbox_path(scope);

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let content = serde_json::to_string_pretty(sections).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Get all inbox items for a scope
#[tauri::command]
pub async fn get_inbox(scope: String) -> Result<InboxResponse, String> {
    let sections = load_inbox(&scope)?;
    Ok(InboxResponse { sections })
}

/// Add a new inbox item
#[tauri::command]
pub async fn add_inbox_item(
    scope: String,
    section_name: String,
    content: String,
) -> Result<InboxItem, String> {
    let mut sections = load_inbox(&scope)?;

    // Find existing section index or mark as needing creation
    let section_idx = sections
        .iter()
        .position(|s| s.name == section_name);

    // Create section if not found
    let section_idx = match section_idx {
        Some(idx) => idx,
        None => {
            sections.push(InboxSection {
                name: section_name.clone(),
                items: Vec::new(),
            });
            sections.len() - 1
        }
    };

    // Create new item
    let item = InboxItem {
        id: uuid::Uuid::new_v4().to_string(),
        content,
        created_at: chrono::Utc::now().to_rfc3339(),
        source: None,
    };

    sections[section_idx].items.push(item.clone());
    save_inbox(&scope, &sections)?;

    Ok(item)
}

/// Update an inbox item
#[tauri::command]
pub async fn update_inbox_item(
    scope: String,
    item_id: String,
    content: String,
) -> Result<(), String> {
    let mut sections = load_inbox(&scope)?;

    for section in sections.iter_mut() {
        if let Some(item) = section.items.iter_mut().find(|i| i.id == item_id) {
            item.content = content;
            save_inbox(&scope, &sections)?;
            return Ok(());
        }
    }

    Err(format!("Item {} not found", item_id))
}

/// Delete an inbox item
#[tauri::command]
pub async fn delete_inbox_item(scope: String, item_id: String) -> Result<(), String> {
    let mut sections = load_inbox(&scope)?;

    for section in sections.iter_mut() {
        let original_len = section.items.len();
        section.items.retain(|i| i.id != item_id);
        if section.items.len() != original_len {
            // Remove empty sections
            sections.retain(|s| !s.items.is_empty());
            save_inbox(&scope, &sections)?;
            return Ok(());
        }
    }

    Err(format!("Item {} not found", item_id))
}

/// Move an inbox item to a different section
#[tauri::command]
pub async fn move_inbox_item(
    scope: String,
    item_id: String,
    target_section: String,
) -> Result<(), String> {
    let mut sections = load_inbox(&scope)?;

    // Find and remove the item
    let mut found_item: Option<InboxItem> = None;
    for section in sections.iter_mut() {
        if let Some(pos) = section.items.iter().position(|i| i.id == item_id) {
            found_item = Some(section.items.remove(pos));
            break;
        }
    }

    let item = found_item.ok_or_else(|| format!("Item {} not found", item_id))?;

    // Find or create target section
    let target_idx = sections.iter().position(|s| s.name == target_section);
    match target_idx {
        Some(idx) => {
            sections[idx].items.push(item);
        }
        None => {
            sections.push(InboxSection {
                name: target_section,
                items: vec![item],
            });
        }
    }

    // Remove empty sections
    sections.retain(|s| !s.items.is_empty());
    save_inbox(&scope, &sections)?;

    Ok(())
}
