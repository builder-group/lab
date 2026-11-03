// Writes `fixtures/loop.marble.json`: a short seamless loop. The marble drops in from above the frame, plays
// 21 eighth notes at 80 bpm on a zigzag between two columns built with the assists (a tilted platform, Mirror,
// then Continue, with Auto place where Continue stops), and falls out of the frame before the loop ends. The loop
// is three bars long, so the music runs on into the start, and `checkLoop` passes on it.
// Usage: tsx scripts/build-loop-fixture.ts
import { writeFileSync } from 'node:fs';
import {
	applyProjectCommands,
	parseProject,
	serializeProject,
	type TEntity,
	type TProject,
	type TProjectCommand
} from '../src/modules/project';
import { autoPlace, continueSuggestions, mirrorPiece } from '../src/modules/simulation/assists';
import { createBareRunProject } from '../src/modules/simulation/fixture-projects';
import { checkLoop, createLoop } from '../src/modules/simulation/loop';
import { namePiecesInOrder } from '../src/modules/simulation/piece-names';
import { createLinkedPiece } from '../src/modules/simulation/placement';
import { createSimulator } from '../src/modules/simulation/simulate';

const LANE = 'lane-1';
const DEGREE = Math.PI / 180;
const SCALE = 1.5;
const MARBLE_RADIUS = 0.008 * SCALE;
const PLATFORM = { length: 0.06 * SCALE, thickness: 0.008 * SCALE, depth: 0.03 * SCALE };
// Eighths 0.375 s apart: at the default half gravity a 0.3 s zigzag hops only about half a bar, and 80 bpm keeps
// three bars on the 1/30 s loop grid
const BPM = 80;
const EIGHTH = 30 / BPM;
const BARS = 3;
// At half gravity the marble needs about 0.45 s to fall into view, plus the entry margin, before the first hit
const FIRST_HIT = 0.7;
const HITS = 21;
// An original phrase in A minor pentatonic, one pitch per eighth note
const MELODY = [69, 72, 76, 74, 72, 69, 67, 69, 72, 74, 76, 79, 76, 74, 72, 74, 69, 72, 67, 69, 64];

const simulator = await createSimulator();
const simulate = (project: TProject) => simulator.simulate(project);

const hitTimes = Array.from({ length: HITS }, (_, i) => Math.round((FIRST_HIT + EIGHTH * i) * 1000) / 1000);
let project = createBareRunProject({
	id: 'loop',
	title: 'Loop',
	end: 10,
	marbles: [{ x: 0, y: 0.6, releaseTime: 0, hitTimes }]
});
project.music.tempo = { bpm: BPM, beatsPerBar: 4 };
project.music.lanes.forEach((lane) => lane.hits.forEach((hit, i) => (hit.pitch = MELODY[i % MELODY.length])));
project.design = {
	...project.design,
	theme: 'brass',
	loop: true,
	camera: { mode: 'rig', distance: 0.65, pitch: 1.0, lead: 0.15, smoothing: 0.6, shots: [] }
};
for (const entity of project.entities) {
	if (entity.components.marble != null) entity.components.marble.radius = MARBLE_RADIUS;
}

project = startZigzag(project, 1, -0.45);
let placed = 2;
while (placed < HITS) {
	const continued = continueSuggestions(project, simulate(project), LANE, { simulate, idFor: (id) => id.replace('hit', 'piece') });
	const commands = continued?.commands ?? [];
	if (commands.length > 0) {
		project = apply(project, commands);
		placed += commands.length;
	} else {
		placed += 1;
		project = place(project, placed);
	}
}
project = withoutOpenHits(project);

// The loop is three bars from its start; the end is set once the start is known
const firstLoop = createLoop(project, simulate(project));
if (firstLoop?.bars == null) throw new Error('The run has no loop start');
project = apply(project, [{ type: 'setEnd', end: Math.round((firstLoop.start + BARS * firstLoop.bars.barLength) * 30) / 30 }]);

const result = simulate(project);
const loop = createLoop(project, result);
if (loop == null) throw new Error('The run has no loop');
const check = checkLoop(project, result, loop);
simulator.dispose();
if (!check.isOk) throw new Error(`The loop check fails: ${JSON.stringify(check.issues)}`);

// Pieces are named in time order last, so the Layers list reads Platform 1, 2, 3 down each marble
const json = serializeProject(namePiecesInOrder(apply(project, [], 0)));
const [isProjectOk, projectErr] = parseProject(json);
if (!isProjectOk) throw projectErr;
writeFileSync(new URL('../fixtures/loop.marble.json', import.meta.url), json);
console.log(
	JSON.stringify({
		start: loop.start,
		end: loop.end,
		bars: loop.bars,
		hits: result.hits.length,
		onTime: result.hits.filter((hit) => hit.status === 'onTime').length,
		positionError: check.positionError
	})
);

function startZigzag(current: TProject, index: number, angle: number): TProject {
	// Try a few opening tilts and keep the one whose continuation descends furthest
	let best: { project: TProject; descent: number } | null = null;
	for (const tilt of [angle, -angle, angle * 0.5, -angle * 0.5, angle * 1.5, -angle * 1.5]) {
		const tilted = apply(current, [
			{ type: 'upsertEntity', entity: scaled(createLinkedPiece('platform', LANE, hitId(index), tilt, { id: pieceId(index) })) }
		]);
		const [isMirrorOk, , mirrored] = mirrorPiece(tilted, simulate(tilted), LANE, { id: pieceId(index + 1) });
		if (!isMirrorOk) continue;
		const started = apply(tilted, mirrored.commands);
		const result = simulate(started);
		if (result.hits.some((hit) => hit.status === 'blocked')) continue;
		const continued = continueSuggestions(started, result, LANE, { simulate, maxCount: 8 });
		if ((continued?.commands.length ?? 0) < 4) continue;
		const ys = (continued?.suggestions ?? []).filter((item) => item.isOk && item.dot != null).map((item) => item.dot?.y ?? 0);
		const first = result.pieces.find((piece) => piece.entityId === pieceId(index))?.position.y ?? 0;
		const descent = first - Math.min(...ys);
		if (best == null || descent > best.descent) best = { project: started, descent };
	}
	return best?.project ?? place(place(current, index), index + 1);
}

function scaled(entity: TEntity): TEntity {
	const piece = entity.components.piece;
	if (piece == null || piece.type !== 'platform') return entity;
	return { ...entity, components: { ...entity.components, piece: { ...piece, params: { ...piece.params, ...PLATFORM } } } };
}

function place(current: TProject, index: number): TProject {
	// Auto place tunes the piece already at the hit, so it is seeded with the kit's size
	const seed = scaled(createLinkedPiece('platform', LANE, hitId(index), 0, { id: pieceId(index) }));
	const seeded = apply(current, [{ type: 'upsertEntity', entity: seed }]);
	for (const range of [undefined, [-60 * DEGREE, 60 * DEGREE] as [number, number]]) {
		const [isPlacedOk, , placed] = autoPlace(seeded, simulate(seeded), LANE, hitId(index), { simulate, id: pieceId(index), range });
		if (isPlacedOk) return apply(current, [{ type: 'upsertEntity', entity: scaled(placed.entity) }]);
	}
	console.error(`${hitId(index)} stays open`);
	return current;
}

/** Hits no angle could serve are left out of the lane, so every remaining hit is on time */
function withoutOpenHits(current: TProject): TProject {
	const served = new Set(current.entities.flatMap((entity) => entity.components.hitLink?.hitId ?? []));
	const next = structuredClone(current);
	for (const lane of next.music.lanes) lane.hits = lane.hits.filter((hit) => served.has(hit.id));
	return next;
}

function hitId(index: number): string {
	return `hit-1-${index}`;
}

function pieceId(index: number): string {
	return `piece-1-${index}`;
}

function apply(current: TProject, commands: TProjectCommand[], revision?: number): TProject {
	const [isAppliedOk, appliedErr, applied] = applyProjectCommands(current, commands);
	if (!isAppliedOk) throw appliedErr;
	if (revision != null) applied.revision = revision;
	return applied;
}
