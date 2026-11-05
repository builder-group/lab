# References

What the app must be able to produce. Reference media stays outside the repository; paths below are local.

## Reference short

Source: `~/Downloads/Legendary-Meme-Songs-SnapYT.App.mp4` from [@virtual3dworld_1000](https://www.youtube.com/@virtual3dworld_1000/shorts). 360×640, 30 fps, 56 seconds.

**Structure**

- One continuous shot without cuts
- A medley of six songs, each about 8 to 14 seconds. Each song is a section with its own piece skins: gold bars with chrome devices, copper bars, dark gray housings with white keys, silver bars and dark knobs with glowing red tops.
- The song title appears as screen-fixed text at the start of each section, with a channel watermark
- A short curved wire rail joins each section to the next
- The run ends in a catch: the marble drops into a curved cage of four chrome wires, posted to the wall with ball ends, and the film ends with it in frame

**Track**

- One blue glass marble, roughly a third of a bar's length
- Pieces form two parallel diagonal columns and the marble zigzags between them. Columns often use different skins of one section's set.
- Pieces in a column are evenly spaced, the same size and at the same angle, so the rhythm is visible
- Bars stand on long posts off the wall, about 15 cm out, and read long into the depth
- Pieces react on hits: keys press, red tops glow

**Timing.** 3.7 to 4.4 audio onsets per second with a median gap of about 240 ms. Hits follow a subset, so a run needs reliable hits at 250 to 500 ms and occasional passages near the 180 ms minimum.

**Camera.** Close through a wide lens, about 30 mm and 20 marble diameters away, tilted about 31° from the wall normal. Bars fan out from a point about a frame width from the center, with an angle spread of 22° in the frame. Travels continuously, marble slightly above the frame's center, and hardly rolls, about 0.4° per second. No hard moves.

**Look.** Pale lavender-gray wall with subtle texture, one soft sun from the left with soft sideways shadows, dark metal with thin bright edges, a clear marble. Measured on the film: wall L* 57, a 6, b -10, 6 L* across the frame; gold L* 41, chroma 33; 1 % of piece area over L* 80; marble L* 33, chroma 42. Brass's defaults aim at these.

## Second reference: pitch-colored tubes

A frame from @marvinblend, "Internet Classics", Boomwhackers section. Not stored in the repository.

- Two marbles share one frame, each with a dense column, so two marbles side by side are a legitimate format
- Tubes about 15 to 20 % of the frame width, marbles about 5 %
- Tubes are colored by note, so pitch is visible
- Tubes point into depth at varied angles on wire brackets, adding depth without changing the contact surface
- Titles are a screen overlay, not wall text

## Targets

1. **Reference short:** recreated through the app as the last step. Use an original or public-domain melody for anything committed or shared. The reference audio may be used locally to compare timing density.
2. **Jingle Bells:** the whole refrain, 115 hits on two marbles, from `fixtures/jingle-bells.mid`

A target passes when every hit lands within 20 ms of its note, the film renders without manual Blender edits, and a side-by-side review shows comparable structure and polish.

## What good tracks do

Measured from the reference short and an earlier Jingle Bells film, with both channels' shorts viewed by eye; method in `.local/track-study.md`. L is the bar length in the image, W the frame width, d the marble diameter. Targets are image-space, and starting ranges rather than limits. They inform Patterns and tests; none is a rule in the app.

1. Close, wide camera: bars' vanishing point about 1.0 W from the center, bar angle spread about 22°
2. Bar 20 to 27 % W, marble 6 to 8 % W, marble about 0.33 of a bar
3. Same-column step 0.8 to 1.0 L, drop per hit 0.4 to 0.6 L
4. Straight columns within a phrase: same-column sideways shift at most 0.2 L median, 0.7 L at p90; drift over 8 hits at most 1 L
5. Column centers 1.0 to 1.2 L apart, inner ends 0 to 0.25 L apart, strikes on the inner third
6. A repeated phrase repeats its shape: tilt correlation at the phrase lag at least 0.8. Blocks of 3 to 5 parallel pieces, with a jog of 0.5 to 1 L only at phrase boundaries
7. About ±10° of tilt, opposite between columns, same-column tilt within ±3° on at least 80 % of neighbors
8. Almost no roll, heading changes between sections, marble at x 0.3 to 0.65 and y 0.35 to 0.53 from the top
9. A new skin set every 6 to 14 s, one skin per column; a screen-fixed title for about 2 s, starting 1 to 2 s before the rail
10. Gaps of 0.55 s or more (about 8 % of hits) bridged by one thin curve of 1.4 to 1.9 L, at section changes first
11. One strike per piece: 0 double bounces in 161 hops. In flight the marble may pass within 0.1 to 0.5 d of a neighbor in the image, without touching
12. Played pieces change state and stay changed; decor stays large, sparse and beside the columns

## The default camera and bars on long posts

The main finding on the look. The reference fans its bars out and gives every piece depth. It takes three things together, none of them physics:

- **A wide lens, close.** 30 mm at 48 cm, Tilt 0.54 rad. A marble spans the same share of the frame as through a long lens further away, but the bars' vanishing point sits just beside the frame.
- **A side-turned view.** Turn 90°, so bars show their long sides.
- **Bars on long posts.** Platforms are 3 cm along the wall and 15 cm deep. Past 9 cm a Depth keeps the bar's size and stands it out on a post. Hops, columns and the canvas's fit stay spaced by `PLACEMENT_LENGTH`, 9 cm, since spacing by 3 cm stopped repeated Next at 4 of 16 hits on a 0.25 s run.

Measured on rendered frames of Reference 20 rebuilt with today's bars and of the reference's whole film. Jingle Bells' marble size comes from the baked camera:

| | Default | Reference |
| --- | --- | --- |
| Bars' vanishing point from center | 0.98 W | 1.06 W |
| Bar angle spread | 21.7° | 22.3° |
| Marble in frame width, one marble | 7.5 % | 7.5 % |
| Marble in frame width, Jingle Bells' two marbles, median | 5.1 % | |
| Cut-off pieces per frame | 1.1 of 6.9 | 2.9 of 13.1 |
| Scroll, median flow, W/s | 0.75 | 0.45 |

Cut-off pieces come with the lens: the reference has more than we do. The higher scroll comes from hop scale, not the camera: a long lens at the same marble size measures 0.70 W/s on the same run. Phase correlation isn't a usable measure of it here: it reads 3.9 W/s at p95, in spikes every 0.8 s where a bar lands on where the column's previous bar was.

Physics stays out of it:

- Depth is visual. Colliders keep a fixed 4.5 cm (`COLLIDER_DEPTH`), since at 9 cm colliders Jingle Bells missed 53 of 115 hits by Rapier's rounding alone.
- The marble is drawn at half the median platform Depth (`pathDepth`), a look only. Rails, the Bowl and Windmills run at that depth on posts to the wall.
- Touching is measured only in the wall plane. Bars may lie over each other in the film's view, as in the reference.
- Themes use f/32, so the frame's ends stay sharp.

## Measured limits

**Density needs the camera, not gravity.** The drop per hit is (1 − e) / (1 + e) · gT² / 2. Half a bar per column at 0.4 s hits needs about 0.15 to 0.2× gravity, where Build Track leaves 9 to 34 of 47 hits open. Half gravity is the default: columns stack 1.7 times denser than at full gravity, and the run covers 40 % less wall.

**Bounce.** Above e ≈ 0.71 a marble rises past the previous piece of the other column. The default is 0.65. A roll is a rise under 0.5 marble radii along the normal within 0.1 s: dead bars reach 0.11 to 0.19 radii, real bounces 0.71 and up.

**Tight columns don't fit our rhythm.** A hop under about 1.4 L at half gravity and half-second notes gets stuck on restrikes. Columns stay 1.5 to 1.7 L apart on Jingle Bells. The reference's 0.25 s rhythm is half our 0.5 s, and hop height goes with its square, so this probably closes with faster notes or less gravity, not with placement.

**Marbles side by side.** `MARBLE_SPACING` stays 0.26 m. Rebuilds at 0.16 to 0.22 m gave no clean build that frames closer, as built marbles stay 0.26 to 0.29 m apart at every spacing. Closer two-marble films need bands that interleave by design.

**Patterns and tilt,** on the reference's hit times:

| Gravity, Width, Bounce | On time | Median tilt | Gap falls |
| --- | --- | --- | --- |
| 0.5, 14 cm, 0.5 | 58/58 | 29° | 5, 11, 8 cm |
| 0.5, 14 cm, 0.65 | 55/58 | 28° | 17, 10, 10 cm |
| 0.5, 14 cm, 0.35 | 58/58 | 27° | 5, 13, 9 cm |
| 1, 14 cm, 0.5 | 58/58 | 16° | 30, 11, 12 cm |
| 1, 11 cm, 0.5 | 58/58 | 13° | 56, 11, 10 cm |

Bounce doesn't lower tilt; Gravity does. Build Track on the same hits falls 35, 81 and 303 cm in those gaps.

**Reference against us.** From the baked camera:

| | Marble in frame width, median | Camera distance, median |
| --- | --- | --- |
| Reference short | about 7.5 % | |
| Jingle Bells | 5.1 % | 0.65 m |
| Reference 20 | 7.3 % | 0.48 m |

**The opening.** Jingle Bells' box spans 0.78 m along the wall. It needs about 0.81 m of distance for a 10 % margin, past the 0.79 m at which a marble still spans 4.5 % of the frame width, so it opens with 9 %.

**Film endings.** The tail after the last note is 0.4 s (`SONG_TAIL`), the longest that keeps the last marble in the final frame on the song fixtures. With Bowls catching it, 0.6 to 1.5 s.

**Flat Light against Fast.** The wall's median color stays within 12 per 8-bit channel per theme, the most on Pegboard with a blue wall and at most 7 on the built-in walls (`check_flat_colors.py`), at about 16 ms per 360 × 640 frame, through a per-theme exposure and sheen, and a wall sheen for the room a wall reflects whatever its color. A project theme's changed light or background isn't modeled in Flat Light, only its wall.

**Bloom** is cheap at quality Low and only runs while `bloom > 0`; Flat Light skips it.

## Scale

Blender's unit is the meter, and the purchased Marble Race Kit uses real scale: marbles 16 mm, track modules about 0.2 m. MidiMarble works in the same units, with a default kit 1.5 times that size (24 mm marbles), so Rapier and Blender share units and lighting and depth of field behave like real objects.

The Marble Race Kit (`assets/3D/blender/Marble Race Kit_v2.2`) is a purchased local reference for proportions and a personal library. It doesn't ship with the app.
