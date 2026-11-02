import {
	Handle,
	Position,
	useConnection,
	useUpdateNodeInternals,
	type Node,
	type NodeProps
} from '@xyflow/react';
import React from 'react';
import { QuestionHint } from '../../components/QuestionHint';
import { PartArtwork } from '../parts/components/PartArtwork';
import {
	getCapability,
	type TFinding,
	type TPart,
	type TPlacement,
	type TPoint,
	type TProject
} from '../project/model';
import { CanvasOverviewContext } from './CanvasViewport';
import { getAppearance, getDisplaySize, getPortAnchor, portColor, rotateAnchor } from './geometry';

export const DeviceNode: React.FC<NodeProps<TDeviceNode>> = React.memo(({ id, data, selected }) => {
	const { part, placement, label, editPorts, onAnchorChange, project, unscaled, findings } = data;
	const overview = React.use(CanvasOverviewContext);
	const activePort = useConnection((c) =>
		c.fromHandle?.nodeId === placement.id ? c.fromHandle.id : null
	);
	const updateNodeInternals = useUpdateNodeInternals();
	const rootRef = React.useRef<HTMLDivElement>(null);
	const cleanupRef = React.useRef<(() => void) | null>(null);
	const [draftAnchor, setDraftAnchor] = React.useState<{ portId: string; point: TPoint } | null>(
		null
	);
	React.useEffect(() => () => cleanupRef.current?.(), []);
	const ports = getCapability(part, 'electrical')?.ports ?? [];
	const size = getDisplaySize(part, placement.rotation);
	const originalSize = getDisplaySize(part, 0);
	const originalWidth = originalSize.width;
	const originalHeight = originalSize.height;
	const assetId = getAppearance(part)?.assetId;
	const geometryKey =
		`${size.width}:${size.height}:${placement.rotation}:` +
		ports
			.map((p, i) => {
				const a = getPortAnchor(part, p, i, ports.length, placement.rotation);
				return `${p.id}/${a.x}/${a.y}`;
			})
			.join('|');
	React.useLayoutEffect(() => {
		updateNodeInternals(id);
	}, [id, geometryKey, updateNodeInternals]);
	const checkMessages = findings.map((f) => ({ title: f.title, detail: f.detail }));
	if (unscaled && !checkMessages.some((m) => /dimension|size/i.test(m.title)))
		checkMessages.unshift({
			title: 'Dimensions not specified',
			detail: 'This is a display envelope. It is not used to calculate physical wire length.'
		});
	if (
		ports.some((p) => !getAppearance(part)?.anchors[p.id]) &&
		!checkMessages.some((m) => /terminal position|anchor/i.test(m.title))
	)
		checkMessages.push({
			title: 'Terminal positions incomplete',
			detail: 'Unpositioned terminals can be drawn, but cannot establish a measured cable route.'
		});
	function moveAnchor(event: React.PointerEvent<HTMLDivElement>, portId: string): void {
		if (!editPorts || !rootRef.current) return;
		event.preventDefault();
		event.stopPropagation();
		const bounds = rootRef.current.getBoundingClientRect();
		let last: TPoint | null = null;
		function move(pointer: PointerEvent): void {
			const viewPoint = {
				x: Math.max(0, Math.min(1, (pointer.clientX - bounds.left) / bounds.width)),
				y: Math.max(0, Math.min(1, (pointer.clientY - bounds.top) / bounds.height))
			};
			last = rotateAnchor(viewPoint, (360 - placement.rotation) % 360);
			setDraftAnchor({ portId, point: viewPoint });
		}
		function cleanup(): void {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', cancel);
		}
		function cancel(): void {
			cleanup();
			setDraftAnchor(null);
		}
		function finish(): void {
			cleanup();
			setDraftAnchor(null);
			if (last) onAnchorChange(part.id, portId, last);
		}
		cleanupRef.current?.();
		cleanupRef.current = cleanup;
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', finish, { once: true });
		window.addEventListener('pointercancel', cancel, { once: true });
	}
	return (
		<div
			ref={rootRef}
			className={
				'physical-device ' + (selected ? 'selected ' : '') + (unscaled ? 'size-unresolved' : '')
			}
			style={
				{
					'--device-zoom': 'var(--canvas-zoom)',
					'--device-width': `${size.width}px`
				} as React.CSSProperties
			}
			title={label || part.name}
		>
			<div
				className="physical-device-art"
				style={{
					width: originalWidth,
					height: originalHeight,
					transform: `translate(-50%, -50%) rotate(${placement.rotation}deg)`
				}}
			>
				{assetId ? (
					<PartArtwork part={part} project={project} />
				) : (
					<div className="physical-device-placeholder">
						<span>{part.name}</span>
					</div>
				)}
			</div>
			{selected && !unscaled && (
				<>
					<span className="device-dimension-width">
						<i />
						<b>{Math.round(size.width)} mm</b>
						<i />
					</span>
					<span className="device-dimension-height">
						<i />
						<b>{Math.round(size.height)} mm</b>
						<i />
					</span>
				</>
			)}
			<span
				className="physical-device-caption"
				style={{ maxWidth: 'max(60px, calc(var(--device-width) * var(--canvas-zoom)))' }}
			>
				<strong>{label || part.name}</strong>
			</span>
			{checkMessages.length > 0 && (
				<span
					className={
						'canvas-entity-check nodrag nopan ' + (overview && !selected ? 'overview' : '')
					}
					style={{ transform: 'scale(calc(1 / var(--canvas-zoom)))' }}
				>
					<QuestionHint
						label={`${label || part.name}: ${checkMessages.length} checks`}
						content={
							<>
								<strong>{label || part.name}</strong>
								{checkMessages.map((m) => (
									<p key={`${m.title}:${m.detail}`}>
										<b>{m.title}</b>
										<br />
										{m.detail}
									</p>
								))}
							</>
						}
					/>
				</span>
			)}
			{ports.map((port, index) => {
				const anchor =
					draftAnchor?.portId === port.id
						? draftAnchor.point
						: getPortAnchor(part, port, index, ports.length, placement.rotation);
				const side =
					anchor.y > 0.75
						? Position.Bottom
						: anchor.y < 0.25
							? Position.Top
							: anchor.x < 0.5
								? Position.Left
								: Position.Right;
				const active = activePort === port.id;
				return (
					<Handle
						key={port.id}
						id={port.id}
						type="source"
						position={side}
						isConnectable={!editPorts}
						onPointerDown={(event) => moveAnchor(event, port.id)}
						className={
							'physical-terminal nodrag ' +
							(active ? 'active ' : '') +
							(editPorts ? 'editing nopan ' : '') +
							(getAppearance(part)?.anchors[port.id] ? '' : 'unlocated')
						}
						style={
							{
								'left': `${anchor.x * 100}%`,
								'top': `${anchor.y * 100}%`,
								'right': 'auto',
								'bottom': 'auto',
								'width': 'calc(20px / var(--canvas-zoom))',
								'height': 'calc(20px / var(--canvas-zoom))',
								'--terminal-color': portColor(port.kind),
								'--terminal-dot': 'calc(6px / var(--canvas-zoom))'
							} as React.CSSProperties
						}
						title={
							editPorts
								? `Drag ${port.name} to its position on the artwork`
								: `${port.name}${getAppearance(part)?.anchors[port.id] ? '' : ' · position not set'}${port.voltageV == null ? '' : ` · ${port.voltageV} V`}${port.connector ? ` · ${port.connector}` : ''}`
						}
						aria-label={`${part.name}: ${port.name}`}
					>
						<span />
						{selected && (
							<label
								className={'terminal-label ' + side}
								style={{ transform: 'scale(calc(1 / var(--canvas-zoom)))' }}
							>
								{port.name}
							</label>
						)}
					</Handle>
				);
			})}
		</div>
	);
});
DeviceNode.displayName = 'DeviceNode';
export interface TDeviceNodeData extends Record<string, unknown> {
	part: TPart;
	findings: TFinding[];
	placement: TPlacement;
	label: string;
	project: TProject;
	editPorts: boolean;
	unscaled: boolean;
	onAnchorChange: (partId: string, portId: string, point: TPoint) => void;
	resolveAssetUrl?: (assetId: string) => string | null;
}
export type TDeviceNode = Node<TDeviceNodeData, 'device'>;
