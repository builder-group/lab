import type { specta } from '@/environment/specta';

export type TAgentRunStatus = specta.AgentRunStatus;
export type TAgentReview = specta.AgentReview;

/** Review state of a run as the UI shows it, combining the process status and the user's decision */
export type TAgentRunPhase =
	| 'working'
	| 'review' // finished with a preview, waiting for accept or decline
	| 'incomplete' // finished without the files the contract asks for
	| 'failed'
	| 'cancelled'
	| 'accepted'
	| 'declined';

export function agentRunPhase(run: {
	status: TAgentRunStatus;
	review: TAgentReview | null;
	hasAsset: boolean;
	previewUrl: string | null;
}): TAgentRunPhase {
	if (run.review === 'accepted') return 'accepted';
	if (run.review === 'declined') return 'declined';
	switch (run.status) {
		case 'running':
			return 'working';
		case 'failed':
			return 'failed';
		case 'cancelled':
			return 'cancelled';
		case 'succeeded':
			return run.hasAsset && run.previewUrl != null ? 'review' : 'incomplete';
	}
}

export function agentRunPhaseLabel(phase: TAgentRunPhase): string {
	switch (phase) {
		case 'working':
			return 'Working…';
		case 'review':
			return 'Ready for review';
		case 'incomplete':
			return 'Finished without a result';
		case 'failed':
			return 'Failed';
		case 'cancelled':
			return 'Cancelled';
		case 'accepted':
			return 'Accepted';
		case 'declined':
			return 'Declined';
	}
}

/** Whether accept is offered: the candidate finished with an asset and a preview and was not reviewed yet */
export function canAcceptRun(phase: TAgentRunPhase): boolean {
	return phase === 'review';
}

/** Compact usage line such as `2 min 4 s · $0.42`, or null when nothing was reported */
export function formatAgentUsage(durationMs: number | null, costUsd: number | null): string | null {
	const parts: string[] = [];
	if (durationMs != null) {
		const seconds = Math.round(durationMs / 1000);
		parts.push(
			seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`
		);
	}
	if (costUsd != null) parts.push(`$${costUsd.toFixed(2)}`);
	return parts.length > 0 ? parts.join(' · ') : null;
}
