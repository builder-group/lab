import { cachedFollowCameraTrack, followCameraTrack, framingStretches, isInFrame, type TCameraTrack, type TFramingStretch } from '@/modules/camera';
import { hitReach, isUnreachable, reachStatus } from '@/modules/compose/reachability';
import type { TProject, TProjectCommand, TVec2 } from '@/modules/project';
import { FINISH_TYPE, finishCatch, getPieceDefinition, soundsHit, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { formatTime } from '@/modules/studio/format';
import { CAMERA_KEY, toHitKey } from '@/modules/studio/selection';
import { problemsInTimeOrder } from '@/modules/studio/timeline/hit-status';
import { describeLoop } from './loop-status';
import { addWideShotCommands } from './shots';

/**
 * The project's problems, like Xcode's issue navigator: hits that miss or drift, hits no platform can reach yet,
 * Blocked scenery, marbles the camera leaves out of frame while they play, stray contacts, the loop and a stale
 * result. It is the one source for the hit summary in the timeline header, its menu, the export sheet and the
 * Camera track. Warnings are problems the film will show; notes are worth a look. Neither blocks the export.
 */
export function preflightExport(project: TProject, result: TSimulationResult | null): TExportPreflight {
	if (result == null || result.revision !== project.revision) {
		return {
			state: 'pending',
			issues: [{ id: 'simulation', kind: 'simulation', severity: 'info', title: 'Checking the run…', detail: 'The run is still updating after the latest edit.', target: null }],
			summary: 'Checking the run…',
			warnings: 0,
			notes: 1,
			hitCount: countHits(project),
			onTimeCount: 0
		};
	}

	const names = createNames(project);
	const issues: TPreflightIssue[] = [
		...hitIssues(project, result, names),
		...sceneryIssues(project, result, names),
		...finishIssues(project, result, names),
		...contactIssues(project, result, names),
		...framingIssues(project, result, names),
		...loopIssues(project, result)
	];
	issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || (a.time ?? Infinity) - (b.time ?? Infinity));

	const warnings = issues.filter((issue) => issue.severity === 'warning').length;
	const notes = issues.length - warnings;
	const hitCount = result.hits.length;
	const onTimeCount = result.hits.filter((hit) => hit.status === 'onTime').length;
	const checked: TExportPreflight = { state: 'checked', issues, summary: '', warnings, notes, hitCount, onTimeCount };
	// The sheet says what the hit summary says, with the tips after it
	const tips = notes > 0 ? `${notes} ${notes === 1 ? 'tip' : 'tips'}` : '';
	return { ...checked, summary: [problemSummary(checked).label, tips].filter(Boolean).join(' · ') };
}

/**
 * The hit summary of the timeline header, read from the preflight so it never disagrees with the export sheet,
 * Layers or the Camera track: "107 of 109 hits on time · 4 other problems", "2 hits need attention", or
 * "Checking…" until the run for the current edit arrives. Problems are the warnings in time order, so the
 * summary's click and Show First Problem go to the earliest.
 */
export function problemSummary(preflight: TExportPreflight): TProblemSummary {
	const { hitCount: total, onTimeCount: onTime } = preflight;
	if (preflight.state === 'pending') return { state: 'pending', tone: 'neutral', label: 'Checking…', problems: [], hitProblems: 0, otherProblems: 0, onTime, total };
	const problems = problemsInTimeOrder(preflight.issues.filter((issue) => issue.severity === 'warning'));
	const hitProblems = problems.filter((issue) => issue.kind === 'hit').length;
	const otherProblems = problems.length - hitProblems;
	const hits =
		hitProblems > 0
			? `${hitProblems} ${hitProblems === 1 ? 'hit needs' : 'hits need'} attention`
			: total > 0
				? `${onTime} of ${total} ${total === 1 ? 'hit' : 'hits'} on time`
				: '';
	const others = otherProblems > 0 ? `${otherProblems} ${hits === '' ? '' : 'other '}${otherProblems === 1 ? 'problem' : 'problems'}` : '';
	const label = [hits, others].filter(Boolean).join(' · ') || 'No hits yet';
	const tone = problems.length > 0 ? 'warn' : total > 0 && onTime === total ? 'good' : 'neutral';
	return { state: 'checked', tone, label, problems, hitProblems, otherProblems, onTime, total };
}

/**
 * The pieces another marble hits outside a note, by entity ID, with those problems: "Bass hits Switchback 6 of
 * Melody". Layers badges them and the inspector shows a pill and a fix, from the same list as the summary.
 */
export function struckPieces(preflight: TExportPreflight): Map<string, TPreflightIssue[]> {
	const struck = new Map<string, TPreflightIssue[]>();
	for (const issue of preflight.issues) {
		// Contacts between two marbles carry no lane; they are about the marbles, not a piece
		const id = issue.kind === 'contact' && issue.laneId != null ? issue.target?.ids[0] : undefined;
		if (id != null) struck.set(id, [...(struck.get(id) ?? []), issue]);
	}
	return struck;
}

/**
 * The framing problem at `time`, as the Camera panel shows it after a jump to it: the one whose span holds the time,
 * or that starts within the lead of its Wide shot fix after it. Null when there is none.
 */
export function framingProblemAt(preflight: TExportPreflight, time: number): TPreflightIssue | null {
	const spans = preflight.issues.filter((issue) => issue.kind === 'framing' && issue.span != null);
	return spans.find((issue) => issue.span != null && time >= issue.span.from - 1e-6 && time <= issue.span.to + 1e-6) ?? spans.find((issue) => issue.span != null && time >= issue.span.from - WIDE_LEAD && time <= issue.span.to) ?? null;
}

export interface TProblemSummary {
	state: TExportPreflight['state'];
	tone: 'good' | 'warn' | 'neutral';
	label: string;
	/**
	 * Warnings in time order, as the problem menu lists them and Show First Problem picks the first: by their time,
	 * a framing span's start or their target's time; issues without one come last
	 */
	problems: TPreflightIssue[];
	hitProblems: number;
	otherProblems: number;
	onTime: number;
	total: number;
}

export interface TExportPreflight {
	/** `pending` while the shown result belongs to an older revision or there is none yet */
	state: 'pending' | 'checked';
	/** Warnings first, then notes, each in time order */
	issues: TPreflightIssue[];
	/** One line for the sheet and the Output panel, such as "All 115 hits on time" or "3 issues" */
	summary: string;
	warnings: number;
	notes: number;
	hitCount: number;
	onTimeCount: number;
}

export type TPreflightSeverity = 'warning' | 'info';

export interface TPreflightIssue {
	/** Stable within one result, for React keys */
	id: string;
	/**
	 * What the issue is about: `hit` for a hit that is not on time or cannot be reached, which the hit summary
	 * counts as hits; `framing` for the camera losing a marble, drawn on the Camera track; the rest are other problems
	 */
	kind: TPreflightKind;
	severity: TPreflightSeverity;
	/** For a marble hitting another lane's piece, that marble's name: "Bass" in "Bass hits Switchback 6 of Melody" */
	by?: string;
	/** The marble the issue is about: for hit, framing, pace and Blocked scenery issues, and for a marble hitting another lane's piece, the lane the piece belongs to */
	laneId?: string;
	title: string;
	detail?: string;
	/** Run time the issue happens at, if it has one */
	time?: number;
	/** The stretch of the run a framing issue lasts, for the Camera track */
	span?: { from: number; to: number };
	/** What Compose selects and frames when the issue is clicked */
	target: TPreflightTarget | null;
}

export interface TPreflightFix {
	label: string;
	/** One sentence for the tooltip: what the fix does */
	detail: string;
	commands: TProjectCommand[];
	/** The shot the fix adds, to select after it */
	shotId?: string;
}

export interface TPreflightTarget {
	/** Selection keys: entity IDs or hit keys */
	ids: string[];
	/** Wall point to bring into view, for issues without a piece such as marble collisions */
	point?: TVec2;
	/** Playhead time to show */
	time?: number;
	/** The workspace that shows the issue; framing issues open Film with the Camera selected */
	workspace?: 'compose' | 'design';
}

export type TPreflightKind = 'hit' | 'open' | 'scenery' | 'contact' | 'framing' | 'loop' | 'simulation';

const severityOrder: Record<TPreflightSeverity, number> = { warning: 0, info: 1 };

/** Seconds before a framing problem a Wide shot starts, so the zoom has widened by then */
const WIDE_LEAD = 1.5;
/** Seconds the Wide shot holds past the end of the problem */
const WIDE_AFTER = 0.5;
/** Distances over the rig's a Wide shot fix tries in turn, the kind's preset first */
const WIDE_SCALES = [1.6, 2.0, 2.5] as const;

// MARK: - Hits

function hitIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	const issues: TPreflightIssue[] = [];
	const pieces = new Map(result.pieces.map((piece) => [piece.entityId, piece]));
	const open: THitResult[] = [];

	const numbers = new Map(project.music.lanes.flatMap((lane) => lane.hits.map((hit, index) => [toHitKey(lane.id, hit.id), index + 1] as const)));
	for (const hit of result.hits) {
		const lane = names.lane(hit.laneId);
		const key = toHitKey(hit.laneId, hit.hitId);
		// "Hit 12 of Melody is Blocked", as words.md names a hit by its number on its marble
		const is = (label: string): string => `Hit ${numbers.get(key) ?? '?'} of ${lane} is ${label}`;
		const piece = hit.pieceEntityId != null ? pieces.get(hit.pieceEntityId) : undefined;
		const target: TPreflightTarget = { ids: hit.pieceEntityId != null ? [hit.pieceEntityId] : [key], point: hit.dot ?? undefined, time: hit.targetTime };
		const id = `hit:${hit.laneId}:${hit.hitId}`;

		if (hit.status === 'blocked') {
			issues.push({
				id,
				kind: 'hit',
				severity: 'warning',
				laneId: hit.laneId,
				title: is('Blocked'),
				detail: `${lane} already passes through this spot earlier in its run, so the platform is left out.`,
				time: hit.targetTime,
				target
			});
		} else if (hit.status === 'missed') {
			const label = hit.reason === 'resting' && piece?.status !== 'unreached' ? 'Stopped' : 'Missed';
			issues.push({ id, kind: 'hit', severity: 'warning', laneId: hit.laneId, title: is(label), detail: missDetail(hit, piece?.status), time: hit.targetTime, target });
		} else if (hit.status === 'drifting') {
			const ms = Math.round((hit.error ?? 0) * 1000);
			issues.push({
				id,
				kind: 'hit',
				severity: 'warning',
				laneId: hit.laneId,
				title: is(ms > 0 ? 'Late' : 'Early'),
				detail: `Lands ${Math.abs(ms)} ms ${ms > 0 ? 'after' : 'before'} the note.`,
				time: hit.targetTime,
				target
			});
		} else if (hit.status === 'open') {
			const reach = hitReach(project, result, hit);
			const status = isUnreachable(reach) ? reachStatus(reach, { marble: lane, time: formatTime(hit.targetTime) }) : null;
			if (status != null) issues.push({ id, kind: 'hit', severity: 'warning', laneId: hit.laneId, title: is(status.label), detail: `${status.detail}.`, time: hit.targetTime, target });
			else open.push(hit);
		}
	}

	// Open hits are grouped per lane: a sketch has many, and each row would say the same
	for (const [laneId, hits] of groupByLane(open, (hit) => hit.laneId)) {
		const first = hits[0];
		if (first == null) continue;
		const count = hits.length;
		issues.push({
			id: `open:${laneId}`,
			kind: 'open',
			severity: 'info',
			title: count === 1 ? `Open note, ${names.lane(laneId)} at ${formatTime(first.targetTime)}` : `${count} open notes on ${names.lane(laneId)}`,
			detail:
				count === 1
					? 'No platform plays this note yet. It still sounds in the film, without a hit.'
					: `No platforms play these notes yet, from ${formatTime(first.targetTime)}. They still sound in the film, without hits.`,
			time: first.targetTime,
			target: { ids: [toHitKey(laneId, first.hitId)], time: first.targetTime }
		});
	}
	return issues;
}

function groupByLane<T>(items: T[], laneOf: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) groups.set(laneOf(item), [...(groups.get(laneOf(item)) ?? []), item]);
	return groups;
}

function missDetail(hit: THitResult, pieceStatus: string | undefined): string {
	if (pieceStatus === 'unreached') return 'The marble never reaches this platform.';
	if (hit.reason === 'resting') return 'The marble stops on the platform instead of striking it.';
	if (hit.actualTime == null || hit.error == null) return 'The marble passes the platform without touching it.';
	const ms = Math.round(hit.error * 1000);
	return `Lands ${Math.abs(ms)} ms ${ms > 0 ? 'after' : 'before'} the note.`;
}

// MARK: - Scenery

/** Scenery that follows a marble but is left out of the run, because the marble's earlier run passes through it */
function sceneryIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	return result.pieces.flatMap((piece) => {
		if (piece.status !== 'blocked') return [];
		const entity = project.entities.find((item) => item.id === piece.entityId);
		const link = entity?.components.hitLink;
		// Platforms that play a note are reported with their hit
		if (link == null || soundsHit(entity?.components.piece?.type ?? piece.type, link)) return [];
		const lane = names.lane(link.laneId);
		const time = piece.entryTime ?? piece.hitTime ?? undefined;
		const type = (getPieceDefinition(piece.type)?.label ?? 'piece').toLowerCase();
		return [
			{
				id: `scenery:${piece.entityId}`,
				kind: 'scenery' as const,
				severity: 'warning' as const,
				laneId: link.laneId,
				title: `${names.entity(piece.entityId)} of ${lane} is Blocked`,
				detail: `${lane} already passes through this spot earlier in its run, so the ${type} is left out.`,
				time,
				target: { ids: [piece.entityId], point: piece.position, time }
			}
		];
	});
}

// MARK: - Finishes

/**
 * Finishes that do not catch their marble: "Melody misses the Finish" when the marble falls past it, bounces out of it,
 * or the film ends before the marble gets there. A Blocked Finish is reported as Blocked scenery. The inspector's
 * Fix-it places it again (Place Finish Again).
 */
function finishIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	return project.entities.flatMap((entity) => {
		const link = entity.components.hitLink;
		if (entity.components.piece?.type !== FINISH_TYPE || link == null) return [];
		const piece = result.pieces.find((item) => item.entityId === entity.id);
		const caught = finishCatch(result, entity.id);
		if (piece == null || caught.status === 'caught' || caught.status === 'blocked') return [];
		const lane = names.lane(link.laneId);
		const time = piece.entryTime ?? piece.hitTime ?? undefined;
		const isLate = caught.status === 'missed' && time != null && time > result.duration - 0.05;
		const detail = isLate
			? `The film ends before ${lane} reaches the Finish. Fit to Song lengthens it.`
			: caught.status === 'escaped'
				? `${lane} lands in the Finish and bounces out of it.`
				: `${lane} falls past the Finish without landing in it.`;
		return [
			{
				id: `finish:${entity.id}`,
				kind: 'scenery' as const,
				severity: 'warning' as const,
				laneId: link.laneId,
				title: `${lane} misses the Finish`,
				detail,
				time,
				target: { ids: [entity.id], point: piece.position, time }
			}
		];
	});
}

/** The Finishes that miss their marble, by entity ID, as the problem model reports them */
export function missedFinishes(preflight: TExportPreflight): Set<string> {
	return new Set(preflight.issues.flatMap((issue) => (issue.id.startsWith('finish:') ? [issue.id.slice('finish:'.length)] : [])));
}

// MARK: - Contacts

/**
 * Stray contacts: marbles touching each other or another lane's pieces. Contacts with the marble's own pieces
 * are expected even after their hit, such as a second bounce or the ride through a rail, tunnel, switchback or
 * windmill. Free pieces, platforms included, are environment the marbles may strike.
 */
function contactIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	const laneOfMarble = new Map(result.marbles.map((marble) => [marble.entityId, marble.laneId]));
	const laneOfPiece = new Map<string, string>();
	for (const entity of project.entities) {
		if (entity.components.hitLink != null) laneOfPiece.set(entity.id, entity.components.hitLink.laneId);
	}
	for (const hit of result.hits) {
		if (hit.pieceEntityId != null) laneOfPiece.set(hit.pieceEntityId, hit.laneId);
	}

	const groups = new Map<string, { kind: 'marble' | 'lane'; marbleId: string; otherId: string; first: TVec2; time: number; count: number }>();
	for (const contact of result.contacts) {
		if (contact.time > result.duration) continue;
		let kind: 'marble' | 'lane';
		if (contact.kind === 'marble') {
			// Every collision is reported once per marble; keep the pair once
			if (contact.marbleEntityId > contact.otherEntityId) continue;
			kind = 'marble';
		} else {
			const pieceLane = laneOfPiece.get(contact.otherEntityId);
			const marbleLane = laneOfMarble.get(contact.marbleEntityId);
			// Free pieces are environment; only another lane's attached pieces are stray
			if (pieceLane == null || pieceLane === marbleLane) continue;
			kind = 'lane';
		}
		const key = `${contact.marbleEntityId}:${contact.otherEntityId}`;
		const group = groups.get(key);
		if (group != null) group.count++;
		else groups.set(key, { kind, marbleId: contact.marbleEntityId, otherId: contact.otherEntityId, first: contact.position, time: contact.time, count: 1 });
	}

	return [...groups.values()].map((group) => {
		const marble = names.entity(group.marbleId);
		const other = names.entity(group.otherId);
		const times = group.count > 1 ? `${group.count} times from ${formatTime(group.time)}` : `at ${formatTime(group.time)}`;
		const id = `contact:${group.marbleId}:${group.otherId}`;
		if (group.kind === 'marble') {
			return {
				id,
				kind: 'contact' as const,
				severity: 'warning' as const,
				title: `${marble} collides with ${other}`,
				detail: `The marbles touch ${times}.`,
				time: group.time,
				target: { ids: [group.marbleId, group.otherId], point: group.first, time: group.time }
			};
		}
		return {
			id,
			kind: 'contact' as const,
			severity: 'warning' as const,
			laneId: laneOfPiece.get(group.otherId),
			by: marble,
			title: `${marble} hits ${other} of ${names.lane(laneOfPiece.get(group.otherId) ?? '')}`,
			detail: `Hits it ${times}, without a note.`,
			time: group.time,
			target: { ids: [group.otherId], point: group.first, time: group.time }
		};
	});
}

// MARK: - Framing

/**
 * Marbles the automatic camera leaves out of frame while they play, from the same camera track the Draft Preview
 * draws and the film bakes: "Bass leaves the frame at 0:12.00 (6 hits)". Each stretch offers Add Wide Shot Here once a
 * what-if of the camera with that shot keeps the marble in frame and adds no other framing problem. A manual camera
 * lives in Blender, which the app cannot see, so it has none.
 */
function framingIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	const framing = checkFraming(project, result);
	if (framing == null) return [];
	const counts = new Map<string, number>();
	return framing.stretches.map((stretch, index) => {
		const lane = names.lane(stretch.laneId);
		const number = (counts.get(stretch.laneId) ?? 0) + 1;
		counts.set(stretch.laneId, number);
		const hits = `${stretch.notes.length} ${stretch.notes.length === 1 ? 'hit' : 'hits'}`;
		const seconds = (stretch.to - stretch.from).toFixed(1);
		const followed = framing.followed[index] ?? [];
		const others = followed.length ? ` The camera follows ${followed.map((laneId) => names.lane(laneId)).join(' and ')} there.` : '';
		return {
			id: `frame:${stretch.laneId}:${number}`,
			kind: 'framing' as const,
			severity: 'warning' as const,
			laneId: stretch.laneId,
			title: `${lane} leaves the frame at ${formatTime(stretch.from)} (${hits})`,
			detail: `Out of frame for ${seconds} s while it plays, until ${formatTime(stretch.to)}.${others}`,
			time: stretch.from,
			span: { from: stretch.from, to: stretch.to },
			target: cameraTarget(stretch.from)
		};
	});
}

/**
 * Add Wide Shot Here for a framing problem of the current run: a Wide shot from WIDE_LEAD before the problem to
 * WIDE_AFTER past it, at the kind's preset distance or wider, offered only once a what-if of the camera with it keeps
 * the marble in frame and leaves fewer framing problems. Null when none works. Each what-if bakes the camera (about
 * 20 ms for Jingle Bells), so it runs only for the problem shown and is kept per run.
 */
export function framingFix(project: TProject, result: TSimulationResult | null, issue: TPreflightIssue): TPreflightFix | null {
	if (result == null || result.revision !== project.revision || issue.kind !== 'framing') return null;
	const framing = checkFraming(project, result);
	if (framing == null) return null;
	const counts = new Map<string, number>();
	const index = framing.stretches.findIndex((stretch) => {
		const number = (counts.get(stretch.laneId) ?? 0) + 1;
		counts.set(stretch.laneId, number);
		return `frame:${stretch.laneId}:${number}` === issue.id;
	});
	const stretch = framing.stretches[index];
	if (stretch == null) return null;
	if (!framing.fixes.has(index)) framing.fixes.set(index, findWideShot(project, result, framing, stretch));
	const wide = framing.fixes.get(index);
	if (wide == null) return null;
	const lane = project.music.lanes.find((item) => item.id === stretch.laneId)?.name ?? 'the marble';
	return {
		label: 'Add Wide Shot Here',
		detail: `Adds a Wide shot at ${formatTime(wide.time)} that holds ${wide.length.toFixed(1)} s, so ${lane} stays in frame.`,
		commands: wide.commands,
		shotId: wide.shotId
	};
}

interface TFraming {
	stretches: TFramingStretch[];
	/** Per stretch, the lanes of the marbles in frame at its middle */
	followed: string[][];
	/** Per stretch, the Wide shot a what-if found to keep its marble in frame, once asked */
	fixes: Map<number, TWideShot | null>;
	fps: number;
}

interface TWideShot {
	time: number;
	length: number;
	commands: TProjectCommand[];
	shotId: string;
}

/** Framing per run and camera settings; the what-ifs bake up to three tracks per problem, so it is kept */
const framings = new WeakMap<TSimulationResult['marbles'], Map<string, TFraming | null>>();

function checkFraming(project: TProject, result: TSimulationResult): TFraming | null {
	if (project.design.camera.mode === 'manual') return null;
	// `renderFps`: the film's frame rate, which the Draft Preview's camera uses too
	const fps = project.design.renderPreset === 'best' ? 60 : 30;
	const key = `${fps}:${JSON.stringify(project.design.camera)}:${project.frame.width}x${project.frame.height}:${project.design.loop}:${result.duration}`;
	let byKey = framings.get(result.marbles);
	if (byKey == null) {
		byKey = new Map();
		framings.set(result.marbles, byKey);
	}
	const cached = byKey.get(key);
	if (cached !== undefined) return cached;
	const track = cachedFollowCameraTrack(project, result, fps);
	const framing = track != null ? measureFraming(project, result, track, fps) : null;
	if (byKey.size >= 8) byKey.delete(byKey.keys().next().value as string);
	byKey.set(key, framing);
	return framing;
}

function measureFraming(project: TProject, result: TSimulationResult, track: TCameraTrack, fps: number): TFraming {
	const stretches = framingStretches(result, track);
	const followed = stretches.map((stretch) => {
		const time = (stretch.from + stretch.to) / 2;
		const frame = Math.min(track.frameCount - 1, Math.round(time * fps));
		return result.marbles.filter((marble) => marble.laneId !== stretch.laneId && marble.samples.length && isInFrame(track, frame, marble, time)).map((marble) => marble.laneId);
	});
	return { stretches, followed, fixes: new Map(), fps };
}

function findWideShot(project: TProject, result: TSimulationResult, framing: TFraming, stretch: TFramingStretch): TWideShot | null {
	const time = Math.max(0, Math.round((stretch.from - WIDE_LEAD) * 100) / 100);
	const length = Math.round((stretch.to + WIDE_AFTER - time) * 100) / 100;
	for (const scale of WIDE_SCALES) {
		const wide = addWideShotCommands(project, time, length, project.design.camera.distance * scale);
		const trial = followCameraTrack(wide.project, result, framing.fps);
		if (trial == null) continue;
		const after = framingStretches(result, trial);
		const isKept = !after.some((other) => other.laneId === stretch.laneId && other.from < stretch.to && other.to > stretch.from);
		if (isKept && after.length < framing.stretches.length) return { time, length, commands: wide.commands, shotId: wide.shotId };
	}
	return null;
}

// MARK: - Loop

function loopIssues(project: TProject, result: TSimulationResult): TPreflightIssue[] {
	if (!project.design.loop) return [];
	const status = describeLoop(project, result);
	if (status.isOk) return [];
	return [{ id: 'loop', kind: 'loop', severity: 'warning', title: status.summary, detail: status.details.join(' '), target: null }];
}

// MARK: - Names

interface TNames {
	lane: (id: string) => string;
	entity: (id: string) => string;
}

function createNames(project: TProject): TNames {
	const lanes = new Map(project.music.lanes.map((lane) => [lane.id, lane.name]));
	const entities = new Map(
		project.entities.map((entity) => {
			const type = entity.components.piece?.type;
			const fallback = entity.components.marble != null ? 'Marble' : type != null ? (getPieceDefinition(type)?.label ?? type) : entity.id;
			return [entity.id, entity.name ?? fallback];
		})
	);
	return { lane: (id) => lanes.get(id) ?? 'Marble', entity: (id) => entities.get(id) ?? id };
}

/** Framing issues open Film at their time with the Camera selected */
function cameraTarget(time: number): TPreflightTarget {
	return { ids: [CAMERA_KEY], time, workspace: 'design' };
}

function countHits(project: TProject): number {
	return project.music.lanes.reduce((sum, lane) => sum + lane.hits.length, 0);
}
