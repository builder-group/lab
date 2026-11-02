import { areJsonValuesEqual } from 'versjon';
import { getPortPosition } from './derivations';
import { prepareCommands, prepareLibraryItem, prepareProject } from './schema';
import type {
	TCommand,
	TExecuteOptions,
	TInstance,
	TJsonValue,
	TLayout,
	TLibraryItem,
	TPart,
	TPartDefinition,
	TPlacement,
	TProject,
	TRunSizingConfig
} from './types';

export function createProject(
	name = 'Untitled build',
	options: { id?: string; now?: string; budget?: number | null } = {}
): TProject {
	const now = options.now ?? new Date().toISOString();
	return prepareProject({
		$schema: 'yadori/project@3',
		id: options.id ?? crypto.randomUUID(),
		revision: 0,
		name,
		currency: 'EUR',
		budget: options.budget ?? null,
		createdAt: now,
		updatedAt: now,
		parts: [],
		instances: [],
		layouts: [],
		placements: [],
		runs: [],
		alternatives: [],
		sources: [],
		quotes: [],
		purchases: [],
		stockPieces: [],
		cuts: [],
		allocations: [],
		assets: [],
		reviews: []
	});
}
export function createPart(
	name = 'Untitled part',
	options: Partial<Omit<TPart, 'name'>> = {}
): TPart {
	return {
		id: crypto.randomUUID(),
		name,
		brand: '',
		description: '',
		buildState: 'wishlist',
		unit: 'each',
		quantity: 1,
		plannedQuantity: null,
		purchasePackQuantity: null,
		estimatedUnitPrice: null,
		notes: '',
		tags: [],
		sourceIds: [],
		sections: ['notes', 'properties', 'sources'],
		capabilities: {},
		properties: [],
		libraryLink: null,
		libraryOrigin: null,
		...structuredClone(options)
	};
}
export function createLibraryPart(
	input: TLibraryItem,
	options: Partial<Omit<TPart, 'libraryLink'>> = {}
): TPart {
	const item = prepareLibraryItem(input);
	const definition = definitionOf(item);
	const unit = item.capabilities['linearMaterial'] || item.capabilities['cable'] ? 'm' : 'each';
	return createPart(item.name, {
		...definition,
		sections: [
			'notes',
			'properties',
			...['dimensions', 'appearance', 'electrical', 'cable'].filter(
				(key) => item.capabilities[key] != null
			),
			'sources',
			'pricing'
		],
		tags: [...item.tags],
		unit,
		quantity: unit === 'm' ? 0 : 1,
		...options,
		libraryOrigin: { itemId: item.id, revision: item.revision },
		libraryLink: {
			itemId: item.id,
			appliedRevision: item.revision,
			base: structuredClone(definition)
		}
	});
}
export function createRunSizingConfig(): TRunSizingConfig {
	return {
		circuit: 'dc',
		voltageV: null,
		maxDropPercent: 2.5,
		roundTripFactor: 2,
		conductorTemperatureC: 70
	};
}

export function createLayout(name = 'Electrical board', widthMm = 1000, heightMm = 600): TLayout {
	return { id: crypto.randomUUID(), name, widthMm, heightMm, kind: 'board', notes: '' };
}
export function createInstance(partId: string, label = ''): TInstance {
	return { id: crypto.randomUUID(), partId, label, installed: false };
}
export function createPlacement(
	instanceId: string,
	layoutId: string,
	xMm: number,
	yMm: number
): TPlacement {
	return { id: crypto.randomUUID(), instanceId, layoutId, xMm, yMm, rotation: 0 };
}

/** All commands apply to a detached candidate; a failed invariant leaves the input untouched. */
export function executeCommands(
	input: TProject,
	commands: TCommand[],
	options: TExecuteOptions = {}
): TProject {
	const project = prepareProject(input);
	if (options.expectedRevision != null && project.revision !== options.expectedRevision)
		throw new Error('This change is based on an older project revision. Refresh and try again.');
	const prepared = prepareCommands(commands);
	if (!prepared.length) return input;
	for (const command of prepared) apply(project, command);
	reconcileRoutes(project);
	project.revision += 1;
	project.updatedAt = options.now ?? new Date().toISOString();
	return prepareProject(project);
}
export function getLibraryOverrides(part: TPart): string[] {
	const link = part.libraryLink;
	if (!link) return [];
	const fields = ['name', 'brand', 'description', 'capabilities', 'properties'] as const;
	return fields.filter((field) => !equal(part[field], link.base[field]));
}
export function previewLibraryUpdate(
	project: TProject,
	partId: string,
	input: TLibraryItem
): { part: TPart; changedFields: string[]; affectedRunIds: string[] } {
	const part = requirePart(project, partId);
	const next = applyLibrary(part, prepareLibraryItem(input));
	const changedFields = (
		['name', 'brand', 'description', 'capabilities', 'properties'] as const
	).filter((field) => !equal(part[field], next[field]));
	const instanceIds = new Set(
		project.instances
			.filter((instance) => instance.partId === partId)
			.map((instance) => instance.id)
	);
	const affectedRunIds = changedFields.includes('capabilities')
		? project.runs
				.filter(
					(run) =>
						run.materialPartId === partId ||
						run.conductors.some(
							(conductor) =>
								instanceIds.has(conductor.from.instanceId) ||
								instanceIds.has(conductor.to.instanceId)
						)
				)
				.map((run) => run.id)
		: [];
	return { part: next, changedFields, affectedRunIds };
}

function apply(project: TProject, command: TCommand): void {
	switch (command.type) {
		case 'part.add':
			project.parts.push(command.part);
			return;
		case 'part.update':
			update(project.parts, command.id, command.patch);
			return;
		case 'part.detach':
			requirePart(project, command.id).libraryLink = null;
			return;
		case 'part.apply-library': {
			const current = requirePart(project, command.id);
			Object.assign(current, applyLibrary(current, prepareLibraryItem(command.item)));
			return;
		}
		case 'part.reset-library-field': {
			const part = requirePart(project, command.id);
			if (!part.libraryLink) throw new Error('This part is not linked to a library item.');
			Object.assign(part, {
				[command.field]: structuredClone(part.libraryLink.base[command.field])
			});
			return;
		}
		case 'part.remove': {
			requirePart(project, command.id);
			if (
				project.purchases.some((purchase) => purchase.partId === command.id) ||
				project.stockPieces.some((stock) => stock.partId === command.id)
			)
				throw new Error(
					'This part has purchase or stock records. Archive it to preserve those facts.'
				);
			const instanceIds = new Set(
				project.instances
					.filter((instance) => instance.partId === command.id)
					.map((instance) => instance.id)
			);
			for (const run of [...project.runs])
				if (
					run.materialPartId === command.id ||
					run.conductors.some(
						(conductor) =>
							instanceIds.has(conductor.from.instanceId) || instanceIds.has(conductor.to.instanceId)
					)
				)
					removeRun(project, run.id);
			project.parts = project.parts.filter((part) => part.id !== command.id);
			project.instances = project.instances.filter((instance) => instance.partId !== command.id);
			project.placements = project.placements.filter(
				(placement) => !instanceIds.has(placement.instanceId)
			);
			project.alternatives = project.alternatives.filter(
				(alternative) => alternative.aPartId !== command.id && alternative.bPartId !== command.id
			);
			project.sources = project.sources.filter((source) => source.partId !== command.id);
			project.quotes = project.quotes.filter((quote) => quote.partId !== command.id);
			project.reviews = project.reviews.filter(
				(review) => !(review.targetType === 'part' && review.targetId === command.id)
			);
			return;
		}
		case 'alternative.add':
			project.alternatives.push(command.alternative);
			return;
		case 'alternative.remove':
			remove(project.alternatives, command.id);
			return;
		case 'alternative.use':
			requirePart(project, command.chosenId).buildState = 'in-build';
			requirePart(project, command.replacedId).buildState = 'wishlist';
			return;
		case 'instance.add':
			project.instances.push(command.instance);
			return;
		case 'instance.update':
			update(project.instances, command.id, command.patch);
			return;
		case 'instance.remove': {
			const instance = requireEntity(project.instances, command.id);
			const part = requirePart(project, instance.partId);
			for (const run of [...project.runs])
				if (
					run.conductors.some(
						(conductor) =>
							conductor.from.instanceId === instance.id || conductor.to.instanceId === instance.id
					)
				)
					removeRun(project, run.id);
			project.placements = project.placements.filter(
				(placement) => placement.instanceId !== instance.id
			);
			remove(project.instances, instance.id);
			part.quantity = Math.max(0, part.quantity - 1);
			return;
		}
		case 'layout.add':
			project.layouts.push(command.layout);
			return;
		case 'layout.update':
			update(project.layouts, command.id, command.patch);
			return;
		case 'placement.add':
			project.placements.push(command.placement);
			return;
		case 'placement.update':
			update(project.placements, command.id, command.patch);
			return;
		case 'placement.remove':
			remove(project.placements, command.id);
			return;
		case 'run.add':
			project.runs.push(command.run);
			return;
		case 'run.update':
			update(project.runs, command.id, command.patch);
			return;
		case 'run.remove':
			removeRun(project, command.id);
			return;
		case 'source.add':
			project.sources.push(command.source);
			{
				const part = requirePart(project, command.source.partId);
				if (!part.sourceIds.includes(command.source.id)) part.sourceIds.push(command.source.id);
			}
			return;
		case 'source.update':
			update(project.sources, command.id, command.patch);
			return;
		case 'source.remove': {
			if (
				project.purchases.some((purchase) => purchase.sourceId === command.id) ||
				project.quotes.some((quote) => quote.sourceId === command.id)
			)
				throw new Error('This source has saved quotes or purchases. Keep it as their provenance.');
			remove(project.sources, command.id);
			for (const part of project.parts) {
				part.sourceIds = part.sourceIds.filter((id) => id !== command.id);
				part.properties = part.properties.map((property) =>
					property.sourceId === command.id ? { ...property, sourceId: null } : property
				);
			}
			return;
		}
		case 'quote.add':
			project.quotes.push(command.quote);
			return;
		case 'purchase.add':
			project.purchases.push(command.purchase);
			return;
		case 'purchase.update':
			update(project.purchases, command.id, command.patch);
			return;
		case 'stock.add':
			project.stockPieces.push(command.stock);
			return;
		case 'stock.update':
			update(project.stockPieces, command.id, command.patch);
			return;
		case 'stock.remove': {
			if (
				project.cuts.some((cut) => cut.stockPieceId === command.id) ||
				project.allocations.some((allocation) => allocation.stockPieceId === command.id)
			)
				throw new Error('This stock piece has cuts or allocations. Correct those records first.');
			remove(project.stockPieces, command.id);
			return;
		}
		case 'cut.update':
			update(project.cuts, command.id, command.patch);
			return;
		case 'cut.remove':
			remove(project.cuts, command.id);
			return;
		case 'cut.add': {
			project.cuts.push(command.cut);
			let remaining = command.cut.lengthM;
			project.allocations = project.allocations.flatMap((allocation) => {
				if (
					allocation.stockPieceId !== command.cut.stockPieceId ||
					allocation.runId !== command.cut.runId ||
					remaining <= 0
				)
					return [allocation];
				const fulfilled = Math.min(remaining, allocation.lengthM);
				remaining -= fulfilled;
				return allocation.lengthM > fulfilled
					? [{ ...allocation, lengthM: allocation.lengthM - fulfilled }]
					: [];
			});
			return;
		}
		case 'allocation.add':
			project.allocations.push(command.allocation);
			return;
		case 'allocation.remove':
			remove(project.allocations, command.id);
			return;
		case 'asset.add':
			project.assets.push(command.asset);
			return;
		case 'review.add':
			project.reviews.push(command.review);
			return;
		case 'review.update':
			update(project.reviews, command.id, command.patch);
			return;
		case 'project.update':
			Object.assign(project, command.patch);
			return;
	}
}
function removeRun(project: TProject, id: string): void {
	requireEntity(project.runs, id);
	project.runs = project.runs.filter((run) => run.id !== id);
	project.allocations = project.allocations.filter((allocation) => allocation.runId !== id);
	project.cuts = project.cuts.map((cut) => (cut.runId === id ? { ...cut, runId: null } : cut));
	project.reviews = project.reviews.filter(
		(review) => !(review.targetType === 'run' && review.targetId === id)
	);
}
function requirePart(project: TProject, id: string): TPart {
	return requireEntity(project.parts, id);
}
function requireEntity<T extends { id: string }>(items: T[], id: string): T {
	const item = items.find((entry) => entry.id === id);
	if (!item) throw new Error(`Record ${id} no longer exists.`);
	return item;
}
function update<T extends { id: string }>(
	items: T[],
	id: string,
	patch: Partial<Omit<T, 'id'>>
): void {
	Object.assign(requireEntity(items, id), patch);
}
function remove<T extends { id: string }>(items: T[], id: string): void {
	const index = items.findIndex((item) => item.id === id);
	if (index < 0) throw new Error(`Record ${id} no longer exists.`);
	items.splice(index, 1);
}
function definitionOf(item: TPartDefinition): TPartDefinition {
	return structuredClone({
		name: item.name,
		brand: item.brand,
		description: item.description,
		capabilities: item.capabilities,
		properties: item.properties
	});
}
function applyLibrary(part: TPart, item: TLibraryItem): TPart {
	if (part.libraryLink && part.libraryLink.itemId !== item.id)
		throw new Error('Detach before linking this part to a different library item.');
	if (part.libraryLink && item.revision < part.libraryLink.appliedRevision)
		throw new Error('Cannot replace a linked part with an older library revision.');
	const incoming = definitionOf(item);
	const base = part.libraryLink?.base ?? {
		name: 'Untitled part',
		brand: '',
		description: '',
		capabilities: {},
		properties: []
	};
	const merged = mergeLinked(
		base as unknown as TJsonValue,
		definitionOf(part) as unknown as TJsonValue,
		incoming as unknown as TJsonValue
	) as unknown as TPartDefinition;
	return {
		...part,
		...merged,
		libraryOrigin: part.libraryOrigin ?? { itemId: item.id, revision: item.revision },
		libraryLink: { itemId: item.id, appliedRevision: item.revision, base: incoming }
	};
}
function equal(left: unknown, right: unknown): boolean {
	if (left === undefined || right === undefined) return left === right;
	return areJsonValuesEqual(left as TJsonValue, right as TJsonValue);
}
/** Three-way merge preserves edited fields and stable-ID array additions. */
function mergeLinked(
	base: TJsonValue | undefined,
	current: TJsonValue | undefined,
	incoming: TJsonValue | undefined
): TJsonValue | undefined {
	if (equal(current, base)) return incoming === undefined ? undefined : structuredClone(incoming);
	if (isRecord(current) && isRecord(incoming)) {
		const original = isRecord(base) ? base : {};
		const output: Record<string, TJsonValue> = {};
		for (const key of new Set([...Object.keys(current), ...Object.keys(incoming)])) {
			const value = mergeLinked(original[key], current[key], incoming[key]);
			if (value !== undefined) output[key] = value;
		}
		return output;
	}
	if (
		Array.isArray(current) &&
		Array.isArray(incoming) &&
		Array.isArray(base) &&
		[...current, ...incoming, ...base].every(
			(item) => isRecord(item) && typeof item['id'] === 'string'
		)
	) {
		const byId = (items: TJsonValue[]) =>
			new Map(items.map((item) => [(item as Record<string, TJsonValue>)['id'] as string, item]));
		const original = byId(base);
		const next = byId(incoming);
		const own = byId(current);
		const result: TJsonValue[] = [];
		for (const id of new Set([...own.keys(), ...next.keys()])) {
			const value = mergeLinked(original.get(id), own.get(id), next.get(id));
			if (value !== undefined) result.push(value);
		}
		return result;
	}
	return current === undefined ? undefined : structuredClone(current);
}
function isRecord(value: TJsonValue | undefined): value is Record<string, TJsonValue> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Endpoint geometry is part of the same transaction as a physical move; measured lengths stay frozen. */
export function reconcileRoutes(project: TProject): void {
	for (const run of project.runs) {
		const conductor = run.conductors[0];
		if (!conductor || run.route.length < 2) continue;
		const from = getPortPosition(project, conductor.from);
		const to = getPortPosition(project, conductor.to);
		const originalFirst = run.route[0];
		const originalSecond = run.route[1];
		const lastIndex = run.route.length - 1;
		const originalLast = run.route[lastIndex];
		const originalPrevious = run.route[lastIndex - 1];
		if (from && originalFirst) {
			if (run.route.length > 2 && originalSecond) {
				if (Math.abs(originalSecond.y - originalFirst.y) < 0.001)
					run.route[1] = { ...originalSecond, y: from.y };
				else if (Math.abs(originalSecond.x - originalFirst.x) < 0.001)
					run.route[1] = { ...originalSecond, x: from.x };
			}
			run.route[0] = from;
		}
		if (to && originalLast) {
			const previous = run.route[lastIndex - 1];
			if (run.route.length > 2 && originalPrevious && previous) {
				if (Math.abs(originalPrevious.y - originalLast.y) < 0.001)
					run.route[lastIndex - 1] = { ...previous, y: to.y };
				else if (Math.abs(originalPrevious.x - originalLast.x) < 0.001)
					run.route[lastIndex - 1] = { ...previous, x: to.x };
			}
			run.route[lastIndex] = to;
		}
	}
}
