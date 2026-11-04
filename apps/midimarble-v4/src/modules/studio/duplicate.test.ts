import { describe, expect, it } from 'vitest';
import { createProject, type TEntity } from '@/modules/project';
import { DUPLICATE_OFFSET, duplicatePieces } from './duplicate';

function freePlatform(id: string, name: string, x: number): TEntity {
	return {
		id,
		name,
		components: {
			piece: { type: 'platform', params: {} },
			transform: { position: { x, y: 0.2 }, angle: 0.1 }
		}
	} as TEntity;
}

describe('duplicatePieces', () => {
	it('should copy a free piece beside it with the next default name', () => {
		const project = { ...createProject(), entities: [...createProject().entities, freePlatform('a', 'Platform 1', 0.3)] };
		const { commands, copies } = duplicatePieces(project, null, ['a']);
		expect(commands).toHaveLength(1);
		const copy = copies[0];
		expect(copy?.id).not.toBe('a');
		expect(copy?.name).toBe('Platform 2');
		expect(copy?.components.transform?.position.x).toBeCloseTo(0.3 + DUPLICATE_OFFSET.x);
		expect(copy?.components.transform?.position.y).toBeCloseTo(0.2 + DUPLICATE_OFFSET.y);
		expect(copy?.components.transform?.angle).toBe(0.1);
	});

	it('should number several copies one after another', () => {
		const project = { ...createProject(), entities: [freePlatform('a', 'Platform 1', 0), freePlatform('b', 'Platform 2', 0.2)] };
		expect(duplicatePieces(project, null, ['a', 'b']).copies.map((copy) => copy.name)).toEqual(['Platform 3', 'Platform 4']);
	});

	it('should skip a tied piece without a run to read its pose from', () => {
		const tied = { ...freePlatform('a', 'Platform 1', 0), components: { ...freePlatform('a', 'Platform 1', 0).components, hitLink: { laneId: 'l', hitId: 'h', angle: 0, contactAt: 0.5, pinned: false } } } as TEntity;
		const project = { ...createProject(), entities: [tied] };
		expect(duplicatePieces(project, null, ['a']).commands).toEqual([]);
	});
});
