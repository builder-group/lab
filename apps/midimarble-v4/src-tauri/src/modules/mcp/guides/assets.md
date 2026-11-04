# Making assets

A skin or decor item is a `.blend` plus `manifest.json`, built with headless Blender and brought in with `add_asset`. It shows in Insert or the skin picker with the origin line **Made by Agent**, so the person can use it by hand too. Work in the project's `agent/scratch/`. Blender is usually at `/Applications/Blender.app/Contents/MacOS/Blender`.

## asset.blend

Exactly one collection named `MM_ASSET` holds the model. Model in metres. Pack every texture (`bpy.ops.file.pack_all()`).

- **Skin**: origin at the centre of the contact surface, +Z away from it. The face the marble touches lies at z = 0 and the body extends toward -Z. The app orients it on the piece. Fit the piece's params; `get_state` lists pieces and a platform's `length` is in its params.
- **Marble skin** (`pieceType: 'marble'`): a sphere with its origin at the marble's centre. It scales evenly from `fittedParams.radius`, the radius you built it at, to the marble's (`get_state.marbles[].radius`), and rolls with the marble. Physics never reads it. Often `marble:glass` with the marble's colour is all you need.
- **Decor**: origin at the centre of the back face, flat on the wall, +Z toward the camera. No hitbox: marbles never touch it. Keep the geometry cheap, since it repeats.
- Optional reaction parts: child objects named `MM_REACT_<Name>` with a custom property `mm_reaction` set to `press`, `wobble` or `glow`. They animate on hits. Visual only; keep presses small.

Build it from a script, starting from an empty file:

```sh
"/Applications/Blender.app/Contents/MacOS/Blender" --background --factory-startup --python build_asset.py
```

```python
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
collection = bpy.data.collections.new('MM_ASSET')
bpy.context.scene.collection.children.link(collection)
# ...build objects, link them to collection...
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath='asset.blend')
```

## manifest.json

```json
{
  "$schema": "marble-asset@1",
  "id": "brass-bar",
  "label": "Brass bar",
  "role": "skin",
  "pieceType": "platform",
  "fittedParams": { "length": 0.09 },
  "reactions": [{ "part": "MM_REACT_Cap", "kind": "glow" }],
  "properties": [{ "name": "Patina", "type": "number", "default": 0.3, "min": 0, "max": 1 }],
  "notes": "What it is and how its parts move"
}
```

A marble skin with one fixed colour adds `"color": "#22ff66"`: the marble takes it on when the skin is applied, so its Compose dot and timeline colour say the same as the film. Leave it out when the skin uses the marble's colour.

`role` is `skin` or `decoration`; `add_asset` also takes `decor`. `id` uses lowercase letters, digits and `-`; a taken id gets a free suffix. For decor, `fittedParams` takes `width` and `height` in metres, which keep it clear of the run. `properties` are optional rows in the inspector, written to the material inputs and nodes of that name. Also put a `preview.png` beside it, a small square render, so the tile shows a picture.

## add_asset

`add_asset({ path, role: 'skin', name: 'Brass bar', pieceType: 'platform' })` with `path` a folder holding those files, or the `.blend` with `manifest.json` beside it. `name`, `role` and `pieceType` override the manifest and can be left out when it says them (`label`, `role`, `pieceType`). It checks the manifest first and answers with the item's id and how to use it, and nothing changes on screen until you use it.

Add `pack: 'Christmas'` to group items in a Pack of this project, which also becomes their origin line. Then `run_command('design.exportPack', { path, name: 'Christmas', theme: true, items: [ids] })` writes a `.marblepack` others can add. Packs hold themes, skins and decor only.
