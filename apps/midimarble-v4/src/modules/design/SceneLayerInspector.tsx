import { BrickWall, Lightbulb, RotateCcw, Sun, TriangleAlert } from 'lucide-react';
import React from 'react';
import { HelpTip, InspectorHeader, Panel, SliderField } from '@/components';
import type { TLight, TProject, TProjectCommand } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { SKIN_HELP } from './concept-words';
import { marbleContrastWarning } from './draft-look';
import { WallPicker } from './SkinPickers';
import { appliedOverrides, baseThemeOf, resolveTheme } from './project-themes';
import {
	keyLightCommands,
	keyLightLayer,
	MAX_LIGHT_STRENGTH,
	resetKeyLightCommands,
	themeOriginLabel,
	updateLightCommands,
	wallCommands,
	wallLayer
} from './scene-layers';

// Inspectors of the Wall and Lights layers of Film. Values the theme sets read "From Brass"; a value the project sets
// keeps its reset, like a piece's skin.

const LIGHT_HELP = 'Shows in the Blender preview. The Draft Preview draws no light. Side runs from the far left to the far right of the wall, Height from below to above.';

/** The Wall layer: its Skin, Wall colour and the Background behind it */
export const WallInspector: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const { design } = project;
	const wall = wallLayer(design);
	const origin = themeOriginLabel(design);
	const themeName = resolveTheme(design).name;
	const isOwn = Object.keys(wall.own).length > 0;
	const marbles = project.entities.flatMap((entity) => (entity.components.marble != null ? [{ name: entity.name ?? 'Marble', color: entity.components.marble.color }] : []));
	const warning = marbleContrastWarning(baseThemeOf(design), appliedOverrides(design), marbles);

	return (
		<>
			<InspectorHeader icon={<BrickWall size={16} strokeWidth={1.7} />} title="Wall" subtitle={isOwn ? `Changed from ${themeName}` : origin} />
			<Panel id="design.wall" title="Skin" accessory={<HelpTip text={`${SKIN_HELP} The wall is what the marbles fall in front of. The Background surrounds it, lights it and reflects in the pieces.`} />}>
				<WallPicker cx={cx} project={project} />
				<ColorWell
					cx={cx}
					id="wall-color"
					label="Wall"
					name="Wall colour"
					own={wall.own.color ?? null}
					shown={wall.color}
					origin={origin}
					resetTitle={`Use ${themeName}'s wall colour again`}
					commandsFor={(color) => wallCommands(requireProject(cx), { color })}
				/>
				{warning != null ? (
					<span className="flex items-start gap-1 text-[11px] text-[var(--text-secondary)]" data-span="2" role="status">
						<TriangleAlert size={12} strokeWidth={1.8} className="mt-px shrink-0 text-[var(--warn)]" aria-hidden />
						{warning}
					</span>
				) : null}
				<ColorWell
					cx={cx}
					id="wall-background"
					label="Background"
					name="Background colour"
					own={wall.own.backgroundColor ?? null}
					shown={wall.backgroundColor}
					origin={origin}
					resetTitle={`Use ${themeName}'s background colour again`}
					commandsFor={(backgroundColor) => wallCommands(requireProject(cx), { backgroundColor })}
				/>
				{isOwn ? (
					<button className="mm-button" data-span="2" onClick={() => cx.execute(wallCommands(project, { kind: null, color: null, backgroundColor: null }))} title={`Show ${themeName}'s wall and colours again`} type="button">
						<RotateCcw size={12} strokeWidth={1.9} />
						Reset to Theme
					</button>
				) : null}
			</Panel>
		</>
	);
};

/** The theme's Key Light: can't be deleted, only given back to the theme */
export const KeyLightInspector: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const { design } = project;
	const key = keyLightLayer(design);
	const origin = themeOriginLabel(design);
	const themeName = resolveTheme(design).name;
	const isOwn = Object.keys(key.own).length > 0;

	return (
		<>
			<InspectorHeader icon={<Sun size={16} strokeWidth={1.7} />} title="Key Light" subtitle={isOwn ? `Changed from ${themeName}` : origin} />
			<Panel id="design.keyLight" title="Light" accessory={<HelpTip text={`The theme's main light. ${LIGHT_HELP}`} />}>
				<ColorWell
					cx={cx}
					id="key-light-color"
					label="Colour"
					name="Key Light colour"
					own={key.own.color ?? null}
					shown={key.color}
					origin={origin}
					resetTitle={`Use ${themeName}'s light colour again`}
					commandsFor={(color) => keyLightCommands(requireProject(cx), { color })}
				/>
				<LightSliders idPrefix="key-light" strength={key.strength} side={key.side} height={key.height} onChange={(patch) => cx.execute(keyLightCommands(requireProject(cx), patch))} />
				{isOwn ? (
					<button className="mm-button" data-span="2" onClick={() => cx.execute(resetKeyLightCommands(requireProject(cx)))} title={`Use ${themeName}'s Key Light again`} type="button">
						<RotateCcw size={12} strokeWidth={1.9} />
						Reset to Theme
					</button>
				) : null}
			</Panel>
		</>
	);
};

/** A light added through Insert */
export const LightInspector: React.FC<{ cx: StudioCx; project: TProject; light: TLight }> = (props) => {
	const { cx, light } = props;
	return (
		<>
			<InspectorHeader
				icon={<Lightbulb size={16} strokeWidth={1.7} />}
				title={light.name}
				subtitle="Light"
				onRename={(name) => cx.execute(updateLightCommands(requireProject(cx), light.id, { name }))}
			/>
			<Panel id="design.light" title="Light" accessory={<HelpTip text={LIGHT_HELP} />}>
				<ColorWell cx={cx} id="light-color" label="Colour" name={`${light.name} colour`} own={light.color} shown={light.color} commandsFor={(color) => (color != null ? updateLightCommands(requireProject(cx), light.id, { color }) : [])} />
				<LightSliders idPrefix="light" strength={light.strength} side={light.side} height={light.height} onChange={(patch) => cx.execute(updateLightCommands(requireProject(cx), light.id, patch))} />
			</Panel>
		</>
	);
};

/** Strength and the two direction sliders, each committing one edit on release */
const LightSliders: React.FC<{ idPrefix: string; strength: number; side: number; height: number; onChange: (patch: { strength?: number; side?: number; height?: number }) => void }> = (props) => {
	const { idPrefix, strength, side, height, onChange } = props;
	const asPercent = (value: number): string => String(Math.round(value));
	return (
		<>
			<SliderField id={`${idPrefix}-strength`} label="Strength" value={strength} min={0} max={MAX_LIGHT_STRENGTH} step={0.1} format={(value) => value.toFixed(1)} unit="" onCommit={(value) => onChange({ strength: value })} />
			<SliderField id={`${idPrefix}-side`} label="Side" value={side * 100} min={-100} max={100} step={1} format={asPercent} unit="%" onCommit={(value) => onChange({ side: value / 100 })} />
			<SliderField id={`${idPrefix}-height`} label="Height" value={height * 100} min={-100} max={100} step={1} format={asPercent} unit="%" onCommit={(value) => onChange({ height: value / 100 })} />
		</>
	);
};

/**
 * One colour well of a layer. An inherited colour names where it comes from, a set one shows its hex with a reset.
 * Dragging in the colour picker is one undo step: changes fold into the first while it is still the latest edit, until
 * the well loses focus.
 */
export const ColorWell: React.FC<{
	cx: StudioCx;
	id: string;
	label: string;
	name: string;
	/** The colour the project set; null reads as `origin` */
	own: string | null;
	shown: string;
	origin?: string;
	resetTitle?: string;
	commandsFor: (color: string | null) => TProjectCommand[];
}> = (props) => {
	const { cx, id, label, name, own, shown, origin, resetTitle, commandsFor } = props;
	const groupRef = React.useRef<number | null>(null);

	function set(color: string | null): void {
		const commands = commandsFor(color);
		if (!commands.length) return;
		if (color != null && groupRef.current != null && cx.editGroup === groupRef.current) {
			cx.execute(commands, { group: groupRef.current });
			return;
		}
		if (cx.execute(commands)) groupRef.current = color != null ? cx.editGroup : null;
	}

	return (
		<span className="mm-ifield" data-span="2">
			<label htmlFor={id} className="mm-ifield-label">
				{label}
			</label>
			<input
				id={id}
				type="color"
				className="mm-color"
				aria-label={name}
				// An outline keeps a light colour visible on the white panel
				style={{ boxShadow: 'inset 0 0 0 1px var(--control-border)', borderRadius: 4 }}
				value={shown}
				onChange={(event) => set(event.target.value)}
				onBlur={() => {
					groupRef.current = null;
				}}
			/>
			{own != null || origin == null ? <span className="mm-ifield-value text-[11px] text-[var(--text-secondary)] uppercase">{shown}</span> : <span className="mm-ifield-value text-[11px] text-[var(--text-tertiary)]">{origin}</span>}
			{own != null && origin != null ? (
				<button className="mm-icon-button" onClick={() => set(null)} title={resetTitle} aria-label={`Reset ${label}`} type="button">
					<RotateCcw size={12} strokeWidth={1.9} />
				</button>
			) : null}
		</span>
	);
};

/** Edits read the latest project, so the commands of a drag fold onto what the drag already changed */
function requireProject(cx: StudioCx): TProject {
	return cx.project as TProject;
}

