import type { TEntity } from '@/modules/project';
import { getPieceDefinition, layoutOf, railLayoutInfo, type TRailLayout } from '@/modules/simulation';

/** The parameters the Physics panel holds: how a piece behaves. Everything else shapes its Hitbox. */
const PHYSICS_PARAMS = ['bounce', 'damping', 'motorSpeed'];

/**
 * A piece type's parameters by inspector panel: Hitbox for what a marble touches, Physics for how it behaves. A
 * box's Length sits in Position and the moment a piece follows in its link panel. A Rail shows what its layout uses.
 */
export function pieceParamPanels(type: string, railLayout?: TRailLayout): { hitbox: string[]; physics: string[] } {
	if (type === 'rail') return { hitbox: railLayoutInfo[railLayout ?? 'path'].params, physics: [] };
	const layout = layoutOf(type);
	// Depth is only how far it stands out of the wall, so it's the Skin's, in Film
	const names = Object.keys(getPieceDefinition(type)?.params ?? {}).filter((name) => name !== 'entryDelay' && name !== 'depth' && !(layout === 'box' && name === 'length') && !(layout === 'catcher' && name === 'mirror'));
	return {
		hitbox: names.filter((name) => !PHYSICS_PARAMS.includes(name)).sort((a, b) => hitboxRank(a) - hitboxRank(b)),
		physics: PHYSICS_PARAMS.filter((name) => names.includes(name))
	};
}

// Thickness leads; the rest keep the definition's order
function hitboxRank(name: string): number {
	return name === 'thickness' ? 0 : 1;
}

/**
 * Whether the inspector shows the link panel: only for one piece that plays a note or follows a marble, as a piece
 * tied to nothing has nothing to show. Play a Note… and Follow a Marble… in its menus tie it.
 */
export function showsLinkPanel(entities: TEntity[]): boolean {
	return entities.length === 1 && entities[0]?.components.hitLink != null;
}
