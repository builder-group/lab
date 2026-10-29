import { X } from 'lucide-react';
import React from 'react';
import { useDialogFocus } from './use-dialog-focus';

export const Dialog: React.FC<TDialogProps> = (props) => {
	const { children, focusKey, dismissible = true, onClose, onEscape } = props;
	const dialogRef = React.useRef<HTMLElement>(null);
	useDialogFocus(dialogRef, { focusKey, dismissible, onClose, onEscape });

	return (
		<div
			className="modal-backdrop"
			onClick={(event) => {
				if (event.target === event.currentTarget && dismissible) onClose();
			}}
		>
			<section
				ref={dialogRef}
				className="modal"
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby="modal-title"
			>
				<button
					className="modal-close icon-button"
					aria-label="Close dialog"
					disabled={!dismissible}
					onClick={onClose}
				>
					<X size={17} />
				</button>
				{children}
			</section>
		</div>
	);
};

interface TDialogProps {
	children: React.ReactNode;
	focusKey: string;
	dismissible?: boolean;
	onClose: () => void;
	onEscape?: () => void;
}
