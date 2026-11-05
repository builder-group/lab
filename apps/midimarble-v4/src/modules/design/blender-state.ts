import type { TDesignStatus } from './DesignCx';

/** Blender's connection as the logo's tint, the state word and the detail for the tooltip, for the title bar's Blender button */
export interface TBlenderState {
	/** The logo's tint: Blender's orange when it can run (`busy` pulses), red on error, gray when not installed; `off` is a fainter gray, since Blender can't run here, which is expected rather than a problem */
	tone: 'ready' | 'busy' | 'bad' | 'idle' | 'off';
	/** The button shows it only while Blender works */
	label: string;
	detail: string;
}

export function blenderState(status: TDesignStatus, version: string | null, error: string | null = null, isRenderingPreview = false): TBlenderState {
	const name = version != null ? `Blender ${version.split(' ')[0] ?? ''}` : 'Blender';
	// The background preview renders in its own Blender while the worker itself is free
	if (isRenderingPreview && (status === 'ready' || status === 'idle')) {
		return { tone: 'busy', label: 'Rendering Preview', detail: `${name}: rendering the preview in the background…` };
	}
	switch (status) {
		case 'unavailable':
			return { tone: 'off', label: 'Blender', detail: 'Blender connects in the desktop app' };
		case 'missing':
			return { tone: 'idle', label: 'Not Installed', detail: "Blender isn't installed. Install Blender 4.2 or later to preview and export films." };
		case 'starting':
			return { tone: 'busy', label: 'Starting', detail: 'Starting Blender…' };
		case 'syncing':
			return { tone: 'busy', label: 'Rendering Preview', detail: `${name}: updating the scene…` };
		case 'rendering':
			return { tone: 'busy', label: 'Rendering Preview', detail: `${name}: rendering the preview…` };
		case 'ready':
			return { tone: 'ready', label: 'Ready', detail: `${name} is connected` };
		case 'error':
			return { tone: 'bad', label: 'Error', detail: error != null ? `${name} reported a problem: ${error}` : `${name} reported a problem` };
		case 'idle':
			return { tone: 'ready', label: 'Ready', detail: `${name} starts when you open Film or the scene` };
	}
}
