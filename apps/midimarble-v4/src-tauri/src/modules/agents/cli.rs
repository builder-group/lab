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
