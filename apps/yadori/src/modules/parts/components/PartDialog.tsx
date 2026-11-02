import React from 'react';

export const PartDialog: React.FC<{ children: React.ReactNode; onClose(): void }> = ({
	children,
	onClose
}) => {
	const ref = React.useRef<HTMLDialogElement>(null);
	React.useEffect(() => {
		const dialog = ref.current;
		const previous = document.activeElement;
		dialog?.showModal();
		return () => {
			dialog?.close();
			if (previous instanceof HTMLElement && previous.isConnected)
				previous.focus({ preventScroll: true });
		};
	}, []);
	return (
		<dialog
			ref={ref}
			className="part-details-dialog"
			aria-label="Part details"
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			onClick={(event) => {
				if (event.target === ref.current) onClose();
			}}
		>
			{children}
		</dialog>
	);
};
