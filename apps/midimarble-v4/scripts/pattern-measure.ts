// How often Patterns fit on real songs, and why they don't: each Pattern on many hit ranges of different lengths, on each
// fixture with no pieces (unbuilt) and after Build Track (built). A success means the app applied it, and the result is
// measured as well: its hits play on time, no hit that was on time went off time, and there are no new Problems.
// Usage: tsx scripts/pattern-measure.ts <label> [--only <fixture,fixture>] [--state unbuilt|built] [--quick]
// Writes .local/pattern-measure/<label>.json, or <label>-<fixture>-<state>.json with --only, and prints the table.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTrack, localBuildDeps } from '../src/modules/building/build-track';
import { NO_BLENDER_OBJECTS, preflightExport, problemSummary } from '../src/modules/building/export-preflight';
import { checkGroupChange } from '../src/modules/building/patterns/check-group';
import { PATTERN_DEFAULTS, runGroupChange, type TGroupChange } from '../src/modules/building/patterns/run-group';
import type { TPatternKind } from '../src/modules/building/patterns/fit-pattern';
import { applyProjectCommands } from '../src/modules/project/commands';
import { parseProject, serializeProject } from '../src/modules/project/project-file';
import type { TProject } from '../src/modules/project/schema';
import { createSimulator } from '../src/modules/simulation/simulate';
import type { TSimulator } from '../src/modules/simulation/simulate';

const FIXTURES = ['jingle-bells', 'reference-20', 'zigzag', 'staircase', 'tap-along', 'long-gap', 'windmill', 'two-marbles'];
const LENGTHS = [2, 3, 4, 6, 8, 12, 16];
/** How many places along a marble's hits each length is tried at */
const STARTS = 3;
/** A silence this long or longer is a range a Long Rail is tried on */
const SILENCE = 0.45;
const MAX_SILENCES = 6;
const OUT = '.local/pattern-measure';

type TState = 'unbuilt' | 'built';

interface TAttempt {
	fixture: string;
	state: TState;
	marble: string;
	kind: TPatternKind;
	hits: number;
	from: number;
	to: number;
	outcome: 'applied' | 'refused' | 'worse';
	reason: string | null;
	words: string | null;
	ms: number;
}

function argument(name: string): string | null {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function loadFixture(name: string): TProject {
	const [isOk, err, project] = parseProject(readFileSync(new URL(`../fixtures/${name}.marble.json`, import.meta.url), 'utf8'));
	if (!isOk) throw err;
	return project;
}

function bare(project: TProject): TProject {
	return { ...project, track: { pieces: [], groups: [] } };
}

/** Build Track's result on a fixture, kept in `.local`: a whole song takes a minute or two */
async function built(name: string, sim: TSimulator): Promise<TProject> {
	const path = join(OUT, 'built', `${name}.json`);
	if (existsSync(path)) {
		const [isOk, err, project] = parseProject(readFileSync(path, 'utf8'));
		if (!isOk) throw err;
		return project;
	}
	const outcome = await buildTrack(bare(loadFixture(name)), localBuildDeps(sim));
	mkdirSync(join(OUT, 'built'), { recursive: true });
	writeFileSync(path, serializeProject(outcome.project));
	return outcome.project;
}

/** Real ranges: each length at the start, the middle and the end of a marble's hits, and its longest silences */
function rangesOf(project: TProject, isQuick: boolean): Omit<TGroupChange, 'width' | 'bounce'>[] {
	const ranges: Omit<TGroupChange, 'width' | 'bounce'>[] = [];
	for (const marble of project.marbles) {
		const seen = new Set<string>();
		for (const length of isQuick ? [3, 8] : LENGTHS) {
			if (length > marble.hits.length) continue;
			const count = isQuick ? 2 : STARTS;
			for (let index = 0; index < count; index++) {
				const first = Math.round((index * (marble.hits.length - length)) / Math.max(1, count - 1));
				const key = `${first}/${length}`;
				if (seen.has(key)) continue;
				seen.add(key);
				const from = marble.hits[first]?.time ?? 0;
				const to = marble.hits[first + length - 1]?.time ?? 0;
				for (const kind of ['zigzag', 'staircase'] as const) ranges.push({ marbleId: marble.id, from, to, kind });
			}
		}
		const silences = marble.hits.slice(1).flatMap((hit, index) => {
			const before = marble.hits[index];
			return before != null && hit.time - before.time >= SILENCE ? [{ from: before.time + 0.02, to: hit.time - 0.02 }] : [];
		});
		const longest = silences.sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, isQuick ? 2 : MAX_SILENCES);
		const firstHit = marble.hits[0];
		if (firstHit != null && firstHit.time - marble.start.time >= SILENCE) longest.push({ from: marble.start.time, to: firstHit.time - 0.02 });
		for (const silence of longest) ranges.push({ marbleId: marble.id, ...silence, kind: 'longRail' });
	}
	return ranges;
}

/** The refusal's reason in a few words, so the table adds them up */
function reasonOf(words: string): string {
	const rules: [RegExp, string][] = [
		[/would break what follows/, `breaks later: ${words.match(/follows: (.*?)\. Nothing/)?.[1]?.replace(/[A-Z][a-z]+ \d+/g, '#').replace(/\d+:\d+/g, '#') ?? ''}`],
		[/can't be reached on time|misses this note/, 'a note can’t be reached'],
		[/settles on this bar/, 'marble settles on a bar'],
		[/second time|strikes a bar twice/, 'strikes a bar twice'],
		[/another bar/, 'strikes another bar'],
		[/rolls along/, 'rolls along a bar'],
		[/touch/, 'pieces touch'],
		[/falls [\d.]+ m/, 'long fall inside the range'],
		[/has not reached/, 'marble hasn’t reached it'],
		[/No rail holds/, `no rail holds: ${words.match(/: (.*?)\./)?.[1] ?? 'unknown'}`],
		[/lets go/, 'rail lets go off time'],
		[/plays notes|fills silence|ends at a note/, 'wrong range for the Pattern']
	];
	return rules.find(([rule]) => rule.test(words))?.[1] ?? words.slice(0, 60);
}

function standing(project: TProject, sim: TSimulator) {
	const result = sim.simulate(project);
	const summary = problemSummary(preflightExport(project, { ...result, revision: project.revision }, NO_BLENDER_OBJECTS), 'track');
	const onTime = new Set(result.hits.filter((hit) => hit.status === 'onTime' || hit.status === 'drifting').map((hit) => hit.hitId));
	return { onTime, problems: summary.problems.map((issue) => issue.title) };
}

function attempt(project: TProject, range: Omit<TGroupChange, 'width' | 'bounce'>, fixture: string, state: TState, sim: TSimulator, before: ReturnType<typeof standing>): TAttempt {
	const marble = project.marbles.find((item) => item.id === range.marbleId);
	const hitIds = (marble?.hits ?? []).filter((hit) => hit.time >= range.from - 1e-6 && hit.time <= range.to + 1e-6).map((hit) => hit.id);
	const row = { fixture, state, marble: marble?.name ?? '', kind: range.kind, hits: hitIds.length, from: range.from, to: range.to };
	const startedAt = performance.now();
	const change: TGroupChange = { ...range, ...PATTERN_DEFAULTS[range.kind] };
	const outcome = runGroupChange(project, change, { sim });
	const check = outcome.commands.length > 0 ? checkGroupChange(project, outcome, range.marbleId, sim) : null;
	const ms = Math.round(performance.now() - startedAt);
	const words = check?.refusal?.words ?? (outcome.commands.length > 0 ? null : (outcome.problems[0]?.words ?? 'nothing made'));
	if (words != null) return { ...row, outcome: 'refused', reason: reasonOf(words), words, ms };
	const [isOk, err, after] = applyProjectCommands(project, check?.commands ?? []);
	if (!isOk) return { ...row, outcome: 'worse', reason: `the edit doesn’t apply: ${err.message.slice(0, 40)}`, words: err.message, ms };
	const now = standing(after, sim);
	const lost = [...before.onTime].filter((hitId) => !now.onTime.has(hitId));
	const offOwn = hitIds.filter((hitId) => !now.onTime.has(hitId));
	const fresh = now.problems.filter((title) => !before.problems.includes(title));
	if (lost.length > 0) return { ...row, outcome: 'worse', reason: 'an on-time hit went off time', words: `${lost.length} hits lost`, ms };
	if (offOwn.length > 0) return { ...row, outcome: 'worse', reason: 'its own hits aren’t on time', words: `${offOwn.length} own hits off`, ms };
	if (now.problems.length > before.problems.length) return { ...row, outcome: 'worse', reason: 'new Problems', words: fresh.slice(0, 3).join('; '), ms };
	return { ...row, outcome: 'applied', reason: null, words: null, ms };
}

function table(attempts: readonly TAttempt[]): string {
	const lines: string[] = [];
	for (const state of ['unbuilt', 'built'] as const) {
		for (const kind of ['zigzag', 'staircase', 'longRail'] as const) {
			const rows = attempts.filter((row) => row.state === state && row.kind === kind);
			if (!rows.length) continue;
			const applied = rows.filter((row) => row.outcome === 'applied').length;
			const worse = rows.filter((row) => row.outcome === 'worse').length;
			const median = [...rows].sort((a, b) => a.ms - b.ms)[Math.floor(rows.length / 2)]?.ms ?? 0;
			lines.push(`${state.padEnd(8)}${kind.padEnd(10)}${String(applied).padStart(4)}/${String(rows.length).padEnd(4)} ${String(Math.round((100 * applied) / rows.length)).padStart(3)} %   worse ${worse}   median ${median} ms`);
			const reasons = new Map<string, number>();
			for (const row of rows) if (row.reason != null) reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1);
			for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8)) lines.push(`    ${String(count).padStart(4)}  ${reason}`);
		}
	}
	return lines.join('\n');
}

async function main(): Promise<void> {
	const label = process.argv[2] ?? 'now';
	const only = argument('only')?.split(',') ?? null;
	const states: TState[] = argument('state') != null ? [argument('state') as TState] : ['unbuilt', 'built'];
	const isQuick = process.argv.includes('--quick');
	mkdirSync(OUT, { recursive: true });
	const sim = await createSimulator();
	const attempts: TAttempt[] = [];
	for (const fixture of FIXTURES.filter((name) => only == null || only.includes(name))) {
		for (const state of states) {
			const project = state === 'built' ? await built(fixture, sim) : bare(loadFixture(fixture));
			const before = standing(project, sim);
			const ranges = rangesOf(project, isQuick);
			console.error(`${fixture} ${state}: ${ranges.length} ranges, ${before.onTime.size} on time, ${before.problems.length} problems`);
			for (const range of ranges) {
				const row = attempt(project, range, fixture, state, sim, before);
				attempts.push(row);
				console.error(`  ${row.kind} ${row.hits} hits at ${row.from.toFixed(2)}: ${row.outcome}${row.reason != null ? ` (${row.reason})` : ''} ${row.ms} ms`);
			}
		}
	}
	const name = only != null ? `${label}-${only.join('+')}${argument('state') != null ? `-${argument('state')}` : ''}` : label;
	writeFileSync(join(OUT, `${name}.json`), JSON.stringify(attempts, null, 1));
	console.log(table(attempts));
	sim.dispose();
}

void main();
