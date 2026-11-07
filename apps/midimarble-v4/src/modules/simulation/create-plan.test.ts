import { beforeAll, describe, expect, it } from 'vitest';
import { applyProjectCommands, createMarble, type TProject } from '@/modules/project';
import { isSameRunInput } from './create-plan';
import { createStaircaseProject } from './fixture-projects';
import { createSimulator, type TSimulator } from './simulate';
import type { TSimulationResult } from './types';

/** A small seeded generator, so a failure repeats */
function randomOf(seed: number): () => number {
	let state = seed;
	return () => {
		state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x9e3779b9;
		return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
	};
}

/** Every value in `value` swapped for a random one of the same kind, so no field of it is left out by name */
function randomized(value: unknown, random: () => number): unknown {
	if (typeof value === 'number') return random() * 10 - 5;
	if (typeof value === 'boolean') return random() > 0.5;
	if (typeof value === 'string') return `random-${Math.floor(random() * 1000)}`;
	if (Array.isArray(value)) return value.map((item) => randomized(item, random));
	if (value != null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, randomized(item, random)]));
	return value;
}

function randomFilm(project: TProject, random: () => number): TProject['film'] {
	const title = { id: 'title', text: 'Song', font: 'serif', size: 1, position: { x: 1, y: 2 }, angle: 0.5 };
	const decor = { id: 'decor', name: 'Tree', source: 'decor:tree', position: { x: 0, y: 1, z: 2 }, scale: 1, rotation: 0.5 };
	const light = { id: 'light', color: '#ffffff', strength: 2, position: { x: 1, y: 1, z: 1 } };
	const shot = { id: 'shot', time: 1, distance: 2, hold: 3 };
	const full = {
		...project.film,
		theme: { base: 'gold', parts: { platform: 'grid' }, glowColor: '#ffffff', pack: 'pack' },
		wall: { color: '#ffffff', backgroundColor: '#000000', kind: 'plaster', labelColor: '#123456' },
		lights: { key: { color: '#ffffff', strength: 1 }, added: [light] },
		camera: { ...project.film.camera, shots: [shot], focusMarbleId: 'marble' },
		titles: [title],
		decor: [decor]
	};
	return randomized(full, random) as TProject['film'];
}

function withoutStats(result: TSimulationResult): Omit<TSimulationResult, 'stats'> {
	const { stats: _stats, ...rest } = result;
	return rest;
}

describe('a run', () => {
	let simulator: TSimulator;

	beforeAll(async () => {
		simulator = await createSimulator();
	});

	/** With nothing to resume from, so no snapshot can hide a difference */
	async function runFresh(project: TProject): Promise<string> {
		const fresh = await createSimulator();
		const result = fresh.simulate(project);
		fresh.dispose();
		return JSON.stringify(withoutStats(result));
	}

	/** Pieces to strike, and open hits on a marble flying sideways, whose dots reach outside any frame */
	function smallProject(): TProject {
		const project = createStaircaseProject();
		const flying = { ...createMarble(1, { x: 0.3, y: 0.5 }, 'flying'), radius: 0.008, start: { position: { x: 0.3, y: 0.5 }, time: 0, velocity: { x: 3, y: 0 } } };
		flying.hits.push({ id: 'near', time: 0.1 }, { id: 'far', time: 0.8 });
		project.marbles.push(flying);
		return project;
	}

	it('stays identical with any film', async () => {
		const project = smallProject();
		const before = JSON.stringify(withoutStats(simulator.simulate(project)));
		for (let seed = 1; seed <= 25; seed++) {
			expect(await runFresh({ ...project, film: randomFilm(project, randomOf(seed)) })).toBe(before);
		}
	});

	it('stays identical with any frame', async () => {
		const project = smallProject();
		const before = JSON.stringify(withoutStats(simulator.simulate(project)));
		expect(await runFresh({ ...project, format: { width: 16, height: 9 } })).toBe(before);
	});

	describe('isSameRunInput function', () => {
		it('holds across a film edit and breaks on anything a run reads', () => {
			const project = smallProject();
			const [isOk, , edited] = applyProjectCommands(project, [{ type: 'updateFilm', film: { camera: { ...project.film.camera, distance: 3 } } }]);
			expect(isOk).toBe(true);
			expect(isSameRunInput(project, edited as TProject)).toBe(true);
			expect(isSameRunInput(project, { ...project, gravity: 0.5 })).toBe(false);
			expect(isSameRunInput(project, { ...project, length: project.length + 1 })).toBe(false);
			expect(isSameRunInput(project, { ...project, marbles: [...project.marbles] })).toBe(false);
			expect(isSameRunInput(project, { ...project, track: { ...project.track, pieces: [...project.track.pieces] } })).toBe(false);
		});

		it('holds across a Group edit, which no run reads', () => {
			const project = smallProject();
			const regrouped: TProject = { ...project, track: { ...project.track, groups: [] } };
			expect(isSameRunInput(project, regrouped)).toBe(true);
		});
	});
});
