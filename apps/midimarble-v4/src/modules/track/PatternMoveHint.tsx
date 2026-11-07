import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { oneLine } from './bar';
import { GhostPiece } from './GhostLayer';
import type { TrackCx } from './TrackCx';

/**
 * Where a live Pattern being moved would stand: its pieces with the pointer, then where `propose` says, in the marble's
 * color. Where it doesn't fit, the ghost turns red and says why beside it, as the bar waits for the release. Nothing is on
 * the track yet
 */
export const PatternMoveHint: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const move = useFeatureState(trackCx.studio.patterns.$move);
	const camera = useFeatureState(trackCx.$camera);
	useFeatureState(trackCx.$viewport);
	if (move == null) return null;
	const project = trackCx.studio.project;
	const group = project?.track.groups.find((item) => item.id === move.groupId);
	const color = project?.marbles.find((marble) => marble.id === group?.marbleId)?.labelColor ?? 'var(--text)';
	const isOk = move.proposal == null || move.proposal.status === 'fits';
	return (
		<g className="mm-ghost-in" data-pattern-move={move.proposal?.status ?? 'asking'}>
			{move.shape.map((piece) => (
				<GhostPiece key={piece.pieceId} trackCx={trackCx} piece={piece} scale={camera.view.scale} isOk={isOk} color={color} />
			))}
		</g>
	);
};

/**
 * Why a moved Pattern doesn't fit where it is, in the bar's place at the bottom of the wall while the drag goes on, as
 * the bar steps aside until release and the ghost may stand out of view
 */
export const PatternMoveReason: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const move = useFeatureState(trackCx.studio.patterns.$move);
	const proposal = move?.proposal;
	if (proposal == null || proposal.status === 'fits') return null;
	const words = oneLine(proposal.words?.replace(/ Nothing changed\.$/, '') ?? "Doesn't fit here");
	return (
		<div className="mm-snap-chip mm-move-reason" data-snapped={false} role="status">
			{words}
		</div>
	);
};
