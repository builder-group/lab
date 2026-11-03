# Design Language

MidiMarble should feel like a native Mac app that people already know how to use. When a pattern exists in an established app, use it instead of inventing one. Innovation belongs in the musical track building, not in basic controls.

Reference apps:

| App                   | Patterns to borrow                                                   |
| --------------------- | -------------------------------------------------------------------- |
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

- Two-finger scroll pans, pinch zooms, Space and drag pans
- ⌘+ and ⌘− zoom, ⇧1 fits everything, ⇧2 fits the selection
- The 2D and orbit toggle sits in the canvas corner; Blender users can orbit with the middle mouse button
- The dot grid fades between densities while zooming

## Selection and editing

- Click selects, Shift-click adds, dragging on empty canvas draws a marquee, Escape clears
- Delete removes, ⌘D duplicates, ⌘Z and ⇧⌘Z undo and redo
- Right-click opens a native context menu with the same commands as the menu bar
- Numeric fields scrub when dragging their label, like Figma, and show units: cm, degrees, ms

## Step loop keys

| Key    | Action                                     |
| ------ | ------------------------------------------ |
| Return | Accept the current piece and go to the next dot |
| Tab    | Accept the Continue ghosts                 |
| Escape | Dismiss ghosts                             |
| R      | Repeat                                     |
| M      | Mirror                                     |
| A      | Auto place                                 |
| P      | Pin or unpin                               |

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
