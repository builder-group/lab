import { describe, expect, it } from 'vitest';
import { stepHints, type THintFacts, type THintState } from './HintsCx';

const empty: THintState = { open: null, seen: [], mark: { editCount: 0, openCount: 0 } };

function facts(overrides: Partial<THintFacts> = {}): THintFacts {
	return { hasSong: true, workspace: 'compose', isPlaying: false, editCount: 0, openCount: 3, isAllOnTime: false, ...overrides };
}

describe('stepHints function', () => {
	it('should open the song hint first when the project has a song', () => {
		expect(stepHints(empty, facts()).open).toBe('song');
	});

	it('should close the song hint once the song plays or the project is edited', () => {
		// Prepare
		const opened = stepHints(empty, facts());

		// Act
		const played = stepHints(opened, facts({ isPlaying: true }));
		const edited = stepHints(opened, facts({ editCount: 1 }));

		// Assert
		expect(played.seen).toContain('song');
		expect(edited.seen).toContain('song');
		expect(stepHints(opened, facts()).open).toBe('song');
	});

	it('should open the dot hint after the song hint and close it when a platform fills a note', () => {
		// Prepare
		const afterSong: THintState = { ...empty, seen: ['song'] };

		// Act
		const opened = stepHints(afterSong, facts({ openCount: 3 }));
		const placed = stepHints(opened, facts({ openCount: 2, editCount: 1 }));

		// Assert
		expect(opened.open).toBe('dot');
		expect(placed.open).toBeNull();
		expect(placed.seen).toEqual(['song', 'dot']);
	});

	it('should skip the song hint for a project without a song', () => {
		expect(stepHints(empty, facts({ hasSong: false })).open).toBe('dot');
	});

	it('should wait for a current run before offering the dot', () => {
		expect(stepHints({ ...empty, seen: ['song'] }, facts({ openCount: null })).open).toBeNull();
	});

	it('should offer Film only after an edit leaves every hit on time and close it in Film', () => {
		// Prepare
		const earlier: THintState = { ...empty, seen: ['song', 'dot'] };

		// Act
		const untouched = stepHints(earlier, facts({ isAllOnTime: true, openCount: 0 }));
		const opened = stepHints(earlier, facts({ isAllOnTime: true, openCount: 0, editCount: 2 }));
		const inFilm = stepHints(opened, facts({ isAllOnTime: true, openCount: 0, editCount: 2, workspace: 'design' }));

		// Assert
		expect(untouched.open).toBeNull();
		expect(opened.open).toBe('film');
		expect(inFilm.open).toBeNull();
		expect(inFilm.seen).toContain('film');
	});

	it('should never open a hint again once seen', () => {
		const state: THintState = { ...empty, seen: ['song', 'dot', 'film'] };
		expect(stepHints(state, facts({ isAllOnTime: true, editCount: 4 })).open).toBeNull();
	});

	it('should not open hints in Film', () => {
		expect(stepHints(empty, facts({ workspace: 'design' })).open).toBeNull();
	});
});
