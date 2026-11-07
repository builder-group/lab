import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import catalog from '../../../blender/mm_worker/skin_catalog.json';
import { createFreePiece, displayPiece } from '@/modules/building';
import { pieceIcons } from '@/modules/canvas/piece-icons';
import { pieceOutline } from '@/modules/scene';
import { getPieceDefinition, layoutOf, PIECE_TYPES, resolvePiecePath } from '@/modules/simulation';
import { insertSections } from './library';

const elements: Record<string, { skins: { id: string }[] }> = catalog.elements;
const themes: Record<string, Record<string, string>> = catalog.themes;
const skinsPy = readFileSync(fileURLToPath(new URL('../../../blender/mm_worker/skins.py', import.meta.url)), 'utf8');
/** `'rail': rail_spec` pairs of the table `build_spec` picks a skin builder from */
const skinBuilders = new Map(
	[...(/builder = \{([^}]*)\}/.exec(skinsPy)?.[1] ?? '').matchAll(/'(\w+)':\s*(\w+)/g)].map((match) => [match[1], match[2]])
);

function missingParts(type: string): string[] {
	const definition = getPieceDefinition(type);
	if (definition == null) return ['no definition in the registry in simulation/pieces.ts'];
	const missing: string[] = [];
	if (definition.type !== type) missing.push(`its definition says type '${definition.type}'`);
	if (!(type in pieceIcons)) missing.push('no icon in canvas/piece-icons.tsx');
	if (!insertSections.some((section) => section.entries.some((entry) => entry.item === type && entry.description !== ''))) missing.push('no tile description in its definition');

	const element = elements[type];
	if (element == null || element.skins.length === 0) missing.push('no element with skins in blender/mm_worker/skin_catalog.json');
	for (const [theme, parts] of Object.entries(themes)) {
		if (element?.skins.some((skin) => skin.id === parts[type]) !== true) missing.push(`theme '${theme}' dresses it with no skin of its own in skin_catalog.json`);
	}

	const builder = skinBuilders.get(type);
	if (builder == null) missing.push('no skin builder in `build_spec` in blender/mm_worker/skins.py');
	else if (!skinsPy.includes(`def ${builder}(`)) missing.push(`skins.py names a skin builder \`${builder}\` it doesn't define`);

	const kind = layoutOf(type);
	const points = resolvePiecePath(type, undefined);
	const piece = createFreePiece(type, { position: { x: 0, y: 0 }, angle: 0 }, [], kind === 'path' || kind === 'tube' ? { points } : undefined);
	const resolved = displayPiece(piece, { pose: { position: { x: 0, y: 0 }, angle: 0 } });
	if ((resolved.shapes?.length ?? 0) === 0) missing.push(`its layout '${kind}' builds no physics shapes from the definition's defaults`);
	if (pieceOutline(resolved).length < 3) missing.push(`its layout '${kind}' draws no outline on the canvas`);
	return missing;
}

describe('piece registry', () => {
	it.each(PIECE_TYPES)('should have every part of a piece type: %s', (type) => {
		const missing = missingParts(type);
		expect(missing.join('; '), `Piece type '${type}' is incomplete: ${missing.join('; ')}. See "Add a piece type" in docs/architecture.md.`).toBe('');
	});

	it('should know no skin element or builder without a piece type', () => {
		const known = new Set<string>(PIECE_TYPES);
		expect(Object.keys(elements).filter((element) => element !== 'marble' && !known.has(element)), 'skin_catalog.json has elements with no piece type').toEqual([]);
		expect([...skinBuilders.keys()].filter((type) => type != null && !known.has(type)), 'skins.py has builders with no piece type').toEqual([]);
	});

	it('should find the skin builders in skins.py', () => {
		expect(skinBuilders.size).toBeGreaterThan(0);
	});
});
