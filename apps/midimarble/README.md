# MidiMarble

A local-first browser studio for building musical marble-run films with React, Three.js, Rapier, and sampled General MIDI audio. Music, objects, materials, camera animation, and lighting stay editable in an ordinary project document.

## Run

From the repository root:

```sh
pnpm install
pnpm --filter @repo/midimarble start:dev
```

Open `http://localhost:3003`. The project screen offers an empty project, native file opening, recent projects, and three small examples. Use **Projects** to return to it from the editor.

- **First light**: eight notes and one glass marble in an eight-second music-box scene
- **Counterpoint**: two marble voices answering one another in a twelve-second shared frame
- **Rolling rhythm**: seven mallet notes and a curved rail interlude in an 8.5-second run, showing how world objects and linked instruments work together

The included melodies and procedural scenes were authored for this project. They use no downloaded video, extracted soundtrack, or third-party 3D models.

## Projects and saving

The browser keeps multiple projects in an IndexedDB library, keyed by project ID. Recent projects show their names and edit times. Autosave updates the current working project; creating or opening an example creates a separate editable project. The latest working project can be restored on the next visit. A localStorage recovery copy supports older installations and storage failures. Corrupt recovery data is reported and retained until a later save.

Archive hides a project from Recent projects without deleting its document. Expand Archived to restore it. When browser storage is unavailable, the editor remains usable and shows a download reminder. Switching away from an unsaved project offers a backup before continuing.

Download important projects as `.marble` files. Browser storage belongs to this browser profile and can be cleared. Saving commits the active field before creating the download. A persistent **Download project** link lets you retry if an automatic download is blocked.

A native `.marble` file is UTF-8 JSON: a flat project document with `format: "midimarble"` and `version: 1`. It contains notes, track instruments and musical expression, marble launches, object model IDs and transforms, materials, camera keys, lighting keys, and titles. Built-in procedural models are referenced by ID. Physics bakes, undo history, selection, and local panel preferences remain outside the file. Older untagged version-1 project files still open through the same validator. Foreign formats, unsupported versions, malformed documents, and files over 20 MB are rejected with an explanation.

No project data or media is uploaded to an external service.

## Build a run

1. Create a project, open an example, or import a `.mid` file. Open a track's piano roll to audition, draw, trim, transpose, duplicate, and change note velocity. Track instruments control MIDI audio independently of object shape.
2. Use the floating **+** toolbar to browse procedural objects. New objects keep a world position. Select a note and choose **Choose an object for this note** to fit an instrument to its trajectory.
3. Link an object to a MIDI note, anchor it to a trajectory time, or keep it in world space. **Unlink & keep position** freezes its resolved pose. Upstream edits rebuild linked placements in note order.
4. Edit transforms, model variants, materials, friction, glow, flex, and rail control points in Properties. Lock protects an object from edits; disabling removes its collision geometry. Notes determine musical audio, while physical collisions determine visible impact reactions.
5. Choose portrait, landscape, or square framing. Author camera keys in World or Follow run space, and animate lighting in the timeline. Preview and export use the saved camera and lighting settings.
6. Download the project or export a film with sound.

New projects and the examples use a fixed wall at world `Z = 0` through `scene.wallPosition`. Moving objects keeps that plane in place. Projects without this field fit the wall behind their objects; wall clearance applies to that automatic fit. The Wall studio lighting preset uses soft shadows and a neutral wall.

The outliner owns selection and organization; Properties edits the selection. Layout, Animation, and Render workspaces change the editing view. Panel sizes persist locally. Middle-button orbit, Shift + middle-button pan, wheel zoom, F to frame selection, and Home to frame all navigate the viewport. G/R/S start cancellable object transforms. F3 or Cmd/Ctrl + K opens command search; Help lists shortcuts. Cmd/Ctrl + S downloads the current native project.

Layout shows selectable wireframe helpers for the film camera and the studio key light. Toggle them with the viewport's lightbulb button. Click a helper or its outliner row to select it; double-click the row or press F to frame it. Unkeyed camera and light rigs support Move and G, including axis constraints, numeric input, Escape to cancel, and a single undo. Edit their aim, lens, and lighting values in Properties. Once a rig has animation keys, edit those keys through Properties and the timeline. Helpers are excluded from camera view and exports. Editing-view navigation does not move the film lighting rig. Render keeps the camera preview fixed; explicit framing or navigation commands return to Layout.

## Playback and export

Physics runs at 240 Hz in a worker. Seeking samples deterministic physical results instead of reversing the simulation. The compiler reuses unchanged inputs and recent bakes, reports missed contacts and interference, and rebuilds when physical inputs change. Music, material, lighting, and camera edits reuse the physical bake when they leave motion unchanged.

The first playback loads the locally served GeneralUser GS sound bank (approximately 31 MB). MIDI notes control pitched instruments; a separate measured contact layer adds rolling and surface sounds. Track mute and solo affect playback and film audio. MIDI download preserves the complete arrangement. Sound bank attribution and its license are in `public/audio/`.

Film export uses WebCodecs and Mediabunny to create WebM with VP9 or VP8 video and Opus audio. The completed film remains in a preview panel with an explicit download button. Escape cancels an active export. Codec support depends on the browser; use a current Chromium browser when an embedded browser or Safari cannot encode. Production requires HTTPS. Still-frame export uses the chosen resolution and aspect ratio.

The current limits are 120 seconds, 2,000 notes, 600 objects, and nine interacting marbles per project. Arbitrary model import, recorded-song synchronization, and cloud storage are outside the current scope.

## Developer CLI

The Bun-based CLI reads the same native files as the editor. It does not start a server or modify its input.

```sh
cd apps/midimarble
pnpm studio inspect public/examples/first-light.marble
pnpm studio simulate public/examples/first-light.marble --at 1,3,6 --out /tmp/marble-report.json
pnpm studio compose public/examples/first-light.marble --track melody --out /tmp/marble-draft.marble
```

All commands print JSON. Inspect validates and describes the project. Simulate reports resolved objects, physical contacts, note timing errors, rail support, bounds, and warnings; `--at` adds marble and camera snapshots. Inspect and simulate can save their report with `--out`.

Compose creates a new close-wall run from one selected monophonic track. Inputs must be at most 20 seconds, with non-overlapping notes. Supply `--track` when several tracks contain music. Only the selected track is copied. The result is written only after physical verification passes. Composition output refuses existing files; report commands refuse to overwrite the input, including through a file link. Invalid files, options, and failed verification exit with status 1 and an error on stderr.

A small contact timing error establishes timing alignment, not visual equivalence to another film. Inspect, edit a separate copy, simulate, and review the resulting composition in the editor.

## Generating examples

From `apps/midimarble`, run:

```sh
pnpm generate:examples
```

The generator requires Bun. The scene definitions in `src/modules/project/example-projects.ts` are the authoring source. It physically verifies those scenes and writes resolved, editable `public/examples/*.marble` files. Gallery thumbnails are still frames exported from those projects. The browser opens those files and compiles them through the generic worker pipeline.

## Validation

```sh
pnpm --filter @repo/midimarble typecheck
pnpm --filter @repo/midimarble lint
pnpm --filter @repo/midimarble test
pnpm --filter @repo/midimarble build
```

Tests cover native file validation and roundtrips, project editing and undo, the current examples, MIDI and audio, deterministic physics, linked and world placements, rails, and camera behavior. Document regressions use small synthetic fixtures. UI-specific browser checks require explicit authorization under the repository agent guide.

## Vercel

Import the Lab repository and configure:

- Root Directory: `apps/midimarble`
- Framework Preset: TanStack Start (also declared in `vercel.json`)
- Node.js Version: 24.x
- Environment variable: `ENABLE_EXPERIMENTAL_COREPACK=1`, so Vercel uses the repository's pinned pnpm version
- Install Command, Build Command, and Output Directory: leave their overrides disabled
- Keep access to files outside the Root Directory enabled, so the build can read the workspace configuration and lockfile

Nitro detects Vercel and emits the Build Output API under `.vercel/output/`, including static assets, workers, the SPA shell, and a Node.js fallback handler. Do not override the output directory with `.output/public` for this deployment mode. Physics, audio synthesis, project storage, and film rendering run in the browser. No database, application secrets, or server-side rendering service needs configuration.

To verify Vercel's build target locally, without uploading a deployment:

```sh
cd apps/midimarble
NITRO_PRESET=vercel pnpm build
```

Vercel supplies HTTPS, which browser audio and WebCodecs require in production. Use a preview deployment to check MIDI playback and video encoding on the target browser before assigning a production domain. Browser project libraries belong to their exact origin: projects saved on localhost or a preview URL do not automatically appear on the production domain. Transfer them with `.marble` files.

Setup references: [Vercel's TanStack Start guide](https://vercel.com/docs/frameworks/full-stack/tanstack-start) and [Vercel's Corepack configuration](https://vercel.com/docs/builds/configure-a-build#corepack).

## Other static hosts

The build creates a static SPA in `.output/public`. Serve that complete directory, including `assets/`, `audio/`, and the current `examples/`. No backend is required. The application currently has one route, `/`.

```sh
pnpm --filter @repo/midimarble build
python3 -m http.server 3004 --directory apps/midimarble/.output/public
```

## Licensing and release contents

Application code, authored examples, and procedural models use the repository's AGPL-3.0-or-later license. The root `LICENSE` contains the full license. Help links to the public source repository.

The approximately 31 MB SoundFont is a deliberate runtime asset. Its author permits redistribution with software; keep `public/audio/GENERALUSER-LICENSE.txt` and `ATTRIBUTION.txt` with it. The audio directory also contains licenses for the synthesis worker and its bundled dependencies. Vite generates `third-party-licenses.md` for the main application bundle at build time.

Commit source, tests, the pnpm lockfile and workspace configuration, and the built-in example and audio assets. Build output, local environment files, dependencies, and `.vercel` project linkage are ignored. Historical recreation files, extracted MIDI, downloaded media, and private research are outside this release.

## Module map

- `routes/`: application entry point and browser-only editor boundary
- `modules/project/`: document validation, native files, browser library, examples, composition helpers, and undo history
- `modules/motion/`: linked placement solver, Rapier simulation, and worker compilation
- `modules/scene/`: procedural models, materials, wall and lighting, interactions, and time-derived cameras
- `modules/music/`: MIDI import/export, musical scheduling, and sampled audio workers
- `modules/editor/`: project screen, session persistence, outliner, inspector, piano roll, timeline, and transport
- `modules/export/`: frame and audio encoding and downloadable films
- `tools/`: local inspection, simulation, and composition commands
