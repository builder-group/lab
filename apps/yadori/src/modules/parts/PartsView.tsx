import { useFeatureState } from 'feature-react/state';
import {
	Archive,
	ArrowDownUp,
	ArrowUpRight,
	Check,
	Filter,
	Link2,
	MoreHorizontal,
	PanelRight,
	Plus,
	Search,
	Table2,
	Tag,
	X
} from 'lucide-react';
import React from 'react';
import { Popover } from '../../components/Popover';
import { Button, IconButton, RequirementQuantity } from '../../components/ui';
import { openLink } from '../../environment/open-link';
import { money, quantity } from '../../lib/format';
import { getParts, type TPart, type TPartRow, type TProject } from '../project/model';
import { PartArtwork } from './components/PartArtwork';
import { PurchaseDialog } from './components/PurchaseDialog';
import type { PartsCx } from './PartsCx';
import '../../styles/parts.css';

type TPopup = {
	kind: 'filter' | 'sort' | 'tags' | 'links' | 'menu';
	anchor: HTMLElement;
	partId?: string;
};
export const PartsView: React.FC<{ cx: PartsCx }> = React.memo(({ cx }) => {
	const project = useFeatureState(cx.session.$project);
	const filter = useFeatureState(cx.$filter);
	const query = useFeatureState(cx.$query);
	const tag = useFeatureState(cx.$tag);
	const sort = useFeatureState(cx.$sort);
	const selected = useFeatureState(cx.$selectedId);
	const [popup, setPopup] = React.useState<TPopup | null>(null);
	const [adding, setAdding] = React.useState(false);
	const [draft, setDraft] = React.useState('');
	const [purchase, setPurchase] = React.useState<string | null>(null);
	const closePopup = React.useCallback(() => setPopup(null), []);
	const allRows = React.useMemo(() => (project ? getParts(project) : []), [project]);
	const tags = React.useMemo(
		() =>
			[...new Set(project?.parts.flatMap((part) => part.tags) ?? [])].sort((a, b) =>
				a.localeCompare(b)
			),
		[project]
	);
	const sourcesByPart = React.useMemo(() => {
		const counts = new Map<string, number>();
		for (const source of project?.sources ?? [])
			counts.set(source.partId, (counts.get(source.partId) ?? 0) + 1);
		return counts;
	}, [project]);
	const show = React.useCallback(
		(kind: TPopup['kind'], anchor: HTMLElement, partId?: string): void => {
			setPopup((current) => (current?.anchor === anchor ? null : { kind, anchor, partId }));
		},
		[]
	);

	if (!project) return null;
	const rowEstimate = (row: TPartRow): number | null =>
		filter === 'to-buy'
			? row.estimatedUnitPrice == null
				? null
				: row.remainingToBuy * row.estimatedUnitPrice
			: row.knownEstimate;

	const normalizedQuery = query.trim().toLowerCase();
	const rows = allRows
		.filter(
			(row) =>
				matchesView(row, filter) &&
				(!tag || row.part.tags.includes(tag)) &&
				`${row.part.name} ${row.part.brand} ${row.part.tags.join(' ')}`
					.toLowerCase()
					.includes(normalizedQuery)
		)
		.sort((a, b) =>
			sort === 'name'
				? a.part.name.localeCompare(b.part.name)
				: sort === 'cost-high'
					? (rowEstimate(b) ?? -1) - (rowEstimate(a) ?? -1)
					: sort === 'cost-low'
						? (rowEstimate(a) ?? Infinity) - (rowEstimate(b) ?? Infinity)
						: 0
		);
	const estimate = rows.reduce((sum, row) => sum + (rowEstimate(row) ?? 0), 0);
	const hasEstimate = rows.some((row) => rowEstimate(row) != null);
	const paid = rows.reduce((sum, row) => sum + row.purchaseCost, 0);
	const incomplete = rows.filter((row) => row.unknownCost || !row.requiredQuantityComplete).length;
	const activePart = popup?.partId ? project.parts.find((part) => part.id === popup.partId) : null;
	const purchasedPart = project.parts.find((part) => part.id === purchase);

	function capture(text = draft): void {
		if (!text.trim()) {
			setAdding(false);
			return;
		}
		cx.capture(text, undefined, { open: false });
		setDraft('');
		setAdding(false);
	}
	return (
		<div className="parts-view database-view">
			<div className="database-heading">
				<h1>Parts</h1>
				<span className="view-toolbar-spacer" />
				<IconButton label="View options" onClick={(event) => show('filter', event.currentTarget)}>
					<MoreHorizontal size={18} />
				</IconButton>
			</div>
			<div className="database-toolbar">
				<div className="database-views" role="tablist" aria-label="Parts views">
					{(
						[
							{ id: 'all', label: 'All parts' },
							{ id: 'in-build', label: 'In build' },
							{ id: 'wishlist', label: 'Wishlist' },
							{ id: 'to-buy', label: 'To buy' }
						] as const
					).map((view) => (
						<button
							key={view.id}
							role="tab"
							aria-selected={filter === view.id}
							className={filter === view.id ? 'active' : ''}
							onClick={() => {
								cx.$filter.set(view.id);
								setPopup(null);
							}}
						>
							<Table2 size={14} />
							{view.label}
						</button>
					))}
					{filter === 'archived' && (
						<button className="active" role="tab" aria-selected>
							Archived
						</button>
					)}
				</div>
				<span className="view-toolbar-spacer" />
				<button
					className={`database-tool ${tag ? 'active' : ''}`}
					onClick={(event) => show('filter', event.currentTarget)}
				>
					<Filter size={14} />
					<span>Filter</span>
					{tag && <i />}
				</button>
				<button
					className={`database-tool ${sort !== 'manual' ? 'active' : ''}`}
					onClick={(event) => show('sort', event.currentTarget)}
				>
					<ArrowDownUp size={14} />
					<span>Sort</span>
				</button>
				<label className="database-search">
					<Search size={14} />
					<input
						aria-label="Search parts"
						placeholder="Search"
						value={query}
						onChange={(event) => cx.$query.set(event.target.value)}
					/>
					{query && (
						<IconButton label="Clear search" onClick={() => cx.$query.set('')}>
							<X size={12} />
						</IconButton>
					)}
				</label>
				<Button
					variant="primary"
					icon={<Plus size={14} />}
					onClick={() => cx.$captureOpen.set(true)}
				>
					New
				</Button>
			</div>
			{tag && (
				<div className="database-filters">
					<button onClick={() => cx.$tag.set(null)}>
						<Tag size={12} />
						Tags contains {tag}
						<X size={12} />
					</button>
				</div>
			)}
			<div className="parts-table-wrap">
				<table className="parts-table database-table">
					<thead>
						<tr>
							<th className="name-column">
								<span className="property-type">Aa</span>Name
							</th>
							<th className="build-column">Build</th>
							<th className="tags-column">
								<Tag size={12} />
								Tags
							</th>
							<th className="numeric">Needed</th>
							<th className="numeric">Bought</th>
							<th className="numeric">Unit price</th>
							<th className="numeric">{filter === 'to-buy' ? 'Left to buy' : 'Estimate'}</th>
							<th className="links-column">
								<Link2 size={12} />
								Links
							</th>
							<th className="row-menu-column" />
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<PartTableRow
								key={row.part.id}
								row={row}
								project={project}
								cx={cx}
								selected={selected === row.part.id}
								estimate={rowEstimate(row)}
								sourceCount={sourcesByPart.get(row.part.id) ?? 0}
								onShow={show}
								onPurchase={setPurchase}
							/>
						))}
						<tr className="new-part-row">
							<td colSpan={9}>
								{adding ? (
									<div className="inline-capture">
										<Plus size={14} />
										<input
											autoFocus
											aria-label="New part name or link"
											value={draft}
											onChange={(event) => setDraft(event.target.value)}
											placeholder="Part name or product link"
											onBlur={(event) => capture(event.currentTarget.value)}
											onKeyDown={(event) => {
												if (event.key === 'Enter') event.currentTarget.blur();
												if (event.key === 'Escape') {
													event.currentTarget.value = '';
													event.currentTarget.blur();
												}
											}}
										/>
									</div>
								) : (
									<button onClick={() => setAdding(true)}>
										<Plus size={14} />
										New part
									</button>
								)}
							</td>
						</tr>
					</tbody>
					<tfoot>
						<tr>
							<td colSpan={5}>
								{rows.length} parts
								{incomplete > 0 && (
									<span
										className="table-coverage"
										title="The estimate excludes missing specifications and prices"
									>
										{' '}
										· {incomplete} incomplete
									</span>
								)}
							</td>
							<td className="numeric aggregate-label">SUM</td>
							<td className="numeric aggregate-total">
								{incomplete > 0 && hasEstimate ? '≥ ' : ''}
								{hasEstimate ? money(estimate) : 'Not priced'}
							</td>
							<td colSpan={2} />
						</tr>
					</tfoot>
				</table>
				{rows.length === 0 && query && (
					<div className="database-empty">
						No parts match “{query}”.<button onClick={() => cx.$query.set('')}>Clear search</button>
					</div>
				)}
			</div>
			<div className="parts-summary">
				<span>
					{filter === 'wishlist'
						? 'Wishlist · excluded from build'
						: filter === 'all'
							? 'All active parts'
							: filter === 'to-buy'
								? 'Remaining purchases'
								: filter === 'archived'
									? 'Archived parts'
									: 'In build'}
				</span>
				<span className="view-toolbar-spacer" />
				<span>
					Recorded <strong>{money(paid)}</strong>
				</span>
				<button
					onClick={() => cx.$filter.set(filter === 'archived' ? 'all' : 'archived')}
					title="Show archived parts"
				>
					<Archive size={13} />
				</button>
			</div>
			{popup && (
				<Popover
					anchor={popup.anchor}
					label={
						popup.kind === 'filter'
							? 'Filter parts'
							: popup.kind === 'sort'
								? 'Sort parts'
								: popup.kind === 'tags'
									? 'Edit tags'
									: popup.kind === 'links'
										? 'Part links'
										: 'Part actions'
					}
					onClose={closePopup}
					align={
						popup.kind === 'filter' || popup.kind === 'sort' || popup.kind === 'menu'
							? 'end'
							: 'start'
					}
					width={popup.kind === 'links' ? 330 : 250}
				>
					{popup.kind === 'filter' && (
						<>
							<div className="popover-title">Filter</div>
							<label className="popover-field">
								<span>Build</span>
								<select
									value={filter}
									onChange={(event) => cx.$filter.set(event.target.value as typeof filter)}
								>
									<option value="all">All active parts</option>
									<option value="in-build">In build</option>
									<option value="wishlist">Wishlist</option>
									<option value="to-buy">To buy</option>
									<option value="archived">Archived</option>
								</select>
							</label>
							<label className="popover-field">
								<span>Tags</span>
								<select
									value={tag ?? ''}
									onChange={(event) => cx.$tag.set(event.target.value || null)}
								>
									<option value="">Any tag</option>
									{tags.map((value) => (
										<option key={value}>{value}</option>
									))}
								</select>
							</label>
							<button
								className="popover-item"
								onClick={() => {
									cx.$tag.set(null);
									cx.$filter.set('all');
								}}
							>
								Clear filters
							</button>
						</>
					)}
					{popup.kind === 'sort' && (
						<>
							<div className="popover-title">Sort</div>
							{(
								[
									{ id: 'manual', label: 'Original order' },
									{ id: 'name', label: 'Name · A → Z' },
									{ id: 'cost-high', label: 'Estimate · Highest first' },
									{ id: 'cost-low', label: 'Estimate · Lowest first' }
								] as const
							).map((item) => (
								<button
									className="popover-item"
									key={item.id}
									onClick={() => {
										cx.$sort.set(item.id);
										setPopup(null);
									}}
								>
									{item.label}
									{sort === item.id && <Check size={13} />}
								</button>
							))}
						</>
					)}
					{popup.kind === 'tags' && activePart && (
						<TagEditor part={activePart} tags={tags} cx={cx} />
					)}
					{popup.kind === 'links' && activePart && (
						<LinksEditor part={activePart} project={project} cx={cx} />
					)}
					{popup.kind === 'menu' && activePart && (
						<>
							<button
								className="popover-item"
								onClick={() => {
									cx.open(activePart.id, true);
									setPopup(null);
								}}
							>
								<ArrowUpRight size={14} />
								Open as page
							</button>
							<button
								className="popover-item"
								onClick={() => {
									setPurchase(activePart.id);
									setPopup(null);
								}}
							>
								Record purchase
							</button>
							<button
								className="popover-item"
								onClick={() => {
									cx.setBuildState(activePart, 'archived');
									setPopup(null);
								}}
							>
								<Archive size={14} />
								Archive
							</button>
						</>
					)}
				</Popover>
			)}
			{purchasedPart && (
				<PurchaseDialog part={purchasedPart} cx={cx} onClose={() => setPurchase(null)} />
			)}
		</div>
	);
});

PartsView.displayName = 'PartsView';
interface TPartTableRowProps {
	row: TPartRow;
	project: TProject;
	cx: PartsCx;
	selected: boolean;
	estimate: number | null;
	sourceCount: number;
	onShow(kind: TPopup['kind'], anchor: HTMLElement, partId?: string): void;
	onPurchase(id: string): void;
}
const PartTableRow: React.FC<TPartTableRowProps> = React.memo(
	({ row, project, cx, selected, estimate, sourceCount, onShow, onPurchase }) => {
		const nameRef = React.useRef<HTMLInputElement>(null);
		React.useLayoutEffect(() => {
			if (nameRef.current && document.activeElement !== nameRef.current)
				nameRef.current.value = row.part.name;
		}, [row.part.name]);
		return (
			<tr className={selected ? 'selected' : ''}>
				<td className="name-cell">
					<PartArtwork part={row.part} project={project} />
					<input
						ref={nameRef}
						className="cell-input part-title-input"
						title={row.part.name}
						aria-label={`Name for ${row.part.name}`}
						defaultValue={row.part.name}
						onBlur={(event) => {
							const name = event.currentTarget.value.trim();
							if (name && name !== row.part.name) cx.update(row.part, { name });
							if (!name) event.currentTarget.value = row.part.name;
						}}
						onKeyDown={(event) => {
							if (event.key === 'Enter') {
								event.preventDefault();
								event.stopPropagation();
								event.currentTarget.blur();
								if (event.metaKey || event.ctrlKey) cx.open(row.part.id);
							}
							if (event.key === 'Escape') {
								event.preventDefault();
								event.stopPropagation();
								event.currentTarget.value = row.part.name;
								event.currentTarget.blur();
							}
						}}
					/>
					<button
						className="open-part-button"
						onClick={() => cx.open(row.part.id)}
						title="Open part"
					>
						<PanelRight size={12} />
						<span>Open</span>
					</button>
				</td>
				<td>
					<select
						className={`cell-build-select ${row.part.buildState}`}
						aria-label={`Build status for ${row.part.name}`}
						value={row.part.buildState}
						onChange={(event) =>
							cx.setBuildState(row.part, event.target.value as TPart['buildState'])
						}
					>
						<option value="in-build">In build</option>
						<option value="wishlist">Wishlist</option>
						<option value="archived">Archived</option>
					</select>
				</td>
				<td>
					<button
						className="cell-tags"
						aria-label={`Tags for ${row.part.name}`}
						onClick={(event) => onShow('tags', event.currentTarget, row.part.id)}
					>
						{row.part.tags.slice(0, 2).map((value) => (
							<span key={value} className="tag">
								{value}
							</span>
						))}
						{row.part.tags.length > 2 && <small>+{row.part.tags.length - 2}</small>}
						{!row.part.tags.length && <span className="empty-cell">Empty</span>}
					</button>
				</td>
				<td className="numeric">
					{row.part.unit === 'each' ? (
						<InlineNumber
							label={`Quantity for ${row.part.name}`}
							value={row.part.quantity}
							onCommit={(quantity) => cx.update(row.part, { quantity: quantity ?? 0 })}
						/>
					) : (
						<button
							className="quantity-cell"
							onClick={() => cx.open(row.part.id)}
							title="Open material requirements"
						>
							<RequirementQuantity
								value={row.requiredQuantity}
								unit={row.part.unit}
								unknownCount={row.unknownRequirementCount}
							/>
						</button>
					)}
				</td>
				<td className="numeric">
					<button
						className="quantity-cell"
						title="Record a purchase"
						onClick={() => onPurchase(row.part.id)}
					>
						{row.boughtQuantity ? (
							quantity(row.boughtQuantity, row.part.unit)
						) : (
							<span className="empty-cell">—</span>
						)}
					</button>
				</td>
				<td className="numeric price-cell">
					<span className="currency-symbol">€</span>
					<InlineNumber
						label={`Unit price for ${row.part.name}`}
						value={row.part.estimatedUnitPrice}
						nullable
						onCommit={(estimatedUnitPrice) => cx.update(row.part, { estimatedUnitPrice })}
					/>
					{row.part.unit === 'm' && <small>/m</small>}
				</td>
				<td
					className="numeric estimate-cell"
					title={
						row.unknownCost || !row.requiredQuantityComplete
							? 'Known estimate only; some prices or lengths are missing'
							: undefined
					}
				>
					{estimate == null ? (
						<span className="empty-cell">—</span>
					) : (
						<>
							{(!row.requiredQuantityComplete || row.unknownCost) && (
								<span className="incomplete-prefix">≥ </span>
							)}
							{money(estimate)}
						</>
					)}
				</td>
				<td>
					<button
						className="cell-link"
						onClick={(event) => onShow('links', event.currentTarget, row.part.id)}
					>
						{sourceCount > 0 ? (
							<>
								<Link2 size={13} />
								{sourceCount}
							</>
						) : (
							<span className="empty-cell">Add link</span>
						)}
					</button>
				</td>
				<td>
					<IconButton
						label={`Actions for ${row.part.name}`}
						onClick={(event) => onShow('menu', event.currentTarget, row.part.id)}
					>
						<MoreHorizontal size={15} />
					</IconButton>
				</td>
			</tr>
		);
	}
);
PartTableRow.displayName = 'PartTableRow';
function matchesView(row: TPartRow, filter: string): boolean {
	return filter === 'to-buy'
		? row.part.buildState === 'in-build' &&
				(row.remainingToBuy > 0 || !row.requiredQuantityComplete)
		: filter === 'all'
			? row.part.buildState !== 'archived'
			: row.part.buildState === filter;
}
const InlineNumber: React.FC<{
	label: string;
	value: number | null;
	nullable?: boolean;
	onCommit(value: number | null): void;
}> = ({ label, value, nullable, onCommit }) => {
	const ref = React.useRef<HTMLInputElement>(null);
	React.useLayoutEffect(() => {
		if (ref.current && document.activeElement !== ref.current)
			ref.current.value = value == null ? '' : String(value);
	}, [value]);
	return (
		<input
			ref={ref}
			className="cell-input number-cell-input"
			aria-label={label}
			type="number"
			min="0"
			step="any"
			placeholder="—"
			defaultValue={value ?? ''}
			onBlur={(event) => {
				const raw = event.currentTarget.value.trim();
				const next = raw === '' ? (nullable ? null : 0) : Number(raw);
				if (next != null && (!Number.isFinite(next) || next < 0)) {
					event.currentTarget.value = value == null ? '' : String(value);
					return;
				}
				if (next !== value) onCommit(next);
			}}
			onKeyDown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					event.stopPropagation();
					event.currentTarget.blur();
				}
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					event.currentTarget.value = value == null ? '' : String(value);
					event.currentTarget.blur();
				}
			}}
		/>
	);
};

const TagEditor: React.FC<{ part: TPart; tags: string[]; cx: PartsCx }> = ({ part, tags, cx }) => {
	const [name, setName] = React.useState('');
	return (
		<>
			<div className="popover-title">Tags</div>
			{tags.map((tag) => (
				<button
					className="popover-item"
					key={tag}
					onClick={() =>
						cx.update(part, {
							tags: part.tags.includes(tag)
								? part.tags.filter((value) => value !== tag)
								: [...part.tags, tag]
						})
					}
				>
					<span className="tag">{tag}</span>
					{part.tags.includes(tag) && <Check size={13} />}
				</button>
			))}
			<form
				className="popover-new"
				onSubmit={(event) => {
					event.preventDefault();
					if (name.trim()) cx.update(part, { tags: [...new Set([...part.tags, name.trim()])] });
					setName('');
				}}
			>
				<input
					aria-label="New tag"
					placeholder="Create a tag"
					value={name}
					onChange={(event) => setName(event.target.value)}
				/>
				<IconButton label="Add tag" type="submit">
					<Plus size={14} />
				</IconButton>
			</form>
		</>
	);
};
const LinksEditor: React.FC<{ part: TPart; project: TProject; cx: PartsCx }> = ({
	part,
	project,
	cx
}) => {
	const [url, setUrl] = React.useState('');
	return (
		<>
			<div className="popover-title">Links</div>
			{project.sources
				.filter((source) => source.partId === part.id)
				.map((source) => (
					<button
						className="popover-item source-item"
						key={source.id}
						onClick={() => void openLink(source.url)}
					>
						<Link2 size={13} />
						<span>
							{source.title}
							<small>{new URL(source.url).hostname}</small>
						</span>
						<ArrowUpRight size={12} />
					</button>
				))}
			<form
				className="popover-new"
				onSubmit={(event) => {
					event.preventDefault();
					cx.addSource(part.id, url);
					setUrl('');
				}}
			>
				<input
					type="url"
					required
					aria-label="Add product link"
					placeholder="Paste a link"
					value={url}
					onChange={(event) => setUrl(event.target.value)}
				/>
				<IconButton label="Add link" type="submit">
					<Plus size={14} />
				</IconButton>
			</form>
		</>
	);
};
export function buildStateLabel(part: TPart): string {
	return part.buildState === 'in-build'
		? 'In build'
		: part.buildState === 'wishlist'
			? 'Wishlist'
			: 'Archived';
}
