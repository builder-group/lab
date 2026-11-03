import { useFeatureState } from 'feature-react/state';
import { Anchor, ChevronRight, Eye, EyeOff, Link2, Lock, LockOpen, Pin, Plus } from 'lucide-react';
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
 * Full-height sidebar after Paper and Figma: the project, the Compose and Design switch, the marbles like
 * Paper's pages and the layer list. In Design the library sits below the layers.
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
			<div className="px-3 pb-2">
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
				<div className="min-h-0 flex-1 overflow-y-auto pb-3">
					<Marbles cx={cx} project={project} />
					<Layers cx={cx} project={project} />
				</div>
			) : (
				<>
					<div className="max-h-[38%] shrink-0 overflow-y-auto border-b border-[var(--separator)] pb-2">
						<Layers cx={cx} project={project} />
					</div>
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

// MARK: - Marbles

const Marbles: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const selection = useFeatureState(cx.$selection);
	const renaming = useFeatureState(cx.$renaming);
	const result = useFeatureState(cx.simulation.$result);

	return (
		<section aria-label="Marbles">
			<SectionHeader title="Marbles">
				<MenuButton
					className="mm-icon-button !h-5 !w-5"
					label={<Plus size={13} strokeWidth={2} />}
					title="Add"
					items={[commandItem(cx, 'marble.add'), commandItem(cx, 'tool.marble', 'Place Marble on Canvas'), 'separator', commandItem(cx, 'file.importMidi'), commandItem(cx, 'file.importAudio')]}
				/>
			</SectionHeader>
			<div className="flex flex-col gap-px" role="listbox" aria-label="Marbles">
				{project.music.lanes.map((lane) => {
					const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
					const id = marble?.id ?? lane.id;
					const placed = result?.hits.filter((hit) => hit.laneId === lane.id && hit.status !== 'open').length ?? 0;
					return (
						<LayerRow
							key={lane.id}
							depth={0}
							isActive={selection[0] === id}
							isSelected={selection.includes(id)}
							icon={<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: lane.color, boxShadow: 'inset 0 0 0 0.5px rgb(0 0 0 / 0.2)' }} />}
							label={lane.name}
							isRenaming={renaming === id}
							onRename={(name) => {
								cx.$renaming.set(null);
								if (name != null && name !== lane.name) cx.execute([{ type: 'upsertLane', lane: { ...lane, name } }]);
							}}
							trailing={<span className="mm-row-secondary" title={`${placed} of ${lane.hits.length} hits have a platform`}>{`${placed}/${lane.hits.length}`}</span>}
							onClick={(event) => selectRow(cx, id, event)}
							onDoubleClick={() => cx.$renaming.set(id)}
							onContextMenu={(event) => {
								if (!selection.includes(id)) cx.$selection.set([id]);
								openContextMenu(event, laneMenu(cx, lane));
							}}
						/>
					);
				})}
			</div>
			{!project.music.lanes.length ? <div className="mm-caption px-4 py-1">Add a marble with + or the Marble tool (O).</div> : null}
		</section>
	);
};

// MARK: - Layers

/** Figma-like layer list: each marble with the pieces attached to it, then the free pieces, newest first */
const Layers: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const selection = useFeatureState(cx.$selection);
	const renaming = useFeatureState(cx.$renaming);
	const result = useFeatureState(cx.simulation.$result);
	const hidden = useFeatureState(cx.$hidden);
	const locked = useFeatureState(cx.$locked);
	const [collapsed, setCollapsed] = React.useState<string[]>([]);

	const pieceResults = React.useMemo(() => new Map((result?.pieces ?? []).map((piece) => [piece.entityId, piece])), [result]);
	const hitResults = React.useMemo(() => new Map((result?.hits ?? []).flatMap((hit) => (hit.pieceEntityId == null ? [] : [[hit.pieceEntityId, hit] as const]))), [result]);
	const free = project.entities.filter((entity) => entity.components.piece != null && entity.components.hitLink == null).reverse();
	// Rows in the order shown, for Shift-click ranges
	const order = [
		...project.music.lanes.flatMap((lane) => {
			const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
			const pieces = collapsed.includes(lane.id) ? [] : lanePieces(project, lane).map((piece) => piece.id);
			return [marble?.id ?? lane.id, ...pieces];
		}),
		...free.map((piece) => piece.id)
	];

	const pieceRow = (piece: TEntity, depth: number): React.ReactNode => (
		<PieceRow
			key={piece.id}
			cx={cx}
			piece={piece}
			depth={depth}
			selection={selection}
			isRenaming={renaming === piece.id}
			isHidden={hidden.includes(piece.id)}
			isLocked={locked.includes(piece.id)}
			resolved={pieceResults.get(piece.id)}
			hit={hitResults.get(piece.id)}
			order={order}
		/>
	);

	return (
		<section aria-label="Layers">
			<SectionHeader title="Layers" />
			<div role="tree" aria-label="Layers" className="flex flex-col gap-px">
				{project.music.lanes.map((lane) => {
					const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
					const pieces = lanePieces(project, lane);
					const id = marble?.id ?? lane.id;
					const isOpen = !collapsed.includes(lane.id);
					return (
						<React.Fragment key={lane.id}>
							<LayerRow
								depth={0}
								isActive={selection[0] === id}
								isSelected={selection.includes(id)}
								isOpen={pieces.length > 0 ? isOpen : undefined}
								onToggle={() => setCollapsed((current) => (isOpen ? [...current, lane.id] : current.filter((item) => item !== lane.id)))}
								icon={
									<span className="flex shrink-0" style={{ color: lane.color }}>
										<PieceIcon type="marble" size={14} />
									</span>
								}
								label={lane.name}
								isRenaming={false}
								onRename={() => undefined}
								trailing={<span className="mm-row-secondary">{pieces.length || ''}</span>}
								onClick={(event) => selectRow(cx, id, event, order)}
								onDoubleClick={() => cx.$renaming.set(id)}
								onContextMenu={(event) => {
									if (!selection.includes(id)) cx.$selection.set([id]);
									openContextMenu(event, laneMenu(cx, lane));
								}}
							/>
							{isOpen ? pieces.map((piece) => pieceRow(piece, 1)) : null}
						</React.Fragment>
					);
				})}
				{free.map((piece) => pieceRow(piece, 0))}
			</div>
			{!free.length && !project.entities.some((entity) => entity.components.piece != null) ? (
				<div className="mm-caption px-4 py-1">Pieces you add appear here.</div>
			) : null}
		</section>
	);
};

const PieceRow: React.FC<{
	cx: StudioCx;
	piece: TEntity;
	depth: number;
	selection: string[];
	isRenaming: boolean;
	isHidden: boolean;
	isLocked: boolean;
	resolved: TResolvedPiece | undefined;
	hit: THitResult | undefined;
	order: string[];
}> = (props) => {
	const { cx, piece, depth, selection, isRenaming, isHidden, isLocked, resolved, hit, order } = props;
	const type = piece.components.piece?.type ?? 'platform';
	const name = piece.name ?? type;
	const link = piece.components.hitLink;
	const isLinked = soundsHit(type, link);
	// Like Xcode's navigator, only problems get a badge; on-time pieces stay quiet
	const status = isLinked ? badgeStatus(resolved?.status, hit) : resolved?.status === 'blocked' ? 'blocked' : null;
	const isProblem = status != null && status !== 'onTime';

	return (
		<LayerRow
			depth={depth}
			isActive={selection[0] === piece.id}
			isSelected={selection.includes(piece.id)}
			isDimmed={isHidden}
			icon={
				<span className="flex shrink-0 opacity-75">
					<PieceIcon type={type} size={14} />
				</span>
			}
			label={name}
			isRenaming={isRenaming}
			onRename={(value) => {
				cx.$renaming.set(null);
				if (value != null && value !== name) cx.execute([{ type: 'upsertEntity', entity: { ...piece, name: value } }]);
			}}
			trailing={
				<>
					{isProblem ? <StatusIcon status={status} size={11} /> : null}
					{link?.pinned === true ? <Pin size={11} strokeWidth={2} className="opacity-60" aria-label="Pinned" /> : null}
					{link != null ? (
						isLinked ? (
							<Link2 size={11} strokeWidth={2} className="opacity-50" aria-label="Linked to a hit" />
						) : (
							<Anchor size={11} strokeWidth={2} className="opacity-50" aria-label="Anchored" />
						)
					) : null}
					<RowToggle label={isLocked ? 'Unlock' : 'Lock'} isOn={isLocked} onClick={() => cx.toggleLocked(piece.id)}>
						{isLocked ? <Lock size={11} strokeWidth={2} /> : <LockOpen size={11} strokeWidth={2} />}
					</RowToggle>
					<RowToggle label={isHidden ? 'Show' : 'Hide'} isOn={isHidden} onClick={() => cx.toggleHidden(piece.id)}>
						{isHidden ? <EyeOff size={11} strokeWidth={2} /> : <Eye size={11} strokeWidth={2} />}
					</RowToggle>
				</>
			}
			onClick={(event) => selectRow(cx, piece.id, event, order)}
			onDoubleClick={() => cx.$renaming.set(piece.id)}
			onContextMenu={(event) => {
				if (!selection.includes(piece.id)) cx.reveal([piece.id]);
				openContextMenu(event, pieceMenu(cx));
			}}
		/>
	);
};

/** Eye and lock buttons that show on row hover, and stay when on, like Figma's layer toggles */
const RowToggle: React.FC<{ label: string; isOn: boolean; onClick: () => void; children: React.ReactNode }> = (props) => {
	const { label, isOn, onClick, children } = props;
	return (
		<button
			className="mm-row-toggle"
			data-on={isOn}
			title={label}
			aria-label={label}
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
			onDoubleClick={(event) => event.stopPropagation()}
			type="button"
		>
			{children}
		</button>
	);
};

const SectionHeader: React.FC<{ title: string; children?: React.ReactNode }> = (props) => {
	const { title, children } = props;
	return (
		<div className="flex items-center justify-between pr-3">
			<div className="mm-section-title">{title}</div>
			{children}
		</div>
	);
};

const LayerRow: React.FC<TLayerRowProps> = (props) => {
	const { depth, isActive, isSelected, isDimmed = false, isOpen, onToggle, icon, label, isRenaming, onRename, trailing, onClick, onDoubleClick, onContextMenu } = props;
	return (
		<div
			role="treeitem"
			aria-selected={isSelected}
			aria-expanded={isOpen}
			className="mm-row mm-layer-row"
			data-selected={isSelected}
			data-active={isActive}
			data-dimmed={isDimmed}
			style={{ paddingLeft: 8 + depth * 16 }}
			onClick={onClick}
			onDoubleClick={onDoubleClick}
			onContextMenu={onContextMenu}
		>
			{isOpen != null ? (
				<button
					className="mm-disclosure"
					data-open={isOpen}
					aria-label={isOpen ? 'Collapse' : 'Expand'}
					onClick={(event) => {
						event.stopPropagation();
						onToggle?.();
					}}
					onDoubleClick={(event) => event.stopPropagation()}
					type="button"
				>
					<ChevronRight size={11} strokeWidth={2.2} />
				</button>
			) : (
				<span className="w-2.5 shrink-0" />
			)}
			{icon}
			{isRenaming ? <RenameField value={label} onDone={onRename} /> : <span className="min-w-0 flex-1 truncate">{label}</span>}
			<span className="flex shrink-0 items-center gap-1">{trailing}</span>
		</div>
	);
};

interface TLayerRowProps {
	depth: number;
	isActive: boolean;
	isSelected: boolean;
	isDimmed?: boolean;
	/** Undefined for rows without children */
	isOpen?: boolean;
	onToggle?: () => void;
	icon: React.ReactNode;
	label: string;
	isRenaming: boolean;
	onRename: (value: string | null) => void;
	trailing?: React.ReactNode;
	onClick: (event: React.MouseEvent) => void;
	onDoubleClick: () => void;
	onContextMenu: (event: React.MouseEvent) => void;
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
