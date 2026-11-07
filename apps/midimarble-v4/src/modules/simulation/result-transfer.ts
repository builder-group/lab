import type { TMarbleSample, TSimulationResult } from './types';

// A simulation result crosses from the worker with each marble's samples packed into one Float64Array, which is
// transferred instead of copied. Structured cloning a whole song's samples as objects took about 14 ms per
// result in Chrome, as much as the run itself for a short what-if.

const FIELDS = 6;

/** A result whose marbles carry their samples packed as time, x, y, angle, velocity x and y */
export interface TPackedResult {
	isPacked: true;
	result: Omit<TSimulationResult, 'marbles'> & {
		marbles: (Omit<TSimulationResult['marbles'][number], 'samples'> & { samples: Float64Array })[];
	};
}

export function packResult(result: TSimulationResult): { packed: TPackedResult; transfer: ArrayBuffer[] } {
	const transfer: ArrayBuffer[] = [];
	const marbles = result.marbles.map((marble) => {
		const samples = new Float64Array(marble.samples.length * FIELDS);
		marble.samples.forEach((sample, index) => {
			const at = index * FIELDS;
			samples[at] = sample.time;
			samples[at + 1] = sample.position.x;
			samples[at + 2] = sample.position.y;
			samples[at + 3] = sample.angle;
			samples[at + 4] = sample.velocity.x;
			samples[at + 5] = sample.velocity.y;
		});
		transfer.push(samples.buffer);
		return { ...marble, samples };
	});
	return { packed: { isPacked: true, result: { ...result, marbles } }, transfer };
}

export function isPackedResult(value: unknown): value is TPackedResult {
	return typeof value === 'object' && value != null && (value as { isPacked?: unknown }).isPacked === true;
}

export function unpackResult(packed: TPackedResult): TSimulationResult {
	return {
		...packed.result,
		marbles: packed.result.marbles.map((marble) => {
			const samples: TMarbleSample[] = [];
			const values = marble.samples;
			for (let at = 0; at + FIELDS <= values.length; at += FIELDS) {
				samples.push({
					time: values[at] ?? 0,
					position: { x: values[at + 1] ?? 0, y: values[at + 2] ?? 0 },
					angle: values[at + 3] ?? 0,
					velocity: { x: values[at + 4] ?? 0, y: values[at + 5] ?? 0 }
				});
			}
			return { ...marble, samples };
		})
	};
}
