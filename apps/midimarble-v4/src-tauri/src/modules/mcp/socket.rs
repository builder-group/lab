use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};

/// Overrides the socket for the smoke script and tests
const SOCKET_ENV: &str = "MM_MCP_SOCKET";
const CACHES_FOLDER: &str = "Library/Caches/MidiMarble";
/// The line a stdio process sends once a client has initialized, on a connection it keeps open while it runs, so the
/// app knows who is connected. It isn't an MCP tool: `tools/call` only forwards the tools it lists.
pub const PRESENCE_TOOL: &str = "__presence";

/// A tool call on the socket, one JSON line
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireRequest {
    pub id: u32,
    /// One stdio server's lifetime, which names its log in `agent/runs/`
    pub session: String,
    pub client: Option<String>,
    pub tool: String,
    pub arguments: Value,
}

/// The app's answer, one JSON line
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireResponse {
    pub id: u32,
    pub content: Vec<Value>,
    pub is_error: bool,
}

/// Each binary talks to the app of the same binary, so a bundled app and a debug build of it can run side by side.
/// The path is computed the same way in the app and in the stdio process.
pub fn socket_path() -> PathBuf {
    if let Some(path) = std::env::var_os(SOCKET_ENV) {
        return PathBuf::from(path);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let binary = std::env::current_exe()
        .ok()
        .and_then(|path| path.file_stem().map(|stem| stem.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "midimarble".to_string());
    return home.join(CACHES_FOLDER).join(socket_name(&binary, cfg!(debug_assertions)));
}

fn socket_name(binary: &str, is_debug: bool) -> String {
    let slug: String = binary
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    return format!("mcp-{}{}.sock", slug, if is_debug { "-debug" } else { "" });
}

/// Binds the socket in a folder only this user can enter. A live socket means another app owns it: `AddrInUse`.
/// A stale one from a crash is replaced.
pub fn bind(path: &Path) -> io::Result<UnixListener> {
    if let Some(folder) = path.parent() {
        fs::DirBuilder::new().recursive(true).mode(0o700).create(folder)?;
    }
    if path.exists() {
        if UnixStream::connect(path).is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                "Another MidiMarble window already serves MCP",
            ));
        }
        fs::remove_file(path)?;
    }
    let listener = UnixListener::bind(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    return Ok(listener);
}

/// Answers each JSON line of a connection with `handle`, until the other side hangs up
pub fn serve_connection(
    stream: UnixStream,
    mut handle: impl FnMut(WireRequest) -> WireResponse,
) -> io::Result<()> {
    let mut writer = stream.try_clone()?;
    for line in BufReader::new(stream).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let Ok(request) = serde_json::from_str::<WireRequest>(&line) else {
            continue;
        };
        let response = handle(request);
        writeln!(writer, "{}", serde_json::to_string(&response)?)?;
        writer.flush()?;
    }
    return Ok(());
}

/// One call from the stdio process
pub fn send(path: &Path, request: &WireRequest) -> io::Result<WireResponse> {
    let mut stream = UnixStream::connect(path)?;
    writeln!(stream, "{}", serde_json::to_string(request)?)?;
    stream.flush()?;
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line)?;
    if line.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "The app closed the connection",
        ));
    }
    return Ok(serde_json::from_str(&line)?);
}

/// Says `request`'s client is connected and stays until the app hangs up: it quit, or Enable MCP went off
pub fn hold_presence(path: &Path, request: &WireRequest) -> io::Result<()> {
    let mut stream = UnixStream::connect(path)?;
    writeln!(stream, "{}", serde_json::to_string(request)?)?;
    stream.flush()?;
    io::copy(&mut stream, &mut io::sink())?;
    return Ok(());
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_socket(name: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        return std::env::temp_dir()
            .join(format!("mm-mcp-{}-{}", name, nanos % 1_000_000_000))
            .join("s.sock");
    }

    fn request(tool: &str) -> WireRequest {
        return WireRequest {
            id: 7,
            session: "s".to_string(),
            client: None,
            tool: tool.to_string(),
            arguments: json!({}),
        };
    }

    #[test]
    fn names_the_socket_after_the_binary_and_build() {
        assert_eq!(socket_name("MidiMarble", false), "mcp-midimarble.sock");
        assert_eq!(
            socket_name("MidiMarble - Development", true),
            "mcp-midimarble---development-debug.sock"
        );
    }

    #[test]
    fn binds_private_and_bridges_a_call() {
        let path = temporary_socket("bridge");
        let listener = bind(&path).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let folder = fs::metadata(path.parent().unwrap()).unwrap().permissions().mode() & 0o777;
        assert_eq!(folder, 0o700);

        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            serve_connection(stream, |request| WireResponse {
                id: request.id,
                content: vec![json!({ "type": "text", "text": request.tool })],
                is_error: false,
            })
            .unwrap();
        });
        let response = send(&path, &request("get_state")).unwrap();
        assert_eq!(response.id, 7);
        assert_eq!(response.content[0]["text"], "get_state");
        server.join().unwrap();
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn replaces_a_stale_socket_and_refuses_a_live_one() {
        let path = temporary_socket("stale");
        let first = bind(&path).unwrap();
        assert_eq!(bind(&path).unwrap_err().kind(), io::ErrorKind::AddrInUse);
        drop(first);
        // The file stays behind, as after a crash
        assert!(path.exists());
        assert!(bind(&path).is_ok());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_presence_connection_stays_until_the_app_hangs_up() {
        let path = temporary_socket("presence");
        let listener = bind(&path).unwrap();
        let (told, heard) = std::sync::mpsc::channel();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let peer = stream.try_clone().unwrap();
            told.send(peer).unwrap();
            let _ = serve_connection(stream, |request| WireResponse {
                id: request.id,
                content: vec![],
                is_error: false,
            });
        });
        let holder = {
            let path = path.clone();
            thread::spawn(move || hold_presence(&path, &request(PRESENCE_TOOL)))
        };
        let peer = heard.recv().unwrap();
        thread::sleep(std::time::Duration::from_millis(50));
        assert!(!holder.is_finished());
        peer.shutdown(std::net::Shutdown::Both).unwrap();
        assert!(holder.join().unwrap().is_ok());
        server.join().unwrap();
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn fails_clearly_without_a_server() {
        let path = temporary_socket("missing");
        assert!(send(&path, &request("get_state")).is_err());
    }
}
