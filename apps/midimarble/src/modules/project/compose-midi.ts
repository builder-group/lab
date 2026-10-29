import { noteName } from './project';
import type { TProject, TSceneObject, TSceneStyle } from './types';

/** Fits editable keys to MIDI onsets. Rapier resolves every position and verifies the resulting contacts. */
export function composeMidiNotes(project: TProject, options: TCompositionOptions = {}): TProject {
	const result = structuredClone(project);
	const counts = new Map<string, number>();
	result.objects = [...result.notes]
		.sort((a, b) => a.time - b.time)
		.map((note): TSceneObject => {
			const voice = options.voices?.[note.trackId];
			const marbleId = voice?.marbleId ?? 'main';
			const index = counts.get(marbleId) ?? 0;
			counts.set(marbleId, index + 1);
			const direction = (index % 2 === 0 ? 1 : -1) * (voice?.direction ?? 1);
			return {
				id: `${result.id}-key-${note.id}`,
				name: `${noteName(note.midi)} · ${index + 1}`,
				kind: 'bar',
				modelId: 'key-bar',
				mountStyle: 'pins',
				roundedNose: true,
				marbleId,
				binding: { noteId: note.id, offset: [0, 0, 0] },
				position: [0, 0, 0.65],
				rotation: [0, 0, direction * (options.angle ?? 0.64)],
				size: [options.width ?? 0.85, 0.09, 1.2],
				restitution: options.restitution ?? 0.4,
				friction: 0.12,
				material: 'metal',
				materialFinish: 'painted',
				color: '#b68d50',
				glowColor: voice?.color ?? '#f5bc72',
				emission: 0.55,
				glowFade: 0.24,
				glowMode: 'impact',
				flex: 0.08
			};
		});
	return result;
}

export interface TCompositionOptions {
	angle?: number;
	width?: number;
	restitution?: number;
	voices?: Record<string, { marbleId: string; direction?: 1 | -1; color?: string }>;
}

export function createCloseWallStyle(): TSceneStyle {
	return {
		theme: 'wall',
		viewTransform: 'agx',
		wallClearance: 0.06,
		wallPosition: 0,
		background: '#d0c7b7',
		keyColor: '#fff2de',
		fillColor: '#dae6f4',
		exposure: 0.9,
		bloom: 0.12,
		keyPosition: [-3, 7, 9],
		keyIntensity: 2.6,
		fillIntensity: 0.55,
		environmentIntensity: 0.5
	};
}
