use crate::modules::mcp::toml_string;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Supported agent CLIs
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AgentCli {
    Claude,
    Codex,
}

impl AgentCli {
    pub const ALL: [AgentCli; 2] = [AgentCli::Claude, AgentCli::Codex];

    pub fn binary(self) -> &'static str {
        return match self {
            AgentCli::Claude => "claude",
            AgentCli::Codex => "codex",
        };
    }
}

/// Folders searched after `PATH`. Apps launched from Finder get a minimal `PATH` without them.
const EXTRA_BIN_DIRS: [&str; 3] = ["~/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"];

/// Built-in tools the Claude Code agent may use, on top of the app's own. Web and sub-agent tools stay unavailable.
const CLAUDE_TOOLS: &str = "Bash,Read,Write,Edit,Glob,Grep,TodoWrite";

/// Commands allowed without the sandbox, as the fallback when the Bash sandbox is unavailable
const CLAUDE_ALLOWED: [&str; 9] = [
    // The app's own tools; a run has no person to ask
    "mcp__midimarble",
    "Bash(/Applications/Blender.app/Contents/MacOS/Blender:*)",
    "Bash(\"/Applications/Blender.app/Contents/MacOS/Blender\":*)",
    "Bash(ls:*)",
    "Bash(cat:*)",
    "Bash(head:*)",
    "Bash(tail:*)",
    "Bash(file:*)",
    "Bash(wc:*)",
];

/// Settings layered over the agent's session: Bash runs in Claude Code's sandbox, which limits writes to the
/// working directory, and commands cannot ask to leave it
const CLAUDE_SETTINGS: &str = r#"{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true,"allowUnsandboxedCommands":false},"permissions":{"deny":["WebFetch","WebSearch"]}}"#;

/// The chat's standing instructions: the same tools as any external agent, and how to work with the person watching
pub const CHAT_RULES: &str = "You work in the person's open MidiMarble app through the midimarble tools, in Compose and in Film alike. Start with get_guide and get_state, and read AGENTS.md and references/ in this folder. Work in small steps. Every edit is one named Undo step and shows live in the window, so the person can step in. If a tool says they are busy, wait a moment and try again; don't undo their edits. A message lists what is selected, with ids that work in args.select and in project.execute; rebuild from a hit with run_command('build.track', { from: hitId }). Tools answer when they are done, and get_state shows a running build, so don't wait with sleep or background commands. Run Blender only headless with --background. End by saying what you changed in a sentence or two, in the app's words (get_guide words).";

/// The per-message line on making an asset: a Result the person reviews, or items added directly
pub fn result_note(run_id: &str) -> String {
    return format!(
        "If this asks for a new skin, decor or theme, build it in scratch/result-{}/, following BRIEF.md there, and the person reviews it with Accept and Discard; don't call add_asset for it. For several items, or when they say to just add it, use add_asset and the assets guide. Otherwise ignore that folder.",
        run_id
    );
}

pub fn search_dirs() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    for dir in EXTRA_BIN_DIRS {
        let path = match (dir.strip_prefix("~/"), &home) {
            (Some(rest), Some(home)) => home.join(rest),
            (Some(_), None) => continue,
            (None, _) => PathBuf::from(dir),
        };
        if !dirs.contains(&path) {
            dirs.push(path);
        }
    }
    return dirs;
}

/// The newest installation when several exist, because an outdated CLI can fail where a current one works
pub fn find(cli: AgentCli) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for path in search_dirs().into_iter().map(|dir| dir.join(cli.binary())) {
        if !path.is_file() {
            continue;
        }
        let resolved = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        let duplicate = candidates
            .iter()
            .any(|known| std::fs::canonicalize(known).unwrap_or_else(|_| known.clone()) == resolved);
        if !duplicate {
            candidates.push(path);
        }
    }
    if candidates.len() <= 1 {
        return candidates.into_iter().next();
    }
    return candidates
        .into_iter()
        .map(|path| {
            let parsed = version(&path).map(|text| parse_version(&text)).unwrap_or_default();
            return (parsed, path);
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, path)| path);
}

/// Numeric parts of the first version-like word, such as `2.1.311` in `2.1.311 (Claude Code)`
fn parse_version(text: &str) -> Vec<u64> {
    return text
        .split_whitespace()
        .find(|word| word.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(|word| {
            word.split(|c: char| !c.is_ascii_digit())
                .filter(|part| !part.is_empty())
                .filter_map(|part| part.parse().ok())
                .collect()
        })
        .unwrap_or_default();
}

pub fn version(path: &Path) -> Option<String> {
    let output = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    return text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string);
}

/// Non-interactive command for one chat message, in the project's `agent/` folder with `midimarble mcp` as its only MCP
/// server. The prompt is written to stdin so it is never parsed as flags. `resume` continues that session.
pub fn build_chat_command(
    cli: AgentCli,
    binary: &Path,
    agent_folder: &Path,
    app_binary: &Path,
    resume: Option<&str>,
) -> Command {
    let mut command = Command::new(binary);
    command.current_dir(agent_folder);
    let app = app_binary.display().to_string();
    match cli {
        AgentCli::Claude => {
            let servers = json!({ "mcpServers": { "midimarble": { "command": app, "args": ["mcp"] } } });
            command
                .arg("-p")
                .args(["--output-format", "stream-json", "--verbose", "--include-partial-messages"])
                .args(["--permission-mode", "acceptEdits"])
                .args(["--tools", CLAUDE_TOOLS])
                .args(["--allowedTools", &CLAUDE_ALLOWED.join(",")])
                // User settings may carry hooks, plugins or broad allow rules; only this folder's own settings apply
                .args(["--setting-sources", "project"])
                .arg("--strict-mcp-config")
                .args(["--mcp-config", &servers.to_string()])
                .args(["--settings", CLAUDE_SETTINGS])
                .args(["--append-system-prompt", CHAT_RULES]);
            if let Some(session) = resume {
                command.args(["--resume", session]);
            }
        }
        AgentCli::Codex => {
            command
                .arg("exec")
                .arg("--json")
                .args(["--sandbox", "workspace-write"])
                .arg("--skip-git-repo-check")
                .arg("--cd")
                .arg(agent_folder)
                .args(["-c", &format!("mcp_servers.midimarble.command={}", toml_string(&app))])
                .args(["-c", "mcp_servers.midimarble.args=[\"mcp\"]"]);
            if let Some(session) = resume {
                command.args(["resume", session]);
            }
            command.arg("-");
        }
    }
    let path = std::env::join_paths(search_dirs()).unwrap_or_default();
    command.env("PATH", path);
    // A nested Claude Code session would inherit the host session's markers and credentials routing
    for (key, _) in std::env::vars_os() {
        let name = key.to_string_lossy();
        if name == "CLAUDECODE" || name.starts_with("CLAUDE_CODE_") {
            command.env_remove(&key);
        }
    }
    return command;
}

/// What the CLI reads on stdin. Codex has no flag for standing instructions, so a new session starts with them.
pub fn chat_input(cli: AgentCli, prompt: &str, is_resuming: bool) -> String {
    if cli == AgentCli::Codex && !is_resuming {
        return format!("{}\n\n{}", CHAT_RULES, prompt);
    }
    return prompt.to_string();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(command: &Command) -> Vec<String> {
        return command
            .get_args()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
    }

    fn has(args: &[String], pair: [&str; 2]) -> bool {
        return args.windows(2).any(|window| window == pair);
    }

    #[test]
    fn builds_a_confined_claude_chat_with_the_apps_tools() {
        let command = build_chat_command(
            AgentCli::Claude,
            Path::new("/bin/claude"),
            Path::new("/p/agent"),
            Path::new("/Apps/Mid \"Marble\"/MidiMarble"),
            None,
        );
        let args = args(&command);
        assert_eq!(command.get_current_dir(), Some(Path::new("/p/agent")));
        assert!(has(&args, ["--permission-mode", "acceptEdits"]));
        assert!(has(&args, ["--output-format", "stream-json"]));
        assert!(has(&args, ["--setting-sources", "project"]));
        assert!(args.contains(&"--include-partial-messages".to_string()));
        assert!(args.contains(&"--strict-mcp-config".to_string()));
        assert!(!args.contains(&"--resume".to_string()));
        assert!(!args.iter().any(|arg| arg.contains("dangerously")));
        let at = args.iter().position(|arg| arg == "--mcp-config").unwrap();
        let servers: serde_json::Value = serde_json::from_str(&args[at + 1]).unwrap();
        assert_eq!(servers["mcpServers"]["midimarble"]["command"], "/Apps/Mid \"Marble\"/MidiMarble");
        assert_eq!(servers["mcpServers"]["midimarble"]["args"][0], "mcp");
        let at = args.iter().position(|arg| arg == "--allowedTools").unwrap();
        assert!(args[at + 1].split(',').any(|tool| tool == "mcp__midimarble"));
        let settings: serde_json::Value = serde_json::from_str(CLAUDE_SETTINGS).unwrap();
        assert_eq!(settings["sandbox"]["enabled"], true);
        assert_eq!(settings["sandbox"]["allowUnsandboxedCommands"], false);
    }

    #[test]
    fn resumes_a_claude_session() {
        let command = build_chat_command(AgentCli::Claude, Path::new("/bin/claude"), Path::new("/p/agent"), Path::new("/app"), Some("abc"));
        assert!(has(&args(&command), ["--resume", "abc"]));
    }

    #[test]
    fn builds_a_sandboxed_codex_chat_and_resumes_it() {
        let command = build_chat_command(AgentCli::Codex, Path::new("/bin/codex"), Path::new("/p/agent"), Path::new("/app"), None);
        let new = args(&command);
        assert_eq!(new[0], "exec");
        assert!(has(&new, ["--sandbox", "workspace-write"]));
        assert!(has(&new, ["-c", "mcp_servers.midimarble.command=\"/app\""]));
        assert!(has(&new, ["-c", "mcp_servers.midimarble.args=[\"mcp\"]"]));
        assert_eq!(new.last().map(String::as_str), Some("-"));
        assert!(!new.contains(&"resume".to_string()));

        let command = build_chat_command(AgentCli::Codex, Path::new("/bin/codex"), Path::new("/p/agent"), Path::new("/app"), Some("t-1"));
        let resumed = args(&command);
        assert_eq!(resumed[resumed.len() - 3..], ["resume", "t-1", "-"]);
    }

    #[test]
    fn only_a_new_codex_session_reads_the_rules_on_stdin() {
        assert!(chat_input(AgentCli::Codex, "hi", false).starts_with(CHAT_RULES));
        assert_eq!(chat_input(AgentCli::Codex, "hi", true), "hi");
        assert_eq!(chat_input(AgentCli::Claude, "hi", false), "hi");
    }
}

#[cfg(test)]
mod version_tests {
    use super::parse_version;

    #[test]
    fn orders_cli_versions_numerically() {
        assert!(parse_version("2.1.311 (Claude Code)") > parse_version("2.0.76 (Claude Code)"));
        assert!(parse_version("codex-cli 0.9.0") < parse_version("codex-cli 0.10.1"));
        assert_eq!(parse_version("no version"), Vec::<u64>::new());
    }
}
