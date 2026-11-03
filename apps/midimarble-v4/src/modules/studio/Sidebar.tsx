import { useFeatureState } from 'feature-react/state';
import { Anchor, ChevronRight, Eye, EyeOff, Lock, LockOpen, Plus } from 'lucide-react';
import React from 'react';
import { MenuButton, openContextMenu, RenameField } from '@/components';
import { PieceIcon } from '@/modules/compose/piece-icons';
import { badgeStatus, StatusIcon } from '@/modules/compose/status';
import { DesignLibrary } from '@/modules/design/DesignLibrary';
import type { TEntity, TLane, TProject } from '@/modules/project';
import { soundsHit, type THitResult, type TResolvedPiece } from '@/modules/simulation';
import { commandItem } from './commands';
import { laneMenu, pieceMenu } from './menus';
import type { StudioCx, TWorkspace } from './StudioCx';

/**
 * Full-height sidebar after Paper and Figma: the project, the Compose and Design switch and the layer list.
 * In Design the library sits below the layers.
 */
export const Sidebar: React.FC<TSidebarProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const workspace = useFeatureState(cx.$workspace);
	const project = history?.present;
	if (project == null) return null;

	return (
		<aside className="mm-sidebar flex w-[248px] shrink-0 flex-col" aria-label="Sidebar">
			<ProjectHeader cx={cx} project={project} />
			<div className="px-3 pb-1">
				<div className="mm-segmented flex w-full" role="tablist" aria-label="Workspace">
					{workspaces.map((item) => (
						<button
							key={item.id}
							className="flex-1"
							data-active={workspace === item.id}
							onClick={() => cx.$workspace.set(item.id)}
							role="tab"
							aria-selected={workspace === item.id}
							title={`${item.label} (${item.shortcut})`}
							type="button"
						>
							{item.label}
						</button>
					))}
				</div>
			</div>
			{workspace === 'compose' ? (
				<Layers cx={cx} project={project} canAdd />
			) : (
				<>
					<Layers cx={cx} project={project} isCompact />
					<DesignLibrary cx={cx} project={project} />
				</>
			)}
		</aside>
	);
};

interface TSidebarProps {
	cx: StudioCx;
}

const workspaces: { id: TWorkspace; label: string; shortcut: string }[] = [
	{ id: 'compose', label: 'Compose', shortcut: '⌘1' },
	{ id: 'design', label: 'Design', shortcut: '⌘2' }
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
 * Layer list like Figma UI3: each marble is a group with the pieces linked or anchored to it in hit order,
 * then the free pieces, newest first. Up and Down move the selection, Left and Right fold a group.
 */
const Layers: React.FC<{ cx: StudioCx; project: TProject; canAdd?: boolean; isCompact?: boolean }> = (props) => {
	const { cx, project, canAdd = false, isCompact = false } = props;
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
	const rows = React.useMemo(() => layerRows(project, collapsed), [project, collapsed]);
	const order = rows.map((row) => row.id);
	const selectedGroups = new Set(rows.flatMap((row) => (row.kind === 'marble' && selection.includes(row.id) ? [row.lane.id] : [])));
	// Selected rows and the pieces of a selected group are highlighted
	const isTinted = (row: TLayerRowModel | undefined): boolean => row != null && (selection.includes(row.id) || (row.kind === 'piece' && row.laneId != null && selectedGroups.has(row.laneId)));

	// Return focus to the list after a rename, like Finder, so the arrow keys keep working
	React.useEffect(() => {
		if (wasRenamingRef.current && renaming == null) treeRef.current?.focus({ preventScroll: true });
		wasRenamingRef.current = renaming != null && rows.some((row) => row.id === renaming);
	}, [renaming, rows]);

	function toggleGroup(laneId: string, isOpen?: boolean): void {
		setCollapsed((current) => {
			const open = isOpen ?? current.includes(laneId);
			return open ? current.filter((item) => item !== laneId) : [...current, laneId];
		});
	}

	function onKeyDown(event: React.KeyboardEvent): void {
		if (event.target !== treeRef.current || event.metaKey || event.ctrlKey || event.altKey) return;
		const index = order.indexOf(selection[0] ?? '');
		const row = rows[index];
		let handled = true;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			const next = rows[index < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
			if (next != null) {
				cx.reveal([next.id]);
				treeRef.current?.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
			}
		} else if (event.key === 'ArrowLeft' && row != null) {
			if (row.kind === 'marble' && row.hasChildren) toggleGroup(row.lane.id, false);
			else if (row.parentId != null) cx.reveal([row.parentId]);
		} else if (event.key === 'ArrowRight' && row?.kind === 'marble' && row.hasChildren) {
			toggleGroup(row.lane.id, true);
		} else if (event.key === 'Enter' && row != null) {
			cx.$renaming.set(row.id);
		} else {
			handled = false;
		}
		if (!handled) return;
		// Keep the studio's arrow and Return shortcuts from also acting on the canvas and timeline
		event.preventDefault();
		event.stopPropagation();
	}

	return (
		<section aria-label="Layers" className={isCompact ? 'flex max-h-[38%] shrink-0 flex-col border-b border-[var(--separator)]' : 'flex min-h-0 flex-1 flex-col'}>
			<div className="mm-layers-header">
				<span>Layers</span>
				{canAdd ? (
					<MenuButton
						className="mm-icon-button !h-6 !w-6"
						label={<Plus size={14} strokeWidth={1.8} />}
						title="Add"
						items={[commandItem(cx, 'marble.add'), commandItem(cx, 'tool.marble', 'Place Marble on Canvas'), 'separator', commandItem(cx, 'file.importMidi'), commandItem(cx, 'file.importAudio')]}
					/>
				) : null}
			</div>
			<div ref={treeRef} role="tree" aria-label="Layers" tabIndex={0} className="mm-layers min-h-0 flex-1 overflow-y-auto pb-3" onKeyDown={onKeyDown}>
				{rows.map((row, index) => {
					const isSelected = selection.includes(row.id);
					const isInSelection = row.kind === 'piece' && row.laneId != null && selectedGroups.has(row.laneId);
					// Like Figma, adjacent highlighted rows join into one block
					const joins = { top: isTinted(row) && isTinted(rows[index - 1]), bottom: isTinted(row) && isTinted(rows[index + 1]) };
					if (row.kind === 'marble') {
						return (
							<MarbleRow
								key={row.id}
								cx={cx}
								row={row}
								isSelected={isSelected}
								joins={joins}
								isRenaming={renaming === row.id}
								onToggle={() => toggleGroup(row.lane.id)}
								onClick={(event) => selectRow(cx, row.id, event, order)}
								onContextMenu={(event) => {
									if (!selection.includes(row.id)) cx.$selection.set([row.id]);
									openContextMenu(event, laneMenu(cx, row.lane));
								}}
							/>
						);
					}
					return (
						<PieceRow
							key={row.id}
							cx={cx}
							piece={row.piece}
							depth={row.depth}
							isSelected={isSelected}
							isInSelection={isInSelection}
							joins={joins}
							isRenaming={renaming === row.id}
							isHidden={hidden.includes(row.id)}
							isLocked={locked.includes(row.id)}
							resolved={pieceResults.get(row.id)}
							hit={hitResults.get(row.id)}
							onClick={(event) => selectRow(cx, row.id, event, order)}
							onContextMenu={(event) => {
								if (!selection.includes(row.id)) cx.reveal([row.id]);
								openContextMenu(event, pieceMenu(cx));
							}}
						/>
					);
				})}
				{!rows.length ? <div className="mm-layers-empty">No layers</div> : null}
			</div>
		</section>
	);
};

type TLayerRowModel =
	| { kind: 'marble'; id: string; depth: 0; lane: TLane; hasChildren: boolean; isOpen: boolean; parentId: null }
	| { kind: 'piece'; id: string; depth: number; piece: TEntity; laneId: string | null; parentId: string | null };

/** Visible rows in display order, which Shift ranges and arrow keys follow */
function layerRows(project: TProject, collapsed: string[]): TLayerRowModel[] {
	const rows: TLayerRowModel[] = [];
	for (const lane of project.music.lanes) {
		const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
		const id = marble?.id ?? lane.id;
		const pieces = lanePieces(project, lane);
		const isOpen = !collapsed.includes(lane.id);
		rows.push({ kind: 'marble', id, depth: 0, lane, hasChildren: pieces.length > 0, isOpen, parentId: null });
		if (isOpen) for (const piece of pieces) rows.push({ kind: 'piece', id: piece.id, depth: 1, piece, laneId: lane.id, parentId: id });
	}
	const free = project.entities.filter((entity) => entity.components.piece != null && entity.components.hitLink == null).reverse();
	for (const piece of free) rows.push({ kind: 'piece', id: piece.id, depth: 0, piece, laneId: null, parentId: null });
	return rows;
}

const MarbleRow: React.FC<{
	cx: StudioCx;
	row: Extract<TLayerRowModel, { kind: 'marble' }>;
	isSelected: boolean;
	joins: TJoins;
	isRenaming: boolean;
	onToggle: () => void;
	onClick: (event: React.MouseEvent) => void;
	onContextMenu: (event: React.MouseEvent) => void;
}> = (props) => {
	const { cx, row, isSelected, joins, isRenaming, onToggle, onClick, onContextMenu } = props;
	const { lane } = row;

	return (
		<LayerRow
			id={row.id}
			depth={0}
			isSelected={isSelected}
			joins={joins}
			isOpen={row.hasChildren ? row.isOpen : undefined}
			onToggle={onToggle}
			icon={<span className="mm-layer-chip" style={{ background: lane.color }} />}
			label={lane.name}
			isRenaming={isRenaming}
			onRename={(value) => {
				cx.$renaming.set(null);
				if (value != null && value !== lane.name) cx.execute([{ type: 'upsertLane', lane: { ...lane, name: value } }]);
			}}
			onClick={onClick}
			onDoubleClick={() => cx.$renaming.set(row.id)}
			onContextMenu={onContextMenu}
		/>
	);
};

const PieceRow: React.FC<{
	cx: StudioCx;
	piece: TEntity;
	depth: number;
	isSelected: boolean;
	isInSelection: boolean;
	joins: TJoins;
	isRenaming: boolean;
	isHidden: boolean;
	isLocked: boolean;
	resolved: TResolvedPiece | undefined;
	hit: THitResult | undefined;
	onClick: (event: React.MouseEvent) => void;
	onContextMenu: (event: React.MouseEvent) => void;
}> = (props) => {
	const { cx, piece, depth, isSelected, isInSelection, joins, isRenaming, isHidden, isLocked, resolved, hit, onClick, onContextMenu } = props;
	const type = piece.components.piece?.type ?? 'platform';
	const name = piece.name ?? type;
	const link = piece.components.hitLink;
	const isLinked = soundsHit(type, link);
	// Like Xcode's navigator, only problems get a badge; on-time pieces stay quiet
	const status = isLinked ? badgeStatus(resolved?.status, hit) : resolved?.status === 'blocked' ? 'blocked' : null;
	const isProblem = status != null && status !== 'onTime';

	return (
		<LayerRow
			id={piece.id}
			depth={depth}
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
					{link != null && !isLinked ? <Anchor size={11} strokeWidth={1.8} aria-label="Anchored" /> : null}
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
	const { id, depth, isSelected, isInSelection = false, joins, isDimmed = false, isOpen, onToggle, icon, label, isRenaming, onRename, meta, actions, onClick, onDoubleClick, onContextMenu } = props;
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

/** Click selects, ⌘-click toggles and Shift-click selects the range of rows, like Figma's layers and Finder */
function selectRow(cx: StudioCx, id: string, event: React.MouseEvent, order: string[] = []): void {
	const selection = cx.$selection.get();
	const anchor = selection[0];
	if (event.shiftKey && anchor != null && order.includes(anchor) && order.includes(id)) {
		const from = Math.min(order.indexOf(anchor), order.indexOf(id));
		const to = Math.max(order.indexOf(anchor), order.indexOf(id));
		// The first selected row stays the anchor for the next Shift-click
		cx.$selection.set([anchor, ...order.slice(from, to + 1).filter((item) => item !== anchor)]);
		return;
	}
	if (event.shiftKey || event.metaKey) {
		cx.$selection.set(selection.includes(id) ? selection.filter((item) => item !== id) : [...selection, id]);
		return;
	}
	cx.reveal([id]);
}

/** Pieces linked or anchored to a lane's hits, in hit order */
function lanePieces(project: TProject, lane: TLane): TEntity[] {
	const order = new Map(lane.hits.map((hit, index) => [hit.id, index]));
	return project.entities
		.filter((entity) => entity.components.piece != null && entity.components.hitLink?.laneId === lane.id)
		.sort((a, b) => (order.get(a.components.hitLink?.hitId ?? '') ?? 0) - (order.get(b.components.hitLink?.hitId ?? '') ?? 0));
}

/** Compact time such as `0:03.2` for a row's secondary column */
function formatShortTime(seconds: number): string {
	const safe = Math.max(0, seconds);
	const minutes = Math.floor(safe / 60);
	return `${minutes}:${(safe - minutes * 60).toFixed(1).padStart(4, '0')}`;
}
