# Building a track

Each marble falls and bounces. A **hit** is a moment in the song a marble must strike a note. A **platform** tied to a hit plays that note. Units are metres and seconds; y points up.

## Fastest way

`run_command('build.track')`, "Build Track", builds every marble's open hits in time order, with platforms, rails or switchbacks across long gaps, and ends each marble in a Finish. Track pieces already there stay; it turns one only when nothing else works and says so. It is one Undo step and shows on the wall as it goes. It answers when done, usually within a minute or two. A client with a short tool timeout can pass `args: { wait: false }` and read `get_state.building`, then `get_state.lastBuild`; `build.stop` stops it and keeps what it built.

A hit it can't solve is named in the reply (`lastBuild.attention`) and it builds the rest. `build.replace` (Fix Hits) fixes broken hits; for an open hit, change the ones before it or place it by hit. Then adjust by hand.

Two arguments steer it, and neither is needed by default:

- `args: { from: hitId }` is **Rebuild From Here**: everything up to that hit stays exactly as it is, on every marble, and the rest is built again as one Undo step. Turn a platform by hand, then rebuild from its hit, and the track follows your edit. The hit IDs are in `get_state.marbles[].hits`. `run_command('build.rebuildFrom', { select: [key] })` does the same from a hit's or piece's key, or from what the person selected, and also answers when the build is done.
- `args: { gapPiece: 'rail' }` or `'switchback'` tries that piece first across every long gap. Without it, a rail where one reads well and a switchback where nothing else bridges the gap. `get_state.lastBuild` and `hits` say what happened.

## How a track should look

Build Track, `build.next`, Continue and `build.replace` share these rules. A hit's timing comes first; a person's hand edit is never undone to meet them.

- **Track pieces don't touch.** Two pieces stand at least 1.2 cm apart as the film shows them, and a skin hangs up to 1.4 cm below its hitbox. A pair that comes closer is the tip "Platform 12 touches Platform 13".
- **A marble strikes a platform once.** "Melody hits Platform 12 twice" is a problem to fix, not a quiet note. Rests and rolls after a marble's last note and rides on a switchback, rail or Finish don't count.
- **Marbles may cross.** A marble's run may leave its lane and cross another's path, as long as it touches neither that marble nor its pieces. It stays in its lane where it can, since its pieces would otherwise stand in the other marble's way, and always stays in frame.

To fix a touching pair or a second strike, try these in order of how little they change. Each moves the run a little from there on, since every bounce follows the one before, so read `hits` in the reply and Undo a try that breaks one.

1. **Shorten** (touching only): `setComponent` the platform's `piece` with a smaller `params.length`, down to about two thirds of its own, as long as the marble still strikes it. Build Track does this itself when things are tight.
2. **Move** (touching only): `setComponent` its `hitLink` with another `contactAt`, from 0.15 to 0.85, which slides the platform along its own surface under the same strike.
3. **Tilt**: a new `angle` in that `hitLink`, or in the platform before it, which sets where the marble arrives. `build.replace` tries all of these for every such piece when nothing else is wrong.
4. **Rebuild From Here** from the hit before them, if none of that holds.

## One step at a time

1. `build.next` takes the next step: a platform at the next open hit, or a switchback or rail when a long gap comes first. Where none fits it takes the step Build Track would, or says what to do; a second press then places a platform at the note after the gap. A reply with `changed: false` placed nothing, and it made no Undo step.
2. `build.placeAgain`, "Place Again", solves the selected platform's tilt and bounce so it lands on time, in that platform's Undo step. To place one at an open hit, select the hit through `args.select` and run `build.next`.
3. `build.continue` accepts a suggested pattern. `build.repeat` and `build.mirror` copy the last platform's tilt, which makes zigzags.
4. `build.replace` (Fix Hits) fixes broken hits. `edit.firstProblem` jumps to the first problem for the person.
5. `build.addFinish` ends a marble's run in a catch once all its hits are on time.

Build marbles together in time order, since they can collide with each other's pieces. The same project and the same calls always give the same track.

## Reading hits

`get_state.marbles[].hitList` lists every hit as `hitColumns` says: id, time, note, status and its dot, where the marble is at that time. A hit's time is the MIDI note's time plus the Song's `offset` (`get_state.song.sources`), one second for an import. `nextOpen` gives the next open hits; `hasDot` means a platform can go there now. Each piece in `layers.pieces` has its `angle` in radians (positive tilts to the left) and `params`, such as a platform's `length` and `bounce`. Statuses in `problems`: **Early/Late** by some ms (tilt or move the platform), **Missed** (the marble passes it), **Stopped** (it rests on it: tilt it), **Blocked** (a piece is in the way before this note), **Too Soon** and **Out of Reach** (no platform can play this hit from where the marble is: change the earlier ones, or make the note Backing with `edit.makeBacking`).

## Long gaps

Two notes further apart than about 0.7 s are a long gap: a marble in free fall drops about 5 m in a 2 s gap at the default speed and leaves the track. Build Track and `build.next` bridge them with a rail where one reads well, or a switchback, which holds the marble while it descends, where nothing else does. A rail, tunnel or switchback never plays a note.

To choose the piece yourself, place it on the hit before the gap with `project.execute`: `{ type: 'placePiece', pieceType: 'rail', hit: { laneId, hitId }, params: { entryDelay: 0.3 } }`, where `entryDelay` is how many seconds after that hit the marble meets it, and `path` sets its shape. Any of `rail`, `tunnel` or `switchback` counts as bridging the gap, and Build Track then keeps it and builds around it.

## project.execute

`run_command('project.execute', { label: 'Place Platform', commands: [...] })` applies all commands as one Undo step. An invalid batch changes nothing and says why: a command with a field it doesn't know is refused, and commands that leave the project as it was answer `changed: false` with no Undo step. These read best:

- `{ type: 'placePiece', pieceType: 'platform', hit: { laneId, hitId }, angle?, params? }`: tied to a hit, like clicking its dot. `angle` is in radians; without one the app picks.
- `{ type: 'placePiece', pieceType: 'rail', position: { x, y }, path: [{ x, y }, ...] }`: a piece tied to nothing. Types: `platform`, `rail`, `tunnel`, `windmill`, `switchback`, `finish`.
- `{ type: 'applySkin', assetId, pieceType }` or `{ type: 'applySkin', assetId, entityIds }`
- `{ type: 'placeDecor', source, at: { x, y } }` and `{ type: 'scatterDecor', sources, density?, seed? }`

The project's own commands work too:

- `{ type: 'setEnd', end }`, `{ type: 'setTempo', tempo: { bpm, beatsPerBar } }`, `{ type: 'setDesign', design: { ... } }`: see `film-look`
- `{ type: 'setPhysics', physics: { gravityScale } }`: Gravity, 0.05 to 2, 0.5 by default (`get_state.physics`). `run_command('marble.speed', { value })` is the same.
- `{ type: 'setComponent', entityId, component: { name, value } }`, with the component's whole value; `marble`, `skin` and `wallText` take only what changes. A marble's `{ color, radius }`: `get_state.marbles[]` has both. The radius, in metres and 0.012 as usual, changes the run, so hits can move; change it only on purpose and read `hits` in the reply. Moving a marble's start: `component: { name: 'release', value: { position: { x, y }, time } }`. Turning a platform: `component: { name: 'hitLink', value: { laneId, hitId, angle, contactAt } }`.
- `{ type: 'removeEntities', entityIds }`, `{ type: 'upsertEntity', entity: { id, name, components } }`
- `{ type: 'removeHits', laneId, hitIds }`, `{ type: 'assignHits', hitIds, laneId }`

Platform params: `length`, `thickness`, `depth`, `bounce`.

## Tips

Gravity changes every marble: it is a share of Earth's gravity, so at the same tilt and bounce slower gives smaller hops and denser columns. Tilt and bounce shape a hop as much, so build again after changing it. Marbles leaving the frame are reported until the camera can follow them: problems about the frame are about Film, not the hits. A rail, tunnel or windmill never plays a note; a marble riding one can't strike a hit until it leaves. Check the length with `get_state.project.length`; `setEnd` changes it.
