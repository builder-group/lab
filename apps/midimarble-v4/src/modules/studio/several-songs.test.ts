import { describe, expect, it } from 'vitest';
import { createImportCommands, type TMidiFile } from '@/modules/music';
import { applyProjectCommands, backingOf, createMarble, createProject, type THit, type TProject, type TSong } from '@/modules/project';
import { previewMidiImport, type TMidiImport } from './SourcesCx';
import type { StudioCx } from './StudioCx';
import { suggestedHitChoices, suggestedHits } from './suggested-hits';

const FIRST: TSong = { id: 'first', kind: 'midi', path: 'a.mid', name: 'a.mid', start: 1, backing: [{ id: 'kept', time: 2, pitch: 40 }] };
const note = (time: number) => ({ time, pitch: 60, velocity: 0.8, duration: 0.2, trackId: 'melody' });

function project(songs: TSong[], hits: THit[] = []): TProject {
	return { ...createProject({ title: 'Songs' }), songs, marbles: [{ ...createMarble(0, { x: 0, y: 0 }, 'melody'), hits }] };
}

function midiImport(start?: number): TMidiImport {
	const midi = { tracks: [{ id: 'melody', name: 'Melody', program: 9, isDrums: false, notes: [note(2), note(3)] }] } as unknown as TMidiFile;
	return { file: { name: 'b.mid', path: 'b.mid' }, midi, trackIds: ['melody'], options: { strategy: 'split', maxMarbles: 1 }, ...(start != null ? { start } : {}) };
}

function studio(from: TProject, onsets: Record<string, number[]>): StudioCx {
	const $analysis = { get: () => Object.fromEntries(Object.entries(onsets).map(([id, list]) => [id, { onsets: list }])) };
	return { project: from, sources: { $analysis } } as unknown as StudioCx;
}

describe('adding a second song', () => {
	it('should start its first note where it is asked, by default so its marble is released at 0', () => {
		expect(previewMidiImport(midiImport()).marbles[0]?.map((item) => item.time)).toEqual([0.5, 1.5]);
		expect(previewMidiImport(midiImport(8)).marbles[0]?.map((item) => item.time)).toEqual([8, 9]);
	});

	it('should leave the first song, its Backing and the marbles alone, and tie the new hits to the new song', () => {
		const from = project([FIRST], [{ id: 'old', time: 1, pitch: 60, songId: 'first' }]);
		const second: TSong = { id: 'second', kind: 'midi', path: 'b.mid', name: 'b.mid', start: 8, backing: [] };

		const [isOk, error, next] = applyProjectCommands(from, createImportCommands(from, { marbles: [[note(8), note(9)]], source: second, keepsBacking: true }));
		if (!isOk) throw error;

		expect(next.songs.map((song) => song.id)).toEqual(['first', 'second']);
		expect(backingOf(next).map((hit) => hit.id)).toEqual(['kept']);
		expect(next.marbles.map((marble) => marble.hits.map((hit) => hit.songId))).toEqual([['first'], ['second', 'second']]);
	});

	it("should keep another song's Backing when the marbles have no hits yet", () => {
		const from = project([FIRST]);
		const second: TSong = { id: 'second', kind: 'midi', path: 'b.mid', name: 'b.mid', start: 8, backing: [] };

		const [isOk, error, next] = applyProjectCommands(from, createImportCommands(from, { marbles: [[note(8)]], source: second, keepsBacking: true }));
		if (!isOk) throw error;

		expect(backingOf(next).map((hit) => hit.id)).toEqual(['kept']);
	});
});

describe('suggestedHits function with several recordings', () => {
	const a: TSong = { id: 'a', kind: 'audio', path: 'a.wav', name: 'a.wav', start: 1, backing: [] };
	const b: TSong = { id: 'b', kind: 'audio', path: 'b.wav', name: 'b.wav', start: 10, backing: [] };

	it("should tie each suggestion to the recording it came from, at that recording's start", () => {
		const marble = project([a, b]).marbles[0];
		if (marble == null) throw new Error('No marble');

		expect(suggestedHits(studio(project([a, b]), { a: [0.5], b: [0.5] }), marble)).toEqual([
			{ time: 1.5, songId: 'a' },
			{ time: 10.5, songId: 'b' }
		]);
	});

	it('should offer one choice per recording, naming it once there are several', () => {
		const several = project([a, b]);
		const one = project([a]);
		const marble = several.marbles[0];
		if (marble == null) throw new Error('No marble');

		expect(suggestedHitChoices(studio(several, { a: [0.5], b: [0.5, 1] }), marble).map((choice) => choice.label)).toEqual(['Add 1 Suggested Hit from a.wav', 'Add 2 Suggested Hits from b.wav']);
		expect(suggestedHitChoices(studio(one, { a: [0.5] }), marble).map((choice) => choice.label)).toEqual(['Add 1 Suggested Hit']);
	});
});
