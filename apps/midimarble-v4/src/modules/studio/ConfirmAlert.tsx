import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { AlertSheet, useAlertKeys } from './AlertSheet';
import type { StudioCx } from './StudioCx';

function choiceOf(event: KeyboardEvent): boolean | null {
	return event.key === 'Escape' ? false : event.key === 'Enter' ? true : null;
}

/**
 * The macOS alert for an edit that loses something, like "Delete Jingle Bells and its 40 Backing notes?": Cancel
 * (Escape) and the action as the default button (Return)
 */
export const ConfirmAlert: React.FC<TConfirmAlertProps> = (props) => {
	const { cx } = props;
	const prompt = useFeatureState(cx.$confirmPrompt);
	const answer = React.useCallback((choice: boolean) => cx.answerConfirm(choice), [cx]);
	const actionRef = useAlertKeys(prompt, choiceOf, answer);

	if (prompt == null) return null;

	return (
		<AlertSheet id="confirm-title" question={prompt.question} detail={prompt.detail}>
			<div className="flex items-center justify-end gap-2">
				<button className="mm-button" data-size="dialog" onClick={() => cx.answerConfirm(false)} title="Cancel (Esc)" type="button">
					Cancel
				</button>
				<button ref={actionRef} className="mm-button" data-size="dialog" data-variant="primary" onClick={() => cx.answerConfirm(true)} title={`${prompt.action} (↩)`} type="button">
					{prompt.action}
				</button>
			</div>
		</AlertSheet>
	);
};

interface TConfirmAlertProps {
	cx: StudioCx;
}
