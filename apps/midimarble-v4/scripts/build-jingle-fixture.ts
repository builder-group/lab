// Writes `fixtures/jingle-bells.marble.json`: the public domain Jingle Bells refrain with a simple bass line,
// imported like the app's MIDI import sheet (split across up to two marbles, aligned to the import start) and
// built hit by hit with Next semantics through the assist worker's request handler: a rail for a long gap,
// accepted Continue ghosts, Mirror when the interval repeats and Auto place otherwise. Where those find
// nothing, the build does what a user would: rotates the piece or the one before it by hand, or tilts the
// piece before a gap less steeply. Every step must keep all hits on time and each marble on its own pieces;
// the build stops at the first step that cannot. Writes the MIDI file and a build log to `.local/jingle/`.
// Usage: tsx scripts/build-jingle-fixture.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import * as toneMidi from '@tonejs/midi';
import { alignNotes, createImportCommands, parseMidiFile, proposeLanes } from '../src/modules/music';
import {
	applyProjectCommands,
	createProject,
	parseProject,
	serializeProject,
	type TProject,
	type TProjectCommand
} from '../src/modules/project';
import {
	autoPlace,
	continueSuggestions,
	findLongGaps,
	isInBand,
	mirrorPiece,
	type TSimulateFn
} from '../src/modules/simulation/assists';
import { createLinkedPiece, defaultPlatformAngle, frameBand } from '../src/modules/simulation/placement';
import { createSimulator } from '../src/modules/simulation/simulate';
import type { THitResult, TSimulationResult } from '../src/modules/simulation/types';
import { answerWorkerRequest, type TWorkerAnswers } from '../src/modules/simulation/worker-protocol';

// Node loads the CommonJS build of @tonejs/midi, whose exports sit on `default`
const { Midi } = (toneMidi as unknown as { default?: typeof toneMidi }).default ?? toneMidi;
const OUT = new URL('../.local/jingle/', import.meta.url);
// Same as the import sheet: notes start after a one second lead-in, at most two marbles
const IMPORT_START = 1;
const MAX_MARBLES = 2;
const GLOCKENSPIEL = 9;
const CELESTA = 8;
// Melody on the left of the frame, bass on the right. Released at 0.75 s, so the first strike at 1 s comes
// after a short fall; a release at 0 s arrives too fast for any angle to keep the next dot in frame.
const RELEASES = [
	{ x: -0.12, y: 0.6, time: 0.75 },
	{ x: 0.12, y: 0.6, time: 0.75 }
];
const DEGREE = Math.PI / 180;
// Next suggests a rail above 1.2 s. Half notes at 120 BPM leave 1.0 s, which no single bounce can serve in
// frame, so the build asks for a rail from 0.9 s on, like a user adding one with the Rail tool.
const RAIL_GAP = 0.9;

mkdirSync(OUT, { recursive: true });
const log: string[] = [];
const say = (line: string): void => {
	log.push(line);
	console.log(line);
};

// MIDI file and import

const midiBytes = createJingleMidi();
writeFileSync(new URL('jingle-bells.mid', OUT), midiBytes);
const [isMidiOk, midiErr, midi] = parseMidiFile(midiBytes);
if (!isMidiOk) throw midiErr;
const notes = midi.tracks.flatMap((track) => track.notes);
const proposal = proposeLanes(alignNotes(notes, IMPORT_START), { strategy: 'split', maxLanes: MAX_MARBLES });
say(
	`import: ${midi.tracks.length} tracks, ${notes.length} notes -> lanes ${proposal.lanes.map((lane) => lane.length).join(' + ')}, ${proposal.dropped.length} dropped`
);
const lastTime = proposal.lanes.flat().reduce((max, note) => Math.max(max, note.time + note.duration), 0);
let project = createProject({ id: 'jingle-bells', title: 'Jingle Bells' });
project = apply(
	project,
	createImportCommands(project, {
		lanes: proposal.lanes,
		instrument: GLOCKENSPIEL,
		end: Math.ceil(lastTime + 1.5)
	})
);
project = withStableIds(project);
// What a user sets after the import: lane names, Celesta for the bass, the brass theme and where each
// marble starts
project.design.theme = 'brass';
project.music.lanes.forEach((lane, index) => {
	lane.name = index === 0 ? 'Melody' : 'Bass';
	lane.instrument = index === 0 ? GLOCKENSPIEL : CELESTA;
});
project.entities.forEach((entity, index) => {
	const release = RELEASES[index];
	if (entity.components.marble == null || release == null) return;
	entity.name = index === 0 ? 'Melody' : 'Bass';
	entity.components.release = { position: { x: release.x, y: release.y }, time: release.time };
});

// Build

const simulator = await createSimulator();
const simulate: TSimulateFn = (current) => simulator.simulate(current);
const counts = { next: 0, rail: 0, continue: 0, continued: 0, mirror: 0, autoPlace: 0, launch: 0, wide: 0, lean: 0, retilt: 0, backtrack: 0, failed: 0 };
const failures: string[] = [];
const reasons: string[] = [];
const startedAt = performance.now();

for (let step = 0; step < 400; step++) {
	const result = simulate(project);
	// Without a selection Next takes the earliest open hit of any marble
	const target = openHits(result)[0];
	if (target == null) break;
	counts.next++;
	reasons.length = 0;
	const next = buildStep(project, target) ?? backtrack(project, target);
	if (next == null) {
		// The build stops at the first step no assist can take: both lanes keep only the hits before it
		failures.push(`${target.hitId} at ${target.targetTime.toFixed(2)} s: ${reasons.join('; ') || 'no assist found a piece'}`);
		say(`  ${target.hitId}: impossible, the build stops at ${target.targetTime.toFixed(2)} s`);
		project = truncatedAt(project, target.targetTime);
		counts.failed++;
		break;
	}
	project = next;
}

const finalResult = simulate(project);
simulator.dispose();
const byLane = project.music.lanes.map((lane) => {
	const hits = finalResult.hits.filter((hit) => hit.laneId === lane.id);
	return `${lane.name}: ${hits.filter((hit) => hit.status === 'onTime').length}/${hits.length} on time`;
});
say(`build: ${Math.round(performance.now() - startedAt)} ms, ${JSON.stringify(counts)}`);
say(`hits: ${byLane.join(', ')}`);
say(`separation: ${describeSeparation(finalResult)}`);
say(`heights every 4 s (melody | bass, m): ${describeHeights(finalResult)}`);
for (const failure of failures) say(`failed: ${failure}`);

const json = serializeProject(apply(project, [], 0));
const [isProjectOk, projectErr] = parseProject(json);
if (!isProjectOk) throw projectErr;
writeFileSync(new URL('../fixtures/jingle-bells.marble.json', import.meta.url), json);
writeFileSync(new URL('build-log.txt', OUT), `${log.join('\n')}\n`);

/**
 * One press of Next for the earliest open hit: a rail when a long gap ends at it, otherwise Continue
 * ghosts for its lane, then Mirror when the rhythm repeats, then Auto place. Each option must keep every
 * placed hit on time and the lane's next dot in frame; the first that does wins.
 */
function buildStep(current: TProject, target: THitResult): TProject | null {
	const { laneId, hitId } = target;
	// The assists see the lane's own region as the frame
	const view = regionView(current, laneId);
	const viewResult = simulate(view);
	const gap = findLongGaps(current, laneId, RAIL_GAP).find((item) => item.toHitId === hitId && item.bridgedBy == null);
	if (gap != null) {
		const railed = railAcross(current, laneId, gap.fromHitId, gap.toHitId);
		if (railed != null) {
			counts.rail++;
			say(`  ${gap.fromHitId} -> ${gap.toHitId}: rail over ${gap.duration.toFixed(2)} s`);
			return railed;
		}
		say(`  ${gap.fromHitId} -> ${gap.toHitId}: no rail fits the ${gap.duration.toFixed(2)} s gap (${reasons.at(-1) ?? ''})`);
	}

	// The hit before a long gap needs a launch angle so a rail can catch the marble, so Continue and Mirror
	// stop before it
	const angles = launchAngles(view, target);
	const launchHits = new Set(findLongGaps(current, laneId, RAIL_GAP).map((item) => item.fromHitId));
	const continued = angles == null ? continueSuggestions(view, viewResult, laneId, { simulate, idFor: pieceId }) : null;
	const ghosts = takeWhile(continued?.commands ?? [], (command) => command.type === 'upsertEntity' && !launchHits.has(command.entity.components.hitLink?.hitId ?? ''));
	if (ghosts.length > 0) {
		const accepted = accept(current, ghosts, laneId);
		if (accepted != null) {
			counts.continue++;
			counts.continued += ghosts.length;
			return accepted;
		}
	}

	if (angles == null && repeatsInterval(current, laneId, hitId)) {
		const [isMirrorOk, , mirrored] = mirrorPiece(view, viewResult, laneId, { id: pieceId(hitId) });
		const accepted = isMirrorOk ? accept(current, mirrored.commands, laneId) : null;
		if (accepted != null) {
			counts.mirror++;
			return accepted;
		}
	}

	const placed = ask(view, {
		kind: 'autoPlace',
		project: view,
		laneId,
		hitId,
		type: 'platform',
		entityId: pieceId(hitId),
		launchAngles: angles
	}) as TWorkerAnswers['autoPlace'] | null;
	const accepted =
		placed != null ? accept(current, [{ type: 'upsertEntity', entity: placed.entity }], laneId, angles == null) : null;
	if (accepted != null) {
		if (angles != null) counts.launch++;
		else counts.autoPlace++;
		return accepted;
	}
	// What a user tries next: rotating further than Auto place searches
	const [isWideOk, wideErr, wide] = autoPlace(view, viewResult, laneId, hitId, {
		simulate,
		id: pieceId(hitId),
		range: [-60 * DEGREE, 60 * DEGREE]
	});
	const widened = isWideOk ? accept(current, wide.commands, laneId) : reject(`wide autoPlace: ${wideErr.message}`);
	if (widened != null) {
		counts.wide++;
		return widened;
	}
	// What a user does when Auto place finds nothing: rotate the piece by hand until the next dot comes back
	// as close to the marble's region as it gets, keeping every hit on time
	const band = frameBand(view);
	let best: { project: TProject; angle: number; offset: number } | null = null;
	for (let degrees = -24; degrees <= 24; degrees += 3) {
		const entity = createLinkedPiece('platform', laneId, hitId, degrees * DEGREE, { id: pieceId(hitId) });
		const leaned = accept(current, [{ type: 'upsertEntity', entity }], laneId, false);
		if (leaned == null) continue;
		const dot = nextOpenPerLane(simulate(leaned)).get(laneId)?.dot;
		const offset = dot == null ? 0 : Math.abs(dot.x - band.centerX);
		if (best == null || offset < best.offset - 1e-6) best = { project: leaned, angle: degrees, offset };
	}
	if (best == null) return null;
	counts.lean++;
	say(`  ${hitId}: rotated by hand to ${best.angle}°, next dot ${best.offset.toFixed(2)} m from its region centre`);
	return best.project;
}

/**
 * The rail suggestion for a gap. When none fits, the user's next move from the hint: tilt the piece
 * before the gap less steeply, so the marble leaves it slower and stays in frame, and ask again.
 */
function railAcross(current: TProject, laneId: string, fromHitId: string, toHitId: string): TProject | null {
	const suggest = (project: TProject): TProject | null => {
		const view = regionView(project, laneId);
		const answer = ask(view, {
			kind: 'gapPiece',
			type: 'rail',
			project: view,
			laneId,
			fromHitId,
			toHitId,
			entityId: `rail-${laneIndex(laneId)}-${counts.rail + 1}`
		}) as TWorkerAnswers['gapPiece'] | null;
		// The hit after the rail is placed by construction wherever the marble arrives
		return answer != null ? accept(project, answer.commands, laneId, false) : null;
	};
	const railed = suggest(current);
	if (railed != null) return railed;
	const launcher = current.entities.find((entity) => entity.components.hitLink?.hitId === fromHitId);
	const angle = launcher?.components.hitLink?.angle;
	if (launcher == null || angle == null) return null;
	for (const degrees of [10, 7, 13, 5, 16]) {
		for (const sign of [Math.sign(angle) || 1, -(Math.sign(angle) || 1)]) {
			const tilted = structuredClone(launcher);
			if (tilted.components.hitLink != null) tilted.components.hitLink.angle = sign * degrees * DEGREE;
			const leaned = accept(current, [{ type: 'upsertEntity', entity: tilted }], laneId, false);
			const result = leaned != null ? suggest(leaned) : null;
			if (result != null) {
				counts.retilt++;
				return result;
			}
		}
	}
	return null;
}

/**
 * The project as the assists see it for one lane: that lane's marble first, so the frame band centres on
 * its own release instead of the first marble's. The assists have no per-marble region yet.
 */
function regionView(current: TProject, laneId: string): TProject {
	const marble = current.entities.find((entity) => entity.components.marble?.laneId === laneId);
	const others = current.entities.filter((entity) => entity !== marble);
	return { ...current, entities: marble != null ? [marble, ...others] : current.entities };
}

function takeWhile<T>(items: T[], predicate: (item: T) => boolean): T[] {
	const index = items.findIndex((item) => !predicate(item));
	return index < 0 ? items : items.slice(0, index);
}

/** Same request the Compose assist worker answers; null when the assist finds nothing */
function ask(current: TProject, request: Parameters<typeof answerWorkerRequest>[1]): unknown {
	try {
		return answerWorkerRequest(simulator, { ...request, project: current } as typeof request);
	} catch (error) {
		return reject(`${request.kind}: ${(error as Error).message}`);
	}
}

/**
 * Applies the commands when every hit with a piece stays on time afterwards and the lane's next open dot
 * lies in its region. Before a long gap the dot cannot stay in frame until a rail exists.
 */
function accept(current: TProject, commands: TProjectCommand[], laneId: string, checkFrame = true): TProject | null {
	const [isAppliedOk, , applied] = applyProjectCommands(current, commands);
	if (!isAppliedOk) return reject('commands do not apply');
	const result = simulate(applied);
	const late = result.hits.filter((hit) => hit.status !== 'open' && hit.status !== 'onTime');
	if (late.length > 0) return reject(`late ${late.map((hit) => `${hit.hitId}:${hit.status}`).join(' ')}`);
	// A marble resting on a piece counts as touching it at every hit time; a real strike arrives moving
	const resting = result.hits.filter((hit) => hit.status === 'onTime' && Math.hypot(hit.velocity?.x ?? 0, hit.velocity?.y ?? 0) < 0.3);
	if (resting.length > 0) return reject(`resting ${resting.map((hit) => hit.hitId).join(' ')}`);
	// Each marble may only touch its own lane's pieces and never the other marble
	const crossed = result.contacts.filter(
		(contact) =>
			contact.kind === 'marble' ||
			(contact.kind === 'piece' && laneOfEntity(applied, contact.otherEntityId) !== laneOfEntity(applied, contact.marbleEntityId))
	);
	if (crossed.length > 0) return reject(`crossing ${crossed.map((contact) => `${contact.marbleEntityId}/${contact.otherEntityId}`).join(' ')}`);
	if (!checkFrame) return applied;
	const band = frameBand(regionView(applied, laneId));
	const next = nextOpenPerLane(result).get(laneId);
	if (next?.dot == null || isBeforeLongGap(applied, next) || isInBand(next.dot, band, 0.9)) return applied;
	return reject(`out of region ${next.hitId}@${next.dot.x.toFixed(2)}`);
}

function laneOfEntity(current: TProject, entityId: string): string | null {
	const entity = current.entities.find((item) => item.id === entityId);
	return entity?.components.hitLink?.laneId ?? entity?.components.marble?.laneId ?? null;
}

function reject(reason: string): null {
	reasons.push(reason);
	return null;
}

function isBeforeLongGap(current: TProject, hit: THitResult): boolean {
	return findLongGaps(current, hit.laneId, RAIL_GAP).some((gap) => gap.toHitId === hit.hitId && gap.bridgedBy == null);
}

/** `launchAngles` from the Compose assist: clear leans for the hit before an unbridged long gap */
function launchAngles(current: TProject, hit: THitResult): number[] | undefined {
	const gap = findLongGaps(current, hit.laneId, RAIL_GAP).find((item) => item.fromHitId === hit.hitId && item.bridgedBy == null);
	if (gap == null) return undefined;
	const previous = previousAngle(current, hit.laneId, hit.targetTime);
	const lean =
		previous != null && Math.abs(previous) > DEGREE
			? -Math.sign(previous)
			: Math.sign(defaultPlatformAngle(hit.dot ?? { x: 0, y: 0 }, hit.velocity, frameBand(current).centerX));
	return [17, 12, 22, 28].flatMap((degrees) => [lean * degrees * DEGREE, -lean * degrees * DEGREE]);
}

function previousAngle(current: TProject, laneId: string, time: number): number | null {
	const lane = current.music.lanes.find((item) => item.id === laneId);
	let angle: number | null = null;
	let latest = -Infinity;
	for (const entity of current.entities) {
		const link = entity.components.hitLink;
		if (link?.laneId !== laneId || entity.components.piece?.type !== 'platform') continue;
		const hitTime = lane?.hits.find((hit) => hit.id === link.hitId)?.time ?? -Infinity;
		if (hitTime < time && hitTime > latest) {
			latest = hitTime;
			angle = link.angle;
		}
	}
	return angle;
}

/** The interval to this hit equals the interval before, so a mirrored piece keeps the zigzag rhythm */
function repeatsInterval(current: TProject, laneId: string, hitId: string): boolean {
	const hits = current.music.lanes.find((lane) => lane.id === laneId)?.hits ?? [];
	const index = hits.findIndex((hit) => hit.id === hitId);
	const [a, b, c] = [hits[index - 2], hits[index - 1], hits[index]];
	if (a == null || b == null || c == null) return false;
	return Math.abs(c.time - b.time - (b.time - a.time)) < 0.015;
}

function openHits(result: TSimulationResult): THitResult[] {
	return result.hits
		.filter((hit) => hit.status === 'open' && hit.dot != null)
		.sort((a, b) => a.targetTime - b.targetTime);
}

function nextOpenPerLane(result: TSimulationResult): Map<string, THitResult> {
	const next = new Map<string, THitResult>();
	for (const hit of openHits(result)) if (!next.has(hit.laneId)) next.set(hit.laneId, hit);
	return next;
}

/**
 * When no piece works for a hit, the user rotates the lane's previous platform by hand so the marble
 * arrives differently, then presses Next again
 */
function backtrack(current: TProject, target: THitResult): TProject | null {
	const lane = current.music.lanes.find((item) => item.id === target.laneId);
	const index = lane?.hits.findIndex((hit) => hit.id === target.hitId) ?? -1;
	const previousHit = lane?.hits[index - 1];
	const previous = current.entities.find(
		(entity) => entity.components.hitLink?.hitId === previousHit?.id && entity.components.piece?.type === 'platform'
	);
	const angle = previous?.components.hitLink?.angle;
	if (previous == null || angle == null) return null;
	for (const delta of [3, -3, 6, -6, 9, -9, 12, -12, 18, -18]) {
		const rotated = structuredClone(previous);
		if (rotated.components.hitLink != null) rotated.components.hitLink.angle = angle + delta * DEGREE;
		const turned = accept(current, [{ type: 'upsertEntity', entity: rotated }], target.laneId, false);
		if (turned == null) continue;
		const moved = simulate(turned).hits.find((hit) => hit.hitId === target.hitId);
		if (moved?.dot == null || moved.status !== 'open') continue;
		const next = buildStep(turned, moved);
		if (next != null) {
			counts.backtrack++;
			say(`  ${previous.id}: rotated by ${delta}° by hand so ${target.hitId} can be placed`);
			return next;
		}
	}
	return null;
}

/** Hits from `time` on are left out, and the run ends shortly after the last hit before it */
function truncatedAt(current: TProject, time: number): TProject {
	const next = structuredClone(current);
	for (const lane of next.music.lanes) lane.hits = lane.hits.filter((hit) => hit.time < time - 1e-6);
	const last = Math.max(0, ...next.music.lanes.flatMap((lane) => lane.hits.map((hit) => hit.time)));
	next.end = Math.ceil((last + 0.5) * 10) / 10;
	return next;
}

function describeHeights(result: TSimulationResult): string {
	const times = Array.from({ length: Math.floor(result.duration / 4) }, (_, i) => (i + 1) * 4);
	return times
		.map((time) =>
			result.marbles
				.map((marble) => (marble.samples.find((sample) => sample.time >= time)?.position.y ?? NaN).toFixed(1))
				.join('|')
		)
		.join('  ');
}

/** Horizontal and vertical distance between the two marbles over the run */
function describeSeparation(result: TSimulationResult): string {
	const [a, b] = result.marbles;
	if (a == null || b == null) return 'one marble';
	let minDx = Infinity;
	let maxDy = 0;
	let crossings = 0;
	let side = 0;
	for (const [index, sample] of a.samples.entries()) {
		const other = b.samples[index];
		if (other == null) break;
		const dx = other.position.x - sample.position.x;
		minDx = Math.min(minDx, dx);
		maxDy = Math.max(maxDy, Math.abs(other.position.y - sample.position.y));
		if (side !== 0 && Math.sign(dx) !== side) crossings++;
		side = Math.sign(dx);
	}
	const marbleContacts = result.contacts.filter((contact) => contact.kind === 'marble').length;
	return `min x gap ${minDx.toFixed(3)} m, max y gap ${maxDy.toFixed(2)} m, ${crossings} side changes, ${marbleContacts} marble contacts`;
}

/** Lane, marble and hit IDs `lane-N`, `marble-N`, `hit-N-M` instead of the import's random ones */
function withStableIds(current: TProject): TProject {
	let json = JSON.stringify(current);
	current.music.lanes.forEach((lane, laneIndex) => {
		const n = laneIndex + 1;
		json = json.replaceAll(`"${lane.id}"`, `"lane-${n}"`);
		lane.hits.forEach((hit, hitIndex) => {
			json = json.replaceAll(`"${hit.id}"`, `"hit-${n}-${hitIndex + 1}"`);
		});
		const marble = current.entities.find((entity) => entity.components.marble?.laneId === lane.id);
		if (marble != null) json = json.replaceAll(`"${marble.id}"`, `"marble-${n}"`);
	});
	return JSON.parse(json) as TProject;
}

function pieceId(hitId: string): string {
	return hitId.replace('hit', 'piece');
}

function laneIndex(laneId: string): string {
	return laneId.replace('lane-', '');
}

function apply(current: TProject, commands: TProjectCommand[], revision?: number): TProject {
	const [isAppliedOk, appliedErr, applied] = applyProjectCommands(current, commands);
	if (!isAppliedOk) throw appliedErr;
	if (revision != null) applied.revision = revision;
	return applied;
}

/**
 * The Jingle Bells refrain (James Lord Pierpont, 1857, public domain) in G major at 120 BPM on Glockenspiel,
 * and a root and fifth bass in quarter notes on Celesta. Notes are [beat, beats, MIDI pitch].
 */
function createJingleMidi(): Uint8Array {
	const [G, A, B, C, D] = [67, 69, 71, 72, 74];
	const verse = (start: number): number[][] => [
		[start, 1, B], [start + 1, 1, B], [start + 2, 2, B],
		[start + 4, 1, B], [start + 5, 1, B], [start + 6, 2, B],
		[start + 8, 1, B], [start + 9, 1, D], [start + 10, 1.5, G], [start + 11.5, 0.5, A],
		[start + 12, 4, B],
		[start + 16, 1, C], [start + 17, 1, C], [start + 18, 1.5, C], [start + 19.5, 0.5, C],
		[start + 20, 1, C], [start + 21, 1, B], [start + 22, 1, B], [start + 23, 0.5, B], [start + 23.5, 0.5, B]
	];
	const melody = [
		...verse(0),
		[24, 1, B], [25, 1, A], [26, 1, A], [27, 1, B],
		[28, 2, A], [30, 2, D],
		...verse(32),
		[56, 1, D], [57, 1, D], [58, 1, C], [59, 1, A],
		[60, 4, G]
	];
	// Chord roots per bar: G G G G C G A D, G G G G C G D G
	const roots = ['G', 'G', 'G', 'G', 'C', 'G', 'A', 'D', 'G', 'G', 'G', 'G', 'C', 'G', 'D', 'G'];
	const fifths: Record<string, [number, number]> = { G: [55, 50], C: [48, 55], A: [57, 52], D: [50, 57] };
	const bass = roots.flatMap((root, bar) => {
		const [low, high] = fifths[root] ?? [55, 50];
		return [low, high, low, high].map((pitch, beat) => [bar * 4 + beat, 1, pitch]);
	});

	const file = new Midi();
	file.name = 'Jingle Bells';
	file.header.setTempo(120);
	const seconds = 0.5;
	for (const [name, program, list, velocity] of [
		['Melody', GLOCKENSPIEL, melody, 0.85],
		['Bass', CELESTA, bass, 0.7]
	] as const) {
		const track = file.addTrack();
		track.name = name;
		track.instrument.number = program;
		for (const [beat = 0, beats = 1, pitch = 60] of list) {
			track.addNote({ midi: pitch, time: beat * seconds, duration: beats * seconds * 0.95, velocity });
		}
	}
	return file.toArray();
}
