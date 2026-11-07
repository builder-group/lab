import React from 'react';

/**
 * While `prompt` is up, focuses the returned default button and answers the keys `choiceOf` names before anything
 * else hears them. `choiceOf` and `answer` keep their identity, or the button takes the focus back.
 */
export function useAlertKeys<T>(prompt: unknown, choiceOf: (event: KeyboardEvent) => T | null, answer: (choice: T) => void): React.RefObject<HTMLButtonElement | null> {
	const defaultRef = React.useRef<HTMLButtonElement>(null);

	React.useEffect(() => {
		if (prompt == null) return;
		defaultRef.current?.focus();
		function onKeyDown(event: KeyboardEvent): void {
			const choice = choiceOf(event);
			if (choice == null) return;
			event.preventDefault();
			event.stopPropagation();
			answer(choice);
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [prompt, choiceOf, answer]);

	return defaultRef;
}

/** The sheet of a macOS alert: its question, a line of detail and its buttons */
export const AlertSheet: React.FC<TAlertSheetProps> = (props) => {
	const { id, question, detail, children } = props;
	return (
		<div className="absolute inset-0 z-50 flex justify-center bg-black/10" onPointerDown={(event) => event.stopPropagation()}>
			<div role="alertdialog" aria-modal aria-labelledby={id} className="mm-sheet mt-[60px] w-[380px]">
				<div className="flex flex-col gap-1">
					<span id={id} className="font-semibold">
						{question}
					</span>
					{detail != null ? <span className="text-[11px] text-[var(--text-secondary)]">{detail}</span> : null}
				</div>
				{children}
			</div>
		</div>
	);
};

interface TAlertSheetProps {
	id: string;
	question: string;
	detail?: string | null | undefined;
	children: React.ReactNode;
}
