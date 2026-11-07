// One marble, the other notes as Backing: how far plain placing gets through `propose`, what a rest offers, what placing a
// Pattern first gets against it, and Build Track as the yardstick. No going back in the first two. Nothing here chooses for the app.
// Usage: tsx scripts/one-marble-measure.ts <out.json> [songs, comma] [gravities, comma] [modes, comma: plain,pattern,build]
import { readFileSync, writeFileSync } from 'node:fs';
import { assignNotesCommands, buildTrack, checkRun, hitOwners, hitReach, localBuildDeps, localProposeDeps, NO_BLENDER_OBJECTS, nextStepOf, openLongGaps, problemSummary, propose, type TProposal, type TProposeDeps } from '../src/modules/building';
import { withStartRails } from '../src/modules/building/start-rail';
import { filmCamera } from '../src/modules/camera';
import { applyProjectCommands, BACKING_ID, type TProject, type TProjectCommand } from '../src/modules/project';
import { parseProject } from '../src/modules/project/project-file';
import { createSimulator, type TSimulationResult, type TSimulator } from '../src/modules/simulation';
import { odeToJoy } from './songs';

const [out = '', songsText = 'jingle-bells,reference-20,ode-to-joy', gravitiesText = '0.25,0.3,0.35,0.5', modesText = 'plain,pattern,build'] = process.argv.slice(2);
/** Seconds one run may take, so a run that wanders ends with what it has */
const RUN_LIMIT = 300;
const PATTERN_NOTES = [8, 4];

function applied(project: TProject, commands: TProjectCommand[]): TProject {
	if (!commands.length) return project;
	const [isOk, error, next] = applyProjectCommands(project, commands);
	if (!isOk) throw error;
	return next;
}

function oneMarble(song: string, gravity: number): TProject {
	let project: TProject;
	if (song === 'ode-to-joy') project = odeToJoy();
	else {
		const [isOk, error, parsed] = parseProject(readFileSync(`fixtures/${song}.marble.json`, 'utf8'));
		if (!isOk) throw error;
		project = parsed;
	}
	project = { ...project, gravity, track: { ...project.track, pieces: [], groups: [] } };
	for (const marble of project.marbles.slice(1)) {
		project = applied(project, assignNotesCommands(project, null, marble.hits.map((hit) => hit.id), BACKING_ID));
		project = applied(project, [{ type: 'removeMarble', marbleId: marble.id }]);
	}
	return { ...project, marbles: project.marbles.map(({ handOvers: _handOvers, waitsFrom: _waitsFrom, ...marble }) => marble) };
}

function stats(values: readonly number[]): { p50: number; p90: number; max: number; n: number } {
	const sorted = [...values].sort((a, b) => a - b);
	const at = (share: number): number => Number((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0).toFixed(1));
	return { p50: at(0.5), p90: at(0.9), max: Number((sorted.at(-1) ?? 0).toFixed(1)), n: sorted.length };
}

function isPlaying(status: string): boolean {
	return status === 'onTime' || status === 'drifting';
}

/** Notes, Problems and the camera's median distance up to the last note played: past it the marble falls freely */
function standing(project: TProject, result: TSimulationResult): Record<string, unknown> {
	const played = result.hits.filter((hit) => isPlaying(hit.status));
	const last = Math.max(0, ...played.map((hit) => hit.targetTime));
	const distances = Array.from(filmCamera(project, result).track?.distance ?? []);
	const built = distances.slice(0, Math.max(1, Math.round((last / Math.max(1e-9, result.duration)) * distances.length))).sort((a, b) => a - b);
	const problems = problemSummary(checkRun(project, result, NO_BLENDER_OBJECTS)).problems;
	return { notes: played.length, of: result.hits.length, lastNoteAt: Number(last.toFixed(2)), problems: problems.length, titles: problems.slice(0, 3).map((issue) => issue.title), camera: Number((built[Math.floor(built.length / 2)] ?? 0).toFixed(3)), pieces: project.track.pieces.length };
}

interface TWalkOptions {
	/** Offer each run of notes to a Pattern before plain pieces */
	isPatternFirst: boolean;
}

interface TRest {
	at: number;
	seconds: number;
	longRail: string;
	switchback: string;
	rail: string;
	took: string;
}

const statusOf = (proposal: TProposal): string => (proposal.status === 'fits' ? 'fits' : `${proposal.status}: ${(proposal.words ?? '').slice(0, 90)}`);

/** The kind of every Next press until one can't go on: a rest is asked of all its kinds, a note of a platform, and nothing goes back */
async function walk(start: TProject, deps: TProposeDeps, sim: TSimulator, options: TWalkOptions): Promise<Record<string, unknown>> {
	const marbleId = start.marbles[0]?.id ?? '';
	const hits = start.marbles[0]?.hits ?? [];
	let project = start;
	let result = sim.simulate(project);
	const times: Record<string, number[]> = { platform: [], longRail: [], switchback: [], rail: [], zigzag: [], staircase: [] };
	const made: Record<string, number> = { platform: 0, longRail: 0, switchback: 0, rail: 0, zigzag: 0, staircase: 0, fall: 0 };
	const rests: TRest[] = [];
	let faulted = 0;
	let refusedPatterns = 0;
	let stop: string | null = null;
	const started = performance.now();
	const asked = async (kind: string, hitIds: string[], isAnyDot = false): Promise<TProposal> => {
		const t0 = performance.now();
		const proposal = await propose(project, { marbleId, hitIds, kind }, deps, { result, isAnyDot });
		(times[kind] ??= []).push(performance.now() - t0);
		return proposal;
	};
	const land = (proposal: TProposal, kind: string, notes = 1): void => {
		project = applied(project, proposal.commands);
		result = sim.simulate(project);
		made[kind] = (made[kind] ?? 0) + notes;
		if (proposal.status === 'problems') faulted++;
	};
	for (let press = 0; press < hits.length * 2 + 8 && stop == null; press++) {
		if ((performance.now() - started) / 1000 > RUN_LIMIT) {
			stop = `the ${RUN_LIMIT} s limit`;
			break;
		}
		const step = nextStepOf(project, result, []);
		if (step.kind === 'done') break;
		if (step.kind === 'unreachable') {
			stop = `Hit ${hits.findIndex((hit) => hit.id === step.hit.hitId) + 1} at ${step.hit.targetTime.toFixed(2)} s: ${hitReach(project, result, step.hit).kind}`;
			break;
		}
		if (step.kind === 'gap') {
			const { gap } = step;
			const longRail = await asked('longRail', [gap.toHitId]);
			const switchback = await asked('switchback', [gap.toHitId]);
			const rail = await asked('rail', [gap.toHitId]);
			const chosen = [{ kind: 'longRail', proposal: longRail }, { kind: 'switchback', proposal: switchback }, { kind: 'rail', proposal: rail }].find((item) => item.proposal.status === 'fits');
			rests.push({ at: Number(gap.from.toFixed(2)), seconds: Number((gap.to - gap.from).toFixed(2)), longRail: statusOf(longRail), switchback: statusOf(switchback), rail: statusOf(rail), took: chosen?.kind ?? 'nothing' });
			if (chosen != null) {
				land(chosen.proposal, chosen.kind);
				continue;
			}
			// A rest with no fit: the plain piece at the note after it, with its reason
			const fall = await asked('platform', [gap.toHitId], true);
			if (!fall.commands.length) {
				stop = `rest to Hit ${hits.findIndex((hit) => hit.id === gap.toHitId) + 1} at ${gap.to.toFixed(2)} s: ${fall.words ?? 'nothing fits'}`;
				break;
			}
			land(fall, 'fall');
			continue;
		}
		const index = hits.findIndex((hit) => hit.id === step.hit.hitId);
		if (options.isPatternFirst && index > 0) {
			// The notes up to the one that launches into the next rest, which stays plain
			const gaps = openLongGaps(project, marbleId);
			let last = index;
			const isOwned = hitOwners(project, marbleId);
			while (hits[last + 1] != null && !isOwned.has(hits[last + 1]?.id ?? '') && !gaps.some((gap) => gap.fromHitId === hits[last]?.id) && (hits[last + 1]?.time ?? 0) - (hits[last]?.time ?? 0) <= 0.68) last++;
			let isPlaced = false;
			for (const length of PATTERN_NOTES) {
				if (last - index < length) continue;
				const ids = hits.slice(index, index + length).map((hit) => hit.id);
				const zigzag = await asked('zigzag', ids);
				if (zigzag.status === 'fits') {
					land(zigzag, 'zigzag', length);
					isPlaced = true;
					break;
				}
				refusedPatterns++;
			}
			if (isPlaced) continue;
		}
		const piece = await asked('platform', [step.hit.hitId]);
		if (!piece.commands.length) {
			stop = `Hit ${index + 1} at ${step.hit.targetTime.toFixed(2)} s: ${piece.words ?? 'nothing fits'}`;
			break;
		}
		land(piece, 'platform');
		const placedHit = result.hits.find((hit) => hit.hitId === step.hit.hitId);
		if (placedHit == null || !isPlaying(placedHit.status)) stop = `Hit ${index + 1} at ${step.hit.targetTime.toFixed(2)} s: placed, and it doesn't play (${placedHit?.reason ?? placedHit?.status ?? 'gone'})`;
	}
	return { ...standing(project, result), stop, made, faulted, refusedPatterns, rests, msPerPropose: Object.fromEntries(Object.entries(times).filter(([, values]) => values.length > 0).map(([kind, values]) => [kind, stats(values)])), seconds: Number(((performance.now() - started) / 1000).toFixed(1)) };
}

const rows: unknown[] = [];
for (const song of songsText.split(',')) {
	for (const gravity of gravitiesText.split(',').map(Number)) {
		for (const mode of modesText.split(',')) {
			const sim = await createSimulator();
			let sims = 0;
			const counting: TSimulator = { ...sim, simulate: (...args) => { sims++; return sim.simulate(...args); } };
			const bare = oneMarble(song, gravity);
			const marbleId = bare.marbles[0]?.id ?? '';
			let row: Record<string, unknown>;
			if (mode === 'build') {
				const started = performance.now();
				const outcome = await buildTrack(bare, localBuildDeps(counting));
				row = { ...standing(outcome.project, outcome.result), attempts: outcome.attempts, counts: Object.fromEntries(Object.entries(outcome.counts).filter(([, count]) => count > 0)), seconds: Number(((performance.now() - started) / 1000).toFixed(1)) };
			} else {
				const start = withStartRails(bare, new Set([marbleId]));
				row = await walk(start, localProposeDeps(counting), counting, { isPatternFirst: mode === 'pattern' });
			}
			const line = { song, gravity, mode, sims, ...row };
			rows.push(line);
			console.log(JSON.stringify(line));
			if (out !== '') writeFileSync(out, JSON.stringify(rows, null, '\t'));
			sim.dispose();
		}
	}
}

