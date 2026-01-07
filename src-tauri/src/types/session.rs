use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub project: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    pub updated_at: String,
    pub message_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(default)]
    pub slugs: Vec<String>,
    #[serde(default)]
    pub status: SessionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_running: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_slugs: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Inbox,
    Active,
    #[default]
    Recent,
}

impl std::fmt::Display for SessionStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SessionStatus::Inbox => write!(f, "inbox"),
            SessionStatus::Active => write!(f, "active"),
            SessionStatus::Recent => write!(f, "recent"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsResponse {
    pub sessions: Vec<Session>,
    pub counts: SessionCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionCounts {
    pub inbox: i32,
    pub active: i32,
    pub recent: i32,
    pub running: i32,
}

/// Stored session status in the database
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoredSessionStatus {
    pub status: Option<String>,
    pub sort_order: Option<i32>,
    pub starred: Option<bool>,
}
