use super::store::{self, LibraryItemDto, LibraryScope, ASSET_FILE, MANIFEST_FILE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

// A Pack is a `.marblepack` folder with any mix of themes, skins and decor:
//   pack.json                manifest: name, author, items
//   themes/<id>.json         a project theme
//   assets/<id>/             a library item: manifest.json, asset.blend, preview.png
// Added Packs live in the app's support folder (`Packs/`); a project copies what it uses, so it stays portable. Each
// copy records its origin in its manifest, so a project on another Mac still names the Pack. `version` changes nothing
// in a project yet; it is kept for telling a Pack's updates apart later.

pub const PACKS_FOLDER: &str = "Packs";
pub const PACK_FILE: &str = "pack.json";
/// Optional picture of a Pack's card
const PICTURE_FILE: &str = "picture.png";
pub const PACK_EXTENSION: &str = "marblepack";
const PACK_SCHEMA: &str = "marble-pack@1";
const THEMES_FOLDER: &str = "themes";
const ASSETS_FOLDER: &str = "assets";

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PackManifest {
    #[serde(rename = "$schema")]
    pub schema: String,
    /// Defaults to the name as an ID
    pub id: Option<String>,
    pub name: String,
    /// Defaults to `1.0`
    pub version: Option<String>,
    /// One line for the Pack's card
    pub description: Option<String>,
    pub author: Option<String>,
    /// Where to get it, shown when a project has items of a Pack not added on this Mac
    pub link: Option<String>,
    pub items: Vec<PackItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PackItem {
    pub kind: PackItemKind,
    pub id: String,
    pub label: String,
    /// Where it comes from, such as `agent`
    pub origin: Option<String>,
    /// A bundled Pack's item that the app draws itself until real assets exist: `decor:bauble-red`, `platform:gold`. It has no folder.
    pub source: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum PackItemKind {
    Theme,
    Skin,
    Decor,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PackDto {
    pub id: String,
    /// Absolute folder, which Add copies a bundled Pack from
    pub path: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub link: Option<String>,
    pub picture_path: Option<String>,
    /// Raw `themes/<id>.json` files, validated by the app
    pub themes_json: Vec<String>,
    pub items: Vec<LibraryItemDto>,
    /// Decor the app draws itself, by source
    pub built_in_decor: Vec<String>,
}

/// A theme to write into a Pack, as JSON the app validated
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PackThemeDto {
    pub id: String,
    pub json: String,
}

/// Imports a Pack folder into `root`. Importing a Pack of the same ID replaces it.
pub fn import_pack(source: &Path, root: &Path) -> Result<PackDto, String> {
    let manifest = read_manifest(source)?;
    let id = manifest_id(&manifest);
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let staging = root.join(format!(".{}.tmp-{}", id, nanos()));
    let result = (|| -> Result<(), String> {
        fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
        fs::copy(source.join(PACK_FILE), staging.join(PACK_FILE)).map_err(|error| error.to_string())?;
        let picture = source.join(PICTURE_FILE);
        reject_link(&picture)?;
        if picture.is_file() {
            fs::copy(&picture, staging.join(PICTURE_FILE)).map_err(|error| error.to_string())?;
        }
        for item in &manifest.items {
            if !store::is_valid_id(&item.id) {
                return Err(format!("{} has an invalid item ID: {}", manifest.name, item.id));
            }
            if item.source.is_some() {
                continue;
            }
            if item.kind == PackItemKind::Theme {
                let from = source.join(THEMES_FOLDER).join(format!("{}.json", item.id));
                reject_link(&from)?;
                let to = staging.join(THEMES_FOLDER);
                fs::create_dir_all(&to).map_err(|error| error.to_string())?;
                fs::copy(&from, to.join(format!("{}.json", item.id)))
                    .map_err(|_| format!("{} says it holds the theme {}, but its file is missing", manifest.name, item.label))?;
                continue;
            }
            let from = source.join(ASSETS_FOLDER).join(&item.id);
            for name in [MANIFEST_FILE, ASSET_FILE, store::PREVIEW_FILE] {
                reject_link(&from.join(name))?;
            }
            let tagged = tagged_manifest(&from, &item.id, &manifest)?;
            store::copy_item(&from, &staging.join(ASSETS_FOLDER), &item.id, Some(&tagged))
                .map_err(|error| error.to_string())?;
        }
        let target = root.join(&id);
        if target.exists() {
            fs::remove_dir_all(&target).map_err(|error| error.to_string())?;
        }
        return fs::rename(&staging, &target).map_err(|error| error.to_string());
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result?;
    return read_pack(&root.join(&id), &id);
}

/// The imported Packs by name. A folder that can't be read is left out.
pub fn list_packs(root: &Path) -> Vec<PackDto> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut packs: Vec<PackDto> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let id = entry.file_name().to_str()?.to_string();
            if !store::is_valid_id(&id) {
                return None;
            }
            return read_pack(&entry.path(), &id).ok();
        })
        .collect();
    packs.sort_by(|a, b| a.name.cmp(&b.name));
    return packs;
}

/// The Packs that ship inside the app, none added until a person adds them
pub fn list_bundled(root: &Path) -> Vec<PackDto> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut packs: Vec<PackDto> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let manifest = read_manifest(&entry.path()).ok()?;
            return read_pack(&entry.path(), &manifest_id(&manifest)).ok();
        })
        .collect();
    packs.sort_by(|a, b| a.name.cmp(&b.name));
    return packs;
}

pub fn remove_pack(root: &Path, id: &str) -> Result<(), String> {
    if !store::is_valid_id(id) {
        return Err(format!("Invalid Pack ID {}", id));
    }
    return fs::remove_dir_all(root.join(id)).map_err(|error| error.to_string());
}

/// Writes a Pack folder at `destination` with the project's items and the given themes. Returns its path.
pub fn export_pack(
    package: &Path,
    destination: &Path,
    manifest_json: &str,
    themes: &[PackThemeDto],
    asset_ids: &[String],
) -> Result<PathBuf, String> {
    let manifest: PackManifest =
        serde_json::from_str(manifest_json).map_err(|error| format!("Invalid Pack: {}", error))?;
    check_manifest(&manifest)?;
    let target = pack_path(destination);
    if target.exists() {
        return Err(format!("{} already exists", target.display()));
    }
    let result = (|| -> Result<(), String> {
        fs::create_dir_all(&target).map_err(|error| error.to_string())?;
        fs::write(target.join(PACK_FILE), format!("{}\n", manifest_json.trim_end())).map_err(|error| error.to_string())?;
        for theme in themes {
            if !store::is_valid_id(&theme.id) {
                return Err(format!("Invalid theme ID {}", theme.id));
            }
            let folder = target.join(THEMES_FOLDER);
            fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
            fs::write(folder.join(format!("{}.json", theme.id)), &theme.json).map_err(|error| error.to_string())?;
        }
        for id in asset_ids {
            let from = package.join(ASSETS_FOLDER).join(id);
            let tagged = tagged_manifest(&from, id, &manifest)?;
            store::copy_item(&from, &target.join(ASSETS_FOLDER), id, Some(&tagged)).map_err(|error| error.to_string())?;
        }
        return Ok(());
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&target);
    }
    result?;
    return Ok(target);
}

/// Copies a Pack's item into the project's library. The item already copied from this Pack is reused; another item
/// with that ID keeps it, and this one takes a free ID. Returns the project's item.
pub fn copy_into_project(source: &Path, assets: &Path, id: &str) -> Result<LibraryItemDto, String> {
    let pack = pack_of(source);
    let mut target_id = id.to_string();
    let mut suffix = 1;
    while assets.join(&target_id).exists() {
        if pack.is_some() && pack_of(&assets.join(&target_id)) == pack {
            return Ok(store::item(&assets.join(&target_id), &target_id, LibraryScope::Project));
        }
        suffix += 1;
        target_id = format!("{}-{}", id, suffix);
    }
    let manifest = fs::read_to_string(source.join(MANIFEST_FILE)).map_err(|error| error.to_string())?;
    let mut value: Value = serde_json::from_str(&manifest).map_err(|error| error.to_string())?;
    value["id"] = Value::String(target_id.clone());
    let target = store::copy_item(source, assets, &target_id, Some(&pretty(&value)))
        .map_err(|error| error.to_string())?;
    return Ok(store::item(&target, &target_id, LibraryScope::Project));
}

/// A folder path with the Pack extension
fn pack_path(path: &Path) -> PathBuf {
    if path.extension().is_some_and(|extension| extension == PACK_EXTENSION) {
        return path.to_path_buf();
    }
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(".{}", PACK_EXTENSION));
    return PathBuf::from(name);
}

fn read_pack(dir: &Path, id: &str) -> Result<PackDto, String> {
    let manifest = read_manifest(dir)?;
    let mut themes_json = Vec::new();
    let mut items = Vec::new();
    let mut built_in_decor = Vec::new();
    for item in &manifest.items {
        if let Some(source) = &item.source {
            // A theme or skin the app draws itself needs nothing from here; the Starter Pack's are read in the app
            if item.kind == PackItemKind::Decor {
                built_in_decor.push(source.clone());
            }
        } else if item.kind == PackItemKind::Theme {
            let path = dir.join(THEMES_FOLDER).join(format!("{}.json", item.id));
            themes_json.push(fs::read_to_string(path).map_err(|error| error.to_string())?);
        } else {
            let mut listed = store::item(&dir.join(ASSETS_FOLDER).join(&item.id), &item.id, LibraryScope::Global);
            listed.pack_id = Some(id.to_string());
            items.push(listed);
        }
    }
    return Ok(PackDto {
        id: id.to_string(),
        path: dir.display().to_string(),
        version: manifest_version(&manifest),
        name: manifest.name,
        description: manifest.description,
        author: manifest.author,
        link: manifest.link,
        picture_path: dir.join(PICTURE_FILE).is_file().then(|| dir.join(PICTURE_FILE).display().to_string()),
        themes_json,
        items,
        built_in_decor,
    });
}

fn read_manifest(dir: &Path) -> Result<PackManifest, String> {
    let path = dir.join(PACK_FILE);
    reject_link(&path)?;
    let json = fs::read_to_string(&path).map_err(|_| format!("{} is not a MidiMarble Pack", dir.display()))?;
    let manifest: PackManifest =
        serde_json::from_str(&json).map_err(|error| format!("pack.json can't be read: {}", error))?;
    check_manifest(&manifest)?;
    return Ok(manifest);
}

fn check_manifest(manifest: &PackManifest) -> Result<(), String> {
    if manifest.schema != PACK_SCHEMA {
        return Err(format!("This Pack needs a newer MidiMarble ({})", manifest.schema));
    }
    if manifest.name.trim().is_empty() {
        return Err("A Pack needs a name".to_string());
    }
    return Ok(());
}

/// An item's manifest carrying its origin, which still names the Pack on a Mac that doesn't have it
fn tagged_manifest(dir: &Path, id: &str, pack: &PackManifest) -> Result<String, String> {
    let json = fs::read_to_string(dir.join(MANIFEST_FILE)).map_err(|_| format!("{} has no manifest.json", id))?;
    let mut value: Value = serde_json::from_str(&json).map_err(|error| format!("{}'s manifest can't be read: {}", id, error))?;
    if !value.is_object() {
        return Err(format!("{}'s manifest can't be read", id));
    }
    let mut origin = serde_json::json!({
        "packId": manifest_id(pack),
        "packName": pack.name,
        "version": manifest_version(pack),
    });
    if let Some(author) = &pack.author {
        origin["author"] = Value::String(author.clone());
    }
    if let Some(link) = &pack.link {
        origin["link"] = Value::String(link.clone());
    }
    value["pack"] = origin;
    return Ok(pretty(&value));
}

fn pack_of(item: &Path) -> Option<String> {
    let json = fs::read_to_string(item.join(MANIFEST_FILE)).ok()?;
    let value: Value = serde_json::from_str(&json).ok()?;
    return value["pack"]["packId"].as_str().map(str::to_string);
}

fn pretty(value: &Value) -> String {
    return format!("{}\n", serde_json::to_string_pretty(value).unwrap_or_default());
}

fn manifest_id(manifest: &PackManifest) -> String {
    return match &manifest.id {
        Some(id) if store::is_valid_id(id) => id.clone(),
        _ => pack_id(&manifest.name),
    };
}

fn manifest_version(manifest: &PackManifest) -> String {
    return manifest.version.clone().unwrap_or_else(|| "1.0".to_string());
}

fn pack_id(name: &str) -> String {
    let slug: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let slug = slug.trim_matches('-').chars().take(56).collect::<String>();
    return if slug.is_empty() { "pack".to_string() } else { slug };
}

/// A Pack comes from elsewhere, so a link in it must not pull in files from outside it
fn reject_link(path: &Path) -> Result<(), String> {
    let is_link = fs::symlink_metadata(path).map(|meta| meta.file_type().is_symlink()).unwrap_or(false);
    if is_link {
        return Err(format!("{} is a link, which a Pack can't hold", path.display()));
    }
    return Ok(());
}

fn nanos() -> u128 {
    return SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temporary_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("mm-pack-{}-{}", name, nanos()));
        fs::create_dir_all(&root).unwrap();
        return root;
    }

    fn write_item(assets: &Path, id: &str, extra: Value) {
        let dir = assets.join(id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(ASSET_FILE), b"BLENDER").unwrap();
        let mut manifest = json!({ "$schema": "marble-asset@1", "id": id, "label": id, "role": "decoration" });
        for (key, value) in extra.as_object().unwrap() {
            manifest[key] = value.clone();
        }
        fs::write(dir.join(MANIFEST_FILE), manifest.to_string()).unwrap();
    }

    fn manifest(name: &str) -> String {
        return json!({
            "$schema": PACK_SCHEMA,
            "name": name,
            "version": "2.1",
            "description": "A cosy film",
            "author": "Ann",
            "link": "https://example.com/christmas",
            "items": [
                { "kind": "theme", "id": "cosy", "label": "Cosy" },
                { "kind": "decor", "id": "bauble", "label": "Bauble", "origin": "agent" }
            ]
        })
        .to_string();
    }

    fn exported(root: &Path, name: &str) -> PathBuf {
        let package = root.join(format!("{}.marble", name));
        write_item(&package.join(ASSETS_FOLDER), "bauble", json!({}));
        let themes = [PackThemeDto { id: "cosy".to_string(), json: "{\"name\":\"Cosy\"}".to_string() }];
        return export_pack(&package, &root.join(name), &manifest(name), &themes, &["bauble".to_string()]).unwrap();
    }

    #[test]
    fn exports_imports_and_lists_a_pack() {
        let root = temporary_root("roundtrip");
        let pack = exported(&root, "Christmas");
        assert!(pack.ends_with("Christmas.marblepack"));
        assert!(pack.join(PACK_FILE).is_file());
        assert!(pack.join("themes/cosy.json").is_file());
        assert!(pack.join("assets/bauble/asset.blend").is_file());

        let library = root.join(PACKS_FOLDER);
        let imported = import_pack(&pack, &library).unwrap();
        assert_eq!(imported.id, "christmas");
        assert_eq!(imported.author.as_deref(), Some("Ann"));
        assert_eq!(imported.description.as_deref(), Some("A cosy film"));
        assert_eq!(imported.themes_json, ["{\"name\":\"Cosy\"}"]);
        assert_eq!(imported.items[0].pack_id.as_deref(), Some("christmas"));
        let item: Value = serde_json::from_str(imported.items[0].manifest_json.as_ref().unwrap()).unwrap();
        assert_eq!(item["pack"], json!({ "packId": "christmas", "packName": "Christmas", "version": "2.1", "author": "Ann", "link": "https://example.com/christmas" }));
        assert_eq!(imported.version, "2.1");
        assert_eq!(imported.link.as_deref(), Some("https://example.com/christmas"));

        // Several Packs live side by side; the same name replaces
        let second = exported(&root, "Autumn");
        import_pack(&second, &library).unwrap();
        import_pack(&pack, &library).unwrap();
        let names: Vec<String> = list_packs(&library).into_iter().map(|pack| pack.name).collect();
        assert_eq!(names, ["Autumn", "Christmas"]);

        remove_pack(&library, "autumn").unwrap();
        assert_eq!(list_packs(&library).len(), 1);
        assert!(remove_pack(&library, "../x").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_bundled_starter_adds_without_asset_folders() {
        let bundled = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../packs");
        let packs = list_bundled(&bundled);
        let starter = packs.iter().find(|pack| pack.name == "Starter").unwrap();
        assert_eq!(starter.built_in_decor, vec!["decor:snowfall".to_string()]);
        let christmas = packs.iter().find(|pack| pack.name == "Christmas").unwrap();
        assert!(christmas.built_in_decor.contains(&"decor:bauble-red".to_string()));
        assert!(starter.items.is_empty());
        assert!(starter.description.is_some());

        let root = temporary_root("starter");
        let library = root.join(PACKS_FOLDER);
        let added = import_pack(Path::new(&starter.path), &library).unwrap();
        assert_eq!(added.id, "starter");
        assert_eq!(added.built_in_decor.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_what_is_not_a_pack() {
        let root = temporary_root("reject");
        let library = root.join(PACKS_FOLDER);
        assert!(import_pack(&root.join("nothing"), &library).is_err());

        let wrong = root.join("Wrong.marblepack");
        fs::create_dir_all(&wrong).unwrap();
        fs::write(wrong.join(PACK_FILE), json!({ "$schema": "marble-pack@9", "name": "X", "items": [] }).to_string()).unwrap();
        assert!(import_pack(&wrong, &library).unwrap_err().contains("newer"));

        let escaping = root.join("Escaping.marblepack");
        fs::create_dir_all(&escaping).unwrap();
        fs::write(escaping.join(PACK_FILE), json!({ "$schema": PACK_SCHEMA, "name": "X", "items": [{ "kind": "decor", "id": "../../x", "label": "x" }] }).to_string()).unwrap();
        assert!(import_pack(&escaping, &library).unwrap_err().contains("invalid"));

        let linked = exported(&root, "Linked");
        let asset = linked.join("assets/bauble").join(ASSET_FILE);
        fs::remove_file(&asset).unwrap();
        std::os::unix::fs::symlink("/etc/hosts", &asset).unwrap();
        assert!(import_pack(&linked, &library).unwrap_err().contains("link"));
        assert!(list_packs(&library).is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copies_into_a_project_once_and_keeps_other_items() {
        let root = temporary_root("project");
        let assets = root.join("project/assets");
        write_item(&assets, "bauble", json!({}));
        let source = root.join("packs/christmas/assets");
        write_item(&source, "bauble", json!({ "pack": { "packId": "christmas", "packName": "Christmas", "version": "1.0" } }));

        let copied = copy_into_project(&source.join("bauble"), &assets, "bauble").unwrap();
        assert_eq!(copied.id, "bauble-2");
        let manifest: Value = serde_json::from_str(copied.manifest_json.as_ref().unwrap()).unwrap();
        assert_eq!(manifest["id"], "bauble-2");
        assert_eq!(manifest["pack"]["packName"], "Christmas");

        // Using it again finds the copy
        let again = copy_into_project(&source.join("bauble"), &assets, "bauble").unwrap();
        assert_eq!(again.id, "bauble-2");
        fs::remove_dir_all(root).unwrap();
    }
}
