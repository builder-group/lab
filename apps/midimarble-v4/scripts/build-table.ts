// The comparison table for Build Entire Track: notes on time, Problems, time, camera, and how rests and repeats come
// out, per song, Gravity and marble count. Run it on two commits and compare the rows; nothing here chooses for the app.
// The songs are Jingle Bells and reference-20 from `fixtures/` and Ode to Joy (`songs.ts`), tuned on nothing; no other
// song has two marbles.
// Usage: tsx scripts/build-table.ts <out.json> [songs, comma] [gravities, comma] [marbles, comma: 1,2] [save-dir]
// One marble keeps the first and hands the others' notes to Backing; two runs the fixture as it is, where it has two.
// With a save folder each built project is written there, for a film of it (`export-blender-fixture.ts`).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { assignNotesCommands, buildTrack, checkRun, hitOwners, localBuildDeps, NO_BLENDER_OBJECTS, problemSummary } from '../src/modules/building';
import { filmCamera } from '../src/modules/camera';
import { applyProjectCommands, BACKING_ID, tieOf, type TProject, type TProjectCommand } from '../src/modules/project';
import { parseProject, serializeProject } from '../src/modules/project/project-file';
import { createSimulator, type TSimulationResult } from '../src/modules/simulation';
import { repeatedStretches, STRETCH } from '../src/modules/building/repeats';
import { odeToJoy } from './songs';

const [out = '', songsText = 'jingle-bells,reference-20,ode-to-joy',gravitiesText = '0.25,0.3,0.35,0.5', marblesText = '1,2', saveDir = ''] = process.argv.slice(2);
const DEGREE = Math.PI / 180;

function applied(project: TProject, commands: TProjectCommand[]): TProject {
	if (!commands.length) return project;
	const [isOk, error, next] = applyProjectCommands(project, commands);
	if (!isOk) throw error;
	return next;
}

/** A fixture, or Ode to Joy (`songs.ts`), which has one marble */
function song(name: string): TProject {
	if (name === 'ode-to-joy') return odeToJoy();
	const [isOk, error, parsed] = parseProject(readFileSync(`fixtures/${name}.marble.json`, 'utf8'));
	if (!isOk) throw error;
	return parsed;
}

function bare(name: string, gravity: number, marbles: number): TProject | null {
	const parsed = song(name);
	if (parsed.marbles.length < marbles) return null;
	let project: TProject = { ...parsed, gravity, track: { ...parsed.track, pieces: [], groups: [] } };
	for (const marble of project.marbles.slice(marbles)) {
		project = applied(project, assignNotesCommands(project, null, marble.hits.map((hit) => hit.id), BACKING_ID));
		project = applied(project, [{ type: 'removeMarble', marbleId: marble.id }]);
	}
	return { ...project, marbles: project.marbles.map(({ handOvers: _handOvers, waitsFrom: _waitsFrom, ...marble }) => marble) };
}

/** Notes, Problems and the camera's median distance up to the last note played */
function standing(project: TProject, result: TSimulationResult): Record<string, unknown> {
	const played = result.hits.filter((hit) => hit.status === 'onTime' || hit.status === 'drifting');
	const last = Math.max(0, ...played.map((hit) => hit.targetTime));
	const distances = Array.from(filmCamera(project, result).track?.distance ?? []);
	const built = distances.slice(0, Math.max(1, Math.round((last / Math.max(1e-9, result.duration)) * distances.length))).sort((a, b) => a - b);
	const problems = problemSummary(checkRun(project, result, NO_BLENDER_OBJECTS)).problems;
	return { notes: `${played.length}/${result.hits.length}`, problems: problems.length, titles: problems.slice(0, 3).map((issue) => issue.title), camera: Number((built[Math.floor(built.length / 2)] ?? 0).toFixed(3)) };
}

/** What fills each rest: a Switchback or Chain is a hook cluster, a path rail one stroke */
function rests(project: TProject): Record<string, number> {
	const counts: Record<string, number> = { stroke: 0, hooks: 0, legs: 0, tunnel: 0 };
	for (const piece of project.track.pieces) {
		const tie = tieOf(piece);
		if (tie == null || tie.kind === 'plays' || (piece.type !== 'rail' && piece.type !== 'tunnel')) continue;
		if (piece.type === 'tunnel') counts['tunnel'] = (counts['tunnel'] ?? 0) + 1;
		else if (piece.layout === 'switchback' || piece.layout === 'chain') {
			counts['hooks'] = (counts['hooks'] ?? 0) + 1;
			counts['legs'] = (counts['legs'] ?? 0) + (piece.params['turns'] ?? 1);
		} else counts['stroke'] = (counts['stroke'] ?? 0) + 1;
	}
	return counts;
}

/**
 * How alike a repeated stretch comes out (`repeatedStretches`), each against its first time: tilts within 3°, and how
 * far each dot lies from where the first time's did, both measured from the stretch's first note, in cm
 */
function repeats(project: TProject, result: TSimulationResult): Record<string, unknown> {
	let pairs = 0;
	const tilts: number[] = [];
	const offsets: number[] = [];
	for (const marble of project.marbles) {
		const { hits } = marble;
		const owners = hitOwners(project, marble.id);
		for (const { first: earlier, again: start } of repeatedStretches(project, marble.id)) {
			pairs++;
			const dotOf = (index: number) => result.hits.find((hit) => hit.marbleId === marble.id && hit.hitId === hits[index]?.id)?.dot ?? null;
			const [a0, b0] = [dotOf(earlier), dotOf(start)];
			for (let index = 0; index < STRETCH; index++) {
				const [a, b] = [owners.get(hits[earlier + index]?.id ?? ''), owners.get(hits[start + index]?.id ?? '')];
				if (a?.type === 'platform' && b?.type === 'platform') {
					const turn = Math.abs(((a.angle - b.angle + Math.PI) % (2 * Math.PI)) - Math.PI);
					tilts.push(turn / DEGREE);
				}
				const [da, db] = [dotOf(earlier + index), dotOf(start + index)];
				if (index > 0 && a0 != null && b0 != null && da != null && db != null) offsets.push(Math.hypot(da.x - a0.x - (db.x - b0.x), da.y - a0.y - (db.y - b0.y)) * 100);
			}
		}
	}
	const median = (values: number[]): number | null => (values.length ? Number(([...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] ?? 0).toFixed(1)) : null);
	return { pairs, within3: tilts.length ? `${Math.round((tilts.filter((value) => value <= 3).length / tilts.length) * 100)}%` : null, apartCm: median(offsets) };
}

const rows: unknown[] = [];
for (const song of songsText.split(',')) {
	for (const marbles of marblesText.split(',').map(Number)) {
		for (const gravity of gravitiesText.split(',').map(Number)) {
			const project = bare(song, gravity, marbles);
			if (project == null) continue;
			const sim = await createSimulator();
			const started = performance.now();
			const outcome = await buildTrack(project, localBuildDeps(sim));
			const line = { song, marbles, gravity, ...standing(outcome.project, outcome.result), seconds: Number(((performance.now() - started) / 1000).toFixed(1)), rests: rests(outcome.project), repeats: repeats(outcome.project, outcome.result), counts: Object.fromEntries(Object.entries(outcome.counts).filter(([, count]) => count > 0)) };
			sim.dispose();
			if (saveDir !== '') {
				mkdirSync(saveDir, { recursive: true });
				writeFileSync(`${saveDir}/${song}-${marbles}-${gravity}.marble.json`, serializeProject(outcome.project));
			}
			rows.push(line);
			console.log(JSON.stringify(line));
			if (out !== '') writeFileSync(out, JSON.stringify(rows, null, '\t'));
		}
	}
}
