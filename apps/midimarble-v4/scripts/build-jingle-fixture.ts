// Writes `fixtures/jingle-bells.marble.json`: the public domain Jingle Bells refrain with a simple bass line,
// imported like the app's MIDI import sheet (split across up to two marbles, aligned to the import start) and
// built hit by hit with Next semantics through the assist worker's request handler: a switchback (or a rail when
// none fits) for a long gap, accepted Continue ghosts, Mirror when the interval repeats and Auto place otherwise.
// Every lane keeps to its own frame band and to the shared descent pace y*(t). Where the assists find nothing,
// the build does what a user would: rotates the piece or the one before it by hand. Every step must keep all hits
// on time and each marble on its own pieces; the build stops at the first step that cannot. Writes the MIDI file
// and a build log with the pace measurements to `.local/jingle/`. The fixture ships the MIDI file next to it as
// `fixtures/jingle-bells.mid`, its song, which the example copies into the new package.
// Usage: tsx scripts/build-jingle-fixture.ts [--finalize]
//   --finalize re-applies the song and piece names to the existing fixture without rebuilding its pieces
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as toneMidi from '@tonejs/midi';
import { preflightExport } from '../src/modules/design/export-preflight';
import { alignNotes, createImportCommands, parseMidiFile, proposeLanes } from '../src/modules/music';
import {
	applyProjectCommands,
	createProject,
	LANE_SPACING,
	parseProject,
	serializeProject,
	type TProject,
	type TProjectCommand,
	type TSource
} from '../src/modules/project';
import {
	autoPlace,
	findLongGaps,
	isInBand,
	mirrorPiece,
	openLongGaps,
	type TSimulateFn
} from '../src/modules/simulation/assists';
import { paceAt } from '../src/modules/simulation/pace';
import { namePiecesInOrder } from '../src/modules/simulation/piece-names';
import { createLinkedPiece, frameBand } from '../src/modules/simulation/placement';
import { createSimulator } from '../src/modules/simulation/simulate';
import type { THitResult, TSimulationResult } from '../src/modules/simulation/types';
import { answerWorkerRequest, type TGapPieceType, type TWorkerAnswers } from '../src/modules/simulation/worker-protocol';

// Node loads the CommonJS build of @tonejs/midi, whose exports sit on `default`
const { Midi } = (toneMidi as unknown as { default?: typeof toneMidi }).default ?? toneMidi;
const OUT = new URL('../.local/jingle/', import.meta.url);
const FIXTURE_URL = new URL('../fixtures/jingle-bells.marble.json', import.meta.url);
const SONG_NAME = 'jingle-bells.mid';
const TEMPO = 120;
// Same as the import sheet: notes start after a one second lead-in, at most two marbles
const IMPORT_START = 1;
const MAX_MARBLES = 2;
const GLOCKENSPIEL = 9;
const CELESTA = 8;
// Melody on the left of the frame, bass on the right, one lane spacing apart like the import places them. Each
// keeps the import's release time, a short drop before its first note
const RELEASES = [
	{ x: -LANE_SPACING / 2, y: 0.6 },
	{ x: LANE_SPACING / 2, y: 0.6 }
];
const DEGREE = Math.PI / 180;
// Release shifts the build tries in turn, in metres
const RELEASE_SHIFTS = [0, 0.01, -0.01, 0.005, -0.005, 0.015, -0.015, 0.02, -0.02, 0.025, -0.025, 0.03, -0.03, 0.04, -0.04];

mkdirSync(OUT, { recursive: true });
const log: string[] = [];
const say = (line: string): void => {
	log.push(line);
	console.log(line);
};

// MIDI file and import

const midiBytes = createJingleMidi();
writeFileSync(new URL(SONG_NAME, OUT), midiBytes);
writeFileSync(new URL(`../fixtures/${SONG_NAME}`, import.meta.url), midiBytes);

if (process.argv.includes('--finalize')) {
	const [isFixtureOk, fixtureErr, fixture] = parseProject(readFileSync(FIXTURE_URL, 'utf8'));
	if (!isFixtureOk) throw fixtureErr;
	writeFileSync(FIXTURE_URL, serializeProject(finalized(fixture)));
	console.log('finalized');
	process.exit(0);
}

const [isMidiOk, midiErr, midi] = parseMidiFile(midiBytes);
if (!isMidiOk) throw midiErr;
const notes = midi.tracks.flatMap((track) => track.notes);
const proposal = proposeLanes(alignNotes(notes, IMPORT_START), { strategy: 'split', maxLanes: MAX_MARBLES });
say(
	`import: ${midi.tracks.length} tracks, ${notes.length} notes -> lanes ${proposal.lanes.map((lane) => lane.length).join(' + ')}, ${proposal.backing.length} backing`
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
	entity.components.release = { position: { x: release.x, y: release.y }, time: entity.components.release?.time ?? 0 };
});

// Build

// Speed: the user sets full gravity in the World panel. At the default half gravity the build stops early for
// every release lead tried (23 s at 0.35 s, 1.5 s at 0.7 s, 29 s at 1 s); at full gravity it completes
const GRAVITY_SCALE = 1;
project.physics.gravityScale = GRAVITY_SCALE;

const simulator = await createSimulator();
const simulate: TSimulateFn = (current) => simulator.simulate(current);
const emptyCounts = () => ({ next: 0, switchback: 0, rail: 0, continue: 0, continued: 0, mirror: 0, autoPlace: 0, launch: 0, wide: 0, lean: 0, backtrack: 0, unblock: 0, failed: 0 });
let counts = emptyCounts();
let failures: string[] = [];
const reasons: string[] = [];
const startedAt = performance.now();
const imported = project;

// The build is sensitive to where the marbles start, like a user's run is. When a build gets stuck, the user
// moves both releases a few millimetres and builds again; the first complete build that keeps the shared pace wins,
// else the one that got furthest.
let best: { project: TProject; counts: typeof counts; failures: string[]; reached: number } | null = null;
for (const shift of RELEASE_SHIFTS) {
	project = structuredClone(imported);
	for (const entity of project.entities) {
		const release = entity.components.release;
		if (release != null) release.position = { x: Math.round((release.position.x + shift) * 1e4) / 1e4, y: release.position.y };
	}
	counts = emptyCounts();
	failures = [];
	say(`releases shifted by ${shift.toFixed(3)} m`);
	let reached = Infinity;
	for (let step = 0; step < 400; step++) {
		const result = simulate(project);
		// Without a selection Next takes the earliest open hit of any marble, or an earlier long gap after the last
		// piece, across which the marble may have fallen too far to leave a dot
		const open = openHits(result)[0];
		const gap = project.music.lanes.flatMap((lane) => openLongGaps(project, lane.id)).sort((a, b) => a.to - b.to)[0];
		const target =
			gap != null && (open == null || gap.to <= open.targetTime + 1e-9)
				? (result.hits.find((hit) => hit.laneId === gap.laneId && hit.hitId === gap.toHitId) ?? open)
				: open;
		if (target == null) break;
		counts.next++;
		reasons.length = 0;
		// The assists first, then what a user tries: rotating the previous piece, then rotating this one by hand
		const next =
			buildStep(project, target, false) ??
			(target.dot != null ? backtrack(project, target) : null) ??
			unblock(project, target) ??
			buildStep(project, target, true);
		if (next == null) {
			// The build stops at the first step no assist can take: both lanes keep only the hits before it
			failures.push(`${target.hitId} at ${target.targetTime.toFixed(2)} s: ${reasons.join('; ') || 'no assist found a piece'}`);
			say(`  ${target.hitId}: impossible, the build stops at ${target.targetTime.toFixed(2)} s`);
			project = truncatedAt(project, target.targetTime);
			counts.failed++;
			reached = target.targetTime;
			break;
		}
		project = next;
	}
	// A complete build must also keep its dots on the shared pace, as the fixture test checks
	if (reached === Infinity && !keepsPace(simulate(project))) {
		say('  the dots leave the shared pace, so the build counts as stopped at the end');
		reached = project.end;
	}
	if (best == null || reached > best.reached) best = { project, counts, failures, reached };
	if (reached === Infinity) break;
}
if (best != null) ({ project, counts, failures } = best);

const finalResult = simulate(project);
simulator.dispose();
const byLane = project.music.lanes.map((lane) => {
	const hits = finalResult.hits.filter((hit) => hit.laneId === lane.id);
	return `${lane.name}: ${hits.filter((hit) => hit.status === 'onTime').length}/${hits.length} on time`;
});
say(`build: ${Math.round(performance.now() - startedAt)} ms, ${JSON.stringify(counts)}`);
say(
	`manual steps: ${counts.lean + counts.backtrack + counts.unblock} (${counts.lean} hand rotations, ${counts.backtrack} rotations of the previous piece, ${counts.unblock} of the other lane's piece in the way)`
);
say(`hits: ${byLane.join(', ')}`);
say(`separation: ${describeSeparation(project, finalResult)}`);
for (const line of describePace(project, finalResult)) say(line);
say(`heights every 4 s (melody | bass | y*, m): ${describeHeights(finalResult)}`);
for (const failure of failures) say(`failed: ${failure}`);
say(`export preflight: ${preflightExport(project, finalResult).issues.map((issue) => `${issue.title} (${issue.detail})`).join('; ') || 'clean'}`);

const json = serializeProject(finalized(apply(project, [], 0)));
const [isProjectOk, projectErr] = parseProject(json);
if (!isProjectOk) throw projectErr;
writeFileSync(FIXTURE_URL, json);
writeFileSync(new URL('build-log.txt', OUT), `${log.join('\n')}\n`);

/**
 * What the import sheet records besides the marbles: the MIDI file as the project's song, starting where its
 * first note plays, and its tempo. Pieces are named in time order last. Neither changes the run.
 */
function finalized(current: TProject): TProject {
	const source: TSource = { id: 'source-1', kind: 'midi', path: `audio/${SONG_NAME}`, name: SONG_NAME, offset: IMPORT_START };
	const removed = current.music.sources.map((item) => ({ type: 'removeSource' as const, sourceId: item.id }));
	const song = apply(current, [...removed, { type: 'upsertSource', source }, { type: 'setTempo', tempo: { bpm: TEMPO, beatsPerBar: 4 } }], current.revision);
	return namePiecesInOrder(song);
}

/** At most two dots beyond the pace limit, and none by more than 0.15 m beyond it */
function keepsPace(result: TSimulationResult): boolean {
	const pace = result.pace;
	if (pace == null) return false;
	const offsets = result.hits.map((hit) => Math.abs((hit.dot?.y ?? Infinity) - paceAt(pace, hit.targetTime)));
	return offsets.filter((offset) => offset > pace.limit).length <= 2 && Math.max(...offsets) < pace.limit + 0.15;
}

/**
 * One press of Next for the earliest open hit: a switchback, or a rail, when a long gap ends at it, otherwise
 * Continue ghosts for its lane, then Mirror when the rhythm repeats, then Auto place (which launches the marble
 * into the coming switchback before a long gap). Each option must keep every placed hit on time, the lane's next
 * dot in its frame band and near the pace; the first that does wins.
 */
function buildStep(current: TProject, target: THitResult, canLean: boolean): TProject | null {
	const { laneId, hitId } = target;
	const result = simulate(current);
	const gap = findLongGaps(current, laneId).find((item) => item.toHitId === hitId && item.bridgedBy == null);
	if (gap != null) {
		for (const type of ['switchback', 'rail'] as TGapPieceType[]) {
			const answer = ask(current, {
				kind: 'gapPiece',
				type,
				project: current,
				laneId,
				fromHitId: gap.fromHitId,
				toHitId: gap.toHitId,
				entityId: `${type}-${laneIndex(laneId)}-${counts.switchback + counts.rail + 1}`
			}) as TWorkerAnswers['gapPiece'] | null;
			// The hit after the gap piece is placed by construction wherever the marble arrives
			const accepted = answer != null ? accept(current, answer.commands, laneId, false) : null;
			if (accepted == null) continue;
			counts[type === 'switchback' ? 'switchback' : 'rail']++;
			const params = answer?.entity.components.piece?.params ?? {};
			const pace = answer?.check?.paceError;
			say(
				`  ${gap.fromHitId} -> ${gap.toHitId}: ${type} over ${gap.duration.toFixed(2)} s${type === 'switchback' ? ` (${params['legs']} legs at ${(Math.abs(answer?.entity.components.hitLink?.angle ?? 0) / DEGREE).toFixed(0)}°)` : ''}, next dot ${pace != null ? `${pace.toFixed(2)} m from y*` : 'without pace'}`
			);
			return accepted;
		}
		say(`  ${gap.fromHitId} -> ${gap.toHitId}: no gap piece fits the ${gap.duration.toFixed(2)} s gap (${reasons.at(-1) ?? ''})`);
	}

	const isLaunch = findLongGaps(current, laneId).some((item) => item.fromHitId === hitId && item.bridgedBy == null);
	const continued = !isLaunch ? (ask(current, { kind: 'continue', project: current, laneId }) as TWorkerAnswers['continue'] | null) : null;
	// Ghosts get the build's stable piece IDs, so the fixture is the same on every run
	const ghosts: TProjectCommand[] = (continued?.commands ?? []).map((command) =>
		command.type === 'upsertEntity' && command.entity.components.hitLink != null
			? { ...command, entity: { ...command.entity, id: pieceId(command.entity.components.hitLink.hitId) } }
			: command
	);
	if (ghosts.length > 0) {
		const accepted = accept(current, ghosts, laneId);
		if (accepted != null) {
			counts.continue++;
			counts.continued += ghosts.length;
			return accepted;
		}
	}

	const isLast = current.music.lanes.find((lane) => lane.id === laneId)?.hits.at(-1)?.id === hitId;
	// Like Continue, Mirror leaves the hit ahead of a launch to Auto place, which checks the launch is struck firmly
	const hits = current.music.lanes.find((lane) => lane.id === laneId)?.hits ?? [];
	const following = hits[hits.findIndex((hit) => hit.id === hitId) + 1];
	const isBeforeLaunch = following != null && findLongGaps(current, laneId).some((item) => item.fromHitId === following.id);
	if (!isLaunch && !isLast && !isBeforeLaunch && repeatsInterval(current, laneId, hitId)) {
		const [isMirrorOk, , mirrored] = mirrorPiece(current, result, laneId, { id: pieceId(hitId) });
		const accepted = isMirrorOk ? accept(current, mirrored.commands, laneId) : null;
		if (accepted != null) {
			counts.mirror++;
			return accepted;
		}
	}

	const placed = ask(current, {
		kind: 'autoPlace',
		project: current,
		laneId,
		hitId,
		type: 'platform',
		entityId: pieceId(hitId)
	}) as TWorkerAnswers['autoPlace'] | null;
	const accepted = placed != null ? accept(current, [{ type: 'upsertEntity', entity: placed.entity }], laneId) : null;
	if (accepted != null) {
		if (isLaunch) counts.launch++;
		else counts.autoPlace++;
		return accepted;
	}
	// What a user tries next: rotating further than Auto place searches
	const [isWideOk, wideErr, wide] = autoPlace(current, result, laneId, hitId, {
		simulate,
		id: pieceId(hitId),
		range: [-60 * DEGREE, 60 * DEGREE]
	});
	const widened = isWideOk ? accept(current, wide.commands, laneId) : reject(`wide autoPlace: ${wideErr.message}`);
	if (widened != null) {
		counts.wide++;
		return widened;
	}
	if (!canLean) return null;
	// What a user does when Auto place finds nothing: rotate the piece by hand until the next dot comes back
	// as close to the marble's band as it gets, keeping every hit on time
	const band = frameBand(current, laneId);
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
	say(`  ${hitId}: rotated by hand to ${best.angle}°, next dot ${best.offset.toFixed(2)} m from its band centre (${reasons.at(-1) ?? ''})`);
	return best.project;
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
 * Applies the commands when every hit with a piece stays on time afterwards (a resting first contact counts
 * as missed) up to the other marbles' next open hits, each marble touches only its own pieces, and the
 * lane's next open dot lies in its band and within the pace limit of y* (or no further than the target dot
 * already was). Before a long gap the dot cannot do either until a gap piece exists.
 */
function accept(current: TProject, commands: TProjectCommand[], laneId: string, checkFrame = true): TProject | null {
	const [isAppliedOk, , applied] = applyProjectCommands(current, commands);
	if (!isAppliedOk) return reject('commands do not apply');
	const result = simulate(applied);
	// Each marble's path is final up to its next open hit; beyond that it is free flight that later pieces
	// change, and it may pass through or bump into what the other marble has built
	const frontier = new Map<string, number>();
	for (const hit of result.hits) {
		if (hit.status !== 'open') continue;
		const marbleId = applied.entities.find((entity) => entity.components.marble?.laneId === hit.laneId)?.id ?? '';
		frontier.set(marbleId, Math.min(frontier.get(marbleId) ?? Infinity, hit.targetTime));
	}
	// Across a long gap that nothing bridges yet the marble falls freely until its switchback exists
	for (const lane of applied.music.lanes) {
		const marbleId = applied.entities.find((entity) => entity.components.marble?.laneId === lane.id)?.id ?? '';
		for (const gap of openLongGaps(applied, lane.id)) frontier.set(marbleId, Math.min(frontier.get(marbleId) ?? Infinity, gap.from + 0.3));
	}
	const othersFrontier = (laneId: string): number =>
		Math.min(
			Infinity,
			...applied.entities
				.filter((entity) => entity.components.marble != null && entity.components.marble.laneId !== laneId)
				.map((entity) => frontier.get(entity.id) ?? Infinity)
		);
	const late = result.hits.filter(
		(hit) => hit.status !== 'open' && hit.status !== 'onTime' && hit.targetTime < othersFrontier(hit.laneId)
	);
	if (late.length > 0) return reject(`late ${late.map((hit) => `${hit.hitId}:${hit.reason ?? hit.status}`).join(' ')}`);
	// Each marble may only touch its own lane's pieces and never the other marble
	const crossed = result.contacts.filter(
		(contact) =>
			contact.time < Math.min(frontier.get(contact.marbleEntityId) ?? Infinity, contact.kind === 'marble' ? (frontier.get(contact.otherEntityId) ?? Infinity) : Infinity) &&
			(contact.kind === 'marble' ||
				(contact.kind === 'piece' && laneOfEntity(applied, contact.otherEntityId) !== laneOfEntity(applied, contact.marbleEntityId)))
	);
	if (crossed.length > 0) return reject(`crossing ${crossed.map((contact) => `${contact.marbleEntityId}/${contact.otherEntityId}`).join(' ')}`);
	if (!checkFrame) return applied;
	const band = frameBand(applied, laneId);
	const next = nextOpenPerLane(result).get(laneId);
	if (next?.dot == null || isBeforeLongGap(applied, next)) return applied;
	if (!isInBand(next.dot, band, 0.9)) return reject(`out of band ${next.hitId}@${next.dot.x.toFixed(2)}`);
	// A flat platform must still fit at the next dot, as Auto place checks for its own pieces
	const probe = createLinkedPiece('platform', laneId, next.hitId, 0, { id: 'accept-probe' });
	const probed = simulate({ ...applied, entities: [...applied.entities, probe], end: Math.min(applied.end, next.targetTime + 0.05) });
	if (probed.pieces.find((piece) => piece.entityId === probe.id)?.status === 'blocked') return reject(`no room at ${next.hitId}`);
	const pace = result.pace;
	const before = simulate(current).hits.find((hit) => hit.laneId === laneId && hit.status === 'open' && hit.dot != null);
	if (pace != null && before?.dot != null) {
		// Beyond the limit a dot may not get further from the pace than the one before it
		const allowed = Math.max(pace.limit, Math.abs(before.dot.y - paceAt(pace, before.targetTime)));
		const off = Math.abs(next.dot.y - paceAt(pace, next.targetTime));
		if (off > allowed) return reject(`off pace ${next.hitId} by ${off.toFixed(2)} m`);
	}
	return applied;
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
	return findLongGaps(current, hit.laneId).some((gap) => gap.toHitId === hit.hitId && gap.bridgedBy == null);
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
		const next = buildStep(turned, moved, false);
		if (next != null) {
			counts.backtrack++;
			say(`  ${previous.id}: rotated by ${delta}° by hand so ${target.hitId} can be placed`);
			return next;
		}
	}
	return null;
}

/**
 * When every step fails because a piece of the other lane ends up blocked or resting, the user rotates that
 * piece by hand so the marbles keep clear of each other, then presses Next again
 */
function unblock(current: TProject, target: THitResult): TProject | null {
	const blocked = [...new Set(reasons.flatMap((reason) => [...reason.matchAll(/(hit-\d+-\d+):(?:blocked|resting)/g)].map((match) => match[1] ?? '')))].filter(
		(hitId) => hitId !== target.hitId && !hitId.startsWith(target.hitId.replace(/-\d+$/, '-'))
	);
	for (const hitId of blocked) {
		const piece = current.entities.find((entity) => entity.components.hitLink?.hitId === hitId && entity.components.piece?.type === 'platform');
		const angle = piece?.components.hitLink?.angle;
		if (piece == null || angle == null) continue;
		for (const delta of [3, -3, 6, -6, 9, -9]) {
			const rotated = structuredClone(piece);
			if (rotated.components.hitLink != null) rotated.components.hitLink.angle = angle + delta * DEGREE;
			const [isAppliedOk, , turned] = applyProjectCommands(current, [{ type: 'upsertEntity', entity: rotated }]);
			if (!isAppliedOk) continue;
			const result = simulate(turned);
			if (result.hits.some((hit) => hit.status !== 'open' && hit.status !== 'onTime' && hit.targetTime <= target.targetTime)) continue;
			const moved = result.hits.find((hit) => hit.hitId === target.hitId);
			if (moved == null) continue;
			const next = buildStep(turned, moved, false) ?? (moved.dot != null ? backtrack(turned, moved) : null);
			if (next != null) {
				counts.unblock++;
				say(`  ${piece.id}: rotated by ${delta}° by hand so ${target.hitId} keeps clear of it`);
				return next;
			}
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
		.map((time) => {
			const heights = result.marbles.map((marble) => (marble.samples.find((sample) => sample.time >= time)?.position.y ?? NaN).toFixed(1));
			const pace = result.pace != null ? paceAt(result.pace, time).toFixed(1) : '-';
			return [...heights, pace].join('|');
		})
		.join('  ');
}

/** Horizontal and vertical distance between the two marbles while both play, from the later first hit to the earlier last hit */
function describeSeparation(current: TProject, result: TSimulationResult): string {
	const [a, b] = result.marbles;
	if (a == null || b == null) return 'one marble';
	const from = Math.max(...current.music.lanes.map((lane) => lane.hits[0]?.time ?? 0));
	const to = Math.min(...current.music.lanes.map((lane) => lane.hits.at(-1)?.time ?? Infinity));
	let minDx = Infinity;
	let maxDy = 0;
	let crossings = 0;
	let side = 0;
	const offset = Math.round((b.samples[0]?.time ?? 0) * 240) - Math.round((a.samples[0]?.time ?? 0) * 240);
	for (const [index, sample] of a.samples.entries()) {
		const other = b.samples[index - offset];
		if (other == null || sample.time < from || sample.time > to) continue;
		const dx = other.position.x - sample.position.x;
		minDx = Math.min(minDx, dx);
		maxDy = Math.max(maxDy, Math.abs(other.position.y - sample.position.y));
		if (side !== 0 && Math.sign(dx) !== side) crossings++;
		side = Math.sign(dx);
	}
	const marbleContacts = result.contacts.filter((contact) => contact.kind === 'marble').length;
	return `min x gap ${minDx.toFixed(3)} m, max y gap ${maxDy.toFixed(2)} m, ${crossings} side changes, ${marbleContacts} marble contacts`;
}

/**
 * Per lane, |y − y*| over every sample from the lane's first to its last hit, and at the hit dots; the
 * largest vertical distance between the marbles over the time both play; the gap pieces used
 */
function describePace(current: TProject, result: TSimulationResult): string[] {
	const pace = result.pace;
	if (pace == null) return ['pace: none'];
	const lines = [`pace: ${pace.rate.toFixed(3)} m/s from ${pace.anchorY.toFixed(2)} m at ${pace.anchorTime.toFixed(2)} s, limit ${pace.limit} m`];
	const windows: [number, number][] = [];
	for (const lane of current.music.lanes) {
		const marble = result.marbles.find((item) => item.laneId === lane.id);
		const first = lane.hits[0]?.time ?? 0;
		const last = lane.hits.at(-1)?.time ?? 0;
		windows.push([first, last]);
		let max = 0;
		let sum = 0;
		let count = 0;
		for (const sample of marble?.samples ?? []) {
			if (sample.time < first || sample.time > last) continue;
			const off = Math.abs(sample.position.y - paceAt(pace, sample.time));
			max = Math.max(max, off);
			sum += off;
			count++;
		}
		const dots = result.hits.filter((hit) => hit.laneId === lane.id && hit.dot != null).map((hit) => Math.abs((hit.dot?.y ?? 0) - paceAt(pace, hit.targetTime)));
		const dotsOver = dots.filter((off) => off > pace.limit).length;
		lines.push(
			`  ${lane.name}: |y - y*| max ${max.toFixed(2)} m, mean ${(sum / Math.max(1, count)).toFixed(2)} m over samples; at dots max ${Math.max(0, ...dots).toFixed(2)} m, ${dotsOver} of ${dots.length} beyond ${pace.limit} m`
		);
	}
	const [a, b] = result.marbles;
	if (a != null && b != null) {
		const from = Math.max(...windows.map(([first]) => first));
		const to = Math.min(...windows.map(([, last]) => last));
		const byTime = new Map(b.samples.map((sample) => [Math.round(sample.time * 240), sample.position.y]));
		let maxDy = 0;
		for (const sample of a.samples) {
			if (sample.time < from || sample.time > to) continue;
			const other = byTime.get(Math.round(sample.time * 240));
			if (other != null) maxDy = Math.max(maxDy, Math.abs(sample.position.y - other));
		}
		lines.push(`  marbles: max vertical distance ${maxDy.toFixed(2)} m from ${from.toFixed(2)} s to ${to.toFixed(2)} s`);
	}
	const holders = current.entities.filter((entity) => entity.components.piece?.type === 'switchback').length;
	const rails = current.entities.filter((entity) => entity.components.piece?.type === 'rail').length;
	lines.push(`  gap pieces: ${holders} switchbacks, ${rails} rails`);
	return lines;
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
	file.header.setTempo(TEMPO);
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
