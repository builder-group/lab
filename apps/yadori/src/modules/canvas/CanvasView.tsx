import {
	Background,
	BackgroundVariant,
	ConnectionMode,
	getViewportForBounds,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
	type Connection,
	type NodeChange,
	type NodeProps,
	type ReactFlowInstance,
	type Viewport
} from '@xyflow/react';
import { useFeatureState } from 'feature-react/state';
import {
	Cable,
	Check,
	ChevronDown,
	Hand,
	MousePointer2,
	PanelLeft,
	Plus,
	ZoomIn,
	ZoomOut
} from 'lucide-react';
import React from 'react';
import { QuestionHint } from '../../components/QuestionHint';
import { libraryItems } from '../library/data';
import { getCapability, type TCommand, type TLayout, type TPoint } from '../project/model';
import { CanvasCx, type TCanvasBindings } from './CanvasCx';
import { CanvasInspector } from './CanvasInspector';
import { CanvasRulers } from './CanvasRulers';
import {
	CanvasSceneView,
	createCanvasDocumentScene,
	type TBoardNode,
	type TCanvasNode
} from './CanvasScene';
import { CanvasSidebar } from './CanvasSidebar';
import { CanvasOverviewContext, CanvasZoomReadout } from './CanvasViewport';
import { DeviceNode } from './DeviceNode';
import { snapPoint } from './geometry';
import { RunEdge, type TRunEdge } from './RunEdge';
import '@xyflow/react/dist/style.css';
import '../../styles/canvas.css';

export const CanvasView: React.FC<TCanvasBindings> = React.memo((props) => (
	<ReactFlowProvider>
		<CanvasInner {...props} />
	</ReactFlowProvider>
));
const CanvasInner: React.FC<TCanvasBindings> = (props) => {
	const { project } = props;
	const [cx] = React.useState(() => new CanvasCx(props));
	React.useLayoutEffect(() => cx.bind(props), [cx, props]);
	React.useEffect(() => cx.mount(), [cx]);
	const layoutId = useFeatureState(cx.$layoutId);
	const selection = useFeatureState(cx.$selection);
	const tool = useFeatureState(cx.$tool);
	const materialId = useFeatureState(cx.$materialId);
	const series = useFeatureState(cx.$series);
	const activeCable = project.parts.find((p) => p.id === materialId);
	const activeSection = activeCable ? getCapability(activeCable, 'cable')?.crossSectionMm2 : null;
	const editPorts = useFeatureState(cx.$editPorts);
	const notice = useFeatureState(cx.$notice);
	const focus = useFeatureState(cx.$focus);
	const sidebarTab = useFeatureState(cx.$sidebarTab);
	const sidebarOpen = useFeatureState(cx.$sidebarOpen);
	const [cableMenu, setCableMenu] = React.useState(false);
	const [viewMenu, setViewMenu] = React.useState(false);
	const viewport = cx.$viewport.get();
	const [initialViewport] = React.useState(viewport);
	const [overview, setOverview] = React.useState(viewport.zoom < 0.6);
	const overviewRef = React.useRef(overview);
	const [draftPositions, setDraftPositions] = React.useState<Record<string, TPoint>>({});
	const [boardSettings, setBoardSettings] = React.useState(false);
	const [surfaceSize, setSurfaceSize] = React.useState({ width: 0, height: 0 });
	const [flowReady, setFlowReady] = React.useState(false);
	const [measurements, setMeasurements] = React.useState<{
		projectId: string;
		byId: Record<string, { width: number; height: number }>;
	}>({ projectId: project.id, byId: {} });
	const userNavigatedRef = React.useRef(new Set<string>());
	const [panMode, setPanMode] = React.useState(false);
	const [snap, setSnap] = React.useState(true);
	const surfaceRef = React.useRef<HTMLDivElement>(null);
	const fittedLayoutRef = React.useRef<string | null>(null);
	const draggingRevisionRef = React.useRef<number | null>(null);
	const providerFlow = useReactFlow<TCanvasNode, TRunEdge>();
	const [initializedFlow, setInitializedFlow] = React.useState<ReactFlowInstance<
		TCanvasNode,
		TRunEdge
	> | null>(null);
	const flow = initializedFlow ?? providerFlow;
	React.useLayoutEffect(() => {
		const surface = surfaceRef.current;
		if (!surface) return;
		const bounds = surface.getBoundingClientRect();
		setSurfaceSize({ width: bounds.width, height: bounds.height });
		const observer = new ResizeObserver(([entry]) => {
			if (entry)
				setSurfaceSize({ width: entry.contentRect.width, height: entry.contentRect.height });
		});
		observer.observe(surface);
		return () => observer.disconnect();
	}, []);
	const onViewportMove = React.useCallback(
		(_: unknown, next: Viewport) => {
			surfaceRef.current?.style.setProperty('--canvas-zoom', String(next.zoom));
			cx.$viewport.set(next);
			const nextOverview = next.zoom < 0.6;
			if (overviewRef.current !== nextOverview) {
				overviewRef.current = nextOverview;
				setOverview(nextOverview);
			}
		},
		[cx]
	);
	const focusedRequestRef = React.useRef<number | null>(null);
	React.useLayoutEffect(() => {
		const request = props.focusRequest;
		if (
			!request ||
			!flowReady ||
			surfaceSize.width <= 22 ||
			surfaceSize.height <= 22 ||
			focusedRequestRef.current === request.nonce
		)
			return;
		if (request.kind === 'placement') {
			const placement = project.placements.find((p) => p.id === request.id);
			if (!placement) return;
			focusedRequestRef.current = request.nonce;
			fittedLayoutRef.current = `${project.id}:${placement.layoutId}`;
			cx.$layoutId.set(placement.layoutId);
			cx.$selection.set({ kind: 'placement', id: placement.id });
			cx.$focus.set(placement.id);
			return;
		}
		const run = project.runs.find((r) => r.id === request.id);
		if (!run) return;
		fittedLayoutRef.current = `${project.id}:${run.layoutId}`;
		cx.$layoutId.set(run.layoutId);
		cx.$selection.set({ kind: 'run', id: run.id });
		const points = run.route;
		if (!points.length) return;
		const x = Math.min(...points.map((p) => p.x));
		const y = Math.min(...points.map((p) => p.y));
		const width = Math.max(200, Math.max(...points.map((p) => p.x)) - x);
		const height = Math.max(200, Math.max(...points.map((p) => p.y)) - y);
		void flow
			.fitBounds(
				{ x: x - 150, y: y - 150, width: width + 300, height: height + 300 },
				{ padding: 0.25, duration: 0 }
			)
			.then((fitted) => {
				if (fitted) focusedRequestRef.current = request.nonce;
				else cx.notify('The canvas view is not ready. Try again.');
			})
			.catch((error) =>
				cx.notify(error instanceof Error ? error.message : 'Unable to focus the canvas.')
			);
	}, [props.focusRequest, project, cx, flow, flowReady, surfaceSize.width, surfaceSize.height]);
	const layout =
		project.layouts.find((entry) => entry.id === layoutId) ?? project.layouts[0] ?? null;
	const scene = React.useMemo(() => createCanvasDocumentScene(project), [project]);
	const cables = scene.cables;
	const onAnchorChange = React.useCallback(
		(partId: string, portId: string, point: TPoint) => cx.positionTerminal(partId, portId, point),
		[cx]
	);
	const onRouteChange = React.useCallback(
		(id: string, route: TPoint[]) => {
			cx.execute([{ type: 'run.update', id, patch: { route } }], 'Route wire');
		},
		[cx]
	);
	const sceneView = React.useMemo(
		() =>
			new CanvasSceneView(
				scene,
				layout?.id ?? '',
				onAnchorChange,
				onRouteChange,
				props.resolveAssetUrl
			),
		[scene, layout?.id, onAnchorChange, onRouteChange, props.resolveAssetUrl]
	);
	const { nodes, edges } = React.useMemo(
		() =>
			sceneView.frame(
				selection,
				draftPositions,
				editPorts,
				measurements.projectId === project.id ? measurements.byId : undefined
			),
		[sceneView, selection, draftPositions, editPorts, measurements, project.id]
	);
	const layoutScene = scene.layouts.get(layout?.id ?? '');
	const placements = React.useMemo(
		() => Array.from(layoutScene?.records.values() ?? []).map((r) => r.placement),
		[layoutScene]
	);
	const workingX = layoutScene?.bounds.x ?? 0,
		workingY = layoutScene?.bounds.y ?? 0,
		workingWidth = layoutScene?.bounds.width ?? 1200,
		workingHeight = layoutScene?.bounds.height ?? 800;
	React.useEffect(() => {
		if (
			!flowReady ||
			surfaceSize.width <= 22 ||
			surfaceSize.height <= 22 ||
			!layout ||
			userNavigatedRef.current.has(`${project.id}:${layout.id}`) ||
			fittedLayoutRef.current === `${project.id}:${layout.id}`
		)
			return;
		const key = `${project.id}:${layout.id}`;
		const target = getViewportForBounds(
			{ x: workingX, y: workingY, width: workingWidth, height: workingHeight },
			surfaceSize.width - 22,
			surfaceSize.height - 22,
			0.08,
			4,
			0.14
		);
		fittedLayoutRef.current = key;
		void flow
			.setViewport(target, { duration: 0 })
			.then((fitted) => {
				if (!fitted) {
					if (fittedLayoutRef.current === key) fittedLayoutRef.current = null;
					cx.notify('The canvas view is not ready. Try again.');
				}
			})
			.catch((error) => {
				if (fittedLayoutRef.current === key) fittedLayoutRef.current = null;
				cx.notify(error instanceof Error ? error.message : 'Unable to fit the canvas.');
			});
	}, [
		layout,
		project.id,
		flow,
		workingX,
		workingY,
		workingWidth,
		workingHeight,
		surfaceSize.width,
		surfaceSize.height,
		flowReady,
		cx
	]);
	React.useEffect(() => {
		if (!focus || !flowReady) return;
		const node = nodes.find((n) => n.id === focus && n.type === 'device');
		const run = project.runs.find((r) => r.id === focus);
		let operation: Promise<boolean> | null = null;
		if (node)
			operation = flow.setCenter(
				node.position.x + Number(node.style?.width ?? 100) / 2,
				node.position.y + Number(node.style?.height ?? 100) / 2,
				{ zoom: Math.max(0.8, cx.$viewport.get().zoom), duration: 0 }
			);
		else if (run?.route.length) {
			const x = Math.min(...run.route.map((p) => p.x)),
				y = Math.min(...run.route.map((p) => p.y));
			operation = flow.fitBounds(
				{
					x: x - 100,
					y: y - 100,
					width: Math.max(200, Math.max(...run.route.map((p) => p.x)) - x + 200),
					height: Math.max(200, Math.max(...run.route.map((p) => p.y)) - y + 200)
				},
				{ padding: 0.12, duration: 0 }
			);
		}
		if (operation)
			void operation
				.then((fitted) => {
					if (!fitted) cx.notify('The canvas view is not ready. Try again.');
				})
				.catch((error) =>
					cx.notify(error instanceof Error ? error.message : 'Unable to focus the canvas.')
				);
		cx.$focus.set(null);
	}, [focus, project.runs, cx, flow, nodes, flowReady]);
	const shortcutActionsRef = React.useRef({ fit: () => {}, actualSize: () => {} });
	React.useLayoutEffect(() => {
		shortcutActionsRef.current = {
			fit: fitWorking,
			actualSize: () => camera(flow.zoomTo(1, { duration: 0 }))
		};
	});
	React.useEffect(() => {
		if (props.active === false) {
			cx.$pickerOpen.set(false);
			return;
		}
		let nudge: { id: string; revision: number; x: number; y: number } | null = null;
		function finishNudge(): void {
			if (!nudge) return;
			const pending = nudge;
			nudge = null;
			if (cx.project.revision === pending.revision)
				cx.execute(
					[
						{
							type: 'placement.update',
							id: pending.id,
							patch: { xMm: pending.x, yMm: pending.y }
						}
					],
					'Nudge equipment'
				);
			else cx.notify('The plan changed during this move. Please move the part again.');
			setDraftPositions({});
		}
		function keydown(event: KeyboardEvent): void {
			if (
				event.defaultPrevented ||
				!(event.target instanceof Element) ||
				event.target.closest(
					'input,textarea,select,[contenteditable=true],dialog,[role=dialog],[aria-modal=true],[role=tooltip],[role=menu],.question-hint,.canvas-cable-menu,.canvas-view-menu'
				)
			)
				return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.shiftKey && event.code === 'Digit1') {
				event.preventDefault();
				shortcutActionsRef.current.fit();
				return;
			}
			if (event.shiftKey && event.code === 'Digit0') {
				event.preventDefault();
				shortcutActionsRef.current.actualSize();
				return;
			}
			if (event.shiftKey && event.code === 'Digit2') {
				const current = cx.$selection.get();
				if (current) {
					event.preventDefault();
					cx.$focus.set(current.id);
				}
				return;
			}
			const delta = (
				{ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<
					string,
					number[]
				>
			)[event.key];
			if (delta) {
				const selected = cx.$selection.get();
				const placement =
					selected?.kind === 'placement'
						? cx.project.placements.find((p) => p.id === selected.id)
						: null;
				if (!placement) return;
				event.preventDefault();
				event.stopPropagation();
				if (nudge?.id !== placement.id) {
					finishNudge();
					nudge = {
						id: placement.id,
						revision: cx.project.revision,
						x: placement.xMm,
						y: placement.yMm
					};
				}
				if (!nudge) return;
				const step = event.shiftKey ? 10 : 1;
				nudge.x = Math.max(0, nudge.x + (delta[0] ?? 0) * step);
				nudge.y = Math.max(0, nudge.y + (delta[1] ?? 0) * step);
				setDraftPositions({ [nudge.id]: { x: nudge.x, y: nudge.y } });
				return;
			}
			if (event.key === 'Escape') {
				cx.$pickerOpen.set(false);
				cx.$selection.set(null);
				cx.$tool.set('pointer');
				cx.$editPorts.set(false);
				setCableMenu(false);
				setViewMenu(false);
			}
			if (event.key.toLowerCase() === 'w') cx.$tool.set('wire');
			if (event.key.toLowerCase() === 'v') cx.$tool.set('pointer');
			if (event.key.toLowerCase() === 'r') cx.rotate();
			if (event.key.toLowerCase() === 'h') cx.$tool.set('pan');
			if (event.key === 'Delete' || event.key === 'Backspace') {
				event.preventDefault();
				cx.removeSelection();
			}
			if (event.code === 'Space') {
				event.preventDefault();
				setPanMode(true);
			}
		}
		function keyup(event: KeyboardEvent): void {
			if (event.key.startsWith('Arrow')) finishNudge();
			if (event.code === 'Space') setPanMode(false);
		}
		function blur(): void {
			finishNudge();
			setPanMode(false);
		}
		function surfaceKeydown(event: KeyboardEvent): void {
			if (event.key.startsWith('Arrow')) keydown(event);
		}
		const surface = surfaceRef.current;
		surface?.addEventListener('keydown', surfaceKeydown);
		window.addEventListener('keydown', keydown);
		window.addEventListener('keyup', keyup);
		window.addEventListener('blur', blur);
		return () => {
			surface?.removeEventListener('keydown', surfaceKeydown);
			window.removeEventListener('keydown', keydown);
			window.removeEventListener('keyup', keyup);
			window.removeEventListener('blur', blur);
			blur();
		};
	}, [cx, props.active]);
	React.useEffect(() => {
		function outside(event: PointerEvent): void {
			if (
				event.target instanceof Element &&
				!event.target.closest('.canvas-floating-tools,.canvas-view-controls')
			) {
				setCableMenu(false);
				setViewMenu(false);
			}
		}
		document.addEventListener('pointerdown', outside);
		return () => document.removeEventListener('pointerdown', outside);
	}, []);
	const position = React.useCallback((): TPoint => {
		const bounds = surfaceRef.current?.getBoundingClientRect();
		if (!bounds) return { x: 100, y: 100 };
		return snapPoint(
			flow.screenToFlowPosition({
				x: bounds.left + bounds.width * 0.43,
				y: bounds.top + bounds.height * 0.37
			})
		);
	}, [flow]);
	const connect = React.useCallback(
		(connection: Connection): void => {
			const source = cx.project.placements.find((p) => p.id === connection.source);
			const target = cx.project.placements.find((p) => p.id === connection.target);
			if (source && target && connection.sourceHandle && connection.targetHandle)
				cx.connect(
					{ instanceId: source.instanceId, portId: connection.sourceHandle },
					{ instanceId: target.instanceId, portId: connection.targetHandle }
				);
		},
		[cx]
	);
	const changeNodes = React.useCallback(
		(changes: NodeChange<TCanvasNode>[]): void => {
			const measured = changes.filter((c) => c.type === 'dimensions' && c.dimensions != null);
			if (measured.length)
				setMeasurements((current) => {
					const byId = current.projectId === project.id ? { ...current.byId } : {};
					let changed = current.projectId !== project.id;
					for (const change of measured)
						if (change.type === 'dimensions' && change.dimensions) {
							const previous = byId[change.id];
							if (
								previous?.width !== change.dimensions.width ||
								previous?.height !== change.dimensions.height
							) {
								byId[change.id] = {
									width: change.dimensions.width,
									height: change.dimensions.height
								};
								changed = true;
							}
						}
					return changed ? { projectId: project.id, byId } : current;
				});
			const positions = changes.filter(
				(change) => change.type === 'position' && change.position != null
			);
			if (positions.length)
				setDraftPositions((current) => {
					const next = { ...current };
					for (const change of positions)
						if (change.type === 'position' && change.position) next[change.id] = change.position;
					return next;
				});
		},
		[project.id]
	);
	const finishDrag = React.useCallback(
		(moved: TCanvasNode[]): void => {
			if (
				draggingRevisionRef.current != null &&
				draggingRevisionRef.current !== cx.project.revision
			) {
				setDraftPositions({});
				cx.notify('The plan changed during this move. Please move the part again.');
				return;
			}
			const commands: TCommand[] = moved
				.filter((node) => node.type === 'device')
				.map((node) => ({
					type: 'placement.update',
					id: node.id,
					patch: { xMm: Math.max(0, node.position.x), yMm: Math.max(0, node.position.y) }
				}));
			if (commands.length) cx.execute(commands, 'Move equipment');
			setDraftPositions({});
			draggingRevisionRef.current = null;
		},
		[cx]
	);
	const onInit = React.useCallback((instance: ReactFlowInstance<TCanvasNode, TRunEdge>) => {
		setInitializedFlow(instance);
		setFlowReady(true);
	}, []);
	const onMoveStart = React.useCallback(
		(event: unknown) => {
			if (event && cx.layout) userNavigatedRef.current.add(`${cx.project.id}:${cx.layout.id}`);
		},
		[cx]
	);
	const onNodeClick = React.useCallback(
		(event: React.MouseEvent, node: TCanvasNode) => {
			if ((event.target as Element).closest('.physical-terminal')) return;
			if (node.type === 'device') {
				cx.$editPorts.set(false);
				cx.$selection.set({ kind: 'placement', id: node.id });
				setBoardSettings(false);
			}
		},
		[cx]
	);
	const onNodeDoubleClick = React.useCallback(
		(_: React.MouseEvent, node: TCanvasNode) => {
			if (node.type === 'device') cx.openPart(node.data.part.id);
		},
		[cx]
	);
	const onEdgeClick = React.useCallback(
		(_: React.MouseEvent, edge: TRunEdge) => {
			cx.$selection.set({ kind: 'run', id: edge.id });
			setBoardSettings(false);
		},
		[cx]
	);
	const onPaneClick = React.useCallback(() => cx.$selection.set(null), [cx]);
	const onNodeDragStart = React.useCallback(() => {
		draggingRevisionRef.current = cx.project.revision;
	}, [cx]);
	const onNodeDragStop = React.useCallback(
		(_: unknown, node: TCanvasNode, moved: TCanvasNode[]) =>
			finishDrag(moved.length ? moved : [node]),
		[finishDrag]
	);

	function camera(operation: Promise<boolean>): void {
		void operation
			.then((accepted) => {
				if (!accepted) cx.notify('The canvas view is not ready. Try again.');
			})
			.catch((error) =>
				cx.notify(error instanceof Error ? error.message : 'Unable to update the canvas view.')
			);
	}
	function fitWorking(): void {
		const target = getViewportForBounds(
			{ x: workingX, y: workingY, width: workingWidth, height: workingHeight },
			surfaceSize.width - 22,
			surfaceSize.height - 22,
			0.08,
			4,
			0.14
		);
		camera(flow.setViewport(target, { duration: 0 }));
	}
	function fitOverview(): void {
		if (layout)
			camera(
				flow.fitBounds(
					{ x: 0, y: 0, width: layout.widthMm, height: layout.heightMm },
					{ padding: 0.12, duration: 0 }
				)
			);
	}
	function dropAsset(event: React.DragEvent): void {
		event.preventDefault();
		try {
			const value = JSON.parse(event.dataTransfer.getData('application/x-yadori-asset')) as {
				kind: string;
				id: string;
			};
			const point = snapPoint(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
			if (value.kind === 'part') {
				const part = project.parts.find((p) => p.id === value.id);
				if (part) {
					const unitIds = new Set(
						project.instances.filter((i) => i.partId === part.id).map((i) => i.id)
					);
					const placed = project.placements.filter((p) => unitIds.has(p.instanceId)).length;
					cx.place(part, point, placed >= part.quantity);
				}
			} else {
				const item = libraryItems.find((i) => i.id === value.id);
				if (item) cx.addPreset(item, point);
			}
		} catch {
			/* Ignore unrelated desktop drags. */
		}
	}
	return (
		<CanvasOverviewContext value={overview}>
			<div
				className={
					'canvas-workspace figma-canvas-workspace ' +
					(sidebarOpen ? 'sidebar-open' : 'sidebar-closed')
				}
			>
				<CanvasSidebar
					cx={cx}
					project={project}
					position={position}
					assistantBusy={props.assistantBusy}
					assistantProposalCount={props.assistantProposalCount}
				/>
				<main className="canvas-editor">
					<div
						className={
							'physical-canvas ' +
							(tool === 'wire' ? 'wire-mode ' : '') +
							(panMode || tool === 'pan' ? 'pan-mode' : '')
						}
						ref={surfaceRef}
						style={{ '--canvas-zoom': initialViewport.zoom } as React.CSSProperties}
						onDragOver={(e) => {
							e.preventDefault();
							e.dataTransfer.dropEffect = 'copy';
						}}
						onDrop={dropAsset}
					>
						<ReactFlow<TCanvasNode, TRunEdge>
							nodes={nodes}
							edges={edges}
							nodeTypes={nodeTypes}
							edgeTypes={edgeTypes}
							defaultViewport={initialViewport}
							onInit={onInit}
							onMoveStart={onMoveStart}
							onNodesChange={changeNodes}
							onConnect={connect}
							connectionMode={ConnectionMode.Loose}
							connectionRadius={24}
							connectionLineStyle={CONNECTION_STYLE}
							onNodeClick={onNodeClick}
							onNodeDoubleClick={onNodeDoubleClick}
							onEdgeClick={onEdgeClick}
							onPaneClick={onPaneClick}
							onNodeDragStart={onNodeDragStart}
							onNodeDragStop={onNodeDragStop}
							onMove={onViewportMove}
							onMoveEnd={onViewportMove}
							minZoom={0.08}
							maxZoom={4}
							snapToGrid={snap}
							snapGrid={SNAP_GRID}
							panOnScroll
							zoomOnScroll={false}
							zoomOnPinch
							panOnDrag={panMode || tool === 'pan' ? true : [1, 2]}
							selectionOnDrag={!panMode && tool !== 'pan'}
							nodesDraggable={!panMode && tool !== 'pan'}
							nodesConnectable={!panMode && tool !== 'pan'}
							multiSelectionKeyCode="Shift"
							deleteKeyCode={null}
							proOptions={{ hideAttribution: false }}
						>
							<Background variant={BackgroundVariant.Dots} gap={50} size={1} color="#c8c8c8" />
						</ReactFlow>
						<CanvasRulers width={surfaceSize.width - 22} height={surfaceSize.height - 22} />
						{!placements.length && (
							<div className="canvas-empty-state">
								<strong>Place your first part</strong>
								<span>Drag from Parts or Library onto the canvas.</span>
							</div>
						)}
						{notice && (
							<div className="canvas-toast" role="status">
								{notice}
							</div>
						)}
					</div>
					<div className="canvas-floating-tools" role="toolbar" aria-label="Canvas tools">
						<button
							className={'canvas-tool ' + (tool === 'pointer' ? 'active' : '')}
							aria-label="Select tool"
							aria-pressed={tool === 'pointer'}
							title="Move · V"
							onClick={() => cx.$tool.set('pointer')}
						>
							<MousePointer2 size={19} />
						</button>
						<button
							className={'canvas-tool ' + (tool === 'pan' ? 'active' : '')}
							aria-label="Pan tool"
							aria-pressed={tool === 'pan'}
							title="Hand · H"
							onClick={() => cx.$tool.set('pan')}
						>
							<Hand size={19} />
						</button>
						<span className="canvas-tool-divider" />
						<div className="canvas-tool-dropdown">
							<button
								className={'canvas-tool ' + (tool === 'wire' ? 'active' : '')}
								aria-label="Wire tool"
								aria-pressed={tool === 'wire'}
								title={`${activeCable?.name ?? 'Unspecified cable'} · connect two terminals · W`}
								onClick={() => cx.$tool.set('wire')}
							>
								<Cable size={19} />
								{tool === 'wire' && (
									<span className="canvas-current-cable">
										{activeSection != null
											? `${activeSection} mm²`
											: (activeCable?.name ?? 'Unspecified')}
									</span>
								)}
							</button>
							<button
								className="canvas-tool-chevron"
								aria-label="Choose cable"
								aria-expanded={cableMenu}
								onClick={() => setCableMenu((v) => !v)}
							>
								<ChevronDown size={12} />
							</button>
							{cableMenu && (
								<div className="canvas-cable-menu">
									<div className="canvas-menu-label">Cable profile</div>
									<button
										onClick={() => {
											cx.$materialId.set(null);
											cx.$tool.set('wire');
											setCableMenu(false);
										}}
									>
										Unspecified cable{!materialId && <Check size={13} />}
									</button>
									{cables.map((p) => (
										<button
											key={p.id}
											onClick={() => {
												cx.armCable(p.id);
												setCableMenu(false);
											}}
										>
											{p.name}
											{materialId === p.id && <Check size={13} />}
										</button>
									))}
									<button
										onClick={() => {
											cx.$sidebarTab.set('assets');
											cx.$assetSource.set('library');
											cx.$assetQuery.set('cable');
											cx.$sidebarOpen.set(true);
											setCableMenu(false);
										}}
									>
										Browse cable library…
									</button>
									<label>
										<input
											type="checkbox"
											checked={series}
											onChange={(e) => cx.$series.set(e.target.checked)}
										/>{' '}
										Intentional series link
									</label>
								</div>
							)}
						</div>
						<span className="canvas-tool-divider" />
						<button
							className={
								'canvas-tool ' + (sidebarOpen && sidebarTab === 'assets' ? 'insert-active' : '')
							}
							aria-label="Insert asset"
							title="Insert from assets"
							onClick={() => {
								if (sidebarOpen && sidebarTab === 'assets') cx.$sidebarOpen.set(false);
								else {
									cx.$sidebarTab.set('assets');
									cx.$sidebarOpen.set(true);
								}
							}}
						>
							<Plus size={20} />
						</button>
					</div>
					<div className="canvas-view-controls">
						<button
							aria-label="Toggle navigation panel"
							title="Toggle left panel"
							onClick={() => cx.$sidebarOpen.set(!sidebarOpen)}
						>
							<PanelLeft size={15} />
						</button>
						<div className="canvas-view-menu-wrap">
							<button
								className="canvas-view-percent"
								aria-label="Canvas view options"
								aria-expanded={viewMenu}
								onClick={() => setViewMenu((v) => !v)}
							>
								<CanvasZoomReadout cx={cx} />
								<ChevronDown size={12} />
							</button>
							{viewMenu && (
								<div className="canvas-view-menu">
									<button
										onClick={() => {
											camera(flow.zoomTo(1, { duration: 0 }));
											setViewMenu(false);
										}}
									>
										100% <span>1 px / mm</span>
									</button>
									<button
										onClick={() => {
											fitWorking();
											setViewMenu(false);
										}}
									>
										Zoom to fit parts
									</button>
									<button
										onClick={() => {
											fitOverview();
											setViewMenu(false);
										}}
									>
										Zoom to frame
									</button>
									<div />
									<button onClick={() => setSnap((v) => !v)}>
										Snap to 10 mm{snap && <Check size={13} />}
									</button>
									<button onClick={() => camera(flow.zoomIn({ duration: 0 }))}>
										Zoom in
										<ZoomIn size={13} />
									</button>
									<button onClick={() => camera(flow.zoomOut({ duration: 0 }))}>
										Zoom out
										<ZoomOut size={13} />
									</button>
								</div>
							)}
						</div>
					</div>
				</main>
				<aside className="canvas-design" aria-label="Design inspector">
					<div className="canvas-design-tabs">
						<strong>Design</strong>
					</div>
					{selection && !boardSettings ? (
						<CanvasInspector key={selection.kind + selection.id} cx={cx} project={project} />
					) : (
						<BoardSettings
							key={layout?.id}
							layout={layout}
							onSave={(value) => {
								if (layout)
									cx.execute(
										[{ type: 'layout.update', id: layout.id, patch: value }],
										'Resize mounting surface'
									);
								else
									cx.execute(
										[
											{
												type: 'layout.add',
												layout: { id: crypto.randomUUID(), kind: 'board', notes: '', ...value }
											}
										],
										'Add mounting surface'
									);
								setBoardSettings(false);
							}}
							onAdd={() => {
								const next = createNewLayout();
								cx.execute([{ type: 'layout.add', layout: next }], 'Add mounting surface');
								cx.$layoutId.set(next.id);
							}}
						/>
					)}
				</aside>
			</div>
		</CanvasOverviewContext>
	);
};
const BoardNode: React.FC<NodeProps<TBoardNode>> = ({ data }) => (
	<div className="mounting-surface">
		<span>
			{data.layout.name}
			<small>
				{data.layout.widthMm} × {data.layout.heightMm} mm
			</small>
		</span>
	</div>
);
const nodeTypes = { device: DeviceNode, board: BoardNode };
const edgeTypes = { wire: RunEdge };
function createNewLayout(): TLayout {
	return {
		id: crypto.randomUUID(),
		name: 'Mounting surface',
		widthMm: 1200,
		heightMm: 800,
		kind: 'board',
		notes: ''
	};
}
const BoardSettings: React.FC<{
	layout: TLayout | null;
	onSave: (layout: Pick<TLayout, 'name' | 'widthMm' | 'heightMm'>) => void;
	onAdd: () => void;
}> = ({ layout, onSave, onAdd }) => {
	function commit(form: HTMLFormElement): void {
		const data = new FormData(form),
			name = String(data.get('name') ?? '').trim(),
			widthMm = Number(data.get('width')),
			heightMm = Number(data.get('height'));
		if (
			name &&
			widthMm > 0 &&
			heightMm > 0 &&
			(name !== layout?.name || widthMm !== layout?.widthMm || heightMm !== layout?.heightMm)
		)
			onSave({ name, widthMm, heightMm });
	}
	return (
		<form
			className="canvas-board-settings figma-frame-settings"
			onSubmit={(e) => {
				e.preventDefault();
				commit(e.currentTarget);
			}}
			onBlur={(e) => {
				if (e.target instanceof HTMLInputElement) commit(e.currentTarget);
			}}
		>
			<div className="canvas-frame-heading">
				<strong>Frame</strong>
				<span>
					{layout?.notes && (
						<QuestionHint label="About this layout" content={<p>{layout.notes}</p>} />
					)}
					<button
						type="button"
						className="canvas-icon"
						aria-label="Add frame"
						title="Add frame"
						onClick={onAdd}
					>
						<Plus size={13} />
					</button>
				</span>
			</div>
			<label className="canvas-field">
				<span>Name</span>
				<input
					key={layout?.name}
					name="name"
					aria-label="Frame name"
					required
					defaultValue={layout?.name ?? 'Electrical board'}
				/>
			</label>
			<div className="canvas-field-grid">
				<label className="canvas-field">
					<span>
						W <small>mm</small>
					</span>
					<input
						key={layout?.widthMm}
						name="width"
						aria-label="Frame width mm"
						type="number"
						min="10"
						required
						defaultValue={layout?.widthMm ?? 2000}
					/>
				</label>
				<label className="canvas-field">
					<span>
						H <small>mm</small>
					</span>
					<input
						key={layout?.heightMm}
						name="height"
						aria-label="Frame height mm"
						type="number"
						min="10"
						required
						defaultValue={layout?.heightMm ?? 1200}
					/>
				</label>
			</div>
		</form>
	);
};

const SNAP_GRID: [number, number] = [10, 10];
const CONNECTION_STYLE = { stroke: '#707070', strokeWidth: 2 };
