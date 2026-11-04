use super::brief;
use super::cli::{self, AgentCli};
use super::folder::{self, AgentReferencesDto};
use super::runner::{
    self, AgentReview, AgentRunRecord, AgentRunStatus, AgentState, ASSET_FILE, MANIFEST_FILE,
    PREVIEW_FILE,
};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri_specta::Event;

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliDto {
    pub cli: AgentCli,
    pub path: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunDto {
    #[serde(flatten)]
    pub record: AgentRunRecord,
    pub candidate_path: String,
    pub has_asset: bool,
    /// Contents of the candidate's `manifest.json`, validated by the app before accepting
    pub manifest_json: Option<String>,
    /// Absolute path of `preview.png` once it exists
    pub preview_path: Option<String>,
}

/// Agent CLIs found on `PATH`, `~/.local/bin`, `/opt/homebrew/bin` or `/usr/local/bin`
#[tauri::command]
#[specta::specta]
pub async fn agents_detect() -> Result<Vec<AgentCliDto>, String> {
    return run_blocking(|| {
        return Ok(AgentCli::ALL
            .iter()
            .filter_map(|cli| {
                let path = cli::find(*cli)?;
                return Some(AgentCliDto {
                    cli: *cli,
                    version: cli::version(&path),
                    path: path.display().to_string(),
                });
            })
            .collect());
    })
    .await;
}

/// Writes the brief into `candidates/<runId>/` and starts the CLI there. Output streams as `agent-run-event`.
#[tauri::command]
#[specta::specta]
pub async fn agents_start(
    app: AppHandle,
    state: State<'_, AgentState>,
    package_path: String,
    cli: AgentCli,
    run_id: String,
    prompt: String,
    brief_json: String,
) -> Result<AgentRunDto, String> {
    let state = state.inner().clone();
    return run_blocking(move || {
        let package = PathBuf::from(&package_path);
        let binary =
            cli::find(cli).ok_or_else(|| format!("{} was not found on this Mac", cli.binary()))?;
        let dir = brief::write_candidate(&package, &run_id, &brief_json, blender_path().as_deref())
            .map_err(|error| error.to_string())?;
        let record = AgentRunRecord {
            run_id: run_id.clone(),
            cli,
            prompt,
            status: AgentRunStatus::Running,
            review: None,
            started_at: runner::now(),
            finished_at: None,
            exit_code: None,
            error: None,
            outside_changes: Vec::new(),
        };
        let command = cli::build_command(cli, &binary, &dir);
        let record = state.spawn(&package, &dir, record, command, move |event| {
            let _ = event.emit(&app);
        })?;
        return Ok(run_dto(&dir, record));
    })
    .await;
}

/// Ends a running agent. Returns false when the run is not running.
#[tauri::command]
#[specta::specta]
pub fn agents_cancel(state: State<'_, AgentState>, run_id: String) -> Result<bool, String> {
    return state.cancel(&run_id);
}

/// Candidate runs of the package, newest first
#[tauri::command]
#[specta::specta]
pub fn agents_list(state: State<'_, AgentState>, package_path: String) -> Vec<AgentRunDto> {
    return runner::list_runs(state.inner(), &PathBuf::from(package_path))
        .into_iter()
        .map(|(dir, record)| run_dto(&dir, record))
        .collect();
}

/// Records the user's decision on a candidate. The candidate folder stays for reference.
#[tauri::command]
#[specta::specta]
pub fn agents_review(
    package_path: String,
    run_id: String,
    review: AgentReview,
) -> Result<AgentRunDto, String> {
    let package = PathBuf::from(package_path);
    let record = runner::set_review(&package, &run_id, review)?;
    let dir = brief::candidate_dir(&package, &run_id).map_err(|error| error.to_string())?;
    return Ok(run_dto(&dir, record));
}

fn run_dto(dir: &Path, record: AgentRunRecord) -> AgentRunDto {
    let preview = dir.join(PREVIEW_FILE);
    return AgentRunDto {
        record,
        candidate_path: dir.display().to_string(),
        has_asset: dir.join(ASSET_FILE).is_file(),
        manifest_json: fs::read_to_string(dir.join(MANIFEST_FILE)).ok(),
        preview_path: preview.is_file().then(|| preview.display().to_string()),
    };
}

/// Blender from `MIDIMARBLE_BLENDER`, `/Applications` or `~/Applications`, for the command lines in the brief
fn blender_path() -> Option<PathBuf> {
    if let Some(value) = std::env::var_os("MIDIMARBLE_BLENDER") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    let executable = "Blender.app/Contents/MacOS/Blender";
    let mut candidates = vec![PathBuf::from("/Applications").join(executable)];
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join("Applications").join(executable));
    }
    return candidates.into_iter().find(|path| path.is_file());
}

async fn run_blocking<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    return tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| error.to_string())?;
}

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
