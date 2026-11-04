import { describe, expect, it } from 'vitest';
import { createProject, type TProject } from '@/modules/project';
import type { THitResult, TSimulationResult } from '@/modules/simulation/types';
import { buildSceneDescription, encodeRecords, lastStruckTime, MOTION_FOLDER } from './scene-builder';

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
			hitLink: { laneId: lane.id, hitId: 'hit-1', angle: 0.3, contactAt: 0.5 }
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

function firstPiece(result: TSimulationResult): TSimulationResult['pieces'][number] {
	const piece = result.pieces[0];
	if (piece == null) throw new Error('Missing piece');
	return structuredClone(piece);
}

function decode(bytes: Uint8Array): number[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return Array.from({ length: bytes.byteLength / 4 }, (_, index) => view.getFloat32(index * 4, true));
}

describe('buildSceneDescription', () => {
	it.each(['marble:glass', 'marble:metal', 'marble:magic'])("carries a marble's built-in skin %s, without an asset", (assetId) => {
		const { project, result, marbleId } = fixture();
		const marble = project.entities.find((entity) => entity.id === marbleId);
		if (marble != null) marble.components.skin = { assetId };
		const [described] = buildSceneDescription(project, result, { fps: 30 }).description.marbles;
		expect(described?.skin?.assetId).toBe(assetId);
		expect(described?.assetPath).toBeUndefined();
	});

	it("carries the asset of a marble's library skin", () => {
		const { project, result, marbleId } = fixture();
		const marble = project.entities.find((entity) => entity.id === marbleId);
		if (marble != null) marble.components.skin = { assetId: 'green-glass' };
		expect(buildSceneDescription(project, result, { fps: 30 }).description.marbles[0]?.assetPath).toBe('assets/green-glass/asset.blend');
	});

	it('carries the camera sway', () => {
		const { project, result } = fixture();
		expect(buildSceneDescription(project, result, { fps: 30 }).description.camera?.sway).toBe(1);
		project.design.camera.sway = 0;
		expect(buildSceneDescription(project, result, { fps: 30 }).description.camera?.sway).toBe(0);
	});

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

	it('collects merged contact starts per piece and marks music pieces', () => {
		const { project, result, marbleId } = fixture();
		const contact = (time: number, otherEntityId: string, kind: 'piece' | 'marble' = 'piece') => ({
			time,
			marbleEntityId: marbleId,
			otherEntityId,
			kind,
			position: { x: 0, y: 0 }
		});
		result.contacts = [
			contact(1.19, 'piece-1'),
			contact(0.501, 'piece-1'),
			contact(0.55, 'piece-1'),
			contact(0.7, 'piece-1'),
			contact(0.9, 'piece-1', 'marble'),
			contact(0.3, 'rail-1')
		];
		result.pieces.push({ ...firstPiece(result), entityId: 'rail-1', type: 'rail', hitTime: null });
		const { description } = buildSceneDescription(project, result, { fps: 60 });
		const [platform, rail] = description.pieces;
		expect(platform?.contactTimes).toEqual([0.501, 0.7, 1.19]);
		expect(platform?.musical).toBe(true);
		expect(rail?.contactTimes).toEqual([0.3]);
		expect(rail?.hitTimes).toEqual([]);
		expect(rail?.musical).toBe(false);
	});

	it('uses the resolved pose of a free piece, not its transform', () => {
		const { project, result } = fixture();
		project.entities.push({
			id: 'rail-1',
			name: 'Rail 1',
			components: {
				piece: { type: 'rail', params: {} },
				transform: { position: { x: 0.4, y: 0.4 }, angle: 0.5 }
			}
		});
		const path = [
			{ x: 0.1, y: 0.3 },
			{ x: 0.2, y: 0.25 }
		];
		result.pieces.push({
			...firstPiece(result),
			entityId: 'rail-1',
			type: 'rail',
			position: { x: 0.1, y: 0.3 },
			angle: 0,
			hitTime: null,
			status: 'free',
			path
		});
		const { description } = buildSceneDescription(project, result, { fps: 60 });
		const rail = description.pieces.find((piece) => piece.id === 'rail-1');
		expect(rail?.position).toEqual({ x: 0.1, y: 0.3 });
		expect(rail?.angle).toBe(0);
		expect(rail?.path).toEqual(path);
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

describe('buildSceneDescription with moving and path pieces', () => {
	it('writes windmill motion as [time, angle] records', () => {
		const { project, result } = fixture();
		result.pieces.push({
			entityId: 'windmill-1',
			type: 'windmill',
			position: { x: 0, y: 0.1 },
			angle: 0,
			params: { bladeCount: 4 },
			contactPoint: null,
			contactNormal: null,
			hitTime: null,
			status: 'placed',
			motion: [
				{ time: 0, angle: 0 },
				{ time: 0.5, angle: 1.25 }
			]
		});
		const { description, motionFiles } = buildSceneDescription(project, result, { fps: 60 });
		const windmill = description.pieces.find((piece) => piece.id === 'windmill-1');
		expect(windmill?.motionPath).toBe(`${MOTION_FOLDER}/windmill-1.bin`);
		expect(windmill?.sampleCount).toBe(2);
		const file = motionFiles.find((entry) => entry.path === windmill?.motionPath);
		expect(decode(file?.bytes ?? new Uint8Array())).toEqual([0, 0, 0.5, 1.25]);
	});

	it('passes the resolved rail path in wall coordinates', () => {
		const { project, result } = fixture();
		const path = [
			{ x: 0, y: 0.1 },
			{ x: 0.15, y: 0.088 }
		];
		result.pieces.push({
			entityId: 'rail-1',
			type: 'rail',
			position: { x: 0, y: 0.1 },
			angle: 0,
			params: { radius: 0.0025, gap: 0.01 },
			contactPoint: null,
			contactNormal: null,
			hitTime: null,
			status: 'placed',
			path
		});
		const { description } = buildSceneDescription(project, result, { fps: 60 });
		expect(description.pieces.find((piece) => piece.id === 'rail-1')?.path).toEqual(path);
		expect(description.pieces[0]?.path).toBeNull();
	});

	it('passes the wires of a switchback in wall coordinates', () => {
		const { project, result } = fixture();
		const paths = [
			[
				{ x: 0, y: 0.1 },
				{ x: 0, y: 0 }
			],
			[
				{ x: 0.1, y: 0.1 },
				{ x: 0.1, y: 0 }
			],
			[
				{ x: 0, y: 0.08 },
				{ x: 0.07, y: 0.06 }
			]
		];
		result.pieces.push({
			entityId: 'switchback-1',
			type: 'switchback',
			position: { x: 0.05, y: 0.1 },
			angle: -0.3,
			params: { width: 0.1, legs: 1, radius: 0.0025 },
			contactPoint: null,
			contactNormal: null,
			hitTime: null,
			status: 'placed',
			paths
		});
		const { description } = buildSceneDescription(project, result, { fps: 60 });
		expect(description.pieces.find((piece) => piece.id === 'switchback-1')?.paths).toEqual(paths);
		expect(description.pieces[0]?.paths).toBeNull();
	});

	it('passes the design camera rig settings', () => {
		const { project, result } = fixture();
		project.design.camera.shots.push({ id: 'shot-1', time: 1, kind: 'pushIn', distance: 0.4 });
		const { description } = buildSceneDescription(project, result, { fps: 60 });
		expect(description.camera).toEqual({
			mode: project.design.camera.mode,
			distance: project.design.camera.distance,
			pitch: project.design.camera.pitch,
			lead: project.design.camera.lead,
			sway: 1,
			smoothing: project.design.camera.smoothing,
			// A Push In without a length of its own holds 2 s before the camera eases back
			shots: [{ time: 1, kind: 'pushIn', distance: 0.4, length: 2 }],
			focusMarbleId: null,
			descent: null,
			holdAfter: lastStruckTime(result),
			holdFinish: null
		});
	});

	it('holds the camera on the last struck hit', () => {
		const { project, result } = fixture();
		const struck = result.hits.flatMap((hit) => (hit.actualTime != null ? [hit.actualTime] : []));
		const { description } = buildSceneDescription(project, result, { fps: 60 });
		expect(description.camera?.holdAfter).toBe(struck.length ? Math.round(Math.max(...struck) * 1e4) / 1e4 : null);
	});

	it('passes the focus marble and a shared descent curve when the result has one', () => {
		const { project, result } = fixture();
		project.design.camera.focusMarbleId = 'marble-2';
		const descent = [
			{ time: 0, y: 0.5 },
			{ time: 1, y: 0.2 },
			{ time: 2, y: Number.NaN }
		];
		const { description } = buildSceneDescription(project, { ...result, descent } as typeof result, { fps: 60 });
		expect(description.camera?.focusMarbleId).toBe('marble-2');
		expect(description.camera?.descent).toEqual([
			{ time: 0, y: 0.5 },
			{ time: 1, y: 0.2 }
		]);
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

describe('buildSceneDescription for scenery', () => {
	it('gives the windmill fixture contact times and no hit times', async () => {
		const { readFileSync } = await import('node:fs');
		const { parseProject } = await import('@/modules/project');
		const { createSimulator } = await import('@/modules/simulation/simulate');
		const json = readFileSync(new URL('../../../fixtures/windmill.marble.json', import.meta.url), 'utf8');
		const [isProjectOk, projectErr, project] = parseProject(json);
		if (!isProjectOk) throw projectErr;
		const simulator = await createSimulator();
		const result = simulator.simulate(project);
		simulator.dispose();

		const { description } = buildSceneDescription(project, result, { fps: 30 });

		const windmill = description.pieces.find((piece) => piece.type === 'windmill');
		expect(windmill?.musical).toBe(false);
		expect(windmill?.hitTimes).toEqual([]);
		expect(windmill?.contactTimes?.length).toBeGreaterThan(0);
		const platforms = description.pieces.filter((piece) => piece.type === 'platform');
		expect(platforms.every((piece) => piece.musical === true)).toBe(true);
		expect(platforms.some((piece) => piece.hitTimes.length > 0)).toBe(true);
	});
});
