use serde::Deserialize;
use std::fmt::Write as _;
use std::fs;
use std::path::{Component, Path, PathBuf};

pub const CANDIDATES_FOLDER: &str = "candidates";
pub const BRIEF_FILE: &str = "BRIEF.md";
pub const BRIEF_JSON_FILE: &str = "brief.json";
pub const PREVIEW_SCRIPT_FILE: &str = "mm_preview.py";
const PREVIEW_SCRIPT: &str = include_str!("mm_preview.py");

/// Brief built by the app from the project and the simulation result. Mirrors `TAgentBrief` in TypeScript.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBrief {
    pub request: String,
    pub target: BriefTarget,
    #[serde(default)]
    pub params: Vec<BriefParam>,
    pub contact: Option<BriefContact>,
    #[serde(default)]
    pub hit_times: Vec<f64>,
    #[serde(default)]
    pub reaction_slots: Vec<BriefReactionSlot>,
    pub scale: BriefScale,
    pub wall_point: Option<BriefVec2>,
    /// Set for a New Theme request: the agent also proposes the theme's colours in `manifest.json`
    pub theme: Option<BriefTheme>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefTheme {
    /// Built-in theme the project shows now
    pub base: String,
    #[serde(default)]
    pub bases: Vec<String>,
    #[serde(default)]
    pub fields: Vec<BriefThemeField>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefThemeField {
    /// `wallColor`, `lightColor`, `glowColor` or `backgroundColor`
    pub name: String,
    pub label: String,
    pub description: String,
    /// The colour the project shows now, as `#rrggbb`
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefTarget {
    /// `piece`, `scene` or `wall`
    pub kind: String,
    pub entity_id: Option<String>,
    pub name: Option<String>,
    /// `skin`, `decoration` or `text`
    pub role: String,
    pub piece_type: Option<String>,
    pub piece_label: Option<String>,
    /// Pieces of this type in the project, which an accepted skin applies to
    pub piece_count: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefParam {
    pub name: String,
    pub label: String,
    pub value: f64,
    pub unit: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefContact {
    pub description: String,
    /// Surface normal in wall coordinates at the linked hit, pointing toward the incoming marble
    pub normal: Option<BriefVec2>,
    pub point: Option<BriefVec2>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefReactionSlot {
    /// `press`, `wobble` or `glow`
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefScale {
    pub marble_radius: f64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct BriefVec2 {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, thiserror::Error)]
pub enum BriefError {
    #[error("Run ID must use 1 to 64 letters, digits, '-' or '_'")]
    InvalidRunId,
    #[error("{0} is not a MidiMarble project")]
    NotAPackage(String),
    #[error("Candidate {0} already exists")]
    AlreadyExists(String),
    #[error("Candidate folder escapes the package: {0}")]
    OutsidePackage(String),
    #[error("Invalid brief: {0}")]
    InvalidBrief(String),
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

/// `<package>/candidates/<runId>`, checked to stay inside the package's candidates folder
pub fn candidate_dir(package: &Path, run_id: &str) -> Result<PathBuf, BriefError> {
    if !is_valid_id(run_id) {
        return Err(BriefError::InvalidRunId);
    }
    if !package.join("project.json").is_file() {
        return Err(BriefError::NotAPackage(package.display().to_string()));
    }
    let dir = package.join(CANDIDATES_FOLDER).join(run_id);
    ensure_inside(&package.join(CANDIDATES_FOLDER), &dir)?;
    return Ok(dir);
}

/// Rejects a path that leaves `root` lexically or through an existing symlink
pub fn ensure_inside(root: &Path, path: &Path) -> Result<(), BriefError> {
    let escapes = path
        .strip_prefix(root)
        .map(|rest| {
            rest.components()
                .any(|part| !matches!(part, Component::Normal(_)))
        })
        .unwrap_or(true);
    if escapes {
        return Err(BriefError::OutsidePackage(path.display().to_string()));
    }
    if let (Ok(real_root), Ok(real_path)) = (root.canonicalize(), path.canonicalize()) {
        if !real_path.starts_with(&real_root) {
            return Err(BriefError::OutsidePackage(path.display().to_string()));
        }
    }
    return Ok(());
}

/// Creates the candidate folder with `BRIEF.md`, `brief.json` and the preview helper. Returns the folder.
pub fn write_candidate(
    package: &Path,
    run_id: &str,
    brief_json: &str,
    blender: Option<&Path>,
) -> Result<PathBuf, BriefError> {
    let brief: AgentBrief = serde_json::from_str(brief_json)
        .map_err(|error| BriefError::InvalidBrief(error.to_string()))?;
    let dir = candidate_dir(package, run_id)?;
    if dir.exists() {
        return Err(BriefError::AlreadyExists(run_id.to_string()));
    }
    fs::create_dir_all(&dir).map_err(|source| io("create", &dir, source))?;
    ensure_inside(&package.join(CANDIDATES_FOLDER), &dir)?;
    let markdown = render_brief(&brief, blender);
    write(&dir.join(BRIEF_FILE), markdown.as_bytes())?;
    write(&dir.join(BRIEF_JSON_FILE), brief_json.as_bytes())?;
    write(&dir.join(PREVIEW_SCRIPT_FILE), PREVIEW_SCRIPT.as_bytes())?;
    return Ok(dir);
}

/// Human-readable brief the agent reads first
pub fn render_brief(brief: &AgentBrief, blender: Option<&Path>) -> String {
    let blender = blender
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "/Applications/Blender.app/Contents/MacOS/Blender".to_string());
    let mut out = String::new();
    let target = &brief.target;

    let _ = writeln!(out, "# MidiMarble candidate brief\n");
    let _ = writeln!(out, "## Request\n\n{}\n", brief.request.trim());

    let _ = writeln!(out, "## Target\n");
    let _ = writeln!(out, "- Kind: {}", target.kind);
    let _ = writeln!(out, "- Role: {}", target.role);
    if let Some(name) = &target.name {
        let _ = writeln!(out, "- Name: {}", name);
    }
    if let Some(entity) = &target.entity_id {
        let _ = writeln!(out, "- Entity: `{}`", entity);
    }
    if let Some(piece_type) = &target.piece_type {
        let label = target.piece_label.as_deref().unwrap_or(piece_type);
        let _ = writeln!(out, "- Piece type: `{}` ({})", piece_type, label);
    }
    if let Some(count) = target.piece_count {
        let _ = writeln!(
            out,
            "- Accepting the candidate applies it to all {} pieces of this type",
            count
        );
    }
    out.push('\n');

    if !brief.params.is_empty() {
        let _ = writeln!(out, "## Physical parameters\n");
        let _ = writeln!(out, "| Parameter | Value | Unit |\n| --- | --- | --- |");
        for param in &brief.params {
            let _ = writeln!(
                out,
                "| {} (`{}`) | {} | {} |",
                param.label,
                param.name,
                format_number(param.value),
                if param.unit.is_empty() {
                    "-"
                } else {
                    &param.unit
                }
            );
        }
        out.push('\n');
    }

    if let Some(contact) = &brief.contact {
        let _ = writeln!(
            out,
            "## Contact surface\n\n{}\n",
            contact.description.trim()
        );
        if let Some(normal) = contact.normal {
            let _ = writeln!(
                out,
                "- Surface normal at the hit, in wall coordinates (x right, y up): ({}, {})",
                format_number(normal.x),
                format_number(normal.y)
            );
        }
        if let Some(point) = contact.point {
            let _ = writeln!(
                out,
                "- Contact point on the wall: ({}, {}) m",
                format_number(point.x),
                format_number(point.y)
            );
        }
        out.push('\n');
    }

    if let Some(point) = brief.wall_point {
        let _ = writeln!(
            out,
            "## Wall point\n\nThe user picked ({}, {}) m on the wall. Model the element centred on this point; the worker places it.\n",
            format_number(point.x),
            format_number(point.y)
        );
    }

    if !brief.hit_times.is_empty() {
        let times: Vec<String> = brief
            .hit_times
            .iter()
            .map(|time| format!("{} s", format_number(*time)))
            .collect();
        let _ = writeln!(
            out,
            "## Hit times\n\nThe marble strikes this target at: {}\n",
            times.join(", ")
        );
    }

    let _ = writeln!(out, "## Reaction slots\n");
    if brief.reaction_slots.is_empty() {
        let _ = writeln!(
            out,
            "This target has no reaction slots. Do not add `MM_REACT_*` parts.\n"
        );
    } else {
        let _ = writeln!(
            out,
            "Reaction parts animate from the hit value. They are visual only and never change the physics. Keep presses small so a resting marble does not appear to float.\n"
        );
        for slot in &brief.reaction_slots {
            let _ = writeln!(out, "- `{}`: {}", slot.name, slot.description);
        }
        out.push('\n');
    }

    if let Some(theme) = &brief.theme {
        render_theme(&mut out, theme);
    }

    let _ = writeln!(out, "## Scale\n");
    let _ = writeln!(
        out,
        "- Model in metres at real size. Blender's unit scale stays 1.0."
    );
    let _ = writeln!(
        out,
        "- Marble radius: {} m",
        format_number(brief.scale.marble_radius)
    );
    if let Some(notes) = &brief.scale.notes {
        let _ = writeln!(out, "- {}", notes.trim());
    }
    out.push('\n');

    let _ = write!(
        out,
        r#"## Output contract

Produce these files in this folder:

1. `asset.blend` with exactly one collection named `MM_ASSET` holding the visual model
   - Model in metres. Put the origin at the centre of the contact surface, with +Z pointing away from the contact face, so the face the marble touches lies at z = 0 and the body extends toward -Z. The worker orients it on the piece.
   - Optional reaction parts are child objects named `MM_REACT_<Name>` with a custom property `mm_reaction` set to `press`, `wobble` or `glow`
   - Pack every texture into the file (File > External Data > Pack Resources, or `bpy.ops.file.pack_all()`)
2. `manifest.json`:

   ```json
   {{
     "$schema": "marble-asset@1",
     "id": "brass-bar",
     "label": "Brass bar",
     "role": "{role}",
     "pieceType": "{piece_type}",
     "fittedParams": {{ "length": 0.06 }},
     "notes": "What the asset is and how its reaction parts move"
   }}
   ```

   `id` uses lowercase letters, digits and `-`. `pieceType` and `fittedParams` are optional; `fittedParams` lists the physical parameters the model was built for.
3. `preview.png`, rendered with the helper in this folder:

   ```sh
   "{blender}" --background --factory-startup --python mm_preview.py -- asset.blend preview.png
   ```

   The helper checks the contract, prints `MM_CHECK` lines and only renders when the asset passes. Fix every `MM_CHECK error` and render again.

## Building with Blender

Write a Python build script in this folder, such as `build_asset.py`, and run it headless:

```sh
"{blender}" --background --factory-startup --python build_asset.py
```

The script should start from an empty file (`bpy.ops.wm.read_factory_settings(use_empty=True)`), build the model inside `MM_ASSET` and save with `bpy.ops.wm.save_as_mainfile(filepath="asset.blend")`.

## Rules

- Work only inside this folder. Never read or write `scene.blend`, `project.json` or any file outside this folder.
- Use Blender headless as shown above. Do not open the Blender interface.
- Do not download files or install software
- Finish with a short summary of what you built
"#,
        role = target.role,
        piece_type = target.piece_type.as_deref().unwrap_or("platform"),
        blender = blender,
    );
    return out;
}

/// The New Theme section: besides the skin, the agent names the theme and picks its colours in `manifest.json`
fn render_theme(out: &mut String, theme: &BriefTheme) {
    let _ = writeln!(out, "## Theme\n");
    let _ = writeln!(
        out,
        "This request makes a new theme. Besides the skin, add a `theme` object to `manifest.json` that names the theme, picks a built-in base and sets the colours that match the request. Accepting the result adds the theme to the project and shows the film in it.\n"
    );
    let bases = if theme.bases.is_empty() {
        format!("`{}`", theme.base)
    } else {
        theme
            .bases
            .iter()
            .map(|base| format!("`{}`", base))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let _ = writeln!(
        out,
        "- `base`: one of {}; the project uses `{}` now. The base brings the materials, skins and lighting style; the colours below change on top of it.",
        bases, theme.base
    );
    let _ = writeln!(
        out,
        "- `overrides`: any of these colours as `#rrggbb` display values; leave one out to keep the base's\n"
    );
    if !theme.fields.is_empty() {
        let _ = writeln!(out, "| Colour | Key | Now | Meaning |\n| --- | --- | --- | --- |");
        for field in &theme.fields {
            let _ = writeln!(
                out,
                "| {} | `{}` | {} | {} |",
                field.label,
                field.name,
                field.value.as_deref().unwrap_or("-"),
                field.description
            );
        }
        out.push('\n');
    }
    let _ = writeln!(
        out,
        "```json\n\"theme\": {{ \"name\": \"Sunset\", \"base\": \"{}\", \"overrides\": {{ \"wallColor\": \"#3b2a4a\", \"lightColor\": \"#ffb070\" }} }}\n```\n",
        theme.base
    );
    let _ = writeln!(
        out,
        "Use the same `theme` in every result of this request, so the skins of each piece type share one theme.\n"
    );
}

fn format_number(value: f64) -> String {
    let text = format!("{:.4}", value);
    let trimmed = text.trim_end_matches('0').trim_end_matches('.');
    return if trimmed == "-0" {
        "0".to_string()
    } else {
        trimmed.to_string()
    };
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), BriefError> {
    return fs::write(path, bytes).map_err(|source| io("write", path, source));
}

fn io(action: &'static str, path: &Path, source: std::io::Error) -> BriefError {
    return BriefError::Io {
        action,
        path: path.display().to_string(),
        source,
    };
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    pub fn temporary_package(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "midimarble-agents-{}-{}",
            name,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let package = root.join("Song.marble");
        fs::create_dir_all(package.join(CANDIDATES_FOLDER)).unwrap();
        fs::write(package.join("project.json"), "{}").unwrap();
        return package;
    }

    pub const BRIEF_JSON: &str = r#"{
        "request": "a simple brushed brass bar with a small chrome end cap",
        "target": { "kind": "piece", "entityId": "piece-3", "role": "skin", "pieceType": "platform", "pieceLabel": "Platform", "pieceCount": 16 },
        "params": [
            { "name": "length", "label": "Length", "value": 0.06, "unit": "m" },
            { "name": "thickness", "label": "Thickness", "value": 0.008, "unit": "m" }
        ],
        "contact": { "description": "The top face of a 0.06 m bar", "normal": { "x": -0.29552, "y": 0.95534 } },
        "hitTimes": [0.5, 1.25],
        "reactionSlots": [{ "name": "press", "description": "The bar dips a little on each hit" }],
        "scale": { "marbleRadius": 0.008 }
    }"#;

    #[test]
    fn writes_the_brief_files() {
        let package = temporary_package("brief");
        let dir = write_candidate(&package, "run-1", BRIEF_JSON, None).unwrap();
        assert_eq!(dir, package.join("candidates/run-1"));
        let markdown = fs::read_to_string(dir.join(BRIEF_FILE)).unwrap();
        assert!(markdown.contains("a simple brushed brass bar"));
        assert!(markdown.contains("| Length (`length`) | 0.06 | m |"));
        assert!(markdown.contains("(-0.2955, 0.9553)"));
        assert!(markdown.contains("0.5 s, 1.25 s"));
        assert!(markdown.contains("`press`: The bar dips"));
        assert!(markdown.contains("all 16 pieces"));
        assert!(markdown.contains("MM_ASSET"));
        assert!(markdown.contains("\"$schema\": \"marble-asset@1\""));
        assert!(markdown.contains("--python mm_preview.py -- asset.blend preview.png"));
        assert_eq!(
            fs::read_to_string(dir.join(BRIEF_JSON_FILE)).unwrap(),
            BRIEF_JSON
        );
        assert!(fs::read_to_string(dir.join(PREVIEW_SCRIPT_FILE))
            .unwrap()
            .contains("MM_CHECK"));
        fs::remove_dir_all(package.parent().unwrap()).unwrap();
    }

    #[test]
    fn renders_the_theme_section_of_a_new_theme_brief() {
        let json = r##"{
            "request": "New theme: warm sunset",
            "target": { "kind": "piece", "entityId": "piece-3", "role": "skin", "pieceType": "platform" },
            "scale": { "marbleRadius": 0.008 },
            "theme": {
                "base": "neon",
                "bases": ["pegboard", "brass", "neon"],
                "fields": [{ "name": "wallColor", "label": "Wall", "description": "Colour of the wall", "value": "#0f1427" }]
            }
        }"##;
        let brief: AgentBrief = serde_json::from_str(json).unwrap();
        let markdown = render_brief(&brief, None);
        assert!(markdown.contains("## Theme"));
        assert!(markdown.contains("`pegboard`, `brass`, `neon`"));
        assert!(markdown.contains("| Wall | `wallColor` | #0f1427 | Colour of the wall |"));
        assert!(markdown.contains("\"base\": \"neon\""));
        let plain: AgentBrief = serde_json::from_str(BRIEF_JSON).unwrap();
        assert!(!render_brief(&plain, None).contains("## Theme"));
    }

    #[test]
    fn rejects_run_ids_that_leave_the_candidates_folder() {
        let package = temporary_package("confine");
        for id in [
            "",
            "..",
            "../scene",
            "a/b",
            "/tmp/x",
            "a b",
            &"x".repeat(65),
        ] {
            assert!(
                matches!(candidate_dir(&package, id), Err(BriefError::InvalidRunId)),
                "{}",
                id
            );
        }
        assert!(candidate_dir(&package, "run_2-b").is_ok());
        fs::remove_dir_all(package.parent().unwrap()).unwrap();
    }

    #[test]
    fn rejects_a_candidates_folder_that_symlinks_outside() {
        let package = temporary_package("symlink");
        let outside = package.parent().unwrap().join("outside");
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, package.join("candidates/run-1")).unwrap();
        assert!(matches!(
            ensure_inside(
                &package.join(CANDIDATES_FOLDER),
                &package.join("candidates/run-1")
            ),
            Err(BriefError::OutsidePackage(_))
        ));
        assert!(matches!(
            ensure_inside(
                &package.join(CANDIDATES_FOLDER),
                &package.join("candidates/../x")
            ),
            Err(BriefError::OutsidePackage(_))
        ));
        fs::remove_dir_all(package.parent().unwrap()).unwrap();
    }

    #[test]
    fn refuses_existing_candidates_and_invalid_briefs() {
        let package = temporary_package("existing");
        write_candidate(&package, "run-1", BRIEF_JSON, None).unwrap();
        assert!(matches!(
            write_candidate(&package, "run-1", BRIEF_JSON, None),
            Err(BriefError::AlreadyExists(_))
        ));
        assert!(matches!(
            write_candidate(&package, "run-2", "{}", None),
            Err(BriefError::InvalidBrief(_))
        ));
        assert!(!package.join("candidates/run-2").exists());
        fs::remove_dir_all(package.parent().unwrap()).unwrap();
    }
}
