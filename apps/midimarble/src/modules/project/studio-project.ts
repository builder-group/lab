import { createEmptyProject } from './project';
import type { TProject } from './types';

/** Creates independent starting documents without example music or geometry. */
export function createStudioProject(preset: 'wall' | 'duet' | 'empty'): TProject {
	const project = createEmptyProject();
	if (preset === 'empty') {
		project.tracks = [];
		return project;
	}
	if (preset === 'duet') {
		project.name = 'Untitled duet';
		project.launch.position[0] = -1.2;
		project.marbles = [
			{
				id: 'second',
				name: 'Amber',
				launch: { ...project.launch, position: [1.2, 4, 0.8], velocity: [-1.1, -0.4, 0] },
				color: '#cc9253',
				style: 'ribbon'
			}
		];
		project.tracks.push({
			id: 'answer',
			name: 'Answer',
			color: '#cc9253',
			instrument: 11,
			muted: false
		});
		if (project.camera != null) project.camera.distance = 9;
	}
	return project;
}
