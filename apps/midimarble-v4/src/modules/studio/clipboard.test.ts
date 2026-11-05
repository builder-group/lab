import { describe, expect, it } from 'vitest';
import { applyProjectCommands, createProject, type TEntity } from '@/modules/project';
import { pasteFilmCommands } from './clipboard';
import { DUPLICATE_OFFSET, freePieces } from './duplicate';

describe('Copy and Paste', () => {
	it('should paste a title as a new layer beside it, and the next paste beside that', () => {
		const title = { id: 'title', name: 'Hello', components: { transform: { position: { x: 1, y: 1 }, angle: 0 }, wallText: { text: 'Hello', size: 0.1, color: '#ffffff', font: 'sans' } } } as unknown as TEntity;
		const once = pasteFilmCommands(createProject(), { titles: [title], decor: [] });
		expect(once.titles[0]?.id).not.toBe('title');
		expect(once.titles[0]?.components.transform?.position.x).toBeCloseTo(1 + DUPLICATE_OFFSET.x);
		const twice = pasteFilmCommands(createProject(), { titles: once.titles, decor: [] });
		expect(twice.titles[0]?.components.transform?.position.x).toBeCloseTo(1 + 2 * DUPLICATE_OFFSET.x);
	});

	it('should keep a free piece as it is', () => {
		const piece = { id: 'bar', name: 'Platform 1', components: { transform: { position: { x: 0, y: 0 }, angle: 0 }, piece: { type: 'platform', params: {} } } } as unknown as TEntity;
		const [isOk, , project] = applyProjectCommands(createProject(), [{ type: 'upsertEntity', entity: piece }]);
		expect(isOk).toBe(true);
		if (project != null) expect(freePieces(project, null, ['bar'])[0]?.id).toBe('bar');
	});
});
