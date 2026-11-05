import { createState } from 'feature-state';
import { createPatternClient, flattenCommands, groupsOfLane, hitsInRange, patternLockWords, patternOfPiece, PATTERN_DEFAULTS, PATTERN_LABELS, PatternCanceledError, type TGroupChange, type TPatternClient, type TPatternKind, type TPatternProblem } from '@/modules/building';
import { type TPatternAnswer } from '@/modules/building/patterns/pattern.worker';
import { type TResolvedPiece } from '@/modules/simulation';
import type { TGroup, TPatternGroup, TProject } from '@/modules/project';
import { parseHitKey, parseRangeKey, toGroupKey, toHitKey, toRangeKey } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';

/** How long a pointer rests on a tile before its ghost is worked out: real rhythm takes about 230 ms for 9 hits, so moving across tiles asks nothing */
const HOVER_DELAY = 180;
/** A second try on a locked piece within this is the same try, and says nothing new */
const LOCK_NOTICE_MS = 3000;

/** Where a Pattern goes: a range of one marble's row, or the Group already there */
export interface TPatternTarget {
	laneId: string;
	from: number;
	to: number;
	group?: TPatternGroup;
}

export interface TPatternPreview {
	revision: number;
	kind: TPatternKind;
	key: string;
	laneId: string;
	pieces: TResolvedPiece[];
	/** Milliseconds from asking in the worker to the answer, for the check of hover speed */
	ms: number;
}

/** What the inspector or an agent asks of a Pattern, past its range */
export interface TPatternSettings {
	width?: number;
	bounce?: number;
	maxTilt?: number;
}

/** What the tiles say for a range that couldn't take a Pattern */
export interface TPatternFailure {
	key: string;
	problems: TPatternProblem[];
}

/**
 * The Patterns prototype in Track: a click on a tile makes or changes a Group, one Undo step, with progress and Stop in
 * the notice; resting on a tile shows its ghost on the wall. Agents come here too, with `applyPattern`.
 */
export class PatternsCx {
	readonly $preview = createState<TPatternPreview | null>(null);
	readonly $failure = createState<TPatternFailure | null>(null);
	readonly $isRunning = createState(false);

	private client: TPatternClient | null = null;
	private hoverTimer: ReturnType<typeof setTimeout> | undefined;
	private hoverKey: string | null = null;
	/** `$failure` is only what the ghost's one shape showed, gone with the hover */
	private isHoverFailure = false;
	/** The run on its way, which an edit ends; `isReplaced` when a newer click takes its place, which says nothing */
	private run: { key: string; isReplaced: boolean } | null = null;

	constructor(readonly studio: StudioCx) {}

	mount(): () => void {
		this.$preview.set(null);
		this.$failure.set(null);
		const unlisten = [
			this.studio.$history.listen(({ value }) => {
				if (this.$preview.get() != null && this.$preview.get()?.revision !== value?.present.revision) this.$preview.set(null);
				// A new Undo step or an Undo is an edit; the song's length and a settled run amend the step they follow
				if (this.run != null && value != null && stepKey(value) !== this.run.key) this.client?.cancel();
			}),
			this.studio.$selection.listen(() => {
				if (this.$failure.get() != null) this.$failure.set(null);
			})
		];
		return () => {
			for (const stop of unlisten) stop();
			clearTimeout(this.hoverTimer);
			this.client?.dispose();
			this.client = null;
		};
	}

	/** Rest on a tile. The ghost shows the first of several marbles */
	hover(target: TPatternTarget, kind: TPatternKind): void {
		const project = this.studio.project;
		if (project == null || this.run != null) return;
		const change = changeFor(target, kind);
		const key = previewKey(change);
		this.hoverKey = key;
		clearTimeout(this.hoverTimer);
		this.hoverTimer = setTimeout(() => {
			const startedAt = performance.now();
			this.clientNow()
				.preview(project, change)
				.then((answer) => {
					if (this.hoverKey !== key || this.studio.project?.revision !== project.revision) return;
					this.$preview.set({ revision: project.revision, kind, key, laneId: change.laneId, pieces: answer.pieces, ms: performance.now() - startedAt });
					// The ghost is one shape, so a click may still find a better one: what's wrong with it is only said to be likely
					const [blocking] = answer.blocking;
					if (blocking != null) {
						this.isHoverFailure = true;
						this.$failure.set({ key: failureKey(target), problems: [{ ...blocking, words: `May not fit: ${blocking.words}` }] });
					}
					// Notes in free fall lie far below the view: a ghost nobody sees previews nothing, so the view pans to it, keeping the zoom
					const middle = answer.pieces[Math.floor(answer.pieces.length / 2)];
					if (middle != null) this.studio.$reveal.set({ ids: [], point: middle.position });
				})
				.catch((error: unknown) => {
					if (!(error instanceof PatternCanceledError)) console.warn(error);
				});
		}, HOVER_DELAY);
	}

	endHover(): void {
		this.hoverKey = null;
		clearTimeout(this.hoverTimer);
		if (this.$preview.get() != null) this.$preview.set(null);
		if (this.isHoverFailure) this.$failure.set(null);
		this.isHoverFailure = false;
	}

	stop(): void {
		this.isStopped = true;
		this.client?.cancel();
	}

	private isStopped = false;

	/**
	 * Gravity changes how every marble falls, so live Patterns fit again, in one Undo step with it. A Group fits the later
	 * ones on its marble itself, so the first of each marble is enough. Stop takes the change back, so nothing changed.
	 */
	async setGravity(gravityScale: number): Promise<void> {
		this.endHover();
		if (!this.studio.execute([{ type: 'setPhysics', physics: { gravityScale } }])) return;
		const project = this.studio.project;
		if (project == null) return;
		this.isStopped = false;
		for (const group of project.music.lanes.flatMap((lane) => groupsOfLane(project, lane.id)[0] ?? [])) {
			const answer = await this.fit(changeFor({ laneId: group.laneId, from: group.from, to: group.to, group }, group.kind), false);
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
		const change = changeFor(target, kind, settings);
		const answer = await this.fit(change);
		if (answer == null) return null;
		if (!answer.commands.length || answer.groupId == null) {
			this.refuse(target, kind, settings, answer);
			return answer;
		}
		if (!this.studio.simulation.landWorkedOut(answer.commands, { label: PATTERN_LABELS[kind] })) return null;
		const group = this.studio.project?.groups?.find((item) => item.id === answer.groupId);
		const pieceIds = group?.pieceIds ?? [];
		this.studio.$selection.set([toGroupKey(answer.groupId), ...pieceIds]);
		// The zoom stays where the range was framed, like an operator's redo in Blender
		this.studio.$trackCx.get()?.revealOnceSimulated(pieceIds, true);
		this.tell(answer, madeWords(target, kind, settings, answer.name));
		return answer;
	}

	/** Nothing changed: the notice says which hit and why, the wall shows it, the tiles keep saying it */
	private refuse(target: TPatternTarget, kind: TPatternKind, settings: TPatternSettings, answer: TPatternAnswer): void {
		const { refusal, nearestWidth } = answer;
		const words = refusal?.words ?? answer.problems[0]?.words ?? `${PATTERN_LABELS[kind]} can't fit here.`;
		this.$failure.set({ key: failureKey(target), problems: [{ hitId: refusal?.hitId ?? answer.problems[0]?.hitId ?? '', words }] });
		const width = nearestWidth != null && settings.width !== nearestWidth ? nearestWidth : null;
		const actions = width != null ? [{ label: `Try Width ${Math.round(width * 100)} cm`, title: 'The nearest Width with no problems', run: () => void this.apply(target, kind, { ...settings, width }) }] : [];
		this.studio.notify(words, 'error', { actions });
		if (refusal?.hitId != null) this.studio.$reveal.set({ ids: [toHitKey(refusal.laneId, refusal.hitId)], isZoomKept: true });
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

	private async fit(change: TGroupChange, isChecked = true): Promise<TPatternAnswer | null> {
		const project = this.studio.project;
		if (project == null) return null;
		if (this.run != null) this.run.isReplaced = true;
		const history = this.studio.$history.get();
		const run = { key: history != null ? stepKey(history) : '', isReplaced: false };
		this.run = run;
		this.$isRunning.set(true);
		const label = PATTERN_LABELS[change.kind];
		const noticeId = this.studio.notify(`Fitting ${label}`, 'info', { progress: 0, actions: [{ label: 'Stop', title: 'Stop fitting; nothing changes', run: () => this.stop() }] });
		try {
			const answer = await this.clientNow().run(project, change, (progress) => {
				const steps = progress.steps > 1 ? ` · ${progress.step} of ${progress.steps} Groups` : '';
				this.studio.updateNotice(noticeId, { message: `Fitting ${progress.name}${steps}`, progress: progress.fraction });
			}, isChecked);
			this.studio.updateNotice(noticeId, { progress: undefined, actions: [] });
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

/** Where the tiles say why a Pattern doesn't fit */
function failureKey(target: TPatternTarget): string {
	return target.group != null ? toGroupKey(target.group.id) : toRangeKey(target.laneId, target.from, target.to);
}

function changeFor(target: TPatternTarget, kind: TPatternKind, settings: TPatternSettings = {}): TGroupChange {
	const { group, laneId, from, to } = target;
	const defaults = PATTERN_DEFAULTS[kind];
	const isSameKind = group?.kind === kind;
	const maxTilt = settings.maxTilt ?? (isSameKind ? group.maxTilt : undefined);
	return {
		...(group != null ? { groupId: group.id } : {}),
		laneId,
		from,
		to,
		kind,
		width: settings.width ?? (isSameKind ? group.width : defaults.width),
		bounce: settings.bounce ?? (isSameKind ? group.bounce : defaults.bounce),
		...(maxTilt != null ? { maxTilt } : {})
	};
}

/** What a click or a setting just did, so the notice names the edit its Undo takes back */
function madeWords(target: TPatternTarget, kind: TPatternKind, settings: TPatternSettings, name: string): string {
	const { group } = target;
	if (group == null) return `Made ${name}`;
	if (group.kind !== kind) return `${group.name} is now ${PATTERN_LABELS[kind]}`;
	if (settings.width != null) return `${name}: Width ${(settings.width * 100).toFixed(0)} cm`;
	if (settings.bounce != null) return `${name}: Bounce ${settings.bounce.toFixed(2)}`;
	if (settings.maxTilt != null) return `${name}: Tilt limit ${settings.maxTilt.toFixed(0)}°`;
	return target.from !== group.from || target.to !== group.to ? `${name}: new range` : `Fitted ${name} again`;
}

function stepKey(history: { past: readonly unknown[]; future: readonly unknown[] }): string {
	return `${history.past.length}:${history.future.length}`;
}

function previewKey(change: TGroupChange): string {
	return JSON.stringify(change);
}

/** The ranges a selection offers tiles for, one per marble: selected hits or a dragged silence. Empty when it offers none */
export function patternTargets(project: TProject, selection: readonly string[]): TPatternTarget[] {
	const range = selection.flatMap((key) => parseRangeKey(key) ?? [])[0];
	if (range != null) return [range];
	const byLane = new Map<string, number[]>();
	for (const key of selection) {
		const parsed = parseHitKey(key);
		const hit = project.music.lanes.find((lane) => lane.id === parsed?.laneId)?.hits.find((item) => item.id === parsed?.hitId);
		if (parsed == null || hit == null) continue;
		byLane.set(parsed.laneId, [...(byLane.get(parsed.laneId) ?? []), hit.time]);
	}
	return [...byLane].map(([laneId, times]) => ({ laneId, from: Math.min(...times), to: Math.max(...times) }));
}

/** A selection with every piece of a live Pattern standing for its whole Group, as a click on one does */
export function withWholePatterns(project: TProject, selection: readonly string[]): string[] {
	const groups = new Set(selection.flatMap((key) => patternOfPiece(project, key) ?? []));
	return [...new Set([...selection, ...[...groups].flatMap(groupSelection)])];
}

/** A selection with every piece of any Group standing for that Group, as a marquee finds Figma's groups */
export function withWholeGroups(project: TProject, selection: readonly string[]): string[] {
	const groups = (project.groups ?? []).filter((group) => group.pieceIds.some((id) => selection.includes(id)));
	return [...new Set([...selection, ...groups.flatMap(groupSelection)])];
}

/** Selecting a Group selects its pieces with it, so the wall and the hits show them and Delete takes them */
export function groupSelection(group: TGroup): string[] {
	return [toGroupKey(group.id), ...group.pieceIds];
}

/** Selection for a range dragged in the strip: its notes as hits, the same as dragging over them, or the silence itself */
export function rangeSelection(project: TProject, laneId: string, from: number, to: number): string[] {
	const lane = project.music.lanes.find((item) => item.id === laneId);
	if (lane == null) return [];
	const hits = hitsInRange(lane, from, to);
	return hits.length > 0 ? hits.map((hit) => toHitKey(laneId, hit.id)) : [toRangeKey(laneId, from, to)];
}

