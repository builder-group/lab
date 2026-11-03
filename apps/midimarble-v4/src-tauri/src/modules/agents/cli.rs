use serde::{Deserialize, Serialize};
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

/// Tools the Claude Code agent may use. Web, MCP and sub-agent tools stay unavailable.
const CLAUDE_TOOLS: &str = "Bash,Read,Write,Edit,Glob,Grep,TodoWrite";

/// Commands allowed without the sandbox, as the fallback when the Bash sandbox is unavailable
const CLAUDE_ALLOWED_BASH: [&str; 8] = [
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

const SYSTEM_RULES: &str = "You build one MidiMarble asset candidate. Read BRIEF.md in the current folder first and follow its output contract. Work only inside the current folder. Never read or write files outside it, including scene.blend and project.json of the surrounding project. Run Blender only headless with --background.";

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

pub fn find(cli: AgentCli) -> Option<PathBuf> {
    return search_dirs()
        .into_iter()
        .map(|dir| dir.join(cli.binary()))
        .find(|path| path.is_file());
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

/// Non-interactive command for one run. The prompt is written to stdin so it is never parsed as flags.
pub fn build_command(cli: AgentCli, binary: &Path, cwd: &Path) -> Command {
    let mut command = Command::new(binary);
    command.current_dir(cwd);
    match cli {
        AgentCli::Claude => {
            command
                .arg("-p")
                .args(["--output-format", "stream-json", "--verbose"])
                .args(["--permission-mode", "acceptEdits"])
                .args(["--tools", CLAUDE_TOOLS])
                .args(["--allowedTools", &CLAUDE_ALLOWED_BASH.join(",")])
                // User settings may carry hooks, plugins or broad allow rules; only the candidate folder's own settings apply
                .args(["--setting-sources", "project"])
                .arg("--strict-mcp-config")
                .args(["--settings", CLAUDE_SETTINGS])
                .args(["--append-system-prompt", SYSTEM_RULES]);
        }
        AgentCli::Codex => {
            command
                .arg("exec")
                .arg("--json")
                .args(["--sandbox", "workspace-write"])
                .arg("--skip-git-repo-check")
                .arg("--cd")
                .arg(cwd)
                .arg("-");
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

#[cfg(test)]
mod tests {
    use super::*;

    fn args(command: &Command) -> Vec<String> {
        return command
            .get_args()
            .map(|value| value.to_string_lossy().to_string())
            .collect();
    }

    #[test]
    fn builds_a_confined_claude_command() {
        let command = build_command(
            AgentCli::Claude,
            Path::new("/bin/claude"),
            Path::new("/tmp/c"),
        );
        let args = args(&command);
        assert_eq!(command.get_current_dir(), Some(Path::new("/tmp/c")));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--permission-mode", "acceptEdits"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--output-format", "stream-json"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--setting-sources", "project"]));
        assert!(args.contains(&"--strict-mcp-config".to_string()));
        assert!(!args.iter().any(|arg| arg.contains("dangerously")));
        let settings: serde_json::Value = serde_json::from_str(CLAUDE_SETTINGS).unwrap();
        assert_eq!(settings["sandbox"]["enabled"], true);
        assert_eq!(settings["sandbox"]["allowUnsandboxedCommands"], false);
    }

    #[test]
    fn builds_a_sandboxed_codex_command() {
        let command = build_command(
            AgentCli::Codex,
            Path::new("/bin/codex"),
            Path::new("/tmp/c"),
        );
        let args = args(&command);
        assert_eq!(args[0], "exec");
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "workspace-write"]));
        assert_eq!(args.last().map(String::as_str), Some("-"));
    }
}
