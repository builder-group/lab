import React from 'react';
import { createPortal } from 'react-dom';

export const Popover: React.FC<{
	anchor: HTMLElement;
	onClose(): void;
	label: string;
	children: React.ReactNode;
	width?: number;
	align?: 'start' | 'end';
	className?: string;
}> = ({ anchor, onClose, label, children, width = 260, align = 'start', className = '' }) => {
	const ref = React.useRef<HTMLDivElement>(null);
	const closeRef = React.useRef(onClose);
	React.useLayoutEffect(() => {
		closeRef.current = onClose;
	}, [onClose]);
	React.useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		let frame: number | undefined;
		function place(): void {
			frame = undefined;
			if (!anchor.isConnected) {
				closeRef.current();
				return;
			}
			const rect = anchor.getBoundingClientRect(),
				box = element?.getBoundingClientRect();
			if (!box || !element) return;
			const actualWidth = Math.min(width, innerWidth - 16);
			const left = align === 'end' ? rect.right - actualWidth : rect.left;
			const top = rect.bottom + 5;
			Object.assign(element.style, {
				left: `${Math.max(8, Math.min(innerWidth - actualWidth - 8, left))}px`,
				top: `${top + box.height > innerHeight - 8 ? Math.max(8, rect.top - box.height - 5) : top}px`,
				width: `${actualWidth}px`,
				visibility: 'visible'
			});
		}
		function schedule(): void {
			if (frame == null) frame = requestAnimationFrame(place);
		}
		place();
		if (!element.contains(document.activeElement))
			element
				.querySelector<HTMLElement>(
					'[autofocus],input:not([disabled]),button:not([disabled]),select:not([disabled])'
				)
				?.focus({ preventScroll: true });
		const outside = (event: PointerEvent): void => {
			if (
				event.target instanceof Node &&
				!element.contains(event.target) &&
				!anchor.contains(event.target)
			)
				closeRef.current();
		};
		const key = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				closeRef.current();
				if (anchor.isConnected) anchor.focus({ preventScroll: true });
			}
		};
		const observer = new ResizeObserver(schedule);
		observer.observe(element);
		observer.observe(anchor);
		document.addEventListener('pointerdown', outside, true);
		document.addEventListener('keydown', key, true);
		document.addEventListener('scroll', schedule, true);
		window.addEventListener('resize', schedule);
		return () => {
			if (frame != null) cancelAnimationFrame(frame);
			observer.disconnect();
			document.removeEventListener('pointerdown', outside, true);
			document.removeEventListener('keydown', key, true);
			document.removeEventListener('scroll', schedule, true);
			window.removeEventListener('resize', schedule);
		};
	}, [anchor, align, width]);
	return createPortal(
		<div
			ref={ref}
			role="dialog"
			aria-label={label}
			className={`popover ${className}`}
			style={{
				position: 'fixed',
				width,
				maxWidth: 'calc(100vw - 16px)',
				maxHeight: 'calc(100vh - 16px)',
				overflowY: 'auto',
				visibility: 'hidden'
			}}
		>
			{children}
		</div>,
		document.body
	);
};
