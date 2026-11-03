import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { StudioCx } from './StudioCx';

/**
 * The notice above the canvas: one line, its actions at the right like the Undo of Mail's and Finder's toasts,
 * and a thin progress bar while a long task such as Re-place runs. Hovering keeps it open.
 */
export const Notice: React.FC<TNoticeProps> = (props) => {
	const { cx } = props;
	const notice = useFeatureState(cx.$notice);
	const workspace = useFeatureState(cx.$workspace);
	if (notice == null) return null;
	const actions = notice.actions ?? [];

	return (
		<div
			role="status"
			className="mm-notice absolute left-1/2 z-30 w-max max-w-[min(640px,calc(100%-32px))] -translate-x-1/2 overflow-hidden rounded-[10px] bg-[var(--content-raised)] text-[13px]"
			style={{
				// Compose notices sit above the floating tool bar
				bottom: workspace === 'compose' ? 64 : 16,
				boxShadow: 'var(--shadow-popover)'
			}}
			onPointerEnter={() => cx.holdNotice(true)}
			onPointerLeave={() => cx.holdNotice(false)}
		>
			<div className="flex items-center gap-3 py-1.5 pr-1.5 pl-4" style={{ minHeight: 36 }}>
				<span className="min-w-0" style={{ color: notice.tone === 'error' ? 'var(--bad)' : undefined }}>
					{notice.message}
				</span>
				{actions.length > 0 ? (
					<span className="flex shrink-0 items-center gap-1">
						{actions.map((action, index) => (
							<button
								key={action.label}
								className="mm-notice-action"
								data-variant={index === 0 && actions.length > 1 ? 'primary' : undefined}
								onClick={() => {
									cx.dismissNotice(notice.id);
									action.run();
								}}
								title={action.title}
								type="button"
							>
								{action.label}
							</button>
						))}
					</span>
				) : (
					<span className="w-2.5" />
				)}
			</div>
			{notice.progress != null ? (
				<div className="h-[3px] bg-[var(--field-fill)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(notice.progress * 100)}>
					<div className="h-full bg-[var(--accent)] transition-[width] duration-200" style={{ width: `${Math.round(notice.progress * 100)}%` }} />
				</div>
			) : null}
		</div>
	);
};

interface TNoticeProps {
	cx: StudioCx;
}
