import { requireNativeView } from 'expo';
import React from 'react';
import { useColorScheme, type ViewProps } from 'react-native';

export const DurationPickerView: React.FC<TDurationPickerViewProps> = (props) => {
	const colorScheme = useColorScheme() ?? 'light';
	return <NativeDurationPickerView {...props} colorScheme={colorScheme} />;
};

export interface TDurationPickerViewProps extends ViewProps {
	hours: number;
	minutes: number;
	seconds: number;
	// Extra spacing between hour/min/sec groups, valid range 0...20 on iOS.
	groupSpacing?: number;
	// Spacing between the number and its unit label, valid range 0...20 on iOS.
	valueToUnitSpacing?: number;
	onDurationChange?: (event: { nativeEvent: TDurationPickerChangeEvent }) => void;
}

export interface TDurationPickerChangeEvent {
	hours: number;
	minutes: number;
	seconds: number;
}

const NativeDurationPickerView = requireNativeView<TNativeProps>('DurationPicker');

interface TNativeProps extends TDurationPickerViewProps {
	colorScheme: string;
}
