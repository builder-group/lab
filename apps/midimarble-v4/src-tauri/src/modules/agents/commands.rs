use super::folder::{self, AgentReferencesDto};
use std::path::PathBuf;

/// Creates the package's agent folder on first use and returns its path
#[tauri::command]
#[specta::specta]
pub fn agent_folder_ensure(package_path: String, title: String) -> Result<String, String> {
    let folder = folder::ensure(&PathBuf::from(package_path), &title).map_err(|error| error.to_string())?;
    return Ok(folder.display().to_string());
}

#[tauri::command]
#[specta::specta]
pub fn agent_references_read(package_path: String) -> AgentReferencesDto {
    return folder::read_references(&PathBuf::from(package_path));
}

/// Replaces the project's References with copies of the images and these words
#[tauri::command]
#[specta::specta]
pub fn agent_references_set(
    package_path: String,
    title: String,
    paths: Vec<String>,
    text: String,
) -> Result<AgentReferencesDto, String> {
    return folder::set_references(&PathBuf::from(package_path), &title, &paths, &text);
}
