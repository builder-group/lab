import { describe, expect, it } from 'vitest';
import {
	agentChatTurns,
	agentRunPrompt,
	composeAgentRequest,
	filterMentions,
	findMentionQuery,
	focusFromPrompt,
	planAgentRuns,
	removeMentionQuery,
	requestFromPrompt,
	SCENE_MENTION,
	splitMentions,
	type TAgentMention
} from './agent-chat';
import type { TAgentRun } from './AgentCx';

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

	describe('planAgentRuns function', () => {
		it('should send a message without mentions to the scene', () => {
			expect(planAgentRuns([])).toEqual([{ target: { kind: 'scene' }, label: 'Project' }]);
		});

		it('should start one run per mentioned piece', () => {
			expect(planAgentRuns([platform1, platform2, platform1])).toEqual([
				{ target: { kind: 'piece', entityId: 'p1' }, label: 'Platform 1' },
				{ target: { kind: 'piece', entityId: 'p2' }, label: 'Platform 2' }
			]);
		});

		it('should fold marbles and the scene into one scene run', () => {
			expect(planAgentRuns([melody, platform1, SCENE_MENTION])).toEqual([
				{ target: { kind: 'piece', entityId: 'p1' }, label: 'Platform 1' },
				{ target: { kind: 'scene' }, label: 'Project' }
			]);
		});
	});

	describe('stored prompts', () => {
		it('should round-trip the request, its mentions and the run focus', () => {
			// Prepare
			const request = composeAgentRequest(' make it wooden ', [platform1, melody]);

			// Act
			const prompt = agentRunPrompt(request, 'Platform 1');

			// Assert
			expect(request).toBe('@[Platform 1] @[Melody] make it wooden');
			expect(requestFromPrompt(prompt)).toBe(request);
			expect(focusFromPrompt(prompt)).toBe('Platform 1');
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
		});
	});

	describe('agentChatTurns function', () => {
		it('should group the runs of one message and keep later messages apart', () => {
			// Prepare
			const request = '@[Platform 1] @[Platform 2] wooden';
			const runs = [
				run('c', 'again', 100_000),
				run('a', agentRunPrompt(request, 'Platform 1'), 1_000),
				run('b', agentRunPrompt(request, 'Platform 2'), 1_400),
				run('d', agentRunPrompt(request, 'Platform 1'), 60_000)
			];

			// Act
			const turns = agentChatTurns(runs);

			// Assert
			expect(turns.map((turn) => turn.runs.map((item) => item.id))).toEqual([['a', 'b'], ['d'], ['c']]);
			expect(turns[0]?.request).toBe(request);
		});
	});
});

function run(id: string, prompt: string, startedAt: number): TAgentRun {
	return {
		id,
		cli: 'claude',
		prompt,
		target: null,
		status: 'running',
		review: null,
		phase: 'working',
		startedAt,
		finishedAt: null,
		error: null,
		candidatePath: `/p/candidates/${id}`,
		hasAsset: false,
		manifestJson: null,
		manifest: null,
		manifestError: null,
		previewUrl: null,
		outsideChanges: [],
		messages: [],
		acceptedItemId: null
	};
}
