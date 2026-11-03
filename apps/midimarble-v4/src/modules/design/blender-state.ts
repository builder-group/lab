import type { TDesignStatus } from './DesignCx';

/** Blender's connection as a dot, one word and the detail for the tooltip, for the title bar's Blender chip */
export interface TBlenderState {
	/** `off` draws a hollow dot: Blender can't run here, which is expected rather than a problem */
	tone: 'good' | 'bad' | 'busy' | 'idle' | 'off';
	label: string;
	detail: string;
}

export function blenderState(status: TDesignStatus, version: string | null, error: string | null = null): TBlenderState {
	const name = version != null ? `Blender ${version.split(' ')[0] ?? ''}` : 'Blender';
	switch (status) {
		case 'unavailable':
			return { tone: 'off', label: 'Blender', detail: 'Blender connects in the desktop app' };
		case 'missing':
			return { tone: 'bad', label: 'Not Installed', detail: "Blender isn't installed. Install Blender 4.2 or later to preview and export films." };
		case 'starting':
			return { tone: 'busy', label: 'Starting', detail: 'Starting Blender…' };
		case 'syncing':
			return { tone: 'busy', label: 'Rendering Preview', detail: `${name}: updating the scene…` };
		case 'rendering':
			return { tone: 'busy', label: 'Rendering Preview', detail: `${name}: rendering the preview…` };
		case 'ready':
			return { tone: 'good', label: 'Ready', detail: `${name} is connected` };
		case 'error':
			return { tone: 'bad', label: 'Error', detail: error != null ? `${name} reported a problem: ${error}` : `${name} reported a problem` };
		case 'idle':
			return { tone: 'idle', label: 'Ready', detail: `${name} starts when you open Film or the scene` };
	}
}
