import type { TProject } from '@/modules/project';
import { checkLoop, createLoop, LOOP_ENTRY_DROP, type TLoopIssue, type TSimulationResult } from '@/modules/simulation';
import { formatTime } from '@/modules/studio/format';

/** What the Design inspector says about a seamless loop: one summary line, the mismatches and a bar fix */
export function describeLoop(project: TProject, result: TSimulationResult): TLoopStatus {
	const loop = createLoop(project, result);
	if (loop == null) {
		const drop = LOOP_ENTRY_DROP * project.design.camera.distance;
		return {
			isOk: false,
			summary: 'No loop yet',
			details: [`A marble has to fall ${drop.toFixed(2)} m from its release before the loop can start, so it enters from above the frame.`],
			snappedEnd: null
		};
	}
	const check = checkLoop(project, result, loop);
	const bars = loop.bars != null ? ` · ${loop.bars.count} ${loop.bars.count === 1 ? 'bar' : 'bars'}` : '';
	const names = new Map(project.entities.map((entity) => [entity.id, entity.name ?? entity.id]));
	const name = (id: string): string => names.get(id) ?? id;
	return {
		isOk: check.isOk,
		summary: `Loops ${formatTime(loop.start)} to ${formatTime(loop.end)}${bars} · ${check.isOk ? 'start and end match' : `${check.issues.length} ${check.issues.length === 1 ? 'mismatch' : 'mismatches'}`}`,
		details: check.issues.map((issue) => describeIssue(issue, name, loop.start, loop.end)),
		snappedEnd: check.issues.find((issue) => issue.kind === 'bars')?.snappedEnd ?? null
	};
}

export interface TLoopStatus {
	isOk: boolean;
	summary: string;
	details: string[];
	/** Project end that makes the loop whole bars, when it is not */
	snappedEnd: number | null;
}

function describeIssue(issue: TLoopIssue, name: (id: string) => string, start: number, end: number): string {
	switch (issue.kind) {
		case 'state':
			return `${name(issue.marbleEntityId)} does not return to its first frame (${(issue.positionError * 1000).toFixed(1)} mm off).`;
		case 'entry':
			return `${name(issue.marbleEntityId)} hits a piece at ${formatTime(issue.contactTime)}, right after the loop starts at ${formatTime(start)}. Release it higher.`;
		case 'stillInView':
			return `${name(issue.marbleEntityId)} is still ${issue.distance.toFixed(2)} m from its entry at ${formatTime(end)}. Let it fall out of the frame before the end.`;
		case 'lateRelease':
			return `${name(issue.marbleEntityId)} is released after the loop starts and waits at its release point.`;
		case 'reaction':
			return `${name(issue.pieceEntityId)} still reacts to its hit at ${formatTime(issue.time)} when the loop ends.`;
		case 'movingPiece':
			return `${name(issue.pieceEntityId)} ends ${((issue.angleError * 180) / Math.PI).toFixed(0)}° turned from its first frame.`;
		case 'bars':
			return `The loop is ${Math.abs(issue.offset).toFixed(2)} s ${issue.offset > 0 ? 'longer' : 'shorter'} than whole bars, so the music jumps.`;
	}
}
