mod app;
mod environment;
mod modules;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app::run();
}

/// `midimarble mcp`: the local stdio MCP server. No window and no second app. Returns the exit code.
pub fn run_mcp() -> i32 {
    return modules::mcp::stdio::run();
}
