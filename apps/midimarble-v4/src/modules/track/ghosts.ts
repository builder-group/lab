import type { TPiece, TVec2 } from '@/modules/project';
import type { TContinueAnswer, TGapAnswer, THitResult, TResolvedPiece } from '@/modules/simulation';

// Ghost pieces are suggestions drawn in place before they exist: Continue offers the next pieces of a
// repeating pattern, Next offers a rail across a long gap, and a click on an open dot shows the
// piece it would get. Suggestions belong to one project
// revision. Any edit makes them stale, so they disappear until the worker answers for the new revision,
// and answers that arrive for an older revision are dropped.

export type TGhost = { kind: 'continue'; answer: TContinueAnswer } | { kind: 'gap'; answer: TGapAnswer } | { kind: 'place'; answer: TPlaceAnswer };

/** The piece a clicked open dot would get. `type` names it, so other kinds can be listed later beside the platform. */
export interface TPlaceAnswer {
	revision: number;
	marbleId: string;
	hit: THitResult;
	type: string;
	entity: TPiece;
	/** The piece as it shows at its dot */
	piece: TResolvedPiece;
	/** Where the marble's next note lands with this piece; null until Auto place answers */
	nextDot: TVec2 | null;
	/** Auto place has answered, so `entity` is what gets added */
	isSolved: boolean;
	/** False when no tilt keeps the next note in the frame and the piece has the default tilt */
	isOk: boolean;
}

export interface TGhostState {
	/** Newest project revision seen */
	revision: number | null;
	ghost: TGhost | null;
	/** A gap piece is being computed for this marble and revision */
	pendingGap: { marbleId: string; toHitId: string; revision: number } | null;
	/** Revision whose suggestions were dismissed; nothing is offered again until the next edit */
	dismissedRevision: number | null;
}

export type TGhostAction =
	| { type: 'revision'; revision: number }
	| { type: 'requestGap'; revision: number; marbleId: string; toHitId: string }
	| { type: 'continueAnswer'; revision: number; answer: TContinueAnswer | null }
	| { type: 'gapAnswer'; answer: TGapAnswer }
	| { type: 'gapFailed'; revision: number }
	| { type: 'preview'; answer: TPlaceAnswer }
	| { type: 'previewCanceled' }
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
				pendingGap: { marbleId: action.marbleId, toHitId: action.toHitId, revision: action.revision },
				dismissedRevision: null
			};
		case 'continueAnswer': {
			if (action.revision !== state.revision || state.dismissedRevision === action.revision) return state;
			// A suggestion the user asked for wins over background Continue ghosts
			if (state.ghost?.kind === 'gap' || state.ghost?.kind === 'place' || state.pendingGap != null) return state;
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
		case 'preview':
			return { ...state, revision: action.answer.revision, ghost: { kind: 'place', answer: action.answer }, pendingGap: null };
		// Unlike Escape on Continue ghosts, nothing is hidden for the rest of this revision: the click only looked
		case 'previewCanceled':
			if (state.ghost == null && state.pendingGap == null) return state;
			return { ...state, ghost: null, pendingGap: null };
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
	if (ghost.kind !== 'continue') return 1;
	return ghost.answer.suggestions.filter((suggestion) => suggestion.isOk).length;
}
