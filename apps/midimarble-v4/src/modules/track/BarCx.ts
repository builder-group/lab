import { createState } from 'feature-state';
import { acceptProposal, propose, type TProposal, type TProposeDeps } from '@/modules/building';
import { PatternCanceledError } from '@/modules/building';
import { type TProject, tieOf } from '@/modules/project';
import { isSuperseded, type THitResult, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';
import { displayPiece } from '@/modules/building';
import type { StudioCx, TNotice } from '@/modules/studio';
import { acceptWords, askOf, barRows, barTargetOf, BUILD_ENTIRE, BUILD_UP_TO, defaultChoice, frontierStop, REBUILD, selectionOfStop, stopBeside, targetHitKeys, targetKey, type TBarChoice, type TBarRow, type TBarStop, type TBarTarget } from './bar';
import { pieceForHit } from './step-loop';

/** What a kind answered for the target and the track on show */
export interface TBarAnswer {
	kind: TBarChoice;
	/** Drawn at once from the note, or as soon as a Pattern's first fit says */
	shape: TResolvedPiece[];
	/** Null while it's asked */
	proposal: TProposal | null;
	/** From asking to the shape and to the answer, in milliseconds */
	shapeMs: number | null;
	answerMs: number | null;
}

export interface TBarState {
	target: TBarTarget | null;
	/** What a press lands; null when nothing is chosen */
	choice: TBarChoice | null;
	answers: Readonly<Record<string, TBarAnswer>>;
	/** The open dropdown, with the row the pointer or the arrows are on, -1 for none; that row's ghost shows */
	menu: { rows: TBarRow[]; index: number } | null;
	/** Presses made while the answer was on its way */
	queued: number;
}

const EMPTY: TBarState = { target: null, choice: null, answers: {}, menu: null, queued: 0 };

/** The one question at a time for one target on one track: moving on or an edit makes a new one and the old one's answers are dropped */
interface TBarSession {
	project: TProject;
	key: string;
	waiting: TBarChoice[];
	isAsking: boolean;
	/** The view has gone to it, once its run said where it is */
	isRevealed: boolean;
}

/**
 * The floating bar: what it's about, what's chosen, and the hint from `propose`. Only moving between notes and choosing
 * happen here without an accept; every change to the track is an accepted proposal, one Undo step, exactly what the wall showed.
 */
export class BarCx {
	readonly $state = createState<TBarState>(EMPTY);

	private session: TBarSession | null = null;
	/** Projects whose first note the bar already went to, so it opens on a new track's first note once */
	private opened = new Set<string>();

	constructor(private readonly studio: StudioCx) {}

	mount(): () => void {
		let future = this.studio.$history.get()?.future.length ?? 0;
		const unlisten = [
			this.studio.$selection.listen(() => this.sync()),
			this.studio.$history.listen(({ value }) => {
				const isUndo = (value?.future.length ?? 0) > future;
				future = value?.future.length ?? 0;
				this.sync();
				if (isUndo) this.backToBuilt();
			}),
			this.studio.simulation.$result.listen(() => this.sync()),
			this.studio.$workspace.listen(() => this.sync())
		];
		this.sync();
		return () => {
			for (const stop of unlisten) stop();
			this.end();
		};
	}

	/** Whether a notice is about the note on show, so the bar says it: the report of an edit made right here */
	carriesNotice(notice: TNotice): boolean {
		return this.isShown && notice.progress == null && notice.revision != null && notice.revision === this.studio.project?.revision && notice.selection === this.studio.$selection.get();
	}

	/** Whether the bar has something to say and may show */
	get isShown(): boolean {
		return this.$state.get().target != null && this.studio.$workspace.get() === 'track' && !this.studio.$playing.get() && !this.studio.assist.isBuilding;
	}

	get answerOfChoice(): TBarAnswer | null {
		const { choice, answers } = this.$state.get();
		return choice != null ? (answers[choice] ?? null) : null;
	}

	/** The answer the wall shows: the row under the pointer's, or else what's chosen */
	get shownAnswer(): TBarAnswer | null {
		const { menu, answers } = this.$state.get();
		const row = menu?.rows[menu.index];
		if (row?.isChoice === true) return answers[row.id] ?? null;
		return this.answerOfChoice;
	}

	// MARK: - Where

	/** ◀ ▶: only moves. Nothing changes on the track */
	move(direction: 1 | -1): boolean {
		const project = this.studio.project;
		const { target } = this.$state.get();
		if (project == null || target == null) return false;
		const stop = stopBeside(project, target, direction);
		if (stop == null) return true;
		this.goTo(project, stop);
		return true;
	}

	private goTo(project: TProject, stop: TBarStop): void {
		const selection = selectionOfStop(project, stop);
		this.studio.$selection.set(selection);
		const time = stop.kind === 'note' ? stop.time : stop.gap.from;
		if (!this.studio.$playing.get()) this.studio.seek(time);
	}

	/** After an Undo the bar may stand past what's built now; it goes back to where building goes on */
	private backToBuilt(): void {
		const project = this.studio.project;
		const { target } = this.$state.get();
		if (project == null || target == null || target.kind === 'notes' || target.stage !== 'pastBuilt') return;
		const stop = frontierStop(project, target.marbleId);
		if (stop != null) this.goTo(project, stop);
	}

	// MARK: - What

	/** Enter: lands what's chosen and moves on, or just moves on when nothing is. A press before the answer waits for it */
	enter(): void {
		const project = this.studio.project;
		const state = this.$state.get();
		const { target, choice, menu } = state;
		if (project == null) return;
		if (menu != null) {
			this.runRow(menu.rows[menu.index]);
			return;
		}
		if (target == null) {
			this.startBuilding(project);
			return;
		}
		if (choice == null) {
			this.move(1);
			return;
		}
		if (choice === BUILD_UP_TO) {
			void this.buildUpToHere();
			return;
		}
		const answer = state.answers[choice];
		if (answer?.proposal == null) {
			this.$state.set({ ...state, queued: state.queued + 1 });
			return;
		}
		this.acceptAnswer(answer.proposal);
	}

	/** With nothing selected Enter and N open the bar where building goes on */
	private startBuilding(project: TProject): void {
		for (const marble of project.marbles) {
			const stop = frontierStop(project, marble.id);
			if (stop != null) {
				this.goTo(project, stop);
				return;
			}
		}
		this.studio.notify('Every note already has a piece');
	}

	/** Lands exactly this proposal as one Undo step and goes on to the next stop */
	private acceptAnswer(proposal: TProposal): void {
		const project = this.studio.project;
		const { target, choice } = this.$state.get();
		if (project == null || target == null || choice == null) return;
		if (!proposal.commands.length) {
			// Nothing fits this rest: the note after it takes a plain platform
			if (target.kind === 'rest') this.move(1);
			return;
		}
		const [isAccepted, , commands] = acceptProposal(project, proposal);
		if (!isAccepted) return;
		const label = acceptWords(project, target, choice, false).replace(/ · .*$/, '');
		if (!this.studio.simulation.landWorkedOut(commands, { label })) return;
		if (target.kind === 'note' && choice !== 'remove') this.studio.audition(target.marbleId, project.marbles.find((marble) => marble.id === target.marbleId)?.hits.find((hit) => hit.id === target.hitId)?.pitch);
		if (proposal.status === 'problems' && proposal.words != null) this.studio.notifyEdit(proposal.words);
		const now = this.studio.project;
		if (now == null) return;
		if (choice === 'remove' || choice === 'flip') {
			if (choice === 'flip') this.$state.set({ ...this.$state.get(), choice: null });
			return;
		}
		const stop = this.stopAfter(now, target, proposal);
		if (stop != null) this.goTo(now, stop);
		else this.studio.$selection.set(selectionOfLast(now, proposal));
	}

	/** The stop after the notes a proposal landed on */
	private stopAfter(project: TProject, target: TBarTarget, proposal: TProposal): TBarStop | null {
		const last = proposal.ask.hitIds.at(-1);
		const marble = project.marbles.find((item) => item.id === target.marbleId);
		const number = marble?.hits.findIndex((hit) => hit.id === last) ?? -1;
		if (target.kind === 'rest') return stopBeside(project, target, 1);
		const hit = marble?.hits[number];
		if (hit == null) return null;
		return stopBeside(project, { kind: 'notes', marbleId: target.marbleId, hitIds: [hit.id], first: number + 1, last: number + 1, total: marble?.hits.length ?? 0, time: hit.time, pieces: [], group: null }, 1);
	}

	/** Build Up to Here: everything before this note, as one Undo step, and the bar stays on it */
	private async buildUpToHere(): Promise<void> {
		const { target } = this.$state.get();
		const project = this.studio.project;
		if (target == null || project == null || target.kind === 'notes') return;
		const time = target.kind === 'note' ? target.time : target.gap.from;
		const key = this.studio.$selection.get();
		await this.studio.assist.buildUpTo(target.kind === 'note' ? time - 1e-3 : time);
		const now = this.studio.project;
		if (now == null) return;
		this.studio.$selection.set(key);
		this.studio.seek(time);
	}

	/** Chooses a kind: its hint shows, and the next press lands it */
	choose(kind: TBarChoice): void {
		const state = this.$state.get();
		this.$state.set({ ...state, choice: kind, menu: null, queued: 0 });
		this.ask(kind, true);
	}

	/** Flip at the end of what's built, with its own key: a hint like any other choice */
	flip(): boolean {
		const { target } = this.$state.get();
		if (target?.kind !== 'note' || !target.isLastBuilt || target.group != null) return false;
		this.choose('flip');
		return true;
	}

	/** Esc: closes the dropdown, takes back what was chosen, drops waiting presses. False when there was nothing of the kind */
	escape(): boolean {
		const state = this.$state.get();
		if (state.menu != null) {
			this.closeMenu();
			return true;
		}
		if (state.queued > 0) {
			this.$state.set({ ...state, queued: 0 });
			return true;
		}
		const fallback = state.target != null ? defaultChoice(state.target) : null;
		if (state.choice === fallback) return false;
		this.$state.set({ ...state, choice: fallback });
		return true;
	}

	// MARK: - Dropdown

	toggleMenu(): void {
		if (this.$state.get().menu != null) this.closeMenu();
		else this.openMenu();
	}

	/** Opening it asks every other kind, one by one; they fill in as they finish */
	openMenu(): void {
		const project = this.studio.project;
		const state = this.$state.get();
		if (project == null || state.target == null) return;
		const openNotes = this.openNotes(project);
		const rows = barRows(project, state.target, openNotes);
		if (!rows.length) return;
		this.$state.set({ ...state, menu: { rows, index: rows.findIndex((row) => row.id === state.choice) } });
		for (const row of rows) if (row.isChoice) this.ask(row.id, false);
	}

	closeMenu(): void {
		const state = this.$state.get();
		if (state.menu == null) return;
		this.$state.set({ ...state, menu: null });
		const session = this.session;
		if (session == null) return;
		// What nobody is looking at stops; the choice's own answer goes on
		session.waiting = session.waiting.filter((kind) => kind === state.choice);
		const asking = Object.values(state.answers).some((answer) => answer.proposal == null && answer.kind !== state.choice);
		if (asking) this.studio.patterns.cancelAsk();
	}

	/** The pointer or the arrows on a row: its ghost shows, and it's asked next */
	hoverRow(index: number): void {
		const state = this.$state.get();
		if (state.menu == null) return;
		if (state.menu == null || state.menu.index === index) return;
		this.$state.set({ ...state, menu: { ...state.menu, index } });
		const row = state.menu.rows[index];
		const session = this.session;
		if (row?.isChoice === true && session?.waiting.includes(row.id) === true) session.waiting = [row.id, ...session.waiting.filter((kind) => kind !== row.id)];
	}

	runRow(row: TBarRow | undefined): void {
		if (row == null) return;
		if (row.isChoice) {
			this.choose(row.id);
			return;
		}
		this.closeMenu();
		const { target } = this.$state.get();
		if (row.id === BUILD_ENTIRE) void this.studio.assist.buildTrack();
		if (row.id === REBUILD && target != null && target.kind !== 'rest') {
			const hitId = target.kind === 'note' ? target.hitId : target.hitIds[0];
			if (hitId != null) void this.studio.assist.buildTrack({ marbleId: target.marbleId, hitId });
		}
	}

	/** Arrow keys and Enter go to the open dropdown before anything else */
	handleMenuKey(event: KeyboardEvent): boolean {
		const { menu } = this.$state.get();
		if (menu == null) return false;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			const step = event.key === 'ArrowDown' ? 1 : -1;
			this.hoverRow((menu.index + step + menu.rows.length) % menu.rows.length);
			return true;
		}
		if (event.key === 'Enter') {
			this.runRow(menu.rows[menu.index]);
			return true;
		}
		if (event.key === 'Escape' || event.key === 'Tab') {
			this.closeMenu();
			return true;
		}
		return false;
	}

	/** Notes with no piece yet, on every marble */
	private openNotes(project: TProject): number {
		const tied = new Set(project.track.pieces.flatMap((piece) => {
			const tie = tieOf(piece);
			return tie?.kind === 'plays' ? [`${tie.marbleId}/${tie.hitId}`] : [];
		}));
		return project.marbles.reduce((sum, marble) => sum + marble.hits.filter((hit) => !tied.has(`${marble.id}/${hit.id}`)).length, 0);
	}

	// MARK: - The answers

	/** Keeps the bar on the selection and the track on show: a new target or an edit starts over, nothing else does */
	private sync(): void {
		const project = this.studio.project;
		if (project == null || this.studio.$workspace.get() !== 'track') {
			this.end();
			return;
		}
		this.openOnFirstNote(project);
		const target = barTargetOf(project, this.studio.$selection.get());
		const key = target != null ? targetKey(target) : null;
		const session = this.session;
		if (target == null || key == null) {
			this.end();
			return;
		}
		if (session?.project === project && session.key === key) {
			this.revealOnce(session, target);
			this.askChoice();
			return;
		}
		const state = this.$state.get();
		// An amend that lands the same pieces keeps a press waiting
		const isSameTarget = session?.key === key;
		this.studio.patterns.cancelAsk();
		const next: TBarSession = { project, key, waiting: [], isAsking: false, isRevealed: isSameTarget };
		this.session = next;
		const choice = isSameTarget && state.choice != null && state.choice !== 'flip' ? state.choice : defaultChoice(target);
		this.$state.set({ target, choice, answers: {}, menu: null, queued: isSameTarget ? state.queued : 0 });
		this.revealOnce(next, target);
		this.askChoice();
	}

	private end(): void {
		if (this.session == null && this.$state.get() === EMPTY) return;
		this.session = null;
		this.studio.patterns.cancelAsk();
		this.$state.set(EMPTY);
	}

	/** Brings the note above the bar, as soon as this track's run says where it is. A press never pans again */
	private revealOnce(session: TBarSession, target: TBarTarget): void {
		if (session.isRevealed || this.currentResult(session.project) == null) return;
		session.isRevealed = true;
		this.studio.$reveal.set({ ids: targetHitKeys(target), isZoomKept: true });
	}

	/** A new track with nothing built starts on its first note, so the bar is there at once */
	private openOnFirstNote(project: TProject): void {
		if (this.opened.has(project.id) || this.studio.$selection.get().length > 0) return;
		const marble = project.marbles.find((item) => item.hits.length > 0);
		if (marble == null) return;
		this.opened.add(project.id);
		if (project.track.pieces.length > 0) return;
		const stop = frontierStop(project, marble.id);
		if (stop != null) this.studio.$selection.set(selectionOfStop(project, stop));
	}

	/** What's chosen is asked as soon as this track's run is there */
	private askChoice(): void {
		const { choice } = this.$state.get();
		if (choice != null && choice !== BUILD_UP_TO) this.ask(choice, true);
	}

	private currentResult(project: TProject): TSimulationResult | null {
		const simulation = this.studio.simulation;
		const result = simulation.$result.get();
		return result != null && !simulation.isPreviewing && result.revision === project.revision ? result : null;
	}

	private ask(kind: TBarChoice, isFirst: boolean): void {
		const session = this.session;
		const project = this.studio.project;
		const state = this.$state.get();
		if (session == null || project == null || state.answers[kind] != null || kind === BUILD_UP_TO) return;
		if (this.studio.assist.isBuilding) return;
		if (!session.waiting.includes(kind)) session.waiting = isFirst ? [kind, ...session.waiting] : [...session.waiting, kind];
		void this.pump(session);
	}

	/** One question at a time, as the workers keep only the newest of a kind */
	private async pump(session: TBarSession): Promise<void> {
		if (session.isAsking) return;
		const result = this.currentResult(session.project);
		if (result == null) return;
		session.isAsking = true;
		while (session === this.session && session.waiting.length > 0) {
			const kind = session.waiting.shift();
			if (kind != null) await this.askOne(session, kind, result);
		}
		session.isAsking = false;
	}

	private async askOne(session: TBarSession, kind: TBarChoice, result: TSimulationResult): Promise<void> {
		const { target } = this.$state.get();
		const startedAt = performance.now();
		if (target == null) return;
		const write = (patch: Partial<TBarAnswer>): void => {
			if (session !== this.session) return;
			const state = this.$state.get();
			const answer: TBarAnswer = { kind, shape: [], proposal: null, shapeMs: null, answerMs: null, ...state.answers[kind], ...patch };
			this.$state.set({ ...state, answers: { ...state.answers, [kind]: answer } });
		};
		const shape = shapeNow(session.project, result, target, kind);
		write({ shape, shapeMs: shape.length > 0 ? performance.now() - startedAt : null });
		const proposal = await this.answerOf(session, kind, target, result, (pieces) => {
			write({ shape: pieces, ...(this.$state.get().answers[kind]?.shapeMs == null ? { shapeMs: performance.now() - startedAt } : {}) });
		});
		if (proposal == null) return;
		write({ proposal, answerMs: performance.now() - startedAt, ...(proposal.shown.length > 0 ? { shape: proposal.shown } : {}) });
		// Where the hint sends the marble is part of the hint
		if (session === this.session && this.$state.get().choice === kind && proposal.nextDot != null) this.studio.$reveal.set({ ids: targetHitKeys(target), point: proposal.nextDot, isZoomKept: true });
		const state = this.$state.get();
		if (session !== this.session || state.choice !== kind || state.queued === 0) return;
		// A press made before the answer takes it only if there's nothing it should have read first
		this.$state.set({ ...state, queued: proposal.status === 'fits' ? state.queued - 1 : 0 });
		if (proposal.status === 'fits') this.acceptAnswer(proposal);
	}

	private async answerOf(session: TBarSession, kind: TBarChoice, target: TBarTarget, result: TSimulationResult, onShape: (pieces: TResolvedPiece[]) => void): Promise<TProposal | null> {
		const { project } = session;
		const base = this.studio.assist.proposeDeps({ isCanceled: () => session !== this.session });
		if (base == null) return null;
		const deps: TProposeDeps = { ...base, pattern: (asked, ask) => this.studio.patterns.ask(asked, ask, onShape) };
		const ask = { ...askOf(project, target, kind) };
		// A note with an empty rest before it gets what a note gets: the rest was its own stop, with its own answer
		const options = { result, ...(target.kind === 'note' && target.stage === 'open' ? { isAnyDot: true } : {}) };
		for (let isRetry = false; ; isRetry = true) {
			try {
				return await propose(project, ask, deps, options);
			} catch (error) {
				if (session !== this.session) return null;
				if (!isSuperseded(error) && !(error instanceof PatternCanceledError)) {
					console.warn(error);
					return null;
				}
				// Asked again once: what took its place was someone else's, and the note is still waiting for its answer
				if (isRetry) return null;
			}
		}
	}
}

/** The selection after the very last stop: what landed, so its Adjust is there */
function selectionOfLast(project: TProject, proposal: TProposal): string[] {
	const ids = proposal.pieces.map((piece) => piece.id).filter((id) => project.track.pieces.some((piece) => piece.id === id));
	return ids.length > 0 ? ids.slice(-1) : [];
}

/** A platform's shape from the note alone, before any answer */
function shapeNow(project: TProject, result: TSimulationResult, target: TBarTarget, kind: TBarChoice): TResolvedPiece[] {
	if (kind !== 'platform' || target.kind !== 'note') return [];
	const hit: THitResult | undefined = result.hits.find((item) => item.marbleId === target.marbleId && item.hitId === target.hitId);
	if (hit?.dot == null) return [];
	const guess = pieceForHit(project, hit, kind, 'default', 'bar-shape');
	const radius = project.marbles.find((marble) => marble.id === target.marbleId)?.radius;
	return [displayPiece(guess, { pose: { position: hit.dot, angle: guess.angle }, dot: hit.dot, velocity: hit.velocity }, radius)];
}
