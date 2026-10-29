import { createDemoProject, createWorldObject } from '../project/fixtures/sample-project';
import { describe, expect, it } from 'vitest';
import { type TPerformance } from '../project';
import { mixSurfaceAudio } from './surface-audio';

describe('mixSurfaceAudio function', () => {
	it('should put deterministic nonmusical rolling sound only inside actual contact intervals', () => {
		const project = createDemoProject();
		project.duration = 1;
		project.audio = { musicVolume: 0, surfaceVolume: 1, surfacesEnabled: true };
		const object = createWorldObject('rail', [0, 0, 0]);
		const performance: TPerformance = {
			duration: 1,
			dt: 1 / 240,
			objects: [object],
			samples: [],
			impacts: [],
			noteMarkers: [],
			warnings: [],
			bounds: { min: [0, 0, 0], max: [0, 0, 0] },
			surfaceContacts: [{ objectId: object.id, start: 0.2, end: 0.7, speed: 1.2 }]
		};
		const left = new Float32Array(44100),
			right = new Float32Array(44100);
		mixSurfaceAudio(left, right, project, performance, 44100);
		expect(left.slice(0, 8820).every((value) => value === 0)).toBe(true);
		expect(left.slice(30870).every((value) => value === 0)).toBe(true);
		expect(left.some((value) => Math.abs(value) > 0.001)).toBe(true);
		const repeat = new Float32Array(44100);
		mixSurfaceAudio(repeat, new Float32Array(44100), project, performance, 44100);
		expect(repeat).toEqual(left);
	});
	it('should leave rails silent when there is no physical support or surface sound is muted', () => {
		const project = createDemoProject();
		project.audio = { musicVolume: 1, surfaceVolume: 1, surfacesEnabled: false };
		const left = new Float32Array([0.3, -0.2]);
		const right = left.slice();
		mixSurfaceAudio(left, right, project, null, 44100);
		expect([...left]).toEqual([...right]);
	});
	it('should smooth tiny support gaps without restarting the rolling texture', () => {
		const project = createDemoProject();
		project.audio = { musicVolume: 0, surfaceVolume: 1, surfacesEnabled: true };
		const object = createWorldObject('rail', [0, 0, 0]);
		const performance: TPerformance = {
			duration: 1,
			dt: 1 / 240,
			objects: [object],
			samples: [],
			impacts: [],
			noteMarkers: [],
			warnings: [],
			bounds: { min: [0, 0, 0], max: [0, 0, 0] },
			surfaceContacts: [{ objectId: object.id, start: 0.2, end: 0.7, speed: 1.2 }]
		};
		const continuous = new Float32Array(44100);
		mixSurfaceAudio(continuous, new Float32Array(44100), project, performance, 44100);
		performance.surfaceContacts = [
			{ objectId: object.id, start: 0.2, end: 0.4, speed: 1.2 },
			{ objectId: object.id, start: 0.42, end: 0.7, speed: 1.2 }
		];
		const original = structuredClone(performance.surfaceContacts);
		const interrupted = new Float32Array(44100);
		mixSurfaceAudio(interrupted, new Float32Array(44100), project, performance, 44100);
		expect(interrupted).toEqual(continuous);
		expect(performance.surfaceContacts).toEqual(original);
	});

	it('should keep rolling texture quiet and band limited instead of broadband static', () => {
		const project = createDemoProject();
		project.audio = { musicVolume: 0, surfaceVolume: 1, surfacesEnabled: true };
		const object = createWorldObject('rail', [0, 0, 0]);
		const performance: TPerformance = {
			duration: 1,
			dt: 1 / 240,
			objects: [object],
			samples: [],
			impacts: [],
			noteMarkers: [],
			warnings: [],
			bounds: { min: [0, 0, 0], max: [0, 0, 0] },
			surfaceContacts: [{ objectId: object.id, start: 0.2, end: 0.7, speed: 3 }]
		};
		for (const sampleRate of [44100, 48000]) {
			const audio = new Float32Array(sampleRate);
			mixSurfaceAudio(audio, new Float32Array(sampleRate), project, performance, sampleRate);
			let energy = 0;
			let differenceEnergy = 0;
			let peak = 0;
			for (let index = Math.round(0.3 * sampleRate); index < 0.6 * sampleRate; index++) {
				const value = audio[index] ?? 0;
				energy += value * value;
				differenceEnergy += (value - (audio[index - 1] ?? 0)) ** 2;
				peak = Math.max(peak, Math.abs(value));
			}
			expect(Math.sqrt(energy / (0.3 * sampleRate))).toBeGreaterThan(0.002);
			expect(peak).toBeLessThan(0.06);
			expect(Math.sqrt(differenceEnergy / energy)).toBeLessThan(0.4);
			expect(audio[Math.round(0.2 * sampleRate)]).toBe(0);
			expect(audio[Math.ceil(0.7 * sampleRate) - 1]).toBe(0);
		}
	});
});
