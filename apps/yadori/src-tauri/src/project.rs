use base64::Engine;
use fs2::FileExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const MAX_PROJECT: u64 = 32 * 1024 * 1024;
const MAX_ASSET: u64 = 24 * 1024 * 1024;
const MAX_ARCHIVE: u64 = 256 * 1024 * 1024;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub revision: u64,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery_error: Option<String>,
}
#[derive(Serialize)]
pub struct ProjectFile {
    #[serde(flatten)]
    pub record: ProjectRecord,
    pub content: String,
    pub path: String,
}
pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|_| "Cannot locate application storage".into())
}
pub fn identifier(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 120
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Invalid project or asset identifier".into());
    }
    Ok(())
}
pub fn random_id() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "Cannot obtain secure randomness")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
pub fn project_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    identifier(id)?;
    let projects = root.join("projects");
    let dir = projects.join(id);
    for path in [&projects, &dir] {
        if let Ok(meta) = fs::symlink_metadata(path) {
            if !meta.is_dir() || meta.file_type().is_symlink() {
                return Err("Managed project directory is invalid".into());
            }
        }
    }
    Ok(dir)
}
pub fn parse(content: &str) -> Result<(Value, ProjectRecord), String> {
    if content.len() as u64 > MAX_PROJECT {
        return Err("Project is too large".into());
    }
    let value: Value = serde_json::from_str(content).map_err(|_| "Invalid project JSON")?;
    if value["$schema"] != "yadori/project@1"
        && value["$schema"] != "yadori/project@2"
        && value["$schema"] != "yadori/project@3"
    {
        return Err("Unsupported project format".into());
    }
    let id = value["id"]
        .as_str()
        .ok_or("Missing project identity")?
        .to_owned();
    identifier(&id)?;
    let revision = value["revision"]
        .as_u64()
        .ok_or("Invalid project revision")?;
    let name = value["name"]
        .as_str()
        .ok_or("Missing project name")?
        .to_owned();
    let updated_at = value["updatedAt"]
        .as_str()
        .ok_or("Missing project date")?
        .to_owned();
    for key in [
        "parts",
        "instances",
        "layouts",
        "placements",
        "runs",
        "assets",
    ] {
        if !value[key].is_array() {
            return Err(format!("Missing project collection: {key}"));
        }
    }
    Ok((
        value,
        ProjectRecord {
            id,
            name,
            revision,
            updated_at,
            recovery_error: None,
        },
    ))
}
pub fn read_project(root: &Path, id: &str) -> Result<ProjectFile, String> {
    let path = project_dir(root, id)?.join("project.json");
    let content = read_text(&path, MAX_PROJECT)?;
    let (_, record) = parse(&content)?;
    if record.id != id {
        return Err("Project folder identity mismatch".into());
    }
    Ok(ProjectFile {
        record,
        content,
        path: path.to_string_lossy().into_owned(),
    })
}
pub fn read_text(path: &Path, limit: u64) -> Result<String, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("Cannot read local file: {e}"))?;
    if !meta.is_file() || meta.len() > limit {
        return Err("File is unsupported or too large".into());
    }
    fs::read_to_string(path).map_err(|_| "Cannot read UTF-8 local file".into())
}
pub fn atomic_write(path: &Path, bytes: &[u8], backup: bool) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid storage path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = parent.join(format!(".{}.tmp", random_id()?));
    let result = (|| {
        let mut f = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        f.write_all(bytes)
            .and_then(|_| f.sync_all())
            .map_err(|e| e.to_string())?;
        if backup && path.exists() {
            let previous = fs::read(path).map_err(|e| e.to_string())?;
            atomic_write(&path.with_extension("json.backup"), &previous, false)?;
        }
        fs::rename(&temp, path).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
pub fn save(
    root: &Path,
    id: &str,
    content: &str,
    expected: Option<u64>,
) -> Result<ProjectFile, String> {
    let (_, incoming) = parse(content)?;
    if incoming.id != id {
        return Err("Cannot change project identity".into());
    }
    let dir = project_dir(root, id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(".writer.lock"))
        .map_err(|e| e.to_string())?;
    lock.try_lock_exclusive()
        .map_err(|_| "Project is being saved by another writer")?;
    let path = dir.join("project.json");
    match expected {
        Some(rev) => {
            let current = read_project(root, id)?;
            if current.record.revision != rev {
                return Err("Project changed elsewhere. Reopen before saving.".into());
            }
            if incoming.revision < rev {
                return Err("Cannot save an older project revision".into());
            }
            if incoming.revision == rev && current.content != content {
                return Err("Changed project must have a new revision".into());
            }
        }
        None => {
            if path.exists() {
                return Err("Project already exists".into());
            }
        }
    }
    atomic_write(&path, content.as_bytes(), expected.is_some())?;
    read_project(root, id)
}
#[tauri::command]
pub async fn list_projects(app: AppHandle) -> Result<Vec<ProjectRecord>, String> {
    let root = root(&app)?;
    let dir = root.join("projects");
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut records = vec![];
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        match read_project(&root, &id) {
            Ok(file) => records.push(file.record),
            Err(error) => records.push(ProjectRecord {
                id: id.clone(),
                name: format!("Recovery needed · {id}"),
                revision: 0,
                updated_at: String::new(),
                recovery_error: Some(error),
            }),
        }
    }
    records.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(records)
}
#[tauri::command]
pub async fn create_project(app: AppHandle, content: String) -> Result<ProjectFile, String> {
    let (_, record) = parse(&content)?;
    save(&root(&app)?, &record.id, &content, None)
}
#[tauri::command]
pub async fn open_project(app: AppHandle, project_id: String) -> Result<ProjectFile, String> {
    read_project(&root(&app)?, &project_id)
}
#[tauri::command]
pub async fn save_project(
    app: AppHandle,
    project_id: String,
    content: String,
    expected_revision: u64,
) -> Result<ProjectFile, String> {
    save(&root(&app)?, &project_id, &content, Some(expected_revision))
}
fn safe_asset_path(relative: &str) -> Result<&Path, String> {
    let p = Path::new(relative);
    if p.components().any(|c| !matches!(c, Component::Normal(_)))
        || !relative.starts_with("assets/")
        || p.components().count() != 2
    {
        return Err("Invalid project asset path".into());
    }
    Ok(p)
}
fn asset_paths(value: &Value) -> Result<Vec<String>, String> {
    value["assets"]
        .as_array()
        .ok_or("Missing assets")?
        .iter()
        .map(|asset| {
            let p = asset["relativePath"].as_str().ok_or("Missing asset path")?;
            safe_asset_path(p)?;
            Ok(p.to_owned())
        })
        .collect()
}
fn package_manifest() -> String {
    json!({"$schema":"yadori/package@1","projectPath":"project.json"}).to_string()
}
fn validate_package_manifest(bytes: &[u8]) -> Result<(), String> {
    let value: Value =
        serde_json::from_slice(bytes).map_err(|_| "Invalid Yadori package manifest")?;
    if value["$schema"] != "yadori/package@1" {
        return Err("Unsupported Yadori package version".into());
    }
    let expected: Value =
        serde_json::from_str(&package_manifest()).map_err(|_| "Package format is unavailable")?;
    if value != expected {
        return Err("Unsupported Yadori package layout".into());
    }
    Ok(())
}
pub fn archive_project(
    root: &Path,
    id: &str,
    destination: &Path,
    content: Option<&str>,
) -> Result<(), String> {
    let project = if let Some(content) = content {
        let (_, record) = parse(content)?;
        if record.id != id {
            return Err("Export project identity mismatch".into());
        }
        ProjectFile {
            record,
            content: content.to_owned(),
            path: String::new(),
        }
    } else {
        read_project(root, id)?
    };
    let (value, _) = parse(&project.content)?;
    let mut buffer = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buffer);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let manifest = package_manifest();
        zip.start_file("manifest.json", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(manifest.as_bytes())
            .map_err(|e| e.to_string())?;
        zip.start_file("project.json", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(project.content.as_bytes())
            .map_err(|e| e.to_string())?;
        let dir = project_dir(root, id)?;
        let mut total = (project.content.len() + manifest.len()) as u64;
        for relative in asset_paths(&value)? {
            let path = asset_path(&dir, &relative)?;
            let meta = fs::symlink_metadata(&path)
                .map_err(|_| format!("Missing project asset {relative}"))?;
            if !meta.is_file() || meta.len() > MAX_ASSET {
                return Err("Invalid project asset".into());
            }
            total += meta.len();
            if total > MAX_ARCHIVE {
                return Err("Project archive is too large".into());
            }
            zip.start_file(relative, options)
                .map_err(|e| e.to_string())?;
            let mut f = File::open(path).map_err(|e| e.to_string())?;
            std::io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
    }
    atomic_write(destination, buffer.get_ref(), false)
}
pub fn import_archive(root: &Path, path: &Path) -> Result<ProjectFile, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_ARCHIVE {
        return Err("Archive is too large".into());
    }
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let declared_entries = archive_entry_count(&mut file, meta.len())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "Invalid Yadori archive")?;
    if zip.len() != declared_entries {
        return Err("Duplicate archive entries are not supported".into());
    }
    if zip.len() > 5000 {
        return Err("Too many archive entries".into());
    }
    let mut total = 0;
    let mut entries = std::collections::HashMap::new();
    for i in 0..zip.len() {
        let mut item = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = item.name().to_owned();
        if name != "project.json" && name != "manifest.json" {
            safe_asset_path(&name)?;
        }
        if (name == "manifest.json" && item.size() > 8192)
            || item.is_dir()
            || item.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
            || item.size() > MAX_PROJECT
        {
            return Err("Unsupported archive entry".into());
        }
        total += item.size();
        if total > MAX_ARCHIVE {
            return Err("Expanded archive is too large".into());
        }
        let mut bytes = Vec::new();
        item.by_ref()
            .take(MAX_PROJECT + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_PROJECT || entries.insert(name, bytes).is_some() {
            return Err("Duplicate or oversized archive entry".into());
        }
    }
    if let Some(manifest) = entries.remove("manifest.json") {
        validate_package_manifest(&manifest)?;
    }
    // Legacy private snapshots used this same strict flat layout without a manifest.
    let content = String::from_utf8(
        entries
            .remove("project.json")
            .ok_or("Archive has no project.json")?,
    )
    .map_err(|_| "Project JSON is not UTF-8")?;
    let (mut value, _) = parse(&content)?;
    let paths = asset_paths(&value)?;
    if entries.len() != paths.len() || paths.iter().any(|p| !entries.contains_key(p)) {
        return Err("Archive assets do not match project references".into());
    }
    let id = random_id()?;
    let old_id = value["id"].as_str().unwrap_or_default().to_owned();
    value["id"] = json!(id);
    if let Some(reviews) = value["reviews"].as_array_mut() {
        for review in reviews {
            if review["targetType"] == "project" && review["targetId"] == old_id {
                review["targetId"] = json!(id);
            }
        }
    }
    value["revision"] = json!(0);
    let staging = root.join("imports").join(&id);
    let result = (|| {
        let dir = project_dir(&staging, &id)?;
        for relative in paths {
            let bytes = entries.get(&relative).ok_or("Missing asset")?;
            if bytes.len() as u64 > MAX_ASSET {
                return Err("Asset is too large".into());
            }
            atomic_write(&asset_path(&dir, &relative)?, bytes, false)?;
        }
        let content = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        save(&staging, &id, &content, None)?;
        let destination = project_dir(root, &id)?;
        if destination.exists() {
            return Err("Imported project identity already exists".into());
        }
        fs::create_dir_all(root.join("projects")).map_err(|e| e.to_string())?;
        fs::rename(dir, destination).map_err(|e| e.to_string())?;
        read_project(root, &id)
    })();
    let _ = fs::remove_dir_all(staging);
    result
}
#[tauri::command]
pub async fn export_project(
    app: AppHandle,
    project_id: String,
    content: Option<String>,
) -> Result<Option<String>, String> {
    let source = match content.as_deref() {
        Some(value) => value.to_owned(),
        None => read_project(&root(&app)?, &project_id)?.content,
    };
    let (_, record) = parse(&source)?;
    let name: String = record
        .name
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| {
            if matches!(c, '/' | '\\' | ':') {
                '-'
            } else {
                c
            }
        })
        .take(60)
        .collect();
    let name = name.trim();
    let filename = format!(
        "{}.yadori",
        if name.is_empty() {
            "Untitled build"
        } else {
            name
        }
    );
    let chosen = app
        .dialog()
        .file()
        .add_filter("Yadori project", &["yadori"])
        .set_file_name(filename)
        .blocking_save_file();
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = chosen
        .into_path()
        .map_err(|_| "Unsupported export location")?;
    archive_project(&root(&app)?, &project_id, &path, content.as_deref())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
#[tauri::command]
pub async fn import_project(app: AppHandle) -> Result<Option<ProjectFile>, String> {
    let chosen = app
        .dialog()
        .file()
        .add_filter("Yadori project", &["yadori", "yadoriproject"])
        .blocking_pick_file();
    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let path = chosen
        .into_path()
        .map_err(|_| "Unsupported import location")?;
    Ok(Some(import_archive(&root(&app)?, &path)?))
}
#[tauri::command]
pub async fn add_project_asset(
    app: AppHandle,
    project_id: String,
) -> Result<Option<Value>, String> {
    let root = root(&app)?;
    read_project(&root, &project_id)?;
    let Some(chosen) = app.dialog().file().blocking_pick_file() else {
        return Ok(None);
    };
    let path = chosen
        .into_path()
        .map_err(|_| "Unsupported asset location")?;
    Ok(Some(import_asset_file(&root, &project_id, &path)?))
}
fn import_asset_file(root: &Path, project_id: &str, path: &Path) -> Result<Value, String> {
    read_project(root, project_id)?;
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_ASSET {
        return Err("Asset must be a file smaller than 24 MiB".into());
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|e| e.to_string())?
        .take(MAX_ASSET + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_ASSET {
        return Err("Asset exceeds the 24 MiB limit".into());
    }
    let extension = detect_asset_extension(&bytes)?;
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let name = format!(
        "{}.{}",
        if stem.is_empty() { "Asset" } else { &stem },
        extension
    );
    let id = random_id()?;
    let relative = format!("assets/{id}.{extension}");
    atomic_write(
        &asset_path(&project_dir(root, project_id)?, &relative)?,
        &bytes,
        false,
    )?;
    Ok(json!({"id":id,"name":name,"mediaType":media_type(extension),"relativePath":relative}))
}
fn detect_asset_extension(bytes: &[u8]) -> Result<&'static str, String> {
    for extension in ["png", "jpg", "webp", "pdf", "svg"] {
        if matches_media(bytes, media_type(extension)) {
            return Ok(extension);
        }
    }
    Err("Choose a PNG, JPEG, WebP, PDF or SVG file. The selected content is not recognized.".into())
}

fn media_type(ext: &str) -> &str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}
#[tauri::command]
pub async fn read_project_asset(
    app: AppHandle,
    project_id: String,
    relative_path: String,
) -> Result<String, String> {
    safe_asset_path(&relative_path)?;
    let root = root(&app)?;
    let file = read_project(&root, &project_id)?;
    let (value, _) = parse(&file.content)?;
    if !asset_paths(&value)?.contains(&relative_path) {
        return Err("Asset does not belong to this project".into());
    }
    let path = asset_path(&project_dir(&root, &project_id)?, &relative_path)?;
    let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > MAX_ASSET {
        return Err("Invalid asset".into());
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let ext = path.extension().and_then(|v| v.to_str()).unwrap_or("");
    Ok(format!(
        "data:{};base64,{}",
        media_type(ext),
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetWrite {
    id: Option<String>,
    name: String,
    media_type: String,
    data_base64: String,
}
#[tauri::command]
pub async fn write_project_asset(
    app: AppHandle,
    project_id: String,
    asset: AssetWrite,
) -> Result<Value, String> {
    write_asset(&root(&app)?, &project_id, asset)
}
fn write_asset(root: &Path, project_id: &str, asset: AssetWrite) -> Result<Value, String> {
    read_project(root, project_id)?;
    if asset.name.len() > 512 || asset.data_base64.len() as u64 > MAX_ASSET * 4 / 3 + 8 {
        return Err("Asset exceeds size limits".into());
    }
    let extension = match asset.media_type.as_str() {
        "image/svg+xml" => "svg",
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "application/pdf" => "pdf",
        _ => return Err("Unsupported embedded asset media type".into()),
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&asset.data_base64)
        .map_err(|_| "Invalid base64 asset")?;
    if bytes.is_empty()
        || bytes.len() as u64 > MAX_ASSET
        || !matches_media(&bytes, &asset.media_type)
    {
        return Err("Asset is empty, too large or does not match its media type".into());
    }
    let id = match asset.id {
        Some(id) => {
            validate_asset_id(&id)?;
            id
        }
        None => random_id()?,
    };
    let filename = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(id.as_bytes());
    let relative = format!("assets/{filename}.{extension}");
    let path = asset_path(&project_dir(root, project_id)?, &relative)?;
    if path.exists() {
        let existing = fs::read(&path).map_err(|e| e.to_string())?;
        if existing != bytes {
            return Err("This asset identity already has different content".into());
        }
    } else {
        atomic_write(&path, &bytes, false)?;
    }
    Ok(json!({"id":id,"name":asset.name,"mediaType":asset.media_type,"relativePath":relative}))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("yadori-next-test-{}", random_id().unwrap())))
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn content(id: &str, revision: u64) -> String {
        json!({"$schema":"yadori/project@1","id":id,"revision":revision,"name":"Build","updatedAt":"2026-11-02T12:00:00Z","parts":[],"instances":[],"layouts":[],"placements":[],"runs":[],"assets":[],"reviews":[]}).to_string()
    }
    #[test]
    fn should_keep_projects_separate_and_reject_stale_writers() {
        let f = Fixture::new();
        save(&f.0, "first", &content("first", 0), None).unwrap();
        save(&f.0, "second", &content("second", 0), None).unwrap();
        save(&f.0, "first", &content("first", 3), Some(0)).unwrap();
        assert!(save(&f.0, "first", &content("first", 4), Some(0)).is_err());
        assert_eq!(read_project(&f.0, "first").unwrap().record.revision, 3);
        assert_eq!(read_project(&f.0, "second").unwrap().record.revision, 0);
    }
    #[test]
    fn should_keep_backup_and_never_overwrite_corrupt_existing_file() {
        let f = Fixture::new();
        let original = content("first", 0);
        save(&f.0, "first", &original, None).unwrap();
        save(&f.0, "first", &content("first", 1), Some(0)).unwrap();
        let dir = project_dir(&f.0, "first").unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("project.json.backup")).unwrap(),
            original
        );
        fs::write(dir.join("project.json"), b"corrupt").unwrap();
        assert!(save(&f.0, "first", &content("first", 2), Some(1)).is_err());
        assert_eq!(
            fs::read_to_string(dir.join("project.json")).unwrap(),
            "corrupt"
        );
    }
    #[test]
    fn should_refuse_second_writer_lock() {
        let f = Fixture::new();
        save(&f.0, "first", &content("first", 0), None).unwrap();
        let lock = OpenOptions::new()
            .write(true)
            .open(project_dir(&f.0, "first").unwrap().join(".writer.lock"))
            .unwrap();
        lock.lock_exclusive().unwrap();
        assert!(save(&f.0, "first", &content("first", 1), Some(0)).is_err());
    }
    #[test]
    fn should_roundtrip_portable_assets_and_retarget_project_reviews() {
        let f = Fixture::new();
        let initial = content("first", 0);
        save(&f.0, "first", &initial, None).unwrap();
        let asset = write_asset(
            &f.0,
            "first",
            AssetWrite {
                id: Some("library-art".into()),
                name: "Battery".into(),
                media_type: "image/svg+xml".into(),
                data_base64: base64::engine::general_purpose::STANDARD
                    .encode(b"<svg xmlns='http://www.w3.org/2000/svg'/>"),
            },
        )
        .unwrap();
        let mut value: Value = serde_json::from_str(&initial).unwrap();
        value["assets"] = json!([asset]);
        value["reviews"] = json!([{"targetType":"project","targetId":"first"}]);
        value["revision"] = json!(1);
        save(&f.0, "first", &value.to_string(), Some(0)).unwrap();
        let archive = f.0.join("portable.yadori");
        archive_project(&f.0, "first", &archive, None).unwrap();
        let mut exported = zip::ZipArchive::new(File::open(&archive).unwrap()).unwrap();
        let mut manifest = String::new();
        exported
            .by_name("manifest.json")
            .unwrap()
            .read_to_string(&mut manifest)
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&manifest).unwrap(),
            json!({"$schema":"yadori/package@1","projectPath":"project.json"})
        );
        let imported = import_archive(&f.0, &archive).unwrap();
        assert_ne!(imported.record.id, "first");
        let imported_value: Value = serde_json::from_str(&imported.content).unwrap();
        assert_eq!(imported_value["reviews"][0]["targetId"], imported.record.id);
        assert!(project_dir(&f.0, &imported.record.id)
            .unwrap()
            .join(
                imported_value["assets"][0]["relativePath"]
                    .as_str()
                    .unwrap()
            )
            .is_file());
        assert_eq!(imported.record.revision, 0);
    }
    #[test]
    fn should_export_current_memory_without_overwriting_managed_head() {
        let f = Fixture::new();
        save(&f.0, "first", &content("first", 0), None).unwrap();
        let mut current: Value = serde_json::from_str(&content("first", 9)).unwrap();
        current["name"] = json!("Unsaved edits");
        let archive = f.0.join("recovery.yadori");
        archive_project(&f.0, "first", &archive, Some(&current.to_string())).unwrap();
        let imported = import_archive(&f.0, &archive).unwrap();
        assert_eq!(imported.record.name, "Unsaved edits");
        assert_eq!(read_project(&f.0, "first").unwrap().record.revision, 0);
        fs::write(
            project_dir(&f.0, "first").unwrap().join("project.json"),
            "broken",
        )
        .unwrap();
        assert!(archive_project(&f.0, "first", &archive, Some(&current.to_string())).is_ok());
    }
    #[test]
    fn should_reject_traversal_and_missing_assets() {
        for id in ["../outside", "/absolute", "a/b", ""] {
            assert!(project_dir(Path::new("/unused"), id).is_err());
        }
        for p in [
            "assets/../outside",
            "assets/a/b",
            "/assets/a",
            "../a",
            "assets/",
        ] {
            assert!(safe_asset_path(p).is_err());
        }
        let f = Fixture::new();
        let mut value: Value = serde_json::from_str(&content("first", 0)).unwrap();
        value["assets"] = json!([{"relativePath":"assets/missing.svg"}]);
        save(&f.0, "first", &value.to_string(), None).unwrap();
        assert!(archive_project(&f.0, "first", &f.0.join("test.yadori"), None).is_err());
    }
    #[test]
    fn should_reject_future_or_malformed_package_manifests_before_storage_mutation() {
        let f = Fixture::new();
        fs::create_dir_all(&f.0).unwrap();
        for manifest in [
            json!({"$schema":"yadori/package@2","projectPath":"project.json"}).to_string(),
            json!({"$schema":"yadori/package@1","projectPath":"other.json"}).to_string(),
            json!({"$schema":"yadori/package@1","projectPath":"project.json","unexpected":true})
                .to_string(),
            "invalid JSON".into(),
        ] {
            let archive = f.0.join("future.yadori");
            let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("manifest.json", options).unwrap();
            zip.write_all(manifest.as_bytes()).unwrap();
            zip.start_file("project.json", options).unwrap();
            zip.write_all(content("first", 0).as_bytes()).unwrap();
            zip.finish().unwrap();
            assert!(import_archive(&f.0, &archive).is_err());
            assert!(!f.0.join("projects").exists());
            assert!(!f.0.join("imports").exists());
        }
    }
    #[test]
    fn should_import_legacy_private_flat_archives_without_a_manifest() {
        let f = Fixture::new();
        fs::create_dir_all(&f.0).unwrap();
        let archive = f.0.join("legacy.yadori");
        let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
        zip.start_file("project.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(content("old", 0).as_bytes()).unwrap();
        zip.finish().unwrap();
        let imported = import_archive(&f.0, &archive).unwrap();
        assert_eq!(imported.record.name, "Build");
        assert_ne!(imported.record.id, "old");
    }
    #[test]
    fn should_reject_zip_slip_unknown_entries_and_duplicates() {
        let f = Fixture::new();
        fs::create_dir_all(&f.0).unwrap();
        for names in [
            vec!["../outside"],
            vec!["credentials.json"],
            vec!["project.json", "project.jsox"],
        ] {
            let path = f.0.join("bad.yadori");
            let file = File::create(&path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            for name in names {
                zip.start_file(name, zip::write::SimpleFileOptions::default())
                    .unwrap();
                zip.write_all(content("first", 0).as_bytes()).unwrap();
            }
            zip.finish().unwrap();
            let mut bytes = fs::read(&path).unwrap();
            let needle = b"project.jsox";
            for start in 0..bytes.len().saturating_sub(needle.len()) {
                if &bytes[start..start + needle.len()] == needle {
                    bytes[start..start + needle.len()].copy_from_slice(b"project.json");
                }
            }
            fs::write(&path, bytes).unwrap();
            assert!(import_archive(&f.0, &path).is_err());
        }
    }
    #[test]
    fn should_infer_known_asset_types_from_bytes_instead_of_filename_extensions() {
        for (bytes, expected) in [
            (b"\x89PNG\r\n\x1a\nfixture".as_slice(), "png"),
            (b"\xff\xd8\xfffixture".as_slice(), "jpg"),
            (b"RIFFxxxxWEBPfixture".as_slice(), "webp"),
            (b"%PDF-1.7 fixture".as_slice(), "pdf"),
            (
                b"<svg xmlns='http://www.w3.org/2000/svg'/>".as_slice(),
                "svg",
            ),
        ] {
            assert_eq!(detect_asset_extension(bytes).unwrap(), expected);
        }
        let f = Fixture::new();
        save(&f.0, "first", &content("first", 0), None).unwrap();
        let path = f.0.join("receipt.png");
        let jpeg = b"\xff\xd8\xfffixture";
        fs::write(&path, jpeg).unwrap();
        let asset = import_asset_file(&f.0, "first", &path).unwrap();
        assert_eq!(asset["mediaType"], "image/jpeg");
        assert_eq!(asset["name"], "receipt.jpg");
        let relative = asset["relativePath"].as_str().unwrap();
        assert!(relative.ends_with(".jpg"));
        let stored = fs::read(project_dir(&f.0, "first").unwrap().join(relative)).unwrap();
        assert_eq!(stored, jpeg);
        assert!(matches_media(&stored, asset["mediaType"].as_str().unwrap()));
    }
    #[test]
    fn should_reject_unsupported_asset_bytes_before_creating_managed_assets() {
        for bytes in [
            b"".as_slice(),
            b"not an image".as_slice(),
            b"#!/bin/sh\necho test".as_slice(),
            b"<html><svg/></html>".as_slice(),
        ] {
            assert!(detect_asset_extension(bytes).is_err());
        }
        let f = Fixture::new();
        let original = content("first", 0);
        save(&f.0, "first", &original, None).unwrap();
        let path = f.0.join("unsupported.png");
        fs::write(&path, b"not image content").unwrap();
        assert!(import_asset_file(&f.0, "first", &path).is_err());
        assert!(!project_dir(&f.0, "first").unwrap().join("assets").exists());
        assert_eq!(read_project(&f.0, "first").unwrap().content, original);
    }
    #[test]
    fn should_keep_embedded_asset_identity_immutable() {
        let f = Fixture::new();
        save(&f.0, "first", &content("first", 0), None).unwrap();
        let asset = |bytes: &[u8]| AssetWrite {
            id: Some("asset".into()),
            name: "Art".into(),
            media_type: "image/png".into(),
            data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        };
        assert!(write_asset(&f.0, "first", asset(b"\x89PNG\r\n\x1a\nfirst")).is_ok());
        assert!(write_asset(&f.0, "first", asset(b"\x89PNG\r\n\x1a\nfirst")).is_ok());
        assert!(write_asset(&f.0, "first", asset(b"\x89PNG\r\n\x1a\nsecond")).is_err());
    }
}

fn asset_path(dir: &Path, relative: &str) -> Result<PathBuf, String> {
    safe_asset_path(relative)?;
    if let Ok(meta) = fs::symlink_metadata(dir.join("assets")) {
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err("Project assets directory is invalid".into());
        }
    }
    let path = dir.join(relative);
    if let Ok(meta) = fs::symlink_metadata(&path) {
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err("Project asset is invalid".into());
        }
    }
    Ok(path)
}

fn archive_entry_count(file: &mut File, length: u64) -> Result<usize, String> {
    let tail_len = length.min(65557);
    file.seek(SeekFrom::End(-(tail_len as i64)))
        .map_err(|e| e.to_string())?;
    let mut tail = Vec::new();
    file.read_to_end(&mut tail).map_err(|e| e.to_string())?;
    let offset = (0..tail.len().saturating_sub(21))
        .rev()
        .find(|i| {
            tail[*i..].starts_with(b"PK\x05\x06")
                && *i + 22 + u16::from_le_bytes([tail[*i + 20], tail[*i + 21]]) as usize
                    == tail.len()
        })
        .ok_or("Archive footer is invalid")?;
    let count = u16::from_le_bytes([tail[offset + 10], tail[offset + 11]]);
    if count == u16::MAX
        || tail[offset + 4..offset + 8] != [0, 0, 0, 0]
        || tail[offset + 8..offset + 10] != tail[offset + 10..offset + 12]
    {
        return Err("Multipart and ZIP64 archives are not supported".into());
    }
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    Ok(count as usize)
}

fn validate_asset_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 120
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':'))
    {
        return Err("Invalid embedded asset identity".into());
    }
    Ok(())
}
pub fn import_library_asset(
    root: &Path,
    project_id: &str,
    asset_id: &str,
) -> Result<Value, String> {
    let assets: Value = serde_json::from_str(crate::library_data::ASSETS)
        .map_err(|_| "Bundled asset catalog is invalid")?;
    let asset = assets
        .as_array()
        .and_then(|items| items.iter().find(|asset| asset["id"] == asset_id))
        .ok_or("Unknown library asset")?;
    let bytes =
        crate::library_data::asset_bytes(asset_id).ok_or("Library artwork is unavailable")?;
    let mut result = write_asset(
        root,
        project_id,
        AssetWrite {
            id: Some(asset_id.to_owned()),
            name: asset["name"].as_str().unwrap_or("Artwork").into(),
            media_type: asset["mediaType"]
                .as_str()
                .ok_or("Missing media type")?
                .into(),
            data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        },
    )?;
    result["sourceUrl"] = asset["sourceUrl"].clone();
    result["attribution"] = asset["attribution"].clone();
    Ok(result)
}

fn matches_media(bytes: &[u8], media: &str) -> bool {
    match media {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        "application/pdf" => bytes.starts_with(b"%PDF-"),
        "image/svg+xml" => std::str::from_utf8(bytes).is_ok_and(|text| {
            let text = text.trim_start_matches('\u{feff}').trim_start();
            (text.starts_with("<svg") || text.starts_with("<?xml") || text.starts_with("<!--"))
                && text.contains("<svg")
        }),
        _ => false,
    }
}

#[tauri::command]
pub async fn open_project_asset(
    app: AppHandle,
    project_id: String,
    relative_path: String,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let root = root(&app)?;
    let file = read_project(&root, &project_id)?;
    let (value, _) = parse(&file.content)?;
    if !asset_paths(&value)?.contains(&relative_path) {
        return Err("Asset does not belong to this project".into());
    }
    let path = asset_path(&project_dir(&root, &project_id)?, &relative_path)?;
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if !matches!(ext, "pdf" | "png" | "jpg" | "jpeg" | "webp") {
        return Err("Native preview supports PDF and raster image receipts".into());
    }
    let meta = fs::symlink_metadata(&path).map_err(|_| "Receipt could not be read")?;
    if !meta.is_file() || meta.len() > MAX_ASSET {
        return Err("Invalid receipt asset".into());
    }
    let bytes = fs::read(&path).map_err(|_| "Receipt could not be read")?;
    if !matches_media(&bytes, media_type(ext)) {
        return Err("Receipt file does not match its media type".into());
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|_| "The operating system could not open this receipt".into())
}
