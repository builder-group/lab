# The film's look

Film dresses the run without changing a single hit. Make the environment fit the song and the person's References (`get_state.references`, and the images in `agent/references/`, which you can open).

## What to set

- **Theme**: dresses every piece, the wall and the light. One per project. `design.themePegboard`, `design.themeBrass`, `design.themeNeon`, or a project theme with `setDesign { theme: id }`. Added Packs bring more. `design.saveAsTheme` keeps changes as a project theme. A theme restyles what is there; Decor is never part of one.
- **Skins**: one piece type's look. `applySkin` with a built-in id such as `platform:copper` or a library item.
- **Wall and light**: select `wall` or `light:key` and see their values, or `setDesign` with `wall` and `lights`.
- **Decor**: things on the wall behind the run. No hitbox. `placeDecor`, or `scatterDecor` to fill what the camera sees. Add Pack brings items (`run_command('design.addPack', { name: 'Starter' })`), or make your own with `add_asset`.
- **Camera**: the follow camera works out of the box. `camera.addShot` adds a shot at the playhead (seek with `play.nextHit`), `camera.addWideShot` a wide one.
- **Titles**: `design.addText` for a wall title.

## Judging it

`preview_frame(time)` shows a Blender frame; draft is quick, blender is larger and takes longer. Look at a frame near the start, a busy moment and the end. Ask of each: can you read the marble against the wall? Does the wall feel like the place the song asks for? Is one thing the brightest in the frame? Less decor is usually better; it should never crowd the run. `problems` also warns when the camera loses a marble or decor overlaps the path.

Then `play_range(from, to)` for the person, and ask them.

## Export

`export_film({ quality: 'draft' })` is flat and quick, for timing. `fast`, `balanced` and `best` use the real look and take longer. It answers within seconds with progress; call `export_film()` with no quality to check. Without `path` the film lands in the project's `renders` folder.
