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

The first set is platform, rail, tunnel and windmill. A tunnel is a physical tube in the world like a rail. Its length and slope set the travel time, and Blender hides the marble inside it while playing back the recorded keyframes.

## Simulation

All marbles share one Rapier world. The simulation module exposes pure operations over a project document:

- `simulate` runs the world ahead of the playhead and returns samples, contacts and hit errors
- Snapshots are taken at each placed piece, so an edit re-simulates from the earliest affected snapshot
- `place` builds a piece for a hit dot. The contact surface is placed where the marble is at the hit time, offset by the marble radius along the surface normal. Timing is therefore correct by construction for the placed hit, and only its angle changes the future.
- `repeat`, `mirror`, `autoPlace` and `continue` produce piece edits as commands

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
| `render`         | Render the film with a preset, cancellable with progress                    |
| `inspect`        | Report link states, detached objects and Blender-owned changes              |
| `preview_asset`  | Render a candidate asset in isolation                                       |
| `accept_asset`   | Copy an accepted candidate into the project library                         |
| `export_silhouette` | Write a simplified untextured mesh of a skin for the Compose view        |
| `save`, `shutdown` | Save `scene.blend` and close cleanly                                      |

Motion moves as a binary file rather than JSON. The app writes sampled positions and rotations as Float32 arrays into `.cache/motion/`, and the worker reads them with NumPy and writes F-curves with `foreach_set`. Keyframes are written at the render frame rate. Hit values become an animated custom property per piece.

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
