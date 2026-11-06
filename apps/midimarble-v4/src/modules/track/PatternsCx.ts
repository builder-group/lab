import { createState } from 'feature-state';
import { createPatternClient, flattenCommands, groupsOfMarble, hitsInRange, isPatternKind, patternLabel, patternLockWords, patternOfPiece, patternSpan, PATTERNS, PatternCanceledError, type TGroupRunProgress, type THitVerdict, type TPatternAsk, type TPatternClient, type TPatternKind, type TPatternOffer, type TPatternRefusal } from '@/modules/building';
import { type TPatternAnswer } from '@/modules/building/patterns/pattern.worker';
import { type TResolvedPiece } from '@/modules/simulation';
import type { TGroup, TPatternGroup, TProject, TProjectHistory } from '@/modules/project';
import { parseHitKey, parseRangeKey, toGroupKey, toHitKey, toRangeKey } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';

/** How long a pointer rests on a tile before it is asked: moving across tiles asks nothing */
const HOVER_DELAY = 180;
/** A second try on a locked piece within this is the same try, and says nothing new */
const LOCK_NOTICE_MS = 3000;

/** Where a Pattern goes: a range of one marble's row, or the Group already there */
export interface TPatternTarget {
	marbleId: string;
	from: number;
	to: number;
	group?: TPatternGroup;
}

export interface TPatternPreview {
	revision: number;
	kind: TPatternKind;
	key: string;
	marbleId: string;
	pieces: TResolvedPiece[];
	/** Milliseconds from asking in the worker to the ghost, for the check of hover speed */
	ms: number;
	/** False once the whole song has said no */
	isOk: boolean;
}

/** What the inspector or an agent asks of a Pattern, past its range */
export interface TPatternSettings {
	width?: number;
	bounce?: number;
	maxTilt?: number;
}

/** What the tiles and the strip say about a range: while it's asked, then a verdict per hit */
export interface TPatternVerdict {
	key: string;
	marbleId: string;
	kind: TPatternKind;
	isChecking: boolean;
	verdicts: THitVerdict[];
	/** The Pattern doesn't fit: the hit named and why. Null while asked, or when it fits */
	refusal: TPatternRefusal | null;
	/** What fits instead, on a refusal */
	offers: TPatternOffer[];
	/** Pieces after the range that would move with the marble */
	movedAfter: number;
	/** Only what resting on a tile showed, gone with the pointer */
	isHover: boolean;
}

/**
 * Patterns in Track. Resting on a tile asks it: its ghost on the wall, then a verdict per hit in the strip and under the
 * tiles. A click applies that answer, or asks and applies, one Undo step, with progress and Stop in the notice. Agents come
 * here too, with `applyPattern`.
 */
export class PatternsCx {
	readonly $preview = createState<TPatternPreview | null>(null);
	readonly $verdict = createState<TPatternVerdict | null>(null);
	readonly $isRunning = createState(false);

	private client: TPatternClient | null = null;
	private hoverTimer: ReturnType<typeof setTimeout> | undefined;
	private hoverKey: string | null = null;
	/** The newest answer from resting on a tile, which a click on it applies without asking again */
	private answered: { key: string; project: TProject; answer: TPatternAnswer } | null = null;
	/** The run on its way, which an edit ends; `isReplaced` when a newer click takes its place, which says nothing */
	private run: { key: string | null; isReplaced: boolean; isStopped: boolean } | null = null;

	constructor(readonly studio: StudioCx) {}

	mount(): () => void {
		this.$preview.set(null);
		this.$verdict.set(null);
		const unlisten = [
			this.studio.$history.listen(({ value }) => {
				if (this.$preview.get() != null && this.$preview.get()?.revision !== value?.present.revision) this.$preview.set(null);
				// What a resting pointer asked was about the project as it was
				if (this.run == null) this.endAsking();
				// Another project, a new Undo step or an Undo is an edit; the song's length and a settled run amend the step they follow
				if (this.run != null && stepKey(value) !== this.run.key) this.client?.cancel();
			}),
			this.studio.$selection.listen(() => {
				if (this.$verdict.get() != null) this.$verdict.set(null);
				// A question about the old selection is only in the way of the next one
				if (this.run == null) this.endAsking();
			})
		];
		return () => {
			for (const stop of unlisten) stop();
			clearTimeout(this.hoverTimer);
			this.client?.dispose();
			this.client = null;
		};
	}

	/** Rest on a tile: the ghost shows the first of several marbles, then the whole song is asked */
	hover(target: TPatternTarget, kind: TPatternKind): void {
		const project = this.studio.project;
		if (project == null || this.run != null) return;
		const change = changeFor(target, kind);
		const key = previewKey(change);
		this.hoverKey = key;
		clearTimeout(this.hoverTimer);
		const isCurrent = (): boolean => this.hoverKey === key && this.studio.project?.revision === project.revision;
		this.hoverTimer = setTimeout(() => {
			const startedAt = performance.now();
			this.$verdict.set({ key: verdictKey(target), marbleId: target.marbleId, kind, isChecking: true, verdicts: [], refusal: null, offers: [], movedAfter: 0, isHover: true });
			this.clientNow()
				.preview(project, change, (pieces) => {
					if (!isCurrent()) return;
					this.$preview.set({ revision: project.revision, kind, key, marbleId: change.marbleId, pieces, ms: performance.now() - startedAt, isOk: true });
					// Notes in free fall lie far below the view: a ghost nobody sees previews nothing, so the view pans to it, keeping the zoom
					const middle = pieces[Math.floor(pieces.length / 2)];
					if (middle != null) this.studio.$reveal.set({ ids: [], point: middle.position });
				})
				.then((answer) => {
					// A check is worth keeping once it's done, even for a pointer that has moved on
					this.answered = { key, project, answer };
					if (!isCurrent()) return;
					const preview = this.$preview.get();
					this.$preview.set({ revision: project.revision, kind, key, marbleId: change.marbleId, pieces: answer.pieces.length > 0 ? answer.pieces : (preview?.pieces ?? []), ms: preview?.ms ?? performance.now() - startedAt, isOk: answer.refusal == null });
					this.$verdict.set(verdictOf(target, kind, answer, true));
				})
				.catch((error: unknown) => {
					if (!(error instanceof PatternCanceledError)) console.warn(error);
				});
		}, HOVER_DELAY);
	}

	/** Stops what a resting pointer asked, with its ghost */
	private endAsking(): void {
		this.endHover();
		this.client?.cancelPreview();
	}

	endHover(): void {
		this.hoverKey = null;
		clearTimeout(this.hoverTimer);
		if (this.$preview.get() != null) this.$preview.set(null);
		if (this.$verdict.get()?.isHover === true) this.$verdict.set(null);
	}

	stop(): void {
		this.isStopped = true;
		if (this.run != null) this.run.isStopped = true;
		this.client?.cancel();
	}

	private isStopped = false;

	/**
	 * Gravity changes how every marble falls, so live Patterns fit again, in one Undo step with it. A Group fits the later
	 * ones on its marble itself, so the first of each marble is enough. Stop takes the change back, so nothing changed.
	 */
	async setGravity(gravity: number): Promise<void> {
		this.endHover();
		if (!this.studio.execute([{ type: 'updateProject', patch: { gravity: gravity } }])) return;
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
			if (!answer.commands.length) {
				this.studio.notify(`${group.name} can't fit at this Gravity: ${answer.problems[0]?.words ?? 'try another Width.'}`, 'error');
				continue;
			}
			if (!this.studio.execute(answer.commands, { amend: true })) return;
			this.tell(answer, `Fitted ${answer.name} again`);
		}
	}

	/** Makes or changes the Group and selects it. Null when it was stopped or couldn't be made */
	async apply(target: TPatternTarget, kind: TPatternKind, settings: TPatternSettings = {}): Promise<TPatternAnswer | null> {
		this.endHover();
		const marble = this.studio.project?.marbles.find((item) => item.id === target.marbleId);
		const span = marble != null && target.group != null ? patternSpan(marble, target.group) : null;
		const change = changeFor(target, kind, settings);
		const answered = this.answered;
		// What a settle is about to land changes the project that answer was about
		const isAnswered = answered != null && answered.key === previewKey(change) && answered.project === this.studio.project && !this.studio.simulation.isSettling;
		const answer = isAnswered ? answered.answer : await this.fit(change);
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

	/** Nothing changed: the notice says which hit and why, and offers what fits instead; the wall shows it; the tiles keep saying it */
	private refuse(target: TPatternTarget, kind: TPatternKind, settings: TPatternSettings, answer: TPatternAnswer): void {
		const { refusal } = answer;
		const words = refusal?.words ?? answer.problems[0]?.words ?? `${PATTERNS[kind].label} can't fit here.`;
		this.$verdict.set({ ...verdictOf(target, kind, answer, false), refusal: refusal ?? { marbleId: target.marbleId, hitId: answer.problems[0]?.hitId ?? null, words } });
		const actions = answer.offers.map((offer) => ({
			label: offer.label,
			title: offer.words,
			run: () => void this.apply({ ...target, from: offer.from ?? target.from, to: offer.to ?? target.to }, kind, { ...settings, ...(offer.width != null ? { width: offer.width } : {}) })
		}));
		const said = answer.offers.map((offer) => offer.words).join(' ');
		this.studio.notify(said.length > 0 ? `${words} ${said}` : words, 'error', { actions });
		if (refusal?.hitId != null) this.studio.$reveal.set({ ids: [toHitKey(refusal.marbleId, refusal.hitId)], isZoomKept: true });
	}

	/** Flatten Pattern: one Undo step, and the pieces are selected, to edit one by one */
	flatten(group: TPatternGroup): void {
		this.endHover();
		if (!this.studio.execute(flattenCommands(group), { label: 'Flatten' })) return;
		this.studio.$selection.set(group.pieceIds);
		this.studio.notifyEdit(`Flattened ${group.name}`);
	}

	private toldAt = 0;
	private toldGroup: string | null = null;

	/** Says once per try that a live Pattern's piece doesn't edit: a held key or a long drag is one try */
	tellLocked(group: TPatternGroup): void {
		const now = performance.now();
		if (this.toldGroup === group.id && now - this.toldAt < LOCK_NOTICE_MS) {
			this.toldAt = now;
			return;
		}
		this.toldGroup = group.id;
		this.toldAt = now;
		this.studio.notify(patternLockWords(group));
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
			const answer = await this.clientNow().run(project, change, (progress: TGroupRunProgress) => {
				const steps = progress.steps > 1 ? ` · ${progress.step} of ${progress.steps} Groups` : '';
				this.studio.updateNotice(noticeId, { message: `Fitting ${progress.name}${steps}`, progress: progress.fraction });
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
		if (answer.laterLateHits > 0) parts.push(`${answer.laterLateHits} later ${answer.laterLateHits === 1 ? 'hit is' : 'hits are'} no longer on time`);
		if (answer.otherMarbleTouches.length > 0) parts.push('it touches another marble’s pieces');
		this.studio.notifyEdit(parts.join(' · '), [], details != null ? { details } : {});
	}
}

function verdictOf(target: TPatternTarget, kind: TPatternKind, answer: TPatternAnswer, isHover: boolean): TPatternVerdict {
	return { key: verdictKey(target), marbleId: target.marbleId, kind, isChecking: false, verdicts: answer.verdicts, refusal: answer.refusal, offers: answer.offers, movedAfter: answer.movedAfter, isHover };
}

/** Where the tiles say what a Pattern makes of a range */
export function verdictKey(target: TPatternTarget): string {
	return target.group != null ? toGroupKey(target.group.id) : toRangeKey(target.marbleId, target.from, target.to);
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

function previewKey(change: TPatternAsk): string {
	return JSON.stringify(change);
}

/** The ranges a selection offers tiles for, one per marble: selected hits or a dragged silence. Empty when it offers none */
export function patternTargets(project: TProject, selection: readonly string[]): TPatternTarget[] {
	const range = selection.flatMap((key) => parseRangeKey(key) ?? [])[0];
	if (range != null) return [range];
	const byMarble = new Map<string, number[]>();
	for (const key of selection) {
		const parsed = parseHitKey(key);
		const hit = project.marbles.find((marble) => marble.id === parsed?.marbleId)?.hits.find((item) => item.id === parsed?.hitId);
		if (parsed == null || hit == null) continue;
		byMarble.set(parsed.marbleId, [...(byMarble.get(parsed.marbleId) ?? []), hit.time]);
	}
	return [...byMarble].map(([marbleId, times]) => ({ marbleId, from: Math.min(...times), to: Math.max(...times) }));
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

/** Selection for a range dragged in the strip: its notes as hits, the same as dragging over them, or the silence itself */
export function rangeSelection(project: TProject, marbleId: string, from: number, to: number): string[] {
	const marble = project.marbles.find((item) => item.id === marbleId);
	if (marble == null) return [];
	const hits = hitsInRange(marble, from, to);
	return hits.length > 0 ? hits.map((hit) => toHitKey(marbleId, hit.id)) : [toRangeKey(marbleId, from, to)];
}

