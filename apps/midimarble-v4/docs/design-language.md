# Design Language

MidiMarble should feel like a native Mac app people already know how to use. When a pattern exists in an established app, use it instead of inventing one. Innovation belongs in the musical track building, not in basic controls.

Blender is the main interaction reference, because the film is finished in Blender and the app should feel like a friendly front end to it. Look at Blender and established apps first. Surfaces follow Apple Photos and native macOS, with the yellow accent. No reference is copied one to one.

| App | Patterns to borrow |
| --- | --- |
| Blender | Outliner, dope sheet, properties, modifiers and Apply, Adjust Last Operation, keyframe vocabulary, shortcuts |
| Figma, FigJam, Paper | Canvas navigation, dot grid, selection, scrubbable fields, layers, inspector, tool rail, Insert |
| Logic Pro, GarageBand | Lanes, playhead, transport, piano roll, Space to play |
| Final Cut Pro | Inspector, clips on a timeline, background render, proxy playback |
| Linear, Raycast | Command palette, keyboard flow |
| Xcode | Start window with templates, issues, Fix-its |

## Rules

Names, labels and every other string follow [words.md](words.md), which takes precedence over wording here.

**One natural place.** Every action has one place. An action that lives in + or a menu gets no extra button beside it; a new control has to earn its place against what it adds to the screen. Before adding anything, ask whether the app must do it for every project or it is one project's content. Content is an asset made in Blender or by an agent, delivered in a Pack. Power users go to Blender.

**Layers hold everything in the scene,** like Blender's Outliner: marbles, Track Pieces, lights, camera, titles, Decor. Settings that aren't things (Gravity, Format) stay in the Scene panel. An empty selection is the Scene, so nothing stays stuck on a selection. Selecting a layer anywhere selects it everywhere.

**The timeline holds what changes over time,** like a dope sheet: Song, marbles and their hits, Camera shots, titles with a time range. A light gets a row only once it animates. Decor and pieces have none.

**Each layer owns its settings** in the inspector. The inspector doesn't repeat rows and keys: Delete, Duplicate and Hidden live on Layers rows, menus and keys.

**The app decides physics; looks are free.** Pieces have a Hitbox, which a marble touches, and a Skin, which never changes it. Decor never collides. Track sets a piece's Shape (Length, Thickness, Depth) and a skin follows it however large. Everything placed in Compose is a piece; everything added in Film is Decor.

**Problems are physics in Compose and clear output mistakes in Film. Taste is never a rule.** Compose: touching, a double bounce, rolling on a platform, the marble passing through something, using the real skin size. Film: a marble out of frame, a title that doesn't fit. A long free fall is a tip. Problems get built out, so correct tracks are easy. No hard-coded taste and no silent clamp: asked values are kept, or the app says why not. There's no look score; Build Track's small tie-break stays only until Patterns replace it.

**Patterns are like Blender modifiers, Flatten like Apply** (prototype, not yet approved by the owner; if undone, this paragraph and the Patterns sections go). A Pattern is an action, with Blender's parallels: Group for Collection, Array with Fit Length for bar Patterns, Curve for rail Patterns, Adjust Last Operation for the inspector after running. A live Pattern's pieces can't be edited one by one. Flatten keeps the pieces and removes the Pattern, so there are no overrides and no hand edits to lose. Patterns are optional shortcuts; by hand stays first-class. Taste comes mostly from Patterns, since every user has different tastes.

**Themes and Packs.** A theme is a preset of parts that only restyles what is there: it never adds or removes anything, and has nothing to edit. Hand changes live on the layers ("From Brass") and the Theme row counts them with a Reset. Everything comes from a Pack; the Starter Pack is always present. Export Pack… is the one action to keep a look. Skins are named for what they are, free of themes. Seasonal content is a Pack.

**One Insert.** + in the tool rail (⇧I) holds what you add, in both workspaces. Skins and themes are chosen in floating pickers from the inspector, with the same panel. Nothing opens in place.

**Familiar, native, canvas first.** System font, menus, light and dark. Little text: explanations sit behind a ? only where a concept needs explaining. Every frequent action has a key and can also be done by dragging. Timing and stale previews are always visible, never behind a check button.

**Song.** The Song is the only sound, and is optional. Timing is shown, not heard. Mute and Solo live on the Song's Parts.

**Agents are collaborators.** The person's own AI app is the chat; the window shows no chat panel. See Agents below.

## Window

The layout, after Paper, stays the same in Compose and Film; only the contents of each region change:

```txt
┌──────────────────────────────────────────────────────────────────────────┐
│ ● ● ● [◧] [⌂] [Compose|Film]   Song    [◉ Blender] [✦ Agent] [Export Film…] [▭] [◨] │  title bar
├───────────────┬──┬──────────────────────────────────────┬────────────────┤
│ Layers        │ ▸│                          [⊙ ▢ ◫]    │ 100% ⌄         │
│  ◇ Scene      │ ✋│                                      │ Scene / Piece  │
│  ♪ Song       │ +│                canvas                │ sections       │
│ ▾● Melody     │  │      (pegboard or Blender preview)   │                │
│    ▭ Platform │  │                                      │                │
│ ▾▢ Track Pieces│  │        [ Next N | Build Track ⇧N ]  │                │
│ ▸▣ Camera     │  ├──────────────────────────────────────┴────────────────┤
│               │  │        ⏮ |◁ ▶ ▷| [0:12.40  0:35.00]     − ━○━ + ⇆  │  transport
│               │  │ Layers │ ruler · playhead · Song, marbles, Camera   │  timeline
└───────────────┴──┴─────────────────────────────────────────────────────────┘
```

- Title bar: one project per window, so there is no tab strip. The traffic lights keep their 72 px inset, then the sidebar toggle, Home (house), which returns to the start window, and the Compose and Film switch (⌘1, ⌘2). The document title sits centered like a macOS document window, with a red "Not Saved" when saving failed and a double-click to rename. A saved project autosaves within a second of each edit, so it shows no edited dot (it only flickered); the tooltip says it saves automatically. An unsaved document such as an opened example shows no dot (its autosave is internal) and a quiet secondary "Not Saved" once it has changes, like the Edited of an untitled macOS document. On the right, the project's actions, the same in Compose and Film: the Blender button, the Agent button (sparkles and label; pressed while its menu is open; it pulses and reads Working while an agent works), **Export Film…** (⌘E), then the timeline and inspector toggles. Blender and Agent share one secondary style, Export Film… is the one accent button (see Controls). Quick Help has no button here: it is in Help › MidiMarble Help, ⇧⌘/ and ⌘K. Toggles say Show or Hide in their native tooltip
- Export Film… is the window's one accent button and the only export button. While a film exports with the sheet closed it carries the progress as a small ring before its label, like Final Cut's background tasks; a finished or failed export leaves a green or red dot until the sheet is opened again. The tooltip names the step ("Rendering frame 120 of 600") and a click shows the sheet
- Sidebar, full height and translucent like Finder and Photos: a row with the word **Layers** in 11 px semibold, then the list
- Layers is the outline of the whole project, in Compose the Song and the marbles with their pieces, in Film every layer, drawn like Figma UI3's layer list: 28 px rows, a 16 px disclosure column, one 16 px indent per level, a 14 px type icon and the name. In order: the **Song** (only while the project has a song file or Backing notes, a note or waveform icon and the file name), each **Marble** (its color chip) as a group with the pieces linked or anchored to it in hit order, **Track Pieces** as a folder group, newest first, **Camera** with its shots by time (kind and time), and **Titles** as a folder group. Empty Track Pieces and Titles groups are left out. Layers with a row in the timeline carry no glyph, since it read as a Git icon and the shared selection already says it: selecting a layer in Layers selects its timeline row and the inspector, and the other way round, and the other side scrolls to it. Camera, shots and titles belong to Film and are listed there only. A click on a folder group selects its children. The quiet trailing column holds only information: problem badges, the hit time of a linked piece or a shot in 11 px tabular figures (0:03.2), and an anchor glyph for anchored pieces, as well as the ? of a group. Slots are reserved: piece and Decor rows keep the toggles' space at the right edge, so the eye keeps one column down the list, and on hover the lock and eye appear in it (they stay visible while on) without moving or hiding the name or the trailing column. A long name truncates before that space. Hover draws a hairline outline; selected rows are tinted, the children of a selected marble or the Camera and a marble whose hits are selected get a lighter tint, and adjacent highlighted rows join into one block. Hidden and locked are view state. Click selects, ⌘-click toggles, Shift-click selects a range, double-click or Return renames marbles, pieces and titles, Up and Down move the selection, Left and Right fold a group
- Tool rail, 48 px, between sidebar and canvas. Compose: Move, Hand, then Insert (+). Film: Move, then Insert (+). Insert opens its popover beside the rail: two columns of tiles with previews, in Compose Track (Marble, Platform, Rail, Tunnel, Windmill, Bowl, with their keys O, P, B, U, W) and Song while there is none (a click arms the tool, a drag drops the piece on the wall, the armed tile has an accent ring), in Film Titles, Decor, with Scatter Decor… and Add Pack… as full-width buttons, Light and Camera, then Song and Marble (a click adds, a drag onto the viewer places; Light and Shot only click). T still places a Wall Title in Film. Tooltips open to the right with the name, one line of help and the key
- Inspector: in Compose a top bar with only the zoom and its menu (zoom, fit, Snap and Follow); Film has no zoom and no top bar. Then the header row and sections for the selection, or the Scene without one
- Timeline: spans canvas and inspector at the bottom. Its header holds the transport like Logic's control bar, centered: Go to Beginning, Previous Hit, Play, Next Hit and the LCD time readout, then Final Cut's zoom slider at the far end
- Nothing floats over the canvas except feedback and the contextual build bar: the Snap and Follow toggles sit in its top right corner
- Sheets, the ⌘K palette and context menus are unchanged
- A start window offers New Project, Import Song… (one panel for a MIDI file or a recording) and Open Project…, recent projects and examples grouped as Songs and Techniques. Each example shows a 28 × 48 px portrait still of its run rendered in Blender (`public/examples/<id>.jpg`, 160 px wide), like Xcode's and GarageBand's template pickers; a recent project shows its folder, and nothing in the browser.

The inspector follows Figma UI3's properties panel. A 56 px header row holds a 32 px icon tile, the name (click renames it in place), the type below it and, where it applies, a status pill on the right. Sections have flush-left 11 px semibold titles with a chevron that appears on hover and collapses them, hairline separators and 16 px side padding; a section without content shows only its title row, like Figma's Export section. Fields sit on one two-column grid with 8 px gaps and carry their label inside: X, Y, ∠ for the angle, L for length, or a short word such as Pitch, Frame or Skin, with the full name in the tooltip. Open and closed sections are remembered per section.

- Piece: a Rail | Tunnel segmented control for drawn pieces; a Rail's Layout; Position (X and Y, ∠, L and Slope on a Rail or Tunnel, Lands At for a platform that plays a note; X and Y dimmed while the piece follows its hit); the tie; the Shape panel (Length, Thickness, Depth…) and the collapsed Physics panel. A live Pattern's Group shows only Depth under Shape. The header subtitle names the tie: "Plays C4 · 0:03.2", "Follows Marble 1 at 0:03.2" or "None". The tie section is one row that selects what the piece is tied to, with Detach as its icon action; a piece tied to nothing has no such panel. The header pill shows the timing, with the words of the Timing statuses table in words.md, or what the marble does on a Rail or Tunnel (Rides 1.2 s, Still Riding). Several pieces show the shared fields with Mixed where they differ. In Film a piece shows its Skin section
- Hit: the header names the hit and its marble with the timing pill; Note edits Pitch (a note name with a semitone stepper; arrows step a semitone, Shift an octave, and a change plays the note), Velocity and Time. Played By is a row that selects the platform, or Add Platform, which places an auto-placed platform on the open dot
- Marble: in Compose a Release (X, Y), though the marble's ring drags on the wall; its label color is chosen on its row, its film color in its Skin
- Scene (nothing selected): Film has the Theme row and Format; Compose has Gravity. The length is the transport's second time and the ruler's end marker. Quality is in the Export sheet
- Song: the file and its kind, tempo and meter when known, Replace Song… and Delete Song, then Backing (its note count and the Sound it plays with)
- Camera: Automatic or Manual with Distance, Turn, Tilt and Sway, the framing problem at the playhead with its fix, and Reset Camera

Explanations sit behind a ? icon or in a tooltip, never as text in a panel. The timeline is resizable from its top edge and collapsible; its height is remembered and double-clicking the edge resets it.

## Canvas

The canvas is open like Figma: every element is placed with its tool, moved by dragging and turned with its grip.

- Move (V) selects, drags and turns. Dragging a piece moves it with the pointer every frame while the run behind it re-simulates as a what-if; the trajectory shown is where the marble goes if the piece stays there
- Every what-if says what it does to the run beside the pointer: "Breaks 86 hits" in red or "Breaks no hits", in the drag chip and, before the click, while an armed Windmill hovers over a trajectory or a dot, or the Platform tool over a trajectory. The hover shows the piece the click would add and the run with it. A windmill added on a trajectory follows the marble beside its fall, its arms clear of every marble's path and every piece, so adding one keeps the run; dragging it into the path makes the marble turn it
- Dragging a platform that plays a note keeps Plays, like Final Cut's connected clips: the chip beside it reads "Plays Hit 3 · C4" with the timing it would get there, live (On Time, 12 ms Late, Missed), a dashed ghost and ring stay where it was, and it stays where it is dropped. On its own dot it follows its note again. Only ⌥ or a drop more than 25 cm from its note (the chip then reads "Detaches Hit 3 · C4") frees it, with a notice and Undo; Fix or A puts it back on its note
- Drops attach like Figma's snapping, with a chip beside the piece saying what will happen: over a hit dot a platform links (accent ring on the dot, chip "Hit 4 · C5") and plays that note; near a trajectory any piece anchors to that moment (chip with the marble and time); elsewhere it stays free. Hold ⌥ while dragging to drop it free; the magnet toggle in the canvas corner and View › Snap turn snapping off
- Shift keeps a move on one axis and snaps rotation to 5°, 15° while placing
- Marble (O) releases a new marble where clicked and adds its lane. Platform (P) places a free platform on click, or orients it along a drag; on a hit dot it places an auto-placed platform right away. Rail (B) draws a rail and U arms the same tool for a tunnel; the drawn path anchors when it starts on a trajectory. Windmill (W), armed from the Insert library, place free on click, or anchor where a trajectory is clicked
- Insert (+, ⇧I) opens a 268 px popover beside the rail like Figma's assets and Paper's insert panel: Track (Marble, Platform, Rail, Tunnel, Windmill, Bowl) as two-column tiles, its tooltips beside the panel, level with their tile, so its scrolling never clips them, and an armed Platform, Windmill or Bowl follows the pointer over the wall. A Rail's layout is chosen on its inspector, not here. Each tile shows its real default geometry from the piece definition on a canvas-colored well, with the marble and a dashed line for what it does, the name and its key; the one-line description is the tile's tooltip. A click arms the item's tool (a tunnel arms Rail's drawing with that type) and the armed tile has an accent ring; dragging a tile past 4 px closes the popover and shows the piece on the wall under the pointer with the move rules (link to a dot, anchor near a trajectory, ⌥ for free), outside the canvas a small ghost tile follows the pointer. Escape or a press outside closes it. The + button lights up while a tile's tool is armed
- Rail (B) draws rails like Figma's pen: click adds a point, dragging pulls symmetric curve handles (⌥ moves only the outgoing one), Return or a click on the first or last point finishes, Backspace removes the last point, Escape cancels. The run follows the rail while drawing. A rail that starts on a trajectory is anchored there. A selected drawn rail shows its points and handles for editing; ⌥ breaks a handle's symmetry
- Clicking an open note's dot selects the hit and draws its platform as a dashed outline, tilted to land on time, as the hint says; clicking again, ↩ or N adds it and Esc or a click elsewhere takes it away. A long-gap dot shows its Rail the same way and a dot no platform can reach says why, as N does. Every hit has the same dot, solid with a small outline ring: the marble's color while open, green when on time, a little larger in amber or red when it needs attention. The next open dot and every dot that needs attention pulse. A click rings it and selects the hit; a click on the platform selects the platform and leaves the dot alone. Right-clicking it opens its menu: Add Platform, and for a long gap Add Rail, Add Rail: Switchback, Add Rail: Chain and Add Tunnel, then Go to Note
- The contextual build bar sits under the selected linked piece, or under the next open dot when nothing is selected, like Figma's selection toolbar: Next (Place Next Platform) and Build Track, and, when the rhythm repeats, Continue Pattern with the count. Keys R, M and A work everywhere and stay in the Track menu; the wand is Fix under a piece's pill. It hides while dragging, drawing, playing or when its target is out of view
- Pieces use flat toy colors: platform coral, rail blue, tunnel violet, windmill green. Every piece keeps a visible minimum size at any zoom, and marbles keep a minimum on-screen radius
- Suggestions are ghosts: dashed, see-through pieces with dashed dots; in dark mode the outline is lightened and the fill raised to 40 % of a lighter tint, so a ghost never reads as a solid bar. They hide while an element is dragged
- Pieces the marble has not reached yet at the playhead keep their full color, so they never read as pale suggestion ghosts; the trajectory after the playhead is drawn quieter and shows what is still to come
- Two-finger scroll pans, pinch zooms, Space and drag pans
- ⌘+ and ⌘− zoom, ⌘0 zooms to 100 %, ⇧1 shows the releases, the pieces and each marble's run up to its last placed hit and the next open dot (not the free fall past it), however small; a person's Build Track ends with it. ⇧2 fits the selection. After tapping stops or a song is imported the view glides to the next open dots when they are out of view, with room for the hint and the build bar. Coming back from Film keeps the view
- Track has three views, **2D**, **3D** and **Camera**, a switch at the canvas's top right, with Snap and Follow beside it in 2D only. 3D is a free look around, like orbiting Blender's viewport, and choosing 2D eases back to front-on. Camera is Blender's Camera view: the whole canvas through the film's camera, the Format's frame marked and 60% black beyond it; with the Camera layer selected a drag orbits. Both show the plain Pegboard look, pieces and marbles in their Label Color; they select and play, nothing drags. Film is always through the camera, in the real look, on a plain neutral around its frame.
- Follow sits at the canvas's top right beside Snap: a locate glyph (LocateFixed) with an accent fill while on, F, and the tooltip "Follow the marble at the playhead · panning turns it off". It is a toggle with `aria-pressed`, like Snap, and its state shows the moment a hand pan turns it off
- The dot grid fades between densities while zooming
- Projects open in the film-frame view, with the marble in the upper third; the canvas follows the marble only while Follow is on, and a piece placed by an assist glides into view

## Selection and editing

- Click selects, Shift-click adds, dragging on empty canvas draws a marquee, Escape clears
- Selecting a piece moves the playhead to its hit, unless playing, so the piece is never shown ghosted
- Long-gap dots are diamonds with a dashed ring; their insert menu offers Rail, Rail: Switchback, Rail: Chain and Tunnel. Dots outside the frame are red and say by how much
- Delete removes, ⌘A selects all pieces, ⌘Z and ⇧⌘Z undo and redo. Duplicate (⌘D, like Figma and Finder) copies the selected pieces as free pieces a little right of and below them, with the next default names, or the nearest spot clear of every marble's path and every piece, checked with a what-if; without one nearby they go beside the run at their height and the notice says so, and if even that would break hits nothing is copied. A copy never changes a hit. A note has one platform, so a copy never plays it. ⌘D is Don't Save only while the save alert is open. Repeat and Continue copy a piece onto the next hits
- Right-click selects what is under the pointer and opens a context menu with the same commands and shortcuts as the palette: pieces (Fix, Rebuild From Here, Zoom to Selection, Duplicate, Rename, Delete; in Film only Rename and the piece's link), open dots (place any piece type, bridge a long gap), marbles and lanes (Add Hit, Rename, Delete Marble), timeline hits (Go to Hit, Play from Hit, Select Piece, Move to another marble, Delete) and empty canvas (step loop and view)
- Numeric fields scrub when dragging their label, like Figma, and show units: cm, degrees, ms

## Keys

| Key        | Action                                                          |
| ---------- | --------------------------------------------------------------- |
| V, H       | Move and Hand tools                                             |
| O          | Add Marble: the next click on the wall releases it              |
| P          | Platform tool                                                   |
| B, U       | Rail tool, or the same tool drawing a tunnel                    |
| W          | Windmill tool                                                   |
| ⇧I         | Open the Insert library                                         |
| T          | Tap a hit at the playhead in Compose; Add Title in Film         |
| Return, N  | Place Next Platform, or accept the ghosts on screen; Return finishes a rail being drawn. Presses made while the run catches up queue and run one by one, shown as "Next ×5" on the build bar; Escape drops them. With only the Song or Camera track selected, Return goes to the start |
| Tab        | Accept the Continue ghosts or the gap suggestion                |
| Escape     | Close the Insert library or cancel a drag out of it, cancel the drag or rail, then dismiss ghosts, then leave the tool, then clear the selection; in Film it leaves title placing, then clears the selection (a piece, a title or shots) |
| R, M      | Repeat Last Platform, Mirror Last Platform                      |
| A          | Fix; with nothing selected, Next                                |
| ⇧N         | Build Track                                                     |
| ⇧M         | Add Shot at the playhead in Film                                |
| F          | Follow on and off in Compose                                     |
| C          | Repeat Range on and off                                          |
| ⌘0         | Zoom to 100 % in Compose                                         |
| ⇧1, ⇧2     | Zoom to Fit, Zoom to Selection                                  |
| 0          | With notes selected, make them Backing                           |
| 1 to 9     | With notes selected, hand them to that marble                   |
| ⌘Z, ⇧⌘Z    | Undo and redo, also from a focused checkbox, select or segmented control; only text fields keep them for their text |
| ⌘N, ⌘O, ⌘W | New Project…, Open Project…, Close Project                      |
| ⌘S, ⇧⌘S    | Save, Save As…                                                   |
| ⌘I, ⌘E     | Import Song…, Export Film…                                       |
| ⌘1, ⌘2     | Compose and Film                                                 |
| ⌃⌘S, ⌃⌘I, ⌃⌘T | Show or hide the sidebar, inspector and timeline             |
| ⇧⌘/        | Quick Help (MidiMarble Help)                                     |
| ⌥ (held)   | Drop free while dragging; break handle symmetry on the Rail tool |
| ← →      | Previous and next hit, on the marble in focus or from the playhead |
| ↑ ↓      | Tilt the selected platform or the platform of the selected hit (⇧ 5°); in Layers, walk the rows |

In the desktop app WebKit hands a ⌘ key to the page before the menu bar. The studio's key handler runs the command and prevents the default, so the menu bar never runs it a second time; a key the page leaves alone, such as ⌘S or ⌘Z in a text field, reaches the menu bar, which runs the same command. The menu's Undo, Redo and Select All act on the focused text field's text, like AppKit's. The browser surface has no menu bar and keeps the key handler alone.

Return acts as Next only while something is selected or offered; otherwise it keeps its timeline meaning and jumps to the start. One key has one meaning at a time: the editor that holds the selection takes the key, so with notes selected 0 to 9 belong to the piano roll and 0 leaves the camera alone, like Logic's key focus.

## Timeline

- **Transport:** the header centers one group of plain lucide glyphs at 1.75 stroke, like Logic's control bar: Go to Beginning (skip back, ↩), Previous Hit and Next Hit (step chevrons against a bar, ← →), Play or Pause (Space) and Repeat Range (repeat glyph, C; a quiet selection fill while on). Play has no circle behind it; its glyph is filled and keeps the transport's neutral color, and only the icon says Play or Pause, like Final Cut and Figma. Tooltips name the command and its shortcut
- **LCD:** beside the transport a recessed readout shows the playhead time in 15 px tabular figures, the second exception to the type scale, with the length in 11 px secondary. Clicking the time turns it into a field with the time selected: Return goes to the typed time (`m:ss.cc`, `m:ss` or seconds, clamped to the length), Escape or leaving the field cancels, and text that is not a time turns the ring red
- **Zoom:** at the right, Final Cut's zoom slider between − and + glyphs on a logarithmic scale, then Zoom to Fit. Pinch or ⌘ with scroll zooms around the pointer. A newly opened project shows its whole length
- Space plays and pauses, Return jumps to the start, Left and Right move to the previous and next hit
- **Song row:** the Song layer, only while the project has a song file or Backing notes, sits on top of the marble rows with an icon tile (waveform for a recording, a note for MIDI), the file name and its kind with the length or tempo. A recording shows its waveform with onset ticks; a MIDI song shows a strip of every marble's notes in their colors, higher notes higher. Right-clicking it offers Replace Song… and Delete Song. Without a file it reads Song with "Backing · 12 notes". The row is absent while the project has no Song layer
- **Layers column:** the layers that change over time, in the sidebar's order: Song, one row per marble, then Camera and Titles in Film. Its header reads Layers. Clicking a row header selects the same layer as its row in Layers. Dropping a MIDI or audio file anywhere on the window imports it, with the accent drop frame
- **Track headers** stick to the left like GarageBand and stay above everything that scrolls, the playhead included: a round color chip and the name with the hit count below; icon toggles for Mute (speaker, crossed out while muted, gray fill) and Solo (headphones, accent fill) sit on the Song's Parts and a recording's Song row, never on a marble. The toggles stay tertiary until the header is hovered or selected, and a muted track dims its name. Mute and solo are view state and change playback immediately
- **Piano roll:** only the Song layer has one, and only while the song has notes; it expands from its disclosure triangle like Logic's piano roll. The header column then shows a keyboard strip, black keys reaching in from the left and C keys labeled with their octave; clicking a key plays it. The lane shows one 12 px row per semitone over the song's range plus two semitones, black-key rows shaded and a line under each C, and notes drawn as blocks whose left edge is the note's time. Dragging a note moves it in time and snaps it to semitones, as one undo step, and plays it at its new pitch on drop. The expanded state is remembered for the session. It shows at most 240 px and scrolls inside, keyboard strip and notes together, so the canvas and the marble tracks stay in view like GarageBand's editor pane; the header keeps the song's name above the strip. A recording stays a flat waveform row; marble tracks are flat rows of diamonds at one height
- **Repeat Range:** C or the transport's toggle turns it on with the 4 s from the playhead. The range shows on the ruler only while it is on, so moving the playhead can never start one; it and its edges drag. Play starts at the playhead inside the range, else at its start, and tapping along ignores it. View state for the session, never saved, never in the film
- The ruler shows minutes and seconds with minor ticks, a red playhead head and a draggable end bracket for the project length, Logic's end marker. Like Logic's ruler it runs on past the end to the window's edge, so the end can be dragged out, but past the end the ruler is shaded like the lanes, Blender's area past the end frame, and its ticks and times are dimmed, so the film visibly stops at the bracket. The separator line between the ruler and the rows is Film's render bar, like Final Cut's: 2 px of green over the Blender frames rendered, brighter at Fast lighting, and the plain separator elsewhere. The playhead stays inside the scrolling area at every zoom: its head and line pass under the Layers column
- Hits are drawn by status, the diamond being Blender's keyframe shape: a hollow diamond Open, a green diamond On Time, an amber circle early or late, a red square Missed, Blocked or Stopped, accent yellow when selected, and outlined in the accent when their piece is selected on the canvas. A red ring marks hits closer than 180 ms. Notes in the Song's piano roll show who plays them instead: the marble's color, Backing in gray
- Hits are dragged like notes in Logic; dragging on empty track space draws a time marquee that selects the hits it spans; a marble's release is dragged like a clip in Final Cut
- **Titles row:** in Film only, after Camera and only when the project has titles: a type icon, "Titles" and the count in the header, each title as a 13 px clip from In to Out with its text, like Final Cut's title clips, accent when selected. Click selects, dragging moves both times, dragging an edge trims, each one undo step; overlapping clips stack in two rows
- **Camera row:** in Film only, 32 px: a camera icon, "Camera" and the shot count in the header, shots as small amber tabs pointing at their time, like Final Cut markers, accent yellow when selected. Insert and a double-click on the track add one; a marker is dragged sideways to move it. Compose has no Camera row and Layers in Compose no Camera layer, because Compose is about notes and hits

## Status colors

| State                 | Color   |
| --------------------- | ------- |
| Open hit              | Marble color, hollow in the timeline |
| On Time, within 5 ms  | Green   |
| Early or Late (5 to 20 ms) | Amber |
| Missed, Blocked or Stopped | Red |
| Preview out of date   | Dimmed with a label |

Colors always come with a shape or label so they remain readable without color.

## Commands

⌘K opens a command palette with every command, like Linear, Raycast and Blender's F3 search. It groups commands by section, with those of Compose only there and those of Film only there. A search also finds the other workspace's commands, after this workspace's and dimmed with "Opens Compose" or "Opens Film", like Raycast's grouped results; choosing one switches workspace first, then runs it. It matches word starts and extra keywords, shows check marks for toggles, dims unavailable commands and draws shortcuts as keycaps. Commands live in one registry that the palette, context menus, the shortcut handlers and the macOS menu bar share, so a command reads and behaves the same everywhere.

**Menu bar.** The desktop app has a real macOS menu bar, laid out in `src/modules/studio/menu-bar.ts` from the registry and built by the host (`src-tauri/src/app/menu.rs`):

- **MidiMarble:** About MidiMarble, Services, Hide MidiMarble ⌘H, Hide Others, Show All, Quit MidiMarble ⌘Q (AppKit's own items). There is no Settings… item while the app has no settings
- **File:** New Project… ⌘N, Open Project… ⌘O, Open Recent ▸ (recent projects newest first, then Clear Menu), Close Project ⌘W, Save ⌘S, Save As… ⇧⌘S, Import Song… ⌘I, Replace Song…, Delete Song, Add Pack…, Export Pack…, Export Film… ⌘E
- **Edit:** Undo ⌘Z and Redo ⇧⌘Z of the project, Cut, Copy and Paste (AppKit's, for text), Duplicate ⌘D, Delete, Select All ⌘A, Deselect, Rename…, Make Backing, Show First Problem
- **View:** Compose ⌘1 and Film ⌘2 (checked), Show or Hide Sidebar ⌃⌘S, Inspector ⌃⌘I, and Timeline ⌃⌘T, Zoom In ⌘=, Zoom Out ⌘−, Zoom to 100% ⌘0, Zoom to Fit, Zoom to Selection, Snap (Compose only), Show Hitboxes, Follow Marble in View, Audio Scrubbing, Enter Full Screen
- **Insert:** the tiles of Insert, with their keys, for the workspace
- **Playback:** Play or Pause (named for what it does now), Go to Beginning, Previous Hit, Next Hit, Repeat Range (checked)
- **Track:** Place Next Platform, Build Track, Rebuild From Here, Continue Pattern, Mirror Last Platform, Repeat Last Platform, Fix, Add Bowl, Detach; dimmed in Film
- **Window:** Minimize, Zoom, Bring All to Front and the window list (AppKit's)
- **Help:** MidiMarble Help ⇧⌘/ (Quick Help, with AppKit's Help search), Reset Hints

Titles, keys, enabled and checked states come from the registry: Save is dimmed while a saved project has nothing waiting to save, Follow and Snap show their check, the panel items say Show or Hide. Items act in the current workspace and are dimmed where they do not apply, such as Zoom In in Film. Only ⌘ and ⌃ keys are menu keys; single keys (F, ⇧1, ⌫, Space, T) stay with the window, so typing in a text field never runs a menu command. Items of Playback and Track still show their key after a tab in the title ("Place Next Platform  N"), which teaches it without binding it; the other items with a single key show none.

## Agents

The person's own AI app is the chat: Claude Code, Codex or the Claude app connected through MCP. Keep the window free of chat panels, @mentions and agent settings. An agent shows as a collaborator in a shared Figma file: its name, what it is doing, what it just changed.

- **The Agent button** is a secondary button like Blender's, opening a small menu: the status line, Connect Claude Code, Connect ChatGPT and Codex, Copy Command for Other Apps, Enable MCP, Show Agent Folder. A Connect row reads Disconnect while that app lists this copy of MidiMarble. Its glyph is yellow while an agent is connected, and pulses with the word Working while it works.
- **One place says what's happening:** the notice at the bottom left of the canvas while a call runs, "Agent · Placing Platform 12" with **Stop**. It goes 1.5 s after the last call, and reads don't show it. Stop ends a running Build Track, Fix or export; what's done stays.
- **What an agent changed flashes:** the accent outline, drawn as the selection's, fades in 1 s on the wall and on its row in Layers. CSS animations, so nothing renders per frame. Reduce Motion: it shows for that second with no fade.
- **"This" is the selection,** resolved by `get_state.selection`.
- **Connect is a click.** It runs the tool's own command, with no Terminal and no folder in Documents, which also avoids the Documents privacy prompt. MidiMarble only reads the tool's config, to say whether it lists this copy.
- Every edit is one Undo step, "Agent: Place Platform", in Edit › Undo and its notice.

## Track pieces

A piece is named for what the marble does on it.

- **Platforms bounce.** Rolling belongs on Rails.
- **One Rail, several paths,** like one Blender curve with several splines: one row in Layers, one Hitbox, one Skin. A Rail's Layout generates its paths; none is a piece type. Its skins draw two wires on posts from the wall that end in a ball.
- **A Bowl** collects the marble and holds it, added by hand or by an agent, never by a rule tied to a setting, and deleted like any piece.
- **Timeline:** a Group shows as a block in the marble's Pattern strip, away from the ruler where the playhead lives.

## Film workspace

- Pickers follow Figma's Assets panel and Final Cut's browser: tiles of square rendered previews with a name and a quiet origin line; the current one has the accent ring; In Use is a small dark badge; the Keep in Library star sits in the top-right corner, shown on hover and always when kept.
- Blender's state is on the title bar's Blender button; an agent at work shows on the Agent button and in the notice; an export shows as a ring in Export Film… while the sheet is closed. Open in Blender is in the Blender menu and ⌘K
- The Film inspector uses the same grid and has no prose. A piece shows its Skin section and Blender's link as one row with a dot (Detached with a reset, when it is)
- **Draft Preview.** Wherever Blender's frames aren't there, the app draws the run through the same follow camera, like Final Cut's proxy playback, with the theme in flat colors. View › Draft Preview keeps it on. Picking, title placing, drops, scrubbing and playback work the same on both
- Placing a title uses a crosshair cursor and a floating hint with an esc keycap. A title's inspector has Text, Timing (In and Out as m:ss.cc text fields) and, for a Wall Title, Position
- Sheets (Import, Export Film) drop from the title bar with AppKit-style right-aligned form labels and dialog buttons; Return runs the default button and Escape cancels

## Help and hints

- **Quick Help** follows GarageBand's Quick Help and Logic's Quick Help panel. Each region gets a 1.5 px accent outline and an 11 px label card beside it (a 3 px accent edge, the region name in semibold, one secondary line), placed in the wall's gutters so it covers no controls: the sidebar's and the tool rail's labels stack down the wall's left edge, the title bar's and the inspector's down its right edge, the timeline's in rows along its bottom edge clear of the Quick Help panel, and the wall's own label at its center. Labels and outlines take no pointer events. The panel is a 260 px popover at the bottom right of the wall: "Quick Help" as its 11 px title with a close button, then the hovered control's name in 13 px semibold with its shortcut as a keycap and its detail in 11 px secondary, or "Point at a control to see what it does". Its text comes from the control's existing tooltip (a Figma-style tooltip, a ? bubble, its `title` or a button's label); there is no second help text per control, only the one line per region in `src/modules/studio/quick-help.ts`. Escape closes it unless a menu or sheet takes Escape first
- **First-run hints** are one calm line in a 30 px popover with the raised surface, the popover shadow, a 7 px accent dot, 13 px text, a × and a caret toward the anchor: right of the Song track header and of the next open dot (so it covers neither the marble nor the build bar), and below the Compose and Film switch. Elements mark their place with `data-hint-anchor`; a hint waits while its anchor is out of view. One hint at a time, never during Quick Help, no motion beyond a short fade (none with Reduce Motion)
- **Save Changes alert**: a sheet from the title bar like the other sheets, "Save changes to Jingle Bells?" in semibold, one secondary line "Your changes are lost if you don't save them.", then Don't Save at the left and Cancel and Save… (default, Return) at the right, as in macOS


## Visual style

- System font through `-apple-system`, compact density like Finder and Logic
- Type scale: 13 px for body, list rows, field labels and values, panel headers (semibold), menus and buttons; 11 px for secondary text, captions, units, section headers and ruler labels. The palette search field is the one 15 px exception. Numbers use tabular figures of the system font, not a monospaced font
- Brand yellow from the logo (`#FDE200`) as the accent for selection, focus and primary actions, used like the highlight yellow in Photos and Final Cut Pro, with dark text on yellow
- Selection: the active row is filled with the accent and dark text, like a focused macOS source list; other selected rows are tinted. In dark mode the secondary tint is neutral gray, because yellow over dark gray turns olive
- Follows the system light or dark appearance. Every color is a token in `styles.css` with a dark value; the browser surface paints a window background where the desktop app shows Liquid Glass
- Thin lucide icons at 1.6 to 1.8 stroke in one family; piece icons are drawn to match
- Motion is short and functional; Reduce Motion disables decorative animation


## Controls

- Push buttons are 24 px high; dialog buttons are at least 76 px wide with the default button in the accent, and Return and Escape act on them
- Inspector fields are 24 px high, filled without a border like Figma UI3, with the label inside on the left in 11 px secondary and the unit inside on the right in 11 px tertiary; hover shows a hairline ring and focus an accent ring. Numeric labels scrub on drag and brighten on hover; arrow keys step, Shift steps ten times. Sheets keep 22 px bordered fields
- Relation rows (Plays, Follows, Played By) have a field's shape, a chevron and an optional icon action; state rows (Blender link) have a colored dot, a short label and a ? for the detail
- Title bar secondary buttons (Blender, Agent) are 26 px high with a 6 px radius, like Export Film… beside them: the control fill, a 1 px control border and neutral text, the same in light and dark, after Figma's secondary buttons and Xcode's neutral status display. Hover and the pressed state (Agent and Blender while their menus are open) change only the fill. On Blender its 14 px logo carries the color: Blender's orange when ready and working, with a subtle pulse while working (still with Reduce Motion), red on error, gray when not installed, never green; the word stays neutral. The state word is in the tooltip and the menu; only while Blender works does it slide open beside the name ("Rendering Preview"), after a short wait, so quick updates don't resize the button
- Status pills are 20 px high, tinted in the status color with a dot and the label, with the detail in a tooltip
- Pop-up buttons are native selects drawn with the AppKit double chevron. Checkboxes are 14 px with a 3.5 px radius, accent fill and a dark check
- Menus are translucent with 22 px items, a check mark column, right-aligned shortcut glyphs and section headers. They take keyboard focus: arrows move, Return runs, Escape closes, and they flip to stay inside the window
- Tooltips on window chrome are native `title` tooltips that name the command and its shortcut, and say Show or Hide for panel toggles; the tool rail and the build bar use Figma-style tooltips with a keycap; inspector explanations sit behind a ? icon with a bubble
- Empty states name the next action with a short title in Title Case, one sentence of help and a button where one fits: no song shows No Song Yet with Import Song… at the bottom of the wall; with open hits the build bar waits under the pulsing dot
- Dropping a file shows an accent drop frame over the window, like Finder and Logic
