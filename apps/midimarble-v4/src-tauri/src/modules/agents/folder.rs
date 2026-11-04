use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

// What this project wants from agents, kept in the package: its goal and rules, the References, notes across runs,
// free space for experiments and each run's log. How the app works ships with the app, so this stays right when the
// app updates.

pub const AGENT_FOLDER: &str = "agent";
pub const REFERENCES_FOLDER: &str = "references";
const SUBFOLDERS: [&str; 4] = [REFERENCES_FOLDER, "notes", "scratch", "runs"];
const BRIEF_FILE: &str = "AGENTS.md";
/// The References' words, beside their images
const WORDS_FILE: &str = "references.md";
const IMAGE_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "webp", "gif", "heic", "tiff"];

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentReferencesDto {
    /// Absolute paths of the images
    pub images: Vec<String>,
    pub text: String,
}

/// Creates the folder on first agent use and writes its `AGENTS.md`, which a person may then edit. Returns the folder.
pub fn ensure(package: &Path, title: &str) -> io::Result<PathBuf> {
    require_package(package)?;
    let folder = package.join(AGENT_FOLDER);
    for name in SUBFOLDERS {
        fs::create_dir_all(folder.join(name))?;
    }
    let brief = folder.join(BRIEF_FILE);
    if !brief.exists() {
        fs::write(&brief, project_brief(title))?;
    }
    return Ok(folder);
}

fn project_brief(title: &str) -> String {
    return format!(
        "# {}\n\nThis project's goal and rules for agents. Read this at the start of every run. A person may edit it.\n\n\
## Goal\n\nMake a film of this project's song in the app, with the look the References ask for.\n\n\
## Rules\n\n- Make every edit through the MidiMarble tools, so it shows in the window with Undo.\n\
- `references/` holds the images and words for the look.\n\
- Keep what you learn and decide in `notes/`. `scratch/` is free space and doesn't travel with Save As.\n\
- `runs/` records each session's tool calls. Leave it as it is.\n",
        title
    );
}

/// The References, empty when there are none. Reading never creates the folder.
pub fn read_references(package: &Path) -> AgentReferencesDto {
    let folder = references_folder(package);
    let mut images: Vec<String> = fs::read_dir(&folder)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| path.is_file() && is_image(path))
                .map(|path| path.display().to_string())
                .collect()
        })
        .unwrap_or_default();
    images.sort();
    return AgentReferencesDto {
        images,
        text: fs::read_to_string(folder.join(WORDS_FILE)).unwrap_or_default(),
    };
}

/// Replaces the References with copies of `paths` and `text`. A path that can't be used leaves the old ones in place.
pub fn set_references(
    package: &Path,
    title: &str,
    paths: &[String],
    text: &str,
) -> Result<AgentReferencesDto, String> {
    let sources: Vec<&Path> = paths.iter().map(Path::new).collect();
    for path in &sources {
        if !is_image(path) {
            return Err(format!(
                "{} isn't an image. Use {}.",
                path.display(),
                IMAGE_EXTENSIONS.join(", ")
            ));
        }
        if !path.is_file() {
            return Err(format!("{} can't be read", path.display()));
        }
    }
    let stringify = |error: io::Error| error.to_string();
    ensure(package, title).map_err(stringify)?;
    let folder = references_folder(package);
    // Copied first, as a path may already be inside the folder
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let staging = folder.join(format!(".tmp-{}", nanos));
    let copied = (|| -> io::Result<()> {
        fs::create_dir_all(&staging)?;
        for (index, path) in sources.iter().enumerate() {
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            fs::copy(path, staging.join(format!("{:02}-{}", index + 1, strip_order(&name))))?;
        }
        for entry in fs::read_dir(&folder)?.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_file() && is_image(&path) {
                fs::remove_file(path)?;
            }
        }
        for entry in fs::read_dir(&staging)?.filter_map(Result::ok) {
            fs::rename(entry.path(), folder.join(entry.file_name()))?;
        }
        let words = folder.join(WORDS_FILE);
        if text.trim().is_empty() {
            if words.exists() {
                fs::remove_file(words)?;
            }
        } else {
            fs::write(words, text)?;
        }
        return Ok(());
    })();
    let _ = fs::remove_dir_all(&staging);
    copied.map_err(stringify)?;
    return Ok(read_references(package));
}

/// `02-wall.png` set again keeps one order prefix
fn strip_order(name: &str) -> &str {
    let bytes = name.as_bytes();
    let is_ordered = bytes.len() > 3
        && bytes[0].is_ascii_digit()
        && bytes[1].is_ascii_digit()
        && bytes[2] == b'-';
    return if is_ordered { &name[3..] } else { name };
}

fn references_folder(package: &Path) -> PathBuf {
    return package.join(AGENT_FOLDER).join(REFERENCES_FOLDER);
}

fn is_image(path: &Path) -> bool {
    return path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| IMAGE_EXTENSIONS.contains(&extension.to_lowercase().as_str()));
}

fn require_package(package: &Path) -> io::Result<()> {
    if package.join("project.json").is_file() {
        return Ok(());
    }
    return Err(io::Error::new(
        io::ErrorKind::NotFound,
        format!("{} is not a MidiMarble project", package.display()),
    ));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_package(name: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let package = std::env::temp_dir().join(format!("mm-agent-{}-{}", name, nanos));
        fs::create_dir_all(&package).unwrap();
        fs::write(package.join("project.json"), "{}").unwrap();
        return package;
    }

    #[test]
    fn creates_the_folder_once_and_keeps_edits() {
        let package = temporary_package("ensure");
        let folder = ensure(&package, "Jingle Bells").unwrap();
        for name in SUBFOLDERS {
            assert!(folder.join(name).is_dir());
        }
        let brief = fs::read_to_string(folder.join(BRIEF_FILE)).unwrap();
        assert!(brief.starts_with("# Jingle Bells"));
        fs::write(folder.join(BRIEF_FILE), "mine").unwrap();
        ensure(&package, "Other").unwrap();
        assert_eq!(fs::read_to_string(folder.join(BRIEF_FILE)).unwrap(), "mine");
        assert!(ensure(Path::new("/no/such/package"), "x").is_err());
        fs::remove_dir_all(package).unwrap();
    }

    #[test]
    fn sets_and_replaces_references() {
        let package = temporary_package("references");
        assert!(read_references(&package).images.is_empty());
        assert!(!package.join(AGENT_FOLDER).exists());

        let wall = package.join("wall.png");
        let tree = package.join("tree.JPG");
        fs::write(&wall, b"PNG").unwrap();
        fs::write(&tree, b"JPG").unwrap();
        let paths = [wall.display().to_string(), tree.display().to_string()];
        let set = set_references(&package, "Song", &paths, "Warm and cosy").unwrap();
        assert_eq!(set.images.len(), 2);
        assert!(set.images[0].ends_with("agent/references/01-wall.png"));
        assert_eq!(set.text, "Warm and cosy");

        // Setting them from their own folder keeps them and drops the rest
        let again = set_references(&package, "Song", &[set.images[1].clone()], "").unwrap();
        assert_eq!(again.images.len(), 1);
        assert!(again.images[0].ends_with("01-tree.JPG"));
        assert_eq!(fs::read(&again.images[0]).unwrap(), b"JPG");
        assert_eq!(again.text, "");

        // A bad path leaves them as they were
        let notes = package.join("notes.txt");
        fs::write(&notes, "x").unwrap();
        assert!(set_references(&package, "Song", &[notes.display().to_string()], "").is_err());
        assert!(set_references(&package, "Song", &["/no/such.png".to_string()], "").is_err());
        assert_eq!(read_references(&package).images.len(), 1);
        fs::remove_dir_all(package).unwrap();
    }
}
