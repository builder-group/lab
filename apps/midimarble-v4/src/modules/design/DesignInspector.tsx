import { useFeatureState } from 'feature-react/state';
import { Bookmark, RotateCcw, Type, Video } from 'lucide-react';
import React from 'react';
import { CheckField, HelpTip, InspectorHeader, LinkRow, Panel, ReadoutField, ScrubField, SelectField, StateRow, TextField } from '@/components';
import { shotLength } from '@/modules/camera/shots';
import { PieceIcon } from '@/modules/compose/piece-icons';
import type { TDesign, TEntity, TProject, TShot } from '@/modules/project';
import { getPieceDefinition } from '@/modules/simulation';
import type { StudioCx } from '@/modules/studio';
import { getCommand } from '@/modules/studio/commands';
import { formatTime } from '@/modules/studio/format';
import { parseTime } from '@/modules/studio/timeline/parse-time';
import {
	cameraCommands,
	builtInSkinCommands,
	commonPieceType,
	defaultTitleColor,
	frameHeightOnWall,
	isScreenTitle,
	pieceCountLabel,
	titleStyles,
	withTitleStyle,
	type TTitleStyle
} from './design-commands';
import type { TDesignLink } from './DesignCx';
import { canonicalSkinId } from '@/modules/project/skin-ids';
import { SKIN_HELP } from './concept-words';
import { themeOriginLabel } from './scene-layers';
import { skinElement } from './skin-catalog';
import { SkinPicker } from './SkinPickers';
import { ResetToTheme, SkinPropertyRows } from './SkinProperties';
import { framingFix, framingProblemAt, preflightExport } from './export-preflight';
import { describeLoop } from './loop-status';
import { shotKindLabel, shotKinds, updateShotCommands, type TShotKind } from './shots';
import { songDisplayName, titleSpan, withTitleTime } from './titles';

// Inspectors of the Film layers on the inspector grid: a piece's skin, a title or the titles, a shot and the
// Camera, plus Seamless Loop for the Scene in Compose. The studio's Inspector picks one for the selection.

/** Seamless Loop in the Scene inspector of Compose, where the run has to loop; export honours it */
export const SeamlessLoopRows: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const design = project.design;
	return (
		<>
			<CheckField id="design-loop" label="Seamless Loop" checked={design.loop} onChange={(loop) => cx.execute([{ type: 'setDesign', design: { loop } }])} />
			{design.loop ? <LoopStatus cx={cx} project={project} /> : null}
		</>
	);
};

/** The loop check of the current simulation as one state row, with a fix for a length off the bar grid */
const LoopStatus: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const result = useFeatureState(cx.simulation.$result);
	const status = React.useMemo(() => (result != null && result.revision === project.revision ? describeLoop(project, result) : null), [project, result]);
	if (status == null) return <StateRow tone="neutral" label="Checking the loop…" />;
	const { snappedEnd } = status;
	const mismatches = status.details.length;
	return (
		<>
			<StateRow
				tone={status.isOk ? 'good' : 'warn'}
				label={status.isOk ? 'Start and end match' : mismatches > 0 ? `${mismatches} ${mismatches === 1 ? 'mismatch' : 'mismatches'}` : status.summary}
				detail={[status.summary, ...status.details].join(' ')}
			/>
			{snappedEnd != null ? (
				<button className="mm-button" data-span="2" onClick={() => cx.execute([{ type: 'setEnd', end: snappedEnd }])} type="button">
					Snap End to Bar
				</button>
			) : null}
		</>
	);
};

/**
 * The Camera layer's inspector, in Compose and in Film: the frame of the film, then Automatic or Manual with the
 * rig's distance, pitch, lead and smoothing, the framing problem at the playhead and the shots
 */
export const CameraInspector: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const camera = project.design.camera;
	const shots = camera.shots.length;
	return (
		<>
			<InspectorHeader
				icon={<Video size={16} strokeWidth={1.7} />}
				title="Camera"
				subtitle={`${camera.mode === 'rig' ? 'Automatic' : 'Manual'} · ${shots === 1 ? '1 shot' : `${shots} shots`}`}
			/>
			<CameraPanel cx={cx} project={project} />
		</>
	);
};

/** The shape of the film, in Film's Scene */
export const FormatField: React.FC<{ cx: StudioCx; project: TProject }> = ({ cx, project }) => {
	const aspect = frameAspects.find((item) => item.width === project.frame.width && item.height === project.frame.height);
	return (
		<SelectField
			id="project-format"
			label="Format"
			value={aspect?.label ?? 'custom'}
			options={[...frameAspects.map((item) => ({ value: item.label, label: item.label })), ...(aspect == null ? [{ value: 'custom', label: 'Custom' }] : [])]}
			onChange={(value) => {
				const next = frameAspects.find((item) => item.label === value);
				if (next != null) cx.execute([{ type: 'setFrame', width: next.width, height: next.height }]);
			}}
		/>
	);
};

const frameAspects = [
	{ label: '9:16 Portrait', width: 9, height: 16 },
	{ label: '1:1 Square', width: 1, height: 1 },
	{ label: '4:5 Portrait', width: 4, height: 5 },
	{ label: '16:9 Landscape', width: 16, height: 9 }
];

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
		<>
		<Panel
			id="design.camera"
			title="Camera"
			accessory={<HelpTip text="Automatic: the camera follows the marbles, shaped by the shots. Manual: you move and animate the camera in Blender and the app leaves it alone." />}
		>
			<div className="mm-segmented" data-span="2" role="radiogroup" aria-label="Camera mode">
				{(['rig', 'manual'] as const).map((mode) => (
					<button key={mode} role="radio" aria-checked={camera.mode === mode} data-active={camera.mode === mode} onClick={() => set({ mode })} type="button">
						{mode === 'rig' ? 'Automatic' : 'Manual'}
					</button>
				))}
			</div>
			{camera.mode === 'rig' ? (
				<>
					<FramingProblem cx={cx} project={project} />
					<ScrubField id="camera-distance" label="Distance" name="Distance" value={camera.distance * 100} unit="cm" step={0.5} precision={1} min={5} max={500} onCommit={(value) => set({ distance: value / 100 })} />
					<ScrubField id="camera-pitch" label="Tilt" name="Downward angle" value={(camera.pitch * 180) / Math.PI} unit="°" step={0.5} min={-80} max={80} onCommit={(value) => set({ pitch: (value * Math.PI) / 180 })} />
					<ScrubField id="camera-sway" label="Sway" name="How much the view turns and rolls on its own; 0 keeps the wall upright" value={Math.round((camera.sway ?? 1) * 100)} unit="%" step={1} min={0} max={100} onCommit={(value) => set({ sway: value / 100 })} />
					{cameraState === 'takenOver' ? (
						<>
							<StateRow tone="warn" label="Edited in Blender" detail="The app no longer updates the camera, so your Blender changes stay. Reset Camera discards them and follows the marbles again." />
							{isConfirming ? (
								<>
									<button className="mm-button" onClick={() => setIsConfirming(false)} type="button">
										Keep Changes
									</button>
									<button
										className="mm-button"
										data-variant="primary"
										onClick={() => {
											setIsConfirming(false);
											void cx.design.regenerateCamera();
										}}
										type="button"
									>
										Reset Camera
									</button>
								</>
							) : (
								<button className="mm-button" data-span="2" onClick={() => setIsConfirming(true)} type="button">
									Reset Camera…
								</button>
							)}
						</>
					) : null}
				</>
			) : (
				<button className="mm-button" data-span="2" disabled={status === 'unavailable' || status === 'missing'} onClick={() => void cx.design.openInBlender()} type="button">
					Edit in Blender
				</button>
			)}
		</Panel>
		{camera.mode === 'rig' ? (
			<Panel id="design.camera.advanced" title="Advanced" defaultCollapsed accessory={<HelpTip text="Look Ahead: how far ahead of the marbles the camera looks. Smooth: how gently it follows them." />}>
				<ScrubField id="camera-lead" label="Look Ahead" name="How far ahead of the marbles the camera looks" value={camera.lead} unit="s" step={0.01} precision={2} min={0} max={3} onCommit={(value) => set({ lead: value })} />
				<ScrubField id="camera-smoothing" label="Smooth" name="Smoothing" value={Math.round(camera.smoothing * 100)} unit="%" step={0.5} min={0} max={100} onCommit={(value) => set({ smoothing: value / 100 })} />
			</Panel>
		) : null}
		</>
	);
};

/**
 * The framing problem at the playhead, which a jump from the hit summary, the export sheet or the Camera track lands
 * on, with its Fix-it once the problem model's what-if found one: "Bass leaves the frame at 0:12.00 (6 hits)" ·
 * Add Wide Shot Here
 */
const FramingProblem: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const result = useFeatureState(cx.simulation.$result);
	const playhead = useFeatureState(cx.$playhead);
	const preflight = React.useMemo(() => preflightExport(project, result), [project, result]);
	const issue = framingProblemAt(preflight, playhead);
	// The what-if runs once the problem shows; a fix that would not help is not offered
	const fix = React.useMemo(() => (issue != null ? framingFix(project, result, issue) : null), [issue, project, result]);
	if (issue == null) return null;
	return (
		<>
			<StateRow tone="warn" label={issue.title} detail={issue.detail} />
			{fix != null && (
				<button className="mm-button" data-span="2" onClick={() => getCommand('camera.addWideShot').run(cx)} title={fix.detail} type="button">
					{fix.label}
				</button>
			)}
		</>
	);
};

/** The Titles layer's inspector, for several titles selected together: each title as a link */
export const TitlesInspector: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const texts = project.entities.filter((entity) => entity.components.wallText != null);

	return (
		<>
			<InspectorHeader icon={<Type size={16} strokeWidth={1.7} />} title="Titles" subtitle={texts.length === 1 ? '1 title' : `${texts.length} titles`} />
			<Panel
				id="design.text"
				title="Titles"
				isEmpty={!texts.length}
				accessory={<HelpTip text="Text on the wall or in the frame, such as a title or a credit. Insert adds one." />}
			>
				{texts.map((entity) => (
					<LinkRow key={entity.id} icon={<Type size={13} strokeWidth={1.8} className="shrink-0 text-[var(--text-secondary)]" />} title="Select Title" onOpen={() => cx.$selection.set([entity.id])}>
						{entity.components.wallText?.text}
					</LinkRow>
				))}
			</Panel>
		</>
	);
};

// MARK: - Shot

/** Seconds from the Hold field; "next" or 0 keeps the shot until the next one */
function parseHold(text: string): number | null {
	if (/next/i.test(text)) return 0;
	const value = Number.parseFloat(text);
	return Number.isFinite(value) && value >= 0 ? value : null;
}

export const ShotInspector: React.FC<{ cx: StudioCx; project: TProject; shot: TShot }> = (props) => {
	const { cx, project, shot } = props;

	function set(patch: Partial<Omit<TShot, 'id'>>): void {
		cx.execute(updateShotCommands(project, shot.id, patch));
	}

	return (
		<>
			<InspectorHeader icon={<Bookmark size={16} strokeWidth={1.7} />} title={shotKindLabel(shot.kind)} subtitle="Shot" />
			<Panel
				id="design.shot"
				title="Shot"
				accessory={
					<HelpTip text="When the shot starts, the camera eases to its distance and roll over 0.8 s. After its hold it eases back to the automatic camera; a hold of 0 keeps the shot until the next one. Drag the shot on the timeline to move it." />
				}
			>
				<SelectField id="shot-kind" label="Kind" value={shot.kind} options={shotKinds.map((item) => ({ value: item.kind, label: item.label }))} onChange={(value) => set({ kind: value as TShotKind })} />
				<ScrubField id="shot-time" label="Time" name="Time" value={shot.time} unit="" step={0.01} precision={2} min={0} max={project.end} format={formatTime} parse={parseTime} onCommit={(value) => set({ time: value })} />
				<ScrubField id="shot-roll" label="Roll" name="Roll" value={(shot.roll * 180) / Math.PI} unit="°" step={0.5} precision={1} min={-90} max={90} onCommit={(value) => set({ roll: (value * Math.PI) / 180 })} />
				<ScrubField id="shot-distance" label="Distance" name="Distance" value={shot.distance * 100} unit="cm" step={0.5} precision={1} min={5} max={500} onCommit={(value) => set({ distance: value / 100 })} />
				<ScrubField
					id="shot-hold"
					label="Hold"
					name="Hold"
					value={shotLength(shot) ?? 0}
					unit="s"
					step={0.05}
					precision={1}
					min={0}
					max={project.end}
					format={(value) => (value <= 0 ? 'To Next Shot' : `${value.toFixed(1)} s`)}
					parse={parseHold}
					onCommit={(value) => set({ length: value })}
				/>
			</Panel>
		</>
	);
};

// MARK: - Title

export const WallTextInspector: React.FC<{ cx: StudioCx; project: TProject; entity: TEntity }> = (props) => {
	const { cx, project, entity } = props;
	const text = entity.components.wallText;
	const transform = entity.components.transform;
	const filmEnd = project.end;
	const editingTitle = useFeatureState(cx.design.$editingTitle);
	const [timingKey, setTimingKey] = React.useState(0);

	// A title just placed starts in its Text field with the text selected, like Figma's text tool
	React.useEffect(() => {
		if (editingTitle !== entity.id) return;
		cx.design.$editingTitle.set(null);
		const field = document.getElementById('text-content');
		if (field instanceof HTMLInputElement) {
			field.focus();
			field.select();
		}
	}, [cx, editingTitle, entity.id]);

	if (text == null) return null;
	const span = titleSpan(text, filmEnd);
	const style: TTitleStyle = text.style ?? 'wall';
	const isScreen = isScreenTitle(style);

	function setText(patch: Partial<NonNullable<TEntity['components']['wallText']>>): void {
		if (text == null) return;
		const value = { ...text, ...patch };
		// The entity name follows the text so lists and the outliner read the same
		cx.execute([{ type: 'upsertEntity', entity: { ...entity, name: value.text, components: { ...entity.components, wallText: value } } }]);
	}

	/** The title reads in the colour that stands apart from the wall, whatever the wall becomes */
	function clearColor(): void {
		if (text == null) return;
		const { color: _color, ...value } = text;
		cx.execute([{ type: 'upsertEntity', entity: { ...entity, components: { ...entity.components, wallText: value } } }]);
	}

	function setStyle(next: TTitleStyle): void {
		if (text == null || next === style) return;
		const playhead = cx.$playhead.get();
		const songName = songDisplayName(project);
		const frameHeight = frameHeightOnWall(project, cx.simulation.$result.get(), playhead);
		const value = withTitleStyle(text, next, { frameHeight, playhead, end: filmEnd, songName, aspect: project.frame.width / project.frame.height });
		cx.execute([{ type: 'upsertEntity', entity: { ...entity, name: value.text, components: { ...entity.components, wallText: value } } }]);
	}

	function setTime(field: 'in' | 'out', typed: string): void {
		if (text == null) return;
		const value = withTitleTime(text, field, typed, filmEnd);
		if (value == null) {
			// Not a time, or the title would end before it starts: the field shows the time it had
			setTimingKey((key) => key + 1);
			return;
		}
		cx.execute([{ type: 'setComponent', entityId: entity.id, component: { name: 'wallText', value } }]);
	}

	function setPosition(axis: 'x' | 'y', value: number): void {
		const current = transform ?? { position: { x: 0, y: 0 }, angle: 0 };
		cx.execute([{ type: 'setComponent', entityId: entity.id, component: { name: 'transform', value: { ...current, position: { ...current.position, [axis]: value } } } }]);
	}

	return (
		<>
			<InspectorHeader icon={<Type size={16} strokeWidth={1.7} />} title={text.text || 'Title'} subtitle={titleStyles.find((item) => item.style === style)?.label ?? 'Title'} />
			<Panel
				id="design.wallText"
				title="Text"
				accessory={
					<HelpTip text="Wall Title sits on the wall where you placed it. Caption, Song Name and End Card stay in the frame while the camera moves, and their size is a share of the frame height. Song Name opens the film, Caption shows for 3 s from the playhead and End Card covers the last 3 s." />
				}
			>
				<TextField id="text-content" label="Text" name="Text" value={text.text} span={2} allowEmpty={false} onCommit={(value) => setText({ text: value })} />
				<SelectField id="text-style" label="Style" value={style} options={titleStyles.map((item) => ({ value: item.style, label: item.label }))} onChange={(value) => setStyle(value as TTitleStyle)} />
				{isScreen ? (
					<ScrubField
						id="text-size"
						label="Size"
						name="Letter height as a share of the frame height"
						value={text.size * 100}
						unit="%"
						step={0.05}
						precision={1}
						min={1}
						max={40}
						onCommit={(value) => setText({ size: value / 100 })}
					/>
				) : (
					<>
						<ScrubField id="text-size" label="Size" name="Letter height" value={text.size * 100} unit="cm" step={0.05} precision={1} min={0.2} max={50} onCommit={(value) => setText({ size: value / 100 })} />
						<ScrubField id="text-depth" label="Depth" name="Depth" value={text.depth * 1000} unit="mm" step={0.1} precision={1} min={0} max={50} onCommit={(value) => setText({ depth: value / 1000 })} />
					</>
				)}
				<span className="mm-ifield" data-span="2">
					<label htmlFor="text-color" className="mm-ifield-label">
						Colour
					</label>
					<input id="text-color" type="color" className="mm-color" aria-label="Title colour" style={{ boxShadow: 'inset 0 0 0 1px var(--control-border)', borderRadius: 4 }} value={text.color ?? defaultTitleColor(project.design)} onChange={(event) => setText({ color: event.target.value })} />
					{text.color != null ? <span className="mm-ifield-value text-[11px] text-[var(--text-secondary)] uppercase">{text.color}</span> : <span className="mm-ifield-value text-[11px] text-[var(--text-tertiary)]">{themeOriginLabel(project.design)}</span>}
					{text.color != null && text.color.toLowerCase() !== defaultTitleColor(project.design) ? (
						<button className="mm-icon-button" onClick={clearColor} title="Use the colour that reads on the wall" aria-label="Reset Colour" type="button">
							<RotateCcw size={12} strokeWidth={1.9} />
						</button>
					) : null}
				</span>
			</Panel>
			<Panel id="design.wallText.timing" title="Timing" accessory={<HelpTip text="When the title shows: it fades in at In and out at Out. A Wall Title shows for the whole film; the other styles bring their own times, and times you type stay." />}>
				<TextField key={`in-${timingKey}`} id="text-in" label="In" name="Time the title appears" value={formatTime(span.start)} onCommit={(value) => setTime('in', value)} />
				<TextField key={`out-${timingKey}`} id="text-out" label="Out" name="Time the title disappears" value={formatTime(span.end)} onCommit={(value) => setTime('out', value)} />
			</Panel>
			<Panel id="design.wallText.position" title="Position">
				{isScreen ? (
					<ReadoutField label="Place" name="Place in the frame" span={2}>
						{style === 'caption' ? 'Top of the Frame' : style === 'songName' ? 'Upper Third of the Frame' : 'Centre of the Frame'}
					</ReadoutField>
				) : (
					<>
						<ScrubField id="text-x" label="X" name="X" value={(transform?.position.x ?? 0) * 100} unit="cm" step={0.1} precision={1} onCommit={(value) => setPosition('x', value / 100)} />
						<ScrubField id="text-y" label="Y" name="Y" value={(transform?.position.y ?? 0) * 100} unit="cm" step={0.1} precision={1} onCommit={(value) => setPosition('y', value / 100)} />
					</>
				)}
			</Panel>
		</>
	);
};

// MARK: - Piece skin

export const PieceSkin: React.FC<{ cx: StudioCx; project: TProject; pieces: TEntity[] }> = (props) => {
	const { cx, project, pieces } = props;
	const projectItems = useFeatureState(cx.library.$projectItems);
	const globalItems = useFeatureState(cx.library.$globalItems);
	const links = useFeatureState(cx.design.$links);

	const first = pieces[0] as TEntity;
	// Skins fit one piece type: with several types selected they go on the most common one
	const type = commonPieceType(pieces) ?? first.components.piece?.type ?? 'platform';
	const typeLabel = getPieceDefinition(type)?.label ?? type;
	const ids = pieces.map((entity) => entity.id);
	const skinned = pieces.filter((entity) => entity.components.piece?.type === type);
	const isMixedTypes = skinned.length < pieces.length;
	const isSingle = pieces.length === 1;
	const skinIds = [...new Set(skinned.map((entity) => entity.components.skin?.assetId ?? ''))];
	const ownSkin = skinIds.length === 1 && skinIds[0] !== '' ? (skinIds[0] as string) : null;
	const link = mergedLink(ids.map((id) => links[id]));
	const unlinked = ids.filter((id) => links[id]?.link === 'unlinked');
	const name = isSingle ? (first.name ?? typeLabel) : pieceCountLabel(pieces);

	function applyToAll(assetId: string): void {
		const item = [...projectItems, ...globalItems].find((candidate) => candidate.id === assetId);
		if (item != null) void cx.library.applySkin(item, { kind: 'pieceType', pieceType: type });
		else cx.execute(builtInSkinCommands(project, { kind: 'pieceType', pieceType: type }, canonicalSkinId(assetId)));
	}

	return (
		<>
			<InspectorHeader
				icon={<PieceIcon type={type} size={16} />}
				title={name}
				subtitle={isSingle ? typeLabel : isMixedTypes ? 'Track Pieces' : `${typeLabel}s`}
				onRename={isSingle ? (value) => cx.execute([{ type: 'upsertEntity', entity: { ...first, name: value } }]) : undefined}
			/>
			<Panel
				id="design.skin"
				title="Skin"
				accessory={
					<HelpTip
						text={`${SKIN_HELP} A click applies to the selection, ⌥-click to all ${typeLabel.toLowerCase()}s; a skin your agent makes shows here. On Hit moves or lights the skin on every hit; a skin never changes how the marble bounces.${isMixedTypes ? ` With several kinds of piece selected, a skin goes on the ${typeLabel.toLowerCase()}s and the others keep theirs.` : ''}`}
					/>
				}
			>
				<SkinPicker cx={cx} project={project} element={skinElement(type)} pieceType={type} entities={skinned} selected={pieces} />
				<SkinPropertyRows cx={cx} project={project} entities={pieces} />
				{ownSkin != null ? (
					<button className="mm-button" data-span="2" onClick={() => applyToAll(ownSkin)} type="button">
						Apply to All {typeLabel}s
					</button>
				) : null}
				<ResetToTheme cx={cx} project={project} entities={pieces} />
				<LinkState cx={cx} link={link} unlinked={unlinked} />
			</Panel>
		</>
	);
};

/** A piece changed in Blender, as one row with a reset button; the normal state needs no row */
const LinkState: React.FC<{ cx: StudioCx; link: TDesignLink | 'mixed' | null; unlinked: string[] }> = (props) => {
	const { cx, link, unlinked } = props;
	if (link == null || !unlinked.length) return null;
	const reason = link !== 'mixed' && link.reason != null ? reasonLabel(link.reason) : null;
	return (
		<StateRow
			tone="warn"
			label={link === 'mixed' ? 'Some detached' : `Detached${reason != null ? ` · ${reason}` : ''}`}
			detail="Changed in Blender, so the app no longer moves it. The marble still bounces off the Compose position."
			action={
				<button className="mm-icon-button" onClick={() => void cx.design.relink(unlinked)} title="Discard Blender Changes: the app moves it again" aria-label="Discard Blender Changes" type="button">
					<RotateCcw size={12} strokeWidth={1.9} />
				</button>
			}
		/>
	);
};

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
			return 'detached by hand';
		default:
			return reason;
	}
}
