import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { StudioCx } from './StudioCx';

export const Notice: React.FC<TNoticeProps> = (props) => {
	const { cx } = props;
	const notice = useFeatureState(cx.$notice);
	const workspace = useFeatureState(cx.$workspace);
	if (notice == null) return null;

	return (
		<div
			role="status"
			className="absolute left-1/2 z-30 max-w-[520px] -translate-x-1/2 rounded-[10px] bg-[var(--content-raised)] px-4 py-2 text-[13px]"
			style={{
				// Compose notices sit above the floating tool bar
				bottom: workspace === 'compose' ? 64 : 16,
				boxShadow: 'var(--shadow-popover)', color: notice.tone === 'error' ? 'var(--bad)' : undefined }}
		>
			{notice.message}
		</div>
	);
};

interface TNoticeProps {
	cx: StudioCx;
}
