import { describe, expect, it } from 'vitest';
import { createProject, type TProject } from '@/modules/project';
import type { THitResult, TSimulationResult } from '@/modules/simulation/types';
import { buildSceneDescription, encodeRecords, MOTION_FOLDER } from './scene-builder';

function fixture(): { project: TProject; result: TSimulationResult; marbleId: string; laneId: string } {
	const project = createProject({ title: 'Song', id: 'project-1' });
	const lane = project.music.lanes[0];
	const marble = project.entities[0];
	if (lane == null || marble == null) throw new Error('Missing default lane or marble');
	project.entities.push({
		id: 'piece-1',
		name: 'Platform 1',
		components: {
			piece: { type: 'platform', params: { length: 0.08 } },
			transform: { position: { x: 0.1, y: 0.2 }, angle: 0.3 },
			hitLink: { laneId: lane.id, hitId: 'hit-1', angle: 0.3, contactAt: 0.5, pinned: false }
		}
	});
	const hit = (overrides: Partial<THitResult>): THitResult => ({
		laneId: lane.id,
		hitId: 'hit-1',
		targetTime: 0.5,
		pieceEntityId: 'piece-1',
		dot: null,
		velocity: null,
		actualTime: 0.501,
		error: 0.001,
		status: 'onTime',
		...overrides
	});
	const result: TSimulationResult = {
		revision: project.revision,
		duration: 2,
		marbles: [
			{
				entityId: marble.id,
				laneId: lane.id,
				radius: 0.008,
				samples: [0, 1, 2].map((index) => ({
					time: 0.1 + index / 240,
					position: { x: 0.01 * index, y: 0.6 - 0.001 * index * index },
					angle: -0.5 * index,
					velocity: { x: 0, y: 0 }
				}))
			}
		],
		pieces: [
			{
				entityId: 'piece-1',
				type: 'platform',
				position: { x: 0.1, y: 0.2 },
				angle: 0.3,
				params: { length: 0.08, thickness: 0.008, depth: 0.03 },
				contactPoint: null,
				contactNormal: null,
				hitTime: 0.5,
				status: 'placed'
			}
		],
		contacts: [],
		hits: [
			hit({ hitId: 'hit-2', targetTime: 1.2, actualTime: 1.19 }),
			hit({}),
			hit({ hitId: 'hit-3', actualTime: null, status: 'missed' }),
			hit({ hitId: 'hit-4', pieceEntityId: null, actualTime: 0.7, status: 'open' })
		],
		stats: { computeMs: 1, reusedUntil: 0, steps: 480 }
	};
	return { project, result, marbleId: marble.id, laneId: lane.id };
}

function decode(bytes: Uint8Array): number[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return Array.from({ length: bytes.byteLength / 4 }, (_, index) => view.getFloat32(index * 4, true));
}

describe('buildSceneDescription', () => {
	it('writes one [time, x, y, angle] record per marble sample', () => {
		const { project, result, marbleId } = fixture();
		const { description, motionFiles } = buildSceneDescription(project, result, { fps: 60 });
		const marble = description.marbles[0];
		expect(marble?.motionPath).toBe(`${MOTION_FOLDER}/${marbleId}.bin`);
		expect(marble?.sampleCount).toBe(3);
		expect(motionFiles).toHaveLength(1);
		const file = motionFiles[0];
		expect(file?.path).toBe(marble?.motionPath);
		expect(file?.bytes.byteLength).toBe(3 * 4 * 4);
		const values = decode(file?.bytes ?? new Uint8Array());
		const expected = result.marbles[0]?.samples.flatMap((sample) => [
			sample.time,
			sample.position.x,
			sample.position.y,
			sample.angle
		]);
		expected?.forEach((value, index) => expect(values[index]).toBeCloseTo(value, 6));
	});

	it('passes wall coordinates and angles through unchanged', () => {
		const { project, result } = fixture();
		const { description } = buildSceneDescription(project, result, { fps: 60 });
		const piece = description.pieces[0];
		expect(piece?.position).toEqual({ x: 0.1, y: 0.2 });
		expect(piece?.angle).toBe(0.3);
		expect(piece?.params).toEqual({ length: 0.08, thickness: 0.008, depth: 0.03 });
		expect(piece?.wallOffset).toBe(0);
		expect(piece?.name).toBe('Platform 1');
		expect(piece?.motionPath).toBeNull();
		expect(description.marbles[0]?.radius).toBe(0.008);
	});

	it('collects sorted actual hit times of the linked piece only', () => {
		const { project, result } = fixture();
		const { description } = buildSceneDescription(project, result, { fps: 60 });
		expect(description.pieces[0]?.hitTimes).toEqual([0.501, 1.19]);
	});

	it('carries project metadata and lane colors', () => {
		const { project, result, laneId } = fixture();
		const { description } = buildSceneDescription(project, result, { fps: 30 });
		expect(description).toMatchObject({
			version: 1,
			projectId: 'project-1',
			revision: project.revision,
			fps: 30,
			duration: 2,
			frame: { width: 9, height: 16 },
			theme: 'pegboard'
		});
		const laneColor = project.music.lanes.find((lane) => lane.id === laneId)?.color;
		expect(description.pieces[0]?.color).toBe(laneColor);
	});
});

describe('encodeRecords', () => {
	it('packs little-endian Float32 values', () => {
		const bytes = encodeRecords([
			[1, 2],
			[3, -0.5]
		]);
		expect(Array.from(bytes.slice(0, 4))).toEqual([0, 0, 128, 63]);
		expect(decode(bytes)).toEqual([1, 2, 3, -0.5]);
	});
});
