use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const PROJECT_FILE: &str = "project.json";
pub const PACKAGE_EXTENSION: &str = "marble";
const PACKAGE_FOLDERS: [&str; 6] = ["audio", "assets", "candidates", "renders", ".cache", ".bridge"];

#[derive(Debug, thiserror::Error)]
pub enum PackageError {
    #[error("{0} already exists")]
    AlreadyExists(String),
    #[error("{0} is not a MidiMarble project")]
    NotAPackage(String),
    #[error("{action} {path}: {source}")]
    Io {
        action: &'static str,
        path: String,
        source: std::io::Error,
    },
}

/// Appends the `.marble` extension when the chosen path does not carry it
pub fn package_path(path: &Path) -> PathBuf {
    if path.extension().and_then(|value| value.to_str()) == Some(PACKAGE_EXTENSION) {
        return path.to_path_buf();
    }
    let mut name = path.as_os_str().to_os_string();
    name.push(".");
    name.push(PACKAGE_EXTENSION);
    return PathBuf::from(name);
}

pub fn create_package(path: &Path, project_json: &str) -> Result<PathBuf, PackageError> {
    let package = package_path(path);
    if package.exists() {
        return Err(PackageError::AlreadyExists(display(&package)));
    }
    for folder in PACKAGE_FOLDERS {
        let folder_path = package.join(folder);
        fs::create_dir_all(&folder_path).map_err(|source| io("create", &folder_path, source))?;
    }
    write_atomic(&package.join(PROJECT_FILE), project_json.as_bytes())?;
    return Ok(package);
}

pub fn read_project(package: &Path) -> Result<String, PackageError> {
    let file = package.join(PROJECT_FILE);
    if !file.is_file() {
        return Err(PackageError::NotAPackage(display(package)));
    }
    return fs::read_to_string(&file).map_err(|source| io("read", &file, source));
}

pub fn save_project(package: &Path, project_json: &str) -> Result<(), PackageError> {
    if !package.join(PROJECT_FILE).is_file() {
        return Err(PackageError::NotAPackage(display(package)));
    }
    // Restore folders a user or sync tool removed, so later writes have a target
    for folder in PACKAGE_FOLDERS {
        let folder_path = package.join(folder);
        fs::create_dir_all(&folder_path).map_err(|source| io("create", &folder_path, source))?;
    }
    return write_atomic(&package.join(PROJECT_FILE), project_json.as_bytes());
}

/// Writes through a sibling temporary file and a rename so a crash never leaves a partial file
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), PackageError> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let temporary = path.with_extension(format!("tmp-{}", nanos));
    let mut file = fs::File::create(&temporary).map_err(|source| io("write", &temporary, source))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|source| io("write", &temporary, source))?;
    fs::rename(&temporary, path).map_err(|source| io("replace", path, source))?;
    return Ok(());
}

fn io(action: &'static str, path: &Path, source: std::io::Error) -> PackageError {
    return PackageError::Io {
        action,
        path: display(path),
        source,
    };
}

fn display(path: &Path) -> String {
    return path.display().to_string();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "midimarble-package-{}-{}",
            name,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        return root;
    }

    #[test]
    fn creates_reads_and_saves_a_package() {
        let root = temporary_root("roundtrip");
        let package = create_package(&root.join("Song"), "{\"a\":1}").unwrap();
        assert_eq!(package, root.join("Song.marble"));
        assert!(package.join("audio").is_dir());
        assert_eq!(read_project(&package).unwrap(), "{\"a\":1}");
        save_project(&package, "{\"a\":2}").unwrap();
        assert_eq!(read_project(&package).unwrap(), "{\"a\":2}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn opens_a_moved_package() {
        let root = temporary_root("moved");
        let package = create_package(&root.join("Song.marble"), "{}").unwrap();
        let moved = root.join("Elsewhere.marble");
        fs::rename(&package, &moved).unwrap();
        assert_eq!(read_project(&moved).unwrap(), "{}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_existing_and_invalid_packages() {
        let root = temporary_root("invalid");
        create_package(&root.join("Song"), "{}").unwrap();
        assert!(matches!(
            create_package(&root.join("Song"), "{}"),
            Err(PackageError::AlreadyExists(_))
        ));
        assert!(matches!(
            read_project(&root),
            Err(PackageError::NotAPackage(_))
        ));
        fs::remove_dir_all(root).unwrap();
    }
}
