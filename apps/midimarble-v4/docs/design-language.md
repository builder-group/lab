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
| Blender               | Orbit and frame shortcuts for users who know it                      |
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

## Window

The layout, after Paper, stays the same in Compose and Design; only the contents of each region change:

```txt
┌──────────────────────────────────────────────────────────────────────────┐
│ ● ● ● [◧] [⌂] [ Song ● × ] +            activity             [▭] [◨]    │  title bar
├───────────────┬──┬──────────────────────────────────────┬────────────────┤
│ Song          │ ▸│                          [⊙ ▢ ◫]    │ 100% ⌄  Export │
│[Compose|Design]│ ✋│                                      │ World / Piece  │
│ Marbles     + │ ─│                canvas                │ sections       │
│  ● Melody 9/16│ ◯│      (pegboard or Blender preview)   │                │
│ Layers        │ ▭│                                      │                │
│  ◯ Melody     │ ✎│        [ Next N | ⟳ ⇋ ✦ | » 7 ⇥ ]     │                │
│    ▭ Platform │ ⊂├──────────────────────────────────────┴────────────────┤
│  ▭ Platform 9 │ ✳│ ⏮ ◇ ▶ ◇ 0:12.40 / 0:35.00               − + ⇆       │  transport
│               │  │ Marbles  + │ ruler · playhead · lanes                │  timeline
└───────────────┴──┴─────────────────────────────────────────────────────────┘
```

- Title bar: the traffic lights, the sidebar toggle, a Projects tab (house) that returns to the start window, the open project as a document tab with an edited dot and a close button, + for a new project, the activity view in the middle and the timeline and inspector toggles on the right. Panel toggles say Show or Hide in their native tooltip
- Sidebar, full height and translucent like Finder and Photos: the project name (double-click renames), the Compose and Design segmented control, Marbles (like Paper's pages, with + for Add Marble, Place Marble on Canvas and the imports) and the layer list. In Design the layer list stays on top and the library sits below it
- Layers read like Figma's layer list: each marble is a group with the pieces linked or anchored to it in hit order, then the free pieces, newest first. Rows show a type icon, the name, a link or anchor glyph, problem badges only, and eye and lock toggles on hover that stay visible while on. Hidden and locked are view state. Click selects, ⌘-click toggles, Shift-click selects a range, double-click renames
- Tool rail, 48 px, between sidebar and canvas: Move and Hand, then the workspace's tools. Compose: Marble, Platform, Path (rails), Tunnel, Windmill. Design: Move, Text, Asset. Tooltips open to the right with the name, one line of help and the key
- Inspector: zoom with its menu (zoom, fit, snapping, wall and orbit) and the Export button at the top, then compact sections for the selection, or the World without one
- Timeline: spans canvas and inspector at the bottom. Its header holds the transport like a video editor: Go to Beginning, Previous Hit, Play, Next Hit and the time with the length, then the zoom controls at the far end. Play is the one round, filled button in the window
- Nothing floats over the canvas except feedback and the contextual build bar: the 2D, orbit and snap toggles sit in its top right corner
- Sheets, the ⌘K palette and context menus are unchanged
- A start window offers Empty, From MIDI, From Audio, Examples and recent projects.

The inspector edits the selection with a header row naming what is inspected with an icon tile, then collapsible panels whose state is remembered: Transform (X and Y side by side, Angle, Length, Contact), Attachment (Free, Linked to Hit N with the note and Unlink, Anchored to a marble at a time with Unanchor, Pinned), Physics and Timing for a piece; Marble, Release and Hits for a marble; Hit and Piece for a hit; Physics (Speed slider), Film (Frame, Length) and Music for the World. Explanations sit behind a ? icon. Positions of linked and anchored pieces show dimmed, since they follow the marble. In Design the inspector hosts the agent conversation for the selection. The timeline is resizable from its top edge and collapsible; its height is remembered and double-clicking the edge resets it.

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
- The 2D and orbit toggle sits in the canvas corner; Blender users can orbit with the middle mouse button
- The dot grid fades between densities while zooming
- Projects open in the film-frame view, with the marble in the upper third; during playback the canvas follows the marble vertically, and a piece placed by an assist is panned into view

## Selection and editing

- Click selects, Shift-click adds, dragging on empty canvas draws a marquee, Escape clears
- Selecting a piece moves the playhead to its hit, unless playing, so the piece is never shown ghosted
- Long-gap dots are diamonds with a dashed ring; their insert menu offers Switchback, Rail and Tunnel. Dots outside the frame are red and say by how much
- Delete removes, ⌘A selects all pieces, ⌘Z and ⇧⌘Z undo and redo. There is no Duplicate yet; Repeat and Continue copy a piece onto the next hits
- Right-click selects what is under the pointer and opens a context menu with the same commands and shortcuts as the palette: pieces (Auto Place, Pin, Rotate, Zoom to Selection, Rename, Delete), open dots (place any piece type, bridge a long gap), marbles and lanes (Add Hit, Mute, Solo, Rename, Delete Marble), timeline hits (Go to Hit, Play from Hit, Select Piece, Move to another marble, Delete) and empty canvas (step loop and view)
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
| ⇧P         | Pin or unpin                                                    |
| ⌥ (held)   | Drop free while dragging; break handle symmetry on the Path tool |
| ← →        | Turn selected pieces 1° (⇧ 5°); without pieces, previous and next hit |

Return acts as Next only while something is selected or offered; otherwise it keeps its timeline meaning and jumps to the start.

## Timeline

- Space plays and pauses, Return jumps to the start, Left and Right move to the previous and next hit
- Pinch or ⌘ with scroll zooms the timeline around the pointer; the corner buttons zoom out, in and to fit. A newly opened project shows its whole length
- Track headers stick to the left like Logic: a colour bar, name, hit count with the instrument, and M and S toggles for mute and solo while lanes are synthesized. Mute and solo are view state and change playback immediately
- The ruler shows minutes and seconds with minor ticks, a red playhead head and a draggable end bracket for the project length. Time past the end is shaded like Blender's area past the end frame
- Hits are diamonds, Blender's keyframe shape: hollow until a piece plays them, filled in the lane colour when on time, amber-edged when drifting, red when missed, accent yellow when selected, and outlined in the accent when their piece is selected on the canvas. A red ring marks hits closer than 180 ms
- Hits are dragged like notes in Logic; a marble's release is dragged like a clip in Final Cut
- The waveform or MIDI notes sit faintly behind each lane

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

The agent conversation lives in the inspector for the current selection, like a comment thread. Candidates appear as cards with a preview image and Accept and Decline buttons. The canvas shows the candidate in place while it is pending.


If no agent CLI is installed, or a run fails because the CLI is not logged in, the panel says so and shows the Terminal command that fixes it, such as `claude /login`, with a copy button. Long runs fold earlier tool steps into a count and keep the latest four.

## Design workspace

- Library tiles follow Blender's asset browser in a Finder-style sidebar: two columns of 4:3 thumbnails with a name and a secondary line, a search field, collapsible sections. The applied theme gets an accent ring and a check badge; a selected item gets a grey tile and the ring. Items that do not fit the selected piece type are dimmed
- The activity view (Xcode) sits in the middle of the title bar: Blender's state (Starting, Updating scene, Rendering preview, Ready), agents at work and the export with a hairline progress bar. Clicking it during an export shows the export sheet
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
- Fields are 22 px high with a half-pixel border, the unit inside on the right in 11 px tertiary, and an accent focus ring. Numeric labels scrub on drag like Figma and brighten on hover; arrow keys step, Shift steps ten times
- Pop-up buttons are native selects drawn with the AppKit double chevron. Checkboxes are 14 px with a 3.5 px radius, accent fill and a dark check
- Menus are translucent with 22 px items, a check mark column, right-aligned shortcut glyphs and section headers. They take keyboard focus: arrows move, Return runs, Escape closes, and they flip to stay inside the window
- Tooltips on window chrome are native `title` tooltips that name the command and its shortcut, and say Show or Hide for panel toggles; the tool rail and the build bar use Figma-style tooltips with a keycap; inspector explanations sit behind a ? icon with a bubble
- Empty states name the next action with a short title in Title Case, one sentence of help and a button where one fits: no hits shows Add Music with MIDI and Audio at the bottom of the canvas; with open hits the build bar waits under the pulsing dot
- Dropping a file shows an accent drop frame over the window, like Finder and Logic
