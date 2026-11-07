import { describe, expect, it } from 'vitest';
import type { TProject } from '@/modules/project';
import { createLinkedPiece } from './placement';
import { createBareRunProject } from './fixture-projects';
import { createRequestQueue, isSuperseded } from './request-queue';
import { createSimulator } from './simulate';
import { answerWorkerRequest, type TContinueAnswer, type TGapAnswer } from '@/modules/building';

function setup(priority?: (channel: string) => number): {
	queue: ReturnType<typeof createRequestQueue<string>>;
	sent: { id: number; message: string }[];
} {
	const sent: { id: number; message: string }[] = [];
	const queue = createRequestQueue<string>({ send: (id, message) => sent.push({ id, message }), priority });
	return { queue, sent };
}

describe('request queue', () => {
	it('pairs answers with requests by id and ignores strangers', async () => {
		const { queue, sent } = setup();
		const first = queue.enqueue<string>('a', 'one');
		expect(sent).toEqual([{ id: 1, message: 'one' }]);
		expect(queue.receive({ id: 99, ok: true, value: 'stray' })).toBe(false);
		expect(queue.receive({ id: 1, ok: true, value: 'answer one' })).toBe(true);
		await expect(first).resolves.toBe('answer one');
		// A late duplicate of an answered id is ignored too
		expect(queue.receive({ id: 1, ok: true, value: 'again' })).toBe(false);
	});

	it('keeps only the newest waiting request per channel and merges simulate waiters', async () => {
		const { queue, sent } = setup();
		const running = queue.enqueue<string>('simulate', 'p1', { merge: true });
		const replaced = queue.enqueue<string>('simulate', 'p2', { merge: true });
		const newest = queue.enqueue<string>('simulate', 'p3', { merge: true });
		expect(sent.map((item) => item.message)).toEqual(['p1']);
		queue.receive({ id: 1, ok: true, value: 'r1' });
		await expect(running).resolves.toBe('r1');
		// p2 was never sent: the worker goes straight to p3, and both waiters get its answer
		expect(sent.map((item) => item.message)).toEqual(['p1', 'p3']);
		queue.receive({ id: 2, ok: true, value: 'r3' });
		await expect(replaced).resolves.toBe('r3');
		await expect(newest).resolves.toBe('r3');
	});

	it('rejects replaced assist requests as superseded', async () => {
		const { queue } = setup();
		queue.enqueue('continue', 'busy').catch(() => undefined);
		const old = queue.enqueue('autoPlace', 'old');
		const fresh = queue.enqueue<string>('autoPlace', 'fresh');
		await expect(old).rejects.toSatisfy(isSuperseded);
		queue.receive({ id: 1, ok: true, value: null });
		queue.receive({ id: 2, ok: true, value: 'placed' });
		await expect(fresh).resolves.toBe('placed');
	});

	it('runs higher priority channels first and keeps a replaced request in line', () => {
		const { queue, sent } = setup((channel) => ({ autoPlace: 0, gapPiece: 1, continue: 2 })[channel] ?? 3);
		const ignore = (promise: Promise<unknown>): void => void promise.catch(() => undefined);
		ignore(queue.enqueue('continue', 'c1'));
		ignore(queue.enqueue('continue', 'c2'));
		ignore(queue.enqueue('gapPiece', 'g1'));
		ignore(queue.enqueue('autoPlace', 'a1'));
		expect(queue.waitingChannels).toEqual(['continue', 'gapPiece', 'autoPlace']);
		queue.receive({ id: 1, ok: true, value: null });
		queue.receive({ id: 2, ok: true, value: null });
		queue.receive({ id: 3, ok: true, value: null });
		expect(sent.map((item) => item.message)).toEqual(['c1', 'a1', 'g1', 'c2']);
	});

	it('turns error answers and worker failures into rejections and moves on', async () => {
		const { queue, sent } = setup();
		const failing = queue.enqueue('a', 'x');
		const crashed = queue.enqueue('b', 'y');
		queue.receive({ id: 1, ok: false, error: 'No angle fits' });
		await expect(failing).rejects.toThrow('No angle fits');
		queue.fail(new Error('worker crashed'));
		await expect(crashed).rejects.toThrow('worker crashed');
		const after = queue.enqueue<string>('a', 'z');
		expect(sent.at(-1)).toEqual({ id: 3, message: 'z' });
		queue.dispose();
		await expect(after).rejects.toThrow('disposed');
	});
});

describe('worker protocol', () => {
	function bareRun(hitTimes: number[], angles: number[]): TProject {
		const project = createBareRunProject({
			gravity: 1, id: 'protocol', title: 'Protocol', end: 5, marbles: [{ x: 0, y: 0.6, releaseTime: 0, hitTimes }] });
		angles.forEach((angle, index) => {
			project.track.pieces.push(createLinkedPiece('platform', 'marble-1', `hit-1-${index + 1}`, angle, { id: `piece-${index + 1}` }));
		});
		return project;
	}

	it('answers simulate, autoPlace, continue and gapPiece requests', async () => {
		const simulator = await createSimulator();
		const zigzag = bareRun([0.15, 0.45, 0.75, 1.05, 1.35, 1.65], [-0.4, 0.4]);
		const placed = answerWorkerRequest(simulator, { kind: 'autoPlace', project: zigzag, marbleId: 'marble-1', hitId: 'hit-1-3', type: 'platform', pieceId: 'auto-1' });
		expect(placed).toMatchObject({ piece: { id: 'auto-1' } });

		const continued = answerWorkerRequest(simulator, { kind: 'continue', project: zigzag, marbleId: 'marble-1' }) as TContinueAnswer;
		expect(continued.pattern).toBe('mirror');
		expect(continued.revision).toBe(zigzag.revision);
		expect(continued.suggestions.filter((item) => item.isOk).length).toBeGreaterThanOrEqual(3);

		const gap = bareRun([0.15, 0.45, 0.75, 2.25, 2.55], [-0.4, 0.4, -0.4]);
		const rail = answerWorkerRequest(simulator, {
			kind: 'gapPiece',
			type: 'rail',
			project: gap,
			marbleId: 'marble-1',
			fromHitId: 'hit-1-3',
			toHitId: 'hit-1-4'
		}) as TGapAnswer;
		expect(rail.resolved?.status).toBe('placed');
		expect(rail.track.length).toBeGreaterThan(10);
		expect(rail.commands).toHaveLength(1);
		// The answer is plain data that survives the structured clone between worker and UI
		expect(structuredClone(rail)).toEqual(rail);

		const switchback = answerWorkerRequest(simulator, {
			kind: 'gapPiece',
			type: 'switchback',
			project: gap,
			marbleId: 'marble-1',
			fromHitId: 'hit-1-3',
			toHitId: 'hit-1-4'
		}) as TGapAnswer;
		expect(switchback.type).toBe('switchback');
		expect(switchback.resolved?.status).toBe('placed');
		expect(switchback.resolved?.paths?.length).toBeGreaterThanOrEqual(3);
		expect(switchback.check?.leaveTime).not.toBeNull();

		expect(() =>
			answerWorkerRequest(simulator, { kind: 'autoPlace', project: gap, marbleId: 'marble-1', hitId: 'missing', type: 'platform' })
		).toThrow();
		simulator.dispose();
	}, 20_000);
});
