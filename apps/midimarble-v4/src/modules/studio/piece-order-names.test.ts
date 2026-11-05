import { describe, expect, it } from 'vitest';
import type { TEntity, TProject } from '@/modules/project';
import { createLinkedPiece, startRailId } from '@/modules/simulation';
import { createBareRunProject } from '@/modules/simulation/fixture-projects';
import { renumberDefaultNames } from './piece-order-names';

function oneMarble(): TProject {
	return createBareRunProject({ id: 'names', title: 'Names', end: 4, marbles: [{ x: 0, y: 0.6, releaseTime: 0, hitTimes: [0.5, 1, 1.5] }] });
}

function linked(hitId: string, name: string): TEntity {
	return { ...createLinkedPiece('platform', 'lane-1', hitId, 0, { id: `platform-${hitId}` }), name };
}

function names(project: TProject): Record<string, string | undefined> {
	return Object.fromEntries(project.entities.filter((entity) => entity.components.piece != null).map((entity) => [entity.id, entity.name]));
}

describe('renumberDefaultNames', () => {
	it('should count a marble\'s start rail first among its rails, as Layers lists it', () => {
		const before = oneMarble();
		const rail = (id: string, name: string, hitLink?: { marbleId: string; hitId: string; angle: number; contactAt: number }): TEntity => ({ id, name, components: { piece: { type: 'rail', params: {} }, ...(hitLink != null ? { hitLink } : {}) } });
		before.entities.push(rail('free', 'Rail 1'), rail(startRailId('lane-1'), 'Rail 2'));
		const after = { ...before, entities: [...before.entities, rail('gap', 'Rail 3', { marbleId: 'lane-1', hitId: 'hit-1-1', angle: 0, contactAt: 0.5 })] };

		expect(names(renumberDefaultNames(before, after))).toEqual({ [startRailId('lane-1')]: 'Rail 1', gap: 'Rail 2', free: 'Rail 3' });
	});

	it('should give a new platform for an earlier hit the lower number', () => {
		// Prepare: Hit 2 and 3 have platforms, then Hit 1 gets one
		const before = oneMarble();
		before.entities.push(linked('hit-1-2', 'Platform 1'), linked('hit-1-3', 'Platform 2'));
		const after = { ...before, entities: [...before.entities, linked('hit-1-1', 'Platform 3')] };

		// Act
		const named = renumberDefaultNames(before, after);

		// Assert
		expect(names(named)).toEqual({ 'platform-hit-1-2': 'Platform 2', 'platform-hit-1-3': 'Platform 3', 'platform-hit-1-1': 'Platform 1' });
	});

	it('should keep custom names and count only default ones', () => {
		const before = oneMarble();
		before.entities.push(linked('hit-1-2', 'Kick'), linked('hit-1-3', 'Platform 1'));
		const after = { ...before, entities: [...before.entities, linked('hit-1-1', 'Platform 3')] };
		expect(names(renumberDefaultNames(before, after))).toEqual({ 'platform-hit-1-2': 'Kick', 'platform-hit-1-3': 'Platform 2', 'platform-hit-1-1': 'Platform 1' });
	});

	it('should leave an edit that adds no piece alone, even with names out of order', () => {
		const before = oneMarble();
		before.entities.push(linked('hit-1-1', 'Platform 2'), linked('hit-1-2', 'Platform 1'));
		const after = { ...before, entities: [...before.entities] };
		expect(renumberDefaultNames(before, after)).toBe(after);
	});

	it('should renumber when an edit leaves two pieces with the same default name', () => {
		const before = oneMarble();
		before.entities.push(linked('hit-1-1', 'Platform 1'), linked('hit-1-2', 'Platform 2'));
		const after = { ...before, entities: [linked('hit-1-1', 'Platform 2'), linked('hit-1-2', 'Platform 2')] };
		expect(names(renumberDefaultNames(before, after))).toEqual({ 'platform-hit-1-1': 'Platform 1', 'platform-hit-1-2': 'Platform 2' });
	});
});
