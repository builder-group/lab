import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectToFrame, type TCameraTrack } from '@/modules/camera';
import { parseProject, serializeProject, type TDecor, type TProject } from '@/modules/project';
import { buildSceneDescription } from '@/modules/blender/scene-builder';
import { createSimulator, type TSimulator } from '@/modules/simulation/simulate';
import type { TSimulationResult } from '@/modules/simulation/types';
import { createStaircaseProject } from '@/modules/simulation/fixture-projects';
import { buildOutline, collapsedGroups, DECOR_KEY, groupsOfSelection } from '@/modules/studio/outline';
import { inspectorTarget } from '@/modules/studio/inspector-target';
import { toDecorKey, toMadeInBlenderKey } from '@/modules/studio/selection';
import {
	addDecorCommands,
	assetDecorSource,
	builtInSource,
	decorBox,
	decorOverlaps,
	deleteDecorCommands,
	duplicateDecorCommands,
	madeInBlenderCommands,
	moveDecorClear,
	MOVE_CLEAR_MARGIN,
	overlapLabel,
	updateDecorCommands
} from './decor';
import { DECOR_ITEMS, isFrameEffect } from './decor-catalog';
import { effectDefaults, flakeAt, snowFlakes } from './decor-effects';
import { buildObstacleField, distanceToBox, type TWallBox } from './decor-clearance';
import { SCATTER_MARGIN, scatterDecorCommands, scatterPlacements } from './decor-scatter';
import { NO_BLENDER_OBJECTS, decorTips, preflightExport } from './export-preflight';
import { filmCamera } from './film-camera';
import { pieceOutline } from '@/modules/compose/scene';
import { apply, loadFixture } from '@/modules/project/test-helpers';

function loadBare(name: string): TProject {
	const project = loadFixture(name);
	// These tests place their own decor
	return { ...project, design: { ...project.design, decor: [] } };
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

describe('Decor', () => {
	let simulator: TSimulator;
	let project: TProject;
	let result: TSimulationResult;
	let track: TCameraTrack;

	beforeAll(async () => {
		simulator = await createSimulator();
		project = loadBare('zigzag');
		result = simulator.simulate(project);
		const camera = filmCamera(project, result).track;
		if (camera == null) throw new Error('The fixture has no film camera');
		track = camera;
	}, 120_000);

	afterAll(() => {
		simulator.dispose();
	});

	function onTheRun(): { x: number; y: number } {
		const sample = result.marbles[0]?.samples[Math.floor((result.marbles[0]?.samples.length ?? 0) / 2)];
		if (sample == null) throw new Error('no samples');
		return sample.position;
	}

	describe('model', () => {
		it('should round-trip decor through the project file', () => {
			const { commands } = addDecorCommands(project, builtInSource('decor:star'), { x: 1, y: 2 });
			const withDecor = apply(apply(project, commands), madeInBlenderCommands(project, 'Tree', { in: 1, out: 2, hidden: true }));
			const [isOk, err, parsed] = parseProject(serializeProject(withDecor));
			if (!isOk) throw err;
			expect(parsed.design.decor).toEqual(withDecor.design.decor);
			expect(parsed.design.madeInBlender).toEqual([{ name: 'Tree', in: 1, out: 2, hidden: true }]);
			expect(parsed.$schema).toBe('marble-project@5');
			expect(project.design.decor).toEqual([]);
		});

		it('should never reach the simulation: the hits are the same with decor over the run', () => {
			const { commands } = addDecorCommands(project, builtInSource('decor:gift-box'), onTheRun());
			const after = simulator.simulate(apply(project, commands));
			expect(after.hits.map((hit) => hit.actualTime)).toEqual(result.hits.map((hit) => hit.actualTime));
		});

		it('should number names', () => {
			const first = apply(project, addDecorCommands(project, builtInSource('decor:star'), { x: 0, y: 0 }).commands);
			const second = apply(first, addDecorCommands(first, builtInSource('decor:star'), { x: 0, y: 0 }).commands);
			expect(second.design.decor.map((item) => item.name)).toEqual(['Star', 'Star 2']);
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
			expect(renamed.design.decor[0]?.name).toBe('North Star');
			const hidden = apply(renamed, updateDecorCommands(renamed, [id], { hidden: true }));
			expect(hidden.design.decor[0]?.hidden).toBe(true);
			const shown = apply(hidden, updateDecorCommands(hidden, [id], { hidden: false }));
			expect(shown.design.decor[0]?.hidden).toBeUndefined();
			const { commands, decorIds } = duplicateDecorCommands(shown, [id]);
			const copied = apply(shown, commands);
			expect(copied.design.decor).toHaveLength(2);
			expect(copied.design.decor[1]?.id).toBe(decorIds[0]);
			expect(copied.design.decor[1]?.position.x).toBeGreaterThan(0.1);
			const deleted = apply(copied, deleteDecorCommands(copied, [id, ...decorIds]));
			expect(deleted.design.decor).toEqual([]);
		});

		it('should make a hand-moved scattered item the user\'s', () => {
			const { project: base, id } = added();
			const scattered = apply(base, [{ type: 'setDesign', design: { decor: base.design.decor.map((item) => ({ ...item, scattered: true })) } }]);
			const moved = apply(scattered, updateDecorCommands(scattered, [id], { position: { x: 0.3, y: 0.3 } }));
			expect(moved.design.decor[0]?.scattered).toBeUndefined();
			const renamed = apply(scattered, updateDecorCommands(scattered, [id], { name: 'Mine' }));
			expect(renamed.design.decor[0]?.scattered).toBe(true);
		});

		it('should clear Made in Blender entries that set nothing', () => {
			const set = apply(project, madeInBlenderCommands(project, 'Tree', { hidden: true }));
			expect(set.design.madeInBlender).toEqual([{ name: 'Tree', hidden: true }]);
			expect(apply(set, madeInBlenderCommands(set, 'Tree', { hidden: null })).design.madeInBlender).toEqual([]);
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
			const preflight = preflightExport(over, run, NO_BLENDER_OBJECTS);
			const tip = decorTips(preflight).get(toDecorKey(decorId));
			expect(tip?.severity).toBe('info');
			expect(tip?.label).toMatch(/^Overlaps .+'s path/);
			expect(tip?.target?.workspace).toBe('design');
			const warnings = preflightExport(project, { ...result, revision: project.revision }, NO_BLENDER_OBJECTS).warnings;
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
			expect(decorTips(preflightExport(project, { ...result, revision: project.revision }, [object])).has(toMadeInBlenderKey('Tree'))).toBe(true);
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
			const decor = moved.design.decor[0] as TDecor;
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
			const placements = scatterPlacements(project, result, track, options);
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
			expect(DECOR_ITEMS.filter((item) => !item.scatter).map((item) => item.label)).toEqual(['Particles']);
		}, 60_000);

		it('should replace only what it placed, in one edit, and keep clear of the user\'s decor', () => {
			const { commands: mine, decorId } = addDecorCommands(project, builtInSource('decor:star'), { x: 0.5, y: -3 });
			const base = apply(project, mine);
			const first = scatterDecorCommands(base, result, track, options);
			expect(first.commands).toHaveLength(1);
			const once = apply(base, first.commands);
			const twice = apply(once, scatterDecorCommands(once, result, track, { ...options, seed: 9 }).commands);
			expect(once.design.decor.filter((item) => item.scattered === true).length).toBe(first.count);
			expect(twice.design.decor.some((item) => item.id === decorId)).toBe(true);
			expect(twice.design.decor.filter((item) => item.scattered !== true)).toHaveLength(1);
		}, 60_000);
	});

	describe('agent', () => {
		it('should scatter library items by their asset path with their manifest size', () => {
			const source = assetDecorSource('holly', 'Holly', { width: 0.04, height: 0.03 });
			expect(source.footprint).toEqual({ x: 0.02, y: 0.015 });
			const { commands, count } = scatterDecorCommands(project, result, track, { items: [source], density: 0.5, seed: 1 });
			expect(count).toBeGreaterThan(0);
			expect(new Set(apply(project, commands).design.decor.map((item) => item.source))).toEqual(new Set(['assets/holly/asset.blend']));
		}, 60_000);
	});

	describe('Particles', () => {
		function withEffects(): { project: TProject; result: TSimulationResult; track: TCameraTrack } {
			let project = loadBare('zigzag');
			for (const source of ['decor:snowfall']) project = apply(project, addDecorCommands(project, builtInSource(source), { x: 0, y: 0 }).commands);
			const result = simulator.simulate(project);
			const track = filmCamera(project, result).track;
			if (track == null) throw new Error('The fixture has a film camera');
			return { project, result, track };
		}

		it('come as Library items with their settings', () => {
			expect(DECOR_ITEMS.filter((item) => item.effect != null).map((item) => item.label)).toEqual(['Particles']);
			expect(effectDefaults('decor:snowfall')).toEqual({ snowfall: { density: 0.5, size: 1, speed: 1, color: '#fff1d6' } });
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
			expect(loaded.design.decor.map((item) => item.snowfall)).toEqual([{ density: 0.5, size: 1, speed: 1, color: '#fff1d6' }]);
			expect(buildSceneDescription(project, result, { fps: 30 }).description.decor?.map((item) => item.item)).toEqual(['snowfall']);
		});

		it('Scatter Decor ignores them, as items and as obstacles', () => {
			const { project, result, track } = withEffects();
			const items = [builtInSource('decor:star')];
			const bare = loadBare('zigzag');
			const barePlacements = scatterPlacements(bare, simulator.simulate(bare), track, { items, density: 0.3, seed: 1 });
			expect(scatterPlacements(project, result, track, { items, density: 0.3, seed: 1 })).toEqual(barePlacements);
			expect(scatterPlacements(project, result, track, { items: [builtInSource('decor:snowfall')], density: 0.3, seed: 1 })).toEqual([]);
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

describe('Film Layers', () => {
	it('should open with the marbles and Decor closed, and Compose open, each toggled the other way by hand', () => {
		const project = createStaircaseProject();
		const laneId = project.music.lanes[0]?.id as string;
		expect(collapsedGroups(project, 'design', [])).toEqual(expect.arrayContaining([laneId, DECOR_KEY]));
		expect(collapsedGroups(project, 'compose', [])).toEqual([]);
		expect(collapsedGroups(project, 'design', [laneId])).not.toContain(laneId);
		expect(collapsedGroups(project, 'compose', [laneId])).toEqual([laneId]);
		const rows = buildOutline(project, { workspace: 'design', collapsed: collapsedGroups(project, 'design', []) });
		expect(rows.some((row) => row.kind === 'piece')).toBe(false);
		expect(rows.some((row) => row.kind === 'wall')).toBe(true);
	});

	it('should name the group a selection made elsewhere opens', () => {
		const project = createStaircaseProject();
		const piece = project.entities.find((entity) => entity.components.hitLink != null);
		expect(groupsOfSelection(project, [piece?.id as string])).toEqual([piece?.components.hitLink?.laneId]);
		expect(groupsOfSelection(project, ['decor:1'])).toEqual([DECOR_KEY]);
		expect(groupsOfSelection(project, ['wall'])).toEqual([]);
	});
});
