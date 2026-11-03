import { useFeatureState } from 'feature-react/state';
import { createState } from 'feature-state';
import React from 'react';
import { createPortal } from 'react-dom';

/** The open context menu. One menu is open at a time, like on macOS. */
export const $contextMenu = createState<TContextMenu | null>(null);

/** Opens a context menu at the pointer of a `contextmenu` event */
export function openContextMenu(event: { clientX: number; clientY: number; preventDefault: () => void }, entries: TMenuEntry[]): void {
	event.preventDefault();
	if (!entries.some(isItem)) return;
	$contextMenu.set({ x: event.clientX, y: event.clientY, entries });
}

/** Renders the open context menu; mount once near the root */
export const ContextMenuHost: React.FC = () => {
	const menu = useFeatureState($contextMenu);
	if (menu == null) return null;
	return <MenuList entries={menu.entries} anchor={{ x: menu.x, y: menu.y }} onClose={() => $contextMenu.set(null)} />;
};

/**
 * A macOS-style menu in a portal. It takes keyboard focus so arrow keys, Return and Escape act on the
 * menu and never reach the canvas, and it stays inside the window like a native menu.
 */
export const MenuList: React.FC<TMenuListProps> = (props) => {
	const { entries, anchor, onClose, label } = props;
	const ref = React.useRef<HTMLDivElement>(null);
	const items = entries.filter(isItem);
	const [highlighted, setHighlighted] = React.useState<number | null>(null);
	const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null);

	// Flip and clamp inside the window once the size is known
	React.useLayoutEffect(() => {
		const element = ref.current;
		if (element == null) return;
		const { width, height } = element.getBoundingClientRect();
		const left = anchor.x + width > window.innerWidth - 6 ? Math.max(6, (anchor.alignRight ?? anchor.x) - width) : anchor.x;
		const top = anchor.y + height > window.innerHeight - 6 ? Math.max(6, (anchor.flipY ?? anchor.y) - height) : anchor.y;
		setPosition({ left, top });
	}, [anchor.x, anchor.y, anchor.alignRight, anchor.flipY]);

	// Focus once visible; a hidden element cannot take focus
	const isPlaced = position != null;
	React.useEffect(() => {
		if (isPlaced) ref.current?.focus({ preventScroll: true });
	}, [isPlaced]);

	React.useEffect(() => {
		function onPointerDown(event: PointerEvent): void {
			if (!ref.current?.contains(event.target as Node)) onClose();
		}
		function onBlur(): void {
			onClose();
		}
		window.addEventListener('pointerdown', onPointerDown, true);
		window.addEventListener('blur', onBlur);
		window.addEventListener('resize', onBlur);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, true);
			window.removeEventListener('blur', onBlur);
			window.removeEventListener('resize', onBlur);
		};
	}, [onClose]);

	function run(item: TMenuItem): void {
		if (item.disabled === true) return;
		onClose();
		item.onSelect();
	}

	function move(direction: 1 | -1): void {
		const enabled = items.map((item, index) => (item.disabled === true ? -1 : index)).filter((index) => index >= 0);
		if (!enabled.length) return;
		const current = highlighted == null ? -1 : enabled.indexOf(highlighted);
		const next = current < 0 ? (direction === 1 ? 0 : enabled.length - 1) : (current + direction + enabled.length) % enabled.length;
		setHighlighted(enabled[next] ?? null);
	}

	function onKeyDown(event: React.KeyboardEvent): void {
		event.stopPropagation();
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			move(event.key === 'ArrowDown' ? 1 : -1);
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			const item = highlighted == null ? undefined : items[highlighted];
			if (item != null) run(item);
		} else if (event.key === 'Escape' || event.key === 'Tab') {
			event.preventDefault();
			onClose();
		}
	}

	const indexOf = new Map(items.map((item, index) => [item, index]));
	return createPortal(
		<div
			ref={ref}
			role="menu"
			aria-label={label}
			tabIndex={-1}
			className="mm-menu"
			style={{ left: position?.left ?? anchor.x, top: position?.top ?? anchor.y, visibility: position == null ? 'hidden' : undefined }}
			onKeyDown={onKeyDown}
			onContextMenu={(event) => event.preventDefault()}
			onPointerLeave={() => setHighlighted(null)}
		>
			{entries.map((entry, position) => {
				if (entry === 'separator') {
					return <div key={`separator-${entries.slice(0, position).filter(isItem).length}`} className="mm-menu-separator" role="separator" />;
				}
				if (!isItem(entry)) {
					return (
						<div key={`section-${entry.section}`} className="mm-menu-section">
							{entry.section}
						</div>
					);
				}
				const index = indexOf.get(entry) ?? -1;
				return (
					<button
						key={`${entry.label}-${index}`}
						role={entry.checked != null ? 'menuitemcheckbox' : 'menuitem'}
						aria-checked={entry.checked}
						className="mm-menu-item"
						data-highlighted={highlighted === index}
						disabled={entry.disabled}
						tabIndex={-1}
						onPointerEnter={() => setHighlighted(entry.disabled === true ? null : index)}
						onClick={() => run(entry)}
						type="button"
					>
						<span className="mm-menu-check">{entry.checked === true ? '✓' : ''}</span>
						<span className="truncate">{entry.label}</span>
						{entry.shortcut != null ? <span className="mm-menu-shortcut">{entry.shortcut}</span> : null}
					</button>
				);
			})}
		</div>,
		document.body
	);
};

interface TMenuListProps {
	entries: TMenuEntry[];
	/** Top-left corner in window coordinates; `alignRight` and `flipY` are used when the menu would leave the window */
	anchor: { x: number; y: number; alignRight?: number; flipY?: number };
	onClose: () => void;
	label?: string;
}

export interface TMenuItem {
	label: string;
	shortcut?: string;
	disabled?: boolean;
	/** Shows a check mark column entry, like View menu toggles */
	checked?: boolean;
	onSelect: () => void;
}

export type TMenuEntry = TMenuItem | 'separator' | { section: string };

interface TContextMenu {
	x: number;
	y: number;
	entries: TMenuEntry[];
}

export function isItem(entry: TMenuEntry): entry is TMenuItem {
	return entry !== 'separator' && !('section' in entry);
}

/** Drops leading, trailing and doubled separators left behind by conditional entries */
export function tidyMenu(entries: (TMenuEntry | null | false)[]): TMenuEntry[] {
	const result: TMenuEntry[] = [];
	for (const entry of entries) {
		if (entry == null || entry === false) continue;
		if (entry === 'separator' && (!result.length || result[result.length - 1] === 'separator')) continue;
		result.push(entry);
	}
	if (result[result.length - 1] === 'separator') result.pop();
	return result;
}
