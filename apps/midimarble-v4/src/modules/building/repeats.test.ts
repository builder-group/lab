import { describe, expect, it } from 'vitest';
import { createProject, type TProject } from '@/modules/project';
import { repeatedStretches, repeatSources, STRETCH } from './repeats';

/** One marble playing these gaps and pitches from 1 s */
function played(notes: [gap: number, pitch: number][]): TProject {
	const base = createProject();
	let time = 1;
	const hits = notes.map(([gap, pitch], index) => {
		time += gap;
		return { id: `h${index + 1}`, time, pitch };
	});
	const marble = { ...(base.marbles[0] ?? { id: 'm', name: 'Melody' }), id: 'm', hits } as TProject['marbles'][number];
	return { ...base, marbles: [marble] };
}

const PHRASE: [number, number][] = [0.5, 0.5, 1, 0.5, 0.5, 1, 0.5, 0.25].map((gap, index) => [gap, 60 + (index % 3)]);

describe('repeatedStretches', () => {
	it('finds a stretch that comes back with the same gaps and pitch steps, wherever it starts', () => {
		// The phrase, two other notes, then the phrase a fourth higher
		const project = played([...PHRASE, [2, 50], [0.3, 70], ...PHRASE.map(([gap, pitch]): [number, number] => [gap, pitch + 5])]);
		expect(repeatedStretches(project, 'm')).toEqual([{ first: 0, again: STRETCH + 2 }]);
		const sources = repeatSources(project, 'm');
		expect(sources.size).toBe(STRETCH);
		expect(sources.get(`h${STRETCH + 4}`)).toBe('h2');
	});

	it('takes nothing that differs in rhythm or melody, or overlaps its first time', () => {
		const changed = PHRASE.map(([gap, pitch], index): [number, number] => [index === 4 ? gap + 0.05 : gap, pitch]);
		expect(repeatedStretches(played([...PHRASE, ...changed]), 'm')).toEqual([]);
		const steps = PHRASE.map(([gap, pitch], index): [number, number] => [gap, index === 6 ? pitch + 1 : pitch]);
		expect(repeatedStretches(played([...PHRASE, ...steps]), 'm')).toEqual([]);
		// The same note over and over repeats itself only where a stretch has ended
		expect(repeatedStretches(played(Array.from({ length: 20 }, (): [number, number] => [0.5, 60])), 'm')).toEqual([{ first: 0, again: STRETCH }]);
	});
});
