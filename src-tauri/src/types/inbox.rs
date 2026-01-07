use serde::{Deserialize, Serialize};

/// InboxItem for inbox.json format (simple inbox items)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub id: String,
    pub content: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// InboxSection for inbox.json format
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxSection {
    pub name: String,
    pub items: Vec<InboxItem>,
}

/// Response for inbox.json items
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxResponse {
    pub sections: Vec<InboxSection>,
}

/// TodoItem for Todo.md format (task items with completion status)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub prompt: String,
    pub completed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    pub created_at: String,
    pub sort_order: i32,
}

/// Section heading from Todo.md
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoSection {
    pub heading: String,
    pub level: u8,
}

/// Response for Todo.md items
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoResponse {
    pub items: Vec<TodoItem>,
    pub sections: Vec<TodoSection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_mod_time: Option<u64>,
}

/// Response for folder listing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FoldersResponse {
    pub folders: Vec<String>,
}

/// Response for plan operations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanResponse {
    pub slug: String,
    pub path: String,
    pub content: String,
    pub modified_at: String,
}
