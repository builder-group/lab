//! `midimarble mcp`: the app binary as a local stdio MCP server. The stdio process has no window; it answers
//! `get_guide` itself and bridges every other tool over a per-user Unix socket to the running app, whose front end
//! runs the tool on the open project, so each edit shows live in the window with Undo.

pub mod commands;
mod guides;
mod host;
pub mod protocol;
pub mod socket;
pub mod stdio;
mod workspace;

pub use host::{McpClientsEvent, McpRequestEvent, McpState};
pub use workspace::toml_string;
