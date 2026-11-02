import { createState } from 'feature-state';
import * as desktop from '../../environment/desktop';
import { type TCommand, type TLibraryItem, type TProject } from '../project/model';
import { prepareAgentProposal, summarizeAgentCommands, type TValidatedProposal } from './proposals';

export interface TAgentHost {
	$project: { get(): TProject | null };
	$save?: { get(): { state: string; error?: string } };
	notify?(message: string): void;
	flush(): Promise<void>;
	execute(commands: TCommand[], label?: string): boolean;
}
export class AgentCx {
	readonly $capabilities = createState<desktop.TAgentCapabilities | null>(null);
	readonly $job = createState<desktop.TAgentJob | null>(null);
	readonly $jobs = createState<desktop.TAgentJob[]>([]);
	readonly $proposals = createState<desktop.TAgentProposal[]>([]);
	readonly $error = createState<string | null>(null);
	private disposed = false;
	private generation = 0;
	private refreshGeneration = 0;
	private unlisten: (() => void) | null = null;
	private poll: ReturnType<typeof setInterval> | null = null;
	constructor(private readonly host: TAgentHost) {}
	mount(): () => void {
		this.disposed = false;
		if (!desktop.isDesktop())
			return () => {
				this.disposed = true;
			};
		void this.initialize();
		this.poll = setInterval(() => {
			void this.refresh();
		}, 2000);
		return () => {
			this.disposed = true;
			this.generation++;
			this.unlisten?.();
			this.unlisten = null;
			if (this.poll) clearInterval(this.poll);
			this.poll = null;
			const job = this.$job.get();
			if (job?.state === 'running') void desktop.cancelAgentJob(job.id).catch(() => undefined);
		};
	}
	private setJob(job: desktop.TAgentJob): void {
		const current = this.$job.get();
		if (
			current?.id === job.id &&
			current.projectId === job.projectId &&
			current.state === job.state &&
			current.detail === job.detail &&
			current.proposalId === job.proposalId
		)
			return;
		this.$job.set(job);
		this.$jobs.set([job, ...this.$jobs.get().filter((entry) => entry.id !== job.id)].slice(0, 30));
	}
	mcpConfiguration(): string {
		const capabilities = this.$capabilities.get();
		if (!capabilities) return '';
		const project = this.host.$project.get();
		return JSON.stringify(
			{
				mcpServers: {
					yadori: {
						command: capabilities.executable,
						args: [...capabilities.mcpArgs, ...(project ? ['--project', project.id] : [])]
					}
				}
			},
			null,
			2
		);
	}
	async enhancePart(partId: string, libraryItems: TLibraryItem[] = []): Promise<void> {
		const project = this.host.$project.get();
		const part = project?.parts.find((entry) => entry.id === partId);
		if (!part) return;
		const suggestions = libraryItems
			.filter(
				(item) =>
					item.name.toLowerCase().includes(part.name.toLowerCase()) ||
					part.name.toLowerCase().includes(item.name.toLowerCase())
			)
			.slice(0, 8)
			.map((item) => ({ id: item.id, name: item.name, brand: item.brand }));
		await this.start(
			`Research and improve part ${JSON.stringify(part.name)} with id ${part.id}. Check existing project sources and definitions before researching. Preserve the user name, notes and existing verified facts. Add cited manufacturer product/datasheet URLs with source.add commands, and propose only specifications evidenced by those sources. Keep unknown ratings unknown; do not infer a different product variant. Add concise research notes or review questions. Candidate library names (unverified suggestions only): ${JSON.stringify(suggestions)}`
		);
	}
	private async initialize(): Promise<void> {
		const generation = this.generation;
		try {
			const capabilities = await desktop.agentCapabilities();
			if (this.disposed || generation !== this.generation) return;
			this.$capabilities.set(capabilities);
			const unlisten = await desktop.subscribeAgentEvents((event) => {
				if (this.disposed || event.jobId !== this.$job.get()?.id) return;
				if (event.job) this.setJob(event.job);
				else {
					const job = this.$job.get();
					if (job?.state === 'running') this.setJob({ ...job, detail: event.message });
				}
				if (event.job && event.job.state !== 'running') void this.refresh();
			});
			if (this.disposed || generation !== this.generation) {
				unlisten();
				return;
			}
			this.unlisten = unlisten;
			await this.refresh();
		} catch (error) {
			if (!this.disposed) this.$error.set(message(error));
		}
	}
	async refresh(): Promise<void> {
		const refreshGeneration = ++this.refreshGeneration;
		const project = this.host.$project.get();
		if (!project || !desktop.isDesktop() || this.disposed) {
			if (this.$proposals.get().length) this.$proposals.set([]);
			return;
		}
		if (this.$proposals.get().some((proposal) => proposal.projectId !== project.id))
			this.$proposals.set([]);
		try {
			const proposals = await desktop.listAgentProposals(project.id);
			if (
				!this.disposed &&
				refreshGeneration === this.refreshGeneration &&
				this.host.$project.get()?.id === project.id
			) {
				const previous = this.$proposals.get();
				if (
					previous.length !== proposals.length ||
					proposals.some((proposal, index) => {
						const old = previous[index];
						return (
							old?.id !== proposal.id ||
							old.projectId !== proposal.projectId ||
							old.baseRevision !== proposal.baseRevision
						);
					})
				)
					this.$proposals.set(proposals);
			}
			const job = this.$job.get();
			if (job?.state === 'running') {
				const status = await desktop.getAgentJob(job.id);
				if (
					!this.disposed &&
					refreshGeneration === this.refreshGeneration &&
					this.$job.get()?.id === status.id
				)
					this.setJob(
						status.state === 'running'
							? { ...status, detail: this.$job.get()?.detail ?? status.detail }
							: status
					);
			}
		} catch (error) {
			if (!this.disposed) this.$error.set(message(error));
		}
	}
	async start(prompt: string): Promise<void> {
		if (!desktop.isDesktop()) {
			this.$error.set('Agent tasks require the desktop app.');
			return;
		}
		if (this.$job.get()?.state === 'running') return;
		const project = this.host.$project.get();
		if (!project) return;
		this.$error.set(null);
		try {
			await this.host.flush();
			this.requireSavedEdits();
			if (this.host.$project.get()?.id !== project.id) return;
			const latest = this.host.$project.get();
			if (!latest) return;
			const job = await desktop.startAgentJob(latest.id, latest.revision, prompt);
			if (this.disposed || this.host.$project.get()?.id !== latest.id) {
				await desktop.cancelAgentJob(job.id);
				return;
			}
			this.setJob(job);
		} catch (error) {
			if (!this.disposed) this.$error.set(message(error));
		}
	}
	async cancel(): Promise<void> {
		const job = this.$job.get();
		if (!job || job.state !== 'running') return;
		try {
			await desktop.cancelAgentJob(job.id);
			await this.refresh();
		} catch (error) {
			this.$error.set(message(error));
		}
	}
	getProjectRevisionKey(): string {
		const project = this.host.$project.get();
		return project ? `${project.id}:${project.revision}` : '';
	}
	inspectProposal(value: unknown): { proposal: TValidatedProposal; changes: string[] } {
		const proposal = this.preview(value);
		const project = this.host.$project.get();
		return { proposal, changes: project ? summarizeAgentCommands(project, proposal.commands) : [] };
	}
	private preview(value: unknown): TValidatedProposal {
		const project = this.host.$project.get();
		if (!project) throw new Error('Open a project first.');
		return prepareAgentProposal(value, project);
	}
	async acceptProposal(value: unknown): Promise<boolean> {
		try {
			await this.host.flush();
			this.requireSavedEdits();
			const proposal = this.preview(value);
			if (!this.host.execute(proposal.commands, 'Apply agent proposal')) return false;
			await this.host.flush();
			this.requireSavedEdits();
			const current = this.host.$project.get();
			if (current?.id !== proposal.projectId)
				throw new Error('The active project changed. The proposal remains available.');
			const persisted = await desktop.openProject(proposal.projectId);
			if (persisted.revision !== current.revision)
				throw new Error('Changes could not be saved. The proposal remains available.');
			await desktop.dismissAgentProposal(proposal.projectId, proposal.id);
			await this.refresh();
			return true;
		} catch (error) {
			this.$error.set(message(error));
			return false;
		}
	}
	private requireSavedEdits(): void {
		const save = this.host.$save?.get();
		if (save?.state === 'error')
			throw new Error(save.error ?? 'Save pending edits before using the assistant.');
	}
	async dismiss(proposal: desktop.TAgentProposal): Promise<void> {
		try {
			await desktop.dismissAgentProposal(proposal.projectId, proposal.id);
			await this.refresh();
		} catch (error) {
			this.$error.set(message(error));
		}
	}
}
function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
