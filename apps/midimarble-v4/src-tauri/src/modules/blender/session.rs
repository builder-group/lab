use super::detect;
use super::mailbox;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const POLL: Duration = Duration::from_millis(20);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(60);
const EXIT_TIMEOUT: Duration = Duration::from_secs(10);

pub struct BlenderProcess {
    child: Child,
    visible: bool,
}

/// One Blender worker process per open package, keyed by package path
#[derive(Default, Clone)]
pub struct BlenderState {
    processes: Arc<Mutex<HashMap<PathBuf, BlenderProcess>>>,
    // Serializes starts and stops so one package never gets two workers
    lifecycle: Arc<Mutex<()>>,
}

pub struct Session {
    pub pid: u32,
    pub visible: bool,
}

impl BlenderState {
    pub fn session(&self, package: &Path) -> Result<Option<Session>, String> {
        let mut processes = self.processes.lock().map_err(|error| error.to_string())?;
        let Some(process) = processes.get_mut(package) else {
            return Ok(None);
        };
        if process
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            processes.remove(package);
            return Ok(None);
        }
        return Ok(Some(Session {
            pid: process.child.id(),
            visible: process.visible,
        }));
    }

    /// Starts the worker for `package` and waits until it reports ready. Returns the running session when one exists.
    pub fn start(&self, worker: &Path, package: &Path, visible: bool) -> Result<Session, String> {
        let _lifecycle = self.lifecycle.lock().map_err(|error| error.to_string())?;
        if let Some(session) = self.session(package)? {
            return Ok(session);
        }
        let blender = detect::blender_path().ok_or(
            "Blender was not found. Install it in /Applications or set MIDIMARBLE_BLENDER.",
        )?;
        if !worker.is_file() {
            return Err(format!("Blender worker not found at {}", worker.display()));
        }
        mailbox::ensure_bridge(package).map_err(|error| error.to_string())?;
        let status_path = mailbox::bridge_dir(package).join(mailbox::STATUS_FILE);
        let _ = fs::remove_file(&status_path);
        let log_path = mailbox::bridge_dir(package).join("worker.log");
        let log = fs::File::create(&log_path).map_err(|error| error.to_string())?;

        let mut command = Command::new(blender);
        if !visible {
            command.arg("--background");
        }
        let scene = package.join("scene.blend");
        if scene.is_file() {
            command.arg(&scene);
        }
        command
            .args(["--python-exit-code", "1", "--python"])
            .arg(worker)
            .arg("--")
            .arg("--project-dir")
            .arg(package)
            .arg("--host-pid")
            .arg(std::process::id().to_string())
            // The bundled worker lives in a read-only app bundle in release builds
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|error| error.to_string())?)
            .stderr(log);
        let child = command
            .spawn()
            .map_err(|error| format!("Could not launch Blender: {}", error))?;
        let pid = child.id();
        self.processes
            .lock()
            .map_err(|error| error.to_string())?
            .insert(package.to_path_buf(), BlenderProcess { child, visible });

        let began = Instant::now();
        loop {
            if self.session(package)?.is_none() {
                return Err(format!(
                    "Blender exited while starting. See {}",
                    log_path.display()
                ));
            }
            if let Some(status) = mailbox::read_status(package) {
                if status["ready"] == true && status["pid"].as_u64() == Some(u64::from(pid)) {
                    return Ok(Session { pid, visible });
                }
            }
            if began.elapsed() > STARTUP_TIMEOUT {
                self.kill(package)?;
                return Err(format!(
                    "Blender did not become ready within {} seconds. See {}",
                    STARTUP_TIMEOUT.as_secs(),
                    log_path.display()
                ));
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    /// Sends one request and blocks until the worker answers. Returns the response envelope `{id, ok, result | error}`.
    pub fn request(
        &self,
        package: &Path,
        op: &str,
        args: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        if self.session(package)?.is_none() {
            return Err("Blender is not running for this project".to_string());
        }
        let id = mailbox::new_request_id();
        let request_path =
            mailbox::write_request(package, &id, op, args).map_err(|error| error.to_string())?;
        let began = Instant::now();
        loop {
            // The worker can answer and exit right away on shutdown, so read the response before checking liveness
            if let Some(response) =
                mailbox::take_response(package, &id).map_err(|error| error.to_string())?
            {
                return Ok(response);
            }
            if self.session(package)?.is_none() {
                let _ = fs::remove_file(&request_path);
                return Err(format!("Blender exited while handling {}", op));
            }
            if began.elapsed() > timeout {
                let _ = fs::remove_file(&request_path);
                return Err(format!(
                    "Blender did not answer {} within {} ms",
                    op,
                    timeout.as_millis()
                ));
            }
            thread::sleep(POLL);
        }
    }

    /// Saves and closes the worker. A failed save leaves Blender running so no work is lost.
    pub fn stop(&self, package: &Path) -> Result<(), String> {
        let _lifecycle = self.lifecycle.lock().map_err(|error| error.to_string())?;
        if self.session(package)?.is_none() {
            return Ok(());
        }
        let response = self.request(package, "shutdown", Value::Object(Default::default()), SHUTDOWN_TIMEOUT)?;
        if response["ok"] != true {
            return Err(format!(
                "Blender could not save before closing: {}",
                response["error"]["message"].as_str().unwrap_or("unknown error")
            ));
        }
        let began = Instant::now();
        while began.elapsed() < EXIT_TIMEOUT {
            if self.session(package)?.is_none() {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(50));
        }
        // The scene is saved; a worker that does not exit is safe to end
        return self.kill(package);
    }

    fn kill(&self, package: &Path) -> Result<(), String> {
        let process = self
            .processes
            .lock()
            .map_err(|error| error.to_string())?
            .remove(package);
        if let Some(mut process) = process {
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
        return Ok(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Needs an installed Blender: cargo test -p midimarble-v4 -- --ignored
    #[test]
    #[ignore]
    fn background_worker_round_trip() {
        let package = std::env::temp_dir().join(format!("mm-session-{}.marble", mailbox::new_request_id()));
        fs::create_dir_all(&package).unwrap();
        let worker = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../blender/worker.py");
        let state = BlenderState::default();
        let session = state.start(&worker, &package, false).unwrap();
        assert!(!session.visible);
        let again = state.start(&worker, &package, false).unwrap();
        assert_eq!(again.pid, session.pid);

        let ping = state.request(&package, "ping", json!({}), Duration::from_secs(10)).unwrap();
        assert_eq!(ping["ok"], true);
        assert_eq!(ping["result"]["background"], true);
        let unknown = state.request(&package, "explode", json!({}), Duration::from_secs(10)).unwrap();
        assert_eq!(unknown["ok"], false);
        assert_eq!(unknown["error"]["code"], "UNKNOWN_OP");
        let inspect = state.request(&package, "inspect", json!({}), Duration::from_secs(10)).unwrap();
        assert_eq!(inspect["ok"], true);

        state.stop(&package).unwrap();
        assert!(state.session(&package).unwrap().is_none());
        assert!(package.join("scene.blend").is_file());
        fs::remove_dir_all(&package).unwrap();
    }
}
