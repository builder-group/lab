import { isTauri } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import React from 'react';

export function usePlatform() {
	// The browser UI development surface has no OS plugin; it previews the macOS layout
	return React.useMemo(() => (isTauri() ? platform() : 'macos'), []);
}
