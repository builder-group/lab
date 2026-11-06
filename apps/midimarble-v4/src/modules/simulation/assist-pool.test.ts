import { beforeAll, describe, expect, it } from 'vitest';
import { type TProject } from '@/modules/project';
import { createAssistPool, type TPoolWorker } from './assist-pool';
import { autoPlace, findLongGaps, hitOwners } from './assists';
import { createRailForGap, createSwitchbackForGap, createTunnelForGap } from './gap-pieces';
import { isSuperseded } from './request-queue';
import { packResult, unpackResult } from './result-transfer';
import { createSimulator, type TSimulator } from './simulate';
import { answerWorkerRequest, createWorkerMemory, type TGapPieceType, type TWorkerMessage } from './worker-protocol';
import { loadFixture } from '@/modules/project/test-helpers';

/**
 * Workers in this thread, each with its own simulator, that answer in order after a pseudo-random delay, so
 * chunks of a stage come back out of order the way they do across real workers
 */
function createFakeWorkers(seed: number): { createWorker: () => TPoolWorker; posted: TWorkerMessage[] } {
	let state = seed;
	const random = (): number => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state / 2147483648;
	};
	const posted: TWorkerMessage[] = [];
	const createWorker = (): TPoolWorker => {
		const simulator = createSimulator();
		const memory = createWorkerMemory();
		let chain: Promise<unknown> = Promise.resolve();
		let onAnswer: Parameters<TPoolWorker['listen']>[0] = () => undefined;
		let isTerminated = false;
		return {
			post(message) {
				posted.push(message);
				const copy = structuredClone(message);
				const delay = random() * 4;
				chain = chain.then(async () => {
					await new Promise((resolve) => setTimeout(resolve, delay));
					if (isTerminated) return;
					try {
						const value = answerWorkerRequest(await simulator, copy, memory);
						onAnswer({ id: copy.id, ok: true, value: structuredClone(value) });
					} catch (error) {
						onAnswer({ id: copy.id, ok: false, error: error instanceof Error ? error.message : String(error) });
					}
				});
			},
			listen(answer) {
				onAnswer = answer;
			},
			terminate() {
				isTerminated = true;
			}
		};
	};
	return { createWorker, posted };
}

describe('createAssistPool function', () => {
	let simulator: TSimulator;
	let project: TProject;

	beforeAll(async () => {
		simulator = await createSimulator();
		project = loadFixture('zigzag');
	});

	/** Auto place in this thread, the answer a single assists worker gives */
	function placeAlone(marbleId: string, hitId: string, pieceId: string): unknown {
		const simulate = (next: TProject): ReturnType<TSimulator['simulate']> => simulator.simulate(next);
		const [isOk, error, placement] = autoPlace(project, simulate(project), marbleId, hitId, { simulate, type: 'platform', id: pieceId });
		return isOk ? { piece: placement.piece, angle: placement.angle, nextDot: placement.nextDot } : error.message;
	}

	it('should place the same platforms as a single worker whatever the pool size and timing', async () => {
		// Prepare: platforms early, mid-song and late
		const marble = project.marbles[0];
		if (marble == null) throw new Error('The fixture has a marble');
		const owners = hitOwners(project, marble.id);
		const hits = [3, 8, 13].map((index) => marble.hits[index]).filter((hit): hit is NonNullable<typeof hit> => hit != null && owners.has(hit.id));
		expect(hits.length).toBeGreaterThan(2);
		const expected = hits.map((hit) => placeAlone(marble.id, hit.id, owners.get(hit.id)?.id ?? 'piece'));

		for (const [size, seed] of [
			[2, 1],
			[5, 7]
		] as const) {
			const { createWorker } = createFakeWorkers(seed);
			const pool = createAssistPool({ size, createWorker });

			// Act
			const answers: unknown[] = [];
			for (const hit of hits) {
				const request = { project, marbleId: marble.id, hitId: hit.id, type: 'platform', pieceId: owners.get(hit.id)?.id ?? 'piece' };
				answers.push(
					await pool.autoPlace(request).then(
						(answer) => ({ piece: answer.piece, angle: answer.angle, nextDot: answer.nextDot }),
						(error: unknown) => (error instanceof Error ? error.message : String(error))
					)
				);
			}
			pool.dispose();

			// Assert
			expect(answers).toEqual(expected);
		}
	}, 60_000);

	it('should suggest the same switchbacks, rails and tunnels as a single worker', async () => {
		// Prepare
		const simulate = (next: TProject): ReturnType<TSimulator['simulate']> => simulator.simulate(next);
		const project = loadFixture('long-gap');
		const gaps = project.marbles.flatMap((marble) => findLongGaps(project, marble.id)).slice(0, 1);
		expect(gaps.length).toBeGreaterThan(0);
		const { createWorker } = createFakeWorkers(3);
		const pool = createAssistPool({ size: 3, createWorker });

		for (const gap of gaps) {
			for (const type of ['switchback', 'rail', 'tunnel'] as TGapPieceType[]) {
				const pieceId = gap.bridgedBy ?? 'gap-piece';
				const create = type === 'switchback' ? createSwitchbackForGap : type === 'rail' ? createRailForGap : createTunnelForGap;
				const [isOk, error, proposal] = create(project, simulate(project), gap.marbleId, gap.fromHitId, gap.toHitId, { simulate, id: pieceId });

				// Act
				const answer = await pool.gapPiece({ type, project, marbleId: gap.marbleId, fromHitId: gap.fromHitId, toHitId: gap.toHitId, pieceId }).then(
					(value) => ({ piece: value.piece, check: value.check }),
					(failure: unknown) => (failure instanceof Error ? failure.message : String(failure))
				);

				// Assert
				expect(answer).toEqual(isOk ? { piece: proposal.piece, check: proposal.check } : error.message);
			}
		}
		pool.dispose();
	}, 60_000);

	it('should stop a search between stages and keep answering later requests', async () => {
		// Prepare
		const marble = project.marbles[0];
		const hit = marble?.hits[8];
		if (marble == null || hit == null) throw new Error('The fixture has a marble');
		const pieceId = hitOwners(project, marble.id).get(hit.id)?.id ?? 'piece';
		const { createWorker, posted } = createFakeWorkers(5);
		const pool = createAssistPool({ size: 3, createWorker });
		const request = { project, marbleId: marble.id, hitId: hit.id, type: 'platform', pieceId };

		// Act: Stop pressed once the first stage went out
		const stopped = pool.autoPlace(request, { isCanceled: () => posted.length > 0 });
		// Replaced at once by the newest, so its rejection is caught right away
		const waiting = pool.autoPlace(request).catch((error: unknown) => error);
		const newest = pool.autoPlace(request);

		// Assert
		await expect(stopped).rejects.toThrow('Auto place was stopped');
		expect(isSuperseded(await waiting)).toBe(true);
		await expect(newest).resolves.toMatchObject({ piece: (placeAlone(marble.id, hit.id, pieceId) as { piece: unknown }).piece });
		const late = pool.autoPlace(request);
		pool.dispose();
		await expect(late).rejects.toThrow();
	}, 60_000);
});

describe('packResult function', () => {
	it('should pack samples into transferable arrays that unpack to the same result', async () => {
		// Prepare
		const simulator = await createSimulator();
		const result = simulator.simulate(loadFixture('two-marbles'));

		// Act
		const { packed, transfer } = packResult(result);

		// Assert
		expect(transfer.length).toBe(result.marbles.length);
		expect(unpackResult(structuredClone(packed, { transfer }))).toEqual(result);
	});
});
