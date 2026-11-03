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
3. The wall is finite. From 22 s on, with the melody about 20 m down, the camera passes the wall edge.
4. One frame band for all marbles. `frameBand` centres on the first marble's release, so the second marble's assists pull it toward the melody. The build gave each lane its own band by putting its marble first in the project the assists see.
5. Auto place fails after fast arrivals. A release at 0 s (the import's default) reaches the first hit at about 5 m/s and no angle keeps the next dot in frame; the build released at 0.75 s. Later, 22 hits had no Auto place answer and were rotated by hand, and 9 needed the previous piece rotated first.
6. Launch angles are too steep. The rail suggestion fails when the piece before a gap throws the marble out of the frame band; 17° to 28° launches failed for 1 s gaps and the build re-tilted the launcher to 5° to 16°.
7. Continue and Mirror ignore a following long gap, so a ghost can take the launch hit. The build stopped ghosts before launch hits.
8. Hits can count as on time while a marble rests on a piece. The build rejects hits whose arrival speed is below 0.3 m/s.
9. `@tonejs/midi` loaded through its CommonJS build in Node, so `parseMidiFile` did not run outside a bundler. Fixed in `music/midi.ts`.

Next steps: a long-gap piece that holds the marble for 1 to 2 s inside the band (a switchback rail or a cup), a per-lane frame band in the assists, a shared descent rate across lanes (or one camera per marble), an infinite or growing wall, gentler launch angles, and an arrival-speed check in the hit status.

## Scale

Blender's default unit is the metre, and the purchased Marble Race Kit uses real scale: marbles are 16 mm and track modules about 0.2 m. MidiMarble uses the same scale. Rapier and Blender then share units, and lighting, depth of field and physics behave like real objects.

The Marble Race Kit (`assets/3D/blender/Marble Race Kit_v2.2`) is a purchased local reference. It can inform proportions and be used in a personal library, but it is not shipped with the app.
