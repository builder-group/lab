import { useFeatureState } from 'feature-react/state';
import { ChevronRight, Pin, Plus } from 'lucide-react';
import React from 'react';
import { MenuButton, openContextMenu, RenameField } from '@/components';
import { PieceIcon } from '@/modules/compose/piece-icons';
import { badgeStatus, StatusIcon } from '@/modules/compose/status';
import { DesignLibrary } from '@/modules/design/DesignLibrary';
import type { TEntity, TLane, TProject } from '@/modules/project';
import type { THitResult, TResolvedPiece } from '@/modules/simulation';
import { commandItem } from './commands';
import { laneMenu, pieceMenu } from './menus';
import type { StudioCx } from './StudioCx';

/** Outliner like Blender's and Finder's sidebar: marbles with their pieces in hit order */
export const Sidebar: React.FC<TSidebarProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const workspace = useFeatureState(cx.$workspace);
	const project = history?.present;
	if (project == null) return null;

	return (
		<aside className={`flex w-[232px] shrink-0 flex-col bg-[var(--chrome)] pb-3 ${workspace === 'compose' ? 'overflow-y-auto' : 'overflow-hidden'}`} aria-label="Sidebar">
			{workspace === 'compose' ? (
				<Outliner cx={cx} project={project} />
			) : (
				<DesignLibrary cx={cx} project={project} />
			)}
		</aside>
	);
};

interface TSidebarProps {
	cx: StudioCx;
}

const Outliner: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const selection = useFeatureState(cx.$selection);
	const renaming = useFeatureState(cx.$renaming);
	const result = useFeatureState(cx.simulation.$result);
	const [collapsed, setCollapsed] = React.useState<string[]>([]);

	const pieceResults = React.useMemo(() => new Map((result?.pieces ?? []).map((piece) => [piece.entityId, piece])), [result]);
	const hitResults = React.useMemo(() => new Map((result?.hits ?? []).flatMap((hit) => (hit.pieceEntityId == null ? [] : [[hit.pieceEntityId, hit] as const]))), [result]);

	function select(id: string, event: React.MouseEvent): void {
		if (event.shiftKey || event.metaKey) {
			cx.$selection.set(selection.includes(id) ? selection.filter((item) => item !== id) : [...selection, id]);
			return;
		}
		cx.reveal([id]);
	}

	return (
		<>
			<div className="flex items-center justify-between pr-3">
				<div className="mm-section-title">Marbles</div>
				<MenuButton
					className="mm-icon-button !h-5 !w-5"
					label={<Plus size={13} strokeWidth={2} />}
					title="Add"
					items={[commandItem(cx, 'marble.add'), 'separator', commandItem(cx, 'file.importMidi'), commandItem(cx, 'file.importAudio')]}
				/>
			</div>
			<div role="tree" aria-label="Marbles and pieces" className="flex flex-col gap-px">
				{project.music.lanes.map((lane) => {
					const marble = project.entities.find((entity) => entity.components.marble?.laneId === lane.id);
					const pieces = lanePieces(project, lane);
					const id = marble?.id ?? lane.id;
					const isOpen = !collapsed.includes(lane.id);
					const placed = result?.hits.filter((hit) => hit.laneId === lane.id && hit.status !== 'open').length ?? 0;
					return (
						<React.Fragment key={lane.id}>
							<OutlinerRow
								depth={0}
								isActive={selection[0] === id}
								isSelected={selection.includes(id)}
								isOpen={pieces.length > 0 ? isOpen : undefined}
								onToggle={() => setCollapsed((current) => (isOpen ? [...current, lane.id] : current.filter((item) => item !== lane.id)))}
								icon={<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: lane.color, boxShadow: 'inset 0 0 0 0.5px rgb(0 0 0 / 0.2)' }} />}
								label={lane.name}
								isRenaming={renaming === id}
								onRename={(name) => {
									cx.$renaming.set(null);
									if (name != null && name !== lane.name) cx.execute([{ type: 'upsertLane', lane: { ...lane, name } }]);
								}}
								trailing={<span className="mm-row-secondary" title={`${placed} of ${lane.hits.length} hits have a piece`}>{`${placed}/${lane.hits.length}`}</span>}
								onClick={(event) => select(id, event)}
								onDoubleClick={() => cx.$renaming.set(id)}
								onContextMenu={(event) => {
									if (!selection.includes(id)) cx.$selection.set([id]);
									openContextMenu(event, laneMenu(cx, lane));
								}}
							/>
							{isOpen
								? pieces.map((piece) => (
										<PieceRow
											key={piece.id}
											cx={cx}
											piece={piece}
											selection={selection}
											isRenaming={renaming === piece.id}
											resolved={pieceResults.get(piece.id)}
											hit={hitResults.get(piece.id)}
											onClick={(event) => select(piece.id, event)}
										/>
									))
								: null}
						</React.Fragment>
					);
				})}
			</div>
			{!project.music.lanes.length ? (
				<div className="mm-placeholder !h-auto pt-8">
					<span className="mm-placeholder-title">No Marbles</span>
					<span className="mm-placeholder-body">Add a marble with + or import a MIDI file.</span>
				</div>
			) : null}
		</>
	);
};

const PieceRow: React.FC<{
	cx: StudioCx;
	piece: TEntity;
	selection: string[];
	isRenaming: boolean;
	resolved: TResolvedPiece | undefined;
	hit: THitResult | undefined;
	onClick: (event: React.MouseEvent) => void;
}> = (props) => {
	const { cx, piece, selection, isRenaming, resolved, hit, onClick } = props;
	const type = piece.components.piece?.type ?? 'platform';
	const name = piece.name ?? type;
	// Like Xcode's navigator, only problems get a badge; on-time pieces stay quiet
	const status = badgeStatus(resolved?.status, hit);
	const isProblem = status != null && status !== 'onTime';

	return (
		<OutlinerRow
			depth={1}
			isActive={selection[0] === piece.id}
			isSelected={selection.includes(piece.id)}
			icon={
				<span className="flex shrink-0 opacity-70">
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
					{piece.components.hitLink?.pinned === true ? <Pin size={11} strokeWidth={2} className="opacity-60" aria-label="Pinned" /> : null}
					{isProblem ? <StatusIcon status={status} size={11} /> : null}
				</>
			}
			onClick={onClick}
			onDoubleClick={() => cx.$renaming.set(piece.id)}
			onContextMenu={(event) => {
				if (!selection.includes(piece.id)) cx.reveal([piece.id]);
				openContextMenu(event, pieceMenu(cx));
			}}
		/>
	);
};

const OutlinerRow: React.FC<TOutlinerRowProps> = (props) => {
	const { depth, isActive, isSelected, isOpen, onToggle, icon, label, isRenaming, onRename, trailing, onClick, onDoubleClick, onContextMenu } = props;
	return (
		<div
			role="treeitem"
			aria-selected={isSelected}
			aria-expanded={isOpen}
			className="mm-row"
			data-selected={isSelected}
			data-active={isActive}
			style={{ paddingLeft: 8 + depth * 18 }}
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

interface TOutlinerRowProps {
	depth: number;
	isActive: boolean;
	isSelected: boolean;
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

/** Pieces linked to a lane's hits, in hit order */
function lanePieces(project: TProject, lane: TLane): TEntity[] {
	const order = new Map(lane.hits.map((hit, index) => [hit.id, index]));
	return project.entities
		.filter((entity) => entity.components.piece != null && entity.components.hitLink?.laneId === lane.id)
		.sort((a, b) => (order.get(a.components.hitLink?.hitId ?? '') ?? 0) - (order.get(b.components.hitLink?.hitId ?? '') ?? 0));
}
