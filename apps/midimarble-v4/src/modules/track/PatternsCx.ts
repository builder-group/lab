import { createState } from 'feature-state';
import { acceptProposal, createEstimate, createPatternClient, flattenCommands, groupsOfMarble, hitKey, hitsInRange, isPatternKind, MOVE_PATTERN, patternLabel, patternOfPiece, patternSpan, PATTERNS, PatternCanceledError, playingNotes, propose, type TGroupRunProgress, type TPatternAsk, type TPatternClient, type TPatternKind, type TProposal, type TProposeDeps } from '@/modules/building';
import { type TPatternAnswer } from '@/modules/building/patterns/pattern.worker';
import { isSuperseded, type TResolvedPiece, type TSimulationResult } from '@/modules/simulation';
import type { TGroup, TPatternGroup, TProject, TProjectHistory, TVec2 } from '@/modules/project';
import { toGroupKey, toHitKey, toRangeKey } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';

/** A second try on a locked piece within this is the same try, and says nothing new */
const LOCK_NOTICE_MS = 3000;

/** Where a Pattern goes: a range of one marble's row, or the Group already there */
export interface TPatternTarget {
	marbleId: string;
	from: number;
	to: number;
	group?: TPatternGroup;
}

/** What the inspector or an agent asks of a Pattern, past its range */
export interface TPatternSettings {
	width?: number;
	bounce?: number;
	maxTilt?: number;
}

/**
 * Patterns in Track. The bar asks through `ask` and lands what `propose` answered; a Group's own settings and agents'
 * `applyPattern` come through `apply`, one Undo step, with progress and Stop in the notice.
 */
export class PatternsCx {
	readonly $isRunning = createState(false);

	private client: TPatternClient | null = null;
	/** The run on its way, which an edit ends; `isReplaced` when a newer click takes its place, which says nothing */
	private run: { key: string | null; isReplaced: boolean; isStopped: boolean } | null = null;

	constructor(readonly studio: StudioCx) {}

	mount(): () => void {
		const unlisten = this.studio.$history.listen(({ value }) => {
			// Another project, a new Undo step or an Undo is an edit; the song's length and a settled run amend the step they follow
			if (this.run != null && stepKey(value) !== this.run.key) this.client?.cancel();
		});
		return () => {
			unlisten();
			this.client?.dispose();
			this.client = null;
			this.moveClient?.dispose();
			this.moveClient = null;
		};
	}

	stop(): void {
		this.isStopped = true;
		if (this.run != null) this.run.isStopped = true;
		this.client?.cancel();
	}

	private isStopped = false;

	/**
	 * Gravity changes how every marble falls, so live Patterns fit again, in one Undo step with it. A Group fits the later
	 * ones on its marble itself, so the first of each marble is enough. Stop takes the change back, so nothing changed. A
	 * change that stops notes playing is taken back too, and says which, with Change Anyway to land it knowingly.
	 */
	async setGravity(gravity: number, options: { isForced?: boolean } = {}): Promise<void> {
		const before = this.studio.project;
		if (before == null || !this.studio.execute([{ type: 'updateProject', patch: { gravity: gravity } }])) return;
		const project = this.studio.project;
		if (project == null) return;
		this.isStopped = false;
		for (const marble of project.marbles) {
			const group = groupsOfMarble(project, marble.id).find((item) => patternSpan(marble, item) != null);
			const span = group != null ? patternSpan(marble, group) : null;
			if (group == null || span == null) continue;
			if (!isPatternKind(group.pattern.kind)) continue;
			const answer = await this.fit(changeFor({ marbleId: group.marbleId, from: span.from, to: span.to, group }, group.pattern.kind), false);
			if (answer == null) {
				if (this.isStopped) this.studio.undo();
				return;
			}
			if (answer.commands.length > 0 && !this.studio.execute(answer.commands, { amend: true })) return;
		}
		if (options.isForced === true) return;
		await this.studio.simulation.whenSettled();
		const words = await this.lostWords(before, gravity);
		if (words == null) return;
		this.studio.undo();
		const was = before.gravity.toFixed(2);
		this.studio.notify(`${words} Gravity stays ${was}.`, 'error', { actions: [{ label: 'Change Anyway', title: `Set Gravity to ${gravity.toFixed(2)} even though those notes stop playing`, run: () => void this.setGravity(gravity, { isForced: true }) }] });
	}

	/** What a Gravity change stops playing, compared with the track before it, in words; null when every note still plays */
	private async lostWords(before: TProject, gravity: number): Promise<string | null> {
		const simulate = this.studio.assist.proposeDeps()?.simulate;
		const after = this.studio.project;
		if (simulate == null || after == null || after.gravity !== gravity) return null;
		return lostNotesWords(before, await simulate(before), await simulate(after), `at Gravity ${gravity.toFixed(2)}`);
	}

	/** Makes or changes the Group and selects it. Null when it was stopped or couldn't be made */
	async apply(target: TPatternTarget, kind: TPatternKind, settings: TPatternSettings = {}): Promise<TPatternAnswer | null> {
		const marble = this.studio.project?.marbles.find((item) => item.id === target.marbleId);
		const span = marble != null && target.group != null ? patternSpan(marble, target.group) : null;
		const change = changeFor(target, kind, settings);
		const answer = await this.fit(change);
		if (answer == null) return null;
		if (!answer.commands.length || answer.groupId == null) {
			this.refuse(target, kind, settings, answer);
			return answer;
		}
		if (!this.studio.simulation.landWorkedOut(answer.commands, { label: PATTERNS[kind].label })) return null;
		const group = this.studio.project?.track.groups.find((item) => item.id === answer.groupId);
		const pieceIds = group?.pieceIds ?? [];
		this.studio.$selection.set([toGroupKey(answer.groupId), ...pieceIds]);
		// The zoom stays where the range was framed, like an operator's redo in Blender
		this.studio.$trackCx.get()?.revealOnceSimulated(pieceIds, true);
		this.tell(answer, madeWords(target, span, kind, settings, answer.name));
		return answer;
	}

	/** Nothing changed: the notice says which hit and why, and offers what fits instead */
	private refuse(target: TPatternTarget, kind: TPatternKind, settings: TPatternSettings, answer: TPatternAnswer): void {
		const { refusal } = answer;
		const words = refusal?.words ?? answer.problems[0]?.words ?? `${PATTERNS[kind].label} can't fit here.`;
		const actions = answer.offers.map((offer) => ({
			label: offer.label,
			title: offer.words,
			run: () => void this.apply({ ...target, from: offer.from ?? target.from, to: offer.to ?? target.to }, kind, { ...settings, ...(offer.width != null ? { width: offer.width } : {}) })
		}));
		const said = answer.offers.map((offer) => offer.words).join(' ');
		this.studio.notify(said.length > 0 ? `${words} ${said}` : words, 'error', { actions });
		if (refusal?.hitId != null) this.studio.$reveal.set({ ids: [toHitKey(refusal.marbleId, refusal.hitId)], isZoomKept: true });
	}

	/** Flatten Pattern: one Undo step, and the piece a person went for is selected, ready to drag, or else all of them */
	flatten(group: TPatternGroup, pieceId?: string): void {
		if (!this.studio.execute(flattenCommands(group), { label: 'Flatten' })) return;
		this.studio.$selection.set(pieceId != null && group.pieceIds.includes(pieceId) ? [pieceId] : group.pieceIds);
		this.studio.notifyEdit(`Flattened ${group.name}`);
	}

	private toldAt = 0;
	private toldGroup: string | null = null;

	/** Says once per try that a live Pattern's piece doesn't edit, with Flatten beside it: a held key or a long drag is one try */
	tellLocked(group: TPatternGroup, pieceId?: string): void {
		// The bar already says it on a note
		if (this.studio.bar.isShown) return;
		const now = performance.now();
		if (this.toldGroup === group.id && now - this.toldAt < LOCK_NOTICE_MS) {
			this.toldAt = now;
			return;
		}
		this.toldGroup = group.id;
		this.toldAt = now;
		this.studio.notify(`Part of ${group.name}.`, 'info', { actions: [{ label: 'Flatten', title: FLATTEN_HELP, run: () => this.flatten(group, pieceId) }] });
	}

	/** What a Pattern would make of this, with its ghost as soon as there is one and no notice, for the bar's hint. `cancelAsk` ends it */
	ask(project: TProject, change: TPatternAsk, onGhost: (pieces: TResolvedPiece[]) => void): Promise<TPatternAnswer> {
		return this.clientNow().preview(project, change, onGhost);
	}

	cancelAsk(): void {
		this.client?.cancelPreview();
	}

	// MARK: - Moving a Pattern

	/** A live Pattern being moved: its hint on the wall, what `propose` answered once it has */
	readonly $move = createState<{ groupId: string; shape: TResolvedPiece[]; proposal: TProposal | null } | null>(null);
	private moveAsk = 0;
	/** A move's fits run in a worker of their own, so the bar's hints and a drag never end each other's */
	private moveClient: TPatternClient | null = null;

	/** Shows where a moved Pattern would stand before it's asked, such as its pieces shifted with the pointer */
	showMove(group: TPatternGroup, shape: TResolvedPiece[]): void {
		const shown = this.$move.get();
		if (shown?.groupId !== group.id || shown.proposal == null) this.$move.set({ groupId: group.id, shape, proposal: null });
	}

	/**
	 * Asks `propose` where a live Pattern would go, on the wall (`dot`, its first note's) or along its row (`shift` notes).
	 * The newest ask wins and its hint shows; nothing changes. Null when a newer ask took its place
	 */
	async askMove(group: TPatternGroup, move: { dot?: TVec2; shift?: number }): Promise<TProposal | null> {
		const project = this.studio.project;
		const ask = ++this.moveAsk;
		const isCurrent = (): boolean => ask === this.moveAsk;
		const base = this.studio.assist.proposeDeps({ isCanceled: () => !isCurrent() });
		const [first] = group.pattern.hitIds;
		if (project == null || base == null || first == null) return null;
		const deps: TProposeDeps = { ...base, pattern: (asked, change) => this.fitOn(asked, change) };
		const result = this.studio.simulation.$result.get();
		try {
			const proposal = await propose(project, { marbleId: group.marbleId, hitIds: [first], kind: MOVE_PATTERN, settings: { groupId: group.id, ...move } }, deps, result?.revision === project.revision ? { result } : {});
			if (!isCurrent()) return null;
			this.$move.set({ groupId: group.id, shape: proposal.shown, proposal });
			return proposal;
		} catch (error) {
			if (isCurrent() && !isSuperseded(error) && !(error instanceof PatternCanceledError)) console.warn(error);
			return null;
		}
	}

	/** A Pattern's whole-song check on a track that isn't the one on show, such as one with a moved Pattern's first dot, in the move's own worker */
	fitOn(project: TProject, change: TPatternAsk): Promise<TPatternAnswer> {
		this.moveClient ??= createPatternClient();
		return this.moveClient.preview(project, change, () => undefined);
	}

	/** The release: lands where it was moved, as one Undo step, if that fits; otherwise nothing changes and the notice says why */
	async endMove(group: TPatternGroup, move: { dot?: TVec2; shift?: number }): Promise<void> {
		const proposal = await this.askMove(group, move);
		this.$move.set(null);
		const project = this.studio.project;
		if (proposal == null || project == null) return;
		if (proposal.status !== 'fits') {
			const words = proposal.words ?? `${group.name} doesn't fit there.`;
			this.studio.notify(words.endsWith('Nothing changed.') ? words : `${words} Nothing changed.`, 'error');
			return;
		}
		const [isAccepted, refusal, commands] = acceptProposal(project, proposal);
		if (!isAccepted) {
			this.studio.notify(refusal.message, 'error');
			return;
		}
		if (!this.studio.simulation.landWorkedOut(commands, { label: `Move ${group.name}` })) return;
		const moved = this.studio.project?.track.groups.find((item) => item.id === group.id);
		if (moved != null) this.studio.$selection.set(groupSelection(moved));
	}

	/** Esc or a drag that ends nowhere: the hint goes and nothing is asked any more */
	cancelMove(): void {
		this.moveAsk++;
		this.$move.set(null);
		this.moveClient?.cancelPreview();
	}

	/** The same run with nothing applied, for an agent's dry run */
	async dryRun(target: TPatternTarget, kind: TPatternKind, settings: TPatternSettings = {}): Promise<TPatternAnswer | null> {
		return this.fit(changeFor(target, kind, settings));
	}

	private clientNow(): TPatternClient {
		this.client ??= createPatternClient();
		return this.client;
	}

	private async fit(change: TPatternAsk, isChecked = true): Promise<TPatternAnswer | null> {
		if (this.studio.project == null) return null;
		if (this.run != null) this.run.isReplaced = true;
		const run = { key: stepKey(this.studio.$history.get()), isReplaced: false, isStopped: false };
		this.run = run;
		this.$isRunning.set(true);
		const label = patternLabel(change.kind);
		const noticeId = this.studio.notify(`Fitting ${label}`, 'info', { progress: 0, actions: [{ label: 'Stop', title: 'Stop fitting; nothing changes', run: () => this.stop() }] });
		try {
			// A settle on its way lands on the project and amends its step, so the fit starts from what it lands
			if (this.studio.simulation.isSettling) {
				await this.studio.simulation.whenSettled();
				if (run.isStopped || this.run !== run || stepKey(this.studio.$history.get()) !== run.key) throw new PatternCanceledError();
			}
			const project = this.studio.project;
			if (project == null) throw new PatternCanceledError();
			const startedAt = performance.now();
			const estimate = createEstimate({ minElapsedMs: 3000 });
			const answer = await this.clientNow().run(project, change, (progress: TGroupRunProgress) => {
				const percent = Math.round(progress.fraction * 100);
				const steps = progress.steps > 1 ? `${progress.step} of ${progress.steps} groups` : `${percent}%`;
				const left = estimate.update(performance.now() - startedAt, progress.fraction, percent, 100);
				this.studio.updateNotice(noticeId, { message: [`Fitting ${progress.name}`, steps, left].filter(Boolean).join(' · '), progress: progress.fraction });
			}, isChecked);
			this.studio.updateNotice(noticeId, { progress: undefined, actions: [] });
			// A cancel can't reach an answer already on its way
			if (stepKey(this.studio.$history.get()) !== run.key) throw new PatternCanceledError();
			return answer;
		} catch (error) {
			this.studio.updateNotice(noticeId, { progress: undefined, actions: [] });
			if (error instanceof PatternCanceledError) {
				if (!run.isReplaced) this.studio.notify(`Stopped fitting ${label}. Nothing changed.`);
				return null;
			}
			this.studio.notify((error as Error).message, 'error');
			return null;
		} finally {
			if (this.run === run) {
				this.run = null;
				this.$isRunning.set(false);
			}
		}
	}

	/** One notice for the whole run: what it made, what else moved, and first of all what no longer fits */
	private tell(answer: TPatternAnswer, made: string): void {
		const broken = answer.later.filter((item) => item.problems.length > 0);
		const lines = [...answer.notes, ...answer.problems.map((problem) => `${answer.name}: ${problem.words}`), ...broken.flatMap((item) => item.problems.map((problem) => `${item.name}: ${problem.words}`)), ...answer.otherMarbleTouches];
		if (broken.length > 0) {
			const first = broken[0];
			const message = `${first?.name} can't fit any more: ${first?.problems[0]?.words}`;
			// Details add to the line above them, never repeat it
			const rest = lines.filter((line) => line !== `${first?.name}: ${first?.problems[0]?.words}`);
			this.studio.notify(message, 'error', rest.length > 0 ? { details: rest.join(' ') } : {});
			return;
		}
		const details = lines.length > 0 ? lines.join(' ') : undefined;
		const parts = [answer.later.length > 0 ? `${answer.name} and ${answer.later.length === 1 ? answer.later[0]?.name : `${answer.later.length} later Groups`} fitted, so everything stays on time` : made];
		if (answer.problems.length > 0) parts.push(`${answer.problems.length} ${answer.problems.length === 1 ? 'problem' : 'problems'}`);
		if (answer.movedAfter > 0) parts.push(`the ${answer.movedAfter === 1 ? 'piece' : `${answer.movedAfter} pieces`} after it moved with the marble`);
		if (answer.laterLateHits > 0) parts.push(`${answer.laterLateHits} later ${answer.laterLateHits === 1 ? 'note is' : 'notes are'} no longer on time`);
		if (answer.otherMarbleTouches.length > 0) parts.push('it touches another marble’s pieces');
		this.studio.notifyEdit(parts.join(' · '), [], details != null ? { details } : {});
	}
}

/** What to ask of a Pattern: what was set, what its Group has, and otherwise no Width, so the app picks one that fits */
function changeFor(target: TPatternTarget, kind: TPatternKind, settings: TPatternSettings = {}): TPatternAsk {
	const { group, marbleId, from, to } = target;
	const isSameKind = group?.pattern.kind === kind;
	const width = settings.width ?? (isSameKind ? group.pattern.width : undefined);
	const bounce = settings.bounce ?? (isSameKind ? group.pattern.bounce : undefined);
	const maxTilt = settings.maxTilt ?? (isSameKind ? group.pattern.maxTilt : undefined);
	return {
		...(group != null ? { groupId: group.id } : {}),
		marbleId,
		from,
		to,
		kind,
		...(width != null ? { width } : {}),
		...(bounce != null ? { bounce } : {}),
		...(maxTilt != null ? { maxTilt } : {})
	};
}

/** The notes a change stops playing, from the runs before and after it, as one sentence; null when every note still plays */
export function lostNotesWords(project: TProject, before: TSimulationResult, after: TSimulationResult, when: string): string | null {
	const now = playingNotes(after);
	const lost = before.hits.filter((hit) => (hit.status === 'onTime' || hit.status === 'drifting') && !now.has(hitKey(hit.marbleId, hit.hitId)));
	const marble = project.marbles.find((item) => item.id === lost[0]?.marbleId);
	if (marble == null) return null;
	const numbers = lost.filter((hit) => hit.marbleId === marble.id).map((hit) => marble.hits.findIndex((item) => item.id === hit.hitId) + 1).sort((a, b) => a - b);
	const notes = numbers.length === 1 ? `Note ${numbers[0]}` : `${numbers.length} notes from Note ${numbers[0]}`;
	const others = lost.length - numbers.length;
	return `${notes} of ${marble.name} ${numbers.length === 1 ? 'stops' : 'stop'} playing ${when}${others > 0 ? `, and ${others} of other marbles` : ''}.`;
}

/** What a click or a setting just did, so the notice names the edit its Undo takes back */
function madeWords(target: TPatternTarget, span: { from: number; to: number } | null, kind: TPatternKind, settings: TPatternSettings, name: string): string {
	const { group } = target;
	if (group == null) return `Made ${name}`;
	if (group.pattern.kind !== kind) return `${group.name} is now ${PATTERNS[kind].label}`;
	if (settings.width != null) return `${name}: Width ${(settings.width * 100).toFixed(0)} cm`;
	if (settings.bounce != null) return `${name}: Bounce ${settings.bounce.toFixed(2)}`;
	if (settings.maxTilt != null) return `${name}: Tilt limit ${settings.maxTilt.toFixed(0)}°`;
	return span != null && (target.from !== span.from || target.to !== span.to) ? `${name}: new range` : `Fitted ${name} again`;
}

/** The open project and its Undo step: an edit, an Undo or another project changes it, an amend doesn't */
function stepKey(history: TProjectHistory | null): string | null {
	return history != null ? `${history.present.id}:${history.groups.present}` : null;
}

/** A selection with every piece of a live Pattern standing for its whole Group, as a click on one does */
export function withWholePatterns(project: TProject, selection: readonly string[]): string[] {
	const groups = new Set(selection.flatMap((key) => patternOfPiece(project, key) ?? []));
	return [...new Set([...selection, ...[...groups].flatMap(groupSelection)])];
}

/** A selection with every piece of any Group standing for that Group, as a marquee finds Figma's groups */
export function withWholeGroups(project: TProject, selection: readonly string[]): string[] {
	const groups = project.track.groups.filter((group) => group.pieceIds.some((id) => selection.includes(id)));
	return [...new Set([...selection, ...groups.flatMap(groupSelection)])];
}

/** Selecting a Group selects its pieces with it, so the wall and the hits show them and Delete takes them */
export function groupSelection(group: TGroup): string[] {
	return [toGroupKey(group.id), ...group.pieceIds];
}

/** What Flatten does, in its tooltip wherever it's offered */
export const FLATTEN_HELP = 'Keep these pieces as they are, as a plain Group, and remove the Pattern';

/** How far apart notes can be and still read as one phrase for a Pattern, in seconds */
const PHRASE_GAP = 1.2;
/** A phrase's most notes: a first choice to change, not a whole verse */
const PHRASE_NOTES = 8;

/**
 * Pattern…: the hits a Pattern starts from, around a hit. Several selected stay as they are; otherwise this hit and the
 * ones after it in the same phrase, so the tiles have a range to fit.
 */
export function patternPhrase(project: TProject, marbleId: string, hitId: string, selection: readonly string[] = []): string[] {
	const key = toHitKey(marbleId, hitId);
	if (selection.length > 1 && selection.includes(key)) return [...selection];
	const hits = [...(project.marbles.find((marble) => marble.id === marbleId)?.hits ?? [])].sort((a, b) => a.time - b.time);
	const first = hits.findIndex((hit) => hit.id === hitId);
	if (first < 0) return [key];
	const phrase = [hits[first]];
	for (const hit of hits.slice(first + 1, first + PHRASE_NOTES)) {
		if (hit.time - (phrase[phrase.length - 1]?.time ?? hit.time) > PHRASE_GAP) break;
		phrase.push(hit);
	}
	return phrase.flatMap((hit) => (hit != null ? [toHitKey(marbleId, hit.id)] : []));
}

/** Selection for a range dragged in the strip: its notes as hits, the same as dragging over them, or the silence itself */
export function rangeSelection(project: TProject, marbleId: string, from: number, to: number): string[] {
	const marble = project.marbles.find((item) => item.id === marbleId);
	if (marble == null) return [];
	const hits = hitsInRange(marble, from, to);
	return hits.length > 0 ? hits.map((hit) => toHitKey(marbleId, hit.id)) : [toRangeKey(marbleId, from, to)];
}

