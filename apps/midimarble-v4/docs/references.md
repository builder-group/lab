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

## Scale

Blender's default unit is the metre, and the purchased Marble Race Kit uses real scale: marbles are 16 mm and track modules about 0.2 m. MidiMarble uses the same scale. Rapier and Blender then share units, and lighting, depth of field and physics behave like real objects.

The Marble Race Kit (`assets/3D/blender/Marble Race Kit_v2.2`) is a purchased local reference. It can inform proportions and be used in a personal library, but it is not shipped with the app.
