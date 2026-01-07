use crate::types::{TodoItem, TodoResponse, TodoSection};
use chrono::Utc;
use regex::Regex;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

/// Get the Todo.md path for a given scope
pub fn get_todo_path(scope: Option<&str>) -> Option<PathBuf> {
    let scope = scope.filter(|s| !s.is_empty())?;
    Some(PathBuf::from(scope).join("docs").join("Todo.md"))
}

/// Parse a Todo.md file into todo items
pub fn parse_todo_md(scope: Option<&str>) -> TodoResponse {
    let path = match get_todo_path(scope) {
        Some(p) if p.exists() => p,
        _ => {
            return TodoResponse {
                items: vec![],
                sections: vec![],
                last_mod_time: None,
            };
        }
    };

    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => {
            return TodoResponse {
                items: vec![],
                sections: vec![],
                last_mod_time: None,
            };
        }
    };

    let last_mod_time = fs::metadata(&path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| {
            t.duration_since(std::time::SystemTime::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_millis() as u64)
        });

    // Regex patterns
    let heading_re = Regex::new(r"^(#{1,6})\s+(.+)$").unwrap();
    let checkbox_re = Regex::new(r"^-\s+\[([ xX])\]\s+(.+)$").unwrap();
    let id_re = Regex::new(r"<!--\s*id:([a-zA-Z0-9-]+)\s*-->").unwrap();

    let mut items: Vec<TodoItem> = Vec::new();
    let mut sections: Vec<TodoSection> = Vec::new();
    let mut current_section: Option<String> = None;
    let mut sort_order = 0;

    for line in content.lines() {
        // Check for heading
        if let Some(caps) = heading_re.captures(line) {
            let level = caps.get(1).map(|m| m.as_str().len()).unwrap_or(1) as u8;
            let heading = caps.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
            sections.push(TodoSection {
                heading: heading.clone(),
                level,
            });
            current_section = Some(heading);
            continue;
        }

        // Check for checkbox item
        if let Some(caps) = checkbox_re.captures(line) {
            let completed = caps
                .get(1)
                .map(|m| m.as_str() != " ")
                .unwrap_or(false);
            let text = caps.get(2).map(|m| m.as_str()).unwrap_or("");

            // Extract ID from HTML comment if present
            let id = id_re
                .captures(text)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
                .unwrap_or_else(|| Uuid::new_v4().to_string());

            // Remove ID comment from prompt text
            let prompt = id_re.replace(text, "").trim().to_string();

            items.push(TodoItem {
                id,
                prompt,
                completed,
                section: current_section.clone(),
                project_path: scope.map(|s| s.to_string()),
                created_at: Utc::now().to_rfc3339(),
                sort_order,
            });
            sort_order += 1;
        }
    }

    // Filter out completed items for the main view
    let items: Vec<TodoItem> = items.into_iter().filter(|i| !i.completed).collect();

    TodoResponse {
        items,
        sections,
        last_mod_time,
    }
}

/// Add an item to Todo.md
pub fn add_todo_item(scope: Option<&str>, prompt: &str, section: Option<&str>) -> Result<String, String> {
    let path = get_todo_path(scope).ok_or("No scope provided")?;

    // Ensure docs directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let id = Uuid::new_v4().to_string();
    let line = format!("- [ ] {} <!-- id:{} -->", prompt, id);

    let mut content = if path.exists() {
        fs::read_to_string(&path).unwrap_or_default()
    } else {
        String::new()
    };

    // If section specified, find it and add after it
    if let Some(section) = section {
        let section_re = Regex::new(&format!(r"(?m)^#+\s+{}\s*$", regex::escape(section))).unwrap();
        if let Some(m) = section_re.find(&content) {
            let insert_pos = m.end();
            // Find the next line break
            let next_line = content[insert_pos..].find('\n').map(|i| insert_pos + i + 1).unwrap_or(content.len());
            content.insert_str(next_line, &format!("{}\n", line));
        } else {
            // Section not found, append at end
            if !content.ends_with('\n') && !content.is_empty() {
                content.push('\n');
            }
            content.push_str(&format!("{}\n", line));
        }
    } else {
        // No section, append at end
        if !content.ends_with('\n') && !content.is_empty() {
            content.push('\n');
        }
        content.push_str(&format!("{}\n", line));
    }

    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(id)
}

/// Update an item in Todo.md
pub fn update_todo_item(
    scope: Option<&str>,
    id: &str,
    prompt: Option<&str>,
    completed: Option<bool>,
    section: Option<&str>,
) -> Result<(), String> {
    let path = get_todo_path(scope).ok_or("No scope provided")?;
    if !path.exists() {
        return Err("Todo.md not found".to_string());
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let id_pattern = format!("<!-- id:{} -->", id);

    let mut new_lines: Vec<String> = Vec::new();
    let mut found = false;

    for line in content.lines() {
        if line.contains(&id_pattern) {
            found = true;

            // Parse the existing line
            let checkbox_re = Regex::new(r"^(-\s+\[)([ xX])(\]\s+)(.+)(<!--\s*id:[a-zA-Z0-9-]+\s*-->)$").unwrap();
            if let Some(caps) = checkbox_re.captures(line) {
                let prefix = caps.get(1).map(|m| m.as_str()).unwrap_or("- [");
                let check_char = if let Some(c) = completed {
                    if c { "x" } else { " " }
                } else {
                    caps.get(2).map(|m| m.as_str()).unwrap_or(" ")
                };
                let mid = caps.get(3).map(|m| m.as_str()).unwrap_or("] ");
                let text = if let Some(p) = prompt {
                    p.to_string()
                } else {
                    caps.get(4)
                        .map(|m| m.as_str().trim())
                        .unwrap_or("")
                        .to_string()
                };
                let id_comment = caps.get(5).map(|m| m.as_str()).unwrap_or(&id_pattern);

                new_lines.push(format!("{}{}{}{} {}", prefix, check_char, mid, text, id_comment));
            } else {
                new_lines.push(line.to_string());
            }
        } else {
            new_lines.push(line.to_string());
        }
    }

    if !found {
        return Err(format!("Item with id {} not found", id));
    }

    // Handle section move if specified
    // TODO: Implement section move logic

    let _ = section; // Suppress unused warning for now

    let new_content = new_lines.join("\n");
    fs::write(&path, new_content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete an item from Todo.md
pub fn delete_todo_item(scope: Option<&str>, id: &str) -> Result<(), String> {
    let path = get_todo_path(scope).ok_or("No scope provided")?;
    if !path.exists() {
        return Err("Todo.md not found".to_string());
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let id_pattern = format!("<!-- id:{} -->", id);

    let new_lines: Vec<&str> = content
        .lines()
        .filter(|line| !line.contains(&id_pattern))
        .collect();

    let new_content = new_lines.join("\n");
    fs::write(&path, new_content).map_err(|e| e.to_string())?;
    Ok(())
}
