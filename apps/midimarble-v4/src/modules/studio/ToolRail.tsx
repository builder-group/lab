import { useFeatureState } from 'feature-react/state';
import { Hand, MousePointer2, PenTool, Plus, Type } from 'lucide-react';
import React from 'react';
import type { ComposeCx } from '@/modules/compose/ComposeCx';
import { InsertDragGhost, InsertLibrary } from '@/modules/compose/InsertLibrary';
import { toolKeys, type TComposeTool } from '@/modules/compose/keys';
import { PieceIcon } from '@/modules/compose/piece-icons';
import { isEditingTarget } from '@/lib';
import { getCommand } from './commands';
import type { StudioCx } from './StudioCx';
import { useInsertDrag } from './use-insert-drag';

/** Narrow vertical tool rail between the sidebar and the canvas, like Paper's */
export const ToolRail: React.FC<TToolRailProps> = (props) => {
	const { cx } = props;
	const workspace = useFeatureState(cx.$workspace);
	const compose = useFeatureState(cx.$compose);
	return (
		<nav className="mm-tool-rail" aria-label="Tools" data-quick-help="tools">
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
	const isLibraryTool = tool === 'windmill' || tool === 'switchback' || tool === 'finish';
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
			{/* The rail holds tools only; the Library is the sidebar's Library tab, also Show Library in ⌘K */}
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
