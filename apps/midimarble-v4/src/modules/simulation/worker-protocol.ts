import type { TEntity, TProject, TProjectCommand, TVec2 } from '@/modules/project';
import { autoPlace, continueSuggestions, findHitResult, simulateTrial, withEntities, type TContinueResult, type TSimulateFn } from './assists';
import { createLinkedPiece } from './placement';
import { createRailForGap, createSwitchbackForGap, createTunnelForGap, type TGapPieceCheck } from './gap-pieces';
import type { TSimulator } from './simulate';
import type { TResolvedPiece, TSimulationResult } from './types';

// Messages between the UI and the simulation worker. Every request carries the project it asks about,
// so the worker always answers for the newest edit. Assists first simulate that project, which resumes
// from the worker's snapshots, and then run the assist against the fresh result.

export type TWorkerRequest =
	| { kind: 'simulate'; project: TProject }
	| {
			kind: 'autoPlace';
			project: TProject;
			laneId: string;
			hitId: string;
			type: string;
			entityId?: string;
			/**
			 * Angles tried in order instead of the Auto place search, for a hit before a long gap: the
			 * first angle that keeps the hit on time and sends the marble off the piece wins. Auto place
			 * itself launches into a switchback before a long gap, so Compose no longer sends these.
			 */
			launchAngles?: number[];
	  }
	| { kind: 'continue'; project: TProject; laneId: string; maxCount?: number }
	| {
			kind: 'gapPiece';
			type: TGapPieceType;
			project: TProject;
			laneId: string;
			fromHitId: string;
			toHitId: string;
			entityId?: string;
	  };

export type TWorkerMessage = TWorkerRequest & { id: number };

/** Pieces that bridge a long gap */
export type TGapPieceType = 'switchback' | 'rail' | 'tunnel';

export interface TAutoPlaceAnswer {
	entity: TEntity;
	angle: number;
	nextDot: TVec2 | null;
	/** Height of the next dot above the shared pace y*, when known */
	paceError?: number | null;
	/** Milliseconds the worker spent, including the base simulation */
	computeMs: number;
}

export interface TContinueAnswer extends TContinueResult {
	/** Revision of the project the suggestions were made for */
	revision: number;
	laneId: string;
	computeMs: number;
}

export interface TGapAnswer {
	revision: number;
	type: TGapPieceType;
	laneId: string;
	fromHitId: string;
	toHitId: string;
	entity: TEntity;
	commands: TProjectCommand[];
	/** The suggested piece as the simulation resolves it, for drawing the ghost */
	piece: TResolvedPiece | null;
	/** Predicted marble path from the entry to the next hit */
	track: TVec2[];
	check: TGapPieceCheck | null;
	computeMs: number;
}

export interface TWorkerAnswers {
	simulate: TSimulationResult;
	autoPlace: TAutoPlaceAnswer;
	continue: TContinueAnswer | null;
	gapPiece: TGapAnswer;
}

/** Answers one request. Throws with a readable message when an assist finds nothing. */
export function answerWorkerRequest(simulator: TSimulator, request: TWorkerRequest): TWorkerAnswers[TWorkerRequest['kind']] {
	const startedAt = performance.now();
	const simulate = (project: TProject): TSimulationResult => simulator.simulate(project);
	const result = simulate(request.project);
	switch (request.kind) {
		case 'simulate':
			return result;
		case 'autoPlace': {
			const { project, laneId, hitId, type, entityId, launchAngles } = request;
			if (launchAngles != null) {
				const entity = launchPlace(project, simulate, laneId, hitId, type, launchAngles, entityId);
				if (entity == null) throw new Error('No angle sends the marble off this piece on time');
				return { entity, angle: entity.components.hitLink?.angle ?? 0, nextDot: null, computeMs: performance.now() - startedAt };
			}
			const [isOk, error, placement] = autoPlace(project, result, laneId, hitId, { simulate, type, id: entityId });
			if (!isOk) throw error;
			return {
				entity: placement.entity,
				angle: placement.angle,
				nextDot: placement.nextDot,
				paceError: placement.paceError ?? null,
				computeMs: performance.now() - startedAt
			};
		}
		case 'continue': {
			const { project, laneId, maxCount } = request;
			const answer = continueSuggestions(project, result, laneId, { simulate, maxCount });
			if (answer == null) return null;
			return { ...answer, revision: project.revision, laneId, computeMs: performance.now() - startedAt };
		}
		case 'gapPiece': {
			const { project, laneId, fromHitId, toHitId, entityId, type } = request;
			const create = type === 'switchback' ? createSwitchbackForGap : type === 'rail' ? createRailForGap : createTunnelForGap;
			const [isOk, error, proposal] = create(project, result, laneId, fromHitId, toHitId, { simulate, id: entityId });
			if (!isOk) throw error;
			const toTime = project.music.lanes.find((lane) => lane.id === laneId)?.hits.find((hit) => hit.id === toHitId)?.time ?? proposal.entryTime;
			const trial = simulateTrial(simulate, withEntities(project, [proposal.entity]), toTime + 0.02);
			const samples = trial.marbles.find((marble) => marble.laneId === laneId)?.samples ?? [];
			const track: TVec2[] = [];
			// About every 10 ms is smooth enough for a dashed preview
			samples.forEach((sample, index) => {
				if (sample.time >= proposal.entryTime - 0.05 && sample.time <= toTime && index % 2 === 0) track.push(sample.position);
			});
			const dot = findHitResult(trial, laneId, toHitId)?.dot;
			if (dot != null) track.push(dot);
			return {
				revision: project.revision,
				type,
				laneId,
				fromHitId,
				toHitId,
				entity: proposal.entity,
				commands: proposal.commands,
				piece: trial.pieces.find((piece) => piece.entityId === proposal.entity.id) ?? null,
				track,
				check: proposal.check,
				computeMs: performance.now() - startedAt
			};
		}
	}
}

/** First of `angles` whose piece lands the hit on time and that the marble has left 0.25 s later */
function launchPlace(
	project: TProject,
	simulate: TSimulateFn,
	laneId: string,
	hitId: string,
	type: string,
	angles: number[],
	id?: string
): TEntity | null {
	const time = project.music.lanes.find((lane) => lane.id === laneId)?.hits.find((hit) => hit.id === hitId)?.time;
	const marbleId = project.entities.find((entity) => entity.components.marble?.laneId === laneId)?.id;
	if (time == null) return null;
	for (const angle of angles) {
		const entity = createLinkedPiece(type, laneId, hitId, angle, { entities: project.entities, id });
		const trial = simulateTrial(simulate, withEntities(project, [entity]), time + 0.35);
		const status = findHitResult(trial, laneId, hitId)?.status;
		if (status !== 'onTime' && status !== 'drifting') continue;
		const isBack = trial.contacts.some(
			(contact) => contact.marbleEntityId === marbleId && contact.otherEntityId === entity.id && contact.time > time + 0.25
		);
		if (!isBack) return entity;
	}
	return null;
}
