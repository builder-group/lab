use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, State};
#[derive(Default)]
pub struct QuitGuard {
    ready: AtomicBool,
    registrations: Mutex<HashSet<String>>,
    approved: AtomicBool,
    pending: AtomicBool,
}
#[derive(Debug, PartialEq)]
pub enum Decision {
    Allow,
    Wait,
    Notify,
}
impl QuitGuard {
    pub fn request(&self, has_main_window: bool) -> Decision {
        if !has_main_window
            || !self.ready.load(Ordering::SeqCst)
            || self.approved.load(Ordering::SeqCst)
        {
            return Decision::Allow;
        }
        if self.pending.swap(true, Ordering::SeqCst) {
            Decision::Wait
        } else {
            Decision::Notify
        }
    }
}
impl QuitGuard {
    fn register(&self, id: String) -> Result<(), String> {
        let mut registrations = self
            .registrations
            .lock()
            .map_err(|_| "Quit guard unavailable")?;
        registrations.insert(id);
        self.ready.store(true, Ordering::SeqCst);
        Ok(())
    }
    fn unregister(&self, id: &str) -> Result<(), String> {
        let mut registrations = self
            .registrations
            .lock()
            .map_err(|_| "Quit guard unavailable")?;
        registrations.remove(id);
        let ready = !registrations.is_empty();
        self.ready.store(ready, Ordering::SeqCst);
        if !ready {
            self.pending.store(false, Ordering::SeqCst);
        }
        Ok(())
    }
}
#[tauri::command]
pub fn register_desktop_quit_guard(
    guard: State<'_, QuitGuard>,
    guard_id: String,
) -> Result<(), String> {
    crate::project::identifier(&guard_id)?;
    guard.register(guard_id)
}
#[tauri::command]
pub fn unregister_desktop_quit_guard(
    guard: State<'_, QuitGuard>,
    guard_id: String,
) -> Result<(), String> {
    guard.unregister(&guard_id)
}
#[tauri::command]
pub fn reject_desktop_exit(guard: State<'_, QuitGuard>) {
    guard.pending.store(false, Ordering::SeqCst);
}
#[tauri::command]
pub fn approve_desktop_exit(app: AppHandle, guard: State<'_, QuitGuard>) {
    guard.approved.store(true, Ordering::SeqCst);
    app.exit(0);
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn should_allow_startup_and_destroyed_window_exit() {
        let guard = QuitGuard::default();
        assert_eq!(guard.request(true), Decision::Allow);
        guard.ready.store(true, Ordering::SeqCst);
        assert_eq!(guard.request(false), Decision::Allow);
    }
    #[test]
    fn should_keep_new_guard_registered_after_stale_cleanup() {
        let guard = QuitGuard::default();
        guard.register("old".into()).unwrap();
        guard.register("new".into()).unwrap();
        guard.unregister("old").unwrap();
        assert_eq!(guard.request(true), Decision::Notify);
        guard.unregister("old").unwrap();
        assert_eq!(guard.request(true), Decision::Wait);
        guard.unregister("new").unwrap();
        assert_eq!(guard.request(true), Decision::Allow);
    }
    #[test]
    fn should_notify_once_and_require_explicit_approval() {
        let guard = QuitGuard::default();
        guard.ready.store(true, Ordering::SeqCst);
        assert_eq!(guard.request(true), Decision::Notify);
        assert_eq!(guard.request(true), Decision::Wait);
        guard.pending.store(false, Ordering::SeqCst);
        assert_eq!(guard.request(true), Decision::Notify);
        guard.approved.store(true, Ordering::SeqCst);
        assert_eq!(guard.request(true), Decision::Allow);
    }
}
