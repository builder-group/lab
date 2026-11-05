import { useFeatureState } from 'feature-react/state';
import { RotateCcw } from 'lucide-react';
import React from 'react';
import { addedPacks, isPackAdded } from '@/modules/library';
import { appliedColors, draftMarble, draftPieceColors, draftWall, packThemeCommands, packOriginOf, themeCommands, resolveTheme, THEME_COLOR_FIELDS, themeOrigin, type TResolvedTheme, type TThemeColors } from '@/modules/scene';
import type { TMenuEntry } from '@/components';
import type { TFilm, TProject } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { handChangeCount, resetHandChangesCommands, themePresets } from './film-commands';
import { TilePicker, type TPickerTile } from './TilePicker';

/**
 * The Scene inspector's Theme in Film: one row, the theme's picture and name, which opens the themes in a picker.
 * A theme has nothing to edit: changes are made on the layers, and the row counts them with a Reset that clears them.
 * Packs… exports a look.
 */
export const ThemeRow: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const packs = useFeatureState(addedPacks);
	const theme = resolveTheme(project.film);
	const changes = handChangeCount(project);
	const noColors: TThemeColors = {};
	// A Pack's themes show as the look they'd give the film, with their tile checked while the film wears one
	const packThemes = packs.flatMap((pack) =>
		pack.themes.map((item) => {
			const [command] = packThemeCommands(project, item, packOriginOf(pack));
			const look = (command?.type === 'updateFilm' ? command.film : {}) as Pick<TFilm, 'theme' | 'wall' | 'lights'>;
			return { pack, theme: item, resolved: resolveTheme(look), colors: appliedColors(look) };
		})
	);
	const isWorn = (packId: string, themeId: string): boolean => theme.pack?.packId === packId && theme.pack.themeId === themeId;
	// A Pack this Mac doesn't have can't list the theme the film wears, so it gets a tile of its own
	const wornFromElsewhere = theme.pack != null && !packThemes.some((item) => isWorn(item.pack.id, item.theme.id));

	function resetChanges(): void {
		if (cx.execute(resetHandChangesCommands(project))) cx.notifyEdit(`${changesLabel(changes)} cleared`);
	}

	const tiles: TPickerTile[] = [
		...themePresets.map((item) => {
			const preset = resolveTheme({ theme: { base: item.id } });
			return { ...themeTile(cx, preset, noColors), isCurrent: theme.pack == null && theme.base === item.id, onApply: () => void cx.execute(themeCommands(project, item.id)) };
		}),
		...(wornFromElsewhere ? [{ ...themeTile(cx, theme, appliedColors(project.film)), isCurrent: true, onApply: () => undefined }] : []),
		...packThemes.map(({ pack, theme: item, resolved, colors }) => ({
			...themeTile(cx, resolved, colors),
			key: `${pack.id}:${item.id}`,
			isCurrent: isWorn(pack.id, item.id),
			// Picking the theme the film already wears changes nothing, as with a built-in one: wearing it again would clear the Wall and Lights changes made on it
			onApply: () => (isWorn(pack.id, item.id) ? undefined : void cx.library.applyPackTheme(pack, item)),
			onMenu: (): TMenuEntry[] => [{ label: 'Remove Pack', onSelect: () => void cx.library.removePack(pack) }]
		}))
	];

	return (
			<TilePicker
				id="scene-theme"
				heading="Theme"
				label="Themes"
				current={{ label: theme.name, ...(changes > 0 ? { detail: changesLabel(changes) } : {}), previewUrl: null, thumb: <ThemePicture theme={theme} colors={appliedColors(project.film)} /> }}
				title="Choose another theme"
				tiles={tiles}
				accessory={
					changes > 0 ? (
						<button className="mm-icon-button shrink-0" onClick={resetChanges} title={`Clear ${changesLabel(changes)} and show ${theme.name} as it is`} aria-label={`Reset ${changesLabel(changes)}`} type="button">
							<RotateCcw size={12} strokeWidth={1.9} />
						</button>
					) : null
				}
			/>
	);
};

function changesLabel(count: number): string {
	return `${count} ${count === 1 ? 'change' : 'changes'}`;
}

/** What every theme tile shows: its still, the colors a Pack's theme changes as dots in the corner, its name and origin */
function themeTile(cx: StudioCx, theme: TResolvedTheme, colors: TThemeColors): Pick<TPickerTile, 'key' | 'label' | 'detail' | 'onDetail' | 'previewUrl' | 'thumb' | 'title'> {
	const origin = theme.pack;
	const swatches = THEME_COLOR_FIELDS.flatMap((field) => {
		const color = colors[field.name];
		return color != null ? [{ name: field.label, color }] : [];
	});
	return {
		key: theme.id,
		label: theme.name,
		detail: themeOrigin(theme, isPackAdded),
		onDetail: origin != null && !isPackAdded(origin.packId) ? () => cx.library.openPackCard(origin) : undefined,
		previewUrl: null,
		thumb: (
			<>
				<ThemePicture theme={theme} colors={colors} />
				{swatches.length > 0 ? (
					<span className="absolute top-1 left-1 flex gap-0.5" aria-label={swatches.map((swatch) => `${swatch.name} ${swatch.color}`).join(', ')}>
						{swatches.map((swatch) => (
							<span key={swatch.name} className="h-2.5 w-2.5 rounded-full shadow-[0_0_0_1px_rgb(255_255_255/0.8)]" style={{ background: swatch.color }} />
						))}
					</span>
				) : null}
			</>
		),
		title: themePresets.find((item) => item.id === theme.id)?.description ?? themeOrigin(theme, isPackAdded)
	};
}

/** A theme's rendered still of its base, the Color by Note still when its platforms take their note's color */
const ThemePicture: React.FC<{ theme: TResolvedTheme; colors: TThemeColors }> = ({ theme, colors }) => {
	const preset = themePresets.find((item) => item.id === theme.base);
	if (preset == null) return null;
	if (theme.ownParts != null || (theme.pack != null && colors.wallColor != null)) return <ThemeSketch theme={theme} colors={colors} />;
	return <img alt="" src={theme.parts.platform.colorSource === 'note' ? preset.notePreviewUrl : preset.previewUrl} draggable={false} />;
};

/** A Pack's theme has no rendered still of its own, so its base's would lie: its wall, bars and marble as the Draft Preview draws them */
const ThemeSketch: React.FC<{ theme: TResolvedTheme; colors: TThemeColors }> = ({ theme, colors }) => {
	const wall = draftWall(theme.base, colors).color;
	const { bar } = draftPieceColors(theme.base, { type: 'platform', color: SKETCH_BLUE, skin: null }, colors, theme.ownParts);
	const marble = draftMarble(theme.base, SKETCH_BLUE, colors, theme.parts.marble);
	return (
		<svg viewBox="0 0 48 36" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden>
			<rect width="48" height="36" fill={wall} />
			{SKETCH_BARS.map(([x, y, angle]) => (
				<rect key={y} x={x - 7} y={y - 1.25} width="14" height="2.5" rx="0.5" fill={bar} transform={`rotate(${angle} ${x} ${y})`} />
			))}
			<circle cx="24" cy="11" r="2.5" fill={marble.body} stroke={marble.rim ?? 'none'} strokeWidth="0.5" />
		</svg>
	);
};

const SKETCH_BLUE = '#3478f6';
const SKETCH_BARS = [
	[15, 9, 14],
	[33, 19, -14],
	[15, 29, 14]
] as const;
