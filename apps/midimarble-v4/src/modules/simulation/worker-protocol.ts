import type { TEntity, TProject, TProjectCommand, TVec2 } from '@/modules/project';
import type { TResult } from 'tuple-result';
import {
	autoPlace,
	autoPlaceHorizon,
	continueSuggestions,
	findHitResult,
	prepareAutoPlace,
	simulateTrial,
	withEntities,
	type TAngleEvaluation,
	type TAngleTry,
	type TAutoPlacePlan,
	type TContinueResult,
	type TSimulateFn
} from './assists';
import { createLinkedPiece } from './placement';
import {
	createRailForGap,
	createSwitchbackForGap,
	createTunnelForGap,
	prepareGapSearch,
	type TGapEvaluation,
	type TGapPieceCheck,
	type TGapPieceProposal,
	type TGapSearchPlan,
	type TGapTry
} from './gap-pieces';
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
			/** Angle range searched first, in radians; see `TAutoPlaceOptions` */
			range?: [number, number];
	  }
	| {
			/**
			 * Some of one Auto place or gap piece search's tries, for a worker of the assists pool. `search` names
			 * the search; the first request of a search to a worker carries what it searches for, which the worker
			 * simulates and prepares once, and later requests leave it out.
			 */
			kind: 'searchTries';
			search: string;
			prepare?: TSearchRequest;
			tries: TAngleTry[] | TGapTry[];
	  }
	| {
			/** The full answer for the gap piece a search chose, from the worker that prepared the search */
			kind: 'gapAnswer';
			search: string;
			proposal: TGapPieceProposal;
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

/** What a search spread over the assists pool looks for */
export type TSearchRequest =
	| { assist: 'autoPlace'; project: TProject; laneId: string; hitId: string; type: string; entityId: string; range?: [number, number] }
	| {
			assist: 'gapPiece';
			type: TGapPieceType;
			project: TProject;
			laneId: string;
			fromHitId: string;
			toHitId: string;
			entityId: string;
	  };

/** Answers to some of a search's tries, in the order they were asked, with the search's plan */
export interface TSearchBatch {
	plan: TAutoPlacePlan | TGapSearchPlan;
	evaluations: (TAngleEvaluation | TGapEvaluation)[];
}

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
	searchTries: TSearchBatch;
	gapAnswer: TGapAnswer;
	continue: TContinueAnswer | null;
	gapPiece: TGapAnswer;
}

interface TPreparedSearch {
	plan: TAutoPlacePlan | TGapSearchPlan;
	evaluate: (item: never) => TAngleEvaluation | TGapEvaluation;
}

/** What a worker keeps between requests: the search it prepared last */
export interface TWorkerMemory {
	search: { key: string; request: TSearchRequest; prepared: TResult<TPreparedSearch, Error> } | null;
}

export function createWorkerMemory(): TWorkerMemory {
	return { search: null };
}

/** Answers one request. Throws with a readable message when an assist finds nothing. */
export function answerWorkerRequest(
	simulator: TSimulator,
	request: TWorkerRequest,
	memory: TWorkerMemory = createWorkerMemory()
): TWorkerAnswers[TWorkerRequest['kind']] {
	const startedAt = performance.now();
	const simulate = (project: TProject): TSimulationResult => simulator.simulate(project);
	if (request.kind === 'searchTries') return answerTries(simulate, request, memory);
	if (request.kind === 'gapAnswer') {
		const prepared = memory.search;
		if (prepared?.key !== request.search || prepared.request.assist !== 'gapPiece') throw new Error('The assists worker lost the gap search');
		return gapAnswer(simulate, prepared.request, request.proposal, startedAt);
	}
	const result = simulate(request.project);
	switch (request.kind) {
		case 'simulate':
			return result;
		case 'autoPlace': {
			const { project, laneId, hitId, type, entityId, launchAngles, range } = request;
			if (launchAngles != null) {
				const entity = launchPlace(project, simulate, laneId, hitId, type, launchAngles, entityId);
				if (entity == null) throw new Error('No angle sends the marble off this piece on time');
				return { entity, angle: entity.components.hitLink?.angle ?? 0, nextDot: null, computeMs: performance.now() - startedAt };
			}
			const [isOk, error, placement] = autoPlace(project, result, laneId, hitId, { simulate, type, id: entityId, ...(range != null ? { range } : {}) });
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
			return gapAnswer(simulate, request, proposal, startedAt);
		}
	}
}

/** The gap piece answer for a proposal: the piece as the simulation resolves it and the marble's path to the next hit */
function gapAnswer(
	simulate: TSimulateFn,
	request: Pick<Extract<TWorkerRequest, { kind: 'gapPiece' }>, 'type' | 'project' | 'laneId' | 'fromHitId' | 'toHitId'>,
	proposal: TGapPieceProposal,
	startedAt: number
): TGapAnswer {
	const { project, laneId, fromHitId, toHitId, type } = request;
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

// Past the trials' end, more than a hit's tolerance, so the hits up to it are judged as in the whole run
const BASE_MARGIN = 0.25;

function answerTries(
	simulate: TSimulateFn,
	request: Extract<TWorkerRequest, { kind: 'searchTries' }>,
	memory: TWorkerMemory
): TSearchBatch {
	const { search: key, prepare, tries } = request;
	if (memory.search?.key !== key) {
		if (prepare == null) throw new Error('The assists worker lost the search');
		memory.search = { key, request: prepare, prepared: prepareSearch(simulate, prepare) };
	}
	const [isOk, error, search] = memory.search.prepared;
	if (!isOk) throw error;
	const evaluate = search.evaluate as (item: TAngleTry | TGapTry) => TAngleEvaluation | TGapEvaluation;
	return { plan: search.plan, evaluations: (tries as (TAngleTry | TGapTry)[]).map(evaluate) };
}

/** Simulates the search's project up to the end of its trials, plus `BASE_MARGIN`, the only part its checks read */
function prepareSearch(simulate: TSimulateFn, request: TSearchRequest): TResult<TPreparedSearch, Error> {
	const { project, laneId, entityId: id } = request;
	if (request.assist === 'autoPlace') {
		const horizon = autoPlaceHorizon(project, laneId, request.hitId);
		const base = horizon != null ? simulateTrial(simulate, project, horizon + BASE_MARGIN) : simulate(project);
		return prepareAutoPlace(project, base, laneId, request.hitId, { simulate, type: request.type, id });
	}
	const toTime = project.music.lanes.find((lane) => lane.id === laneId)?.hits.find((hit) => hit.id === request.toHitId)?.time;
	const base = toTime != null ? simulateTrial(simulate, project, toTime + 0.02 + BASE_MARGIN) : simulate(project);
	return prepareGapSearch(request.type, project, base, laneId, request.fromHitId, request.toHitId, { simulate, id });
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
