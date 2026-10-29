import type { TProject } from '../project/types';
import { compilePerformance } from './compile-performance';
import type { TCompileOptions } from './motion-progress';

self.addEventListener(
	'message',
	async (
		event: MessageEvent<{ id: number; project: TProject; previous?: TCompileOptions['previous'] }>
	) => {
		try {
			const performance = await compilePerformance(event.data.project, {
				previous: event.data.previous,
				onProgress: (progress) => self.postMessage({ id: event.data.id, progress })
			});
			self.postMessage({ id: event.data.id, performance });
		} catch (error) {
			self.postMessage({
				id: event.data.id,
				error: error instanceof Error ? error.message : 'Simulation failed.'
			});
		}
	}
);
