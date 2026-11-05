import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createProject, type TProject } from '@/modules/project';
import { createImportCommands, DEFAULT_PROJECT_END, filmTail, BOWL_TAIL, BOWL_TAIL_MAX, BOWL_TAIL_MIN, bowlTail, IMPORT_RELEASE_LEAD, isAutoEnd, lastPlayingMarbles, SONG_TAIL } from './marble-commands';
import type { TMidiNote } from './midi';

function note(time: number, pitch: number): TMidiNote {
	return { time, pitch, duration: 0.2, velocity: 0.8 };
}

describe('createImportCommands', () => {
	it('releases each marble a short lead before its first note', () => {
		const project = createProject({ id: 'import', title: 'Import' });
		const commands = createImportCommands(project, { marbles: [[note(2, 60), note(2.5, 62)], [note(0.1, 48)]] });
		const [isApplied, applyErr, next] = applyProjectCommands(project, commands);
		if (!isApplied) throw applyErr;
		const releases = next.entities.map((entity) => entity.components.release?.time).filter((time) => time != null);

		expect(releases).toHaveLength(2);
		expect(releases[0]).toBeCloseTo(2 - IMPORT_RELEASE_LEAD, 6);
		// A note earlier than the lead keeps the release at the start
		expect(releases[1]).toBe(0);
	});

	it('should keep every note, with the notes no marble plays in Backing', () => {
		const project = createProject({ id: 'import', title: 'Import' });
		const commands = createImportCommands(project, { marbles: [[note(1, 60)]], backing: [note(1, 55), note(1.1, 52)], backingInstrument: 0 });
		const [isApplied, applyErr, next] = applyProjectCommands(project, commands);
		if (!isApplied) throw applyErr;

		expect(next.music.marbles[0]?.hits.map((hit) => hit.duration)).toEqual([0.2]);
		expect(next.music.backing.map((hit) => hit.pitch)).toEqual([55, 52]);
		expect(next.music.backingInstrument).toBe(0);
	});
});

describe('film length', () => {
	function tapped(times: number[], end = DEFAULT_PROJECT_END): TProject {
		const project = createProject({ id: 'tap', title: 'Tap' });
		const marble = project.music.marbles[0];
		if (marble != null) marble.hits = times.map((time, index) => ({ id: `h${index}`, time }));
		return { ...project, length: end };
	}

	it('starts from the length of a new project', () => {
		expect(createProject().length).toBe(DEFAULT_PROJECT_END);
	});

	it('tells a length left as the song set it from one the user set', () => {
		expect(isAutoEnd(tapped([0.2]))).toBe(true);
		expect(isAutoEnd(tapped([1, 3.6], 4))).toBe(true);
		expect(isAutoEnd(tapped([1, 3.6], 20))).toBe(false);
	});

});

describe('bowlTail', () => {
	it('should end 0.1 s after the marble leaves the frame, within its bounds', () => {
		expect(bowlTail(1)).toBe(1.1);
		expect(bowlTail(0.2)).toBe(BOWL_TAIL_MIN);
		expect(bowlTail(1.71)).toBe(BOWL_TAIL_MAX);
		expect(bowlTail(Number.POSITIVE_INFINITY)).toBe(BOWL_TAIL_MAX);
		expect(bowlTail(null)).toBe(BOWL_TAIL);
	});
});

describe('filmTail', () => {
	function withMarbles(times: number[][], bowls: string[] = [], end = 4): TProject {
		const project = createProject({ id: 'bowl', title: 'Bowl' });
		const marbles = times.map((hits, index) => ({ ...(project.music.marbles[0] as TProject['music']['marbles'][number]), id: `lane-${index}`, hits: hits.map((time, hit) => ({ id: `h${index}-${hit}`, time })) }));
		const entities = bowls.map((marbleId) => ({
			id: `bowl-${marbleId}`,
			components: { piece: { type: 'bowl', params: {} }, hitLink: { marbleId, hitId: 'h0-0', angle: 0, contactAt: 0.5, anchored: true } }
		}));
		return { ...project, length: end, music: { ...project.music, marbles }, entities: [...project.entities, ...entities] };
	}

	it('runs the Bowl tail only when every marble that plays last has a Bowl', () => {
		expect(lastPlayingMarbles(withMarbles([[1, 3], [2.5]]))).toEqual(['lane-0', 'lane-1']);
		expect(lastPlayingMarbles(withMarbles([[1, 6], [2.5]]))).toEqual(['lane-0']);
		expect(filmTail(withMarbles([[1, 3], [2.5]], ['lane-0']))).toBe(SONG_TAIL);
		expect(filmTail(withMarbles([[1, 3], [2.5]], ['lane-0', 'lane-1']))).toBe(BOWL_TAIL);
		expect(filmTail(withMarbles([[1, 6], [2.5]], ['lane-0']))).toBe(BOWL_TAIL);
	});

	it('counts a measured Bowl tail as following the song', () => {
		expect(isAutoEnd(withMarbles([[1, 3.6]], ['lane-0'], 4.8))).toBe(true);
		expect(isAutoEnd(withMarbles([[1, 3.6]], ['lane-0'], 4.7))).toBe(true);
		expect(isAutoEnd(withMarbles([[1, 3.6]], [], 4.7))).toBe(false);
	});
});
