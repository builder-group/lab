import React from 'react';
import type { TPerformance, TProject } from '../project';
import {
	createTransportController,
	type TTransportController,
	type TTransportSnapshot
} from './transport';

export function useTransport(
	project: TProject,
	onError: (message: string) => void,
	performance: TPerformance | null = null
): TTransport {
	const [controller] = React.useState(() => createTransportController(project, { onError }));
	const snapshot = React.useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
		controller.getSnapshot
	);
	React.useEffect(() => {
		controller.updateProject(project, onError);
	}, [controller, project, onError]);
	React.useEffect(() => {
		controller.updatePerformance(performance);
	}, [controller, performance]);
	const lifecycleRef = React.useRef({ generation: 0 });
	React.useEffect(() => {
		const lifecycle = lifecycleRef.current;
		const mount = ++lifecycle.generation;
		return () => {
			// Strict Mode immediately remounts effects; release only after a real unmount
			queueMicrotask(() => {
				if (lifecycle.generation === mount) controller.dispose();
			});
		};
	}, [controller]);
	return {
		...snapshot,
		timeRef: controller.timeRef,
		play: controller.play,
		stop: controller.stop,
		seek: controller.seek,
		setVolume: controller.setVolume,
		setLoop: controller.setLoop
	};
}

export interface TTransport extends TTransportSnapshot {
	timeRef: TTransportController['timeRef'];
	play: TTransportController['play'];
	stop: TTransportController['stop'];
	seek: TTransportController['seek'];
	setVolume: TTransportController['setVolume'];
	setLoop: TTransportController['setLoop'];
}
