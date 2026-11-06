import { useFeatureState } from 'feature-react/state';
import { createState } from 'feature-state';
import React from 'react';
import { createPortal } from 'react-dom';

/** The open context menu. One menu is open at a time, like on macOS. */
const $contextMenu = createState<TContextMenu | null>(null);

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
	const { entries, anchor, onClose, onDone = onClose, label, minWidth } = props;
	const ref = React.useRef<HTMLDivElement>(null);
	const items = entries.filter(isItem);
	const [highlighted, setHighlighted] = React.useState<number | null>(null);
	const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null);
	// The item whose submenu is open, with the window rect it opens beside
	const [submenu, setSubmenu] = React.useState<{ index: number; rect: DOMRect } | null>(null);
	const closeSubmenu = React.useCallback(() => {
		setSubmenu(null);
		ref.current?.focus({ preventScroll: true });
	}, []);

	// Flip and clamp inside the window once the size is known
	React.useLayoutEffect(() => {
		const element = ref.current;
		if (element == null) return;
		const { width, height } = element.getBoundingClientRect();
		const left = anchor.x + width > window.innerWidth - 6 ? Math.max(6, (anchor.alignRight ?? anchor.x) - width) : anchor.x;
		const top = anchor.y + height > window.innerHeight - 6 ? Math.max(6, (anchor.flipY ?? anchor.y) - height) : anchor.y;
		setPosition({ left, top });
	}, [anchor.x, anchor.y, anchor.alignRight, anchor.flipY]);

	// The highlighted item stays in view when the arrow keys move through a long, scrolling menu
	React.useEffect(() => {
		if (highlighted != null) ref.current?.querySelector(`[data-index="${highlighted}"]`)?.scrollIntoView?.({ block: 'nearest' });
	}, [highlighted]);

	// Focus once visible; a hidden element cannot take focus
	const isPlaced = position != null;
	React.useEffect(() => {
		if (isPlaced) ref.current?.focus({ preventScroll: true });
	}, [isPlaced]);

	React.useEffect(() => {
		function onPointerDown(event: PointerEvent): void {
			// A press in an open submenu stays inside the menu
			const target = event.target as Element | null;
			if (!ref.current?.contains(target) && target?.closest?.('[data-submenu="true"]') == null) onClose();
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

	function run(item: TMenuItem, element?: Element | null): void {
		if (item.disabled === true) return;
		if (item.submenu != null) {
			openSubmenu(item, element);
			return;
		}
		onDone();
		item.onSelect();
	}

	function openSubmenu(item: TMenuItem, element?: Element | null): void {
		const index = items.indexOf(item);
		const rect = (element ?? ref.current?.querySelector(`[data-index="${index}"]`))?.getBoundingClientRect();
		if (item.submenu == null || item.disabled === true || rect == null) return;
		setSubmenu({ index, rect });
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
		} else if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
			event.preventDefault();
			const item = highlighted == null ? undefined : items[highlighted];
			if (item != null && (event.key !== 'ArrowRight' || item.submenu != null)) run(item);
		} else if (event.key === 'ArrowLeft' && props.isSubmenu === true) {
			event.preventDefault();
			onClose();
		} else if (event.key === 'Escape' || event.key === 'Tab') {
			event.preventDefault();
			onClose();
		}
	}

	const submenuItem = submenu == null ? undefined : items[submenu.index];

	const indexOf = new Map(items.map((item, index) => [item, index]));
	return createPortal(
		<div
			ref={ref}
			role="menu"
			aria-label={label}
			tabIndex={-1}
			className="mm-menu"
			data-submenu={props.isSubmenu === true}
			style={{ left: position?.left ?? anchor.x, top: position?.top ?? anchor.y, minWidth, visibility: position == null ? 'hidden' : undefined }}
			onKeyDown={onKeyDown}
			onContextMenu={(event) => event.preventDefault()}
			// An open submenu keeps its item highlighted, like macOS
			onPointerLeave={() => setHighlighted(submenu?.index ?? null)}
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
						aria-haspopup={entry.submenu != null ? 'menu' : undefined}
						aria-expanded={entry.submenu != null ? submenu?.index === index : undefined}
						className="mm-menu-item"
						data-index={index}
						data-highlighted={highlighted === index}
						disabled={entry.disabled}
						title={entry.title}
						tabIndex={-1}
						onPointerEnter={(event) => {
							setHighlighted(entry.disabled === true ? null : index);
							if (entry.submenu != null) openSubmenu(entry, event.currentTarget);
							else if (submenu != null) closeSubmenu();
						}}
						onClick={(event) => run(entry, event.currentTarget)}
						type="button"
					>
						<span className="mm-menu-check">{entry.checked === true ? '✓' : ''}</span>
						{entry.swatch != null ? <span className="mr-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entry.swatch }} aria-hidden /> : null}
						<span className="truncate">{entry.label}</span>
						{entry.submenu != null ? (
							<span className="mm-menu-shortcut" aria-hidden>
								▸
							</span>
						) : entry.shortcut != null ? (
							<span className="mm-menu-shortcut">{entry.shortcut}</span>
						) : null}
					</button>
				);
			})}
			{submenu != null && submenuItem?.submenu != null ? (
				<MenuList
					key={submenu.index}
					entries={submenuItem.submenu}
					anchor={{ x: submenu.rect.right - 2, y: submenu.rect.top - 5, alignRight: submenu.rect.left + 2, flipY: submenu.rect.bottom + 5 }}
					onClose={closeSubmenu}
					onDone={onDone}
					label={submenuItem.label}
					isSubmenu
				/>
			) : null}
		</div>,
		document.body
	);
};

interface TMenuListProps {
	entries: TMenuEntry[];
	/** Top-left corner in window coordinates; `alignRight` and `flipY` are used when the menu would leave the window */
	anchor: { x: number; y: number; alignRight?: number; flipY?: number };
	onClose: () => void;
	/** Closes the whole menu after an item runs; a submenu gets its parent's, so a choice closes both */
	onDone?: () => void;
	label?: string;
	isSubmenu?: boolean;
	/** At least the width of the control that opened it, like a pop-up button's menu */
	minWidth?: number;
}

export interface TMenuItem {
	label: string;
	/** The native tooltip: more than the label says, such as a problem's detail */
	title?: string;
	shortcut?: string;
	disabled?: boolean;
	/** Shows a check mark column entry, like View menu toggles */
	checked?: boolean;
	/** A color dot before the label, like Finder's tags */
	swatch?: string;
	/** Entries of a submenu that opens beside the item on hover, click or Right Arrow, like Piece ▸ */
	submenu?: TMenuEntry[];
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
