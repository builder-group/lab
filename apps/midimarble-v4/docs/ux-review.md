# UX Review

How a UI round is judged. Match the test to the change: a small fix gets a quick look at that spot.

## Tasks

A first-time user who knows Figma or GarageBand should finish each without help. Note every hesitation and wrong click.

| Task | Target |
| --- | --- |
| Open an example and play it | 10 s |
| Pause, scrub to a hit, step to the next hit | 10 s |
| Add a marble to an empty project | 15 s |
| Place a platform on a hit dot and hear its note | 15 s |
| Draw a curved rail and adjust one handle | 30 s |
| Continue a zigzag with the suggested pieces | 15 s |
| Change Gravity | 10 s |
| Switch to Film, apply a theme, export a Draft film | 60 s |

## Check

- Every action undoes, Escape cancels any gesture, nothing commits on hover
- Every interaction has a reference app that does it the same way (Blender, Figma, Final Cut, Logic), or a reason why not
- One natural place per action; no duplicate buttons
- Hover every row and control, in light and dark, including every Layers row kind and long names. Nothing moves or disappears.
- Screenshots of the title bar and panels beside Xcode, Figma and Final Cut at the same scale: control height, weight, contrast, spacing, how much color

## Budgets

| Measure | Budget |
| --- | --- |
| Pointer to visual response while dragging | 16 ms, never above 50 ms |
| Trajectory update during a drag | 100 ms, the last result kept on screen |
| Any click to visible feedback | 100 ms |
| Playback | 60 fps on a 60 s project |
| Example open to first frame | 1 s |

## From-scratch test

When a batch of work changes how someone builds or films something, a tester uses the bundled desktop app like a user, with no developer hooks and no examples: New Project, Import Song… with `fixtures/jingle-bells.mid`, build the run with clicks and keys, then Film: pick a look, add decor, a shot and a title, export a Draft and watch it. Record every stall, wrong turn and time per step. The same film made through MCP is the benchmark for the agent path.
