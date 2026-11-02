import {
	ArrowDown,
	ArrowUp,
	Box,
	Cable,
	ChevronRight,
	CircleHelp,
	Columns2,
	ExternalLink,
	FileText,
	Image,
	Link2,
	Maximize2,
	MoreHorizontal,
	Plus,
	Ruler,
	Search,
	ShoppingBag,
	Tag,
	Unlink,
	X,
	Zap
} from 'lucide-react';
import React from 'react';
import { IconButton, Modal, NumberField, RequirementQuantity } from '../../components/ui';
import { openLink } from '../../environment/open-link';
import { money, quantity } from '../../lib/format';
import { getLibraryItem } from '../library/data';
import { PricingSection } from '../pricing';
import {
	getCapability,
	getFindings,
	getLibraryOverrides,
	getParts,
	type TCapabilities,
	type TPart,
	type TProject
} from '../project/model';
import { ReviewNotes } from '../review/ReviewNotes';
import { AlternativesSection } from './components/AlternativesSection';
import {
	AppearanceSection,
	CableSection,
	DimensionsSection,
	PropertiesSection
} from './components/CapabilitySections';
import { ElectricalSection } from './components/ElectricalSection';
import { NotesEditor } from './components/NotesEditor';
import { PartArtwork } from './components/PartArtwork';
import { PurchaseDialog } from './components/PurchaseDialog';
import { StockSection } from './components/StockSection';
import type { PartsCx } from './PartsCx';
import './part-page.css';

const BLOCKS = [
	{ key: 'dimensions', label: 'Dimensions', icon: Ruler },
	{ key: 'appearance', label: 'Artwork', icon: Image },
	{ key: 'electrical', label: 'Electrical terminals', icon: Zap },
	{ key: 'cable', label: 'Cable specification', icon: Cable },
	{ key: 'sources', label: 'Links', icon: Link2 },
	{ key: 'pricing', label: 'Prices', icon: ShoppingBag },
	{ key: 'purchasing', label: 'Purchases & stock', icon: ShoppingBag },
	{ key: 'alternatives', label: 'Alternatives', icon: Columns2 }
];
export const PartPage: React.FC<{
	part: TPart;
	project: TProject;
	cx: PartsCx;
	full?: boolean;
	onEnhance(): void;
}> = ({ part, project, cx, full, onEnhance }) => {
	const [purchase, setPurchase] = React.useState(false);
	const [comparing, setComparing] = React.useState(false);
	const [addMenu, setAddMenu] = React.useState(false);
	const [pageMenu, setPageMenu] = React.useState(false);
	const [openBlocks, setOpenBlocks] = React.useState<Set<string>>(() => new Set());
	const scrollRef = React.useRef<HTMLDivElement>(null);
	React.useLayoutEffect(() => {
		scrollRef.current?.scrollTo({ top: 0 });
	}, [part.id, full]);
	const titleRef = React.useRef<HTMLTextAreaElement>(null);
	React.useLayoutEffect(() => resizeTitle(titleRef.current), [part.name]);
	const sectionElementsRef = React.useRef(new Map<string, HTMLElement>());
	const pendingSectionRef = React.useRef<string | null>(null);
	React.useLayoutEffect(() => {
		const key = pendingSectionRef.current;
		if (!key) return;
		const element = sectionElementsRef.current.get(key);
		if (!element) return;
		pendingSectionRef.current = null;
		element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		element
			.querySelector<HTMLElement>(
				'.field input,.field select,.electrical-section > .button,.artwork-editor .button,input,button'
			)
			?.focus({ preventScroll: true });
	}, [part.sections, part.capabilities, openBlocks]);
	const rows = React.useMemo(() => getParts(project), [project]);
	const projectFindings = React.useMemo(() => getFindings(project), [project]);
	const row = rows.find((entry) => entry.part.id === part.id);
	if (!row) return null;
	const sectionKeys = part.sections;
	const sources = project.sources.filter((source) => source.partId === part.id);
	const library = part.libraryLink ? getLibraryItem(part.libraryLink.itemId) : null;
	const overrides = getLibraryOverrides(part);
	const alternatives = project.alternatives.filter(
		(entry) => entry.aPartId === part.id || entry.bPartId === part.id
	);
	const findings = projectFindings.filter(
		(finding) => finding.targetType === 'part' && finding.targetId === part.id
	);
	const dimensions = getCapability(part, 'dimensions');
	const cable = getCapability(part, 'cable');
	const electrical = getCapability(part, 'electrical');
	const purchases = project.purchases.filter((entry) => entry.partId === part.id);
	const canChooseMaterial =
		part.unit === 'm' ||
		(!electrical?.ports.length &&
			!purchases.length &&
			!project.instances.some((instance) => instance.partId === part.id));
	const blocks = sectionKeys.filter((key) => BLOCKS.some((block) => block.key === key));
	function reveal(key: string): void {
		pendingSectionRef.current = key;
		setOpenBlocks((current) => new Set([...current, key]));
		if (!part.sections.includes(key)) cx.update(part, { sections: [...part.sections, key] });
		setAddMenu(false);
	}
	function summary(key: string): string {
		if (key === 'dimensions')
			return dimensions?.widthMm && dimensions.heightMm
				? `${dimensions.widthMm} × ${dimensions.heightMm}${dimensions.depthMm ? ` × ${dimensions.depthMm}` : ''} mm`
				: 'Size not set';
		if (key === 'appearance')
			return getCapability(part, 'appearance')?.assetId ? 'Image attached' : 'No image';
		if (key === 'electrical') return `${electrical?.ports.length ?? 0} terminals`;
		if (key === 'cable')
			return `${cable?.crossSectionMm2 == null ? 'Area not set' : `${cable.crossSectionMm2} mm²`} · ${cable?.coreCount ?? 1} core${cable?.coreCount === 1 ? '' : 's'}`;
		if (key === 'sources') return `${sources.length} link${sources.length === 1 ? '' : 's'}`;
		if (key === 'purchasing')
			return purchases.length
				? `${quantity(row?.boughtQuantity ?? 0, part.unit)} bought · ${money(row?.purchaseCost)}`
				: 'No purchases';
		if (key === 'pricing')
			return part.estimatedUnitPrice == null
				? 'No estimate'
				: `${money(part.estimatedUnitPrice)} / ${part.unit === 'm' ? 'm' : 'unit'}`;
		if (key === 'alternatives') return `${alternatives.length} linked`;
		return '';
	}
	function addCapability(kind: string): void {
		const capabilities: TCapabilities = { ...part.capabilities };
		if (kind === 'electrical')
			capabilities['electrical'] = { $schema: 'yadori/electrical-device@1', ports: [] };
		if (kind === 'dimensions')
			capabilities['dimensions'] = {
				$schema: 'yadori/dimensions@1',
				widthMm: null,
				heightMm: null,
				depthMm: null,
				verified: false
			};
		if (kind === 'appearance') {
			capabilities['appearance'] = {
				$schema: 'yadori/appearance@1',
				assetId: null,
				projection: 'front',
				anchors: {}
			};
			if (!capabilities['dimensions'])
				capabilities['dimensions'] = {
					$schema: 'yadori/dimensions@1',
					widthMm: null,
					heightMm: null,
					depthMm: null,
					verified: false
				};
		}
		if (kind === 'cable') {
			capabilities['cable'] = {
				$schema: 'yadori/electrical-cable@1',
				crossSectionMm2: null,
				coreCount: 1,
				conductor: 'copper',
				color: '#c14b42',
				outerDiameterMm: null,
				ratedCurrentA: null,
				voltageRatingV: null,
				verified: false
			};
			capabilities['linearMaterial'] = {
				$schema: 'yadori/linear-material@1',
				unit: 'm',
				continuous: true,
				cutLossMm: 0
			};
		}
		if (kind === 'linearMaterial')
			capabilities['linearMaterial'] = {
				$schema: 'yadori/linear-material@1',
				unit: 'm',
				continuous: true,
				cutLossMm: 0
			};
		const section = kind === 'linearMaterial' ? 'purchasing' : kind;
		pendingSectionRef.current = section;
		setOpenBlocks((current) => new Set([...current, section]));
		cx.update(part, {
			capabilities,
			...(kind === 'cable' || kind === 'linearMaterial' ? { unit: 'm', quantity: 0 } : {}),
			sections: [
				...new Set([
					...sectionKeys,
					...(kind === 'appearance' ? ['dimensions'] : []),
					kind === 'linearMaterial' ? 'purchasing' : kind
				])
			]
		});
		setAddMenu(false);
	}
	function moveSection(key: string, direction: number): void {
		const next = [...sectionKeys];
		const index = next.indexOf(key);
		const target = index + direction;
		if (target < 0 || target >= next.length) return;
		const a = next[index];
		const b = next[target];
		if (!a || !b) return;
		[next[index], next[target]] = [b, a];
		cx.update(part, { sections: next });
	}

	return (
		<aside
			className={`part-page document-page ${full ? 'full-page' : 'peek'}`}
			aria-label={part.name}
		>
			<header className="part-page-toolbar">
				<span className="part-breadcrumb">
					<FileText size={13} />
					Parts<span>/</span>
					{part.name}
				</span>
				<span className="view-toolbar-spacer" />
				<IconButton label="Research part" onClick={onEnhance}>
					<Search size={14} />
				</IconButton>
				<div className="page-menu-anchor">
					<IconButton label="Page options" onClick={() => setPageMenu(!pageMenu)}>
						<MoreHorizontal size={16} />
					</IconButton>
					{pageMenu && (
						<>
							<button
								className="menu-scrim"
								aria-label="Close page options"
								onClick={() => setPageMenu(false)}
							/>
							<div className="dropdown-menu page-options-menu">
								{part.libraryLink && (
									<>
										<div className="page-menu-label">
											Library · v{part.libraryLink.appliedRevision}
										</div>
										{library && library.revision > part.libraryLink.appliedRevision && (
											<button
												onClick={() => {
													cx.session.execute(
														[{ type: 'part.apply-library', id: part.id, item: library }],
														'Update library definition'
													);
													setPageMenu(false);
												}}
											>
												Update library definition
											</button>
										)}
										{overrides.length > 0 && (
											<button
												onClick={() => {
													cx.session.execute(
														[
															{
																type: 'part.reset-library-field',
																id: part.id,
																field: 'capabilities'
															},
															{ type: 'part.reset-library-field', id: part.id, field: 'properties' }
														],
														'Reset library specifications'
													);
													setPageMenu(false);
												}}
											>
												Reset library specifications
											</button>
										)}
										<button
											onClick={() => {
												cx.session.execute(
													[{ type: 'part.detach', id: part.id }],
													'Detach library item'
												);
												setPageMenu(false);
											}}
										>
											<Unlink size={13} />
											Detach from library
										</button>
									</>
								)}
								<div className="page-menu-label">Visible blocks</div>
								{BLOCKS.filter(
									(block) =>
										!['dimensions', 'appearance', 'electrical', 'cable'].includes(block.key) ||
										part.capabilities[block.key]
								).map((block) => (
									<label key={block.key}>
										<input
											type="checkbox"
											checked={sectionKeys.includes(block.key)}
											onChange={(event) =>
												cx.update(part, {
													sections: event.target.checked
														? [...sectionKeys, block.key]
														: sectionKeys.filter((key) => key !== block.key)
												})
											}
										/>
										{block.label}
									</label>
								))}
							</div>
						</>
					)}
				</div>
				{!full && (
					<IconButton label="Open as page" onClick={() => cx.$fullPage.set(true)}>
						<Maximize2 size={14} />
					</IconButton>
				)}
				<IconButton label="Close part" onClick={() => cx.close()}>
					<X size={16} />
				</IconButton>
			</header>
			<div className="part-page-scroll" ref={scrollRef}>
				<div className="part-document">
					<div className="document-title-row">
						<PartArtwork part={part} project={project} />
						<div>
							<textarea
								ref={titleRef}
								rows={1}
								onInput={(event) => resizeTitle(event.currentTarget)}
								className="part-title"
								key={part.id + part.name}
								aria-label="Part name"
								defaultValue={part.name}
								onBlur={(event) => {
									const name = event.currentTarget.value.trim();
									if (name) cx.update(part, { name });
									else event.currentTarget.value = part.name;
								}}
								onKeyDown={(event) => {
									if (event.key === 'Enter') {
										event.preventDefault();
										event.currentTarget.blur();
									}
								}}
							/>
							<input
								className="part-brand"
								key={part.id + part.brand}
								aria-label="Brand"
								defaultValue={part.brand}
								placeholder="Add brand"
								onBlur={(event) => cx.update(part, { brand: event.currentTarget.value.trim() })}
							/>
						</div>
					</div>
					<div className="document-properties">
						<div className="document-property">
							<label htmlFor={`scope-${part.id}`}>
								<Box size={13} />
								Build
							</label>
							<select
								id={`scope-${part.id}`}
								value={part.buildState}
								onChange={(event) =>
									cx.setBuildState(part, event.target.value as TPart['buildState'])
								}
							>
								<option value="wishlist">Wishlist</option>
								<option value="in-build">In build</option>
								<option value="archived">Archived</option>
							</select>
						</div>
						<div className="document-property">
							<label htmlFor={`tags-${part.id}`}>
								<Tag size={13} />
								Tags
							</label>
							<input
								id={`tags-${part.id}`}
								key={part.id + part.tags.join(',')}
								defaultValue={part.tags.join(', ')}
								placeholder="Empty"
								onBlur={(event) =>
									cx.update(part, {
										tags: [
											...new Set(
												event.currentTarget.value
													.split(',')
													.map((tag) => tag.trim())
													.filter(Boolean)
											)
										]
									})
								}
							/>
						</div>
						<div className="document-property">
							<span>
								<Box size={13} />
								{part.unit === 'm' ? 'Extra material' : 'Quantity'}
							</span>
							<div className="property-inline-number">
								<NumberField
									label={part.unit === 'm' ? 'Extra material' : 'Build quantity'}
									value={part.quantity}
									required
									unit={part.unit === 'm' ? 'm' : undefined}
									onChange={(value) => cx.update(part, { quantity: value ?? 0 })}
								/>
								{(part.unit === 'm' || row.placedCount > 0) && (
									<small>
										<RequirementQuantity
											value={row.requiredQuantity}
											unit={part.unit}
											unknownCount={row.unknownRequirementCount}
										/>
										{row.placedCount > 0 ? ` · ${row.placedCount} placed` : ' needed'}
									</small>
								)}
							</div>
						</div>
						<div className="document-property">
							<span>
								<ShoppingBag size={13} />
								Price
							</span>
							<div className="property-inline-number">
								<NumberField
									label={`Estimate per ${part.unit === 'm' ? 'metre' : 'unit'}`}
									value={part.estimatedUnitPrice}
									unit="€"
									onChange={(estimatedUnitPrice) => cx.update(part, { estimatedUnitPrice })}
								/>
								<button className="property-link" onClick={() => reveal('pricing')}>
									Check prices
								</button>
							</div>
						</div>
						{(part.libraryLink || part.libraryOrigin) && (
							<div className="document-property">
								<span>
									<Link2 size={13} />
									Library
								</span>
								<span
									className="property-library"
									title={library?.name ?? part.libraryOrigin?.itemId}
								>
									{library?.name ??
										getLibraryItem(part.libraryOrigin?.itemId ?? '')?.name ??
										part.libraryOrigin?.itemId}
									<small>{part.libraryLink ? 'Linked' : 'Detached'}</small>
								</span>
							</div>
						)}
						{sources.length > 0 && (
							<div className="document-property">
								<span>
									<ExternalLink size={13} />
									Source
								</span>
								<button
									className="property-source"
									title={sources[0]?.url}
									onClick={() => void openLink(sources[0]?.url ?? '')}
								>
									<span>{sources[0]?.title}</span>
									<ExternalLink size={11} />
								</button>
							</div>
						)}
						<div className="document-custom-properties">
							<PropertiesSection part={part} cx={cx} />
						</div>
					</div>
					<div className="document-relations">
						<button onClick={() => setComparing(true)}>
							<Columns2 size={13} />
							Compare{alternatives.length ? ` · ${alternatives.length}` : ''}
						</button>
						<button onClick={() => setPurchase(true)}>
							<ShoppingBag size={13} />
							Record purchase
						</button>
					</div>
					<div className="document-notes">
						<NotesEditor
							key={`${project.id}:${part.id}`}
							value={part.notes}
							session={cx.session}
							projectId={project.id}
							partId={part.id}
						/>
					</div>
					<div className="document-blocks">
						{blocks.map((key, index) => {
							const block = BLOCKS.find((entry) => entry.key === key);
							if (!block) return null;
							return (
								<details
									className="document-toggle"
									key={key}
									ref={(element) => {
										if (element) sectionElementsRef.current.set(key, element);
										else sectionElementsRef.current.delete(key);
									}}
									open={openBlocks.has(key)}
									onToggle={(event) => {
										const open = event.currentTarget.open;
										setOpenBlocks((current) => {
											if (current.has(key) === open) return current;
											const next = new Set(current);
											if (open) next.add(key);
											else next.delete(key);
											return next;
										});
									}}
								>
									<summary>
										<ChevronRight size={13} className="toggle-chevron" />
										<block.icon size={14} />
										<strong>{block.label}</strong>
										<span>{summary(key)}</span>
									</summary>
									<div className="document-toggle-content">
										{key === 'dimensions' && <DimensionsSection part={part} cx={cx} />}
										{key === 'appearance' && (
											<AppearanceSection part={part} project={project} cx={cx} />
										)}
										{key === 'electrical' && <ElectricalSection part={part} cx={cx} />}
										{key === 'cable' && <CableSection part={part} cx={cx} />}
										{key === 'sources' && (
											<>
												<div className="source-list">
													{sources.map((source) => (
														<div className="source-row" key={source.id}>
															<ExternalLink size={13} />
															<button title={source.url} onClick={() => void openLink(source.url)}>
																{source.title}
																<small>{new URL(source.url).hostname}</small>
															</button>
															<IconButton
																label={`Remove ${source.title}`}
																onClick={() =>
																	cx.session.execute(
																		[{ type: 'source.remove', id: source.id }],
																		'Remove link'
																	)
																}
															>
																<X size={12} />
															</IconButton>
														</div>
													))}
												</div>
												<form
													className="inline-form"
													onSubmit={(event) => {
														event.preventDefault();
														const input = event.currentTarget.elements.namedItem(
															'url'
														) as HTMLInputElement;
														cx.addSource(part.id, input.value);
														input.value = '';
													}}
												>
													<input
														name="url"
														type="url"
														required
														aria-label="Add a link"
														placeholder="Paste a product, video or datasheet link…"
													/>
													<IconButton label="Add link" type="submit">
														<Plus size={14} />
													</IconButton>
												</form>
											</>
										)}
										{key === 'purchasing' && (
											<>
												<div className="procurement-properties">
													<NumberField
														label="Planned purchase"
														value={part.plannedQuantity}
														unit={part.unit === 'm' ? 'm' : undefined}
														help="Optional buying allowance; build demand stays separate."
														onChange={(plannedQuantity) => cx.update(part, { plannedQuantity })}
													/>
													<NumberField
														label={part.unit === 'm' ? 'Roll / pack length' : 'Units per pack'}
														value={part.purchasePackQuantity}
														min={0.001}
														unit={part.unit === 'm' ? 'm' : undefined}
														onChange={(purchasePackQuantity) =>
															cx.update(part, { purchasePackQuantity })
														}
													/>
												</div>
												<StockSection part={part} project={project} cx={cx} />
											</>
										)}
										{key === 'alternatives' && (
											<AlternativesSection part={part} project={project} cx={cx} />
										)}
										{key === 'pricing' && (
											<PricingSection
												part={part}
												project={project}
												onCommands={(commands) => cx.session.execute(commands, 'Update prices')}
											/>
										)}
										<div className="document-block-tools">
											<IconButton
												label={`Move ${block.label} up`}
												disabled={index === 0}
												onClick={() => moveSection(key, -1)}
											>
												<ArrowUp size={11} />
											</IconButton>
											<IconButton
												label={`Move ${block.label} down`}
												disabled={index === blocks.length - 1}
												onClick={() => moveSection(key, 1)}
											>
												<ArrowDown size={11} />
											</IconButton>
										</div>
									</div>
								</details>
							);
						})}
					</div>
					<div className="document-add-block">
						<button onClick={() => setAddMenu(!addMenu)}>
							<Plus size={14} />
							Add a block
						</button>
						{addMenu && (
							<>
								<button
									className="menu-scrim"
									aria-label="Close block menu"
									onClick={() => setAddMenu(false)}
								/>
								<div className="dropdown-menu document-block-menu">
									{BLOCKS.filter(
										(block) =>
											!blocks.includes(block.key) &&
											(block.key !== 'cable' || part.capabilities['cable'] || canChooseMaterial)
									).map((block) => (
										<button
											key={block.key}
											onClick={() =>
												['dimensions', 'appearance', 'electrical', 'cable'].includes(block.key) &&
												!part.capabilities[block.key]
													? addCapability(block.key)
													: reveal(block.key)
											}
										>
											<block.icon size={14} />
											{block.label}
										</button>
									))}
									{canChooseMaterial &&
										!part.capabilities['linearMaterial'] &&
										!part.capabilities['cable'] && (
											<button onClick={() => addCapability('linearMaterial')}>
												<Ruler size={14} />
												Linear material
											</button>
										)}
								</div>
							</>
						)}
					</div>
					{findings.length > 0 && (
						<details className="document-checks">
							<summary>
								<CircleHelp size={13} />
								{findings.length} things to check
							</summary>
							{findings.map((finding) => (
								<p key={finding.id}>
									<strong>{finding.title}</strong>
									<br />
									{finding.detail}
								</p>
							))}
						</details>
					)}
					<details className="document-questions">
						<summary>
							<CircleHelp size={13} />
							Questions
							{project.reviews.filter(
								(review) =>
									review.targetType === 'part' &&
									review.targetId === part.id &&
									review.status === 'open'
							).length
								? ` · ${project.reviews.filter((review) => review.targetType === 'part' && review.targetId === part.id && review.status === 'open').length}`
								: ''}
						</summary>
						<ReviewNotes
							project={project}
							target={{ type: 'part', id: part.id }}
							onCommands={(commands) => cx.session.execute(commands, 'Review question')}
						/>
					</details>
				</div>
			</div>
			{comparing && (
				<Modal title="Compare alternatives" onClose={() => setComparing(false)}>
					<div className="compare-current">
						<PartArtwork part={part} project={project} />
						<span>
							<strong>{part.name}</strong>
							<small>
								{part.buildState === 'in-build' ? 'In build' : 'Wishlist'} · {money(row.estimate)}
							</small>
						</span>
					</div>
					<AlternativesSection part={part} project={project} cx={cx} />
				</Modal>
			)}
			{purchase && (
				<PurchaseDialog
					part={part}
					cx={cx}
					onRecorded={() => reveal('purchasing')}
					onClose={() => setPurchase(false)}
				/>
			)}
		</aside>
	);
};

function resizeTitle(element: HTMLTextAreaElement | null): void {
	if (!element) return;
	element.style.height = 'auto';
	element.style.height = `${element.scrollHeight}px`;
}
