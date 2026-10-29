import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './project';
import {
	getProjectFileName,
	parseProjectFile,
	readWorkingProject,
	serializeProjectFile
} from './project-file';
import { createAuthoredTestProject } from './fixtures/authored-project';

describe('project-file module', () => {
	describe('serializeProjectFile function', () => {
		it('should roundtrip a complete authored project in a tagged JSON document', () => {
			const project = createAuthoredTestProject();
			project.tempos = [{ time: 0, bpm: 120 }, { time: 12, bpm: 98 }];
			project.titles = [{ id: 'title', time: 1, duration: 2, text: 'Portable scene' }];
			const track = project.tracks[0];
			if (track == null) throw new Error('Expected an authored track.');
			track.controls = [{ number: 64, time: 1, value: 1 }];
			track.pitchBends = [{ time: 2, value: -0.25 }];

			const text = serializeProjectFile(project);
			const document = JSON.parse(text);

			expect(document).toEqual({ format: 'midimarble', ...project });
			expect(text.startsWith('{\n  "format": "midimarble",\n')).toBe(true);
			expect(text.endsWith('\n')).toBe(true);
			expect(parseProjectFile(text)).toEqual(project);
			expect(serializeProjectFile(parseProjectFile(text))).toBe(text);
		});

		it('should exclude derived performances and local editor state from the portable document', () => {
			const project = {
				...createEmptyProject(),
				performance: { samples: [{ time: 0, position: [0, 0, 0] }] },
				selection: ['object-1'],
				history: { past: [] },
				panels: { inspector: 400 }
			};
			expect(JSON.parse(serializeProjectFile(project))).toEqual({
				format: 'midimarble',
				...createEmptyProject(),
				id: project.id
			});
		});
	});

	describe('parseProjectFile function', () => {
		it('should preserve legacy untagged projects without requiring a migration', () => {
			const project = createAuthoredTestProject();
			expect(parseProjectFile(JSON.stringify(project))).toEqual(project);
		});

		it.each(['another-app', '', null, 1])('should reject the foreign format tag %s', (format) => {
			const text = JSON.stringify({ ...createEmptyProject(), format });
			expect(() => parseProjectFile(text)).toThrow('different project format');
		});

		it('should reject unsupported document versions with a useful error', () => {
			const text = JSON.stringify({ ...createEmptyProject(), format: 'midimarble', version: 2 });
			expect(() => parseProjectFile(text)).toThrow('version is not supported');
		});

		it.each(['{', '{"format":"midimarble",', '', 'not JSON'])(
			'should reject malformed or truncated input %s',
			(text) => {
				expect(() => parseProjectFile(text)).toThrow('not valid JSON');
			}
		);

		it('should apply the document validator to tagged files', () => {
			const project = createEmptyProject();
			const text = JSON.stringify({
				...project,
				format: 'midimarble',
				notes: [{ id: 'note', trackId: 'missing', time: 0, duration: 1, midi: 60, velocity: 1 }]
			});
			expect(() => parseProjectFile(text)).toThrow('missing music track');
		});

		it('should reject oversized text before attempting to parse it', () => {
			expect(() => parseProjectFile(' '.repeat(20 * 1024 * 1024 + 1))).toThrow('smaller than 20 MB');
		});

		it('should enforce the file size limit for multibyte text', () => {
			expect(() => parseProjectFile('雪'.repeat(Math.ceil((20 * 1024 * 1024) / 3)))).toThrow(
				'smaller than 20 MB'
			);
		});
	});

	describe('getProjectFileName function', () => {
		it('should retain Unicode and use exactly one native extension', () => {
			expect(getProjectFileName({ name: ' 雪のワルツ 🎵.MARBLE ' })).toBe('雪のワルツ 🎵.marble');
		});

		it('should remove path separators, control characters and reserved punctuation', () => {
			const fileName = getProjectFileName({ name: '../folder\\song:\n"take"?' });
			expect(fileName).toBe('-folder-song---take--.marble');
		});

		it.each(['', '   ', '...', '.marble'])(
			'should use a sensible filename for an empty name %s',
			(name) => {
				expect(getProjectFileName({ name })).toBe('Untitled scene.marble');
			}
		);

		it('should avoid reserved device filenames and trailing dots', () => {
			expect(getProjectFileName({ name: 'CON' })).toBe('_CON.marble');
			expect(getProjectFileName({ name: 'Song. ' })).toBe('Song.marble');
		});

		it('should limit long Unicode filenames without splitting a character', () => {
			expect(getProjectFileName({ name: '🎵'.repeat(80) })).toBe(`${'🎵'.repeat(50)}.marble`);
		});
	});

	describe('readWorkingProject function', () => {
		it('should distinguish a missing working copy from a corrupt one', () => {
			expect(readWorkingProject(null)).toEqual({ project: null, error: null });
			expect(readWorkingProject('{')).toEqual({
				project: null,
				error: expect.stringContaining('not valid JSON')
			});
		});

		it('should restore a legacy autosave or a native project file', () => {
			const project = createEmptyProject();
			expect(readWorkingProject(JSON.stringify(project))).toEqual({ project, error: null });
			expect(readWorkingProject(serializeProjectFile(project))).toEqual({ project, error: null });
		});
	});
});
