//! The macOS menu bar. The app menu, the text items (Cut, Copy, Paste) and the Window items are AppKit's own;
//! every other item comes from the front end's command registry (`src/modules/studio/menu-bar.ts`), so the menu
//! bar, the command palette and the shortcuts share one list of titles, keys and enabled states. Choosing an item
//! emits a `menu-command-event` with the command id, and the front end runs the command.

use crate::environment::configs::app::AppConfig;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::{
    AboutMetadata, CheckMenuItem, IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem,
    Submenu,
};
use tauri::{AppHandle, Manager, Runtime, State, Wry};
use tauri_specta::Event;

/// The front end's items by command id, so state updates reach them without a rebuild
#[derive(Default)]
pub struct MenuState {
    items: Mutex<HashMap<String, MenuItemKind<Wry>>>,
}

/// One menu of the menu bar after the app menu, such as File or View
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MenuDto {
    pub title: String,
    /// `window` makes it the menu AppKit lists the windows in; `help` adds the Help search field
    pub role: Option<MenuRole>,
    pub items: Vec<MenuEntryDto>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MenuRole {
    Window,
    Help,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MenuEntryDto {
    /// An item that runs a front-end command. `checked` makes it a check item.
    #[serde(rename_all = "camelCase")]
    Command {
        id: String,
        title: String,
        /// Tauri accelerator such as `CmdOrCtrl+Shift+S`
        accelerator: Option<String>,
        enabled: bool,
        checked: Option<bool>,
    },
    Separator,
    #[serde(rename_all = "camelCase")]
    Submenu {
        title: String,
        enabled: bool,
        items: Vec<MenuEntryDto>,
    },
    /// An item AppKit handles itself, for the text in focus or the window
    #[serde(rename_all = "camelCase")]
    Standard { item: StandardMenuItem },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum StandardMenuItem {
    Cut,
    Copy,
    Paste,
    Minimize,
    Zoom,
    FullScreen,
    BringAllToFront,
}

/// A state change of a command item; a missing field stays as it is
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MenuItemStateDto {
    pub id: String,
    pub title: Option<String>,
    pub enabled: Option<bool>,
    pub checked: Option<bool>,
}

/// A command item was chosen in the menu bar, or its key was pressed and the web view left the key alone
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct MenuCommandEvent {
    pub id: String,
}

/// The menu bar before the front end sends its menus: the app menu, AppKit's Edit items and Window
pub fn initial_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = window_menu(app)?;
    let menu = Menu::with_items(app, &[&app_menu(app)?, &edit, &window])?;
    #[cfg(target_os = "macos")]
    window.set_as_windows_menu_for_nsapp()?;
    return Ok(menu);
}

/// Forwards command items to the front end; AppKit's own items never reach here
pub fn on_menu_event(app: &AppHandle, id: &str) {
    let is_command = app
        .try_state::<MenuState>()
        .and_then(|state| state.items.lock().ok().map(|items| items.contains_key(id)))
        .unwrap_or(false);
    if is_command {
        let _ = MenuCommandEvent { id: id.to_string() }.emit(app);
    }
}

/// Replaces the menu bar after the app menu with the front end's menus
#[tauri::command]
#[specta::specta]
pub fn menu_set_bar(
    app: AppHandle,
    state: State<'_, MenuState>,
    menus: Vec<MenuDto>,
) -> Result<(), String> {
    let mut items = HashMap::new();
    let menu = build_menu(&app, &menus, &mut items).map_err(|error| error.to_string())?;
    let mut registry = state.items.lock().map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;
    *registry = items;
    return Ok(());
}

/// Updates titles, enabled and checked states of command items in place
#[tauri::command]
#[specta::specta]
pub fn menu_update_items(
    state: State<'_, MenuState>,
    items: Vec<MenuItemStateDto>,
) -> Result<(), String> {
    let registry = state.items.lock().map_err(|error| error.to_string())?;
    for update in items {
        let Some(item) = registry.get(&update.id) else {
            continue;
        };
        apply_state(item, &update).map_err(|error| error.to_string())?;
    }
    return Ok(());
}

fn apply_state(item: &MenuItemKind<Wry>, update: &MenuItemStateDto) -> tauri::Result<()> {
    match item {
        MenuItemKind::MenuItem(item) => {
            if let Some(title) = &update.title {
                item.set_text(title)?;
            }
            if let Some(enabled) = update.enabled {
                item.set_enabled(enabled)?;
            }
        }
        MenuItemKind::Check(item) => {
            if let Some(title) = &update.title {
                item.set_text(title)?;
            }
            if let Some(enabled) = update.enabled {
                item.set_enabled(enabled)?;
            }
            if let Some(checked) = update.checked {
                item.set_checked(checked)?;
            }
        }
        MenuItemKind::Submenu(item) => {
            if let Some(enabled) = update.enabled {
                item.set_enabled(enabled)?;
            }
        }
        _ => {}
    }
    return Ok(());
}

fn build_menu(
    app: &AppHandle,
    menus: &[MenuDto],
    items: &mut HashMap<String, MenuItemKind<Wry>>,
) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    menu.append(&app_menu(app)?)?;
    for spec in menus {
        let submenu = Submenu::new(app, &spec.title, true)?;
        append_entries(app, &submenu, &spec.items, items)?;
        menu.append(&submenu)?;
        #[cfg(target_os = "macos")]
        match spec.role {
            Some(MenuRole::Window) => submenu.set_as_windows_menu_for_nsapp()?,
            Some(MenuRole::Help) => submenu.set_as_help_menu_for_nsapp()?,
            None => {}
        }
    }
    return Ok(menu);
}

fn append_entries(
    app: &AppHandle,
    submenu: &Submenu<Wry>,
    entries: &[MenuEntryDto],
    items: &mut HashMap<String, MenuItemKind<Wry>>,
) -> tauri::Result<()> {
    for entry in entries {
        match entry {
            MenuEntryDto::Command {
                id,
                title,
                accelerator,
                enabled,
                checked,
            } => {
                if let Some(checked) = checked {
                    let item = CheckMenuItem::with_id(
                        app,
                        id.as_str(),
                        title,
                        *enabled,
                        *checked,
                        accelerator.as_deref(),
                    )?;
                    submenu.append(&item)?;
                    items.insert(id.clone(), MenuItemKind::Check(item));
                } else {
                    let item =
                        MenuItem::with_id(app, id.as_str(), title, *enabled, accelerator.as_deref())?;
                    submenu.append(&item)?;
                    items.insert(id.clone(), MenuItemKind::MenuItem(item));
                }
            }
            MenuEntryDto::Separator => submenu.append(&PredefinedMenuItem::separator(app)?)?,
            MenuEntryDto::Submenu {
                title,
                enabled,
                items: children,
            } => {
                let child = Submenu::new(app, title, *enabled)?;
                append_entries(app, &child, children, items)?;
                submenu.append(&child)?;
            }
            MenuEntryDto::Standard { item } => {
                let standard = standard_item(app, *item)?;
                submenu.append(&standard as &dyn IsMenuItem<Wry>)?;
            }
        }
    }
    return Ok(());
}

fn standard_item<R: Runtime, M: Manager<R>>(
    app: &M,
    item: StandardMenuItem,
) -> tauri::Result<PredefinedMenuItem<R>> {
    return match item {
        StandardMenuItem::Cut => PredefinedMenuItem::cut(app, None),
        StandardMenuItem::Copy => PredefinedMenuItem::copy(app, None),
        StandardMenuItem::Paste => PredefinedMenuItem::paste(app, None),
        StandardMenuItem::Minimize => PredefinedMenuItem::minimize(app, None),
        StandardMenuItem::Zoom => PredefinedMenuItem::maximize(app, Some("Zoom")),
        StandardMenuItem::FullScreen => PredefinedMenuItem::fullscreen(app, None),
        StandardMenuItem::BringAllToFront => PredefinedMenuItem::bring_all_to_front(app, None),
    };
}

/// MidiMarble: About, Services, Hide, Hide Others, Show All and Quit. The app has no settings yet, so there is no
/// Settings… item.
fn app_menu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let name = AppConfig::app_name();
    let about = AboutMetadata {
        name: Some(name.to_string()),
        version: Some(app.package_info().version.to_string()),
        ..Default::default()
    };
    return Submenu::with_items(
        app,
        name,
        true,
        &[
            &PredefinedMenuItem::about(app, Some(&format!("About {}", name)), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some(&format!("Hide {}", name)))?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some(&format!("Quit {}", name)))?,
        ],
    );
}

fn window_menu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    return Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::bring_all_to_front(app, None)?,
        ],
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_front_end_menus() {
        let json = r#"[
            {"title": "File", "role": null, "items": [
                {"kind": "command", "id": "file.save", "title": "Save", "accelerator": "CmdOrCtrl+S", "enabled": false, "checked": null},
                {"kind": "separator"},
                {"kind": "submenu", "title": "Open Recent", "enabled": true, "items": [
                    {"kind": "command", "id": "recent:/a/Song.marble", "title": "Song", "accelerator": null, "enabled": true, "checked": null}
                ]}
            ]},
            {"title": "Window", "role": "window", "items": [{"kind": "standard", "item": "bringAllToFront"}]}
        ]"#;
        let menus: Vec<MenuDto> = serde_json::from_str(json).unwrap();
        assert_eq!(menus.len(), 2);
        assert_eq!(menus[1].role, Some(MenuRole::Window));
        assert!(matches!(
            &menus[0].items[0],
            MenuEntryDto::Command { id, enabled: false, checked: None, .. } if id == "file.save"
        ));
        assert!(matches!(
            &menus[0].items[2],
            MenuEntryDto::Submenu { items, .. } if items.len() == 1
        ));
        assert!(matches!(
            &menus[1].items[0],
            MenuEntryDto::Standard { item: StandardMenuItem::BringAllToFront }
        ));
    }

    #[test]
    fn reads_a_partial_state_update() {
        let update: MenuItemStateDto =
            serde_json::from_str(r#"{"id": "view.follow", "checked": true}"#).unwrap();
        assert_eq!(update.checked, Some(true));
        assert_eq!(update.enabled, None);
        assert_eq!(update.title, None);
    }
}
