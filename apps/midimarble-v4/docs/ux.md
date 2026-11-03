# MidiMarble UX

MidiMarble is a marble track builder whose tracks play music. A run looks satisfying in short-form video because its visual rhythm follows the musical rhythm. The app owns music and track building. Blender owns the look and the final render.

The product serves two kinds of people with one project:

- A beginner composes a track in the app, styles it through presets and agents and renders without opening Blender
- An advanced user opens the same scene in Blender at any time and changes anything the app does not own

The app is fully offline. It uses tools installed on the computer: Blender is required, and agents run through the local Codex CLI or Claude Code CLI. There is no account or cloud storage.

## Flow

1. **Start** from a MIDI file, an audio file or an empty project
2. **Compose** the music lanes and the physical track on a flat pegboard
3. **Design** the look through presets, the library and agents, or open Blender for detailed work
4. **Render** in Blender in the background

The default frame is 9:16. It can be changed, but Compose warnings use the chosen frame from the start. The app targets macOS. Project length has no fixed limit; the user decides where the run ends, like the end of a video timeline.

## Compose

Compose is the app's editor. It has full direct control and a deliberately small set of pieces.

### Music lanes

Each marble has one lane. A lane is a row of hits on the shared timeline. There is no piano roll.

- A hit has a time and a sound, either a pitch or a sample
- The lane background shows the source: a waveform for audio, note marks for MIDI. This makes it easy to place hits on the music.
- MIDI import proposes a lane per voice by channel or pitch range. A marble plays one note at a time with at least 180 ms between hits, so chords spread across marbles. Conflicts are highlighted and hits can be dragged to another lane.
- Audio import suggests hits from detected onsets. Tap-along records hits while the song plays.
- An empty project starts with hits clicked or tapped onto lanes
- The user decides where the run ends. There is no fixed length limit in the UX.

Sound depends on the source:

- MIDI hits play through a sampled instrument chosen per lane, so composing the track feels like composing music. The same instrument renders the film soundtrack.
- An imported recording already contains the music. Hits only mark when the marble should strike, and no extra sound is added.

### Pegboard view

The track lives on a wall. Pieces move in the wall plane, rotate only around the wall normal and keep a fixed distance from the wall. The marbles are locked to the wall plane, which keeps trajectories predictable.

The camera faces the wall in 2D by default. Orbit is available but not required.

The wall shows a dot grid like FigJam, drawn as pegboard holes. Its spacing adapts to the zoom level and doubles as a ruler at real scale. The grid is only a visual signal that Compose is a draft, not the final scene; nothing snaps to it. Pieces use flat, toy-like colors per type, following [marblie](https://github.com/younghoonam/marblie).

Rotation follows Figma: dragging rotates freely around the hit point with a live angle readout, Shift snaps to 5° steps, arrow keys nudge by 1° and Shift with an arrow by 5°. Double-clicking the readout accepts an exact angle. Brackets adjust their length to reach the wall, so a piece never leaves its hit point.

### Pieces

| Piece    | Purpose                                                        |
| -------- | -------------------------------------------------------------- |
| Platform | Main hit surface                                               |
| Rail     | Visible path for long gaps and rolling                         |
| Tunnel   | Physical tube that hides the marble; length and slope set the travel time |
| Windmill | Moving piece the marble strikes; spins with damping or a motor |

Rails and tunnels shape the path through long gaps; they do not have to deliver the marble to an exact point. The user places one onto the trajectory and adjusts its length and shape while the live trajectory shows where the marble goes. After it, the marble is in free flight again, and the next hit's platform is placed where the marble is at that note's time, so the hit stays on time.

Each piece type is one self-contained definition with a physics shape, a few parameters and a default skin. Parameters are physical: platform length and thickness, rail radius, tunnel length, windmill blade count, blade length and damping. Adding a piece type later means adding one definition.

Each marble has a release with its own position on the wall and time on the timeline, independent of the first hit. Like a clip in a video editor, the release can be moved earlier to leave a gap before the first hit, and that stretch can hold any pieces.

### Step loop

The run is built one hit at a time against a live trajectory:

1. Drag the marble release point. A ghost trajectory shows its fall.
2. A dot marks where the marble will be at the next hit time.
3. Click the dot to add a platform with a sensible default angle.
4. Rotate it. The trajectory after it updates live and the next dot moves along the curve.
5. Accept and move to the next dot.

Assists inside the loop:

- **Repeat** applies the previous piece's relative angle and offset to the next dot
- **Mirror** applies the mirrored relationship, which produces a zigzag when alternated
- **Auto place** lets the solver choose an angle that keeps the next dot in frame and consistent with nearby pieces
- **Continue** works like tab autocomplete. When the next hits share the rhythm of the last placed hits, ghost pieces repeat or mirror the recent steps. Tab accepts them all; Escape keeps placing one at a time.

Repeat, Mirror and Continue turn musical repetition into visual repetition. Named patterns can later be saved Continue setups.

Guardrails appear while building:

- A gap too long for a bounce offers a rail or tunnel
- A dot turns red when the next hit falls outside the frame or collides with an existing piece

### Editing earlier pieces

The track behaves like a parametric history. Pieces are bound to their hit. Their position comes from the trajectory and authored tweaks are stored relative to it. Changing an earlier piece re-simulates from that piece onward. Later pieces follow the new trajectory and keep their tweaks. A pinned piece keeps its position when the trajectory moves.

The playhead works like a rollback marker. Everything after it is shown ghosted, so the user builds up to the playhead and continues from there.

### Several marbles

All marbles share one physics world. The world is simulated ahead of the playhead to draw every marble's trajectory line. Marbles can collide with each other and with any piece, and a collision between marbles can be an intended effect with its own sound. Compose shows marble contacts as markers on the timeline.

Shared collisions couple the lanes: editing one marble's track can change another's timing. Compose reports newly created or removed marble contacts after each edit so the effect is visible.

### Skins in Compose

Skins appear in Compose as untextured grey silhouettes so the layout matches the final film. A toggle switches between skins and physics shapes. Skins never change the physics. A skin declares the parameters it fits, such as four blades of 0.3 m, and applying it sets those physics parameters.

## Physics and handoff

The app owns physics. Rapier and Blender's Bullet do not produce identical results, and small differences grow along a chain of bounces until hits miss their note. One engine records the motion and Blender plays it back.

- Rapier simulates at 240 Hz with a snapshot per piece so edits re-simulate only from the changed piece
- Moving bodies, marbles and windmills, are sampled at the output frame rate
- The app writes the scene directly into the `.blend` through the running Blender worker. No intermediate export format is used.
- Each piece becomes an app-owned holder object with its transform and keyframes. Its skin is a child of the holder, so rotating a piece in Compose rotates its skin.
- Every piece gets an animated hit value that rises to 1 on impact and decays to 0. Effects, reactions and the camera read it.
- A deleted piece moves its skin to a detached collection instead of deleting the artwork

## Design

Design is art direction. The user chooses, describes and toggles. Blender is the editor for fine work.

The Design tab supports:

- Selecting an object by clicking the rendered preview through an object ID pass
- Applying skins, effects and themes from the library
- Asking an agent to change a selected object or the scene
- Adjusting the few parameters a preset exposes, such as color, light intensity or text
- Clicking the wall to place text or a decal
- **Edit in Blender**, which opens Blender with that object selected and framed

The Design tab has no transform handles. Each change needs a Blender render, so dragging would feel slow and duplicate Blender.

Design owns lighting, the wall, text, effects, decorations and the camera.

### Library

Skins, effects and wall decorations are Blender assets. Each item is a `.blend` with packed textures and a small manifest with its role, compatible piece type, fitted parameters, contact surface, reaction parts and thumbnail. The app reads manifests without starting Blender. The library folder is registered as a Blender asset library, so it also appears in Blender's Asset Browser.

- The app ships preset themes with ready skins for every piece type. The pegboard look of Compose is one of them, for users who want that style in the film.
- A project copies the items it uses into its own assets, so it stays portable
- **Save to my library** promotes an item for use in other projects
- Applying a skin to a piece type also applies it to pieces placed later

### Agents

An agent works on a selected object or the scene, such as "make this platform a piano key". Its brief includes the piece's contact surface, hit times and reaction slots, so the model fits the physics shape and rigs its reaction. The agent builds the candidate in a headless Blender. Its preview appears in the agent conversation and as a temporary candidate in the scene preview. Accepting it moves it into the project library and applies it; declining removes it.

The clearance check warns when a skin intersects the marble path.

### Reactions

A reaction animates part of a skin from the hit value, such as a key pressing down, a bell wobbling or a light flashing. Reactions are visual and never change the physics. Keep presses small so a resting marble does not appear to float.

### Wall text and decals

Clicking the wall places a native Blender text object with font, size, depth and material. Flat prints use decals projected onto the wall. Agents can restyle either.

Scene decorations follow the same review as skins. The user clicks a point on the wall and describes the element. The agent creates it there, a preview renders, and the user accepts or declines it. Accepted decorations stay in the project; they enter the library only when the user saves them there.

### Camera

The default camera is a rig of native Blender objects:

- A rail curve that follows the smoothed trajectory at a distance from the wall
- A target that leads the marble
- Shot markers on the timeline, such as wide, push in, roll or close on a hit, with eased transitions

The Design tab exposes distance, downward angle, lead, smoothing and shot markers. The app regenerates the rail when the motion changes. Editing the rig in Blender takes over the camera, and the app then asks before regenerating it.

### Preview and render

The Design preview is a low-resolution Eevee render of the current playhead from the real scene. A preview clip renders a short video. The final render runs in Blender in the background with progress shown in the app.

Export offers three presets: Fast (720p, 30 fps), Balanced (1080p, 30 fps) and Best (1080p, 60 fps). There is no 4K preset. Streaming Blender's viewport is a later option if the playhead render does not feel responsive enough.

## Ownership

| App owns                                          | Blender owns                         |
| ------------------------------------------------- | ------------------------------------ |
| Piece holders, transforms and motion              | Skins, materials and textures        |
| Marble and windmill keyframes                     | Lights, world, particles and effects |
| Hit values, timing, frame rate and audio          | Decorations and compositing          |
| The generated camera rig until the user takes over | The camera after the user takes over |

App-owned objects live in a managed collection with locked transforms. Every app-owned object has a link state, similar to Figma components:

- **Linked**: the app drives it
- **Unlinked**: Blender owns it, the app shows it as detached and stops changing it

An unlinked object can be relinked, which discards its Blender changes, or pushed to Compose, which adopts its Blender transform as a pinned piece and re-simulates. Unlinking is offered, never forced. An unlinked physical piece shows how far its visual position is from the physics it represents, because the marble still collides with the Compose position.

Blender changes never sync back automatically. Physics changes timing, which only Compose can show.

## Loops

A run can be marked as a loop so the end of the video flows into its start. A loop needs three matching pieces:

- The music ends on a bar that leads back into the start
- The marble state at the end matches the first frame. A return tunnel or an entry from above the frame hides the transfer, and the run can start with the marble already in motion.
- The camera rig ends where it starts

A loop check compares the first and last frames and reports mismatches.

## Project file

A project is a `.marble` package, a folder shown as one file on macOS. Moving the package moves the whole project to another computer, so every path inside it is project-relative. It contains the project JSON, `scene.blend` and assets. The `.blend` embeds a copy of the project JSON so the scene keeps its context when opened alone. The JSON stays outside the `.blend` so the app opens projects and shows the library without starting Blender.

## First version scope

- Music lanes with audio waveform and MIDI note backgrounds, tap-along and hit sounds
- Compose with platform, rail, tunnel and windmill, the step loop, Repeat, Mirror, Continue, pins and reflow
- Shared physics world for up to four marbles
- Direct `.blend` writing with holders, skins, keyframes and hit values
- Default pegboard theme, library manifests and agent candidates
- Camera rig with a few shot types
- Playhead preview and background render

## To verify

- Recorded keyframes keep every hit within 20 ms after playback in Blender
- A windmill plays back correctly as a second moving body
- A zigzag solves as a repeating cycle that can be copied
- Re-simulation stays interactive for 60 seconds with four marbles
- The playhead Eevee preview feels responsive enough for Design
