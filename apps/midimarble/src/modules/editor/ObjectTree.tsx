import {
	Box,
	Camera,
	ChevronDown,
	ChevronRight,
	Circle,
	Layers,
	Lightbulb,
	Music2,
	Route,
	Search,
	X
} from 'lucide-react';
import React from 'react';
import { getProjectMarbles, type TProject, type TSceneObject } from '../project';
import { ContextHelp } from './ContextHelp';
import type { TEditorEntity } from './editor-types';
import {
	getAdjacentObjectId,
	getObjectCollections,
	type TObjectFilter,
	type TObjectNavigationKey
} from './outliner';
import { SceneObjectRow } from './SceneObjectRow';
import './ObjectTree.css';

export const ObjectTree: React.FC<TObjectTreeProps> = (props) => {
	const {
		project,
		selectedId,
		selectedMarbleId,
		onSelectMarble,
		entity,
		onSelect,
		onUpdate,
		onEntity,
		onDuplicate,
		onDelete,
		onLink,
		onFrame,
		onDragObject,
		onDropObject
	} = props;
	const [query, setQuery] = React.useState('');
	const [filter, setFilter] = React.useState<TObjectFilter>('all');
	const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
	const [collapsedSearch, setCollapsedSearch] = React.useState<Set<string>>(() => new Set());
	const [marblesOpen, setMarblesOpen] = React.useState(true);
	const [revealedSelection, setRevealedSelection] = React.useState('');
	const bodyRef = React.useRef<HTMLDivElement>(null);
	const searchRef = React.useRef<HTMLInputElement>(null);
	const allCollections = React.useMemo(() => getObjectCollections(project), [project]);
	const collections = React.useMemo(
		() => getObjectCollections(project, query, filter),
		[project, query, filter]
	);
	const selectedCollectionId = allCollections.find((collection) =>
		collection.objects.some((object) => object.id === selectedId)
	)?.id;
	const searching = query.trim().length > 0 || filter !== 'all';
	const isExpanded = React.useCallback(
		(id: string) => (searching ? !collapsedSearch.has(id) : expanded.has(id)),
		[searching, collapsedSearch, expanded]
	);
	const visibleIds = React.useMemo(
		() =>
			collections.flatMap((collection) =>
				isExpanded(collection.id) ? collection.objects.map((object) => object.id) : []
			),
		[collections, isExpanded]
	);
	const marbles = React.useMemo(
		() =>
			getProjectMarbles(project).filter((marble) =>
				(marble.name ?? 'Marble').toLowerCase().includes(query.trim().toLowerCase())
			),
		[project, query]
	);
	const matchingCount = collections.reduce((sum, collection) => sum + collection.objects.length, 0);
	const linkedCount = project.objects.filter(
		(object) => object.binding != null || object.trajectoryAnchor != null
	).length;

	// MARK: - Actions
	const clearSearch = React.useCallback(() => {
		setQuery('');
		setFilter('all');
		setCollapsedSearch(new Set());
	}, []);
	const toggleCollection = React.useCallback(
		(id: string) => {
			if (searching)
				setCollapsedSearch((current) => {
					const next = new Set(current);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			else
				setExpanded((current) => {
					const next = new Set(current);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
		},
		[searching]
	);
	const navigate = React.useCallback(
		(id: string, key: TObjectNavigationKey) => {
			const nextId = getAdjacentObjectId(visibleIds, id, key);
			if (nextId == null) return;
			onSelect(nextId);
			const next = Array.from(
				bodyRef.current?.querySelectorAll<HTMLButtonElement>('[data-object-id]') ?? []
			).find((button) => button.dataset['objectId'] === nextId);
			next?.focus();
		},
		[visibleIds, onSelect]
	);
	const selectionKey =
		entity === 'object' ? `${selectedId ?? ''}:${selectedCollectionId ?? ''}` : '';
	// Reveal each new selection once, so an explicit collection collapse stays respected
	if (revealedSelection !== selectionKey) {
		setRevealedSelection(selectionKey);
		if (entity === 'object' && selectedId != null && selectedCollectionId != null) {
			if (
				!collections.some((collection) =>
					collection.objects.some((object) => object.id === selectedId)
				)
			)
				clearSearch();
			setExpanded((current) => new Set(current).add(selectedCollectionId));
			setCollapsedSearch((current) => {
				const next = new Set(current);
				next.delete(selectedCollectionId);
				return next;
			});
		}
	}

	// MARK: - UI
	return (
		<aside className="object-tree" aria-label="Scene outliner">
			<div className="panel-title">
				<Layers size={14} />
				<strong>Scene Collection</strong>
				<ContextHelp label="Scene collection help" placement="below">
					<p>
						Use + in the floating toolbar to add an object. Press F to frame the selection.
						Double-click an object to rename it, or a marble, camera, or light to frame it.
					</p>
					<p>
						Search by name, model, track, or pitch such as C4. World objects keep their position;
						linked objects follow their trajectory.
					</p>
				</ContextHelp>
				<span>{project.objects.length}</span>
			</div>
			<div className="tree-search">
				<Search size={13} />
				<input
					ref={searchRef}
					aria-label="Search scene objects"
					placeholder="Name, model, track, pitch…"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setCollapsedSearch(new Set());
					}}
					onKeyDown={(event) => {
						if (event.key === 'Escape' && searching) {
							event.preventDefault();
							event.stopPropagation();
							clearSearch();
						}
					}}
				/>
				{query.length > 0 && (
					<button
						className="tree-search-clear"
						aria-label="Clear object search"
						onClick={() => {
							setQuery('');
							setCollapsedSearch(new Set());
							searchRef.current?.focus();
						}}
					>
						<X size={12} />
					</button>
				)}
			</div>
			<div className="tree-filters" role="group" aria-label="Filter scene objects">
				{(['all', 'linked', 'world'] as const).map((value) => (
					<button
						key={value}
						aria-pressed={filter === value}
						onClick={() => {
							setFilter(value);
							setCollapsedSearch(new Set());
						}}
					>
						{value === 'all' ? 'All' : value === 'linked' ? 'Linked' : 'World'}
					</button>
				))}
				<span aria-live="polite">{matchingCount} objects</span>
			</div>
			<div ref={bodyRef} className="tree-body" role="tree" aria-label="Scene objects">
				<button
					className={`tree-row collection ${entity === 'project' ? 'selected' : ''}`}
					aria-pressed={entity === 'project'}
					onClick={() => onEntity('project')}
				>
					<Layers size={13} />
					<span>Scene</span>
				</button>
				{(
					[
						{ id: 'camera', name: 'Camera', Icon: Camera },
						{ id: 'lighting', name: 'Studio lighting', Icon: Lightbulb }
					] as const
				).map(({ id, name, Icon }) => (
					<button
						key={id}
						className={`tree-row scene-entity ${entity === id ? 'selected' : ''}`}
						aria-pressed={entity === id}
						onClick={() => onEntity(id)}
						onDoubleClick={() => onFrame(`entity:${id}`)}
						title={`${name} · Double-click to frame`}
					>
						<Icon size={13} />
						<span>{name}</span>
					</button>
				))}
				{marbles.length > 0 && (
					<>
						<button
							className="tree-row collection"
							onClick={() => setMarblesOpen(!marblesOpen)}
							aria-expanded={marblesOpen}
						>
							{marblesOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
							<Circle size={13} />
							<span>Marbles</span>
							<small>{marbles.length}</small>
						</button>
						{marblesOpen &&
							marbles.map((marble, index) => (
								<button
									key={marble.id}
									className={`tree-row scene-entity ${entity === 'marble' && (selectedMarbleId ?? 'main') === marble.id ? 'selected' : ''}`}
									aria-pressed={entity === 'marble' && (selectedMarbleId ?? 'main') === marble.id}
									onClick={() => {
										if (onSelectMarble) onSelectMarble(marble.id);
										else onEntity('marble');
									}}
									onDoubleClick={() => onFrame(`marble:${marble.id}`)}
									title={`${marble.name ?? `Marble ${index + 1}`} · Double-click to frame`}
								>
									<Circle size={12} style={{ color: marble.color }} />
									<span>{marble.name ?? `Marble ${index + 1}`}</span>
									{(marble.startTime ?? 0) > 0 && <small>{marble.startTime?.toFixed(1)}s</small>}
								</button>
							))}
					</>
				)}
				{collections.map((collection) => {
					const open = isExpanded(collection.id);
					const Icon =
						collection.kind === 'track' ? Music2 : collection.kind === 'guides' ? Route : Box;
					const containsSelection = entity === 'object' && collection.id === selectedCollectionId;
					return (
						<div
							key={collection.id}
							className="tree-collection"
							role="treeitem"
							aria-expanded={open}
							aria-level={1}
							aria-label={collection.label}
						>
							<button
								className={`tree-row collection ${containsSelection && !open ? 'contains-selection' : ''}`}
								data-collection-id={collection.id}
								aria-expanded={open}
								onClick={() => toggleCollection(collection.id)}
								title={`${collection.label} · ${collection.objects.length} objects`}
								onKeyDown={(event) => {
									if (
										(event.key === 'ArrowRight' && !open) ||
										(event.key === 'ArrowLeft' && open)
									) {
										event.preventDefault();
										event.stopPropagation();
										toggleCollection(collection.id);
									}
								}}
							>
								{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
								<Icon size={13} style={{ color: collection.color }} />
								<span>{collection.label}</span>
								<small>{collection.objects.length}</small>
							</button>
							{open && (
								<div role="group" aria-label={`${collection.label} objects`}>
									{collection.objects.map((object) => (
										<SceneObjectRow
											key={object.id}
											object={object}
											selected={selectedId === object.id && entity === 'object'}
											tabStop={
												selectedId === object.id ||
												(!visibleIds.includes(selectedId ?? '') && visibleIds[0] === object.id)
											}
											onSelect={onSelect}
											onUpdate={onUpdate}
											onDuplicate={onDuplicate}
											onDelete={onDelete}
											onLink={onLink}
											onFrame={onFrame}
											onNavigate={navigate}
											onDragObject={onDragObject}
											onDropObject={onDropObject}
											onCollapse={() => {
												toggleCollection(collection.id);
												const header = Array.from(
													bodyRef.current?.querySelectorAll<HTMLButtonElement>(
														'[data-collection-id]'
													) ?? []
												).find((button) => button.dataset['collectionId'] === collection.id);
												header?.focus();
											}}
										/>
									))}
								</div>
							)}
						</div>
					);
				})}
				{!matchingCount && (
					<div className="empty-tree">
						<p>{searching ? 'No matching objects.' : 'No objects yet.'}</p>
						{searching && (
							<button className="button full" onClick={clearSearch}>
								Clear search and filters
							</button>
						)}
					</div>
				)}
			</div>
			<div className="tree-footer">
				<span>
					<i className="linked-dot" />
					{linkedCount} linked
				</span>
				<span>{project.objects.length - linkedCount} world</span>
			</div>
		</aside>
	);
};

interface TObjectTreeProps {
	project: TProject;
	selectedId: string | null;
	selectedMarbleId?: string | null;
	onSelectMarble?(id: string): void;
	entity: TEditorEntity;
	onSelect(id: string): void;
	onEntity(entity: TEditorEntity): void;
	onUpdate(id: string, patch: Partial<TSceneObject>): void;
	onDuplicate(): void;
	onDelete(): void;
	onLink(): void;
	onFrame(id?: string): void;
	onDragObject?(id: string | null): void;
	onDropObject?(objectId: string, noteId: string): void;
}
