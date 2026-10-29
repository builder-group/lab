import { StatusBar } from 'expo-status-bar';
import { useCompute, useListener } from 'feature-react/state';
import { VariableContextProvider } from 'nativewind';
import React from 'react';
import { Appearance, ColorSchemeName, useColorScheme } from 'react-native';
import { themeTokens, toCssVariables, TThemeMode, TThemeTokens } from '@/environment';
import { useSettingsCx } from '@/features/settings';

const ThemeCx = React.createContext<TThemeCx | null>(null);

interface TThemeCx {
	theme: TThemeMode;
	tokens: TThemeTokens;
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const settingsCx = useSettingsCx();
	const systemTheme = useColorScheme();
	const theme = useCompute(
		settingsCx.$settings,
		(value) => {
			const pref = value.appearance.theme;
			return pref === 'system' ? resolveSystemTheme(systemTheme) : pref;
		},
		[systemTheme]
	);

	const { tokens, cssVariables } = React.useMemo(() => {
		const tokens = themeTokens[theme];
		return { tokens, cssVariables: toCssVariables(tokens) };
	}, [theme]);

	// MARK: - Effects

	// Sync native color scheme whenever the setting changes
	useListener(settingsCx.$settings, ({ value }) => {
		const pref = value.appearance.theme;
		Appearance.setColorScheme(pref === 'system' ? 'auto' : pref);
	});

	// MARK: - UI

	return (
		<ThemeCx.Provider value={React.useMemo(() => ({ theme, tokens }), [theme, tokens])}>
			<VariableContextProvider value={cssVariables}>
				<StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
				{children}
			</VariableContextProvider>
		</ThemeCx.Provider>
	);
};

export function useTheme(): TThemeCx {
	const cx = React.useContext(ThemeCx);
	if (cx == null) {
		throw new Error('useTheme must be used within a ThemeProvider');
	}
	return cx;
}

function resolveSystemTheme(systemTheme: ColorSchemeName | null): TThemeMode {
	return systemTheme === 'dark' ? 'dark' : 'light';
}
