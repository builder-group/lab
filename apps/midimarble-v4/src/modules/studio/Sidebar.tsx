import { useFeatureState } from 'feature-react/state';
import { Anchor, AudioLines, Bookmark, ChevronRight, Eye, EyeOff, Folder, Lock, LockOpen, Music, Plus, Type, Video } from 'lucide-react';
import React from 'react';
import { MenuButton, openContextMenu, RenameField } from '@/components';
import { attachState } from '@/modules/compose/attach-edit';
import { PieceIcon } from '@/modules/compose/piece-icons';
import { badgeStatus, StatusIcon } from '@/modules/compose/status';
import { DesignLibrary } from '@/modules/design/DesignLibrary';
import { shotKindLabel } from '@/modules/design/shots';
import type { TEntity, TProject } from '@/modules/project';
import { soundsHit, type THitResult, type TResolvedPiece } from '@/modules/simulation';
import { addMenu } from './add-menu';
import { commandItem } from './commands';
import { formatTime } from './format';
import { laneMenu, pieceMenu } from './menus';
import { buildOutline, isFilmRow, isSelectableRow, type TOutlineRow } from './outline';
import { PieceLibrary } from './PieceLibrary';
import { $sidebarTabs, setSidebarTab, type TSidebarTab } from './sidebar-state';
import type { StudioCx, TWorkspace } from './StudioCx';

/**
 * Full-height sidebar after Paper and Figma: the project, the Compose and Film switch, then the Layers and
 * Library tabs like Figma's Layers and Assets. Each workspace remembers its tab.
 */
export const Sidebar: React.FC<TSidebarProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const workspace = useFeatureState(cx.$workspace);
	const tabs = useFeatureState($sidebarTabs);
	const project = history?.present;
	if (project == null) return null;
	const tab = tabs[workspace];

	return (
		<aside className="mm-sidebar flex w-[248px] shrink-0 flex-col" aria-label="Sidebar">
			<ProjectHeader cx={cx} project={project} />
			<div className="px-3 pb-1">
				<div className="mm-segmented flex w-full" role="tablist" aria-label="Workspace" data-quick-help="workspace">
					{workspaces.map((item) => (
						<button
							key={item.id}
							className="flex-1"
							data-active={workspace === item.id}
							onClick={() => cx.$workspace.set(item.id)}
							role="tab"
							aria-selected={workspace === item.id}
							data-hint-anchor={item.id === 'design' ? 'film' : undefined}
							title={`${item.label} (${item.shortcut})`}
							type="button"
						>
							{item.label}
						</button>
					))}
				</div>
			</div>
			<div className="mm-sidebar-tabs">
				<div className="flex items-center gap-0.5" role="tablist" aria-label="Sidebar">
					{sidebarTabs.map((item) => (
						<button
							key={item.id}
							id={`sidebar-tab-${item.id}`}
							className="mm-sidebar-tab"
							data-active={tab === item.id}
							onClick={() => setSidebarTab(workspace, item.id)}
							role="tab"
							aria-selected={tab === item.id}
							aria-controls={`sidebar-panel-${item.id}`}
							data-quick-help={item.id}
							type="button"
						>
							{item.label}
						</button>
					))}
				</div>
				{tab === 'layers' ? <MenuButton className="mm-icon-button !h-6 !w-6" label={<Plus size={14} strokeWidth={1.8} />} title="Add" items={addMenu(cx)} /> : null}
			</div>
			<div id={`sidebar-panel-${tab}`} role="tabpanel" aria-labelledby={`sidebar-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
				{tab === 'layers' ? (
					<Layers cx={cx} project={project} workspace={workspace} />
				) : workspace === 'compose' ? (
					<PieceLibrary cx={cx} />
				) : (
					<DesignLibrary cx={cx} project={project} />
				)}
			</div>
		</aside>
	);
};

interface TSidebarProps {
	cx: StudioCx;
}

const workspaces: { id: TWorkspace; label: string; shortcut: string }[] = [
	{ id: 'compose', label: 'Compose', shortcut: '⌘1' },
	{ id: 'design', label: 'Film', shortcut: '⌘2' }
];

const sidebarTabs: { id: TSidebarTab; label: string }[] = [
	{ id: 'layers', label: 'Layers' },
	{ id: 'library', label: 'Library' }
];

/** Project name, renamed in place with a double-click like a Finder title */
const ProjectHeader: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const [isRenaming, setIsRenaming] = React.useState(false);
	return (
		<div className="flex h-[40px] shrink-0 items-center gap-2 px-4">
			{isRenaming ? (
				<RenameField
					value={project.title}
					onDone={(title) => {
						setIsRenaming(false);
						if (title != null && title !== project.title) cx.execute([{ type: 'setTitle', title }]);
					}}
				/>
			) : (
				<span className="min-w-0 flex-1 truncate font-semibold" title="Double-click to rename" onDoubleClick={() => setIsRenaming(true)}>
					{project.title}
				</span>
			)}
		</div>
	);
};

// MARK: - Layers

/**
 * The project's outline like Figma UI3's layer list, the same in both workspaces. Rows that also have a
 * timeline track carry the track glyph and share its selection. Camera, shots and titles belong to Film, so a
 * click on one in Compose opens Film. Up and Down move the selection, Left and Right fold a group.
 */
const Layers: React.FC<{ cx: StudioCx; project: TProject; workspace: TWorkspace }> = (props) => {
	const { cx, project, workspace } = props;
	const selection = useFeatureState(cx.$selection);
	const renaming = useFeatureState(cx.$renaming);
	const result = useFeatureState(cx.simulation.$result);
	const hidden = useFeatureState(cx.$hidden);
	const locked = useFeatureState(cx.$locked);
	const [collapsed, setCollapsed] = React.useState<string[]>([]);
	const treeRef = React.useRef<HTMLDivElement>(null);
	const wasRenamingRef = React.useRef(false);

	const pieceResults = React.useMemo(() => new Map((result?.pieces ?? []).map((piece) => [piece.entityId, piece])), [result]);
	const hitResults = React.useMemo(() => new Map((result?.hits ?? []).flatMap((hit) => (hit.pieceEntityId == null ? [] : [[hit.pieceEntityId, hit] as const]))), [result]);
	const rows = React.useMemo(() => buildOutline(project, { collapsed }), [project, collapsed]);
	const isFilm = workspace === 'design';
	// Rows that Shift ranges and the arrow keys visit; Compose's arrows stay out of the Film rows
	const order = rows.filter((row) => isSelectableRow(row) && (isFilm || !isFilmRow(row))).map((row) => row.id);
	const selectedSet = new Set(selection);
	const selectedLanes = new Set(selection.flatMap((key) => (key.startsWith('hit:') ? [key.split(':')[1] ?? ''] : [])));

	function isSelected(row: TOutlineRow): boolean {
		// A group such as Free Pieces only gathers rows; like Figma only the selected rows are tinted, not their group
		if (row.kind === 'group') return false;
		return selectedSet.has(row.id);
	}

	// The children of a selected marble or camera and a marble whose hits are selected get the lighter tint
	function isInSelection(row: TOutlineRow): boolean {
		if (row.kind === 'marble') return selectedLanes.has(row.lane.id);
		return row.parentId != null && selectedSet.has(row.parentId);
	}

	const isTinted = (row: TOutlineRow | undefined): boolean => row != null && (isSelected(row) || isInSelection(row));

	// Return focus to the list after a rename, like Finder, so the arrow keys keep working
	React.useEffect(() => {
		if (wasRenamingRef.current && renaming == null) treeRef.current?.focus({ preventScroll: true });
		wasRenamingRef.current = renaming != null && rows.some((row) => row.id === renaming);
	}, [renaming, rows]);

	// A selection made elsewhere, such as a track in the timeline, scrolls its row into view like Figma
	const first = selection[0];
	React.useEffect(() => {
		if (first == null) return;
		treeRef.current?.querySelector(`[data-id="${CSS.escape(first)}"]`)?.scrollIntoView({ block: 'nearest' });
	}, [first]);

	function toggleGroup(groupKey: string, isOpen?: boolean): void {
		setCollapsed((current) => {
			const open = isOpen ?? current.includes(groupKey);
			return open ? current.filter((item) => item !== groupKey) : [...current, groupKey];
		});
	}

	/** Click selects, ⌘-click toggles and Shift-click selects the range of rows, like Figma's layers and Finder */
	function select(row: TOutlineRow, event?: React.MouseEvent): void {
		if (!isFilm && isFilmRow(row)) cx.$workspace.set('design');
		const current = cx.$selection.get();
		if (row.kind === 'group') {
			const isAdding = event?.metaKey === true || event?.shiftKey === true;
			cx.$selection.set(isAdding ? [...current.filter((id) => !row.childIds.includes(id)), ...row.childIds] : row.childIds);
			return;
		}
		const anchor = current[0];
		if (event?.shiftKey === true && anchor != null && order.includes(anchor) && order.includes(row.id)) {
			const from = Math.min(order.indexOf(anchor), order.indexOf(row.id));
			const to = Math.max(order.indexOf(anchor), order.indexOf(row.id));
			// The first selected row stays the anchor for the next Shift-click
			cx.$selection.set([anchor, ...order.slice(from, to + 1).filter((item) => item !== anchor)]);
			return;
		}
		if (event?.shiftKey === true || event?.metaKey === true) {
			cx.$selection.set(current.includes(row.id) ? current.filter((item) => item !== row.id) : [...current, row.id]);
			return;
		}
		// Marbles and pieces are brought into view on the wall
		if (row.kind === 'marble' || row.kind === 'piece') cx.reveal([row.id]);
		else cx.$selection.set([row.id]);
	}

	function onKeyDown(event: React.KeyboardEvent): void {
		if (event.target !== treeRef.current || event.metaKey || event.ctrlKey || event.altKey) return;
		const row = rows.find((item) => item.id === selection[0]);
		const index = order.indexOf(selection[0] ?? '');
		const groupKey = row != null && 'groupKey' in row ? row.groupKey : null;
		const isOpenGroup = row != null && 'isOpen' in row && row.isOpen && (!('hasChildren' in row) || row.hasChildren);
		let handled = true;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			const nextId = order[index < 0 ? 0 : Math.min(order.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
			const next = rows.find((item) => item.id === nextId);
			if (next != null) select(next);
		} else if (event.key === 'ArrowLeft' && row != null) {
			const parent = rows.find((item) => item.id === row.parentId);
			if (groupKey != null && isOpenGroup) toggleGroup(groupKey, false);
			else if (parent != null && isSelectableRow(parent)) select(parent);
			else if (parent != null && 'groupKey' in parent) toggleGroup(parent.groupKey, false);
		} else if (event.key === 'ArrowRight' && groupKey != null) {
			toggleGroup(groupKey, true);
		} else if (event.key === 'Enter' && row != null && canRename(row)) {
			cx.$renaming.set(row.id);
		} else {
			handled = false;
		}
		if (!handled) return;
		// Keep the studio's arrow and Return shortcuts from also acting on the canvas and timeline
		event.preventDefault();
		event.stopPropagation();
	}

	function openMenu(row: TOutlineRow, event: React.MouseEvent): void {
		if (!isTinted(row) || row.kind === 'group') select(row);
		if (row.kind === 'marble') openContextMenu(event, laneMenu(cx, row.lane));
		else if (row.kind === 'piece') openContextMenu(event, pieceMenu(cx));
		else if (row.kind === 'song') openContextMenu(event, [{ section: 'Song' }, commandItem(cx, 'file.replaceSong'), commandItem(cx, 'file.removeSong')]);
		else if (row.kind === 'camera' || row.kind === 'shot') openContextMenu(event, [commandItem(cx, 'camera.addShot'), ...(row.kind === 'shot' ? [commandItem(cx, 'edit.delete')] : [])]);
		else event.preventDefault();
	}

	return (
		<section aria-label="Layers" className="flex min-h-0 flex-1 flex-col">
			<div ref={treeRef} role="tree" aria-label="Layers" aria-multiselectable tabIndex={0} className="mm-layers min-h-0 flex-1 overflow-y-auto pb-3" onKeyDown={onKeyDown}>
				{rows.map((row, index) => {
					// Like Figma, adjacent highlighted rows join into one block
					const joins = { top: isTinted(row) && isTinted(rows[index - 1]), bottom: isTinted(row) && isTinted(rows[index + 1]) };
					const common = {
						row,
						isSelected: isSelected(row),
						isInSelection: !isSelected(row) && isInSelection(row),
						joins,
						hasTrack: row.track != null && (row.track !== 'camera' || isFilm),
						onClick: (event: React.MouseEvent) => select(row, event),
						onContextMenu: (event: React.MouseEvent) => openMenu(row, event)
					};
					if (row.kind === 'piece') {
						return (
							<PieceRow
								key={row.id}
								{...common}
								cx={cx}
								piece={row.piece}
								isRenaming={renaming === row.id}
								isHidden={hidden.includes(row.id)}
								isLocked={locked.includes(row.id)}
								resolved={pieceResults.get(row.id)}
								hit={hitResults.get(row.id)}
							/>
						);
					}
					return <OutlineRow key={row.id} {...common} cx={cx} isRenaming={renaming === row.id} onToggle={'groupKey' in row ? () => toggleGroup(row.groupKey) : undefined} />;
				})}
			</div>
		</section>
	);
};

interface TRowProps {
	row: TOutlineRow;
	isSelected: boolean;
	isInSelection: boolean;
	joins: TJoins;
	hasTrack: boolean;
	onClick: (event: React.MouseEvent) => void;
	onContextMenu: (event: React.MouseEvent) => void;
}

function canRename(row: TOutlineRow): boolean {
	return row.kind === 'marble' || row.kind === 'piece' || row.kind === 'title';
}

/** Every row except pieces: the song, marbles, groups, the camera, shots and titles */
const OutlineRow: React.FC<TRowProps & { cx: StudioCx; isRenaming: boolean; onToggle?: () => void }> = (props) => {
	const { cx, row, isSelected, isInSelection, joins, hasTrack, isRenaming, onToggle, onClick, onContextMenu } = props;
	const view = outlineRowView(row);

	function rename(value: string | null): void {
		cx.$renaming.set(null);
		if (value == null || value === view.label) return;
		if (row.kind === 'marble') cx.execute([{ type: 'upsertLane', lane: { ...row.lane, name: value } }]);
		else if (row.kind === 'title') cx.execute([{ type: 'upsertEntity', entity: { ...row.entity, name: value } }]);
	}

	return (
		<LayerRow
			id={row.id}
			depth={row.depth}
			isSelected={isSelected}
			isInSelection={isInSelection}
			joins={joins}
			isOpen={view.isOpen}
			onToggle={onToggle}
			icon={view.icon}
			label={view.label}
			title={view.title}
			isRenaming={isRenaming}
			onRename={rename}
			meta={
				view.time != null || hasTrack ? (
					<>
						{view.time != null ? <span>{formatShortTime(view.time)}</span> : null}
						{hasTrack ? <TrackGlyph /> : null}
					</>
				) : undefined
			}
			onClick={onClick}
			onDoubleClick={() => {
				if (canRename(row)) cx.$renaming.set(row.id);
			}}
			onContextMenu={onContextMenu}
		/>
	);
};

/** Icon, name, fold state and quiet time of a row */
function outlineRowView(row: TOutlineRow): { icon: React.ReactNode; label: string; title?: string; isOpen?: boolean; time?: number } {
	switch (row.kind) {
		case 'song': {
			const isRecording = row.source.kind === 'audio';
			return {
				icon: isRecording ? <AudioLines size={14} strokeWidth={1.75} /> : <Music size={14} strokeWidth={1.75} />,
				label: row.source.name,
				title: isRecording ? 'Song · Recording' : 'Song · MIDI'
			};
		}
		case 'marble':
			return { icon: <span className="mm-layer-chip" style={{ background: row.lane.color }} />, label: row.lane.name, isOpen: row.hasChildren ? row.isOpen : undefined };
		case 'group':
			return { icon: <Folder size={14} strokeWidth={1.75} />, label: row.label, isOpen: row.isOpen };
		case 'camera':
			return { icon: <Video size={14} strokeWidth={1.75} />, label: 'Camera', isOpen: row.hasChildren ? row.isOpen : undefined };
		case 'shot':
			return { icon: <Bookmark size={13} strokeWidth={1.75} />, label: shotKindLabel(row.shot.kind), time: row.shot.time };
		case 'title':
			return { icon: <Type size={14} strokeWidth={1.75} />, label: row.entity.name ?? row.entity.components.wallText?.text ?? 'Title' };
		case 'piece':
			return { icon: null, label: row.piece.name ?? '' };
	}
}

/** A track with a keyframe: the row also has a track in the timeline, like Final Cut's timeline index */
const TrackGlyph: React.FC = () => (
	<svg className="mm-layer-track" width={12} height={12} viewBox="0 0 12 12" role="img" aria-label="In the timeline">
		<title>In the timeline</title>
		<path d="M0.5 6h3M8.5 6h3" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" />
		<path d="M6 3.2 8.8 6 6 8.8 3.2 6z" fill="currentColor" />
	</svg>
);

const PieceRow: React.FC<
	TRowProps & {
		cx: StudioCx;
		piece: TEntity;
		isRenaming: boolean;
		isHidden: boolean;
		isLocked: boolean;
		resolved: TResolvedPiece | undefined;
		hit: THitResult | undefined;
	}
> = (props) => {
	const { cx, row, piece, isSelected, isInSelection, joins, isRenaming, isHidden, isLocked, resolved, hit, onClick, onContextMenu } = props;
	const type = piece.components.piece?.type ?? 'platform';
	const name = piece.name ?? type;
	const link = piece.components.hitLink;
	const isLinked = soundsHit(type, link);
	// A piece that follows a moment names it, as the inspector header does: "Follows Marble 1 at 0:03.2"
	const project = cx.project;
	const attach = link != null && !isLinked && project != null ? attachState(project, piece) : null;
	const followLabel =
		attach?.kind === 'anchored' ? `Follows ${project?.music.lanes.find((lane) => lane.id === attach.laneId)?.name ?? 'a marble'} at ${formatTime(attach.time)}` : null;
	// Like Xcode's navigator, only problems get a badge; on-time pieces stay quiet
	const status = isLinked ? badgeStatus(resolved?.status, hit) : resolved?.status === 'blocked' ? 'blocked' : null;
	const isProblem = status != null && status !== 'onTime';

	return (
		<LayerRow
			id={piece.id}
			depth={row.depth}
			isSelected={isSelected}
			isInSelection={isInSelection}
			joins={joins}
			isDimmed={isHidden}
			icon={<PieceIcon type={type} size={14} />}
			label={name}
			isRenaming={isRenaming}
			onRename={(value) => {
				cx.$renaming.set(null);
				if (value != null && value !== name) cx.execute([{ type: 'upsertEntity', entity: { ...piece, name: value } }]);
			}}
			// A linked piece reads by its hit time; an anchored one says it only follows the marble
			meta={
				<>
					{isProblem ? <StatusIcon status={status} size={11} /> : null}
					{followLabel != null ? (
						<span className="inline-flex" title={followLabel} aria-label={followLabel} role="img">
							<Anchor size={11} strokeWidth={1.8} aria-hidden />
						</span>
					) : null}
					{isLinked && hit != null ? <span>{formatShortTime(hit.targetTime)}</span> : null}
				</>
			}
			actions={
				<>
					<RowToggle label={isLocked ? 'Unlock' : 'Lock'} isOn={isLocked} onClick={() => cx.toggleLocked(piece.id)}>
						{isLocked ? <Lock size={12} strokeWidth={1.8} /> : <LockOpen size={12} strokeWidth={1.8} />}
					</RowToggle>
					<RowToggle label={isHidden ? 'Show' : 'Hide'} isOn={isHidden} onClick={() => cx.toggleHidden(piece.id)}>
						{isHidden ? <EyeOff size={12} strokeWidth={1.8} /> : <Eye size={12} strokeWidth={1.8} />}
					</RowToggle>
				</>
			}
			onClick={onClick}
			onDoubleClick={() => cx.$renaming.set(piece.id)}
			onContextMenu={onContextMenu}
		/>
	);
};

/** Eye and lock buttons that show on row hover, and stay when on, like Figma's layer toggles */
const RowToggle: React.FC<{ label: string; isOn: boolean; onClick: () => void; children: React.ReactNode }> = (props) => {
	const { label, isOn, onClick, children } = props;
	return (
		<button
			className="mm-layer-toggle"
			data-on={isOn}
			title={label}
			aria-label={label}
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
			onDoubleClick={(event) => event.stopPropagation()}
			tabIndex={-1}
			type="button"
		>
			{children}
		</button>
	);
};

const LayerRow: React.FC<TLayerRowProps> = (props) => {
	const { id, depth, isSelected, isInSelection = false, joins, isDimmed = false, isOpen, onToggle, icon, label, title, isRenaming, onRename, meta, actions, onClick, onDoubleClick, onContextMenu } = props;
	return (
		<div
			role="treeitem"
			aria-selected={isSelected}
			aria-expanded={isOpen}
			aria-level={depth + 1}
			className="mm-layer"
			data-id={id}
			data-selected={isSelected}
			data-in-selection={isInSelection}
			data-join-top={joins.top}
			data-join-bottom={joins.bottom}
			data-dimmed={isDimmed}
			title={title}
			style={{ paddingLeft: 4 + depth * 16 }}
			onClick={onClick}
			onDoubleClick={onDoubleClick}
			onContextMenu={onContextMenu}
		>
			{isOpen != null ? (
				<button
					className="mm-layer-disclosure"
					data-open={isOpen}
					aria-label={isOpen ? 'Collapse' : 'Expand'}
					onClick={(event) => {
						event.stopPropagation();
						onToggle?.();
					}}
					onDoubleClick={(event) => event.stopPropagation()}
					tabIndex={-1}
					type="button"
				>
					<ChevronRight size={12} strokeWidth={2} />
				</button>
			) : (
				<span className="mm-layer-disclosure" />
			)}
			<span className="mm-layer-icon">{icon}</span>
			{isRenaming ? <RenameField value={label} onDone={onRename} /> : <span className="mm-layer-name">{label}</span>}
			{meta != null ? <span className="mm-layer-meta">{meta}</span> : null}
			{actions != null ? <span className="mm-layer-actions">{actions}</span> : null}
		</div>
	);
};

interface TLayerRowProps {
	id: string;
	depth: number;
	isSelected: boolean;
	/** Inside a selected group */
	isInSelection?: boolean;
	joins: TJoins;
	isDimmed?: boolean;
	/** Undefined for rows without children */
	isOpen?: boolean;
	onToggle?: () => void;
	icon: React.ReactNode;
	label: string;
	title?: string;
	isRenaming: boolean;
	onRename: (value: string | null) => void;
	/** Quiet trailing information that gives way to the actions on hover */
	meta?: React.ReactNode;
	actions?: React.ReactNode;
	onClick: (event: React.MouseEvent) => void;
	onDoubleClick: () => void;
	onContextMenu: (event: React.MouseEvent) => void;
}

/** Whether a tinted row continues into the row above or below, so the highlight reads as one block */
interface TJoins {
	top: boolean;
	bottom: boolean;
}

/** Compact time such as `0:03.2` for a row's secondary column */
function formatShortTime(seconds: number): string {
	const safe = Math.max(0, seconds);
	const minutes = Math.floor(safe / 60);
	return `${minutes}:${(safe - minutes * 60).toFixed(1).padStart(4, '0')}`;
}
