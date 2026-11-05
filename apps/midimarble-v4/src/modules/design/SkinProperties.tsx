import { useFeatureState } from 'feature-react/state';
import { RotateCcw } from 'lucide-react';
import React from 'react';
import { HelpTip, Panel, ScrubField, SelectField } from '@/components';
import type { TAssetProperty } from '@/modules/library/asset-manifest';
import { marbleFilmColor, type TEntity, type TProject } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { skinPropertyCommands, type TSkinPropertyPatch } from './design-commands';
import { resolveElementLook } from './project-themes';
import { SKIN_HELP } from './concept-words';
import { themeOriginLabel } from './scene-layers';
import { SkinPicker } from './SkinPickers';
import { catalogSkin, COLOUR_LABELS, entitySkinElement, ON_HIT_LABELS, sharedSkinProperties, type TSkinColour } from './skin-catalog';

// The standard skin properties in the Skin panel, the same rows for pieces and marbles.

const MIXED = '__mixed__';
const FROM_THEME = '__theme__';

/**
 * Colour, On Hit, Glow Colour, Variant and a library skin's extra properties for the selected entities: what their skins
 * share, each with its theme's value as the first choice. Every change is one undo step.
 */
export const SkinPropertyRows: React.FC<{ cx: StudioCx; project: TProject; entities: TEntity[] }> = (props) => {
	const { cx, project, entities } = props;
	const projectItems = useFeatureState(cx.library.$projectItems);
	const globalItems = useFeatureState(cx.library.$globalItems);
	const looks = entities.flatMap((entity) => {
		const element = entitySkinElement(entity);
		return element != null ? [{ entity, element, look: resolveElementLook(project.design, element, entity.components.skin) }] : [];
	});
	const shared = sharedSkinProperties(looks);
	const ids = entities.map((entity) => entity.id);
	const extras = sharedExtras(project, entities, [...projectItems, ...globalItems]);

	function set(patch: TSkinPropertyPatch): void {
		cx.execute(skinPropertyCommands(project, ids, patch));
	}

	/** The row's value: the one override, the theme's when nothing is overridden, or Mixed */
	function valueOf(field: 'colour' | 'onHit' | 'variant'): string {
		const values = new Set(entities.map((entity) => entity.components.skin?.[field] ?? FROM_THEME));
		return values.size > 1 ? MIXED : ([...values][0] ?? FROM_THEME);
	}

	const options = (value: string, fromTheme: string, choices: readonly { value: string; label: string }[]): { value: string; label: string }[] => [
		...(value === MIXED ? [{ value: MIXED, label: 'Mixed' }] : []),
		{ value: FROM_THEME, label: fromTheme },
		...choices
	];
	const first = looks[0];
	const firstSkin = first != null ? catalogSkin(first.look.skin) : null;
	// Showing the theme's skin, a value not set here comes from the theme: "From Brass"; on a skin of its own, it is that skin's
	const origin = first?.look.isThemeSkin === false ? 'Default' : themeOriginLabel(project.design);
	// On a marble, Marble means a colour of its own, set in the row below
	const isMarbles = looks.length > 0 && looks.every(({ element }) => element === 'marble');
	const colourLabel = (colour: TSkinColour): string => (isMarbles && colour === 'marble' ? 'Custom' : COLOUR_LABELS[colour]);
	const hasOwnColour = isMarbles && looks.every(({ look }) => look.colour === 'marble');

	return (
		<>
			{shared.colours.length > 1 ? (
				<SelectField
					id="skin-colour"
					label="Colour"
					value={valueOf('colour')}
					options={options(valueOf('colour'), first != null ? `${colourLabel(first.look.colour)} · ${origin}` : origin, shared.colours.map((colour) => ({ value: colour, label: colourLabel(colour) })))}
					onChange={(value) => {
						if (value !== MIXED) set({ colour: value === FROM_THEME ? null : (value as NonNullable<TSkinPropertyPatch['colour']>) });
					}}
				/>
			) : null}
			{hasOwnColour ? (
				<ColourRow
					cx={cx}
					id="skin-own-colour"
					label="Marble Colour"
					value={sameOf(entities.map((entity) => entity.components.skin?.color))}
					fallback={first?.entity.components.marble != null ? marbleFilmColor(project, first.entity.components.marble.laneId) : '#ffffff'}
					origin="Default"
					patch={(color) => skinPropertyCommands(cx.project ?? project, ids, { color })}
				/>
			) : null}
			{shared.onHit.length > 0 ? (
				<SelectField
					id="skin-on-hit"
					label="On Hit"
					value={valueOf('onHit')}
					options={options(valueOf('onHit'), first != null ? `${ON_HIT_LABELS[first.look.onHit ?? firstSkin?.reacts ?? 'none']} · ${origin}` : origin, shared.onHit.map((onHit) => ({ value: onHit, label: ON_HIT_LABELS[onHit] })))}
					onChange={(value) => {
						if (value !== MIXED) set({ onHit: value === FROM_THEME ? null : (value as NonNullable<TSkinPropertyPatch['onHit']>) });
					}}
				/>
			) : null}
			{shared.glowColor ? <ColourRow cx={cx} id="skin-glow" label="Glow Colour" value={sameOf(entities.map((entity) => entity.components.skin?.glowColor))} fallback={first?.look.glowColor ?? '#ffffff'} origin={origin} patch={(color) => skinPropertyCommands(cx.project ?? project, ids, { glowColor: color })} /> : null}
			{shared.variants.length > 0 ? (
				<SelectField
					id="skin-variant"
					label="Variant"
					value={valueOf('variant')}
					options={options(valueOf('variant'), `${shared.variants.find((item) => item.id === firstSkin?.variant)?.label ?? ''} · ${origin}`, shared.variants.map((item) => ({ value: item.id, label: item.label })))}
					onChange={(value) => {
						if (value !== MIXED) set({ variant: value === FROM_THEME ? null : value });
					}}
				/>
			) : null}
			{extras.map((extra) =>
				extra.type === 'colour' ? (
					<ColourRow
						key={extra.name}
						cx={cx}
						id={`skin-extra-${extra.name}`}
						label={extra.name}
						value={sameOf(entities.map((entity) => entity.components.skin?.properties?.[extra.name])) as string | null}
						fallback={typeof extra.default === 'string' ? extra.default : '#ffffff'}
							origin={origin}
						patch={(color) => skinPropertyCommands(cx.project ?? project, ids, { property: { name: extra.name, value: color } })}
					/>
				) : (
					<ScrubField
						key={extra.name}
						id={`skin-extra-${extra.name}`}
						label={extra.name}
						name={extra.name}
						value={Number(sameOf(entities.map((entity) => entity.components.skin?.properties?.[extra.name])) ?? extra.default ?? 0)}
						unit=""
						step={0.01}
						precision={2}
						{...(extra.min != null ? { min: extra.min } : {})}
						{...(extra.max != null ? { max: extra.max } : {})}
						onCommit={(value) => set({ property: { name: extra.name, value } })}
					/>
				)
			)}
		</>
	);
};

function sameOf<T>(values: readonly (T | undefined)[]): T | null {
	const set = new Set(values);
	return set.size === 1 ? (values[0] ?? null) : null;
}

/** Extra properties every selected entity's skin has: a library skin's manifest declares them, the catalog a built-in skin's */
function sharedExtras(project: TProject, entities: TEntity[], items: readonly { id: string; manifest?: { properties?: TAssetProperty[] | undefined } | null }[]): TAssetProperty[] {
	const lists = entities.map((entity) => {
		const library = items.find((item) => item.id === entity.components.skin?.assetId)?.manifest?.properties;
		if (library != null) return library;
		const element = entitySkinElement(entity);
		return element != null ? (catalogSkin(resolveElementLook(project.design, element, entity.components.skin).skin)?.properties ?? []) : [];
	});
	return (lists[0] ?? []).filter((property) => lists.every((list) => list.some((item) => item.name === property.name && item.type === property.type)));
}

/** A colour well with a reset; dragging in the colour picker is one undo step */
const ColourRow: React.FC<{ cx: StudioCx; id: string; label: string; value: string | null; fallback: string; origin: string; patch: (color: string | null) => ReturnType<typeof skinPropertyCommands> }> = (props) => {
	const { cx, id, label, value, fallback, origin, patch } = props;
	const groupRef = React.useRef<number | null>(null);

	function set(color: string | null): void {
		const commands = patch(color);
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
				aria-label={label}
				style={{ boxShadow: 'inset 0 0 0 1px var(--control-border)', borderRadius: 4 }}
				value={value ?? fallback}
				onChange={(event) => set(event.target.value)}
				onBlur={() => {
					groupRef.current = null;
				}}
			/>
			{value != null ? <span className="mm-ifield-value text-[11px] text-[var(--text-secondary)] uppercase">{value}</span> : <span className="mm-ifield-value text-[11px] text-[var(--text-tertiary)]">{origin}</span>}
			{value != null ? (
				<button className="mm-icon-button" onClick={() => set(null)} title={`Use ${origin === 'Default' ? 'the default' : "the theme's"} ${label.toLowerCase()} again`} aria-label={`Reset ${label}`} type="button">
					<RotateCcw size={12} strokeWidth={1.9} />
				</button>
			) : null}
		</span>
	);
};

/** A marble's Skin section in Film: its skin and properties. Its physics never change with its skin. */
export const MarbleSkin: React.FC<{ cx: StudioCx; project: TProject; marble: TEntity }> = (props) => {
	const { cx, project, marble } = props;

	return (
		<Panel id="marble.skin" title="Skin" accessory={<HelpTip text={`${SKIN_HELP} A click applies to this marble, ⌥-click to all marbles. A skin never changes how it falls or bounces.`} />}>
			<SkinPicker cx={cx} project={project} element="marble" pieceType="marble" entities={[marble]} />
			<SkinPropertyRows cx={cx} project={project} entities={[marble]} />
		</Panel>
	);
};
