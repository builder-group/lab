import type { TThemeOverrides } from '@/modules/project';
import { draftMarble, draftPieceColors, draftWall, type TDraftColors, type TDraftMarble } from './draft-look';
import { isBuiltInTheme, THEME_OVERRIDE_FIELDS, themeDefaultColor } from './project-themes';

// A theme drawn in its own colours for the agent's New Theme Result card: the Draft Preview's flat look of a wall,
// a few platforms and a marble, so the card shows the theme rather than one piece's skin

export interface TThemePreview {
	wall: string;
	/** Peg holes of Pegboard's hardboard, null for a plain wall */
	holes: string | null;
	/** The key light's colour, a soft wash from the top */
	light: string | null;
	platforms: TDraftColors[];
	marble: TDraftMarble;
	/** Neon's glowing edges, null for themes without them */
	glow: string | null;
}

export interface TThemeSwatch {
	label: string;
	color: string;
}

/** The theme's look with `marbleColors`, the project's marble colours, for its pieces and the marble */
export function themePreview(base: string, overrides: TThemeOverrides, marbleColors: readonly string[]): TThemePreview {
	const theme = isBuiltInTheme(base) ? base : 'pegboard';
	const colors = marbleColors.length > 0 ? marbleColors : [DEFAULT_MARBLE];
	const wall = draftWall(theme, overrides);
	const platforms = [0, 1, 2].map((index) =>
		draftPieceColors(theme, { type: 'platform', color: colors[index % colors.length] ?? DEFAULT_MARBLE, skin: null }, false, overrides)
	);
	return {
		wall: wall.color,
		holes: wall.holes ?? null,
		light: overrides.lightColor ?? null,
		platforms,
		marble: draftMarble(theme, colors[0] ?? DEFAULT_MARBLE, overrides),
		glow: theme === 'neon' ? (overrides.glowColor ?? colors[0] ?? DEFAULT_MARBLE) : null
	};
}

/** The colours the theme sets, with its base's for the rest, as the swatches beside its name */
export function themeSwatches(base: string, overrides: TThemeOverrides): TThemeSwatch[] {
	return THEME_OVERRIDE_FIELDS.flatMap((field) => {
		const color = overrides[field.name] ?? themeDefaultColor(base, field.name);
		return color != null ? [{ label: field.label, color }] : [];
	});
}

const DEFAULT_MARBLE = '#e0533d';
