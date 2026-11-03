import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { StudioCx } from './StudioCx';

/**
 * The macOS alert for closing an unsaved document with changes: Save… (Return) asks where to save it, Don't Save
 * (⌘D) closes without it and Cancel (Escape) keeps it open
 */
export const SaveChangesAlert: React.FC<TSaveChangesAlertProps> = (props) => {
	const { cx } = props;
	const prompt = useFeatureState(cx.$closePrompt);
	const saveRef = React.useRef<HTMLButtonElement>(null);

	React.useEffect(() => {
		if (prompt == null) return;
		saveRef.current?.focus();
		function onKeyDown(event: KeyboardEvent): void {
			const choice = event.key === 'Escape' ? 'cancel' : event.key === 'Enter' ? 'save' : event.metaKey && event.key.toLowerCase() === 'd' ? 'discard' : null;
			if (choice == null) return;
			event.preventDefault();
			event.stopPropagation();
			cx.answerClose(choice);
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [cx, prompt]);

	if (prompt == null) return null;

	return (
		<div className="absolute inset-0 z-50 flex justify-center bg-black/10" onPointerDown={(event) => event.stopPropagation()}>
			<div role="alertdialog" aria-modal aria-labelledby="save-changes-title" className="mm-sheet mt-[60px] w-[380px]">
				<div className="flex flex-col gap-1">
					<span id="save-changes-title" className="font-semibold">
						{prompt.question}
					</span>
					<span className="text-[11px] text-[var(--text-secondary)]">Your changes are lost if you don't save them.</span>
				</div>
				<div className="flex items-center gap-2">
					<button className="mm-button" data-size="dialog" onClick={() => cx.answerClose('discard')} title="Don't Save (⌘D)" type="button">
						Don't Save
					</button>
					<span className="flex-1" />
					<button className="mm-button" data-size="dialog" onClick={() => cx.answerClose('cancel')} title="Cancel (Esc)" type="button">
						Cancel
					</button>
					<button ref={saveRef} className="mm-button" data-size="dialog" data-variant="primary" onClick={() => cx.answerClose('save')} title="Save… (↩)" type="button">
						Save…
					</button>
				</div>
			</div>
		</div>
	);
};

interface TSaveChangesAlertProps {
	cx: StudioCx;
}
