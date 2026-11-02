use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Restores the main window on macOS reopen, creating it after the previous one was closed.
pub fn show(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
        return Ok(());
    }
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Yadori")
        .inner_size(1440.0, 940.0)
        .min_inner_size(1100.0, 720.0)
        .resizable(true)
        .center();

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(18.0, 23.0));

    builder.build()?;
    Ok(())
}
