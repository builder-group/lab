import React from 'react';

/** Keeps keyboard focus inside an open dialog and returns it to the opener on close. */
export function useDialogFocus(
	dialogRef: React.RefObject<HTMLElement | null>,
	options: TDialogFocusOptions
): void {
	const { focusKey, initialFocusRef } = options;
	const dismiss = React.useEffectEvent(() => {
		if (options.onEscape) options.onEscape();
		else if (options.dismissible !== false) options.onClose();
	});
	React.useEffect(() => {
		const dialog = dialogRef.current;
		if (dialog == null) return;
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		function trap(event: KeyboardEvent) {
			if (event.key !== 'Tab') return;
			const controls = Array.from(
				dialog?.querySelectorAll<HTMLElement>(
					'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), video[controls], a[href], [tabindex="0"]'
				) ?? []
			).filter((element) => element.getClientRects().length > 0);
			const first = controls[0];
			const last = controls[controls.length - 1];
			if (first == null) {
				event.preventDefault();
				dialog?.focus();
				return;
			}
			const outside = !controls.some((element) => element === document.activeElement);
			if (event.shiftKey && (document.activeElement === first || outside)) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && (document.activeElement === last || outside)) {
				event.preventDefault();
				first.focus();
			}
		}
		function escape(event: KeyboardEvent) {
			if (
				event.key !== 'Escape' ||
				event.defaultPrevented ||
				document.querySelector(':popover-open')
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			dismiss();
		}
		document.addEventListener('keydown', trap, true);
		document.addEventListener('keydown', escape);
		return () => {
			document.removeEventListener('keydown', trap, true);
			document.removeEventListener('keydown', escape);
			if (previous?.isConnected) previous.focus();
		};
	}, [dialogRef]);
	React.useEffect(() => {
		const dialog = dialogRef.current;
		const first = dialog?.querySelector<HTMLElement>('button:not(:disabled)');
		(initialFocusRef?.current ?? first ?? dialog)?.focus();
	}, [dialogRef, focusKey, initialFocusRef]);
}

interface TDialogFocusOptions {
	onClose(): void;
	onEscape?(): void;
	dismissible?: boolean;
	focusKey?: string;
	initialFocusRef?: React.RefObject<HTMLElement | null>;
}
