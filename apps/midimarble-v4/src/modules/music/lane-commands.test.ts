import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createProject, type TProject } from '@/modules/project';
import { autoEnd, changesHitsOnly, changesTail, createImportCommands, DEFAULT_PROJECT_END, filmTail, BOWL_TAIL, BOWL_TAIL_MAX, BOWL_TAIL_MIN, bowlTail, fitsSong, fitToSongOffer, IMPORT_RELEASE_LEAD, isAutoEnd, lastPlayingLanes, SONG_TAIL } from './lane-commands';
import type { TMidiNote } from './midi';

function note(time: number, pitch: number): TMidiNote {
	return { time, pitch, duration: 0.2, velocity: 0.8 };
}

describe('createImportCommands', () => {
	it('releases each marble a short lead before its first note', () => {
		const project = createProject({ id: 'import', title: 'Import' });
		const commands = createImportCommands(project, { lanes: [[note(2, 60), note(2.5, 62)], [note(0.1, 48)]] });
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
		const commands = createImportCommands(project, { lanes: [[note(1, 60)]], backing: [note(1, 55), note(1.1, 52)], backingInstrument: 0 });
		const [isApplied, applyErr, next] = applyProjectCommands(project, commands);
		if (!isApplied) throw applyErr;

		expect(next.music.lanes[0]?.hits.map((hit) => hit.duration)).toEqual([0.2]);
		expect(next.music.backing.map((hit) => hit.pitch)).toEqual([55, 52]);
		expect(next.music.backingInstrument).toBe(0);
	});
});

describe('autoEnd', () => {
	function tapped(times: number[], end = DEFAULT_PROJECT_END): TProject {
		const project = createProject({ id: 'tap', title: 'Tap' });
		const lane = project.music.lanes[0];
		if (lane != null) lane.hits = times.map((time, index) => ({ id: `h${index}`, time }));
		return { ...project, end };
	}

	it('starts from the length of a new project', () => {
		expect(createProject().end).toBe(DEFAULT_PROJECT_END);
	});

	it('keeps the length of a tapped film, however many hits it gets, until Fit to Song', () => {
		// The review's tapped project: 6 hits ending at 0:03.6 in a 0:12 film
		expect(autoEnd(tapped([]), tapped([0.6, 1.2, 1.8, 2.4, 3, 3.6]))).toBeNull();
		expect(autoEnd(tapped([]), tapped([0.2]))).toBeNull();
		expect(autoEnd(tapped([0.2, 0.7, 1.2]), tapped([0.2, 0.7, 1.2, 1.7]))).toBeNull();
		// Fit to Song chose a shorter film, so the next hit does not jump back to the default
		expect(autoEnd(tapped([0.2], 0.6), tapped([0.2, 0.5], 0.6))).toBe(0.9);
		expect(isAutoEnd(tapped([0.2]))).toBe(true);
	});

	it('keeps following the song after the fit, and lengthens for hits past the end', () => {
		const fitted = tapped([1, 3.6], 4);
		expect(isAutoEnd(fitted)).toBe(true);

		expect(autoEnd(fitted, tapped([1, 3.6, 5], 4))).toBe(5.4);
	});

	it('never changes a length the user set', () => {
		const set = tapped([1, 3.6], 20);

		expect(isAutoEnd(set)).toBe(false);
		expect(autoEnd(set, tapped([1, 3.6, 5], 20))).toBeNull();
	});

	it('offers Fit to Song where the user set a length the song no longer matches', () => {
		expect(fitToSongOffer(tapped([1, 3.6], 20))).toBe(4);
		// Hits past a length the user set are cut off
		expect(fitToSongOffer(tapped([1, 3.6], 3))).toBe(4);
		expect(fitToSongOffer(tapped([1, 3.6], 4.5))).toBeNull();
		expect(fitToSongOffer(tapped([1, 3.6]))).toBeNull();
	});

	it('follows the song only for edits of the notes, not one that sets the length', () => {
		expect(changesHitsOnly([{ type: 'upsertHits', laneId: 'l', hits: [] }])).toBe(true);
		expect(changesHitsOnly([{ type: 'upsertHits', laneId: 'l', hits: [] }, { type: 'setEnd', end: 3 }])).toBe(false);
		expect(changesHitsOnly([{ type: 'setTitle', title: 'Song' }])).toBe(false);
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
	function withLanes(times: number[][], bowls: string[] = [], end = 4): TProject {
		const project = createProject({ id: 'bowl', title: 'Bowl' });
		const lanes = times.map((hits, index) => ({ ...(project.music.lanes[0] as TProject['music']['lanes'][number]), id: `lane-${index}`, hits: hits.map((time, hit) => ({ id: `h${index}-${hit}`, time })) }));
		const entities = bowls.map((laneId) => ({
			id: `bowl-${laneId}`,
			components: { piece: { type: 'bowl', params: {} }, hitLink: { laneId, hitId: 'h0-0', angle: 0, contactAt: 0.5, anchored: true } }
		}));
		return { ...project, end, music: { ...project.music, lanes }, entities: [...project.entities, ...entities] };
	}

	it('runs the Bowl tail only when every marble that plays last has a Bowl', () => {
		expect(lastPlayingLanes(withLanes([[1, 3], [2.5]]))).toEqual(['lane-0', 'lane-1']);
		expect(lastPlayingLanes(withLanes([[1, 6], [2.5]]))).toEqual(['lane-0']);
		expect(filmTail(withLanes([[1, 3], [2.5]], ['lane-0']))).toBe(SONG_TAIL);
		expect(filmTail(withLanes([[1, 3], [2.5]], ['lane-0', 'lane-1']))).toBe(BOWL_TAIL);
		expect(filmTail(withLanes([[1, 6], [2.5]], ['lane-0']))).toBe(BOWL_TAIL);
	});

	it('lengthens a film that follows the song when the last marble gets its Bowl, and only then', () => {
		const before = withLanes([[1, 3.6]], [], 4);
		const after = withLanes([[1, 3.6]], ['lane-0'], 4);
		expect(changesTail([{ type: 'upsertEntity', entity: after.entities[after.entities.length - 1] as TProject['entities'][number] }], before, after)).toBe(true);
		expect(autoEnd(before, after)).toBe(3.6 + BOWL_TAIL);
		// A length the user set stays theirs, and Fit to Song offers the longer one
		expect(isAutoEnd(withLanes([[1, 3.6]], ['lane-0'], 4.8))).toBe(true);
		expect(fitToSongOffer(withLanes([[1, 3.6]], ['lane-0'], 9))).toBe(4.8);
		expect(autoEnd(withLanes([[1, 3.6]], [], 9), withLanes([[1, 3.6]], ['lane-0'], 9))).toBeNull();
		// A measured tail counts as following the song and carries over to the next edit
		expect(isAutoEnd(withLanes([[1, 3.6]], ['lane-0'], 4.7))).toBe(true);
		expect(autoEnd(withLanes([[1, 3.6]], ['lane-0'], 4.7), withLanes([[1, 3.6, 4]], ['lane-0'], 4.7))).toBe(5.1);
		expect(isAutoEnd(withLanes([[1, 3.6]], [], 4.7))).toBe(false);
	});
});

describe('fitsSong', () => {
	function withLast(end: number, bowl: boolean): TProject {
		const project = createProject({ id: 'p', title: 'T' });
		const laneId = project.music.lanes[0]?.id as string;
		const [, , next] = applyProjectCommands(project, [
			{ type: 'upsertHits', laneId, hits: [{ id: 'h', time: 33 }] },
			{ type: 'setEnd', end },
			...(bowl ? [{ type: 'upsertEntity' as const, entity: { id: 'f', components: { piece: { type: 'bowl', params: {} }, hitLink: { laneId, hitId: 'h', angle: 0, contactAt: 0.5, anchored: true } } } as never }] : [])
		]);
		return next as TProject;
	}

	it('should say a length fits at the song tail without a Bowl', () => {
		expect(fitsSong(withLast(33.4, false))).toBe(true);
		expect(fitsSong(withLast(33.7, false))).toBe(false);
	});

	it('should say any measured tail fits with a Bowl, the reported 0:33.70 included', () => {
		expect(fitsSong(withLast(33.7, true))).toBe(true);
		expect(fitsSong(withLast(33.4, true))).toBe(false);
		expect(fitsSong(withLast(36, true))).toBe(false);
	});
});

describe('createImportCommands names', () => {
	it('should name marbles as asked and keep a name another marble has', () => {
		const project = createProject({ id: 'p', title: 'T' });
		const [, , next] = applyProjectCommands(project, createImportCommands(project, { lanes: [[note(1, 60)], [note(1, 50)]], names: ['Melody', null] }));
		expect(next?.music.lanes.map((lane) => lane.name)).toEqual(['Melody', 'Marble 2']);
		expect(next?.entities.filter((entity) => entity.components.marble != null).map((entity) => entity.name)).toEqual(['Melody', 'Marble 2']);
	});
});
