import type { TPiece, TProject, TProjectCommand, TVec2 } from '@/modules/project';
import type { TResult } from 'tuple-result';
import { autoPlace, autoPlaceHorizon, continueSuggestions, findHitResult, prepareAutoPlace, simulateTrial, withPieces, type TAngleEvaluation, type TAngleTry, type TAutoPlacePlan, type TContinueResult, type TSimulateFn } from './assists';
import { createRailForGap, createChainForGap, createSwitchbackForGap, createTunnelForGap, prepareGapSearch, type TGapEvaluation, type TGapPieceCheck, type TGapPieceProposal, type TGapSearchPlan, type TGapTry } from './gap-pieces';
import { answerEdit, reconnect, type TEditAnswer, type TEditRequest } from './edit-rule';
import type { TSimulator } from './simulate';
import type { TResolvedPiece, TSimulationResult } from './types';

// Messages between the UI and the simulation worker. Every request carries the project it asks about,
// so the worker always answers for the newest edit. Assists first simulate that project, which resumes
// from the worker's snapshots, and then run the assist against the fresh result.

export type TWorkerRequest =
	| { kind: 'simulate'; project: TProject; horizon?: number }
	| {
			kind: 'autoPlace';
			project: TProject;
			marbleId: string;
			hitId: string;
			type: string;
			pieceId?: string;
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
	| { kind: 'continue'; project: TProject; marbleId: string; maxCount?: number; canTurn?: boolean }
	| ({ kind: 'settle' } & TEditRequest)
	| { kind: 'reconnect'; project: TProject }
	| {
			kind: 'gapPiece';
			type: TGapPieceType;
			project: TProject;
			marbleId: string;
			fromHitId: string;
			toHitId: string;
			pieceId?: string;
	  };

export type TWorkerMessage = TWorkerRequest & { id: number };

/** What a search spread over the assists pool looks for */
export type TSearchRequest =
	| { assist: 'autoPlace'; project: TProject; marbleId: string; hitId: string; type: string; pieceId: string; range?: [number, number] }
	| {
			assist: 'gapPiece';
			type: TGapPieceType;
			project: TProject;
			marbleId: string;
			fromHitId: string;
			toHitId: string;
			pieceId: string;
	  };

/** Answers to some of a search's tries, in the order they were asked, with the search's plan */
export interface TSearchBatch {
	plan: TAutoPlacePlan | TGapSearchPlan;
	evaluations: (TAngleEvaluation | TGapEvaluation)[];
}

/** Pieces that bridge a long gap */
export type TGapPieceType = 'switchback' | 'chain' | 'rail' | 'tunnel';

export interface TAutoPlaceAnswer {
	piece: TPiece;
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
	marbleId: string;
	computeMs: number;
}

export interface TGapAnswer {
	revision: number;
	type: TGapPieceType;
	marbleId: string;
	fromHitId: string;
	toHitId: string;
	piece: TPiece;
	commands: TProjectCommand[];
	/** The suggested piece as the simulation resolves it, for drawing the ghost */
	resolved: TResolvedPiece | null;
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
	settle: TEditAnswer;
	reconnect: Pick<TEditAnswer, 'pieces' | 'marbles'> | null;
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
	if (request.kind === 'simulate') return simulator.simulate(request.project, request.horizon);
	if (request.kind === 'settle') return answerEdit(simulator, request);
	if (request.kind === 'reconnect') return reconnect(simulator, request.project);
	const result = simulate(request.project);
	switch (request.kind) {
		case 'autoPlace': {
			const { project, marbleId, hitId, type, pieceId, range } = request;
			const [isOk, error, placement] = autoPlace(project, result, marbleId, hitId, { simulate, type, id: pieceId, ...(range != null ? { range } : {}) });
			if (!isOk) throw error;
			return {
				piece: placement.piece,
				angle: placement.angle,
				nextDot: placement.nextDot,
				paceError: placement.paceError ?? null,
				computeMs: performance.now() - startedAt
			};
		}
		case 'continue': {
			const { project, marbleId, maxCount, canTurn } = request;
			const answer = continueSuggestions(project, result, marbleId, { simulate, maxCount, canTurn });
			if (answer == null) return null;
			return { ...answer, revision: project.revision, marbleId, computeMs: performance.now() - startedAt };
		}
		case 'gapPiece': {
			const { project, marbleId, fromHitId, toHitId, pieceId, type } = request;
			const create = type === 'switchback' ? createSwitchbackForGap : type === 'chain' ? createChainForGap : type === 'rail' ? createRailForGap : createTunnelForGap;
			const [isOk, error, proposal] = create(project, result, marbleId, fromHitId, toHitId, { simulate, id: pieceId });
			if (!isOk) throw error;
			return gapAnswer(simulate, request, proposal, startedAt);
		}
	}
}

/** The gap piece answer for a proposal: the piece as the simulation resolves it and the marble's path to the next hit */
function gapAnswer(
	simulate: TSimulateFn,
	request: Pick<Extract<TWorkerRequest, { kind: 'gapPiece' }>, 'type' | 'project' | 'marbleId' | 'fromHitId' | 'toHitId'>,
	proposal: TGapPieceProposal,
	startedAt: number
): TGapAnswer {
	const { project, marbleId, fromHitId, toHitId, type } = request;
	const toTime = project.marbles.find((marble) => marble.id === marbleId)?.hits.find((hit) => hit.id === toHitId)?.time ?? proposal.entryTime;
	const trial = simulateTrial(simulate, withPieces(project, [proposal.piece]), toTime + 0.02);
	const samples = trial.marbles.find((marble) => marble.marbleId === marbleId)?.samples ?? [];
	const track: TVec2[] = [];
	// About every 10 ms is smooth enough for a dashed preview
	samples.forEach((sample, index) => {
		if (sample.time >= proposal.entryTime - 0.05 && sample.time <= toTime && index % 2 === 0) track.push(sample.position);
	});
	const dot = findHitResult(trial, marbleId, toHitId)?.dot;
	if (dot != null) track.push(dot);
	return {
		revision: project.revision,
		type,
		marbleId,
		fromHitId,
		toHitId,
		piece: proposal.piece,
		commands: proposal.commands,
		resolved: trial.pieces.find((piece) => piece.pieceId === proposal.piece.id) ?? null,
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
	const { project, marbleId, pieceId: id } = request;
	if (request.assist === 'autoPlace') {
		const horizon = autoPlaceHorizon(project, marbleId, request.hitId);
		const base = horizon != null ? simulateTrial(simulate, project, horizon + BASE_MARGIN) : simulate(project);
		return prepareAutoPlace(project, base, marbleId, request.hitId, { simulate, type: request.type, id });
	}
	const toTime = project.marbles.find((marble) => marble.id === marbleId)?.hits.find((hit) => hit.id === request.toHitId)?.time;
	const base = toTime != null ? simulateTrial(simulate, project, toTime + 0.02 + BASE_MARGIN) : simulate(project);
	return prepareGapSearch(request.type, project, base, marbleId, request.fromHitId, request.toHitId, { simulate, id });
}
