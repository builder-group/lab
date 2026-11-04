# References

These references define what the first version must be able to produce. Reference media stays outside the repository; paths below are local.

## Reference short

Source: `~/Downloads/Legendary-Meme-Songs-SnapYT.App.mp4` from [@virtual3dworld_1000](https://www.youtube.com/@virtual3dworld_1000/shorts). 360×640, 30 fps, 56 seconds.

### Structure

- One continuous shot without cuts
- A medley of five songs, each about 8 to 14 seconds. Each song is a section with its own piece skins: gold bars with chrome devices, copper bars, dark grey housings with white keys, silver bars and dark knobs with glowing red tops.
- The song title appears as white text on the wall at the start of each section, together with a channel watermark
- A short curved wire rail joins each section to the next one
- The run ends in a rail catch

### Track

- One blue glass marble
- Pieces form two parallel diagonal columns, and the marble zigzags between them. The left column and right column often use different skins of the same section set.
- Pieces in a column are evenly spaced, the same size and at the same angle. Regular spacing makes the musical rhythm visible.
- The marble is roughly a third of a bar's length. Bars sit on short brackets that keep them off the wall.
- Pieces react visually on hits: keys press and red tops glow

### Timing

Audio onset estimates per section are 3.7 to 4.4 onsets per second with a median gap of about 240 ms. Marble hits follow a subset of those onsets, so the run needs reliable hits at 250 to 500 ms and occasional faster passages near the 180 ms minimum.

How densely the pieces stack depends on the platform `bounce` (restitution e). With a hit every T seconds the marble settles at a drop per hit of (1 − e) / (1 + e) · gT² / 2 and rises e² / (1 − e²) times that drop after each bounce. Above e ≈ 0.71 it rises past the previous piece of the other column and must pass beside it, which the assists cannot keep in frame. The default 0.65 drops about 9.4 cm per hit at 300 ms, against 12.8 cm at the earlier 0.55. Auto place also sets each platform's bounce so a fast arrival, such as the first fall from the release, settles in one hit.

### Camera

- The camera looks steeply down along the wall, so the wall reads almost as a floor
- It travels continuously with the marble and keeps it slightly above the frame center
- The roll changes slowly over time, turning the columns from diagonal to almost vertical and back
- Soft depth of field and no hard camera moves

### Look

- Pale lavender-grey wall with subtle texture
- One soft sun from the upper left casting long diagonal shadows
- Metallic and glossy materials with clear reflections

## Reproduction targets

1. **Reference short:** recreate the first 20 seconds: one section of zigzag columns, a rail transition into a second section with a different skin set, wall titles, reactions and the travelling camera with slow roll. Use an original or public-domain melody for anything committed or shared. The reference audio may be used locally to compare timing density.
2. **Jingle Bells:** the opening phrase or more, compared with the earlier attempts:
   - `apps/.local/midimarble-blender/output/v4-jingle/jingle-bells-christmas.mp4`
   - The `jingle-bells` playground in `apps/.local/midimarble-desktop/playgrounds/`

A target passes when every hit lands within 20 ms of its note, the film renders without manual Blender edits, and a side-by-side review shows comparable structure and polish.

## Jingle Bells comparison

Compared on 2026-11-03. Films and contact sheets are in `.local/jingle/`; the v4 build log is `.local/jingle/build-log.txt`.

| | Blender prototype (`jingle-bells-christmas.mp4`) | Desktop playground (`jingle-bells.marble.json`) | v4 (`fixtures/jingle-bells.marble.json`) |
| --- | --- | --- | --- |
| Music | First phrase, 11 notes (13 in the source), one marble, 9.3 s | First phrase, 13 hits, one marble, 11.25 s | Whole 16-bar refrain plus a quarter-note bass, 51 + 64 hits on two marbles, 32.9 s (35 s before the song tail of 0.4 s) |
| Timing | 0.26 ms worst error, physics-native | Anchors at hit times; no film | All 115 hits within 8 ms; soundtrack synthesized from the lanes |
| Pieces | Hand-styled pads, paired-wire catch rail, Christmas set dressing | 13 anchors, 9 auto spans and 3 rails, graybox | 115 platforms and 7 rails from the assists, brass theme |
| Readability | The marble, every pad and the rail are large and readable in every frame | Not rendered | Readable for the first 4 s. From about 5 s the camera pulls back to keep both marbles in frame, pieces shrink to specks and the marbles are invisible; from 22 s the camera passes the edge of the wall and the frame shows the wall edge and background |
| Camera | Hand-placed, steady, close | None | Baked follow camera framing both marbles; it zooms out with their vertical spread |
| Look | Cycles at 32 samples, glass marble, decorated wall | Graybox | Eevee fast preset at 720×1280, plain lavender wall, small brass bars with shadows |
| Render | 279 frames in 38 s at 1080×1920 | — | 1050 frames in 428 s (408 ms per frame) at 720×1280 |
| Manual work | Many review and styling rounds in Blender (review-v1 to v4, styling-v2 and v3, separate physics and outro tests) | Every anchor placed by hand | Scripted: 91 Next presses. 37 hits from Continue, 20 from Mirror, 28 from Auto place, 7 launch angles, 7 rails; 34 hand moves (22 hand rotations where Auto place found nothing, 9 rotations of the previous piece, 3 re-tilts before a rail) |

Verdict: v4 is the only attempt that plays the whole refrain with a bass line, keeps every hit on time and renders without Blender edits. As a film it is worse than the Blender prototype: two marbles with different rhythms drift apart vertically, so the camera cannot frame them and nothing on screen reads. The prototype covers 11 notes but shows them clearly.

### Gaps found

1. Long notes drop the melody. Next suggests rails only above 1.2 s, but half notes at 120 BPM (1.0 s) cannot be served by a bounce in frame either, so the build asked for rails from 0.9 s. Rails top out at 0.25 m and are straight, so a 2 s whole note still ends in a long free fall. One 2 s gap got no rail because every candidate crossed the bass marble's path, and the melody fell about 17 m there.
2. Two marbles drift apart vertically. The descent per hit grows with the square of the interval, so the melody and bass fall at different rates: 1 m apart after 4 s, 21 m after 28 s and up to 39 m during free falls. The camera follows both and zooms out until nothing is visible. Nothing in the assists keeps lanes at a common height.
3. The wall is finite. From 22 s on, with the melody about 20 m down, the camera passes the wall edge. Fixed: the wall is generated from the run and the camera's view on every apply, and the camera keeps a readable distance and the melody marble (see `progress.md`, Camera readability).
4. One frame band for all marbles. `frameBand` centres on the first marble's release, so the second marble's assists pull it toward the melody. The build gave each lane its own band by putting its marble first in the project the assists see.
5. Auto place fails after fast arrivals. A release at 0 s (the import's default) reaches the first hit at about 5 m/s and no angle keeps the next dot in frame; the build released at 0.75 s. Later, 22 hits had no Auto place answer and were rotated by hand, and 9 needed the previous piece rotated first.
6. Launch angles are too steep. The rail suggestion fails when the piece before a gap throws the marble out of the frame band; 17° to 28° launches failed for 1 s gaps and the build re-tilted the launcher to 5° to 16°.
7. Continue and Mirror ignore a following long gap, so a ghost can take the launch hit. The build stopped ghosts before launch hits.
8. Hits can count as on time while a marble rests on a piece. The build rejects hits whose arrival speed is below 0.3 m/s.
9. `@tonejs/midi` loaded through its CommonJS build in Node, so `parseMidiFile` did not run outside a bundler. Fixed in `music/midi.ts`.

Next steps: a long-gap piece that holds the marble for 1 to 2 s inside the band (a switchback rail or a cup), a per-lane frame band in the assists, a shared descent rate across lanes (or one camera per marble), an infinite or growing wall, gentler launch angles, and an arrival-speed check in the hit status.

### After the engine iteration

Rebuilt on 2026-11-03 with `pnpm fixtures:jingle` after the shared descent pace, per-lane frame bands, switchbacks and the impact rule (see `architecture.md`, Pieces and Simulation). Both marbles are now released at 0 s, the import's default, and at x = ±0.16 m, the centres of their lane bands. Measured over the time both marbles play, 1 to 31 s, against the pace y*(t) of 0.52 m/s; the "before" column is the previous fixture simulated with the new engine.

| | Before | After |
| --- | --- | --- |
| Hits on time | 49/51 melody (2 now count as resting), 64/64 bass | 51/51 melody, 64/64 bass |
| Melody \|y − y*\| over samples | max 21.0 m, mean 5.65 m | max 0.68 m, mean 0.19 m |
| Bass \|y − y*\| over samples | max 0.54 m, mean 0.33 m | max 0.54 m, mean 0.25 m |
| Dots further than 0.25 m from y* | 47 of 51 melody | none (melody max 0.19 m, bass 0.24 m) |
| Largest vertical distance between the marbles | 21.1 m (mean 5.96 m) | 0.54 m (mean 0.14 m) |
| Gap pieces | 7 rails | 12 switchbacks (1 to 3 legs) |
| Manual steps | 34 hand rotations and re-tilts | 2 (one hand rotation, one rotation of the previous piece, both in the bass at 30 s) |
| Assist steps | 91 Next presses | 111 Next presses: 12 switchbacks, 12 launches, 46 Auto place, 37 Mirror, 19 ghosts from 3 Continue accepts |

Gaps found above, now:

1. Long notes: closed. Gaps longer than about 0.68 s at this pace (where a bounce would rise more than 0.4 m) get a switchback. The twelve hold the marble 0.28 to 1.37 s (1 to 3 legs, 7 to 15 cm tall) and release it so the next dot lies within 0.11 m of y*; the two 2 s whole notes use 2 and 3 legs at 3° and 5°.
2. Vertical drift: closed for the dots; between dots a marble is up to 0.68 m from y*, mostly while a switchback holds it above the pace.
3. Finite wall: not addressed here. The simulation now reports the pace as `TSimulationResult.descent` for the Blender camera to follow; the run covers about 16 m of wall over 31 s.
4. One frame band: closed. Each lane has its own band (in this rebuild a frame widened to 0.63 m for two marbles; see the next section for the larger kit's lanes).
5. Fast arrivals: closed for the first fall; the 4.9 m fall from a 0 s release settles in one hit on a nearly flat platform with bounce 0.2. Two hand steps remain, both where a bass bounce near the end would touch the melody's last piece.
6. Launch angles: closed. Auto place launches with a 1.2 m/s hop that drops the marble beside the piece into the switchback.
7. Continue before a long gap: closed. Ghosts stop before the launch hit.
8. Resting hits: closed. They count as missed with reason `resting`.

### After the engine and camera work

Compared on 2026-11-03 after the shared descent pace, side-by-side lane bands, impact-only hits, switchbacks, the readable camera and the generated wall. Film: `.local/look3/films/jingle-bells-fast.mp4`; contact sheets before and after: `.local/look3/jingle-compare.jpg`.

- Music and timing unchanged: 115 of 115 hits on time; 12 switchbacks hold the long notes
- The two marbles stay within about 0.3 m of each other until 31.5 s, and the camera frames both the whole time at 1.0 to 1.8 m. Nothing becomes a speck and the wall edge never shows
- Still behind the Blender prototype: at that distance the 6 cm pieces fill 8 to 11 % of the frame width and the marbles are small dots (the bass reads only by colour). Switchbacks look like small chrome wire cages up close but are faint at film distance. The film opens on two lone marbles and ends with a 15 m solo fall of the melody
- Remaining gap: lanes side by side 0.3 m apart cost scale. Narrower lane bands or a larger kit scale (as in `reference-20`) would bring pieces to the reference's 12 to 15 % of the frame width

### Larger kit and closer lanes

Rebuilt and rendered on 2026-11-03 after the 1.5× default kit and the 0.26 m lane spacing (`architecture.md`, Units and Simulation). Film: `.local/look4/films/jingle-bells-fast.mp4` (1050 frames, Eevee fast preset, 720×1280), 1 fps contact sheet `.local/look4/jingle-bells-contact.jpg`, side by side with the previous film in `.local/look4/jingle-compare.jpg`. Sizes are measured on 360 px wide frames at 5, 11 and 20 s; the reference sheets were read the same way.

| | Previous film (`.local/look3`) | This film | Reference short |
| --- | --- | --- | --- |
| Bar length in frame width | 8 to 11 % | 12 to 19 % (16 % typical) | 25 to 30 % |
| Marble diameter in frame width | about 1.7 % (12 px at 720p) | 3.3 to 4 % | about 7 % |
| Bars per frame | 15 to 25, tiny | 12 to 18 | 10 to 14 |
| Both marbles in frame | yes | yes, 1 to 31 s | one marble |
| Build | 115/115, 12 switchbacks | 115/115, 12 switchbacks, 7 manual steps, every dot within 0.21 m of y*, marbles at most 0.66 m apart vertically | |

Verdict: better than the previous film, with pieces about one and a half times larger and the marbles readable, but still about half the reference's scale. The remaining limit is the group camera, not the lanes. It keeps every marble within 55 % of the half frame height (65 % of the half width) and holds the widest need for a second. A 0.5 s bounce sags gT²/8 ≈ 0.31 m from the straight pace line between its dots, so the bass alone asks for about 1.3 m of camera distance against the set 0.85 m, and the lane spacing about 1.1 m. Rendering the same package with the group framing loosened in memory to 0.8 of the half height and 0.85 of the half width (`.local/look4/patched_look.py`, nothing in `blender/` changed; stills in `.local/look4/framing-compare.jpg`) gives bars of 23 to 25 % and marbles of about 4.5 %, with both marbles still in frame. Lanes at the requested 0.15 to 0.18 m were not reachable: all marbles share one physics world, so interleaved lanes strike each other's bars and every build attempt failed within 2 to 13 s; they would need collisions limited to a lane's own pieces and a depth offset per lane in Blender. The film still ends with three seconds of empty wall after the last notes.

### Column density and the steeper camera

Measured on 2026-11-03 with `reference-20`. Its dots step down 0.244 m per column (2.7 bar lengths between two bars of one column) with the columns 0.25 m apart; the reference stacks a column's bars about half a bar apart, so a frame shows 8 to 10 per column against our 3 to 4.

- Physics alone cannot close it. The step is the drop per hit, (1 − e) / (1 + e) · gT² / 2 per hit, two hits per column, so half a bar at 0.4 s hits needs about 0.15 to 0.2× gravity. At those speeds the assists leave 9 to 34 of 47 hits open (0.2× at 0.4 s: 9; 0.15×: 17; 0.25× at 0.35 s: 23; 0.2× at 0.3 s: 34) and the rail between the sections fails
- Most of the packed look is the camera: the reference looks almost along the wall. At pitch 1.15 rad (66° from the wall normal, before 0.85 and 1.0) perspective folds the 2.7 bar steps together and a frame shows 6 to 8 bars per column receding along the wall; at 1.3 the near bars are oversized and the wall edge shows at the bottom. The follow camera keeps every marble in frame as well as before (port measurement on both fixtures). New projects and both fixtures now use 1.15
- Still different: our columns are about twice as far apart as the reference's (the hop sideways at this rhythm), so the middle of the frame is empty wall where the reference's columns nearly touch

### Half gravity

Measured on 2026-11-03. New projects default to half gravity (Marble Speed 0.50×), but `pnpm fixtures:jingle` only completed at full gravity. With `GRAVITY_SCALE = 0.5` and the import's 0.5 s release lead the build stopped at 11.5 s. Every height at a given rhythm halves with gravity (drop per hit, bounce rise, pace), while pieces, marbles and lanes keep their size, and four things broke on that. The blocked check was not too strict: blocked candidates overlapped the marble's own path from 0.1 to 1 s earlier, not far in the past.

1. Switchback hold estimate. `switchbackHoldTime` rolled every leg from rest, but the marble keeps its entry speed through the bends. Simulated on the 2 s whole note at 7 s, holds were 0.22 to 0.27 s per leg at any slope while the estimate gave 0.38 to 1.09 s per leg (4 legs at 12°: 2.24 s estimated, 1.06 s simulated; 6 legs at 2°: 6.16 against 1.31 s). At full gravity it was 1.6 to 4 times too long as well, but there the shortlist still caught good candidates. At half gravity it shortlisted only switchbacks that released too early: the build took 4 legs at 13° and the melody ended 1.61 m below y*, although 537 of 3156 simulated candidates (mostly 4 to 6 legs) ended within 0.25 m. Rolling from 0.35 of the entry speed and keeping the speed through the bends fits both gravities within 0.23 s rms.
2. Long-gap threshold. `MAX_BOUNCE_RISE` was 0.4 m at any gravity, so at half gravity the threshold rose from 0.68 to 0.91 s and 0.75 s notes became bounces rising 0.25 m, while the lane's earlier pieces sat 0.13 and 0.26 m above. Auto place found only near vertical bounces (13 mm sideways) that struck their own piece again, after which no angle at the next dot cleared the marble's own path (167 of 167 blocked). The rise now scales with gravity, so the threshold stays at 0.68 s.
3. Column clearance. A zigzag passes under the piece two hits back on its way to the next piece of that column, d − r below it for a drop d per hit and a bounce rise r. The default bounce leaves 7 cm at full gravity and 0.5 s, but 3.5 cm at half gravity, about a marble diameter plus half a bar. The bass, a plain quarter-note line, ended up resting on its pieces and needed hand rotations; with fixes 1 and 2 the build stopped at 11.5 s on a resting bass hit. With several marbles the pace now falls at least at `columnRate`, which keeps 6.5 cm: 0.304 m/s instead of 0.260 at half gravity and 0.5 s (a bounce of about 0.60 instead of 0.65), unchanged at full gravity. The build then reached 28.5 s.
4. Launch horizon. The launch hop rises the same 7 cm at any gravity but stays in the air 0.35 s instead of 0.25 s, and Auto place followed it for a fixed 0.3 s. Hops that fell back onto their own piece or left the lane after 0.3 s passed, and no switchback fitted after them: the 2 s gap at 23 s got a rail and the melody fell 4.45 m below y*. The horizon is now 0.3 s / √gravityScale.

The build script also accepted a step that left an earlier hit of the lane being built blocked by its own path, when that hit lay beyond the other marble's frontier; every later step of the other lane then failed (26.75 s). It now checks the built lane's hits in full.

| Jingle Bells build | Half gravity | Full gravity |
| --- | --- | --- |
| Hits on time | 51/51 melody, 64/64 bass | 51/51, 64/64 |
| Release position | the first one tried | the first one tried (before: the fifth) |
| Next presses | 108: 10 switchbacks, 1 rail, 12 launches, 53 Auto place, 28 Mirror, 22 ghosts from 4 Continue accepts | 73: 12 switchbacks, 12 launches, 41 Auto place, 3 Mirror, 58 ghosts from 4 Continue accepts, 1 wide search |
| Manual steps | 10 rotations of the previous piece, no hand rotations | 3 rotations of the previous piece (before: 5) |
| Pace | 0.304 m/s | 0.520 m/s |
| \|y − y*\| over samples | melody max 0.37 m, mean 0.11; bass max 0.39, mean 0.16 | melody max 0.53, mean 0.17; bass max 0.32, mean 0.18 |
| Dots beyond 0.25 m of y* | none (melody max 0.21 m, bass 0.25 m) | none (melody 0.24 m, bass 0.05 m) |
| Largest vertical distance between the marbles | 0.56 m | 0.49 m |
| Same-column step (median) | 0.32 m melody, 0.29 m bass | 0.53 m, 0.52 m |
| Platforms per metre of wall | 5.7 melody, 6.6 bass (6 to 7 per 1.05 m frame height) | 3.3, 3.9 (3.5 to 4) |
| Wall covered | 9 to 10 m | 15.5 to 16.5 m |
| Export preflight | clean | clean |

Decision: the fixture is rebuilt at half gravity. It is what a beginner importing the song gets, its columns stack 1.7 times denser, closer to the reference's half-bar spacing, and the run covers 40 % less wall at a slower camera, at the cost of seven more manual steps, all rotations of the previous piece. The 0.75 s note at 6 s still gets a rail instead of a switchback, because every switchback there crosses the earlier path.

Other release leads at half gravity, which stopped at 23 s (0.35 s) and 29 s (1 s) before: 0.35 s completes on the third release position (shifted −1 cm) with 7 rotations of the previous piece and a clean preflight; 1 s completes on the first with 17 manual steps (4 by hand) and 4 dots outside their lane, which the preflight reports.

### Close camera

Measured on 2026-11-04 after the Round 4 review (N5: Jingle Bells framed about 40 bars with marbles at 3 % of the frame width, a Push In held to the end, the film ended on empty wall). Numbers come from the TypeScript port at 30 fps projected into the 9:16 frame over the time from the first to the last hit (`.local/camera-framing/measure.ts`; before in `before.txt`, after in `after.jsonl`); Draft films and before/after stills are in `.local/camera-framing/films/`.

| | reference-20 before | reference-20 after | Jingle Bells before | Jingle Bells after |
| --- | --- | --- | --- | --- |
| Rig distance, pitch | 0.85 m, 1.15 | 0.7 m, 1.15 | 0.85 m, 1.15 | 0.7 m, 1.15 |
| Marble in frame width, median (10th percentile) | 7.2 % (6.7) | 8.7 % (8.0) | 4.3 % (3.5) | 5.3 % (4.3) |
| Pieces in frame, median | 11 | 9 | 27 | 20 |
| Next four pieces in frame, median | 4 | 4 | 4 | 4 |
| Bar length in frame width, median | 17 % | 21 % | 12 % | 16 % |
| All playing marbles in frame | 100 % | 100 % | 99.8 % | 100 % |
| Camera distance, median and max | 0.85, 0.85 m | 0.7, 0.7 m | 1.33, 1.62 m | 1.06, 1.5 m |
| At 0:12 | 13 pieces, marble 7.5 % | 11 pieces, 9.1 % | 36 pieces, 3.6 and 3.8 % | 28 pieces, 4.8 and 5.2 % |
| Last frame | no piece | 4 of the last 5 pieces | no piece | 4 of the last 5 pieces |

What changed:

- Group size as the camera sees it. The group need measured each marble's offset flat on the wall against the frame's width and height. At pitch 1.15 the wall's vertical is foreshortened to about 0.4 and the image is turned some 55° against the wall even without roll, so it overestimated vertical spreads and could not see that the smoothed target sits off the group's centre when marbles weave sideways. It now projects each offset onto the camera's own right and up axes (from the side, pitch and roll it will bake) around the smoothed target of a first pass, plus the depth toward the camera. Measured that way the Jingle Bells group used 43 % of the half frame at the median against its 75 to 80 % budget, so the frame budget rose to 85 % of the half width and height. 0.9 also keeps both marbles in frame (5.5 % median) but puts them within a tenth of the frame edge on 10 % of the frames
- Marble readability bound. The readable maximum also keeps a marble at 3.5 % of the frame width or more (1.69 m for the 24 mm marble); past it the camera follows the focus marble as before. 4 % left the bass out of shot on 5 % of the frames
- Rig distance 0.7 m for new projects and both fixtures (0.6 m makes bars 25 % of the frame but leaves 7 pieces and 3 of the next four in frame). The steep 1.15 pitch stays: with two lanes, pitch 1.0 shows 19 pieces against 20 but the marbles shrink to 4.8 %, and single-marble columns lose their stacked rows
- Shots release. Push In and Close-Up hold 2 s and ease back over 0.8 s, Wide and Follow hold until the next shot; a reference-20 Push In at 6 s is back at the rig distance by 9.5 s
- Ending. After the last struck hit the camera reads the marbles at that time and eases over a second to the middle of the last second of run, with heading and roll drift coming to rest; the camera slows from about 50 cm/s to under 1 cm/s by the end

Still different from the references: two lanes side by side keep the Jingle Bells camera at about 1 m, so its pieces stay at 16 % of the frame width against the reference's 25 to 30 %; closer does not come from narrower lane spacing alone (see Narrower lanes with one world per marble). Zigzag and the other early fixtures keep their 0.9 m, 0.7 rad camera. The closer frame drops reference-20's "Night Keys" title at 0:10 out of shot; its offsets were set for the 0.85 m frame. Before/after Draft stills: `.local/camera-framing/films/*-before-after.jpg` (top row the Round 5 Draft films, bottom row these).

### Narrower lanes with one world per marble

Measured on 2026-11-04 after one Rapier world per marble. Jingle Bells was rebuilt with `LANE_SPACING` at 0.26, 0.22, 0.20, 0.19, 0.18, 0.17 and 0.16 m (half gravity, builds in `.local/lanes/`), and with narrower lane bands (`LANE_HALF_WIDTH` 0.11, 0.10, 0.09 m). Camera numbers come from the TypeScript follow camera with `.local/camera-framing/measure.ts` over the first to the last hit; "clean" means 115/115 on time, keeping the pace (the fixture test's rule) and an empty export preflight.

| Build | Result | Marble in frame width, median (10th pct) | Bar in frame width | Camera distance, median and max | Both marbles in frame |
| --- | --- | --- | --- | --- | --- |
| Fixture, 0.26 m (before) | clean | 5.7 % (4.8) | 16.9 % | 0.96, 1.22 m | 100 % |
| 0.26 m, new assists | clean, third release shift | 5.7 % (4.7) | 16.2 % | 0.99, 1.28 m | 100 % |
| 0.22 m | 115/115, a bass dot 9 cm outside its band | 5.7 % (4.9) | 16.6 % | 1.00, 1.34 m | 100 % |
| 0.20 m | clean, fourth shift | 5.7 % (4.8) | 16.2 % | 1.01, 1.35 m | 100 % |
| 0.19 m | 115/115, clean preflight, a dot 0.33 m off the pace | 6.0 % (4.9) | 17.5 % | 0.95, 1.31 m | 100 % |
| 0.18 m | 115/115, a melody dot 0.20 m outside its band, marbles change sides twice | 7.3 % (6.1) | 21.1 % | 0.74, 0.96 m | 100 % |
| 0.18 m, every placed dot in its band | stops at the latest after 29 release shifts | | | | |
| 0.17 m | 115/115, clean preflight, off the pace | 6.0 % (5.3) | 17.7 % | 0.90, 1.13 m | 100 % |
| 0.16 m | stops at 12 to 29.5 s on 15 shifts | | | | |
| Bands 0.11 / 0.10 / 0.09 m at 0.22 / 0.20 / 0.18 m | stops at 3 to 21 s | | | | |

Decision: `LANE_SPACING` stays 0.26 m. No narrower spacing gives a clean build that frames closer.

- The camera needs the marbles' sideways offset, not the lane spacing. Shifting the bass's recorded motion 4, 8 and 12 cm toward the melody brings the camera from 0.96 to 0.87, 0.79 and 0.73 m; removing the vertical offset changes nothing (0.94 m). Built lanes do not come closer, though: the median sideways offset between the marbles is 0.26 to 0.29 m at every spacing from 0.26 to 0.20 m (0.21 m in the 0.18 m build that left its band). Where the bands overlap, the other lane's pieces stand in the zigzag's path, so Auto place keeps each marble's dots on the outer side of its band, and the vertical offset grows instead (90th percentile 0.36 m at 0.20 m against 0.26 m).
- Narrower bands leave no room for a zigzag of 9 cm bars and stop within the first seconds.
- Results scatter from one release shift to the next more than between spacings: 0.18 m framed at 6.8 and 7.3 % in two builds, 0.19 and 0.17 m at 6.0 %. Reaching the reference's 7 to 9 % reliably needs lanes that interleave by design, for example both marbles sharing one zigzag column pattern offset by half a period, rather than a narrower constant.

The assists now keep clear of other lanes whatever the spacing. Auto place rejects an angle whose run breaks a hit of another marble that was on time up to that marble's next open hit (`crossesOtherLanes`), as the Jingle build accepted only after its own check. Switchbacks, rails and tunnels for a long gap are never suggested when the marble touches another lane's piece or the other marble, or the other marble touches the piece; before, a rail had no such check and a switchback only lost score. The Jingle build also rejects a step that leaves a switchback, rail or tunnel Blocked (two builds had finished 115/115 with a rail left out after a hand rotation of the launch platform) or a placed dot outside its band. Earlier 0.18 to 0.22 m attempts on 2026-11-04 resolved `@/` imports to the app's own constant and are not in the table.

### Steady close camera with a leading marble

Measured on 2026-11-04 after review finding R5-5 (Jingle Bells, Camera Automatic, Distance 70: close at 6 to 10 % for most of the film, then a survey of 20 and more bars at 0:10 to 0:14; a Push In at 0:10 changed nothing; the held end at 0:34.5 shows no marble). TypeScript follow camera at 30 fps with `.local/camera-r7/measure.ts` (the method above plus each marble's share in frame, the largest change of distance within one second and the time the last marble stays in the held frame) over the first to the last hit; before and after in `.local/camera-r7/before.jsonl` and `after.jsonl`.

| | Jingle Bells before | Jingle Bells after | reference-20 before | reference-20 after |
| --- | --- | --- | --- | --- |
| Marble in frame width, median (10th percentile) | 5.7 % (4.8) | 6.2 % (5.4) | 8.7 % (8.0) | 8.7 % (8.0) |
| Camera distance, median and max | 0.96, 1.22 m | 0.91, 0.97 m | 0.7, 0.7 m | 0.7, 0.7 m |
| Largest distance change within 1 s | 0.169 m | 0.045 m | 0 | 0 |
| Melody / bass in frame while it plays | 100 / 100 % | 97.9 / 92.5 % | 100 % | 100 % |
| Both marbles in frame | 97.5 % | 87.9 % | | |
| At least one playing marble in frame | 100 % | 100 % | 100 % | 100 % |
| Pieces in frame, median; next four, median (10th pct) | 18; 4 (3) | 17; 4 (3) | 9; 4 (2) | 9; 4 (2) |
| At 0:12 | 27 pieces, marbles 4.5 and 5.6 %, 1.14 m | 17 pieces, 5.4 and 7.1 %, 0.96 m | 11 pieces, 9.1 % | unchanged |
| Push In at 0:10 (49 cm, Hold 2 s), distance at 0:11 | 1.16 m, as without it | 0.68 m, 0.70 of the automatic 0.97 m | 0.56 m (shot at 6 s: 0.49 m set) | 0.49 m |
| Last frame | 4 of the last 5 pieces, no marble | unchanged | 4 of the last 5, no marble | unchanged |
| Last marble in the held frame after the last hit | 1.03 s | 1.03 s | 0.47 s | 0.47 s |

What changed (both `camera.py` and `follow-camera.ts`; `pnpm camera:check` within 0.001 mm and 0.016°):

- Readable maximum. `MIN_MARBLE_FRACTION` 3.5 % → 6 % of the frame width at the rig distance (0.99 m for the 24 mm marble), which the steep view's perspective turns into about 5 % at the 10th percentile. 5 % left the camera at 1.13 m and the marbles at 4.5 % at 0:12; 6.5 and 7 % kept the camera within 0.91 and 0.85 m but both marbles in frame on only 76 and 68 % of the frames
- The zoom stays at the readable maximum where the group no longer fits, instead of easing back to the rig distance, and follows the group's need with a 1.5 s time constant (0.5 s before). Easing back to the rig distance framed closer (7.0 % median) but breathed between 0.73 and 0.89 m every few seconds and kept both marbles in frame on 73 % of the frames
- Leading marble. Where the group does not fit, the camera pans to the marble in flight with the most notes in the next 2 s (the scene marbles now carry their lane's note times, `hitTimes`); the focus marble gets half a note extra, a lead lasts at least 1.5 s, and the pan eases over 2.5 s (1.5 s: both in frame 83 %; 3 s ahead: 91.5 % but the 10th percentile marble 5.2 %). The finished-focus-marble rule is now part of it: a marble past `activeUntil` never leads
- Shots scale the automatic distance by their distance over the rig's, after the zoom smoothing; a Push In or Close-Up also frames the leading marble alone. Before, a shot set the base the group need overrode, so a Push In during a wide group frame did nothing, and the 0.5 s zoom smoothing softened a single marble's Push In to 0.56 of 0.7 m
- Ending: unchanged. In Jingle Bells the last marble leaves the held frame 1.0 s after the last hit (at 32.5 s) and is 5 m below it by 34.2 s, so the last 1.5 s of the 35 s song can only show the pieces. Holding on the last hit itself instead of the middle of the last second kept the marble 0.14 s longer but dropped one of the last five pieces in both fixtures; following the fall would show the empty wall the hold avoids. A film that should end on the marble needs its song end, or an End Card, within about a second of the last hit

Draft film and its 1 fps contact sheet: `.local/camera-r7/films/jingle-bells-draft.mp4` and `jingle-bells-draft-contact.jpg`.

### Song tail: the film ends on the marble

Measured on 2026-11-04 with the TypeScript follow camera (`.local/song-tail/measure.ts`, each run extended to 4 s past its last note): seconds after the last hit until the marble that struck it leaves the held frame, with its centre anywhere in the frame and with a 5 % margin.

| Fixture | Last note | End before | Marble in frame | With 5 % margin | End now |
| --- | --- | --- | --- | --- | --- |
| jingle-bells | 32.5 s | 35 s (2.5 s tail) | 1.03 s | 0.93 s | 32.9 s |
| reference-20 | 19.25 s | 20 s (0.75 s) | 0.47 s | 0.43 s | 19.65 s |
| two-marbles | 1.3 s | 1.8 s (0.5 s) | 0.83 s | 0.77 s | 1.8 s (hand-built, unchanged) |
| tap-along | 8.70 s | 11 s (2.3 s) | 0.67 s | 0.63 s | 9.1 s |
| zigzag, windmill, long-gap, staircase | | | 0.67, 0.63, 0.43, 0.13 s | | unchanged |

- `SONG_TAIL` is 0.4 s (1.5 s before, and the MIDI import rounded the last note's end up to a whole second, 2.5 s for Jingle Bells). The shortest stay among the song fixtures is Reference 20's 0.43 s, so 0.4 s is the longest tail that keeps the last marble inside the final frame for all of them. A tail of 0.8 to 1 s would only suit Jingle Bells and Two Marbles. At the new ends the last marble sits in the final frame at (0.36, 0.43) in Jingle Bells, (0.66, 0.12) in Reference 20 and (0.40, 0.31) in Tap Along (frame 0 to 1, y up)
- The import now ends at the last note's start plus the tail, not at its end: a long final note would push the film past the marble
- Audio: `FILM_AUDIO_FADE` 0.4 s, a linear fade over the end of the soundtrack (`renderProjectAudio`, 25 ms before), and an `afade` of the same length in the FFmpeg encode (a volume ramp in Blender's own encoder). Loop films keep their fold and are not faded

### Finish: the film ends on the catch

The reference short's last 2 s (frames in `.local/finish/ref/`): after its final note the marble drops into a curved cage of four chrome wires, posted to the wall with ball ends, rolls down it to the lower left and falls on below it; the film ends with the marble still in frame under the chute. MidiMarble's Finish (Chute) is built after it. Measured on 2026-11-04 with the TypeScript follow camera at 30 fps (`.local/finish/frame-check.test.ts`), the fixtures' Finishes placed by Add Finish (frame 0 to 1, y up):

| Fixture | Last note | Lands in the Finish | Rolls off the Chute | At the catch | Marble leaves the held frame | End |
| --- | --- | --- | --- | --- | --- | --- |
| jingle-bells, Bass (plays last) | 32.5 s | +0.49 s | +0.87 s | (0.34, 0.46) | +1.0 s | 33.6 s (32.9 s before Finishes) |
| jingle-bells, Melody | 31.0 s | +0.48 s | +0.76 s | (0.17, 0.72), while the camera still follows both | | |
| reference-20 | 19.25 s | +0.38 s | +0.83 s | (0.70, 0.22) | +1.71 s | 20.75 s (19.65 s before Finishes) |

- The tail is per film since 2026-11-04 (`finishTail` in `lane-commands.ts`, `finishExit` in `camera/finish-exit.ts`): the time the last marble's centre leaves the frame in the follow camera of a what-if run after its last note, plus 0.1 s, clamped to 0.6 to 1.5 s. The camera does not depend on the end, so the longer run reads the same frames. Jingle Bells: leaves at +0.996 s, tail 1.1 s, end 33.6 s (33.7 s before). Reference 20: leaves at +1.71 s, past the longest tail, tail 1.5 s, end 20.75 s (20.45 s before), marble still in the final frame under the chute. A marble a Cup holds never leaves, so it gets 1.5 s by the same rule (not measured on a fixture). `FINISH_TAIL` 1.2 s remains for a Finish that misses and before the first measurement. `SONG_TAIL` stays 0.4 s without Finishes, and the audio fade stays 0.4 s
- Held ending: half way (`FINISH_FRAME`) from the last hit's follow point to the mouths of the Finishes that catch a marble after the last hit; at the end the mouth sits at (0.39, 0.53) in Jingle Bells and (0.68, 0.34) in Reference 20, and the last pieces stay in frame. `pnpm camera:check` within 0.001 mm and 0.017°
- Catching: dropped onto a free Chute at half gravity, every arrival from 1 to 5 m/s, straight down or moving up to 1 m/s toward the backstop, lands and rolls out (`finish.test.ts`); without the cover over the run-out, arrivals of 3 m/s and more flew over it, and with a 35° hook a marble clipping it bounced out. A Cup holds arrivals up to 4 m/s and 0.6 m/s sideways. Add Finish finds a spot in 0.15 s (Reference 20) and 0.35 s for both marbles of Jingle Bells in Node, on the first or second drop tried
- Hits unchanged: Jingle Bells 115 of 115 and Reference 20 48 of 48 on time with their Finishes

### Flat Light against Fast

Measured on 2026-11-04 with `blender/tests/check_flat_colors.py`: median colour of a 360 × 640 frame of Jingle Bells, which is the wall (8-bit display, frames 300 and 760 for Flat Light; tolerance 12 per channel). Studio Workbench light made Brass's wall (68, 64, 77) at frame 760 and (101, 95, 114) in Zigzag: it darkens a camera-facing wall by a factor that varies with the camera angle. Flat lighting is the same at every frame.

| Theme | Fast | Flat Light | Largest difference |
| --- | --- | --- | --- |
| Pegboard | 174, 157, 139 | 175, 160, 142 | 3 |
| Brass | 159, 151, 171 | 161, 156, 174 | 5 |
| Neon | 14, 19, 31 | 12, 16, 27 | 4 |
| Brass, wall #c4623a | 182, 88, 48 | 184, 92, 52 | 4 |
| Pegboard, wall #2f6f8f | 62, 115, 140 | 61, 117, 143 | 3 |
| Neon, wall #405070 | 50, 71, 100 | 51, 71, 98 | 2 |

- Settings: flat lighting, the scene's AgX look, theme exposure offset and sheen (`flat` in `THEMES`: Pegboard +0.05 stops and 0.025, Brass +1.05 and 0.025, Neon +0.4 and 0.012), metal × 0.4, Neon's materials × 2.2. A project theme's changed light or background colour is not modelled in Flat Light, only its wall
- Speed: Flat Light 16.0 ms/frame with AgX and flat lighting (20.2 before), Jingle Bells filled in 18.2 s (about 24 s before), JPEGs 18.5 kB

### Clean frame edges and an opening on the track

Measured on 2026-11-04 after review finding R6-11 (at 0:21 the Melody marble sits cut by the left edge while the camera follows the Bass; the opening frame shows two marbles over an empty wall with the first pieces at its bottom edge). TypeScript follow camera at 30 fps with `.local/camera-r8/measure.ts` (the round 7 script plus the edge band, the opening and the target's speed) over the first to the last hit; before and after in `.local/camera-r8/before.jsonl` and `after.jsonl`. Frame positions are 0 to 1, y up.

| | Jingle Bells before | Jingle Bells after | reference-20 before | reference-20 after |
| --- | --- | --- | --- | --- |
| Frames with a marble centre within 4 % of a frame edge | 9.6 % | 4.4 % | 0 | 0 |
| Same, only marbles that are playing | 9.0 % | 3.7 % | 0 | 0 |
| Frames with a marble cut by the edge (disc across it) | 14.9 % | 7.1 % | 0 | 0 |
| Edge stretches of 0.2 s or more | 13.3, 15.6, 20.9, 23.1 to 24.0 s | 9.8 s, 31.7 s (the finished melody falling away) | | |
| Marble in frame width, median (10th percentile) | 6.2 % (5.4) | 6.1 % (5.4) | 8.7 % (8.0) | 8.7 % (8.0) |
| Camera distance, median and max | 0.91, 0.97 m | 0.93, 0.97 m | 0.7, 0.7 m | 0.7, 0.7 m |
| Both marbles in frame | 87.9 % | 80.8 % | | |
| Melody / bass in frame while it plays | 97.9 / 92.5 % | 94.7 / 88.3 % | 100 % | 100 % |
| Target speed, 99th percentile and max | 0.63, 0.71 m/s | 0.47, 0.49 m/s | unchanged | unchanged |
| Opening: first three struck pieces at height | 0.22, 0.00, 0.07 | 0.35, 0.16, 0.21 | 0.49, 0.08, 0.31 | 0.71, 0.27, 0.37 |
| Opening: marbles at height | 0.72, 0.43 | 0.87, 0.64 | 0.54 | 0.82 |
| Last marble in the held frame after the last hit | 0.43 s | 0.43 s | 0.43 s | 0.43 s |

What changed (both `camera.py` and `follow-camera.ts`; `pnpm camera:check` within 0.001 mm and 0.016°):

- Edges. After the target is baked, every marble in flight is seen through the baked view. One that does not lead stays inside `EDGE_IN` (0.8 of the half frame, 10 % of the frame from its edge) or beyond `EDGE_OUT` (1.15, fully out): it keeps the side it came from while it swings through the band, a side lasts at least 1 s, and it goes out wherever keeping it in would take the leading marble past `LEADER_KEEP` (0.8). Kept out, it is pushed only once within `EDGE_NEAR` (0.88): without that, Two Marbles, which is clean, lost its second marble on 23 % of the frames. The leading marble is kept in too. The shift a marble needs holds at its largest over `EDGE_HOLD` (±0.5 s) and eases over `EDGE_EASE` (0.45 s) on its own, outside the target's 0.34 s smoothing. Earlier versions that shifted the follow point before the target smoothing, or decided the side frame by frame, reached 4.9 to 7.4 %: the bass's zigzag swings it in and out of the band about once a second
- The bass in Jingle Bells zigzags across the left edge of the melody's frame between 9 and 14 s and 20 and 27 s; every remaining stay in the edge band is shorter than 0.2 s except at 9.8 s and 31.7 s. Holding it in would push the leading melody past its keep, so it goes out cleanly and both-in-frame drops from 87.9 to 80.8 %. Keeping the leading marble in on every frame reached 3.4 % but made the long pan of the far-apart test marbles jump (0.020 m in a frame against 0.013), so while the frame pans to a marble arriving from beyond `EDGE_OUT` (or the leader's share is below `LEAD_SETTLED`, 0.75, while one does) the pan sets the pace alone. A hold of ±0.75 s or ±1 s, or `LEADER_KEEP` 0.7 to 0.9, gave 4.2 to 4.5 %
- Opening. Until the first hit the follow point is the centre, in the image, of the box around the marbles (in flight or waiting at their release point) and the first three struck pieces within 2 s of the first hit (`opening_pieces`, set by `apply_scene`); the zoom widens to fit the box within the readable maximum and the opening eases into the follow over 1.5 s after the first hit. Centred on the wall instead, the steep view put the box low (pieces at 0.09 to 0.27, marbles at 0.73); counting only marbles in flight left them out of frame until their release at 0.5 s. Where the box does not fit the readable maximum the opening is skipped: Two Marbles' first pieces span the wall's width and its opening is unchanged. Loops have no opening
- Ending: unchanged; the song-tail test still holds (last marble at the final frame inside a 5 % margin)

Draft film and its 1 fps contact sheet: `.local/camera-r8/films/jingle-bells-draft.mp4` and `jingle-bells-draft-contact.jpg`; frames 0, 15, 30 and 630 in `opening-21s.jpg`.

### Duets in one frame, a lead on falls, framing problems from the camera

Measured on 2026-11-04 after review findings R7-10 (at 0:12 the camera drops Bass completely), R7-4 (a falling marble sits low with the next pieces cut by the bottom edge) and R7-1 (framing problems computed from a fixed band contradict the Draft Preview). TypeScript follow camera at 30 fps with `.local/camera-r9/measure.ts` (the round 8 script plus where a marble sits in the frame while it falls faster than 0.5 m/s) over the first to the last hit; before and after in `.local/camera-r9/before.jsonl` and `after.jsonl`, side by side in `compare.txt`. Frame positions are 0 to 1, y up.

| | Jingle Bells before | Jingle Bells after | reference-20 before | reference-20 after |
| --- | --- | --- | --- | --- |
| Both marbles in frame | 80.8 % | 95.5 % | | |
| Melody / bass in frame while it plays | 94.7 / 88.3 % | 99.0 / 98.8 % | 100 % | 100 % |
| At 0:12 | Melody only, 5.7 %, 12 pieces, 0.96 m | both, 4.6 and 5.9 %, 25 pieces, 1.09 m | 9.1 % | 10.1 % |
| Marble in frame width, median (10th percentile) | 6.1 % (5.4) | 5.6 % (5.0) | 8.7 % (8.0) | 9.6 % (8.7) |
| Camera distance, median and max | 0.93, 0.97 m | 1.00, 1.09 m | 0.7, 0.7 m | 0.7, 0.7 m |
| Largest distance change within 1 s | 0.045 m | 0.051 m | 0 | 0 |
| Frames with a marble centre within 4 % of a frame edge (playing only) | 4.4 % (3.7) | 2.6 % (2.0) | 0 | 0 |
| Frames with a marble cut by the edge | 7.1 % | 3.4 % | 0 | 0 |
| Falling marble's height in frame, median (10th percentile) | 0.51 (0.35) | 0.53 (0.36) | 0.52 (0.39) | 0.63 (0.48) |
| Opening: marbles at height | 0.87, 0.64 | 0.82, 0.62 | 0.82 | 0.83 |
| Last marble in the held frame after the last hit | 0.43 s | 0.43 s | 0.43 s | 0.43 s |
| Last five pieces at the last hit; in the last frame | 3; 3 | 3; 3 | 4; 3 | 3; 3 (the fourth sat on the edge, its centre at 1.00, now 1.02) |
| Framing problems in the problem model | none (the band) | none (the camera) | none | none |

Falls on the other fixtures (median and 10th percentile of the falling marble's height): Tap Along 0.51 (0.41) → 0.65 (0.53), Zigzag 0.52 (0.43) → 0.63 (0.52), Loop 0.54 (0.37) → 0.65 (0.50), Staircase 0.52 (0.35) → 0.58 (0.36); a 1.5 s drop at 2.5 m/s (`follow-camera.test.ts`) puts the marble at 0.68 mid-drop and never below 0.29. Two Marbles is unchanged in every row.

What changed (both `camera.py` and `follow-camera.ts`; `pnpm camera:check` within 0.001 mm and 0.017° on seven fixtures, one of them Jingle Bells with the bass moved 20 cm, a Wide shot and a rolled Push In):

- Duets. `MIN_MARBLE_FRACTION` 6 % → 5 % of the frame width at the rig distance, which the steep view's perspective turns into 4.6 % or more for every marble (10th percentile 5.0 %). The camera keeps framing the group up to that readable maximum and follows the busier marble only beyond it, as before. 5.5 % kept both in frame on 83.4 % of the frames and made the edge band worse (7.1 %); 4.5 and 4.7 % gave the same result as 5 % with a wider camera (1.12 m), as the piece size limits the zoom there. `DISTANCE_TAU` 1.5 → 1.8 s keeps the zoom from pumping (0.061 m within a second at 1.5 s; 2 s gave 0.045 m but put Two Marbles' second marble at the edge on 7.7 % of its frames)
- Falls. While the follow point falls faster than `FALL_START` (0.3 m/s), the frame looks `FALL_AHEAD` (0.25 s) of the extra speed below it, at most `FALL_LIMIT` (15 %) of the camera distance, held `FALL_HOLD` (0.5 s) past the fall, as the smoothed target slows before the marble lands, and eased over `FALL_EASE` (0.6 s). The look-ahead before this was capped at `LEAD_LIMIT`, 4 % of the distance. A framed group and the opening lead no fall, and the lead fades out over the second before the hold, so the held ending is unchanged. Leading into the hold too kept the falling marble 0.1 frame higher in the tail but dropped one of the last five pieces in Reference 20 and two in Tap Along; 0.15 s ahead and 12 % left falls at 0.54
- Opening. The opening box must fit 85 % of the readable maximum (`OPENING_ROOM`): with the wider maximum Two Marbles' box, at 0.96 of it, became an opening and lost both marbles at the top of the first frame; it keeps no opening, as before. Jingle Bells needs 0.76, Reference 20 0.52
- Wide shots frame the group. A Wide shot widens the readable maximum by its scale, sizes the group around its own centre as well as around the first pass's target, and stands at least its distance away; before, it only multiplied the automatic distance, so a Wide shot while the camera followed one marble kept that marble centred and the other out
- Framing problems. `framingStretches` (`camera/framing.ts`) projects every marble through the same track the Draft Preview draws: a marble is out while its centre is outside the frame from 0.3 s before its first note to 0.3 s after its last, stays back in shorter than 0.25 s join, and a stretch longer than 0.5 s that holds at least one of its notes is a problem: "Bass leaves the frame at 0:09.03 (9 hits)" with "Out of frame for 4.6 s while it plays, until 0:13.67. The camera follows Melody there." The band and pace checks are gone. Cost: about 17 to 20 ms per new run for Jingle Bells (the camera bake; 0.3 ms before), 0.1 to 0.2 ms for every further read of the same run, as the track and the framing are kept per run
- Add Wide Shot Here. The Camera panel shows the problem at the playhead, where a jump to it lands, with the fix once a what-if of the camera with the shot (from 1.5 s before the problem to 0.5 s after, at 1.6, 2.0 or 2.5 times the rig distance) keeps the marble in frame and leaves fewer framing problems; about 17 ms once per problem. With the bass moved 20 cm every one of the five problems has a working Wide shot; with 40 cm only the first does, and the others offer none

## Scale

Blender's default unit is the metre, and the purchased Marble Race Kit uses real scale: marbles are 16 mm and track modules about 0.2 m. MidiMarble works in the same units; its default kit is 1.5 times that size (24 mm marbles, 9 cm bars), which reads at the reference film's scale, as `reference-20` showed first. Rapier and Blender then share units, and lighting, depth of field and physics behave like real objects.

The Marble Race Kit (`assets/3D/blender/Marble Race Kit_v2.2`) is a purchased local reference. It can inform proportions and be used in a personal library, but it is not shipped with the app.

## Second reference: pitch-coloured tubes

A frame from another channel (@marvinblend, "Internet Classics", Boomwhackers section), shared by the owner. Not stored in the repository.

- Two marbles share one frame, each with its own dense column side by side, so two-lane layouts are a legitimate format
- Scale: tubes about 15–20 % of the frame width, marbles about 5 %
- Pieces are boomwhacker tubes coloured by note, so pitch is visible. A theme can derive colour and tube length from each hit's pitch
- Tubes point into depth at varied angles on wire brackets, which adds depth without changing the contact surface
- Titles are a screen overlay with a translucent box (section number and song), not wall text
