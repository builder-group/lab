import { useFeatureState } from 'feature-react/state';
import { X } from 'lucide-react';
import React from 'react';
import type { StudioCx } from './StudioCx';

/**
 * The notice at the bottom left of the canvas, in both workspaces, above the transport and away from the wall's centre,
 * where the run, the hints and the build bar are: one line, two at most, its actions at the right like the Undo of Mail's and
 * Finder's toasts, and a thin progress bar while a long task such as Fix Hits runs. Hovering keeps it open. A
 * notice with details, like Figma's notifications, has a Details disclosure with the full text and a close
 * button, and stays until it is closed or the next edit.
 */
export const Notice: React.FC<TNoticeProps> = (props) => {
	const { cx } = props;
	const notice = useFeatureState(cx.$notice);
	const [openDetails, setOpenDetails] = React.useState<number | null>(null);
	if (notice == null) return null;
	const actions = notice.actions ?? [];
	const isOpen = notice.details != null && openDetails === notice.id;

	return (
		<div
			role="status"
			className="mm-notice absolute bottom-3 left-3 z-30 w-max max-w-[min(560px,calc(100%-24px))] overflow-hidden rounded-[10px] bg-[var(--content-raised)] text-[13px]"
			style={{ boxShadow: 'var(--shadow-popover)' }}
			onPointerEnter={() => cx.holdNotice(true)}
			onPointerLeave={() => cx.holdNotice(false)}
		>
			<div className="flex items-center gap-3 py-1.5 pr-1.5 pl-4" style={{ minHeight: 36 }}>
				<span
					className="min-w-0 overflow-hidden"
					// Two lines at most; the rest sits behind Details
					style={{ color: notice.tone === 'error' ? 'var(--bad)' : undefined, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
				>
					{notice.message}
				</span>
				{actions.length > 0 || notice.details != null ? (
					<span className="flex shrink-0 items-center gap-1">
						{notice.details != null ? (
							<button
								className="mm-notice-action"
								aria-expanded={isOpen}
								onClick={() => setOpenDetails(isOpen ? null : notice.id)}
								title={isOpen ? 'Hide the details' : 'Show everything this changed'}
								type="button"
							>
								Details
							</button>
						) : null}
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
						{notice.details != null ? (
							<button className="mm-icon-button !h-6 !w-6" aria-label="Close" onClick={() => cx.dismissNotice(notice.id)} title="Close" type="button">
								<X size={13} strokeWidth={2} />
							</button>
						) : null}
					</span>
				) : (
					<span className="w-2.5" />
				)}
			</div>
			{isOpen ? (
				<p className="max-h-40 overflow-y-auto px-4 pb-2.5 text-[12px] leading-[1.45] text-[var(--text-secondary)] select-text" style={{ maxWidth: 640 }}>
					{notice.details}
				</p>
			) : null}
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
