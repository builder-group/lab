import { useFeatureState } from 'feature-react/state';
import { RotateCcw } from 'lucide-react';
import React from 'react';
import { addedPacks, isPackAdded, packOriginOf } from '@/modules/library';
import type { TMenuEntry } from '@/components';
import type { TProject } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { deleteTheme } from '@/modules/studio/commands';
import { draftMarble, draftPieceColors, draftWall } from './draft-look';
import { handChangeCount, resetHandChangesCommands, themeCommands, themePresets } from './design-commands';
import { projectThemes, renameThemeCommands, resolveTheme, THEME_OVERRIDE_FIELDS, themeOrigin, type TResolvedTheme } from './project-themes';
import { TilePicker, type TPickerTile } from './TilePicker';

/**
 * The Scene inspector's Theme in Film: one row, the theme's picture and name, which opens the themes in a picker.
 * A theme has nothing to edit: changes are made on the layers, and the row counts them with a Reset that clears them.
 * Export Pack… keeps a look.
 */
export const ThemeRow: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const [renamingId, setRenamingId] = React.useState<string | null>(null);
	const packs = useFeatureState(addedPacks);
	const theme = resolveTheme(project.design);
	const changes = handChangeCount(project);
	const own = projectThemes(project.design);
	const themes = [...themePresets.map((item) => item.id), ...own.map((item) => item.id)].map((id) => resolveTheme(project.design, id));
	// A Pack's themes join the project when applied; one already in it shows as the project's
	const packThemes = packs.flatMap((pack) =>
		pack.themes.filter((item) => !own.some((theirs) => theirs.id === item.id)).map((item) => ({ pack, theme: item, resolved: resolveTheme({ theme: project.design.theme, themes: [{ ...item, pack: packOriginOf(pack) }] }, item.id) }))
	);

	/** A project theme's own: a click on the tile applies any theme */
	function menu(item: TResolvedTheme): TMenuEntry[] {
		return [
			{ label: 'Rename', onSelect: () => setRenamingId(item.id) },
			{ label: 'Delete Theme', onSelect: () => deleteTheme(cx, item.id) }
		];
	}

	function resetChanges(): void {
		if (cx.execute(resetHandChangesCommands(project))) cx.notifyEdit(`${changesLabel(changes)} cleared`);
	}

	const tiles: TPickerTile[] = [
		...themes.map((item) => ({
			...themeTile(cx, item),
			isCurrent: project.design.theme === item.id,
			onApply: () => {
				cx.execute(themeCommands(project, item.id));
			},
			...(item.projectTheme != null ? { onMenu: () => menu(item) } : {}),
			...(renamingId === item.id
				? {
						nameField: (
							<ThemeNameField
								name={item.name}
								onCommit={(name) => {
									setRenamingId(null);
									cx.execute(renameThemeCommands(project, item.id, name));
								}}
								onCancel={() => setRenamingId(null)}
							/>
						)
					}
				: {})
		})),
		...packThemes.map(({ pack, theme: item, resolved }) => ({
			...themeTile(cx, resolved),
			key: `${pack.id}:${item.id}`,
			isCurrent: false,
			onApply: () => void cx.library.applyPackTheme(pack, item),
			onMenu: (): TMenuEntry[] => [{ label: 'Remove Pack', onSelect: () => void cx.library.removePack(pack) }]
		}))
	];

	return (
			<TilePicker
				id="scene-theme"
				heading="Theme"
				label="Themes"
				current={{ label: theme.name, ...(changes > 0 ? { detail: changesLabel(changes) } : {}), previewUrl: null, thumb: <ThemePicture theme={theme} /> }}
				title="Choose another theme"
				tiles={tiles}
				accessory={
					changes > 0 ? (
						<button className="mm-icon-button shrink-0" onClick={resetChanges} title={`Clear ${changesLabel(changes)} and show ${theme.name} as it is`} aria-label={`Reset ${changesLabel(changes)}`} type="button">
							<RotateCcw size={12} strokeWidth={1.9} />
						</button>
					) : null
				}
				footer={
					<>
						<button className="mm-button w-full" onClick={() => cx.library.openExportPack()} title="Keep this look as a theme in a Pack, with chosen skins and decor" type="button">
							Export Pack…
						</button>
					</>
				}
			/>
	);
};

function changesLabel(count: number): string {
	return `${count} ${count === 1 ? 'change' : 'changes'}`;
}

/** What every theme tile shows: its still, the colors a project theme changes as dots in the corner, its name and origin */
function themeTile(cx: StudioCx, theme: TResolvedTheme): Pick<TPickerTile, 'key' | 'label' | 'detail' | 'onDetail' | 'previewUrl' | 'thumb' | 'title'> {
	const origin = theme.projectTheme?.pack;
	const swatches = THEME_OVERRIDE_FIELDS.flatMap((field) => {
		const color = theme.overrides[field.name];
		return color != null ? [{ name: field.label, color }] : [];
	});
	return {
		key: theme.id,
		label: theme.name,
		detail: themeOrigin(theme),
		onDetail: origin != null && !isPackAdded(origin.packId) ? () => cx.library.openPackCard(origin) : undefined,
		previewUrl: null,
		thumb: (
			<>
				<ThemePicture theme={theme} />
				{swatches.length > 0 ? (
					<span className="absolute top-1 left-1 flex gap-0.5" aria-label={swatches.map((swatch) => `${swatch.name} ${swatch.color}`).join(', ')}>
						{swatches.map((swatch) => (
							<span key={swatch.name} className="h-2.5 w-2.5 rounded-full shadow-[0_0_0_1px_rgb(255_255_255/0.8)]" style={{ background: swatch.color }} />
						))}
					</span>
				) : null}
			</>
		),
		title: themePresets.find((item) => item.id === theme.id)?.description ?? themeOrigin(theme)
	};
}

/** A theme's rendered still of its base, the Color by Note still when its platforms take their note's color */
const ThemePicture: React.FC<{ theme: TResolvedTheme }> = ({ theme }) => {
	const preset = themePresets.find((item) => item.id === theme.base);
	if (preset == null) return null;
	if (theme.projectTheme != null && (theme.overrides.wallColor != null || theme.projectTheme.parts != null)) return <ThemeSketch theme={theme} />;
	return <img alt="" src={theme.parts.platform.colorSource === 'note' ? preset.notePreviewUrl : preset.previewUrl} draggable={false} />;
};

/** A project theme has no rendered still of its own, so its base's would lie: its wall, bars and marble as the Draft Preview draws them */
const ThemeSketch: React.FC<{ theme: TResolvedTheme }> = ({ theme }) => {
	const wall = draftWall(theme.base, theme.overrides).color;
	const { bar } = draftPieceColors(theme.base, { type: 'platform', color: SKETCH_BLUE, skin: null }, false, theme.overrides, theme.projectTheme?.parts);
	const marble = draftMarble(theme.base, SKETCH_BLUE, theme.overrides, theme.parts.marble);
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

/** Inline rename of a project theme's tile, like Finder: Return keeps the name, Escape cancels */
const ThemeNameField: React.FC<{ name: string; onCommit: (name: string) => void; onCancel: () => void }> = (props) => {
	const { name, onCommit, onCancel } = props;
	const [value, setValue] = React.useState(name);
	return (
		<input
			className="mm-input mt-0.5 w-full"
			aria-label="Theme name"
			autoFocus
			value={value}
			onFocus={(event) => event.currentTarget.select()}
			onChange={(event) => setValue(event.target.value)}
			onBlur={() => onCommit(value)}
			onKeyDown={(event) => {
				if (event.key === 'Enter') onCommit(value);
				if (event.key === 'Escape') {
					event.stopPropagation();
					onCancel();
				}
				event.stopPropagation();
			}}
		/>
	);
};
