import { calculateDcCableSizing, type TDcCableSizingResult } from '../../electrical';
import type {
	TAppearanceCapability,
	TArtworkCalibrationCapability,
	TBudget,
	TCableCapability,
	TCableRun,
	TCapability,
	TDimensionsCapability,
	TElectricalCapability,
	TEndpoint,
	TFinding,
	TLinearMaterialCapability,
	TMaterialRequirement,
	TPart,
	TPartRow,
	TPlacement,
	TPoint,
	TPort,
	TProject,
	TQuote,
	TStockPiece
} from './types';

const CAPABILITY_SCHEMAS: Record<string, string> = {
	'dimensions': 'yadori/dimensions@1',
	'appearance': 'yadori/appearance@1',
	'artwork-calibration': 'yadori/artwork-calibration@1',
	'electrical': 'yadori/electrical-device@1',
	'cable': 'yadori/electrical-cable@1',
	'linearMaterial': 'yadori/linear-material@1'
};

export function getCapability(
	part: Pick<TPart, 'capabilities'>,
	key: 'artwork-calibration'
): TArtworkCalibrationCapability | undefined;
export function getCapability(
	part: Pick<TPart, 'capabilities'>,
	key: 'dimensions'
): TDimensionsCapability | undefined;
export function getCapability(
	part: Pick<TPart, 'capabilities'>,
	key: 'appearance'
): TAppearanceCapability | undefined;
export function getCapability(
	part: Pick<TPart, 'capabilities'>,
	key: 'electrical'
): TElectricalCapability | undefined;
export function getCapability(
	part: Pick<TPart, 'capabilities'>,
	key: 'cable'
): TCableCapability | undefined;
export function getCapability(
	part: Pick<TPart, 'capabilities'>,
	key: 'linearMaterial'
): TLinearMaterialCapability | undefined;
export function getCapability(
	part: Pick<TPart, 'capabilities'>,
	key: string
): TCapability | undefined;
export function getCapability(
	part: Pick<TPart, 'capabilities'>,
	key: string
): TCapability | undefined {
	const value = part.capabilities[key];
	return value && (CAPABILITY_SCHEMAS[key] == null || value.$schema === CAPABILITY_SCHEMAS[key])
		? value
		: undefined;
}
export function getPartForInstance(project: TProject, instanceId: string): TPart | undefined {
	const instance = project.instances.find((entry) => entry.id === instanceId);
	return instance ? project.parts.find((part) => part.id === instance.partId) : undefined;
}
export function getPort(project: TProject, endpoint: TEndpoint): TPort | undefined {
	const part = getPartForInstance(project, endpoint.instanceId);
	return part
		? getCapability(part, 'electrical')?.ports.find((port) => port.id === endpoint.portId)
		: undefined;
}
function getBodyDimensions(part: TPart): { widthMm: number; heightMm: number } | null {
	const dimensions = getCapability(part, 'dimensions');
	if (!dimensions) return null;
	const projection = getCapability(part, 'appearance')?.projection ?? 'front';
	const width = projection === 'side' ? dimensions.depthMm : dimensions.widthMm;
	const height = projection === 'top' ? dimensions.depthMm : dimensions.heightMm;
	return width != null && height != null ? { widthMm: width, heightMm: height } : null;
}
/** x/y is the top-left of the rotated body's axis-aligned bounding box. */
export function getPlacementDimensions(
	project: TProject,
	placement: TPlacement
): { widthMm: number; heightMm: number } | null {
	const part = getPartForInstance(project, placement.instanceId);
	const dimensions = part ? getBodyDimensions(part) : null;
	if (!dimensions) return null;
	return placement.rotation === 90 || placement.rotation === 270
		? { widthMm: dimensions.heightMm, heightMm: dimensions.widthMm }
		: dimensions;
}
export function getPortPosition(project: TProject, endpoint: TEndpoint): TPoint | null {
	const placement = project.placements.find((entry) => entry.instanceId === endpoint.instanceId);
	const part = getPartForInstance(project, endpoint.instanceId);
	if (!placement || !part) return null;
	const dimensions = getBodyDimensions(part);
	const electrical = getCapability(part, 'electrical');
	if (!dimensions || !electrical) return null;
	const index = electrical.ports.findIndex((port) => port.id === endpoint.portId);
	if (index < 0) return null;
	const anchor = getCapability(part, 'appearance')?.anchors[endpoint.portId];
	if (!anchor) return null;
	const { widthMm: width, heightMm: height } = dimensions;
	let point: TPoint;
	switch (placement.rotation) {
		case 90:
			point = { x: height * (1 - anchor.y), y: width * anchor.x };
			break;
		case 180:
			point = { x: width * (1 - anchor.x), y: height * (1 - anchor.y) };
			break;
		case 270:
			point = { x: height * anchor.y, y: width * (1 - anchor.x) };
			break;
		default:
			point = { x: width * anchor.x, y: height * anchor.y };
	}
	return { x: placement.xMm + point.x, y: placement.yMm + point.y };
}
export function getRunLengthM(project: TProject, run: TCableRun): number | null {
	if (run.lengthBasis !== 'route')
		return run.lengthM == null ? null : roundQuantity(run.lengthM + run.extraLengthM);
	// Unknown physical sizes or unplaced endpoints cannot be measured through generic artwork.
	for (const conductor of run.conductors) {
		const from = project.placements.find(
			(placement) => placement.instanceId === conductor.from.instanceId
		);
		const to = project.placements.find(
			(placement) => placement.instanceId === conductor.to.instanceId
		);
		if (
			!from ||
			!to ||
			from.layoutId !== run.layoutId ||
			to.layoutId !== run.layoutId ||
			!getPortPosition(project, conductor.from) ||
			!getPortPosition(project, conductor.to)
		)
			return null;
	}
	const millimetres = run.route.slice(1).reduce((sum, point, index) => {
		const previous = run.route[index];
		return sum + (previous ? Math.hypot(point.x - previous.x, point.y - previous.y) : 0);
	}, 0);
	return roundQuantity(millimetres / 1000 + run.extraLengthM);
}
export function isRunInBuild(project: TProject, run: TCableRun): boolean {
	return (
		project.parts.find((part) => part.id === run.materialPartId)?.buildState === 'in-build' &&
		run.conductors.every(
			(conductor) =>
				getPartForInstance(project, conductor.from.instanceId)?.buildState === 'in-build' &&
				getPartForInstance(project, conductor.to.instanceId)?.buildState === 'in-build'
		)
	);
}
export function getMaterialRequirements(project: TProject): TMaterialRequirement[] {
	return project.parts
		.filter((part) => part.unit === 'm')
		.map((part) => {
			const runs = project.runs.filter(
				(run) => run.materialPartId === part.id && isRunInBuild(project, run)
			);
			const unknownRunIds = runs
				.filter((run) => getRunLengthM(project, run) == null)
				.map((run) => run.id);
			const knownM = roundQuantity(
				runs.reduce((sum, run) => sum + (getRunLengthM(project, run) ?? 0), 0)
			);
			return {
				partId: part.id,
				requiredM: roundQuantity(knownM + (part.buildState === 'in-build' ? part.quantity : 0)),
				knownM,
				unknownRunIds,
				runIds: runs.map((run) => run.id)
			};
		});
}
export function getStockRemaining(project: TProject, stock: TStockPiece): number {
	return roundQuantity(
		Math.max(
			0,
			stock.lengthM -
				project.cuts
					.filter((cut) => cut.stockPieceId === stock.id)
					.reduce((sum, cut) => sum + cut.lengthM + cut.wasteM, 0)
		)
	);
}
export function getStockAvailable(project: TProject, stock: TStockPiece): number {
	return roundQuantity(
		Math.max(
			0,
			getStockRemaining(project, stock) -
				project.allocations
					.filter((allocation) => allocation.stockPieceId === stock.id)
					.reduce((sum, allocation) => sum + allocation.lengthM, 0)
		)
	);
}
export function getLatestQuote(project: TProject, partId: string): TQuote | null {
	return (
		[...project.quotes]
			.filter((quote) => quote.partId === partId)
			.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0] ?? null
	);
}
export function getQuoteUnitPrice(quote: TQuote): number {
	return roundPrice(quote.price / quote.packQuantity);
}
export function getParts(project: TProject): TPartRow[] {
	const materials = new Map(getMaterialRequirements(project).map((entry) => [entry.partId, entry]));
	return project.parts.map((part) => {
		const material = materials.get(part.id);
		const requiredQuantity =
			part.unit === 'm' ? (material?.requiredM ?? part.quantity) : part.quantity;
		const roundToPack = (quantity: number): number =>
			part.purchasePackQuantity == null
				? quantity
				: Math.ceil(Math.max(0, quantity - 1e-9) / part.purchasePackQuantity) *
					part.purchasePackQuantity;
		const rawTargetQuantity = Math.max(requiredQuantity, part.plannedQuantity ?? 0);
		const purchases = project.purchases.filter(
			(purchase) => purchase.partId === part.id && purchase.status !== 'returned'
		);
		const boughtQuantity = purchases.reduce((sum, purchase) => sum + purchase.quantity, 0);
		const receivedQuantity = purchases
			.filter((purchase) => purchase.status === 'received')
			.reduce((sum, purchase) => sum + purchase.quantity, 0);
		const stock = project.stockPieces.filter((piece) => piece.partId === part.id);
		const cuts = project.cuts.filter((cut) => stock.some((piece) => piece.id === cut.stockPieceId));
		const consumedQuantity = cuts.reduce((sum, cut) => sum + cut.lengthM + cut.wasteM, 0);
		const unrecordedReceived = purchases
			.filter((purchase) => purchase.status === 'received')
			.reduce(
				(sum, purchase) =>
					sum +
					Math.max(
						0,
						purchase.quantity -
							stock
								.filter((piece) => piece.purchaseId === purchase.id)
								.reduce((length, piece) => length + piece.lengthM, 0)
					),
				0
			);
		const usableStockQuantity =
			part.unit === 'm'
				? stock.reduce((sum, piece) => sum + getStockRemaining(project, piece), 0) +
					unrecordedReceived
				: receivedQuantity;
		const activeMaterialRuns = project.runs.filter(
			(run) => run.materialPartId === part.id && isRunInBuild(project, run)
		);
		const fulfilledRequirements =
			part.unit === 'm'
				? activeMaterialRuns.reduce(
						(sum, run) => sum + getFulfilledRunLength(project, run, part),
						0
					)
				: 0;
		const ordered = purchases
			.filter((purchase) => purchase.status === 'ordered')
			.reduce((sum, purchase) => sum + purchase.quantity, 0);
		const coveredQuantity = usableStockQuantity + fulfilledRequirements + ordered;
		const preOwnedQuantity = stock
			.filter((piece) => piece.purchaseId == null)
			.reduce((sum, piece) => sum + piece.lengthM, 0);
		const netTargetQuantity = Math.max(0, rawTargetQuantity - boughtQuantity - preOwnedQuantity);
		const plannedQuantity = rawTargetQuantity + roundToPack(netTargetQuantity) - netTargetQuantity;
		// This is a proof of an individual piece shortage, not a multi-run cutting optimizer.
		const continuousShortfall =
			requiresContinuousMaterial(part) &&
			ordered === 0 &&
			unrecordedReceived === 0 &&
			!stock.some((piece) => piece.continuity === 'unknown')
				? activeMaterialRuns.reduce((sum, run) => {
						const length = getRunLengthM(project, run);
						if (
							length == null ||
							!cuts.some((cut) => cut.runId === run.id) ||
							getFulfilledRunLength(project, run, part) >= length - 0.000001
						)
							return sum;
						return stock.some((piece) => getStockRemaining(project, piece) >= length - 0.000001)
							? sum
							: sum + length;
					}, 0)
				: 0;
		const remainingToBuy = roundQuantity(
			roundToPack(
				Math.max(0, requiredQuantity - coveredQuantity, netTargetQuantity, continuousShortfall)
			)
		);
		const estimatedUnitPrice = part.estimatedUnitPrice;
		const unknownQuantity = (material?.unknownRunIds.length ?? 0) > 0;
		return {
			part,
			requiredQuantity: roundQuantity(requiredQuantity),
			requiredQuantityComplete: !unknownQuantity,
			unknownRequirementCount: material?.unknownRunIds.length ?? 0,
			knownEstimate:
				estimatedUnitPrice == null ? null : roundPrice(estimatedUnitPrice * plannedQuantity),
			plannedQuantity: roundQuantity(plannedQuantity),
			boughtQuantity: roundQuantity(boughtQuantity),
			receivedQuantity: roundQuantity(receivedQuantity),
			usableStockQuantity: roundQuantity(usableStockQuantity),
			consumedQuantity: roundQuantity(consumedQuantity),
			expectedSpare: roundQuantity(coveredQuantity - requiredQuantity),
			remainingToBuy,
			estimatedUnitPrice,
			estimate:
				estimatedUnitPrice == null || unknownQuantity
					? null
					: roundPrice(estimatedUnitPrice * plannedQuantity),
			purchaseCost: roundPrice(
				purchases.reduce(
					(sum, purchase) => sum + (purchase.totalPrice ?? 0) + (purchase.shipping ?? 0),
					0
				)
			),
			placedCount: project.placements.filter((placement) =>
				project.instances.some(
					(instance) => instance.id === placement.instanceId && instance.partId === part.id
				)
			).length,
			unknownCost:
				unknownQuantity ||
				(remainingToBuy > 0 && estimatedUnitPrice == null) ||
				purchases.some((purchase) => purchase.totalPrice == null)
		};
	});
}
export function getBudget(project: TProject): TBudget {
	const rows = getParts(project);
	const active = rows.filter((row) => row.part.buildState === 'in-build');
	const purchases = project.purchases.filter((purchase) => purchase.status !== 'returned');
	const committedCost = purchases.reduce(
		(sum, purchase) => sum + (purchase.totalPrice ?? 0) + (purchase.shipping ?? 0),
		0
	);
	const recordedSpending = purchases
		.filter((purchase) => purchase.status === 'received')
		.reduce((sum, purchase) => sum + (purchase.totalPrice ?? 0) + (purchase.shipping ?? 0), 0);
	const unknownPurchaseFallback = purchases
		.filter((purchase) => purchase.totalPrice == null)
		.reduce(
			(sum, purchase) =>
				sum +
				purchase.quantity *
					(project.parts.find((part) => part.id === purchase.partId)?.estimatedUnitPrice ?? 0),
			0
		);
	const remainingPurchases = active.reduce(
		(sum, row) => sum + row.remainingToBuy * (row.estimatedUnitPrice ?? 0),
		0
	);
	const forecast = roundPrice(committedCost + unknownPurchaseFallback + remainingPurchases);
	return {
		forecast,
		forecastComplete:
			!active.some((row) => row.unknownCost) &&
			!purchases.some((purchase) => purchase.totalPrice == null),
		recordedSpending: roundPrice(recordedSpending),
		committedCost: roundPrice(committedCost),
		remainingPurchases: roundPrice(remainingPurchases),
		wishlist: roundPrice(
			rows
				.filter((row) => row.part.buildState === 'wishlist')
				.reduce((sum, row) => sum + row.plannedQuantity * (row.estimatedUnitPrice ?? 0), 0)
		),
		plannedAllowance: roundPrice(
			active.reduce((sum, row) => sum + row.plannedQuantity * (row.estimatedUnitPrice ?? 0), 0)
		),
		unknownPriceCount: rows.filter(
			(row) =>
				row.unknownCost &&
				(row.part.buildState === 'in-build' ||
					row.purchaseCost > 0 ||
					project.purchases.some(
						(purchase) => purchase.partId === row.part.id && purchase.status !== 'returned'
					))
		).length,
		unknownQuantityCount: getMaterialRequirements(project).filter(
			(requirement) => requirement.unknownRunIds.length > 0
		).length,
		overBudget: project.budget == null ? null : roundPrice(Math.max(0, forecast - project.budget))
	};
}

/** Findings compare only entered facts. They do not certify ampacity, protection coordination or installation safety. */
export function getFindings(project: TProject): TFinding[] {
	const findings: TFinding[] = [];
	let requiredQuantities: Map<string, number> | undefined;
	function getRequiredQuantity(partId: string): number {
		requiredQuantities ??= new Map(
			getParts(project).map((row) => [row.part.id, row.requiredQuantity])
		);
		return requiredQuantities.get(partId) ?? 0;
	}
	function add(
		code: string,
		targetType: TFinding['targetType'],
		targetId: string,
		severity: TFinding['severity'],
		title: string,
		detail: string
	): void {
		findings.push({
			id: `${code}:${targetType}:${targetId}`,
			code,
			targetType,
			targetId,
			severity,
			title,
			detail
		});
	}
	const supported = new Set([
		'yadori/dimensions@1',
		'yadori/appearance@1',
		'yadori/artwork-calibration@1',
		'yadori/electrical-device@1',
		'yadori/electrical-cable@1',
		'yadori/linear-material@1'
	]);
	for (const part of project.parts) {
		for (const capability of Object.values(part.capabilities))
			if (!supported.has(capability.$schema))
				add(
					'unsupported-capability:' + capability.$schema,
					'part',
					part.id,
					'warning',
					'Capability not supported by this app version',
					`${capability.$schema} is preserved but not used for calculations.`
				);
		if (part.buildState !== 'in-build') continue;
		const dimensions = getCapability(part, 'dimensions');
		if (
			project.placements.some(
				(placement) => getPartForInstance(project, placement.instanceId)?.id === part.id
			) &&
			(!dimensions || dimensions.widthMm == null || dimensions.heightMm == null)
		)
			add(
				'unknown-dimensions',
				'part',
				part.id,
				'warning',
				'Physical size is not established',
				'This illustration is unscaled. Enter the body dimensions before using its placement to estimate cable lengths.'
			);
		if (part.plannedQuantity != null && getRequiredQuantity(part.id) > part.plannedQuantity)
			add(
				'above-allowance',
				'part',
				part.id,
				'warning',
				'Requirement exceeds the planned allowance',
				`The current design needs more than the saved ${part.plannedQuantity} ${part.unit} allowance.`
			);
	}
	for (const placement of project.placements) {
		const part = getPartForInstance(project, placement.instanceId);
		if (part?.buildState !== 'in-build') continue;
		const layout = project.layouts.find((entry) => entry.id === placement.layoutId);
		const size = getPlacementDimensions(project, placement);
		if (
			layout &&
			size &&
			(placement.xMm < 0 ||
				placement.yMm < 0 ||
				placement.xMm + size.widthMm > layout.widthMm ||
				placement.yMm + size.heightMm > layout.heightMm)
		)
			add(
				'outside-layout',
				'placement',
				placement.id,
				'warning',
				'Part extends beyond this surface',
				'Check the mounting surface size or move the part.'
			);
	}
	const activeRuns = project.runs.filter((run) => isRunInBuild(project, run));
	for (const run of activeRuns) {
		const material = project.parts.find((part) => part.id === run.materialPartId);
		if (!material) continue;
		const cable = getCapability(material, 'cable');
		const length = getRunLengthM(project, run);
		const sizing = getRunCableSizing(project, run);
		if (sizing.status === 'ready' && sizing.withinVoltageDrop === false)
			add(
				'voltage-drop',
				'run',
				run.id,
				'warning',
				'Selected cable exceeds the voltage-drop target',
				`${sizing.selectedVoltageDropPercent?.toFixed(2)}% estimated cable drop; target ${run.sizing?.maxDropPercent}%. Voltage-drop minimum ${sizing.recommendedStandardMm2 == null ? 'exceeds supported sizes' : `${sizing.recommendedStandardMm2} mm²`}. Verify manufacturer and installation requirements separately.`
			);
		if (sizing.status === 'ready' && sizing.recommendedStandardMm2 == null)
			add(
				'sizing-range',
				'run',
				run.id,
				'warning',
				'Required cable area exceeds the supported size list',
				'Review the circuit design; no standard cable size is being recommended.'
			);

		if (length == null)
			add(
				'unknown-length',
				'run',
				run.id,
				'warning',
				'Cable requirement is incomplete',
				run.lengthBasis === 'route'
					? 'Place both endpoints with established body dimensions and explicit terminal positions, or enter a manual/measured length. This run is excluded from known material totals.'
					: 'Enter the cable length. This run is excluded from known material totals.'
			);
		if (!cable || cable.crossSectionMm2 == null)
			add(
				'unknown-cable-section',
				'run',
				run.id,
				'warning',
				'Cable cross-section needs a specification',
				'Choose a cable profile or enter a conductor cross-section. No suitability is assumed.'
			);
		if (run.currentA != null && cable?.ratedCurrentA != null && run.currentA > cable.ratedCurrentA)
			add(
				'cable-current',
				'run',
				run.id,
				'error',
				'Entered load exceeds the cable rating',
				`${run.currentA} A exceeds the entered ${cable.ratedCurrentA} A rating. Verify that rating applies to this installation method.`
			);
		if (run.currentA != null && cable?.ratedCurrentA == null)
			add(
				'unknown-ampacity',
				'run',
				run.id,
				'warning',
				'Cable current capacity is not established',
				'Conductor cross-section alone does not establish ampacity; installation and manufacturer data are still needed.'
			);
		for (const conductor of run.conductors) {
			const from = getPort(project, conductor.from);
			const to = getPort(project, conductor.to);
			if (!from || !to) continue;
			const incompatible = incompatibleKinds(from.kind, to.kind);
			if (incompatible && run.topology !== 'series')
				add(
					'terminal-kind:' + conductor.id,
					'run',
					run.id,
					'error',
					'These terminal roles do not match',
					`${from.name} (${from.kind}) connects to ${to.name} (${to.kind}). Use intentional Series link only for a verified series connection.`
				);
			if (
				run.topology === 'series' &&
				!(
					(from.kind === 'positive' && to.kind === 'negative') ||
					(from.kind === 'negative' && to.kind === 'positive')
				)
			)
				add(
					'series-kind:' + conductor.id,
					'run',
					run.id,
					'warning',
					'Verify this series link',
					'Series intent normally links opposite DC terminals. This is not a computed bank-voltage approval.'
				);
			for (const port of [from, to]) {
				if (
					cable?.crossSectionMm2 != null &&
					((port.minCrossSectionMm2 != null && cable.crossSectionMm2 < port.minCrossSectionMm2) ||
						(port.maxCrossSectionMm2 != null && cable.crossSectionMm2 > port.maxCrossSectionMm2))
				)
					add(
						'terminal-section:' + conductor.id + ':' + port.id,
						'run',
						run.id,
						'error',
						'Cable cross-section is outside the terminal range',
						`${cable.crossSectionMm2} mm² does not fit the entered ${port.minCrossSectionMm2 ?? '?'}–${port.maxCrossSectionMm2 ?? '?'} mm² range for ${port.name}.`
					);
				if (run.currentA != null && port.maxCurrentA != null && run.currentA > port.maxCurrentA)
					add(
						'terminal-current:' + conductor.id + ':' + port.id,
						'run',
						run.id,
						'error',
						'Entered load exceeds the terminal rating',
						`${run.currentA} A exceeds the entered ${port.maxCurrentA} A limit for ${port.name}.`
					);
			}
			const seriesContext = activeRuns.some(
				(candidate) =>
					candidate.topology === 'series' &&
					candidate.conductors.some(
						(entry) =>
							[conductor.from.instanceId, conductor.to.instanceId].includes(
								entry.from.instanceId
							) ||
							[conductor.from.instanceId, conductor.to.instanceId].includes(entry.to.instanceId)
					)
			);
			if (
				run.topology !== 'series' &&
				!seriesContext &&
				from.voltageV != null &&
				to.voltageV != null &&
				from.voltageV !== to.voltageV
			)
				add(
					'voltage:' + conductor.id,
					'run',
					run.id,
					'warning',
					'Declared terminal voltages differ',
					`${from.voltageV} V and ${to.voltageV} V differ. Verify nominal system voltage, operating ranges and any conversion.`
				);
			if (
				cable?.voltageRatingV != null &&
				Math.max(from.voltageV ?? 0, to.voltageV ?? 0) > cable.voltageRatingV
			)
				add(
					'cable-voltage:' + conductor.id,
					'run',
					run.id,
					'error',
					'Entered voltage exceeds cable rating',
					`The entered terminal voltage exceeds the cable's ${cable.voltageRatingV} V rating.`
				);
		}
		const stock = project.stockPieces.filter((piece) => piece.partId === run.materialPartId);
		const cuts = project.cuts.filter((cut) => cut.runId === run.id);
		const fulfilled = getFulfilledRunLength(project, run, material);
		const assignedLength = cuts.reduce((sum, cut) => sum + cut.lengthM, 0);
		if (
			length != null &&
			requiresContinuousMaterial(material) &&
			assignedLength + 0.000001 >= length &&
			fulfilled + 0.000001 < length
		)
			add(
				'cut-continuity',
				'run',
				run.id,
				'warning',
				'Assigned cuts do not provide one continuous length',
				`This run needs ${roundQuantity(length)} m in one piece. Several shorter cuts cannot be treated as that continuous cable; revise the cut assignment or explicitly plan a joint.`
			);
		const unfulfilled = Math.max(0, (length ?? 0) - fulfilled);
		if (unfulfilled > 0 && stock.length && requiresContinuousMaterial(material)) {
			const remaining = stock.reduce((sum, piece) => sum + getStockRemaining(project, piece), 0);
			const continuous = stock
				.filter((piece) => piece.continuity === 'continuous')
				.some((piece) => getStockRemaining(project, piece) + 0.000001 >= unfulfilled);
			if (!continuous && remaining >= unfulfilled)
				add(
					'stock-continuity',
					'run',
					run.id,
					stock.some((piece) => piece.continuity === 'unknown') ? 'warning' : 'error',
					'Check the available continuous length',
					'The total stock length is sufficient, but no known continuous piece can supply this run. An intentional joint requires its own plan.'
				);
		}
	}
	// Multiple connections are a declared terminal property, not an inferred busbar.
	const usage = new Map<string, { endpoint: TEndpoint; runIds: Set<string> }>();
	for (const run of activeRuns)
		for (const conductor of run.conductors)
			for (const endpoint of [conductor.from, conductor.to]) {
				const key = endpoint.instanceId + ':' + endpoint.portId;
				const entry = usage.get(key) ?? { endpoint, runIds: new Set<string>() };
				entry.runIds.add(run.id);
				usage.set(key, entry);
			}
	for (const entry of usage.values())
		if (entry.runIds.size > 1 && getPort(project, entry.endpoint)?.multiple === false)
			for (const runId of entry.runIds)
				add(
					'occupied-terminal:' + entry.endpoint.instanceId + ':' + entry.endpoint.portId,
					'run',
					runId,
					'warning',
					'Several runs use a single-connection terminal',
					'Verify the permitted terminal occupancy and any distribution block or adapter.'
				);
	return findings;
}
function incompatibleKinds(a: TPort['kind'], b: TPort['kind']): boolean {
	if (a === 'generic' || b === 'generic') return false;
	return a !== b;
}
export function roundQuantity(value: number): number {
	return Math.round((value + Number.EPSILON) * 10000) / 10000;
}
export function roundPrice(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getRunCableSizing(project: TProject, run: TCableRun): TDcCableSizingResult {
	const part = project.parts.find((entry) => entry.id === run.materialPartId);
	const cable = part ? getCapability(part, 'cable') : undefined;
	const config = run.sizing;
	const kinds = run.conductors.flatMap((conductor) => [
		getPort(project, conductor.from)?.kind,
		getPort(project, conductor.to)?.kind
	]);
	const hasAc = kinds.some((kind) => kind === 'live' || kind === 'neutral');
	const hasSignal = kinds.some((kind) => kind === 'signal');
	const result = calculateDcCableSizing({
		circuit: hasAc || hasSignal ? 'ac' : (config?.circuit ?? 'unknown'),
		voltageV: config?.voltageV ?? null,
		currentA: run.currentA,
		oneWayLengthM: getRunLengthM(project, run),
		maxDropPercent: config?.maxDropPercent ?? null,
		roundTripFactor: config?.roundTripFactor ?? 2,
		conductorTemperatureC: config?.conductorTemperatureC ?? 70,
		conductor: cable?.conductor ?? 'unknown',
		selectedCrossSectionMm2: cable?.crossSectionMm2 ?? null,
		enteredCableCurrentLimitA: cable?.ratedCurrentA ?? null
	});
	if (hasSignal) {
		result.status = 'unsupported';
		result.reason =
			'Signal/data cables require protocol-specific cable selection, not DC power sizing.';
		result.minimumCrossSectionMm2 = null;
		result.recommendedStandardMm2 = null;
		result.selectedVoltageDropV = null;
		result.selectedVoltageDropPercent = null;
		result.withinVoltageDrop = null;
	}
	return result;
}

function requiresContinuousMaterial(part: TPart): boolean {
	return getCapability(part, 'linearMaterial')?.continuous ?? Boolean(getCapability(part, 'cable'));
}
function getFulfilledRunLength(project: TProject, run: TCableRun, part: TPart): number {
	const required = getRunLengthM(project, run);
	if (required == null) return 0;
	const cuts = project.cuts.filter((cut) => cut.runId === run.id);
	if (requiresContinuousMaterial(part))
		return cuts.some((cut) => cut.lengthM + 0.000001 >= required) ? required : 0;
	return Math.min(
		required,
		cuts.reduce((sum, cut) => sum + cut.lengthM, 0)
	);
}
