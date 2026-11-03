import type { TContinueAnswer, TGapAnswer } from '@/modules/simulation';

// Ghost pieces are suggestions drawn in place before they exist: Continue offers the next pieces of a
// repeating pattern, and Next offers a rail across a long gap. Suggestions belong to one project
// revision. Any edit makes them stale, so they disappear until the worker answers for the new revision,
// and answers that arrive for an older revision are dropped.

export type TGhost = { kind: 'continue'; answer: TContinueAnswer } | { kind: 'gap'; answer: TGapAnswer };

export interface TGhostState {
	/** Newest project revision seen */
	revision: number | null;
	ghost: TGhost | null;
	/** A gap piece is being computed for this lane and revision */
	pendingGap: { laneId: string; toHitId: string; revision: number } | null;
	/** Revision whose suggestions were dismissed; nothing is offered again until the next edit */
	dismissedRevision: number | null;
}

export type TGhostAction =
	| { type: 'revision'; revision: number }
	| { type: 'requestGap'; revision: number; laneId: string; toHitId: string }
	| { type: 'continueAnswer'; revision: number; answer: TContinueAnswer | null }
	| { type: 'gapAnswer'; answer: TGapAnswer }
	| { type: 'gapFailed'; revision: number }
	| { type: 'dismiss' }
	| { type: 'accepted' };

export const initialGhostState: TGhostState = { revision: null, ghost: null, pendingGap: null, dismissedRevision: null };

export function ghostReducer(state: TGhostState, action: TGhostAction): TGhostState {
	switch (action.type) {
		case 'revision': {
			if (action.revision === state.revision) return state;
			const ghost = state.ghost != null && ghostRevision(state.ghost) === action.revision ? state.ghost : null;
			const pendingGap = state.pendingGap?.revision === action.revision ? state.pendingGap : null;
			return { revision: action.revision, ghost, pendingGap, dismissedRevision: null };
		}
		case 'requestGap':
			if (action.revision !== state.revision) return state;
			return {
				...state,
				ghost: null,
				pendingGap: { laneId: action.laneId, toHitId: action.toHitId, revision: action.revision },
				dismissedRevision: null
			};
		case 'continueAnswer': {
			if (action.revision !== state.revision || state.dismissedRevision === action.revision) return state;
			// A gap suggestion the user asked for wins over background Continue ghosts
			if (state.ghost?.kind === 'gap' || state.pendingGap != null) return state;
			const answer = action.answer;
			const hasOk = answer != null && answer.suggestions.some((suggestion) => suggestion.isOk);
			return { ...state, ghost: hasOk ? { kind: 'continue', answer } : null };
		}
		case 'gapAnswer': {
			const { answer } = action;
			if (answer.revision !== state.revision || state.pendingGap?.revision !== answer.revision) return state;
			return { ...state, ghost: { kind: 'gap', answer }, pendingGap: null };
		}
		case 'gapFailed':
			if (state.pendingGap?.revision !== action.revision) return state;
			return { ...state, pendingGap: null };
		case 'dismiss':
			if (state.ghost == null && state.pendingGap == null) return state;
			return { ...state, ghost: null, pendingGap: null, dismissedRevision: state.revision };
		case 'accepted':
			return { ...state, ghost: null, pendingGap: null };
	}
}

export function ghostRevision(ghost: TGhost): number {
	return ghost.answer.revision;
}

/** Ghosts Tab or Return would add */
export function acceptableCount(ghost: TGhost | null): number {
	if (ghost == null) return 0;
	if (ghost.kind === 'gap') return 1;
	return ghost.answer.suggestions.filter((suggestion) => suggestion.isOk).length;
}
