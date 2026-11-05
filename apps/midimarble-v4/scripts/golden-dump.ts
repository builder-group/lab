// Golden dump for the MidiMarble restructure: what a project does, in a form that doesn't depend on the schema. Compare
// two dumps with `golden-compare.ts`. Removed after the restructure; `.local/golden/README.md` says how it's used.
// Usage: tsx scripts/golden-dump.ts <out-dir> [--convert <module>] [--only <case,case>] [--skip-build]
//   --convert: a module whose default export turns the @5 JSON into the schema being tested, applied before parsing
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSceneDescription } from '../src/modules/scene/scene-builder';
import { buildTrack, localBuildDeps } from '../src/modules/building/build-track';
import { backingVoice } from '../src/modules/music/synthesize';
import { parseProject } from '../src/modules/project/project-file';
import { type TProject } from '../src/modules/project/schema';
import { createSimulator } from '../src/modules/simulation/simulate';
import type { TSimulationResult } from '../src/modules/simulation/types';

// Jingle Bells is `fixtures/jingle-bells.marble.json`; it's in the list of cases and is what Build Track runs on
const SCENE_FPS = 60;
// Long series are stored as one hash per this many seconds plus each block's first sample, so a compare can name the
// second a run first differs in, without gigabytes of samples
const BLOCK_SECONDS = 1;
const BUILD_CASE = 'jingle-bells';

// --- The only part that reads the project's shape. After schema @6 rewrite these five for @6 and leave the rest. -----

/** Marbles with the ID results and scene use, each with what sets its sound */
function marblesOf(project: TProject) {
	const lanes = new Map(project.music.lanes.map((lane) => [lane.id, lane]));
	return project.entities.flatMap((entity) => {
		const marble = entity.components.marble;
		const lane = marble == null ? undefined : lanes.get(marble.laneId);
		return lane == null ? [] : [{ id: entity.id, laneId: lane.id, sound: lane.instrument, hits: lane.hits }];
	});
}

/** Everything that changes what's heard, by marble and not by lane, since lanes go in @6 */
function audioInputs(project: TProject) {
	const backing = backingVoice(project);
	return {
		marbles: marblesOf(project).map(({ id, sound, hits }) => ({ id, sound, hits: sortedHits(hits) })),
		backing: backing == null ? null : { sound: backing.instrument, hits: sortedHits(backing.hits) },
		songs: project.music.sources.map(({ id, kind, path, name, offset }) => ({ id, kind, path, name, start: offset })),
		tempo: project.music.tempo ?? null,
		length: project.end
	};
}

/** The hits alone, as Build Track starts from them */
function withoutPieces(project: TProject): TProject {
	const { groups: _groups, ...rest } = project;
	return { ...rest, entities: project.entities.filter((entity) => entity.components.piece == null) };
}

/** IDs of pieces and groups, in project order: what a Build Track run made is named by position */
function madeIds(project: TProject): string[] {
	const pieces = project.entities.filter((entity) => entity.components.piece != null).map((entity) => entity.id);
	return [...pieces, ...(project.groups ?? []).map((group) => group.id)];
}

/** The pieces a Build Track run left in the project, in order, as stored */
function storedPieces(project: TProject): unknown[] {
	return project.entities.filter((entity) => entity.components.piece != null);
}

// --- Schema-neutral from here on --------------------------------------------------------------------------------------

function sortedHits<T extends { id: string; time: number }>(hits: T[]): T[] {
	return [...hits].sort((a, b) => a.time - b.time || compareText(a.id, b.id));
}

function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** JSON with sorted keys, one level per line, so two dumps are byte-comparable and diffable */
function stableJson(value: unknown): string {
	const sortKeys = (item: unknown): unknown => {
		if (Array.isArray(item)) return item.map(sortKeys);
		if (item != null && typeof item === 'object') {
			const source = item as Record<string, unknown>;
			return Object.fromEntries(
				Object.keys(source)
					.sort(compareText)
					.map((key) => [key, sortKeys(source[key])])
			);
		}
		return item;
	};
	return `${JSON.stringify(sortKeys(value), null, 1)}\n`;
}

function hashOf(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

/** A time series as one hash per block, with the block's first sample at full precision */
function blocks<T extends { time: number }>(samples: T[]): unknown {
	const grouped = new Map<number, T[]>();
	for (const sample of samples) {
		const index = Math.floor(sample.time / BLOCK_SECONDS);
		grouped.set(index, [...(grouped.get(index) ?? []), sample]);
	}
	return {
		count: samples.length,
		hash: hashOf(samples),
		blocks: [...grouped.entries()].map(([second, items]) => ({ second, count: items.length, hash: hashOf(items), first: items[0] }))
	};
}

function sectionsOf(project: TProject, result: TSimulationResult): Record<string, unknown> {
	const marbles = marblesOf(project);
	const marbleOfLane = new Map(marbles.map((marble) => [marble.laneId, marble.id]));
	const build = buildSceneDescription(project, result, { fps: SCENE_FPS });
	// Revision says how often a project was edited, not what it does, and may stop being saved in @6
	const { revision: _revision, ...scene } = build.description;
	const hits = result.hits
		.map((hit) => {
			const { laneId, ...rest } = hit;
			return { ...rest, marble: marbleOfLane.get(laneId) ?? `lane:${laneId}` };
		})
		.sort((a, b) => compareText(a.marble, b.marble) || a.targetTime - b.targetTime || compareText(a.hitId, b.hitId));
	const pieces = result.pieces
		.map(({ motion, ...rest }) => ({ ...rest, motion: motion == null ? null : blocks(motion) }))
		.sort((a, b) => compareText(a.entityId, b.entityId));
	return {
		hits: { duration: result.duration, onTime: hits.filter((hit) => hit.status === 'onTime').length, total: hits.length, hits },
		pieces,
		contacts: result.contacts,
		scene,
		motion: {
			marbles: result.marbles
				.map((track) => ({ id: track.entityId, radius: track.radius, samples: blocks(track.samples) }))
				.sort((a, b) => compareText(a.id, b.id)),
			files: build.motionFiles
				.map((file) => ({ path: file.path, bytes: file.bytes.length, sha256: createHash('sha256').update(file.bytes).digest('hex') }))
				.sort((a, b) => compareText(a.path, b.path)),
			pace: result.pace ?? null,
			descent: result.descent ?? null
		},
		audio: audioInputs(project)
	};
}

function writeSections(outDir: string, name: string, sections: Record<string, unknown>, rename: (text: string) => string = (text) => text): void {
	const dir = join(outDir, name);
	mkdirSync(dir, { recursive: true });
	for (const [section, value] of Object.entries(sections)) writeFileSync(join(dir, `${section}.json`), rename(stableJson(value)));
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const valueOf = (flag: string): string | undefined => {
		const index = args.indexOf(flag);
		return index < 0 ? undefined : args[index + 1];
	};
	const outDir = args[0];
	if (outDir == null || outDir.startsWith('--')) throw new Error('Usage: golden-dump <out-dir> [--convert <module>] [--only <case,case>] [--skip-build]');
	const root = new URL('..', import.meta.url).pathname;
	const convertPath = valueOf('--convert');
	const convert: (raw: unknown) => unknown =
		convertPath == null ? (raw) => raw : ((await import(pathToFileURL(resolve(convertPath)).href)) as { default: (raw: unknown) => unknown }).default;
	const only = valueOf('--only')?.split(',');
	const load = (path: string): TProject => {
		const [isOk, error, project] = parseProject(JSON.stringify(convert(JSON.parse(readFileSync(path, 'utf8')))));
		if (!isOk) throw new Error(`${path}: ${String(error)}`);
		return project;
	};

	const cases = new Map<string, string>();
	for (const file of readdirSync(join(root, 'fixtures')).sort(compareText)) {
		if (file.endsWith('.marble.json')) cases.set(file.replace('.marble.json', ''), join(root, 'fixtures', file));
	}

	for (const [name, path] of cases) {
		if (only != null && !only.includes(name)) continue;
		const startedAt = performance.now();
		const project = load(path);
		// A new simulator per project: nothing carries over between cases
		const simulator = await createSimulator();
		const result = simulator.simulate(project);
		simulator.dispose();
		writeSections(outDir, name, sectionsOf(project, result));
		console.log(`${name}: ${result.hits.filter((hit) => hit.status === 'onTime').length}/${result.hits.length} on time, ${Math.round(performance.now() - startedAt)} ms`);
	}

	if (args.includes('--skip-build') || (only != null && !only.includes('build-track'))) return;
	const startedAt = performance.now();
	const bare = withoutPieces(load(cases.get(BUILD_CASE) as string));
	const simulator = await createSimulator();
	const outcome = await buildTrack(bare, localBuildDeps(simulator));
	simulator.dispose();
	const made = madeIds(outcome.project);
	const names = new Map(made.map((id, index) => [id, `built-${String(index).padStart(4, '0')}`]));
	const pattern = made.length === 0 ? null : new RegExp(made.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
	const rename = (text: string): string => (pattern == null ? text : text.replace(pattern, (id) => names.get(id) ?? id));
	writeSections(
		outDir,
		'build-track',
		{
			...sectionsOf(outcome.project, outcome.result),
			outcome: {
				added: outcome.added,
				attempts: outcome.attempts,
				attention: outcome.attention,
				bowls: outcome.bowls,
				counts: outcome.counts,
				isStopped: outcome.isStopped,
				releaseShift: outcome.releaseShift,
				turned: outcome.turned
			},
			stored: { pieces: storedPieces(outcome.project), hash: hashOf(storedPieces(outcome.project).map((piece) => rename(JSON.stringify(piece)))) }
		},
		rename
	);
	console.log(`build-track: ${outcome.added} added, ${outcome.result.hits.filter((hit) => hit.status === 'onTime').length}/${outcome.result.hits.length} on time, ${Math.round(performance.now() - startedAt)} ms`);
}

await main();
