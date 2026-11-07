# Building a track

Each marble falls and bounces. A **hit** is a moment in the song a marble must strike a note. A **platform** tied to a hit plays that note. Units are meters and seconds; y points up.

## Fastest way

`run_command('build.track')`, "Build Entire Track", builds every marble's open hits in time order, with platforms and rails across long gaps, starts each bare marble on a short Rail and ends each marble in a Bowl; both are ordinary pieces you can delete. Track pieces already there stay; it turns one only when nothing else works and says so. It is one Undo step and shows on the wall as it goes, and leaves the window at a zoom that reads with Follow on, the playhead at the top, so the person can press Space and watch it. It answers when done, usually within a minute or two. A client with a short tool timeout can pass `args: { wait: false }` and read `get_state.building`, then `get_state.lastBuild`; `build.stop` stops it and keeps what it built.

**Patterns: make a stretch of the track a shape, on a song with or without pieces.** `project.execute` with one command `{ type: 'applyPattern', marbleId, from, to, kind, width, bounce, maxTilt, dryRun }` fits a Pattern over the notes between `from` and `to` (seconds), or over the silence there, as a Group: ordinary pieces in one Undo step, named after the Pattern. `get_state.patterns` lists the kinds, each with what it takes: `zigzag` and `staircase` play notes, `longRail` and `switchback` fill silence. `width` is in meters, `bounce` asks for less fall per hit when higher (0.3 to 0.7), and `maxTilt` is in degrees. Leave `width` out and the app picks one that fits; a `width` you give is kept or refused, never changed.

Asking changes nothing: `dryRun: true` answers exactly what applying would. `fits` says whether it lands, `verdicts` has one `{ hitId, fits, words }` per hit, `refusal` names the hit and why, ending "Nothing changed.", `ending` is the later hit it would break, and `offers` says what fits instead: another `width`, or a shorter `from` and `to`. It applies nothing unless every hit fits and no hit that was on time goes off time, with no new Problems. `measures` gives `onTime`, `columnStraightness`, `dropPerHit`, `largestDrop`, `medianTilt`. It never falls back silently.

On a song already built, a Pattern follows the way the track goes, so what comes after can stay where it stands; `movedAfter` counts the pieces that had to move with the marble. A hop too long for a bounce gets a rail inside the Pattern, as Build Entire Track's do. A rail already holding a silence stays and joins the Group. A marble with nothing before the range starts just above it, and the notes before it wait; a Pattern on them later moves the release back and fits what follows again. With pieces before the range and open notes between, the first hit is out of order, and the refusal says which hits to build first. Changing an earlier Pattern fits the later ones again. Tilt follows Gravity, not Bounce.

A hit it can't solve is named in the reply (`lastBuild.attention`) and it builds the rest. `build.fix` (Fix) fixes broken hits; for an open hit, change the ones before it or place it by hit. Then adjust by hand.

Two arguments steer it, and neither is needed by default:

- `args: { from: hitId }` is **Rebuild From Here**: everything up to that hit stays exactly as it is, on every marble, and the rest is built again as one Undo step. Turn a platform by hand, then rebuild from its hit, and the track follows your edit. The hit IDs are in `get_state.marbles[].hits`. `run_command('build.rebuildFrom', { select: [key] })` does the same from a hit's or piece's key, or from what the person selected, and also answers when the build is done.
- `args: { gapPiece: 'rail' }`, `'switchback'` or `'chain'` tries that Rail layout first across every long gap. Without it, a single Curved Rail where one holds the marble through a silence of up to 1.55 s, then a straight Rail where one reads well and the Switchback layout where nothing else bridges the gap. `'chain'` is curved turns, always simulated, and falls back to the Switchback layout when its turns would hold the marble. `get_state.lastBuild` and `hits` say what happened.

## A line to follow

Each marble's band of the wall runs straight down from where it starts. To send it another way, store a line: `project.execute` with `{ type: 'updateMarble', marbleId, patch: { guide: { points: [{ x, y }, ...] } } }`, points from highest to lowest. Auto place, gap pieces and Build Entire Track then keep the marble near the line at each height, and refuse a dot that leaves its band. A run never reads the line, so setting it moves nothing already placed. Keep it straight down to the first note, since nothing steers the marble before its first piece. Up to about 2 m sideways per meter of drop every note still plays on the songs measured; at 3 notes are lost.

## How a track should look

Build Entire Track, `build.next` and `build.fix` share these rules. A hit's timing comes first; a person's hand edit is never undone to meet them.

- **Track pieces don't touch.** Two pieces stand at least 1.2 cm apart on the wall, skins included. A pair that comes closer is the problem "Platform 12 touches Platform 13".
- **A marble strikes a platform once.** "Melody strikes Platform 12 twice" is a problem to fix, not a quiet note. Rests and rolls after a marble's last note and rides on a rail or in a Bowl don't count.
- **Marbles may cross.** A marble's run may leave its band of the wall and cross another's path, as long as it touches neither that marble nor its pieces. It stays in its band where it can, since its pieces would otherwise stand in the other marble's way, and always stays in frame.

To fix a touching pair or a second strike, try these in order of how little they change. Each moves the run a little from there on, since every bounce follows the one before, so read `hits` in the reply and Undo a try that breaks one.

1. **Shorten** (touching only): `updatePiece` the platform with a smaller `length` in its `params`, down to about two thirds of its own, as long as the marble still strikes it. Build Entire Track does this itself when things are tight.
2. **Move** (touching only): `updatePiece` its `place` with another `contactAt`, from 0.15 to 0.85, which slides the platform along its own surface under the same strike.
3. **Tilt**: `updatePiece` with a new `angle`, or on the platform before it, which sets where the marble arrives. `build.fix` tries all of these for every such piece when nothing else is wrong.
4. **Rebuild From Here** from the hit before them, if none of that holds.

## One step at a time

1. `build.next` takes the next step: a platform at the next open hit, or a rail when a long gap comes first, and its reply's `placed` says what it placed, with its `angle` and how the marble takes it, ready for one `updatePiece` before the next call. It adds one piece and changes nothing already there. Where no rail fits a gap it takes the step Build Entire Track would without touching what's there, or says what to do; a second press then tries a platform at the note after the gap. Where no tilt plays a note it places nothing and its notice says why. A reply with `changed: false` placed nothing, and it made no Undo step.
2. `build.fix` with a platform selected through `args.select` solves that platform's tilt and bounce so it lands on time. To place one at an open hit, select the hit through `args.select` and run `build.next`.
3. `build.repeat` copies the last platform's tilt; a Pattern through `build.propose` makes a stretch of them.
4. `build.fix` with nothing selected fixes the whole run. `edit.firstProblem` jumps to the first problem for the person.
5. `build.addBowl` ends a marble's run in a catch once all its hits are on time.

Build marbles together in time order, since they can collide with each other's pieces. The same project and the same calls always give the same track.

## Ask before placing

`run_command('build.propose', { marbleId, hitIds: [hitId], kind })` says what would be placed and changes nothing, so you can ask as often as you like and compare. `kind` is `platform`, `rail` or `chain` for the rest before the note, `flip` for a note's platform, `remove` for its piece, `fix` for what Fix would change on the first of their pieces with a Problem, or a Pattern: `zigzag` or `staircase` over the notes in `hitIds` (with `width`, `bounce`, `maxTilt` if wanted) and `longRail` or `switchback` for the rest before its note, or `movePattern` with `groupId` to move a live Pattern whole: `dot` puts its first note's dot there (the piece before sends the marble to it), `shift` moves it that many notes along the row, and the notes it leaves keep their pieces. Nothing chooses a shape for you.

The reply has `status`: `fits`, every fact holds; `problems`, it would land with the `reasons` listed, and accepting it is your call; `refused`, with nothing to place and `words` saying why; or `buildUpTo`, the note lies past notes with no piece, and `words` names the first. `notes` has one `{ hitId, number, time, state, words }` per note: `onTime`, `reached` (a piece can still play it) or `off`. `changes` lists the pieces it would change, remove or move, before or after those notes. `facts` has `onTime`, `total`, `lost`, `strikes`, `rolls`, `passThroughs`, `touching`, `crossings`, `isNearPace` and `hasRoomAtNext`, each counting only what the track didn't already have. A `platform` for a note after a rest answers with `instead`: a proposal for `longRail` and for `switchback`, and the plain platform with its reason when neither fits.

`run_command('build.accept', { proposalId })` lands exactly that proposal as one Undo step. It refuses one made before the track last changed: propose again. `build.next` answers with `status` and, when the piece it placed has a fault, `words`.

## Reading hits

`get_state.marbles[].hitList` lists every hit as `hitColumns` says: id, time, note, status, its dot, where the marble is at that time, and the song it is tied to. A hit's time is the MIDI note's time plus the Song's `start` (`get_state.song.songs`), one second for an import. `nextOpen` gives the next open hits; `hasDot` means a platform can go there now. Each piece in `layers.pieces` has its `angle` in radians (positive tilts to the left) and `params`, such as a platform's `length` and `bounce`. Statuses in `problems`: **Early/Late** by some ms (tilt or move the platform), **Missed** (the marble passes it), **Stopped** (it rests on it: tilt it), **Blocked** (a piece is in the way before this note), **Too Soon** and **Out of Reach** (no platform can play this hit from where the marble is: change the earlier ones, or make the note Backing with `edit.makeBacking`).

## Long gaps

Two notes further apart than about 0.7 s are a long gap: a marble in free fall drops about 5 m in a 2 s gap at the default speed and leaves the track. Build Entire Track first tries a single Curved Rail that holds the marble through the silence; it and `build.next` bridge them with a rail where one reads well, or a Rail with the Switchback layout, which holds the marble while it descends, where nothing else does. A rail or tunnel never plays a note.

To choose the piece yourself, place it on the hit before the gap with `project.execute`: `{ type: 'placePiece', pieceType: 'rail', hit: { marbleId, hitId }, params: { entryDelay: 0.3 } }`, where `entryDelay` is how many seconds after that hit the marble meets it, and `path` sets its shape, or `layout: 'switchback'`, `'chain'`, `'c'` or `'curve'` with `params` such as `turns`, `width` and `drop` generates its paths. A `rail` or `tunnel` counts as bridging the gap, and Build Entire Track then keeps it and builds around it.

## project.execute

`run_command('project.execute', { label: 'Place Platform', commands: [...] })` applies all commands as one Undo step. An invalid batch changes nothing and says why: a command with a field it doesn't know is refused, and commands that leave the project as it was answer `changed: false` with no Undo step. These read best:

- `{ type: 'placePiece', pieceType: 'platform', hit: { marbleId, hitId }, angle?, params? }`: tied to a hit, like clicking its dot. `angle` is in radians; without one the app picks.
- `{ type: 'placePiece', pieceType: 'rail', position: { x, y }, path: [{ x, y }, ...] }`: a piece tied to nothing; `paths` adds further paths to the same Rail. Types: `platform`, `rail`, `tunnel`, `windmill`, `bowl`.
- `{ type: 'applySkin', assetId, pieceType }` or `{ type: 'applySkin', assetId, ids }`
- `{ type: 'flattenPattern', groupId }`: a live Pattern's pieces stay as they are, to edit one by one, and the Pattern is gone
- `{ type: 'placeDecor', source, at: { x, y } }` and `{ type: 'scatterDecor', sources, density?, seed? }`

The project's own commands work too. `add` replaces what has the same ID. `update` changes the fields in `patch` and leaves the rest, and `null` deletes a field. A skin and a marble's `start` take only what changes, and `null` there deletes that field: `skin: { color: null }` goes back to the theme's color, `start: { velocity: null }` to a plain drop. A command that names a marble, hit, piece, song, file or piece type that isn't there is refused, and the message names it.

- `{ type: 'updateProject', patch: { title, length, format: { width, height }, gravity } }`: `length` is seconds, up to an hour, or the song's length when that's longer. `gravity` is 0.05 to 2, 0.5 by default (`get_state.gravity`), and `run_command('marble.speed', { value })` is the same.
- `{ type: 'updateFilm', film: { ... } }`: see `film-look`
- `{ type: 'updateMarble', marbleId, patch: { ... } }`, `{ type: 'addMarble', marble }`, `{ type: 'removeMarble', marbleId }`, which takes the marble's tied pieces with it. A marble is `{ id, name, labelColor, sound, radius, start: { position: { x, y }, time }, skin?, hits }`. Moving its start: `patch: { start: { position: { x, y } } }`. Its `radius`, in meters and 0.012 as usual, changes the run, so hits can move; change it only on purpose and read `hits` in the reply.
- `{ type: 'updatePiece', pieceId, patch: { ... } }`, `{ type: 'addPiece', piece }`, `{ type: 'removePieces', pieceIds }`. A piece is `{ id, name?, labelColor?, type, layout?, params, angle, place, path?, skin? }`, and its `place` is one of `{ kind: 'free', position: { x, y } }`, `{ kind: 'plays', marbleId, hitId, contactAt }`, for a platform, or `{ kind: 'follows', marbleId, hitId, contactAt?, offset? }`. Turning a platform: `patch: { angle }`.
- `{ type: 'upsertHits', marbleId, hits: [{ id, time, pitch?, velocity?, duration?, songId? }] }`, `{ type: 'removeHits', marbleId, hitIds }`, `{ type: 'assignHits', hitIds, marbleId }`. A hit's platform goes with it: `assignHits` hands it to the other marble or, for Backing, removes it, and `removeHits` removes it. A piece following the marble there moves to its nearest hit left. `marbleId: 'backing'` means Backing: a note stays in the song that holds it, or goes to the song its `songId` names. A hit's `songId` ties it to a song, so it moves with that song. Without one it's the marble's own.
- `{ type: 'addGroup', group: { id, name, marbleId?, pieceIds } }`, `{ type: 'updateGroup', groupId, patch: { ... } }`, `{ type: 'removeGroups', groupIds }`
- `{ type: 'addSong', song: { id, name, kind, path, start, backing: [] } }`, `{ type: 'updateSong', songId, patch: { tempo: { bpm, beatsPerBar }, backingSound } }`, `{ type: 'moveSong', songId, start }`, `{ type: 'removeSong', songId }`. `moveSong` is the one way to change a start: the song's Backing and the hits with its `songId` shift with it, and a marble that plays only this song starts that much later too, so its run stays on time. Other hits stay. Removing a song takes its Backing, and hits a marble plays stay and lose their `songId`

Platform params: `length`, `thickness`, `depth`, `bounce`.

## Tips

Gravity changes every marble: it is a share of Earth's gravity, so at the same tilt and bounce slower gives smaller hops and denser columns. Tilt and bounce shape a hop as much, so build again after changing it. Marbles leaving the frame are reported until the camera can follow them: problems about the frame are about Film, not the hits. A rail, tunnel or windmill never plays a note; a marble riding one can't strike a hit until it leaves. Check the length with `get_state.project.length`; `updateProject` changes it.
