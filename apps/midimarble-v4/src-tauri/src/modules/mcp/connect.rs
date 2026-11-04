//! Connect in the Agent menu: runs the agent tool's own `mcp add` and `mcp remove`, and reads the tool's config to
//! say whether it points at this binary. Only the tools write their config; this file only reads it.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

const SERVER_NAME: &str = "midimarble";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const SHELL_TIMEOUT: Duration = Duration::from_secs(5);
/// A process a tool left behind can hold its pipes open after the tool exits
const OUTPUT_GRACE: Duration = Duration::from_millis(500);
const FOLDER_SEARCH_DEPTH: usize = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum McpAgentTool {
    Claude,
    Codex,
}

impl McpAgentTool {
    fn executable(self) -> &'static str {
        return match self {
            McpAgentTool::Claude => "claude",
            McpAgentTool::Codex => "codex",
        };
    }

    fn name(self) -> &'static str {
        return match self {
            McpAgentTool::Claude => "Claude Code",
            McpAgentTool::Codex => "Codex",
        };
    }
}

/// What a click did: the tool's command ran, or it wasn't found and its command text was copied instead
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum McpConnectOutcome {
    Done,
    Copied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionsDto {
    pub claude: bool,
    pub codex: bool,
}

pub fn connect(tool: McpAgentTool, home: &Path, binary: &str) -> Result<McpConnectOutcome, String> {
    let Some(program) = locate(tool, home) else {
        return copy_instead(&manual_command(tool, &add_args(tool, &shell_quote(binary))));
    };
    return connect_with(tool, &program, home, binary, COMMAND_TIMEOUT);
}

pub fn disconnect(tool: McpAgentTool, home: &Path) -> Result<McpConnectOutcome, String> {
    let Some(program) = locate(tool, home) else {
        return copy_instead(&manual_command(tool, &remove_args(tool)));
    };
    return disconnect_with(tool, &program, home, COMMAND_TIMEOUT);
}

/// Whether each tool's config lists this binary. A missing or malformed file reads as not connected.
pub fn connections(home: &Path, binary: &str) -> McpConnectionsDto {
    let read = |path: PathBuf| fs::read_to_string(path).unwrap_or_default();
    return McpConnectionsDto {
        claude: is_claude_connected(&read(home.join(".claude.json")), binary),
        codex: is_codex_connected(&read(home.join(".codex/config.toml")), binary),
    };
}

/// The plain server command, for apps with no command of their own
pub fn copy_server_command(binary: &str) -> Result<(), String> {
    return copy_text(&format!("{} mcp", shell_quote(binary)));
}

/// Removes any entry first, so an app that moved is fixed by connecting again; a failed remove means there was none
fn connect_with(tool: McpAgentTool, program: &Path, home: &Path, binary: &str, timeout: Duration) -> Result<McpConnectOutcome, String> {
    let deadline = Instant::now() + timeout;
    let _ = run(program, &remove_args(tool), home, timeout);
    let remaining = deadline.saturating_duration_since(Instant::now());
    return match run(program, &add_args(tool, binary), home, remaining) {
        Ran::Finished { is_success: true, .. } => Ok(McpConnectOutcome::Done),
        Ran::Finished { stdout, stderr, .. } => Err(format!(
            "{} couldn't add MidiMarble{}. Update it and try again, or use Copy Command for Other Apps.",
            tool.name(),
            failure_detail(&stderr, &stdout)
        )),
        Ran::TimedOut => Err(format!("{} didn't answer in time. Try again, or use Copy Command for Other Apps.", tool.name())),
        Ran::NotStarted(error) => Err(format!("{} couldn't start: {}. Try again, or use Copy Command for Other Apps.", tool.name(), error)),
    };
}

fn disconnect_with(tool: McpAgentTool, program: &Path, home: &Path, timeout: Duration) -> Result<McpConnectOutcome, String> {
    return match run(program, &remove_args(tool), home, timeout) {
        Ran::Finished { is_success: true, .. } => Ok(McpConnectOutcome::Done),
        Ran::Finished { stdout, stderr, .. } => Err(format!(
            "{} couldn't remove MidiMarble{}. Remove it with its own settings, or try again.",
            tool.name(),
            failure_detail(&stderr, &stdout)
        )),
        Ran::TimedOut => Err(format!("{} didn't answer in time. Try again.", tool.name())),
        Ran::NotStarted(error) => Err(format!("{} couldn't start: {}. Try again.", tool.name(), error)),
    };
}

fn copy_instead(command: &str) -> Result<McpConnectOutcome, String> {
    copy_text(command)?;
    return Ok(McpConnectOutcome::Copied);
}

fn remove_args(tool: McpAgentTool) -> Vec<String> {
    return match tool {
        McpAgentTool::Claude => strings(&["mcp", "remove", "--scope", "user", SERVER_NAME]),
        McpAgentTool::Codex => strings(&["mcp", "remove", SERVER_NAME]),
    };
}

fn add_args(tool: McpAgentTool, binary: &str) -> Vec<String> {
    return match tool {
        McpAgentTool::Claude => strings(&["mcp", "add", "--scope", "user", SERVER_NAME, "--", binary, "mcp"]),
        McpAgentTool::Codex => strings(&["mcp", "add", SERVER_NAME, "--", binary, "mcp"]),
    };
}

fn strings(items: &[&str]) -> Vec<String> {
    return items.iter().map(|item| item.to_string()).collect();
}

/// The command text a person pastes, with the tool as its plain name
fn manual_command(tool: McpAgentTool, args: &[String]) -> String {
    return format!("{} {}", tool.executable(), args.join(" "));
}

/// Dev build names contain spaces
fn shell_quote(value: &str) -> String {
    let mut quoted = String::from("\"");
    for character in value.chars() {
        if matches!(character, '\\' | '"' | '$' | '`') {
            quoted.push('\\');
        }
        quoted.push(character);
    }
    quoted.push('"');
    return quoted;
}

/// Where a tool's installers put it, in the order to try. A GUI app gets a minimal PATH, so PATH can't find them.
fn candidates(tool: McpAgentTool, home: &Path) -> Vec<PathBuf> {
    let at_home = |path: &str| home.join(path);
    return match tool {
        McpAgentTool::Claude => vec![
            at_home(".local/bin/claude"),
            PathBuf::from("/opt/homebrew/bin/claude"),
            PathBuf::from("/usr/local/bin/claude"),
            at_home(".claude/local/claude"),
            at_home(".npm-global/bin/claude"),
            at_home(".bun/bin/claude"),
        ],
        McpAgentTool::Codex => vec![
            PathBuf::from("/opt/homebrew/bin/codex"),
            PathBuf::from("/usr/local/bin/codex"),
            at_home(".local/bin/codex"),
            at_home(".npm-global/bin/codex"),
            at_home(".bun/bin/codex"),
            PathBuf::from("/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"),
            PathBuf::from("/Applications/Codex.app/Contents/Resources/codex"),
        ],
    };
}

/// Finds a tool without running it, up to the login shell, which is the slow last resort
fn locate_without_shell(tool: McpAgentTool, home: &Path) -> Option<PathBuf> {
    if let Some(found) = first_executable(&candidates(tool, home)) {
        return Some(found);
    }
    return match tool {
        McpAgentTool::Claude => newest_bundled_claude(&home.join("Library/Application Support/Claude/claude-code")),
        McpAgentTool::Codex => None,
    };
}

fn locate(tool: McpAgentTool, home: &Path) -> Option<PathBuf> {
    return locate_without_shell(tool, home).or_else(|| locate_with_login_shell(tool, home));
}

fn first_executable(paths: &[PathBuf]) -> Option<PathBuf> {
    return paths.iter().find(|path| is_executable(path)).cloned();
}

fn is_executable(path: &Path) -> bool {
    return fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false);
}

/// The Claude desktop app's copy: `<root>/<version>/<hash>/claude.app/Contents/MacOS/claude`, newest version first
fn newest_bundled_claude(root: &Path) -> Option<PathBuf> {
    let mut versions: Vec<(Vec<u64>, PathBuf)> = fs::read_dir(root)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let parts = name.to_str()?.split('.').map(|part| part.parse::<u64>().ok()).collect::<Option<Vec<u64>>>()?;
            return Some((parts, entry.path()));
        })
        .collect();
    versions.sort_by(|a, b| b.0.cmp(&a.0));
    return versions
        .iter()
        .find_map(|(_, folder)| find_executable(folder, "claude", FOLDER_SEARCH_DEPTH));
}

fn find_executable(folder: &Path, name: &str, depth: usize) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    for entry in fs::read_dir(folder).ok()?.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            if let Some(found) = find_executable(&path, name, depth - 1) {
                return Some(found);
            }
        } else if entry.file_name() == name && is_executable(&path) {
            return Some(path);
        }
    }
    return None;
}

fn locate_with_login_shell(tool: McpAgentTool, home: &Path) -> Option<PathBuf> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let args = strings(&["-lc", &format!("command -v {}", tool.executable())]);
    let Ran::Finished { stdout, is_success: true, .. } = run(Path::new(&shell), &args, home, SHELL_TIMEOUT) else {
        return None;
    };
    return path_in_shell_output(&stdout).filter(|path| is_executable(path));
}

/// A login shell's profile can print anything first; an alias answers without a path
fn path_in_shell_output(output: &str) -> Option<PathBuf> {
    return output
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with('/'))
        .map(PathBuf::from);
}

/// Scripts among the tools start `node` and the like, which the app's own PATH doesn't reach
fn search_path(program: &Path, home: &Path, inherited: &str) -> String {
    let mut folders: Vec<String> = Vec::new();
    if let Some(parent) = program.parent() {
        folders.push(parent.display().to_string());
    }
    folders.push(home.join(".local/bin").display().to_string());
    folders.push("/opt/homebrew/bin".to_string());
    folders.push("/usr/local/bin".to_string());
    folders.push(home.join(".npm-global/bin").display().to_string());
    folders.push(home.join(".bun/bin").display().to_string());
    if !inherited.is_empty() {
        folders.push(inherited.to_string());
    }
    return folders.join(":");
}

#[derive(Debug)]
enum Ran {
    Finished { is_success: bool, stdout: String, stderr: String },
    TimedOut,
    NotStarted(String),
}

fn run(program: &Path, args: &[String], home: &Path, timeout: Duration) -> Ran {
    let inherited = std::env::var("PATH").unwrap_or_default();
    let spawned = Command::new(program)
        .args(args)
        .current_dir(home)
        .env("PATH", search_path(program, home, &inherited))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(error) => return Ran::NotStarted(error.to_string()),
    };
    let stdout = child.stdout.take().map(read_in_background);
    let stderr = child.stderr.take().map(read_in_background);
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Ran::TimedOut;
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Ran::NotStarted(error.to_string());
            }
        }
    };
    let collect = |output: Option<mpsc::Receiver<String>>| output.and_then(|receiver| receiver.recv_timeout(OUTPUT_GRACE).ok()).unwrap_or_default();
    return Ran::Finished {
        is_success: status.success(),
        stdout: collect(stdout),
        stderr: collect(stderr),
    };
}

fn read_in_background(mut pipe: impl Read + Send + 'static) -> mpsc::Receiver<String> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = pipe.read_to_end(&mut bytes);
        let _ = sender.send(String::from_utf8_lossy(&bytes).into_owned());
    });
    return receiver;
}

/// The tool's own first line, as ": what it said", for a notice
fn failure_detail(stderr: &str, stdout: &str) -> String {
    let line = stderr
        .lines()
        .chain(stdout.lines())
        .map(str::trim)
        .find(|line| !line.is_empty());
    return match line {
        Some(line) => format!(": {}", line.chars().take(160).collect::<String>().trim_end_matches('.')),
        None => String::new(),
    };
}

/// Through `pbcopy`: a command can come from the native menu, where the web view has no user gesture to copy with
fn copy_text(text: &str) -> Result<(), String> {
    let words = "The command couldn't be copied";
    let mut child = Command::new("/usr/bin/pbcopy")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("{}: {}", words, error))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes()).map_err(|error| format!("{}: {}", words, error))?;
    }
    let status = child.wait().map_err(|error| format!("{}: {}", words, error))?;
    if !status.success() {
        return Err(words.to_string());
    }
    return Ok(());
}

fn is_claude_connected(config: &str, binary: &str) -> bool {
    return serde_json::from_str::<Value>(config)
        .ok()
        .and_then(|value| value.pointer("/mcpServers/midimarble/command").and_then(Value::as_str).map(|command| command == binary))
        .unwrap_or(false);
}

fn is_codex_connected(config: &str, binary: &str) -> bool {
    return codex_server_command(config).as_deref() == Some(binary);
}

/// The `command` of `[mcp_servers.midimarble]`. A text scan, as this needs one value and no TOML crate is a dependency;
/// a shape it doesn't read gives None, which reads as not connected, and Connect then writes it in the tool's form.
fn codex_server_command(config: &str) -> Option<String> {
    let mut is_in_section = false;
    for line in config.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            is_in_section = is_codex_server_header(line);
            continue;
        }
        if !is_in_section {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        if key.trim().trim_matches('"') == "command" {
            return toml_string_value(value.trim());
        }
    }
    return None;
}

fn is_codex_server_header(line: &str) -> bool {
    let header: String = line.split('#').next().unwrap_or("").chars().filter(|character| !character.is_whitespace()).collect();
    return header == "[mcp_servers.midimarble]" || header == "[mcp_servers.\"midimarble\"]";
}

fn toml_string_value(value: &str) -> Option<String> {
    if let Some(literal) = value.strip_prefix('\'') {
        return literal.split_once('\'').map(|(text, _)| text.to_string());
    }
    let mut characters = value.strip_prefix('"')?.chars();
    let mut text = String::new();
    while let Some(character) = characters.next() {
        match character {
            '"' => return Some(text),
            '\\' => match characters.next()? {
                '\\' => text.push('\\'),
                '"' => text.push('"'),
                'n' => text.push('\n'),
                't' => text.push('\t'),
                'r' => text.push('\r'),
                'b' => text.push('\u{8}'),
                'f' => text.push('\u{c}'),
                'u' => text.push(toml_unicode(&mut characters, 4)?),
                'U' => text.push(toml_unicode(&mut characters, 8)?),
                _ => return None,
            },
            other => text.push(other),
        }
    }
    return None;
}

fn toml_unicode(characters: &mut std::str::Chars<'_>, length: usize) -> Option<char> {
    let digits: String = characters.by_ref().take(length).collect();
    return char::from_u32(u32::from_str_radix(&digits, 16).ok()?);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    const BINARY: &str = "/Applications/Midi Marble.app/Contents/MacOS/MidiMarble - Development";
    static NEXT_FOLDER: AtomicU32 = AtomicU32::new(0);

    /// A folder standing in for HOME; nothing here reads or writes the real one
    fn temporary_home() -> PathBuf {
        let folder = std::env::temp_dir().join(format!("mm-connect-{}-{}", std::process::id(), NEXT_FOLDER.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&folder).unwrap();
        return folder;
    }

    fn write_executable(path: &Path, contents: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// A stand-in tool that logs its arguments and fails or hangs as a script says
    fn fake_tool(home: &Path, body: &str) -> PathBuf {
        let path = home.join("fake-tool");
        write_executable(&path, &format!("#!/bin/sh\necho \"$*\" >> \"{}/log\"\n{}\n", home.display(), body));
        return path;
    }

    #[test]
    fn builds_each_tools_own_arguments() {
        assert_eq!(remove_args(McpAgentTool::Claude), ["mcp", "remove", "--scope", "user", "midimarble"]);
        assert_eq!(remove_args(McpAgentTool::Codex), ["mcp", "remove", "midimarble"]);
        assert_eq!(add_args(McpAgentTool::Claude, BINARY), ["mcp", "add", "--scope", "user", "midimarble", "--", BINARY, "mcp"]);
        assert_eq!(add_args(McpAgentTool::Codex, BINARY), ["mcp", "add", "midimarble", "--", BINARY, "mcp"]);
    }

    #[test]
    fn writes_the_command_a_person_pastes() {
        assert_eq!(
            manual_command(McpAgentTool::Claude, &add_args(McpAgentTool::Claude, &shell_quote("/A B/mid"))),
            "claude mcp add --scope user midimarble -- \"/A B/mid\" mcp"
        );
        assert_eq!(
            manual_command(McpAgentTool::Codex, &add_args(McpAgentTool::Codex, &shell_quote("/A B/mid"))),
            "codex mcp add midimarble -- \"/A B/mid\" mcp"
        );
        assert_eq!(shell_quote("/a\"b$c`d\\e"), "\"/a\\\"b\\$c\\`d\\\\e\"");
    }

    #[test]
    fn locates_the_first_executable_candidate() {
        let home = temporary_home();
        let plain = home.join("plain");
        fs::write(&plain, "not executable").unwrap();
        let tool = home.join("tool");
        write_executable(&tool, "#!/bin/sh\n");
        let later = home.join("later");
        write_executable(&later, "#!/bin/sh\n");
        let paths = vec![home.join("missing"), plain, home.clone(), tool.clone(), later];
        assert_eq!(first_executable(&paths), Some(tool));
        assert_eq!(first_executable(&[home.join("missing")]), None);
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn tries_home_folders_in_the_given_order() {
        let home = PathBuf::from("/h");
        let claude = candidates(McpAgentTool::Claude, &home);
        assert_eq!(claude[0], PathBuf::from("/h/.local/bin/claude"));
        assert_eq!(claude[1], PathBuf::from("/opt/homebrew/bin/claude"));
        assert_eq!(candidates(McpAgentTool::Codex, &home)[0], PathBuf::from("/opt/homebrew/bin/codex"));
        assert_eq!(candidates(McpAgentTool::Codex, &home)[5], PathBuf::from("/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"));
    }

    #[test]
    fn finds_the_newest_bundled_claude_by_version_not_by_name() {
        let root = temporary_home();
        let older = root.join("2.1.99/aaa/claude.app/Contents/MacOS/claude");
        let newer = root.join("2.1.317/bbb/claude.app/Contents/MacOS/claude");
        write_executable(&older, "#!/bin/sh\n");
        write_executable(&newer, "#!/bin/sh\n");
        fs::write(root.join(".DS_Store"), "").unwrap();
        // The newest folder with nothing runnable in it gives way to the one before
        fs::create_dir_all(root.join("2.1.400/ccc")).unwrap();
        assert_eq!(newest_bundled_claude(&root), Some(newer));
        assert_eq!(newest_bundled_claude(&root.join("missing")), None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn takes_only_a_path_from_a_login_shell() {
        assert_eq!(path_in_shell_output("Welcome back\n/opt/x/claude\n"), Some(PathBuf::from("/opt/x/claude")));
        assert_eq!(path_in_shell_output("alias claude='/opt/x/claude'\n"), None);
        assert_eq!(path_in_shell_output(""), None);
    }

    #[test]
    fn reaches_the_tools_own_folder_first() {
        assert_eq!(
            search_path(Path::new("/tools/bin/claude"), Path::new("/h"), "/usr/bin:/bin"),
            "/tools/bin:/h/.local/bin:/opt/homebrew/bin:/usr/local/bin:/h/.npm-global/bin:/h/.bun/bin:/usr/bin:/bin"
        );
    }

    #[test]
    fn reads_claude_as_connected_only_at_this_binary() {
        let config = format!("{{\"mcpServers\":{{\"midimarble\":{{\"type\":\"stdio\",\"command\":{:?},\"args\":[\"mcp\"]}}}}}}", BINARY);
        assert!(is_claude_connected(&config, BINARY));
        assert!(!is_claude_connected(&config, "/Applications/MidiMarble.app/Contents/MacOS/MidiMarble"));
        assert!(!is_claude_connected("{\"mcpServers\":{\"other\":{\"command\":\"x\"}}}", BINARY));
        assert!(!is_claude_connected("{\"mcpServers\":{\"midimarble\":{\"command\":3}}}", BINARY));
        assert!(!is_claude_connected("{ not json", BINARY));
        assert!(!is_claude_connected("", BINARY));
    }

    #[test]
    fn reads_codex_as_connected_only_at_this_binary() {
        let config = format!("model = \"x\"\n\n[mcp_servers.other]\ncommand = \"/other\"\n\n# a comment\n[mcp_servers.midimarble] # ours\nargs = [\"mcp\"]\ncommand = \"{}\"\n\n[mcp_servers.midimarble.env]\ncommand = \"/not-this\"\n", BINARY);
        assert!(is_codex_connected(&config, BINARY));
        assert!(!is_codex_connected(&config, "/moved/MidiMarble"));
        assert!(is_codex_connected("[mcp_servers.\"midimarble\"]\ncommand = '/a b/mid'\n", "/a b/mid"));
        assert!(is_codex_connected("[mcp_servers.midimarble]\ncommand = \"/a\\\"b/\\u00e9\"\n", "/a\"b/é"));
    }

    #[test]
    fn tolerates_codex_configs_it_cannot_read() {
        // Only another table's command, a comment, and an unfinished, a bad and a missing value
        assert!(!is_codex_connected("[mcp_servers.other]\ncommand = \"/b\"\n", "/b"));
        assert!(!is_codex_connected("# [mcp_servers.midimarble]\ncommand = \"/b\"\n", "/b"));
        assert!(!is_codex_connected("[mcp_servers.midimarble]\ncommand = \"/b", "/b"));
        assert!(!is_codex_connected("[mcp_servers.midimarble]\ncommand = \"/b\\q\"\n", "/b"));
        assert!(!is_codex_connected("[mcp_servers.midimarble]\nargs = [\"mcp\"]\n[other]\ncommand = \"/b\"\n", "/b"));
        assert!(!is_codex_connected("[[[ \u{0}", "/b"));
        assert!(!is_codex_connected("", ""));
    }

    #[test]
    fn missing_files_read_as_not_connected() {
        let home = temporary_home();
        assert_eq!(connections(&home, BINARY), McpConnectionsDto::default());
        fs::write(home.join(".claude.json"), format!("{{\"mcpServers\":{{\"midimarble\":{{\"command\":{:?}}}}}}}", BINARY)).unwrap();
        assert_eq!(connections(&home, BINARY), McpConnectionsDto { claude: true, codex: false });
        fs::create_dir_all(home.join(".codex")).unwrap();
        fs::write(home.join(".codex/config.toml"), vec![0xff, 0xfe]).unwrap();
        assert_eq!(connections(&home, BINARY), McpConnectionsDto { claude: true, codex: false });
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn connecting_removes_first_and_ignores_a_failed_remove() {
        let home = temporary_home();
        let tool = fake_tool(&home, "case \"$2\" in remove) echo 'no such server' >&2; exit 1;; esac");
        let outcome = connect_with(McpAgentTool::Codex, &tool, &home, BINARY, Duration::from_secs(10));
        assert_eq!(outcome, Ok(McpConnectOutcome::Done));
        assert_eq!(fs::read_to_string(home.join("log")).unwrap(), format!("mcp remove midimarble\nmcp add midimarble -- {} mcp\n", BINARY));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn says_in_plain_words_when_the_add_fails() {
        let home = temporary_home();
        let tool = fake_tool(&home, "case \"$2\" in add) echo 'unknown option --scope.' >&2; exit 1;; esac");
        let error = connect_with(McpAgentTool::Claude, &tool, &home, BINARY, Duration::from_secs(10)).unwrap_err();
        assert_eq!(error, "Claude Code couldn't add MidiMarble: unknown option --scope. Update it and try again, or use Copy Command for Other Apps.");
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn gives_up_on_a_tool_that_hangs() {
        let home = temporary_home();
        let tool = fake_tool(&home, "exec sleep 30");
        let started = Instant::now();
        let error = connect_with(McpAgentTool::Claude, &tool, &home, BINARY, Duration::from_millis(200)).unwrap_err();
        assert!(error.contains("didn't answer"));
        assert!(started.elapsed() < Duration::from_secs(5));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn disconnecting_runs_the_remove_alone() {
        let home = temporary_home();
        let tool = fake_tool(&home, "exit 0");
        assert_eq!(disconnect_with(McpAgentTool::Claude, &tool, &home, Duration::from_secs(10)), Ok(McpConnectOutcome::Done));
        assert_eq!(fs::read_to_string(home.join("log")).unwrap(), "mcp remove --scope user midimarble\n");

        let failing = fake_tool(&home, "exit 3");
        assert!(disconnect_with(McpAgentTool::Codex, &failing, &home, Duration::from_secs(10)).unwrap_err().contains("couldn't remove"));
        fs::remove_dir_all(home).unwrap();
    }

    /// Not a check: prints what this machine resolves to, with `--ignored --nocapture`. Reads paths only.
    #[test]
    #[ignore]
    fn prints_what_this_machine_locates() {
        let home = PathBuf::from(std::env::var("HOME").unwrap());
        println!("claude: {:?}", locate(McpAgentTool::Claude, &home));
        println!("codex: {:?}", locate(McpAgentTool::Codex, &home));
    }
}
