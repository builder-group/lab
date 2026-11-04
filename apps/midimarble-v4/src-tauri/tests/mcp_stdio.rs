//! Drives `midimarble mcp` as a client would, over stdin and stdout, against a stub of the running app's socket.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

struct Server {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u32,
}

impl Server {
    fn start(socket: &PathBuf) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_midimarble-v4"))
            .arg("mcp")
            .env("MM_MCP_SOCKET", socket)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        return Self { child, stdin, stdout, next_id: 0 };
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        let request = json!({ "jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params });
        writeln!(self.stdin, "{}", request).unwrap();
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        // Stdout carries nothing but protocol, so every line parses
        let reply: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(reply["id"], self.next_id);
        return reply;
    }

    fn call(&mut self, tool: &str, arguments: Value) -> Value {
        return self.request("tools/call", json!({ "name": tool, "arguments": arguments }))["result"].clone();
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn temporary_socket(name: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    return std::env::temp_dir().join(format!("mm-stdio-{}-{}.sock", name, nanos % 1_000_000_000));
}

#[test]
fn says_clearly_when_the_app_is_not_open() {
    let mut server = Server::start(&temporary_socket("closed"));
    let init = server.request("initialize", json!({ "protocolVersion": "2025-06-18", "clientInfo": { "name": "test" } }));
    assert_eq!(init["result"]["serverInfo"]["name"], "midimarble");

    let tools = server.request("tools/list", json!({}));
    assert_eq!(tools["result"]["tools"].as_array().unwrap().len(), 10);

    // Guides ship in the binary
    let guide = server.call("get_guide", json!({}));
    assert_eq!(guide["isError"], false);
    assert!(guide["content"][0]["text"].as_str().unwrap().contains("# MidiMarble"));

    let state = server.call("get_state", json!({}));
    assert_eq!(state["isError"], true);
    assert!(state["content"][0]["text"].as_str().unwrap().contains("isn't open"));
}

#[test]
fn bridges_tool_calls_to_the_socket() {
    let socket = temporary_socket("open");
    let listener = UnixListener::bind(&socket).unwrap();
    let stub = thread::spawn(move || {
        let mut seen = Vec::new();
        for _ in 0..2 {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let request: Value = serde_json::from_str(&line).unwrap();
            let mut writer = stream;
            let reply = json!({
                "id": request["id"],
                "content": [{ "type": "image", "data": "UE5H", "mimeType": "image/png" }, { "type": "text", "text": "3 of 4 hits on time" }],
                "isError": request["tool"] == "export_film",
            });
            writeln!(writer, "{}", reply).unwrap();
            seen.push(request);
        }
        return seen;
    });

    let mut server = Server::start(&socket);
    server.request("initialize", json!({ "clientInfo": { "name": "claude-code" } }));
    let frame = server.call("preview_frame", json!({ "time": 1.5 }));
    assert_eq!(frame["isError"], false);
    assert_eq!(frame["content"][0]["type"], "image");
    assert_eq!(frame["content"][1]["text"], "3 of 4 hits on time");
    assert_eq!(server.call("export_film", json!({}))["isError"], true);

    let seen = stub.join().unwrap();
    assert_eq!(seen[0]["tool"], "preview_frame");
    assert_eq!(seen[0]["client"], "claude-code");
    assert_eq!(seen[0]["arguments"]["time"], 1.5);
    assert_eq!(seen[1]["tool"], "export_film");
    assert_eq!(seen[0]["session"], seen[1]["session"]);
    std::fs::remove_file(socket).unwrap();
}

#[test]
fn ends_when_stdin_closes() {
    let mut server = Server::start(&temporary_socket("end"));
    let stdin = std::mem::replace(&mut server.stdin, {
        // A sink so Drop stays simple; the real pipe closes when `stdin` drops below
        let mut other = Command::new("/bin/cat").stdin(Stdio::piped()).spawn().unwrap();
        let taken = other.stdin.take().unwrap();
        let _ = other.kill();
        let _ = other.wait();
        taken
    });
    drop(stdin);
    assert!(server.child.wait().unwrap().success());
}
