export type TBuildState = 'wishlist' | 'in-build' | 'archived';
export type TUnit = 'each' | 'm';
export type TJsonValue =
	string | number | boolean | null | TJsonValue[] | { [key: string]: TJsonValue };
export interface TProperty {
	id: string;
	name: string;
	value: TJsonValue;
	unit: string | null;
	sourceId: string | null;
}
export interface TPoint {
	x: number;
	y: number;
}
export interface TDimensionsCapability {
	$schema: 'yadori/dimensions@1';
	widthMm: number | null;
	heightMm: number | null;
	depthMm: number | null;
	verified: boolean;
}
export interface TArtworkCalibrationCapability {
	$schema: 'yadori/artwork-calibration@1';
	sourceKind: 'third-party-illustration' | 'manufacturer-dimension-drawing' | 'user-calibrated';
	sourceUrl: string;
	catalogSourceUrl?: string;
	sourceVariant: string;
	projection: 'front' | 'top' | 'side';
	physicalWidthMm: number;
	physicalHeightMm: number;
	dimensionSourceUrl: string;
	sourceBodyBounds: { x: number; y: number; width: number; height: number };
	sourceOuterViewBox?: [number, number, number, number];
	sourceBodyViewBox?: [number, number, number, number];
	anchorsBasis:
		| 'source-illustration-landmarks'
		| 'manufacturer-drawing-projective-landmarks'
		| 'unlocated-rear-connector'
		| 'user-calibrated';
	notes: string;
}
export interface TAppearanceCapability {
	$schema: 'yadori/appearance@1';
	assetId: string | null;
	projection: 'front' | 'top' | 'side';
	anchors: Record<string, TPoint>;
}
export type TPortKind =
	'positive' | 'negative' | 'live' | 'neutral' | 'earth' | 'signal' | 'generic';
export interface TPort {
	id: string;
	name: string;
	kind: TPortKind;
	direction: 'input' | 'output' | 'bidirectional';
	voltageV: number | null;
	connector: string | null;
	minCrossSectionMm2: number | null;
	maxCrossSectionMm2: number | null;
	maxCurrentA: number | null;
	multiple: boolean;
	verified: boolean;
}
export interface TElectricalCapability {
	$schema: 'yadori/electrical-device@1';
	ports: TPort[];
}
export interface TCableCapability {
	$schema: 'yadori/electrical-cable@1';
	crossSectionMm2: number | null;
	coreCount: number;
	conductor: 'copper' | 'aluminium' | 'unknown';
	color: string | null;
	outerDiameterMm: number | null;
	ratedCurrentA: number | null;
	voltageRatingV: number | null;
	verified: boolean;
}
export interface TLinearMaterialCapability {
	$schema: 'yadori/linear-material@1';
	unit: 'm';
	continuous: boolean;
	cutLossMm: number;
}
export interface TUnknownCapability {
	$schema: string;
	[key: string]: TJsonValue;
}
export type TCapability =
	| TDimensionsCapability
	| TAppearanceCapability
	| TArtworkCalibrationCapability
	| TElectricalCapability
	| TCableCapability
	| TLinearMaterialCapability
	| TUnknownCapability;
export interface TCapabilities {
	[key: string]: TCapability;
}
export interface TPartDefinition {
	name: string;
	brand: string;
	description: string;
	capabilities: TCapabilities;
	properties: TProperty[];
}
export interface TLibraryItem extends TPartDefinition {
	$schema: 'yadori/library-item@1';
	id: string;
	revision: number;
	tags: string[];
	sourceUrl: string | null;
}
export interface TLibraryLink {
	itemId: string;
	appliedRevision: number;
	base: TPartDefinition;
}
export interface TPart extends TPartDefinition {
	id: string;
	buildState: TBuildState;
	unit: TUnit;
	/** Discrete planned units; for linear material this is explicit demand in addition to runs. */
	quantity: number;
	/** Optional purchasing allowance/target, independent of current requirements. */
	plannedQuantity: number | null;
	purchasePackQuantity: number | null;
	estimatedUnitPrice: number | null;
	notes: string;
	tags: string[];
	sourceIds: string[];
	/** Ordered section keys such as notes, properties, sources, electrical, dimensions. */
	sections: string[];
	libraryLink: TLibraryLink | null;
	/** Provenance survives detach and is never replaced by project notes or purchases. */
	libraryOrigin: { itemId: string; revision: number } | null;
}
export interface TInstance {
	id: string;
	partId: string;
	label: string;
	installed: boolean;
}
export interface TLayout {
	id: string;
	name: string;
	widthMm: number;
	heightMm: number;
	kind: 'board' | 'wall' | 'floor';
	notes: string;
}
export interface TPlacement {
	id: string;
	instanceId: string;
	layoutId: string;
	xMm: number;
	yMm: number;
	rotation: 0 | 90 | 180 | 270;
}
export interface TEndpoint {
	instanceId: string;
	portId: string;
}
export interface TConductor {
	id: string;
	name: string;
	coreIndex: number;
	from: TEndpoint;
	to: TEndpoint;
}
export interface TRunSizingConfig {
	circuit: 'dc' | 'ac' | 'unknown';
	voltageV: number | null;
	maxDropPercent: number;
	roundTripFactor: 1 | 2;
	conductorTemperatureC: number;
}
export interface TCableRun {
	id: string;
	name: string;
	layoutId: string;
	materialPartId: string;
	topology: 'standard' | 'series';
	conductors: TConductor[];
	/** Route points in physical layout millimetres, independent of viewport zoom. */
	route: TPoint[];
	lengthBasis: 'route' | 'manual' | 'measured';
	sizing: TRunSizingConfig | null;
	lengthM: number | null;
	extraLengthM: number;
	currentA: number | null;
	fuseA: number | null;
	notes: string;
}
export interface TAlternative {
	id: string;
	aPartId: string;
	bPartId: string;
}
export interface TSource {
	id: string;
	partId: string;
	kind: 'product' | 'seller' | 'video' | 'datasheet' | 'other';
	title: string;
	url: string;
	provider: 'idealo' | 'agent' | null;
	productId: string | null;
	notes: string;
}
export interface TQuote {
	id: string;
	partId: string;
	sourceId: string;
	observedAt: string;
	currency: 'EUR';
	price: number;
	packQuantity: number;
	unit: TUnit;
	seller: string | null;
	shipping: number | null;
	tax: 'gross' | 'net' | 'unknown';
	condition: 'new' | 'used' | 'unknown';
	notes: string;
}
export interface TPurchase {
	id: string;
	partId: string;
	sourceId: string | null;
	orderedAt: string;
	quantity: number;
	unit: TUnit;
	totalPrice: number | null;
	shipping: number | null;
	status: 'ordered' | 'received' | 'returned';
	receiptAssetId: string | null;
	notes: string;
}
export interface TStockPiece {
	id: string;
	partId: string;
	purchaseId: string | null;
	label: string;
	lengthM: number;
	continuity: 'continuous' | 'unknown';
	notes: string;
}
export interface TStockCut {
	id: string;
	stockPieceId: string;
	runId: string | null;
	lengthM: number;
	wasteM: number;
	recordedAt: string;
	installed: boolean;
	notes: string;
}
export interface TAllocation {
	id: string;
	stockPieceId: string;
	runId: string;
	lengthM: number;
}
export interface TAsset {
	id: string;
	name: string;
	mediaType: string;
	relativePath: string;
	sourceUrl: string | null;
	attribution: string | null;
}
export interface TReviewNote {
	id: string;
	targetType: 'project' | 'part' | 'run';
	targetId: string;
	title: string;
	text: string;
	status: 'open' | 'resolved';
	source: 'user' | 'agent';
	createdAt: string;
}
export interface TProject {
	$schema: 'yadori/project@3';
	id: string;
	revision: number;
	name: string;
	currency: 'EUR';
	budget: number | null;
	createdAt: string;
	updatedAt: string;
	parts: TPart[];
	instances: TInstance[];
	layouts: TLayout[];
	placements: TPlacement[];
	runs: TCableRun[];
	alternatives: TAlternative[];
	sources: TSource[];
	quotes: TQuote[];
	purchases: TPurchase[];
	stockPieces: TStockPiece[];
	cuts: TStockCut[];
	allocations: TAllocation[];
	assets: TAsset[];
	reviews: TReviewNote[];
}
export interface TPartRow {
	part: TPart;
	requiredQuantity: number;
	requiredQuantityComplete: boolean;
	unknownRequirementCount: number;
	knownEstimate: number | null;
	plannedQuantity: number;
	boughtQuantity: number;
	receivedQuantity: number;
	usableStockQuantity: number;
	consumedQuantity: number;
	expectedSpare: number;
	remainingToBuy: number;
	estimatedUnitPrice: number | null;
	estimate: number | null;
	purchaseCost: number;
	placedCount: number;
	unknownCost: boolean;
}
export interface TMaterialRequirement {
	partId: string;
	requiredM: number;
	knownM: number;
	unknownRunIds: string[];
	runIds: string[];
}
export interface TBudget {
	forecast: number;
	forecastComplete: boolean;
	recordedSpending: number;
	committedCost: number;
	remainingPurchases: number;
	wishlist: number;
	plannedAllowance: number;
	unknownPriceCount: number;
	unknownQuantityCount: number;
	overBudget: number | null;
}
export interface TFinding {
	id: string;
	severity: 'error' | 'warning' | 'info';
	code: string;
	targetType: 'project' | 'part' | 'run' | 'placement';
	targetId: string;
	title: string;
	detail: string;
}
export interface TValidation {
	valid: boolean;
	errors: string[];
}
export type TCommand =
	| { type: 'part.add'; part: TPart }
	| { type: 'part.update'; id: string; patch: Partial<Omit<TPart, 'id'>> }
	| { type: 'part.remove'; id: string }
	| { type: 'part.detach'; id: string }
	| { type: 'part.apply-library'; id: string; item: TLibraryItem }
	| { type: 'part.reset-library-field'; id: string; field: keyof TPartDefinition }
	| { type: 'alternative.add'; alternative: TAlternative }
	| { type: 'alternative.remove'; id: string }
	| { type: 'alternative.use'; chosenId: string; replacedId: string }
	| { type: 'instance.add'; instance: TInstance }
	| { type: 'instance.update'; id: string; patch: Partial<Omit<TInstance, 'id'>> }
	| { type: 'instance.remove'; id: string }
	| { type: 'layout.add'; layout: TLayout }
	| { type: 'layout.update'; id: string; patch: Partial<Omit<TLayout, 'id'>> }
	| { type: 'placement.add'; placement: TPlacement }
	| { type: 'placement.update'; id: string; patch: Partial<Omit<TPlacement, 'id'>> }
	| { type: 'placement.remove'; id: string }
	| { type: 'run.add'; run: TCableRun }
	| { type: 'run.update'; id: string; patch: Partial<Omit<TCableRun, 'id'>> }
	| { type: 'run.remove'; id: string }
	| { type: 'source.add'; source: TSource }
	| { type: 'source.update'; id: string; patch: Partial<Omit<TSource, 'id'>> }
	| { type: 'source.remove'; id: string }
	| { type: 'quote.add'; quote: TQuote }
	| { type: 'purchase.add'; purchase: TPurchase }
	| { type: 'purchase.update'; id: string; patch: Partial<Omit<TPurchase, 'id'>> }
	| { type: 'stock.add'; stock: TStockPiece }
	| { type: 'stock.update'; id: string; patch: Partial<Omit<TStockPiece, 'id'>> }
	| { type: 'stock.remove'; id: string }
	| { type: 'cut.add'; cut: TStockCut }
	| { type: 'cut.update'; id: string; patch: Partial<Omit<TStockCut, 'id'>> }
	| { type: 'cut.remove'; id: string }
	| { type: 'allocation.add'; allocation: TAllocation }
	| { type: 'allocation.remove'; id: string }
	| { type: 'asset.add'; asset: TAsset }
	| { type: 'review.add'; review: TReviewNote }
	| { type: 'review.update'; id: string; patch: Partial<Omit<TReviewNote, 'id'>> }
	| { type: 'project.update'; patch: Partial<Pick<TProject, 'name' | 'budget'>> };
export interface TExecuteOptions {
	expectedRevision?: number;
	now?: string;
}
