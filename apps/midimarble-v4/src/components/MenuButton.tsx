import React from 'react';

/** Button with a pull-down menu styled like a macOS menu */
export const MenuButton: React.FC<TMenuButtonProps> = (props) => {
	const { label, title, items, className } = props;
	const [open, setOpen] = React.useState(false);
	const rootRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (!open) return;
		function onPointerDown(event: PointerEvent): void {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		}
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key === 'Escape') setOpen(false);
		}
		window.addEventListener('pointerdown', onPointerDown);
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown);
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [open]);

	return (
		<div ref={rootRef} className="relative">
			<button
				className={className ?? 'mm-icon-button'}
				data-active={open}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				title={title}
				type="button"
			>
				{label}
			</button>
			{open ? (
				<div
					role="menu"
					className="absolute top-full left-0 z-50 mt-1 min-w-[200px] rounded-[8px] bg-[var(--content-raised)] p-[5px] backdrop-blur-xl"
					style={{ boxShadow: 'var(--shadow-popover)' }}
				>
					{items.map((item, position) =>
						item === 'separator' ? (
							<div key={`separator-${items.slice(0, position).filter((entry) => entry !== 'separator').length}`} className="mx-2 my-1 h-px bg-[var(--separator)]" />
						) : (
							<button
								key={item.label}
								role="menuitem"
								className="flex h-[22px] w-full items-center justify-between gap-6 rounded-[4px] px-2 text-left hover:bg-[var(--accent)] hover:text-white disabled:opacity-40"
								disabled={item.disabled}
								onClick={() => {
									setOpen(false);
									item.onSelect();
								}}
								type="button"
							>
								<span>{item.label}</span>
								{item.shortcut != null ? <span className="opacity-60">{item.shortcut}</span> : null}
							</button>
						)
					)}
				</div>
			) : null}
		</div>
	);
};

interface TMenuButtonProps {
	label: React.ReactNode;
	title: string;
	items: (TMenuItem | 'separator')[];
	className?: string;
}

export interface TMenuItem {
	label: string;
	shortcut?: string;
	disabled?: boolean;
	onSelect: () => void;
}
