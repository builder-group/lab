import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createProject, type TProject } from '@/modules/project';
import { autoEnd, changesHitsOnly, createImportCommands, DEFAULT_PROJECT_END, fitToSongOffer, IMPORT_RELEASE_LEAD, isAutoEnd } from './lane-commands';
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
