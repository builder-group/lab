import { CircleHelp } from 'lucide-react';
import React from 'react';
import './ContextHelp.css';

/** Keeps contextual instructions available without covering the workspace. */
export const ContextHelp: React.FC<TContextHelpProps> = (props) => {
	const { label, children, placement = 'above' } = props;
	const id = React.useId();
	const popoverRef = React.useRef<HTMLDivElement>(null);
	const [open, setOpen] = React.useState(false);
	function position(event: React.MouseEvent<HTMLButtonElement>) {
		const popover = popoverRef.current;
		if (popover == null) return;
		const anchor = event.currentTarget.getBoundingClientRect();
		const width = Math.min(300, window.innerWidth - 24);
		const above = placement === 'above' && anchor.top > 180;
		popover.style.width = `${width}px`;
		popover.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))}px`;
		popover.style.top = `${above ? anchor.top - 8 : anchor.bottom + 8}px`;
		popover.style.transform = above ? 'translateY(-100%)' : 'none';
	}
	return (
		<>
			<button
				type="button"
				className="context-help-trigger"
				aria-label={label}
				title={label}
				aria-expanded={open}
				aria-controls={id}
				popoverTarget={id}
				onClick={position}
			>
				<CircleHelp size={14} />
			</button>
			<div
				ref={popoverRef}
				id={id}
				popover="auto"
				role="dialog"
				aria-label={label}
				className="context-help-popover"
				onToggle={(event) => setOpen(event.newState === 'open')}
			>
				<strong>{label}</strong>
				{children}
			</div>
		</>
	);
};

interface TContextHelpProps {
	label: string;
	children: React.ReactNode;
	placement?: 'above' | 'below';
}
