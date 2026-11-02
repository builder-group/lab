import {
	BaseEdge,
	EdgeLabelRenderer,
	useReactFlow,
	type Edge,
	type EdgeProps
} from '@xyflow/react';
import React from 'react';
import { QuestionHint } from '../../components/QuestionHint';
import {
	getCapability,
	type TCableRun,
	type TFinding,
	type TPart,
	type TPoint,
	type TPortKind
} from '../project/model';
import { CanvasOverviewContext } from './CanvasViewport';
import {
	orthogonalizeRoute,
	polylineLengthM,
	portColor,
	readableWireWidth,
	routePath,
	snapPoint
} from './geometry';

export const RunEdge: React.FC<EdgeProps<TRunEdge>> = React.memo(
	({ id, sourceX, sourceY, targetX, targetY, data, selected }) => {
		const overview = React.use(CanvasOverviewContext);
		const flow = useReactFlow();
		const cleanupRef = React.useRef<(() => void) | null>(null);
		React.useEffect(() => () => cleanupRef.current?.(), []);
		const [draft, setDraft] = React.useState<TPoint[] | null>(null);
		if (!data) return null;
		const { run, material, onRouteChange, fromPoint, toPoint, scaleKnown, semanticKind, findings } =
			data;
		const cable = material ? getCapability(material, 'cable') : null;
		const baseRoute = run.route;
		const route = (draft ?? baseRoute).map((point, index, points) =>
			index === 0
				? (fromPoint ?? { x: sourceX, y: sourceY })
				: index === points.length - 1
					? (toPoint ?? { x: targetX, y: targetY })
					: point
		);
		if (route.length < 2) route.push({ x: sourceX, y: sourceY }, { x: targetX, y: targetY });
		const color = wireColor(cable?.color) ?? portColor(semanticKind);
		const midpoint = route[Math.floor(route.length / 2)] ?? fromPoint ?? { x: sourceX, y: sourceY };
		const lengthLabel =
			run.lengthBasis === 'route'
				? scaleKnown
					? `${polylineLengthM(route).toFixed(2)} m route${run.extraLengthM > 0 ? ` + ${run.extraLengthM.toFixed(2)} m` : ''}`
					: 'size unknown'
				: `${run.lengthM == null ? '?' : (run.lengthM + run.extraLengthM).toFixed(2)} m · ${run.lengthBasis === 'measured' ? 'measured' : 'manual'}`;
		const label = `${cable?.crossSectionMm2 ?? '?'} mm² · ${lengthLabel}`;
		const labelWidth = Math.max(112, label.length * 5.8 + 18);
		function startDrag(event: React.PointerEvent<SVGCircleElement>, index: number): void {
			event.stopPropagation();
			const next = [...route];
			function move(moveEvent: PointerEvent): void {
				const point = snapPoint(
					flow.screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY })
				);
				next[index] = point;
				setDraft([...next]);
			}
			function cleanup(): void {
				window.removeEventListener('pointermove', move);
				window.removeEventListener('pointerup', finish);
				window.removeEventListener('pointercancel', cancel);
			}
			function cancel(): void {
				cleanup();
				setDraft(null);
			}
			function finish(): void {
				cleanup();
				setDraft(null);
				onRouteChange(id, orthogonalizeRoute(next));
			}
			cleanupRef.current?.();
			cleanupRef.current = cleanup;
			window.addEventListener('pointercancel', cancel, { once: true });
			window.addEventListener('pointermove', move);
			window.addEventListener('pointerup', finish, { once: true });
		}
		return (
			<g className={'wire-graphics ' + (selected ? 'selected' : '')}>
				<BaseEdge
					id={id}
					path={routePath(route)}
					interactionWidth={22}
					style={{
						stroke: color,
						strokeWidth:
							cable?.outerDiameterMm != null
								? `max(calc(1px / var(--canvas-zoom)), ${cable.outerDiameterMm}px)`
								: `calc(${readableWireWidth(cable?.crossSectionMm2 ?? null) + (selected ? 1 : 0)}px / var(--canvas-zoom))`,
						opacity: 1,
						strokeLinecap: 'round',
						strokeLinejoin: 'round'
					}}
				/>
				{selected && (
					<>
						<g transform={`translate(${midpoint.x},${midpoint.y})`} className="wire-label">
							<g style={{ transform: 'scale(calc(1 / var(--canvas-zoom))) translateY(-14px)' }}>
								<rect x={-labelWidth / 2} y="-15" width={labelWidth} height="25" rx="5" />
								<text textAnchor="middle" y="1">
									{label}
								</text>
							</g>
						</g>
						{route.slice(1, -1).map((point, index) => (
							<circle
								key={`${id}-bend-${point.x}:${point.y}`}
								className="wire-bend nodrag nopan"
								cx={point.x}
								cy={point.y}
								r={5}
								style={{ r: 'calc(5px / var(--canvas-zoom))' } as React.CSSProperties}
								onPointerDown={(event) => startDrag(event, index + 1)}
							/>
						))}
					</>
				)}
				{findings.length > 0 && (!overview || selected) && (
					<EdgeLabelRenderer>
						<div
							className="canvas-wire-check nodrag nopan"
							style={{
								position: 'absolute',
								transformOrigin: '0 0',
								transform: `translate(${midpoint.x}px, ${midpoint.y}px) scale(calc(1 / var(--canvas-zoom))) translate(10px, 8px)`,
								pointerEvents: 'all',
								width: 14,
								height: 14
							}}
						>
							<QuestionHint
								label={`${run.name}: ${findings.length} checks`}
								content={
									<>
										<strong>{run.name}</strong>
										{findings.map((f) => (
											<p key={f.id}>
												<b>{f.title}</b>
												<br />
												{f.detail}
											</p>
										))}
									</>
								}
							/>
						</div>
					</EdgeLabelRenderer>
				)}
			</g>
		);
	}
);
RunEdge.displayName = 'RunEdge';
export interface TRunEdgeData extends Record<string, unknown> {
	run: TCableRun;
	material: TPart | null;
	findings: TFinding[];
	fromPoint: TPoint | null;
	toPoint: TPoint | null;
	scaleKnown: boolean;
	semanticKind: TPortKind;
	unscaled: boolean;
	onRouteChange: (id: string, route: TPoint[]) => void;
}
export type TRunEdge = Edge<TRunEdgeData, 'wire'>;
function wireColor(color: string | null | undefined): string | null {
	if (color === 'red') return '#d8483a';
	if (color === 'black') return '#363636';
	if (color === 'blue') return '#397fd1';
	if (color === 'green-yellow') return '#8a973b';
	if (color && /^#[a-f0-9]{6}$/i.test(color)) return color;
	return null;
}
