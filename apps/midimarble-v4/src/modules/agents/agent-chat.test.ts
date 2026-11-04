import { describe, expect, it } from 'vitest';
import {
	agentChatPrompt,
	agentChatTurns,
	composeAgentRequest,
	describeMention,
	filterMentions,
	findMentionQuery,
	focusFromPrompt,
	mentionOptions,
	mentionTarget,
	removeMentionQuery,
	requestFromPrompt,
	SCENE_MENTION,
	selectionMentions,
	splitMentions,
	type TAgentMention
} from './agent-chat';
import type { TAgentRun } from './AgentCx';
import { createProject, type TEntity, type TLane, type TProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';

const platform1: TAgentMention = { id: 'p1', kind: 'piece', label: 'Platform 1' };
const platform2: TAgentMention = { id: 'p2', kind: 'piece', label: 'Platform 2' };
const melody: TAgentMention = { id: 'm1', kind: 'marble', label: 'Melody' };

describe('agent chat', () => {
	describe('findMentionQuery function', () => {
		it('should find the query after an @ at the caret', () => {
			expect(findMentionQuery('make @Plat', 10)).toEqual({ start: 5, query: 'Plat' });
		});

		it('should allow single spaces inside a layer name', () => {
			expect(findMentionQuery('@Platform 1', 11)).toEqual({ start: 0, query: 'Platform 1' });
		});

		it('should ignore an @ inside a word such as an email address', () => {
			expect(findMentionQuery('mail me@home', 12)).toBeNull();
		});

		it('should close the mention after a double space or a new line', () => {
			expect(findMentionQuery('@Platform  ', 11)).toBeNull();
			expect(findMentionQuery('@Plat\nx', 7)).toBeNull();
		});
	});

	describe('filterMentions function', () => {
		it('should match word starts and skip mentioned layers', () => {
			const options = [SCENE_MENTION, platform1, platform2, melody];
			expect(filterMentions(options, '1').map((option) => option.id)).toEqual(['p1']);
			expect(filterMentions(options, 'plat', ['p2']).map((option) => option.id)).toEqual(['p1']);
			expect(filterMentions(options, '')).toHaveLength(4);
		});
	});

	describe('removeMentionQuery function', () => {
		it('should remove the typed query and place the caret where it began', () => {
			expect(removeMentionQuery('make @Plat wooden', { start: 5, query: 'Plat' })).toEqual({ text: 'make wooden', caret: 5 });
		});
	});

	describe('stored prompts', () => {
		it('should keep the mentions of a request for the bubble', () => {
			const request = composeAgentRequest(' make it wooden ', [platform1, melody]);
			expect(request).toBe('@[Platform 1] @[Melody] make it wooden');
			expect(splitMentions(request)).toEqual([
				{ kind: 'mention', label: 'Platform 1' },
				{ kind: 'mention', label: 'Melody' },
				{ kind: 'text', text: 'make it wooden' }
			]);
		});

		it('should read prompts of runs started before the chat', () => {
			const prompt = 'Make a brass bar\n\nRead BRIEF.md in this folder first and follow its output contract.';
			expect(requestFromPrompt(prompt)).toBe('Make a brass bar');
			expect(focusFromPrompt(prompt)).toBeNull();
			expect(focusFromPrompt(`${prompt} This run makes the candidate for Platform 1.`)).toBe('Platform 1');
		});
	});

	describe('agentChatTurns function', () => {
		it('should give each message a turn, oldest first, with what was written', () => {
			const turns = agentChatTurns([run('b', 'second', 60_000), run('a', '@[Platform 1] wooden', 1_000)]);
			expect(turns.map((turn) => turn.request)).toEqual(['@[Platform 1] wooden', 'second']);
		});
	});

	describe('the selection', () => {
		const lane: TLane = { id: 'lane-1', name: 'Melody', color: '#f00', hits: [{ id: 'h-1', time: 1 }, { id: 'h-2', time: 6.5, pitch: 72 }, { id: 'h-3', time: 8 }] } as TLane;
		const piece: TEntity = { id: 'piece-2', name: 'Platform 2', components: { piece: { type: 'platform', params: {} }, hitLink: { laneId: 'lane-1', hitId: 'h-2', angle: Math.PI / 6 } } } as TEntity;
		const marble: TEntity = { id: 'marble-1', name: 'Marble', components: { marble: { laneId: 'lane-1' } } } as TEntity;
		const base = createProject({ title: 'Song' });
		const project: TProject = { ...base, music: { ...base.music, lanes: [lane] }, entities: [marble, piece] };
		const result = {
			hits: [
				{ laneId: 'lane-1', hitId: 'h-2', targetTime: 6.5, pieceEntityId: 'piece-2', dot: { x: 1, y: 2 }, velocity: null, actualTime: 6.5, error: 0, status: 'onTime' },
				{ laneId: 'lane-1', hitId: 'h-3', targetTime: 8, pieceEntityId: null, dot: { x: 0.25, y: -1 }, velocity: null, actualTime: null, error: null, status: 'open' }
			],
			pieces: [{ entityId: 'piece-2', position: { x: 1.2345, y: -0.5 } }],
			contacts: []
		} as unknown as TSimulationResult;

		it('should turn what is selected into mentions, leaving out what is gone', () => {
			const mentions = selectionMentions(project, ['hit:lane-1:h-2', 'piece-2', 'marble-1', 'wall', 'hit:lane-1:gone', 'nothing']);
			expect(mentions.map((mention) => [mention.kind, mention.label])).toEqual([
				['hit', 'Hit 2 of Melody'],
				['piece', 'Platform 2'],
				['marble', 'Melody'],
				['layer', 'Wall']
			]);
		});

		it('should offer the scene, the marbles and the pieces for @', () => {
			expect(mentionOptions(project).map((option) => option.label)).toEqual(['Scene', 'Melody', 'Platform 2']);
		});

		it('should resolve a played hit with what plays it and every id a tool takes', () => {
			const line = describeMention(project, result, { id: 'hit:lane-1:h-2', kind: 'hit', label: 'Hit 2 of Melody' });
			expect(line).toBe('Hit 2 of Melody at 0:06.50, C5, On Time, hitId h-2, key hit:lane-1:h-2; played by Platform 2 at (1.235, -0.5), angle 30° (0.524 rad), id piece-2');
		});

		it('should resolve an open hit with its dot', () => {
			const line = describeMention(project, result, { id: 'hit:lane-1:h-3', kind: 'hit', label: 'Hit 3 of Melody' });
			expect(line).toBe('Hit 3 of Melody at 0:08.00, Open, hitId h-3, key hit:lane-1:h-3; its dot is at (0.25, -1), no platform yet');
		});

		it('should resolve a piece with the hit it plays', () => {
			const line = describeMention(project, result, { id: 'piece-2', kind: 'piece', label: 'Platform 2' });
			expect(line).toContain('Platform 2 at (1.235, -0.5), angle 30°');
			expect(line).toContain('plays Hit 2 of Melody at 0:06.50, On Time, hitId h-2');
		});

		it('should work before the run has arrived', () => {
			expect(describeMention(project, null, { id: 'hit:lane-1:h-2', kind: 'hit', label: 'Hit 2 of Melody' })).toContain('Open, hitId h-2');
		});

		it('should put several selected things in the prompt and none when nothing is selected', () => {
			expect(agentChatPrompt(' swing wider ', ['Hit 2', 'Platform 2'])).toBe('swing wider\n\nSelected in the app:\n- Hit 2\n- Platform 2');
			expect(agentChatPrompt(' swing wider ', [])).toBe('swing wider');
		});

		it('should aim a Result at the mentioned piece or the piece playing a mentioned hit', () => {
			expect(mentionTarget(project, [platform1])).toEqual({ kind: 'piece', entityId: 'p1' });
			expect(mentionTarget(project, [{ id: 'hit:lane-1:h-2', kind: 'hit', label: 'x' }])).toEqual({ kind: 'piece', entityId: 'piece-2' });
			expect(mentionTarget(project, [{ id: 'hit:lane-1:h-3', kind: 'hit', label: 'x' }, melody])).toEqual({ kind: 'scene' });
		});
	});
});

function run(id: string, prompt: string, startedAt: number): TAgentRun {
	return {
		id,
		cli: 'claude',
		prompt,
		request: prompt,
		isChat: true,
		target: null,
		status: 'running',
		review: null,
		phase: 'working',
		startedAt,
		finishedAt: null,
		error: null,
		runPath: `/p/agent/runs/${id}`,
		candidatePath: `/p/candidates/${id}`,
		hasAsset: false,
		manifestJson: null,
		manifest: null,
		manifestError: null,
		previewUrl: null,
		messages: [],
		acceptedItemId: null
	};
}
