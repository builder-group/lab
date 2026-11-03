import { useFeatureState } from 'feature-react/state';
import { Clapperboard, Plus, Trash2, Type } from 'lucide-react';
import React from 'react';
import { InfoRow, InspectorHeader, Panel, ScrubField, Select } from '@/components';
import type { TAgentTarget } from '@/modules/agents';
import { PieceIcon } from '@/modules/compose/piece-icons';
import type { TLibraryItem } from '@/modules/library';
import type { TDesign, TEntity, TProject } from '@/modules/project';
import { getPieceDefinition } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';
import { AgentPanel } from './AgentPanel';
import {
	cameraCommands,
	clearSkinCommands,
	itemFitsPieceType,
	reactionChoiceOf,
	reactionChoices,
	reactionCommands,
	themeCommands,
	themePresets,
	type TReactionChoice
} from './design-commands';
import type { TDesignLink } from './DesignCx';
import { libraryItemLabel } from './DesignLibraryCx';
import { LIBRARY_DRAG_TYPE } from './DesignLibrary';
import { renderPresetLabel, renderPresets } from './export-estimate';
import { PreflightIcon, useExportPreflight } from './ExportPreflight';
import { describeLoop } from './loop-status';

/** Properties of the Design workspace in Blender-style panels: the scene, a piece's look or wall text */
export const DesignInspector: React.FC<TDesignInspectorProps> = (props) => {
	const { cx, project, selection } = props;
	const entities = project.entities.filter((entity) => selection.includes(entity.id));
	const pieces = entities.filter((entity) => entity.components.piece != null);
	const text = entities.find((entity) => entity.components.wallText != null);

	if (pieces.length > 0) return <PieceLook cx={cx} project={project} pieces={pieces} />;
	if (text != null) return <WallTextInspector cx={cx} entity={text} />;
	return <SceneInspector cx={cx} project={project} />;
};

interface TDesignInspectorProps {
	cx: StudioCx;
	project: TProject;
	selection: string[];
}

// MARK: - Scene

const SceneInspector: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const design = project.design;
	const theme = themePresets.find((item) => item.id === design.theme);
	const sceneTarget = React.useMemo<TAgentTarget>(() => ({ kind: 'scene' }), []);

	return (
		<>
			<InspectorHeader
				icon={<Clapperboard size={15} strokeWidth={1.7} />}
				title="Scene"
				subtitle={`${theme?.label ?? design.theme} · ${renderPresetLabel(design.renderPreset)}`}
			/>
			<Panel id="design.scene" title="Look">
				<div className="mm-field">
					<label htmlFor="design-theme">Theme</label>
					<Select
						id="design-theme"
						value={design.theme}
						options={[
							...themePresets.map((item) => ({ value: item.id, label: item.label })),
							...(theme == null ? [{ value: design.theme, label: design.theme }] : [])
						]}
						onChange={(value) => cx.execute(themeCommands(project, value))}
					/>
				</div>
				<div className="mm-field">
					<label htmlFor="design-preset">Render</label>
					<Select
						id="design-preset"
						value={design.renderPreset}
						options={renderPresets.map((preset) => ({ value: preset.id, label: `${preset.label} · ${preset.shortSide}p ${preset.fps}` }))}
						onChange={(value) => cx.execute([{ type: 'setDesign', design: { renderPreset: value as TDesign['renderPreset'] } }])}
					/>
				</div>
				<div className="mm-field">
					<span className="mm-field-label">Loop</span>
					<label className="flex items-center gap-1.5">
						<input
							type="checkbox"
							className="mm-checkbox"
							checked={design.loop}
							onChange={(event) => cx.execute([{ type: 'setDesign', design: { loop: event.target.checked } }])}
						/>
						<span>Seamless loop</span>
					</label>
				</div>
				{design.loop ? <LoopStatus cx={cx} project={project} /> : null}
			</Panel>
			<CameraPanel cx={cx} project={project} />
			<WallTextPanel cx={cx} project={project} />
			<AgentPanel cx={cx} target={sceneTarget} targetLabel="the scene" placeholder="Describe the scene, such as warm evening light…" />
			<Panel id="design.output" title="Output">
				<p className="mm-caption">Renders the film in Blender in the background with the soundtrack.</p>
				<OutputPreflight cx={cx} />
				<button className="mm-button self-start" onClick={() => cx.film.openSheet()} title="Export Film (⌘E)" type="button">
					Export Film…
				</button>
			</Panel>
		</>
	);
};

/** The export preflight's summary line; the export sheet lists the issues */
const OutputPreflight: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const preflight = useExportPreflight(cx);
	if (preflight == null) return null;
	return (
		<div className="flex items-center gap-1.5" aria-label="Preflight">
			<PreflightIcon preflight={preflight} />
			<span className="min-w-0 truncate">{preflight.summary}</span>
		</div>
	);
};

/** Loop range and the loop check of the current simulation, with a fix for a length off the bar grid */
const LoopStatus: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const result = useFeatureState(cx.simulation.$result);
	const status = React.useMemo(
		() => (result != null && result.revision === project.revision ? describeLoop(project, result) : null),
		[project, result]
	);
	if (status == null) return <p className="mm-caption">Checking the loop…</p>;
	const { snappedEnd } = status;
	return (
		<>
			<p className="mm-caption">{status.summary}</p>
			{status.details.map((detail) => (
				<p key={detail} className="mm-caption">
					{detail}
				</p>
			))}
			{snappedEnd != null ? (
				<button className="mm-button self-start" onClick={() => cx.execute([{ type: 'setEnd', end: snappedEnd }])} type="button">
					Snap End to Bar
				</button>
			) : null}
		</>
	);
};

const CameraPanel: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const camera = project.design.camera;
	const cameraState = useFeatureState(cx.design.$camera);
	const status = useFeatureState(cx.design.$status);
	const [isConfirming, setIsConfirming] = React.useState(false);

	function set(patch: Partial<TDesign['camera']>): void {
		cx.execute(cameraCommands(project, patch));
	}

	return (
		<Panel id="design.camera" title="Camera">
			<div className="mm-field">
				<span className="mm-field-label">Mode</span>
				<div className="mm-segmented !w-full" role="radiogroup" aria-label="Camera mode">
					{(['rig', 'manual'] as const).map((mode) => (
						<button key={mode} className="flex-1" role="radio" aria-checked={camera.mode === mode} data-active={camera.mode === mode} onClick={() => set({ mode })} type="button">
							{mode === 'rig' ? 'Rig' : 'Manual'}
						</button>
					))}
				</div>
			</div>
			{camera.mode === 'rig' ? (
				<>
					<ScrubField id="camera-distance" label="Distance" value={camera.distance * 100} unit="cm" step={0.5} precision={1} min={5} max={500} onCommit={(value) => set({ distance: value / 100 })} />
					<ScrubField id="camera-pitch" label="Pitch" value={(camera.pitch * 180) / Math.PI} unit="°" step={0.5} min={-80} max={80} onCommit={(value) => set({ pitch: (value * Math.PI) / 180 })} />
					<ScrubField id="camera-lead" label="Lead" value={camera.lead} unit="s" step={0.01} precision={2} min={0} max={3} onCommit={(value) => set({ lead: value })} />
					<ScrubField id="camera-smoothing" label="Smoothing" value={Math.round(camera.smoothing * 100)} unit="%" step={0.5} min={0} max={100} onCommit={(value) => set({ smoothing: value / 100 })} />
					{cameraState === 'takenOver' ? (
						<div className="mm-setup-card">
							<div className="font-semibold">Camera Edited in Blender</div>
							<p className="mm-caption">The app stopped updating the camera so your Blender changes stay. Regenerating discards them.</p>
							{isConfirming ? (
								<div className="flex gap-1.5">
									<button className="mm-button flex-1" onClick={() => setIsConfirming(false)} type="button">
										Keep
									</button>
									<button
										className="mm-button flex-1"
										data-variant="primary"
										onClick={() => {
											setIsConfirming(false);
											void cx.design.regenerateCamera();
										}}
										type="button"
									>
										Regenerate
									</button>
								</div>
							) : (
								<button className="mm-button self-start" onClick={() => setIsConfirming(true)} type="button">
									Regenerate Camera…
								</button>
							)}
						</div>
					) : (
						<>
							<p className="mm-caption">The app bakes a follow camera from the run. Take it over to animate the camera yourself in Blender.</p>
							<button className="mm-button self-start" onClick={() => set({ mode: 'manual' })} type="button">
								Take Over Camera
							</button>
						</>
					)}
				</>
			) : (
				<>
					<p className="mm-caption">Blender owns the camera. Move and animate it in Blender; the app leaves it alone. Switch back to Rig to let the app follow the marble again.</p>
					<button className="mm-button self-start" disabled={status === 'unavailable' || status === 'missing'} onClick={() => void cx.design.openInBlender()} type="button">
						Edit in Blender
					</button>
				</>
			)}
		</Panel>
	);
};

const WallTextPanel: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const placing = useFeatureState(cx.design.$placing);
	const texts = project.entities.filter((entity) => entity.components.wallText != null);

	function add(): void {
		if (cx.design.$preview.get() != null) cx.design.$placing.set(placing === 'text' ? null : 'text');
		else cx.placeWallText();
	}

	return (
		<Panel
			id="design.text"
			title="Wall Text"
			accessory={
				<button className="mm-icon-button !h-5 !w-5" data-active={placing === 'text'} onClick={add} title="Add Text" aria-label="Add Text" type="button">
					<Plus size={13} strokeWidth={2} />
				</button>
			}
		>
			{placing === 'text' ? <p className="mm-caption !text-[var(--text)]">Click the preview where the text should go. Escape cancels.</p> : null}
			{texts.length > 0 ? (
				<div className="flex flex-col" role="list">
					{texts.map((entity) => (
						<button key={entity.id} role="listitem" className="mm-row !px-1.5" onClick={() => cx.$selection.set([entity.id])} type="button">
							<Type size={13} strokeWidth={1.8} className="shrink-0 opacity-60" />
							<span className="min-w-0 flex-1 truncate text-left">{entity.components.wallText?.text}</span>
						</button>
					))}
				</div>
			) : placing !== 'text' ? (
				<p className="mm-caption">Add a title or credit on the wall. It becomes a native Blender text object.</p>
			) : null}
			{placing !== 'text' ? (
				<button className="mm-button self-start" onClick={add} type="button">
					Add Text
				</button>
			) : null}
		</Panel>
	);
};

// MARK: - Wall text

const WallTextInspector: React.FC<{ cx: StudioCx; entity: TEntity }> = (props) => {
	const { cx, entity } = props;
	const text = entity.components.wallText;
	const transform = entity.components.transform;
	if (text == null) return null;

	function setText(patch: Partial<NonNullable<TEntity['components']['wallText']>>): void {
		if (text == null) return;
		const value = { ...text, ...patch };
		// The entity name follows the text so lists and the outliner read the same
		cx.execute([{ type: 'upsertEntity', entity: { ...entity, name: value.text, components: { ...entity.components, wallText: value } } }]);
	}

	function setPosition(axis: 'x' | 'y', value: number): void {
		const current = transform ?? { position: { x: 0, y: 0 }, angle: 0 };
		cx.execute([{ type: 'setComponent', entityId: entity.id, component: { name: 'transform', value: { ...current, position: { ...current.position, [axis]: value } } } }]);
	}

	return (
		<>
			<InspectorHeader icon={<Type size={15} strokeWidth={1.7} />} title={text.text || 'Wall Text'} subtitle="Wall Text" />
			<Panel id="design.wallText" title="Text">
				<div className="mm-field">
					<label htmlFor="text-content">Text</label>
					<CommitText id="text-content" value={text.text} onCommit={(value) => setText({ text: value })} />
				</div>
				<ScrubField id="text-size" label="Size" value={text.size * 100} unit="cm" step={0.05} precision={1} min={0.2} max={50} onCommit={(value) => setText({ size: value / 100 })} />
				<ScrubField id="text-depth" label="Depth" value={text.depth * 1000} unit="mm" step={0.1} precision={1} min={0} max={50} onCommit={(value) => setText({ depth: value / 1000 })} />
				<div className="mm-field">
					<label htmlFor="text-color">Color</label>
					<span className="flex items-center gap-2">
						<input id="text-color" type="color" className="mm-color" value={text.color} onChange={(event) => setText({ color: event.target.value })} />
						<span className="mm-tabular text-[11px] text-[var(--text-secondary)] uppercase">{text.color}</span>
					</span>
				</div>
			</Panel>
			<Panel id="design.wallText.position" title="Position">
				<ScrubField id="text-x" label="X" value={(transform?.position.x ?? 0) * 100} unit="cm" step={0.1} precision={1} onCommit={(value) => setPosition('x', value / 100)} />
				<ScrubField id="text-y" label="Y" value={(transform?.position.y ?? 0) * 100} unit="cm" step={0.1} precision={1} onCommit={(value) => setPosition('y', value / 100)} />
				<button
					className="mm-button self-start"
					onClick={() => {
						if (cx.execute([{ type: 'removeEntities', entityIds: [entity.id] }])) cx.$selection.set([]);
					}}
					type="button"
				>
					<Trash2 size={12} strokeWidth={1.8} />
					Delete Text
				</button>
			</Panel>
		</>
	);
};

// MARK: - Piece look

const PieceLook: React.FC<{ cx: StudioCx; project: TProject; pieces: TEntity[] }> = (props) => {
	const { cx, project, pieces } = props;
	const projectItems = useFeatureState(cx.library.$projectItems);
	const globalItems = useFeatureState(cx.library.$globalItems);
	const links = useFeatureState(cx.design.$links);
	const status = useFeatureState(cx.design.$status);
	const [isDropping, setIsDropping] = React.useState(false);

	const first = pieces[0] as TEntity;
	const type = first.components.piece?.type ?? 'platform';
	const typeLabel = getPieceDefinition(type)?.label ?? type;
	const ids = pieces.map((entity) => entity.id);
	const isSingle = pieces.length === 1;
	const skinIds = [...new Set(pieces.map((entity) => entity.components.skin?.assetId ?? ''))];
	const skinValue = skinIds.length === 1 ? (skinIds[0] ?? '') : MIXED;
	const reactions = [...new Set(pieces.map(reactionChoiceOf))];
	const link = mergedLink(ids.map((id) => links[id]));
	const unlinked = ids.filter((id) => links[id]?.link === 'unlinked');
	const target = React.useMemo<TAgentTarget>(() => ({ kind: 'piece', entityId: first.id }), [first.id]);
	const fitting = [...projectItems, ...globalItems.filter((item) => !projectItems.some((own) => own.id === item.id))].filter((item) => itemFitsPieceType(item, type));
	const current = projectItems.find((item) => item.id === skinValue);
	const name = isSingle ? (first.name ?? typeLabel) : `${pieces.length} Pieces`;

	function setSkin(value: string): void {
		if (value === '') {
			cx.execute(clearSkinCommands(project, ids));
			return;
		}
		const item = fitting.find((candidate) => itemValue(candidate) === value);
		if (item != null) void cx.library.applySkin(item, { kind: 'entities', entityIds: ids });
	}

	function onDrop(event: React.DragEvent): void {
		setIsDropping(false);
		const data = event.dataTransfer.getData(LIBRARY_DRAG_TYPE);
		if (!data) return;
		event.preventDefault();
		const dropped = JSON.parse(data) as { id: string; scope: string };
		const item = [...projectItems, ...globalItems].find((candidate) => candidate.id === dropped.id && candidate.scope === dropped.scope);
		if (item != null) void cx.library.applySkin(item, { kind: 'entities', entityIds: ids });
	}

	return (
		<>
			<InspectorHeader
				icon={<PieceIcon type={type} size={15} />}
				title={name}
				subtitle={`${typeLabel}${status === 'unavailable' ? '' : ` · ${link == null ? 'Link unknown' : link === 'mixed' ? 'Mixed link' : link.link === 'linked' ? 'Linked' : 'Detached'}`}`}
			/>
			<Panel id="design.look" title="Look">
				<div
					className="mm-drop-well"
					data-dropping={isDropping}
					onDragOver={(event) => {
						if (!event.dataTransfer.types.includes(LIBRARY_DRAG_TYPE)) return;
						event.preventDefault();
						setIsDropping(true);
					}}
					onDragLeave={() => setIsDropping(false)}
					onDrop={onDrop}
				>
					<span className="mm-skin-thumb">
						{current?.previewUrl != null ? <img alt="" src={current.previewUrl} /> : <PieceIcon type={type} size={18} />}
					</span>
					<span className="flex min-w-0 flex-1 flex-col leading-tight">
						<span className="truncate">{skinValue === MIXED ? 'Mixed skins' : current != null ? libraryItemLabel(current) : skinValue === '' ? 'Theme default' : skinLabel(skinValue)}</span>
						<span className="truncate text-[11px] text-[var(--text-secondary)]">{isDropping ? 'Drop to apply' : 'Drag a skin from the library here'}</span>
					</span>
				</div>
				<div className="mm-field">
					<label htmlFor="piece-skin">Skin</label>
					<Select
						id="piece-skin"
						value={skinValue === MIXED ? MIXED : current != null ? itemValue(current) : skinValue}
						options={[
							...(skinValue === MIXED ? [{ value: MIXED, label: 'Mixed' }] : []),
							{ value: '', label: 'Theme Default' },
							...(skinValue !== '' && skinValue !== MIXED && current == null ? [{ value: skinValue, label: skinLabel(skinValue) }] : []),
							...fitting.map((item) => ({ value: itemValue(item), label: `${libraryItemLabel(item)}${item.scope === 'global' ? ' (My Library)' : ''}` }))
						]}
						onChange={setSkin}
					/>
				</div>
				<div className="mm-field">
					<label htmlFor="piece-reaction">Reaction</label>
					<Select
						id="piece-reaction"
						value={reactions.length === 1 ? (reactions[0] ?? 'theme') : MIXED}
						options={[...(reactions.length > 1 ? [{ value: MIXED, label: 'Mixed' }] : []), ...reactionChoices.map((choice) => ({ value: choice.value, label: choice.label }))]}
						onChange={(value) => {
							if (value !== MIXED) cx.execute(reactionCommands(project, ids, value as TReactionChoice));
						}}
					/>
				</div>
				<p className="mm-caption">Reactions animate the skin on every hit. They never change the physics.</p>
				{skinValue !== '' && skinValue !== MIXED ? (
					<button
						className="mm-button self-start"
						onClick={() => {
							const item = current ?? fitting.find((candidate) => candidate.id === skinValue);
							if (item != null) void cx.library.applySkin(item, { kind: 'pieceType', pieceType: type });
						}}
						type="button"
					>
						Apply to All {typeLabel}s
					</button>
				) : null}
			</Panel>
			<Panel id="design.link" title="Link">
				{status === 'unavailable' ? (
					<p className="mm-caption">Blender reports whether a piece was changed there. Open the project in the desktop app.</p>
				) : (
					<>
						<InfoRow label="State">
							<span className="mm-link-state" data-state={link == null ? 'unknown' : link === 'mixed' ? 'mixed' : link.link}>
								{link == null ? 'Unknown' : link === 'mixed' ? 'Mixed' : link.link === 'linked' ? 'Linked' : 'Detached'}
							</span>
						</InfoRow>
						<p className="mm-caption">
							{link == null
								? 'Blender reports the link state after the scene is updated.'
								: unlinked.length > 0
									? `Changed in Blender${link !== 'mixed' && link.reason != null ? ` (${reasonLabel(link.reason)})` : ''}, so the app no longer moves it. The marble still bounces off the Compose position.`
									: 'The app drives this piece. Changes in Compose appear in Blender.'}
						</p>
						{unlinked.length > 0 ? (
							<button className="mm-button self-start" onClick={() => void cx.design.relink(unlinked)} title="Discard the Blender changes and follow Compose again" type="button">
								Reset to Compose
							</button>
						) : null}
					</>
				)}
			</Panel>
			{isSingle ? <AgentPanel cx={cx} target={target} targetLabel={name} /> : null}
		</>
	);
};

const MIXED = '__mixed__';

function itemValue(item: TLibraryItem): string {
	return item.scope === 'project' ? item.id : `global:${item.id}`;
}

/** Built-in skins such as `brass:gold` read as `Brass Gold` */
function skinLabel(assetId: string): string {
	return assetId
		.split(/[:_-]/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

function mergedLink(links: (TDesignLink | undefined)[]): TDesignLink | 'mixed' | null {
	const known = links.filter((link): link is TDesignLink => link != null);
	if (!known.length) return null;
	const first = known[0] as TDesignLink;
	return known.every((link) => link.link === first.link) ? first : 'mixed';
}

function reasonLabel(reason: string): string {
	switch (reason) {
		case 'transform':
			return 'moved';
		case 'keyframes':
			return 'animation edited';
		case 'marked':
			return 'unlinked by hand';
		default:
			return reason;
	}
}

/** Text field that commits on Return or blur and reverts on Escape */
const CommitText: React.FC<{ id: string; value: string; onCommit: (value: string) => void }> = (props) => {
	const { id, value, onCommit } = props;
	const [draft, setDraft] = React.useState(value);
	const [source, setSource] = React.useState(value);
	if (source !== value) {
		setSource(value);
		setDraft(value);
	}
	return (
		<input
			id={id}
			className="mm-input"
			value={draft}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={() => {
				if (draft.trim().length > 0 && draft !== value) onCommit(draft);
				else setDraft(value);
			}}
			onKeyDown={(event) => {
				if (event.key === 'Enter') event.currentTarget.blur();
				if (event.key === 'Escape') {
					setDraft(value);
					requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
				}
			}}
		/>
	);
};
