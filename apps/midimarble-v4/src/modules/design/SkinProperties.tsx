import { useFeatureState } from 'feature-react/state';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import React from 'react';
import { HelpTip, LinkRow, NoteRow, Panel, ScrubField, SelectField } from '@/components';
import type { TAssetProperty } from '@/modules/library/asset-manifest';
import type { TEntity, TProject } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { resetToThemeCommands, skinPropertyCommands, type TSkinPropertyPatch } from './design-commands';
import { marbleContrastWarning } from './draft-look';
import { appliedOverrides, resolveElementLook, resolveTheme, saveAsThemeCommands } from './project-themes';
import { SKIN_HELP } from './concept-words';
import { themeOriginLabel } from './scene-layers';
import { SkinTiles } from './LookTiles';
import { catalogSkin, COLOUR_LABELS, elementPlural, entitySkinElement, ON_HIT_LABELS, sharedSkinProperties } from './skin-catalog';
import { themePartRows } from './skin-tiles';

// The standard skin properties in the Look panel, the same rows for pieces and marbles, and a theme's parts as a list.

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

	return (
		<>
			{shared.colours.length > 1 ? (
				<SelectField
					id="skin-colour"
					label="Colour"
					value={valueOf('colour')}
					options={options(valueOf('colour'), first != null ? `${COLOUR_LABELS[first.look.colour]} · ${origin}` : origin, shared.colours.map((colour) => ({ value: colour, label: COLOUR_LABELS[colour] })))}
					onChange={(value) => {
						if (value !== MIXED) set({ colour: value === FROM_THEME ? null : (value as NonNullable<TSkinPropertyPatch['colour']>) });
					}}
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

/** Reset to Theme: for a selection with a skin, a property or an old reaction of its own */
export const ResetToTheme: React.FC<{ cx: StudioCx; project: TProject; entities: TEntity[] }> = (props) => {
	const { cx, project, entities } = props;
	const commands = resetToThemeCommands(project, entities.map((entity) => entity.id));
	if (!commands.length) return null;
	return (
		<button className="mm-button" data-span="2" onClick={() => cx.execute(commands)} title={`Show ${resolveTheme(project.design).name}'s skin and properties again`} type="button">
			<RotateCcw size={12} strokeWidth={1.9} />
			Reset to Theme
		</button>
	);
};

/** A marble's Look section in Film: its skin and properties. Its physics never change with its skin. */
export const MarbleLook: React.FC<{ cx: StudioCx; project: TProject; marble: TEntity }> = (props) => {
	const { cx, project, marble } = props;
	const look = resolveElementLook(project.design, 'marble', marble.components.skin);
	const theme = resolveTheme(project.design);
	const warning = marbleContrastWarning(theme.base, appliedOverrides(project.design), [{ name: marble.name ?? 'This', color: marble.components.marble?.color ?? '#d0d4dc', skin: look }]);

	return (
		<Panel id="marble.look" title="Look" accessory={<HelpTip text={`${SKIN_HELP} A click applies to this marble, ⌥-click to all marbles. A skin never changes how it falls or bounces.`} />}>
			<SkinTiles cx={cx} project={project} element="marble" pieceType="marble" entities={[marble]} />
			<SkinPropertyRows cx={cx} project={project} entities={[marble]} />
			<ResetToTheme cx={cx} project={project} entities={[marble]} />
			{warning != null ? (
				<span className="flex items-start gap-1 text-[11px] text-[var(--text-secondary)]" data-span="2" role="status">
					<TriangleAlert size={12} strokeWidth={1.8} className="mt-px shrink-0 text-[var(--warn)]" aria-hidden />
					{warning}
				</span>
			) : null}
		</Panel>
	);
};

/** The theme's parts as the film shows them; each row selects that element's first piece, whose Look holds its skins */
export const ThemeParts: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const projectItems = useFeatureState(cx.library.$projectItems);
	const globalItems = useFeatureState(cx.library.$globalItems);
	const libraryLabel = (id: string): string | null => [...projectItems, ...globalItems].find((item) => item.id === id)?.manifest?.label ?? null;

	return (
		<>
			{themePartRows(project, libraryLabel).map((row) =>
				row.entityId != null ? (
					<LinkRow key={row.element} icon={null} title={`Select the first of the ${elementPlural(row.element).toLowerCase()} to change its skin`} onOpen={() => cx.reveal([row.entityId as string])}>
						{row.label}
					</LinkRow>
				) : (
					<NoteRow key={row.element}>{row.label}</NoteRow>
				)
			)}
		</>
	);
};

/** Save as Theme for a button or ⌘K, with the notice */
export function saveAsTheme(cx: StudioCx, chosenName?: string): void {
	const project = cx.project;
	if (project == null) return;
	const { commands, themeId } = saveAsThemeCommands(project, chosenName);
	if (!cx.execute(commands)) return;
	const name = cx.project != null ? resolveTheme(cx.project.design, themeId).name : 'a theme';
	cx.notifyEdit(`Saved as ${name}`);
}
