import { Box, Eye, EyeOff, Link2, LockKeyhole, UnlockKeyhole } from 'lucide-react';
import React from 'react';
import type { TSceneObject } from '../project';
import type { TObjectNavigationKey } from './outliner';
import { pointerGesture } from './pointer-gesture';

export const SceneObjectRow: React.FC<TSceneObjectRowProps> = (props) => {
	const {
		object,
		selected,
		tabStop,
		onSelect,
		onUpdate,
		onDuplicate,
		onDelete,
		onLink,
		onFrame,
		onNavigate,
		onCollapse,
		onDragObject,
		onDropObject
	} = props;
	const [renaming, setRenaming] = React.useState(false);
	const [context, setContext] = React.useState<{ left: number; top: number } | null>(null);
	const buttonRef = React.useRef<HTMLButtonElement>(null);
	const menuRef = React.useRef<HTMLDivElement>(null);
	const ghostRef = React.useRef<HTMLDivElement>(null);
	const cancelDragRef = React.useRef<(() => void) | null>(null);
	const suppressClickRef = React.useRef(false);

	if (context != null && !selected) setContext(null);

	// MARK: - Actions
	const openContext = React.useCallback(
		(x: number, y: number) => {
			onSelect(object.id);
			setContext({
				left: Math.max(8, Math.min(x, window.innerWidth - 195)),
				top: Math.max(8, Math.min(y, window.innerHeight - 235))
			});
		},
		[object.id, onSelect]
	);
	const runContextAction = React.useCallback((action: () => void) => {
		setContext(null);
		buttonRef.current?.focus();
		action();
	}, []);
	const dragObject = React.useCallback(
		(event: React.PointerEvent<HTMLButtonElement>) => {
			if (event.button !== 0 || object.locked || onDropObject == null) return;
			cancelDragRef.current?.();
			const start = { x: event.clientX, y: event.clientY };
			let dragging = false;
			let hovered: HTMLElement | null = null;
			function targetAt(x: number, y: number) {
				return document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-note-id]') ?? null;
			}
			cancelDragRef.current = pointerGesture(event.currentTarget, event.pointerId, {
				move(next) {
					if (!dragging && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 5) return;
					if (!dragging) {
						dragging = true;
						onDragObject?.(object.id);
						if (ghostRef.current) ghostRef.current.hidden = false;
					}
					next.preventDefault();
					const target = targetAt(next.clientX, next.clientY);
					if (hovered !== target) {
						hovered?.removeAttribute('data-object-drop');
						hovered = target;
						hovered?.setAttribute('data-object-drop', 'true');
					}
					if (ghostRef.current)
						ghostRef.current.style.transform = `translate(${next.clientX + 14}px,${next.clientY + 14}px)`;
				},
				end(cancelled) {
					const noteId = !cancelled && dragging ? hovered?.dataset['noteId'] : null;
					hovered?.removeAttribute('data-object-drop');
					if (ghostRef.current) ghostRef.current.hidden = true;
					cancelDragRef.current = null;
					if (dragging) {
						suppressClickRef.current = true;
						setTimeout(() => {
							suppressClickRef.current = false;
						}, 0);
						onDragObject?.(null);
					}
					if (noteId) onDropObject(object.id, noteId);
				}
			});
		},
		[object, onDragObject, onDropObject]
	);

	// MARK: - Effects
	React.useEffect(() => () => cancelDragRef.current?.(), []);
	React.useEffect(() => {
		if (selected) buttonRef.current?.scrollIntoView({ block: 'nearest' });
	}, [selected]);
	React.useEffect(() => {
		if (context == null) return;
		menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
		function outside(event: PointerEvent) {
			if (event.target instanceof Node && !menuRef.current?.contains(event.target))
				setContext(null);
		}
		function escape(event: KeyboardEvent) {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			setContext(null);
			buttonRef.current?.focus();
		}
		document.addEventListener('pointerdown', outside, true);
		document.addEventListener('keydown', escape, true);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			document.removeEventListener('keydown', escape, true);
		};
	}, [context, selected]);

	return (
		<div
			className={`tree-object ${selected ? 'selected' : ''} ${object.disabled ? 'disabled' : ''} ${object.binding || object.trajectoryAnchor ? 'linked' : ''}`}
			role="treeitem"
			aria-selected={selected}
			aria-level={2}
			draggable={false}
			onContextMenu={(event) => {
				event.preventDefault();
				openContext(event.clientX, event.clientY);
			}}
		>
			{renaming ? (
				<div className="tree-select">
					<Box size={12} />
					<input
						aria-label="Rename object"
						autoFocus
						defaultValue={object.name}
						maxLength={100}
						onBlur={(event) => {
							const name = event.target.value.trim();
							if (name && name !== object.name && !object.locked) onUpdate(object.id, { name });
							setRenaming(false);
						}}
						onKeyDown={(event) => {
							if (event.nativeEvent.isComposing || !['Escape', 'Enter'].includes(event.key)) return;
							event.stopPropagation();
							if (event.key === 'Escape') event.currentTarget.value = object.name;
							if (event.key === 'Escape' || event.key === 'Enter') {
								event.preventDefault();
								event.currentTarget.blur();
								requestAnimationFrame(() => buttonRef.current?.focus());
							}
						}}
					/>
				</div>
			) : (
				<button
					ref={buttonRef}
					className="tree-select"
					draggable={false}
					onPointerDown={dragObject}
					data-object-id={object.id}
					tabIndex={tabStop ? 0 : -1}
					onClick={(event) => {
						if (suppressClickRef.current) event.preventDefault();
						else onSelect(object.id);
					}}
					onDoubleClick={() => {
						if (!object.locked) setRenaming(true);
					}}
					title={`${object.name} · ${object.trajectoryAnchor ? 'Follows trajectory time' : object.binding ? 'Follows MIDI note' : 'World object'} · drag onto a timeline note to link`}
					onKeyDown={(event) => {
						if (event.key === 'F2' && !object.locked) {
							event.preventDefault();
							setRenaming(true);
							return;
						}
						if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
							event.preventDefault();
							const rect = event.currentTarget.getBoundingClientRect();
							openContext(rect.left + 20, rect.bottom);
							return;
						}
						if (event.key === 'ArrowLeft') {
							event.preventDefault();
							event.stopPropagation();
							onCollapse();
							return;
						}
						if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
						event.preventDefault();
						event.stopPropagation();
						onNavigate(object.id, event.key as TObjectNavigationKey);
					}}
				>
					<Box size={12} />
					<span>{object.name}</span>
				</button>
			)}
			{(object.binding || object.trajectoryAnchor) && (
				<span
					title={
						object.trajectoryAnchor
							? `Trajectory at ${object.trajectoryAnchor.time.toFixed(2)}s`
							: 'Linked to MIDI note'
					}
				>
					<Link2 className="linked-icon" size={11} />
				</span>
			)}
			<button
				className="tree-action"
				aria-label={`${object.locked ? 'Unlock' : 'Lock'} ${object.name}`}
				title="Lock editing"
				onClick={() => onUpdate(object.id, { locked: !object.locked })}
			>
				{object.locked ? <LockKeyhole size={11} /> : <UnlockKeyhole size={11} />}
			</button>
			<button
				className="tree-action"
				aria-label={`${object.disabled ? 'Enable' : 'Disable'} ${object.name}`}
				title="Enable in scene and simulation"
				onClick={() => onUpdate(object.id, { disabled: !object.disabled })}
			>
				{object.disabled ? <EyeOff size={12} /> : <Eye size={12} />}
			</button>
			{context != null && selected && (
				<div
					ref={menuRef}
					className="tree-context"
					role="menu"
					aria-label={`${object.name} actions`}
					style={context}
					onKeyDown={(event) => {
						if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
						event.preventDefault();
						event.stopPropagation();
						const buttons = Array.from(
							event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
						);
						const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
						let next = Math.max(
							0,
							Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))
						);
						if (event.key === 'Home') next = 0;
						if (event.key === 'End') next = buttons.length - 1;
						buttons[next]?.focus();
					}}
				>
					<button role="menuitem" onClick={() => runContextAction(() => onFrame(object.id))}>
						Frame selected <kbd>F</kbd>
					</button>
					<button
						role="menuitem"
						disabled={object.locked}
						onClick={() => runContextAction(() => setRenaming(true))}
					>
						Rename <kbd>F2</kbd>
					</button>
					<button role="menuitem" onClick={() => runContextAction(onDuplicate)}>
						Duplicate <kbd>⇧D</kbd>
					</button>
					<button role="menuitem" disabled={object.locked} onClick={() => runContextAction(onLink)}>
						Link to a note… <kbd>L</kbd>
					</button>
					<button
						role="menuitem"
						disabled={object.locked}
						onClick={() => runContextAction(onDelete)}
					>
						Delete
					</button>
					<button
						role="menuitem"
						onClick={() => runContextAction(() => buttonRef.current?.focus())}
					>
						Close menu
					</button>
				</div>
			)}
			<div ref={ghostRef} className="object-drag-ghost" hidden aria-hidden="true">
				{object.name}
			</div>
		</div>
	);
};

interface TSceneObjectRowProps {
	object: TSceneObject;
	selected: boolean;
	tabStop: boolean;
	onSelect: (id: string) => void;
	onUpdate: (id: string, patch: Partial<TSceneObject>) => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onLink: () => void;
	onFrame: (id?: string) => void;
	onNavigate: (id: string, key: TObjectNavigationKey) => void;
	onCollapse: () => void;
	onDragObject?: (id: string | null) => void;
	onDropObject?: (objectId: string, noteId: string) => void;
}
