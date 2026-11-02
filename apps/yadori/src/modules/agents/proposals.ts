import { z } from 'zod';
import { executeCommands, SCommands, type TCommand, type TProject } from '../project/model';

const SProposal = z.object({
	id: z.string().min(1),
	projectId: z.string().min(1),
	baseRevision: z.number().int().nonnegative(),
	summary: z.string().max(16000),
	commands: SCommands.max(1000),
	createdAt: z.string().min(1)
});
export type TValidatedProposal = Omit<z.infer<typeof SProposal>, 'commands'> & {
	commands: TCommand[];
};
/** Domain parsing and a dry run happen before any user-facing Apply action. */
export function prepareAgentProposal(value: unknown, project: TProject): TValidatedProposal {
	const proposal = SProposal.parse(value) as TValidatedProposal;
	if (proposal.projectId !== project.id)
		throw new Error('This proposal belongs to another project.');
	if (proposal.baseRevision !== project.revision)
		throw new Error('The project changed after this proposal was prepared. Run the task again.');
	executeCommands(project, proposal.commands, { expectedRevision: proposal.baseRevision });
	return proposal;
}

export function summarizeAgentCommands(project: TProject, commands: TCommand[]): string[] {
	return commands.map((command) => {
		if (command.type === 'part.update') {
			const part = project.parts.find((entry) => entry.id === command.id);
			const changes = Object.entries(command.patch).map(
				([key, value]) =>
					`${fieldName(key)}: ${compact(part?.[key as keyof typeof part])} → ${compact(value)}`
			);
			return `${part?.name ?? 'Part'} — ${changes.join('; ')}`;
		}
		if (command.type === 'part.add') return `Add part: ${command.part.name}`;
		if (command.type === 'source.add')
			return `Add source for ${project.parts.find((part) => part.id === command.source.partId)?.name ?? 'part'}: ${command.source.title} (${command.source.url})`;
		if (command.type === 'review.add') return `Add review note: ${command.review.title}`;
		if (command.type === 'quote.add')
			return `Record price: €${command.quote.price} for ${command.quote.packQuantity} ${command.quote.unit} · ${command.quote.observedAt}`;
		if (command.type === 'instance.add')
			return `Add physical unit: ${command.instance.label || project.parts.find((part) => part.id === command.instance.partId)?.name || 'Equipment'}`;
		if (command.type === 'run.add')
			return `Add cable run: ${command.run.name} · ${command.run.lengthBasis === 'route' ? 'projected route' : command.run.lengthM == null ? 'length unresolved' : `${command.run.lengthM} m`}`;
		if (command.type === 'placement.add') {
			const instance = project.instances.find((entry) => entry.id === command.placement.instanceId);
			return `Place ${instance?.label || project.parts.find((part) => part.id === instance?.partId)?.name || 'equipment'} at ${command.placement.xMm}, ${command.placement.yMm} mm`;
		}
		const record = command as unknown as Record<string, unknown>;
		const id = typeof record['id'] === 'string' ? record['id'] : '';
		const target =
			project.parts.find((part) => part.id === id)?.name ??
			project.runs.find((run) => run.id === id)?.name ??
			'';
		return `${fieldName(command.type.replace('.', ' '))}${target ? `: ${target}` : ''}`;
	});
}
function compact(value: unknown): string {
	if (value == null) return 'unknown';
	if (typeof value === 'string')
		return value.length > 75 ? `${value.slice(0, 72)}…` : value || 'empty';
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) return `${value.length} entries`;
	return 'technical details';
}
function fieldName(value: string): string {
	const text = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
	return text.charAt(0).toUpperCase() + text.slice(1);
}
