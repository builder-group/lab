import { useFeatureState } from 'feature-react/state';
import { ChevronDown, Sparkles } from 'lucide-react';
import React from 'react';
import { addedPacks, isPackAdded, packOriginOf } from '@/modules/library';
import { HelpTip, openContextMenu, Panel, type TMenuEntry } from '@/components';
import type { TProject } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { deleteTheme } from '@/modules/studio/commands';
import { THEME_HELP } from './concept-words';
import { themeCommands, themePresets } from './design-commands';
import { NEW_THEME_PROMPT } from './DesignLibraryCx';
import { projectThemes, renameThemeCommands, resolveTheme, THEME_OVERRIDE_FIELDS, themeOrigin, type TResolvedTheme } from './project-themes';
import { saveAsTheme, ThemeParts } from './SkinProperties';

/**
 * The Scene inspector's Theme section in Film: the current theme's picture and name, which opens the themes as pictures
 * in place, then Save as Theme, the one way to change a theme, and the theme's parts. A click on a card applies it and the grid stays
 * open, so themes can be compared. Escape closes it.
 */
export const ThemePanel: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const [isOpen, setIsOpen] = React.useState(false);
	const theme = resolveTheme(project.design);
	return (
		<Panel
			id="design.theme"
			title="Theme"
			accessory={<HelpTip text={`${THEME_HELP} Change a skin, the Wall or the Lights, then Save as Theme keeps it as a theme of your own.`} />}
		>
			<div
				className="flex flex-col gap-2"
				data-span="2"
				onKeyDown={(event) => {
					if (event.key !== 'Escape' || !isOpen) return;
					event.stopPropagation();
					setIsOpen(false);
				}}
			>
				<button className="mm-theme-current" aria-expanded={isOpen} title={isOpen ? 'Close the themes' : 'Choose another theme'} onClick={() => setIsOpen(!isOpen)} type="button">
					<span className="mm-tile-thumb mm-theme-current-thumb">
						<ThemePicture theme={theme} />
					</span>
					<span className="flex min-w-0 flex-1 flex-col text-left">
						<span className="truncate font-medium">{theme.name}</span>
						{themeOrigin(theme).length > 0 ? <ThemeOriginLine cx={cx} theme={theme} className="!p-0" /> : null}
					</span>
					<ChevronDown size={12} strokeWidth={2} className="shrink-0 text-[var(--text-tertiary)]" style={{ transform: isOpen ? 'rotate(180deg)' : undefined }} />
				</button>
				{isOpen ? <ThemeGrid cx={cx} project={project} /> : null}
			</div>
			<button className="mm-button" data-span="2" onClick={() => saveAsTheme(cx)} title={`Make a theme from ${theme.name} with this project's skins, Wall and Lights`} type="button">
				Save as Theme
			</button>
			<ThemeParts cx={cx} project={project} />
		</Panel>
	);
};

/** A theme's origin line; one that reads "Not Added" opens that Pack's card */
const ThemeOriginLine: React.FC<{ cx: StudioCx; theme: TResolvedTheme; className?: string }> = ({ cx, theme, className = '' }) => {
	const origin = theme.projectTheme?.pack;
	const opensCard = origin != null && !isPackAdded(origin.packId);
	return (
		<span
			className={`mm-tile-secondary ${className} ${opensCard ? 'underline' : ''}`}
			onClick={
				opensCard
					? (event) => {
							event.stopPropagation();
							cx.library.openPackCard(origin);
						}
					: undefined
			}
		>
			{themeOrigin(theme)}
		</span>
	);
};

/** A theme's rendered still of its base, the Colour by Note still when its platforms take their note's colour */
const ThemePicture: React.FC<{ theme: TResolvedTheme }> = ({ theme }) => {
	const preset = themePresets.find((item) => item.id === theme.base);
	if (preset == null) return null;
	return <img alt="" src={theme.parts.platform.colour === 'note' ? preset.notePreviewUrl : preset.previewUrl} draggable={false} />;
};

/** Built-in themes first, then the project's own with where they come from */
const ThemeGrid: React.FC<{ cx: StudioCx; project: TProject }> = (props) => {
	const { cx, project } = props;
	const [renamingId, setRenamingId] = React.useState<string | null>(null);
	const packs = useFeatureState(addedPacks);
	const themes = [...themePresets.map((theme) => theme.id), ...projectThemes(project.design).map((theme) => theme.id)].map((id) => resolveTheme(project.design, id));
	// A Pack's themes join the project when applied; one already in it shows as the project's
	const packThemes = packs.flatMap((pack) =>
		pack.themes
			.filter((theme) => !projectThemes(project.design).some((own) => own.id === theme.id))
			.map((theme) => ({ pack, theme, resolved: resolveTheme({ theme: project.design.theme, themes: [{ ...theme, pack: packOriginOf(pack) }] }, theme.id) }))
	);

	function menu(theme: TResolvedTheme): TMenuEntry[] {
		return [
			{ label: 'Apply Theme', disabled: project.design.theme === theme.id, onSelect: () => cx.execute(themeCommands(project, theme.id)) },
			...(theme.projectTheme != null
				? [
						'separator' as const,
						{ label: 'Rename', onSelect: () => setRenamingId(theme.id) },
						{ label: 'Delete Theme', onSelect: () => deleteTheme(cx, theme.id) }
					]
				: [])
		];
	}

	function newThemeWithAgent(): void {
		// One run per piece type: each makes the new theme's skin for that type, which Accept puts on every piece of it
		const seen = new Set<string>();
		const mentionIds = project.entities.flatMap((entity) => {
			const type = entity.components.piece?.type;
			if (type == null || seen.has(type)) return [];
			seen.add(type);
			return [entity.id];
		});
		cx.openAgent({ text: NEW_THEME_PROMPT, mentionIds: mentionIds.length > 0 ? mentionIds : ['scene'] });
	}

	return (
		<>
			<div className="mm-tile-grid mm-theme-tiles" role="list" aria-label="Themes">
				{themes.map((theme) => (
					<ThemeCard
						cx={cx}
						key={theme.id}
						theme={theme}
						isInUse={project.design.theme === theme.id}
						isRenaming={renamingId === theme.id}
						onApply={() => cx.execute(themeCommands(project, theme.id))}
						onMenu={() => menu(theme)}
						onRename={(name) => {
							setRenamingId(null);
							cx.execute(renameThemeCommands(project, theme.id, name));
						}}
						onRenameCancel={() => setRenamingId(null)}
					/>
				))}
				{packThemes.map(({ pack, theme, resolved }) => (
					<ThemeCard
						cx={cx}
						key={`${pack.id}:${theme.id}`}
						theme={resolved}
						isInUse={false}
						isRenaming={false}
						onApply={() => void cx.library.applyPackTheme(pack, theme)}
						onMenu={() => [
							{ label: 'Apply Theme', onSelect: () => void cx.library.applyPackTheme(pack, theme) },
							'separator',
							{ label: 'Remove Pack', onSelect: () => void cx.library.removePack(pack) }
						]}
						onRename={() => undefined}
						onRenameCancel={() => undefined}
					/>
				))}
			</div>
			<button className="mm-button w-full" onClick={newThemeWithAgent} title="Describe a theme and the agent makes it, with a skin for every piece type" type="button">
				<Sparkles size={12} strokeWidth={1.8} />
				New Theme with Agent…
			</button>
			<div className="flex gap-1.5">
				<button className="mm-button flex-1" onClick={() => cx.library.$isAddPackOpen.set(true)} title="Browse Packs of themes, skins and decor. Adding one changes nothing in your project." type="button">
					Add Pack…
				</button>
				<button className="mm-button flex-1" onClick={() => cx.library.$exportPack.set({ name: resolveTheme(project.design).name, includesTheme: true, assetIds: [] })} title="Export this theme, or chosen skins and decor, as a Pack" type="button">
					Export Pack…
				</button>
			</div>
		</>
	);
};

/**
 * A theme card: the rendered still of its base, the colours a project theme changes as dots in the corner, its name
 * and where it comes from. The context menu has Rename and Delete Theme for a project theme.
 */
const ThemeCard: React.FC<{
	cx: StudioCx;
	theme: TResolvedTheme;
	isInUse: boolean;
	isRenaming: boolean;
	onApply: () => void;
	onMenu: () => TMenuEntry[];
	onRename: (name: string) => void;
	onRenameCancel: () => void;
}> = (props) => {
	const { cx, theme, isInUse, isRenaming, onApply, onMenu, onRename, onRenameCancel } = props;
	const description = themePresets.find((item) => item.id === theme.id)?.description ?? themeOrigin(theme);
	const swatches = THEME_OVERRIDE_FIELDS.flatMap((field) => {
		const color = theme.overrides[field.name];
		return color != null ? [{ name: field.label, color }] : [];
	});
	return (
		<div className="mm-tile-wrap" role="listitem">
			<button className="mm-tile" data-applied={isInUse} aria-pressed={isInUse} title={description} onClick={onApply} onContextMenu={(event) => openContextMenu(event, onMenu())} type="button">
				<span className="mm-tile-thumb mm-tile-thumb-square">
					<ThemePicture theme={theme} />
					{swatches.length > 0 ? (
						<span className="absolute top-1 left-1 flex gap-0.5" aria-label={swatches.map((swatch) => `${swatch.name} ${swatch.color}`).join(', ')}>
							{swatches.map((swatch) => (
								<span key={swatch.name} className="h-2.5 w-2.5 rounded-full shadow-[0_0_0_1px_rgb(255_255_255/0.8)]" style={{ background: swatch.color }} />
							))}
						</span>
					) : null}
				</span>
				{isRenaming ? null : <span className="mm-tile-label">{theme.name}</span>}
				{themeOrigin(theme).length > 0 ? <ThemeOriginLine cx={cx} theme={theme} /> : null}
			</button>
			{isRenaming ? <ThemeNameField name={theme.name} onCommit={onRename} onCancel={onRenameCancel} /> : null}
		</div>
	);
};

/** Inline rename of a project theme's card, like Finder: Return keeps the name, Escape cancels */
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
				if (event.key === 'Escape') onCancel();
				event.stopPropagation();
			}}
		/>
	);
};
