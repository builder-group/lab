import { createState } from 'feature-state';
import type { TProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import type { StudioCx, TWorkspace } from './StudioCx';

/**
 * First-run hints: at most three one-line hints, each shown once, where the next step is. A hint opens when its
 * step becomes possible, counts as seen once it is on screen, and closes when its step is done or it is dismissed.
 */
export class HintsCx {
	/** The hint that should show now; the hint layer draws it once its anchor is on screen */
	readonly $open = createState<THintId | null>(null);
	/** Hints that were shown or whose step was done, remembered across launches */
	readonly $seen = createState<THintId[]>(readSeen());
	private mark: THintMark = { editCount: 0, openCount: 0 };

	constructor(private readonly studio: StudioCx) {}

	mount(): () => void {
		const { studio } = this;
		const evaluate = (): void => this.evaluate();
		const stops = [
			studio.$history.listen(evaluate),
			studio.simulation.$result.listen(evaluate),
			studio.$playing.listen(evaluate),
			studio.$workspace.listen(evaluate),
			// A hint belongs to the project it was opened for
			studio.$path.listen(() => {
				this.$open.set(null);
				evaluate();
			}),
			this.$seen.listen(({ value }) => writeSeen(value))
		];
		return () => {
			for (const stop of stops) stop();
		};
	}

	/** Called by the hint layer when the hint is on screen */
	markSeen(id: THintId): void {
		if (!this.$seen.get().includes(id)) this.$seen.set([...this.$seen.get(), id]);
	}

	dismiss(id: THintId): void {
		this.markSeen(id);
		if (this.$open.get() === id) this.$open.set(null);
		this.evaluate();
	}

	/** Reset Hints: every hint can show again */
	reset(): void {
		this.$open.set(null);
		this.$seen.set([]);
		this.evaluate();
	}

	private evaluate(): void {
		const project = this.studio.project;
		if (project == null) {
			this.$open.set(null);
			return;
		}
		const facts = hintFacts(project, this.studio.$history.get()?.past.length ?? 0, this.studio.simulation.$result.get(), {
			workspace: this.studio.$workspace.get(),
			isPlaying: this.studio.$playing.get()
		});
		const next = stepHints({ open: this.$open.get(), seen: this.$seen.get(), mark: this.mark }, facts);
		this.mark = next.mark;
		if (next.seen !== this.$seen.get()) this.$seen.set(next.seen);
		if (next.open !== this.$open.get()) this.$open.set(next.open);
	}
}

export type THintId = 'song' | 'tap' | 'dot' | 'film';

/** One line each, in the words of `docs/words.md` (sentence case, no period) */
export const hintTexts: Record<THintId, string> = {
	song: 'This is your song: each marble plays some of its notes',
	tap: 'Press T to add a hit at the playhead, or play and tap along with T',
	dot: 'Press N for the next platform, or ⇧N to build the whole track',
	film: 'Switch to Film to choose a theme and export'
};

/** What the hints depend on, read from the open project and its latest run */
export interface THintFacts {
	hasSong: boolean;
	// Any marble has a hit
	hasHits: boolean;
	workspace: TWorkspace;
	isPlaying: boolean;
	// Edits made since the project opened
	editCount: number;
	// Notes without a platform yet; null while the run belongs to an older revision
	openCount: number | null;
	// A piece is on the wall, so the step the dot's hint names has been found
	hasPieces: boolean;
	// Every hit has a platform and is on time
	isAllOnTime: boolean;
}

export interface THintState {
	open: THintId | null;
	seen: THintId[];
	// The facts when the open hint opened, to tell when its step is done
	mark: THintMark;
}

interface THintMark {
	editCount: number;
	openCount: number;
}

export function hintFacts(
	project: TProject,
	editCount: number,
	result: TSimulationResult | null,
	view: { workspace: TWorkspace; isPlaying: boolean }
): THintFacts {
	const isCurrent = result != null && result.revision === project.revision;
	const hits = isCurrent ? result.hits : [];
	return {
		hasSong: project.songs.some((song) => song.path != null),
		hasHits: project.marbles.some((marble) => marble.hits.length > 0),
		workspace: view.workspace,
		isPlaying: view.isPlaying,
		editCount,
		openCount: isCurrent ? hits.filter((hit) => hit.status === 'open').length : null,
		hasPieces: project.track.pieces.length > 0,
		isAllOnTime: hits.length > 0 && hits.every((hit) => hit.status === 'onTime')
	};
}

/**
 * The next hint state. The open hint closes when its step is done: the song once it plays or the project is
 * edited, tapping once a marble has a hit, the dot once a platform fills a note, Film once Film is open.
 * Then the next unseen hint whose step is possible opens: the song first, tapping once a song has no hits yet, the dot
 * after those, Film after the first edit that leaves every hit on time.
 */
export function stepHints(state: THintState, facts: THintFacts): THintState {
	let { open, seen } = state;
	const { mark } = state;
	if (open != null && isStepDone(open, mark, facts)) {
		seen = seen.includes(open) ? seen : [...seen, open];
		open = null;
	}
	if (open != null) return { open, seen, mark };
	const next = hintOrder.find((id) => !seen.includes(id) && canOpen(id, seen, facts));
	if (next == null) return { open: null, seen, mark };
	return { open: next, seen, mark: { editCount: facts.editCount, openCount: facts.openCount ?? 0 } };
}

const hintOrder: THintId[] = ['song', 'tap', 'dot', 'film'];

function isStepDone(id: THintId, mark: THintMark, facts: THintFacts): boolean {
	switch (id) {
		case 'song':
			return facts.isPlaying || facts.editCount > mark.editCount;
		case 'tap':
			return facts.hasHits;
		case 'dot':
			return facts.openCount != null && facts.openCount < mark.openCount;
		case 'film':
			return facts.workspace === 'film';
	}
}

function canOpen(id: THintId, seen: THintId[], facts: THintFacts): boolean {
	if (facts.workspace !== 'track') return false;
	switch (id) {
		case 'song':
			return facts.hasSong;
		case 'tap':
			return facts.hasSong && !facts.hasHits;
		case 'dot':
			return (seen.includes('song') || !facts.hasSong) && !facts.hasPieces && (facts.openCount ?? 0) > 0;
		case 'film':
			return facts.isAllOnTime && facts.editCount > 0;
	}
}

const HINTS_KEY = 'midimarble-v4:hints-seen';

function readSeen(): THintId[] {
	try {
		const stored = JSON.parse(localStorage.getItem(HINTS_KEY) ?? '[]') as unknown;
		return Array.isArray(stored) ? hintOrder.filter((id) => stored.includes(id)) : [];
	} catch {
		return [];
	}
}

function writeSeen(seen: THintId[]): void {
	try {
		localStorage.setItem(HINTS_KEY, JSON.stringify(seen));
	} catch {
		// Storage can be unavailable; hints then show again on the next launch
	}
}
