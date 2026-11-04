import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createProject, type TProject } from '@/modules/project';
import { autoEnd, changesHitsOnly, changesTail, createImportCommands, DEFAULT_PROJECT_END, filmTail, FINISH_TAIL, FINISH_TAIL_MAX, FINISH_TAIL_MIN, finishTail, fitsSong, fitToSongOffer, IMPORT_RELEASE_LEAD, isAutoEnd, lastPlayingLanes, SONG_TAIL } from './lane-commands';
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

	it('ends a tapped project with its last hit while the length is the untouched default', () => {
		// The review's tapped project: 6 hits ending at 0:03.6 in a 0:12 film
		const before = tapped([]);
		const after = tapped([0.6, 1.2, 1.8, 2.4, 3, 3.6]);

		expect(autoEnd(before, after)).toBe(4);
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

describe('finishTail', () => {
	it('should end 0.1 s after the marble leaves the frame, within its bounds', () => {
		expect(finishTail(1)).toBe(1.1);
		expect(finishTail(0.2)).toBe(FINISH_TAIL_MIN);
		expect(finishTail(1.71)).toBe(FINISH_TAIL_MAX);
		expect(finishTail(Number.POSITIVE_INFINITY)).toBe(FINISH_TAIL_MAX);
		expect(finishTail(null)).toBe(FINISH_TAIL);
	});
});

describe('filmTail', () => {
	function withLanes(times: number[][], finishes: string[] = [], end = 4): TProject {
		const project = createProject({ id: 'finish', title: 'Finish' });
		const lanes = times.map((hits, index) => ({ ...(project.music.lanes[0] as TProject['music']['lanes'][number]), id: `lane-${index}`, hits: hits.map((time, hit) => ({ id: `h${index}-${hit}`, time })) }));
		const entities = finishes.map((laneId) => ({
			id: `finish-${laneId}`,
			components: { piece: { type: 'finish', params: {} }, hitLink: { laneId, hitId: 'h0-0', angle: 0, contactAt: 0.5, anchored: true } }
		}));
		return { ...project, end, music: { ...project.music, lanes }, entities: [...project.entities, ...entities] };
	}

	it('runs the Finish tail only when every marble that plays last has a Finish', () => {
		expect(lastPlayingLanes(withLanes([[1, 3], [2.5]]))).toEqual(['lane-0', 'lane-1']);
		expect(lastPlayingLanes(withLanes([[1, 6], [2.5]]))).toEqual(['lane-0']);
		expect(filmTail(withLanes([[1, 3], [2.5]], ['lane-0']))).toBe(SONG_TAIL);
		expect(filmTail(withLanes([[1, 3], [2.5]], ['lane-0', 'lane-1']))).toBe(FINISH_TAIL);
		expect(filmTail(withLanes([[1, 6], [2.5]], ['lane-0']))).toBe(FINISH_TAIL);
	});

	it('lengthens a film that follows the song when the last marble gets its Finish, and only then', () => {
		const before = withLanes([[1, 3.6]], [], 4);
		const after = withLanes([[1, 3.6]], ['lane-0'], 4);
		expect(changesTail([{ type: 'upsertEntity', entity: after.entities[after.entities.length - 1] as TProject['entities'][number] }], before, after)).toBe(true);
		expect(autoEnd(before, after)).toBe(3.6 + FINISH_TAIL);
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
	function withLast(end: number, finish: boolean): TProject {
		const project = createProject({ id: 'p', title: 'T' });
		const laneId = project.music.lanes[0]?.id as string;
		const [, , next] = applyProjectCommands(project, [
			{ type: 'upsertHits', laneId, hits: [{ id: 'h', time: 33 }] },
			{ type: 'setEnd', end },
			...(finish ? [{ type: 'upsertEntity' as const, entity: { id: 'f', components: { piece: { type: 'finish', params: {} }, hitLink: { laneId, hitId: 'h', angle: 0, contactAt: 0.5, anchored: true } } } as never }] : [])
		]);
		return next as TProject;
	}

	it('should say a length fits at the song tail without a Finish', () => {
		expect(fitsSong(withLast(33.4, false))).toBe(true);
		expect(fitsSong(withLast(33.7, false))).toBe(false);
	});

	it('should say any measured tail fits with a Finish, the reported 0:33.70 included', () => {
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
