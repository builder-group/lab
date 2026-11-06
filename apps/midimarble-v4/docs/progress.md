# Progress

Where the build stands today. Update this page in place; it stays about a page. Git keeps the history.

## Current state

The app is trimmed and waiting for the owner's test against a to-do list.

- **Compose:** Marbles, Song, hits and Backing; Platform, one Rail with Layouts (Drawn, Curve, C, Chain, Switchback), Tunnel, Windmill, Bowl. Next, Build Track, Rebuild From Here and one Fix. A run is hops, each from a stored hand-over; edits stay local (`simulation/edit-rule.ts`). Problems are physics only.
- **Patterns:** Zigzag, Staircase and Long Rail, checked before they're applied with a ghost and a verdict per hit, Groups and Flatten.
- **Film:** themes, skins, Lights as layers, Wall, Camera with shots, titles, Decor with Scatter, Packs, Draft Preview and background Blender frames. Problems here are clear output mistakes only: a marble out of frame, a screen title wider than the frame.
- **Export:** Draft and Final.
- **Agents:** MCP only, with Connect in the Agent menu. No chat in the window.
- **Defaults:** platforms 3 cm long and 15 cm deep on long posts, 30 mm lens, tilt 0.54, Turn 90°, distance 48 cm, Gravity 0.25. Why: `references.md`.
- **Data:** `marble-project@6`, no migrations, since the app hasn't shipped.

## Verified

- `test:e2e`: 40 of 40 in 221 s, after the 3×9 fixture rebuild, one Fix and the opening frame. Jingle Bells builds 115 of 115 on time with a clean preflight.
- Fix on Jingle Bells: 4 Melody notes handed to Backing recover every hit in about 5 s; with 6, Fix cuts 44 broken hits to 33 in about 17 s and says what is left. Over 2 to 7 notes it recovers two counts fully and comes out worse on two, which it says.
- Titles: a white wall title and a white screen title in Eevee stills on the Christmas wall. The wall title reads, with less contrast than the screen title.
- `typecheck`, `lint`, `test`, `camera:check`, `blender:check`.
- With the chosen look: `blender:design`.
- The film's look against the reference, on Brass's defaults: gold, wall, marble and scroll energy near its numbers (`references.md`, Look).
- Patterns on the reference's hit times: 58 of 58 on time at Gravity 0.5 with no Width asked, no double hits, rolls or touching pieces, on a fresh run. On 638 real ranges of the fixtures, how often they fit, and that none left a track worse (`references.md`).

## Not verified

- The opening's push-in watched in motion: Jingle Bells opens at about 0.79 m and comes to about 0.65 m by about 7 s. It's one eased move, judged from numbers and stills, so `follow-camera.e2e` checks 10 cm/s only from 7 s on. If it reads as too fast in a film, lengthen `OPENING_ZOOM_EASE`.
- Fix in the app, through the worker: the e2e tests call it in Node
- A Final film since Draft and Final replaced the old presets, and a whole Final film at the default camera
- Native window: export through the sheet, the unsaved-example save panel, a covered window (music, playhead, export progress), and how the Playback and Track menus show a single key
- Build Track in the native window against Node's time, read from `get_state.lastBuild.seconds`

## Known problems

- Build Track on Jingle Bells goes through on its first release position at Gravity 0.25, where other settings needed the second. That is one song's luck, not a fix.
- At the default Gravity 0.25 Patterns refuse more on a built track (Zigzag 112 of 144, against 132 at 0.35) and on fast uneven rhythm (17 of the reference's 58 hits, all at 0.35). `references.md` has the table.
- At 3 s and 30 s of Jingle Bells the bass touches the frame's edge for a frame or two, half hidden at 3 s. A 9 % wider duet frame would clear it.
- Fix on a two-marble song recovers less at 0.25: over 2 to 8 notes on Jingle Bells it recovers 2 of 7 fully and leaves more broken hits on 3, against 3 of 6 fully and none worse at 0.5. A result with more broken hits doesn't land. One-marble songs recover every time.
- `long-gap` has one marble passing through a skin, a real Problem in that fixture
- Fixtures keep their 9 cm long bars, so they read as wide slabs on 15 cm posts; bars built today are 3 cm. Example stills aren't regenerated
- Applying a Pattern can still zoom the wall out a little, seen from 17 % to 11 % on Jingle Bells; the reveal itself keeps the zoom, so something else moves it
- Patterns fit far less often as Staircases on two-marble songs (11 of 42 on built Jingle Bells), and a Long Rail on a built song about half the time (`references.md`). A check that says no takes about 7 s on built Jingle Bells, in the Pattern worker, with the ghost and "Checking the whole song…" showing.
- Build Track after a Pattern in the middle of a bare song names the notes before it in its attention list instead of moving the marble's release back; a Pattern on them does move it.
- Patterns: Bounce sets a drop aim, so bars still vary. Median tilt is high at Gravity 0.5 (about 29°, about 16° at Gravity 1). Width 16 cm leaves many problems. A run with 7 later Groups takes 24 s with nothing moving on the wall.
- No Problem for a missing asset: only Blender knows, and only while open
- `assists.test.ts` "holds the marble across a long gap" runs about 360 simulations per search and takes 10 to 30 s depending on the machine's load, against its 20 s limit
- The 204 s, 776 piece perf song doesn't run clean on one surface: 580 of 690 hits with its capsule-era rides and exits kept. Hop edits there take about 0.3 s at the median in Node, and a release can take seconds
- Jingle Bells keeps capsule-era rides on its Switchbacks and exits on its bars, and one touching pair (Platforms 86 and 87) Fix can't part. Build Track's results and Patterns land without going through the edit rule's chain; wiring them on is next
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
