import type { TGapAnswer } from '@/modules/building';

// The bridge Next asks for across a long gap, which it lands when it's there. It belongs to one project revision: any edit
// makes it stale, and an answer for an older revision is dropped.

export type TGhost = { kind: 'gap'; answer: TGapAnswer };

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
	| { type: 'gapAnswer'; answer: TGapAnswer }
	| { type: 'gapFailed'; revision: number }
	| { type: 'dismiss' }
	| { type: 'accepted' };

export const initialGhostState: TGhostState = { revision: null, ghost: null, pendingGap: null, dismissedRevision: null };

export function ghostReducer(state: TGhostState, action: TGhostAction): TGhostState {
	switch (action.type) {
		case 'revision': {
			if (action.revision === state.revision) return state;
			const ghost = state.ghost?.answer.revision === action.revision ? state.ghost : null;
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
