use super::detect;
use super::mailbox;
use super::preview;
use super::session::BlenderState;
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BlenderInstallDto {
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BlenderSessionDto {
    pub package_path: String,
    pub pid: u32,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BlenderStatusDto {
    pub running: bool,
    pub pid: Option<u32>,
    pub visible: bool,
    /// Contents of `.bridge/status.json` written by the worker, if any
    pub status_json: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn blender_detect() -> Result<BlenderInstallDto, String> {
    return run_blocking(|| {
        let path = detect::blender_path();
        let version = path.as_ref().and_then(detect::blender_version);
        return Ok(BlenderInstallDto {
            path: path.map(|value| value.display().to_string()),
            version,
        });
    })
    .await;
}

#[tauri::command]
#[specta::specta]
pub async fn blender_start(
    app: AppHandle,
    state: State<'_, BlenderState>,
    package_path: String,
    visible: bool,
) -> Result<BlenderSessionDto, String> {
    let worker = worker_script(&app)?;
    let state = state.inner().clone();
    return run_blocking(move || {
        let package = PathBuf::from(&package_path);
        let session = state.start(&worker, &package, visible)?;
        return Ok(BlenderSessionDto {
            package_path,
            pid: session.pid,
            visible: session.visible,
        });
    })
    .await;
}

/// Sends one operation to the package's worker. Returns the response envelope `{id, ok, result | error}` as JSON.
#[tauri::command]
#[specta::specta]
pub async fn blender_request(
    state: State<'_, BlenderState>,
    package_path: String,
    op: String,
    args_json: String,
    timeout_ms: u32,
) -> Result<String, String> {
    let args: serde_json::Value = serde_json::from_str(&args_json)
        .map_err(|error| format!("Invalid request arguments: {}", error))?;
    let state = state.inner().clone();
    return run_blocking(move || {
        let response = state.request(
            &PathBuf::from(package_path),
            &op,
            args,
            Duration::from_millis(u64::from(timeout_ms)),
        )?;
        return Ok(response.to_string());
    })
    .await;
}

#[tauri::command]
#[specta::specta]
pub async fn blender_stop(state: State<'_, BlenderState>, package_path: String) -> Result<(), String> {
    let state = state.inner().clone();
    return run_blocking(move || state.stop(&PathBuf::from(package_path))).await;
}

#[tauri::command]
#[specta::specta]
pub fn blender_status(
    state: State<'_, BlenderState>,
    package_path: String,
) -> Result<BlenderStatusDto, String> {
    let package = PathBuf::from(package_path);
    let session = state.session(&package)?;
    return Ok(BlenderStatusDto {
        running: session.is_some(),
        pid: session.as_ref().map(|value| value.pid),
        visible: session.as_ref().map(|value| value.visible).unwrap_or(false),
        status_json: mailbox::read_status(&package).map(|value| value.to_string()),
    });
}

/// Opens the package scene in a Blender window. A background worker saves and restarts with a window.
#[tauri::command]
#[specta::specta]
pub async fn blender_show(
    app: AppHandle,
    state: State<'_, BlenderState>,
    package_path: String,
) -> Result<BlenderSessionDto, String> {
    let worker = worker_script(&app)?;
    let state = state.inner().clone();
    return run_blocking(move || {
        let package = PathBuf::from(&package_path);
        if let Some(session) = state.session(&package)? {
            if session.visible {
                // TODO: Bring the existing Blender window to the front
                return Ok(BlenderSessionDto {
                    package_path,
                    pid: session.pid,
                    visible: true,
                });
            }
            state.stop(&package)?;
        }
        let session = state.start(&worker, &package, true)?;
        return Ok(BlenderSessionDto {
            package_path,
            pid: session.pid,
            visible: session.visible,
        });
    })
    .await;
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BlenderJobPollDto {
    /// Latest `.bridge/outbox/<jobId>.progress.json`, if any
    pub progress_json: Option<String>,
    /// The job's response envelope `{id, ok, result | error}` once it finished; taken on read
    pub response_json: Option<String>,
}

/// Polls a background job such as `render_film`, which runs in its own Blender process
#[tauri::command]
#[specta::specta]
pub fn blender_job_poll(package_path: String, job_id: String) -> Result<BlenderJobPollDto, String> {
    let (progress, response) = mailbox::poll_job(&PathBuf::from(package_path), &job_id)
        .map_err(|error| error.to_string())?;
    return Ok(BlenderJobPollDto {
        progress_json: progress.map(|value| value.to_string()),
        response_json: response.map(|value| value.to_string()),
    });
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BlenderPreviewFramesDto {
    /// Absolute folder of the signature's frames: `<frame>.jpg` at Flat Light, `<frame>.fast.jpg` at Fast
    pub folder: String,
    /// Frame numbers rendered, ascending
    pub frames: Vec<u32>,
    /// The job's `status.json`, if it started
    pub status_json: Option<String>,
}

/// Background preview frames of a scene signature, started with the worker's `preview_render`
#[tauri::command]
#[specta::specta]
pub async fn blender_preview_frames(package_path: String, signature: String) -> Result<BlenderPreviewFramesDto, String> {
    return run_blocking(move || {
        let frames = preview::list_frames(&PathBuf::from(package_path), &signature).map_err(|error| error.to_string())?;
        return Ok(BlenderPreviewFramesDto {
            folder: frames.folder.display().to_string(),
            frames: frames.frames,
            status_json: frames.status.map(|value| value.to_string()),
        });
    })
    .await;
}

/// Points the running preview job at a new playhead: `{"order": [...], "paused": false}`
#[tauri::command]
#[specta::specta]
pub fn blender_preview_target(package_path: String, signature: String, target_json: String) -> Result<(), String> {
    return preview::write_target(&PathBuf::from(package_path), &signature, &target_json).map_err(|error| error.to_string());
}

/// Stops the preview job after its current chunk; its frames stay
#[tauri::command]
#[specta::specta]
pub fn blender_preview_cancel(package_path: String, signature: String) -> Result<(), String> {
    return preview::cancel(&PathBuf::from(package_path), &signature).map_err(|error| error.to_string());
}

/// Writes bytes to a package-relative path, such as motion files under `.cache/motion/`
#[tauri::command]
#[specta::specta]
pub fn write_package_file(
    package_path: String,
    relative_path: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let package = PathBuf::from(package_path);
    if !package.join("project.json").is_file() {
        return Err(format!("{} isn't a MidiMarble project. Choose a .marble package.", package.file_name().map_or_else(|| package.display().to_string(), |name| name.to_string_lossy().into_owned())));
    }
    let path = mailbox::write_package_file(&package, &relative_path, &bytes)
        .map_err(|error| error.to_string())?;
    return Ok(path.display().to_string());
}

/// Copies a package file to an absolute destination, such as a finished film from `renders/` to the path chosen
/// in the save panel. Returns the destination path.
#[tauri::command]
#[specta::specta]
pub async fn copy_file_out(
    package_path: String,
    relative_path: String,
    destination_path: String,
) -> Result<String, String> {
    return run_blocking(move || {
        let package = PathBuf::from(package_path);
        if !package.join("project.json").is_file() {
            return Err(format!("{} isn't a MidiMarble project. Choose a .marble package.", package.file_name().map_or_else(|| package.display().to_string(), |name| name.to_string_lossy().into_owned())));
        }
        let path = mailbox::copy_file_out(&package, &relative_path, &PathBuf::from(destination_path))
            .map_err(|error| error.to_string())?;
        return Ok(path.display().to_string());
    })
    .await;
}

/// The worker runs from bundled resources in any `.app`, and from the source tree under `tauri dev`, so Python edits apply.
/// A bundled app never reads the source tree: under Documents, that would stop on a macOS privacy prompt nobody may see.
fn worker_script(app: &AppHandle) -> Result<PathBuf, String> {
    let resources = app.path().resource_dir().map_err(|error| error.to_string())?;
    let bundled = resources.join("blender/worker.py");
    let is_bundle = resources.components().any(|part| part.as_os_str().to_string_lossy().ends_with(".app"));
    if cfg!(debug_assertions) && !is_bundle {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../blender/worker.py"));
    }
    return Ok(bundled);
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
