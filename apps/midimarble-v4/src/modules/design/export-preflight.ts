import type { TProject, TVec2 } from '@/modules/project';
import { frameBand, getPieceDefinition, paceAt, type THitResult, type TSimulationResult } from '@/modules/simulation';
import { formatTime } from '@/modules/studio/format';
import { toHitKey } from '@/modules/studio/selection';
import { describeLoop } from './loop-status';

/**
 * Checks the run before a film export, like Xcode's issue navigator: hits that miss or drift, open hits,
 * dots outside the frame, stray contacts, marbles far off the shared pace, the loop and a stale result.
 * Warnings are problems the film will show; notes are worth a look. Neither blocks the export.
 */
export function preflightExport(project: TProject, result: TSimulationResult | null): TExportPreflight {
	if (result == null || result.revision !== project.revision) {
		return {
			state: 'pending',
			issues: [{ id: 'simulation', severity: 'info', title: 'Checking the run…', detail: 'The run is still updating after the latest edit.', target: null }],
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
		...contactIssues(project, result, names),
		...paceIssues(result, names),
		...loopIssues(project, result)
	];
	issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || (a.time ?? Infinity) - (b.time ?? Infinity));

	const warnings = issues.filter((issue) => issue.severity === 'warning').length;
	const notes = issues.length - warnings;
	const hitCount = result.hits.length;
	const onTimeCount = result.hits.filter((hit) => hit.status === 'onTime').length;
	return { state: 'checked', issues, summary: summarize(hitCount, onTimeCount, warnings, notes), warnings, notes, hitCount, onTimeCount };
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
	severity: TPreflightSeverity;
	title: string;
	detail?: string;
	/** Run time the issue happens at, if it has one */
	time?: number;
	/** What Compose selects and frames when the issue is clicked */
	target: TPreflightTarget | null;
}

export interface TPreflightTarget {
	/** Selection keys: entity IDs or hit keys */
	ids: string[];
	/** Wall point to bring into view, for issues without a piece such as marble collisions */
	point?: TVec2;
	/** Playhead time to show */
	time?: number;
}

const severityOrder: Record<TPreflightSeverity, number> = { warning: 0, info: 1 };

/** Distance off the shared descent pace, in multiples of the pace limit, at which the camera loses a marble */
const PACE_FACTOR = 2;

function summarize(hitCount: number, onTimeCount: number, warnings: number, notes: number): string {
	// Info issues are tips, so the count never reads like musical notes
	const noteText = notes > 0 ? `${notes} ${notes === 1 ? 'tip' : 'tips'}` : '';
	if (warnings > 0) return [`${warnings} ${warnings === 1 ? 'issue' : 'issues'}`, noteText].filter(Boolean).join(' · ');
	if (!hitCount) return notes > 0 ? noteText : 'No hits to check';
	const hits = `${onTimeCount} of ${hitCount} ${hitCount === 1 ? 'hit' : 'hits'} on time`;
	return [hits, noteText].filter(Boolean).join(' · ');
}

// MARK: - Hits

function hitIssues(project: TProject, result: TSimulationResult, names: TNames): TPreflightIssue[] {
	const issues: TPreflightIssue[] = [];
	const pieces = new Map(result.pieces.map((piece) => [piece.entityId, piece]));
	const isShared = result.marbles.length > 1;
	const open: THitResult[] = [];
	const outside: { hit: THitResult; overshoot: number; target: TPreflightTarget }[] = [];

	for (const hit of result.hits) {
		const lane = names.lane(hit.laneId);
		const key = toHitKey(hit.laneId, hit.hitId);
		const at = `${lane} at ${formatTime(hit.targetTime)}`;
		const piece = hit.pieceEntityId != null ? pieces.get(hit.pieceEntityId) : undefined;
		const target: TPreflightTarget = { ids: hit.pieceEntityId != null ? [hit.pieceEntityId] : [key], time: hit.targetTime };
		const id = `hit:${hit.laneId}:${hit.hitId}`;

		if (hit.status === 'blocked') {
			issues.push({ id, severity: 'warning', title: `Blocked hit, ${at}`, detail: `${lane} already passes through this spot earlier in its run, so the platform is left out.`, time: hit.targetTime, target });
		} else if (hit.status === 'missed') {
			const label = hit.reason === 'resting' && piece?.status !== 'unreached' ? 'Stopped' : 'Missed';
			issues.push({ id, severity: 'warning', title: `${label} hit, ${at}`, detail: missDetail(hit, piece?.status), time: hit.targetTime, target });
		} else if (hit.status === 'drifting') {
			const ms = Math.round((hit.error ?? 0) * 1000);
			issues.push({ id, severity: 'warning', title: `${ms > 0 ? 'Late' : 'Early'} hit, ${at}`, detail: `Lands ${Math.abs(ms)} ms ${ms > 0 ? 'after' : 'before'} the note.`, time: hit.targetTime, target });
		} else if (hit.status === 'open') {
			open.push(hit);
		}

		if (hit.dot != null && hit.status !== 'blocked' && hit.status !== 'missed') {
			const band = frameBand(project, isShared ? hit.laneId : undefined);
			const overshoot = Math.abs(hit.dot.x - band.centerX) - band.halfWidth;
			if (overshoot > 0 || hit.outOfFrame === true) outside.push({ hit, overshoot: Math.max(0, overshoot), target });
		}
	}

	// Open hits and dots outside the frame are grouped per lane: a sketch or a run that drifts sideways has
	// many, and each row would say the same
	for (const [laneId, hits] of groupByLane(open, (hit) => hit.laneId)) {
		const first = hits[0];
		if (first == null) continue;
		const count = hits.length;
		issues.push({
			id: `open:${laneId}`,
			severity: 'info',
			title: count === 1 ? `Open note, ${names.lane(laneId)} at ${formatTime(first.targetTime)}` : `${count} open notes on ${names.lane(laneId)}`,
			detail: count === 1 ? 'No platform plays this note yet. It is heard without a strike.' : `No platforms play these notes yet, from ${formatTime(first.targetTime)}. They are heard without a strike.`,
			time: first.targetTime,
			target: { ids: [toHitKey(laneId, first.hitId)], time: first.targetTime }
		});
	}
	for (const [laneId, dots] of groupByLane(outside, (item) => item.hit.laneId)) {
		const first = dots[0];
		if (first == null) continue;
		const count = dots.length;
		const furthest = Math.max(...dots.map((item) => item.overshoot));
		const where = isShared ? "marble's part of the frame" : 'frame';
		issues.push({
			id: `frame:${laneId}`,
			// With one marble the camera follows it; with several they share one frame
			severity: isShared ? 'warning' : 'info',
			title: count === 1 ? `Dot outside the ${where}, ${names.lane(laneId)} at ${formatTime(first.hit.targetTime)}` : `${count} dots outside the ${where} on ${names.lane(laneId)}`,
			detail: `${count === 1 ? '' : `From ${formatTime(first.hit.targetTime)}, up to `}${furthest.toFixed(2)} m past the edge. ${isShared ? 'The shared camera may lose this marble.' : 'The camera pans to follow it.'}`,
			time: first.hit.targetTime,
			target: first.target
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
				severity: 'warning' as const,
				title: `${marble} collides with ${other}`,
				detail: `The marbles touch ${times}.`,
				time: group.time,
				target: { ids: [group.marbleId, group.otherId], point: group.first, time: group.time }
			};
		}
		return {
			id,
			severity: 'warning' as const,
			title: `${marble} strikes ${other} of ${names.lane(laneOfPiece.get(group.otherId) ?? '')}`,
			detail: `An extra strike ${times}, without a note.`,
			time: group.time,
			target: { ids: [group.otherId], point: group.first, time: group.time }
		};
	});
}

// MARK: - Pace

/** With several marbles the camera follows the shared descent; a marble far off it leaves the frame */
function paceIssues(result: TSimulationResult, names: TNames): TPreflightIssue[] {
	const pace = result.pace;
	if (pace == null || result.descent == null || result.marbles.length < 2) return [];
	const worst = new Map<string, { hit: THitResult; offset: number }>();
	for (const hit of result.hits) {
		if (hit.dot == null) continue;
		const offset = hit.dot.y - paceAt(pace, hit.targetTime);
		if (Math.abs(offset) <= pace.limit * PACE_FACTOR) continue;
		const current = worst.get(hit.laneId);
		if (current == null || Math.abs(offset) > Math.abs(current.offset)) worst.set(hit.laneId, { hit, offset });
	}
	return [...worst.values()].map(({ hit, offset }) => ({
		id: `pace:${hit.laneId}`,
		severity: 'warning' as const,
		title: `${names.lane(hit.laneId)} falls out of step with the other marbles`,
		detail: `${Math.abs(offset).toFixed(2)} m ${offset > 0 ? 'above' : 'below'} the other marbles at ${formatTime(hit.targetTime)}, so the camera may lose it.`,
		time: hit.targetTime,
		target: { ids: [hit.pieceEntityId ?? toHitKey(hit.laneId, hit.hitId)], time: hit.targetTime }
	}));
}

// MARK: - Loop

function loopIssues(project: TProject, result: TSimulationResult): TPreflightIssue[] {
	if (!project.design.loop) return [];
	const status = describeLoop(project, result);
	if (status.isOk) return [];
	return [{ id: 'loop', severity: 'warning', title: status.summary, detail: status.details.join(' '), target: null }];
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

function countHits(project: TProject): number {
	return project.music.lanes.reduce((sum, lane) => sum + lane.hits.length, 0);
}
