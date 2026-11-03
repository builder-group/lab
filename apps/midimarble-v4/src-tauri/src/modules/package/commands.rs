use super::recent::{self, RecentProjectDto};
use super::store;
use serde::Serialize;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProjectDto {
    pub path: String,
    pub project_json: String,
}

#[tauri::command]
#[specta::specta]
pub fn create_project(
    app: AppHandle,
    path: String,
    project_json: String,
) -> Result<OpenedProjectDto, String> {
    let package = store::create_package(&PathBuf::from(path), &project_json)
        .map_err(|error| error.to_string())?;
    let _ = recent::remember(&app, &package);
    return Ok(OpenedProjectDto {
        path: package.display().to_string(),
        project_json,
    });
}

#[tauri::command]
#[specta::specta]
pub fn open_project(app: AppHandle, path: String) -> Result<OpenedProjectDto, String> {
    let package = PathBuf::from(path);
    let project_json = store::read_project(&package).map_err(|error| error.to_string())?;
    let _ = recent::remember(&app, &package);
    return Ok(OpenedProjectDto {
        path: package.display().to_string(),
        project_json,
    });
}

#[tauri::command]
#[specta::specta]
pub fn save_project(path: String, project_json: String) -> Result<(), String> {
    return store::save_project(&PathBuf::from(path), &project_json)
        .map_err(|error| error.to_string());
}

#[tauri::command]
#[specta::specta]
pub fn list_recent_projects(app: AppHandle) -> Vec<RecentProjectDto> {
    return recent::list(&app);
}
