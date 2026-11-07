use super::socket::{self, WireRequest, WireResponse};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::Write;
use std::net::Shutdown;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_specta::Event;

/// A Blender still takes a while; an app showing a dialog never answers
const TOOL_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_LOGGED_ARGUMENTS: usize = 4000;
const MAX_CLIENT_NAME: usize = 64;

/// A tool call for the front end to run. Answered with `mcp_respond`.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct McpRequestEvent {
    pub request_id: u32,
    pub tool: String,
    /// JSON of the tool's arguments
    pub arguments_json: String,
}

/// The front end's answer. `packagePath` names the project whose `agent/runs/` logs the call.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontEndReply {
    pub content: Vec<Value>,
    #[serde(default)]
    pub is_error: bool,
    #[serde(default)]
    pub package_path: Option<String>,
}

/// Which agents are connected changed. `clients` holds what each calls itself in `initialize`, one per connection.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct McpClientsEvent {
    pub clients: Vec<String>,
}

#[derive(Default)]
pub struct McpState {
    shared: Arc<Shared>,
}

/// The stdio processes holding a presence connection, by session. Sorted, so the names read the same every time.
#[derive(Default)]
struct ConnectedClients {
    sessions: BTreeMap<String, (String, Option<UnixStream>)>,
}

impl ConnectedClients {
    fn join(&mut self, session: String, client: Option<String>, stream: Option<UnixStream>) {
        let name: String = client.unwrap_or_default().chars().take(MAX_CLIENT_NAME).collect();
        self.sessions.insert(session, (name, stream));
    }

    fn leave(&mut self, session: &str) {
        self.sessions.remove(session);
    }

    fn names(&self) -> Vec<String> {
        return self.sessions.values().map(|(name, _)| name.clone()).collect();
    }

    /// Hangs up on everyone, so each stdio process finds the socket gone and tries again until it's back
    fn hang_up(&mut self) {
        for (_, stream) in self.sessions.values() {
            if let Some(stream) = stream {
                let _ = stream.shutdown(Shutdown::Both);
            }
        }
        self.sessions.clear();
    }
}

#[derive(Default)]
struct Shared {
    is_serving: AtomicBool,
    is_front_end_ready: AtomicBool,
    next_request: AtomicU32,
    pending: Mutex<HashMap<u32, Sender<FrontEndReply>>>,
    clients: Mutex<ConnectedClients>,
}

impl Shared {
    fn client_names(&self) -> Vec<String> {
        return self.clients.lock().map(|clients| clients.names()).unwrap_or_default();
    }

    fn announce_clients(&self, app: &AppHandle) {
        let _ = McpClientsEvent { clients: self.client_names() }.emit(app);
    }
}

impl McpState {
    pub fn set_front_end_ready(&self) {
        self.shared.is_front_end_ready.store(true, Ordering::SeqCst);
    }

    pub fn is_serving(&self) -> bool {
        return self.shared.is_serving.load(Ordering::SeqCst);
    }

    pub fn client_names(&self) -> Vec<String> {
        return self.shared.client_names();
    }

    /// Hands the front end's answer to the connection waiting for it
    pub fn respond(&self, request_id: u32, reply: FrontEndReply) {
        let sender = self
            .shared
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(&request_id));
        if let Some(sender) = sender {
            let _ = sender.send(reply);
        }
    }

    /// Starts the socket, or leaves it when it already runs. Fails when another app owns it.
    pub fn start(&self, app: &AppHandle) -> Result<(), String> {
        if self.is_serving() {
            return Ok(());
        }
        let path = socket::socket_path();
        let listener = socket::bind(&path).map_err(|error| error.to_string())?;
        self.shared.is_serving.store(true, Ordering::SeqCst);
        let shared = self.shared.clone();
        let app = app.clone();
        thread::spawn(move || {
            for stream in listener.incoming() {
                if !shared.is_serving.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(stream) = stream else {
                    continue;
                };
                let shared = shared.clone();
                let app = app.clone();
                thread::spawn(move || {
                    let peer = stream.try_clone().ok();
                    let mut held = None;
                    let _ = socket::serve_connection(stream, |request| {
                        if request.tool != socket::PRESENCE_TOOL {
                            return handle_request(&app, &shared, request);
                        }
                        held = Some(request.session.clone());
                        if let Ok(mut clients) = shared.clients.lock() {
                            clients.join(request.session, request.client, peer.as_ref().and_then(|stream| stream.try_clone().ok()));
                        }
                        shared.announce_clients(&app);
                        return WireResponse { id: request.id, content: vec![], is_error: false };
                    });
                    if let Some(session) = held {
                        if let Ok(mut clients) = shared.clients.lock() {
                            clients.leave(&session);
                        }
                        shared.announce_clients(&app);
                    }
                });
            }
        });
        return Ok(());
    }

    pub fn stop(&self) {
        if !self.shared.is_serving.swap(false, Ordering::SeqCst) {
            return;
        }
        let path = socket::socket_path();
        // Wakes the accept loop so it sees the flag and drops the listener
        let _ = UnixStream::connect(&path);
        let _ = fs::remove_file(&path);
        if let Ok(mut clients) = self.shared.clients.lock() {
            clients.hang_up();
        }
    }
}

fn handle_request(app: &AppHandle, shared: &Shared, request: WireRequest) -> WireResponse {
    let started = Instant::now();
    let reply = ask_front_end(app, shared, &request);
    if let Some(package) = &reply.package_path {
        let _ = log_call(Path::new(package), &request, &reply, started.elapsed());
    }
    let (content, had_failure) = with_images(reply.content);
    return WireResponse {
        id: request.id,
        content,
        is_error: reply.is_error || had_failure,
    };
}

fn ask_front_end(app: &AppHandle, shared: &Shared, request: &WireRequest) -> FrontEndReply {
    if !shared.is_serving.load(Ordering::SeqCst) {
        return text_reply("MCP is off. Turn on Enable MCP in MidiMarble's Agent menu, then try again.");
    }
    if !shared.is_front_end_ready.load(Ordering::SeqCst) {
        return text_reply("MidiMarble is still starting. Try again in a moment.");
    }
    let request_id = shared.next_request.fetch_add(1, Ordering::SeqCst);
    let (sender, receiver) = mpsc::channel();
    if let Ok(mut pending) = shared.pending.lock() {
        pending.insert(request_id, sender);
    }
    let event = McpRequestEvent {
        request_id,
        tool: request.tool.clone(),
        arguments_json: request.arguments.to_string(),
    };
    if let Err(error) = event.emit(app) {
        return text_reply(format!("MidiMarble couldn't take the call: {}", error));
    }
    let answer = receiver.recv_timeout(TOOL_TIMEOUT);
    if let Ok(mut pending) = shared.pending.lock() {
        pending.remove(&request_id);
    }
    return answer.unwrap_or_else(|_| {
        text_reply("MidiMarble didn't answer in time. It may be waiting for the person, such as on a dialog.")
    });
}

fn text_reply(message: impl Into<String>) -> FrontEndReply {
    return FrontEndReply {
        content: vec![json!({ "type": "text", "text": message.into() })],
        is_error: true,
        package_path: None,
    };
}

/// Turns the front end's `imagePath` blocks into MCP image blocks, since the web view can't hand over a file
fn with_images(content: Vec<Value>) -> (Vec<Value>, bool) {
    let mut had_failure = false;
    let blocks = content
        .into_iter()
        .map(|block| {
            if block["type"] != "imagePath" {
                return block;
            }
            let path = block["path"].as_str().unwrap_or_default();
            return match image_block(Path::new(path)) {
                Ok(image) => image,
                Err(message) => {
                    had_failure = true;
                    json!({ "type": "text", "text": message })
                }
            };
        })
        .collect();
    return (blocks, had_failure);
}

fn image_block(path: &Path) -> Result<Value, String> {
    let unreadable = |error: std::io::Error| format!("The image at {} couldn't be read: {}", path.display(), error);
    let size = fs::metadata(path).map_err(unreadable)?.len();
    if size > MAX_IMAGE_BYTES {
        return Err(format!("The image at {} is too large to send", path.display()));
    }
    let bytes = fs::read(path).map_err(unreadable)?;
    return Ok(json!({
        "type": "image",
        "data": base64::engine::general_purpose::STANDARD.encode(bytes),
        "mimeType": "image/png",
    }));
}

/// One line in `agent/runs/mcp-<session>.jsonl`, the benchmark record of how a film was made
fn log_call(package: &Path, request: &WireRequest, reply: &FrontEndReply, elapsed: Duration) -> std::io::Result<()> {
    if !package.join("project.json").is_file() {
        return Ok(());
    }
    let path = run_log_path(package, &request.session);
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)?;
    }
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs_f64())
        .unwrap_or_default();
    let summary = reply
        .content
        .iter()
        .find_map(|block| block["text"].as_str())
        .map(|text| text.chars().take(400).collect::<String>());
    let line = json!({
        "time": time,
        "client": request.client,
        "tool": request.tool,
        "arguments": logged_arguments(&request.arguments),
        "isError": reply.is_error,
        "ms": elapsed.as_millis() as u64,
        "summary": summary,
    });
    let mut file = fs::OpenOptions::new().create(true).append(true).open(path)?;
    return writeln!(file, "{}", line);
}

fn run_log_path(package: &Path, session: &str) -> PathBuf {
    let safe: String = session
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    return package.join("agent/runs").join(format!("mcp-{}.jsonl", safe));
}

fn logged_arguments(arguments: &Value) -> Value {
    let text = arguments.to_string();
    if text.len() <= MAX_LOGGED_ARGUMENTS {
        return arguments.clone();
    }
    return json!({ "truncated": text.chars().take(MAX_LOGGED_ARGUMENTS).collect::<String>() });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_package(name: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let package = std::env::temp_dir().join(format!("mm-host-{}-{}", name, nanos));
        fs::create_dir_all(&package).unwrap();
        fs::write(package.join("project.json"), "{}").unwrap();
        return package;
    }

    fn request(session: &str) -> WireRequest {
        return WireRequest {
            id: 1,
            session: session.to_string(),
            client: Some("codex".to_string()),
            tool: "run_command".to_string(),
            arguments: json!({ "id": "build.next" }),
        };
    }

    #[test]
    fn keeps_who_is_connected_by_session() {
        let mut clients = ConnectedClients::default();
        assert!(clients.names().is_empty());
        clients.join("b".to_string(), Some("codex".to_string()), None);
        clients.join("a".to_string(), Some("claude-code".to_string()), None);
        clients.join("c".to_string(), None, None);
        assert_eq!(clients.names(), ["claude-code", "codex", ""]);
        clients.leave("a");
        clients.leave("gone");
        assert_eq!(clients.names(), ["codex", ""]);
        clients.hang_up();
        assert!(clients.names().is_empty());
    }

    #[test]
    fn logs_each_call_to_the_sessions_run_file() {
        let package = temporary_package("log");
        let reply = FrontEndReply {
            content: vec![json!({ "type": "text", "text": "3 of 4 hits on time" })],
            is_error: false,
            package_path: None,
        };
        log_call(&package, &request("100-5"), &reply, Duration::from_millis(12)).unwrap();
        log_call(&package, &request("100-5"), &reply, Duration::from_millis(12)).unwrap();
        let log = fs::read_to_string(package.join("agent/runs/mcp-100-5.jsonl")).unwrap();
        let lines: Vec<&str> = log.lines().collect();
        assert_eq!(lines.len(), 2);
        let first: Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["tool"], "run_command");
        assert_eq!(first["client"], "codex");
        assert_eq!(first["ms"], 12);
        assert_eq!(first["summary"], "3 of 4 hits on time");
        fs::remove_dir_all(package).unwrap();
    }

    #[test]
    fn a_session_name_stays_inside_the_runs_folder() {
        let path = run_log_path(Path::new("/p"), "../../evil");
        assert_eq!(path, Path::new("/p/agent/runs/mcp-evil.jsonl"));
    }

    #[test]
    fn turns_image_paths_into_image_blocks() {
        let package = temporary_package("image");
        let image = package.join("frame.png");
        fs::write(&image, b"PNG").unwrap();
        let (content, had_failure) = with_images(vec![
            json!({ "type": "text", "text": "a frame" }),
            json!({ "type": "imagePath", "path": image.display().to_string() }),
        ]);
        assert!(!had_failure);
        assert_eq!(content[1]["type"], "image");
        assert_eq!(content[1]["data"], "UE5H");
        assert_eq!(content[1]["mimeType"], "image/png");

        let (missing, had_failure) = with_images(vec![json!({ "type": "imagePath", "path": "/no/such.png" })]);
        assert!(had_failure);
        assert_eq!(missing[0]["type"], "text");
        fs::remove_dir_all(package).unwrap();
    }
}
