# Design Language

MidiMarble should feel like a native Mac app that people already know how to use. When a pattern exists in an established app, use it instead of inventing one. Innovation belongs in the musical track building, not in basic controls.

Blender is the main reference, because the film is finished in Blender and the app should feel like a friendly front end to it: its timeline and dope sheet for time, its properties editor for structured settings, and its shortcuts where they fit (G, R, Tab, numpad framing). The surface is Apple-native rather than Blender's custom toolkit: system font, translucent sidebar, native menus and sheets. Figma is the reference for canvas navigation and selection.

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

- **Familiar first:** a new user should recognize every control from another app
- **Native:** system font, menus, context menus, light and dark appearance, standard shortcuts
- **Canvas first:** panels stay compact and quiet so the track and music lead
- **Keyboard and direct manipulation:** every frequent action has a shortcut and can also be done by dragging
- **Honest feedback:** timing, misses and stale previews are always visible, never hidden behind a check button
- **Progressive depth:** the default path needs no Blender knowledge; depth appears through the inspector, Blender and agents

## Window

```txt
┌──────────────────────────────────────────────────────────────┐
│ ● ● ●  Song name   [ Compose | Design ]   ◀ ▶ ■  0:12.40   ⓘ │  unified toolbar
├────────────┬───────────────────────────────────┬─────────────┤
│ Sidebar    │ Canvas                            │ Inspector   │
│ marbles    │ Compose: pegboard view            │ selection   │
│ pieces     │ Design: rendered preview          │ properties  │
│ library    │                                   │ agent chat  │
├────────────┴───────────────────────────────────┴─────────────┤
│ Timeline: one lane per marble, shot markers in Design        │
└──────────────────────────────────────────────────────────────┘
```

- The toolbar holds the window controls, project name, the Compose and Design segmented control, transport and the time readout. Long jobs show progress here, like the Xcode activity view.
- The sidebar is translucent, like Finder and Notes. In Compose it lists marbles and their pieces; in Design it shows the library.
- The inspector edits the selection. In Design it also hosts the agent conversation for the selection.
- The timeline is resizable and collapsible. Panels remember their sizes.
- A start window offers Empty, From MIDI, From Audio, Examples and recent projects.

## Canvas

Floating UI belongs to the canvas, as in Figma UI3: the tool bar floats at the bottom centre of the canvas, notices appear above it, and nothing floats over the timeline or panels.

- Floating tool bar: Select (V), Hand (H), the piece types Platform (1), Rail (2), Tunnel (3) and Windmill (4), then Next, Repeat, Mirror, Auto place and Continue
- Pieces use flat toy colours: platform coral, rail blue, tunnel violet, windmill green. Every piece keeps a visible minimum size at any zoom, and marbles keep a minimum on-screen radius
- Suggestions are ghosts: dashed, see-through pieces with dashed dots and a small hint chip showing the key that accepts them

- Two-finger scroll pans, pinch zooms, Space and drag pans
- ⌘+ and ⌘− zoom, ⇧1 fits everything, ⇧2 fits the selection
- The 2D and orbit toggle sits in the canvas corner; Blender users can orbit with the middle mouse button
- The dot grid fades between densities while zooming

## Selection and editing

- Click selects, Shift-click adds, dragging on empty canvas draws a marquee, Escape clears
- Selecting a piece moves the playhead to its hit, unless playing, so the piece is never shown ghosted
- Long-gap dots are diamonds with a dashed ring; hovering one offers Add Rail and Add Tunnel. Dots outside the frame are red and say by how much
- Delete removes, ⌘D duplicates, ⌘Z and ⇧⌘Z undo and redo
- Right-click opens a native context menu with the same commands as the menu bar
- Numeric fields scrub when dragging their label, like Figma, and show units: cm, degrees, ms

## Step loop keys

| Key        | Action                                                          |
| ---------- | --------------------------------------------------------------- |
| Return, N  | Next: place the next dot, or accept the ghosts on screen        |
| Tab        | Accept the Continue ghosts or the rail suggestion               |
| Escape     | Cancel the drag, then dismiss ghosts, then leave the piece tool |
| 1 to 4     | Platform, Rail, Tunnel, Windmill tool                           |
| R          | Repeat                                                          |
| M          | Mirror                                                          |
| A          | Auto place the selected piece, or the next dot                  |
| P          | Pin or unpin                                                    |

Return acts as Next only while something is selected or offered; otherwise it keeps its timeline meaning and jumps to the start. T stays with the timeline for tapping hits.

## Timeline

- Space plays and pauses, Return jumps to the start, Left and Right move to the previous and next hit
- Pinch or ⌘ with scroll zooms the timeline
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

⌘K opens a command palette with every command, like Linear and Notion. The macOS menu bar lists the same commands with their shortcuts, so features are discoverable without the palette.

## Agents

The agent conversation lives in the inspector for the current selection, like a comment thread. Candidates appear as cards with a preview image and Accept and Decline buttons. The canvas shows the candidate in place while it is pending.

## Visual style

- System font through `-apple-system`, 13 px base, compact density like Finder and Logic
- Brand yellow from the logo (`#FDE200`) as the accent for selection, focus and primary actions, used like the highlight yellow in Photos and Final Cut Pro, with dark text on yellow
- Follows the system light or dark appearance
- Thin icons in one family
- Motion is short and functional; Reduce Motion disables decorative animation
