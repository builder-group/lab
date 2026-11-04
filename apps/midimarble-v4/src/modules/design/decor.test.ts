import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectToFrame, type TCameraTrack } from '@/modules/camera';
import { buildAgentBrief } from '@/modules/agents/agent-brief';
import { planAgentRuns } from '@/modules/agents/agent-chat';
import { applyProjectCommands, parseProject, serializeProject, type TDecor, type TProject, type TProjectCommand } from '@/modules/project';
import { buildSceneDescription } from '@/modules/blender/scene-builder';
import { createSimulator, type TSimulator } from '@/modules/simulation/simulate';
import type { TSimulationResult } from '@/modules/simulation/types';
import { buildOutline, DECOR_KEY } from '@/modules/studio/outline';
import { inspectorTarget } from '@/modules/studio/inspector-target';
import { toDecorKey, toMadeInBlenderKey } from '@/modules/studio/selection';
import {
	$blenderObjects,
	addDecorCommands,
	assetDecorSource,
	builtInSource,
	decorBox,
	decorOverlaps,
	decorSourceCommands,
	deleteDecorCommands,
	duplicateDecorCommands,
	madeInBlenderCommands,
	moveDecorClear,
	MOVE_CLEAR_MARGIN,
	overlapLabel,
	updateDecorCommands
} from './decor';
import { DECOR_ITEMS, decorExtent, isFrameEffect } from './decor-catalog';
import { effectDefaults, flakeAt, garlandScrollAt, garlandSprigs, GARLAND_PERIOD, snowFlakes } from './decor-effects';
import { buildObstacleField, distanceToBox, type TWallBox } from './decor-clearance';
import { SCATTER_MARGIN, scatterDecorCommands, scatterPlacements, seedOf } from './decor-scatter';
import { decorTips, preflightExport } from './export-preflight';
import { filmCamera } from './film-camera';
import { pieceOutline } from '@/modules/compose/scene';

function loadFixture(name: string): TProject {
	const [isOk, err, project] = parseProject(readFileSync(new URL(`../../../fixtures/${name}.marble.json`, import.meta.url), 'utf8'));
	if (!isOk) throw err;
	// These tests place their own decor; Jingle Bells ships dressed
	const { decor: _decor, ...design } = project.design;
	return { ...project, design };
}

function apply(project: TProject, commands: TProjectCommand[]): TProject {
	const [isOk, err, next] = applyProjectCommands(project, commands);
	if (!isOk) throw err;
	return next;
}

/** Distance from a box to a marble's path as a polyline, its radius taken off: the exact check, not the grid the code uses */
function clearanceToRuns(result: TSimulationResult, box: TWallBox): number {
	let best = Infinity;
	for (const marble of result.marbles) {
		let last = marble.samples[0];
		for (const sample of marble.samples) {
			if (sample.time > result.duration) break;
			if (last != null) {
				const [ax, ay, bx, by] = [last.position.x, last.position.y, sample.position.x, sample.position.y];
				const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.001));
				for (let step = 0; step <= steps; step++) {
					best = Math.min(best, distanceToBox(box, ax + ((bx - ax) * step) / steps, ay + ((by - ay) * step) / steps) - marble.radius);
				}
			}
			last = sample;
		}
	}
	return best;
}

describe('decorSourceCommands function', () => {
	it('should change the item, keep its place and take over a name that followed the item', () => {
		const project = loadFixture('zigzag');
		const applied = apply(project, addDecorCommands(project, builtInSource('decor:star'), { x: 0.1, y: 0.2 }).commands);
		const [decor] = applied.design.decor ?? [];
		const next = apply(applied, decorSourceCommands(applied, [decor?.id ?? ''], builtInSource('decor:bauble-red')));
		expect(next.design.decor?.[0]).toMatchObject({ source: 'decor:bauble-red', position: { x: 0.1, y: 0.2 }, name: DECOR_ITEMS.find((item) => item.id === 'decor:bauble-red')?.label });
		expect(decorSourceCommands(next, [decor?.id ?? ''], builtInSource('decor:bauble-red'))).toEqual([]);
	});
});

describe('Decor', () => {
	let simulator: TSimulator;
	let project: TProject;
	let result: TSimulationResult;
	let track: TCameraTrack;

	beforeAll(async () => {
		simulator = await createSimulator();
		project = loadFixture('jingle-bells');
		result = simulator.simulate(project);
		const camera = filmCamera(project, result).track;
		if (camera == null) throw new Error('Jingle Bells has no film camera');
		track = camera;
	}, 120_000);

	afterAll(() => {
		simulator.dispose();
		$blenderObjects.set([]);
	});

	function onTheRun(): { x: number; y: number } {
		const sample = result.marbles[0]?.samples[Math.floor((result.marbles[0]?.samples.length ?? 0) / 2)];
		if (sample == null) throw new Error('no samples');
		return sample.position;
	}

	describe('model', () => {
		it('should round-trip decor through the project file and stay valid without it', () => {
			const { commands } = addDecorCommands(project, builtInSource('decor:star'), { x: 1, y: 2 });
			const withDecor = apply(apply(project, commands), madeInBlenderCommands(project, 'Tree', { in: 1, out: 2, hidden: true }));
			const [isOk, err, parsed] = parseProject(serializeProject(withDecor));
			if (!isOk) throw err;
			expect(parsed.design.decor).toEqual(withDecor.design.decor);
			expect(parsed.design.madeInBlender).toEqual([{ name: 'Tree', in: 1, out: 2, hidden: true }]);
			expect(parsed.$schema).toBe('marble-project@4');
			expect(project.design.decor).toBeUndefined();
		});

		it('should never reach the simulation: the hits are the same with decor over the run', () => {
			const { commands } = addDecorCommands(project, builtInSource('decor:gift-box'), onTheRun());
			const after = simulator.simulate(apply(project, commands));
			expect(after.hits.map((hit) => hit.actualTime)).toEqual(result.hits.map((hit) => hit.actualTime));
		});

		it('should number names, and a text item should keep its text', () => {
			const first = apply(project, addDecorCommands(project, builtInSource('decor:handle'), { x: 0, y: 0 }).commands);
			const second = apply(first, addDecorCommands(first, builtInSource('decor:handle'), { x: 0, y: 0 }).commands);
			expect(second.design.decor?.map((item) => item.name)).toEqual(['Handle', 'Handle 2']);
			expect(second.design.decor?.[0]?.text).toBe('@yourchannel');
		});

		it('should grow a Handle with its text', () => {
			const decor = { source: 'decor:handle', scale: 1 };
			expect(decorExtent({ ...decor, text: '@a-much-longer-channel-name' }).x).toBeGreaterThan(decorExtent({ ...decor, text: '@yourchannel' }).x);
		});
	});

	describe('commands', () => {
		const added = (): { project: TProject; id: string } => {
			const { commands, decorId } = addDecorCommands(project, builtInSource('decor:star'), { x: 0.1, y: 0.2 });
			return { project: apply(project, commands), id: decorId };
		};

		it('should rename, hide, delete and duplicate', () => {
			const { project: base, id } = added();
			const renamed = apply(base, updateDecorCommands(base, [id], { name: 'North Star' }));
			expect(renamed.design.decor?.[0]?.name).toBe('North Star');
			const hidden = apply(renamed, updateDecorCommands(renamed, [id], { hidden: true }));
			expect(hidden.design.decor?.[0]?.hidden).toBe(true);
			const shown = apply(hidden, updateDecorCommands(hidden, [id], { hidden: false }));
			expect(shown.design.decor?.[0]?.hidden).toBeUndefined();
			const { commands, decorIds } = duplicateDecorCommands(shown, [id]);
			const copied = apply(shown, commands);
			expect(copied.design.decor).toHaveLength(2);
			expect(copied.design.decor?.[1]?.id).toBe(decorIds[0]);
			expect(copied.design.decor?.[1]?.position.x).toBeGreaterThan(0.1);
			const deleted = apply(copied, deleteDecorCommands(copied, [id, ...decorIds]));
			expect(deleted.design.decor).toBeUndefined();
		});

		it('should make a hand-moved scattered item the user\'s', () => {
			const { project: base, id } = added();
			const scattered = apply(base, [{ type: 'setDesign', design: { decor: base.design.decor?.map((item) => ({ ...item, scattered: true })) } }]);
			const moved = apply(scattered, updateDecorCommands(scattered, [id], { position: { x: 0.3, y: 0.3 } }));
			expect(moved.design.decor?.[0]?.scattered).toBeUndefined();
			const renamed = apply(scattered, updateDecorCommands(scattered, [id], { name: 'Mine' }));
			expect(renamed.design.decor?.[0]?.scattered).toBe(true);
		});

		it('should clear Made in Blender entries that set nothing', () => {
			const set = apply(project, madeInBlenderCommands(project, 'Tree', { hidden: true }));
			expect(set.design.madeInBlender).toEqual([{ name: 'Tree', hidden: true }]);
			expect(apply(set, madeInBlenderCommands(set, 'Tree', { hidden: null })).design.madeInBlender).toBeUndefined();
		});

		it('should send what Blender needs and nothing about scatter tags', () => {
			const { project: base } = added();
			const description = buildSceneDescription(apply(base, madeInBlenderCommands(base, 'Tree', { out: 3 })), result, { fps: 30 }).description;
			expect(description.decor?.[0]).toMatchObject({ item: 'star', scale: 1 });
			expect(description.decor?.[0]?.id.startsWith('decor:')).toBe(true);
			expect(description.madeInBlender).toEqual([{ name: 'Tree', out: 3 }]);
			const asset = apply(project, addDecorCommands(project, assetDecorSource('holly', 'Holly', { width: 0.04, height: 0.02 }), { x: 0, y: 0 }).commands);
			expect(buildSceneDescription(asset, result, { fps: 30 }).description.decor?.[0]).toMatchObject({ assetPath: 'assets/holly/asset.blend' });
		});
	});

	describe('Layers', () => {
		it('should list Decor after Titles in Film only, Made in Blender last', () => {
			const { project: base, decorId } = (() => {
				const { commands, decorId: id } = addDecorCommands(project, builtInSource('decor:star'), { x: 0, y: 0 });
				return { project: apply(project, commands), decorId: id };
			})();
			const objects = [{ name: 'Tree', bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }];
			const film = buildOutline(base, { workspace: 'design', blenderObjects: objects });
			const group = film.findIndex((row) => row.id === DECOR_KEY);
			expect(group).toBeGreaterThan(film.findIndex((row) => row.kind === 'camera'));
			expect(film.slice(group + 1).map((row) => row.kind)).toEqual(['decor', 'madeInBlender']);
			expect(buildOutline(base, { workspace: 'compose', blenderObjects: objects }).some((row) => row.id === DECOR_KEY || row.kind === 'decor')).toBe(false);
			expect(inspectorTarget(base, [toDecorKey(decorId)])).toEqual({ kind: 'decor', id: decorId });
			expect(inspectorTarget(base, [toMadeInBlenderKey('Tree')])).toEqual({ kind: 'madeInBlender', name: 'Tree' });
		});
	});

	describe('path awareness', () => {
		it('should tip decor over a marble\'s run, through the problem model, as a tip and not a problem', () => {
			const { commands, decorId } = addDecorCommands(project, builtInSource('decor:star'), onTheRun());
			const over = apply(project, commands);
			const run = { ...result, revision: over.revision };
			const preflight = preflightExport(over, run);
			const tip = decorTips(preflight).get(toDecorKey(decorId));
			expect(tip?.severity).toBe('info');
			expect(tip?.label).toMatch(/^Overlaps .+'s path/);
			expect(tip?.target?.workspace).toBe('design');
			const warnings = preflightExport(project, { ...result, revision: project.revision }).warnings;
			expect(preflight.warnings).toBe(warnings);
		});

		it('should say nothing for hidden decor or outside its In and Out', () => {
			const { commands, decorId } = addDecorCommands(project, builtInSource('decor:star'), onTheRun());
			const over = apply(project, commands);
			const hidden = apply(over, updateDecorCommands(over, [decorId], { hidden: true }));
			expect(decorOverlaps(hidden, result, [])).toEqual([]);
			const time = decorOverlaps(over, result, [])[0]?.lanes[0]?.time ?? 0;
			const later = apply(over, updateDecorCommands(over, [decorId], { in: time + 100 }));
			expect(decorOverlaps(later, result, []).length).toBe(0);
		});

		it('should use the bounds Blender reports, and respect Hidden there', () => {
			const { x, y } = onTheRun();
			const object = { name: 'Tree', bounds: { minX: x - 0.02, minY: y - 0.02, maxX: x + 0.02, maxY: y + 0.02 } };
			expect(decorOverlaps(project, result, [object])[0]?.key).toBe(toMadeInBlenderKey('Tree'));
			expect(decorOverlaps(apply(project, madeInBlenderCommands(project, 'Tree', { hidden: true })), result, [object])).toEqual([]);
			$blenderObjects.set([object]);
			expect(decorTips(preflightExport(project, { ...result, revision: project.revision })).has(toMadeInBlenderKey('Tree'))).toBe(true);
			$blenderObjects.set([]);
		});

		it('should word several marbles', () => {
			expect(overlapLabel(['Melody'])).toBe("Overlaps Melody's path");
			expect(overlapLabel(['Melody', 'Bass'])).toBe("Overlaps Melody's and Bass's paths");
		});

		it('should Move Clear to a spot clear of every run, and the tip should go', () => {
			const { commands, decorId } = addDecorCommands(project, builtInSource('decor:gift-box'), onTheRun());
			const over = apply(project, commands);
			const fix = moveDecorClear(over, result, decorId);
			expect(fix).not.toBeNull();
			const moved = apply(over, fix?.commands ?? []);
			const decor = moved.design.decor?.[0] as TDecor;
			expect(clearanceToRuns(result, decorBox(decor))).toBeGreaterThanOrEqual(MOVE_CLEAR_MARGIN);
			expect(decorOverlaps(moved, result, [])).toEqual([]);
		});
	});

	describe('Scatter Decor', () => {
		const items = ['decor:bauble-gold', 'decor:snowflake-gold', 'decor:star'].map(builtInSource);
		const options = { items, density: 0.5, seed: 7 };

		it('should be deterministic for a seed and move with another', () => {
			const first = scatterPlacements(project, result, track, options);
			expect(scatterPlacements(project, result, track, options)).toEqual(first);
			expect(scatterPlacements(project, result, track, { ...options, seed: 8 })).not.toEqual(first);
			expect(first.length).toBeGreaterThan(10);
		});

		it('should keep every item clear of every run by the margin', () => {
			const started = performance.now();
			const placements = scatterPlacements(project, result, track, options);
			const elapsed = performance.now() - started;
			console.log(`Scatter Decor on Jingle Bells: ${placements.length} items in ${elapsed.toFixed(0)} ms, ${result.marbles.length} marbles`);
			for (const placement of placements) {
				const box = decorBox({ source: placement.source.source, scale: placement.scale, position: placement.position, rotation: placement.rotation });
				expect(clearanceToRuns(result, box)).toBeGreaterThanOrEqual(SCATTER_MARGIN);
			}
			expect(decorOverlaps(apply(project, scatterDecorCommands(project, result, track, options).commands), result, [])).toEqual([]);
		}, 60_000);

		it('should keep every item clear of the pieces', () => {
			const field = buildObstacleField(result);
			expect(field.x.length).toBeGreaterThan(1000);
			for (const placement of scatterPlacements(project, result, track, options)) {
				const box = decorBox({ source: placement.source.source, scale: placement.scale, position: placement.position, rotation: placement.rotation });
				for (const piece of result.pieces) {
					if (piece.status === 'blocked' || piece.status === 'unreached' || piece.type === 'windmill') continue;
					for (const corner of pieceOutline(piece)) expect(distanceToBox(box, corner.x, corner.y)).toBeGreaterThanOrEqual(SCATTER_MARGIN);
				}
			}
		}, 60_000);

		it('should stay inside what the film camera shows and beside the run', () => {
			for (const placement of scatterPlacements(project, result, track, options)) {
				let isShown = false;
				for (let time = 0; time < track.frameCount / track.fps && !isShown; time += 0.1) {
					isShown = projectsInside(track, time, placement.position);
				}
				expect(isShown).toBe(true);
				expect(clearanceToRuns(result, { x: placement.position.x, y: placement.position.y, halfX: 0, halfY: 0, angle: 0 })).toBeLessThan(0.22);
			}
		}, 60_000);

		it('should place more with more density, mix the set evenly, and leave out text items by default', () => {
			const sparse = scatterPlacements(project, result, track, { ...options, density: 0 });
			const dense = scatterPlacements(project, result, track, { ...options, density: 1 });
			expect(dense.length).toBeGreaterThan(sparse.length);
			const counts = new Map<string, number>();
			for (const placement of dense) counts.set(placement.source.source, (counts.get(placement.source.source) ?? 0) + 1);
			expect(counts.size).toBe(items.length);
			expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
			expect(DECOR_ITEMS.filter((item) => !item.scatter).map((item) => item.label)).toEqual(['Handle', 'Subscribe', 'Garland', 'Particles']);
		}, 60_000);

		it('should replace only what it placed, in one edit, and keep clear of the user\'s decor', () => {
			const { commands: mine, decorId } = addDecorCommands(project, builtInSource('decor:star'), { x: 0.5, y: -3 });
			const base = apply(project, mine);
			const first = scatterDecorCommands(base, result, track, options);
			expect(first.commands).toHaveLength(1);
			const once = apply(base, first.commands);
			const twice = apply(once, scatterDecorCommands(once, result, track, { ...options, seed: 9 }).commands);
			expect(once.design.decor?.filter((item) => item.scattered === true).length).toBe(first.count);
			expect(twice.design.decor?.some((item) => item.id === decorId)).toBe(true);
			expect(twice.design.decor?.filter((item) => item.scattered !== true)).toHaveLength(1);
		}, 60_000);
	});

	describe('agent', () => {
		it('should plan a decor request as a set of runs, and keep other requests as they were', () => {
			const plans = planAgentRuns([], 'Christmas decor along the sides', 'set-1');
			expect(plans).toHaveLength(3);
			expect(plans[1]?.target).toEqual({ kind: 'scene', decorSet: { id: 'set-1', index: 2, total: 3 } });
			expect(plans[1]?.label).toBe('Decor 2 of 3');
			expect(planAgentRuns([], 'A warm wall')).toEqual([{ target: { kind: 'scene' }, label: 'Scene' }]);
			expect(planAgentRuns([{ id: 'piece-1', kind: 'piece', label: 'Platform 1' }], 'decor on this piece')[0]?.target).toEqual({ kind: 'piece', entityId: 'piece-1' });
		});

		it('should brief one item of the set as a decoration', () => {
			const brief = buildAgentBrief({ project, result, target: { kind: 'scene', decorSet: { id: 's', index: 1, total: 3 } }, request: 'Christmas decor along the sides' });
			expect(brief.target.role).toBe('decoration');
			expect(brief.decorSet).toEqual({ index: 1, total: 3, suggestion: 'a round or hanging ornament' });
			expect(brief.contact?.description).toContain('flat on the wall');
		});

		it('should keep the point-on-the-wall brief', () => {
			const brief = buildAgentBrief({ project, result, target: { kind: 'wall', point: { x: 1, y: 2 } }, request: 'A wreath' });
			expect(brief.target).toEqual({ kind: 'wall', role: 'decoration' });
			expect(brief.wallPoint).toEqual({ x: 1, y: 2 });
			expect(brief.decorSet).toBeUndefined();
		});

		it('should scatter accepted items by their asset path with their manifest size', () => {
			const source = assetDecorSource('holly', 'Holly', { width: 0.04, height: 0.03 });
			expect(source.footprint).toEqual({ x: 0.02, y: 0.015 });
			const { commands, count } = scatterDecorCommands(project, result, track, { items: [source], density: 0.5, seed: seedOf('set-1') });
			expect(count).toBeGreaterThan(0);
			expect(new Set(apply(project, commands).design.decor?.map((item) => item.source))).toEqual(new Set(['assets/holly/asset.blend']));
			expect(seedOf('set-1')).toBe(seedOf('set-1'));
		}, 60_000);
	});

	describe('Snowfall and Garland', () => {
		function withEffects(): { project: TProject; result: TSimulationResult; track: TCameraTrack } {
			let project = loadFixture('jingle-bells');
			for (const source of ['decor:snowfall', 'decor:garland']) project = apply(project, addDecorCommands(project, builtInSource(source), { x: 0, y: 0 }).commands);
			const result = simulator.simulate(project);
			const track = filmCamera(project, result).track;
			if (track == null) throw new Error('The fixture has a film camera');
			return { project, result, track };
		}

		it('come as Library items with their settings', () => {
			expect(DECOR_ITEMS.filter((item) => item.effect != null).map((item) => item.label)).toEqual(['Garland', 'Particles']);
			expect(effectDefaults('decor:snowfall')).toEqual({ snowfall: { density: 0.5, size: 1, speed: 1, color: '#fff1d6' } });
			expect(effectDefaults('decor:garland')).toEqual({ garland: { side: 'both', spacing: 0.14 } });
			expect(effectDefaults('decor:star')).toEqual({});
			expect(isFrameEffect({ source: 'decor:snowfall' })).toBe(true);
			expect(isFrameEffect({ source: 'decor:star' })).toBe(false);
		});

		it('have no path warning, no pick and survive a save', () => {
			const { project, result } = withEffects();
			// At the very start of the run, right over the marble's path, they still overlap nothing
			expect(decorOverlaps(project, result, [])).toEqual([]);
			expect(decorTips(preflightExport(project, result, [])).size).toBe(0);
			const [isOk, err, loaded] = parseProject(serializeProject(project));
			if (!isOk) throw err;
			expect(loaded.design.decor?.map((item) => item.snowfall ?? item.garland)).toEqual([{ density: 0.5, size: 1, speed: 1, color: '#fff1d6' }, { side: 'both', spacing: 0.14 }]);
			expect(buildSceneDescription(project, result, { fps: 30 }).description.decor?.map((item) => item.item)).toEqual(['snowfall', 'garland']);
		});

		it('Scatter Decor ignores them, as items and as obstacles', () => {
			const { project, result, track } = withEffects();
			const items = [builtInSource('decor:star')];
			const bare = loadFixture('jingle-bells');
			const barePlacements = scatterPlacements(bare, simulator.simulate(bare), track, { items, density: 0.3, seed: 1 });
			expect(scatterPlacements(project, result, track, { items, density: 0.3, seed: 1 })).toEqual(barePlacements);
			expect(scatterPlacements(project, result, track, { items: [builtInSource('decor:snowfall'), builtInSource('decor:garland')], density: 0.3, seed: 1 })).toEqual([]);
			const placed = scatterPlacements(project, result, track, { items: [...items, builtInSource('decor:snowfall')], density: 0.3, seed: 1 });
			expect(placed.every((placement) => placement.source.source === 'decor:star')).toBe(true);
		});

		it('snow is seeded by the layer and placed by time alone', () => {
			const flakes = snowFlakes('decor-snowfall', 0.5);
			expect(snowFlakes('decor-snowfall', 0.5)).toEqual(flakes);
			expect(snowFlakes('other', 0.5)).not.toEqual(flakes);
			expect(snowFlakes('decor-snowfall', 1).length).toBeGreaterThan(flakes.length);
			const flake = flakes[0];
			if (flake == null) throw new Error('There are flakes');
			expect(flakeAt(flake, 3, 1)).toEqual(flakeAt(flake, 3, 1));
			expect(flakeAt(flake, 3, 1)).not.toEqual(flakeAt(flake, 4, 1));
			const place = flakeAt(flake, 1000, 1);
			expect(place.u >= 0 && place.u < 1 && place.v >= 0 && place.v < 1).toBe(true);
			// Speed 0: it stays where it fell from, apart from its sway
			expect(flakeAt(flake, 1, 0).v).toBe(flakeAt(flake, 99, 0).v);
		});

		it('a garland passes with the camera and repeats its pattern', () => {
			const { project, track } = withEffects();
			const aspect = project.frame.width / project.frame.height;
			expect(garlandScrollAt(track, aspect, 0)).toBe(0);
			// The camera falls with the run, so the wall and the garland keep going up through the frame
			expect(garlandScrollAt(track, aspect, 20)).toBeGreaterThan(garlandScrollAt(track, aspect, 10));
			const sprigs = garlandSprigs(0.14, 0.3);
			expect(sprigs.every((sprig, index) => index === 0 || sprig.v > (sprigs[index - 1]?.v ?? 0))).toBe(true);
			expect(sprigs.length).toBeGreaterThanOrEqual(7);
			const onePeriod = garlandSprigs(0.14, 0.3 + 0.14 * GARLAND_PERIOD);
			expect(onePeriod.map((sprig) => sprig.bauble)).toEqual(sprigs.map((sprig) => sprig.bauble));
		});
	});

	function projectsInside(camera: TCameraTrack, time: number, point: { x: number; y: number }): boolean {
		const frame = Math.min(camera.frameCount - 1, Math.round(time * camera.fps));
		return isInFrameAt(camera, frame, point);
	}
});


function isInFrameAt(camera: TCameraTrack, frame: number, point: { x: number; y: number }): boolean {
	const [u, v] = projectToFrame(camera, frame, point.x, point.y, 0);
	return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}
