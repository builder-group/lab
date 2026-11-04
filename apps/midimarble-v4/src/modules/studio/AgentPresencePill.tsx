import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { StudioCx } from './StudioCx';

/**
 * An agent at work, at the top of the canvas in both workspaces, like a collaborator's name in a shared document:
 * what it is doing and Stop. It goes shortly after the last call.
 */
export const AgentPresencePill: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const presence = useFeatureState(cx.mcp.presence.$current);
	if (presence == null) return null;
	return (
		<div role="status" className="mm-floating absolute top-3 left-1/2 z-30 flex max-w-[min(420px,calc(100%-24px))] -translate-x-1/2 items-center gap-2 py-[3px] pr-[3px] pl-3 text-[12px]">
			<span className="min-w-0 truncate">Agent · {presence.isStopping ? 'Stopping' : presence.label}</span>
			<button className="mm-notice-action" disabled={presence.isStopping} onClick={() => cx.mcp.stop()} title="Stop what the agent is doing; what it did stays" type="button">
				Stop
			</button>
		</div>
	);
};
