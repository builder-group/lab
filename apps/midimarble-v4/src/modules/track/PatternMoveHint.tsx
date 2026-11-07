import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { GhostPiece } from './GhostLayer';
import type { TrackCx } from './TrackCx';

/** Where a live Pattern being moved would stand: its pieces with the pointer, then where `propose` says. Nothing is on the track yet */
export const PatternMoveHint: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const move = useFeatureState(trackCx.studio.patterns.$move);
	const camera = useFeatureState(trackCx.$camera);
	useFeatureState(trackCx.$viewport);
	if (move == null) return null;
	const isOk = move.proposal == null || move.proposal.status === 'fits';
	return (
		<g className="mm-ghost-in" data-pattern-move={move.proposal?.status ?? 'asking'}>
			{move.shape.map((piece) => (
				<GhostPiece key={piece.pieceId} trackCx={trackCx} piece={piece} scale={camera.view.scale} isOk={isOk} />
			))}
		</g>
	);
};
