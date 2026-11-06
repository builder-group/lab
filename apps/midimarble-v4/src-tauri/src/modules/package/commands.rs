use super::recent::{self, RecentProjectDto};
use super::store;
use super::temporary;
use serde::Serialize;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProjectDto {
    pub path: String,
    pub project_json: String,
}

#[tauri::command(async)]
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

#[tauri::command(async)]
#[specta::specta]
pub fn open_project(app: AppHandle, path: String) -> Result<OpenedProjectDto, String> {
    let package = PathBuf::from(path);
    let project_json = store::read_project(&package).map_err(|error| error.to_string())?;
    return Ok(OpenedProjectDto {
        path: package.display().to_string(),
        project_json,
    });
}

/// Adds an opened project to Recent. The app calls it once the file proved to be a project it can open, so a broken
/// file never joins the list; an unsaved project stays out of it.
#[tauri::command(async)]
#[specta::specta]
pub fn remember_recent_project(app: AppHandle, path: String) {
    let package = PathBuf::from(path);
    if !is_temporary(&app, &package) {
        let _ = recent::remember(&app, &package);
    }
}

#[tauri::command(async)]
#[specta::specta]
pub fn save_project(path: String, project_json: String) -> Result<(), String> {
    return store::save_project(&PathBuf::from(path), &project_json)
        .map_err(|error| error.to_string());
}

#[tauri::command(async)]
#[specta::specta]
pub fn keep_previous_save(path: String) -> Result<(), String> {
    return store::keep_previous_save(&PathBuf::from(path)).map_err(|error| error.to_string());
}

#[tauri::command(async)]
#[specta::specta]
pub fn list_recent_projects(app: AppHandle) -> Vec<RecentProjectDto> {
    return recent::list(&app);
}

#[tauri::command(async)]
#[specta::specta]
pub fn import_source(package_path: String, source_path: String) -> Result<String, String> {
    return store::import_source(&PathBuf::from(package_path), &PathBuf::from(source_path))
        .map_err(|error| error.to_string());
}

/// Creates an unsaved project, such as an opened example, in the app's cache folder. It is not added to Recent;
/// `move_project` saves it where the user chooses.
#[tauri::command(async)]
#[specta::specta]
pub fn create_temporary_project(
    app: AppHandle,
    name: String,
    project_json: String,
) -> Result<OpenedProjectDto, String> {
    let root = temporary::root(&app).ok_or("The app's cache folder isn't available")?;
    let package =
        temporary::create_in(&root, &name, &project_json).map_err(|error| error.to_string())?;
    return Ok(OpenedProjectDto {
        path: package.display().to_string(),
        project_json,
    });
}

/// Moves a package to a chosen path and adds it to Recent. Returns the new package path.
#[tauri::command(async)]
#[specta::specta]
pub fn move_project(
    app: AppHandle,
    path: String,
    destination_path: String,
) -> Result<String, String> {
    let package = store::move_package(&PathBuf::from(path), &PathBuf::from(destination_path))
        .map_err(|error| error.to_string())?;
    let _ = recent::remember(&app, &package);
    return Ok(package.display().to_string());
}

/// Save As… of a saved project: copies the package with its files to a chosen path and adds the copy to Recent.
/// Returns the copy's package path.
#[tauri::command(async)]
#[specta::specta]
pub fn copy_project(
    app: AppHandle,
    path: String,
    destination_path: String,
) -> Result<String, String> {
    let package = store::copy_package(&PathBuf::from(path), &PathBuf::from(destination_path))
        .map_err(|error| error.to_string())?;
    let _ = recent::remember(&app, &package);
    return Ok(package.display().to_string());
}

/// Clear Menu in File > Open Recent
#[tauri::command(async)]
#[specta::specta]
pub fn clear_recent_projects(app: AppHandle) {
    let _ = recent::clear(&app);
}

/// Whether a package is an unsaved project in the app's cache folder
#[tauri::command(async)]
#[specta::specta]
pub fn is_temporary_project(app: AppHandle, path: String) -> bool {
    return is_temporary(&app, &PathBuf::from(path));
}

fn is_temporary(app: &AppHandle, package: &PathBuf) -> bool {
    return temporary::root(app).is_some_and(|root| temporary::is_inside(&root, package));
}
