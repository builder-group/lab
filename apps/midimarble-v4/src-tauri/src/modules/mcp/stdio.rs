use super::protocol::{McpServer, ToolBridge, ToolReply};
use super::socket::{self, WireRequest};
use serde_json::Value;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const APP_NOT_OPEN: &str = "MidiMarble isn't open, or Enable MCP is off. Open MidiMarble, turn on Enable MCP in its Agent menu, then try again.";
/// How soon a running client shows as connected after the app opens or Enable MCP goes on
const PRESENCE_RETRY: Duration = Duration::from_secs(2);

/// The bridge of the stdio process: one socket connection per call, so the app can quit and reopen in between
struct SocketBridge {
    path: PathBuf,
    session: String,
    next_id: u32,
}

impl ToolBridge for SocketBridge {
    fn call(&mut self, client: Option<&str>, tool: &str, arguments: Value) -> ToolReply {
        self.next_id += 1;
        let request = WireRequest {
            id: self.next_id,
            session: self.session.clone(),
            client: client.map(str::to_string),
            tool: tool.to_string(),
            arguments,
        };
        return match socket::send(&self.path, &request) {
            Ok(response) => ToolReply {
                content: response.content,
                is_error: response.is_error,
            },
            Err(_) => ToolReply::error(APP_NOT_OPEN),
        };
    }
}

/// Keeps the app told this client is connected, for as long as this process runs. Ending the process hangs up, which
/// is how the app learns the client left.
fn keep_presence(path: PathBuf, session: String, client: Option<String>) {
    thread::spawn(move || {
        let request = WireRequest {
            id: 0,
            session,
            client,
            tool: socket::PRESENCE_TOOL.to_string(),
            arguments: Value::Null,
        };
        loop {
            let _ = socket::hold_presence(&path, &request);
            thread::sleep(PRESENCE_RETRY);
        }
    });
}

/// `midimarble mcp`: serves MCP on stdin and stdout until stdin closes. Stdout carries only the protocol. Returns
/// the process's exit code.
pub fn run() -> i32 {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default();
    let path = socket::socket_path();
    let session = format!("{}-{}", seconds, std::process::id());
    let mut server = McpServer::new(SocketBridge {
        path: path.clone(),
        session: session.clone(),
        next_id: 0,
    });
    let mut has_presence = false;
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            return 1;
        };
        if line.trim().is_empty() {
            continue;
        }
        if let Some(reply) = server.handle_line(&line) {
            if writeln!(stdout, "{}", reply).and_then(|_| stdout.flush()).is_err() {
                return 1;
            }
        }
        if !has_presence && server.is_initialized() {
            has_presence = true;
            keep_presence(path.clone(), session.clone(), server.client_name().map(str::to_string));
        }
    }
    return 0;
}
