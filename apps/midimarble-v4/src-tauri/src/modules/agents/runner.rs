use super::brief::{self, CANDIDATES_FOLDER};
use super::cli::AgentCli;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

pub const RUN_FILE: &str = "run.json";
pub const TRANSCRIPT_FILE: &str = "transcript.jsonl";
pub const STDERR_FILE: &str = "stderr.log";
pub const ASSET_FILE: &str = "asset.blend";
pub const MANIFEST_FILE: &str = "manifest.json";
pub const PREVIEW_FILE: &str = "preview.png";

/// Top-level package entries the app or the Blender worker rewrite during normal work, so changes there
/// do not indicate an agent writing outside its folder
const VOLATILE_ENTRIES: [&str; 6] = [
    CANDIDATES_FOLDER,
    "agent",
    ".bridge",
    ".cache",
    "renders",
    "project.json",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AgentRunStatus {
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AgentReview {
    Accepted,
    Declined,
}

/// Stored as `run.json` in the candidate folder
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecord {
    pub run_id: String,
    pub cli: AgentCli,
    pub prompt: String,
    pub status: AgentRunStatus,
    pub review: Option<AgentReview>,
    pub started_at: f64,
    pub finished_at: Option<f64>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
    /// Package files outside `candidates/` that changed during the run. Advisory: the user or Blender may
    /// also have changed them.
    #[serde(default)]
    pub outside_changes: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AgentEventKind {
    Text,
    Tool,
    Result,
    Error,
    /// The process ended; the payload is the final run record
    Exit,
}

/// One stdout line of an agent CLI, emitted as the `agent-run-event` Tauri event
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunEvent {
    pub run_id: String,
    pub kind: AgentEventKind,
    /// The CLI's JSON line, or `{"type":"raw","text":...}` for plain text
    pub payload: String,
}

struct RunProcess {
    child: Child,
    cancelled: bool,
}

/// Running agent processes keyed by run ID
#[derive(Default, Clone)]
pub struct AgentState {
    processes: Arc<Mutex<HashMap<String, RunProcess>>>,
}

impl AgentState {
    pub fn is_running(&self, run_id: &str) -> bool {
        return self
            .processes
            .lock()
            .map(|processes| processes.contains_key(run_id))
            .unwrap_or(false);
    }

    /// Spawns `command` for a prepared candidate folder and streams its stdout through `emit` until it exits
    pub fn spawn<F>(
        &self,
        package: &Path,
        dir: &Path,
        record: AgentRunRecord,
        mut command: Command,
        emit: F,
    ) -> Result<AgentRunRecord, String>
    where
        F: Fn(AgentRunEvent) + Send + 'static,
    {
        let stderr = fs::File::create(dir.join(STDERR_FILE)).map_err(|error| error.to_string())?;
        write_record(dir, &record)?;
        let before = fingerprint(package);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(stderr)
            // Own process group, so cancelling also ends Blender processes the agent started
            .process_group(0);
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let mut failed = record.clone();
                failed.status = AgentRunStatus::Failed;
                failed.finished_at = Some(now());
                failed.error = Some(format!(
                    "Could not start {}: {}",
                    record.cli.binary(),
                    error
                ));
                write_record(dir, &failed)?;
                return Err(failed.error.unwrap_or_default());
            }
        };
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(record.prompt.as_bytes());
        }
        let stdout = child.stdout.take().ok_or("Agent stdout is unavailable")?;
        self.processes
            .lock()
            .map_err(|error| error.to_string())?
            .insert(
                record.run_id.clone(),
                RunProcess {
                    child,
                    cancelled: false,
                },
            );

        let state = self.clone();
        let package = package.to_path_buf();
        let dir = dir.to_path_buf();
        let started = record.clone();
        thread::spawn(move || {
            let mut transcript = OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join(TRANSCRIPT_FILE))
                .ok();
            let mut last_result: Option<Value> = None;
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                let (kind, payload, value) = classify_line(started.cli, &line);
                if let Some(file) = transcript.as_mut() {
                    let _ = writeln!(file, "{}", payload);
                }
                if matches!(kind, AgentEventKind::Result | AgentEventKind::Error) {
                    last_result = value;
                }
                emit(AgentRunEvent {
                    run_id: started.run_id.clone(),
                    kind,
                    payload,
                });
            }
            let finished = state.finish(&package, &dir, started, before, last_result);
            let payload = serde_json::to_string(&finished).unwrap_or_default();
            emit(AgentRunEvent {
                run_id: finished.run_id.clone(),
                kind: AgentEventKind::Exit,
                payload,
            });
        });
        return Ok(record);
    }

    fn finish(
        &self,
        package: &Path,
        dir: &Path,
        mut record: AgentRunRecord,
        before: BTreeMap<String, (u64, u128)>,
        last_result: Option<Value>,
    ) -> AgentRunRecord {
        let process = self
            .processes
            .lock()
            .ok()
            .and_then(|mut processes| processes.remove(&record.run_id));
        let (exit_code, cancelled) = match process {
            Some(mut process) => {
                let status = process.child.wait().ok();
                (status.and_then(|value| value.code()), process.cancelled)
            }
            None => (None, false),
        };
        let result_error = last_result.as_ref().and_then(result_error);
        record.exit_code = exit_code;
        record.finished_at = Some(now());
        record.outside_changes = changed_paths(&before, &fingerprint(package));
        record.status = if cancelled {
            AgentRunStatus::Cancelled
        } else if exit_code == Some(0) && result_error.is_none() {
            AgentRunStatus::Succeeded
        } else {
            AgentRunStatus::Failed
        };
        if record.status == AgentRunStatus::Failed {
            record.error = result_error.or_else(|| {
                let tail = stderr_tail(dir);
                Some(if tail.is_empty() {
                    format!("{} exited with code {:?}", record.cli.binary(), exit_code)
                } else {
                    tail
                })
            });
        }
        let _ = write_record(dir, &record);
        return record;
    }

    /// Ends the run's process group. The reader thread then records the run as cancelled.
    pub fn cancel(&self, run_id: &str) -> Result<bool, String> {
        let mut processes = self.processes.lock().map_err(|error| error.to_string())?;
        let Some(process) = processes.get_mut(run_id) else {
            return Ok(false);
        };
        process.cancelled = true;
        let pid = process.child.id();
        let _ = Command::new("/bin/kill")
            .args(["-TERM", &format!("-{}", pid)])
            .status();
        let _ = process.child.kill();
        return Ok(true);
    }
}

/// Maps one stdout line to an event kind. Returns the kind, the transcript payload and the parsed value.
pub fn classify_line(cli: AgentCli, line: &str) -> (AgentEventKind, String, Option<Value>) {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        let payload = serde_json::json!({ "type": "raw", "text": line }).to_string();
        return (AgentEventKind::Text, payload, None);
    };
    let kind_of = |name: &str| value["type"].as_str() == Some(name);
    let kind = match cli {
        AgentCli::Claude => {
            if kind_of("result") {
                if value["is_error"] == true {
                    AgentEventKind::Error
                } else {
                    AgentEventKind::Result
                }
            } else if kind_of("user") {
                AgentEventKind::Tool
            } else if kind_of("assistant") {
                let has_tool = value["message"]["content"]
                    .as_array()
                    .map(|items| items.iter().any(|item| item["type"] == "tool_use"))
                    .unwrap_or(false);
                if has_tool {
                    AgentEventKind::Tool
                } else {
                    AgentEventKind::Text
                }
            } else {
                AgentEventKind::Text
            }
        }
        AgentCli::Codex => {
            let item_type = value["item"]["type"].as_str().unwrap_or("");
            if kind_of("turn.completed") {
                AgentEventKind::Result
            } else if kind_of("turn.failed") || kind_of("error") {
                AgentEventKind::Error
            } else if matches!(
                item_type,
                "command_execution" | "file_change" | "mcp_tool_call" | "web_search"
            ) {
                AgentEventKind::Tool
            } else {
                AgentEventKind::Text
            }
        }
    };
    return (kind, line.to_string(), Some(value));
}

fn result_error(value: &Value) -> Option<String> {
    if value["is_error"] == true {
        return Some(
            value["result"]
                .as_str()
                .unwrap_or("The agent reported an error")
                .to_string(),
        );
    }
    if value["type"] == "turn.failed" || value["type"] == "error" {
        let message = value["error"]["message"]
            .as_str()
            .or_else(|| value["message"].as_str())
            .unwrap_or("The agent reported an error");
        return Some(message.to_string());
    }
    return None;
}

pub fn read_record(dir: &Path) -> Option<AgentRunRecord> {
    let json = fs::read_to_string(dir.join(RUN_FILE)).ok()?;
    return serde_json::from_str(&json).ok();
}

pub fn write_record(dir: &Path, record: &AgentRunRecord) -> Result<(), String> {
    let json = serde_json::to_string_pretty(record).map_err(|error| error.to_string())?;
    let temporary = dir.join(format!("{}.tmp", RUN_FILE));
    fs::write(&temporary, json).map_err(|error| error.to_string())?;
    return fs::rename(&temporary, dir.join(RUN_FILE)).map_err(|error| error.to_string());
}

/// Candidate folders of a package, newest first. A run recorded as running without a live process was
/// interrupted, such as by quitting the app.
pub fn list_runs(state: &AgentState, package: &Path) -> Vec<(PathBuf, AgentRunRecord)> {
    let Ok(entries) = fs::read_dir(package.join(CANDIDATES_FOLDER)) else {
        return Vec::new();
    };
    let mut runs: Vec<(PathBuf, AgentRunRecord)> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .filter_map(|path| {
            let mut record = read_record(&path)?;
            if record.status == AgentRunStatus::Running && !state.is_running(&record.run_id) {
                record.status = AgentRunStatus::Failed;
                record.error = Some("The run was interrupted".to_string());
            }
            return Some((path, record));
        })
        .collect();
    runs.sort_by(|a, b| b.1.started_at.total_cmp(&a.1.started_at));
    return runs;
}

pub fn set_review(
    package: &Path,
    run_id: &str,
    review: AgentReview,
) -> Result<AgentRunRecord, String> {
    let dir = brief::candidate_dir(package, run_id).map_err(|error| error.to_string())?;
    let mut record =
        read_record(&dir).ok_or_else(|| format!("Candidate {} has no run record", run_id))?;
    record.review = Some(review);
    write_record(&dir, &record)?;
    return Ok(record);
}

/// Size and modification time of every package file outside the volatile entries
fn fingerprint(package: &Path) -> BTreeMap<String, (u64, u128)> {
    let mut files = BTreeMap::new();
    let Ok(entries) = fs::read_dir(package) else {
        return files;
    };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().to_string();
        if VOLATILE_ENTRIES.contains(&name.as_str()) {
            continue;
        }
        collect(package, &entry.path(), &mut files);
    }
    return files;
}

fn collect(root: &Path, path: &Path, files: &mut BTreeMap<String, (u64, u128)>) {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if metadata.is_dir() {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.filter_map(Result::ok) {
                collect(root, &entry.path(), files);
            }
        }
        return;
    }
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|time| time.as_nanos())
        .unwrap_or_default();
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string();
    files.insert(relative, (metadata.len(), modified));
}

fn changed_paths(
    before: &BTreeMap<String, (u64, u128)>,
    after: &BTreeMap<String, (u64, u128)>,
) -> Vec<String> {
    let mut changed: Vec<String> = after
        .iter()
        .filter(|(path, value)| before.get(*path) != Some(value))
        .map(|(path, _)| path.clone())
        .collect();
    changed.extend(
        before
            .keys()
            .filter(|path| !after.contains_key(*path))
            .cloned(),
    );
    changed.sort();
    return changed;
}

fn stderr_tail(dir: &Path) -> String {
    let text = fs::read_to_string(dir.join(STDERR_FILE)).unwrap_or_default();
    let lines: Vec<&str> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let start = lines.len().saturating_sub(5);
    return lines[start..].join("\n");
}

pub fn now() -> f64 {
    return SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as f64)
        .unwrap_or_default();
}

#[cfg(test)]
mod tests {
    use super::super::brief::tests::{temporary_package, BRIEF_JSON};
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn record(run_id: &str) -> AgentRunRecord {
        return AgentRunRecord {
            run_id: run_id.to_string(),
            cli: AgentCli::Claude,
            prompt: "Build it".to_string(),
            status: AgentRunStatus::Running,
            review: None,
            started_at: now(),
            finished_at: None,
            exit_code: None,
            error: None,
            outside_changes: Vec::new(),
        };
    }

    fn shell(script: &str, cwd: &Path) -> Command {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", script]).current_dir(cwd);
        return command;
    }

    fn collect_events(receiver: mpsc::Receiver<AgentRunEvent>) -> Vec<AgentRunEvent> {
        let mut events = Vec::new();
        while let Ok(event) = receiver.recv_timeout(Duration::from_secs(10)) {
            let done = event.kind == AgentEventKind::Exit;
            events.push(event);
            if done {
                break;
            }
        }
        return events;
    }

    #[test]
    fn classifies_claude_stream_lines() {
        let tool = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{}}]}}"#;
        let text = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}"#;
        let failed = r#"{"type":"result","is_error":true,"result":"Invalid API key"}"#;
        assert_eq!(
            classify_line(AgentCli::Claude, tool).0,
            AgentEventKind::Tool
        );
        assert_eq!(
            classify_line(AgentCli::Claude, text).0,
            AgentEventKind::Text
        );
        assert_eq!(
            classify_line(AgentCli::Claude, failed).0,
            AgentEventKind::Error
        );
        assert_eq!(
            classify_line(AgentCli::Claude, r#"{"type":"result","is_error":false}"#).0,
            AgentEventKind::Result
        );
        let (kind, payload, _) = classify_line(AgentCli::Claude, "plain text");
        assert_eq!(kind, AgentEventKind::Text);
        assert_eq!(payload, r#"{"text":"plain text","type":"raw"}"#);
    }

    #[test]
    fn classifies_codex_stream_lines() {
        let command =
            r#"{"type":"item.completed","item":{"type":"command_execution","command":"ls"}}"#;
        assert_eq!(
            classify_line(AgentCli::Codex, command).0,
            AgentEventKind::Tool
        );
        assert_eq!(
            classify_line(AgentCli::Codex, r#"{"type":"turn.completed","usage":{}}"#).0,
            AgentEventKind::Result
        );
        assert_eq!(
            classify_line(
                AgentCli::Codex,
                r#"{"type":"turn.failed","error":{"message":"x"}}"#
            )
            .0,
            AgentEventKind::Error
        );
    }

    #[test]
    fn streams_events_and_writes_the_transcript() {
        let package = temporary_package("stream");
        let dir = brief::write_candidate(&package, "run-1", BRIEF_JSON, None).unwrap();
        let state = AgentState::default();
        let (sender, receiver) = mpsc::channel();
        let script = r#"read prompt; echo "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"$prompt\"}]}}"; echo touch > asset.blend; echo '{"type":"result","is_error":false,"total_cost_usd":0.01}'"#;
        state
            .spawn(
                &package,
                &dir,
                record("run-1"),
                shell(script, &dir),
                move |event| {
                    let _ = sender.send(event);
                },
            )
            .unwrap();
        let events = collect_events(receiver);
        let kinds: Vec<AgentEventKind> = events.iter().map(|event| event.kind).collect();
        assert_eq!(
            kinds,
            [
                AgentEventKind::Text,
                AgentEventKind::Result,
                AgentEventKind::Exit
            ]
        );
        assert!(events[0].payload.contains("Build it"));
        let transcript = fs::read_to_string(dir.join(TRANSCRIPT_FILE)).unwrap();
        assert_eq!(transcript.lines().count(), 2);
        let stored = read_record(&dir).unwrap();
        assert_eq!(stored.status, AgentRunStatus::Succeeded);
        assert_eq!(stored.exit_code, Some(0));
        assert!(stored.outside_changes.is_empty());
        fs::remove_dir_all(package.parent().unwrap()).unwrap();
    }

    #[test]
    fn records_failures_and_writes_outside_the_candidate() {
        let package = temporary_package("failure");
        fs::write(package.join("scene.blend"), "before").unwrap();
        let dir = brief::write_candidate(&package, "run-1", BRIEF_JSON, None).unwrap();
        let state = AgentState::default();
        let (sender, receiver) = mpsc::channel();
        let script = r#"sleep 0.05; echo after > ../../scene.blend; echo '{"type":"result","is_error":true,"result":"Invalid API key"}'; echo oops >&2; exit 1"#;
        state
            .spawn(
                &package,
                &dir,
                record("run-1"),
                shell(script, &dir),
                move |event| {
                    let _ = sender.send(event);
                },
            )
            .unwrap();
        let events = collect_events(receiver);
        assert_eq!(events[0].kind, AgentEventKind::Error);
        let stored = read_record(&dir).unwrap();
        assert_eq!(stored.status, AgentRunStatus::Failed);
        assert_eq!(stored.error.as_deref(), Some("Invalid API key"));
        assert_eq!(stored.outside_changes, ["scene.blend"]);
        fs::remove_dir_all(package.parent().unwrap()).unwrap();
    }

    #[test]
    fn cancels_a_running_process_group() {
        let package = temporary_package("cancel");
        let dir = brief::write_candidate(&package, "run-1", BRIEF_JSON, None).unwrap();
        let state = AgentState::default();
        let (sender, receiver) = mpsc::channel();
        state
            .spawn(
                &package,
                &dir,
                record("run-1"),
                shell("sleep 30 & wait", &dir),
                move |event| {
                    let _ = sender.send(event);
                },
            )
            .unwrap();
        assert!(state.is_running("run-1"));
        assert!(state.cancel("run-1").unwrap());
        let events = collect_events(receiver);
        assert_eq!(events.last().unwrap().kind, AgentEventKind::Exit);
        assert_eq!(read_record(&dir).unwrap().status, AgentRunStatus::Cancelled);
        assert!(!state.is_running("run-1"));
        let runs = list_runs(&state, &package);
        assert_eq!(runs.len(), 1);
        let reviewed = set_review(&package, "run-1", AgentReview::Declined).unwrap();
        assert_eq!(reviewed.review, Some(AgentReview::Declined));
        fs::remove_dir_all(package.parent().unwrap()).unwrap();
    }
}
