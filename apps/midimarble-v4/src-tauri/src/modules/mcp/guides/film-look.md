# The film's look

Film dresses the run without changing a single hit. Make the environment fit the song and the person's References (`get_state.references`, and the images in `agent/references/`, which you can open). When the person gives you images or words for the look, keep them with `set_references(paths, text)`: it copies the images into `agent/references/` and replaces what was there, so later runs see them. The window has no panel for them.

## What to set

- **Theme**: dresses every piece, the wall and the light. One per project. `{ type: 'updateFilm', film: { theme: id } }` with `pegboard`, `brass`, `neon` or an id from `get_state.projectThemes` or `get_state.packThemes`. Pegboard, Brass and Neon are the Starter Pack's, which is always there. Another Pack brings its themes when added (`run_command('film.addPack', { name })` or `{ path }`); setting one copies it into the project, and `run_command('film.removePack', { name })` takes the Pack away again. To keep a look, `run_command('film.exportPack', { path, name, theme: true })` writes a Pack with it as a theme; a project theme can also be stored with `updateFilm`, in `themes` (`{ id, name, base, overrides }`). `get_state.theme` shows the theme. A theme restyles what is there; Decor is never part of one.
- **Skins**: `{ type: 'applySkin', assetId, ids }` or `{ ..., pieceType }`, with `marble` as a piece type. `list_commands` answers with `skins.builtIn` per element and `skins.library`, the project's own. An id that doesn't exist or doesn't fit is an error. `get_state.marbles[].skin` shows what a marble wears, the theme's when it has none of its own.
- **Marbles**: `marble:contrast` is the theme's marble: pearl on a dark wall, its color made deep on a light one, whichever stands apart more, so the same color looks different per theme and per wall. `marble:glass`, `marble:metal`, `marble:magic` are the same in every theme; Glass and Magic take the marble's color, and `marble:pearl` and `marble:deep` say the choice outright. For a color: `{ type: 'updateMarble', marbleId, patch: { skin: { color: '#22ff66' } } }`. A skin's own color: `patch: { skin: { colorSource: 'skin' } }` (`skin`, `marble` or `note`), and `variant` such as `cats-eye` on Glass, the same on a marble or with `updatePiece`.
- **A marble's color in the film is its skin's**: `patch: { skin: { colorSource: 'marble', color: '#ff1a2e' } }`, and platforms with Color: Marble wear it too. `get_state.marbles[].filmColor` says what it is now. `labelColor` labels the marble in Layers, the timeline and Track, and reaches the film only on the skin None (`marble:none`, `platform:none`…), which draws a plain Pegboard piece or marble in its label color; a skin never changes it.
- **Wall**: `{ type: 'updateFilm', film: { wall: { color, backgroundColor, kind, labelColor } } }`. `labelColor` is the plain Pegboard wall's color in Track, and the film's under `kind: 'none'`. `color` is the wall you see. `backgroundColor` is the world behind and around it, which only shows beyond the wall and in reflections. `kind` is its skin: `plain` is one smooth color, the way to turn a theme's pattern off; `plaster`, `pegboard` (holes) and `grid` are the others. Name only what changes.
- **Light**: `{ type: 'updateFilm', film: { lights: { key: { color, strength, side, height, softness, exposure, bloom } } } }`. A film has one Key Light: `key` and `added`, a list of `{ id, name, color, strength, side, height }` from `light.add`. `side` runs -1 left to 1 right, `height` -1 below to 1 above, `softness` and `bloom` 0 to 1, `exposure` -3 to 3 stops, `strength` from 0, about 3 to 5 as usual. `get_state.wall` and `get_state.lights` show what the film uses and, in `own`, what this project set on top of its theme. `run_command('edit.select', { select: ['wall'] })` or `['light:key']` shows that layer's inspector to the person.
- **Decor**: things on the wall behind the run. No hitbox. The Starter Pack has Sphere, Ring, Cube and Particles; add a Pack for more (`run_command('film.addPack', { name: 'Christmas' })` brings baubles, a star and the like), or make your own with `add_asset`. Then `{ type: 'placeDecor', source: 'decor:star', at: { x, y } }` puts one at a wall point, and `{ type: 'scatterDecor', sources: ['decor:star', 'decor:bauble-red'], density: 0.2, seed: 1 }` fills what the camera sees and replaces what it scattered before. Starter's ids: `decor:bauble-red`, `decor:bauble-gold`, `decor:snowflake-gold`, `decor:fairy-light`, `decor:gift-box`, `decor:star`. `get_state.decor` counts what is placed.
- **Particles**: drifting snow, sparks or dust in front of the wall, over the whole frame. It is one Decor item with no place of its own: `{ type: 'placeDecor', source: 'decor:snowfall', at: { x: 0, y: 0 } }`.
- **Titles**: `run_command('film.addText', { text, style, at: { x, y }, color, in, out })`. `style` is `wall` (on the wall, seen as the camera passes), `caption`, `songName` or `endCard` (in the frame, with their usual timing); only `text` is needed. `get_state.layers.titles` lists them. Change one by writing the list back: `{ type: 'updateFilm', film: { titles: [...] } }`, with every title, each `{ id, name?, text, font, size, color?, in?, out?, style?, plate?, position: { x, y }, angle }`. `size` is meters on the wall, and a share of the frame's height for the others. `font` is `Bfont Regular` or a `.ttf` or `.otf` in the project.

## The camera

`get_state.camera` shows it. Change it with `{ type: 'updateFilm', film: { camera: { ... } } }`, naming only what changes. Lengths are meters, angles radians.

| Field | Default | What it does |
| --- | --- | --- |
| `auto` | `true` | The Follow Marbles toggle. On, the camera follows the marbles. Off, the camera is left to Blender, so use it only with Open in Blender, as it freezes the camera where it is |
| `distance` | 0.48 | How close: the 30 mm lens shows about `0.68 × distance` of wall across in 9:16 from the front, about `0.79 × distance` at the default tilt. Marbles get smaller as it grows, and side Decor belongs inside that width |
| `tilt` | 0.54 | Downward angle: 0 looks straight at the wall, larger looks further along it |
| `turn` | 1.57 (90°) | How far around the marbles the camera stands, 0 to 2π radians |
| `sway` | 1 | 0 to 1, how much the view turns with the run and rolls on its own, by about a degree. 0 holds `turn` and keeps the wall upright, so a vertical line stays vertical |
| `focusMarbleId` | first marble | The marble kept when they don't all fit |
| `shots` | none | Moves at given times |

With more than one marble the rig widens beyond `distance` when it must, to a limit, and otherwise keeps the leading marble.

A shot eases the camera to its values at `time`. `run_command('camera.addShot', { time, kind, distance, hold })` adds one at the playhead with no arguments; `kind` is `wide` (1.6 × the rig's distance), `follow` (1 ×), `pushIn` (0.7 ×, the usual) or `closeUp` (0.45 ×), and its distance can be set outright. `hold` is the seconds it holds before easing back, 0 until the next shot. A closer shot can make a marble leave the frame: the reply's `problems` say so. To change or remove shots, set the whole `camera.shots` list, each `{ id, time, kind, distance, hold? }`.

## Judging it

`preview_frame(time)` shows a Blender frame; draft is quick, blender is larger and takes longer. Look at a frame near the start, a busy moment and the end. Ask of each: can you read the marble against the wall? Does the wall feel like the place the song asks for? Is one thing the brightest in the frame? Less decor is usually better; it should never crowd the run. `problems` also warns when the camera loses a marble or decor overlaps the path.

Then `play_range(from, to)` for the person, and ask them.

## Export

`export_film({ quality: 'draft' })` is flat and quick, for testing. `final` is 1080p with the real look and takes longer; stills from `preview_frame` are the quick way to judge a look. `get_state.quality` holds the choice by its ids, `draft` and `final`, which `updateFilm { quality }` takes too. It answers within seconds with progress; call `export_film()` with no quality to check. Without `path` the film lands in the project's `renders` folder.
