import { beforeAll, describe, expect, it } from 'vitest';
import { type TPiece, type TProject, tieOf } from '@/modules/project';
import { loadFixture } from '@/modules/project/test-helpers';
import { createSimulator, handOversOf, type TSimulator } from './simulate';

// How much a change in how the marble enters a rail grows by the time it leaves: the velocity change at the next note over the
// entry change, each rail on its own, as physics with no stored ride. A wire of one surface keeps this near what a ball on a
// perfect curve has. Without it, capsules, the same rails reach thousands.

const CHANGES = [1e-5, -1e-5, 1e-4, -1e-4, 1e-3, -1e-3];

interface TGain {
	id: string;
	median: number;
	max: number;
	spread: number;
	isLong: boolean;
}

function gains(simulator: TSimulator, name: string): TGain[] {
	const fixture = loadFixture(name);
	const base = simulator.walk(fixture);
	// Each hop starts from where the run has it, and the one tested runs as physics, with no ride and no kept exit
	const stored: TProject = { ...fixture, marbles: fixture.marbles.map((marble, index) => ({ ...marble, handOvers: handOversOf(base, index) })) };
	const bare = (railId: string, hitId: string): TProject => ({
		...stored,
		track: {
			...stored.track,
			pieces: stored.track.pieces.map((piece): TPiece => {
				if (piece.id === railId) {
					const { ride: _, ...rest } = piece;
					return rest;
				}
				if (piece.place.kind !== 'plays' || piece.place.hitId !== hitId) return piece;
				const { leaves: _leaves, ...place } = piece.place;
				return { ...piece, place };
			})
		}
	});
	const out: TGain[] = [];
	for (const piece of stored.track.pieces) {
		const tie = tieOf(piece);
		if (tie == null || (piece.type !== 'rail' && piece.type !== 'tunnel')) continue;
		const project = bare(piece.id, tie.hitId);
		const index = project.marbles.findIndex((marble) => marble.id === tie.marbleId);
		const marble = project.marbles[index];
		const hit = marble?.hits.find((item) => item.id === tie.hitId);
		if (marble?.handOvers == null || hit == null) continue;
		const step = Math.floor(hit.time * 240 + 1e-7);
		const at = marble.handOvers.findIndex((handOver) => handOver.step === step);
		const next = marble.handOvers[at + 1];
		if (at < 0 || next == null) continue;
		const landing = (handOvers: NonNullable<typeof marble.handOvers>) => {
			const hop = simulator.walk({ ...project, marbles: project.marbles.map((item, i) => (i === index ? { ...item, handOvers } : item)) }, next.step).marbles[index]?.hops.find((item) => item.from === step);
			return hop?.record.marbles[hop.track]?.end;
		};
		const before = landing(marble.handOvers);
		if (before == null) continue;
		const measured = CHANGES.map((change) => {
			const after = landing(marble.handOvers?.map((handOver, i) => (i === at ? { ...handOver, velocity: { x: handOver.velocity.x + change, y: handOver.velocity.y } } : handOver)) ?? []);
			if (after == null) return { gain: Infinity, spread: Infinity };
			return { gain: Math.hypot(after.vx - before.vx, after.vy - before.vy) / Math.abs(change), spread: Math.hypot(after.x - before.x, after.y - before.y) };
		});
		const sorted = measured.map((item) => item.gain).sort((a, b) => a - b);
		out.push({ id: `${name}/${piece.id}`, median: sorted[sorted.length >> 1] ?? 0, max: sorted.at(-1) ?? 0, spread: Math.max(...measured.map((item) => item.spread)), isLong: (next.step - step) / 240 > 1.2 && (piece.params['turns'] ?? 1) > 1 });
	}
	return out;
}

describe('a rail as one surface', () => {
	let simulator: TSimulator;

	beforeAll(async () => {
		simulator = await createSimulator();
	});

	it('keeps a change in how the marble enters small on the fixtures rails', () => {
		const all = ['jingle-bells', 'long-gap', 'reference-20'].flatMap((name) => gains(simulator, name));
		for (const gain of all) console.log(`${gain.id}: median ${gain.median.toPrecision(3)}, max ${gain.max.toPrecision(3)}, ${(gain.spread * 100).toPrecision(2)} cm`);
		const short = all.filter((gain) => !gain.isLong);
		const long = all.filter((gain) => gain.isLong);
		expect(short.length).toBeGreaterThan(3);
		expect(long.length).toBeGreaterThan(0);
		// Rolling rails stay calm; a marble that drops through a long Switchback's turns stays the one chaotic case, which is why those keep stored rides
		for (const gain of short) expect(gain.median, gain.id).toBeLessThan(40);
		for (const gain of short) expect(gain.spread, gain.id).toBeLessThan(0.05);
		for (const gain of long) expect(gain.spread, gain.id).toBeLessThan(0.1);
	});
});
