import type { Node } from '@xyflow/react';
import {
	getCapability,
	getFindings,
	getPortPosition,
	type TFinding,
	type TLayout,
	type TPart,
	type TPoint,
	type TProject
} from '../project/model';
import { getEndpointDisplayPosition, type TCanvasSelection } from './CanvasCx';
import type { TDeviceNode } from './DeviceNode';
import { getDisplaySize } from './geometry';
import type { TRunEdge } from './RunEdge';

export type TBoardNode = Node<{ layout: TLayout }, 'board'>;
export type TCanvasNode = TDeviceNode | TBoardNode;
export interface TCanvasDocumentScene {
	project: TProject;
	partsById: Map<string, TPart>;
	instancesById: Map<string, TProject['instances'][number]>;
	placementsById: Map<string, TProject['placements'][number]>;
	findings: TFinding[];
	cables: TPart[];
	layouts: Map<
		string,
		{
			nodes: Omit<TDeviceNode, 'data'>[];
			records: Map<
				string,
				{
					part: TPart;
					placement: TProject['placements'][number];
					label: string;
					unscaled: boolean;
					findings: TFinding[];
				}
			>;
			edges: TRunEdge[];
			bounds: { x: number; y: number; width: number; height: number };
		}
	>;
}
const NO_FINDINGS: TFinding[] = [];
const EMPTY_POINTS: Record<string, TPoint> = {};
const EMPTY_MEASUREMENTS: Record<string, { width: number; height: number }> = {};
/** Document-only work. Camera, hover and pointer previews never audit the project. */
export function createCanvasDocumentScene(project: TProject): TCanvasDocumentScene {
	const partsById = new Map(project.parts.map((p) => [p.id, p])),
		instancesById = new Map(project.instances.map((i) => [i.id, i])),
		placementsById = new Map(project.placements.map((p) => [p.id, p]));
	const findings = getFindings(project),
		byTarget = new Map<string, TFinding[]>();
	for (const finding of findings) {
		const key = `${finding.targetType}:${finding.targetId}`;
		const group = byTarget.get(key) ?? [];
		group.push(finding);
		byTarget.set(key, group);
	}
	const layouts: TCanvasDocumentScene['layouts'] = new Map();
	for (const layout of project.layouts) {
		const records: Map<
			string,
			{
				part: TPart;
				placement: TProject['placements'][number];
				label: string;
				unscaled: boolean;
				findings: TFinding[];
			}
		> = new Map();
		const nodes: Omit<TDeviceNode, 'data'>[] = [];
		const placedIds = new Map<string, string>();
		for (const placement of project.placements) {
			if (placement.layoutId !== layout.id) continue;
			const instance = instancesById.get(placement.instanceId),
				part = instance ? partsById.get(instance.partId) : undefined;
			if (!part || part.buildState !== 'in-build') continue;
			const size = getDisplaySize(part, placement.rotation),
				partFindings = byTarget.get(`part:${part.id}`) ?? NO_FINDINGS,
				placementFindings = byTarget.get(`placement:${placement.id}`) ?? NO_FINDINGS;
			records.set(placement.id, {
				part,
				placement,
				label: instance?.label ?? '',
				unscaled: !size.calibrated,
				findings: placementFindings.length ? [...partFindings, ...placementFindings] : partFindings
			});
			placedIds.set(placement.instanceId, placement.id);
			nodes.push({
				id: placement.id,
				type: 'device',
				position: { x: placement.xMm, y: placement.yMm },
				width: size.width,
				height: size.height,
				style: { width: size.width, height: size.height },
				ariaLabel: part.name,
				selected: false
			});
		}
		const endpoints = new Map<string, { point: TPoint | null; known: boolean }>();
		function endpoint(value: { instanceId: string; portId: string }): {
			point: TPoint | null;
			known: boolean;
		} {
			const key = `${value.instanceId}\0${value.portId}`;
			let cached = endpoints.get(key);
			if (!cached) {
				cached = {
					point: getEndpointDisplayPosition(project, value),
					known: getPortPosition(project, value) != null
				};
				endpoints.set(key, cached);
			}
			return cached;
		}
		const edges: TRunEdge[] = [];
		for (const run of project.runs) {
			const conductor = run.conductors[0];
			if (run.layoutId !== layout.id || !conductor) continue;
			const source = placedIds.get(conductor.from.instanceId),
				target = placedIds.get(conductor.to.instanceId);
			if (!source || !target) continue;
			const from = endpoint(conductor.from),
				to = endpoint(conductor.to);
			const sourcePart = records.get(source)?.part;
			edges.push({
				id: run.id,
				type: 'wire',
				source,
				target,
				sourceHandle: conductor.from.portId,
				targetHandle: conductor.to.portId,
				selected: false,
				ariaLabel: run.name,
				data: {
					run,
					semanticKind: sourcePart
						? (getCapability(sourcePart, 'electrical')?.ports.find(
								(p) => p.id === conductor.from.portId
							)?.kind ?? 'generic')
						: 'generic',
					unscaled: false,
					fromPoint: from.point,
					toPoint: to.point,
					scaleKnown: from.known && to.known,
					material: partsById.get(run.materialPartId) ?? null,
					findings: byTarget.get(`run:${run.id}`) ?? NO_FINDINGS,
					onRouteChange: NO_ROUTE_CHANGE
				}
			});
		}
		const x = nodes.length ? Math.min(...nodes.map((n) => n.position.x)) - 80 : 0,
			y = nodes.length ? Math.min(...nodes.map((n) => n.position.y)) - 80 : 0;
		const width = nodes.length
				? Math.max(...nodes.map((n) => n.position.x + (n.width ?? 0))) - x + 80
				: layout.widthMm,
			height = nodes.length
				? Math.max(...nodes.map((n) => n.position.y + (n.height ?? 0))) - y + 80
				: layout.heightMm;
		layouts.set(layout.id, { nodes, records, edges, bounds: { x, y, width, height } });
	}
	return {
		project,
		partsById,
		instancesById,
		placementsById,
		findings,
		cables: project.parts.filter((p) => p.buildState !== 'archived' && getCapability(p, 'cable')),
		layouts
	};
}
function NO_ROUTE_CHANGE(): void {
	/* Replaced with a stable command callback when the view is built. */
}
export class CanvasSceneView {
	readonly baseNodes: TCanvasNode[];
	readonly baseEdges: TRunEdge[];
	private nodes: TCanvasNode[] = [];
	private edges: TRunEdge[] = [];
	private readonly nodeCache = new Map<string, TCanvasNode>();
	private readonly edgeCache = new Map<
		string,
		{
			edge: TRunEdge;
			sourceDraft: TPoint | undefined;
			targetDraft: TPoint | undefined;
			selected: boolean;
		}
	>();
	constructor(
		readonly scene: TCanvasDocumentScene,
		readonly layoutId: string,
		onAnchorChange: (partId: string, portId: string, point: TPoint) => void,
		onRouteChange: (id: string, route: TPoint[]) => void,
		resolveAssetUrl?: (id: string) => string | null
	) {
		const layout = scene.project.layouts.find((l) => l.id === layoutId),
			view = scene.layouts.get(layoutId);
		this.baseNodes = view
			? view.nodes.map((n) => {
					const record = view.records.get(n.id);
					if (!record) throw new Error('Canvas node record missing');
					return {
						...n,
						data: {
							...record,
							project: scene.project,
							editPorts: false,
							onAnchorChange,
							...(resolveAssetUrl ? { resolveAssetUrl } : {})
						}
					} as TDeviceNode;
				})
			: [];
		if (layout)
			this.baseNodes.unshift({
				id: 'mounting-surface',
				type: 'board',
				position: { x: 0, y: 0 },
				data: { layout },
				width: layout.widthMm,
				height: layout.heightMm,
				style: { width: layout.widthMm, height: layout.heightMm },
				draggable: false,
				selectable: false,
				deletable: false,
				connectable: false,
				zIndex: -10
			});
		this.baseEdges = view
			? view.edges.map((e) => {
					if (!e.data) throw new Error('Canvas wire data missing');
					return { ...e, data: { ...e.data, onRouteChange } };
				})
			: [];
	}
	frame(
		selection: TCanvasSelection,
		drafts: Record<string, TPoint> = EMPTY_POINTS,
		editPorts = false,
		measurements: Record<string, { width: number; height: number }> = EMPTY_MEASUREMENTS
	): { nodes: TCanvasNode[]; edges: TRunEdge[] } {
		const nodes = this.baseNodes.map((base) => {
			const selected = selection?.kind === 'placement' && selection.id === base.id,
				position = drafts[base.id] ?? base.position,
				measured = measurements[base.id];
			const previous = this.nodeCache.get(base.id);
			const editing = selected && editPorts;
			if (
				previous &&
				previous.selected === selected &&
				previous.position === position &&
				previous.measured === measured &&
				(previous.type !== 'device' || previous.data.editPorts === editing)
			)
				return previous;
			const next = {
				...base,
				position,
				selected,
				measured,
				...(base.type === 'device'
					? {
							data:
								editing === base.data.editPorts ? base.data : { ...base.data, editPorts: editing }
						}
					: {})
			} as TCanvasNode;
			this.nodeCache.set(base.id, next);
			return next;
		});
		const edges = this.baseEdges.map((base) => {
			const data = base.data;
			if (!data) return base;
			const sourceDraft = drafts[base.source],
				targetDraft = drafts[base.target],
				selected = selection?.kind === 'run' && selection.id === base.id;
			const previous = this.edgeCache.get(base.id);
			if (
				previous &&
				previous.sourceDraft === sourceDraft &&
				previous.targetDraft === targetDraft &&
				previous.selected === selected
			)
				return previous.edge;
			const from = base.data?.fromPoint,
				to = base.data?.toPoint,
				source = this.scene.placementsById.get(base.source),
				target = this.scene.placementsById.get(base.target);
			const edge = {
				...base,
				selected,
				data:
					sourceDraft || targetDraft
						? {
								...data,
								fromPoint:
									from && sourceDraft && source
										? {
												x: from.x + sourceDraft.x - source.xMm,
												y: from.y + sourceDraft.y - source.yMm
											}
										: (from ?? null),
								toPoint:
									to && targetDraft && target
										? { x: to.x + targetDraft.x - target.xMm, y: to.y + targetDraft.y - target.yMm }
										: (to ?? null)
							}
						: base.data
			};
			this.edgeCache.set(base.id, { edge, sourceDraft, targetDraft, selected });
			return edge;
		});
		if (!sameReferences(this.nodes, nodes)) this.nodes = nodes;
		if (!sameReferences(this.edges, edges)) this.edges = edges;
		return { nodes: this.nodes, edges: this.edges };
	}
}
function sameReferences<T>(before: T[], after: T[]): boolean {
	return before.length === after.length && before.every((value, index) => value === after[index]);
}
