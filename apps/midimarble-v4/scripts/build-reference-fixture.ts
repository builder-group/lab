// Writes `fixtures/reference-20.marble.json`: a 20 s run shaped like the reference short. Two sections of
// zigzag hits between two columns, built the way a user would with the assists (one tilted platform, Mirror,
// then Continue, with Auto place where Continue stops), joined by a rail. Each section gives its two columns
// their own skin finish (`brass:<finish>` skin asset IDs), like the reference's skin sets per song.
// Usage: tsx scripts/build-reference-fixture.ts
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
import { createRailForGap } from '../src/modules/simulation/gap-pieces';
import { createLinkedPiece } from '../src/modules/simulation/placement';
import { createSimulator } from '../src/modules/simulation/simulate';

const LANE = 'lane-1';
const DEGREE = Math.PI / 180;
// The kit at twice the Marble Race Kit scale: at the same rhythm the marble then descends half as far per hit in
// piece lengths, which packs the columns like the reference
const SCALE = 1.5;
const MARBLE_RADIUS = 0.008 * SCALE;
const PLATFORM = { length: 0.06 * SCALE, thickness: 0.008 * SCALE, depth: 0.03 * SCALE };
const GAP = 0.3;
const SECTIONS = [
	{ start: 0.15, gap: GAP, count: Math.round(9.6 / GAP), finishes: ['gold', 'silver'] },
	{ start: 10.05, gap: GAP, count: Math.round(9.6 / GAP), finishes: ['copper', 'dark'] }
];

const simulator = await createSimulator();
const simulate = (project: TProject) => simulator.simulate(project);

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
	project = setFinishes(project, first, last, section.finishes);
	offset = last;
}
project = withoutOpenHits(project);
const finalResult = createSimulatorResult(project);
simulator.dispose();
// Assists accept a marble that comes to rest on stacked pieces; a section must keep travelling down the wall
if (finalResult.descent1 < 2 || finalResult.descent2 < 2) throw new Error('A section stopped descending');
const json = serializeProject(apply(project, [], 0));
const [isProjectOk, projectErr] = parseProject(json);
if (!isProjectOk) throw projectErr;
writeFileSync(new URL('../fixtures/reference-20.marble.json', import.meta.url), json);
console.log(JSON.stringify(finalResult));

function startZigzag(current: TProject, index: number, angle: number): TProject {
	// Try a few opening tilts and keep the one whose continuation descends furthest, so the section keeps
	// travelling down the wall instead of bouncing in place
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
	// The assists' default range first, then steeper angles; a hit no angle can serve stays open
	for (const range of [undefined, [-60 * DEGREE, 60 * DEGREE] as [number, number]]) {
		const [isPlacedOk, , placed] = autoPlace(current, simulate(current), LANE, hitId(index), {
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

function setFinishes(current: TProject, first: number, last: number, finishes: string[]): TProject {
	const pieces = current.entities.filter((entity) => {
		const id = entity.components.hitLink?.hitId;
		return entity.components.piece?.type === 'platform' && id != null && hitIndex(id) >= first && hitIndex(id) <= last;
	});
	return apply(
		current,
		pieces.map((entity) => ({
			type: 'upsertEntity',
			entity: {
				...entity,
				components: {
					...entity.components,
					// The zigzag alternates columns hit by hit
					skin: { assetId: `brass:${finishes[hitIndex(entity.components.hitLink?.hitId ?? '') % 2]}`, link: 'linked' }
				}
			}
		}))
	);
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
