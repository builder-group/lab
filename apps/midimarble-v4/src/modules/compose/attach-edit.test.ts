import { describe, expect, it } from 'vitest';
import type { TEntity } from '@/modules/project';
import { createLinkedPiece, resolvePiecePath, tunnelDefinition } from '@/modules/simulation';
import { createFreePiece, railPath, withPathType } from './attach-edit';

describe('withPathType function', () => {
	const nodes = [
		{ point: { x: 0, y: 0 }, out: { x: 0.04, y: 0 } },
		{ point: { x: 0.12, y: -0.05 }, in: { x: -0.04, y: 0 } }
	];

	it('should turn a drawn rail into a tunnel and back with the same path and pose', () => {
		// Prepare
		const rail = createFreePiece('rail', { position: { x: 0.3, y: 0.5 }, angle: 0.2 }, [], railPath(nodes));
		rail.components.piece = { type: 'rail', params: { ...rail.components.piece?.params, gap: 0.018 } };

		// Act
		const tunnel = withPathType(rail, 'tunnel', [rail]);
		const back = withPathType(tunnel, 'rail', [tunnel]);

		// Assert
		expect(tunnel.id).toBe(rail.id);
		expect(tunnel.components.piece?.type).toBe('tunnel');
		expect(tunnel.components.path).toEqual(rail.components.path);
		expect(tunnel.components.transform).toEqual(rail.components.transform);
		expect(tunnel.components.piece?.params['bore']).toBe(tunnelDefinition.params['bore']?.default);
		expect(tunnel.components.piece?.params['gap']).toBeUndefined();
		expect(back.components.path).toEqual(rail.components.path);
		expect(back.components.transform).toEqual(rail.components.transform);
		expect(back.components.piece?.params['gap']).not.toBe(0.018);
	});

	it('should keep the anchor and its moment on the trajectory', () => {
		const rail = createLinkedPiece('rail', 'lane-1', 'hit-2', 0, { entities: [] });
		rail.components.piece = { type: 'rail', params: { ...rail.components.piece?.params, entryDelay: 0.25 } };
		rail.components.hitLink = { ...(rail.components.hitLink as NonNullable<TEntity['components']['hitLink']>), anchored: true, offset: { x: 0.01, y: -0.02 } };

		const tunnel = withPathType(rail, 'tunnel', [rail]);

		expect(tunnel.components.hitLink).toEqual(rail.components.hitLink);
		expect(tunnel.components.piece?.params['entryDelay']).toBe(0.25);
		// The rail ran on its default path, which the tunnel keeps instead of taking its own
		expect(tunnel.components.path?.points).toEqual(resolvePiecePath('rail', undefined));
	});

	it('should renumber a default name after the new type and keep a custom one', () => {
		const tunnel = createFreePiece('tunnel', { position: { x: 0, y: 0 }, angle: 0 }, []);
		const rail = createFreePiece('rail', { position: { x: 0, y: 0 }, angle: 0 }, [], railPath(nodes));
		expect(withPathType(rail, 'tunnel', [tunnel, rail]).name).toBe('Tunnel 2');
		expect(withPathType({ ...rail, name: 'Long slide' }, 'tunnel', [tunnel, rail]).name).toBe('Long slide');
	});

	it('should leave other piece types unchanged', () => {
		const windmill = createFreePiece('windmill', { position: { x: 0, y: 0 }, angle: 0 }, []);
		expect(withPathType(windmill, 'tunnel', [windmill])).toBe(windmill);
	});
});
