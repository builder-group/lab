import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseProject, type TProject } from '@/modules/project';
import { createSimulator, type TSimulationResult } from '@/modules/simulation';
import { buildAgentBrief } from './agent-brief';

function loadFixture(name: string): TProject {
	const json = readFileSync(
		new URL(`../../../fixtures/${name}.marble.json`, import.meta.url),
		'utf8'
	);
	const [isProjectOk, projectErr, project] = parseProject(json);
	if (!isProjectOk) throw projectErr;
	return project;
}

let zigzag: TProject;
let result: TSimulationResult;

beforeAll(async () => {
	zigzag = loadFixture('zigzag');
	const simulator = await createSimulator();
	result = simulator.simulate(zigzag);
	simulator.dispose();
});

describe('buildAgentBrief function', () => {
	it('should describe a zigzag platform with its parameters, contact normal and hit time', () => {
		const platform = zigzag.entities.find((entity) => entity.components.piece?.type === 'platform');
		if (platform == null) throw new Error('The zigzag fixture has no platform');

		const brief = buildAgentBrief({
			project: zigzag,
			result,
			target: { kind: 'piece', entityId: platform.id },
			request: '  a simple brushed brass bar with a small chrome end cap '
		});

		expect(brief.request).toBe('a simple brushed brass bar with a small chrome end cap');
		expect(brief.target).toMatchObject({
			kind: 'piece',
			entityId: platform.id,
			role: 'skin',
			pieceType: 'platform',
			pieceLabel: 'Platform',
			pieceCount: 16
		});
		expect(brief.params.map((param) => param.name)).toEqual(['length', 'thickness', 'depth']);
		expect(brief.params.every((param) => param.unit === 'm' && param.value > 0)).toBe(true);

		const pose = result.pieces.find((piece) => piece.entityId === platform.id);
		const hit = result.hits.find((item) => item.pieceEntityId === platform.id);
		expect(brief.contact?.normal?.x).toBeCloseTo(pose?.contactNormal?.x ?? NaN, 4);
		expect(brief.contact?.normal?.y).toBeCloseTo(pose?.contactNormal?.y ?? NaN, 4);
		expect(brief.contact?.description).toContain('top face');
		expect(brief.hitTimes).toHaveLength(1);
		expect(brief.hitTimes[0]).toBeCloseTo(hit?.actualTime ?? NaN, 4);
		expect(brief.reactionSlots.map((slot) => slot.name)).toEqual(['press', 'glow']);
		expect(brief.scale.marbleRadius).toBeGreaterThan(0);
	});

	it('should brief a wall decoration at the picked point without reaction slots', () => {
		const brief = buildAgentBrief({
			project: zigzag,
			result,
			target: { kind: 'wall', point: { x: 0.1234567, y: -0.2 } },
			request: 'a small brass plaque'
		});

		expect(brief.target).toEqual({ kind: 'wall', role: 'decoration' });
		expect(brief.wallPoint).toEqual({ x: 0.12346, y: -0.2 });
		expect(brief.reactionSlots).toEqual([]);
		expect(brief.hitTimes).toEqual([]);
	});

	it('should still brief a piece target without a simulation result', () => {
		const platform = zigzag.entities.find((entity) => entity.components.piece != null);

		const brief = buildAgentBrief({
			project: zigzag,
			result: null,
			target: { kind: 'piece', entityId: platform?.id ?? '' },
			request: 'a piano key'
		});

		expect(brief.hitTimes).toEqual([]);
		expect(brief.contact?.normal).toBeUndefined();
		expect(brief.params.length).toBeGreaterThan(0);
	});
});
