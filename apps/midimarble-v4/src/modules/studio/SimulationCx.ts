import { createState } from 'feature-state';
import type { TProject } from '@/modules/project';
import { createSimulationClient, type TSimulationClient, type TSimulationResult } from '@/modules/simulation';
import type { StudioCx } from './StudioCx';

/**
 * Keeps a simulation result for the open project. Every history change re-simulates once per animation
 * frame in the worker. Live drags send a temporary project through `preview` without touching history,
 * so the trajectory follows the pointer and the drag commits one history entry on release.
 */
export class SimulationCx {
	readonly $result = createState<TSimulationResult | null>(null);
	readonly $computing = createState(false);
	/** Wall time from the newest request to its result, in milliseconds */
	readonly $latency = createState<number | null>(null);

	private client: TSimulationClient | null = null;
	private preview: TProject | null = null;
	private frame: number | null = null;
	private sent = 0;
	private accepted = 0;


	constructor(private readonly studio: StudioCx) {}

	mount(): () => void {
		this.client = createSimulationClient();
		const unlisten = this.studio.$history.subscribe(({ value }) => {
			if (value == null) {
				this.preview = null;
				this.$result.set(null);
				return;
			}
			this.schedule();
		});
		return () => {
			unlisten();
			if (this.frame != null) cancelAnimationFrame(this.frame);
			this.frame = null;
			this.client?.dispose();
			this.client = null;
		};
	}

	/** True when the shown result belongs to the project as it is now, rather than an older edit */
	get isCurrent(): boolean {
		const result = this.$result.get();
		return result != null && result.revision === this.studio.project?.revision;
	}

	/** Simulates `project` in place of the history's present until `endPreview` */
	startPreview(project: TProject): void {
		this.preview = project;
		this.schedule();
	}

	/** Returns to the history's present, usually right after the drag committed its edit */
	endPreview(): void {
		if (this.preview == null) return;
		this.preview = null;
		this.schedule();
	}

	get isPreviewing(): boolean {
		return this.preview != null;
	}

	private schedule(): void {
		if (this.frame != null) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = null;
			this.run();
		});
	}

	private run(): void {
		const project = this.preview ?? this.studio.project;
		const client = this.client;
		if (project == null || client == null) return;
		const id = ++this.sent;
		const startedAt = performance.now();
		this.$computing.set(true);
		client.simulate(project).then(
			(result) => {
				// Requests replaced while waiting resolve with the same newer result, oldest first
				if (id < this.accepted) return;
				this.accepted = id;
				this.$latency.set(performance.now() - startedAt);
				if (result !== this.$result.get()) this.$result.set(result);
				if (id === this.sent) this.$computing.set(false);
			},
			(error: unknown) => {
				if (this.client == null) return;
				if (id === this.sent) this.$computing.set(false);
				this.studio.notify(`Simulation failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
			}
		);
	}
}
