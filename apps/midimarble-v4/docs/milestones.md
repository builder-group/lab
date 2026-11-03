# Milestones

Each milestone ends with checks that a person or an agent can run. A milestone is done only when its checks pass and the results are reported. Later milestones may refine earlier ones but must keep their checks passing.

Development works against the project's own fixtures and playgrounds. Each fixture isolates one behavior so failures point at a cause. Performance tests run beside the hit checks and track simulation, reflow and Blender handoff times. The reference short is a final validation in M6, not a development target. When it falls short, the gaps become new fixtures and the work iterates on those.

## Fixtures

Example projects live in `fixtures/` and grow with the milestones. Each one states its expected hits.

| Fixture       | Content                                                      | From |
| ------------- | ------------------------------------------------------------ | ---- |
| `staircase`   | One marble, eight evenly spaced hits built with Repeat       | M2   |
| `zigzag`      | One marble, sixteen hits built with Mirror and Continue      | M3   |
| `long-gap`    | Hits with a 1.5 second gap bridged by a rail and a tunnel    | M3   |
| `windmill`    | A windmill hit between platforms                             | M3   |
| `two-marbles` | Two lanes in one world with one intended marble collision    | M3   |
| `jingle-bells`| The opening phrase, compared with the earlier attempts       | M4   |
| `reference-20`| The first 20 seconds of the reference short structure       | M6   |
| `loop`        | A short run whose last frame flows into its first            | M6   |

## M0 Foundation

Scaffold from the `desktop-tauri` template, project schema with `versjon`, commands with undo and redo, and `.marble` package read and write in the host.

Done when:

- The app starts, creates a project and reopens it from a moved package
- Schema, migration and command tests pass
- `pnpm --filter @lab/midimarble-v4 typecheck`, `lint` and `test` pass

## M1 Music lanes

MIDI import with lane proposals, audio import with waveform and suggested hits, tap-along, click editing, per-lane instruments and playback.

Done when:

- A MIDI file splits into lanes that respect one note per marble and the 180 ms gap, with conflicts shown
- An audio file shows its waveform and suggested hits, and tap-along records hits within 30 ms of the taps
- MIDI lanes play through the chosen instrument; audio projects play the recording alone

## M2 Compose core

Pegboard view, marble release, one shared Rapier world, trajectory ahead of the playhead, hit dots, platform placement and rotation, reflow with snapshots and pins.

Done when:

- `staircase` builds through the UI and every hit lands within 20 ms
- Rotating an early platform reflows later platforms, keeps their tweaks and leaves pinned pieces in place
- Re-simulation after a rotation updates the trajectory within 50 ms for `staircase` and within 250 ms for a 60 second, four marble project
- Headless simulation of a fixture matches the UI result exactly

## M3 Assists and pieces

Repeat, Mirror, Auto place and Continue, plus rail, tunnel and windmill with their parameters and guardrails.

Done when:

- `zigzag`, `long-gap`, `windmill` and `two-marbles` pass their hit checks
- Continue offers ghost pieces when the rhythm repeats and Tab accepts them
- Long gaps and out-of-frame dots show their guardrails

## M4 Blender handoff

Bundled worker, managed collection, holders and skins, motion files, keyframes, hit values, the default pegboard theme, playhead preview and silhouettes in Compose.

Done when:

- A headless check builds every fixture in Blender and every contact frame matches its hit time within one frame at 60 fps
- The windmill plays back with its recorded rotation
- Rotating a platform in Compose rotates its skin in Blender while a manual skin offset survives
- `jingle-bells` renders a preview clip without manual Blender edits

## M5 Design

Object selection on the preview, library with themes and project items, agent candidates with review, reactions, wall text and decals, link and unlink with relink and push to Compose.

Done when:

- An agent turns a selected platform into a requested object, the preview renders, and accepting it applies it to every platform of that type
- A reaction animates from hit values without changing motion
- Wall text placed by clicking appears at that point in Blender
- Moving a holder in Blender is detected as unlinked, and relink and push to Compose both work
- A reference theme with brass bars, chrome brackets, a glass marble, a grey wall and a soft sun exists as a library theme

## M6 Camera, render and loops

Camera rig with rail, target and shot markers, take over, export presets, loop mode and the loop check.

Done when:

- `reference-20` renders at the Best preset with a travelling camera and slow roll, and a side-by-side review against the reference shows comparable structure and polish
- `jingle-bells` renders as a full film and is compared with the earlier attempts
- `loop` passes the loop check and plays seamlessly when repeated
- A take-over camera survives a Compose edit, and the app asks before regenerating it
