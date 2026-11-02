import { createState } from 'feature-state';
import {
	createInstance,
	createLayout,
	createPart,
	createPlacement,
	getCapability,
	getPartForInstance,
	getPortPosition,
	type TCommand,
	type TEndpoint,
	type TLayout,
	type TLibraryItem,
	type TPart,
	type TPoint,
	type TProject
} from '../project/model';
import { getDisplaySize, getPortAnchor, orthogonalRoute } from './geometry';

export class CanvasCx {
	readonly $selection = createState<TCanvasSelection>(null);
	readonly $layoutId = createState<string | null>(null);
	readonly $pickerOpen = createState(false);
	readonly $pickerTab = createState<'parts' | 'library'>('parts');
	readonly $tool = createState<'pointer' | 'wire' | 'pan'>('pointer');
	readonly $sidebarTab = createState<'file' | 'assets' | 'checks'>('file');
	readonly $assetSource = createState<'project' | 'library'>('project');
	readonly $assetQuery = createState('');
	readonly $sidebarOpen = createState(true);
	readonly $materialId = createState<string | null>(null);
	readonly $series = createState(false);
	readonly $editPorts = createState(false);
	readonly $notice = createState<string | null>(null);
	readonly $focus = createState<string | null>(null);
	readonly $showIssues = createState(false);
	readonly $viewport = createState({ x: 40, y: 40, zoom: 0.55 });
	private noticeTimer: ReturnType<typeof setTimeout> | undefined;
	private bindings: TCanvasBindings;
	private pendingPreset: {
		itemId: string;
		placementIds: Set<string>;
		cable: boolean;
	} | null = null;
	constructor(bindings: TCanvasBindings) {
		this.bindings = bindings;
	}
	bind(bindings: TCanvasBindings): void {
		if (bindings.project.id !== this.bindings.project.id) {
			this.pendingPreset = null;
			this.$editPorts.set(false);
			this.$selection.set(null);
			this.$layoutId.set(null);
			this.$materialId.set(null);
			this.$focus.set(null);
		}
		this.bindings = bindings;
		if (this.pendingPreset) {
			const pending = this.pendingPreset;
			if (pending.cable) {
				const material = bindings.project.parts.find(
					(p) =>
						p.buildState !== 'archived' &&
						p.libraryLink?.itemId === pending.itemId &&
						getCapability(p, 'cable')
				);
				if (material) {
					this.pendingPreset = null;
					this.armCable(material.id);
				}
			}
			const placement = bindings.project.placements.find(
				(p) =>
					!pending.placementIds.has(p.id) &&
					getPartForInstance(bindings.project, p.instanceId)?.libraryOrigin?.itemId ===
						pending.itemId
			);
			if (placement) {
				this.pendingPreset = null;
				this.$selection.set({ kind: 'placement', id: placement.id });
			}
		}
	}
	mount(): () => void {
		return () => clearTimeout(this.noticeTimer);
	}
	get project(): TProject {
		return this.bindings.project;
	}
	get layout(): TLayout | null {
		return (
			this.project.layouts.find((layout) => layout.id === this.$layoutId.get()) ??
			this.project.layouts[0] ??
			null
		);
	}
	notify(message: string): void {
		clearTimeout(this.noticeTimer);
		this.$notice.set(message);
		this.noticeTimer = setTimeout(() => this.$notice.set(null), 5000);
	}
	execute(commands: TCommand[], label: string): boolean {
		try {
			this.bindings.onCommand(commands, label);
			return true;
		} catch (error) {
			this.notify(error instanceof Error ? error.message : String(error));
			return false;
		}
	}
	ensureLayout(): TLayout {
		if (this.layout) return this.layout;
		const layout = createLayout('Electrical board', 2000, 1200);
		this.execute([{ type: 'layout.add', layout }], 'Add mounting surface');
		this.$layoutId.set(layout.id);
		return layout;
	}
	place(part: TPart, point: TPoint, another = false): void {
		if (getCapability(part, 'cable')) {
			this.armCable(part.id);
			return;
		}
		const layout = this.ensureLayout();
		const commands: TCommand[] = [];
		const instances = this.project.instances.filter((instance) => instance.partId === part.id);
		let instance = instances.find(
			(unit) => !this.project.placements.some((p) => p.instanceId === unit.id)
		);
		if (!instance && !another && instances.length >= part.quantity) {
			const placed = this.project.placements.find((p) =>
				instances.some((unit) => unit.id === p.instanceId)
			);
			if (placed) {
				this.$layoutId.set(placed.layoutId);
				this.$selection.set({ kind: 'placement', id: placed.id });
				this.$pickerOpen.set(false);
				return;
			}
		}
		if (part.buildState !== 'in-build')
			commands.push({ type: 'part.update', id: part.id, patch: { buildState: 'in-build' } });
		if (!instance || another) {
			if (instances.length >= part.quantity)
				commands.push({
					type: 'part.update',
					id: part.id,
					patch: { quantity: instances.length + 1 }
				});
			instance = createInstance(
				part.id,
				instances.length ? `${part.name} ${instances.length + 1}` : ''
			);
			commands.push({ type: 'instance.add', instance });
		}
		const freePoint = this.freePoint(part, point, layout);
		const placement = createPlacement(instance.id, layout.id, freePoint.x, freePoint.y);
		commands.push({ type: 'placement.add', placement });
		this.execute(commands, 'Place ' + part.name);
		this.$selection.set({ kind: 'placement', id: placement.id });
		this.$pickerOpen.set(false);
	}
	addPreset(item: TLibraryItem, point: TPoint): void {
		const cable = Boolean(getCapability(item, 'cable'));
		this.pendingPreset = {
			itemId: item.id,
			placementIds: new Set(this.project.placements.map((p) => p.id)),
			cable
		};
		if (cable) {
			const existing = this.project.parts.find(
				(p) =>
					p.buildState !== 'archived' &&
					p.libraryLink?.itemId === item.id &&
					getCapability(p, 'cable')
			);
			if (existing) {
				this.pendingPreset = null;
				this.armCable(existing.id);
				this.$pickerOpen.set(false);
				return;
			}
		}
		const layout = this.ensureLayout();
		const freePoint = cable ? point : this.freePoint(item, point, layout);
		this.bindings.onAddPreset(item, { layoutId: layout.id, xMm: freePoint.x, yMm: freePoint.y });
		this.$pickerOpen.set(false);
	}
	armCable(partId: string): void {
		this.$materialId.set(partId);
		this.$tool.set('wire');
	}
	projectMenu(): void {
		this.bindings.onProjectMenu?.();
	}
	showParts(): void {
		this.bindings.onShowParts?.();
	}
	openAssistant(): void {
		this.bindings.onAssistant?.();
	}
	openIntegrations(): void {
		this.bindings.onIntegrations?.();
	}
	private freePoint(part: Pick<TPart, 'capabilities'>, point: TPoint, layout: TLayout): TPoint {
		const size = getDisplaySize(part, 0);
		const occupied = this.project.placements
			.filter((p) => p.layoutId === layout.id)
			.flatMap((p) => {
				const placedPart = getPartForInstance(this.project, p.instanceId);
				return placedPart
					? [{ x: p.xMm, y: p.yMm, ...getDisplaySize(placedPart, p.rotation) }]
					: [];
			});
		const clamp = (candidate: TPoint): TPoint => ({
			x: Math.max(20, Math.min(candidate.x, layout.widthMm - size.width - 20)),
			y: Math.max(20, Math.min(candidate.y, layout.heightMm - size.height - 20))
		});
		const candidates = [clamp(point)];
		for (let y = 40; y + size.height < layout.heightMm; y += 50)
			for (let x = 40; x + size.width < layout.widthMm; x += 50) candidates.push({ x, y });
		candidates.sort(
			(a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y)
		);
		return (
			candidates.find(
				(p) =>
					!occupied.some(
						(o) =>
							p.x < o.x + o.width + 35 &&
							p.x + size.width + 35 > o.x &&
							p.y < o.y + o.height + 35 &&
							p.y + size.height + 35 > o.y
					)
			) ?? clamp(point)
		);
	}
	positionTerminal(partId: string, portId: string, point: TPoint): void {
		const part = this.project.parts.find((p) => p.id === partId);
		if (!part) return;
		const appearance = getCapability(part, 'appearance') ?? {
			$schema: 'yadori/appearance@1' as const,
			assetId: null,
			projection: 'front' as const,
			anchors: {}
		};
		this.execute(
			[
				{
					type: 'part.update',
					id: part.id,
					patch: {
						capabilities: {
							...part.capabilities,
							appearance: { ...appearance, anchors: { ...appearance.anchors, [portId]: point } }
						}
					}
				}
			],
			'Position terminal'
		);
	}
	openPart(partId: string): void {
		this.bindings.onSelectPart(partId);
	}
	createPart(): void {
		this.$pickerOpen.set(false);
		this.bindings.onCreatePart?.();
	}
	removeSelection(): void {
		const selection = this.$selection.get();
		if (!selection) return;
		if (selection.kind === 'placement') {
			this.execute([{ type: 'placement.remove', id: selection.id }], 'Remove from canvas');
			this.notify('Removed from canvas. The part and its connections stay in your build.');
		} else this.execute([{ type: 'run.remove', id: selection.id }], 'Remove wire');
		this.$selection.set(null);
	}
	rotate(): void {
		const selected = this.$selection.get();
		if (selected?.kind !== 'placement') return;
		const placement = this.project.placements.find((p) => p.id === selected.id);
		if (!placement) return;
		this.execute(
			[
				{
					type: 'placement.update',
					id: placement.id,
					patch: { rotation: ((placement.rotation + 90) % 360) as 0 | 90 | 180 | 270 }
				}
			],
			'Rotate part'
		);
	}
	connect(from: TEndpoint, to: TEndpoint): void {
		if (from.instanceId === to.instanceId && from.portId === to.portId) return;
		if (
			this.project.runs.some((run) =>
				run.conductors.some(
					(c) =>
						(sameEndpoint(c.from, from) && sameEndpoint(c.to, to)) ||
						(sameEndpoint(c.to, from) && sameEndpoint(c.from, to))
				)
			)
		) {
			this.notify('These terminals are already connected.');
			return;
		}
		const layout = this.layout;
		if (!layout) return;
		const fromPoint =
			getPortPosition(this.project, from) ?? getEndpointDisplayPosition(this.project, from);
		const toPoint =
			getPortPosition(this.project, to) ?? getEndpointDisplayPosition(this.project, to);
		if (!fromPoint || !toPoint) {
			this.notify('Place both terminals on this mounting surface first.');
			return;
		}
		const commands: TCommand[] = [];
		let material =
			this.project.parts.find(
				(p) => p.id === this.$materialId.get() && getCapability(p, 'cable')
			) ??
			this.project.parts.find(
				(p) =>
					p.buildState === 'in-build' &&
					getCapability(p, 'cable')?.crossSectionMm2 == null &&
					getCapability(p, 'cable')?.coreCount === 1
			);
		if (!material) {
			material = createPart('Unspecified wire', {
				buildState: 'in-build',
				unit: 'm',
				quantity: 0,
				capabilities: {
					cable: {
						$schema: 'yadori/electrical-cable@1',
						crossSectionMm2: null,
						coreCount: 1,
						conductor: 'unknown',
						color: null,
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
			commands.push({ type: 'part.add', part: material });
		}
		if (material.buildState !== 'in-build')
			commands.push({ type: 'part.update', id: material.id, patch: { buildState: 'in-build' } });
		const run = {
			id: crypto.randomUUID(),
			name: 'Wire',
			layoutId: layout.id,
			materialPartId: material.id,
			conductors: [{ id: crypto.randomUUID(), name: 'Conductor 1', coreIndex: 0, from, to }],
			route: orthogonalRoute(fromPoint, toPoint),
			topology: this.$series.get() ? ('series' as const) : ('standard' as const),
			sizing: null,
			lengthBasis: 'route' as const,
			lengthM: null,
			extraLengthM: 0,
			currentA: null,
			fuseA: null,
			notes: ''
		};
		commands.push({ type: 'run.add', run });
		this.execute(commands, 'Connect terminals');
		this.$selection.set({ kind: 'run', id: run.id });
	}
}
export interface TCanvasBindings {
	active?: boolean;
	project: TProject;
	assistantBusy?: boolean;
	assistantProposalCount?: number;
	focusRequest?: { id: string; kind: 'run' | 'placement'; nonce: number };
	onCommand: (commands: TCommand[], label?: string) => void;
	onSelectPart: (partId: string) => void;
	onAddPreset: (item: TLibraryItem, position?: TCanvasAddPosition) => void;
	onCreatePart?: () => void;
	onProjectMenu?: () => void;
	onShowParts?: () => void;
	onAssistant?: () => void;
	onIntegrations?: () => void;
	resolveAssetUrl?: (assetId: string) => string | null;
}
export interface TCanvasAddPosition {
	layoutId: string;
	xMm: number;
	yMm: number;
}
export type TCanvasSelection = { kind: 'placement' | 'run'; id: string } | null;
export function getEndpointDisplayPosition(project: TProject, endpoint: TEndpoint): TPoint | null {
	const placement = project.placements.find((p) => p.instanceId === endpoint.instanceId);
	const instance = project.instances.find((i) => i.id === endpoint.instanceId);
	const part = project.parts.find((p) => p.id === instance?.partId);
	if (!placement || !part) return null;
	const ports = getCapability(part, 'electrical')?.ports ?? [];
	const index = ports.findIndex((port) => port.id === endpoint.portId);
	const port = ports[index];
	if (!port) return null;
	const size = getDisplaySize(part, placement.rotation);
	const anchor = getPortAnchor(part, port, index, ports.length, placement.rotation);
	return { x: placement.xMm + size.width * anchor.x, y: placement.yMm + size.height * anchor.y };
}
function sameEndpoint(a: TEndpoint, b: TEndpoint): boolean {
	return a.instanceId === b.instanceId && a.portId === b.portId;
}
