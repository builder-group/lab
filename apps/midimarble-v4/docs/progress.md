# Progress

The autonomous build updates this log after every slice. Newest entries go first.

## Current state

- Milestone: M1 Music lanes
- Next step: MIDI import with lane proposals
- Blockers: none
- Not committed on purpose: `pnpm-lock.yaml` (also holds unrelated local changes) and the lab `.claude/launch.json`

## Log

### M0 Foundation

- Scaffolded from the community `desktop-tauri` template, kept the Liquid Glass window crate, removed the greet demo
- Project schema `marble-project@1` with Zod and `versjon`, entity components, commands with undo and redo
- Rust `package` module: create, open and save `.marble` packages with atomic writes, recent projects, `.marble` exported as a package type
- Host layer with a localStorage fallback so the UI development surface runs in a browser
- Studio shell: Xcode-style start screen, unified toolbar with Compose and Design, sidebar, peg-dot canvas, project inspector, timeline overview, playback clock and standard shortcuts
- Checks: `typecheck`, `lint` and `test` (7) pass; `cargo test` (3) passes, including reopening a moved package; browser check of new project flow
- Deferred: native menu bar commands, ⌘K palette and open-panel behavior for registered packages in the bundled app

### Planning

- Wrote ux.md, design-language.md, architecture.md, milestones.md and references.md
- No code yet
