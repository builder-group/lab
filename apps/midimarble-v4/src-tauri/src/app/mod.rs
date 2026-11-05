pub mod menu;
pub mod window;

use crate::modules::{agents, blender, library, mcp, package};
use specta_typescript::Typescript;
use tauri_specta::{collect_commands, collect_events, Builder as SpectaBuilder};

fn specta_builder() -> SpectaBuilder<tauri::Wry> {
    return SpectaBuilder::<tauri::Wry>::new()
        .events(collect_events![menu::MenuCommandEvent, mcp::McpRequestEvent, mcp::McpClientsEvent])
        .commands(collect_commands![
            package::commands::create_project,
            package::commands::open_project,
            package::commands::save_project,
            package::commands::keep_previous_save,
            package::commands::list_recent_projects,
            package::commands::import_source,
            package::commands::create_temporary_project,
            package::commands::move_project,
            package::commands::is_temporary_project,
            package::commands::copy_project,
            package::commands::clear_recent_projects,
            menu::menu_set_bar,
            menu::menu_update_items,
            blender::commands::blender_detect,
            blender::commands::blender_start,
            blender::commands::blender_request,
            blender::commands::blender_stop,
            blender::commands::blender_status,
            blender::commands::blender_show,
            blender::commands::write_package_file,
            blender::commands::blender_job_poll,
            blender::commands::copy_file_out,
            blender::commands::blender_preview_frames,
            blender::commands::blender_preview_target,
            blender::commands::blender_preview_cancel,
            agents::commands::agent_folder_ensure,
            agents::commands::agent_references_read,
            agents::commands::agent_references_set,
            mcp::commands::mcp_status,
            mcp::commands::mcp_front_end_ready,
            mcp::commands::mcp_set_enabled,
            mcp::commands::mcp_respond,
            mcp::commands::mcp_connect,
            mcp::commands::mcp_disconnect,
            mcp::commands::mcp_connections,
            mcp::commands::mcp_copy_server_command,
            library::commands::library_list,
            library::commands::library_promote,
            library::commands::library_import,
            library::commands::library_remove,
            library::commands::library_add_asset,
            library::commands::library_list_packs,
            library::commands::library_list_bundled_packs,
            library::commands::library_import_pack,
            library::commands::library_export_pack,
            library::commands::library_remove_pack,
        ]);
}

pub fn run() {
    let specta_builder = specta_builder();

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
        .manage(menu::MenuState::default())
        .manage(mcp::McpState::default())
        .menu(menu::initial_menu)
        .on_menu_event(|app, event| menu::on_menu_event(app, event.id().as_ref()))
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            // https://docs.rs/tauri-specta/2.0.0-rc.21/tauri_specta/index.html
            specta_builder.mount_events(app);
            mcp::commands::start_if_enabled(app.handle());

            // Show main window on startup
            let _ = window::AppWindow::Main.show(app.handle());

            return Ok(());
        })
        .run(tauri::generate_context!())
        .expect("Error while running tauri application");
}

#[cfg(test)]
mod tests {
    /// Writes the TypeScript bindings, as a debug launch does, to `MM_BINDINGS_OUT` or the temp folder, so a
    /// changed command or DTO can be checked without starting the app
    #[test]
    fn exports_typescript_bindings() {
        let out = std::env::var("MM_BINDINGS_OUT").map(std::path::PathBuf::from).unwrap_or_else(|_| {
            std::env::temp_dir().join("midimarble-v4-bindings.gen.ts")
        });
        super::specta_builder()
            .export(super::Typescript::default(), &out)
            .unwrap();
        let bindings = std::fs::read_to_string(out).unwrap();
        assert!(bindings.contains("menuSetBar"));
        assert!(bindings.contains("menu-command-event"));
    }
}
