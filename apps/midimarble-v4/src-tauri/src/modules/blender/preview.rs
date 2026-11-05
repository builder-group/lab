//! Background preview frames in `.cache/preview-frames/<signature>/` (see `blender/mm_worker/live_preview.py`).
//! The worker starts the job; the host reads its frames and status and writes its target and cancel flag
//! directly, so following the playhead never waits for the worker's queue.

use super::mailbox::{self, MailboxError};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub const PREVIEW_FOLDER: &str = ".cache/preview-frames";
const MAX_TARGET_BYTES: usize = 1024 * 1024;

/// Frames on disk and the job's `status.json`
#[derive(Debug, Default, PartialEq)]
pub struct PreviewFrames {
    pub folder: PathBuf,
    pub frames: Vec<u32>,
    pub status: Option<Value>,
}

pub fn preview_folder(package: &Path, signature: &str) -> Result<PathBuf, MailboxError> {
    if !mailbox::is_valid_id(signature) {
        return Err(MailboxError::InvalidResponse(format!("signature {}", signature)));
    }
    return Ok(package.join(PREVIEW_FOLDER).join(signature));
}

/// Lists `00042.jpg` frames, sorted. A missing folder has no frames.
pub fn list_frames(package: &Path, signature: &str) -> Result<PreviewFrames, MailboxError> {
    let folder = preview_folder(package, signature)?;
    let mut frames = PreviewFrames {
        folder: folder.clone(),
        ..PreviewFrames::default()
    };
    let Ok(entries) = fs::read_dir(&folder) else {
        return Ok(frames);
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(index) = frame_index(&name) {
            frames.frames.push(index);
        }
    }
    frames.frames.sort_unstable();
    frames.status = mailbox::read_json(&folder.join("status.json")).ok();
    return Ok(frames);
}

/// Frame number of `<digits>.jpg`, such as 42 for `00042.jpg`
fn frame_index(name: &str) -> Option<u32> {
    let stem = name.strip_suffix(".jpg")?;
    if stem.is_empty() || !stem.chars().all(|value| value.is_ascii_digit()) {
        return None;
    }
    return stem.parse().ok();
}

/// Replaces the running job's `target.json` (`{"order": [...], "paused": false}`); the job reads it between chunks
pub fn write_target(package: &Path, signature: &str, target_json: &str) -> Result<(), MailboxError> {
    let folder = preview_folder(package, signature)?;
    if target_json.len() > MAX_TARGET_BYTES {
        return Err(MailboxError::InvalidResponse("target".into()));
    }
    let target: Value = serde_json::from_str(target_json)
        .map_err(|_| MailboxError::InvalidResponse("target".into()))?;
    if !target.is_object() {
        return Err(MailboxError::InvalidResponse("target".into()));
    }
    if !folder.is_dir() {
        return Ok(());
    }
    return mailbox::write_atomic(&folder.join("target.json"), target.to_string().as_bytes());
}

/// Asks the job to stop after its current chunk. Frames on disk stay for later playback.
pub fn cancel(package: &Path, signature: &str) -> Result<(), MailboxError> {
    let folder = preview_folder(package, signature)?;
    if !folder.is_dir() {
        return Ok(());
    }
    return mailbox::write_atomic(&folder.join("cancel"), b"cancel");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_package(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("mm-preview-{}-{}", name, mailbox::new_request_id()));
        fs::create_dir_all(&path).unwrap();
        return path;
    }

    #[test]
    fn lists_frames() {
        let package = temp_package("list");
        let folder = preview_folder(&package, "abc123").unwrap();
        fs::create_dir_all(&folder).unwrap();
        for name in ["00002.jpg", "00000.jpg", "00001.jpg", ".partial-00003.jpg", "scene.blend", "x.jpg"] {
            fs::write(folder.join(name), b"x").unwrap();
        }
        fs::write(folder.join("status.json"), br#"{"state":"rendering","frames":3}"#).unwrap();
        let frames = list_frames(&package, "abc123").unwrap();
        assert_eq!(frames.frames, vec![0, 1, 2]);
        assert_eq!(frames.status.unwrap()["state"], "rendering");
        fs::remove_dir_all(package).unwrap();
    }

    #[test]
    fn missing_folder_has_no_frames() {
        let package = temp_package("missing");
        let frames = list_frames(&package, "nothing").unwrap();
        assert!(frames.frames.is_empty() && frames.status.is_none());
        fs::remove_dir_all(package).unwrap();
    }

    #[test]
    fn rejects_signatures_that_leave_the_cache() {
        let package = temp_package("signature");
        assert!(list_frames(&package, "../renders").is_err());
        assert!(write_target(&package, "a/b", "{}").is_err());
        assert!(cancel(&package, "").is_err());
        fs::remove_dir_all(package).unwrap();
    }

    #[test]
    fn writes_target_and_cancel() {
        let package = temp_package("target");
        let folder = preview_folder(&package, "sig").unwrap();
        // Nothing to retarget before the worker created the folder
        write_target(&package, "sig", r#"{"order":[1]}"#).unwrap();
        assert!(!folder.exists());
        fs::create_dir_all(&folder).unwrap();
        write_target(&package, "sig", r#"{"order":[3,4],"paused":false}"#).unwrap();
        let target: Value = serde_json::from_str(&fs::read_to_string(folder.join("target.json")).unwrap()).unwrap();
        assert_eq!(target["order"][1], 4);
        assert!(write_target(&package, "sig", "[1,2]").is_err());
        assert!(write_target(&package, "sig", "not json").is_err());
        cancel(&package, "sig").unwrap();
        assert!(folder.join("cancel").is_file());
        fs::remove_dir_all(package).unwrap();
    }
}
