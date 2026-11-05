import type { TEntity } from '@/modules/project';
import { getPieceDefinition, layoutOf, railLayoutInfo, type TRailLayout } from '@/modules/simulation';

/** The parameters the Physics panel holds: how a piece behaves. Everything else is its Shape. */
const PHYSICS_PARAMS = ['bounce', 'damping', 'motorSpeed'];

/**
 * A piece type's parameters by inspector panel: Shape for its size, which skins follow, Physics for how it behaves. The
 * moment a piece follows sits in its link panel. A Rail shows what its layout uses.
 */
export function pieceParamPanels(type: string, railLayout?: TRailLayout): { shape: string[]; physics: string[] } {
	if (type === 'rail') return { shape: railLayoutInfo[railLayout ?? 'path'].params, physics: [] };
	const layout = layoutOf(type);
	const names = Object.keys(getPieceDefinition(type)?.params ?? {}).filter((name) => name !== 'entryDelay' && !(layout === 'catcher' && name === 'mirror'));
	return {
		shape: names.filter((name) => !PHYSICS_PARAMS.includes(name)).sort((a, b) => shapeRank(a) - shapeRank(b)),
		physics: PHYSICS_PARAMS.filter((name) => names.includes(name))
	};
}

// Length and Thickness lead and Depth comes last; the rest keep the definition's order
function shapeRank(name: string): number {
	if (name === 'length') return 0;
	if (name === 'thickness') return 1;
	return name === 'depth' ? 3 : 2;
}

/**
 * Whether the inspector shows the link panel: only for one piece that plays a note or follows a marble, as a piece
 * tied to nothing has nothing to show. Play a Note… and Follow a Marble… in its menus tie it.
 */
export function showsLinkPanel(entities: TEntity[]): boolean {
	return entities.length === 1 && entities[0]?.components.hitLink != null;
}
