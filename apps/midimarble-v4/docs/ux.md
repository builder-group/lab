# MidiMarble UX

MidiMarble is a marble track builder whose tracks play music. A run looks satisfying in short-form video because its visual rhythm follows the musical rhythm. The app owns music and track building. Blender owns the look and the final render.

The product serves two kinds of people with one project:

- A beginner composes a track in the app, styles it through presets and agents and renders without opening Blender
- An advanced user opens the same scene in Blender at any time and changes anything the app does not own

The app is fully offline. It uses tools installed on the computer: Blender is required, and agents run through the local Codex CLI or Claude Code CLI. There is no account or cloud storage.

## Flow

1. **Start** from a song (a MIDI file or a recording) or an empty project
2. **Compose** the marbles' tracks and the run on a flat wall
3. **Film**: choose the look, camera and titles through themes, the library and agents, or open Blender for detailed work
4. **Export** the film; Blender renders it in the background

## Window

A window holds one project; there are no document tabs until several projects can really be open at once. The title bar shows the project title with its edited state, Home to return to the start window, the panel toggles and the Agent button.

The start window offers New Project, Import Song… (one panel for a MIDI file or a recording, starting a project named after the file) and Open Project…, and lists recent projects and the examples in two groups. Songs show the music import end to end: Jingle Bells, two marbles built from a MIDI file, and Tap Along, one marble on hits suggested from a recording. Techniques each isolate one behavior: Staircase, Zigzag, Long Gap, Windmill, Two Marbles, Seamless Loop and Brass Sections. An example opens as an unsaved document named after it, like an untitled macOS document, so Recent does not fill with copies; its song file is copied into the package like an imported one, so the Song track and the Project inspector show it. See Onboarding. Pieces are named per type in time order, marble after marble (Platform 1, 2, 3 down the first marble, Switchback 1, 2 in the order they play), and a new piece continues after the highest number in use.

The inspector edits the selection and lets relations navigate. A piece's tie row (Plays, Follows or Free) selects the note it plays (or the marble it follows) and its Detach button detaches it in place; a hit's inspector edits the note's pitch, velocity and time, plays the new pitch, and its Played By row selects the platform again, or Add Platform places an auto-placed one on the open dot. Timing is a status pill in the header (On Time, 12 ms Late, Missed, Stopped, Blocked, Open, as in words.md) with the detail in its tooltip. Without a selection the Project shows the song's file and tempo, the film's frame and length with Fit to Song (the last note plus 1.5 s), and the physics speed. The title bar holds the project's actions in both workspaces: Blender's state as a chip whose menu opens the scene in Blender, restarts it or shows its log, Agent and Export Film….

The default frame is 9:16. It can be changed, but Compose warnings use the chosen frame from the start. The app targets macOS. Project length has no fixed limit; the user decides where the run ends, like the end of a video timeline.

## Onboarding

The same window serves a beginner and a power user; there is no Beginner mode. Help is optional and never blocks the window.

- **Examples open unsaved.** The host keeps an opened example in a temporary location: a folder in the app's cache (`Unsaved Projects`) on macOS, a separate key range in the browser's storage. It autosaves there, so a reload or relaunch reopens it, and it is never listed in Recent. Opening another example clears the earlier unsaved one. The title shows the example's name and, once it has changes, "Not Saved". Save (⌘S) asks where to save it with the save panel and moves the package there with its song and every other file; the project then continues as a normal autosaved project in Recent, named after the chosen file. Closing it with changes (Home, Close Project, New Project, Open Project…) asks "Save changes to Jingle Bells?" with Save…, Don't Save (⌘D) and Cancel; an unchanged example closes silently. Undoing every edit makes it unchanged again; after a reload the autosaved revision counts as a change. Quitting the desktop app does not ask yet, because the unsaved example reopens at the next launch
- **Quick Help** (the ? button in the title bar, ⇧⌘/, Help › Quick Help in the palette) labels the window's regions in place with one line each: Compose and Film, Layers, Library, Tools, Wall (Preview in Film), Inspector, Tracks, Song, Hit Summary, Transport, Blender, Agent, Export Film…. While it is on, a panel at the bottom right of the wall explains the control under the pointer with that control's own tooltip and shortcut; elsewhere in a region it repeats the region's line. The window stays fully usable. Escape, the shortcut, the ? button or the panel's × end it; it is always off at launch
- **First-run hints**: at most three one-line hints, each shown once, where the next step is. "This is your song: each marble plays some of its notes" beside the Song track when a project with a song opens; it goes once the song plays or the project is edited. "Click a note's dot to add a platform" beside the earliest open dot once the song hint is gone (or at once without a song); it goes when a platform fills a note. "Switch to Film to choose the look and export" under the Film tab once an edit leaves every hit on time; it goes when Film opens. Each has a × that dismisses it. A hint counts as seen once it is on screen, which is remembered across launches; Reset Hints in the command palette shows them again. Hints wait while Quick Help is on

## Compose

Compose is the app's editor. It has full direct control and a deliberately small set of pieces.

### Open canvas

This section takes precedence over the step-loop sections below where they differ; it follows the owner's hands-on test.

Compose is an open canvas like Figma. Everything on it is an element the user can add, select, move, rotate and delete freely:

- **Marbles are elements.** Adding a marble with the Marble tool places its release point on the canvas and creates its lane in the timeline. A marble shows its live trajectory and the dots of its lane's hits.
- **Pieces are placed anywhere.** Platforms, windmills and tunnels are drawn or dropped at any point on the wall and act physically at once. Placement on a trajectory is a convenience, not a requirement.
- **Live preview while dragging.** Dragging any element into or across a trajectory recomputes the run continuously and shows what will happen if the element stays there.
- **Hit dots offer a choice.** Clicking a dot opens a small insert menu at the dot (platform, auto-placed platform, and later instrument pieces) instead of placing a platform right away. With the Platform tool active, a click on a dot places one directly.
- **Two ways to attach, both optional.** *Anchoring* attaches any element to a moment on a marble's trajectory, so it follows upstream edits; it plays no note. The moment is stored against the lane's hit before it, or its first hit when it comes earlier, so a lane needs at least one hit to anchor to. *Linking* is only for music platforms and only onto hit dots, which are special: clicking a dot with the Platform tool, or dropping a platform on a dot, links it so it plays that note. Unlinking or unanchoring keeps the element where it is. There is no separate pin: a linked or anchored element follows its hit, and an element is kept in place by detaching it with the Detach button on its tie row. Older projects with pinned pieces still load; editing such a piece's link drops the pin. Windmills, rails, tunnels and switchbacks never play notes.
- **Rails and tunnels are drawn with one vector path tool**, like Figma's pen, not a freehand brush: click to add points, drag to pull out curve handles, Return or a click on the first point to finish. Points and handles stay editable afterwards. A drawn path is a rail by default (B); U arms the same tool for a tunnel. The inspector's Rail | Tunnel control switches a path piece between both in one undo step, keeping its path, its free pose or anchor and a custom name; the other type's parameters start at their defaults.
- **Assists are contextual.** Place Next Platform, Repeat Last Platform, Mirror Last Platform, Add Platform and Continue Pattern appear in a small contextual bar next to the selected last piece or the next open dot, like Figma's selection toolbar, and their keys keep working. The tool rail beside the canvas holds tools only: Move, Hand, Marble, Platform, Path and Insert. Insert (⇧I) opens a library of every piece with a preview of its real geometry and a one-line tooltip: Rail, Tunnel, Platform, Windmill, Switchback and Marble. A click arms the piece's tool and dragging a tile drops the piece where it is released, with the same link and anchor rules as a move.
- **Transport lives in the timeline.** Go to Beginning, previous and next hit, Play and an LCD time readout that accepts a typed time sit in the timeline header, like Logic's control bar, with Final Cut's zoom slider at its right. The window toolbar keeps the workspace switch and panel toggles.
- **Preview Film Camera.** The canvas switches between Wall View, for editing, and Preview Film Camera, which plays the run through the film's follow camera in the flat Compose look and in real time, like Blender's camera view. It previews; camera settings stay in Film. Placement, rhythm and framing are judged here before anything is rendered.
- **Speed is a project setting.** The Project inspector shown without a selection sets the Marble Speed (gravity scale, 0.05 to 2). New projects use half of Earth's gravity: with the 1.5× kit and hits 0.3 s apart an Add Platform hop then spans about 1.4 bar lengths and drops 8 cm, where full gravity spans about 1.9 and drops 12 cm, at 0.58 instead of 0.93 m/s. Slower speed gives smaller hops and denser columns while every linked hit stays on time. Platforms keep their own bounce. Very fast rhythms need care at the default: a mirrored zigzag of hits 0.3 s apart hops only about half a bar, so its bars overlap; 0.4 s apart it zigzags cleanly.

### Music lanes

Each marble has one lane, shown as its track. A note of the song belongs to exactly one place: a marble, which strikes it as a hit, or **Backing**, which is heard in the film and needs no piece. The timeline's left column is **Tracks**:

- **Song** on top: the song's file name and kind ("MIDI · 120 BPM" or "Recording · 0:35"), a waveform with beat ticks for a recording and an overview of every note for MIDI, marble colours and Backing in grey. A MIDI song expands into a piano roll of every note. Click selects a note and plays it, Shift-click adds one, dragging on empty space selects a box of notes. Pressing 1 to 9 hands the selection to that marble in track order and 0 makes it Backing; the context menu lists Play With · each marble · New Marble · Backing. A new file of the same kind replaces the song; Remove Song keeps the marbles and their hits.
- **One track per marble**: name, instrument, Mute and Solo, and its hits in a flat row drawn by timing status: a green diamond On Time, an amber circle Early or Late, a red square Missed, Blocked or Stopped, a hollow diamond Open. Shapes differ so colour is never the only signal; the tooltip names the status. A track with pitched hits expands into a piano roll of just its notes, one row per semitone, where a note drags in time and in pitch and a key of the keyboard strip plays its note. Right-clicking a hit offers the same Play With entries.
- **Camera** last, in Film only: the shots as markers. Compose leaves it out so its timeline stays about notes and hits.
- Handing a note to another marble or to Backing keeps the note and its ID, as one undo step. The platform that played it goes with it: to the other marble's run, or removed for Backing, and a notice says which. A piece that follows the marble at a moment keeps that moment, tied to the lane's nearest remaining hit, and stands Free only when no hit is near enough. A Free platform is on the wall from the start, so the run after it can change.
- The hit summary at the left of the timeline header reads "12 of 12 hits on time", or "2 hits need attention" when hits are early, late, missed, blocked or stopped; clicking it selects the first such hit's platform, frames it and moves the playhead there. Open hits count toward the total only.
- The hit inspector's Played By section has a Marble pop-up with every marble and Backing; choosing one hands the selected notes over like the number keys. A Backing note shows as "Note 3" with its pitch, velocity and time.
- A hit has a time and a sound, either a pitch or a sample; MIDI notes also keep their length
- MIDI import keeps every note. Marbles play the notes of the checked tracks: a marble plays one note at a time with at least 180 ms between hits, so chords spread across marbles up to the chosen count, or keep their top note. Every other note becomes Backing: chord notes no marble can take, notes too close to the previous one, and the unchecked melodic tracks. Drum tracks are left out, since the instrument bank has no drums. The import sheet shows a row per marble and one for Backing with their note counts.
- Audio import suggests hits from detected onsets. Tap-along records hits while the song plays.
- An empty project starts with hits clicked or tapped onto lanes
- The user decides where the run ends. There is no fixed length limit in the UX.

The track column is the timed part of the project's outline in the sidebar's Layers tab, in the same order. Layers lists the whole project in both workspaces: the Song, each marble with the pieces it plays or that follow it in hit order, Free Pieces, the Camera with its shots and Titles. Rows that also have a track carry a track glyph, and selecting a row or its track selects both. Camera, shots and titles belong to Film, so clicking one in Compose opens Film. One Add menu (+) sits in the Layers tab row and the track column header: Add Marble, Add Piece ▸, Add Title, Add Shot and Import Song… (Replace Song… and Remove Song with a song); an item of the other workspace opens it first. The sidebar's second tab, Library, holds the pieces to place in Compose (click arms, drag drops) and the themes and skins in Film; each workspace remembers its tab.

Sound depends on the source:

- MIDI hits play through a sampled instrument chosen per lane, so composing the track feels like composing music. Backing plays on its own channel with the notes' MIDI lengths, in the song's first MIDI program when the instrument bank has it, otherwise piano. Soloing a marble silences Backing. The same sounds render the film soundtrack.
- An imported recording already contains the music. Hits only mark when the marble should strike, and no extra sound is added.

### Pegboard view

The track lives on a wall. Pieces move in the wall plane, rotate only around the wall normal and keep a fixed distance from the wall. The marbles are locked to the wall plane, which keeps trajectories predictable.

The camera faces the wall in 2D by default. Orbit is available but not required.

The wall shows a dot grid like FigJam, drawn as pegboard holes. Its spacing adapts to the zoom level and doubles as a ruler at real scale. The grid is only a visual signal that Compose is a draft, not the final scene; nothing snaps to it. Pieces use flat, toy-like colors per type, following [marblie](https://github.com/younghoonam/marblie).

Rotation follows Figma: dragging rotates freely around the hit point with a live angle readout, Shift snaps to 5° steps, arrow keys nudge by 1° and Shift with an arrow by 5°. Double-clicking the readout accepts an exact angle. Brackets adjust their length to reach the wall, so a piece never leaves its hit point.

### Pieces

| Piece    | Kind    | Purpose                                                        |
| -------- | ------- | -------------------------------------------------------------- |
| Platform | Music   | Main hit surface; linked to a hit dot it plays that note        |
| Rail     | Scenery | Visible path for long gaps and rolling                         |
| Tunnel   | Scenery | Physical tube that hides the marble; length and slope set the travel time |
| Windmill | Scenery | Moving piece the marble strikes; spins with damping or a motor |
| Switchback | Scenery | Holder for long notes: sloped wire legs with rounded bends that the marble zigzags down for a set time |

Only platforms are music pieces. Scenery never uses up a note: a marble striking a windmill or rolling along a rail is a plain contact, never a hit and never a miss. Scenery is either free on the wall or anchored to a moment on a trajectory, which is how the windmill tool places a windmill: like a rail, on the trajectory, not on a hit dot. The assists never put scenery on a hit. A platform can be anchored too; it then follows the trajectory and plays no note. Free and anchored pieces are environment the marbles may strike; only another lane's music pieces, and the other marbles, count as stray contacts.

A switchback holds the marble in a narrow column: it drops in at the top, rolls down a leg, falls through the opening at the leg's end onto the next leg, rolls through the rounded bend at the wall and back, and leaves through the last opening. Each leg is one bent wire, wall into bend into leg, so the marble rolls through the turn instead of knocking against a corner. Leg count, slope, width and bend radius set how long it holds and how far the marble descends meanwhile. Next offers one for each long gap; it is not on the piece keys.

Switchbacks, rails and tunnels shape the path through long gaps; they do not have to deliver the marble to an exact point. The user places one onto the trajectory and adjusts its length and shape while the live trajectory shows where the marble goes. After it, the marble is in free flight again, and the next hit's platform is placed where the marble is at that note's time, so the hit stays on time.

Each piece type is one self-contained definition with a physics shape, a few parameters and a default skin. New projects use a kit one and a half times the Marble Race Kit's size, 24 mm marbles and 9 cm bars, which reads at the reference film's scale; saved projects keep their sizes. Parameters are physical: platform length and thickness, rail radius, tunnel length, windmill blade count, blade length and damping. Adding a piece type later means adding one definition.

Each marble has a release with its own position on the wall and time on the timeline, independent of the first hit. The MIDI import releases each marble 0.5 s before its first note, a short drop, so the film does not open on a long empty fall. Like a clip in a video editor, the release can be moved earlier to leave a gap before the first hit, and that stretch can hold any pieces.

### Step loop

The run is built one hit at a time against a live trajectory:

1. Drag the marble release point. A ghost trajectory shows its fall.
2. A dot marks where the marble will be at the next hit time.
3. Click the dot to add the chosen piece. Auto place picks its angle when it answers within 150 ms; otherwise the piece starts at the default lean and the answer refines it in the same undo step.
4. Rotate it. The trajectory after it updates live and the next dot moves along the curve.
5. Press Next (Return or N) to place the following dot the same way.

Assists inside the loop:

- **Repeat** applies the previous piece's relative angle and offset to the next dot
- **Mirror** applies the mirrored relationship, which produces a zigzag when alternated
- **Add Platform** (A) lets the solver choose an angle that keeps the next dot in frame and consistent with nearby pieces. With several marbles it also sets the platform's bounce so the next dot lands on the shared descent pace (see Several marbles). Before a long gap it gives a short sideways hop that drops the marble beside the piece into the coming switchback.
- **Continue** works like tab autocomplete. When the next hits share the rhythm of the last placed hits, ghost pieces repeat or mirror the recent steps, drawn dashed with their predicted dots and a hint chip next to the first one. Tab accepts them all as one undo step; Escape hides them until the next edit, and any edit asks for fresh ghosts. Ghosts stop before a hit that starts a long gap, stop when the next hit would have no room for a piece, and with several marbles stop when a dot leaves the descent pace.
- **Place Next Platform** (N) does the sensible thing for the focused marble's next open hit: an ordinary gap gets an auto placed platform, a long gap gets a switchback suggestion, or a rail when no switchback fits, shown as a ghost that Return or Tab accepts. The ghost's hint warns when the next dot ends more than 0.25 m off the descent pace. A long gap after the last placed piece comes first, even when the marble falls so far across it that the hit after it has no dot yet. A hit right before a long gap gets a short hop into the switchback instead of bouncing in place.

Assists run in a second simulation worker, so the live trajectory never waits for them. Each kind of assist keeps only its newest question, and answers for an older edit are dropped.

Repeat, Mirror and Continue turn musical repetition into visual repetition. Named patterns can later be saved Continue setups.

Rails and tunnels can also start anywhere on a trajectory: a path drawn from a point on the line is anchored there, so the marble enters it at that moment, and a dropped or dragged one anchors near the line like any piece. A selected rail or tunnel shows an end handle that sets its length and a bend handle that curves it, with the live trajectory following the drag. The inspector reports how the marble rides it, such as "Marble leaves the rail after 1.1 s, then flies 0.12 s to Hit 4".

Guardrails appear while building:

- A gap too long for a bounce offers a switchback, rail or tunnel. A gap is long when one bounce at the descent pace would rise more than 0.4 m at full Marble Speed, about 0.68 s at the pace of a 0.5 s rhythm. The height scales with Marble Speed like every height at a rhythm, so the threshold stays near 0.68 s at any speed.
- A dot turns red when the next hit falls outside the frame or collides with an existing piece

### Recovery

An edit that breaks the run offers its fix where the user is looking, like Xcode's Fix-its, so ⌘Z is never the only way out.

- **Every notice that reports an edit has Undo** ("6 platforms removed: Backing needs no platform" · Undo, "Added 4 platforms" · Undo), like Mail's and Finder's undo toasts. Undo takes back that edit only while it is still the latest. A notice with actions stays 10 s, and as long as the pointer is over it.
- **Re-place after breaking edits.** After each edit Compose compares the hits with the run before it. When later hits became Blocked or Missed, the edit's notice gets "Re-place 24 Platforms" as its first action, or a notice says "3 later hits are now Blocked or Missed" with Re-place and Undo. Undo, redo and Re-place itself never ask. The same action is Re-place Broken Platforms in the hit summary's menu.
- **What Re-place does.** It rebuilds the run like the step loop built it, one problem at a time from the earliest: Auto place again for the platform before the problem (a launch into a bridged gap is tilted as if the gap were open, then its switchback or rail is suggested again, falling back to the other kind); a change is kept only if the problem moves later in the song and no other marble loses a hit. When that fails it steps back up to three more platforms and rebuilds forward, then tries turning one of the two platforms before the problem by hand. A problem nothing fixes is left and Re-place carries on after it; after three such hits on one marble it stops working on that marble. When the marble's first notes went to Backing and its first fall grew long, the release first moves to just before the first remaining note, released so the marble arrives where and how fast it did before; its spin cannot be copied, so the rebuild does the real work. Everything is one undo step, with progress through the song and Stop in the notice; another edit stops it. The result notice says how the run stands, with Undo. Handing the first 6 Melody notes of Jingle Bells to Backing breaks 37 hits; Re-place re-places 29 platforms and brings back 109 of 109 hits on time in about 50 s in Node (149 trial runs); small repairs on reference-20 take 0.1 to 5 s. Bridges the new run no longer needs stay Blocked and are named in the result
- **Re-place for one platform**: the wand beside a Blocked, Missed or Stopped pill in the inspector header runs Auto place for that platform alone. A Blocked spot often needs the platform before it re-placed, which the hit summary's Re-place Broken Platforms does; the notice says so when one platform cannot be fixed alone.
- **Open notes that cannot get a platform** get a status: Too Soon (before the release, or before the marble has fallen its diameter and reached strike speed) or Out of Reach (the marble fell out of the run or lies still). The hit is drawn hollow amber in the timeline, its inspector header shows the pill with the reason, Played By offers Move Release Earlier or Later when that fixes it and Make Backing, and Place Next Platform (N) explains the earliest such note of the focused marble instead of skipping it: "Hit 1 is too soon for Marble 1. Move the release earlier or make it Backing." The hit summary counts them as needing attention.

### Editing earlier pieces

The track behaves like a parametric history. Pieces are bound to their hit. Their position comes from the trajectory and authored tweaks are stored relative to it. Changing an earlier piece re-simulates from that piece onward. Later pieces follow the new trajectory and keep their tweaks. A free piece keeps its position when the trajectory moves.

The playhead works like a rollback marker. The trajectory after it is drawn in a quieter colour, so the user builds up to the playhead and continues from there; pieces keep their full colour.

### Several marbles

All marbles share one physics world. The world is simulated ahead of the playhead to draw every marble's trajectory line. Marbles can collide with each other and with any piece, and a collision between marbles can be an intended effect with its own sound. Compose shows marble contacts as markers on the timeline.

Shared collisions couple the lanes: editing one marble's track can change another's timing. Compose reports newly created or removed marble contacts after each edit so the effect is visible.

One camera frames every marble, so the marbles must stay together:

- **Lanes side by side.** Each marble gets a lane 0.26 m wide, about three bar lengths of the default kit, and the lanes sit side by side 0.26 m apart in the order of the releases from left to right; the MIDI import places new marbles that far apart. Each marble's assists keep its dots and path inside its own lane.
- **Shared descent pace.** The project has a target height y*(t) that falls at a constant rate, the steady descent of the default bounce at the median hit interval of all lanes, anchored at the earliest hit. It falls at least fast enough that a zigzag's bounce stays 6.5 cm below the piece two hits back, which the marble passes on its way to the next piece of that column; at the default half Marble Speed and a 0.5 s rhythm that is 0.30 m/s instead of the default bounce's 0.26 m/s. The assists keep every marble's dots within 0.25 m of y*: Auto place solves each platform's bounce for it, Continue drops ghosts that leave it and switchbacks hold the marble through long notes so it leaves near it. A marble below the pace climbs back half way per hit; a marble above returns at once. The simulation result carries the pace so the film camera can follow y*.

With one marble the frame is the film frame (0.59 m at the default camera distance) and the pace is only a reference for the camera: Auto place keeps the steady speed of the default bounce, which falls at the pace rate for a regular rhythm.

A hit sounds only when the marble strikes its piece. A first contact slower than 0.3 m/s along the contact normal, such as a marble resting or rolling onto a piece, counts as missed, and the inspector's status pill shows it as Stopped.

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

## Film

Film is art direction. The user chooses, describes and toggles. Blender is the editor for fine work.

The Film workspace supports:

- Selecting an object by clicking the rendered preview through an object ID pass, or the Draft Preview
- Applying skins, effects and themes from the library
- Asking an agent to change a selected object or the scene
- Adjusting the few parameters a preset exposes, such as color, light intensity or text
- Clicking the wall to place text or a decal
- **Open in Blender**, from the title bar's Blender chip or the command palette, which opens the scene in a Blender window

The Film workspace has no transform handles. Each change needs a Blender render, so dragging would feel slow and duplicate Blender.

The Film sidebar's Library tab is the library, one list without storage scopes. With nothing selected it shows the themes as cards with a rendered still of Jingle Bells (the Colour by Note still when that option is on) and an In Use badge on the current one; a click applies the theme. Below them, New Theme with Agent… opens the agent chat with "New theme: " and one mention per piece type in the project; each mention starts its own run, so the agent returns one skin Result per type, and accepting a Result from a New Theme request skins every piece of that type. There is no theme artifact yet: a new theme is a set of accepted skins on top of the current theme's wall and light. With pieces selected the Library shows that type's skins: the current theme's first (its default, then variants such as Brass's Copper, Silver, Device, Copper Device, Key and Knob platforms), then skins made with the agent or imported. Each tile has a rendered preview, its origin as a quiet line (Brass Theme, Made with Agent, Imported) and an In Use badge when a piece of the project shows it. Click applies to the selected pieces of that type, ⌥-click to every piece of the type; with several pieces selected the tiles follow the type most of them have, so a section selected as a range in Layers (Shift-click its first and last platform) gets its own look in one click, as in the Brass Sections example, and the Library's help says so; the context menu says the same and has Keep in Library and Remove (disabled while the item is in use). Library items can also be dragged onto a piece in the preview or the inspector's Look panel. Search filters the visible tiles. Colour by Note is a checkbox under Theme in the Project's Look panel; it is one undoable edit and changes the Film only (the Compose canvas keeps piece colours). The inspector shows the Project without a selection (Look, Camera, Titles, Export), a piece's Look and Link panels, or a selected title's Text and Position.

Film owns lighting, the wall, titles, effects, decorations and the camera.

### Library

Skins, effects and wall decorations are Blender assets. Each item is a `.blend` with packed textures and a small manifest with its role, compatible piece type, fitted parameters, contact surface, reaction parts and thumbnail. The app reads manifests without starting Blender. The library folder is registered as a Blender asset library, so it also appears in Blender's Asset Browser.

- The app ships preset themes with ready skins for every piece type. The pegboard look of Compose is one of them, for users who want that style in the film.
- A project copies the items it uses into its own assets, so it stays portable
- **Keep in Library** (the star on a tile) copies an item into the global library so it shows in every project; unstarring removes that copy. Applying a kept item copies it into the project silently
- Built-in theme skins are not library files: the Blender worker builds them, and their previews are rendered by `blender/tests/render_skin_previews.py` into `public/skins/`
- An accepted Result's manifest records `origin: "agent"` (Made with Agent); items without it read Imported
- Applying a skin to a piece type also applies it to pieces placed later

### Agents

The agent is one shared chat per project, opened from the title bar's Agent button or ⌘J in Compose and Film. Selecting an element mentions it in the composer, and typing @ mentions any layer. Sending starts one run per mentioned piece, or one scene run when only the scene or marbles are mentioned or nothing is; each run reports as one status line that expands to its steps, and its candidate comes back as a card to accept or discard. The conversation is the project's agent runs, so it persists with the package.

An agent works on a mentioned object or the scene, such as "make this platform a piano key". Its brief includes the piece's contact surface, hit times and reaction slots, so the model fits the physics shape and rigs its reaction. The agent builds the candidate in a headless Blender. Its preview appears in the chat and as a temporary candidate in the scene preview. Accepting it moves it into the project library and applies it; declining removes it.

The clearance check warns when a skin intersects the marble path.

### Reactions

A reaction animates part of a skin from the hit value, such as a key pressing down, a bell wobbling or a light flashing. Reactions are visual and never change the physics. Keep presses small so a resting marble does not appear to float.

### Wall text and decals

Clicking the wall places a native Blender text object with font, size, depth and material. Flat prints use decals projected onto the wall. Agents can restyle either.

A title shows for the whole film unless it has In and Out times. The title inspector's Timing panel edits them as `m:ss.cc`, `m:ss` or seconds, like the LCD; a time at the start or the end of the film clears it, and an Out before In is refused. Blender hides the title outside its range and fades it in over 0.25 s after In and out over the 0.25 s before Out (an object property drives a transparent mix in its material, and the title is hidden from renders and the ID pass while it is out). In Film the timeline shows a Titles track after Camera with each title as a clip from In to Out: click selects the title, dragging the clip moves both times, dragging an edge trims one, each as one undo step.

Placing a title selects it and focuses its Text field with the text selected, like Figma's text tool, so typing replaces "Title" at once. A new title takes the theme's title colour (white on Brass, navy on Pegboard; switching the theme recolours titles still in the old theme's colour) and a letter height of 6 % of the film frame at the wall, so it reads on a phone. The Title inspector's Style picks one of four:

- **Wall Title**, the default: text on the wall where it was placed, lit like the pieces
- **Caption**: big text near the top of the frame (its centre 15 % below the top edge), 6 % of the frame height, for 3 s from the playhead
- **Song Name**: upright text in the upper third of the frame (its centre 35 % below the top edge) over the first 3 s of the film, 7 % of the frame height, reading the song's name while the text is still "Title"
- **End Card**: centred text over the last 3 s of the film, 8 % of the frame height

Caption, Song Name and End Card are screen titles, like the overlay titles of the reference films. The exported film draws them onto the frames when it is encoded, centred, with a 0.25 s fade, a soft dark backing and a bold system font, so depth of field can never blur them (3D captions in front of the pieces came out blurred and grey). Blender's previews and its own encoder, used only without FFmpeg, show 3D copies parented to the film camera at 96 % of the way to the closer of the focus distance and the wall, glowing in their colour; drivers on the camera's lens, focus and distance keep their place and size in the frame while the camera moves. Their Size is a share of the frame height in %, shrunk when the text would not fit the frame width, and they have no Depth or Position. The Draft Preview draws them at the same place and size, in the same font, with the same backing and shadow. Like a title preset in Final Cut or CapCut, choosing a style sets its times while the title still has the previous style's own times or shows for the whole film; times set by hand stay. A caption's own times are any 3 s span.

Scene decorations follow the same review as skins. The user clicks a point on the wall and describes the element. The agent creates it there, a preview renders, and the user accepts or declines it. Accepted decorations stay in the project; they enter the library only when the user saves them there.

### Camera

The default camera is a native Blender camera with baked keyframes:

- It follows the smoothed trajectory at a distance from the wall, looking down along the run. New projects stand it 70 cm from the marble at the steep 1.15 rad pitch: a lone marble spans about 9 % of the frame width and the next four pieces are in frame, like the reference shorts' close, tracked shots
- Its target leads the marble, and its roll follows the run's direction slowly
- Shot markers on the timeline, such as wide, push in, roll or close on a hit, with eased transitions. A shot holds for its Hold and then eases back to the automatic camera; Push In and Close-Up hold 2 s by default, Wide and Follow until the next shot, and a Hold of 0 keeps any shot until the next one
- After the run's last struck hit the camera stops following: it settles over a second on the last stretch of the run, so the film ends on the final pieces instead of a marble falling down an empty wall. Loop films keep following and close the loop instead

- It stays readable: it never pulls back past the distance at which a typical piece spans 6 % of the frame width or a marble 3.5 %, nor past three times its set distance. A group of marbles is sized as the camera sees it, with its pitch and roll, so two lanes side by side stay in frame at the closest distance that fits them. Several marbles share the frame only while they fit; otherwise the camera follows the focus marble (the first marble, which carries the melody, or the project's `design.camera.focusMarbleId`) and lets the others leave the frame. A marble counts only until 0.6 s after its last note while another marble still plays: then the camera keeps the marbles that play on, also when the finished one is the focus marble, and lets the finished one fall away. With a shared descent pace from the simulation it frames a group at that pace instead of the bouncing centre
- The wall is generated on every apply to cover the run and everything the camera sees, so the film never shows its edge. A wall edited in Blender is left alone

The Film workspace exposes distance, downward angle, lead, smoothing and shots; the focus marble has no control yet. Add Shot (⇧M, the Add Shot button in the Camera section or the Add menu) places a Push In marker at the playhead at 0.7 times the rig distance; double-clicking the Camera track adds one at that time. Clicking a marker selects it and the inspector shows its Kind, Time, Roll, Distance and Hold. The Camera track draws each shot's span behind its marker: to its hold's end, where a fade shows the ease back, or to the next shot. Choosing a kind applies its preset distance relative to the rig (Wide 1.6×, Follow 1×, Push In 0.7×, Close-Up 0.45×) and zero roll, which the user can then fine-tune. Dragging a marker moves its time in one undo step, and Delete removes it. Markers stay sorted by time. The app regenerates the rail when the motion changes. Editing the rig in Blender takes over the camera, and the app then asks before regenerating it.

### Preview and render

The Film preview is a low-resolution Eevee render of the current playhead from the real scene. Whenever that render is not there (the browser, Blender not installed, starting or failed) the **Draft Preview** stands in, like Final Cut's proxy playback: the app draws the run through the same follow camera (the TypeScript port, with shots; a manual camera falls back to the automatic one) with the Compose renderer's Camera view, and approximates the theme's look in flat colours: Pegboard's hardboard with peg holes and toy colours, Brass's lavender plaster with gold, copper, silver and dark bars, chrome rails and devices, the Colour by Note wheel of the Blender theme, and titles as text at their wall positions with their timing fades. A "Draft Preview" label with a ? sits in the frame's corner. Clicks pick pieces and titles (Shift adds), the Title tool places a title where the wall is clicked, library drops skin the piece under the pointer, and scrubbing and playback move it. When Blender's render is ready it replaces the draft. Placing a title maps the click through the film camera's pose in both previews. A preview clip renders a short video. The final render runs in Blender in the background with progress shown in the app.

Export offers four qualities: Draft (720p, 30 fps), Standard (720p, 30 fps), High (1080p, 30 fps) and Best (1080p, 60 fps); the saved ids stay draft, fast, balanced and best. There is no 4K preset. Draft is for judging placement, motion, timing and the camera quickly: it renders the same scene, camera, frame range, loop and soundtrack with Blender's Workbench instead of the chosen renderer, in solid theme colours with short shadows, cavity and outlines and without lighting, materials, depth of field or motion blur. Its picker entry reads "Draft · 720p · Flat Light", against "Standard · 720p", "High · 1080p" and "Best · 1080p · 60 fps", and with Draft chosen the sheet dims the Lighting choice; the qualities are also in the command palette and the Film inspector's Quality menu. Export Film… (⌘E) opens a sheet with the quality, the lighting (Fast for Eevee or Realistic for Cycles, the engine names only in tooltips), the file name and an estimated time: the frame count times the per-frame time of the last film rendered with that renderer, or of the playhead preview scaled to the film size; Draft without a film of its own uses the typical Workbench time. Above the buttons a preflight checks the current simulation result, like Final Cut's share warnings with Xcode's issue list: a summary line ("115 of 115 hits on time" with a check, or "3 issues · 1 tip") discloses the issues, warnings first. Warnings are missed hits with their reason (no contact, early or late, resting, never reached), blocked, early and late hits, stray contacts (marbles touching each other, another lane's pieces or a free platform; a second bounce on the marble's own piece and rides through rails, tunnels, switchbacks and windmills are expected), with several marbles dots outside their part of the frame and a marble more than twice the pace limit off the shared descent pace, and loop mismatches in loop mode. Tips are open notes and, with one marble, dots outside the frame, grouped per lane. A result for an older revision shows "Checking the run…". Clicking an issue closes the sheet, switches to Compose, moves the playhead to it and selects and frames the hit or piece. Issues never block the export; the default button then reads Export Anyway. The Film inspector's Export panel shows the same summary line. While rendering the sheet shows the frame, elapsed and remaining time and Cancel; it can be hidden while the title bar's Export Film… button keeps the progress as a ring. A finished film plays in the sheet with Show in Finder. Films are rendered into the package's `renders/` folder and then copied to the location chosen in the save panel. Streaming Blender's viewport is a later option if the playhead render does not feel responsive enough.

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

An unlinked object can be relinked, which discards its Blender changes, or pushed to Compose, which adopts its Blender transform as a free piece and re-simulates. Unlinking is offered, never forced. An unlinked physical piece shows how far its visual position is from the physics it represents, because the marble still collides with the Compose position.

Blender changes never sync back automatically. Physics changes timing, which only Compose can show.

## Loops

A run can be marked as a loop so the end of the video flows into its start. A loop needs three matching pieces:

- The music ends on a bar that leads back into the start
- The marble state at the end matches the first frame. A return tunnel or an entry from above the frame hides the transfer, and the run can start with the marble already in motion.
- The camera rig ends where it starts

A loop check compares the first and last frames and reports mismatches.

The app builds a loop by entry from above. The film starts once the first marble has fallen three quarters of the camera distance below its release, so the release point is out of view. The film ends at the project end, and both snap to 1/30 s. Before the end a second instance of the marble replays the marble's own fall into the frame, so the frame after the last shows exactly the first frame, while the marble itself has fallen out of view. The camera blends its last 0.75 s into its poses from before the start, which reads as a quick pan back up the run. The soundtrack contains only the hits inside the loop, with ringing notes at the end carried over onto the start.

With **Seamless Loop** on, the Film inspector shows one state row, "Start and end match" or the number of mismatches, with the loop range, its bars when the tempo is known (from MIDI import) and each mismatch in its tooltip: a hit too soon after the start, a marble still near its entry at the end, a piece still reacting, a windmill at another angle, or a length off whole bars with **Snap End to Bar**. The timeline ruler marks the loop range like Logic's cycle area. Audio projects have no tempo yet, so their loops do not snap to bars.

## Project file

A project is a `.marble` package, a folder shown as one file on macOS. Moving the package moves the whole project to another computer, so every path inside it is project-relative. It contains the project JSON, `scene.blend` and assets. The `.blend` embeds a copy of the project JSON so the scene keeps its context when opened alone. The JSON stays outside the `.blend` so the app opens projects and shows the library without starting Blender.

## First version scope

- Music lanes with a Song track (audio waveform or MIDI note overview), piano roll editing of MIDI lanes, tap-along and hit sounds
- Compose with platform, rail, tunnel and windmill, the step loop, Repeat, Mirror, Continue and reflow
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
- The playhead Eevee preview feels responsive enough for Film
