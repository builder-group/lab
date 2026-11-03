# Architecture

This document describes how MidiMarble v4 is built. The product behavior is in [ux.md](ux.md) and the target films are in [references.md](references.md). Earlier prototypes in `apps/.local/midimarble-desktop`, `apps/.local/midimarble-blender`, `apps/midimarble` and `apps/_deprecated/midimarble` are references, not sources of truth.

## Stack

- **Host:** Tauri 2 on macOS, started from the community `desktop-tauri` template. The Rust host owns files, packages and processes: Blender, FFmpeg and the agent CLIs.
- **UI:** React, TanStack Router and Tailwind, structured by the community [React project structure](https://github.com/builder-group/community/blob/develop/docs/conventions/project-structure-react.md). The Rust side follows the [Rust project structure](https://github.com/builder-group/community/blob/develop/docs/conventions/project-structure-rust.md).
- **State:** `feature-state` atoms and `Cx` owners following the lab rules
- **Compose view:** Three.js
- **Physics:** Rapier's deterministic WASM build (`@dimforge/rapier3d-deterministic-compat`) in a Web Worker. The same simulation module runs headless in Node for tests and fixtures.
- **Documents:** JSON validated with Zod and versioned with [`versjon`](https://www.npmjs.com/package/versjon), so the format can change through migrations
- **Blender:** a bundled Python worker started as a dedicated Blender process. The app never installs a Blender add-on or changes Blender preferences.

Tauri suits the job: the host needs process control and file packages, and Blender does the final rendering, so a bundled Chromium would add weight without benefit.

## Units and time

Distances are metres and angles are radians, matching Blender. Marbles default to 16 mm. Time is seconds on one shared timeline. Physics runs at a fixed 240 Hz; render frame rates are derived from it at export.

## Data model

The project document is component based. An entity is a stable ID with a set of typed components. Behavior lives in plain modules that read components, the way systems do in an ECS; there is no ECS runtime framework.

Components:

| Component   | Data                                                              |
| ----------- | ----------------------------------------------------------------- |
| `marble`    | Radius, color, lane ID                                            |
| `release`   | Wall position and timeline time                                   |
| `piece`     | Piece type and its physical parameters                            |
| `transform` | Wall position and angle                                           |
| `hitLink`   | Lane and hit ID, offset and angle relative to the trajectory, pin |
| `skin`      | Asset ID and link state                                           |
| `reaction`  | Reaction preset and parameters                                    |
| `wallText`  | Text, font, size, depth and wall position                         |

A platform is an entity with `piece`, `hitLink` and `skin`. A decoration is an entity with `transform` and `skin`. New features add components rather than new entity classes.

Music is stored beside the entities:

- **Sources:** imported MIDI and audio files, referenced by package-relative path
- **Lanes:** one per marble, with an instrument for MIDI playback and a list of hits. A hit has a stable ID, time, optional pitch and velocity.

Design-only state, such as camera rig settings, shot markers, theme, render preset and loop flag, sits in a `design` section. Detailed Blender edits stay in `scene.blend`.

Edits are commands applied to an immutable document with undo and redo. Each command batch increments a revision so asynchronous work can detect intervening edits. Content fingerprints separate music, track and design so a design change never invalidates motion.

## Pieces

Each piece type is one definition in a registry:

- Physics shape built from its parameters
- Parameter schema with defaults and limits
- Placement rule that puts its contact surface at a trajectory point
- Default skin per theme
- Optional dynamic behavior, such as the windmill hinge with damping or motor

The first set is platform, rail, tunnel and windmill:

- **Platform:** a box whose top face is the contact surface
- **Rail:** a smoothed path built from thin rounded segments in the marble plane. The two-wire look is visual only.
- **Tunnel:** a rail floor with a ceiling that starts shortly after the entry. Blender hides the marble inside it.
- **Windmill:** a hub that turns only around the wall normal, with angular damping or a constant-speed motor. Its angle is recorded every step and becomes rotation keyframes in Blender.

Rails and tunnels are anchored to the trajectory a short delay after the hit before a gap and follow upstream edits like platforms. The next platform is placed where the marble actually is, so hits stay on time whatever the rail does. Gap suggestions search entry, orientation, slope and length and report honestly whether the result stays in frame.

## Simulation

All marbles share one Rapier world. The simulation module exposes pure operations over a project document:

- `simulate` runs the world ahead of the playhead and returns samples, contacts and hit errors
- Snapshots are taken at each placed piece, so an edit re-simulates from the earliest affected snapshot
- `place` builds a piece for a hit dot. The contact surface is placed where the marble is at the hit time, offset by the marble radius along the surface normal. Timing is therefore correct by construction for the placed hit, and only its angle changes the future.
- `repeatPiece`, `mirrorPiece`, `autoPlace`, `continueSuggestions`, `findLongGaps` and the gap helpers produce piece edits. They need a simulate function, so the UI calls them through the simulation worker.

Pegboard snapping applies to angles and to the bracket mount. The contact surface stays on the trajectory, so snapping never moves a hit off its time.

Contacts record actual time, entity, marble and impulse. A hit is valid when its marble touches its linked piece once within 20 ms of the hit time. Unexpected contacts, including marble collisions, are reported separately.

## Blender bridge

The Rust host starts one Blender process per open project with the bundled worker. Requests and responses use the file mailbox proven in the desktop prototype:

- The host writes `{id, op, args}` to `.bridge/host-inbox/`
- The worker writes `{id, ok, result | error}` and progress files to `.bridge/outbox/`
- Agent tools write to a separate `.bridge/inbox/` that accepts only inspection and candidate previews

Operations:

| Operation        | Purpose                                                                     |
| ---------------- | --------------------------------------------------------------------------- |
| `apply_scene`    | Create or update holders, skins and keyframes from a scene description      |
| `preview_frame`  | Render an Eevee frame and an object ID pass at a time                       |
| `preview_clip`   | Render a short low-resolution clip                                          |
| `render_film`    | Start a film render with a preset in a separate Blender process             |
| `cancel`         | Cancel a film render job                                                    |
| `inspect`        | Report link states, detached objects and Blender-owned changes              |
| `preview_asset`  | Render a candidate asset in isolation                                       |
| `accept_asset`   | Copy an accepted candidate into the project library                         |
| `export_silhouette` | Write a simplified untextured mesh of a skin for the Compose view        |
| `save`, `shutdown` | Save `scene.blend` and close cleanly                                      |

Motion moves as a binary file rather than JSON. The app writes sampled positions and rotations as Float32 arrays into `.cache/motion/`, and the worker reads them with NumPy and writes F-curves with `foreach_set`. Keyframes are written at the render frame rate. Hit values become an animated custom property per piece.

### Themes, reactions and camera

- `TSceneDescription.theme` selects a procedural theme in `blender/mm_worker/themes.py`: `pegboard` (flat toy colors, pegboard wall, wooden pegs) and `brass` (the reference look: lavender plaster wall, brushed brass bars on bent chrome brackets with round wall bases, chrome two-wire rails, satin tunnels, brass windmills, a glass marble with a swirl core in the lane color, one soft low sun from the upper left, a studio environment for metal reflections, AgX). Themes are data; materials are shared and created once, so Blender edits to them survive.
- Default skins are built per theme and piece type (`skins.py`). A skin root carries a fingerprint of what the app built; the app rebuilds only unedited default skins of linked holders when the theme or parameters change. Edited skins, custom skins and objects outside the MidiMarble collections are never touched. Studio objects (wall, sun, world) are re-themed only while they hold what the app last wrote.
- Reactions: a platform's bar is a child part whose drivers read the holder's `mm_hit`: it presses along its normal and tilts a few degrees around the bracket, springing back as `mm_hit` decays. An optional emission flash uses the `mm_flash` object property. Reactions never touch holders or their keyframes. `TSceneDescription.reactions` overrides the theme values.
- Camera: with `TSceneDescription.camera` (from `design.camera`) the worker bakes a follow camera in `camera.py`. Follow point: the weighted centre of the marbles in flight. Target: moved up to `lead` seconds ahead, smoothed with a zero-phase critically damped filter (time constant `0.04 + 0.5 * smoothing` s) and pulled along where a fast fall would leave the frame. The camera stands `distance` away at `pitch` from the wall normal, up the run; its azimuth follows the run's direction slowly, which rolls the columns between diagonal and vertical. Shots set distance and extra roll with eased transitions and appear as `MM · <kind>` timeline markers. Several marbles widen the distance so all stay in frame. Lens 85 mm by default (`camera.lens`): the reference's perspective changes only about 13 % across the frame, which a long lens at a modest pitch reproduces (`distance` 1.0 and `pitch` 0.45 match the reference framing). Keyframes are baked on the studio camera, so Blender plays it without add-ons. A camera edited in Blender is taken over: `apply_scene` reports `camera: 'takenOver'` and regenerates only with `regenerateCamera`. `mode: 'manual'` leaves the camera alone.

### Film render

`render_film {preset, engine?, outputPath, audioPath?, samples?, jobId?}` saves a copy of the live scene to `renders/.jobs/<jobId>/scene.blend`, starts a background Blender on it with `blender/render_job.py` and answers with the job right away, so the live worker stays responsive. Presets: Fast 720p 30 fps, Balanced 1080p 30 fps, Best 1080p 60 fps, by the short side (portrait 9:16 gives 1080x1920). Output frame i shows time i / fps, independent of the keyframe rate. The job writes progress to `.bridge/outbox/<jobId>.progress.json`, renders PNG frames, muxes them with the soundtrack WAV into an MP4 (H.264, AAC) with FFmpeg (or with Blender's own FFmpeg through the sequencer when no binary is found) and writes the response envelope to `.bridge/outbox/<jobId>.json`. The host reads both with `blender_job_poll`. `cancel {jobId}` sets a cancel flag the job checks between frames and stops the process after a grace period. The job also stops when the app exits, and the live worker reports jobs that end without an answer. `renderFilm` in `src/modules/blender/render-film.ts` writes `renders/soundtrack.wav` from `renderProjectAudio` and follows the job.

Scene structure in Blender:

- `MidiMarble · managed` holds app-owned holder empties with locked transforms
- Each holder parents its skin, so Compose transforms move the skin and Blender offsets stay local
- `MidiMarble · detached` receives skins of deleted pieces
- Everything else belongs to the user

## Agents

The host runs the local Claude Code CLI or Codex CLI in non-interactive mode with the working directory set to `candidates/<id>/` inside the package. It writes a brief into that folder: the request, target entity, piece parameters, contact surface, hit times, reaction slots, scale and the asset manifest format. The agent may run Blender headless to build the candidate and calls the restricted bridge tools to inspect the scene and render previews. Output streams into the Design tab. The host, not the agent, accepts assets.

## Package

```txt
Song.marble/
├── project.json   # versjon `marble-project@<n>`
├── scene.blend
├── audio/         # imported sources
├── assets/        # project library items
├── candidates/    # agent work awaiting review
├── renders/       # previews and exports
├── .cache/        # motion, waveforms, silhouettes; regenerable
└── .bridge/       # runtime mailbox
```

The package is registered as a macOS document package so Finder shows it as one file. Every stored path is package-relative. The global library lives in the app's support folder with the same item layout and is registered as a Blender asset library for the dedicated process.

Library item:

```txt
<item-id>/
├── manifest.json  # versjon `marble-asset@<n>`: role, piece type, parameters, contact surface, reactions
├── asset.blend    # textures packed
├── thumbnail.png
└── silhouette.glb
```

## Code layout

```txt
apps/midimarble-v4/
├── src/
│   ├── routes/
│   ├── environment/        # configs, generated host bindings
│   └── modules/
│       ├── project/        # schema, commands, history, fingerprints
│       ├── music/          # MIDI and audio import, onsets, waveform, lanes, sampler
│       ├── pieces/         # piece registry
│       ├── simulation/     # Rapier world, worker, placement, assists
│       ├── compose/        # pegboard view, step loop, timeline
│       ├── design/         # preview, selection, library, agent panel
│       ├── blender/        # bridge client, scene description, motion files
│       └── export/
├── src-tauri/src/
│   ├── app/
│   ├── environment/
│   └── modules/            # package, blender, agents, media, tools, library
├── blender/                # bundled Python worker
├── fixtures/               # example projects
└── docs/
```

## Testing

- **Unit:** Vitest for schema, migrations, commands, history, lane assignment and piece parameters
- **Fixtures:** example projects simulated headless in Node. Each fixture states its expected hits and fails when any hit misses 20 ms.
- **Blender:** headless checks build a scene from a fixture, read the keyframes back, compare contact frames with hit times and render a frame
- **UI:** the UI development surface runs in a browser with a mocked host. The built-in browser and computer use are allowed for milestone checks of this app, including the native window and Blender.
- **Reference films:** rendered at milestone ends and compared side by side with the references
