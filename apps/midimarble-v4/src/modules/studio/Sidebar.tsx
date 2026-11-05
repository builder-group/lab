import { useFeatureState } from 'feature-react/state';
import { Anchor, AudioLines, Bookmark, Box, BrickWall, ChevronRight, Eye, EyeOff, Folder, Globe, Lightbulb, Lock, LockOpen, Music, Sparkles, Sun, TriangleAlert, Type, Video } from 'lucide-react';
import React from 'react';
import { HelpTip, openContextMenu, RenameField, type TMenuEntry } from '@/components';
import { attachState, decorTips, pieceProblems, struckPieces, type TPreflightIssue, patternOfPiece } from '@/modules/building';
import { PieceIcon, useRunPreflight } from '@/modules/canvas';
import { badgeStatus, StatusIcon, type TBadgeStatus, groupSelection } from '@/modules/track';
import { madeInBlenderCommands, madeInBlenderLayer, selectedDecorIds, updateDecorCommands, updateLightCommands, shotKindLabel } from '@/modules/scene';
import { $scatterPanel, revealMadeInBlender } from '@/modules/film';
import { isPatternGroup, type TPiece, type TProject, formatTime, SCENE_KEY, tieOf } from '@/modules/project';
import { soundsHit, type THitResult, type TResolvedPiece } from '@/modules/simulation';
import { commandItem } from './commands';
import { inspectorTarget } from './inspector-target';
import { decorLabelEntries, decorMenu, entityLabelEntries, marbleLabelEntries, marbleMenu, pieceMenu, songMenu, titleMenu } from './menus';
import { buildOutline, collapsedGroups, DECOR_KEY, groupsOfSelection, isFilmRow, isSelectableRow, type TOutlineRow } from './outline';
import type { StudioCx, TWorkspace } from './StudioCx';

/** Full-height sidebar after Paper and Figma, and only Layers; what you add is in the tool rail's Insert */

export const Sidebar: React.FC<TSidebarProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const workspace = useFeatureState(cx.$workspace);
	const project = history?.present;
	if (project == null) return null;

	return (
		<aside className="mm-sidebar flex w-[264px] shrink-0 flex-col" aria-label="Sidebar">
			<div className="mm-sidebar-head">
				<span>Layers</span>
			</div>
			<Layers cx={cx} project={project} workspace={workspace} />
		</aside>
	);
};

interface TSidebarProps {
	cx: StudioCx;
}

// MARK: - Layers

/**
 * The project's layers like Figma UI3's layer list. Each layer with a row in the timeline shares its selection
 * with that row. The Scene comes first, like Blender's Scene Collection, and a
 * click on empty space selects it, then the Song, the Camera with its shots, the Wall and the marbles with their pieces;
 * Film adds the Lights, the titles and Decor. Up and Down move the selection, Left and Right
 * fold a group.
 */
const Layers: React.FC<{ cx: StudioCx; project: TProject; workspace: TWorkspace }> = (props) => {
	const { cx, project, workspace } = props;
	const selection = useFeatureState(cx.$selection);
	const renaming = useFeatureState(cx.$renaming);
	const result = useFeatureState(cx.simulation.$result);
	const hidden = useFeatureState(cx.$hidden);
	const locked = useFeatureState(cx.$locked);
	// What the user folded the other way, per workspace, while this stays open
	const [toggled, setToggled] = React.useState<Record<TWorkspace, string[]>>({ track: [], film: [] });
	const collapsed = React.useMemo(() => collapsedGroups(project, workspace, toggled[workspace]), [project, workspace, toggled]);
	const treeRef = React.useRef<HTMLDivElement>(null);
	const hasScattered = useFeatureState($scatterPanel)?.group != null;

	// What Scatter Decor places stays folded away, even in a Decor group that was open
	React.useEffect(() => {
		if (hasScattered) setToggled((current) => ({ ...current, film: current.film.filter((key) => key !== DECOR_KEY) }));
	}, [hasScattered]);
	const wasRenamingRef = React.useRef(false);

	const pieceResults = React.useMemo(() => new Map((result?.pieces ?? []).map((piece) => [piece.entityId, piece])), [result]);
	// Pieces another marble hits, from the problem model the hit summary and the inspector read
	const blenderObjects = useFeatureState(cx.film.$blenderObjects);
	// Badges wait while Build Track works: each step would check the whole run again, and the hit summary says Building…
	const preflight = useRunPreflight(cx, project);
	const struck = React.useMemo(() => (preflight != null ? struckPieces(preflight) : null), [preflight]);
	const looks = React.useMemo(() => (preflight != null ? pieceProblems(preflight) : null), [preflight]);
	const tips = React.useMemo(() => (preflight != null ? decorTips(preflight) : null), [preflight]);
	const hitResults = React.useMemo(() => new Map((result?.hits ?? []).flatMap((hit) => (hit.pieceEntityId == null ? [] : [[hit.pieceEntityId, hit] as const]))), [result]);
	const rows = React.useMemo(() => buildOutline(project, { collapsed, workspace, blenderObjects }), [project, collapsed, workspace, blenderObjects]);
	const isFilm = workspace === 'film';
	// Rows that Shift ranges and the arrow keys visit; Track's arrows stay out of the Film rows
	const order = rows.filter((row) => isSelectableRow(row) && (isFilm || !isFilmRow(row))).map((row) => row.id);
	const selectedSet = new Set(selection);
	const selectedMarbles = new Set(selection.flatMap((key) => (key.startsWith('hit:') ? [key.split(':')[1] ?? ''] : [])));
	const isSceneSelected = inspectorTarget(project, selection, workspace).kind === 'scene';

	function isSelected(row: TOutlineRow): boolean {
		if (row.kind === 'scene') return isSceneSelected;
		// A group such as Pieces only gathers rows; like Figma only the selected rows are tinted, not their group
		if (row.kind === 'group') return false;
		return selectedSet.has(row.id);
	}

	// The children of a selected marble or camera and a marble whose hits are selected get the lighter tint
	function isInSelection(row: TOutlineRow): boolean {
		if (row.kind === 'marble') return selectedMarbles.has(row.marble.id);
		return row.parentId != null && selectedSet.has(row.parentId);
	}

	const isTinted = (row: TOutlineRow | undefined): boolean => row != null && (isSelected(row) || isInSelection(row));

	// Return focus to the list after a rename, like Finder, so the arrow keys keep working
	React.useEffect(() => {
		if (wasRenamingRef.current && renaming == null) treeRef.current?.focus({ preventScroll: true });
		wasRenamingRef.current = renaming != null && rows.some((row) => row.id === renaming);
	}, [renaming, rows]);

	// A selection made elsewhere, such as on the wall, opens its group and scrolls its row into view like Figma
	const first = selection[0];
	React.useEffect(() => {
		if (first == null) return;
		const closed = groupsOfSelection(project, [first]).filter((key) => collapsed.includes(key));
		if (closed.length > 0) {
			setToggled((current) => ({ ...current, [workspace]: [...current[workspace].filter((key) => !closed.includes(key)), ...closed.filter((key) => !current[workspace].includes(key))] }));
			return;
		}
		treeRef.current?.querySelector(`[data-id="${CSS.escape(first)}"]`)?.scrollIntoView({ block: 'nearest' });
	}, [first, collapsed.length]); // eslint-disable-line react-hooks/exhaustive-deps -- only a new selection opens a group, and the row scrolls in once its group opened

	function toggleGroup(groupKey: string, isOpen?: boolean): void {
		const isClosed = collapsed.includes(groupKey);
		if ((isOpen ?? isClosed) !== isClosed) return;
		setToggled((current) => {
			const list = current[workspace];
			return { ...current, [workspace]: list.includes(groupKey) ? list.filter((item) => item !== groupKey) : [...list, groupKey] };
		});
	}

	/** Click selects, ⌘-click toggles and Shift-click selects the range of rows, like Figma's layers and Finder */
	function select(row: TOutlineRow, event?: React.MouseEvent): void {
		if (row.kind === 'scene') {
			cx.$selection.set([]);
			return;
		}
		if (!isFilm && isFilmRow(row)) cx.$workspace.set('film');
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
		// A Group selects with its pieces, like a collection's objects in Blender
		if (row.kind === 'patternGroup') {
			cx.$selection.set(groupSelection(row.group));
			cx.$trackCx.get()?.revealOnceSimulated(row.group.pieceIds);
			return;
		}
		// In Track a live Pattern's piece selects its Group; in Film it's a piece to dress
		const live = row.kind === 'piece' && cx.$workspace.get() === 'track' ? patternOfPiece(project, row.id) : null;
		if (live != null) {
			cx.$selection.set(groupSelection(live));
			cx.$trackCx.get()?.revealOnceSimulated(live.pieceIds);
			return;
		}
		// Marbles and pieces are brought into view on the wall
		if (row.kind === 'marble' || row.kind === 'piece') cx.reveal([row.id]);
		else cx.$selection.set([row.id]);
	}

	function onKeyDown(event: React.KeyboardEvent): void {
		if (event.target !== treeRef.current || event.metaKey || event.ctrlKey || event.altKey) return;
		const row = rows.find((item) => item.id === selection[0]);
		const index = order.indexOf(selection[0] ?? SCENE_KEY);
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
		if (row.kind === 'marble') openContextMenu(event, marbleMenu(cx, row.marble));
		else if (row.kind === 'piece' || row.kind === 'patternGroup') openContextMenu(event, pieceMenu(cx));
		else if (row.kind === 'song') openContextMenu(event, songMenu(cx));
		else if (row.kind === 'light') openContextMenu(event, [commandItem(cx, 'light.add'), ...(row.light != null ? [commandItem(cx, 'edit.delete')] : [])]);
		else if (row.kind === 'title') openContextMenu(event, titleMenu(cx, row.title));
		else if (row.kind === 'decor') openContextMenu(event, decorMenu(cx, tips?.has(row.id) === true));
		else if (row.kind === 'madeInBlender') openContextMenu(event, [{ label: 'Open in Blender', onSelect: () => revealMadeInBlender(cx, row.name) }, commandItem(cx, 'decor.scatter')]);
		else if (row.kind === 'group' && row.id === DECOR_KEY) openContextMenu(event, [commandItem(cx, 'decor.scatter')]);
		else if (row.kind === 'camera' || row.kind === 'shot') openContextMenu(event, [commandItem(cx, 'camera.addShot'), ...(row.kind === 'shot' ? [commandItem(cx, 'edit.delete')] : [])]);
		else event.preventDefault();
	}

	useAgentTouchedRows(cx, treeRef);

	// One object for every row and render, so a memoized row re-renders only when its own props change; each action is this render's
	const latestRef = React.useRef({ select, openMenu, toggleGroup });
	React.useLayoutEffect(() => {
		latestRef.current = { select, openMenu, toggleGroup };
	});
	const rowActions = React.useMemo<TRowActions>(
		() => ({
			onClick: (row, event) => latestRef.current.select(row, event),
			onContextMenu: (row, event) => latestRef.current.openMenu(row, event),
			onToggle: (groupKey) => latestRef.current.toggleGroup(groupKey)
		}),
		[]
	);

	return (
		<section aria-label="Layers" data-quick-help="layers" className="flex min-h-0 flex-1 flex-col">
			<div ref={treeRef} role="tree" aria-label="Layers" aria-multiselectable tabIndex={0} className="mm-layers min-h-0 flex-1 overflow-y-auto pb-3" onKeyDown={onKeyDown} onClick={(event) => {
				// Empty space below or beside the rows selects the Scene
				if (event.target === event.currentTarget && !event.shiftKey && !event.metaKey) cx.$selection.set([]);
			}}>
				{rows.map((row, index) => {
					// Like Figma, adjacent highlighted rows join into one block
					const joins = { top: isTinted(row) && isTinted(rows[index - 1]), bottom: isTinted(row) && isTinted(rows[index + 1]) };
					const common = {
						row,
						isSelected: isSelected(row),
						isInSelection: !isSelected(row) && isInSelection(row),
						joinsTop: joins.top,
						joinsBottom: joins.bottom,
						actions: rowActions
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
								status={pieceRowStatus(row.piece, pieceResults.get(row.id), hitResults.get(row.id), struck?.get(row.id)?.[0] ?? looks?.get(row.id)?.[0])}
								hitTime={hitResults.get(row.id)?.targetTime}
							/>
						);
					}
					if (row.kind === 'decor' || row.kind === 'madeInBlender') {
						return <DecorRow key={row.id} {...common} cx={cx} isRenaming={renaming === row.id} tip={tips?.get(row.id)?.label} />;
					}
					return <OutlineRow key={row.id} {...common} cx={cx} isRenaming={renaming === row.id} isHidden={hidden.includes(row.id)} />;
				})}
			</div>
		</section>
	);
};

interface TRowProps {
	row: TOutlineRow;
	isSelected: boolean;
	isInSelection: boolean;
	joinsTop: boolean;
	joinsBottom: boolean;
	actions: TRowActions;
}

interface TRowActions {
	onClick: (row: TOutlineRow, event: React.MouseEvent) => void;
	onContextMenu: (row: TOutlineRow, event: React.MouseEvent) => void;
	onToggle: (groupKey: string) => void;
}

/** A piece's badge: like Xcode's navigator, only problems get one; on-time pieces stay quiet */
function pieceRowStatus(piece: TPiece, resolved: TResolvedPiece | undefined, hit: THitResult | undefined, hitBy: TPreflightIssue | undefined): TBadgeStatus | null {
	const own = soundsHit(piece.type ?? 'platform', tieOf(piece)) ? badgeStatus(resolved?.status, hit) : resolved?.status === 'blocked' ? 'blocked' : null;
	// Another marble hitting it shows when the piece's own status is fine
	return hitBy != null && (own == null || own === 'onTime') ? 'struck' : own;
}

function canRename(row: TOutlineRow): boolean {
	return row.kind === 'marble' || row.kind === 'piece' || row.kind === 'title' || row.kind === 'decor' || (row.kind === 'light' && row.light != null) || (row.kind === 'patternGroup' && !isPatternGroup(row.group));
}

/** Every row except pieces: the song, marbles, groups, the wall, lights, the camera, shots and titles */
const OutlineRow = React.memo(function OutlineRow(props: TRowProps & { cx: StudioCx; isRenaming: boolean; isHidden: boolean }) {
	const { cx, row, isSelected, isInSelection, joinsTop, joinsBottom, isRenaming, isHidden, actions } = props;
	const view = outlineRowView(row);

	function rename(value: string | null): void {
		cx.$renaming.set(null);
		if (value == null || value === view.label) return;
		if (row.kind === 'marble') cx.execute([{ type: 'updateMarble', marbleId: row.marble.id, patch: { name: value } }]);
		else if (row.kind === 'patternGroup') cx.execute([{ type: 'addGroup', group: { ...row.group, name: value } }]);
		else if (row.kind === 'title' && cx.project != null) cx.execute([{ type: 'updateFilm', film: { titles: cx.project.film.titles.map((title) => (title.id === row.title.id ? { ...title, name: value } : title)) } }]);
		else if (row.kind === 'light' && row.light != null && cx.project != null) cx.execute(updateLightCommands(cx.project, row.light.id, { name: value }));
	}

	return (
		<LayerRow
			id={row.id}
			depth={row.depth}
			isSelected={isSelected}
			isInSelection={isInSelection}
			joinsTop={joinsTop}
			joinsBottom={joinsBottom}
			isDimmed={isHidden}
			isOpen={view.isOpen}
			onToggle={'groupKey' in row ? () => actions.onToggle(row.groupKey) : undefined}
			icon={view.icon}
			label={view.label}
			title={view.title}
			isRenaming={isRenaming}
			onRename={rename}
			meta={
				view.time != null || view.help != null || view.subtitle != null || row.kind === 'group' ? (
					<>
						{view.subtitle != null ? <span className="max-w-[112px] truncate">{view.subtitle}</span> : null}
						{view.help != null ? (
							// The ? explains the group without selecting it
							<span className="inline-flex" onClick={(event) => event.stopPropagation()}>
								<HelpTip text={view.help} />
							</span>
						) : null}
						{view.time != null ? <span>{formatShortTime(view.time)}</span> : null}
					</>
				) : undefined
			}
			actions={
				row.kind === 'marble' || row.kind === 'wall' || row.kind === 'light' || row.kind === 'title' ? (
					<RowToggle label={isHidden ? 'Show' : 'Hide'} isOn={isHidden} onClick={() => cx.toggleHidden(row.id)}>
						{isHidden ? <EyeOff size={12} strokeWidth={1.8} /> : <Eye size={12} strokeWidth={1.8} />}
					</RowToggle>
				) : undefined
			}
			onClick={(event) => actions.onClick(row, event)}
			onDoubleClick={() => {
				if (canRename(row)) cx.$renaming.set(row.id);
			}}
			onContextMenu={(event) => actions.onContextMenu(row, event)}
			onIconClick={row.kind === 'marble' || row.kind === 'title' || row.kind === 'decor' ? (event) => openContextMenu(event, rowLabelEntries(cx, row)) : undefined}
		/>
	);
});

/** Icon, name, fold state and quiet time of a row */
function outlineRowView(row: TOutlineRow): { icon: React.ReactNode; label: string; title?: string; subtitle?: string | undefined; help?: string; isOpen?: boolean; time?: number } {
	switch (row.kind) {
		case 'scene':
			return { icon: <Globe size={14} strokeWidth={1.75} />, label: 'Scene', title: 'The film as a whole: Gravity in Track, the theme and Format in Film' };
		case 'song': {
			const isRecording = row.source?.kind === 'audio';
			return {
				icon: isRecording ? <AudioLines size={14} strokeWidth={1.75} /> : <Music size={14} strokeWidth={1.75} />,
				label: row.label,
				title: row.source == null ? 'Song · Backing' : isRecording ? `Song · Recording · ${row.source.name}` : `Song · MIDI · ${row.source.name}`,
				subtitle: row.source?.name
			};
		}
		case 'marble':
			return { icon: <span className="mm-layer-chip" style={{ background: row.marble.labelColor }} />, label: row.marble.name, isOpen: row.hasChildren ? row.isOpen : undefined };
		case 'group':
			return { icon: <Folder size={14} strokeWidth={1.75} />, label: row.label, help: row.help, isOpen: row.isOpen };
		case 'patternGroup':
			return { icon: <Folder size={14} strokeWidth={1.75} />, label: row.group.name, ...(isPatternGroup(row.group) ? { title: `${row.group.name}: made by a Pattern; Flatten to edit its pieces one by one` } : {}), isOpen: row.hasChildren ? row.isOpen : undefined };
		case 'wall':
			return { icon: <BrickWall size={14} strokeWidth={1.75} style={{ color: row.labelColor }} />, label: 'Wall' };
		case 'light':
			return { icon: row.light == null ? <Sun size={14} strokeWidth={1.75} /> : <Lightbulb size={14} strokeWidth={1.75} />, label: row.label };
		case 'camera':
			return { icon: <Video size={14} strokeWidth={1.75} />, label: 'Camera', isOpen: row.hasChildren ? row.isOpen : undefined };
		case 'shot':
			return { icon: <Bookmark size={13} strokeWidth={1.75} />, label: shotKindLabel(row.shot.kind), time: row.shot.time };
		case 'title':
			return { icon: <Type size={14} strokeWidth={1.75} style={{ color: row.title.labelColor }} />, label: row.title.name ?? row.title.text };
		case 'piece':
			return { icon: null, label: row.piece.name ?? '' };
		case 'decor':
			return { icon: <Sparkles size={14} strokeWidth={1.75} style={{ color: row.decor.labelColor }} />, label: row.decor.name };
		case 'madeInBlender':
			return { icon: <Box size={14} strokeWidth={1.75} />, label: row.name, title: 'Made in Blender' };
	}
}

/** A Decor layer: its eye and, when a marble's path crosses it, the amber badge the inspector explains */
const DecorRow = React.memo(function DecorRow(props: TRowProps & { cx: StudioCx; isRenaming: boolean; tip: string | undefined }) {
	const { cx, row, isSelected, isInSelection, joinsTop, joinsBottom, isRenaming, tip, actions } = props;
	const view = outlineRowView(row);
	const project = cx.project;
	const isHidden = project != null && (row.kind === 'decor' ? row.decor.hidden === true : row.kind === 'madeInBlender' && madeInBlenderLayer(project.film, row.name).hidden === true);

	function toggleHidden(): void {
		if (project == null) return;
		if (row.kind === 'decor') cx.execute(updateDecorCommands(project, [row.decor.id], { hidden: !isHidden }));
		else if (row.kind === 'madeInBlender') cx.execute(madeInBlenderCommands(project, row.name, { hidden: isHidden ? null : true }));
	}

	return (
		<LayerRow
			id={row.id}
			depth={row.depth}
			isSelected={isSelected}
			isInSelection={isInSelection}
			joinsTop={joinsTop}
			joinsBottom={joinsBottom}
			isDimmed={isHidden}
			icon={view.icon}
			label={view.label}
			title={view.title}
			isRenaming={isRenaming}
			onRename={(value) => {
				cx.$renaming.set(null);
				if (row.kind === 'decor' && project != null && value != null && value !== row.decor.name) cx.execute(updateDecorCommands(project, [row.decor.id], { name: value }));
			}}
			meta={
				tip != null ? (
					<span className="inline-flex" title={tip} aria-label={tip} role="img">
						<TriangleAlert size={11} strokeWidth={1.8} className="text-[var(--warn)]" aria-hidden />
					</span>
				) : undefined
			}
			actions={
				<RowToggle label={isHidden ? 'Show' : 'Hide'} isOn={isHidden} onClick={toggleHidden}>
					{isHidden ? <EyeOff size={12} strokeWidth={1.8} /> : <Eye size={12} strokeWidth={1.8} />}
				</RowToggle>
			}
			onClick={(event) => actions.onClick(row, event)}
			onDoubleClick={() => {
				if (canRename(row)) cx.$renaming.set(row.id);
			}}
			onContextMenu={(event) => actions.onContextMenu(row, event)}
			onIconClick={row.kind === 'marble' || row.kind === 'title' || row.kind === 'decor' ? (event) => openContextMenu(event, rowLabelEntries(cx, row)) : undefined}
		/>
	);
});

/** What clicking a row's icon or dot opens: its Label Color, on the layers that have one */
function rowLabelEntries(cx: StudioCx, row: TOutlineRow): TMenuEntry[] {
	switch (row.kind) {
		case 'marble':
			return marbleLabelEntries(cx, row.marble);
		case 'title':
			return entityLabelEntries(cx, row.title);
		case 'decor': {
			const selected = selectedDecorIds(cx.$selection.get());
			return decorLabelEntries(cx, selected.includes(row.decor.id) ? selected : [row.decor.id]);
		}
		default:
			return [];
	}
}

const PieceRow = React.memo(function PieceRow(
	props: TRowProps & {
		cx: StudioCx;
		piece: TPiece;
		isRenaming: boolean;
		isHidden: boolean;
		isLocked: boolean;
		status: TBadgeStatus | null;
		hitTime: number | undefined;
	}
) {
	const { cx, row, piece, isSelected, isInSelection, joinsTop, joinsBottom, isRenaming, isHidden, isLocked, status, hitTime, actions } = props;
	const type = piece.type ?? 'platform';
	const name = piece.name ?? type;
	const link = tieOf(piece);
	const isLinked = soundsHit(type, link);
	// A piece that follows a moment names it, as the inspector header does: "Follows Marble 1 at 0:03.2"
	const project = cx.project;
	const attach = link != null && !isLinked && project != null ? attachState(project, piece) : null;
	const followLabel =
		attach?.kind === 'anchored' ? `Follows ${project?.marbles.find((marble) => marble.id === attach.marbleId)?.name ?? 'a marble'} at ${formatTime(attach.time)}` : null;
	const isProblem = status != null && status !== 'onTime';

	return (
		<LayerRow
			id={piece.id}
			depth={row.depth}
			isSelected={isSelected}
			isInSelection={isInSelection}
			joinsTop={joinsTop}
			joinsBottom={joinsBottom}
			isDimmed={isHidden}
			icon={
				<span className="contents" style={{ color: piece.labelColor }}>
					<PieceIcon type={type} size={14} />
				</span>
			}
			label={name}
			isRenaming={isRenaming}
			onRename={(value) => {
				cx.$renaming.set(null);
				if (value != null && value !== name) cx.execute([{ type: 'addPiece', piece: { ...piece, name: value } }]);
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
					{isLinked && hitTime != null ? <span>{formatShortTime(hitTime)}</span> : null}
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
			onClick={(event) => actions.onClick(row, event)}
			onDoubleClick={() => cx.$renaming.set(piece.id)}
			onContextMenu={(event) => actions.onContextMenu(row, event)}
			onIconClick={(event) => openContextMenu(event, entityLabelEntries(cx, piece))}
		/>
	);
});

/** Eye and lock buttons in the row's reserved slot: they show on row hover and stay when on, like Figma's layer toggles */
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

const TOUCHED_ROW_DELAY_MS = 30;

/** Marks the rows of what an agent's edit just changed, on the elements directly, so the list doesn't render for it */
function useAgentTouchedRows(cx: StudioCx, treeRef: React.RefObject<HTMLDivElement | null>): void {
	React.useEffect(() => {
		let timer: number | undefined;
		const stop = cx.mcp.presence.$touched.listen(() => {
			// A new layer's row comes with the render that follows its edit
			window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				const keys = new Set(cx.mcp.presence.$touched.get().map((item) => item.key));
				treeRef.current?.querySelectorAll<HTMLElement>('.mm-layer').forEach((row) => {
					const id = row.dataset['id'];
					row.toggleAttribute('data-agent-touched', id != null && keys.has(id));
				});
			}, TOUCHED_ROW_DELAY_MS);
		});
		return () => {
			window.clearTimeout(timer);
			stop();
		};
	}, [cx, treeRef]);
}

const LayerRow: React.FC<TLayerRowProps> = (props) => {
	const { id, depth, isSelected, isInSelection = false, joinsTop, joinsBottom, isDimmed = false, isOpen, onToggle, icon, onIconClick, label, title, isRenaming, onRename, meta, actions, onClick, onDoubleClick, onContextMenu } = props;
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
			data-join-top={joinsTop}
			data-join-bottom={joinsBottom}
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
			<span
				className="mm-layer-icon"
				data-colorable={onIconClick != null}
				title={onIconClick != null ? 'Color' : undefined}
				onClick={
					onIconClick != null
						? (event) => {
								event.stopPropagation();
								onIconClick(event);
							}
						: undefined
				}
				onDoubleClick={onIconClick != null ? (event) => event.stopPropagation() : undefined}
			>
				{icon}
			</span>
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
	/** The highlight continues into the row above or below, so it reads as one block */
	joinsTop: boolean;
	joinsBottom: boolean;
	isDimmed?: boolean;
	/** Undefined for rows without children */
	isOpen?: boolean;
	onToggle?: () => void;
	icon: React.ReactNode;
	label: string;
	title?: string;
	isRenaming: boolean;
	onRename: (value: string | null) => void;
	/** Quiet trailing information, always visible and never moved by hover */
	meta?: React.ReactNode;
	/** Hover actions; their slot at the row's right edge is reserved, so showing them moves nothing */
	actions?: React.ReactNode;
	onClick: (event: React.MouseEvent) => void;
	onDoubleClick: () => void;
	onContextMenu: (event: React.MouseEvent) => void;
	/** Clicking the icon or dot opens the layer's Label Color */
	onIconClick?: ((event: React.MouseEvent) => void) | undefined;
}

/** Compact time such as `0:03.2` for a row's secondary column */
function formatShortTime(seconds: number): string {
	const safe = Math.max(0, seconds);
	const minutes = Math.floor(safe / 60);
	return `${minutes}:${(safe - minutes * 60).toFixed(1).padStart(4, '0')}`;
}
