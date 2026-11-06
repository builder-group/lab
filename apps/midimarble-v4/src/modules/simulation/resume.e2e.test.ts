import { describe, expect, it } from 'vitest';
import { type TProject, tieOf } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { createPerfProject } from './fixture-projects';
import { answerSettle, type TSettleBase } from './local-edit';
import { createSimulator, type TSimulator } from './simulate';
import type { TSimulationResult } from './types';

const DEGREE = Math.PI / 180;

// A simulator resumes from its snapshots and a settle runs its ways a stretch at a time, so after many edits the
// simulator's run must still be, bit for bit, what a fresh simulator finds

function turned(project: TProject, id: string, by: number): TProject {
	return {
		...project,
		revision: project.revision + 1,
		track: { ...project.track, pieces: project.track.pieces.map((piece) => (piece.id === id && tieOf(piece) != null ? { ...piece, angle: piece.angle + by } : piece)) }
	};
}

function withPieces(project: TProject, pieces: TProject['track']['pieces']): TProject {
	const changed = new Map(pieces.map((piece) => [piece.id, piece]));
	return { ...project, revision: project.revision + 1, track: { ...project.track, pieces: project.track.pieces.map((piece) => changed.get(piece.id) ?? piece) } };
}

/** The same run, sample for sample, hit for hit and contact for contact */
function expectSameRun(run: TSimulationResult, fresh: TSimulationResult, what: string): void {
	expect(run.duration, what).toBe(fresh.duration);
	expect(run.marbles.length, what).toBe(fresh.marbles.length);
	for (const [index, marble] of run.marbles.entries()) {
		const other = fresh.marbles[index];
		expect(marble.samples.length, `${what}: samples of ${marble.marbleId}`).toBe(other?.samples.length);
		const differing = marble.samples.findIndex((sample, k) => {
			const was = other?.samples[k];
			return was == null || sample.time !== was.time || sample.position.x !== was.position.x || sample.position.y !== was.position.y || sample.velocity.x !== was.velocity.x || sample.velocity.y !== was.velocity.y || sample.angle !== was.angle;
		});
		expect(differing, `${what}: first differing sample of ${marble.marbleId}`).toBe(-1);
	}
	expect(run.hits.map((hit) => [hit.hitId, hit.status, hit.actualTime, hit.dot]), what).toEqual(fresh.hits.map((hit) => [hit.hitId, hit.status, hit.actualTime, hit.dot]));
	expect(run.contacts.map((contact) => [contact.time, contact.marbleId, contact.otherId, contact.speed]), what).toEqual(fresh.contacts.map((contact) => [contact.time, contact.marbleId, contact.otherId, contact.speed]));
	expect(run.pieces.map((piece) => [piece.pieceId, piece.status, piece.position, piece.angle]), what).toEqual(fresh.pieces.map((piece) => [piece.pieceId, piece.status, piece.position, piece.angle]));
}

/** The first `length` seconds of a run are a stopped-early run's whole */
function expectPrefix(short: TSimulationResult, whole: TSimulationResult, what: string): void {
	for (const [index, marble] of short.marbles.entries()) {
		const other = whole.marbles[index];
		const differing = marble.samples.findIndex((sample, k) => {
			const was = other?.samples[k];
			return was == null || sample.time !== was.time || sample.position.x !== was.position.x || sample.position.y !== was.position.y;
		});
		expect(differing, `${what}: first differing sample of ${marble.marbleId}`).toBe(-1);
	}
	for (const hit of short.hits) {
		if (hit.targetTime > short.duration - 0.05) continue;
		const was = whole.hits.find((item) => item.marbleId === hit.marbleId && item.hitId === hit.hitId);
		expect([hit.status, hit.actualTime], `${what}: hit ${hit.hitId}`).toEqual([was?.status, was?.actualTime]);
	}
}

async function checkEdits(simulator: TSimulator, project: TProject, edits: { id: string; by: number }[], what: string): Promise<void> {
	let memo: TSettleBase | null = null;
	let present = project;
	simulator.simulate(present);
	for (const [index, edit] of edits.entries()) {
		const after = turned(present, edit.id, edit.by * DEGREE);
		// The settle's own runs: short solves, stretches and whole runs, all on the one simulator
		const settled = answerSettle(simulator, { before: present, after }, memo);
		memo = settled.memo;
		const landed = withPieces(after, settled.answer.pieces);
		const label = `${what}, edit ${index + 1} (${edit.id} by ${edit.by}°)`;

		// A run stopped early, then the whole, resumed from it
		const early = simulator.simulate({ ...landed, length: landed.length * 0.6 });
		const resumed = simulator.simulate(landed);
		const fresh = (await createSimulator()).simulate(landed);
		expectSameRun(resumed, fresh, label);
		expectPrefix(early, fresh, `${label}, stopped early`);

		// Back to before the edit: the run of the project the edit was made on
		const undone = simulator.simulate(present);
		expectSameRun(undone, (await createSimulator()).simulate(present), `${label}, undone`);
		simulator.simulate(landed);
		present = landed;
	}
}

describe('resumed and stopped-early runs across edits', () => {
	it('equal a fresh run after every tilt on Jingle Bells', async () => {
		const simulator = await createSimulator();
		const edits = ['piece-1-2', 'piece-1-9', 'piece-2-16', 'piece-1-27', 'piece-2-30', 'piece-1-39', 'piece-2-50', 'piece-1-16'].map((id, index) => ({ id, by: [0.3, -0.7, 1, 0.5][index % 4] ?? 0.3 }));
		await checkEdits(simulator, loadFixture('jingle-bells'), edits, 'Jingle Bells');
		simulator.dispose();
	}, 600_000);

	it('equal a fresh run after every tilt on a 60 second, four marble project', async () => {
		const simulator = await createSimulator();
		const project = createPerfProject();
		const platforms = project.track.pieces.filter((piece) => tieOf(piece) != null).map((piece) => piece.id);
		const edits = [0.1, 0.35, 0.6, 0.85, 0.2, 0.7].map((share, index) => ({ id: platforms[Math.floor(platforms.length * share)] ?? '', by: index % 2 === 0 ? 0.4 : -0.6 }));
		await checkEdits(simulator, project, edits, 'perf project');
		simulator.dispose();
	}, 600_000);
});
