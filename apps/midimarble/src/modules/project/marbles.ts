import type { TMarbleDefinition, TProject } from './types';

/** Normalizes the original primary launch and additional voices for editors and renderers. */
export function getProjectMarbles(project: TProject): TMarbleDefinition[] {
	return [
		{
			id: 'main',
			name: 'Marble',
			launch: project.launch,
			color: project.marbleColor,
			style: project.marbleStyle,
			effect: project.marbleEffect,
			effectSpeed: project.marbleEffectSpeed,
			startTime: 0
		},
		...(project.marbles ?? [])
	];
}
