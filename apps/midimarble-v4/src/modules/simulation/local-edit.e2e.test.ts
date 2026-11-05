import { beforeAll, describe, expect, it } from 'vitest';
import type { TProject } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { answerSettle, type TSettleBase } from './local-edit';
import { createSimulator, type TSimulator } from './simulate';
import type { TSimulationResult } from './types';

const DEGREE = Math.PI / 180;

/** Melody and Bass platforms across the song, some right before a switchback */
const PIECES = ['piece-1-2', 'piece-1-3', 'piece-1-9', 'piece-1-16', 'piece-1-27', 'piece-1-39', 'piece-2-3', 'piece-2-16', 'piece-2-30', 'piece-2-50'];

function turned(project: TProject, id: string, by: number): TProject {
	return {
		...project,
		revision: project.revision + 1,
		entities: project.entities.map((entity) => {
			const link = entity.components.hitLink;
			return entity.id === id && link != null ? { ...entity, components: { ...entity.components, hitLink: { ...link, angle: link.angle + by } } } : entity;
		})
	};
}

describe('small edits on Jingle Bells', () => {
	let simulator: TSimulator;
	let project: TProject;
	let before: TSimulationResult;
	let memo: TSettleBase | null = null;

	beforeAll(async () => {
		simulator = await createSimulator();
		project = loadFixture('jingle-bells');
		before = (await createSimulator()).simulate(project);
	});

	it('should stay on time and keep later pieces where they were, whatever the size up to 1°', async () => {
		for (const id of PIECES) {
			for (const by of [0.17, -0.5, 1]) {
				// Act
				const after = turned(project, id, by * DEGREE);
				const settled = answerSettle(simulator, { before: project, after }, memo);
				memo = settled.memo;
				const changed = new Map(settled.answer.entities.map((entity) => [entity.id, entity]));
				const run = (await createSimulator()).simulate({ ...after, entities: after.entities.map((entity) => changed.get(entity.id) ?? entity) });

				// Assert: what a later session opens is what the settle promised
				const broken = run.hits.filter((hit) => hit.status === 'missed' || hit.status === 'blocked');
				// One break holds what comes later; only marbles that strike each other break one each
				const hasCollided = run.contacts.some((contact) => contact.kind === 'marble');
				expect(broken.length, `${id} by ${by}°`).toBeLessThanOrEqual(hasCollided ? project.music.marbles.length : 1);
				const near = new Set([id, ...settled.answer.absorbedBy]);
				const shifts = run.hits.flatMap((hit) => {
					const was = before.hits.find((item) => item.hitId === hit.hitId);
					return hit.pieceEntityId != null && !near.has(hit.pieceEntityId) && hit.dot != null && was?.dot != null ? [Math.hypot(hit.dot.x - was.dot.x, hit.dot.y - was.dot.y)] : [];
				});
				if (!broken.length) expect(Math.max(...shifts), `${id} by ${by}°`).toBeLessThan(0.05);
			}
		}
	}, 300_000);

	it('should keep every hit when a platform only slides along its bar', async () => {
		for (const id of ['piece-1-3', 'piece-1-9', 'piece-2-16']) {
			// Act
			const after = {
				...project,
				revision: project.revision + 1,
				entities: project.entities.map((entity) => {
					const link = entity.components.hitLink;
					return entity.id === id && link != null ? { ...entity, components: { ...entity.components, hitLink: { ...link, contactAt: 0.4 } } } : entity;
				})
			};
			const settled = answerSettle(simulator, { before: project, after }, memo);
			memo = settled.memo;
			const changed = new Map(settled.answer.entities.map((entity) => [entity.id, entity]));
			const run = (await createSimulator()).simulate({ ...after, entities: after.entities.map((entity) => changed.get(entity.id) ?? entity) });

			// Assert
			expect(run.hits.filter((hit) => hit.status === 'onTime'), id).toHaveLength(run.hits.length);
		}
	}, 120_000);

	it('should leave at most a few problems and no heap when a platform goes', async () => {
		for (const id of ['piece-1-2', 'piece-1-8', 'piece-2-16', 'piece-2-31']) {
			// Act
			const after = { ...project, revision: project.revision + 1, entities: project.entities.filter((entity) => entity.id !== id) };
			const settled = answerSettle(simulator, { before: project, after }, memo);
			memo = settled.memo;
			const changed = new Map(settled.answer.entities.map((entity) => [entity.id, entity]));
			const run = (await createSimulator()).simulate({ ...after, entities: after.entities.map((entity) => changed.get(entity.id) ?? entity) });

			// Assert: pieces after a break stay where they were
			expect(run.hits.filter((hit) => hit.status === 'missed' || hit.status === 'blocked').length, id).toBeLessThanOrEqual(3);
			for (const piece of run.pieces.filter((item) => item.status === 'held')) {
				const was = before.pieces.find((item) => item.entityId === piece.entityId);
				expect(Math.hypot(piece.position.x - (was?.position.x ?? 0), piece.position.y - (was?.position.y ?? 0)), piece.entityId).toBeLessThan(0.002);
			}
		}
	}, 120_000);
});
