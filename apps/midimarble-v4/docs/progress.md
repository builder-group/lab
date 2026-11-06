# Progress

Where the build stands today. Update this page in place; it stays about a page. Git keeps the history.

## Current state

The app is trimmed and waiting for the owner's test against a to-do list.

- **Compose:** Marbles, Song, hits and Backing; Platform, one Rail with Layouts (Drawn, Curve, C, Chain, Switchback), Tunnel, Windmill, Bowl. Next, Build Track, Rebuild From Here and one Fix. Edits stay local (`simulation/local-edit.ts`). Problems are physics only.
- **Patterns:** Zigzag, Staircase and Long Rail, checked before they're applied with a ghost and a verdict per hit, Groups and Flatten.
- **Film:** themes, skins, Lights as layers, Wall, Camera with shots, titles, Decor with Scatter, Packs, Draft Preview and background Blender frames. Problems here are clear output mistakes only: a marble out of frame, a screen title wider than the frame.
- **Export:** Draft and Final.
- **Agents:** MCP only, with Connect in the Agent menu. No chat in the window.
- **Defaults:** platforms 3 cm long and 9 cm deep, 85 mm lens, pitch 1.0, side 95°, rig distance 1.36 m, Gravity 0.5. Why: `references.md`.
- **Data:** `marble-project@6`, no migrations, since the app hasn't shipped.

## Verified

- `test:e2e`: 40 of 40 in 221 s, after the 3×9 fixture rebuild, one Fix and the opening frame. Jingle Bells builds 115 of 115 on time with a clean preflight.
- Fix on Jingle Bells: 6 Melody notes handed to Backing recover every hit in about 8 s; with 7, Fix cuts 16 broken hits to 10 in about 20 s and says what is left.
- Titles: a white wall title and a white screen title in Eevee stills on the Christmas wall. The wall title reads, with less contrast than the screen title.
- `typecheck`, `lint`, `test`, `camera:check`, `blender:check`.
- With the chosen look: `blender:design`.
- The film's look against the reference, on Brass's defaults: gold, wall, marble and scroll energy near its numbers (`references.md`, Look). The camera holds at both 85 mm and the 30 mm trial.
- Patterns on the reference's hit times: 58 of 58 on time at Width 14 cm and Gravity 0.5, chained without the check: it leaves 2 double hits and 2 rolls, which the check refuses. On 638 real ranges of the fixtures, how often they fit, and that none left a track worse (`references.md`).

## Not verified

- The opening's push-in watched in motion: Jingle Bells opens at about 2.2 m and comes to the rig by about 7 s, up to 20 cm/s (about 10 % of the distance per second). It's one eased move, judged from numbers and stills, so `follow-camera.e2e` checks 10 cm/s only from 7 s on. If it reads as too fast in a film, lengthen `OPENING_ZOOM_EASE`.
- Fix in the app, through the worker: the e2e tests call it in Node
- A Final film since Draft and Final replaced the old presets, and a whole film with the 3×9 bars at 120°
- Native window: export through the sheet, the unsaved-example save panel, a covered window (music, playhead, export progress), and how the Playback and Track menus show a single key
- Build Track in the native window against Node's time, read from `get_state.lastBuild.seconds`
- The camera numbers in `references.md` predate the 120° turn and the removal of the readable maximum

## Known problems

- Build Track on Jingle Bells gets stuck on its first release position and goes through on the second. That is one song's luck, not a fix.
- `long-gap` has one marble passing through a skin, a real Problem in that fixture
- Fixtures keep their 9 cm long bars, and example stills aren't regenerated
- Applying a Pattern can still zoom the wall out a little, seen from 17 % to 11 % on Jingle Bells; the reveal itself keeps the zoom, so something else moves it
- Patterns fit far less often as Staircases on two-marble songs (11 of 42 on built Jingle Bells), and a Long Rail on a built song about half the time (`references.md`). A check that says no takes about 10 s on built Jingle Bells.
- Build Track after a Pattern in the middle of a bare song names the notes before it in its attention list instead of moving the marble's release back; a Pattern on them does move it.
- Patterns: Bounce sets a drop aim, so bars still vary. Median tilt is high at Gravity 0.5 (about 29°, about 16° at Gravity 1). Width 16 cm leaves many problems. A run with 7 later Groups takes 24 s with nothing moving on the wall.
- No Problem for a missing asset: only Blender knows, and only while open
- `blender:film` fails its first check: its made-up run lifts the marble above the frame at 0.25 s, before and after the look round. The rest passes with that check limited to after 0.5 s.
- Flat Light reads paler than Fast on the Christmas look. Draft Preview draws no lights, shadows or metal.
- Skin: Cat's-Eye reads weakly when the platform behind has its hue

## Next steps

Playground projects and Jingle Bells are the test ground throughout.

1. The owner tests the trimmed app; fix what the test finds. Compose and Film as names are open until then: the coordinator recommends afterward, compared with Blender workspaces.
2. A Final film of Jingle Bells
3. Films: Jingle Bells V4
4. **Last step and final validation:** recreate the reference short through the app. If the app can't do it, iterate on the app, not the one film.

## Decided, not built

- **Keys:** a gentle run with one key per hit that lights as the marble rolls onto it, the hit being the crossing. After the films unless the reference needs them.
- **Fixed assemblies** (a funnel, a showpiece) as a Track Piece from a Pack, Blender or an agent, and later Save as Piece from a Group. Its own speed-matching needs a test.
- **More Pattern tiles:** C and Chain.
- **Garland** for Jingle Bells, as a Blender object

Parked: Start and End handles, rail-based looping, lights on the canvas and a light's timeline row.

## Notes on local files

Audits and measurement scripts are in the ignored `.local/`: `cleanup-decisions.md` is the owner's decisions, `track-study.md` the reference measurements.
