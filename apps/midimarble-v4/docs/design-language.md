# Design Language

MidiMarble should feel like a native Mac app that people already know how to use. When a pattern exists in an established app, use it instead of inventing one. Innovation belongs in the musical track building, not in basic controls.

Paper (paper.design) is the main reference for layout and interaction: document tabs in the title bar, a full-height left sidebar, a narrow vertical tool rail, a compact right inspector and almost no chrome. Its natural, paper-like look is not copied; surfaces follow Apple Photos and native iOS and macOS, with the yellow accent. The timeline at the bottom borrows behaviour from video editors and Blender and is drawn in the same native style.

Blender is the main interaction reference, because the film is finished in Blender and the app should feel like a friendly front end to it: its timeline and dope sheet for time, its properties editor for structured settings, and its shortcuts where they fit (G, R, Tab, numpad framing). The surface is Apple-native rather than Blender's custom toolkit: system font, translucent sidebar, native menus and sheets. Figma is the reference for canvas navigation and selection.

Reference apps:

| App                   | Patterns to borrow                                                   |
| --------------------- | -------------------------------------------------------------------- |
| Blender               | Timeline and dope sheet, properties sections, keyframe vocabulary, G/R shortcuts, framing |
| Logic Pro, GarageBand | Lanes, playhead, transport, timeline zoom, Space to play             |
| Final Cut Pro         | Workspace switching, inspector, clips moved on a timeline            |
| Figma, FigJam         | Canvas navigation, dot grid, selection, scrubbable fields, components |
| Notion, Linear        | Command palette, keyboard flow, calm visuals                         |
| Blender               | Orbit, camera view (0) and frame shortcuts for users who know it     |
| Xcode                 | Start window with templates, activity view for long jobs             |

## Principles

- **Best parts, not copies:** take the strongest pattern for each job from Paper, Figma, video editors, Blender and native macOS apps such as GarageBand, Logic and Photos, then make them read as one coherent native app. No reference is copied one to one

- **Little text:** labels stay short and explanations live behind a small question-mark icon with a tooltip, so panels stay compact. Icons are fine wherever they are unambiguous and carry a tooltip with the shortcut
- **Figma-like panels:** the sidebar reads like Figma's layers panel and the inspector like Figma's properties panel: compact rows, clear hierarchy, no prose
- **A real timeline:** the timeline behaves like a video editor or Blender's timeline and dope sheet: tracks with headers, a ruler with a draggable playhead, keyframe-style hits, transport in its header

- **Playback looks like a video editor:** play, pause, previous and next hit and the time sit together in the timeline header, as in Final Cut and Premiere. The play triangle is reserved for playback; no other control uses a glyph that could be mistaken for it

- **Familiar first:** a new user should recognize every control from another app
- **Native:** system font, menus, context menus, light and dark appearance, standard shortcuts
- **Canvas first:** panels stay compact and quiet so the track and music lead
- **Keyboard and direct manipulation:** every frequent action has a shortcut and can also be done by dragging
- **Honest feedback:** timing, misses and stale previews are always visible, never hidden behind a check button
- **Progressive depth:** the default path needs no Blender knowledge; depth appears through the inspector, Blender and agents

## Round 2 decisions

From the owner's review of the open-canvas build on 2026-11-03. These take precedence over older sections below until those are rewritten to match.

- **Transport like Logic and Final Cut.** The timeline header holds one transport group of plain glyph buttons (Go to Start, Previous Hit, Play or Pause, Next Hit) with no filled circle behind Play, then an LCD-style time readout in tabular numerals (current time large, length secondary; click to type a time). Zoom sits at the right as a Final Cut zoom slider with a fit button. One icon family and stroke weight throughout; Previous and Next Hit use step glyphs that cannot be mistaken for Play
- **Track headers like GarageBand.** A marble's track header shows a disclosure triangle, the colour chip, the name and the instrument, and icon buttons for Mute (speaker) and Solo (headphones) with tooltips, never bare "M" and "S" letters. A MIDI track expands like Logic's piano roll: a keyboard strip in the header column and one row per semitone over the track's range, hits drawn as notes that drag in time and in pitch. Collapsed, a track stays one compact row of hits
- **The song is project-wide.** A film has one soundtrack: the imported MIDI file or recording, with its tempo. It appears as a Song track at the top of the timeline (waveform for audio, a mini note overview for MIDI) with its file name, and is imported, replaced or removed from the timeline header's add menu or by dropping a file on the timeline. Marbles play parts of it: each marble's track holds the hits it strikes. The World inspector shows Song (file, tempo) and Film (frame, length with Fit to Song); no import buttons hide in a panel named Music
- **Inspector like Figma UI3.** Section titles flush left with no indented disclosure column; fields in a two-column grid with the label inside the field (X, Y, angle, length), aligned to one 8 px grid across sections. No prose in panels; every explanation is a question-mark tooltip. Status shows as a pill in the inspector header (On time, 12 ms late, Missed, Blocked) instead of a Timing section
- **Relations navigate.** An attachment row ("Hit 1 · A4 · 0:00.36") is a link that selects that hit; the hit inspector edits the note (pitch, velocity, time) and shows "Played by Platform 1" as a link back, or an Add Platform action when nothing plays it. Detaching is one icon button on the row. There is no separate pin: a linked platform follows its hit, an unlinked one stays where it is
- **One path tool, two path pieces.** The Path tool draws a Bézier path; the path becomes a rail by default and a segmented control in the inspector switches it between Rail and Tunnel, keeping its shape. There is no separate tunnel tool
- **Insert from a library.** The tool rail keeps Move, Hand, Marble, Platform and Path, plus an Insert (+) button that opens a popover of pieces with a small preview and a one-line tooltip each (Windmill, Rail, Tunnel, Switchback and others), like Figma's assets or Paper's insert panel. Click arms the piece, dragging a tile drops it on the canvas
- **Agent as a shared chat.** The agent lives behind a title bar button that opens a chat panel, one conversation per project. The current selection appears in the composer as @-mention chips and typing @ mentions any layer. Agent progress collapses to one status line that expands on demand; results come back as cards with a preview and Accept or Discard. No agent panel in the inspector and no explanatory subtext
- **One project per window.** The title bar shows the document title with its edited state, Home and the panel toggles; there is no tab strip until several projects can really be open. Blender's connection state sits beside Export, where it matters
- **Layers like Figma.** 28 px rows, one 16 px indent per level, a small type icon, the name, and state glyphs only where they carry information (link or anchor), hover actions on the right

## Window

The layout, after Paper, stays the same in Compose and Design; only the contents of each region change:

```txt
┌──────────────────────────────────────────────────────────────────────────┐
│ ● ● ● [◧] [⌂]                 Song ●                [✦ Agent] [▭] [◨] │  title bar
├───────────────┬──┬──────────────────────────────────────┬────────────────┤
│ Song          │ ▸│                          [⊙ ▢ ◫]    │ 100% ⌄  Export │
│[Compose|Design]│ ✋│                                      │ World / Piece  │
│ Marbles     + │ ─│                canvas                │ sections       │
│  ● Melody 9/16│ ◯│      (pegboard or Blender preview)   │                │
│ Layers        │ ▭│                                      │                │
│  ◯ Melody     │ ✎│        [ Next N | ⟳ ⇋ ✦ | » 7 ⇥ ]     │                │
│    ▭ Platform │ ⊂├──────────────────────────────────────┴────────────────┤
│  ▭ Platform 9 │ ✳│        ⏮ |◁ ▶ ▷| [0:12.40  0:35.00]     − ━○━ + ⇆  │  transport
│               │  │ Marbles  + │ ruler · playhead · lanes                │  timeline
└───────────────┴──┴─────────────────────────────────────────────────────────┘
```

- Title bar: one project per window, so there is no tab strip. The traffic lights keep their 72 px inset, then the sidebar toggle and Home (house), which returns to the start window. The document title sits centred like a macOS document window, with a dot while edited, "Not Saved" when saving failed, and a double-click to rename. On the right: an export pill only while a film exports or just finished (a click shows the export sheet), the Agent button (sparkles and label, ⌘J; a small accent dot while an agent works and the chat is closed), then the timeline and inspector toggles. Toggles say Show or Hide in their native tooltip. Blender's state is not in the title bar; it sits beside Export in the inspector
- Agent chat: a 360 px panel at the right edge of the window, full height beside the inspector and the timeline, so the canvas keeps its width minus the panel and nothing covers it
- Sidebar, full height and translucent like Finder and Photos: the project name (double-click renames), the Compose and Design segmented control, Marbles (like Paper's pages, with + for Add Marble, Place Marble on Canvas and the imports) and the layer list. In Design the layer list stays on top and the library sits below it
- Layers read like Figma UI3's layer list: 28 px rows, a 16 px disclosure column, one 16 px indent per level, a 14 px type icon (a marble group shows its colour chip) and the name. Each marble is a group with the pieces linked or anchored to it in hit order, then the free pieces, newest first. The quiet trailing column holds only information: problem badges, the hit time of a linked piece in 11 px tabular figures (0:03.2) and an anchor glyph for anchored pieces. On hover it gives way to the lock and eye toggles, which stay visible while on. Hover draws a hairline outline; selected rows are tinted, the pieces of a selected group get a lighter tint, and adjacent highlighted rows join into one block. Hidden and locked are view state. Click selects, ⌘-click toggles, Shift-click selects a range, double-click or Return renames, Up and Down move the selection, Left and Right fold a group. An empty list says "No layers" and nothing more
- Tool rail, 48 px, between sidebar and canvas: Move and Hand, then the workspace's tools. Compose: Marble, Platform, Path (rails), Tunnel, Windmill. Design: Move, Text, Asset. Tooltips open to the right with the name, one line of help and the key
- Inspector: a top bar with zoom and its menu (zoom, fit, snapping, wall, orbit and camera view), Blender's connection state as a dot and a short label with the detail in its tooltip, and the Export button; then the header row and sections for the selection, or the World without one
- Timeline: spans canvas and inspector at the bottom. Its header holds the transport like Logic's control bar, centred: Go to Beginning, Previous Hit, Play, Next Hit and the LCD time readout, then Final Cut's zoom slider at the far end
- Nothing floats over the canvas except feedback and the contextual build bar: the view switch (Wall, Orbit, Camera) and the snap toggle sit in its top right corner
- Sheets, the ⌘K palette and context menus are unchanged
- A start window offers Empty, From MIDI, From Audio, Examples and recent projects.

The inspector follows Figma UI3's properties panel. A 56 px header row holds a 32 px icon tile, the name (click renames it in place), the type below it and, where it applies, a status pill on the right. Sections have flush-left 11 px semibold titles with a chevron that appears on hover and collapses them, hairline separators and 16 px side padding; a section without content shows only its title row, like Figma's Export section. Fields sit on one two-column grid with 8 px gaps and carry their label inside: X, Y, ∠ for the angle, L for length, or a short word such as Pitch, Frame or Skin, with the full name in the tooltip. Open and closed sections are remembered per section.

- Piece: Position (X and Y, ∠, L, Contact for a linked platform; X and Y dimmed while the piece follows its hit; L and Slope for a straight rail or tunnel), Attached To and Physics (Bounce, Depth, Thickness and the type's other parameters, closed by default). Attached To is one row that selects what the piece follows: "Hit 1 · B4 · 0:01.00" with the marble's colour dot for a linked platform, the marble's name and the moment with an anchor for an anchored piece, "Nothing, free on the wall" for a free one. The unlink icon on the row detaches it in place. The header pill shows the timing: On time in green, "12 ms late" in amber, Missed, Resting or Blocked in red, with the hit, the offset and the reason in its tooltip. Rails and tunnels show what the marble does on them instead (Rides 1.2 s, Still riding, Not touched). Several pieces show the shared fields with Mixed where they differ
- Hit: the header names the hit and its marble with the timing pill; Note edits Pitch (a note name with a semitone stepper; arrows step a semitone, Shift an octave, and a change plays the note), Velocity and Time. Played By is a row that selects the platform, or Add Platform, which places an auto-placed platform on the open dot
- Marble: the colour swatches and Sound, then Release (X, Y); the header pill warns when hits are too close
- World: Song (the source file and, when known, tempo and meter; imports live in the timeline), Film (Frame, Length and Fit to Song, which sets the length to the last note plus 1.5 s) and Physics (Speed slider with a typeable value)

Explanations sit behind a ? icon or in a tooltip, never as text in a panel. The timeline is resizable from its top edge and collapsible; its height is remembered and double-clicking the edge resets it.

## Canvas

The canvas is open like Figma: every element is placed with its tool, moved by dragging and turned with its grip.

- Move (V) selects, drags and turns. Dragging a piece moves it with the pointer every frame while the run behind it re-simulates as a what-if; the trajectory shown is where the marble goes if the piece stays there
- Drops attach like Figma's snapping, with a chip beside the piece saying what will happen: over a hit dot a platform links (accent ring on the dot, chip "Hit 4 · C5") and plays that note; near a trajectory any piece anchors to that moment (chip with the marble and time); elsewhere it stays free. Hold ⌥ while dragging to drop it free; the magnet toggle in the canvas corner and View › Snap to Dots and Trajectories turn snapping off
- Shift keeps a move on one axis and snaps rotation to 5°, 15° while placing
- Marble (O) releases a new marble where clicked and adds its lane. Platform (P) places a free platform on click, or orients it along a drag; on a hit dot it places an auto-placed platform right away. Tunnel (U) and Windmill (W) place free on click, or anchor where a trajectory is clicked
- Path (B) draws rails like Figma's pen: click adds a point, dragging pulls symmetric curve handles (⌥ moves only the outgoing one), Return or a click on the first or last point finishes, Backspace removes the last point, Escape cancels. The run follows the rail while drawing. A rail that starts on a trajectory is anchored there. A selected drawn rail shows its points and handles for editing; ⌥ breaks a handle's symmetry
- Clicking an open hit dot opens its insert menu at the dot: Auto-Placed Platform, Platform, and for a long gap Switchback, Rail and Tunnel, then Go to Hit
- The contextual build bar sits under the selected linked piece, or under the next open dot when nothing is selected, like Figma's selection toolbar: Next, Repeat, Mirror, Auto Place and, when the rhythm repeats, Continue with the count. Its keys work everywhere. It hides while dragging, drawing, playing or when its target is out of view
- Pieces use flat toy colours: platform coral, rail blue, tunnel violet, windmill green. Every piece keeps a visible minimum size at any zoom, and marbles keep a minimum on-screen radius
- Suggestions are ghosts: dashed, see-through pieces with dashed dots. They hide while an element is dragged
- Two-finger scroll pans, pinch zooms, Space and drag pans
- ⌘+ and ⌘− zoom, ⇧1 fits everything, ⇧2 fits the selection, ⇧3 zooms to the film frame width around the marble
- The view switch sits in the canvas corner: Wall view for editing, Orbit (Blender users can orbit with the middle mouse button) and Camera view
- Camera view, 0 or Numpad 0 like Blender's camera view, toggling back to the view it came from: the canvas looks through the film's follow camera (a TypeScript port of the Blender rig, 50 mm on a 36 mm sensor) at the playhead, live while playing and scrubbing. The film frame sits centred as a viewfinder with corner marks, the canvas outside it dimmed to 78 % canvas colour. Pieces and marbles keep the flat Compose look, all pieces solid and marbles at their real size; trajectories, frame guides, hit dots, badges and ghosts are hidden. A label above the frame says "Camera view · Film camera preview, editing paused" with the 0 keycap. A click selects a piece; dragging, wheel, tools and build keys do nothing until the view returns. Camera settings stay in Design
- The dot grid fades between densities while zooming
- Projects open in the film-frame view, with the marble in the upper third; during playback the canvas follows the marble vertically, and a piece placed by an assist is panned into view

## Selection and editing

- Click selects, Shift-click adds, dragging on empty canvas draws a marquee, Escape clears
- Selecting a piece moves the playhead to its hit, unless playing, so the piece is never shown ghosted
- Long-gap dots are diamonds with a dashed ring; their insert menu offers Switchback, Rail and Tunnel. Dots outside the frame are red and say by how much
- Delete removes, ⌘A selects all pieces, ⌘Z and ⇧⌘Z undo and redo. There is no Duplicate yet; Repeat and Continue copy a piece onto the next hits
- Right-click selects what is under the pointer and opens a context menu with the same commands and shortcuts as the palette: pieces (Auto Place, Rotate, Zoom to Selection, Rename, Delete), open dots (place any piece type, bridge a long gap), marbles and lanes (Add Hit, Mute, Solo, Rename, Delete Marble), timeline hits (Go to Hit, Play from Hit, Select Piece, Move to another marble, Delete) and empty canvas (step loop and view)
- Numeric fields scrub when dragging their label, like Figma, and show units: cm, degrees, ms

## Keys

| Key        | Action                                                          |
| ---------- | --------------------------------------------------------------- |
| V, H       | Move and Hand tools                                             |
| O          | Marble tool                                                     |
| P          | Platform tool                                                   |
| B          | Path tool for rails                                             |
| U, W       | Tunnel and Windmill tools                                       |
| T          | Tap a hit at the playhead in Compose; Text tool in Design       |
| Return, N  | Next: place the next dot, or accept the ghosts on screen; Return finishes a rail being drawn |
| Tab        | Accept the Continue ghosts or the gap suggestion                |
| Escape     | Cancel the drag or rail, then dismiss ghosts, then leave the tool, then clear the selection |
| R, M, A    | Repeat, Mirror, Auto place                                      |
| ⇧M         | Add a camera shot marker at the playhead in Design              |
| ⌘J         | Show or hide the agent chat                                     |
| ⌥ (held)   | Drop free while dragging; break handle symmetry on the Path tool |
| ← →        | Turn selected pieces 1° (⇧ 5°); without pieces, previous and next hit |

Return acts as Next only while something is selected or offered; otherwise it keeps its timeline meaning and jumps to the start.

## Timeline

- **Transport:** the header centres one group of plain lucide glyphs at 1.75 stroke, like Logic's control bar: Go to Beginning (skip back, ↩), Previous Hit and Next Hit (step chevrons against a bar, ← →) and Play or Pause (Space). Play has no circle behind it; its glyph is filled and turns green while playing. Tooltips name the command and its shortcut
- **LCD:** beside the transport a recessed readout shows the playhead time in 15 px tabular figures, the second exception to the type scale, with the length in 11 px secondary. Clicking the time turns it into a field with the time selected: Return goes to the typed time (`m:ss.cc`, `m:ss` or seconds, clamped to the length), Escape or leaving the field cancels, and text that is not a time turns the ring red
- **Zoom:** at the right, Final Cut's zoom slider between − and + glyphs on a logarithmic scale, then Zoom to Fit. Pinch or ⌘ with scroll zooms around the pointer. A newly opened project shows its whole length
- Space plays and pauses, Return jumps to the start, Left and Right move to the previous and next hit
- **Song track:** the project's song sits on top of the marble tracks with an icon tile (waveform for a recording, a note for MIDI), the file name and its kind with the length or tempo. A recording shows its waveform with onset ticks; a MIDI song shows a strip of every marble's notes in their colours, higher notes higher. Right-clicking it offers Replace Song… and Remove Song. The track is absent while the project has no song
- **Add menu:** the + beside "Marbles" in the header column offers Add Marble, Import MIDI… and Import Audio…, and with a song Replace Song… and Remove Song. Dropping a MIDI or audio file anywhere on the window imports it, with the accent drop frame
- **Track headers** stick to the left like GarageBand: a disclosure triangle, a round colour chip, the name with the instrument and hit count below, and icon toggles for Mute (speaker, crossed out while muted, grey fill) and Solo (headphones, accent fill) while lanes are synthesized. The toggles stay tertiary until the header is hovered or selected, and a muted track dims its name. Mute and solo are view state and change playback immediately
- **Piano roll:** a track with pitched hits expands from its disclosure triangle like Logic's piano roll. The header column then shows a keyboard strip, black keys reaching in from the left and C keys labelled with their octave; clicking a key plays it. The lane shows one 12 px row per semitone over the track's range plus two semitones, black-key rows shaded and a line under each C, and hits drawn as note blocks whose left edge is the hit time. Dragging a note moves it in time and snaps it to semitones, as one undo step, and plays it at its new pitch on drop; double-clicking a row adds a note there. Expanded tracks are remembered for the session. Tap-along tracks without pitches do not expand; collapsed tracks keep one compact row of diamonds, placed higher for higher notes
- The ruler shows minutes and seconds with minor ticks, a red playhead head and a draggable end bracket for the project length. Time past the end is shaded like Blender's area past the end frame
- Hits are diamonds, Blender's keyframe shape: hollow until a piece plays them, filled in the lane colour when on time, amber-edged when drifting, red when missed, accent yellow when selected, and outlined in the accent when their piece is selected on the canvas. A red ring marks hits closer than 180 ms. Notes in the piano roll use the same states
- Hits are dragged like notes in Logic; dragging on empty track space draws a time marquee that selects the hits it spans; a marble's release is dragged like a clip in Final Cut
- In Design a thin Camera row under the ruler shows shot markers as small amber tabs pointing at their time, like Final Cut markers, accent yellow when selected. Its + button and a double-click on the row add one; a marker is dragged sideways to move it

## Status colors

| State                 | Color   |
| --------------------- | ------- |
| Upcoming hit          | Neutral |
| Hit within 20 ms      | Green   |
| Drifting but valid    | Amber   |
| Missed or blocked     | Red     |
| Stale preview         | Dimmed with a label |

Colors always come with a shape or label so they remain readable without color.

## Commands

⌘K opens a command palette with every command, like Linear, Raycast and Blender's F3 search. It groups commands by section (File, Edit, View, Playback, Tools, Build, Marble, Design; Tools and Build only in Compose, Design only in Design), matches word starts and extra keywords, shows check marks for toggles, dims unavailable commands and draws shortcuts as keycaps. Commands live in one registry that the palette, context menus and the shortcut handlers share, so a command reads and behaves the same everywhere. The macOS menu bar should list the same commands with their shortcuts, so features are discoverable without the palette.

## Agents

The agent is a shared chat, like Figma AI and Cursor: the Agent button in the title bar or ⌘J opens a 360 px panel at the right edge, in Compose and in Design. A project has one conversation, made of its agent runs, so it survives a reload the way the runs do.

- Composer: a rounded field with mention chips above the text and a round send button. The current selection appears as chips (a piece icon or a marble's colour dot and the name), follows the selection, and a chip's × leaves it out of this message. Typing @ opens a picker of the Scene, the marbles and the pieces above the composer; arrows move, Return or Tab picks, Escape closes. Return sends, Shift-Return adds a line, Backspace at the start removes the last chip
- Sending starts one run per mentioned piece. Marbles and the Scene have no asset of their own and share one scene run; a message without mentions goes to the scene. Each run's prompt names its target, so the reply line keeps its name after a reload
- The user's message is a right-aligned bubble with its mentions in the accent. Each run answers with one status line: its state glyph, the target name, the state and the step count ("Platform 1 · Working · 14 steps"), a stop button while it works. Clicking the line expands the steps and the agent's text; nothing else is shown by default
- A finished candidate is a card with its 16:10 preview, the label and Discard and Accept. The canvas shows the candidate in place while it is pending
- No explanatory subtext. In the browser preview, where no CLI can run, one quiet note above the composer says "Agents run in the desktop app" with the one ? tooltip, and send stays disabled. If no CLI is installed, or a run fails because the CLI is not logged in, a card shows the Terminal command that fixes it, such as `claude /login`, with a copy button

## Design workspace

- Library tiles follow Blender's asset browser in a Finder-style sidebar: two columns of 4:3 thumbnails with a name and a secondary line, a search field, collapsible sections. The applied theme gets an accent ring and a check badge; a selected item gets a grey tile and the ring. Items that do not fit the selected piece type are dimmed
- Blender's state sits beside Export in the inspector's top bar as a dot (green when ready, pulsing amber while starting, updating or rendering, red when missing or failing) and a short label, with Starting, Updating scene, Rendering preview or Ready in its tooltip; agents at work show in the chat and as a dot on the Agent button; an export shows as a pill in the title bar while the sheet is closed
- The Design inspector uses the same grid and has no prose: the Scene shows Look (Theme, Render, Seamless loop with the loop check as one state row and Snap End to Bar when needed), Camera (Rig or Manual, Distance, Pitch, Lead, Smooth, Shots with Add Shot, Take Over Camera), Wall Text (a + in the title and one row per text) and Output (the preflight as one state row, Export Film). A piece shows Look: the skin tile that takes library drops, Skin and Reaction, Apply to All for a custom skin and Blender's link as one row with a dot (Linked, or Detached with the reason and a reset button). There is no agent panel in the inspector
- Placing wall text uses a crosshair cursor and a floating hint with an esc keycap; Escape cancels
- Sheets (Import MIDI, Export Film) drop from the title bar with AppKit-style right-aligned form labels and dialog buttons; Return runs the default button and Escape cancels
## Visual style

- System font through `-apple-system`, compact density like Finder and Logic
- Type scale: 13 px for body, list rows, field labels and values, panel headers (semibold), menus and buttons; 11 px for secondary text, captions, units, section headers and ruler labels. The palette search field is the one 15 px exception. Numbers use tabular figures of the system font, not a monospaced font
- Brand yellow from the logo (`#FDE200`) as the accent for selection, focus and primary actions, used like the highlight yellow in Photos and Final Cut Pro, with dark text on yellow
- Selection: the active row is filled with the accent and dark text, like a focused macOS source list; other selected rows are tinted. In dark mode the secondary tint is neutral grey, because yellow over dark grey turns olive
- Follows the system light or dark appearance. Every colour is a token in `styles.css` with a dark value; the browser surface paints a window background where the desktop app shows Liquid Glass
- Thin lucide icons at 1.6 to 1.8 stroke in one family; piece icons are drawn to match
- Motion is short and functional; Reduce Motion disables decorative animation

## Controls

- Push buttons are 24 px high; dialog buttons are at least 76 px wide with the default button in the accent, and Return and Escape act on them
- Inspector fields are 24 px high, filled without a border like Figma UI3, with the label inside on the left in 11 px secondary and the unit inside on the right in 11 px tertiary; hover shows a hairline ring and focus an accent ring. Numeric labels scrub on drag and brighten on hover; arrow keys step, Shift steps ten times. Sheets keep 22 px bordered fields
- Relation rows (Attached To, Played By) have a field's shape, a chevron and an optional icon action; state rows (Blender link, loop check, preflight) have a coloured dot, a short label and a ? for the detail
- Status pills are 20 px high, tinted in the status colour with a dot and the label, with the detail in a tooltip
- Pop-up buttons are native selects drawn with the AppKit double chevron. Checkboxes are 14 px with a 3.5 px radius, accent fill and a dark check
- Menus are translucent with 22 px items, a check mark column, right-aligned shortcut glyphs and section headers. They take keyboard focus: arrows move, Return runs, Escape closes, and they flip to stay inside the window
- Tooltips on window chrome are native `title` tooltips that name the command and its shortcut, and say Show or Hide for panel toggles; the tool rail and the build bar use Figma-style tooltips with a keycap; inspector explanations sit behind a ? icon with a bubble
- Empty states name the next action with a short title in Title Case, one sentence of help and a button where one fits: no hits shows Add Music with MIDI and Audio at the bottom of the canvas; with open hits the build bar waits under the pulsing dot
- Dropping a file shows an accent drop frame over the window, like Finder and Logic
