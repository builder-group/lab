import { describe, expect, it } from 'vitest';
import type { TNote } from '../project';
import { parsePianoClipboard, pastePianoNotes, serializePianoClipboard } from './piano-clipboard';

describe('piano clipboard functions', () => {
	it('should copy musical values relative to the earliest onset without source identities', () => {
		const text = serializePianoClipboard([
			{ id: 'later', trackId: 'source', time: 3.375, duration: 0.5, midi: 67, velocity: 0.8 },
			{ id: 'first', trackId: 'source', time: 2, duration: 2, midi: 60, velocity: 0 }
		]);
		if (text == null) throw new Error('Expected a serializable phrase');
		const parsed = parsePianoClipboard(text);
		expect(parsed).toEqual({
			kind: 'notes',
			notes: [
				{ time: 1.375, duration: 0.5, midi: 67, velocity: 0.8 },
				{ time: 0, duration: 2, midi: 60, velocity: 0 }
			]
		});
		expect(text).not.toContain('source');
		expect(text).not.toContain('later');
	});

	it('should paste fresh unlinked notes into the destination track with one snapped anchor', () => {
		const phrase = [
			{ time: 0, duration: 0.5, midi: 0, velocity: 0.25 },
			{ time: 0.17, duration: 0.8, midi: 127, velocity: 1 }
		];
		const notes = pastePianoNotes(phrase, 'destination', 2.11, { mode: 'beat', bpm: 120, fps: 30 });
		const repeated = pastePianoNotes(phrase, 'destination', 2.11, {
			mode: 'beat',
			bpm: 120,
			fps: 30
		});
		expect(notes.map(({ id, ...note }) => note)).toEqual([
			{ trackId: 'destination', time: 2, duration: 0.5, midi: 0, velocity: 0.25 },
			{ trackId: 'destination', time: 2.17, duration: 0.8, midi: 127, velocity: 1 }
		]);
		expect(new Set([...notes, ...repeated].map((note) => note.id)).size).toBe(4);
	});

	it('should retain exact offsets with snapping off and leave project-bound rejection to atomic add', () => {
		const notes = pastePianoNotes(
			[{ time: 0, duration: 2, midi: 60, velocity: 1 }],
			'track',
			119.125,
			{ mode: 'off', bpm: 120, fps: 30 }
		);
		expect(notes[0]?.time).toBe(119.125);
		expect(notes[0]?.duration).toBe(2);
	});

	it('should ignore foreign text while rejecting malformed and unsupported own-format content', () => {
		expect(parsePianoClipboard('A phrase from another app')).toEqual({ kind: 'foreign' });
		for (const text of ['{', 'null', '{"version":2,"notes":[]}', '{"version":1,"notes":[]}']) {
			expect(parsePianoClipboard('MidiMarble piano\n' + text)).toEqual({ kind: 'invalid' });
		}
	});

	it('should discard untrusted extra fields instead of transferring source IDs or bindings', () => {
		const text =
			'MidiMarble piano\n' +
			JSON.stringify({
				version: 1,
				notes: [
					{
						time: 0,
						duration: 1,
						midi: 60,
						velocity: 1,
						id: 'source',
						trackId: 'old',
						binding: { noteId: 'object' }
					}
				]
			});
		expect(parsePianoClipboard(text)).toEqual({
			kind: 'notes',
			notes: [{ time: 0, duration: 1, midi: 60, velocity: 1 }]
		});
	});

	it('should reject nonfinite, out-of-bounds and wrongly typed musical values', () => {
		const base = { time: 0, duration: 1, midi: 60, velocity: 0.5 };
		for (const patch of [
			{ time: -1 },
			{ time: 1 },
			{ time: '0' },
			{ duration: 0 },
			{ duration: 121 },
			{ midi: 60.5 },
			{ midi: 128 },
			{ velocity: -0.1 },
			{ velocity: 1.1 },
			{ velocity: null }
		]) {
			const text =
				'MidiMarble piano\n' + JSON.stringify({ version: 1, notes: [{ ...base, ...patch }] });
			expect(parsePianoClipboard(text)).toEqual({ kind: 'invalid' });
		}
		expect(
			parsePianoClipboard(
				'MidiMarble piano\n{"version":1,"notes":[{"time":0,"duration":1e400,"midi":60,"velocity":1}]}'
			)
		).toEqual({ kind: 'invalid' });
	});

	it('should cap clipboard size and note count before accepting a phrase', () => {
		const note: TNote = { id: 'a', trackId: 'track', time: 0, duration: 1, midi: 60, velocity: 1 };
		const maximum = serializePianoClipboard(Array.from({ length: 2000 }, () => note));
		if (maximum == null) throw new Error('Expected the maximum-sized phrase to serialize');
		expect(parsePianoClipboard(maximum).kind).toBe('notes');
		expect(serializePianoClipboard(Array.from({ length: 2001 }, () => note))).toBeNull();
		const tooMany =
			'MidiMarble piano\n' + JSON.stringify({ version: 1, notes: Array(2001).fill(note) });
		expect(parsePianoClipboard(tooMany)).toEqual({ kind: 'invalid' });
		expect(parsePianoClipboard('MidiMarble piano\n' + ' '.repeat(512_000))).toEqual({
			kind: 'invalid'
		});
	});
});
