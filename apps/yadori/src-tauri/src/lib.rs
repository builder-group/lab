mod agents;
mod app;
mod idealo;
mod library_data;
mod mcp;
mod project;
mod quit;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app::run();
}
pub fn run_mcp(args: &[String]) -> Result<(), String> {
    mcp::run(args)
}
