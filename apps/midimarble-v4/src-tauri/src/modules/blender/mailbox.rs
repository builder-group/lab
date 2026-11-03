use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const BRIDGE_FOLDER: &str = ".bridge";
pub const HOST_INBOX: &str = "host-inbox";
pub const OUTBOX: &str = "outbox";
pub const STATUS_FILE: &str = "status.json";
const MAX_RESPONSE_BYTES: u64 = 64 * 1024 * 1024;

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, thiserror::Error)]
pub enum MailboxError {
    #[error("{action} {path}: {source}")]
    Io {
        action: &'static str,
        path: String,
        source: std::io::Error,
    },
    #[error("{0} is not a valid response")]
    InvalidResponse(String),
    #[error("{0} leaves the package")]
    OutsidePackage(String),
}

/// Unique request ID that matches the worker's `[A-Za-z0-9_-]` file name rule
pub fn new_request_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let count = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    return format!("h{}-{}-{}", nanos, std::process::id(), count);
}

pub fn bridge_dir(package: &Path) -> PathBuf {
    return package.join(BRIDGE_FOLDER);
}

pub fn request_path(package: &Path, id: &str) -> PathBuf {
    return bridge_dir(package).join(HOST_INBOX).join(format!("{}.json", id));
}

pub fn response_path(package: &Path, id: &str) -> PathBuf {
    return bridge_dir(package).join(OUTBOX).join(format!("{}.json", id));
}

pub fn progress_path(package: &Path, id: &str) -> PathBuf {
    return bridge_dir(package)
        .join(OUTBOX)
        .join(format!("{}.progress.json", id));
}

pub fn ensure_bridge(package: &Path) -> Result<(), MailboxError> {
    for folder in [HOST_INBOX, OUTBOX] {
        let path = bridge_dir(package).join(folder);
        fs::create_dir_all(&path).map_err(|source| io("create", &path, source))?;
    }
    return Ok(());
}

/// Writes `{id, op, args}` atomically into the host inbox and returns the request file path
pub fn write_request(
    package: &Path,
    id: &str,
    op: &str,
    args: Value,
) -> Result<PathBuf, MailboxError> {
    ensure_bridge(package)?;
    let path = request_path(package, id);
    let body = json!({ "id": id, "op": op, "args": args });
    write_atomic(&path, body.to_string().as_bytes())?;
    return Ok(path);
}

/// Takes the worker's response for `id` if it has arrived, removing the response and progress files
pub fn take_response(package: &Path, id: &str) -> Result<Option<Value>, MailboxError> {
    let path = response_path(package, id);
    if !path.is_file() {
        return Ok(None);
    }
    let value = read_json(&path)?;
    let _ = fs::remove_file(&path);
    let _ = fs::remove_file(progress_path(package, id));
    if value.get("id").and_then(Value::as_str) != Some(id) || !value["ok"].is_boolean() {
        return Err(MailboxError::InvalidResponse(path.display().to_string()));
    }
    return Ok(Some(value));
}

/// Progress and, once finished, the response of a background job such as a film render. The job writes the
/// same files as a request; the response is taken (removed) like a request's.
pub fn poll_job(package: &Path, id: &str) -> Result<(Option<Value>, Option<Value>), MailboxError> {
    if !is_valid_id(id) {
        return Err(MailboxError::InvalidResponse(format!("job {}", id)));
    }
    let progress = read_json(&progress_path(package, id)).ok();
    let response = take_response(package, id)?;
    return Ok((progress, response));
}

/// Request and job IDs use `[A-Za-z0-9_-]{1,100}` like the worker's file name rule
pub fn is_valid_id(id: &str) -> bool {
    return !id.is_empty()
        && id.len() <= 100
        && id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_');
}

pub fn read_status(package: &Path) -> Option<Value> {
    return read_json(&bridge_dir(package).join(STATUS_FILE)).ok();
}

pub fn read_json(path: &Path) -> Result<Value, MailboxError> {
    let metadata = fs::metadata(path).map_err(|source| io("read", path, source))?;
    if metadata.len() > MAX_RESPONSE_BYTES {
        return Err(MailboxError::InvalidResponse(path.display().to_string()));
    }
    let text = fs::read_to_string(path).map_err(|source| io("read", path, source))?;
    return serde_json::from_str(&text)
        .map_err(|_| MailboxError::InvalidResponse(path.display().to_string()));
}

/// Resolves a package-relative path, rejecting absolute paths and `..` components
pub fn package_file(package: &Path, relative: &str) -> Result<PathBuf, MailboxError> {
    let relative_path = Path::new(relative);
    let is_inside = !relative.is_empty()
        && relative_path
            .components()
            .all(|component| matches!(component, Component::Normal(_)));
    if !is_inside {
        return Err(MailboxError::OutsidePackage(relative.to_string()));
    }
    return Ok(package.join(relative_path));
}

/// Writes a package file atomically, creating its parent folders
pub fn write_package_file(
    package: &Path,
    relative: &str,
    bytes: &[u8],
) -> Result<PathBuf, MailboxError> {
    let path = package_file(package, relative)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| io("create", parent, source))?;
    }
    write_atomic(&path, bytes)?;
    return Ok(path);
}

/// Writes through a sibling temporary file and a rename. The temporary name does not end in `.json`,
/// so mailbox readers never see a partial file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), MailboxError> {
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let temporary = path.with_file_name(format!("{}.tmp-{}", file_name, new_request_id()));
    let mut file = fs::File::create(&temporary).map_err(|source| io("write", &temporary, source))?;
    file.write_all(bytes)
        .map_err(|source| io("write", &temporary, source))?;
    drop(file);
    fs::rename(&temporary, path).map_err(|source| io("replace", path, source))?;
    return Ok(());
}

fn io(action: &'static str, path: &Path, source: std::io::Error) -> MailboxError {
    return MailboxError::Io {
        action,
        path: path.display().to_string(),
        source,
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_package(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("mm-mailbox-{}-{}", name, new_request_id()));
        fs::create_dir_all(&path).unwrap();
        return path;
    }

    #[test]
    fn request_round_trip() {
        let package = temp_package("round-trip");
        let id = new_request_id();
        let path = write_request(&package, &id, "ping", json!({"a": 1})).unwrap();
        let written = read_json(&path).unwrap();
        assert_eq!(written["id"], id.as_str());
        assert_eq!(written["op"], "ping");
        assert_eq!(written["args"]["a"], 1);
        // No temporary files are left next to the request
        let entries: Vec<_> = fs::read_dir(path.parent().unwrap()).unwrap().collect();
        assert_eq!(entries.len(), 1);

        assert!(take_response(&package, &id).unwrap().is_none());
        write_atomic(
            &response_path(&package, &id),
            json!({"id": id, "ok": true, "result": {"pong": true}})
                .to_string()
                .as_bytes(),
        )
        .unwrap();
        write_atomic(&progress_path(&package, &id), b"{}").unwrap();
        let response = take_response(&package, &id).unwrap().unwrap();
        assert_eq!(response["result"]["pong"], true);
        assert!(!response_path(&package, &id).exists());
        assert!(!progress_path(&package, &id).exists());
        fs::remove_dir_all(&package).unwrap();
    }

    #[test]
    fn rejects_mismatched_response() {
        let package = temp_package("mismatch");
        ensure_bridge(&package).unwrap();
        write_atomic(
            &response_path(&package, "a"),
            json!({"id": "b", "ok": true}).to_string().as_bytes(),
        )
        .unwrap();
        assert!(take_response(&package, "a").is_err());
        fs::remove_dir_all(&package).unwrap();
    }

    #[test]
    fn request_ids_are_unique_and_safe() {
        let first = new_request_id();
        let second = new_request_id();
        assert_ne!(first, second);
        assert!(first
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_'));
    }

    #[test]
    fn polls_job_progress_and_response() {
        let package = temp_package("job");
        ensure_bridge(&package).unwrap();
        assert!(poll_job(&package, "../x").is_err());
        let (progress, response) = poll_job(&package, "film-1").unwrap();
        assert!(progress.is_none() && response.is_none());
        write_atomic(
            &progress_path(&package, "film-1"),
            json!({"id": "film-1", "progress": 0.5}).to_string().as_bytes(),
        )
        .unwrap();
        let (progress, response) = poll_job(&package, "film-1").unwrap();
        assert_eq!(progress.unwrap()["progress"], 0.5);
        assert!(response.is_none());
        write_atomic(
            &response_path(&package, "film-1"),
            json!({"id": "film-1", "ok": true, "result": {"path": "x.mp4"}})
                .to_string()
                .as_bytes(),
        )
        .unwrap();
        let (_, response) = poll_job(&package, "film-1").unwrap();
        assert_eq!(response.unwrap()["result"]["path"], "x.mp4");
        assert!(!response_path(&package, "film-1").exists());
        fs::remove_dir_all(&package).unwrap();
    }

    #[test]
    fn package_files_stay_inside() {
        let package = temp_package("files");
        let path = write_package_file(&package, ".cache/motion/m1.bin", &[1, 2, 3]).unwrap();
        assert_eq!(fs::read(&path).unwrap(), vec![1, 2, 3]);
        assert!(package_file(&package, "../escape.bin").is_err());
        assert!(package_file(&package, "/etc/passwd").is_err());
        assert!(package_file(&package, ".cache/../../x").is_err());
        assert!(package_file(&package, "").is_err());
        fs::remove_dir_all(&package).unwrap();
    }
}
