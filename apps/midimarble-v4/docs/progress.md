# Progress

The autonomous build updates this log after every slice. Newest entries go first.

## Current state

- Milestone: M2 Compose core
- Next step: Rapier simulation module with headless fixture runs
- Blockers: none
- Planned after the Compose canvas: a UI pass that follows Figma UI3 and Premiere Pro more closely (floating canvas tool bar, Figma-style inspector sections, Premiere-style track headers and playhead), reviewed with fresh eyes against screenshots of those apps
- Not committed on purpose: `pnpm-lock.yaml` (also holds unrelated local changes) and the lab `.claude/launch.json`

## Log

### M2 Compose, M4 bridge, Design viewer (in progress)

- Simulation engine (subagent): placement by construction, snapshots for incremental reflow, contacts, blocked detection, shared world. Staircase reflow 8–30 ms; 60 s with 4 marbles and 396 platforms: full 183–228 ms, incremental 103–163 ms
- Compose canvas (subagent): Three.js over the peg-dot grid, trajectories, hit dots, step loop (click, Return, R, M, P, rotate grip, Shift 5° snap), floating tool bar, piece inspector with scrubbable fields. Live rotation 23–35 ms. Staircase built through the UI with all 8 hits on time
- Blender bridge (subagent): background worker with mailbox, `apply_scene`, `preview_frame` with object ID pass, `inspect`, link states, detached collection. Headless check 50/50; marble keyframes match physics within 8e-9 m; 540 px Eevee preview about 0.45 s
- Design viewer: starts the worker, syncs the scene, renders the playhead, picks objects through the ID image, Edit in Blender
- UI pass notes so far: 6 cm platforms nearly invisible at fit-all zoom; selecting does not move the playhead so later pieces stay ghosted; default 15° tilt can leave the frame band
- Not yet verified: the Design tab in the native app (needs a bundled build), GUI Blender

### M1 Music lanes

- MIDI import with a review sheet: track choice, split chords across marbles or keep the top note, marble count, live preview and left-out notes
- Lane proposal keeps the melody on the first marble, leads voices by nearest pitch and respects the 180 ms gap
- Audio import copies the file into the package, shows a waveform behind the lanes and suggests hits from spectral-flux onsets
- Editable timeline: zoom with pinch or Command-scroll, ruler seek, double-click to add, drag to move, marquee and Shift selection, Delete, arrow keys between hits, T to tap along
- Lane and hit inspectors: name, color, instrument, suggested hits, time and note name
- Audio engine (subagent): trimmed GeneralUser GS bank (3.8 MB, 13 pitched instruments) rendered with SpessaSynth; recordings play alone without synthesized lanes; WAV encoding for the film soundtrack
- Drag and drop of MIDI and audio files, start screen shortcuts From MIDI and From Audio
- Checks: `typecheck`, `lint`, `test` (35) and `cargo test` (4) pass. Browser check: Jingle Bells MIDI imports as 2 marbles with 34 hits, playback clock matched wall time within 10 ms over 2 s, a generated WAV with 11 strikes yielded 11 suggested hits
- Not yet verified: audio in the native WebKit window and tap-along latency against a real recording

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
