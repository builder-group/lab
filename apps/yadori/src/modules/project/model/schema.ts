import {
	createSchemaRegistry,
	defineMigration,
	defineSchema,
	prepareSchemaValue,
	prepareSchemaValueFromRegistry,
	readSchemaReference,
	type TJsonObject
} from 'versjon';
import { z } from 'zod';
import type {
	TCapabilities,
	TCapability,
	TCommand,
	TJsonValue,
	TProject,
	TValidation
} from './types';

const SId = z.string().min(1).max(200);
const SText = z.string();
const SNonnegative = z.number().finite().nonnegative();
const SPositive = z.number().finite().positive();
const SNullablePositive = SPositive.nullable();
const SNullableNonnegative = SNonnegative.nullable();
const SDate = z.string().refine((value) => Number.isFinite(Date.parse(value)), 'Invalid date');
const SUrl = z.string().refine((value) => {
	try {
		return ['https:', 'http:'].includes(new URL(value).protocol);
	} catch {
		return false;
	}
}, 'Expected an HTTP or HTTPS URL');
const SUnit = z.enum(['each', 'm']);
const SJsonValue: z.ZodType<TJsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number().finite(),
		z.boolean(),
		z.null(),
		z.array(SJsonValue),
		z.record(z.string(), SJsonValue)
	])
);
const SPoint = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
const SAnchor = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const SProperty = z.strictObject({
	id: SId,
	name: SText,
	value: SJsonValue,
	unit: SText.nullable(),
	sourceId: SId.nullable()
});
const SCapability = z.object({ $schema: z.string().min(1) }).catchall(SJsonValue);
const SCapabilities = z.record(z.string().min(1), SCapability);
export const SDimensionsCapability = z.strictObject({
	$schema: z.literal('yadori/dimensions@1'),
	widthMm: SNullablePositive,
	heightMm: SNullablePositive,
	depthMm: SNullablePositive,
	verified: z.boolean()
});
const SViewBox = z.tuple([z.number().finite(), z.number().finite(), SPositive, SPositive]);
export const SArtworkCalibrationCapability = z.strictObject({
	$schema: z.literal('yadori/artwork-calibration@1'),
	sourceKind: z.enum([
		'third-party-illustration',
		'manufacturer-dimension-drawing',
		'user-calibrated'
	]),
	sourceUrl: SUrl,
	catalogSourceUrl: SUrl.optional(),
	sourceVariant: SText,
	projection: z.enum(['front', 'top', 'side']),
	physicalWidthMm: SPositive,
	physicalHeightMm: SPositive,
	dimensionSourceUrl: SUrl,
	sourceBodyBounds: z.strictObject({
		x: z.number().finite(),
		y: z.number().finite(),
		width: SPositive,
		height: SPositive
	}),
	sourceOuterViewBox: SViewBox.optional(),
	sourceBodyViewBox: SViewBox.optional(),
	anchorsBasis: z.enum([
		'source-illustration-landmarks',
		'manufacturer-drawing-projective-landmarks',
		'unlocated-rear-connector',
		'user-calibrated'
	]),
	notes: SText
});
export const SAppearanceCapability = z.strictObject({
	$schema: z.literal('yadori/appearance@1'),
	assetId: SId.nullable(),
	projection: z.enum(['front', 'top', 'side']),
	anchors: z.record(SId, SAnchor)
});
export const SPort = z.strictObject({
	id: SId,
	name: SText,
	kind: z.enum(['positive', 'negative', 'live', 'neutral', 'earth', 'signal', 'generic']),
	direction: z.enum(['input', 'output', 'bidirectional']),
	voltageV: SNullablePositive,
	connector: SText.nullable(),
	minCrossSectionMm2: SNullablePositive,
	maxCrossSectionMm2: SNullablePositive,
	maxCurrentA: SNullablePositive,
	multiple: z.boolean(),
	verified: z.boolean()
});
export const SElectricalCapability = z.strictObject({
	$schema: z.literal('yadori/electrical-device@1'),
	ports: z.array(SPort)
});
export const SCableCapability = z.strictObject({
	$schema: z.literal('yadori/electrical-cable@1'),
	crossSectionMm2: SNullablePositive,
	coreCount: z.number().int().min(1).max(100),
	conductor: z.enum(['copper', 'aluminium', 'unknown']),
	color: SText.nullable(),
	outerDiameterMm: SNullablePositive,
	ratedCurrentA: SNullablePositive,
	voltageRatingV: SNullablePositive,
	verified: z.boolean()
});
export const SLinearMaterialCapability = z.strictObject({
	$schema: z.literal('yadori/linear-material@1'),
	unit: z.literal('m'),
	continuous: z.boolean(),
	cutLossMm: SNonnegative
});
export const capabilityDefinitions = [
	defineSchema({ family: 'yadori/dimensions', version: 1, schema: SDimensionsCapability }),
	defineSchema({ family: 'yadori/appearance', version: 1, schema: SAppearanceCapability }),
	defineSchema({
		family: 'yadori/artwork-calibration',
		version: 1,
		schema: SArtworkCalibrationCapability
	}),
	defineSchema({ family: 'yadori/electrical-device', version: 1, schema: SElectricalCapability }),
	defineSchema({ family: 'yadori/electrical-cable', version: 1, schema: SCableCapability }),
	defineSchema({ family: 'yadori/linear-material', version: 1, schema: SLinearMaterialCapability })
] as const;
export const capabilityRegistry = createSchemaRegistry(capabilityDefinitions);
const expectedFamilies: Record<string, string> = {
	'dimensions': 'yadori/dimensions',
	'artwork-calibration': 'yadori/artwork-calibration',
	'appearance': 'yadori/appearance',
	'electrical': 'yadori/electrical-device',
	'cable': 'yadori/electrical-cable',
	'linearMaterial': 'yadori/linear-material'
};
export const SPartDefinition = z.strictObject({
	name: z.string().min(1),
	brand: SText,
	description: SText,
	capabilities: SCapabilities,
	properties: z.array(SProperty)
});
export const SLibraryItem = z.strictObject({
	...SPartDefinition.shape,
	$schema: z.literal('yadori/library-item@1'),
	id: SId,
	revision: z.number().int().positive(),
	tags: z.array(SText),
	sourceUrl: SUrl.nullable()
});
export const libraryDefinition = defineSchema({
	family: 'yadori/library-item',
	version: 1,
	schema: SLibraryItem
});
export const SPart = z.strictObject({
	...SPartDefinition.shape,
	id: SId,
	buildState: z.enum(['wishlist', 'in-build', 'archived']),
	unit: SUnit,
	quantity: SNonnegative,
	plannedQuantity: SNullableNonnegative,
	purchasePackQuantity: SPositive.nullable(),
	estimatedUnitPrice: SNullableNonnegative,
	notes: SText,
	tags: z.array(SText),
	sourceIds: z.array(SId),
	sections: z.array(SText),
	libraryOrigin: z.strictObject({ itemId: SId, revision: z.number().int().positive() }).nullable(),
	libraryLink: z
		.strictObject({
			itemId: SId,
			appliedRevision: z.number().int().positive(),
			base: SPartDefinition
		})
		.nullable()
});
export const SInstance = z.strictObject({
	id: SId,
	partId: SId,
	label: SText,
	installed: z.boolean()
});
export const SLayout = z.strictObject({
	id: SId,
	name: z.string().min(1),
	widthMm: SPositive,
	heightMm: SPositive,
	kind: z.enum(['board', 'wall', 'floor']),
	notes: SText
});
export const SPlacement = z.strictObject({
	id: SId,
	instanceId: SId,
	layoutId: SId,
	xMm: z.number().finite(),
	yMm: z.number().finite(),
	rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
});
const SEndpoint = z.strictObject({ instanceId: SId, portId: SId });
export const SConductor = z.strictObject({
	id: SId,
	name: SText,
	coreIndex: z.number().int().nonnegative(),
	from: SEndpoint,
	to: SEndpoint
});
export const SRunSizing = z.strictObject({
	circuit: z.enum(['dc', 'ac', 'unknown']),
	voltageV: SNullablePositive,
	maxDropPercent: SPositive.lt(100),
	roundTripFactor: z.union([z.literal(1), z.literal(2)]),
	conductorTemperatureC: z.number().finite().min(-20).max(105)
});
export const SRun = z.strictObject({
	id: SId,
	name: SText,
	layoutId: SId,
	materialPartId: SId,
	topology: z.enum(['standard', 'series']),
	conductors: z.array(SConductor).min(1),
	route: z.array(SPoint).min(2),
	lengthBasis: z.enum(['route', 'manual', 'measured']),
	sizing: SRunSizing.nullable(),
	lengthM: SNullableNonnegative,
	extraLengthM: SNonnegative,
	currentA: SNullableNonnegative,
	fuseA: SNullablePositive,
	notes: SText
});
export const SAlternative = z.strictObject({ id: SId, aPartId: SId, bPartId: SId });
export const SSource = z.strictObject({
	id: SId,
	partId: SId,
	kind: z.enum(['product', 'seller', 'video', 'datasheet', 'other']),
	title: SText,
	url: SUrl,
	provider: z.enum(['idealo', 'agent']).nullable(),
	productId: SText.nullable(),
	notes: SText
});
export const SQuote = z.strictObject({
	id: SId,
	partId: SId,
	sourceId: SId,
	observedAt: SDate,
	currency: z.literal('EUR'),
	price: SNonnegative,
	packQuantity: SPositive,
	unit: SUnit,
	seller: SText.nullable(),
	shipping: SNullableNonnegative,
	tax: z.enum(['gross', 'net', 'unknown']),
	condition: z.enum(['new', 'used', 'unknown']),
	notes: SText
});
export const SPurchase = z.strictObject({
	id: SId,
	partId: SId,
	sourceId: SId.nullable(),
	orderedAt: SDate,
	quantity: SPositive,
	unit: SUnit,
	totalPrice: SNullableNonnegative,
	shipping: SNullableNonnegative,
	status: z.enum(['ordered', 'received', 'returned']),
	receiptAssetId: SId.nullable(),
	notes: SText
});
export const SStock = z.strictObject({
	id: SId,
	partId: SId,
	purchaseId: SId.nullable(),
	label: SText,
	lengthM: SPositive,
	continuity: z.enum(['continuous', 'unknown']),
	notes: SText
});
export const SCut = z.strictObject({
	id: SId,
	stockPieceId: SId,
	runId: SId.nullable(),
	lengthM: SPositive,
	wasteM: SNonnegative,
	recordedAt: SDate,
	installed: z.boolean(),
	notes: SText
});
export const SAllocation = z.strictObject({
	id: SId,
	stockPieceId: SId,
	runId: SId,
	lengthM: SPositive
});
export const SAsset = z.strictObject({
	id: SId,
	name: SText,
	mediaType: SText,
	relativePath: z
		.string()
		.min(1)
		.refine(
			(path) =>
				!path.startsWith('/') &&
				!path.includes('\\') &&
				!path.split('/').includes('..') &&
				!/^[a-zA-Z]:/.test(path),
			'Asset path must stay inside the project'
		),
	sourceUrl: SUrl.nullable(),
	attribution: SText.nullable()
});
export const SReview = z.strictObject({
	id: SId,
	targetType: z.enum(['project', 'part', 'run']),
	targetId: SId,
	title: SText,
	text: SText,
	status: z.enum(['open', 'resolved']),
	source: z.enum(['user', 'agent']),
	createdAt: SDate
});
export const SProject = z.strictObject({
	$schema: z.literal('yadori/project@3'),
	id: SId,
	revision: z.number().int().nonnegative(),
	name: z.string().min(1),
	currency: z.literal('EUR'),
	budget: SNullableNonnegative,
	createdAt: SDate,
	updatedAt: SDate,
	parts: z.array(SPart),
	instances: z.array(SInstance),
	layouts: z.array(SLayout),
	placements: z.array(SPlacement),
	runs: z.array(SRun),
	alternatives: z.array(SAlternative),
	sources: z.array(SSource),
	quotes: z.array(SQuote),
	purchases: z.array(SPurchase),
	stockPieces: z.array(SStock),
	cuts: z.array(SCut),
	allocations: z.array(SAllocation),
	assets: z.array(SAsset),
	reviews: z.array(SReview)
});
const SLegacyPart = SPart.extend({
	purchasePackQuantity: SPart.shape.purchasePackQuantity.optional(),
	libraryOrigin: SPart.shape.libraryOrigin.optional()
});
const SLegacyRun = SRun.omit({ sizing: true });
const SProjectV2 = SProject.extend({
	$schema: z.literal('yadori/project@2'),
	runs: z.array(SLegacyRun)
});
const SProjectV1 = SProjectV2.extend({
	$schema: z.literal('yadori/project@1'),
	parts: z.array(SLegacyPart)
});
export const projectDefinition = defineSchema({
	family: 'yadori/project',
	version: 3,
	schema: SProject,
	migrations: {
		1: defineMigration({
			schema: SProjectV1,
			migrate(value) {
				return {
					...value,
					$schema: 'yadori/project@2' as const,
					parts: value.parts.map((part) => ({
						...part,
						purchasePackQuantity: part.purchasePackQuantity ?? null,
						libraryOrigin:
							part.libraryOrigin ??
							(part.libraryLink
								? { itemId: part.libraryLink.itemId, revision: part.libraryLink.appliedRevision }
								: null)
					}))
				};
			}
		}),
		2: defineMigration({
			schema: SProjectV2,
			migrate(value) {
				return {
					...value,
					$schema: 'yadori/project@3' as const,
					runs: value.runs.map((run) => ({ ...run, sizing: null }))
				};
			}
		})
	}
});

/** Prepares known contracts while retaining unsupported optional capabilities without executing them. */
export function prepareProject(input: unknown): TProject {
	const [isProjectOk, projectErr, prepared] = prepareSchemaValue(projectDefinition, input);
	if (!isProjectOk) throw projectErr;
	const project = prepared as TProject;
	for (const part of project.parts) {
		part.capabilities = prepareCapabilities(part.capabilities);
		if (part.libraryLink)
			part.libraryLink.base.capabilities = prepareCapabilities(part.libraryLink.base.capabilities);
	}
	const errors = getInvariantErrors(project);
	if (errors.length) throw new Error(errors.join('; '));
	return project;
}
export function prepareCapabilities(input: TCapabilities): TCapabilities {
	const output: TCapabilities = {};
	for (const [key, value] of Object.entries(input)) {
		const [isReferenceOk, referenceErr, reference] = readSchemaReference(
			value as unknown as TJsonObject
		);
		if (!isReferenceOk) throw referenceErr;
		const expected = expectedFamilies[key];
		if (expected != null && reference.family !== expected)
			throw new Error(`Capability ${key} must use ${expected}`);
		const definition = capabilityRegistry.get(reference.family);
		if (definition == null || reference.version > definition.version) {
			output[key] = structuredClone(value);
			continue;
		}
		const [isCapabilityOk, capabilityErr, capability] = prepareSchemaValueFromRegistry(
			capabilityRegistry,
			value
		);
		if (!isCapabilityOk) throw capabilityErr;
		output[key] = capability as TCapability;
	}
	return output;
}
export function validateProject(input: unknown): TValidation {
	try {
		prepareProject(input);
		return { valid: true, errors: [] };
	} catch (error) {
		return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
	}
}
export function prepareLibraryItem(input: unknown): import('./types').TLibraryItem {
	const [isItemOk, itemErr, item] = prepareSchemaValue(libraryDefinition, input);
	if (!isItemOk) throw itemErr;
	return {
		...item,
		capabilities: prepareCapabilities(item.capabilities as TCapabilities)
	} as import('./types').TLibraryItem;
}

export function getInvariantErrors(project: TProject): string[] {
	const errors: string[] = [];
	const collections = [
		project.parts,
		project.instances,
		project.layouts,
		project.placements,
		project.runs,
		project.alternatives,
		project.sources,
		project.quotes,
		project.purchases,
		project.stockPieces,
		project.cuts,
		project.allocations,
		project.assets,
		project.reviews
	];
	const ids = new Set<string>();
	for (const collection of collections)
		for (const entity of collection) {
			if (ids.has(entity.id)) errors.push(`Duplicate identity ${entity.id}`);
			ids.add(entity.id);
		}
	const parts = new Map(project.parts.map((part) => [part.id, part]));
	const instances = new Map(project.instances.map((instance) => [instance.id, instance]));
	const layouts = new Set(project.layouts.map((layout) => layout.id));
	const runs = new Map(project.runs.map((run) => [run.id, run]));
	const sources = new Map(project.sources.map((source) => [source.id, source]));
	const purchases = new Map(project.purchases.map((purchase) => [purchase.id, purchase]));
	const stocks = new Map(project.stockPieces.map((stock) => [stock.id, stock]));
	const assets = new Set(project.assets.map((asset) => asset.id));
	for (const part of project.parts) {
		if (part.unit === 'each' && !Number.isInteger(part.quantity))
			errors.push(`${part.name}: discrete quantity must be an integer`);
		if (project.instances.filter((instance) => instance.partId === part.id).length > part.quantity)
			errors.push(`${part.name}: instances exceed planned quantity`);
		for (const sourceId of part.sourceIds)
			if (sources.get(sourceId)?.partId !== part.id)
				errors.push(`${part.name}: source ${sourceId} does not belong to this part`);
		const electrical = part.capabilities['electrical'];
		if (
			electrical?.$schema === 'yadori/electrical-device@1' &&
			'ports' in electrical &&
			Array.isArray(electrical.ports)
		) {
			const portIds = new Set<string>();
			for (const raw of electrical.ports) {
				const port = raw as unknown as import('./types').TPort;
				if (portIds.has(port.id)) errors.push(`${part.name}: duplicate port ${port.id}`);
				portIds.add(port.id);
				if (
					port.minCrossSectionMm2 != null &&
					port.maxCrossSectionMm2 != null &&
					port.minCrossSectionMm2 > port.maxCrossSectionMm2
				)
					errors.push(`${part.name}: terminal minimum exceeds maximum`);
			}
		}
		if (part.capabilities['cable'] && part.unit !== 'm')
			errors.push(`${part.name}: cable quantity must use metres`);
		const appearance = part.capabilities['appearance'];
		if (
			appearance?.$schema === 'yadori/appearance@1' &&
			typeof appearance['assetId'] === 'string' &&
			!appearance['assetId'].startsWith('library:') &&
			!assets.has(appearance['assetId'])
		)
			errors.push(`${part.name}: missing artwork asset`);
	}
	for (const instance of project.instances)
		if (parts.get(instance.partId)?.unit !== 'each')
			errors.push(`Instance ${instance.id} needs a discrete part`);
	const placed = new Set<string>();
	for (const placement of project.placements) {
		if (!instances.has(placement.instanceId))
			errors.push(`Placement ${placement.id} references a missing instance`);
		if (!layouts.has(placement.layoutId))
			errors.push(`Placement ${placement.id} references a missing layout`);
		if (placed.has(placement.instanceId))
			errors.push(`Instance ${placement.instanceId} has more than one physical placement`);
		placed.add(placement.instanceId);
	}
	function endpointExists(endpoint: import('./types').TEndpoint): boolean {
		const instance = instances.get(endpoint.instanceId);
		const capability = instance
			? parts.get(instance.partId)?.capabilities['electrical']
			: undefined;
		return (
			capability?.$schema === 'yadori/electrical-device@1' &&
			'ports' in capability &&
			Array.isArray(capability.ports) &&
			capability.ports.some(
				(port) =>
					port != null && typeof port === 'object' && 'id' in port && port.id === endpoint.portId
			)
		);
	}
	for (const run of project.runs) {
		if (!layouts.has(run.layoutId)) errors.push(`Run ${run.id} references a missing layout`);
		if (parts.get(run.materialPartId)?.unit !== 'm')
			errors.push(`Run ${run.id} requires a linear material part`);
		const coreIndices = new Set<number>();
		const cable = parts.get(run.materialPartId)?.capabilities['cable'];
		for (const conductor of run.conductors) {
			if (!endpointExists(conductor.from) || !endpointExists(conductor.to))
				errors.push(`Run ${run.id} references a missing terminal`);
			if (
				conductor.from.instanceId === conductor.to.instanceId &&
				conductor.from.portId === conductor.to.portId
			)
				errors.push(`Run ${run.id} connects a terminal to itself`);
			if (coreIndices.has(conductor.coreIndex))
				errors.push(`Run ${run.id} assigns a conductor twice`);
			coreIndices.add(conductor.coreIndex);
			if (
				cable?.$schema === 'yadori/electrical-cable@1' &&
				typeof cable['coreCount'] === 'number' &&
				conductor.coreIndex >= cable['coreCount']
			)
				errors.push(`Run ${run.id} exceeds the cable's core count`);
		}
	}
	const pairs = new Set<string>();
	for (const alternative of project.alternatives) {
		if (
			!parts.has(alternative.aPartId) ||
			!parts.has(alternative.bPartId) ||
			alternative.aPartId === alternative.bPartId
		)
			errors.push(`Alternative ${alternative.id} needs two distinct parts`);
		const pair = [alternative.aPartId, alternative.bPartId].sort().join(':');
		if (pairs.has(pair)) errors.push('Duplicate alternative relationship');
		pairs.add(pair);
	}
	for (const source of project.sources)
		if (!parts.has(source.partId)) errors.push(`Source ${source.id} references a missing part`);
	for (const quote of project.quotes)
		if (
			parts.get(quote.partId)?.unit !== quote.unit ||
			sources.get(quote.sourceId)?.partId !== quote.partId
		)
			errors.push(`Quote ${quote.id} has a mismatched source or unit`);
	for (const purchase of project.purchases) {
		if (
			parts.get(purchase.partId)?.unit !== purchase.unit ||
			(purchase.sourceId && sources.get(purchase.sourceId)?.partId !== purchase.partId)
		)
			errors.push(`Purchase ${purchase.id} has a mismatched part/source/unit`);
		if (purchase.receiptAssetId && !assets.has(purchase.receiptAssetId))
			errors.push(`Purchase ${purchase.id} references a missing receipt`);
	}
	for (const stock of project.stockPieces) {
		if (parts.get(stock.partId)?.unit !== 'm')
			errors.push(`Stock ${stock.id} requires a linear material part`);
		if (
			stock.purchaseId &&
			(purchases.get(stock.purchaseId)?.partId !== stock.partId ||
				purchases.get(stock.purchaseId)?.status !== 'received')
		)
			errors.push(`Stock ${stock.id} must belong to a received purchase of this part`);
		const removed = project.cuts
			.filter((cut) => cut.stockPieceId === stock.id)
			.reduce((sum, cut) => sum + cut.lengthM + cut.wasteM, 0);
		const allocated = project.allocations
			.filter((allocation) => allocation.stockPieceId === stock.id)
			.reduce((sum, allocation) => sum + allocation.lengthM, 0);
		if (removed + allocated > stock.lengthM + 0.000001)
			errors.push(`Stock ${stock.id} has more cuts/reservations than available length`);
	}
	for (const purchase of project.purchases.filter((entry) => entry.unit === 'm')) {
		const total = project.stockPieces
			.filter((stock) => stock.purchaseId === purchase.id)
			.reduce((sum, stock) => sum + stock.lengthM, 0);
		if (total > purchase.quantity + 0.000001)
			errors.push(`Purchase ${purchase.id} has more received stock than purchased length`);
	}
	for (const cut of project.cuts) {
		const stock = stocks.get(cut.stockPieceId);
		if (!stock) errors.push(`Cut ${cut.id} references missing stock`);
		if (cut.runId && runs.get(cut.runId)?.materialPartId !== stock?.partId)
			errors.push(`Cut ${cut.id} has a mismatched run/material`);
	}
	for (const allocation of project.allocations) {
		const stock = stocks.get(allocation.stockPieceId);
		if (!stock || runs.get(allocation.runId)?.materialPartId !== stock.partId)
			errors.push(`Allocation ${allocation.id} has a mismatched run/material`);
	}
	for (const review of project.reviews)
		if (
			(review.targetType === 'project' && review.targetId !== project.id) ||
			(review.targetType === 'part' && !parts.has(review.targetId)) ||
			(review.targetType === 'run' && !runs.has(review.targetId))
		)
			errors.push(`Review ${review.id} references a missing target`);
	return errors;
}

const commandSchemas = [
	z.strictObject({ type: z.literal('part.add'), part: SPart }),
	z.strictObject({
		type: z.literal('part.update'),
		id: SId,
		patch: SPart.omit({ id: true }).partial()
	}),
	z.strictObject({ type: z.literal('part.remove'), id: SId }),
	z.strictObject({ type: z.literal('part.detach'), id: SId }),
	z.strictObject({ type: z.literal('part.apply-library'), id: SId, item: SLibraryItem }),
	z.strictObject({
		type: z.literal('part.reset-library-field'),
		id: SId,
		field: z.enum(['name', 'brand', 'description', 'capabilities', 'properties'])
	}),
	z.strictObject({ type: z.literal('alternative.add'), alternative: SAlternative }),
	z.strictObject({ type: z.literal('alternative.remove'), id: SId }),
	z.strictObject({ type: z.literal('alternative.use'), chosenId: SId, replacedId: SId }),
	z.strictObject({ type: z.literal('instance.add'), instance: SInstance }),
	z.strictObject({
		type: z.literal('instance.update'),
		id: SId,
		patch: SInstance.omit({ id: true }).partial()
	}),
	z.strictObject({ type: z.literal('instance.remove'), id: SId }),
	z.strictObject({ type: z.literal('layout.add'), layout: SLayout }),
	z.strictObject({
		type: z.literal('layout.update'),
		id: SId,
		patch: SLayout.omit({ id: true }).partial()
	}),
	z.strictObject({ type: z.literal('placement.add'), placement: SPlacement }),
	z.strictObject({
		type: z.literal('placement.update'),
		id: SId,
		patch: SPlacement.omit({ id: true }).partial()
	}),
	z.strictObject({ type: z.literal('placement.remove'), id: SId }),
	z.strictObject({ type: z.literal('run.add'), run: SRun }),
	z.strictObject({
		type: z.literal('run.update'),
		id: SId,
		patch: SRun.omit({ id: true }).partial()
	}),
	z.strictObject({ type: z.literal('run.remove'), id: SId }),
	z.strictObject({ type: z.literal('source.add'), source: SSource }),
	z.strictObject({
		type: z.literal('source.update'),
		id: SId,
		patch: SSource.omit({ id: true }).partial()
	}),
	z.strictObject({ type: z.literal('source.remove'), id: SId }),
	z.strictObject({ type: z.literal('quote.add'), quote: SQuote }),
	z.strictObject({ type: z.literal('purchase.add'), purchase: SPurchase }),
	z.strictObject({
		type: z.literal('purchase.update'),
		id: SId,
		patch: SPurchase.omit({ id: true }).partial()
	}),
	z.strictObject({ type: z.literal('stock.add'), stock: SStock }),
	z.strictObject({
		type: z.literal('stock.update'),
		id: SId,
		patch: SStock.omit({ id: true }).partial()
	}),
	z.strictObject({ type: z.literal('stock.remove'), id: SId }),
	z.strictObject({ type: z.literal('cut.add'), cut: SCut }),
	z.strictObject({
		type: z.literal('cut.update'),
		id: SId,
		patch: SCut.omit({ id: true }).partial()
	}),
	z.strictObject({ type: z.literal('cut.remove'), id: SId }),
	z.strictObject({ type: z.literal('allocation.add'), allocation: SAllocation }),
	z.strictObject({ type: z.literal('allocation.remove'), id: SId }),
	z.strictObject({ type: z.literal('asset.add'), asset: SAsset }),
	z.strictObject({ type: z.literal('review.add'), review: SReview }),
	z.strictObject({
		type: z.literal('review.update'),
		id: SId,
		patch: SReview.omit({ id: true }).partial()
	}),
	z.strictObject({
		type: z.literal('project.update'),
		patch: SProject.pick({ name: true, budget: true }).partial()
	})
] as const;
export const SCommands = z.array(z.discriminatedUnion('type', commandSchemas)).max(1000);
export function prepareCommands(input: unknown): TCommand[] {
	const result = SCommands.safeParse(input);
	if (!result.success)
		throw new Error(
			result.error.issues.map((issue) => issue.path.join('.') + ': ' + issue.message).join('; ')
		);
	return result.data as TCommand[];
}
