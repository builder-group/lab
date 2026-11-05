import { describe, expect, it } from 'vitest';
import { applyProjectCommands } from './commands';
import { createProject, marbleFilmColor } from './create-project';
import { createHistory, pushHistory, redoHistory, undoHistory } from './history';
import { parseProject, serializeProject } from './project-file';
import { BACKING_ID, type TProject } from './schema';

function firstMarbleId(project: TProject): string {
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
		for (const renderPreset of ['draft', 'final'] as const) {
			const [isParsedOk, , parsed] = parseProject(serializeProject({ ...project, design: { ...project.design, renderPreset } }));
			expect(isParsedOk).toBe(true);
			expect(parsed?.design.renderPreset).toBe(renderPreset);
		}
	});

	it('should reject a removed design field', () => {
		const project = createProject();
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
		const marbleId = firstMarbleId(project);
		const [isEditOk, editErr, edited] = applyProjectCommands(project, [
			{ type: 'upsertHits', marbleId, hits: [{ id: 'a', time: 1 }, { id: 'b', time: 2, duration: 0.25 }] },
			{ type: 'upsertHits', marbleId: BACKING_ID, hits: [{ id: 'c', time: 1.5 }] },
			{ type: 'assignHits', hitIds: ['b'], marbleId: BACKING_ID }
		]);
		if (!isEditOk) throw editErr;
		expect(edited.music.lanes[0]?.hits.map((hit) => hit.id)).toEqual(['a']);
		expect(edited.music.backing).toEqual([{ id: 'c', time: 1.5 }, { id: 'b', time: 2, duration: 0.25 }]);

		const [isBackOk, backErr, back] = applyProjectCommands(edited, [{ type: 'assignHits', hitIds: ['c', 'b', 'a'], marbleId }]);
		if (!isBackOk) throw backErr;
		expect(back.music.lanes[0]?.hits.map((hit) => hit.id)).toEqual(['a', 'c', 'b']);
		expect(back.music.backing).toEqual([]);
	});

	it('should refuse to assign a hit that does not exist', () => {
		const project = createProject();
		const [isEditOk] = applyProjectCommands(project, [{ type: 'assignHits', hitIds: ['missing'], marbleId: BACKING_ID }]);
		expect(isEditOk).toBe(false);
	});

	it('applies a batch as one revision and keeps hits sorted', () => {
		const project = createProject();
		const marbleId = firstMarbleId(project);
		const [isEditOk, editErr, edited] = applyProjectCommands(project, [
			{ type: 'upsertHits', marbleId, hits: [{ id: 'b', time: 2 }] },
			{ type: 'upsertHits', marbleId, hits: [{ id: 'a', time: 1 }] },
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
			{ type: 'upsertHits', marbleId: 'missing', hits: [] }
		]);
		expect(isEditOk).toBe(false);
		expect(project.title).toBe('Untitled');

		const [isNegativeOk] = applyProjectCommands(project, [
			{ type: 'upsertHits', marbleId: firstMarbleId(project), hits: [{ id: 'x', time: -1 }] }
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
			{ type: 'removeLane', marbleId: firstMarbleId(project) }
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
});

describe('older files', () => {
	it('should refuse them in plain words', () => {
		const project = createProject();
		const [isParsedOk, parsedErr] = parseProject(JSON.stringify({ ...project, $schema: 'marble-project@4' }));
		expect(isParsedOk).toBe(false);
		expect(parsedErr?.message).toBe("This project was made with a different version of MidiMarble and can't be opened.");
	});

	it('should say the same of a file of this version with another shape', () => {
		const stored = JSON.parse(serializeProject(createProject())) as { entities: { components: { marble?: { color?: string } } }[] };
		const marble = stored.entities.find((entity) => entity.components.marble != null)?.components.marble;
		if (marble != null) marble.color = '#778899';
		const [isParsedOk, parsedErr] = parseProject(JSON.stringify(stored));
		expect(isParsedOk).toBe(false);
		expect(parsedErr?.message).toBe("This project was made with a different version of MidiMarble and can't be opened.");
	});

	it('should say the same of a file with no version', () => {
		const [isParsedOk, parsedErr] = parseProject('{ "title": "Mine" }');
		expect(isParsedOk).toBe(false);
		expect(parsedErr?.message).toBe("This project was made with a different version of MidiMarble and can't be opened.");
	});
});

describe('label color and film color', () => {
	it('should keep a lane\'s label color out of the film', () => {
		const project = createProject({ id: 'p', title: 'T' });
		const lane = project.music.lanes[0] as TProject['music']['lanes'][number];
		const film = marbleFilmColor(project, lane.id);
		const [, , next] = applyProjectCommands(project, [{ type: 'upsertLane', lane: { ...lane, color: '#112233' } }]);
		expect(next?.music.lanes[0]?.color).toBe('#112233');
		expect(marbleFilmColor(next as TProject, lane.id)).toBe(film);
	});

	it('should read a marble\'s film color from its skin', () => {
		const project = createProject({ id: 'p', title: 'T' });
		const lane = project.music.lanes[0] as TProject['music']['lanes'][number];
		const marble = project.entities.find((entity) => entity.components.marble != null) as TProject['entities'][number];
		const [, , next] = applyProjectCommands(project, [{ type: 'setComponent', entityId: marble.id, component: { name: 'skin', value: { color: '#445566' } } }]);
		expect(marbleFilmColor(next as TProject, lane.id)).toBe('#445566');
		expect(next?.music.lanes[0]?.color).toBe(lane.color);
	});
});
