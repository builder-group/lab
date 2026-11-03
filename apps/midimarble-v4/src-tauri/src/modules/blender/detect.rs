use std::path::PathBuf;
use std::process::Command;

const BLENDER_ENV: &str = "MIDIMARBLE_BLENDER";
const APP_EXECUTABLE: &str = "Blender.app/Contents/MacOS/Blender";

/// Blender executable from `MIDIMARBLE_BLENDER`, `/Applications` or `~/Applications`
pub fn blender_path() -> Option<PathBuf> {
    if let Some(value) = std::env::var_os(BLENDER_ENV) {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    let mut candidates = vec![PathBuf::from("/Applications").join(APP_EXECUTABLE)];
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join("Applications").join(APP_EXECUTABLE));
    }
    return candidates.into_iter().find(|path| path.is_file());
}

/// First line of `blender --version`, such as `Blender 5.4.0 Alpha`
pub fn blender_version(path: &PathBuf) -> Option<String> {
    let output = Command::new(path)
        .args(["--background", "--factory-startup", "--version"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    return text
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("Blender "))
        .map(str::to_string);
}
