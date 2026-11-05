import { useFeatureState } from 'feature-react/state';
import { Hand, MousePointer2, Plus } from 'lucide-react';
import React from 'react';
import type { TrackCx } from '@/modules/track';
import { InsertDragGhost, InsertLibrary, toolKeys, type TTrackTool } from '@/modules/track';
import { FilmInsert } from '@/modules/film';
import { isEditingTarget } from '@/lib';
import { getCommand } from './commands';
import { hasSongLayer } from './song-layer';
import type { StudioCx } from './StudioCx';
import { useInsertDrag } from './use-insert-drag';

/** Narrow vertical tool rail between the sidebar and the canvas, like Paper's */
export const ToolRail: React.FC<TToolRailProps> = (props) => {
	const { cx } = props;
	const workspace = useFeatureState(cx.$workspace);
	const trackCx = useFeatureState(cx.$trackCx);
	return (
		<nav className="mm-tool-rail" aria-label="Tools" data-quick-help="tools">
			{workspace === 'track' ? trackCx != null ? <TrackTools cx={cx} trackCx={trackCx} /> : null : <FilmTools cx={cx} />}
		</nav>
	);
};

interface TToolRailProps {
	cx: StudioCx;
}

const TrackTools: React.FC<{ cx: StudioCx; trackCx: TrackCx }> = (props) => {
	const { cx, trackCx } = props;
	const history = useFeatureState(cx.$history);
	const tool = useFeatureState(trackCx.$tool);
	const isLibraryOpen = useFeatureState(trackCx.$libraryOpen);
	const inserting = useFeatureState(trackCx.$inserting);
	const insertButtonRef = React.useRef<HTMLButtonElement>(null);
	const ghost = useInsertDrag(trackCx);
	const item = (id: TTrackTool, label: string, detail: string, icon: React.ReactNode): React.ReactNode => (
		<RailButton key={id} label={label} detail={detail} shortcut={toolKeys.find((key) => key.tool === id)?.key} isActive={tool === id} onClick={() => trackCx.armTool(id)}>
			{icon}
		</RailButton>
	);
	// Pieces the library arms light up its button, like Figma's shape tools behind one slot
	const isLibraryTool = tool !== 'select' && tool !== 'hand';
	return (
		<>
			{item('select', 'Move', 'Select, drag and turn', <MousePointer2 size={17} strokeWidth={1.6} />)}
			{item('hand', 'Hand', 'Pan the wall', <Hand size={17} strokeWidth={1.6} />)}
			<div className="mm-tool-rail-divider" />
			<RailButton
				ref={insertButtonRef}
				label="Insert"
				detail="The track, and the song"
				shortcut="⇧I"
				isActive={isLibraryTool}
				isOpen={isLibraryOpen}
				onClick={() => trackCx.$libraryOpen.set(!isLibraryOpen)}
			>
				<Plus size={18} strokeWidth={1.6} />
			</RailButton>
			{isLibraryOpen && inserting == null ? <InsertLibrary trackCx={trackCx} anchor={insertButtonRef} onStartDrag={ghost.start} onAddSong={history?.present != null && hasSongLayer(history.present) ? undefined : () => getCommand('file.importMidi').run(cx)} /> : null}
			{ghost.state != null && !ghost.state.isOnCanvas ? <InsertDragGhost item={ghost.state.item} position={ghost.state.position} /> : null}
		</>
	);
};

const FilmTools: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const placing = useFeatureState(cx.film.$placing);
	const isInsertOpen = useFeatureState(cx.library.$insertOpen);
	const insertButtonRef = React.useRef<HTMLButtonElement>(null);

	// Closes with the workspace, so it doesn't come back open
	React.useEffect(() => () => cx.library.$insertOpen.set(false), [cx]);

	// V and T switch tools and ⇧I opens Insert while Film is open; Track keeps T for tapping hits
	React.useEffect(() => {
		function onKeyDown(event: KeyboardEvent): void {
			if (isEditingTarget(event) || event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.shiftKey) {
				if (event.code !== 'KeyI' && event.code !== 'KeyA') return;
				cx.library.$insertOpen.set(!cx.library.$insertOpen.get());
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			const key = event.key.toLowerCase();
			if (key === 'v') cx.film.$placing.set(null);
			else if (key === 't') getCommand('film.addText').run(cx);
			else return;
			event.preventDefault();
			event.stopPropagation();
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [cx]);

	return (
		<>
			<RailButton label="Move" detail="Select track pieces and titles in the preview" shortcut="V" isActive={placing == null} onClick={() => cx.film.$placing.set(null)}>
				<MousePointer2 size={17} strokeWidth={1.6} />
			</RailButton>
			<div className="mm-tool-rail-divider" />
			<RailButton ref={insertButtonRef} label="Insert" detail="Decor, titles or a light" shortcut="⇧I" isActive={false} isOpen={isInsertOpen} onClick={() => cx.library.$insertOpen.set(!isInsertOpen)}>
				<Plus size={18} strokeWidth={1.6} />
			</RailButton>
			{isInsertOpen ? <FilmInsert
					cx={cx}
					anchor={insertButtonRef}
					onAddTitle={() => getCommand('film.addText').run(cx)}
					onAddLight={() => getCommand('light.add').run(cx)}
				/> : null}
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
