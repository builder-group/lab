# Canvas

The canvas arranges physical units and cable runs over one project. File shows surfaces/layers, Parts searches the project and Library, and Checks groups unresolved specifications and findings. Adding from Library creates an ordinary linked project part. Selecting an existing unit does not create another; the explicit plus adds a physical unit and increases planned quantity.

## Interaction

- Click to select; double-click a layer to reveal it. Drag equipment or edit its X/Y in millimetres. Arrow keys nudge 1 mm, or 10 mm with Shift; a gesture is one undo step.
- V selects, H pans, W chooses the wire tool, R rotates. Space temporarily pans. Shift+1 fits the plan, Shift+0 shows 100%, and Shift+2 reveals selection.
- Click two terminals or drag between them to connect. Draw an unspecified wire first or choose a cable material from Parts/Library. Materials create runs rather than equipment nodes.
- Select a wire to edit its material, route, allowance and manual/measured length. Multicore cable uses one route with separate conductor mappings; its purchased length is counted once.
- Position terminals on artwork edits the part's normalized anchors, shared by all its instances. A physical route needs known endpoint dimensions and explicit anchors.
- Remove from canvas unplaces equipment while retaining the part, purchases and unresolved connections. Deleting a wire removes its planned demand, not purchased stock.

Yellow question marks show findings on hover, focus or click. Overview badges appear contextually to keep the drawing readable. Canvas and Parts retain their working view when switching; the hidden canvas does not receive keyboard shortcuts.

## Scale and length

One world coordinate equals one millimetre. At 100%, one millimetre maps to one CSS pixel, independent of monitor DPI. Zoom only changes the camera. Known-size SVGs and photos use the same physical envelope; selected equipment shows body dimensions.

Missing dimensions use a movable 160 × 110 display envelope, not a physical size estimate. Its footprint cannot enable route measurement. Unknown endpoint dimensions or anchors keep derived length unknown until supplied, or until a manual/measured length is entered.

Route length is a 2D projection plus explicit allowance. It cannot discover vertical runs, hidden routing, bend radii or service loops. Moving equipment changes route-derived demand, not purchases, stock, cuts or manual/measured lengths.

When outside diameter is known, wire stroke follows that diameter with a one-pixel visibility minimum. Otherwise thickness encodes conductor cross-section for readability and is not an insulation-diameter measurement. The [DC estimator](dc-cable-sizing.md) evaluates voltage drop separately from installation ampacity.

## Implementation

`CanvasCx` owns temporary tools and selection and sends ordinary project commands through the session. A conflicting project revision cancels a drag rather than overwriting another edit. `CanvasScene` indexes immutable project snapshots and `CanvasSceneView` reuses unaffected nodes/edges during selection and dragging. Connected wire endpoints preview locally; document lengths change on commit. Rulers and zoom readout subscribe separately from the scene, and terminal internals remeasure only when geometry changes.

Library definitions and [artwork metadata](artwork-sources.md) are data. No SKU requires a custom React component, and no example project is loaded at runtime.
