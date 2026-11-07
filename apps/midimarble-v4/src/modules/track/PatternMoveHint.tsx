import { useFeatureState } from 'feature-react/state';
import React from 'react';
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

/** Why a moved Pattern doesn't fit where it is, beside its first piece while the drag goes on */
export const PatternMoveReason: React.FC<{ trackCx: TrackCx }> = (props) => {
	const { trackCx } = props;
	const move = useFeatureState(trackCx.studio.patterns.$move);
	useFeatureState(trackCx.$camera);
	useFeatureState(trackCx.$viewport);
	const proposal = move?.proposal;
	const [first] = move?.shape ?? [];
	if (proposal == null || proposal.status === 'fits' || first == null) return null;
	const words = proposal.words?.replace(/ Nothing changed\.$/, '') ?? "Doesn't fit here";
	const position = trackCx.toScreen(first.position);
	return (
		<div className="mm-snap-chip mm-move-reason" data-snapped={false} style={{ left: position.x + 18, top: position.y + 14 }} role="status">
			<span>{words}</span>
		</div>
	);
};
