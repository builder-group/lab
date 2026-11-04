import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { toPoints } from '@/modules/compose/PieceLayer';
import type { DraftPreviewCx } from './DraftPreviewCx';

/** Unity's collider green reads on every theme; the dark halo keeps it visible on pale walls */
const HITBOX_COLOR = '#35e06b';
const HITBOX_HALO = 'rgb(0 0 0 / 0.45)';

/**
 * What a marble touches, over the film frame: the selected piece's hitbox as a thin outline, and with View › Show
 * Hitboxes every piece's, like Unity's collider gizmos. It lies above the Draft Preview and Blender's preview frames,
 * which follow the same camera, so a skin that looks bigger than its hitbox shows on either.
 */
export const HitboxOverlay: React.FC<{ draft: DraftPreviewCx }> = (props) => {
	const { draft } = props;
	const studio = draft.studio;
	useFeatureState(draft.$frame);
	const selection = useFeatureState(studio.$selection);
	const showAll = useFeatureState(studio.$showHitboxes);
	const pieces = draft.pieces().filter((piece) => showAll || selection.includes(piece.entityId));
	if (!pieces.length) return null;

	return (
		<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden data-hitboxes>
			{pieces.map((piece) => {
				const d = draft
					.hitboxOutline(piece)
					.filter((outline) => outline.every((corner) => Number.isFinite(corner.x) && Number.isFinite(corner.y)))
					.map((outline) => `M${toPoints(outline)}Z`)
					.join(' ');
				return (
					<g key={piece.entityId}>
						<path d={d} fill="none" stroke={HITBOX_HALO} strokeWidth={2.5} strokeLinejoin="round" />
						<path d={d} fill="none" stroke={HITBOX_COLOR} strokeWidth={1} strokeLinejoin="round" />
					</g>
				);
			})}
		</svg>
	);
};
