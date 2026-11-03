import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { createState } from 'feature-state';
import { Err, Ok, type TResult } from 'tuple-result';
import { specta } from '@/environment/specta';
import {
	library,
	parseCandidateManifest,
	type TAssetManifest,
	type TLibraryItem
} from '@/modules/library';
import type { TProject } from '@/modules/project';
import type { TSimulationResult } from '@/modules/simulation';
import { buildAgentBrief, type TAgentTarget } from './agent-brief';
import {
	appendAgentLine,
	condenseAgentLines,
	type TAgentCli,
	type TAgentMessage
} from './agent-messages';
import { agentRunPhase, canAcceptRun, type TAgentRunPhase } from './agent-status';

const REFRESH_DELAY_MS = 600;

/**
 * Agent runs of the open package. A run writes a brief into `candidates/<runId>/`, runs a local agent CLI
 * there and streams its output. Accepting copies the candidate into the project library; the caller applies
 * the returned item. In the browser development surface agents are unavailable.
 */
export class AgentCx {
	readonly $availability = createState<TAgentAvailability>('unknown');
	readonly $clis = createState<TAgentCliInfo[]>([]);
	readonly $runs = createState<TAgentRun[]>([]);

	private disposed = false;
	// Lines that arrive before `agents_start` resolves with the run
	private pending = new Map<string, specta.AgentRunEvent[]>();
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;
	private targets = new Map<string, TAgentTarget>();

	constructor(private readonly source: TAgentSource) {}

	mount(): () => void {
		this.disposed = false;
		let unlisten: (() => void) | null = null;
		void (async () => {
			if (!isTauri()) {
				this.$availability.set('unavailable');
				return;
			}
			const stop = await specta.events.agentRunEvent.listen((event) =>
				this.handleEvent(event.payload)
			);
			if (this.disposed) {
				stop();
				return;
			}
			unlisten = stop;
			await this.detect();
			await this.reload();
		})();
		return () => {
			this.disposed = true;
			clearTimeout(this.refreshTimer);
			unlisten?.();
		};
	}

	async detect(): Promise<TAgentCliInfo[]> {
		if (!isTauri()) {
			this.$availability.set('unavailable');
			return [];
		}
		const result = await specta.commands.agentsDetect();
		const clis = result.status === 'ok' ? result.data : [];
		if (this.disposed) return clis;
		this.$clis.set(clis);
		this.$availability.set(clis.length > 0 ? 'ready' : 'missing');
		return clis;
	}

	/** Starts an agent for a target with the user's request */
	async start(options: {
		target: TAgentTarget;
		request: string;
		cli?: TAgentCli;
	}): Promise<TResult<TAgentRun, Error>> {
		if (!isTauri()) return Err(new Error('Agents need the desktop app'));
		const packagePath = this.source.getPackagePath();
		const project = this.source.getProject();
		if (packagePath == null || project == null) return Err(new Error('Open a project first'));
		const request = options.request.trim();
		if (!request.length) return Err(new Error('Describe what the agent should make'));
		const cli = options.cli ?? this.$clis.get()[0]?.cli;
		if (cli == null) return Err(new Error('No agent CLI was found. Install Claude Code or Codex.'));

		const brief = buildAgentBrief({
			project,
			result: this.source.getResult(),
			target: options.target,
			request
		});
		const runId = createRunId();
		const prompt = `${request}\n\nRead BRIEF.md in this folder first and follow its output contract.`;
		this.targets.set(runId, options.target);
		const result = await specta.commands.agentsStart(
			packagePath,
			cli,
			runId,
			prompt,
			JSON.stringify(brief)
		);
		if (result.status === 'error') {
			this.targets.delete(runId);
			return Err(new Error(result.error));
		}
		const run = this.toRun(result.data, null);
		this.$runs.set([run, ...this.$runs.get().filter((item) => item.id !== runId)]);
		for (const event of this.pending.get(runId) ?? []) this.handleEvent(event);
		this.pending.delete(runId);
		return Ok(this.getRun(runId) ?? run);
	}

	async cancel(runId: string): Promise<void> {
		if (!isTauri()) return;
		await specta.commands.agentsCancel(runId);
	}

	/** Copies the candidate into the project library and marks the run accepted. Returns the new item. */
	async accept(runId: string): Promise<TResult<TLibraryItem, Error>> {
		const packagePath = this.source.getPackagePath();
		const run = this.getRun(runId);
		if (packagePath == null || run == null)
			return Err(new Error('The candidate is no longer available'));
		if (!canAcceptRun(run.phase)) return Err(new Error('The candidate is not ready for review'));
		const [isItemOk, itemErr, item] = await library.acceptCandidate(
			packagePath,
			runId,
			run.manifestJson
		);
		if (!isItemOk) return Err(itemErr);
		await this.review(runId, 'accepted', item.id);
		return Ok(item);
	}

	/** Marks the run declined, ending it first if it still works */
	async decline(runId: string): Promise<TResult<void, Error>> {
		const run = this.getRun(runId);
		if (run == null) return Err(new Error('The candidate is no longer available'));
		if (run.status === 'running') await this.cancel(runId);
		return this.review(runId, 'declined', null);
	}

	getRun(runId: string): TAgentRun | undefined {
		return this.$runs.get().find((run) => run.id === runId);
	}

	/** Reloads every run of the package, keeping streamed messages and loading transcripts of earlier runs */
	async reload(): Promise<void> {
		const packagePath = this.source.getPackagePath();
		if (!isTauri() || packagePath == null) return;
		const dtos = await specta.commands.agentsList(packagePath);
		if (this.disposed) return;
		const current = new Map(this.$runs.get().map((run) => [run.id, run]));
		const runs = dtos.map((dto) => this.toRun(dto, current.get(dto.runId) ?? null));
		this.$runs.set(runs);
		for (const run of runs) {
			if (!current.has(run.id) && run.status !== 'running') void this.loadTranscript(run);
		}
	}

	private async review(
		runId: string,
		review: specta.AgentReview,
		acceptedItemId: string | null
	): Promise<TResult<void, Error>> {
		const packagePath = this.source.getPackagePath();
		if (packagePath == null) return Err(new Error('Open a project first'));
		const result = await specta.commands.agentsReview(packagePath, runId, review);
		if (result.status === 'error') return Err(new Error(result.error));
		this.updateRun(runId, (run) => {
			const next = this.toRun(result.data, run);
			return { ...next, acceptedItemId: acceptedItemId ?? run.acceptedItemId };
		});
		return Ok(undefined);
	}

	private handleEvent(event: specta.AgentRunEvent): void {
		if (this.disposed) return;
		const run = this.getRun(event.runId);
		if (run == null) {
			this.pending.set(event.runId, [...(this.pending.get(event.runId) ?? []), event]);
			return;
		}
		if (event.kind === 'exit') {
			const record = parseRecord(event.payload);
			this.updateRun(run.id, (current) =>
				withPhase({
					...current,
					status: record?.status ?? 'failed',
					error: record?.error ?? current.error,
					finishedAt: record?.finishedAt ?? Date.now(),
					outsideChanges: record?.outsideChanges ?? []
				})
			);
			this.scheduleRefresh(0);
			return;
		}
		this.updateRun(run.id, (current) => {
			const messages = current.messages.map((message) => ({ ...message }));
			appendAgentLine(messages, current.cli, event.payload);
			return { ...current, messages };
		});
		// Tool steps may have written the asset, manifest or preview
		if (event.kind === 'tool') this.scheduleRefresh(REFRESH_DELAY_MS);
	}

	private scheduleRefresh(delay: number): void {
		clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => void this.reload(), delay);
	}

	private async loadTranscript(run: TAgentRun): Promise<void> {
		try {
			const response = await fetch(convertFileSrc(`${run.candidatePath}/transcript.jsonl`));
			if (!response.ok) return;
			const lines = (await response.text()).split('\n').filter((line) => line.trim().length > 0);
			if (this.disposed) return;
			this.updateRun(run.id, (current) => ({
				...current,
				messages: condenseAgentLines(current.cli, lines)
			}));
		} catch {
			// A missing transcript leaves the conversation empty
		}
	}

	private updateRun(runId: string, update: (run: TAgentRun) => TAgentRun): void {
		this.$runs.set(this.$runs.get().map((run) => (run.id === runId ? update(run) : run)));
	}

	private toRun(dto: specta.AgentRunDto, previous: TAgentRun | null): TAgentRun {
		let manifest: TAssetManifest | null = null;
		let manifestError: string | null = null;
		if (dto.manifestJson != null) {
			const [isManifestOk, manifestErr, parsed] = parseCandidateManifest(dto.manifestJson);
			manifest = isManifestOk ? parsed : null;
			manifestError = isManifestOk ? null : manifestErr.message;
		}
		// Note: no cache-busting query string; Tauri's asset protocol reads it as part of the file path
		const previewUrl = dto.previewPath == null ? null : convertFileSrc(dto.previewPath);
		return withPhase({
			id: dto.runId,
			cli: dto.cli,
			prompt: dto.prompt,
			target: previous?.target ?? this.targets.get(dto.runId) ?? null,
			status: dto.status,
			review: dto.review,
			phase: 'working',
			startedAt: dto.startedAt ?? 0,
			finishedAt: dto.finishedAt,
			error: dto.error,
			candidatePath: dto.candidatePath,
			hasAsset: dto.hasAsset,
			manifestJson: dto.manifestJson,
			manifest,
			manifestError,
			previewUrl,
			outsideChanges: dto.outsideChanges ?? [],
			messages: previous?.messages ?? [],
			acceptedItemId: previous?.acceptedItemId ?? null
		});
	}
}

export interface TAgentSource {
	getPackagePath: () => string | null;
	getProject: () => TProject | null;
	getResult: () => TSimulationResult | null;
}

export type TAgentAvailability = 'unknown' | 'unavailable' | 'missing' | 'ready';
export type TAgentCliInfo = specta.AgentCliDto;

export interface TAgentRun {
	id: string;
	cli: TAgentCli;
	prompt: string;
	/** Known for runs started in this session */
	target: TAgentTarget | null;
	status: specta.AgentRunStatus;
	review: specta.AgentReview | null;
	phase: TAgentRunPhase;
	startedAt: number;
	finishedAt: number | null;
	error: string | null;
	candidatePath: string;
	hasAsset: boolean;
	manifestJson: string | null;
	manifest: TAssetManifest | null;
	manifestError: string | null;
	previewUrl: string | null;
	/** Package files outside `candidates/` that changed during the run; advisory */
	outsideChanges: string[];
	messages: TAgentMessage[];
	acceptedItemId: string | null;
}

function withPhase(run: TAgentRun): TAgentRun {
	return { ...run, phase: agentRunPhase(run) };
}

function parseRecord(payload: string): specta.AgentRunRecord | null {
	try {
		return JSON.parse(payload) as specta.AgentRunRecord;
	} catch {
		return null;
	}
}

function createRunId(): string {
	const random = Math.random().toString(36).slice(2, 8);
	return `run-${Date.now().toString(36)}-${random}`;
}
