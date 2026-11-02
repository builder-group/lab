import { describe, expect, it } from 'vitest';
import catalog from '../../library/data/catalog.v1.json';
import {
	createInstance,
	createLayout,
	createLibraryPart,
	createPart,
	createPlacement,
	createProject,
	executeCommands,
	getBudget,
	getCapability,
	getFindings,
	getLibraryOverrides,
	getMaterialRequirements,
	getParts,
	getPlacementDimensions,
	getPortPosition,
	getRunCableSizing,
	getRunLengthM,
	getStockRemaining,
	prepareLibraryItem,
	prepareProject,
	previewLibraryUpdate,
	validateProject
} from './index';
import type {
	TCableRun,
	TCommand,
	TLibraryItem,
	TPart,
	TPort,
	TProject,
	TPurchase,
	TStockPiece
} from './types';

const now = '2026-11-02T12:00:00Z';
function port(id: string, kind: TPort['kind'] = 'positive'): TPort {
	return {
		id,
		name: id,
		kind,
		direction: 'bidirectional',
		voltageV: 12,
		connector: null,
		minCrossSectionMm2: 1,
		maxCrossSectionMm2: 10,
		maxCurrentA: 20,
		multiple: true,
		verified: true
	};
}
function device(id: string): TPart {
	return createPart(id, {
		id,
		buildState: 'in-build',
		capabilities: {
			dimensions: {
				$schema: 'yadori/dimensions@1',
				widthMm: 100,
				heightMm: 100,
				depthMm: 50,
				verified: true
			},
			electrical: {
				$schema: 'yadori/electrical-device@1',
				ports: [port('positive'), port('negative', 'negative'), port('earth', 'earth')]
			},
			appearance: {
				$schema: 'yadori/appearance@1',
				assetId: null,
				projection: 'front',
				anchors: {
					positive: { x: 0.5, y: 1 },
					negative: { x: 0.25, y: 1 },
					earth: { x: 0.75, y: 1 }
				}
			}
		}
	});
}
function fixture(): TProject {
	const a = device('a');
	const b = device('b');
	const cable = createPart('Red cable', {
		id: 'cable',
		buildState: 'in-build',
		unit: 'm',
		quantity: 0,
		plannedQuantity: 10,
		estimatedUnitPrice: 2,
		capabilities: {
			cable: {
				$schema: 'yadori/electrical-cable@1',
				crossSectionMm2: 6,
				coreCount: 3,
				conductor: 'copper',
				color: 'red',
				outerDiameterMm: null,
				ratedCurrentA: null,
				voltageRatingV: null,
				verified: false
			},
			linearMaterial: {
				$schema: 'yadori/linear-material@1',
				unit: 'm',
				continuous: true,
				cutLossMm: 0
			}
		}
	});
	const run: TCableRun = {
		id: 'run',
		name: 'Cable run',
		layoutId: 'layout',
		materialPartId: cable.id,
		topology: 'standard',
		conductors: [
			{
				id: 'conductor',
				name: '+',
				coreIndex: 0,
				from: { instanceId: 'ia', portId: 'positive' },
				to: { instanceId: 'ib', portId: 'positive' }
			}
		],
		route: [
			{ x: 50, y: 100 },
			{ x: 6050, y: 100 }
		],
		lengthBasis: 'route',
		sizing: null,
		lengthM: null,
		extraLengthM: 0,
		currentA: null,
		fuseA: null,
		notes: ''
	};
	return executeCommands(
		createProject('Test build', { now }),
		[
			{ type: 'part.add', part: a },
			{ type: 'part.add', part: b },
			{ type: 'part.add', part: cable },
			{ type: 'layout.add', layout: { ...createLayout('Board', 10000, 2000), id: 'layout' } },
			{ type: 'instance.add', instance: { ...createInstance(a.id), id: 'ia' } },
			{ type: 'instance.add', instance: { ...createInstance(b.id), id: 'ib' } },
			{ type: 'placement.add', placement: { ...createPlacement('ia', 'layout', 0, 0), id: 'pa' } },
			{
				type: 'placement.add',
				placement: { ...createPlacement('ib', 'layout', 6000, 0), id: 'pb' }
			},
			{ type: 'run.add', run }
		],
		{ now }
	);
}
function purchase(quantity = 10): TPurchase {
	return {
		id: 'purchase',
		partId: 'cable',
		sourceId: null,
		orderedAt: now,
		quantity,
		unit: 'm',
		totalPrice: quantity * 2,
		shipping: 0,
		status: 'received',
		receiptAssetId: null,
		notes: ''
	};
}
function stock(id = 'stock', lengthM = 10): TStockPiece {
	return {
		id,
		partId: 'cable',
		purchaseId: 'purchase',
		label: id,
		lengthM,
		continuity: 'continuous',
		notes: ''
	};
}
function withStock(project = fixture()): TProject {
	return executeCommands(
		project,
		[
			{ type: 'purchase.add', purchase: purchase() },
			{ type: 'stock.add', stock: stock() }
		],
		{ now }
	);
}
function item(): TLibraryItem {
	const part = device('preset');
	return {
		id: 'library-device',
		$schema: 'yadori/library-item@1',
		revision: 1,
		name: 'Library device',
		brand: part.brand,
		description: part.description,
		capabilities: part.capabilities,
		properties: part.properties,
		sourceUrl: null,
		tags: []
	};
}
describe('project model', () => {
	it('should create an empty validated document and capture an ordinary wishlist part', () => {
		const project = createProject('My build', { now });
		const part = createPart('Starlink');
		expect(project.parts).toEqual([]);
		expect(project.layouts).toEqual([]);
		const next = executeCommands(project, [{ type: 'part.add', part }], {
			expectedRevision: 0,
			now
		});
		expect(next.parts[0]?.buildState).toBe('wishlist');
		expect(getBudget(next).forecast).toBe(0);
		expect(next.revision).toBe(1);
		expect(project.parts).toEqual([]);
	});
	it('should validate and migrate older documents without mutating them or dropping optional data', () => {
		const current = fixture();
		const legacy = JSON.parse(JSON.stringify(current));
		legacy.$schema = 'yadori/project@1';
		for (const part of legacy.parts) {
			delete part.purchasePackQuantity;
			delete part.libraryOrigin;
		}
		for (const run of legacy.runs) delete run.sizing;
		const snapshot = JSON.stringify(legacy);
		const migrated = prepareProject(legacy);
		expect(migrated.$schema).toBe('yadori/project@3');
		expect(migrated.parts.every((part) => part.purchasePackQuantity === null)).toBe(true);
		expect(migrated.parts.every((part) => part.libraryOrigin === null)).toBe(true);
		expect(migrated.runs).toEqual(current.runs);
		expect(migrated.runs.every((run) => run.sizing === null)).toBe(true);
		expect(migrated.revision).toBe(current.revision);
		expect(JSON.stringify(legacy)).toBe(snapshot);
		expect(() => prepareProject({ ...legacy, unexpected: true })).toThrow();
	});
	it('should atomically reject a batch with invalid references and stale revisions', () => {
		const project = createProject('Build', { now });
		const original = JSON.stringify(project);
		expect(() =>
			executeCommands(project, [
				{ type: 'part.add', part: createPart('Pump') },
				{ type: 'instance.add', instance: createInstance('missing') }
			])
		).toThrow(/discrete part/);
		expect(JSON.stringify(project)).toBe(original);
		expect(() => executeCommands(project, [], { expectedRevision: 5 })).toThrow(/older project/);
	});
	it('should preserve unknown optional capabilities and refuse newer document versions', () => {
		const project = createProject('Build', { now });
		project.parts.push(
			createPart('Future device', {
				capabilities: { future: { $schema: 'vendor/sensor@8', calibration: { gain: 1.5 } } }
			})
		);
		expect(prepareProject(project).parts[0]?.capabilities['future']).toEqual(
			project.parts[0]?.capabilities['future']
		);
		expect(
			getFindings(project).some((finding) => finding.code.includes('unsupported-capability'))
		).toBe(true);
		expect(validateProject({ ...project, $schema: 'yadori/project@99' }).valid).toBe(false);
	});
	it('should reject invalid known capabilities, identity collisions and escaped asset paths', () => {
		const project = fixture();
		const bad = structuredClone(project);
		required(bad.parts[0]).capabilities['dimensions'] = {
			$schema: 'yadori/dimensions@1',
			widthMm: -3,
			heightMm: 10,
			depthMm: null,
			verified: false
		};
		expect(validateProject(bad).valid).toBe(false);
		expect(
			validateProject({
				...project,
				assets: [
					{
						id: 'asset',
						name: 'Bad',
						mediaType: 'image/svg+xml',
						relativePath: '../private.svg',
						sourceUrl: null,
						attribution: null
					}
				]
			}).valid
		).toBe(false);
		expect(
			validateProject({ ...project, layouts: [{ ...required(project.layouts[0]), id: 'a' }] }).valid
		).toBe(false);
	});
	it('should derive one 6m material requirement for a multicore run and retain a 10m allowance', () => {
		const project = fixture();
		const run = required(project.runs[0]);
		run.conductors.push({
			id: 'second-core',
			name: '-',
			coreIndex: 1,
			from: { instanceId: 'ia', portId: 'negative' },
			to: { instanceId: 'ib', portId: 'negative' }
		});
		expect(getRunLengthM(project, run)).toBe(6);
		expect(getMaterialRequirements(project)[0]?.requiredM).toBe(6);
		const row = required(getParts(project).find((entry) => entry.part.id === 'cable'));
		expect(row.requiredQuantity).toBe(6);
		expect(row.plannedQuantity).toBe(10);
		expect(row.estimate).toBe(20);
		expect(row.remainingToBuy).toBe(10);
	});
	it('should round procurement to complete packs without rounding physical requirements', () => {
		const project = withStock();
		const cable = required(project.parts.find((part) => part.id === 'cable'));
		cable.purchasePackQuantity = 10;
		cable.plannedQuantity = null;
		const run = required(project.runs[0]);
		run.lengthBasis = 'manual';
		run.lengthM = 12;
		run.extraLengthM = 0;
		const row = required(getParts(project).find((entry) => entry.part.id === 'cable'));
		expect(row.requiredQuantity).toBe(12);
		expect(row.plannedQuantity).toBe(20);
		expect(row.remainingToBuy).toBe(10);
		expect(row.estimate).toBe(40);
		const beforePurchase = { ...project, purchases: [], stockPieces: [] };
		expect(
			getParts(beforePurchase).find((entry) => entry.part.id === 'cable')?.remainingToBuy
		).toBe(20);
	});
	it('should distinguish known material and cost lower bounds from unresolved runs', () => {
		const project = fixture();
		const first = required(project.runs[0]);
		project.runs.push({
			...structuredClone(first),
			id: 'unknown-run',
			conductors: first.conductors.map((conductor) => ({ ...conductor, id: 'unknown-core' })),
			lengthBasis: 'manual',
			lengthM: null
		});
		const row = required(getParts(project).find((entry) => entry.part.id === 'cable'));
		expect(row.requiredQuantity).toBe(6);
		expect(row.requiredQuantityComplete).toBe(false);
		expect(row.unknownRequirementCount).toBe(1);
		expect(row.knownEstimate).toBe(20);
		expect(row.estimate).toBeNull();
		expect(getBudget(project).forecastComplete).toBe(false);
		expect(getBudget(project).unknownQuantityCount).toBe(1);
		first.lengthBasis = 'manual';
		first.lengthM = null;
		const unknown = required(getParts(project).find((entry) => entry.part.id === 'cable'));
		expect(unknown.requiredQuantity).toBe(0);
		expect(unknown.requiredQuantityComplete).toBe(false);
		expect(unknown.estimate).toBeNull();
	});
	it('should persist explicit sizing assumptions and never double material demand for the return-path estimate', () => {
		const project = fixture();
		const next = executeCommands(project, [
			{
				type: 'run.update',
				id: 'run',
				patch: {
					currentA: 20,
					sizing: {
						circuit: 'dc',
						voltageV: 12,
						maxDropPercent: 2.5,
						roundTripFactor: 2,
						conductorTemperatureC: 70
					}
				}
			}
		]);
		const run = required(next.runs[0]);
		const sizing = getRunCableSizing(next, run);
		expect(sizing.status).toBe('ready');
		expect(sizing.loopLengthM).toBe(12);
		expect(sizing.recommendedStandardMm2).toBe(25);
		expect(sizing.withinVoltageDrop).toBe(false);
		expect(getMaterialRequirements(next)[0]?.requiredM).toBe(6);
		expect(getFindings(next).some((finding) => finding.code === 'voltage-drop')).toBe(true);
		expect(prepareProject(JSON.parse(JSON.stringify(next))).runs[0]?.sizing).toEqual(run.sizing);
	});
	it('should refuse DC sizing for AC and data terminals even when the user selected DC', () => {
		const project = fixture();
		const run = required(project.runs[0]);
		run.sizing = {
			circuit: 'dc',
			voltageV: 12,
			maxDropPercent: 3,
			roundTripFactor: 2,
			conductorTemperatureC: 20
		};
		run.currentA = 10;
		const part = required(project.parts[0]);
		const electrical = required(getCapability(part, 'electrical'));
		const terminal = required(electrical.ports[0]);
		terminal.kind = 'live';
		expect(getRunCableSizing(project, run).status).toBe('unsupported');
		expect(getRunCableSizing(project, run).recommendedStandardMm2).toBeNull();
		terminal.kind = 'signal';
		const signal = getRunCableSizing(project, run);
		expect(signal.status).toBe('unsupported');
		expect(signal.recommendedStandardMm2).toBeNull();
		expect(signal.recommendedDropV).toBeNull();
		expect(signal.reason).toMatch(/protocol-specific/);
	});
	it('should migrate version2 without inferring voltage, load or sizing assumptions', () => {
		const project = fixture();
		const older = JSON.parse(JSON.stringify(project));
		older.$schema = 'yadori/project@2';
		for (const run of older.runs) delete run.sizing;
		const snapshot = JSON.stringify(older);
		const migrated = prepareProject(older);
		expect(migrated.$schema).toBe('yadori/project@3');
		expect(migrated.runs[0]?.sizing).toBeNull();
		expect(migrated.revision).toBe(older.revision);
		expect(JSON.stringify(older)).toBe(snapshot);
		const result = getRunCableSizing(migrated, required(migrated.runs[0]));
		expect(result.status).toBe('incomplete');
		expect(result.recommendedStandardMm2).toBeNull();
	});
	it('should round the net procurement shortfall after owned material, retaining explicit allowances', () => {
		let project = fixture();
		project.runs = [];
		const cable = required(project.parts.find((part) => part.id === 'cable'));
		cable.quantity = 12;
		cable.plannedQuantity = null;
		cable.purchasePackQuantity = 10;
		project = executeCommands(project, [
			{
				type: 'stock.add',
				stock: {
					id: 'owned',
					partId: 'cable',
					purchaseId: null,
					label: 'Owned',
					lengthM: 3,
					continuity: 'continuous',
					notes: ''
				}
			}
		]);
		let row = required(getParts(project).find((entry) => entry.part.id === 'cable'));
		expect(row.requiredQuantity).toBe(12);
		expect(row.remainingToBuy).toBe(10);
		expect(row.plannedQuantity).toBe(13);
		expect(getBudget(project).remainingPurchases).toBe(20);
		project = executeCommands(project, [
			{ type: 'part.update', id: 'cable', patch: { plannedQuantity: 20 } }
		]);
		row = required(getParts(project).find((entry) => entry.part.id === 'cable'));
		expect(row.remainingToBuy).toBe(20);
		expect(row.plannedQuantity).toBe(23);
	});
	it('should not fulfill a continuous run by adding together shorter assigned cuts', () => {
		let project = fixture();
		project = executeCommands(project, [
			...['one', 'two'].map((id): TCommand => ({
				type: 'stock.add',
				stock: {
					id,
					partId: 'cable',
					purchaseId: null,
					label: id,
					lengthM: 5,
					continuity: 'continuous',
					notes: ''
				}
			})),
			...['one', 'two'].map((id): TCommand => ({
				type: 'cut.add',
				cut: {
					id: `cut-${id}`,
					stockPieceId: id,
					runId: 'run',
					lengthM: 3,
					wasteM: 0,
					recordedAt: now,
					installed: false,
					notes: ''
				}
			}))
		]);
		expect(getFindings(project).some((finding) => finding.code === 'cut-continuity')).toBe(true);
		expect(getParts(project).find((entry) => entry.part.id === 'cable')?.remainingToBuy).toBe(6);
		const complete = executeCommands(project, [
			{
				type: 'stock.add',
				stock: {
					id: 'six',
					partId: 'cable',
					purchaseId: null,
					label: 'Continuous six',
					lengthM: 6,
					continuity: 'continuous',
					notes: ''
				}
			}
		]);
		expect(getParts(complete).find((entry) => entry.part.id === 'cable')?.remainingToBuy).toBe(0);
	});
	it('should recognize and validate bundled artwork calibration provenance', () => {
		const items = catalog.items.map(prepareLibraryItem);
		const item = required(items.find((entry) => entry.capabilities['artwork-calibration']));
		const part = createLibraryPart(item, { buildState: 'in-build' });
		const project = executeCommands(createProject('Artwork'), [{ type: 'part.add', part }]);
		expect(getCapability(part, 'artwork-calibration')?.physicalWidthMm).toBeGreaterThan(0);
		expect(
			getFindings(project).some((finding) => finding.code.includes('artwork-calibration'))
		).toBe(false);
		const invalid = structuredClone(part);
		const calibration = required(getCapability(invalid, 'artwork-calibration'));
		calibration.physicalWidthMm = 0;
		expect(() =>
			executeCommands(createProject('Bad artwork'), [{ type: 'part.add', part: invalid }])
		).toThrow();
	});
	it('should separate bought stock, expected surplus and actual consumption without inventing purchases', () => {
		const project = withStock();
		const row = required(getParts(project).find((entry) => entry.part.id === 'cable'));
		expect(row.boughtQuantity).toBe(10);
		expect(row.usableStockQuantity).toBe(10);
		expect(row.expectedSpare).toBe(4);
		expect(row.remainingToBuy).toBe(0);
		const next = executeCommands(project, [
			{
				type: 'cut.add',
				cut: {
					id: 'cut',
					stockPieceId: 'stock',
					runId: 'run',
					lengthM: 6,
					wasteM: 0.2,
					recordedAt: now,
					installed: true,
					notes: ''
				}
			}
		]);
		expect(getStockRemaining(next, required(next.stockPieces[0]))).toBe(3.8);
		const after = required(getParts(next).find((entry) => entry.part.id === 'cable'));
		expect(after.expectedSpare).toBe(3.8);
		expect(after.remainingToBuy).toBe(0);
		expect(getBudget(next).recordedSpending).toBe(20);
		expect(getBudget(next).forecast).toBe(20);
	});
	it('should count existing owned material without manufacturing a purchase', () => {
		const project = executeCommands(fixture(), [
			{ type: 'stock.add', stock: { ...stock(), purchaseId: null } }
		]);
		const row = required(getParts(project).find((entry) => entry.part.id === 'cable'));
		expect(row.boughtQuantity).toBe(0);
		expect(row.usableStockQuantity).toBe(10);
		expect(row.remainingToBuy).toBe(0);
		expect(project.purchases).toEqual([]);
		expect(getBudget(project).recordedSpending).toBe(0);
	});
	it('should reject stock corrections that erase lengths already cut or reserved', () => {
		let project = withStock();
		project = executeCommands(project, [
			{
				type: 'cut.add',
				cut: {
					id: 'cut',
					stockPieceId: 'stock',
					runId: 'run',
					lengthM: 6,
					wasteM: 0,
					recordedAt: now,
					installed: false,
					notes: ''
				}
			}
		]);
		expect(() =>
			executeCommands(project, [{ type: 'stock.update', id: 'stock', patch: { lengthM: 5 } }])
		).toThrow(/more cuts/);
		expect(() => executeCommands(project, [{ type: 'stock.remove', id: 'stock' }])).toThrow(
			/cuts or allocations/
		);
		expect(project.stockPieces[0]?.lengthM).toBe(10);
		const next = executeCommands(project, [
			{ type: 'cut.update', id: 'cut', patch: { installed: true } }
		]);
		expect(next.cuts[0]?.installed).toBe(true);
		expect(getStockRemaining(next, required(next.stockPieces[0]))).toBe(4);
	});

	it('should prevent cuts plus reservations from exceeding stock and consume a reservation when cut', () => {
		let project = withStock();
		project = executeCommands(project, [
			{
				type: 'allocation.add',
				allocation: { id: 'reservation', stockPieceId: 'stock', runId: 'run', lengthM: 6 }
			}
		]);
		expect(() =>
			executeCommands(project, [
				{
					type: 'cut.add',
					cut: {
						id: 'bad-cut',
						stockPieceId: 'stock',
						runId: null,
						lengthM: 5,
						wasteM: 0,
						recordedAt: now,
						installed: false,
						notes: ''
					}
				}
			])
		).toThrow(/more cuts/);
		const next = executeCommands(project, [
			{
				type: 'cut.add',
				cut: {
					id: 'cut',
					stockPieceId: 'stock',
					runId: 'run',
					lengthM: 6,
					wasteM: 0.2,
					recordedAt: now,
					installed: false,
					notes: ''
				}
			}
		]);
		expect(next.allocations).toEqual([]);
		expect(getStockRemaining(next, required(next.stockPieces[0]))).toBe(3.8);
	});
	it('should flag fragmented stock despite a sufficient total', () => {
		const project = executeCommands(fixture(), [
			{ type: 'purchase.add', purchase: purchase() },
			{ type: 'stock.add', stock: stock('one', 5) },
			{ type: 'stock.add', stock: stock('two', 5) }
		]);
		expect(
			getFindings(project).find((finding) => finding.code === 'stock-continuity')?.severity
		).toBe('error');
	});
	it('should preserve purchase spending when a part leaves the build and forbid erasing its purchase history', () => {
		const project = withStock();
		const next = executeCommands(project, [
			{ type: 'part.update', id: 'cable', patch: { buildState: 'archived' } }
		]);
		expect(getBudget(next).recordedSpending).toBe(20);
		expect(getBudget(next).forecast).toBe(20);
		expect(() => executeCommands(next, [{ type: 'part.remove', id: 'cable' }])).toThrow(
			/purchase or stock/
		);
	});
	it('should unplace without changing quantities, purchases or connection identities', () => {
		const project = withStock();
		const next = executeCommands(project, [{ type: 'placement.remove', id: 'pa' }]);
		expect(next.parts).toEqual(project.parts);
		expect(next.runs[0]?.id).toBe('run');
		expect(next.purchases).toEqual(project.purchases);
		expect(getRunLengthM(next, required(next.runs[0]))).toBeNull();
		expect(getFindings(next).some((finding) => finding.code === 'unknown-length')).toBe(true);
		expect(getBudget(next).unknownQuantityCount).toBe(1);
	});
	it('should update physical route geometry during moves and preserve manually measured length', () => {
		const project = fixture();
		required(project.runs[0]).route = [
			{ x: 50, y: 100 },
			{ x: 3000, y: 100 },
			{ x: 3000, y: 100 },
			{ x: 6050, y: 100 }
		];
		const moved = executeCommands(project, [
			{ type: 'placement.update', id: 'pa', patch: { yMm: 200 } }
		]);
		expect(moved.runs[0]?.route[1]?.y).toBe(300);
		expect(getRunLengthM(moved, required(moved.runs[0]))).toBe(6.2);
		const measured = executeCommands(moved, [
			{
				type: 'run.update',
				id: 'run',
				patch: { lengthBasis: 'measured', lengthM: 7, extraLengthM: 0.3 }
			},
			{ type: 'placement.update', id: 'pb', patch: { xMm: 8000 } }
		]);
		expect(getRunLengthM(measured, required(measured.runs[0]))).toBe(7.3);
	});
	it('should leave route measurement unknown when a real terminal position has not been established', () => {
		const project = fixture();
		const part = required(project.parts[0]);
		const appearance = required(getCapability(part, 'appearance'));
		delete appearance.anchors['positive'];
		expect(getPortPosition(project, { instanceId: 'ia', portId: 'positive' })).toBeNull();
		expect(getRunLengthM(project, required(project.runs[0]))).toBeNull();
		const manual = executeCommands(project, [
			{ type: 'run.update', id: 'run', patch: { lengthBasis: 'manual', lengthM: 5 } }
		]);
		expect(getRunLengthM(manual, required(manual.runs[0]))).toBe(5);
	});
	it('should rotate scaled port anchors around the rotated body bounding box', () => {
		const project = fixture();
		const next = executeCommands(project, [
			{
				type: 'part.update',
				id: 'a',
				patch: {
					capabilities: {
						...required(project.parts[0]).capabilities,
						dimensions: {
							$schema: 'yadori/dimensions@1',
							widthMm: 200,
							heightMm: 100,
							depthMm: 50,
							verified: true
						}
					}
				}
			},
			{ type: 'placement.update', id: 'pa', patch: { rotation: 90, xMm: 10, yMm: 20 } }
		]);
		expect(getPlacementDimensions(next, required(next.placements[0]))).toEqual({
			widthMm: 100,
			heightMm: 200
		});
		expect(getPortPosition(next, { instanceId: 'ia', portId: 'positive' })).toEqual({
			x: 10,
			y: 120
		});
	});
	it('should not derive physical lengths from an illustration without known dimensions', () => {
		const project = fixture();
		const next = executeCommands(project, [
			{
				type: 'part.update',
				id: 'a',
				patch: {
					capabilities: {
						electrical: required(required(project.parts[0]).capabilities['electrical'])
					}
				}
			}
		]);
		expect(getRunLengthM(next, required(next.runs[0]))).toBeNull();
		expect(getBudget(next).unknownQuantityCount).toBe(1);
	});
	it('should report explicit terminal and cable incompatibilities without refusing an editable sketch', () => {
		const project = fixture();
		const cable = required(project.parts.find((part) => part.id === 'cable'));
		const capability = required(getCapability(cable, 'cable'));
		const next = executeCommands(project, [
			{
				type: 'part.update',
				id: cable.id,
				patch: {
					capabilities: {
						...cable.capabilities,
						cable: { ...capability, crossSectionMm2: 16, ratedCurrentA: 10 }
					}
				}
			},
			{
				type: 'run.update',
				id: 'run',
				patch: {
					currentA: 15,
					conductors: [
						{
							...required(required(project.runs[0]).conductors[0]),
							to: { instanceId: 'ib', portId: 'negative' }
						}
					]
				}
			}
		]);
		const codes = getFindings(next).map((finding) => finding.code);
		expect(codes.some((code) => code.startsWith('terminal-section'))).toBe(true);
		expect(codes).toContain('cable-current');
		expect(codes.some((code) => code.startsWith('terminal-kind'))).toBe(true);
		const series = executeCommands(next, [
			{ type: 'run.update', id: 'run', patch: { topology: 'series' } }
		]);
		expect(getFindings(series).some((finding) => finding.code.startsWith('terminal-kind'))).toBe(
			false
		);
	});
	it('should apply library changes with stable-ID local overrides and detach without losing project facts', () => {
		const library = item();
		const part = createLibraryPart(library, {
			id: 'linked',
			buildState: 'in-build',
			quantity: 2,
			notes: 'My mounting notes'
		});
		let project = executeCommands(createProject('Build', { now }), [{ type: 'part.add', part }]);
		project = executeCommands(project, [
			{
				type: 'part.update',
				id: part.id,
				patch: {
					brand: 'Local brand',
					capabilities: {
						...part.capabilities,
						dimensions: { ...required(getCapability(part, 'dimensions')), widthMm: 120 }
					}
				}
			}
		]);
		const changed: TLibraryItem = {
			...library,
			revision: 2,
			name: 'New library name',
			brand: 'Updated brand',
			capabilities: {
				...library.capabilities,
				dimensions: {
					$schema: 'yadori/dimensions@1',
					widthMm: 110,
					heightMm: 130,
					depthMm: 50,
					verified: true
				}
			}
		};
		const preview = previewLibraryUpdate(project, part.id, changed);
		expect(preview.changedFields).toContain('name');
		const updated = executeCommands(project, [
			{ type: 'part.apply-library', id: part.id, item: changed }
		]);
		const result = required(updated.parts[0]);
		expect(result.name).toBe('New library name');
		expect(result.brand).toBe('Local brand');
		expect(getCapability(result, 'dimensions')?.widthMm).toBe(120);
		expect(getCapability(result, 'dimensions')?.heightMm).toBe(130);
		expect(result.quantity).toBe(2);
		expect(result.notes).toBe('My mounting notes');
		expect(getLibraryOverrides(result)).toContain('brand');
		const detached = executeCommands(updated, [{ type: 'part.detach', id: part.id }]);
		expect(detached.parts[0]).toEqual({ ...result, libraryLink: null });
		expect(detached.parts[0]?.libraryOrigin).toEqual({ itemId: library.id, revision: 1 });
	});
	it('should reject library updates that orphan used ports without altering the project', () => {
		const project = fixture();
		const library = item();
		const a = required(project.parts[0]);
		a.libraryLink = {
			itemId: library.id,
			appliedRevision: 1,
			base: {
				name: a.name,
				brand: a.brand,
				description: a.description,
				capabilities: structuredClone(a.capabilities),
				properties: []
			}
		};
		const changed: TLibraryItem = {
			...library,
			revision: 2,
			capabilities: {
				...library.capabilities,
				electrical: { $schema: 'yadori/electrical-device@1', ports: [] }
			}
		};
		const original = JSON.stringify(project);
		expect(() =>
			executeCommands(project, [{ type: 'part.apply-library', id: 'a', item: changed }])
		).toThrow(/missing terminal/);
		expect(JSON.stringify(project)).toBe(original);
	});
	it('should keep unrelated wishlist ideas independent from alternative relationships', () => {
		const one = createPart('Pump A', {
			id: 'one',
			buildState: 'in-build',
			estimatedUnitPrice: 100
		});
		const two = createPart('Pump B', { id: 'two', estimatedUnitPrice: 120 });
		const starlink = createPart('Starlink', { id: 'starlink', estimatedUnitPrice: 300 });
		let project = executeCommands(
			createProject('Build', { now }),
			[one, two, starlink].map((part): TCommand => ({ type: 'part.add', part }))
		);
		project = executeCommands(project, [
			{ type: 'alternative.add', alternative: { id: 'choice', aPartId: one.id, bPartId: two.id } },
			{ type: 'alternative.use', chosenId: two.id, replacedId: one.id }
		]);
		expect(project.parts.find((part) => part.id === 'starlink')?.buildState).toBe('wishlist');
		expect(getBudget(project).forecast).toBe(120);
		expect(getBudget(project).wishlist).toBe(400);
	});
});

function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error('Missing test fixture value');
	return value;
}
