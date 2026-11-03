use super::store::{self, PackageError};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

// Unsaved documents, such as an opened example, live here until the user saves them somewhere
const TEMPORARY_FOLDER: &str = "Unsaved Projects";

pub fn root(app: &AppHandle) -> Option<PathBuf> {
    return app
        .path()
        .app_cache_dir()
        .ok()
        .map(|dir| dir.join(TEMPORARY_FOLDER));
}

/// Creates an unsaved package named `name` in `root`. Earlier unsaved packages are removed first: a window holds
/// one project, and an unsaved one was either saved (moved out) or closed with Don't Save before another opens.
pub fn create_in(root: &Path, name: &str, project_json: &str) -> Result<PathBuf, PackageError> {
    if root.exists() {
        fs::remove_dir_all(root).map_err(|source| store::io("clear", root, source))?;
    }
    fs::create_dir_all(root).map_err(|source| store::io("create", root, source))?;
    return store::create_package(&root.join(file_name(name)), project_json);
}

pub fn is_inside(root: &Path, path: &Path) -> bool {
    return path.starts_with(root);
}

fn file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|character| {
            if character == '/' || character == ':' {
                '-'
            } else {
                character
            }
        })
        .collect();
    let trimmed = cleaned.trim();
    return if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.to_string()
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_root(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        return std::env::temp_dir().join(format!("midimarble-unsaved-{}-{}", name, nanos));
    }

    #[test]
    fn creates_one_unsaved_package_at_a_time() {
        let root = temporary_root("create");
        let first = create_in(&root, "Jingle Bells", "{}").unwrap();
        assert_eq!(first, root.join("Jingle Bells.marble"));
        assert!(is_inside(&root, &first));
        let second = create_in(&root, "Zig/zag", "{}").unwrap();
        assert_eq!(second, root.join("Zig-zag.marble"));
        assert!(!first.exists());
        assert!(!is_inside(
            &root,
            Path::new("/Users/someone/Jingle Bells.marble")
        ));
        fs::remove_dir_all(root).unwrap();
    }
}
