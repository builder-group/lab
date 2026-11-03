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
| Music | First phrase, 11 notes (13 in the source), one marble, 9.3 s | First phrase, 13 hits, one marble, 11.25 s | Whole 16-bar refrain plus a quarter-note bass, 51 + 64 hits on two marbles, 35 s |
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
