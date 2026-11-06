use super::pack::{self, PackDto, PackThemeDto};
use super::store::{self, LibraryItemDto, LibraryScope, ASSET_FILE, PREVIEW_FILE};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const PROJECT_FOLDER: &str = "assets";

/// Items of the project library, `<package>/assets/`
#[tauri::command(async)]
#[specta::specta]
pub fn library_list(package_path: String) -> Result<Vec<LibraryItemDto>, String> {
    return Ok(store::list(&package(&package_path)?.join(PROJECT_FOLDER), LibraryScope::Project));
}

/// Copies an item of an imported Pack into the project so the package stays portable
#[tauri::command(async)]
#[specta::specta]
pub fn library_import(
    app: AppHandle,
    package_path: String,
    item_id: String,
    pack_id: String,
) -> Result<LibraryItemDto, String> {
    let package = package(&package_path)?;
    if !store::is_valid_id(&pack_id) || !store::is_valid_id(&item_id) {
        return Err(format!("Invalid Pack item {}", item_id));
    }
    let source = packs_root(&app)?.join(&pack_id).join(PROJECT_FOLDER).join(&item_id);
    return pack::copy_into_project(&source, &package.join(PROJECT_FOLDER), &item_id);
}

#[tauri::command(async)]
#[specta::specta]
pub fn library_remove(package_path: String, item_id: String) -> Result<(), String> {
    let root = package(&package_path)?.join(PROJECT_FOLDER);
    return store::remove(&root, &item_id).map_err(|error| error.to_string());
}

/// Adds an asset from outside the project: a folder with `asset.blend`, or a `.blend` file with its `preview.png`
/// beside it, with the manifest the app validated
#[tauri::command(async)]
#[specta::specta]
pub fn library_add_asset(
    package_path: String,
    path: String,
    item_id: String,
    manifest_json: String,
) -> Result<LibraryItemDto, String> {
    let package = package(&package_path)?;
    let source = PathBuf::from(&path);
    let assets = package.join(PROJECT_FOLDER);
    let target = if source.is_dir() {
        store::copy_item(&source, &assets, &item_id, Some(&manifest_json))
    } else {
        let staging = package.join(".cache").join(format!("add-asset-{}", item_id));
        let _ = fs::remove_dir_all(&staging);
        fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
        fs::copy(&source, staging.join(ASSET_FILE)).map_err(|error| format!("{} can't be read: {}", path, error))?;
        if let Some(preview) = source.parent().map(|folder| folder.join(PREVIEW_FILE)) {
            if preview.is_file() {
                fs::copy(preview, staging.join(PREVIEW_FILE)).map_err(|error| error.to_string())?;
            }
        }
        let copied = store::copy_item(&staging, &assets, &item_id, Some(&manifest_json));
        let _ = fs::remove_dir_all(&staging);
        copied
    }
    .map_err(|error| error.to_string())?;
    return Ok(store::item(&target, &item_id, LibraryScope::Project));
}

/// The added Packs, kept in the app's support folder
#[tauri::command(async)]
#[specta::specta]
pub fn library_list_packs(app: AppHandle) -> Result<Vec<PackDto>, String> {
    return Ok(pack::list_packs(&packs_root(&app)?));
}

/// The Packs that ship in the app bundle, for the Add Pack sheet
///
/// Off the main thread, and always from the app's own resources: a read under a protected folder such as Documents
/// waits for a macOS permission prompt, which would freeze the window behind it.
#[tauri::command(async)]
#[specta::specta]
pub fn library_list_bundled_packs(app: AppHandle) -> Result<Vec<PackDto>, String> {
    let root = app.path().resource_dir().map_err(|error| error.to_string())?.join("packs");
    return Ok(pack::list_bundled(&root));
}

/// Adds a bundled Pack or a Pack from a file: it stays on this Mac for every project. Nothing changes in the open project.
#[tauri::command(async)]
#[specta::specta]
pub fn library_import_pack(app: AppHandle, path: String) -> Result<PackDto, String> {
    return pack::import_pack(&PathBuf::from(path), &packs_root(&app)?);
}

/// Export Pack…: writes the Pack folder and returns its path
#[tauri::command(async)]
#[specta::specta]
pub fn library_export_pack(
    package_path: String,
    destination_path: String,
    manifest_json: String,
    themes: Vec<PackThemeDto>,
    asset_ids: Vec<String>,
) -> Result<String, String> {
    let package = package(&package_path)?;
    let target = pack::export_pack(&package, Path::new(&destination_path), &manifest_json, &themes, &asset_ids)?;
    return Ok(target.display().to_string());
}

#[tauri::command(async)]
#[specta::specta]
pub fn library_remove_pack(app: AppHandle, pack_id: String) -> Result<(), String> {
    return pack::remove_pack(&packs_root(&app)?, &pack_id);
}

fn packs_root(app: &AppHandle) -> Result<PathBuf, String> {
    return app
        .path()
        .app_data_dir()
        .map(|dir| dir.join(pack::PACKS_FOLDER))
        .map_err(|error| error.to_string());
}

fn package(path: &str) -> Result<PathBuf, String> {
    let package = PathBuf::from(path);
    if !Path::new(path).join("project.json").is_file() {
        return Err(format!("{} isn't a MidiMarble project. Choose a .marble package.", package.file_name().map_or_else(|| package.display().to_string(), |name| name.to_string_lossy().into_owned())));
    }
    return Ok(package);
}
