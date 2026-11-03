use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const PROJECT_FILE: &str = "project.json";
pub const PACKAGE_EXTENSION: &str = "marble";
const PACKAGE_FOLDERS: [&str; 6] = [
    "audio",
    "assets",
    "candidates",
    "renders",
    ".cache",
    ".bridge",
];

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

/// Copies a source file into the package `audio/` folder and returns its package-relative path
pub fn import_source(package: &Path, source: &Path) -> Result<String, PackageError> {
    if !package.join(PROJECT_FILE).is_file() {
        return Err(PackageError::NotAPackage(display(package)));
    }
    let folder = package.join("audio");
    fs::create_dir_all(&folder).map_err(|source| io("create", &folder, source))?;
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("source")
        .to_string();
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value.to_lowercase()))
        .unwrap_or_default();
    let mut name = format!("{}{}", stem, extension);
    let mut index = 2;
    while folder.join(&name).exists() {
        name = format!("{} {}{}", stem, index, extension);
        index += 1;
    }
    let target = folder.join(&name);
    fs::copy(source, &target).map_err(|error| io("copy", source, error))?;
    return Ok(format!("audio/{}", name));
}

/// Moves a package to a new path, such as an unsaved example to where the user saves it. A move to another
/// volume copies the package and then removes the original.
pub fn move_package(from: &Path, to: &Path) -> Result<PathBuf, PackageError> {
    if !from.join(PROJECT_FILE).is_file() {
        return Err(PackageError::NotAPackage(display(from)));
    }
    let target = package_path(to);
    if target.exists() {
        return Err(PackageError::AlreadyExists(display(&target)));
    }
    if fs::rename(from, &target).is_ok() {
        return Ok(target);
    }
    if let Err(error) = copy_dir(from, &target) {
        let _ = fs::remove_dir_all(&target);
        return Err(error);
    }
    fs::remove_dir_all(from).map_err(|source| io("remove", from, source))?;
    return Ok(target);
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), PackageError> {
    fs::create_dir_all(to).map_err(|source| io("create", to, source))?;
    for entry in fs::read_dir(from).map_err(|source| io("read", from, source))? {
        let entry = entry.map_err(|source| io("read", from, source))?;
        let source_path = entry.path();
        let target_path = to.join(entry.file_name());
        let is_dir = entry
            .file_type()
            .map_err(|source| io("read", &source_path, source))?
            .is_dir();
        if is_dir {
            copy_dir(&source_path, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path)
                .map_err(|source| io("copy", &source_path, source))?;
        }
    }
    return Ok(());
}

/// Writes through a sibling temporary file and a rename so a crash never leaves a partial file
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), PackageError> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let temporary = path.with_extension(format!("tmp-{}", nanos));
    let mut file =
        fs::File::create(&temporary).map_err(|source| io("write", &temporary, source))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|source| io("write", &temporary, source))?;
    fs::rename(&temporary, path).map_err(|source| io("replace", path, source))?;
    return Ok(());
}

pub(super) fn io(action: &'static str, path: &Path, source: std::io::Error) -> PackageError {
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
    fn imports_sources_with_unique_names() {
        let root = temporary_root("import");
        let package = create_package(&root.join("Song"), "{}").unwrap();
        let source = root.join("Theme.MID");
        fs::write(&source, b"MThd").unwrap();
        assert_eq!(import_source(&package, &source).unwrap(), "audio/Theme.mid");
        assert_eq!(
            import_source(&package, &source).unwrap(),
            "audio/Theme 2.mid"
        );
        assert_eq!(
            fs::read(package.join("audio/Theme 2.mid")).unwrap(),
            b"MThd"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn moves_a_package_with_its_files() {
        let root = temporary_root("move");
        let package = create_package(&root.join("Jingle Bells"), "{}").unwrap();
        fs::write(package.join("audio/song.mid"), b"MThd").unwrap();
        let moved = move_package(&package, &root.join("Mine")).unwrap();
        assert_eq!(moved, root.join("Mine.marble"));
        assert!(!package.exists());
        assert_eq!(fs::read(moved.join("audio/song.mid")).unwrap(), b"MThd");
        assert_eq!(read_project(&moved).unwrap(), "{}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_a_move_onto_an_existing_package() {
        let root = temporary_root("move-existing");
        let package = create_package(&root.join("A"), "{}").unwrap();
        create_package(&root.join("B"), "{}").unwrap();
        assert!(matches!(
            move_package(&package, &root.join("B.marble")),
            Err(PackageError::AlreadyExists(_))
        ));
        assert!(package.join(PROJECT_FILE).is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copies_nested_folders() {
        let root = temporary_root("copy");
        let package = create_package(&root.join("A"), "{}").unwrap();
        fs::write(package.join("assets/item.txt"), b"x").unwrap();
        copy_dir(&package, &root.join("Copy.marble")).unwrap();
        assert_eq!(
            fs::read(root.join("Copy.marble/assets/item.txt")).unwrap(),
            b"x"
        );
        assert!(root.join("Copy.marble/.bridge").is_dir());
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
