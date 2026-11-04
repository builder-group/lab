// Writes `fixtures/jingle-bells.marble.json`: the public domain Jingle Bells refrain with a simple bass line,
// imported like the app's MIDI import sheet (split across up to two marbles, aligned to the import start) and
// built by Build Track, the app's own builder (`src/modules/compose/build-track.ts`), which ends each marble in a
// Finish. Writes the MIDI file and a build log with the pace measurements to `.local/jingle/`. The fixture ships the
// MIDI file next to it as `fixtures/jingle-bells.mid`, its song, which the example copies into the new package.
// The film ends with the marbles' catch.
// Last it is dressed for the film: a Christmas project theme stored in the fixture and a seeded scatter of the Christmas
// Decor set, which never changes a hit.
// A build lands in `.local/jingle/` and replaces the fixture only with --write.
// Usage: tsx scripts/build-jingle-fixture.ts [--write] [--finalize] [--dress]
//   --finalize re-applies the song, the Finishes, piece names and the film end to the existing fixture without
//   rebuilding its pieces
//   --dress only re-applies the theme and the Decor to the existing fixture
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as toneMidi from '@tonejs/midi';
import { buildTrack, localBuildDeps } from '../src/modules/compose/build-track';
import { withFinishes } from '../src/modules/compose/finish-assist';
import { builtInSource, newDecor, setDecorList } from '../src/modules/design/decor';
import { scatterDecorCommands } from '../src/modules/design/decor-scatter';
import { preflightExport } from '../src/modules/design/export-preflight';
import { filmCamera } from '../src/modules/design/film-camera';
import { fittedSongEnd } from '../src/modules/camera/finish-exit';
import { alignNotes, createImportCommands, parseMidiFile, proposeLanes } from '../src/modules/music';
import {
	applyProjectCommands,
	createProject,
	DEFAULT_CAMERA_DISTANCE,
	DEFAULT_CAMERA_PITCH,
	LANE_SPACING,
	parseProject,
	serializeProject,
	type TProject,
	type TProjectCommand,
	type TDecor,
	type TProjectTheme,
	type TSource
} from '../src/modules/project';
import type { TSimulateFn } from '../src/modules/simulation/assists';
import { paceAt } from '../src/modules/simulation/pace';
import { namePiecesInOrder } from '../src/modules/simulation/piece-names';
import { createSimulator } from '../src/modules/simulation/simulate';
import type { TSimulationResult } from '../src/modules/simulation/types';

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
// The film's look lives in the project: a preset of ordinary parts on Brass's render look. A warm cream wall in a warm
// room under a golden, soft Key Light from close to the wall's normal, a bit of Bloom for what glows.
// This project's own placed Decor; a theme never carries any
const CHRISTMAS_DECOR = ['decor:bauble-red', 'decor:bauble-gold', 'decor:snowflake-gold', 'decor:gift-box', 'decor:star', 'decor:fairy-light'];
const CHRISTMAS_THEME: TProjectTheme = {
	id: 'theme-christmas',
	name: 'Christmas',
	base: 'brass',
	overrides: { wallColor: '#fcf3df', lightColor: '#ffe6b3', backgroundColor: '#fff2d2' },
	keyLight: { strength: 5, side: -0.26, height: 0.35, softness: 0.55, exposure: 0.4, bloom: 0.5 },
	parts: { platform: { skin: 'platform:gift' }, rail: { skin: 'rail:candy' }, switchback: { skin: 'switchback:candy' }, marble: { skin: 'marble:glass-green', colour: 'marble' } }
};
const DECOR_DENSITY = 0.18;
const DECOR_SEED = 1;

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

if (process.argv.includes('--dress')) {
	const [isFixtureOk, fixtureErr, fixture] = parseProject(readFileSync(FIXTURE_URL, 'utf8'));
	if (!isFixtureOk) throw fixtureErr;
	const dressing = await createSimulator();
	writeFileSync(FIXTURE_URL, serializeProject(dressed(fixture, (current) => dressing.simulate(current))));
	dressing.dispose();
	console.log('dressed');
	process.exit(0);
}

if (process.argv.includes('--finalize')) {
	const [isFixtureOk, fixtureErr, fixture] = parseProject(readFileSync(FIXTURE_URL, 'utf8'));
	if (!isFixtureOk) throw fixtureErr;
	const finishing = await createSimulator();
	const finalizedFixture = await finalized(fixture, (current) => finishing.simulate(current));
	writeFileSync(FIXTURE_URL, serializeProject(dressed(finalizedFixture, (current) => finishing.simulate(current))));
	finishing.dispose();
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
let project = createProject({ id: 'jingle-bells', title: 'Jingle Bells' });
project = apply(
	project,
	createImportCommands(project, {
		lanes: proposal.lanes,
		instrument: GLOCKENSPIEL
	})
);
project = withStableIds(project);
// What a user sets after the import: lane names, Celesta for the bass and where each marble starts
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

// Speed: new projects' default half gravity, which a beginner importing the song gets. Full gravity (1) also
// builds; half gravity stacks each column's pieces closer and moves the film slower, like the reference films
const GRAVITY_SCALE = 0.5;
project.physics.gravityScale = GRAVITY_SCALE;

const simulator = await createSimulator();
const simulate: TSimulateFn = (current) => simulator.simulate(current);
const startedAt = performance.now();
const outcome = await buildTrack(project, { ...localBuildDeps(simulator), onLog: say });
project = outcome.project;
const { counts } = outcome;

const finalResult = simulate(project);
const byLane = project.music.lanes.map((lane) => {
	const hits = finalResult.hits.filter((hit) => hit.laneId === lane.id);
	return `${lane.name}: ${hits.filter((hit) => hit.status === 'onTime').length}/${hits.length} on time`;
});
say(`build: ${Math.round(performance.now() - startedAt)} ms, ${JSON.stringify(counts)}`);
say(
	`manual steps: ${counts.lean + counts.backtrack + counts.unblock + counts.rewind + counts.frame} (${counts.lean} hand rotations, ${counts.backtrack} rotations of the previous piece, ${counts.unblock} of the other lane's piece in the way, ${counts.rewind} back-ups of a few hits, ${counts.frame} back-ups for the camera or a stuck hit); attempts: ${outcome.attempts}, releases shifted by ${outcome.releaseShift} m`
);
say(`hits: ${byLane.join(', ')}`);
say(`separation: ${describeSeparation(project, finalResult)}`);
for (const line of describePace(project, finalResult)) say(line);
say(`heights every 4 s (melody | bass | y*, m): ${describeHeights(finalResult)}`);
for (const hit of outcome.attention) say(`needs attention: ${hit.hitId} at ${hit.time.toFixed(2)} s, ${hit.status}`);
for (const line of outcome.finishes) say(`finish: ${line}`);
say(`export preflight: ${preflightExport(project, finalResult).issues.map((issue) => `${issue.title} (${issue.detail})`).join('; ') || 'clean'}`);

const json = serializeProject(dressed(await finalized(apply(project, [], 0), simulate), simulate));
simulator.dispose();
const [isProjectOk, projectErr] = parseProject(json);
if (!isProjectOk) throw projectErr;
writeFileSync(process.argv.includes('--write') ? FIXTURE_URL : new URL('jingle-bells.marble.json', OUT), json);
writeFileSync(new URL('build-log.txt', OUT), `${log.join('\n')}\n`);

/**
 * What the import sheet records besides the marbles: the MIDI file as the project's song, starting where its
 * first note plays, its tempo, the default camera of a new project, a Finish for each marble after its last note
 * and Fit to Song's film end. Pieces are named in time order last. None of it changes the run before its end.
 */
async function finalized(fixture: TProject, simulateFinish: TSimulateFn): Promise<TProject> {
	// Both marbles end in a Finish, the melody's 1.5 s before the bass's, which plays last
	const finished = await withFinishes(fixture, { simulate: simulateFinish }, { lanes: fixture.music.lanes.map((lane) => lane.id) });
	for (const message of finished.messages) console.log(`finish: ${message}`);
	const current = finished.project;
	// The film ends just after the marble that plays last rolls out of its Finish and leaves the frame
	const end = (await fittedSongEnd(current, simulateFinish)) ?? current.end;
	const source: TSource = { id: 'source-1', kind: 'midi', path: `audio/${SONG_NAME}`, name: SONG_NAME, offset: IMPORT_START };
	const removed = current.music.sources.map((item) => ({ type: 'removeSource' as const, sourceId: item.id }));
	const camera = { ...current.design.camera, distance: DEFAULT_CAMERA_DISTANCE, pitch: DEFAULT_CAMERA_PITCH };
	const song = apply(
		current,
		[...removed, { type: 'upsertSource', source }, { type: 'setTempo', tempo: { bpm: TEMPO, beatsPerBar: 4 } }, { type: 'setDesign', design: { camera } },
			{ type: 'setEnd', end }
		],
		current.revision
	);
	return namePiecesInOrder(song);
}

/** The film's look: the project's Christmas theme with the Christmas Decor set scattered. No hit can change. */
function dressed(fixture: TProject, simulateFinal: (current: TProject) => TSimulationResult): TProject {
	const themes = [...fixture.design.themes.filter((theme) => theme.id !== CHRISTMAS_THEME.id), CHRISTMAS_THEME];
	const inTheme: TProject = { ...fixture, design: { ...fixture.design, theme: CHRISTMAS_THEME.id, themes } };
	const themed = inTheme;
	const result = simulateFinal(themed);
	const track = filmCamera(themed, result).track;
	if (track == null) throw new Error('The dress step needs the film camera');
	const { commands, count } = scatterDecorCommands(themed, result, track, { items: CHRISTMAS_DECOR.map(builtInSource), density: DECOR_DENSITY, seed: DECOR_SEED });
	console.log(`dress: ${CHRISTMAS_THEME.name} with ${count} Decor items`);
	const scattered = apply(themed, commands, themed.revision);
	// The frame's dressing keeps its own IDs, which seed it, so a new dress step shows the same snow
	const frameItems: TDecor[] = [
		{ ...newDecor(builtInSource('decor:snowfall'), { x: 0, y: 0 }, []), id: 'decor-snowfall' }
	];
	const placed = scattered.design.decor.filter((item) => !frameItems.some((frameItem) => frameItem.id === item.id));
	return apply(scattered, setDecorList([...placed, ...frameItems]), scattered.revision);
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
