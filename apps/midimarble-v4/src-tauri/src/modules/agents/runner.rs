use super::brief::{self, AGENT_FOLDER, CANDIDATES_FOLDER};
use super::cli::AgentCli;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
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
pub use super::brief::ASSET_FILE;
pub const MANIFEST_FILE: &str = "manifest.json";
pub const PREVIEW_FILE: &str = "preview.png";
/// `agent/runs/session.json`: the project's CLI session, which the next message continues
const SESSION_FILE: &str = "session.json";
/// Longer lines may hold images, which the transcript leaves out
const MAX_LOGGED_LINE: usize = 16 * 1024;
const SESSION_LOST: &str = "The earlier conversation couldn't be continued. Send again to start a new one.";

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

/// Stored as `run.json` in `agent/runs/<runId>/`, or in `candidates/<runId>/` for runs from before the chat
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecord {
    pub run_id: String,
    pub cli: AgentCli,
    /// What the CLI was told: the message, the selection in resolved form and the Result note
    pub prompt: String,
    /// The message as written, with mentions as `@[Name]`. Absent on runs from before the chat.
    #[serde(default)]
    pub request: Option<String>,
    /// The CLI's session this run continues or started
    #[serde(default)]
    pub session_id: Option<String>,
    pub status: AgentRunStatus,
    pub review: Option<AgentReview>,
    pub started_at: f64,
    pub finished_at: Option<f64>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
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

    /// Whether any chat run is running, so a project has one at a time
    pub fn is_any_running(&self) -> bool {
        return self
            .processes
            .lock()
            .map(|processes| !processes.is_empty())
            .unwrap_or(false);
    }

    /// Spawns `command` for a chat message and streams its stdout through `emit` until it exits. `dir` holds the
    /// run's record and transcript; `input` goes to stdin.
    pub fn spawn<F>(
        &self,
        package: &Path,
        dir: &Path,
        record: AgentRunRecord,
        input: String,
        mut command: Command,
        emit: F,
    ) -> Result<AgentRunRecord, String>
    where
        F: Fn(AgentRunEvent) + Send + 'static,
    {
        let stderr = fs::File::create(dir.join(STDERR_FILE)).map_err(|error| error.to_string())?;
        write_record(dir, &record)?;
        let is_resuming = record.session_id.is_some();
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
            let _ = stdin.write_all(input.as_bytes());
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
        let mut started = record.clone();
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
                if is_noise(value.as_ref()) {
                    continue;
                }
                let session = value.as_ref().and_then(|value| session_of(started.cli, value));
                if let Some(session) = session.filter(|id| started.session_id.as_deref() != Some(id)) {
                    let _ = write_session(&package, started.cli, &session);
                    started.session_id = Some(session);
                }
                // Text as it streams is in the finished message too, so the transcript keeps only that
                if !is_partial(value.as_ref()) {
                    if let Some(file) = transcript.as_mut() {
                        let _ = writeln!(file, "{}", without_images(&payload, value.as_ref()));
                    }
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
            let finished = state.finish(&package, &dir, started, is_resuming, last_result);
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
        is_resuming: bool,
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
            if is_resuming && record.error.as_deref().is_some_and(is_session_lost) {
                clear_session(package);
                record.error = Some(SESSION_LOST.to_string());
            }
        }
        // Stopping keeps what's done, so a finished Result counts however the run ended
        if let Err(error) = brief::settle_result(package, &record.run_id) {
            record.error.get_or_insert(error.to_string());
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

/// The session a stdout line names: Claude Code's `session_id`, or Codex's `thread_id` when its thread starts
fn session_of(cli: AgentCli, value: &Value) -> Option<String> {
    let id = match cli {
        AgentCli::Claude if matches!(value["type"].as_str(), Some("system" | "result")) => value["session_id"].as_str(),
        AgentCli::Codex if value["type"] == "thread.started" => value["thread_id"].as_str(),
        _ => None,
    };
    return id.filter(|id| !id.is_empty()).map(str::to_string);
}

/// Claude Code's progress beats, which say nothing the chat or the log shows
fn is_noise(value: Option<&Value>) -> bool {
    return value.is_some_and(|value| {
        value["type"] == "system" && matches!(value["subtype"].as_str(), Some("status" | "thinking_tokens"))
    });
}

fn is_partial(value: Option<&Value>) -> bool {
    return value.is_some_and(|value| value["type"] == "stream_event");
}

/// A tool's reply can hold a whole preview frame as base64, which has no place in a project's log
fn without_images(payload: &str, value: Option<&Value>) -> String {
    let Some(mut value) = value.filter(|_| payload.len() > MAX_LOGGED_LINE).cloned() else {
        return payload.to_string();
    };
    strip_image_data(&mut value);
    return value.to_string();
}

fn strip_image_data(value: &mut Value) {
    match value {
        Value::Array(items) => items.iter_mut().for_each(strip_image_data),
        Value::Object(object) => {
            if object.get("type").and_then(Value::as_str) == Some("image") {
                object.remove("source");
                object.remove("data");
            }
            object.values_mut().for_each(strip_image_data);
        }
        _ => {}
    }
}

/// A session a CLI no longer has, such as after the project moved
fn is_session_lost(error: &str) -> bool {
    let error = error.to_lowercase();
    return error.contains("no conversation found") || error.contains("no rollout found") || error.contains("session not found");
}

fn session_path(package: &Path) -> PathBuf {
    return package.join(AGENT_FOLDER).join("runs").join(SESSION_FILE);
}

fn write_session(package: &Path, cli: AgentCli, session: &str) -> Result<(), String> {
    let value = json!({ "cli": cli, "sessionId": session, "folder": package.join(AGENT_FOLDER) });
    return fs::write(session_path(package), value.to_string()).map_err(|error| error.to_string());
}

/// The session the next message continues. Sessions belong to a CLI and a folder, so another CLI or a project that
/// moved starts a new one.
pub fn read_session(package: &Path, cli: AgentCli) -> Option<String> {
    let value: Value = serde_json::from_str(&fs::read_to_string(session_path(package)).ok()?).ok()?;
    if serde_json::from_value::<AgentCli>(value["cli"].clone()).ok()? != cli {
        return None;
    }
    if Path::new(value["folder"].as_str()?) != package.join(AGENT_FOLDER) {
        return None;
    }
    return value["sessionId"].as_str().map(str::to_string);
}

fn clear_session(package: &Path) {
    let _ = fs::remove_file(session_path(package));
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

/// Runs of a package, newest first: chat runs in `agent/runs/` and earlier ones in `candidates/`. A run recorded as
/// running without a live process was interrupted, such as by quitting the app.
pub fn list_runs(state: &AgentState, package: &Path) -> Vec<(PathBuf, AgentRunRecord)> {
    let folders = [package.join(AGENT_FOLDER).join("runs"), package.join(CANDIDATES_FOLDER)];
    let mut runs: Vec<(PathBuf, AgentRunRecord)> = folders
        .iter()
        .filter_map(|folder| fs::read_dir(folder).ok())
        .flatten()
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

pub fn set_review(package: &Path, run_id: &str, review: AgentReview) -> Result<(PathBuf, AgentRunRecord), String> {
    let chat = brief::run_dir(package, run_id).map_err(|error| error.to_string())?;
    let dir = if chat.join(RUN_FILE).is_file() {
        chat
    } else {
        brief::candidate_dir(package, run_id).map_err(|error| error.to_string())?
    };
    let mut record = read_record(&dir).ok_or_else(|| format!("Result {} has no run record", run_id))?;
    record.review = Some(review);
    write_record(&dir, &record)?;
    return Ok((dir, record));
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
    use super::super::cli;
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::mpsc;
    use std::time::Duration;

    fn record(run_id: &str, session_id: Option<&str>) -> AgentRunRecord {
        return AgentRunRecord {
            run_id: run_id.to_string(),
            cli: AgentCli::Claude,
            prompt: "Build it".to_string(),
            request: Some("Build it".to_string()),
            session_id: session_id.map(str::to_string),
            status: AgentRunStatus::Running,
            review: None,
            started_at: now(),
            finished_at: None,
            exit_code: None,
            error: None,
        };
    }

    /// A stand-in for the CLI: an executable that runs `script` with the CLI's real arguments
    fn fake_cli(package: &Path, script: &str) -> PathBuf {
        let path = package.parent().unwrap().join("fake-claude");
        fs::write(&path, format!("#!/bin/sh\n{}\n", script)).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        return path;
    }

    fn folders(package: &Path, run_id: &str) -> (PathBuf, PathBuf) {
        let agent = package.join("agent");
        for name in ["runs", "scratch"] {
            fs::create_dir_all(agent.join(name)).unwrap();
        }
        let dir = brief::run_dir(package, run_id).unwrap();
        fs::create_dir_all(&dir).unwrap();
        return (agent, dir);
    }

    /// One message through the real command builder and a fake CLI
    fn run_fake(package: &Path, state: &AgentState, run_id: &str, script: &str) -> Vec<AgentRunEvent> {
        let (agent, dir) = folders(package, run_id);
        let session = read_session(package, AgentCli::Claude);
        let binary = fake_cli(package, script);
        let command = cli::build_chat_command(AgentCli::Claude, &binary, &agent, Path::new("/app"), session.as_deref());
        let (sender, receiver) = mpsc::channel();
        state
            .spawn(package, &dir, record(run_id, session.as_deref()), "Build it\n".to_string(), command, move |event| {
                let _ = sender.send(event);
            })
            .unwrap();
        return collect_events(receiver);
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
        assert_eq!(classify_line(AgentCli::Claude, tool).0, AgentEventKind::Tool);
        assert_eq!(classify_line(AgentCli::Claude, text).0, AgentEventKind::Text);
        assert_eq!(classify_line(AgentCli::Claude, failed).0, AgentEventKind::Error);
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
        let command = r#"{"type":"item.completed","item":{"type":"command_execution","command":"ls"}}"#;
        assert_eq!(classify_line(AgentCli::Codex, command).0, AgentEventKind::Tool);
        let mcp = r#"{"type":"item.completed","item":{"type":"mcp_tool_call","tool":"get_state"}}"#;
        assert_eq!(classify_line(AgentCli::Codex, mcp).0, AgentEventKind::Tool);
        assert_eq!(
            classify_line(AgentCli::Codex, r#"{"type":"turn.completed","usage":{}}"#).0,
            AgentEventKind::Result
        );
        assert_eq!(
            classify_line(AgentCli::Codex, r#"{"type":"turn.failed","error":{"message":"x"}}"#).0,
            AgentEventKind::Error
        );
    }

    #[test]
    fn the_transcript_leaves_out_images() {
        let line = json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "tool_use_id": "t1", "content": [{ "type": "image", "source": { "data": "x".repeat(20_000) } }] }] } }).to_string();
        let value: Value = serde_json::from_str(&line).unwrap();
        let kept = without_images(&line, Some(&value));
        assert!(kept.len() < 200);
        assert!(kept.contains("t1"));
        assert_eq!(without_images("{}", Some(&json!({}))), "{}");
    }

    #[test]
    fn reads_the_session_from_either_cli() {
        let claude: Value = serde_json::from_str(r#"{"type":"system","subtype":"init","session_id":"s-1"}"#).unwrap();
        assert_eq!(session_of(AgentCli::Claude, &claude).as_deref(), Some("s-1"));
        let text: Value = serde_json::from_str(r#"{"type":"assistant","session_id":"s-2"}"#).unwrap();
        assert_eq!(session_of(AgentCli::Claude, &text), None);
        let codex: Value = serde_json::from_str(r#"{"type":"thread.started","thread_id":"t-1"}"#).unwrap();
        assert_eq!(session_of(AgentCli::Codex, &codex).as_deref(), Some("t-1"));
    }

    const FINISHED: &str = r#"read prompt; pwd > cwd.txt; echo "$@" > args.txt; echo '{"type":"system","subtype":"init","session_id":"s-1"}'; echo '{"type":"system","subtype":"status"}'; echo '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Ti"}}}'; echo "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"$prompt\"}]}}"; echo '{"type":"result","subtype":"success","is_error":false,"session_id":"s-1"}'"#;

    #[test]
    fn a_message_runs_in_the_agent_folder_and_the_next_one_resumes() {
        let package = temporary_package("chat");
        let state = AgentState::default();
        let events = run_fake(&package, &state, "run-1", FINISHED);
        let kinds: Vec<AgentEventKind> = events.iter().map(|event| event.kind).collect();
        assert_eq!(kinds.last(), Some(&AgentEventKind::Exit));
        assert!(events.iter().any(|event| event.payload.contains("Build it")));

        let dir = package.join("agent/runs/run-1");
        let stored = read_record(&dir).unwrap();
        assert_eq!(stored.status, AgentRunStatus::Succeeded);
        assert_eq!(stored.session_id.as_deref(), Some("s-1"));
        // Streamed text stays out of the transcript
        let transcript = fs::read_to_string(dir.join(TRANSCRIPT_FILE)).unwrap();
        assert_eq!(transcript.lines().count(), 3);
        assert!(!transcript.contains("stream_event"));
        let cwd = fs::read_to_string(package.join("agent/cwd.txt")).unwrap();
        assert!(cwd.trim().ends_with("Song.marble/agent"));
        assert!(fs::read_to_string(package.join("agent/args.txt")).unwrap().contains("--strict-mcp-config"));

        assert_eq!(read_session(&package, AgentCli::Claude).as_deref(), Some("s-1"));
        assert_eq!(read_session(&package, AgentCli::Codex), None);
        run_fake(&package, &state, "run-2", FINISHED);
        assert!(fs::read_to_string(package.join("agent/args.txt")).unwrap().contains("--resume s-1"));

        let ids: Vec<String> = list_runs(&state, &package).into_iter().map(|run| run.1.run_id).collect();
        assert_eq!(ids, ["run-2", "run-1"]);
        fs::remove_dir_all(package.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_finished_result_moves_to_candidates() {
        let package = temporary_package("result");
        fs::create_dir_all(package.join("agent/scratch")).unwrap();
        brief::write_result_brief(&package, "run-1", BRIEF_JSON, None).unwrap();
        let state = AgentState::default();
        let script = r#"read prompt; echo x > scratch/result-run-1/asset.blend; echo '{"type":"result","subtype":"success","is_error":false}'"#;
        run_fake(&package, &state, "run-1", script);
        assert!(package.join("candidates/run-1/asset.blend").is_file());
        assert!(!package.join("agent/scratch/result-run-1").exists());
        let reviewed = set_review(&package, "run-1", AgentReview::Accepted).unwrap();
        assert_eq!(reviewed.1.review, Some(AgentReview::Accepted));
        assert_eq!(read_record(&package.join("agent/runs/run-1")).unwrap().review, Some(AgentReview::Accepted));
        fs::remove_dir_all(package.parent().unwrap()).unwrap();
    }

    /// One real message through the installed CLI, against an open debug app. Spends real model usage. Set
    /// `MM_SMOKE_PACKAGE`, `MM_SMOKE_PROMPT`, `MM_SMOKE_APP` (the debug binary) and `MM_MCP_SOCKET`.
    #[test]
    #[ignore = "runs the installed agent CLI against an open app"]
    fn chat_smoke() {
        let package = PathBuf::from(std::env::var("MM_SMOKE_PACKAGE").expect("MM_SMOKE_PACKAGE"));
        let prompt = std::env::var("MM_SMOKE_PROMPT").expect("MM_SMOKE_PROMPT");
        let app = PathBuf::from(std::env::var("MM_SMOKE_APP").expect("MM_SMOKE_APP"));
        let run_id = format!("smoke-{}", now() as u64);
        let binary = cli::find(AgentCli::Claude).expect("Claude Code not found");
        let (agent, dir) = folders(&package, &run_id);
        let session = read_session(&package, AgentCli::Claude);
        let full = format!("{}\n\n{}", prompt, cli::result_note(&run_id));
        let mut run = record(&run_id, session.as_deref());
        run.prompt = full.clone();
        run.request = Some(prompt);
        let command = cli::build_chat_command(AgentCli::Claude, &binary, &agent, &app, session.as_deref());
        let (sender, receiver) = mpsc::channel();
        let state = AgentState::default();
        state
            .spawn(&package, &dir, run, cli::chat_input(AgentCli::Claude, &full, session.is_some()), command, move |event| {
                let _ = sender.send(event);
            })
            .unwrap();
        while let Ok(event) = receiver.recv_timeout(Duration::from_secs(600)) {
            if event.kind == AgentEventKind::Exit {
                println!("{}", event.payload);
                break;
            }
        }
        println!("run folder: {}", dir.display());
    }

    #[test]
    fn records_failures() {
        let package = temporary_package("failure");
        let state = AgentState::default();
        let script = r#"read prompt; echo '{"type":"result","is_error":true,"result":"Invalid API key"}'; echo oops >&2; exit 1"#;
        let events = run_fake(&package, &state, "run-1", script);
        assert_eq!(events[0].kind, AgentEventKind::Error);
        let stored = read_record(&package.join("agent/runs/run-1")).unwrap();
        assert_eq!(stored.status, AgentRunStatus::Failed);
        assert_eq!(stored.error.as_deref(), Some("Invalid API key"));
        fs::remove_dir_all(package.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_lost_session_is_forgotten_and_said_plainly() {
        let package = temporary_package("lost");
        let state = AgentState::default();
        run_fake(&package, &state, "run-1", FINISHED);
        assert!(read_session(&package, AgentCli::Claude).is_some());
        let script = r#"read prompt; echo "No conversation found with session ID: s-1" >&2; exit 1"#;
        run_fake(&package, &state, "run-2", script);
        let stored = read_record(&package.join("agent/runs/run-2")).unwrap();
        assert_eq!(stored.error.as_deref(), Some(SESSION_LOST));
        assert_eq!(read_session(&package, AgentCli::Claude), None);
        fs::remove_dir_all(package.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_moved_project_starts_a_new_session() {
        let package = temporary_package("moved");
        fs::create_dir_all(package.join("agent/runs")).unwrap();
        let other = json!({ "cli": AgentCli::Claude, "sessionId": "s-1", "folder": "/elsewhere/agent" });
        fs::write(session_path(&package), other.to_string()).unwrap();
        assert_eq!(read_session(&package, AgentCli::Claude), None);
        fs::remove_dir_all(package.parent().unwrap()).unwrap();
    }

    #[test]
    fn stop_ends_the_process_group_and_keeps_the_session() {
        let package = temporary_package("cancel");
        let (agent, dir) = folders(&package, "run-1");
        let script = r#"read prompt; echo '{"type":"system","subtype":"init","session_id":"s-9"}'; sleep 30 & wait"#;
        let binary = fake_cli(&package, script);
        let command = cli::build_chat_command(AgentCli::Claude, &binary, &agent, Path::new("/app"), None);
        let state = AgentState::default();
        let (sender, receiver) = mpsc::channel();
        state
            .spawn(&package, &dir, record("run-1", None), "Build it\n".to_string(), command, move |event| {
                let _ = sender.send(event);
            })
            .unwrap();
        assert!(state.is_running("run-1"));
        assert!(state.is_any_running());
        // Waits for the session line, so stopping comes after the CLI said it
        assert!(receiver.recv_timeout(Duration::from_secs(10)).is_ok());
        assert!(state.cancel("run-1").unwrap());
        let events = collect_events(receiver);
        assert_eq!(events.last().unwrap().kind, AgentEventKind::Exit);
        let stored = read_record(&dir).unwrap();
        assert_eq!(stored.status, AgentRunStatus::Cancelled);
        assert_eq!(stored.session_id.as_deref(), Some("s-9"));
        assert_eq!(read_session(&package, AgentCli::Claude).as_deref(), Some("s-9"));
        assert!(!state.is_running("run-1"));
        fs::remove_dir_all(package.parent().unwrap()).unwrap();
    }
}
