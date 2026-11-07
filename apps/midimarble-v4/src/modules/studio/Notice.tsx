import { useFeatureState } from 'feature-react/state';
import { X } from 'lucide-react';
import React from 'react';
import type { StudioCx } from './StudioCx';

/**
 * The notice in the lane at the bottom of the canvas, in both workspaces, above the transport and above the bar when it
 * shows: one line, two at most, its actions at the right like the Undo of Mail's and
 * Finder's toasts, and a thin progress bar while a long task such as Fix runs. Hovering keeps it open. A
 * notice with details, like Figma's notifications, has a Details disclosure with the full text and a close
 * button, and stays until it is closed or the next edit. An agent at work shows here too, one place for what the app is
 * doing: "Agent · Building track · 12 of 58" with Stop, which stops the agent and any build it started.
 */
export const Notice: React.FC<TNoticeProps> = (props) => {
	const { cx } = props;
	const notice = useFeatureState(cx.$notice);
	const presence = useFeatureState(cx.mcp.presence.$current);
	useFeatureState(cx.$history);
	useFeatureState(cx.$selection);
	const { isDetailsOpen } = useFeatureState(cx.bar.$state);
	const [openDetails, setOpenDetails] = React.useState<number | null>(null);
	// Text past its two lines stays readable behind Details, as it's often the sentence that says what to do
	const textRef = React.useRef<HTMLSpanElement>(null);
	const [cutOff, setCutOff] = React.useState<number | null>(null);
	const noticeId = notice?.id;
	const message = notice?.message;
	React.useLayoutEffect(() => {
		const text = textRef.current;
		if (text == null || noticeId == null) return undefined;
		const measure = (): void => {
			if (text.scrollHeight > text.clientHeight + 1) setCutOff(noticeId);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(text);
		return () => observer.disconnect();
	}, [noticeId, message]);
	// The bar's status popover stands where the notice does: one thing above the bar at a time
	if ((notice == null && presence == null) || isDetailsOpen) return null;
	// An agent's line wins over passing notices, but not over a failure the person should read
	if (presence != null && notice?.tone !== 'error') {
		const doing = presence.isStopping ? 'Stopping' : notice?.progress != null ? notice.message : presence.label;
		return (
			<div role="status" className="mm-notice pointer-events-auto w-max max-w-full overflow-hidden rounded-[10px] bg-[var(--content-raised)] text-[13px]" style={{ boxShadow: 'var(--shadow-popover)' }}>
				<div className="flex items-center gap-3 py-1.5 pr-1.5 pl-4" style={{ minHeight: 36 }}>
					<span className="min-w-0 truncate">Agent · {doing}</span>
					<button className="mm-notice-action" disabled={presence.isStopping} onClick={() => cx.mcp.stop()} title="Stop what the agent is doing" type="button">
						Stop
					</button>
				</div>
				{notice?.progress != null ? <NoticeProgress progress={notice.progress} /> : null}
			</div>
		);
	}
	if (notice == null) return null;
	// The bar says what's about the note on show
	if (cx.bar.carriesNotice(notice)) return null;
	// An Undo is shown only while its edit is the latest, as it would take back a later edit otherwise
	const actions = (notice.actions ?? []).filter((action) => action.undoGroup === undefined || action.undoGroup === cx.editGroup);
	const hasDetails = notice.details != null || cutOff === notice.id;
	const isOpen = hasDetails && openDetails === notice.id;

	return (
		<div
			role="status"
			className="mm-notice pointer-events-auto w-max max-w-full overflow-hidden rounded-[10px] bg-[var(--content-raised)] text-[13px]"
			style={{ boxShadow: 'var(--shadow-popover)' }}
			onPointerEnter={() => cx.holdNotice(true)}
			onPointerLeave={() => {
				if (!isOpen) cx.holdNotice(false);
			}}
		>
			<div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 py-1.5 pr-1.5 pl-4" style={{ minHeight: 36 }}>
				<span
					ref={textRef}
					// Over a narrow canvas its actions take the next line, so the words keep their room
					className="min-w-[120px] flex-1 overflow-hidden"
					// Two lines at most; the rest sits behind Details
					style={{ color: notice.tone === 'error' ? 'var(--bad)' : undefined, ...(isOpen ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }) }}
				>
					{notice.message}
				</span>
				{actions.length > 0 || hasDetails ? (
					<span className="flex shrink-0 items-center gap-1">
						{hasDetails ? (
							<button
								className="mm-notice-action"
								aria-expanded={isOpen}
								// A click leaves no focus ring behind
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => {
									setOpenDetails(isOpen ? null : notice.id);
									// Open, it stays until it's closed: it takes longer to read than a passing notice lasts
									cx.holdNotice(!isOpen);
								}}
								title={isOpen ? 'Hide the details' : 'Show all of it'}
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
						{hasDetails ? (
							<button className="mm-icon-button !h-6 !w-6" aria-label="Close" onClick={() => cx.dismissNotice(notice.id)} title="Close" type="button">
								<X size={13} strokeWidth={2} />
							</button>
						) : null}
					</span>
				) : (
					<span className="w-2.5" />
				)}
			</div>
			{isOpen && notice.details != null ? (
				<p className="max-h-40 overflow-y-auto px-4 pb-2.5 text-[12px] leading-[1.45] whitespace-pre-line text-[var(--text-secondary)] select-text" style={{ maxWidth: 640 }}>
					{notice.details}
				</p>
			) : null}
			{notice.progress != null ? <NoticeProgress progress={notice.progress} /> : null}
		</div>
	);
};

const NoticeProgress: React.FC<{ progress: number }> = (props) => (
	<div className="h-[3px] bg-[var(--field-fill)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(props.progress * 100)}>
		<div className="h-full bg-[var(--accent)] transition-[width] duration-200" style={{ width: `${Math.round(props.progress * 100)}%` }} />
	</div>
);

interface TNoticeProps {
	cx: StudioCx;
}
