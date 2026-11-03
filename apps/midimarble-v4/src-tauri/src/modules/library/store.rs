use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MANIFEST_FILE: &str = "manifest.json";
pub const ASSET_FILE: &str = "asset.blend";
pub const PREVIEW_FILE: &str = "preview.png";
/// Files of a library item. Other files in a candidate folder, such as build scripts, stay behind.
const ITEM_FILES: [&str; 3] = [MANIFEST_FILE, ASSET_FILE, PREVIEW_FILE];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LibraryScope {
    /// `<package>/assets/`
    Project,
    /// The app's support folder, shared by every project
    Global,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItemDto {
    pub id: String,
    pub scope: LibraryScope,
    pub path: String,
    /// Raw `manifest.json`, validated by the app
    pub manifest_json: Option<String>,
    pub has_asset: bool,
    pub preview_path: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum LibraryError {
    #[error("Item ID must use 1 to 64 letters, digits, '-' or '_'")]
    InvalidId,
    #[error("{0} is already in the library")]
    AlreadyExists(String),
    #[error("{0} is not in the library")]
    NotFound(String),
    #[error("{0} has no asset.blend")]
    MissingAsset(String),
    #[error("{action} {path}: {source}")]
    Io {
        action: &'static str,
        path: String,
        source: std::io::Error,
    },
}

pub fn is_valid_id(value: &str) -> bool {
    return !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
}

/// Items of a library folder sorted by ID. A missing folder is an empty library.
pub fn list(root: &Path, scope: LibraryScope) -> Vec<LibraryItemDto> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut items: Vec<LibraryItemDto> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .filter_map(|path| {
            let id = path.file_name()?.to_str()?.to_string();
            if !is_valid_id(&id) {
                return None;
            }
            return Some(item(&path, &id, scope));
        })
        .collect();
    items.sort_by(|a, b| a.id.cmp(&b.id));
    return items;
}

pub fn item(dir: &Path, id: &str, scope: LibraryScope) -> LibraryItemDto {
    let preview = dir.join(PREVIEW_FILE);
    return LibraryItemDto {
        id: id.to_string(),
        scope,
        path: dir.display().to_string(),
        manifest_json: fs::read_to_string(dir.join(MANIFEST_FILE)).ok(),
        has_asset: dir.join(ASSET_FILE).is_file(),
        preview_path: preview.is_file().then(|| preview.display().to_string()),
    };
}

/// Copies an item folder into `<target_root>/<id>/`, replacing its manifest with `manifest_json` when given.
/// Files land in a temporary sibling first, so a failed copy never leaves a partial item.
pub fn copy_item(
    source: &Path,
    target_root: &Path,
    id: &str,
    manifest_json: Option<&str>,
) -> Result<PathBuf, LibraryError> {
    if !is_valid_id(id) {
        return Err(LibraryError::InvalidId);
    }
    if !source.join(ASSET_FILE).is_file() {
        return Err(LibraryError::MissingAsset(source.display().to_string()));
    }
    let target = target_root.join(id);
    if target.exists() {
        return Err(LibraryError::AlreadyExists(id.to_string()));
    }
    fs::create_dir_all(target_root).map_err(|error| io("create", target_root, error))?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let staging = target_root.join(format!(".{}.tmp-{}", id, nanos));
    fs::create_dir_all(&staging).map_err(|error| io("create", &staging, error))?;
    let result = (|| {
        for name in ITEM_FILES {
            let from = source.join(name);
            let to = staging.join(name);
            if name == MANIFEST_FILE {
                if let Some(json) = manifest_json {
                    fs::write(&to, json).map_err(|error| io("write", &to, error))?;
                    continue;
                }
            }
            if from.is_file() {
                fs::copy(&from, &to).map_err(|error| io("copy", &from, error))?;
            }
        }
        return fs::rename(&staging, &target).map_err(|error| io("replace", &target, error));
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result?;
    return Ok(target);
}

pub fn remove(root: &Path, id: &str) -> Result<(), LibraryError> {
    if !is_valid_id(id) {
        return Err(LibraryError::InvalidId);
    }
    let dir = root.join(id);
    if !dir.is_dir() {
        return Err(LibraryError::NotFound(id.to_string()));
    }
    return fs::remove_dir_all(&dir).map_err(|error| io("remove", &dir, error));
}

fn io(action: &'static str, path: &Path, source: std::io::Error) -> LibraryError {
    return LibraryError::Io {
        action,
        path: path.display().to_string(),
        source,
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "midimarble-library-{}-{}",
            name,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        return root;
    }

    fn candidate(root: &Path) -> PathBuf {
        let dir = root.join("candidates/run-1");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(ASSET_FILE), b"BLENDER").unwrap();
        fs::write(dir.join(MANIFEST_FILE), "{\"id\":\"raw\"}").unwrap();
        fs::write(dir.join(PREVIEW_FILE), b"PNG").unwrap();
        fs::write(dir.join("build_asset.py"), "print()").unwrap();
        return dir;
    }

    #[test]
    fn copies_lists_and_removes_items() {
        let root = temporary_root("copy");
        let source = candidate(&root);
        let assets = root.join("assets");
        let target = copy_item(
            &source,
            &assets,
            "brass-bar",
            Some("{\"id\":\"brass-bar\"}"),
        )
        .unwrap();
        assert_eq!(fs::read(target.join(ASSET_FILE)).unwrap(), b"BLENDER");
        assert_eq!(
            fs::read_to_string(target.join(MANIFEST_FILE)).unwrap(),
            "{\"id\":\"brass-bar\"}"
        );
        assert!(!target.join("build_asset.py").exists());

        let items = list(&assets, LibraryScope::Project);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "brass-bar");
        assert!(items[0].has_asset);
        assert!(items[0].preview_path.is_some());

        let global = root.join("Library");
        copy_item(&target, &global, "brass-bar", None).unwrap();
        assert_eq!(
            list(&global, LibraryScope::Global)[0].scope,
            LibraryScope::Global
        );

        remove(&assets, "brass-bar").unwrap();
        assert!(list(&assets, LibraryScope::Project).is_empty());
        assert!(fs::read_dir(&assets).unwrap().next().is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_conflicts_invalid_ids_and_missing_assets() {
        let root = temporary_root("reject");
        let source = candidate(&root);
        let assets = root.join("assets");
        copy_item(&source, &assets, "bar", None).unwrap();
        assert!(matches!(
            copy_item(&source, &assets, "bar", None),
            Err(LibraryError::AlreadyExists(_))
        ));
        assert!(matches!(
            copy_item(&source, &assets, "../bar", None),
            Err(LibraryError::InvalidId)
        ));
        assert!(matches!(
            remove(&assets, ".."),
            Err(LibraryError::InvalidId)
        ));
        fs::remove_file(source.join(ASSET_FILE)).unwrap();
        assert!(matches!(
            copy_item(&source, &assets, "other", None),
            Err(LibraryError::MissingAsset(_))
        ));
        assert!(list(&root.join("missing"), LibraryScope::Global).is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
