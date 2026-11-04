import { ChevronDown, RotateCcw, Sparkles } from 'lucide-react';
import React from 'react';
import { HelpTip, openContextMenu, Panel, TextField, type TMenuEntry } from '@/components';
import type { TProject } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { deleteTheme, duplicateTheme } from '@/modules/studio/commands';
import { themeCommands, themePresets } from './design-commands';
import { NEW_THEME_PROMPT } from './DesignLibraryCx';
import { builtInThemeLabel, projectThemes, renameThemeCommands, resolveTheme, THEME_OVERRIDE_FIELDS, themeDefaultColor, themeOrigin, themeOverrideApplies, themeOverrideCommands, type TResolvedTheme } from './project-themes';
import { canSaveAsTheme, saveAsTheme, ThemeParts } from './SkinProperties';

/**
 * The Scene inspector's Theme section in Film: the current theme's picture and name, which opens the themes as pictures
 * in place, then Duplicate to Edit or Save as Theme and the theme's parts. A click on a card applies it and the grid stays
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
			accessory={<HelpTip text="A theme dresses the whole film: wall, light, marbles and a skin for every piece type. Duplicate a theme to change its colours; Save as Theme keeps the skins you chose." />}
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
						<span className="mm-tile-secondary !p-0">{themeOrigin(theme)}</span>
					</span>
					<ChevronDown size={12} strokeWidth={2} className="shrink-0 text-[var(--text-tertiary)]" style={{ transform: isOpen ? 'rotate(180deg)' : undefined }} />
				</button>
				{isOpen ? <ThemeGrid cx={cx} project={project} /> : null}
			</div>
			<ThemeColors cx={cx} theme={theme} />
			<ThemeParts cx={cx} project={project} />
		</Panel>
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
	const themes = [...themePresets.map((theme) => theme.id), ...projectThemes(project.design).map((theme) => theme.id)].map((id) => resolveTheme(project.design, id));

	function menu(theme: TResolvedTheme): TMenuEntry[] {
		return [
			{ label: 'Apply Theme', disabled: project.design.theme === theme.id, onSelect: () => cx.execute(themeCommands(project, theme.id)) },
			{ label: 'Duplicate Theme', onSelect: () => duplicateTheme(cx, theme.id) },
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
			</div>
			<button className="mm-button w-full" onClick={newThemeWithAgent} title="Describe a look and the agent makes a theme with a skin for every piece type" type="button">
				<Sparkles size={12} strokeWidth={1.8} />
				New Theme with Agent…
			</button>
		</>
	);
};

/**
 * A theme card: the rendered still of its base, the colours a project theme changes as dots in the corner, its name
 * and where it comes from. The context menu has Duplicate Theme, and Rename and Delete Theme for a project theme.
 */
const ThemeCard: React.FC<{
	theme: TResolvedTheme;
	isInUse: boolean;
	isRenaming: boolean;
	onApply: () => void;
	onMenu: () => TMenuEntry[];
	onRename: (name: string) => void;
	onRenameCancel: () => void;
}> = (props) => {
	const { theme, isInUse, isRenaming, onApply, onMenu, onRename, onRenameCancel } = props;
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
				<span className="mm-tile-secondary">{themeOrigin(theme)}</span>
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

/**
 * What the Theme section shows of the applied theme: a project theme's name and, on a Neon base, its Glow; a built-in theme
 * is read-only and offers Duplicate to Edit, like Figma's library styles and Keynote's themes. Once the Wall or Lights
 * layers changed something, Save as Theme makes a theme of that mix. The Wall, Light and Background wells sit on their
 * layers.
 */
const ThemeColors: React.FC<{ cx: StudioCx; theme: TResolvedTheme }> = (props) => {
	const { cx, theme } = props;
	const hasChanges = cx.project != null && canSaveAsTheme(cx.project);
	const save = hasChanges ? (
		<button className="mm-button" data-span="2" onClick={() => saveAsTheme(cx)} title={`Make a theme from ${theme.name} with this project's skins, Wall and Lights`} type="button">
			Save as Theme
		</button>
	) : null;
	if (theme.projectTheme == null) {
		return (
			save ?? (
				<button className="mm-button" data-span="2" onClick={() => duplicateTheme(cx, theme.id)} title={`Make a copy of ${theme.name} in this project to change it`} type="button">
					Duplicate to Edit
				</button>
			)
		);
	}
	return (
		<>
			<TextField
				key={theme.id}
				id="theme-name"
				label="Name"
				span={2}
				name="Name of this project's theme"
				value={theme.name}
				allowEmpty={false}
				onCommit={(name) => {
					const project = cx.project;
					if (project != null) cx.execute(renameThemeCommands(project, theme.id, name));
				}}
			/>
			{THEME_OVERRIDE_FIELDS.filter((field) => field.name === 'glowColor' && themeOverrideApplies(theme.base, field.name)).map((field) => (
				<ThemeColorField key={field.name} cx={cx} theme={theme} field={field} />
			))}
			{save}
		</>
	);
};

/**
 * One theme colour well. Dragging in the colour picker is one undo step: changes fold into the first while it is
 * still the latest edit, until the well loses focus.
 */
const ThemeColorField: React.FC<{ cx: StudioCx; theme: TResolvedTheme; field: (typeof THEME_OVERRIDE_FIELDS)[number] }> = (props) => {
	const { cx, theme, field } = props;
	const groupRef = React.useRef<number | null>(null);
	const value = theme.overrides[field.name];
	const fallback = themeDefaultColor(theme.base, field.name);
	const id = `theme-${field.name}`;

	function set(color: string | null): void {
		const project = cx.project;
		if (project == null) return;
		const commands = themeOverrideCommands(project, theme.id, { [field.name]: color });
		if (!commands.length) return;
		if (color != null && groupRef.current != null && cx.editGroup === groupRef.current) {
			cx.execute(commands, { group: groupRef.current });
			return;
		}
		if (cx.execute(commands)) groupRef.current = color != null ? cx.editGroup : null;
	}

	return (
		<span className="mm-ifield" data-span="2" title={field.help}>
			<label htmlFor={id} className="mm-ifield-label">
				{field.label}
			</label>
			<input
				id={id}
				type="color"
				className="mm-color"
				aria-label={`${field.label} colour`}
				// An outline keeps a light colour such as Neon's pale Light visible on the white panel
				style={{ boxShadow: 'inset 0 0 0 1px var(--control-border)', borderRadius: 4 }}
				value={value ?? fallback ?? '#ffffff'}
				onChange={(event) => set(event.target.value)}
				onBlur={() => {
					groupRef.current = null;
				}}
			/>
			{/* A set colour reads as its hex; an inherited one names where it comes from in normal case, like Figma's style names */}
			{value != null ? (
				<span className="mm-ifield-value text-[11px] text-[var(--text-secondary)] uppercase">{value}</span>
			) : (
				<span className="mm-ifield-value text-[11px] text-[var(--text-tertiary)]">{fallback != null ? `From ${builtInThemeLabel(theme.base) ?? 'the base theme'}` : 'Marble Colour'}</span>
			)}
			{value != null ? (
				<button className="mm-icon-button" onClick={() => set(null)} title={`Use ${builtInThemeLabel(theme.base) ?? 'the base theme'}'s ${field.label.toLowerCase()} again`} aria-label={`Reset ${field.label}`} type="button">
					<RotateCcw size={12} strokeWidth={1.9} />
				</button>
			) : null}
		</span>
	);
};
