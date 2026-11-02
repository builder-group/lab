import { useFeatureState } from 'feature-react/state';
import {
	ArrowUpRight,
	Bot,
	Cable,
	Check,
	ChevronDown,
	ChevronRight,
	CircleAlert,
	File,
	Frame,
	Layers,
	Package,
	PanelLeftClose,
	PanelLeftOpen,
	Plus,
	Search,
	Square,
	Table2,
	X
} from 'lucide-react';
import React from 'react';
import '../../styles/workspace-sidebar.css';
import { getLibraryAssetUrl, libraryItems } from '../library/data';
import { PartArtwork } from '../parts/components/PartArtwork';
import {
	createLayout,
	getCapability,
	getFindings,
	getPartForInstance,
	type TFinding,
	type TPoint,
	type TProject
} from '../project/model';
import { ReviewNotes } from '../review/ReviewNotes';
import { CanvasCx } from './CanvasCx';

export const CanvasSidebar: React.FC<TCanvasSidebarProps> = React.memo(function CanvasSidebar({
	cx,
	project,
	position,
	assistantBusy = false,
	assistantProposalCount = 0
}) {
	const tab = useFeatureState(cx.$sidebarTab);
	const source = useFeatureState(cx.$assetSource);
	const open = useFeatureState(cx.$sidebarOpen);
	const selection = useFeatureState(cx.$selection);
	const layoutId = useFeatureState(cx.$layoutId) ?? project.layouts[0]?.id;
	const materialId = useFeatureState(cx.$materialId);
	const tool = useFeatureState(cx.$tool);
	const query = useFeatureState(cx.$assetQuery);
	const [layerQuery, setLayerQuery] = React.useState('');
	const [searchLayers, setSearchLayers] = React.useState(false);
	const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
	const [focusedLayer, setFocusedLayer] = React.useState<string | null>(null);
	const scrollPositionsRef = React.useRef(new Map<string, number>());
	const index = React.useMemo(() => {
		const partsById = new Map(project.parts.map((part) => [part.id, part]));
		const instancesById = new Map(project.instances.map((instance) => [instance.id, instance]));
		const placedCounts = new Map<string, number>();
		for (const placement of project.placements) {
			const partId = instancesById.get(placement.instanceId)?.partId;
			if (partId) placedCounts.set(partId, (placedCounts.get(partId) ?? 0) + 1);
		}
		return { partsById, instancesById, placedCounts };
	}, [project.parts, project.instances, project.placements]);
	const findings = React.useMemo(
		() => (tab === 'checks' ? getFindings(project) : []),
		[project, tab]
	);
	const checkGroups = React.useMemo(() => {
		const groups = new Map<
			string,
			{ title: string; severity: TFinding['severity']; items: TFinding[] }
		>();
		for (const finding of findings) {
			const key = `${finding.severity}:${finding.title}`;
			const group = groups.get(key) ?? {
				title: finding.title,
				severity: finding.severity,
				items: []
			};
			group.items.push(finding);
			groups.set(key, group);
		}
		return [...groups.values()].sort(
			(a, b) =>
				['error', 'warning', 'info'].indexOf(a.severity) -
				['error', 'warning', 'info'].indexOf(b.severity)
		);
	}, [findings]);
	const q = query.trim().toLowerCase();
	const lq = layerQuery.trim().toLowerCase();
	const parts = React.useMemo(
		() =>
			project.parts.filter(
				(part) =>
					part.buildState !== 'archived' &&
					`${part.name} ${part.brand} ${part.tags.join(' ')}`.toLowerCase().includes(q)
			),
		[project.parts, q]
	);
	const library = React.useMemo(
		() =>
			libraryItems.filter((item) =>
				`${item.name} ${item.brand} ${item.tags.join(' ')}`.toLowerCase().includes(q)
			),
		[q]
	);
	const activeLayout = project.layouts.find((layout) => layout.id === layoutId);
	const placements = React.useMemo(
		() => project.placements.filter((placement) => placement.layoutId === layoutId),
		[project.placements, layoutId]
	);
	const runs = React.useMemo(
		() => project.runs.filter((run) => run.layoutId === layoutId),
		[project.runs, layoutId]
	);
	const layerRows = React.useMemo(
		() =>
			placements.flatMap((placement) => {
				const instance = index.instancesById.get(placement.instanceId);
				const part = instance ? index.partsById.get(instance.partId) : undefined;
				return part && `${part.name} ${instance?.label ?? ''}`.toLowerCase().includes(lq)
					? [{ placement, part, label: instance?.label || part.name }]
					: [];
			}),
		[placements, index, lq]
	);
	const filteredRuns = React.useMemo(
		() => runs.filter((run) => run.name.toLowerCase().includes(lq)),
		[runs, lq]
	);
	const layerExpanded = Boolean(lq) || !collapsed.has(layoutId ?? '');
	const rootLayerId = `surface:${layoutId ?? ''}`;
	const visibleLayerIds = React.useMemo(
		() =>
			new Set([
				rootLayerId,
				...(layerExpanded
					? [...layerRows.map((row) => row.placement.id), ...filteredRuns.map((run) => run.id)]
					: [])
			]),
		[rootLayerId, layerExpanded, layerRows, filteredRuns]
	);
	const preferredLayer = focusedLayer ?? selection?.id;
	const tabLayerId =
		preferredLayer && visibleLayerIds.has(preferredLayer) ? preferredLayer : rootLayerId;
	const selectedRun =
		selection?.kind === 'run' ? project.runs.find((run) => run.id === selection.id) : null;
	const selectedPlacement =
		selection?.kind === 'placement'
			? project.placements.find((placement) => placement.id === selection.id)
			: null;
	const selectedPart = selectedPlacement
		? getPartForInstance(project, selectedPlacement.instanceId)
		: null;
	const questionTarget = selectedRun
		? { type: 'run' as const, id: selectedRun.id, label: selectedRun.name }
		: selectedPart
			? { type: 'part' as const, id: selectedPart.id, label: selectedPart.name }
			: { type: 'project' as const, id: project.id, label: project.name };
	const questionCount = project.reviews.filter(
		(note) =>
			note.targetType === questionTarget.type &&
			note.targetId === questionTarget.id &&
			note.status === 'open'
	).length;
	function changeTab(next: 'file' | 'assets' | 'checks'): void {
		cx.$sidebarTab.set(next);
		cx.$sidebarOpen.set(true);
	}
	function drag(event: React.DragEvent, kind: 'part' | 'library', id: string): void {
		event.dataTransfer.setData('application/x-yadori-asset', JSON.stringify({ kind, id }));
		event.dataTransfer.effectAllowed = 'copy';
	}
	function selectPlacement(id: string, targetLayoutId: string): void {
		cx.$layoutId.set(targetLayoutId);
		cx.$selection.set({ kind: 'placement', id });
	}
	function treeKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key))
			return;
		const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')];
		const current = rows.findIndex((row) => row === event.target);
		if (current < 0) return;
		event.preventDefault();
		event.stopPropagation();
		let next = current;
		if (event.key === 'ArrowDown') next = Math.min(current + 1, rows.length - 1);
		if (event.key === 'ArrowUp') next = Math.max(current - 1, 0);
		if (event.key === 'Home') next = 0;
		if (event.key === 'End') next = rows.length - 1;
		if (event.key === 'ArrowLeft') {
			if (current > 0) next = 0;
			else if (activeLayout && layerExpanded && !lq) toggleLayers(activeLayout.id);
		}
		if (event.key === 'ArrowRight' && current === 0) {
			if (!layerExpanded && activeLayout) toggleLayers(activeLayout.id);
			else next = Math.min(1, rows.length - 1);
		}
		const row = rows[next];
		if (!row) return;
		row.focus({ preventScroll: true });
		row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		const id = row.dataset['layerId'];
		if (row.dataset['layerKind'] === 'placement' && id && layoutId) selectPlacement(id, layoutId);
		if (row.dataset['layerKind'] === 'run' && id) cx.$selection.set({ kind: 'run', id });
	}
	function selectFinding(finding: TFinding): void {
		if (finding.targetType === 'run') {
			const run = project.runs.find((item) => item.id === finding.targetId);
			if (run) {
				cx.$layoutId.set(run.layoutId);
				cx.$selection.set({ kind: 'run', id: run.id });
			}
		} else {
			const placement = project.placements.find((item) =>
				finding.targetType === 'placement'
					? item.id === finding.targetId
					: getPartForInstance(project, item.instanceId)?.id === finding.targetId
			);
			if (placement) selectPlacement(placement.id, placement.layoutId);
			else if (finding.targetType === 'part') cx.openPart(finding.targetId);
			else cx.projectMenu();
		}
	}
	function addSurface(): void {
		const layout = createLayout('Surface ' + (project.layouts.length + 1), 2000, 1200);
		cx.execute([{ type: 'layout.add', layout }], 'Add surface');
		cx.$layoutId.set(layout.id);
		cx.$selection.set(null);
	}
	function toggleLayers(id: string): void {
		setCollapsed((previous) => {
			const next = new Set(previous);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}
	return (
		<aside
			className={`canvas-workspace-sidebar ${open ? '' : 'is-collapsed'}`}
			aria-label="Canvas navigation"
		>
			<nav className="workspace-sidebar-rail" aria-label="Workspace">
				<RailButton
					label="File"
					title="Pages and layers"
					icon={<File size={17} />}
					active={open && tab === 'file'}
					onClick={() => changeTab('file')}
				/>
				<RailButton
					label="Parts"
					title="Parts and library"
					icon={<Package size={18} />}
					active={open && tab === 'assets'}
					onClick={() => changeTab('assets')}
				/>
				<RailButton
					label="Checks"
					icon={<CircleAlert size={18} />}
					active={open && tab === 'checks'}
					onClick={() => changeTab('checks')}
				/>
				<div className="workspace-rail-spacer" />
				<RailButton
					label="Assistant"
					icon={<Bot size={18} />}
					count={assistantProposalCount}
					busy={assistantBusy}
					onClick={() => cx.openAssistant()}
				/>
				<button
					className="workspace-rail-collapse"
					title={open ? 'Collapse sidebar' : 'Expand sidebar'}
					aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
					onClick={() => cx.$sidebarOpen.set(!open)}
				>
					{open ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
				</button>
			</nav>
			{open && (
				<div className="workspace-sidebar-panel">
					<header className="workspace-sidebar-header">
						<button
							onClick={() => cx.projectMenu()}
							title="Project menu"
							aria-label={`Project menu: ${project.name}`}
						>
							<strong>{project.name}</strong>
							<ChevronDown size={12} />
						</button>
						<span>
							{tab === 'file' ? 'File' : tab === 'assets' ? 'Parts & library' : 'Project checks'}
						</span>
					</header>
					{tab === 'file' && (
						<>
							<section className="workspace-pages" aria-label="Pages">
								<div className="workspace-section-heading">
									<strong>Pages</strong>
									<button aria-label="Add surface" title="Add surface" onClick={addSurface}>
										<Plus size={14} />
									</button>
								</div>
								<div className="workspace-pages-list">
									{project.layouts.map((layout) => (
										<button
											key={layout.id}
											className={`workspace-tree-row workspace-page ${layoutId === layout.id ? 'is-active' : ''}`}
											onClick={() => {
												cx.$layoutId.set(layout.id);
												cx.$selection.set(null);
											}}
										>
											<Frame size={14} />
											<span>{layout.name}</span>
											{layoutId === layout.id && <Check size={12} />}
										</button>
									))}
									{!project.layouts.length && (
										<button className="workspace-tree-row" onClick={addSurface}>
											<Plus size={13} />
											<span>Add a surface</span>
										</button>
									)}
								</div>
							</section>
							<div className="workspace-section-heading workspace-layers-heading">
								<strong>Layers</strong>
								<button
									aria-label={searchLayers ? 'Close layer search' : 'Search layers'}
									onClick={() => {
										setSearchLayers(!searchLayers);
										setLayerQuery('');
									}}
								>
									{searchLayers ? <X size={13} /> : <Search size={13} />}
								</button>
							</div>
							{searchLayers && (
								<SearchField value={layerQuery} onChange={setLayerQuery} label="Search layers" />
							)}
							<ScrollArea
								className="workspace-layer-tree"
								scrollKey={`${project.id}:layers:${layoutId}`}
								positions={scrollPositionsRef}
								resetKey={layerQuery}
								role="tree"
								aria-label="Layers"
								onKeyDown={treeKeyDown}
							>
								{activeLayout && (
									<button
										className="workspace-tree-row workspace-surface-row"
										role="treeitem"
										aria-level={1}
										aria-expanded={layerExpanded}
										tabIndex={tabLayerId === rootLayerId ? 0 : -1}
										data-layer-id={rootLayerId}
										onFocus={() => setFocusedLayer(rootLayerId)}
										onClick={() => toggleLayers(activeLayout.id)}
									>
										{!layerExpanded ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
										<Frame size={13} />
										<span>{activeLayout.name}</span>
									</button>
								)}
								{layerExpanded && (
									<div role="group">
										{layerRows.map(({ placement, part, label }) => (
											<button
												key={placement.id}
												role="treeitem"
												aria-level={2}
												aria-selected={
													selection?.kind === 'placement' && selection.id === placement.id
												}
												tabIndex={tabLayerId === placement.id ? 0 : -1}
												data-layer-id={placement.id}
												data-layer-kind="placement"
												className={`workspace-tree-row workspace-layer-row ${selection?.kind === 'placement' && selection.id === placement.id ? 'is-selected' : ''}`}
												title={`${part.name} · double-click to reveal`}
												onFocus={() => setFocusedLayer(placement.id)}
												onClick={() => selectPlacement(placement.id, placement.layoutId)}
												onDoubleClick={() => cx.$focus.set(placement.id)}
											>
												<Square size={12} />
												<span>{label}</span>
											</button>
										))}
										{filteredRuns.map((run) => (
											<button
												key={run.id}
												role="treeitem"
												aria-level={2}
												aria-selected={selection?.kind === 'run' && selection.id === run.id}
												tabIndex={tabLayerId === run.id ? 0 : -1}
												data-layer-id={run.id}
												data-layer-kind="run"
												className={`workspace-tree-row workspace-layer-row ${selection?.kind === 'run' && selection.id === run.id ? 'is-selected' : ''}`}
												title={`${run.name} · double-click to reveal`}
												onDoubleClick={() => cx.$focus.set(run.id)}
												onFocus={() => setFocusedLayer(run.id)}
												onClick={() => cx.$selection.set({ kind: 'run', id: run.id })}
											>
												<Cable size={13} />
												<span>{run.name}</span>
											</button>
										))}
									</div>
								)}
								{lq && !layerRows.length && !filteredRuns.length && (
									<div className="workspace-sidebar-empty">No matching layers</div>
								)}
								{!placements.length && !runs.length && (
									<div className="workspace-sidebar-empty">
										<Layers size={18} />
										<span>No layers on this page</span>
										<button onClick={() => changeTab('assets')}>
											Insert a part <ArrowUpRight size={12} />
										</button>
									</div>
								)}
							</ScrollArea>
						</>
					)}
					{tab === 'assets' && (
						<>
							<div className="workspace-source-tabs" role="tablist" aria-label="Part source">
								{(['project', 'library'] as const).map((item) => (
									<button
										key={item}
										role="tab"
										aria-selected={source === item}
										onClick={() => cx.$assetSource.set(item)}
									>
										{item === 'project' ? 'In this project' : 'Library'}
									</button>
								))}
							</div>
							<SearchField
								value={query}
								onChange={(next) => cx.$assetQuery.set(next)}
								label={source === 'project' ? 'Search project parts' : 'Search library'}
							/>
							<div className="workspace-section-heading">
								<strong>{source === 'project' ? 'Project parts' : 'All components'}</strong>
								<span>{source === 'project' ? parts.length : library.length}</span>
							</div>
							<ScrollArea
								className="workspace-assets-list"
								scrollKey={`${project.id}:assets:${source}`}
								positions={scrollPositionsRef}
								resetKey={query}
							>
								{source === 'project'
									? parts.map((part) => {
											const cable = getCapability(part, 'cable');
											const count = index.placedCounts.get(part.id) ?? 0;
											const allPlaced = !cable && count >= part.quantity && count > 0;
											const selected = cable
												? materialId === part.id && tool === 'wire'
												: Boolean(
														selectedPlacement &&
														index.instancesById.get(selectedPlacement.instanceId)?.partId ===
															part.id
													);
											return (
												<div
													key={part.id}
													className={`workspace-project-asset ${selected ? 'is-selected' : ''}`}
												>
													<button
														className="workspace-asset-row"
														draggable
														onDragStart={(event) => drag(event, 'part', part.id)}
														onClick={() => cx.place(part, position())}
														title={`${part.name} · ${cable ? 'Use for wire' : allPlaced ? 'Select placed unit' : 'Place on canvas'}`}
													>
														{cable ? (
															<span className="workspace-asset-artwork">
																<Cable size={22} />
															</span>
														) : (
															<PartArtwork
																part={part}
																project={project}
																className="workspace-asset-artwork"
															/>
														)}
														<span className="workspace-asset-label">
															<strong>{part.name}</strong>
															<small>
																{cable
																	? `${cable.crossSectionMm2 != null ? `${cable.crossSectionMm2} mm² · ` : ''}Wire material`
																	: `${count} of ${Math.max(part.quantity, count)} placed`}
															</small>
														</span>
													</button>
													{allPlaced && (
														<button
															className="workspace-add-unit"
															aria-label={`Place another ${part.name}`}
															title="Place another unit"
															onClick={() => cx.place(part, position(), true)}
														>
															<Plus size={14} />
														</button>
													)}
												</div>
											);
										})
									: library.map((item) => {
											const asset = getCapability(item, 'appearance')?.assetId;
											const url = getLibraryAssetUrl(asset);
											const cable = getCapability(item, 'cable');
											return (
												<button
													key={item.id}
													className="workspace-asset-row"
													draggable
													onDragStart={(event) => drag(event, 'library', item.id)}
													onClick={() => cx.addPreset(item, position())}
													title={`${item.name} · ${cable ? 'Add wire material' : 'Add to project and place'}`}
												>
													<span className="workspace-asset-artwork">
														{url ? (
															<img src={url} alt="" draggable={false} />
														) : cable ? (
															<Cable size={22} />
														) : (
															<Package size={21} />
														)}
													</span>
													<span className="workspace-asset-label">
														<strong>{item.name}</strong>
														<small>{cable ? 'Wire material' : item.brand || 'Generic'}</small>
													</span>
												</button>
											);
										})}
								{!(source === 'project' ? parts : library).length && (
									<div className="workspace-sidebar-empty">
										{q ? 'No matching parts' : 'No project parts yet'}
									</div>
								)}
							</ScrollArea>
							<footer className="workspace-sidebar-footer">
								<button onClick={() => cx.createPart()}>
									<Plus size={14} />
									Custom part
								</button>
								<button onClick={() => cx.showParts()}>
									<Table2 size={14} />
									Parts table
									<ArrowUpRight size={12} />
								</button>
							</footer>
						</>
					)}
					{tab === 'checks' && (
						<ScrollArea
							className="workspace-check-list"
							scrollKey={`${project.id}:checks`}
							positions={scrollPositionsRef}
						>
							<details
								className="workspace-check-group workspace-question-group"
								key={`${questionTarget.type}:${questionTarget.id}`}
							>
								<summary title={`Questions for ${questionTarget.label}`}>
									<ChevronRight size={12} />
									<strong>Questions</strong>
									<span>{questionCount || <Plus size={12} />}</span>
								</summary>
								<div className="workspace-question-context" title={questionTarget.label}>
									{questionTarget.type === 'project'
										? 'Project'
										: questionTarget.type === 'run'
											? 'Wire'
											: 'Part'}{' '}
									· {questionTarget.label}
								</div>
								<ReviewNotes
									key={`${questionTarget.type}:${questionTarget.id}`}
									project={project}
									target={questionTarget}
									onCommands={(commands) => cx.execute(commands, 'Review question')}
								/>
							</details>
							{checkGroups.map((group) => (
								<details
									key={`${group.severity}:${group.title}`}
									open={group.severity === 'error'}
									className={`workspace-check-group is-${group.severity}`}
								>
									<summary>
										<ChevronRight size={12} />
										<strong>{group.title}</strong>
										<span>{group.items.length}</span>
									</summary>
									{group.items.map((finding) => (
										<button
											key={finding.id}
											className="workspace-check-row"
											onClick={() => selectFinding(finding)}
											aria-label={`${finding.title}: ${findingTarget(project, finding)}`}
											title={finding.detail}
										>
											<span className="workspace-check-dot" />
											<span>
												<strong>{findingTarget(project, finding)}</strong>
											</span>
											<ChevronRight size={12} />
										</button>
									))}
								</details>
							))}
							{!findings.length && (
								<div className="workspace-sidebar-empty">
									<Check size={18} />
									<span>No open checks</span>
								</div>
							)}
						</ScrollArea>
					)}
				</div>
			)}
		</aside>
	);
});
interface TCanvasSidebarProps {
	cx: CanvasCx;
	project: TProject;
	position: () => TPoint;
	assistantBusy?: boolean;
	assistantProposalCount?: number;
}

const ScrollArea: React.FC<
	React.HTMLAttributes<HTMLDivElement> & {
		scrollKey: string;
		positions: React.RefObject<Map<string, number>>;
		resetKey?: string;
	}
> = ({ scrollKey, positions, resetKey, className = '', children, ...props }) => {
	const ref = React.useRef<HTMLDivElement>(null);
	const previousResetRef = React.useRef(resetKey);
	React.useLayoutEffect(() => {
		if (ref.current) ref.current.scrollTop = positions.current.get(scrollKey) ?? 0;
	}, [scrollKey, positions]);
	React.useLayoutEffect(() => {
		if (previousResetRef.current !== resetKey && ref.current) ref.current.scrollTop = 0;
		previousResetRef.current = resetKey;
	}, [resetKey]);
	return (
		<div
			{...props}
			ref={ref}
			className={`workspace-sidebar-scroll ${className}`}
			onScroll={(event) => positions.current.set(scrollKey, event.currentTarget.scrollTop)}
		>
			{children}
		</div>
	);
};

const RailButton: React.FC<{
	label: string;
	title?: string;
	icon: React.ReactNode;
	active?: boolean;
	count?: number;
	busy?: boolean;
	onClick: () => void;
}> = ({ label, title, icon, active, count = 0, busy, onClick }) => (
	<button
		className={`workspace-rail-button ${active ? 'is-active' : ''} ${busy ? 'is-busy' : ''}`}
		title={title ?? label}
		aria-label={title ?? label}
		aria-pressed={active}
		onClick={onClick}
	>
		<span className="workspace-rail-icon">
			{icon}
			{count > 0 && <span className="workspace-rail-badge">{count > 99 ? '99+' : count}</span>}
			{busy && <span className="workspace-rail-busy" />}
		</span>
		<span>{label}</span>
	</button>
);
const SearchField: React.FC<{
	value: string;
	onChange: (value: string) => void;
	label: string;
}> = ({ value, onChange, label }) => (
	<div className="workspace-sidebar-search">
		<Search size={13} />
		<input
			aria-label={label}
			placeholder={label}
			value={value}
			onChange={(event) => onChange(event.target.value)}
		/>
		{value && (
			<button aria-label="Clear search" onClick={() => onChange('')}>
				<X size={12} />
			</button>
		)}
	</div>
);
function findingTarget(project: TProject, finding: TFinding): string {
	if (finding.targetType === 'part')
		return project.parts.find((part) => part.id === finding.targetId)?.name ?? 'Part';
	if (finding.targetType === 'run')
		return project.runs.find((run) => run.id === finding.targetId)?.name ?? 'Wire';
	if (finding.targetType === 'placement') {
		const placement = project.placements.find((item) => item.id === finding.targetId);
		return placement
			? (getPartForInstance(project, placement.instanceId)?.name ?? 'Placement')
			: 'Placement';
	}
	return project.name;
}
