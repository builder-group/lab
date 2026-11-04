use super::store::{self, PROJECT_FILE};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const RECENT_FILE: &str = "recent-projects.json";
const RECENT_LIMIT: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecentProjectDto {
    pub path: String,
    pub name: String,
    pub opened_at: f64,
}

/// Lists recent packages that still exist, newest first
pub fn list(app: &AppHandle) -> Vec<RecentProjectDto> {
    return read(app)
        .into_iter()
        .filter(|item| Path::new(&item.path).join(PROJECT_FILE).is_file())
        .collect();
}

pub fn remember(app: &AppHandle, package: &Path) -> Option<()> {
    let file = recent_file(app)?;
    let path = package.display().to_string();
    let name = package
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled")
        .to_string();
    let opened_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis() as f64;
    let mut items: Vec<RecentProjectDto> = read(app)
        .into_iter()
        .filter(|item| item.path != path)
        .collect();
    items.insert(
        0,
        RecentProjectDto {
            path,
            name,
            opened_at,
        },
    );
    items.truncate(RECENT_LIMIT);
    fs::create_dir_all(file.parent()?).ok()?;
    let json = serde_json::to_string_pretty(&items).ok()?;
    return store::write_atomic(&file, json.as_bytes()).ok();
}

/// Clear Menu in Open Recent: forgets every recent project
pub fn clear(app: &AppHandle) -> Option<()> {
    let file = recent_file(app)?;
    if !file.exists() {
        return Some(());
    }
    return store::write_atomic(&file, b"[]").ok();
}

fn read(app: &AppHandle) -> Vec<RecentProjectDto> {
    let Some(file) = recent_file(app) else {
        return Vec::new();
    };
    return fs::read_to_string(file)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();
}

fn recent_file(app: &AppHandle) -> Option<PathBuf> {
    return app
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(RECENT_FILE));
}
