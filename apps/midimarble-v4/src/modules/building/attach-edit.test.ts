import { describe, expect, it } from 'vitest';
import { createProject, tieOf } from '@/modules/project';
import { createLinkedPiece, resolvePiecePath, tunnelDefinition, type TSimulationResult } from '@/modules/simulation';
import { clearRotorPosition, createFreePiece, railPath, ROTOR_CLEARANCE, withPathType } from './attach-edit';

describe('withPathType function', () => {
	const nodes = [
		{ point: { x: 0, y: 0 }, out: { x: 0.04, y: 0 } },
		{ point: { x: 0.12, y: -0.05 }, in: { x: -0.04, y: 0 } }
	];

	it('should turn a drawn rail into a tunnel and back with the same path and pose', () => {
		// Prepare
		const rail = createFreePiece('rail', { position: { x: 0.3, y: 0.5 }, angle: 0.2 }, [], railPath(nodes));
		rail.params = { ...rail.params, gap: 0.018 };

		// Act
		const tunnel = withPathType(rail, 'tunnel', [rail]);
		const back = withPathType(tunnel, 'rail', [tunnel]);

		// Assert
		expect(tunnel.id).toBe(rail.id);
		expect(tunnel.type).toBe('tunnel');
		expect(tunnel.path).toEqual(rail.path);
		expect(tunnel.place).toEqual(rail.place);
		expect(tunnel.angle).toBe(rail.angle);
		expect(tunnel.params['bore']).toBe(tunnelDefinition.params['bore']?.default);
		expect(tunnel.params['gap']).toBeUndefined();
		expect(back.path).toEqual(rail.path);
		expect(back.place).toEqual(rail.place);
		expect(back.angle).toBe(rail.angle);
		expect(back.params['gap']).not.toBe(0.018);
	});

	it('should keep the anchor and its moment on the trajectory', () => {
		const rail = createLinkedPiece('rail', 'marble-1', 'hit-2', 0, { pieces: [] });
		rail.params = { ...rail.params, entryDelay: 0.25 };
		rail.place = { kind: 'follows', marbleId: 'marble-1', hitId: 'hit-2', offset: { x: 0.01, y: -0.02 } };

		const tunnel = withPathType(rail, 'tunnel', [rail]);

		expect(tieOf(tunnel)).toEqual(tieOf(rail));
		expect(tunnel.angle).toBe(rail.angle);
		expect(tunnel.params['entryDelay']).toBe(0.25);
		// The rail ran on its default path, which the tunnel keeps instead of taking its own
		expect(tunnel.path?.points).toEqual(resolvePiecePath('rail', undefined));
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

describe('clearRotorPosition function', () => {
	// A marble falling straight down at x = 0 and a second one 0.2 m to its right
	const fall = (x: number) => Array.from({ length: 100 }, (_, i) => ({ time: i * 0.01, position: { x, y: 0.6 - i * 0.01 }, angle: 0, velocity: { x: 0, y: -1 } }));
	const result = {
		marbles: [
			{ entityId: 'marble-1', marbleId: 'marble-1', radius: 0.012, samples: fall(0) },
			{ entityId: 'marble-2', marbleId: 'marble-2', radius: 0.012, samples: fall(0.2) }
		],
		pieces: []
	} as unknown as TSimulationResult;
	const distanceToFall = (point: { x: number }, x: number): number => Math.abs(point.x - x);

	it('should put the hub beside the fall with the arm circle clear of every marble', () => {
		// Prepare
		const reach = 0.06;

		// Act
		const hub = clearRotorPosition(createProject(), result, { position: { x: 0, y: 0.3 }, velocity: { x: 0, y: -1 } }, reach, 'marble-1');

		// Assert
		expect(distanceToFall(hub, 0) - 0.012 - reach).toBeGreaterThanOrEqual(ROTOR_CLEARANCE - 1e-9);
		expect(distanceToFall(hub, 0.2) - 0.012 - reach).toBeGreaterThanOrEqual(ROTOR_CLEARANCE - 1e-9);
		expect(hub.y).toBeCloseTo(0.3);
	});

	it('should take the other side when the first one crosses another marble', () => {
		// Prepare: the right side is taken by the second marble whatever the stretch
		const reach = 0.09;

		// Act
		const hub = clearRotorPosition(createProject(), result, { position: { x: 0, y: 0.3 }, velocity: { x: 0, y: -1 } }, reach, 'marble-1');

		// Assert
		expect(hub.x).toBeLessThan(0);
	});
});
