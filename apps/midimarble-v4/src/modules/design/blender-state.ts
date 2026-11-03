import type { TDesignStatus } from './DesignCx';

/** Blender's connection as a dot, a short label and the detail for the tooltip, for the inspector's top bar */
export interface TBlenderState {
	tone: 'good' | 'warn' | 'bad' | 'busy' | 'idle';
	label: string;
	detail: string;
}

export function blenderState(status: TDesignStatus, version: string | null): TBlenderState {
	const name = version != null ? `Blender ${version.split(' ')[0] ?? ''}` : 'Blender';
	switch (status) {
		case 'unavailable':
			return { tone: 'idle', label: 'Blender', detail: 'Blender connects in the desktop app' };
		case 'missing':
			return { tone: 'bad', label: 'No Blender', detail: 'Blender was not found. Install it in Applications.' };
		case 'starting':
			return { tone: 'busy', label: 'Blender', detail: 'Starting Blender…' };
		case 'syncing':
			return { tone: 'busy', label: 'Blender', detail: `${name}: updating the scene…` };
		case 'rendering':
			return { tone: 'busy', label: 'Blender', detail: `${name}: rendering the preview…` };
		case 'ready':
			return { tone: 'good', label: 'Blender', detail: `${name} is connected` };
		case 'error':
			return { tone: 'bad', label: 'Blender', detail: `${name} reported a problem` };
		case 'idle':
			return { tone: 'idle', label: 'Blender', detail: `${name} is not running` };
	}
}
