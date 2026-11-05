import { BrickWall, Lightbulb, RotateCcw, Sun } from 'lucide-react';
import React from 'react';
import { InspectorHeader, Panel, SliderField } from '@/components';
import type { TLight, TProject, TProjectCommand } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { parseHexColor } from '@/modules/studio/format';
import { WallPicker } from './SkinPickers';
import { resolveTheme } from './project-themes';
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

/** The Wall layer: its Skin, Wall color and the Background behind it */
export const WallInspector: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const { design } = project;
	const wall = wallLayer(design);
	const origin = themeOriginLabel(design);
	const themeName = resolveTheme(design).name;
	const isOwn = Object.keys(wall.own).length > 0;

	return (
		<>
			<InspectorHeader icon={<BrickWall size={16} strokeWidth={1.7} />} title="Wall" subtitle={isOwn ? `Changed from ${themeName}` : origin} />
			<Panel id="design.wall" title="Skin">
				<WallPicker cx={cx} project={project} />
				<ColorWell
					cx={cx}
					id="wall-color"
					label="Wall"
					name="Wall color"
					own={wall.own.color ?? null}
					shown={wall.color}
					origin={origin}
					resetTitle={`Use ${themeName}'s wall color again`}
					commandsFor={(color) => wallCommands(requireProject(cx), { color })}
				/>
				<ColorWell
					cx={cx}
					id="wall-background"
					label="Background"
					name="Background color"
					own={wall.own.backgroundColor ?? null}
					shown={wall.backgroundColor}
					origin={origin}
					resetTitle={`Use ${themeName}'s background color again`}
					commandsFor={(backgroundColor) => wallCommands(requireProject(cx), { backgroundColor })}
				/>
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
			<Panel
				id="design.keyLight"
				title="Light"
				accessory={
					<>
						{isOwn ? (
							<button className="mm-icon-button" onClick={() => cx.execute(resetKeyLightCommands(requireProject(cx)))} title={`Use ${themeName}'s Key Light again`} aria-label="Use the theme's Key Light" type="button">
								<RotateCcw size={12} strokeWidth={1.9} />
							</button>
						) : null}
					</>
				}
			>
				<ColorWell
					cx={cx}
					id="key-light-color"
					label="Color"
					name="Key Light color"
					own={key.own.color ?? null}
					shown={key.color}
					origin={origin}
					resetTitle={`Use ${themeName}'s light color again`}
					commandsFor={(color) => keyLightCommands(requireProject(cx), { color })}
				/>
				<LightSliders idPrefix="key-light" strength={key.strength} side={key.side} height={key.height} onChange={(patch) => cx.execute(keyLightCommands(requireProject(cx), patch))} />
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
			<Panel id="design.light" title="Light">
				<ColorWell cx={cx} id="light-color" label="Color" name={`${light.name} color`} own={light.color} shown={light.color} commandsFor={(color) => (color != null ? updateLightCommands(requireProject(cx), light.id, { color }) : [])} />
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

/** A hex color typed by hand; what isn't one stays out of the project and goes back to the color on leaving */
const HexInput: React.FC<{ name: string; value: string; onCommit: (color: string) => void }> = (props) => {
	const { name, value, onCommit } = props;
	const [draft, setDraft] = React.useState(value.toUpperCase());
	const parsed = parseHexColor(draft);

	function leave(): void {
		if (parsed == null) setDraft(value.toUpperCase());
		else if (parsed !== value.toLowerCase()) onCommit(parsed);
	}

	return (
		<input
			className="mm-ifield-value text-[11px] uppercase"
			aria-label={name}
			aria-invalid={parsed == null}
			title={parsed == null ? 'A color has six hex digits, like #3478F6' : undefined}
			spellCheck={false}
			value={draft}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={leave}
			onKeyDown={(event) => {
				if (event.key === 'Enter') event.currentTarget.blur();
			}}
		/>
	);
};

/**
 * One color well of a layer. An inherited color names where it comes from, a set one shows its hex with a reset.
 * Dragging in the color picker is one undo step: changes fold into the first while it is still the latest edit, until
 * the well loses focus.
 */
export const ColorWell: React.FC<{
	cx: StudioCx;
	id: string;
	label: string;
	name: string;
	/** The color the project set; null reads as `origin` */
	own: string | null;
	shown: string;
	origin?: string;
	resetTitle?: string;
	/** The hex can be typed, not only read */
	isHexEditable?: boolean;
	commandsFor: (color: string | null) => TProjectCommand[];
}> = (props) => {
	const { cx, id, label, name, own, shown, origin, resetTitle, isHexEditable = false, commandsFor } = props;
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
				// An outline keeps a light color visible on the white panel
				style={{ boxShadow: 'inset 0 0 0 1px var(--control-border)', borderRadius: 4 }}
				value={shown}
				onChange={(event) => set(event.target.value)}
				onBlur={() => {
					groupRef.current = null;
				}}
			/>
			{isHexEditable ? <HexInput key={shown} name={`${name} in hex`} value={shown} onCommit={set} /> : own != null || origin == null ? <span className="mm-ifield-value text-[11px] text-[var(--text-secondary)] uppercase">{shown}</span> : <span className="mm-ifield-value text-[11px] text-[var(--text-tertiary)]">{origin}</span>}
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

