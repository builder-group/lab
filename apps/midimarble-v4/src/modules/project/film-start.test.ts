import { describe, expect, it } from 'vitest';
import { createProject } from './create-project';
import { filmStartOf, OPENING_LEAD } from './film-start';
import type { TMarble, TProject, TSong } from './schema';

function song(overrides: Partial<TSong> = {}): TSong {
	return { id: 'song', name: 'Song', kind: 'midi', start: 0, backing: [], ...overrides };
}

function project(options: { hits?: number[]; songs?: TSong[]; start?: number }): TProject {
	const base = createProject({ title: 'Test', id: 'test' });
	const marble = base.marbles[0] as TMarble;
	return {
		...base,
		songs: options.songs ?? [],
		marbles: [{ ...marble, hits: (options.hits ?? []).map((time, index) => ({ id: `hit-${index}`, time })) }],
		film: { ...base.film, ...(options.start != null ? { start: options.start } : {}) }
	};
}

describe('filmStartOf function', () => {
	it('should open just before the first hit', () => {
		expect(filmStartOf(project({ hits: [1, 1.5] }))).toBeCloseTo(1 - OPENING_LEAD, 6);
	});

	it('should stay at the timeline start when the first hit comes sooner than the lead', () => {
		expect(filmStartOf(project({ hits: [0.15] }))).toBe(0);
	});

	it('should open at the timeline start with nothing to play', () => {
		expect(filmStartOf(project({}))).toBe(0);
	});

	it('should not cut a Backing note or a recording that starts before the first hit', () => {
		expect(filmStartOf(project({ hits: [3], songs: [song({ backing: [{ id: 'b', time: 1, pitch: 40 }] })] }))).toBeCloseTo(0.8, 6);
		expect(filmStartOf(project({ hits: [3], songs: [song({ kind: 'audio', path: 'audio/song.wav', start: 2 })] }))).toBeCloseTo(1.8, 6);
	});

	it('should land on a whole frame at 30 and 60 fps', () => {
		for (const fps of [30, 60]) {
			const frame = filmStartOf(project({ hits: [1.0177] })) * fps;
			expect(frame).toBeCloseTo(Math.round(frame), 6);
		}
	});

	it('should use the start a person set, also before the first hit', () => {
		expect(filmStartOf(project({ hits: [2], start: 0 }))).toBe(0);
		expect(filmStartOf(project({ hits: [2], start: 1 }))).toBeCloseTo(1, 6);
	});
});
