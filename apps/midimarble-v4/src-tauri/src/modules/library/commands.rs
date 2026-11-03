use super::store::{self, LibraryItemDto, LibraryScope};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const GLOBAL_FOLDER: &str = "Library";
const PROJECT_FOLDER: &str = "assets";
const CANDIDATES_FOLDER: &str = "candidates";

/// Items of the project library (`<package>/assets/`) or the global library in the app's support folder
#[tauri::command]
#[specta::specta]
pub fn library_list(
    app: AppHandle,
    scope: LibraryScope,
    package_path: Option<String>,
) -> Result<Vec<LibraryItemDto>, String> {
    let root = scope_root(&app, scope, package_path.as_deref())?;
    return Ok(store::list(&root, scope));
}

/// Copies a candidate's `asset.blend` and `preview.png` into `assets/<itemId>/` with the manifest the app
/// validated and normalized
#[tauri::command]
#[specta::specta]
pub fn library_accept_candidate(
    package_path: String,
    run_id: String,
    item_id: String,
    manifest_json: String,
) -> Result<LibraryItemDto, String> {
    let package = package(&package_path)?;
    if !store::is_valid_id(&run_id) {
        return Err(format!("Invalid run ID {}", run_id));
    }
    let source = package.join(CANDIDATES_FOLDER).join(&run_id);
    let target = store::copy_item(
        &source,
        &package.join(PROJECT_FOLDER),
        &item_id,
        Some(&manifest_json),
    )
    .map_err(|error| error.to_string())?;
    return Ok(store::item(&target, &item_id, LibraryScope::Project));
}

/// Copies a project item into the global library for use in other projects
#[tauri::command]
#[specta::specta]
pub fn library_promote(
    app: AppHandle,
    package_path: String,
    item_id: String,
) -> Result<LibraryItemDto, String> {
    let package = package(&package_path)?;
    let target = store::copy_item(
        &package.join(PROJECT_FOLDER).join(&item_id),
        &global_root(&app)?,
        &item_id,
        None,
    )
    .map_err(|error| error.to_string())?;
    return Ok(store::item(&target, &item_id, LibraryScope::Global));
}

/// Copies a global item into the project so the package stays portable
#[tauri::command]
#[specta::specta]
pub fn library_import(
    app: AppHandle,
    package_path: String,
    item_id: String,
) -> Result<LibraryItemDto, String> {
    let package = package(&package_path)?;
    let target = store::copy_item(
        &global_root(&app)?.join(&item_id),
        &package.join(PROJECT_FOLDER),
        &item_id,
        None,
    )
    .map_err(|error| error.to_string())?;
    return Ok(store::item(&target, &item_id, LibraryScope::Project));
}

#[tauri::command]
#[specta::specta]
pub fn library_remove(
    app: AppHandle,
    scope: LibraryScope,
    package_path: Option<String>,
    item_id: String,
) -> Result<(), String> {
    let root = scope_root(&app, scope, package_path.as_deref())?;
    return store::remove(&root, &item_id).map_err(|error| error.to_string());
}

fn scope_root(
    app: &AppHandle,
    scope: LibraryScope,
    package_path: Option<&str>,
) -> Result<PathBuf, String> {
    return match scope {
        LibraryScope::Global => global_root(app),
        LibraryScope::Project => {
            let path = package_path.ok_or("The project library needs a package path")?;
            Ok(package(path)?.join(PROJECT_FOLDER))
        }
    };
}

fn global_root(app: &AppHandle) -> Result<PathBuf, String> {
    return app
        .path()
        .app_data_dir()
        .map(|dir| dir.join(GLOBAL_FOLDER))
        .map_err(|error| error.to_string());
}

fn package(path: &str) -> Result<PathBuf, String> {
    let package = PathBuf::from(path);
    if !Path::new(path).join("project.json").is_file() {
        return Err(format!("{} is not a MidiMarble project", package.display()));
    }
    return Ok(package);
}
