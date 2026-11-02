import { describe, expect, it } from 'vitest';
import { createPart, createProject, executeCommands } from '../project/model';
import { prepareAgentProposal, summarizeAgentCommands } from './proposals';

function fixture() {
	const part = createPart('Water pump');
	const project = executeCommands(createProject('Build'), [{ type: 'part.add', part }]);
	return {
		part,
		project,
		proposal: {
			id: 'proposal',
			projectId: project.id,
			baseRevision: project.revision,
			createdAt: '2026-11-02T12:00:00Z',
			summary: 'Confirmed model notes',
			commands: [{ type: 'part.update', id: part.id, patch: { notes: 'Manufacturer reference' } }]
		}
	};
}
describe('prepareAgentProposal function', () => {
	it('should dry run typed commands without mutating the project', () => {
		const { project, part, proposal } = fixture();
		const before = JSON.stringify(project);
		const result = prepareAgentProposal(proposal, project);
		expect(result.commands).toEqual(proposal.commands);
		expect(JSON.stringify(project)).toBe(before);
		expect(project.parts.find((entry) => entry.id === part.id)?.notes).toBe('');
	});
	it('should reject stale project identity and revision', () => {
		const { project, proposal } = fixture();
		expect(() => prepareAgentProposal({ ...proposal, projectId: 'another' }, project)).toThrow(
			'another project'
		);
		expect(() => prepareAgentProposal({ ...proposal, baseRevision: 0 }, project)).toThrow(
			'changed'
		);
	});
	it('should reject unknown commands and invalid target batches atomically', () => {
		const { project, proposal } = fixture();
		const before = JSON.stringify(project);
		expect(() =>
			prepareAgentProposal(
				{ ...proposal, commands: [{ type: 'shell.exec', command: 'test' }] },
				project
			)
		).toThrow();
		expect(() =>
			prepareAgentProposal(
				{
					...proposal,
					commands: [
						...proposal.commands,
						{ type: 'part.update', id: 'missing', patch: { notes: 'Bad' } }
					]
				},
				project
			)
		).toThrow();
		expect(JSON.stringify(project)).toBe(before);
	});
	it('should preserve zero and false values in readable change previews', () => {
		const { project, part } = fixture();
		const lines = summarizeAgentCommands(project, [
			{ type: 'part.update', id: part.id, patch: { estimatedUnitPrice: 0, quantity: 2 } }
		]);
		expect(lines[0]).toContain('Estimated Unit Price: unknown → 0');
		expect(lines[0]).toContain('Quantity: 1 → 2');
	});
});
