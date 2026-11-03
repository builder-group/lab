# Progress

The autonomous build updates this log after every slice. Newest entries go first.

## Current state

- Milestones: M0–M4 done; M5 Design in progress (UI, library and agent runner done; Blender consumption of asset skins, per-piece reactions and wall text in progress); M6 render pipeline, follow camera and seamless loops done, shot markers open
- Next steps: looser group framing in the film camera for two-lane runs (see the larger-kit entry and `references.md`), a held ending for Jingle Bells, a native export test, density at reference hit rates, a focus-marble control in the Design inspector
- Blockers: none
- Native checks run in a bundled debug build (`pnpm exec tauri build --debug --bundles app`) driven with computer use; save panels cannot be typed into while the user's screen is on a full-screen Space, so test packages are opened from Recent

## Log

### Draft film preset

- New `draft` render preset for judging placement, motion, timing and camera quickly: 720p 30 fps, rendered with Workbench from the same scene, camera, frame range, loop range and soundtrack as the other presets, whatever renderer is chosen. Workbench settings live only in the job process (`workbench_settings` in `render.py` through `temporary`): material viewport colours (materials still at the default grey take their Principled base colour), studio light, short shadows down and to the right, screen cavity, dark outlines, Standard view transform, no depth of field or motion blur. Draft frames are written as JPEG (quality 92); PNG writing took as long as the Workbench render itself
- Schema: `design.renderPreset` accepts `draft` additively, so every `marble-project@2` file stays valid. Export sheet picker reads "Draft · 720p · fast preview of motion" and the renderer caption says Draft renders with Workbench; Design inspector Render menu, and Draft/Fast/Balanced/Best Render Preset commands in the command palette. Estimate: a measured draft film by engine `workbench`, otherwise a typical 70 ms per 720×1280 frame (`basis: 'typical'`), never the Eevee preview
- Timings (M-series Mac, film job only): Jingle Bells 1050 frames in 73 s (70 ms per frame, 76 s with encoding) against about 481 ms per frame and 505 s for Fast; reference-20 600 frames in 32 s (53 ms per frame, 34 s) against 470 ms and 285 s. With PNG frames the first draft run was 142 and 98 ms per frame
- Outputs in `.local/draft/`: `films/jingle-bells-draft.mp4`, `films/reference-20-draft.mp4`, `jingle-bells-draft-contact.jpg`, `reference-20-draft-contact.jpg`, `jingle-bells-draft-12.5s.png`. Readability: brass bars, chrome brackets and switchbacks, device skins with their red accents, wall titles and both marbles (blue, orange) read clearly; hit flashes and emission glows do not show in Workbench. Seen in the Jingle Bells draft: the orange marble leaves the frame from 0:32 and the last seconds show an empty wall
- Checks: `typecheck`, `lint`, `test` (196), `blender:check` (103) and `blender:film` (20, new: draft overrides Cycles with Workbench, the live scene keeps Eevee, 720×1280 with AAC, same frame count as Fast, marble and brass colours in a decoded frame; 198 frames in 4.7 s, 24 ms per frame) pass

### Export preflight

- `export-preflight.ts` checks the current result before an export: missed hits with their reason, blocked and drifting hits, open hits and dots outside the frame or lane band (grouped per lane), stray contacts (marble pairs, another lane's pieces, free platforms; own pieces and free scenery are expected), lanes more than 2 × `PACE_LIMIT` off the shared pace when `descent` is set, loop mismatches through `describeLoop`, and a stale or missing result. Warnings change the default button to Export Anyway; notes do not
- Export sheet shows a disclosing summary line with warning and note rows; a row closes the sheet, switches to Compose, sets the playhead and selects and frames the piece or hit dot. `StudioCx.revealIssue`; `$reveal` now carries an optional wall point and hit keys, and stays pending until a Compose canvas mounts and frames it. The Design inspector's Output panel shows the summary
- Observations: `jingle-bells` and `zigzag` pass clean; `loop` has one note (a dot 1 cm outside the frame); `two-marbles` reports its marbles colliding at 0:00.18 before the first hit. Own-lane re-contacts after a hit are common in clean fixtures (7 in Jingle Bells), so they are not flagged
- Checks: `typecheck` and `lint` pass; `test` 195 of 196; the one failure is a timing test in `simulation/performance.test.ts` (a different reflow budget on each run while other work loads the machine); 10 new preflight tests. Browser check at 1440 × 900 in light and dark: Zigzag clean ("All 16 hits on time", Export); with Platform 5 turned to 70° "2 issues · 1 note" (resting miss, blocked hit, 9 dots outside the frame), Export Anyway; clicking the blocked row from Design opened Compose with Platform 16 selected, framed and the playhead at 0:04.65

### Larger default kit, closer lanes

- Default kit 1.5× the Marble Race Kit for new projects (`KIT_SCALE`, `DEFAULT_MARBLE_RADIUS` 0.012 m): every piece default scaled (platform 9 × 1.2 × 4.5 cm, rails, tunnels, windmills, switchbacks, rail and tunnel default paths), default camera distance 0.85 m like `reference-20`, the MIDI import places marbles `LANE_SPACING` apart. Saved projects keep their explicit sizes. Kit-relative assist constants: comfortable and launch travel in piece lengths, switchback entry drops in marble diameters, switchback widths as shares of the default, rail length cap scaled
- Lanes: 0.26 m wide and 0.26 m apart (`LANE_HALF_WIDTH`, `LANE_SPACING`), so the two-lane band is 0.52 m; one marble's band is the film frame scaled with the camera distance (0.59 m at 0.85 m). Tried and rejected: 0.165, 0.18 and 0.22 m spacing with overlapping 0.21 to 0.30 m lanes. All marbles share one world, so interleaved lanes strike each other's bars and the Jingle Bells build failed within 2 to 13 s each time. Lanes at the target 0.15 to 0.18 m would need lane-separated collisions plus depth offsets in Blender
- Assists for narrow lanes: half-degree refinement with several marbles, quarter degrees within ±3° for arrivals faster than 3 m/s, comfortable travel capped at the band's half width, Continue leaves a lane's last hit to Auto place, stray-contact frontiers also start at the launch into an unbridged long gap, rail and tunnel suggestions probe the next hit for room
- Fixture builders: staircase keeps the 1× kit (hand-set angles), zigzag starts at 0.45 rad and long-gap at 0.4 rad with the new kit, two-marbles releases on the lane centres at ±0.65 m/s (collision at 0.18 s), the example projects' camera is 0.9 m. Jingle Bells: releases at ±0.13 m; the simulated user now rotates the previous piece before rotating the target by hand
- Jingle Bells: 115/115 on time, 12 switchbacks, 7 manual steps (1 hand rotation, 6 rotations of the previous piece), every dot within 0.21 m of y*, marbles at most 0.66 m apart vertically. Reference-20 64/64, loop 21/21 and passes `checkLoop`, all fixtures regenerate byte-identically
- Film: `.local/look4/films/jingle-bells-fast.mp4` (rendered with `blender/tests/render_look.py --film fast`), contact sheet `.local/look4/jingle-bells-contact.jpg`, compare `.local/look4/jingle-compare.jpg`. Bars 12 to 19 % of the frame width (was 8 to 11 %), marbles 3.3 to 4 % (reference 25 to 30 % and about 7 %). The group camera is the remaining limit: keeping both marbles' full bounce arcs inside 55 % of the half frame needs about 1.3 m of distance. With its group framing loosened in memory to 0.8 and 0.85 (`.local/look4/patched_look.py`, `framing-compare.jpg`) bars reach 23 to 25 % and marbles about 4.5 % with both marbles in frame; that change belongs in `blender/mm_worker/camera.py`
- Checks: `typecheck`, `lint`, `test` (184) pass
- Next: looser group framing in the camera (Blender side); a held ending so the film does not end on empty wall; lanes closer than 0.26 m only with per-lane collisions and depth offsets

### Owner feedback after the first films

- Jingle Bells after the engine work is clearly better than before; the zigzag reads well; the marble is too small compared with the reference; the rolling camera can stay as a hook, no extra camera setting (Take Over Camera covers custom work)
- Next: windmills, rails, tunnels and switchbacks become scenery that never uses up a note; switchbacks get smooth curved turns instead of sharp corners; windmills and other creative pieces as time holders come later

### Switchbacks in Blender, two-marble framing

- Scene description: pieces carry `paths` (switchback wires in wall coordinates: two walls, then the legs), passed from `TResolvedPiece.paths`; scene bounds include them
- Switchback skins: brass draws every wire as a pair of 2.2 mm chrome wires on both sides of the marble's plane, set back so the marble touches both where it touches the capsule, with ties, posts and wall discs like the rails; pegboard draws one toy-coloured rod per wire with wooden pegs
- Camera for side-by-side lanes: the readable maximum is now three times the set distance (still capped by pieces at 6 % of the frame width); a group may use 65 % of the half frame width; its height follows the shared `descent` curve only inside the curve's time range and within a quarter of the marbles' vertical spread from their midpoint (the curve starts at y −3.8 m while the marbles are released at 0.6 m, and briefly runs 0.25 m off during falls); the zoom need drops spikes shorter than 0.3 s with a running median, and the camera leaves the group only for longer excursions
- Jingle Bells (engine rebuild: 115/115, 12 switchbacks) re-exported and rendered: `.local/look3/films/jingle-bells-fast.mp4` (1050 frames in 496 s), `.local/look3/jingle-bells-contact.jpg`, before and after in `.local/look3/jingle-compare.jpg`. Earlier iterations: `films/jingle-bells-fast-before-engine.mp4`, `films/jingle-bells-fast-switch1.mp4` (switched between group and focus marble every few seconds because one-frame spikes were held for a second)
- Verdict: watchable from 1 s to 31 s with both marbles in frame the whole time, a steady camera at 1.0 to 1.8 m and no wall edge. Weak points: the two lanes run about 0.3 m apart, so the frame is wide; the 6 cm pieces are 8 to 11 % of the frame width and the 16 mm marbles about 12 px at 720p, and the bass marble reads only as an orange dot. Switchbacks read as small chrome wire cages up close and as faint grey scribbles at this distance. The first second shows the two marbles alone, and from 31.5 s the melody falls about 15 m alone with no pieces while the bass leaves the frame. Pieces per frame match the reference's count (15 to 20), but each is about half the reference's size relative to the frame
- Next: narrower lane bands (about 0.15 m) or the 1.5× kit scale of `reference-20` would let the camera come in to reference scale; a held ending for the melody
- Checks: `blender:check` (103, new: switchback wires in both themes), `blender:design` (41), `blender:loop` (16), `blender:film` (13), `typecheck`, `lint` and `test` (183) pass

### Shared descent pace, lane bands, switchbacks, impact hits

- Pace (`simulation/pace.ts`): a project-level target height y*(t) falling at the steady descent of the default bounce at the median hit interval of all lanes (0.52 m/s for Jingle Bells), anchored at the earliest hit dot. `TSimulationResult.pace` carries it, and `descent` samples it every 0.5 s for multi-marble runs in the shape the Blender camera already reads. `longGapThreshold` makes a gap long when one bounce at the pace would rise more than 0.4 m
- Lane bands: `frameBand(project, laneId)` splits a frame widened to 0.7 of the single frame per marble into side-by-side bands ordered by release, with a 2.4 cm gutter; without a lane it returns the whole frame. Open dots report `outOfFrame` against their lane
- Auto place with several marbles solves each platform's bounce for the takeoff that lands the next dot on y* (half-way recovery from below, never less than 0.75 of a pace drop), corrects it once by simulation, and rejects candidates that leave the pace limit (0.25 m, or the current offset), the lane band, the band minus half a platform for the next dot, or that arrive slower than 0.3 m/s falling. Fallbacks: 1° steps within ±12° (fast arrivals), the same with the target 12 cm lower and higher, then ±60°. Before a long gap: a 1.2 m/s hop. One marble keeps the old settling bounce and a soft pace, so single-lane fixtures stay as they were
- Switchback piece (`switchback`, layout `holder`): wall and leg wires from parameters, `createSwitchbackForGap` searching entry, width, direction, entry position, legs and slope by simulation and scoring pace error, frame, strays and room for the next piece; `findLongGaps`/`openLongGaps` and Next (`AssistCx.next`) serve it before a rail, also when the marble falls so far across the gap that the next hit has no dot. Compose draws it from `paths`; the agent brief and inspector know it. A U-rail was rejected by reasoning: it can release the marble only on its first swing
- Impact hits: contacts record the approach `speed` along the normal (relative to windmill blades); a first contact below 0.3 m/s is `missed` with `reason: 'resting'`, shown as Resting in the inspector
- Continue stops before a launch hit, cuts the last ghost when the next hit would have no room, and with several marbles drops ghosts that leave the pace. Stray contacts with another marble count only up to its next open hit
- Compose: Next asks for a switchback with a rail fallback and no longer sends launch angles; gap ghost hint warns when the next dot ends off the pace; step-loop default angles and run directions use the lane band
- Jingle Bells rebuilt with releases at 0 s and ±0.16 m: 115/115 hits on time, 12 switchbacks, 2 manual steps (was 34), every dot within 0.25 m of y* (was 47 of 51 melody dots off), largest vertical distance between the marbles 0.54 m (was 21.1 m), melody |y − y*| max 0.68 m, mean 0.19 m (was 21.0 and 5.65). Build log with measurements in `.local/jingle/build-log.txt`; details in `references.md`
- Other fixtures rebuilt: staircase, zigzag (16 on time), long-gap, windmill, two-marbles, reference-20 (64/64; the builder now seeds the kit-sized platform before Auto place), loop (21/21, `checkLoop` passes, same seeding). All fixtures regenerate byte-identically
- Checks: `typecheck`, `lint` and `test` (182, including performance and new tests for pace, lane bands, resting hits, switchbacks, Continue before a launch and a two-marble pace run) pass
- Limits: between dots a held marble sits up to 0.68 m above y* (the switchback descends slower than the pace); the pace is a straight line anchored at the first hit, so a lane whose first hit is far off cannot be pulled onto it by the assists; the bounce clamps at 0.95, so after a short interval a long one can still end below the pace; the two-marble frame is wider (0.63 m), so pieces render smaller; the Jingle Bells build is a simulated user and its acceptance rules live in the script; the switchback has no Blender geometry yet (only `paths`); the film was not re-rendered

### Camera readability, generated wall, film look round 3

- Camera (`blender/mm_worker/camera.py`): a readable maximum distance, the smaller of twice (later three times) the set distance and the distance at which a typical piece (median platform length, from `apply_scene`) spans 6 % of the frame width. Several marbles share the frame only while they fit within it (the widest need held over a second); otherwise the camera eases over 0.4 s to the focus marble (`design.camera.focusMarbleId`, new optional schema field, else the first marble, which carries the melody lane) and lets the others leave. An optional shared descent curve (`camera.descent`, `{time, y}[]`, read by `descentCurve` from a `descent` field on the simulation result when the engine adds one) replaces the group centre's height
- Wall: `studio.fit_wall` sizes an untouched wall after the camera bake to the run bounds plus every frame-corner ray of the baked, edited or static camera hitting the wall plane (rays that graze it count 12 camera heights away), plus 1.5 m. Materials use object coordinates in metres, so their scale is unchanged. A user-edited wall is left alone. `apply_scene` reports the wall rectangle as `wall`
- Brass device skins, picked per piece with `brass:<skin>`: `device` (silver housing, seven grille slots, a dome and gold end blocks; `device-copper` and friends change the ends), `key` (dark housing, white key over the top and front edge that presses) and `knob` (dark housing, red lens that glows steadily and flashes on every hit). Plain bars are chunkier with flush end caps; every skin's top face is the collider's contact surface. Silver is darker, the sun is wider (16° from 6°) and weaker with a stronger fill, so shadows keep their direction but are softer and lighter; the marble is mostly blue glass with one thin lighter swirl band
- `reference-20`: `scripts/build-reference-fixture.ts --dress` re-applies skins, titles and camera without rebuilding the pieces. Section 1 uses `gold`/`device` with the title "Brass Steps", section 2 `key`/`knob` with "Night Keys" (white extruded wall text, turned so it reads level in the rolled film); camera distance 0.85 and pitch 0.85 show more rows
- Outputs in `.local/look3/`: `films/reference-20-fast.mp4` (600 frames in 285 s, about 470 ms per frame), `films/jingle-bells-fast.mp4` (1050 frames in 505 s, 481 ms per frame), `reference-20-contact.jpg`, `jingle-bells-contact.jpg`, `compare.jpg` (reference sheets above, ours below)
- Jingle Bells now reads in every frame: the camera stays at most 1.16 m away (6 cm pieces at least 12.7 % of the frame width, before up to specks), keeps the melody marble and lets the bass leave, and the wall (5.1 × 61.6 m) covers every view ray in all 141 sampled frames, where the old film showed the wall edge from 22 s. Its layout still has long free falls (23–24 s, 31–33 s show the marble alone)
- Look against the reference sheets: finishes, device types, soft shadows, the blue marble and wall titles now match in kind. Still behind: the reference packs about ten pieces per column into a frame in near-overlapping stacks, ours shows three to four (hit spacing from the layout, not the look); the gold section's chrome wire brackets show as legs where the reference has short hidden brackets; no channel watermark; titles are on the wall but appear only briefly because the camera passes them quickly; devices are simpler than the reference's (no knurled ends or glass inserts)
- Checks: `blender:check` (101, new: readable distance, focus marble kept, other marble leaves, two close marbles share the frame, `focusMarbleId`, wall covers every view ray, device skins' contact surface, knob glow), `blender:design` (41), `blender:loop` (16) and `blender:film` (13) pass; `typecheck` and `lint` pass; `test` 171 of 173, both failures in `simulation/` (the Jingle Bells fixture hits and the alternating Auto place zigzag; an earlier run also timed out the four-marble reflow while films rendered), owned by the concurrent engine work. Lint warnings only in `compose/PieceLayer.tsx` and `simulation/gap-pieces.ts`

### Jingle Bells end to end

- `scripts/build-jingle-fixture.ts` (`pnpm fixtures:jingle`) generates a public domain refrain plus a quarter-note bass as MIDI, imports it like the import sheet (parse, align to 1 s, split across two marbles, `createImportCommands`) and builds every hit with Next semantics through `answerWorkerRequest`: rails for gaps, Continue ghosts, Mirror, Auto place and launch angles, with hand rotations where those find nothing. Brass theme, Glockenspiel melody, Celesta bass
- Result: 51/51 melody and 64/64 bass hits on time, 7 rails, no marble contacts, each marble touches only its own pieces; 34 of 115 steps needed a hand rotation. The build is deterministic and takes about 25 s
- Film: `.local/jingle/jingle-bells-fast.mp4`, 35 s at 720×1280, 1050 frames in 428 s, soundtrack from `renderLanes` and `encodeWav` in Node. It does not read: the marbles drift up to 39 m apart vertically, so the follow camera zooms out until the pieces are specks, and from 22 s it passes the wall edge
- Comparison with the earlier Jingle Bells attempts and the gaps found are in `references.md` under Jingle Bells comparison
- Fixed: `parseMidiFile` failed in Node because `@tonejs/midi` loads as CommonJS there
- Checks: `typecheck`, `lint` and `test` (172) pass; `jingle-bells` added to `fixtures.test.ts`

### Seamless loops

- Approach: entry from above. The film covers [start, end): `start` is the first moment a released marble is 0.75 camera distances below its release, `end` the project end, both on 1/30 s. A ghost instance (`<id>~loop`) replays the marble's fall from its release shifted by the loop length, hidden until its replay begins, so the frame at `end` equals the first frame while the marble itself has fallen out of view. The camera blends its last 0.75 s into its poses from before `start`. The soundtrack holds the loop's hits with note tails folded onto its start (recordings: cut with a 50 ms crossfade). A periodic layout that carries the marble back was not attempted
- `createLoop` and `checkLoop` in `simulation/loop.ts`; optional `music.tempo` (set by MIDI import, 4/4 assumed) for bars; `setTempo` command; scene description `loop` and `ghostOf`; `mm_loop` scene range read by `render_film`; Design inspector loop status with Snap End to Bar; loop range bar on the timeline ruler
- `loop` fixture (`scripts/build-loop-fixture.ts`, `fixtures:loop`): 21 eighth notes at 100 bpm on an assisted zigzag, three bars from 0.333 s to 7.533 s, 21 of 21 on time, `checkLoop` passes with a ghost error of 0
- `blender:loop` (new, 16 assertions): camera at both ends equal (0 m, 0 rad), ghost at the end where the marble starts (0.00 mm), marble out of view on the last frame, ghost hidden until 7.20 s and appearing out of view, Eevee stills at start and end differ by 0.008 of 255, the fast film doubled with FFmpeg concat changes the image by 0.82 at the seam against 0.41 to 1.70 for neighbouring frames. Outputs: `.local/loop/loop-fast.mp4`, `loop-twice.mp4`, `seam-sheet.png`, `blend-sheet.png`
- Checks: `blender:check` (85, with loop camera closure), `blender:design` (41), `test` (171), `lint`, `cargo test` (24) pass; `typecheck` fails only in `scripts/build-jingle-fixture.ts` and `src/modules/music/midi.ts`, in progress elsewhere
- Limits: the camera crosses the whole descent in the 0.75 s blend, which reads as a quick pan over bare wall; the entry needs about 0.5 m of fall before the start, so the first hit is fast; marbles released after the start are not ghosted; `stillInView` uses a distance estimate, the Blender check is the exact test; AAC priming adds about 21 ms of audio at the seam when the MP4 is concatenated; the export estimate still counts frames to the project end; audio projects have no tempo

### Blender consumes Design data

- Library skins: `assetPath` appends the asset's `MM_ASSET` collection once into a template outside the scene (images packed) and builds skins from object copies, oriented on the contact surface and scaled by `fittedParams`; `MM_REACT_*` parts react from `mm_hit` through delta-transform drivers. Swapping between a library skin and the theme default keeps the user's skin offset; edited skins stay the user's
- Per-piece reactions: `reaction {preset, params}` overrides the theme reaction (`none`, `press`, `wobble`, `glow`) for default bars and asset parts
- Wall text: native extruded FONT objects in the managed collection, updated while unedited, left alone after a Blender edit, picked by the ID pass
- Film output: host command `copy_file_out` and `renderFilm({destinationPath})` copy the finished film to the save-panel location. Still to do in `FilmExportCx` (design module): pass `destinationPath: settings.chosenPath` when `resolveFilmOutput` reports `outsidePackage`
- Checks: `blender:design` (new, 41 assertions, including a 6-frame `render_film`), `blender:check` (80), `cargo test` (23), `test` (158) and `lint` pass. `typecheck` fails only in files outside this slice (`scripts/build-jingle-fixture.ts`, `src/modules/music/midi.ts`, in progress elsewhere). Brass still with a library skin and a wall title: `.local/design/design-brass.png`
- Not verified: rail and tunnel library skins beyond a scripted bend check (a box section follows the curve within 0.5 mm), wobble and glow on real agent assets, font files other than the built-in font

### Live agent run

- First successful agent run with Claude Code 2.1.311: "a simple brushed brass bar with a small chrome end cap" produced `asset.blend`, `manifest.json` and a preview in 74 s, with no files changed outside the candidate folder
- The runner now picks the newest installed CLI; the old 2.0.76 failed with an API error on its first tool use

### Native test, schema v2, Design workspace

- Bundled app: opening a package, Compose physics in WebKit and the Design preview rendered by a background Blender all work natively. Fixed: asset protocol refused paths under dot folders (`requireLiteralLeadingDot: false`), cache-busting query broke asset URLs, toolbar overlapped the traffic lights
- `marble-project@2`: piece physics parameters are explicit; the migration gives version 1 platforms their original bounce 0.55 so saved runs do not change when defaults change
- Platform `bounce` parameter, default 0.65 (0.85 makes zigzags impossible because the marble rises past the other column); Auto place also sets bounce so arrivals settle in one hit
- Design workspace: library sidebar with themes and asset tiles, Blender-style Scene, Look, Link and Agent panels, wall text, ⌘E export sheet with estimate, progress, player and Reveal in Finder, activity view
- Film look round 2: steep follow camera with slow roll, two-column zigzags with section finishes after a rail, `reference-20` sandbox with 64 on-time hits, contact-exact frames, tunnels hide the marble. Still behind the reference: density per frame, piece detail, silver finish, wall titles

### UI and UX pass

- Critiqued every surface against Blender, macOS (Finder, Logic, Xcode) and Figma UI3 from browser screenshots in light and dark, then fixed them; the rules are in `design-language.md` under Window, Selection, Timeline, Commands, Visual style and Controls
- Commands: one registry (`studio/commands.ts`) shared by a new ⌘K command palette, context menus and the shortcut handlers; new ⌘N, ⌘O, ⌘A shortcuts and Home for Go to Beginning
- Context menus on canvas pieces, open dots, marbles, empty canvas, timeline hits, lanes and outliner rows, drawn as macOS menus in a portal with keyboard focus. The sidebar Add menu no longer clips inside the sidebar
- Timeline: sticky Logic-style track headers with colour bar, instrument, M and S (mute and solo change playback), Blender keyframe diamonds that show placed, drifting and missed hits and the selected piece's hit, a ruler with minor ticks, playhead head and draggable project end, shading past the end, zoom buttons and zoom to fit on open, a resizable height that is remembered
- Sidebar as an outliner: disclosure triangles, piece icons, pieces in hit order, placed/total counts, problem-only badges, pin glyphs, rename on double-click
- Inspector: header row with an icon tile, collapsible remembered panels, AppKit-style pop-up buttons and checkboxes, captions for empty states, Select Piece from a hit
- Toolbar: Previous and Next Hit buttons, a time display that re-renders alone, Show and Hide tooltips. Empty states for no hits, first piece, Design in the browser and an empty library; a drop frame for dragged files; import sheet with rounded corners, dialog-width buttons and an Up to marble stepper
- Tokens: 13 and 11 px type scale with tabular figures instead of a monospaced font, opaque band colours for ruler and headers, neutral dark-mode selection, a browser window background, the focus ring in the base layer so fields can opt out
- Fixed: a new or opened project briefly showed the previous project's simulation result
- Performance: the playhead is subscribed only by the time display, the ruler head and the timeline line; a playhead update costs 0.8 ms median, 1.0 ms p95 including the React commit on the zigzag fixture
- Checks: `typecheck`, `lint` and `test` (129) pass
- Not verified: the native window (Liquid Glass behind the translucent chrome, native `title` tooltips, Tauri drag-and-drop enter and leave events), real trackpad pinch on the timeline, playback frame rate (the browser pane throttles animation frames while hidden)
- Left for later: a native macOS menu bar built from the command registry, arrow-key navigation in the outliner, Blender-style stepper arrows in number fields, lane height zoom, a Design inspector and library once Design has content

### M3 Compose UI (in progress)

- Assist worker: a second simulation worker answers `autoPlace`, `continue` and `gapPiece` requests with the newest project; a request queue keeps one waiting request per kind, pairs answers by id and keeps latest-wins merging for plain simulation
- Tool bar pieces Platform, Rail, Tunnel, Windmill (1 to 4) with flat toy colours; rails as two wires with ties, tunnels as a translucent tube, windmills as hub and blades turning from `motion` at the playhead
- Rail and tunnel handles (end and bend) with live trajectory, inspector Length, Slope, Physics fields and a ride status line; rails and tunnels can start anywhere on a trajectory
- Next (Return, N), Auto place (A) with a 150 ms wait then refine, Continue ghosts with a hint chip (Tab, Escape), rail suggestion for long gaps, Next presses queued while re-simulating
- Guardrails: long-gap diamonds with Add Rail and Add Tunnel, out-of-frame dots with the overshoot; minimum on-screen size for pieces and marbles; selecting a piece moves the playhead to it
- Browser checks: zigzag from one platform, Mirror and Tab (12 of 12 on time); long gap with Next and the rail suggestion (6 of 6); windmill hit with Next after it (7 of 7). Latency: Auto place 47 to 57 ms, Next 26 to 112 ms, Continue 4 to 18 ms, rail suggestion 189 to 205 ms
- Checks: `typecheck`, `lint` and `test` (100) pass

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
