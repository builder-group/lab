# Building a track

Each marble falls and bounces. A **hit** is a moment in the song a marble must strike a note. A **platform** tied to a hit plays that note. Units are metres and seconds; y points up.

## Fastest way

1. `run_command('build.next')` places a platform at the next open hit and selects it. Repeat it, reading `hits` in each reply.
2. `build.autoPlace`, "Add Platform", solves the selected platform's tilt so it lands on time, in that platform's Undo step. With a hit selected through `args.select` it places one there.
3. `build.continue` accepts a suggested pattern. `build.repeat` and `build.mirror` copy the last platform's tilt, which makes zigzags.
4. `build.replace` re-places broken platforms. `edit.firstProblem` jumps to the first problem for the person.
5. `build.addFinish` ends a marble's run in a catch once all its hits are on time.

Keep to one marble until it works, then the next: marbles can collide with each other's pieces.

## Reading hits

`get_state.marbles[].nextOpen` lists open hits; `hasDot` means a platform can go there now. Statuses in `problems`: **Early/Late** by some ms (tilt or move the platform), **Missed** (the marble passes it), **Stopped** (it rests on it: tilt it), **Blocked** (a piece is in the way before this note), **Too Soon** and **Out of Reach** (no platform can play this hit from where the marble is: change the earlier ones, or make the note Backing with `edit.makeBacking`).

## project.execute

`run_command('project.execute', { label: 'Place Platform', commands: [...] })` applies all commands as one Undo step. An invalid batch changes nothing and says why. These read best:

- `{ type: 'placePiece', pieceType: 'platform', hit: { laneId, hitId }, angle?, params? }`: tied to a hit, like clicking its dot. `angle` is in radians; without one the app picks.
- `{ type: 'placePiece', pieceType: 'rail', position: { x, y }, path: [{ x, y }, ...] }`: a free piece. Types: `platform`, `rail`, `tunnel`, `windmill`, `switchback`, `finish`.
- `{ type: 'applySkin', assetId, pieceType }` or `{ type: 'applySkin', assetId, entityIds }`
- `{ type: 'placeDecor', source, at: { x, y } }` and `{ type: 'scatterDecor', sources, density?, seed? }`

The project's own commands work too: `setEnd`, `setPhysics` (`gravityScale`), `setComponent`, `removeEntities`, `upsertEntity`, `removeHits`, `assignHits`, `setDesign`, `setTempo`. Platform params: `length`, `thickness`, `depth`, `bounce`.

## Tips

Marble Speed (`setPhysics.gravityScale`) changes every marble: slower gives smaller hops and denser columns. Marbles leaving the frame are reported until the camera can follow them: problems about the frame are about Film, not the hits. A rail, tunnel or windmill never plays a note; a marble riding one can't strike a hit until it leaves. Check the length with `get_state.project.length`; `setEnd` changes it.
