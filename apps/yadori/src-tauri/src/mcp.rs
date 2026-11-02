//! Packaged stdio server. Agents may read projects and submit proposals; only the UI writes project state.
use crate::{agents, project};
use serde_json::{json, Value};
use std::{
    io::{BufRead, Read, Write},
    path::{Path, PathBuf},
};

pub fn run(args: &[String]) -> Result<(), String> {
    let root = args
        .windows(2)
        .find(|p| p[0] == "--data-root")
        .map(|p| PathBuf::from(&p[1]))
        .ok_or("--mcp requires --data-root PATH")?;
    let project_id = args
        .windows(2)
        .find(|p| p[0] == "--project")
        .map(|p| p[1].clone());
    if let Some(id) = &project_id {
        project::identifier(id)?;
    }
    let stdin = std::io::stdin();
    let mut reader = stdin.lock();
    let stdout = std::io::stdout();
    let mut writer = stdout.lock();
    loop {
        let mut line = String::new();
        let count = reader
            .by_ref()
            .take(4 * 1024 * 1024 + 1)
            .read_line(&mut line)
            .map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        if count > 4 * 1024 * 1024 {
            return Err("MCP request too large".into());
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => {
                writeln!(writer,"{}",json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Invalid JSON"}})).map_err(|e|e.to_string())?;
                writer.flush().map_err(|e| e.to_string())?;
                continue;
            }
        };
        let Some(id) = request.get("id") else {
            continue;
        };
        let result = handle(&root, project_id.as_deref(), &request);
        let response = match result {
            Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
            Err(error) => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32602,"message":error}}),
        };
        writeln!(writer, "{response}").map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn handle(root: &Path, bound_project: Option<&str>, request: &Value) -> Result<Value, String> {
    match request["method"].as_str().unwrap_or("") {
        "initialize" => Ok(
            json!({"protocolVersion":"2025-03-26","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"yadori","version":"0.2.0"},"instructions":"Read project state; submit scoped proposals. Proposals require user approval in Yadori. Never write project files directly. All command validation happens in the app."}),
        ),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(
            json!({"tools":[{"name":"read_library","description":"Read the bundled library part definitions and artwork metadata. Does not access arbitrary files.","inputSchema":{"type":"object","properties":{},"additionalProperties":false},"annotations":{"readOnlyHint":true}}, {"name":"import_library_asset","description":"Materialize known bundled artwork inside managed project storage. Returns asset metadata for an asset.add proposal; does not modify project JSON.","inputSchema":{"type":"object","required":["assetId"],"properties":{"projectId":{"type":"string"},"assetId":{"type":"string"}},"additionalProperties":false},"annotations":{"readOnlyHint":false,"destructiveHint":false,"openWorldHint":false}}, {"name":"read_project","description":"Read the current project with identity/revision. Supply projectId unless this server is bound to one project.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"}},"additionalProperties":false},"annotations":{"readOnlyHint":true}}, {"name":"command_contract","description":"Get the typed command contract and safe usage guidance.","inputSchema":{"type":"object","properties":{},"additionalProperties":false},"annotations":{"readOnlyHint":true}}, {"name":"propose_commands","description":"Submit reviewable project commands at a base revision. Does not apply edits. Stale revisions are rejected.","inputSchema":{"type":"object","required":["baseRevision","summary","commands"],"properties":{"projectId":{"type":"string"},"baseRevision":{"type":"integer","minimum":0},"summary":{"type":"string"},"commands":{"type":"array","items":{"type":"object","required":["type"],"properties":{"type":{"type":"string"}},"additionalProperties":true},"maxItems":1000}},"additionalProperties":false},"annotations":{"readOnlyHint":false,"destructiveHint":false,"idempotentHint":false,"openWorldHint":false}}]}),
        ),
        "tools/call" => {
            let params = &request["params"];
            let args = &params["arguments"];
            let name = params["name"].as_str().ok_or("Tool name missing")?;
            let result = (|| {
                if name == "read_library" {
                    return Ok(
                        json!({"catalog":serde_json::from_str::<Value>(crate::library_data::CATALOG).map_err(|_|"Invalid bundled catalog")?,"assets":serde_json::from_str::<Value>(crate::library_data::ASSETS).map_err(|_|"Invalid bundled assets")?}),
                    );
                }
                if name == "command_contract" {
                    return Ok(serde_json::from_str::<Value>(include_str!(
                        "command-contract.json"
                    ))
                    .map_err(|_| "Command contract unavailable")?);
                }
                let id = args["projectId"]
                    .as_str()
                    .or(bound_project)
                    .ok_or("projectId required")?;
                if bound_project.is_some_and(|bound| bound != id) {
                    return Err("Server is bound to another project".into());
                }
                match name {
                    "import_library_asset" => {
                        let asset_id = args["assetId"].as_str().ok_or("assetId required")?;
                        project::import_library_asset(root, id, asset_id)
                    }
                    "read_project" => {
                        let file = project::read_project(root, id)?;
                        serde_json::from_str(&file.content)
                            .map_err(|_| "Invalid project JSON".into())
                    }
                    "propose_commands" => {
                        let revision = args["baseRevision"]
                            .as_u64()
                            .ok_or("baseRevision required")?;
                        let proposal = agents::store_proposal(
                            root,
                            id,
                            revision,
                            json!({"summary":args["summary"],"commands":args["commands"]}),
                        )?;
                        serde_json::to_value(proposal).map_err(|e| e.to_string())
                    }
                    _ => Err("Unknown tool".into()),
                }
            })();
            match result {
                Ok(value) => Ok(
                    json!({"content":[{"type":"text","text":serde_json::to_string_pretty(&value).map_err(|e|e.to_string())?}]}),
                ),
                Err(error) => Ok(json!({"isError":true,"content":[{"type":"text","text":error}]})),
            }
        }
        _ => Err("Unsupported MCP method".into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn should_advertise_proposals_without_direct_write() {
        let value = handle(Path::new("/unused"), None, &json!({"method":"tools/list"})).unwrap();
        let tools = value["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 5);
        assert!(!tools.iter().any(|t| t["name"] == "save_project"));
    }
    #[test]
    fn should_reject_cross_project_access() {
        let value=handle(Path::new("/unused"),Some("first"),&json!({"method":"tools/call","params":{"name":"read_project","arguments":{"projectId":"second"}}})).unwrap();
        assert_eq!(value["isError"], true);
    }
}
