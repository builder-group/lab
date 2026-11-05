import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { AlertSheet, useAlertKeys } from './AlertSheet';
import type { StudioCx } from './StudioCx';

type TCloseChoice = Parameters<StudioCx['answerClose']>[0];

function choiceOf(event: KeyboardEvent): TCloseChoice | null {
	return event.key === 'Escape' ? 'cancel' : event.key === 'Enter' ? 'save' : event.metaKey && event.key.toLowerCase() === 'd' ? 'discard' : null;
}

/**
 * The macOS alert for closing an unsaved document with changes: Save… (Return) asks where to save it, Don't Save
 * (⌘D) closes without it and Cancel (Escape) keeps it open
 */
export const SaveChangesAlert: React.FC<TSaveChangesAlertProps> = (props) => {
	const { cx } = props;
	const prompt = useFeatureState(cx.$closePrompt);
	const answer = React.useCallback((choice: TCloseChoice) => cx.answerClose(choice), [cx]);
	const saveRef = useAlertKeys(prompt, choiceOf, answer);

	if (prompt == null) return null;

	return (
		<AlertSheet id="save-changes-title" question={prompt.question} detail="Your changes are lost if you don't save them.">
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
		</AlertSheet>
	);
};

interface TSaveChangesAlertProps {
	cx: StudioCx;
}
