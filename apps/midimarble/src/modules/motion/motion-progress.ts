import type { TPerformance, TProject } from '../project/types';

export interface TMotionProgress {
	phase: 'placement' | 'simulation';
	completed: number;
	total: number;
	/** Counts unchanged linked placements reused from the previous completed build. */
	reused: number;
	/** Contains solved objects during placement, and verified samples during simulation. */
	performance?: TPerformance;
	/** Limits playback of a partial simulation to the time actually computed. */
	simulatedUntil?: number;
}

export interface TCompileOptions {
	onProgress?(progress: TMotionProgress): void;
	previous?: { project: TProject; performance: TPerformance };
	signal?: AbortSignal;
	yieldControl?(): Promise<void>;
}
