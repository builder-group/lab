import { useFeatureState } from 'feature-react/state';
import { Box, Copy, ExternalLink, Sparkles, Trash2 } from 'lucide-react';
import React from 'react';
import { CheckField, HelpTip, InspectorHeader, Panel, ReadoutField, ScrubField, SelectField, SliderField, StatusPill, TextField } from '@/components';
import type { TDecor, TGarland, TProject, TProjectCommand, TSnowfall } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { formatTime } from '@/modules/studio/format';
import { toDecorKey, toMadeInBlenderKey } from '@/modules/studio/selection';
import { $blenderObjects, deleteDecorCommands, duplicateDecorCommands, findDecor, madeInBlenderCommands, madeInBlenderLayer, updateDecorCommands } from './decor';
import { moveDecorClearAction, revealMadeInBlender } from './decor-actions';
import { decorItem, decorText } from './decor-catalog';
import { garlandOf, SNOWFALL_DEFAULTS, snowfallOf } from './decor-effects';
import { ColorWell } from './SceneLayerInspector';
import { decorTips, preflightExport } from './export-preflight';
import { DecorTiles } from './LookTiles';
import { titleSpan, withTitleTime } from './titles';

// Inspectors of the Decor group: which item it is as tiles in Look, then Position, Scale, Rotation, Depth and In and Out
// with the title pattern. Decor has no hitbox. Made in Blender objects keep their place in Blender, so they show only In, Out and their tip.

/** The amber tip on a layer a marble's path crosses, from the one problem model */
function useDecorTip(cx: StudioCx, project: TProject, key: string): string | null {
	const result = useFeatureState(cx.simulation.$result);
	const objects = useFeatureState($blenderObjects);
	return React.useMemo(() => (result != null && result.revision === project.revision ? (decorTips(preflightExport(project, result, objects)).get(key)?.label ?? null) : null), [project, result, objects, key]);
}

export const DecorInspector: React.FC<{ cx: StudioCx; project: TProject; decor: TDecor }> = (props) => {
	const { cx, project, decor } = props;
	const [timingKey, setTimingKey] = React.useState(0);
	const tip = useDecorTip(cx, project, toDecorKey(decor.id));
	const item = decorItem(decor.source);
	const text = decorText(decor);
	const span = titleSpan(decor, project.end);
	const update = (patch: Parameters<typeof updateDecorCommands>[2]): void => void cx.execute(updateDecorCommands(requireProject(cx), [decor.id], patch));

	function setTime(field: 'in' | 'out', typed: string): void {
		const value = withTitleTime(decor, field, typed, project.end);
		if (value == null) {
			// Not a time, or it would end before it starts: the field shows the time it had
			setTimingKey((key) => key + 1);
			return;
		}
		update({ in: value.in, out: value.out });
	}

	return (
		<>
			<InspectorHeader
				icon={<Sparkles size={16} strokeWidth={1.7} />}
				title={decor.name}
				subtitle={item?.label ?? 'Decor'}
				onRename={(name) => update({ name })}
			/>
			{item?.effect === 'snowfall' ? <SnowfallPanel cx={cx} decor={decor} /> : null}
			{item?.effect === 'garland' ? <GarlandPanel decor={decor} onChange={(garland) => update({ garland })} /> : null}
			{tip != null ? (
				<DecorTip tip={tip} detail="A marble passes over it while it shows. Decor has no hitbox, so the hit stays the same.">
					<button className="mm-fix-it mm-fix-it-label" onClick={() => moveDecorClearAction(cx, decor.id)} title="Moves it the shortest way to a spot clear of every marble's path" type="button">
						Move Clear
					</button>
				</DecorTip>
			) : null}
			<Panel id="design.decor.look" title="Look" accessory={<HelpTip text="Which item it is. It keeps its place and times. Decor has no hitbox, so it never changes a hit." />}>
				<DecorTiles cx={cx} project={project} ids={[decor.id]} />
			</Panel>
			{text != null ? (
				<Panel id="design.decor.text" title="Text">
					<TextField key={decor.id} id="decor-text" label="Text" name="What it reads" value={text} span={2} allowEmpty={false} onCommit={(value) => update({ text: value })} />
				</Panel>
			) : null}
			{item?.effect == null ? (
			<Panel id="design.decor.place" title="Position" accessory={<HelpTip text="Where it sits on the wall. Drag it in the Draft Preview, or set it here. Decor has no hitbox, so it never changes a hit." />}>
				<ScrubField id="decor-x" label="X" name="X" value={decor.position.x * 100} unit="cm" step={0.1} precision={1} onCommit={(value) => update({ position: { ...decor.position, x: value / 100 } })} />
				<ScrubField id="decor-y" label="Y" name="Y" value={decor.position.y * 100} unit="cm" step={0.1} precision={1} onCommit={(value) => update({ position: { ...decor.position, y: value / 100 } })} />
				<ScrubField id="decor-scale" label="Scale" name="Scale" value={decor.scale * 100} unit="%" step={1} min={10} max={1000} onCommit={(value) => update({ scale: value / 100 })} />
				<ScrubField id="decor-rotation" label="Rotation" name="Rotation" value={(decor.rotation * 180) / Math.PI} unit="°" step={1} onCommit={(value) => update({ rotation: (value * Math.PI) / 180 })} />
				<ScrubField id="decor-depth" label="Depth" name="Distance in front of the wall" value={decor.depth * 1000} unit="mm" step={0.5} precision={1} min={0} max={200} onCommit={(value) => update({ depth: value / 1000 })} />
			</Panel>
			) : null}
			<Panel id="design.decor.timing" title="Timing" accessory={<HelpTip text="When it shows: it fades in at In and out at Out, like a title." />}>
				<TextField key={`in-${timingKey}`} id="decor-in" label="In" name="Time it appears" value={formatTime(span.start)} onCommit={(value) => setTime('in', value)} />
				<TextField key={`out-${timingKey}`} id="decor-out" label="Out" name="Time it disappears" value={formatTime(span.end)} onCommit={(value) => setTime('out', value)} />
			</Panel>
			<Panel id="design.decor.actions" title="Layer">
				<CheckField id="decor-hidden" label="Hidden" checked={decor.hidden === true} onChange={(hidden) => update({ hidden })} />
				<button className="mm-button" data-span="2" onClick={() => duplicate(cx, [decor.id])} title="A copy beside it (⌘D)" type="button">
					<Copy size={12} strokeWidth={1.8} />
					Duplicate
				</button>
				<button className="mm-button" data-span="2" onClick={() => remove(cx, [decor.id])} title="Delete it (⌫)" type="button">
					<Trash2 size={12} strokeWidth={1.8} />
					Delete Decor
				</button>
			</Panel>
		</>
	);
};

/** Snowfall's settings. It fills the frame, so it has no place on the wall. */
const SnowfallPanel: React.FC<{ cx: StudioCx; decor: TDecor }> = (props) => {
	const { cx, decor } = props;
	const snow = snowfallOf(decor);
	const commands = (patch: Partial<TSnowfall>): TProjectCommand[] => updateDecorCommands(requireProject(cx), [decor.id], { snowfall: { ...snow, ...patch } });
	const asPercent = (value: number): string => String(Math.round(value));
	return (
		<Panel id="design.decor.snowfall" title="Snowfall" accessory={<HelpTip text="Snow falling in front of everything, always filling the frame. It has no hitbox, and it falls the same way in every render." />}>
			<SliderField id="snowfall-density" label="Density" value={snow.density * 100} min={0} max={100} step={1} format={asPercent} unit="%" onCommit={(value) => void cx.execute(commands({ density: value / 100 }))} />
			<SliderField id="snowfall-size" label="Size" value={snow.size * 100} min={25} max={300} step={5} format={asPercent} unit="%" onCommit={(value) => void cx.execute(commands({ size: value / 100 }))} />
			<SliderField id="snowfall-speed" label="Speed" value={snow.speed * 100} min={0} max={300} step={5} format={asPercent} unit="%" onCommit={(value) => void cx.execute(commands({ speed: value / 100 }))} />
			<ColorWell cx={cx} id="snowfall-color" label="Colour" name="Snowfall colour" own={snow.color} shown={snow.color} commandsFor={(color) => commands({ color: color ?? SNOWFALL_DEFAULTS.color })} />
		</Panel>
	);
};

/** Garland's settings. It runs down the frame's edges and passes with the wall. */
const GarlandPanel: React.FC<{ decor: TDecor; onChange: (garland: TGarland) => void }> = (props) => {
	const { decor, onChange } = props;
	const garland = garlandOf(decor);
	return (
		<Panel id="design.decor.garland" title="Garland" accessory={<HelpTip text="Fir sprigs, fairy lights and baubles down the frame's edges for the whole run. It passes with the wall and stays at the edges as the camera turns." />}>
			<SelectField id="garland-side" label="Side" value={garland.side} options={GARLAND_SIDES} onChange={(side) => onChange({ ...garland, side: side as TGarland['side'] })} />
			<SliderField id="garland-spacing" label="Spacing" value={garland.spacing * 100} min={8} max={40} step={1} format={(value) => String(Math.round(value))} unit="%" onCommit={(value) => onChange({ ...garland, spacing: value / 100 })} />
		</Panel>
	);
};

const GARLAND_SIDES: { value: string; label: string }[] = [
	{ value: 'left', label: 'Left' },
	{ value: 'right', label: 'Right' },
	{ value: 'both', label: 'Both' }
];

/** Several decorations selected together */
export const DecorsInspector: React.FC<{ cx: StudioCx; project: TProject; ids: string[] }> = (props) => {
	const { cx, project, ids } = props;
	const list = ids.flatMap((id) => findDecor(project.design, id) ?? []);
	const isAllHidden = list.every((item) => item.hidden === true);
	return (
		<>
			<InspectorHeader icon={<Sparkles size={16} strokeWidth={1.7} />} title="Decor" subtitle={`${list.length} items`} />
			<Panel id="design.decor.look" title="Look" accessory={<HelpTip text="Which item they are. They keep their places and times." />}>
				<DecorTiles cx={cx} project={project} ids={ids} />
			</Panel>
			<Panel id="design.decors" title="Layers">
				<CheckField id="decors-hidden" label="Hidden" checked={isAllHidden} onChange={(hidden) => void cx.execute(updateDecorCommands(requireProject(cx), ids, { hidden }))} />
				<button className="mm-button" data-span="2" onClick={() => duplicate(cx, ids)} type="button">
					<Copy size={12} strokeWidth={1.8} />
					Duplicate
				</button>
				<button className="mm-button" data-span="2" onClick={() => remove(cx, ids)} type="button">
					<Trash2 size={12} strokeWidth={1.8} />
					Delete Decor
				</button>
			</Panel>
		</>
	);
};

/** An object added directly in Blender: it stays where Blender has it, and the app only hides and times it */
export const MadeInBlenderInspector: React.FC<{ cx: StudioCx; project: TProject; name: string }> = (props) => {
	const { cx, project, name } = props;
	const [timingKey, setTimingKey] = React.useState(0);
	const tip = useDecorTip(cx, project, toMadeInBlenderKey(name));
	const layer = madeInBlenderLayer(project.design, name);
	const span = titleSpan(layer, project.end);

	function setTime(field: 'in' | 'out', typed: string): void {
		const value = withTitleTime(layer, field, typed, project.end);
		if (value == null) {
			setTimingKey((key) => key + 1);
			return;
		}
		cx.execute(madeInBlenderCommands(requireProject(cx), name, { in: value.in ?? null, out: value.out ?? null }));
	}

	return (
		<>
			<InspectorHeader
				icon={<Box size={16} strokeWidth={1.7} />}
				title={name}
				subtitle="Made in Blender"
			/>
			{tip != null ? <DecorTip tip={tip} detail="A marble passes over it while it shows. Move it in Blender if that isn't what you want." /> : null}
			<Panel id="design.madeInBlender" title="Blender" accessory={<HelpTip text="You added this in the Blender file. MidiMarble never moves or deletes it, and it has no hitbox." />}>
				<ReadoutField label="Look" name="Where it shows" span={2}>
					Shows in the Blender preview
				</ReadoutField>
				<CheckField id="blender-hidden" label="Hidden" checked={layer.hidden === true} onChange={(hidden) => void cx.execute(madeInBlenderCommands(requireProject(cx), name, { hidden: hidden ? true : null }))} />
				<button className="mm-button" data-span="2" onClick={() => revealMadeInBlender(cx, name)} title="Opens Blender with this object selected" type="button">
					<ExternalLink size={12} strokeWidth={1.8} />
					Open in Blender
				</button>
			</Panel>
			<Panel id="design.madeInBlender.timing" title="Timing" accessory={<HelpTip text="When it shows: keyframes on the object in Blender hide it before In and from Out on." />}>
				<TextField key={`in-${timingKey}`} id="blender-in" label="In" name="Time it appears" value={formatTime(span.start)} onCommit={(value) => setTime('in', value)} />
				<TextField key={`out-${timingKey}`} id="blender-out" label="Out" name="Time it disappears" value={formatTime(span.end)} onCommit={(value) => setTime('out', value)} />
			</Panel>
		</>
	);
};

/** The amber words on a layer a marble's path crosses, on their own line: they run longer than a name */
const DecorTip: React.FC<{ tip: string; detail: string; children?: React.ReactNode }> = (props) => {
	const { tip, detail, children } = props;
	return (
		<div className="flex flex-wrap items-center gap-1.5 px-3 pb-2" role="status">
			<StatusPill tone="warn" label={tip} detail={detail} />
			{children}
		</div>
	);
};

function duplicate(cx: StudioCx, ids: string[]): void {
	const { commands, decorIds } = duplicateDecorCommands(requireProject(cx), ids);
	if (cx.execute(commands)) cx.$selection.set(decorIds.map(toDecorKey));
}

function remove(cx: StudioCx, ids: string[]): void {
	if (cx.execute(deleteDecorCommands(requireProject(cx), ids))) cx.$selection.set([]);
}

function requireProject(cx: StudioCx): TProject {
	return cx.project as TProject;
}
