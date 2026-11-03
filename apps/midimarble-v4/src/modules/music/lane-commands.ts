import {
	createId,
	createLane,
	createMarble,
	LANE_SPACING,
	type THit,
	type TLane,
	type TProject,
	type TProjectCommand,
	type TSource
} from '@/modules/project';
import { MIN_HIT_GAP } from './lane-proposal';
import type { TMidiNote } from './midi';

/**
 * Creates lanes and marbles for proposed note lists. Empty projects are replaced so a fresh
 * import starts clean; projects with hits keep their lanes and gain new ones.
 */
export function createImportCommands(
	project: TProject,
	options: TImportCommandsOptions
): TProjectCommand[] {
	const { lanes, source, instrument, end } = options;
	const hasHits = project.music.lanes.some((lane) => lane.hits.length > 0);
	const commands: TProjectCommand[] = [];
	let index = project.music.lanes.length;

	if (!hasHits) {
		for (const lane of project.music.lanes) commands.push({ type: 'removeLane', laneId: lane.id });
		index = 0;
	}
	if (source != null) commands.push({ type: 'upsertSource', source });

	for (const notes of lanes) {
		const lane: TLane = {
			...createLane(index),
			instrument: instrument ?? createLane(index).instrument,
			hits: notes.map((note) => noteToHit(note))
		};
		commands.push({ type: 'upsertLane', lane });
		commands.push({ type: 'upsertEntity', entity: createMarble(lane, { x: index * LANE_SPACING, y: 0.6 }) });
		index++;
	}
	if (end != null && end > project.end) commands.push({ type: 'setEnd', end });
	return commands;
}

export interface TImportCommandsOptions {
	lanes: TMidiNote[][];
	source?: TSource;
	instrument?: number;
	end?: number;
}

export function noteToHit(note: TMidiNote): THit {
	return {
		id: createId('hit'),
		time: round(note.time),
		pitch: note.pitch,
		velocity: round(note.velocity)
	};
}

/** Hits that follow their predecessor too closely for one marble */
export function findLaneConflicts(lane: TLane, minGap = MIN_HIT_GAP): Set<string> {
	const conflicts = new Set<string>();
	for (let index = 1; index < lane.hits.length; index++) {
		const previous = lane.hits[index - 1];
		const hit = lane.hits[index];
		if (previous == null || hit == null) continue;
		if (hit.time - previous.time < minGap - 1e-9) {
			conflicts.add(previous.id);
			conflicts.add(hit.id);
		}
	}
	return conflicts;
}

function round(value: number): number {
	return Math.round(value * 10000) / 10000;
}
