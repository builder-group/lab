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

Distances are metres and angles are radians, matching Blender. New projects use a kit 1.5 times the Marble Race Kit (`KIT_SCALE` in `simulation/pieces.ts`): 24 mm marbles (`DEFAULT_MARBLE_RADIUS`), 9 cm × 1.2 cm × 4.5 cm platforms and every other piece default scaled alike, with the camera at 0.85 m, which reads at the reference film's size. Saved projects keep their explicit parameters and marble radius. Time is seconds on one shared timeline. Physics runs at a fixed 240 Hz; render frame rates are derived from it at export.

## Data model

The project document is component based. An entity is a stable ID with a set of typed components. Behavior lives in plain modules that read components, the way systems do in an ECS; there is no ECS runtime framework.

Components:

| Component   | Data                                                              |
| ----------- | ----------------------------------------------------------------- |
| `marble`    | Radius, color, lane ID                                            |
| `release`   | Wall position and timeline time                                   |
| `piece`     | Piece type and its physical parameters                            |
| `transform` | Wall position and angle                                           |
| `hitLink`   | Lane and hit ID, angle, contact position, pin; `anchored` and `offset` for anchors |
| `skin`      | Asset ID and link state                                           |
| `reaction`  | Reaction preset and parameters                                    |
| `wallText`  | Text, font, size, depth and wall position                         |

A platform is an entity with `piece`, `hitLink` and `skin`. A decoration is an entity with `transform` and `skin`. New features add components rather than new entity classes.

A piece is in one of three states, and `simulation/attach.ts` converts between them while keeping its world pose (each helper returns `{entity, commands}` with one `upsertEntity` command):

- **Free:** a `transform` and no `hitLink`. Environment the marbles may strike.
- **Anchored:** a `hitLink` with `anchored: true` (scenery types are always anchored). The piece enters the run at the hit time plus its `entryDelay` (up to `ANCHOR_DELAY`, 10 s); with an `offset` it keeps that pose relative to the marble at that moment, else it touches the marble like a linked piece. It never sounds the hit. `anchorPiece(project, result, entityId, laneId, time)` anchors to the latest hit of the lane at or before `time`; `unanchorPiece` frees it in place.
- **Linked:** a music piece (`definition.musical`, platforms only) with a plain `hitLink`; it sounds that hit and is placed by construction. `linkPieceToHit(project, result, entityId, laneId, hitId)` keeps the angle and takes `contactAt` from where the dot falls along the bar, so the bar only moves as far as it must to touch the marble; it refuses scenery and a hit another piece already sounds. `unlinkPiece` frees it in place and opens the hit.

`soundsHit(type, hitLink)` decides which pieces own hits. A free rail or switchback's transform is its local origin or entry point, so `freePose` converts a resolved pose to a transform by a layout at the world origin.

Physics settings sit in `physics`: `gravityScale` (0.05 to 2) scales Earth's gravity everywhere, in the Rapier world, the ballistic sub-step extrapolation, the pace formula, the assists' speed thresholds and loop entry. Speeds at a fixed rhythm scale linearly with gravity, so `IMPACT_SPEED`, `MIN_ARRIVAL` and `FAST_ARRIVAL` scale with it and the launch takeoff with its square root. New projects use 0.5 (`DEFAULT_GRAVITY_SCALE`); the `marble-project@3` migration sets 1 for older projects, so they play exactly as before. The `setPhysics` command changes it.

Schema `marble-project@3` (migration from `@2`): adds `physics`, and turns scenery that `@2` linked to a hit (windmills, rails, tunnels and switchbacks at or before their hit) into anchors on the lane's previous hit with the delay that keeps their moment, so the hit they used becomes open. Scenery already after its hit keeps its link, which now anchors it.

Schema `marble-project@4` (migration from `@3`): adds `music.backing`, the notes no marble plays, and an optional `duration` on every hit, the note's MIDI length. Migrated projects start with an empty Backing, since older imports dropped those notes. `design.themeOptions` (`{ colorByNote? }`, all optional) needs no migration. Neither does `design.themes`, the optional list of project themes (below).

Music is stored beside the entities:

- **Sources:** imported MIDI and audio files, referenced by package-relative path
- **Lanes:** one per marble, with an instrument for MIDI playback and a list of hits. A hit has a stable ID, time, optional pitch, velocity and duration.
- **Backing:** `music.backing`, hits of the same shape that no marble plays, and `music.backingInstrument`, the General MIDI program they play with (absent means piano). Every note sits in exactly one lane or in Backing; hit IDs are unique across both. Hit commands address Backing with the lane ID `BACKING_ID` (`'backing'`), and so do hit selection keys (`hit:backing:<id>`). `assignHits {hitIds, laneId}` moves hits to a lane or to Backing keeping their IDs. `assignNotesCommands(project, result, hitIds, laneId)` in `music/assign-notes.ts` wraps it: a platform linked to a hit that leaves its lane becomes Free at its resolved pose (`freePose`), and an anchored piece is re-anchored to the lane's nearest remaining hit (`anchorHit`) with the `entryDelay` that keeps its moment, else freed. The simulation reads only lanes; Backing never has hit results.
- **Sound:** `renderLanes(lanes, {backing})` synthesizes marble lanes as short strikes and Backing on the next free channel with each note's duration (up to 4 s, cut before the next note of the same pitch). `renderProjectAudio` and the audio signature include Backing, so playback and the exported film soundtrack carry it; a recording still plays alone.

Design-only state, such as camera rig settings, shot markers, theme, render preset and loop flag, sits in a `design` section. Detailed Blender edits stay in `scene.blend`.

**Project themes:** `design.themes` (optional, so `marble-project@4` files without it stay valid) holds themes the project made: `{id, name, base, overrides, origin?}`. `base` is a built-in theme id; `overrides` holds the few designer-facing colours as `#rrggbb` display sRGB (`wallColor`, `lightColor`, `glowColor`, `backgroundColor`), absent ones keeping the base's look; `origin: 'agent'` marks one a New Theme Result made. `design.theme` names a built-in id or a project theme's id. `design/project-themes.ts` resolves it (`resolveTheme`, `baseThemeOf`, `sceneThemeOverrides`) and owns the theme edits (Duplicate Theme, rename, delete with fallback to the base, overrides, agent themes); each is one `setDesign` batch, so undo works like any edit. Skins, reactions, title colours and the render look follow the base.

Edits are commands applied to an immutable document with undo and redo. Each command batch increments a revision so asynchronous work can detect intervening edits. Content fingerprints separate music, track and design so a design change never invalidates motion.

## Pieces

Each piece type is one definition in a registry:

- Physics shape built from its parameters
- Parameter schema with defaults and limits
- Placement rule that puts its contact surface at a trajectory point
- Default skin per theme
- Optional dynamic behavior, such as the windmill hinge with damping or motor

The first set is platform, rail, tunnel, windmill and switchback:

- **Platform:** a box whose top face is the contact surface
- **Rail:** a smoothed path built from thin rounded segments in the marble plane. The two-wire look is visual only.
- **Tunnel:** a rail floor with a ceiling that starts shortly after the entry. Blender hides the marble inside it.
- **Windmill:** a hub that turns only around the wall normal, with angular damping or a constant-speed motor. Its angle is recorded every step and becomes rotation keyframes in Blender.
- **Switchback** (layout `holder`): a holder for long notes built entirely from parameters. `legs` sloped legs `width` wide, stacked `drop` apart and sloping alternately left and right; each leg runs from its wall to `opening` short of the other side. Each leg is one bent wire: the wall comes down on the leg's high side, turns through a fillet of radius `bend` (default 4 cm, 0 gives the old sharp corner) tangent to wall and leg, and runs down the leg. A short stop on the last leg's open side turns the marble down out of the switchback. The marble rolls down a leg, falls through its opening onto the next, rolls through the bend at the wall and back, and leaves through the last opening. The hit link's angle sets the leg slope (2° to 25°) and, by its sign, the first leg's direction like a rail; `contactAt` sets where the marble enters across the top. The wall the marble moves toward at its entry rises `lip` higher to catch a sideways entry; the other wall stops at the rim. `TResolvedPiece.paths` carries the wires as polylines, one bent wire per leg from the top, then the exit stop, and `shapes` their capsules. A free switchback's transform is its entry point. A switchback was chosen over a half-pipe: a U-rail can only release the marble over its lower lip on the first swing, since the marble has less energy on every later one, so a U as wide as a lane holds for one swing or traps the marble for good. The switchback's hold time grows with its legs, and its wall bumps shed the speed gained on each leg. The half-pipe was reasoned about, not simulated.

Switchbacks, rails, tunnels and windmills are scenery: anchored to the trajectory a short delay after the hit before a gap, they follow upstream edits like platforms but never sound a hit. The next platform is placed where the marble actually is, so hits stay on time whatever the gap piece does. Gap suggestions search their parameters by simulation and report honestly whether the result stays in frame and near the pace. `createSwitchbackForGap` enters where the marble has fallen 1.25 or 2.5 marble diameters below the launching hit, so the earlier path stays above the switchback; ranks leg counts (1 to 6) and slopes (2° to 17°) by an estimated hold time (`switchbackHoldTime`, rolling at 5/7 · g · sin slope from 0.35 of the entry speed and keeping the speed through the bends, within about 0.2 s rms of simulated holds at full and half gravity, with 0.6 s slack; rolling every leg from rest overestimated holds two to five times and at half gravity shortlisted only switchbacks that released the marble far too early) and the height the marble would reach at the next hit after falling from the exit; simulates the best ten per entry and width (the kit width and 0.8 and 0.65 of it) for both directions and three entry positions with a flat probe at the next hit; and scores the next dot's pace error (twice as much below the pace), frame, stray contacts and room for the next piece, then refines the best slope by ±2° and ±4°. The marble must leave early enough to fall below the switchback by the next bounce's rise plus 6 cm.

## Simulation

Every marble has a Rapier world of its own, holding only what that marble could reach before the next parking check: nearby pieces of any lane, windmills, and the other marbles as proxies. Any enabled collider, even one that meets nothing, reshapes Rapier's broad-phase tree, and the tree's shape sets the order in which a marble's simultaneous contacts are solved, such as two switchback wires; that order changes the result in the last bits and a tightly tuned run cascades from there. With one shared world a windmill 5 m from every marble broke 83 of Jingle Bells' 115 hits, and a 0.002 rad turn of a bass platform broke 36 melody hits. Separate worlds and parking keep a piece no marble comes near, and every edit in another lane that does not come near a marble, from changing its run at all. The simulation module exposes pure operations over a project document:

- `simulate` runs the world ahead of the playhead and returns samples, contacts and hit errors
- Snapshots are taken at each placed piece, so an edit re-simulates from the earliest affected snapshot
- Every piece starts parked and enters a marble's world only while that marble is within parking reach, checked every 6 steps on the global step grid: over the next 7 steps at twice the marble's speed (or a nearby marble's, when faster) plus 1 m/s and twice the tip speed of a nearby windmill, plus the fall, its radius and 5 cm. Another marble far away never widens the reach, and a lone marble's runs match the earlier shared world bit for bit. A piece no marble reaches leaves the run bit for bit unchanged. Placed pieces enter their marble's world at once. Free and pinned static pieces stay out of the snapshot key chain; on resume `canResume` checks that every added, removed or moved static piece, old and new pose, stayed out of reach (by the fastest marble and blade tip so far) of every sample up to the snapshot, and `rebaseStaticPieces` swaps in the new records in plan order. Dragging a free piece therefore re-simulates only from the last placed piece before a marble could reach it, and the result equals a full run. Windmills are in the key chain since they always turn.
- A windmill is in the world of every marble near it; the first of those worlds drives it and the copies follow its pose each step. Parked everywhere it turns on by its motor, or slows by its damping.
- Another marble enters a marble's world as a proxy, a dynamic copy that takes the other marble's state before each step and meets only marbles, while the two could touch within two steps. The contact is solved in both worlds as between two marbles and each keeps its own marble's response. Rapier reports contacts with a proxy several steps early, so a marble contact is logged once free flight from the start of a step meets within two steps.
- `place` builds a piece for a hit dot. The contact surface is placed where the marble is at the hit time, offset by the marble radius along the surface normal. Timing is therefore correct by construction for the placed hit, and only its angle changes the future.
- `repeatPiece`, `mirrorPiece`, `autoPlace`, `continueSuggestions`, `findLongGaps`, `openLongGaps` and the gap helpers produce piece edits. They need a simulate function, so the UI calls them through the simulation worker.
- Workers (`client.ts`): one simulation worker for the live run, one assists worker for Continue, the long-gap ghosts' fallback and Re-place's own runs (`simulateAssist`), and a pool of assists workers (`assist-pool.ts`) for Auto place and the gap pieces, started on first use with `navigator.hardwareConcurrency − 1` workers, at most 6 (`assistPoolSize`); with fewer than 2 the assists worker answers them as before. Auto place (`prepareAutoPlace` and the `autoPlaceSearch` generator) and the gap pieces (`prepareGapSearch`, `gapSearch`) are split into stages of independent tries; the pool cuts each stage into chunks of about half a stage per worker, hands them to whichever worker is free, puts the answers back in the order the tries were asked and reduces them there, ties going to the first, so the choice is the one the single-thread `autoPlace` and `create*ForGap` make whatever the pool size or timing. The first chunk of a search to a worker carries the request (`searchTries` with `prepare`); the worker simulates the project up to the trials' end plus 0.25 s, the only part the checks read, prepares once and keeps it (`TWorkerMemory`), and later chunks carry only the tries. A gap search ends with `gapAnswer` on a worker that prepared it, for the ghost's track. One search runs at a time; a waiting request is replaced by a newer one of its kind, and `isCancelled` (Re-place's Stop) ends a search between stages. Every worker posts a simulation result with each marble's samples packed into a transferred `Float64Array` (`result-transfer.ts`); cloning a song's samples as objects took about 14 ms per result.

Frame bands and descent pace (`placement.ts`, `pace.ts`):

- `frameBand(project, laneId?)` with one marble is the film frame: 0.45 m wide at 9:16 at the original 0.65 m camera distance, scaled with the aspect and with `design.camera.distance` (0.59 m at the 0.85 m default), centred on the release. With several marbles each lane's band is 0.26 m wide (`LANE_HALF_WIDTH`, two zigzag columns of 9 cm bars a bar and a clearance apart), the lanes sit `LANE_SPACING` (0.26 m) apart ordered by release x and centred on the mean release, so neighbouring bands meet. Without `laneId` it returns the band covering every lane. Open hits report `outOfFrame` against their lane's band. Narrower lanes were tried with one world per marble (0.16 to 0.22 m, `references.md`, Narrower lanes): where bands overlap the other lane's pieces stand in the zigzag's way, the marbles stay about 0.26 m apart anyway and the builds that complete frame no closer.
- `paceRate(project)` is (1 − e) / (1 + e) · g · T / 2 for the default platform bounce e and the median interval T of all lanes' consecutive hits up to 0.8 s, with several marbles at least `columnRate(T, g)`, clamped to 0.15 to 0.8 m/s. `columnRate` is the rate whose drop per hit d leaves `COLUMN_CLEARANCE` (6.5 cm) between a bounce's top and the piece two hits back, which a zigzag passes under: with k = g·T²/2 the bounce rises (k − d)² / 4k, so d = 3k − √(8k² − 4k · clearance). Heights at a rhythm scale with gravity but pieces do not; at half gravity and 0.5 s the default bounce left 3.5 cm and marbles struck those pieces, and the rate becomes 0.30 m/s instead of 0.26. Full gravity at 0.5 s keeps the default bounce's 0.52 m/s. `descentPace(project, hits)` anchors y*(t) = anchorY − rate · (t − anchorTime) at the earliest hit with a dot. `simulate` returns it as `TSimulationResult.pace` for the camera; `paceAt` evaluates it. `PACE_LIMIT` is 0.25 m.
- `longGapThreshold(project)` is the interval at which a bounce at the pace would rise more than `MAX_BOUNCE_RISE` (0.4 m at Earth's gravity, scaled with `gravityScale`), between 0.6 and 2 s. Rise and pace both scale with gravity, so the threshold depends on the rhythm alone, about 0.68 s for 0.5 s hits. `findLongGaps` and Auto place use it. Auto place follows a launch into a long gap for 0.3 s / √gravityScale, since the hop rises the same 7 cm at any gravity and stays in the air that much longer.

Auto place, Continue and the gap helpers treat a project with several marbles as sharing one camera. Then Auto place solves each platform's bounce from the arrival velocity and the surface normal for the takeoff that lands the next dot on the pace (`paceBounce`), corrects it once by simulation when the dot misses by more than 2 cm, and rejects candidates whose next dot ends further than `PACE_LIMIT` from y* (or further than the current dot, plus 5 cm), whose path leaves the lane's band, whose next platform would not fit inside the band, or whose marble is not falling at `IMPACT_SPEED` at the next hit. A dot below the pace recovers half its offset per hit with at least 0.75 of the pace drop; a dot above returns at once. Narrow lanes leave angle windows of a degree or two (a 0.5 s flight moves the next dot about 4 cm per degree), so with several marbles the refinement and the fallback steps are 0.5°. When nothing passes, steps from −12° to 12° are tried (fast arrivals need nearly flat pieces), quarter degrees within ±3° for arrivals faster than 3 m/s, then the steps with the target 12 cm lower and higher, then −60° to 60°. The comfortable travel is two piece lengths, at most the band's half width, which centres a zigzag in a narrow lane. Before a long gap the bounce gives a 1.2 m/s hop that clears the piece into the switchback. Stray contacts with another marble count only up to that marble's next open hit, beyond which its path is unbuilt free fall. An angle whose run breaks another marble's hit that was on time up to that marble's next open hit is rejected (`crossesOtherLanes`); switchbacks, rails and tunnels for long gaps are never suggested when they touch another lane's pieces or marble. Continue drops ghosts that leave the pace, stops before a hit that starts a long gap and before a lane's last hit (whose fall past the other lanes only Auto place checks), and cuts the last ghost when a flat probe at the following hit would be blocked. A marble's path counts as unbuilt after its next open hit and after the launch into a long gap that nothing bridges yet. With one marble Auto place keeps the settling bounce that reaches the next hit at the steady speed of the default bounce, the 0.45 m frame and a soft pace.

Pegboard snapping applies to angles and to the bracket mount. The contact surface stays on the trajectory, so snapping never moves a hit off its time.

`createLoop` and `checkLoop` (`simulation/loop.ts`) make seamless loops. `createLoop` takes the loop start from the first sample at which a released marble is `0.75 * camera.distance` below its highest point, the end from the project end, both on a 1/30 s grid, and ghosts: each marble's samples from its release to just after the start, shifted by the loop length. Bars come from the optional `music.tempo` (`{bpm, beatsPerBar}`, set by MIDI import with four beats per bar). `checkLoop` reports `state` (ghost differs from the marble at the start), `entry` (first contact within 0.15 s of the start), `stillInView` (marble closer than 1.6 camera distances to its entry at the end), `lateRelease`, `reaction` (a hit within 0.25 s before the end), `movingPiece` (rotor angle modulo its blade symmetry) and `bars`.

Contacts record actual time, entity, marble and the approach `speed`: the marble's velocity toward the surface along the contact normal at the refined contact time, relative to a windmill blade's own motion. A hit is valid when its marble first touches its linked piece within 20 ms of the hit time at `IMPACT_SPEED` (0.3 m/s at Earth's gravity, scaled with `gravityScale`) or faster; a slower first contact is a resting or rolling contact and the hit is `missed` with `reason: 'resting'`. Unexpected contacts, including marble collisions, are reported separately.

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

Pieces in the scene description carry the resolved geometry from the simulation result (`TResolvedPiece` position, angle, `path` and `paths`), never raw transforms, so a free switchback (whose transform is its entry point) and a free rail (whose transform is its local origin) show where the physics put them. Each piece carries `hitTimes` (actual contact times of its linked hits), `contactTimes` (every marble contact start with it, starts within `CONTACT_MERGE` = 0.1 s of the previous one merged) and `musical` (the definition's flag). Both fields are additive; a worker that does not know them falls back to treating platforms as music pieces.

### Themes, reactions and camera

- `TSceneDescription.theme` selects a procedural theme in `blender/mm_worker/themes.py`: `pegboard` (flat toy colors, pegboard wall, wooden pegs) and `brass` (the reference look: lavender plaster wall, brushed brass bars on bent chrome brackets with round wall bases, chrome two-wire rails, satin tunnels, brass windmills, a glass marble with a swirl core in the lane color, one soft low sun from the upper left, a studio environment for metal reflections, AgX). Themes are data; materials are shared and created once, so Blender edits to them survive.
- A project theme reaches the worker as its base in `theme` plus `themeOverrides` (`TSceneThemeOverrides`, the applied theme's set colours). `themes.resolve_theme` lays them over the base settings: Wall paints the wall material (named per colour, so the shared base material stays untouched; Neon's grid follows the new wall), Light tints the sun, Background the world, Glow every Neon trim. `scene.apply` sets them for the apply with `themes.set_overrides`; the studio's `mm_theme` key includes them, so changing a colour re-themes the untouched studio, and the skin key includes Glow only when set. The Draft Preview resolves the same theme (`draftWall`, `draftPieceColors` with the overrides); Light and Background have no draft equivalent
- Default skins are built per theme and piece type (`skins.py`). A skin root carries a fingerprint of what the app built; the app rebuilds only unedited default skins of linked holders when the theme or parameters change. Edited skins, custom skins and objects outside the MidiMarble collections are never touched. Studio objects (wall, sun, world) are re-themed only while they hold what the app last wrote.
- Reaction times: `mm_hit` of a music piece (platform) follows its `hitTimes`; scenery (rails, tunnels, windmills, switchbacks) never has hits, so its `mm_hit` follows `contactTimes`. Windmill blade strikes from `contactTimes` also join the contact-frame snapping of the marble. A default windmill skin flashes its whole mesh (`mm_flash` on the skin root, strength 1.2) on each contact unless Design picks `none`; `glow` sets the strength.
- Reactions: a platform's bar is a child part whose drivers read the holder's `mm_hit`: it presses along its normal and tilts a few degrees around the bracket, springing back as `mm_hit` decays. An optional emission flash uses the `mm_flash` object property. Reactions never touch holders or their keyframes. `TSceneDescription.reactions` overrides the theme values. A piece's `reaction {preset, params}` from Design overrides the theme reaction for that piece: `none` adds no drivers, `press` (`press` m, `dip` degrees), `wobble` (`angle` degrees, `frequency` Hz; a decaying swing in the wall plane whose phase comes from `mm_hit` itself, `-ln(h)·τ` being the time since the hit) and `glow` (`strength`). Drivers are simple expressions, so they run without Python auto-execution.
- Library skins (`assets.py`): a piece with `assetPath` (`assets/<id>/asset.blend`) gets the asset's `MM_ASSET` collection as its skin. The worker appends the collection once per file into a template collection outside the scene (`MM asset · <path>`, fake user, images packed) and builds skins from object copies that share the template's meshes and materials. Appending rather than linking keeps everything the scene renders inside `scene.blend`, so packages move freely and film jobs render a saved copy without library paths; a changed `asset.blend` (size or modification time) reloads the template and rebuilds its skins. Skin layout: an empty skin root under the holder (its local transform is the user's offset), an `asset frame` empty that places the asset frame on the contact surface, and the copies. Box pieces put the asset origin at the centre of the top face with +Z along the contact normal, X along the length and Y into the wall; windmills put it at the hub with +Z toward the camera; rails and tunnels repeat the straight section along a curve on the top of the wire or the tunnel floor (Array and Curve modifiers). `fittedParams` from the asset's `manifest.json` scale the asset to the piece (`length`, `depth`, `thickness` per axis for boxes, `bladeLength` uniformly, `radius` across rails and tunnels), clamped to 4x. `MM_REACT_*` parts with `mm_reaction` get drivers on their delta transforms, so the modelled transform stays intact: `press` moves along the asset's -Z, `wobble` turns around the axis toward the camera, `glow` drives `mm_flash`, which the worker adds to the part's materials' emission strength. Switching between a library skin and the theme default replaces an unedited app skin and carries over the root offset; edited skins stay the user's. A missing or invalid `asset.blend` keeps an existing skin of that asset (otherwise the default is built) and is reported in `skins` as `missingAsset` or `invalidAsset`.
- Wall text (`walltext.py`): each `TSceneDescription.wallTexts` entry becomes a FONT object in `MidiMarble · managed` tagged with its entity's `mm_id` and `mm_role = 'text'`: centred on its wall position, extruded by `depth` (half each way, so the back sits on the wall), `size` as the letter size in metres, a colour material, facing the camera side and turned by its wall angle. `font` names a loaded Blender font (`Bfont Regular` is built in) or a font file, which is packed. Re-applying updates a text while it still matches what the app last wrote; an edited text is skipped, and a removed edited text moves to `MidiMarble · detached`. The ID pass picks texts by their `mm_id`.
- Camera: with `TSceneDescription.camera` (from `design.camera`) the worker bakes a follow camera in `camera.py`. Follow point: the weighted centre of the marbles in flight. Target: moved up to `lead` seconds ahead, smoothed with a zero-phase critically damped filter (time constant `0.04 + 0.5 * smoothing` s) and pulled along where a fast fall would leave the frame. The camera stands `distance` away at `pitch` from the wall normal, above and to the side of the run, so bars show their long sides and tops and the wall recedes like a floor, as in the reference. Image roll follows the run direction slowly plus a slow drift, so the columns turn between diagonal and near vertical. Shots set distance and extra roll with eased transitions and appear as `MM · <kind>` timeline markers. Several marbles widen the distance so all stay in frame. Lens 50 mm (`camera.lens` overrides it). Pitch 1.0 with a distance of about 0.65 m per 16 mm marble (0.95 m for the 1.5x kit of `reference-20`) matches the reference framing. Keyframes are baked on the studio camera, so Blender plays it without add-ons. A camera edited in Blender is taken over: `apply_scene` reports `camera: 'takenOver'` and regenerates only with `regenerateCamera`. `mode: 'manual'` leaves the camera alone.
- Contact frames: physics samples straddle each bounce and frames rarely fall on a hit, so a fast bounce would show the marble clear of its piece on every frame. The worker inserts an exact contact sample per hit (extrapolated from the incoming flight) and warps playback time locally so each hit lands on a frame of the 1/30 s grid (the frame rate's grid when it is not a multiple of 30). The shift is at most half a grid step (17 ms), and `mm_hit` uses the same snapped times so reactions start on the contact frame.
- Tunnels hide the marble: `mm_visible` on the marble holder is keyed 0 while the marble is fully inside a tunnel and drives the default skin's visibility.
- Loops: with `design.loop`, the scene builder adds `TSceneDescription.loop {start, end, blend}`, sets `duration` to the loop end and adds a ghost marble `<id>~loop` with `ghostOf` per marble. The worker stores the range as the scene property `mm_loop`, hides a ghost through `mm_visible` until its replay begins, leaves ghosts out of the camera follow, bakes the camera from before `start - blend` and blends the last `blend` seconds into the poses one loop length earlier with a smoothstep weight (rotations as quaternions), so the camera at `end` equals the camera at `start`.
- Switchback skins follow the bent physics wires point by point. Brass draws each wire as a pair of chrome wires either side of the marble plane, offset from the capsule line toward the side away from the marble (the outside of the bend, below the leg, outside the wall) with mitred vertex normals so the offset stays constant through the bend, with ties at the ends and wall posts at the ends and the middle of the bend. The marble side of a bent wire is the side it turns toward; a straight wire (the exit stop) faces the middle of the switchback. Pegboard draws one toy rod on the capsule line with wooden pegs at the same places.
- Built-in brass skins: a piece skin asset ID `brass:<skin>` picks a bar finish (`gold`, `silver`, `copper`, `dark`) or a device: `device` (silver housing with a grille, a dome and gold end blocks; `device-silver`, `device-copper`, `device-dark` change the end blocks), `key` (dark housing with a white key) or `knob` (dark housing with a red lens that glows on every hit unless Design picks a reaction). Every skin keeps the collider's top face as its contact surface. Unknown names fall back to `gold`. `fixtures/reference-20.marble.json` (built by `scripts/build-reference-fixture.ts` with the assists; `--dress` re-applies its skins, titles and camera without rebuilding) uses `gold`/`device` and `key`/`knob` per section

### Film render

`render_film {preset, engine?, outputPath, audioPath?, samples?, jobId?}` saves a copy of the live scene to `renders/.jobs/<jobId>/scene.blend`, starts a background Blender on it with `blender/render_job.py` and answers with the job right away, so the live worker stays responsive. Presets: Draft 720p 30 fps, Fast 720p 30 fps, Balanced 1080p 30 fps, Best 1080p 60 fps, by the short side (portrait 9:16 gives 1080x1920). Draft ignores `engine` and renders with Workbench (`workbench_settings`: material viewport colours, shadows, cavity, outlines, Standard view transform, no depth of field or motion blur) and writes JPEG frames; the started and finished job report `engine: 'workbench'`. Output frame i shows time i / fps, independent of the keyframe rate. The job writes progress to `.bridge/outbox/<jobId>.progress.json`, renders PNG frames, muxes them with the soundtrack WAV into an MP4 (H.264, AAC) with FFmpeg (or with Blender's own FFmpeg through the sequencer when no binary is found) and writes the response envelope to `.bridge/outbox/<jobId>.json`. The host reads both with `blender_job_poll`. A scene with `mm_loop` renders frames `start + i / fps` up to the frame before `end`, so the MP4 repeats seamlessly; `renderFilm({loop})` writes the matching soundtrack (`renderProjectAudio` with `loop`: lanes from the loop's hits rendered 3 s past its end and folded onto the start, or a recording cut with a 50 ms crossfade into the audio before the start). `cancel {jobId}` sets a cancel flag the job checks between frames and stops the process after a grace period. The job also stops when the app exits, and the live worker reports jobs that end without an answer. `renderFilm` in `src/modules/blender/render-film.ts` writes `renders/soundtrack.wav` from `renderProjectAudio` and follows the job. A film is always rendered inside the package; with `destinationPath`, `renderFilm` copies the finished film to the path chosen in the save panel through the host command `copy_file_out(packagePath, relativePath, destinationPath)` (absolute destination in an existing folder, copied through a temporary file and a rename) and returns that path.

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
