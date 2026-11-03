import { useFeatureState } from 'feature-react/state';
import { Hand, Image, MousePointer2, PenTool, Plus, Type } from 'lucide-react';
import React from 'react';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import { InsertDragGhost, InsertLibrary } from '@/modules/compose/InsertLibrary';
import { toolKeys, type TComposeTool } from '@/modules/compose/keys';
import type { TInsertItem } from '@/modules/compose/library';
import { PieceIcon } from '@/modules/compose/piece-icons';
import { isEditingTarget } from '@/lib';
import { getCommand } from './commands';
import type { StudioCx } from './StudioCx';

/** Narrow vertical tool rail between the sidebar and the canvas, like Paper's */
export const ToolRail: React.FC<TToolRailProps> = (props) => {
	const { cx } = props;
	const workspace = useFeatureState(cx.$workspace);
	const compose = useFeatureState(cx.$compose);
	return (
		<nav className="mm-tool-rail" aria-label="Tools">
			{workspace === 'compose' ? compose != null ? <ComposeTools compose={compose} /> : null : <DesignTools cx={cx} />}
		</nav>
	);
};

interface TToolRailProps {
	cx: StudioCx;
}

const ComposeTools: React.FC<{ compose: ComposeCx }> = (props) => {
	const { compose } = props;
	const tool = useFeatureState(compose.$tool);
	const isLibraryOpen = useFeatureState(compose.$libraryOpen);
	const inserting = useFeatureState(compose.$inserting);
	const insertButtonRef = React.useRef<HTMLButtonElement>(null);
	const ghost = useInsertDrag(compose);
	const item = (id: TComposeTool, label: string, detail: string, icon: React.ReactNode): React.ReactNode => (
		<RailButton key={id} label={label} detail={detail} shortcut={toolKeys.find((key) => key.tool === id)?.key} isActive={tool === id} onClick={() => compose.armTool(id)}>
			{icon}
		</RailButton>
	);
	// Pieces only the library arms light up its button, like Figma's shape tools behind one slot
	const isLibraryTool = tool === 'windmill' || tool === 'switchback';
	return (
		<>
			{item('select', 'Move', 'Select, drag and turn', <MousePointer2 size={17} strokeWidth={1.6} />)}
			{item('hand', 'Hand', 'Pan the wall', <Hand size={17} strokeWidth={1.6} />)}
			<div className="mm-tool-rail-divider" />
			{item('marble', 'Marble', 'Click to release a new marble', <PieceIcon type="marble" size={18} />)}
			{item('platform', 'Platform', 'Click or drag to place, click a dot to play its note', <PieceIcon type="platform" size={18} />)}
			{item('path', 'Path', 'Draw a rail or tunnel: click points, drag for curves', <PenTool size={17} strokeWidth={1.6} />)}
			<div className="mm-tool-rail-divider" />
			<RailButton
				ref={insertButtonRef}
				label="Insert"
				detail="Windmill, switchback and every piece"
				shortcut="⇧I"
				isActive={isLibraryTool}
				isOpen={isLibraryOpen}
				onClick={() => compose.$libraryOpen.set(!isLibraryOpen)}
			>
				<Plus size={18} strokeWidth={1.6} />
			</RailButton>
			{isLibraryOpen && inserting == null ? <InsertLibrary compose={compose} anchor={insertButtonRef} onStartDrag={ghost.start} /> : null}
			{ghost.state != null && !ghost.state.isOnCanvas ? <InsertDragGhost item={ghost.state.item} position={ghost.state.position} /> : null}
		</>
	);
};

/**
 * Press on a library tile: a release in place arms its tool, a drag past a few pixels takes it out of the
 * popover and drops it where the pointer is released over the wall
 */
function useInsertDrag(compose: ComposeCx): { state: TGhostState | null; start: (item: TInsertItem, event: React.PointerEvent) => void } {
	const [state, setState] = React.useState<TGhostState | null>(null);
	const cleanupRef = React.useRef<(() => void) | null>(null);

	// Escape or a tool change ends the drag in ComposeCx, so the ghost follows its state
	React.useEffect(
		() =>
			compose.$inserting.listen(({ value }) => {
				if (value != null) return;
				cleanupRef.current?.();
				setState(null);
			}),
		[compose]
	);
	React.useEffect(() => () => cleanupRef.current?.(), []);

	function start(item: TInsertItem, event: React.PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		const origin = { x: event.clientX, y: event.clientY };
		let isDragging = false;

		function onMove(move: PointerEvent): void {
			const position = { x: move.clientX, y: move.clientY };
			if (!isDragging) {
				if (Math.hypot(position.x - origin.x, position.y - origin.y) < 4) return;
				isDragging = true;
				compose.beginInsertDrag(item);
			}
			const isOnCanvas = compose.moveInsertDrag(position, move.altKey);
			setState({ item, position, isOnCanvas });
		}
		function onUp(): void {
			remove();
			if (isDragging) compose.endInsertDrag(true);
			else compose.armInsert(item);
			setState(null);
		}
		function remove(): void {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			cleanupRef.current = null;
		}
		function onCancel(): void {
			remove();
			if (isDragging) compose.endInsertDrag(false);
			setState(null);
		}
		cleanupRef.current?.();
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
		cleanupRef.current = remove;
	}

	return { state, start };
}

interface TGhostState {
	item: TInsertItem;
	position: { x: number; y: number };
	/** The canvas shows the piece itself, so the ghost tile hides */
	isOnCanvas: boolean;
}

const DesignTools: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const placing = useFeatureState(cx.design.$placing);

	// V and T switch tools while Design is open; Compose keeps T for tapping hits
	React.useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			if (isEditingTarget(event) || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
			const key = event.key.toLowerCase();
			if (key === 'v') cx.design.$placing.set(null);
			else if (key === 't') getCommand('tool.text').run(cx);
			else return;
			event.preventDefault();
			event.stopPropagation();
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [cx]);

	return (
		<>
			<RailButton label="Move" detail="Select pieces and titles in the preview" shortcut="V" isActive={placing == null} onClick={() => cx.design.$placing.set(null)}>
				<MousePointer2 size={17} strokeWidth={1.6} />
			</RailButton>
			<div className="mm-tool-rail-divider" />
			<RailButton label="Title" detail="Click the wall to place a title" shortcut="T" isActive={placing === 'text'} onClick={() => getCommand('tool.text').run(cx)}>
				<Type size={17} strokeWidth={1.6} />
			</RailButton>
			<RailButton label="Library" detail="Skins and decorations for the pieces" isActive={false} onClick={() => getCommand('tool.asset').run(cx)}>
				<Image size={17} strokeWidth={1.6} />
			</RailButton>
		</>
	);
};

const RailButton: React.FC<TRailButtonProps> = (props) => {
	const { ref, label, detail, shortcut, isActive, isOpen, onClick, children } = props;
	return (
		<button
			ref={ref}
			className="mm-tool-button"
			data-active={isActive}
			data-open={isOpen}
			aria-label={label}
			aria-pressed={isOpen == null ? isActive : undefined}
			aria-expanded={isOpen}
			aria-haspopup={isOpen != null ? 'dialog' : undefined}
			onClick={onClick}
			type="button"
		>
			{children}
			{isOpen === true ? null : (
				<span className="mm-tooltip mm-tooltip-right">
					<span className="font-medium">{label}</span>
					<span className="text-[rgb(255_255_255/0.6)]">{detail}</span>
					{shortcut != null ? <kbd>{shortcut}</kbd> : null}
				</span>
			)}
		</button>
	);
};

interface TRailButtonProps {
	ref?: React.Ref<HTMLButtonElement>;
	label: string;
	detail: string;
	shortcut?: string;
	isActive: boolean;
	/** For a button that opens a popover: whether it is open */
	isOpen?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}
