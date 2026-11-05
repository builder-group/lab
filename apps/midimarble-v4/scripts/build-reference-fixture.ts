// Writes `fixtures/reference-20.marble.json`: a 20 s run shaped like the reference short. Two sections of
// zigzag hits between two columns, built the way a user would with the assists (one tilted platform, Mirror,
// then Continue, with Auto place where Continue stops), joined by a rail. Each section gives its two columns
// their own brass skin (`platform:<skin>` skin asset IDs) and a wall title at its start, like the reference's skin
// sets and song titles per song.
// Usage: tsx scripts/build-reference-fixture.ts [--dress]
//   --dress re-applies skins, titles, the Bowl, piece names and the film end to the existing fixture without
//   rebuilding its pieces
import { readFileSync, writeFileSync } from 'node:fs';
import {
	applyProjectCommands,
	DEFAULT_CAMERA_DISTANCE,
	DEFAULT_CAMERA_PITCH,
	parseProject,
	serializeProject,
	type TEntity,
	type TProject,
	type TProjectCommand
} from '../src/modules/project';
import { withBowls } from '../src/modules/compose/bowl-assist';
import { fittedSongEnd } from '../src/modules/camera/bowl-exit';
import { songEnd } from '../src/modules/music';
import { autoPlace, continueSuggestions, mirrorPiece } from '../src/modules/simulation/assists';
import { createBareRunProject } from '../src/modules/simulation/fixture-projects';
import { createRailForGap } from '../src/modules/simulation/gap-pieces';
import { namePiecesInOrder } from '../src/modules/simulation/piece-names';
import { createLinkedPiece } from '../src/modules/simulation/placement';
import { createSimulator } from '../src/modules/simulation/simulate';

const LANE = 'lane-1';
const DEGREE = Math.PI / 180;
// The kit at twice the Marble Race Kit scale: at the same rhythm the marble then descends half as far per hit in
// piece lengths, which packs the columns like the reference
const SCALE = 1.5;
const MARBLE_RADIUS = 0.008 * SCALE;
const PLATFORM = { length: 0.06 * SCALE, thickness: 0.008 * SCALE, depth: 0.06 * SCALE };
// At the default half gravity a 0.3 s zigzag hops about half a bar, so the bars would overlap
const GAP = 0.4;
// Skins per column and an original title per section. Titles are art-directed like a user would in Design: shifted
// toward where the camera looks when the section starts and turned so they read level in the rolled film
const SECTIONS = [
	{
		start: 0.15,
		gap: GAP,
		count: Math.round(9.6 / GAP),
		skins: ['gold', 'device'],
		title: { text: 'Brass Steps', dx: -0.19, dy: -0.1, angle: 50 * DEGREE }
	},
	{
		start: 10.05,
		gap: GAP,
		count: Math.round(9.6 / GAP),
		skins: ['key', 'knob'],
		title: { text: 'Night Keys', dx: 0.37, dy: -0.15, angle: 4 * DEGREE }
	}
];
// Letter height as a share of the frame height, and how long a section's caption stays
const CAPTION_SIZE = 0.045;
const CAPTION_SECONDS = 3;
const TITLE = { size: 0.04, color: '#ffffff', font: 'Bfont Regular', rise: 0.1 };
const CAMERA = { distance: DEFAULT_CAMERA_DISTANCE, pitch: DEFAULT_CAMERA_PITCH };
const FIXTURE_URL = new URL('../fixtures/reference-20.marble.json', import.meta.url);

const simulator = await createSimulator();
const simulate = (project: TProject) => simulator.simulate(project);

if (process.argv.includes('--dress')) {
	const [isFixtureOk, fixtureErr, fixture] = parseProject(readFileSync(FIXTURE_URL, 'utf8'));
	if (!isFixtureOk) throw fixtureErr;
	writeFileSync(FIXTURE_URL, serializeProject(namePiecesInOrder(apply(await finished(dress(fixture)), [], fixture.revision))));
	simulator.dispose();
	console.log('dressed');
	process.exit(0);
}

const hitTimes = SECTIONS.flatMap((section) =>
	Array.from({ length: section.count }, (_, i) => Math.round((section.start + section.gap * i) * 1000) / 1000)
);
let project = createBareRunProject({
	id: 'reference-20',
	title: 'Reference 20',
	end: 20,
	marbles: [{ x: 0, y: 0.6, releaseTime: 0, hitTimes }]
});
project.design.theme = 'brass';
for (const entity of project.entities) {
	if (entity.components.marble != null) entity.components.marble.radius = MARBLE_RADIUS;
}

let offset = 0;
for (const [sectionIndex, section] of SECTIONS.entries()) {
	const first = offset + 1;
	const last = offset + section.count;
	if (sectionIndex > 0) {
		// The rail carries the marble across the pause between the sections
		const [isRailOk, railErr, rail] = createRailForGap(project, simulate(project), LANE, hitId(first - 1), hitId(first), {
			simulate,
			id: `rail-${sectionIndex}`
		});
		if (!isRailOk) throw railErr;
		project = apply(project, rail.commands);
	}
	// A tilted platform and its mirror start the zigzag; Continue repeats it
	// A gentle opening tilt keeps the hop sideways short, so the two columns sit closer like the reference's
	project = startZigzag(project, first, sectionIndex === 0 ? -0.3 : 0.3);
	let placed = first + 1;
	while (placed < last) {
		const continued = continueSuggestions(project, simulate(project), LANE, {
			simulate,
			idFor: (id) => id.replace('hit', 'piece')
		});
		const commands = (continued?.commands ?? []).filter((command) => {
			const id = command.type === 'upsertEntity' ? command.entity.components.hitLink?.hitId : null;
			return id != null && hitIndex(id) <= last;
		});
		if (commands.length > 0) {
			project = apply(project, commands);
			placed += commands.length;
		} else {
			placed += 1;
			project = place(project, placed);
		}
	}
	offset = last;
}
project = await finished(dress(withoutOpenHits(project)));
const finalResult = createSimulatorResult(project);
simulator.dispose();
// Assists accept a marble that comes to rest on stacked pieces; a section must keep traveling down the wall
if (finalResult.descent1 < 2 || finalResult.descent2 < 2) throw new Error('A section stopped descending');
// Pieces are named in time order last, so the Layers list reads Platform 1, 2, 3 down the marble
const json = serializeProject(namePiecesInOrder(apply(project, [], 0)));
const [isProjectOk, projectErr] = parseProject(json);
if (!isProjectOk) throw projectErr;
writeFileSync(FIXTURE_URL, json);
console.log(JSON.stringify(finalResult));

function startZigzag(current: TProject, index: number, angle: number): TProject {
	// Try the tilt and its mirror and keep the one whose continuation descends furthest, so the section keeps
	// traveling down the wall instead of bouncing in place. Steeper tilts descend further but spread the columns
	let best: { project: TProject; descent: number } | null = null;
	for (const tilt of [angle, -angle]) {
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
		const first = simulate(started).pieces.find((piece) => piece.entityId === pieceId(index))?.position.y ?? 0;
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
	// Auto place tunes the piece already at the hit, so it is seeded with the kit's size and solves angle and
	// bounce for the piece that will play
	const seed = scaled(createLinkedPiece('platform', LANE, hitId(index), 0, { id: pieceId(index) }));
	const seeded = apply(current, [{ type: 'upsertEntity', entity: seed }]);
	// The assists' default range first, then steeper angles; a hit no angle can serve stays open
	for (const range of [undefined, [-60 * DEGREE, 60 * DEGREE] as [number, number]]) {
		const [isPlacedOk, , placed] = autoPlace(seeded, simulate(seeded), LANE, hitId(index), {
			simulate,
			id: pieceId(index),
			range
		});
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

/** The marble's Bowl after its last note (Add Bowl), with the film ending just after the marble leaves the frame */
async function finished(current: TProject): Promise<TProject> {
	const result = await withBowls(current, { simulate });
	for (const message of result.messages) console.log(`bowl: ${message}`);
	const end = await fittedSongEnd(result.project, simulate);
	return end == null ? result.project : { ...result.project, end };
}

/** Section skins on alternating columns, a wall title above each section's first piece and the camera framing */
function dress(current: TProject): TProject {
	const hitTime = new Map(current.music.lanes.flatMap((lane) => lane.hits.map((hit) => [hit.id, hit.time] as const)));
	const sectionOf = (time: number): number => SECTIONS.filter((section) => time >= section.start - 1e-6).length - 1;
	const commands: TProjectCommand[] = [];
	for (const entity of current.entities) {
		const hitId = entity.components.hitLink?.hitId;
		const time = hitId != null ? hitTime.get(hitId) : undefined;
		if (entity.components.piece?.type !== 'platform' || hitId == null || time == null) continue;
		const section = SECTIONS[sectionOf(time)];
		if (section == null) continue;
		// The zigzag alternates columns hit by hit
		const skin = { assetId: `platform:${section.skins[hitIndex(hitId) % 2]}` };
		commands.push({ type: 'upsertEntity', entity: { ...entity, components: { ...entity.components, skin } } });
	}
	const placed = simulate(current).pieces;
	for (const [index, section] of SECTIONS.entries()) {
		// The first two pieces of a section are its two columns; the title sits centered above them
		const firsts = placed
			.filter((piece) => {
				const hitId = current.entities.find((entity) => entity.id === piece.entityId)?.components.hitLink?.hitId;
				const time = hitId != null ? hitTime.get(hitId) : undefined;
				return piece.type === 'platform' && time != null && sectionOf(time) === index;
			})
			.slice(0, 2);
		if (firsts.length === 0) continue;
		const x = firsts.reduce((sum, piece) => sum + piece.position.x, 0) / firsts.length + section.title.dx;
		const y = Math.max(...firsts.map((piece) => piece.position.y)) + TITLE.rise + section.title.dy;
		commands.push({
			type: 'upsertEntity',
			entity: {
				id: `title-${index + 1}`,
				name: `Title ${index + 1}`,
				components: {
					transform: {
						position: { x: Math.round(x * 1e4) / 1e4, y: Math.round(y * 1e4) / 1e4 },
						angle: Math.round(section.title.angle * 1e4) / 1e4
					},
					// A caption in the frame, like the reference channels' section titles: the camera can never lose it
					wallText: {
						text: section.title.text,
						font: TITLE.font,
						size: CAPTION_SIZE,
						color: TITLE.color,
						style: 'caption' as const,
						in: Math.max(0, Math.round((section.start - 0.15) * 100) / 100),
						out: Math.round((section.start + CAPTION_SECONDS) * 100) / 100
					}
				}
			}
		});
	}
	// The default close, steep camera: the marble and the next pieces fill the frame and a column's rows stack
	commands.push({ type: 'setDesign', design: { camera: { ...current.design.camera, ...CAMERA } } });
	// The film ends while the marble that struck the last note is still in the held frame
	commands.push({ type: 'setEnd', end: songEnd(Math.max(...hitTime.values())) });
	return apply(current, commands);
}

function createSimulatorResult(current: TProject): {
	descent1: number;
	descent2: number;
	hits: number;
	onTime: number;
	pieces: number;
	end: number;
} {
	const result = simulate(current);
	const samples = result.marbles[0]?.samples ?? [];
	const yAt = (time: number): number => samples.find((sample) => sample.time >= time)?.position.y ?? 0;
	const second = SECTIONS[1]?.start ?? 0;
	return {
		descent1: Math.round((yAt(0.5) - yAt(second - 1.5)) * 100) / 100,
		descent2: Math.round((yAt(second + 0.5) - yAt(19.5)) * 100) / 100,
		hits: result.hits.length,
		onTime: result.hits.filter((hit) => hit.status === 'onTime').length,
		pieces: result.pieces.length,
		end: current.end
	};
}

function hitId(index: number): string {
	return `hit-1-${index}`;
}

function pieceId(index: number): string {
	return `piece-1-${index}`;
}

function hitIndex(id: string): number {
	return Number(id.split('-').at(-1));
}

function apply(current: TProject, commands: TProjectCommand[], revision?: number): TProject {
	const [isAppliedOk, appliedErr, applied] = applyProjectCommands(current, commands);
	if (!isAppliedOk) throw appliedErr;
	if (revision != null) applied.revision = revision;
	return applied;
}
