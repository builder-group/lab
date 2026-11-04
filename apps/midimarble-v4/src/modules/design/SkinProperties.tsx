import { useFeatureState } from 'feature-react/state';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import React from 'react';
import { HelpTip, LinkRow, Panel, ScrubField, SelectField } from '@/components';
import type { TAssetProperty } from '@/modules/library/asset-manifest';
import type { TEntity, TProject } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { setSidebarTab } from '@/modules/studio/sidebar-state';
import { followThemeSkinCommands, resetToThemeCommands, skinCommands, skinPropertyCommands, skinsForElement, type TSkinPropertyPatch } from './design-commands';
import { marbleContrastWarning } from './draft-look';
import { appliedOverrides, hasSkinChoices, hasLayerChanges, resolveElementLook, resolveTheme, saveAsThemeCommands } from './project-themes';
import { builtInSkinLabel, catalogSkin, COLOUR_LABELS, elementPlural, entitySkinElement, ON_HIT_LABELS, sharedSkinProperties, SKIN_ELEMENTS, type TSkinElement, type TSkinLook } from './skin-catalog';

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
	const extras = sharedExtras(entities, [...projectItems, ...globalItems]);

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

	return (
		<>
			{shared.colours.length > 1 ? (
				<SelectField
					id="skin-colour"
					label="Colour"
					value={valueOf('colour')}
					options={options(valueOf('colour'), first != null ? `${COLOUR_LABELS[first.look.colour]} · Default` : 'Default', shared.colours.map((colour) => ({ value: colour, label: COLOUR_LABELS[colour] })))}
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
					options={options(valueOf('onHit'), first != null ? `${ON_HIT_LABELS[first.look.onHit ?? firstSkin?.reacts ?? 'none']} · Default` : 'Default', shared.onHit.map((onHit) => ({ value: onHit, label: ON_HIT_LABELS[onHit] })))}
					onChange={(value) => {
						if (value !== MIXED) set({ onHit: value === FROM_THEME ? null : (value as NonNullable<TSkinPropertyPatch['onHit']>) });
					}}
				/>
			) : null}
			{shared.glowColor ? <ColourRow cx={cx} id="skin-glow" label="Glow Colour" value={sameOf(entities.map((entity) => entity.components.skin?.glowColor))} fallback={first?.look.glowColor ?? '#ffffff'} patch={(color) => skinPropertyCommands(cx.project ?? project, ids, { glowColor: color })} /> : null}
			{shared.variants.length > 0 ? (
				<SelectField
					id="skin-variant"
					label="Variant"
					value={valueOf('variant')}
					options={options(valueOf('variant'), `${shared.variants.find((item) => item.id === firstSkin?.variant)?.label ?? ''} · Default`, shared.variants.map((item) => ({ value: item.id, label: item.label })))}
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

/** Extra properties every selected entity's library skin declares */
function sharedExtras(entities: TEntity[], items: readonly { id: string; manifest?: { properties?: TAssetProperty[] | undefined } | null }[]): TAssetProperty[] {
	const lists = entities.map((entity) => items.find((item) => item.id === entity.components.skin?.assetId)?.manifest?.properties ?? []);
	return (lists[0] ?? []).filter((property) => lists.every((list) => list.some((item) => item.name === property.name && item.type === property.type)));
}

/** A colour well with a reset; dragging in the colour picker is one undo step */
const ColourRow: React.FC<{ cx: StudioCx; id: string; label: string; value: string | null; fallback: string; patch: (color: string | null) => ReturnType<typeof skinPropertyCommands> }> = (props) => {
	const { cx, id, label, value, fallback, patch } = props;
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
			{value != null ? <span className="mm-ifield-value text-[11px] text-[var(--text-secondary)] uppercase">{value}</span> : <span className="mm-ifield-value text-[11px] text-[var(--text-tertiary)]">Default</span>}
			{value != null ? (
				<button className="mm-icon-button" onClick={() => set(null)} title={`Use the default ${label.toLowerCase()} again`} aria-label={`Reset ${label}`} type="button">
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

/** A marble's look in Film: its skin and properties. Its physics never change with its skin. */
export const MarbleLook: React.FC<{ cx: StudioCx; project: TProject; marble: TEntity }> = (props) => {
	const { cx, project, marble } = props;
	const look = resolveElementLook(project.design, 'marble', marble.components.skin);
	const skins = skinsForElement(project.design, 'marble');
	const own = marble.components.skin?.assetId;
	const theme = resolveTheme(project.design);
	const warning = marbleContrastWarning(theme.base, appliedOverrides(project.design), [{ name: marble.name ?? 'This', color: marble.components.marble?.color ?? '#d0d4dc', skin: look }]);

	return (
		<Panel id="marble.look" title="Look" accessory={<HelpTip text="How this marble looks in the film. The skin never changes how it falls or bounces. Open the Library to see every marble skin." />}>
			<SelectField
				id="marble-skin"
				label="Skin"
				value={own ?? FROM_THEME}
				options={[{ value: FROM_THEME, label: `${builtInSkinLabel(theme.parts.marble.skin) ?? 'Theme'} · Default` }, ...skins.map((skin) => ({ value: skin.id, label: skin.label }))]}
				onChange={(value) => cx.execute(value === FROM_THEME ? followThemeSkinCommands(project, [marble.id]) : skinCommands(project, { kind: 'entities', entityIds: [marble.id] }, value))}
			/>
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

/** The theme's parts as a simple list; each row opens the Library's skins for that element type */
export const ThemeParts: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const theme = resolveTheme(project.design);

	function open(element: TSkinElement): void {
		cx.library.$filterElement.set(element);
		setSidebarTab('design', 'library');
	}

	return (
		<>
			{SKIN_ELEMENTS.map((element) => (
				<LinkRow key={element} icon={null} title={`Show ${elementPlural(element).toLowerCase()} skins in the Library`} onOpen={() => open(element)}>
					{partLabel(element, theme.parts[element])}
				</LinkRow>
			))}
		</>
	);
};

function partLabel(element: TSkinElement, look: TSkinLook): string {
	return `${elementPlural(element)}: ${builtInSkinLabel(look.skin) ?? look.skin}`;
}

/** Whether Save as Theme has something to store: the Wall and Lights layers' changes or skin choices */
export function canSaveAsTheme(project: TProject): boolean {
	return hasLayerChanges(project.design) || hasSkinChoices(project);
}

/** Save as Theme for a button or ⌘K, with the notice */
export function saveAsTheme(cx: StudioCx): void {
	const project = cx.project;
	if (project == null) return;
	const { commands, themeId } = saveAsThemeCommands(project);
	if (!cx.execute(commands)) return;
	const name = cx.project != null ? resolveTheme(cx.project.design, themeId).name : 'a theme';
	cx.notifyEdit(`Saved as ${name}`);
}
