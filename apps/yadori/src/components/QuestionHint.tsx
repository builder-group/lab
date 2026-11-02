import React from 'react';
import { createPortal } from 'react-dom';
import './question-hint.css';

export const QuestionHint: React.FC<TQuestionHintProps> = ({
	label,
	content,
	className = '',
	size = 14,
	variant = 'warning'
}) => {
	const id = React.useId();
	const buttonRef = React.useRef<HTMLButtonElement>(null);
	const contentRef = React.useRef<HTMLDivElement>(null);
	const openTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const hoveredRef = React.useRef(false);
	const pinnedRef = React.useRef(false);
	const dismissedRef = React.useRef(false);
	const [open, setOpen] = React.useState(false);
	const clearTimers = React.useCallback((): void => {
		clearTimeout(openTimerRef.current);
		clearTimeout(closeTimerRef.current);
	}, []);
	const close = React.useCallback((): void => {
		clearTimers();
		pinnedRef.current = false;
		setOpen(false);
	}, [clearTimers]);
	function leave(): void {
		hoveredRef.current = false;
		dismissedRef.current = false;
		clearTimeout(openTimerRef.current);
		clearTimeout(closeTimerRef.current);
		closeTimerRef.current = setTimeout(() => {
			if (
				!pinnedRef.current &&
				!hoveredRef.current &&
				document.activeElement !== buttonRef.current &&
				!contentRef.current?.contains(document.activeElement)
			)
				setOpen(false);
		}, 120);
	}
	React.useEffect(() => () => clearTimers(), [clearTimers]);
	React.useLayoutEffect(() => {
		if (!open) return;
		const element = contentRef.current,
			anchor = buttonRef.current;
		if (!element || !anchor) return;
		let frame: number | undefined;
		function place(): void {
			frame = undefined;
			const rect = anchor?.getBoundingClientRect(),
				box = element?.getBoundingClientRect();
			if (!rect || !box || !element) return;
			const left = Math.max(8, Math.min(innerWidth - box.width - 8, rect.right - box.width));
			const top =
				rect.bottom + box.height + 8 < innerHeight
					? rect.bottom + 7
					: Math.max(8, rect.top - box.height - 7);
			Object.assign(element.style, { left: `${left}px`, top: `${top}px`, visibility: 'visible' });
		}
		function schedule(): void {
			if (frame == null) frame = requestAnimationFrame(place);
		}
		place();
		const observer = new ResizeObserver(schedule);
		observer.observe(element);
		observer.observe(anchor);
		window.addEventListener('resize', schedule);
		document.addEventListener('scroll', schedule, true);
		return () => {
			if (frame != null) cancelAnimationFrame(frame);
			observer.disconnect();
			window.removeEventListener('resize', schedule);
			document.removeEventListener('scroll', schedule, true);
		};
	}, [open, content]);
	React.useEffect(() => {
		if (!open) return;
		const key = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') return;
			const focused = document.activeElement;
			// Let an active editor restore its own draft on Escape instead of stealing the key for a hovered hint.
			if (!(
				focused instanceof HTMLElement &&
				focused.matches('input,textarea,select') &&
				focused !== buttonRef.current
			)) {
				event.preventDefault();
				event.stopPropagation();
			}
			dismissedRef.current = true;
			close();
		};
		const outside = (event: PointerEvent): void => {
			if (
				event.target instanceof Node &&
				!buttonRef.current?.contains(event.target) &&
				!contentRef.current?.contains(event.target)
			)
				close();
		};
		document.addEventListener('keydown', key, true);
		document.addEventListener('pointerdown', outside, true);
		return () => {
			document.removeEventListener('keydown', key, true);
			document.removeEventListener('pointerdown', outside, true);
		};
	}, [open, close]);
	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				className={`question-hint ${variant === 'help' ? 'question-hint-help' : 'question-hint-warning'} ${className}`}
				style={{ width: size, height: size }}
				aria-label={label}
				aria-describedby={open ? id : undefined}
				aria-expanded={open}
				onPointerEnter={() => {
					hoveredRef.current = true;
					clearTimers();
					if (!dismissedRef.current) openTimerRef.current = setTimeout(() => setOpen(true), 350);
				}}
				onPointerLeave={leave}
				onFocus={() => {
					clearTimers();
					dismissedRef.current = false;
					setOpen(true);
				}}
				onBlur={leave}
				onPointerDown={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					clearTimers();
					dismissedRef.current = false;
					pinnedRef.current = !pinnedRef.current;
					setOpen(pinnedRef.current);
				}}
			>
				?
			</button>
			{open &&
				createPortal(
					<div
						ref={contentRef}
						id={id}
						role="tooltip"
						className="question-hint-content"
						style={{ visibility: 'hidden' }}
						onPointerEnter={() => {
							hoveredRef.current = true;
							clearTimers();
						}}
						onPointerLeave={leave}
					>
						{content}
					</div>,
					document.body
				)}
		</>
	);
};
export interface TQuestionHintProps {
	label: string;
	content: React.ReactNode;
	className?: string;
	size?: number;
	variant?: 'help' | 'warning';
}
