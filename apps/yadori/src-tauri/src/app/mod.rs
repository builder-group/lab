mod window;
use crate::quit::{self, Decision, QuitGuard};
use crate::{
    agents::{self, AgentState},
    idealo::{self, IdealoNativeState},
    project,
};
use tauri::{Emitter, Manager};
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AgentState::default())
        .manage(QuitGuard::default())
        .invoke_handler(tauri::generate_handler![
            quit::register_desktop_quit_guard,
            quit::unregister_desktop_quit_guard,
            quit::approve_desktop_exit,
            quit::reject_desktop_exit,
            project::list_projects,
            project::create_project,
            project::open_project,
            project::save_project,
            project::export_project,
            project::import_project,
            project::add_project_asset,
            project::read_project_asset,
            project::open_project_asset,
            project::write_project_asset,
            agents::agent_capabilities,
            agents::start_agent_job,
            agents::get_agent_job,
            agents::cancel_agent_job,
            agents::list_agent_proposals,
            agents::dismiss_agent_proposal,
            idealo::request_idealo,
            idealo::read_idealo_credentials,
            idealo::save_idealo_credentials,
            idealo::clear_idealo_credentials,
            idealo::start_idealo_auth,
            idealo::wait_idealo_auth,
            idealo::cancel_idealo_auth
        ])
        .setup(|app| {
            app.manage(IdealoNativeState::new().map_err(std::io::Error::other)?);
            window::show(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Unable to launch Yadori");
    app.run(|app, event| match event {
        tauri::RunEvent::ExitRequested { api, .. } => {
            match app
                .state::<QuitGuard>()
                .request(app.get_webview_window("main").is_some())
            {
                Decision::Allow => agents::cancel_all(&app.state::<AgentState>()),
                Decision::Wait => api.prevent_exit(),
                Decision::Notify => {
                    api.prevent_exit();
                    let _ = app.emit("desktop-quit-requested", ());
                }
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            if let Err(error) = window::show(app) {
                eprintln!("Unable to reopen Yadori window: {error}");
            }
        }
        tauri::RunEvent::Exit => agents::cancel_all(&app.state::<AgentState>()),
        _ => {}
    });
}
