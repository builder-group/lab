use super::host::{FrontEndReply, McpState};
use super::workspace;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

const SETTINGS_FILE: &str = "mcp.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpSettings {
    is_enabled: Option<bool>,
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    return app.path().app_data_dir().ok().map(|dir| dir.join(SETTINGS_FILE));
}

/// Enable MCP. On unless turned off: the socket exists only while the app is open and only this user can reach it.
fn is_enabled(app: &AppHandle) -> bool {
    return settings_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|json| serde_json::from_str::<McpSettings>(&json).ok())
        .and_then(|settings| settings.is_enabled)
        .unwrap_or(true);
}

/// Starts the socket when Enable MCP is on. A failure leaves the app working without MCP.
pub fn start_if_enabled(app: &AppHandle) {
    if is_enabled(app) {
        if let Err(error) = app.state::<McpState>().start(app) {
            eprintln!("MCP is unavailable: {}", error);
        }
    }
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct McpStatusDto {
    pub is_enabled: bool,
    pub is_serving: bool,
    /// What each connected agent calls itself, from MCP's `initialize`
    pub clients: Vec<String>,
}

#[tauri::command]
#[specta::specta]
pub fn mcp_status(app: AppHandle, state: State<'_, McpState>) -> McpStatusDto {
    return McpStatusDto {
        is_enabled: is_enabled(&app),
        is_serving: state.is_serving(),
        clients: state.client_names(),
    };
}

/// The front end listens now, so tool calls can reach it
#[tauri::command]
#[specta::specta]
pub fn mcp_front_end_ready(state: State<'_, McpState>) {
    state.set_front_end_ready();
}

#[tauri::command]
#[specta::specta]
pub fn mcp_set_enabled(
    app: AppHandle,
    state: State<'_, McpState>,
    is_enabled: bool,
) -> Result<McpStatusDto, String> {
    let path = settings_path(&app).ok_or("The app's support folder isn't available")?;
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder).map_err(|error| error.to_string())?;
    }
    let settings = McpSettings {
        is_enabled: Some(is_enabled),
    };
    let json = serde_json::to_string(&settings).map_err(|error| error.to_string())?;
    fs::write(&path, json).map_err(|error| error.to_string())?;
    if is_enabled {
        state.start(&app)?;
    } else {
        state.stop();
    }
    return Ok(McpStatusDto {
        is_enabled,
        is_serving: state.is_serving(),
        clients: state.client_names(),
    });
}

/// Answers a `McpRequestEvent` with `{ content, isError, packagePath }`
#[tauri::command]
#[specta::specta]
pub fn mcp_respond(
    state: State<'_, McpState>,
    request_id: u32,
    reply_json: String,
) -> Result<(), String> {
    let reply: FrontEndReply =
        serde_json::from_str(&reply_json).map_err(|error| error.to_string())?;
    state.respond(request_id, reply);
    return Ok(());
}

/// Show AI Workspace: writes the folder for the running binary and returns its path
#[tauri::command]
#[specta::specta]
pub fn mcp_write_workspace(app: AppHandle) -> Result<String, String> {
    let documents = app.path().document_dir().map_err(|error| error.to_string())?;
    let binary = std::env::current_exe().map_err(|error| error.to_string())?;
    let folder = workspace::generate(&documents, &binary).map_err(|error| error.to_string())?;
    return Ok(folder.display().to_string());
}
