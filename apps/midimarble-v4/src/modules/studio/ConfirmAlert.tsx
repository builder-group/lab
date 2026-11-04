import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { StudioCx } from './StudioCx';

/**
 * The macOS alert for an edit that loses something, like "Delete Jingle Bells and its 40 Backing notes?": Cancel
 * (Escape) and the action as the default button (Return)
 */
export const ConfirmAlert: React.FC<TConfirmAlertProps> = (props) => {
	const { cx } = props;
	const prompt = useFeatureState(cx.$confirmPrompt);
	const actionRef = React.useRef<HTMLButtonElement>(null);

	React.useEffect(() => {
		if (prompt == null) return;
		actionRef.current?.focus();
		function onKeyDown(event: KeyboardEvent): void {
			const choice = event.key === 'Escape' ? false : event.key === 'Enter' ? true : null;
			if (choice == null) return;
			event.preventDefault();
			event.stopPropagation();
			cx.answerConfirm(choice);
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [cx, prompt]);

	if (prompt == null) return null;

	return (
		<div className="absolute inset-0 z-50 flex justify-center bg-black/10" onPointerDown={(event) => event.stopPropagation()}>
			<div role="alertdialog" aria-modal aria-labelledby="confirm-title" className="mm-sheet mt-[60px] w-[380px]">
				<div className="flex flex-col gap-1">
					<span id="confirm-title" className="font-semibold">
						{prompt.question}
					</span>
					{prompt.detail != null ? <span className="text-[11px] text-[var(--text-secondary)]">{prompt.detail}</span> : null}
				</div>
				<div className="flex items-center justify-end gap-2">
					<button className="mm-button" data-size="dialog" onClick={() => cx.answerConfirm(false)} title="Cancel (Esc)" type="button">
						Cancel
					</button>
					<button ref={actionRef} className="mm-button" data-size="dialog" data-variant="primary" onClick={() => cx.answerConfirm(true)} title={`${prompt.action} (↩)`} type="button">
						{prompt.action}
					</button>
				</div>
			</div>
		</div>
	);
};

interface TConfirmAlertProps {
	cx: StudioCx;
}
