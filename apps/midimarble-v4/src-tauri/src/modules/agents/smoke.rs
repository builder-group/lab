//! End-to-end run of the installed agent CLI. Run through `pnpm exec tsx scripts/agent-smoke.ts`, which builds the brief from the
//! zigzag fixture and sets `MM_SMOKE_PACKAGE` and `MM_SMOKE_BRIEF`.

use super::brief;
use super::cli::{self, AgentCli};
use super::runner::{self, AgentEventKind, AgentRunRecord, AgentRunStatus, AgentState};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[test]
#[ignore = "runs the installed agent CLI; use scripts/agent-smoke.ts"]
fn agent_smoke() {
    let package = PathBuf::from(std::env::var("MM_SMOKE_PACKAGE").expect("MM_SMOKE_PACKAGE"));
    let brief_json =
        fs::read_to_string(std::env::var("MM_SMOKE_BRIEF").expect("MM_SMOKE_BRIEF")).unwrap();
    let prompt = std::env::var("MM_SMOKE_PROMPT").expect("MM_SMOKE_PROMPT");
    let cli = match std::env::var("MM_SMOKE_CLI").as_deref() {
        Ok("codex") => AgentCli::Codex,
        _ => AgentCli::Claude,
    };
    let binary = cli::find(cli).expect("agent CLI not found");
    let root = package.parent().unwrap().to_path_buf();
    let run_id = format!("smoke-{}", runner::now() as u64);
    let before = files_under(&root);

    let dir = brief::write_candidate(&package, &run_id, &brief_json, None).unwrap();
    let record = AgentRunRecord {
        run_id: run_id.clone(),
        cli,
        prompt,
        status: AgentRunStatus::Running,
        review: None,
        started_at: runner::now(),
        finished_at: None,
        exit_code: None,
        error: None,
        outside_changes: Vec::new(),
    };
    let (sender, receiver) = mpsc::channel();
    let state = AgentState::default();
    let began = Instant::now();
    state
        .spawn(
            &package,
            &dir,
            record,
            cli::build_command(cli, &binary, &dir),
            move |event| {
                let _ = sender.send(event);
            },
        )
        .unwrap();

    let mut finished: Option<AgentRunRecord> = None;
    while finished.is_none() {
        let remaining = TIMEOUT.saturating_sub(began.elapsed());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            let _ = state.cancel(&run_id);
            panic!("the run did not finish within {} s", TIMEOUT.as_secs());
        };
        let short: String = event.payload.chars().take(220).collect();
        println!("[{:?}] {}", event.kind, short);
        if event.kind == AgentEventKind::Exit {
            finished = serde_json::from_str(&event.payload).ok();
        }
    }
    let record = finished.unwrap();
    println!("SMOKE elapsed_s={:.1}", began.elapsed().as_secs_f64());
    println!("SMOKE record={}", serde_json::to_string(&record).unwrap());
    println!("SMOKE candidate={}", dir.display());

    let after = files_under(&root);
    let candidate_prefix = dir.strip_prefix(&root).unwrap().display().to_string();
    let outside: Vec<&String> = after
        .difference(&before)
        .filter(|path| !path.starts_with(&candidate_prefix))
        .collect();
    let candidate_files: Vec<&String> = after
        .iter()
        .filter(|path| path.starts_with(&candidate_prefix))
        .collect();
    println!("SMOKE candidate_files={:?}", candidate_files);
    println!("SMOKE new_files_outside_candidate={:?}", outside);

    assert_eq!(
        record.status,
        AgentRunStatus::Succeeded,
        "{:?}",
        record.error
    );
    for name in [
        runner::ASSET_FILE,
        runner::MANIFEST_FILE,
        runner::PREVIEW_FILE,
    ] {
        assert!(dir.join(name).is_file(), "{} is missing", name);
    }
    assert!(
        outside.is_empty(),
        "files appeared outside the candidate folder"
    );
    assert!(
        record.outside_changes.is_empty(),
        "package files changed: {:?}",
        record.outside_changes
    );
}

fn files_under(root: &Path) -> BTreeSet<String> {
    let mut files = BTreeSet::new();
    walk(root, root, &mut files);
    return files;
}

fn walk(root: &Path, path: &Path, files: &mut BTreeSet<String>) {
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_dir() {
            walk(root, &path, files);
        } else {
            files.insert(path.strip_prefix(root).unwrap().display().to_string());
        }
    }
}
