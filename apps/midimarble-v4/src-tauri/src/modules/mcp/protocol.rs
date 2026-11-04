use super::guides;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const SERVER_NAME: &str = "midimarble";
const LATEST_PROTOCOL: &str = "2025-06-18";
const SUPPORTED_PROTOCOLS: [&str; 3] = ["2024-11-05", "2025-03-26", LATEST_PROTOCOL];
const INSTRUCTIONS: &str = "MidiMarble builds marble-run films from a song. Call get_guide first, then get_state. \
Every edit shows live in the person's window as one Undo step. When they say \"this\" or \"these\", read get_state.selection. A reply saying Stop means stop and ask.";

/// One tool call as the app answers it. `content` holds MCP content blocks.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolReply {
    pub content: Vec<Value>,
    pub is_error: bool,
}

impl ToolReply {
    pub fn text(text: impl Into<String>) -> Self {
        return Self {
            content: vec![json!({ "type": "text", "text": text.into() })],
            is_error: false,
        };
    }

    pub fn error(text: impl Into<String>) -> Self {
        return Self {
            content: vec![json!({ "type": "text", "text": text.into() })],
            is_error: true,
        };
    }
}

/// Where tool calls go: the socket to the running app, or a stub in tests
pub trait ToolBridge {
    fn call(&mut self, client: Option<&str>, tool: &str, arguments: Value) -> ToolReply;
}

#[derive(Debug, Deserialize)]
struct RpcRequest {
    #[serde(default)]
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct RpcError {
    code: i32,
    message: String,
}

/// The JSON-RPC side of the server: one request line in, at most one response line out
pub struct McpServer<B: ToolBridge> {
    bridge: B,
    client: Option<String>,
    is_initialized: bool,
}

impl<B: ToolBridge> McpServer<B> {
    pub fn new(bridge: B) -> Self {
        return Self {
            bridge,
            client: None,
            is_initialized: false,
        };
    }

    /// A client has said hello: `client_name` is what it calls itself, if anything
    pub fn is_initialized(&self) -> bool {
        return self.is_initialized;
    }

    pub fn client_name(&self) -> Option<&str> {
        return self.client.as_deref();
    }

    /// The response to one line, None for a notification. An array is a JSON-RPC batch.
    pub fn handle_line(&mut self, line: &str) -> Option<String> {
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(error) => {
                return Some(failure(
                    Value::Null,
                    -32700,
                    format!("Parse error: {}", error),
                ))
            }
        };
        if let Value::Array(items) = value {
            let replies: Vec<String> = items
                .into_iter()
                .filter_map(|item| self.handle_value(item))
                .collect();
            return (!replies.is_empty()).then(|| format!("[{}]", replies.join(",")));
        }
        return self.handle_value(value);
    }

    fn handle_value(&mut self, value: Value) -> Option<String> {
        let request: RpcRequest = match serde_json::from_value(value) {
            Ok(request) => request,
            Err(error) => {
                return Some(failure(
                    Value::Null,
                    -32600,
                    format!("Invalid request: {}", error),
                ))
            }
        };
        let id = request.id?;
        let result = match request.method.as_str() {
            "initialize" => self.initialize(&request.params),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": tool_definitions() })),
            "tools/call" => self.call_tool(&request.params),
            other => Err(RpcError {
                code: -32601,
                message: format!("Method not found: {}", other),
            }),
        };
        return Some(match result {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string(),
            Err(error) => failure(id, error.code, error.message),
        });
    }

    fn initialize(&mut self, params: &Value) -> Result<Value, RpcError> {
        self.is_initialized = true;
        self.client = params
            .pointer("/clientInfo/name")
            .and_then(Value::as_str)
            .map(str::to_string);
        let requested = params
            .get("protocolVersion")
            .and_then(Value::as_str)
            .unwrap_or(LATEST_PROTOCOL);
        let version = if SUPPORTED_PROTOCOLS.contains(&requested) {
            requested
        } else {
            LATEST_PROTOCOL
        };
        return Ok(json!({
            "protocolVersion": version,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
            "instructions": INSTRUCTIONS,
        }));
    }

    fn call_tool(&mut self, params: &Value) -> Result<Value, RpcError> {
        let Some(tool) = params.get("name").and_then(Value::as_str) else {
            return Err(RpcError {
                code: -32602,
                message: "tools/call needs a tool name".to_string(),
            });
        };
        let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
        let reply = if tool == "get_guide" {
            // The guides ship in the binary, so they work before the app is open
            let topic = arguments.get("topic").and_then(Value::as_str);
            match guides::guide(topic) {
                Ok(text) => ToolReply::text(text),
                Err(message) => ToolReply::error(message),
            }
        } else if tool_definitions()
            .iter()
            .any(|definition| definition["name"] == tool)
        {
            self.bridge.call(self.client.as_deref(), tool, arguments)
        } else {
            return Err(RpcError {
                code: -32602,
                message: format!("Unknown tool: {}", tool),
            });
        };
        return Ok(json!({ "content": reply.content, "isError": reply.is_error }));
    }
}

fn failure(id: Value, code: i32, message: String) -> String {
    return json!({ "jsonrpc": "2.0", "id": id, "error": RpcError { code, message } }).to_string();
}

/// The tools an agent sees. A new studio command needs no new tool: `run_command` reaches it.
pub fn tool_definitions() -> Vec<Value> {
    return vec![
        tool(
            "get_guide",
            "How MidiMarble works, by topic. Read overview first.",
            json!({
                "topic": { "type": "string", "enum": guides::TOPICS, "description": "Defaults to overview" }
            }),
            &[],
        ),
        tool(
            "get_state",
            "The open project in short: layers with each piece's angle and params, marbles with every hit and its dot, physics, wall, lights, hit summary, problems, selection, playhead, theme, parts, decor counts, song, Build Track's progress and result, and the agent folder's path.",
            json!({}),
            &[],
        ),
        tool(
            "list_commands",
            "The studio's commands, the same list as the ⌘K palette, with whether each can run now.",
            json!({ "filter": { "type": "string", "description": "Words to match in id, title or keywords" } }),
            &[],
        ),
        tool(
            "run_command",
            "Runs a studio command by id, or `project.execute` with `args.commands`. Each call is one named Undo step. Answers with the new hit summary and errors in plain words.",
            json!({
                "id": { "type": "string" },
                "args": { "type": "object", "description": "`select` (layer keys) for any command; `path` for commands that open a panel for a person; `commands` and `label` for project.execute; `value` for marble.speed; `wait: false`, `from` (a hit ID: Rebuild From Here) and `gapPiece` (`rail` or `switchback`, tried first across a long gap) for build.track" }
            }),
            &["id"],
        ),
        tool(
            "add_song",
            "Imports a MIDI file or a recording as the project's Song, making a new project when none is open.",
            json!({ "path": { "type": "string", "description": "Absolute path of the file" } }),
            &["path"],
        ),
        tool(
            "set_references",
            "Stores the images and words that set this film's look in the project's agent/references, replacing earlier ones, for every agent that opens the project. See the film-look guide.",
            json!({
                "paths": { "type": "array", "items": { "type": "string" }, "description": "Absolute paths of images" },
                "text": { "type": "string" }
            }),
            &["paths", "text"],
        ),
        tool(
            "preview_frame",
            "One frame of the film as an image, rendered by Blender: draft is small and quick, blender is larger.",
            json!({
                "time": { "type": "number", "description": "Seconds" },
                "quality": { "type": "string", "enum": ["draft", "blender"] }
            }),
            &["time"],
        ),
        tool(
            "play_range",
            "Plays a range in the window for the person watching and returns at once.",
            json!({ "from": { "type": "number" }, "to": { "type": "number" } }),
            &["from", "to"],
        ),
        tool(
            "export_film",
            "Starts a film export and answers with its progress or result. Call it without quality to check on a running export.",
            json!({
                "quality": { "type": "string", "enum": ["draft", "fast", "balanced", "best"] },
                "path": { "type": "string", "description": "Absolute .mp4 path; defaults to the project's renders folder" }
            }),
            &[],
        ),
        tool(
            "add_asset",
            "Adds a .blend with its manifest to the project as a skin or decor, with the same checks as accepting an agent's result. See the assets guide.",
            json!({
                "path": { "type": "string", "description": "A folder with asset.blend and manifest.json, or a .blend file with manifest.json beside it" },
                "role": { "type": "string", "enum": ["skin", "decor"] },
                "name": { "type": "string" },
                "pieceType": { "type": "string", "description": "The piece type a skin fits, such as platform" },
                "pack": { "type": "string", "description": "Name of a new or existing Pack in this project to add it to" }
            }),
            &["path", "role", "name"],
        ),
    ];
}

fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    return json!({
        "name": name,
        "description": description,
        "inputSchema": { "type": "object", "properties": properties, "required": required },
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct StubBridge {
        calls: Vec<(Option<String>, String, Value)>,
    }

    impl ToolBridge for StubBridge {
        fn call(&mut self, client: Option<&str>, tool: &str, arguments: Value) -> ToolReply {
            self.calls
                .push((client.map(str::to_string), tool.to_string(), arguments));
            return ToolReply::text(format!("ran {}", tool));
        }
    }

    fn answer(server: &mut McpServer<StubBridge>, line: &str) -> Value {
        return serde_json::from_str(&server.handle_line(line).unwrap()).unwrap();
    }

    #[test]
    fn initializes_with_the_clients_version_and_short_instructions() {
        let mut server = McpServer::new(StubBridge::default());
        let reply = answer(
            &mut server,
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"claude-code"}}}"#,
        );
        assert_eq!(reply["id"], 1);
        assert_eq!(reply["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(reply["result"]["serverInfo"]["name"], "midimarble");
        assert!(reply["result"]["instructions"].as_str().unwrap().len() < 300);
        assert!(server.is_initialized());
        assert_eq!(server.client_name(), Some("claude-code"));

        let unknown = answer(
            &mut server,
            r#"{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}"#,
        );
        assert_eq!(unknown["result"]["protocolVersion"], LATEST_PROTOCOL);
    }

    #[test]
    fn notifications_get_no_response() {
        let mut server = McpServer::new(StubBridge::default());
        assert!(server
            .handle_line(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#)
            .is_none());
    }

    #[test]
    fn lists_the_agreed_tools() {
        let mut server = McpServer::new(StubBridge::default());
        let reply = answer(&mut server, r#"{"jsonrpc":"2.0","id":3,"method":"tools/list"}"#);
        let names: Vec<&str> = reply["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            [
                "get_guide",
                "get_state",
                "list_commands",
                "run_command",
                "add_song",
                "set_references",
                "preview_frame",
                "play_range",
                "export_film",
                "add_asset"
            ]
        );
    }

    #[test]
    fn forwards_tool_calls_with_the_client_name() {
        let mut server = McpServer::new(StubBridge::default());
        server.handle_line(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"codex"}}}"#,
        );
        let reply = answer(
            &mut server,
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"run_command","arguments":{"id":"build.next"}}}"#,
        );
        assert_eq!(reply["result"]["content"][0]["text"], "ran run_command");
        assert_eq!(reply["result"]["isError"], false);
        let (client, tool, arguments) = &server.bridge.calls[0];
        assert_eq!(client.as_deref(), Some("codex"));
        assert_eq!(tool, "run_command");
        assert_eq!(arguments["id"], "build.next");
    }

    #[test]
    fn answers_guides_without_the_app() {
        let mut server = McpServer::new(StubBridge::default());
        let reply = answer(
            &mut server,
            r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_guide","arguments":{"topic":"assets"}}}"#,
        );
        assert!(reply["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("manifest.json"));
        assert!(server.bridge.calls.is_empty());

        let missing = answer(
            &mut server,
            r#"{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"get_guide","arguments":{"topic":"nope"}}}"#,
        );
        assert_eq!(missing["result"]["isError"], true);
    }

    #[test]
    fn a_client_cant_call_the_presence_line() {
        let mut server = McpServer::new(StubBridge::default());
        let line = format!(
            r#"{{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{{"name":"{}"}}}}"#,
            super::super::socket::PRESENCE_TOOL
        );
        assert_eq!(answer(&mut server, &line)["error"]["code"], -32602);
        assert!(server.bridge.calls.is_empty());
    }

    #[test]
    fn reports_protocol_errors() {
        let mut server = McpServer::new(StubBridge::default());
        assert_eq!(answer(&mut server, "{oops")["error"]["code"], -32700);
        assert_eq!(
            answer(&mut server, r#"{"jsonrpc":"2.0","id":7,"method":"nope"}"#)["error"]["code"],
            -32601
        );
        assert_eq!(
            answer(
                &mut server,
                r#"{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"nope"}}"#
            )["error"]["code"],
            -32602
        );
    }

    #[test]
    fn answers_a_batch_as_an_array() {
        let mut server = McpServer::new(StubBridge::default());
        let reply = answer(
            &mut server,
            r#"[{"jsonrpc":"2.0","id":9,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"}]"#,
        );
        assert_eq!(reply.as_array().unwrap().len(), 1);
    }
}
