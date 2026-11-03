mod commands;
pub mod window;

use crate::modules::{agents, blender, library, package};
use specta_typescript::Typescript;
use tauri_specta::{collect_commands, collect_events, Builder as SpectaBuilder};

pub fn run() {
    let specta_builder = SpectaBuilder::<tauri::Wry>::new()
        .events(collect_events![agents::AgentRunEvent])
        .commands(collect_commands![
            commands::get_app_info,
            package::commands::create_project,
            package::commands::open_project,
            package::commands::save_project,
            package::commands::list_recent_projects,
            package::commands::import_source,
            package::commands::create_temporary_project,
            package::commands::move_project,
            package::commands::is_temporary_project,
            blender::commands::blender_detect,
            blender::commands::blender_start,
            blender::commands::blender_request,
            blender::commands::blender_stop,
            blender::commands::blender_status,
            blender::commands::blender_show,
            blender::commands::write_package_file,
            blender::commands::blender_job_poll,
            blender::commands::copy_file_out,
            agents::commands::agents_detect,
            agents::commands::agents_start,
            agents::commands::agents_cancel,
            agents::commands::agents_list,
            agents::commands::agents_review,
            library::commands::library_list,
            library::commands::library_accept_candidate,
            library::commands::library_promote,
            library::commands::library_import,
            library::commands::library_remove,
        ]);

    #[cfg(debug_assertions)]
    if let Err(error) = specta_builder.export(
        Typescript::default(),
        "../src/environment/specta/bindings.gen.ts",
    ) {
        eprintln!("Skipping TypeScript bindings export: {}", error);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(blender::BlenderState::default())
        .manage(agents::AgentState::default())
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            // https://docs.rs/tauri-specta/2.0.0-rc.21/tauri_specta/index.html
            specta_builder.mount_events(app);

            // Show main window on startup
            let _ = window::AppWindow::Main.show(app.handle());

            return Ok(());
        })
        .run(tauri::generate_context!())
        .expect("Error while running tauri application");
}
