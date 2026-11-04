# The film's look

Film dresses the run without changing a single hit. Make the environment fit the song and the person's References (`get_state.references`, and the images in `agent/references/`, which you can open).

## What to set

- **Theme**: dresses every piece, the wall and the light. One per project. `design.themePegboard`, `design.themeBrass`, `design.themeNeon`, or a project theme with `setDesign { theme: id }`. Added Packs bring more. `design.saveAsTheme` keeps changes as a project theme. A theme restyles what is there; Decor is never part of one.
- **Skins**: one piece type's look. `applySkin` with a built-in id such as `platform:copper` or a library item.
- **Wall and light**: `get_state.wall` and `get_state.lights` hold this project's values, on top of `get_state.theme`. Change them with `setDesign` and `wall` and `lights`, as `{ type: 'setDesign', design: { wall: { backgroundColor: '#fff2d2' } } }`. `run_command('edit.select', { select: ['wall'] })` or `['light:key']` shows that layer's inspector to the person.
- **Decor**: things on the wall behind the run. No hitbox. Add Pack brings items first (`run_command('design.addPack', { name: 'Starter' })`), or make your own with `add_asset`. Then `{ type: 'placeDecor', source: 'decor:star', at: { x, y } }` puts one at a wall point, and `{ type: 'scatterDecor', sources: ['decor:star', 'decor:bauble-red'], density: 0.2, seed: 1 }` fills what the camera sees and replaces what it scattered before. Starter's ids: `decor:bauble-red`, `decor:bauble-gold`, `decor:snowflake-gold`, `decor:fairy-light`, `decor:gift-box`, `decor:star`. `get_state.decor` counts what is placed.
- **Particles**: drifting snow, sparks or dust in front of the wall, over the whole frame. It is one Decor item with no place of its own: `{ type: 'placeDecor', source: 'decor:snowfall', at: { x: 0, y: 0 } }`.
- **Camera**: the follow camera works out of the box. `camera.addShot` adds a shot at the playhead (seek with `play.nextHit`), `camera.addWideShot` a wide one.
- **Titles**: `design.addText` for a wall title.

## Judging it

`preview_frame(time)` shows a Blender frame; draft is quick, blender is larger and takes longer. Look at a frame near the start, a busy moment and the end. Ask of each: can you read the marble against the wall? Does the wall feel like the place the song asks for? Is one thing the brightest in the frame? Less decor is usually better; it should never crowd the run. `problems` also warns when the camera loses a marble or decor overlaps the path.

Then `play_range(from, to)` for the person, and ask them.

## Export

`export_film({ quality: 'draft' })` is flat and quick, for timing. `fast`, `balanced` and `best` use the real look and take longer. It answers within seconds with progress; call `export_film()` with no quality to check. Without `path` the film lands in the project's `renders` folder.
