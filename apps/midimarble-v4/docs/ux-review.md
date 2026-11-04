# UX Review

How a UI round is judged before it counts as done. A reviewer works through the tasks by hand in the app, then scores the heuristics, then checks the budgets. Findings go into `progress.md` with the fix or the reason it waits.

## Tasks

A first-time user who knows Figma or GarageBand but not MidiMarble should finish each task without help. Record the time and every hesitation, wrong click or search.

| Task | Target |
| --- | --- |
| Open an example and play it | 10 s |
| Pause, scrub to a hit, step to the next hit | 10 s |
| Watch the run through the film camera | 5 s |
| Add a marble to an empty project | 15 s |
| Place a platform on a hit dot and hear its note | 15 s |
| Draw a free platform and drag it into the trajectory | 20 s |
| Draw a curved rail and adjust one handle | 30 s |
| Anchor a windmill to the trajectory | 20 s |
| Continue a zigzag with the suggested pieces | 15 s |
| Undo the last three changes | 5 s |
| Change the marble speed | 10 s |
| Switch to Film, apply a theme, export a Draft film | 60 s |

## Heuristics

Score each 0 to 2 and name the screen and element for every point lost. Adapted from Jakob Nielsen's ten usability heuristics and Apple's Human Interface Guidelines for macOS.

1. **Visible state:** playback, simulation, saving, Blender and export always show their state where the eye already is
2. **Match the user's world:** music and film words (hit, note, lane, playhead, take) instead of engine words
3. **Control and freedom:** every action undoes, Escape cancels any gesture, nothing commits on hover
4. **Consistency with platform and references:** the same control looks and works as in Finder, GarageBand, Figma or Final Cut; one glyph means one thing
5. **Error prevention:** problems show before they cost time, such as missed hits before an export
6. **Recognition over recall:** tools, shortcuts and attach states are visible or one hover away
7. **Efficiency:** every frequent action has a key; experts never need a menu
8. **Minimal design:** no prose in panels, help behind a question-mark tooltip, nothing on screen that does not serve the current task
9. **Recovery:** errors say what happened and offer the fix in place
10. **Help in context:** first-run hints point at the next step and disappear once used

## Budgets

| Measure | Budget |
| --- | --- |
| Pointer to visual response while dragging | one frame (16 ms), never above 50 ms |
| Trajectory update during a drag | 100 ms, with the last result kept on screen meanwhile |
| Any click to visible feedback | 100 ms |
| Playback frame rate | 60 fps without dropped frames on a 60 s project |
| Example open to first frame | 1 s |

Measure in the browser with the Performance API and in the bundled app; report the median and the 90th percentile.

## Visual checklist

Check by hand in light and dark, and note every miss like a heuristic point.

- **Hover states:** hover every row and control. Nothing moves or disappears, only appears in a space kept for it. Include every Layers row kind in both workspaces (Scene, Song, marble, pieces, Pieces, Wall, Lights, light, Camera, shot, Titles, title, Decor, decor item) and long names
- **Comparison with established apps:** put screenshots of the title bar and panels beside Xcode, Figma and Final Cut Pro at the same scale. Compare control height, weight, contrast, spacing and how much colour is on screen; a difference needs a reason

## Familiarity map

Every interaction needs a reference app that does it the same way. An interaction without one is either justified as new or changed.

| Interaction | Reference |
| --- | --- |
| Canvas pan, zoom, select, marquee | Figma |
| Layers sidebar, tool rail, inspector | Paper, Figma |
| Vector path for rails | Figma pen tool |
| Timeline, transport, playhead | Final Cut Pro, GarageBand, Blender |
| Tracks with mute and solo | GarageBand, Logic |
| Command palette | Linear, Raycast, Blender F3 |
| Contextual action bar | Figma selection toolbar |
| Export sheet | Final Cut Pro share, macOS sheets |

## From-scratch test after every wave

A wave isn't done until a tester has used the bundled desktop app the way a user does, with no developer hooks and no examples: New Project, Import Song… with `fixtures/jingle-bells.mid` through the real panel, build the run with clicks and keys, then Film: pick a look, add decor, a shot and a title, export a Draft and watch it. Record every stall, wrong turn and time per step, including hover states and playback. Needs the wave finished, no Blender renders running, and the window at least partly visible. The same film made through MCP is the benchmark for the agent path.
