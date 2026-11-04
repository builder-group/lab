import { describe, expect, it } from 'vitest';
import { applyProjectCommands } from './commands';
import { createProject } from './create-project';
import { changedEntityIds, createHistory, pushHistory, redoHistory, undoHistory } from './history';
import { parseProject, serializeProject } from './project-file';
import { BACKING_ID, type TProject } from './schema';

function firstLaneId(project: TProject): string {
	const lane = project.music.lanes[0];
	if (lane == null) throw new Error('Missing lane');
	return lane.id;
}

describe('project document', () => {
	it('round-trips through JSON', () => {
		const project = createProject({ title: 'Song' });
		const [isParsedOk, parsedErr, parsed] = parseProject(serializeProject(project));
		expect(parsedErr).toBeUndefined();
		expect(isParsedOk).toBe(true);
		expect(parsed).toEqual(project);
	});

	it('accepts the draft render preset alongside the earlier presets', () => {
		const project = createProject();
		for (const renderPreset of ['draft', 'fast', 'balanced', 'best'] as const) {
			const [isParsedOk, , parsed] = parseProject(serializeProject({ ...project, design: { ...project.design, renderPreset } }));
			expect(isParsedOk).toBe(true);
			expect(parsed?.design.renderPreset).toBe(renderPreset);
		}
	});

	it('should move old theme options into the theme on load and reject unknown ones', () => {
		const project = createProject();
		const withOptions = { ...project, design: { ...project.design, themeOptions: { colorByNote: true } } };
		expect(parseProject(serializeProject(withOptions))[2]?.design.themeOptions).toBeUndefined();
		expect(parseProject(JSON.stringify({ ...project, design: { ...project.design, themeOptions: { glow: 1 } } }))[0]).toBe(false);
	});

	it('should round-trip project themes and reject malformed ones', () => {
		const project = createProject();
		const themes = [
			{ id: 'theme-1', name: 'Neon Copy', base: 'neon', overrides: { wallColor: '#336699', glowColor: '#00ff88' } },
			{ id: 'theme-2', name: 'Sunset', base: 'brass', overrides: {}, origin: 'agent' as const }
		];
		const withThemes = { ...project, design: { ...project.design, theme: 'theme-1', themes } };
		const [isParsedOk, parsedErr, parsed] = parseProject(serializeProject(withThemes));
		expect(isParsedOk, parsedErr?.message).toBe(true);
		expect(parsed?.design.themes).toEqual(themes);
		expect(parsed?.design.theme).toBe('theme-1');
		// Files from before project themes stay valid
		expect(parseProject(serializeProject(project))[2]?.design.themes).toBeUndefined();
		const badColor = { ...project, design: { ...project.design, themes: [{ ...themes[0], overrides: { wallColor: 'blue' } }] } };
		expect(parseProject(JSON.stringify(badColor))[0]).toBe(false);
		const unknownField = { ...project, design: { ...project.design, themes: [{ ...themes[0], overrides: { fog: '#ffffff' } }] } };
		expect(parseProject(JSON.stringify(unknownField))[0]).toBe(false);
	});

	it('rejects unknown versions and malformed files', () => {
		const project = createProject();
		expect(parseProject(JSON.stringify({ ...project, $schema: 'marble-project@99' }))[0]).toBe(false);
		expect(parseProject('{nope')[0]).toBe(false);
		expect(parseProject(JSON.stringify({ ...project, extra: true }))[0]).toBe(false);
	});
});

describe('commands', () => {
	it('should hand hits to Backing and back, keeping their IDs and order', () => {
		const project = createProject();
		const laneId = firstLaneId(project);
		const [isEditOk, editErr, edited] = applyProjectCommands(project, [
			{ type: 'upsertHits', laneId, hits: [{ id: 'a', time: 1 }, { id: 'b', time: 2, duration: 0.25 }] },
			{ type: 'upsertHits', laneId: BACKING_ID, hits: [{ id: 'c', time: 1.5 }] },
			{ type: 'assignHits', hitIds: ['b'], laneId: BACKING_ID }
		]);
		if (!isEditOk) throw editErr;
		expect(edited.music.lanes[0]?.hits.map((hit) => hit.id)).toEqual(['a']);
		expect(edited.music.backing).toEqual([{ id: 'c', time: 1.5 }, { id: 'b', time: 2, duration: 0.25 }]);

		const [isBackOk, backErr, back] = applyProjectCommands(edited, [{ type: 'assignHits', hitIds: ['c', 'b', 'a'], laneId }]);
		if (!isBackOk) throw backErr;
		expect(back.music.lanes[0]?.hits.map((hit) => hit.id)).toEqual(['a', 'c', 'b']);
		expect(back.music.backing).toEqual([]);
	});

	it('should refuse to assign a hit that does not exist', () => {
		const project = createProject();
		const [isEditOk] = applyProjectCommands(project, [{ type: 'assignHits', hitIds: ['missing'], laneId: BACKING_ID }]);
		expect(isEditOk).toBe(false);
	});

	it('applies a batch as one revision and keeps hits sorted', () => {
		const project = createProject();
		const laneId = firstLaneId(project);
		const [isEditOk, editErr, edited] = applyProjectCommands(project, [
			{ type: 'upsertHits', laneId, hits: [{ id: 'b', time: 2 }] },
			{ type: 'upsertHits', laneId, hits: [{ id: 'a', time: 1 }] },
			{ type: 'setTitle', title: 'Renamed' }
		]);
		expect(editErr).toBeUndefined();
		expect(isEditOk).toBe(true);
		expect(edited?.revision).toBe(project.revision + 1);
		expect(edited?.music.lanes[0]?.hits.map((hit) => hit.id)).toEqual(['a', 'b']);
		expect(project.music.lanes[0]?.hits).toEqual([]);
	});

	it('leaves the source untouched when a batch is invalid', () => {
		const project = createProject();
		const [isEditOk] = applyProjectCommands(project, [
			{ type: 'setTitle', title: 'Changed' },
			{ type: 'upsertHits', laneId: 'missing', hits: [] }
		]);
		expect(isEditOk).toBe(false);
		expect(project.title).toBe('Untitled');

		const [isNegativeOk] = applyProjectCommands(project, [
			{ type: 'upsertHits', laneId: firstLaneId(project), hits: [{ id: 'x', time: -1 }] }
		]);
		expect(isNegativeOk).toBe(false);
	});

	it('sets and removes components', () => {
		const project = createProject();
		const entity = project.entities[0];
		if (entity == null) throw new Error('Missing marble');
		const [, , withPiece] = applyProjectCommands(project, [
			{
				type: 'setComponent',
				entityId: entity.id,
				component: { name: 'transform', value: { position: { x: 1, y: 2 }, angle: 0.1 } }
			}
		]);
		expect(withPiece?.entities[0]?.components.transform?.position.x).toBe(1);
		const [, , without] = applyProjectCommands(withPiece as TProject, [
			{ type: 'removeComponent', entityId: entity.id, name: 'transform' }
		]);
		expect(without?.entities[0]?.components.transform).toBeUndefined();
	});

	it('removes the marble of a removed lane', () => {
		const project = createProject();
		const [, , edited] = applyProjectCommands(project, [
			{ type: 'removeLane', laneId: firstLaneId(project) }
		]);
		expect(edited?.music.lanes).toEqual([]);
		expect(edited?.entities).toEqual([]);
	});
});

describe('history', () => {
	it('undoes and redoes with increasing revisions', () => {
		const project = createProject();
		const [, , renamed] = applyProjectCommands(project, [{ type: 'setTitle', title: 'A' }]);
		let history = pushHistory(createHistory(project), renamed as TProject);
		history = undoHistory(history);
		expect(history.present.title).toBe('Untitled');
		expect(history.present.revision).toBe(2);
		history = redoHistory(history);
		expect(history.present.title).toBe('A');
		expect(history.present.revision).toBe(3);
	});

	it('names the entities an undo changed or brought back', () => {
		const project = createProject();
		const piece = { id: 'piece-a', name: 'A', components: { transform: { position: { x: 0, y: 0 }, angle: 0 } } };
		const [, , withPiece] = applyProjectCommands(project, [{ type: 'upsertEntity', entity: piece }]);
		const [, , moved] = applyProjectCommands(withPiece as TProject, [
			{ type: 'upsertEntity', entity: { ...piece, components: { transform: { position: { x: 1, y: 0 }, angle: 0 } } } }
		]);

		expect(changedEntityIds(moved as TProject, withPiece as TProject)).toEqual(['piece-a']);
		expect(changedEntityIds(withPiece as TProject, project)).toEqual([]);
		expect(changedEntityIds(project, withPiece as TProject)).toEqual(['piece-a']);
	});
});

/** The project as version 3 stored it, before Backing */
function asVersion3(project: TProject): Record<string, unknown> {
	const { backing: _backing, backingInstrument: _instrument, ...music } = project.music;
	return { ...project, $schema: 'marble-project@3', music };
}

describe('migrations', () => {
	it('should give version 3 projects an empty Backing and keep everything else', () => {
		const project = createProject();
		const [isParsedOk, parsedErr, parsed] = parseProject(JSON.stringify(asVersion3(project)));
		expect(parsedErr).toBeUndefined();
		expect(isParsedOk).toBe(true);
		expect(parsed).toEqual(project);
	});

	it('should reject note lengths in version 3 files', () => {
		const project = createProject();
		const lane = project.music.lanes[0];
		if (lane == null) throw new Error('No lane');
		lane.hits = [{ id: 'hit-1', time: 1, duration: 0.5 }];
		expect(parseProject(JSON.stringify(asVersion3(project)))[0]).toBe(false);
	});

	it('gives version 1 pieces their original bounce', () => {
		const project = createProject();
		const piece = {
			id: 'piece-1',
			components: {
				piece: { type: 'platform', params: { length: 0.06 } },
				hitLink: { laneId: firstLaneId(project), hitId: 'hit-1', angle: 0, contactAt: 0.5, pinned: false }
			}
		};
		const { physics: _physics, ...older } = asVersion3(project);
		const legacy = { ...older, $schema: 'marble-project@1', entities: [...project.entities, piece] };
		const [isParsedOk, parsedErr, parsed] = parseProject(JSON.stringify(legacy));
		expect(parsedErr).toBeUndefined();
		expect(isParsedOk).toBe(true);
		expect(parsed?.$schema).toBe('marble-project@4');
		expect(parsed?.entities.find((entity) => entity.id === 'piece-1')?.components.piece?.params['bounce']).toBe(0.55);
	});

	it('turns version 2 windmills and rails on hits into scenery anchored at the same moment', () => {
		const project = createProject();
		const laneId = firstLaneId(project);
		const lane = project.music.lanes[0];
		if (lane == null) throw new Error('No lane');
		lane.hits = [
			{ id: 'hit-1', time: 0.5 },
			{ id: 'hit-2', time: 0.8 },
			{ id: 'hit-3', time: 3.5 }
		];
		const linked = (id: string, type: string, hitId: string, params: Record<string, number>) => ({
			id,
			components: {
				piece: { type, params },
				hitLink: { laneId, hitId, angle: 0.2, contactAt: 0.5, pinned: false }
			}
		});
		const { physics: _physics, ...older } = asVersion3(project);
		const legacy = {
			...older,
			$schema: 'marble-project@2',
			entities: [
				...project.entities,
				linked('windmill-1', 'windmill', 'hit-2', { bladeCount: 4 }),
				linked('first', 'windmill', 'hit-1', {}),
				linked('far', 'rail', 'hit-3', { radius: 0.003 }),
				linked('follower', 'rail', 'hit-1', { entryDelay: 0.2 }),
				linked('platform', 'platform', 'hit-2', { length: 0.09 })
			]
		};
		const [isParsedOk, parsedErr, parsed] = parseProject(JSON.stringify(legacy));
		expect(parsedErr).toBeUndefined();
		expect(isParsedOk).toBe(true);
		expect(parsed?.$schema).toBe('marble-project@4');
		// Older runs keep Earth gravity
		expect(parsed?.physics).toEqual({ gravityScale: 1 });
		const find = (id: string) => parsed?.entities.find((entity) => entity.id === id)?.components;
		// Anchored to the previous hit with the gap as its delay: the same moment, and hit 2 is left open
		expect(find('windmill-1')?.hitLink?.hitId).toBe('hit-1');
		expect(find('windmill-1')?.piece?.params['entryDelay']).toBeCloseTo(0.3, 9);
		expect(find('windmill-1')?.piece?.params['bladeCount']).toBe(4);
		// Without an earlier hit, or one within 2 s, the anchor stays at its own hit's time
		expect(find('first')?.hitLink?.hitId).toBe('hit-1');
		expect(find('first')?.piece?.params['entryDelay']).toBe(0);
		expect(find('far')?.hitLink?.hitId).toBe('hit-3');
		// Followers and platforms are unchanged
		expect(find('follower')?.hitLink?.hitId).toBe('hit-1');
		expect(find('follower')?.piece?.params['entryDelay']).toBe(0.2);
		expect(find('platform')?.hitLink?.hitId).toBe('hit-2');
		expect(find('platform')?.piece?.params['entryDelay']).toBeUndefined();
	});
});
