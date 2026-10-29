import { assert, describe, expect, it } from 'vitest';
import { compilePerformance } from '../motion/compile-performance';
import { getRailGeometry } from '../motion/rail-geometry';
import { createCatalogObject, createCatalogRailPath } from './object-catalog';
import { createEmptyProject, parseProject } from './project';

describe('object catalog rail presets', () => {
	it('should create a continuous wave with two dips and one intervening crest', () => {
		const object = createCatalogObject('rail-wave');
		const path = object.path ?? [];
		const extrema = path.flatMap((point, index) => {
			const previous = path[index - 1];
			const next = path[index + 1];
			if (!previous || !next) return [];
			if (point[1] < previous[1] && point[1] < next[1]) return ['dip'];
			if (point[1] > previous[1] && point[1] > next[1]) return ['crest'];
			return [];
		});
		expect(extrema).toEqual(['dip', 'crest', 'dip']);
		expect(path[0]?.[0]).toBe(-object.size[0] / 2);
		expect(path.at(-1)?.[0]).toBe(object.size[0] / 2);
		for (let index = 1; index < path.length; index++) {
			const point = path[index];
			const previous = path[index - 1];
			assert(point && previous);
			expect(point[0]).toBeGreaterThan(previous[0]);
			expect(Math.hypot(...point.map((value, axis) => value - (previous[axis] ?? 0)))).toBeLessThan(
				0.25
			);
		}
	});

	it('should carry a normally launched marble across both dips and release it beyond the outlet', async () => {
		const project = createEmptyProject();
		const rail = createCatalogObject('rail-wave');
		const inlet = rail.path?.[0];
		assert(inlet);
		project.duration = 4;
		project.objects = [rail];
		const supportHeight = Math.sqrt(
			(project.launch.radius + rail.size[1] / 2) ** 2 - (rail.size[2] / 2) ** 2
		);
		project.launch.position = [inlet[0] + 0.01, inlet[1] + supportHeight + 0.003, 0];
		project.launch.velocity = [3.5, 0, 0];

		const performance = await compilePerformance(project);

		expect(performance.warnings).toEqual([]);
		const outletX = rail.size[0] / 2;
		const release = performance.samples.find((sample) => sample.position[0] > outletX);
		assert(release);
		expect(release.time).toBeLessThan(3.5);
		expect(performance.samples.at(-1)?.position[1]).toBeLessThan(release.position[1] - 1);
		const supported = (performance.surfaceContacts ?? []).filter(
			(contact) => contact.objectId === rail.id
		);
		expect(supported.some((contact) => contact.end - contact.start > 2)).toBe(true);
		expect(supported.at(-1)?.end).toBeGreaterThan(release.time - 0.05);
		for (const [index, sample] of performance.samples.entries()) {
			const previous = performance.samples[index - 1];
			if (previous) expect(sample.position[0]).toBeGreaterThan(previous.position[0]);
			if (sample.time <= release.time) expect(Math.abs(sample.position[2])).toBeLessThan(0.03);
		}
	});

	it('should use the editable wave path for both physical wire centerlines', () => {
		const object = createCatalogObject('rail-wave');
		const geometry = getRailGeometry(object);
		for (const [index, point] of (object.path ?? []).entries()) {
			const left = geometry.paths[0][index];
			const right = geometry.paths[1][index];
			assert(left && right);
			expect(left.slice(0, 2)).toEqual(point.slice(0, 2));
			expect(right.slice(0, 2)).toEqual(point.slice(0, 2));
			expect(right[2] - left[2]).toBeCloseTo(object.size[2]);
		}
		expect(geometry.radius * 2).toBe(object.size[1]);
	});

	it('should reset scaled curves without sharing points with other objects', () => {
		for (const id of ['rail-wave', 'rail-curve', 'rail-straight'] as const) {
			const original = createCatalogObject(id);
			const reset = createCatalogRailPath(id, original.size[0] * 2);
			assert(reset?.[0]);
			expect(reset).toEqual(original.path?.map(([x, y, z]) => [x * 2, y * 2, z]));
			reset[0][1] = 42;
			expect(createCatalogObject(id).path).toEqual(original.path);
		}
	});

	it('should retain a customized wave rail when saving and reopening a project', () => {
		const project = createEmptyProject();
		const rail = createCatalogObject('rail-wave');
		assert(rail.path?.[10]);
		rail.path[10][1] += 0.1;
		project.objects = [rail];
		expect(parseProject(JSON.stringify(project)).objects).toEqual([rail]);
	});
});

describe('createCatalogObject function', () => {
	it('should create a thin bare spring key with a front flange and preserve it on reopen', () => {
		const strip = createCatalogObject('key-strip');
		expect(strip).toMatchObject({
			modelId: 'key-strip',
			kind: 'bar',
			mountStyle: 'folded-front',
			material: 'metal',
			materialFinish: 'bare',
			size: [0.35, 0.045, 1.5]
		});
		const project = createEmptyProject();
		project.objects = [strip];
		expect(parseProject(JSON.stringify(project)).objects).toEqual([strip]);
	});

	it('should save a distinct resonator bar without changing the thin metal key default', () => {
		const block = createCatalogObject('key-block');
		const thin = createCatalogObject('key-bar');
		expect(block.kind).toBe('bar');
		expect(block.material).toBe('metal');
		expect(block.size[1]).toBeGreaterThan(thin.size[1]);
		expect(block.size[0]).toBe(thin.size[0]);
		expect(block.size[2]).toBe(thin.size[2]);
		expect(block.color).not.toBe(thin.color);
		const project = createEmptyProject();
		project.objects = [block, thin];
		expect(parseProject(JSON.stringify(project)).objects).toEqual([block, thin]);
	});
});
