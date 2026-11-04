import React from 'react';
import { MenuList, type TMenuEntry } from './Menu';

/** Button with a pull-down menu styled like a macOS menu */
export const MenuButton: React.FC<TMenuButtonProps> = (props) => {
	const { label, title, items, className, align = 'left', onOpen } = props;
	const [anchor, setAnchor] = React.useState<{ x: number; y: number; alignRight: number; flipY: number } | null>(null);
	const buttonRef = React.useRef<HTMLButtonElement>(null);
	const close = React.useCallback(() => setAnchor(null), []);

	function toggle(): void {
		const rect = buttonRef.current?.getBoundingClientRect();
		if (anchor != null || rect == null) {
			setAnchor(null);
			return;
		}
		onOpen?.();
		setAnchor({ x: align === 'right' ? rect.right - 200 : rect.left, y: rect.bottom + 4, alignRight: rect.right, flipY: rect.top - 4 });
	}

	return (
		<>
			<button
				ref={buttonRef}
				className={className ?? 'mm-icon-button'}
				data-active={anchor != null}
				aria-haspopup="menu"
				aria-expanded={anchor != null}
				aria-label={title}
				// Opening on pointer down matches native pull-downs; the click that follows is ignored
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					event.preventDefault();
					event.stopPropagation();
					toggle();
				}}
				onKeyDown={(event) => {
					if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
						event.preventDefault();
						toggle();
					}
				}}
				title={title}
				type="button"
			>
				{label}
			</button>
			{anchor != null ? <MenuList entries={items} anchor={anchor} onClose={close} label={title} /> : null}
		</>
	);
};

interface TMenuButtonProps {
	label: React.ReactNode;
	title: string;
	items: TMenuEntry[];
	className?: string;
	align?: 'left' | 'right';
	onOpen?: () => void;
}
