import React from 'react';
import {
	createMotionCompiler,
	createNoteMarkers,
	getMotionSignature,
	type TMotionProgress
} from '../motion';
import type { TPerformance, TProject } from '../project';

/** Owns worker revisions and verified progress independently of the editor's selection and panels. */
export function useMotionPerformance(project: TProject, options: TMotionPerformanceOptions) {
	const [state, setState] = React.useState<{
		projectId: string;
		result: TPerformance;
		complete: boolean;
	} | null>(null);
	const [compiling, setCompiling] = React.useState(true);
	const [progress, setProgress] = React.useState<TMotionProgress | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [attempt, setAttempt] = React.useState(0);
	const compilerRef = React.useRef<ReturnType<typeof createMotionCompiler> | null>(null);
	const latestProject = React.useEffectEvent(() => project);
	const onStart = React.useEffectEvent(options.onStart);
	const signature = React.useMemo(() => getMotionSignature(project), [project]);
	const retry = React.useCallback(() => setAttempt((value) => value + 1), []);
	React.useEffect(() => {
		const compiler = createMotionCompiler();
		compilerRef.current = compiler;
		return () => compiler.dispose();
	}, []);
	React.useEffect(() => {
		let current = true;
		let lastPublished = 0;
		queueMicrotask(() => {
			if (!current) return;
			const document = latestProject();
			const reused = compilerRef.current?.reuse(document);
			if (reused != null) {
				setState({ projectId: document.id, result: reused, complete: true });
				setCompiling(false);
				setProgress(null);
				setError(null);
				return;
			}
			onStart();
			setCompiling(true);
			setProgress(null);
			setError(null);
			void compilerRef.current
				?.compile(document, {
					onProgress: (next) => {
						if (!current) return;
						const now = Date.now();
						if (now - lastPublished < 70 && next.completed < next.total) return;
						lastPublished = now;
						setProgress(next);
						const partial = next.performance;
						if (partial != null)
							setState((previous) =>
								previous?.projectId === document.id && previous.complete
									? previous
									: { projectId: document.id, result: partial, complete: false }
							);
					}
				})
				.then((result) => {
					if (!current) return;
					setState({ projectId: document.id, result, complete: true });
					setCompiling(false);
					setProgress(null);
				})
				.catch((reason: unknown) => {
					if (!current || (reason instanceof DOMException && reason.name === 'AbortError')) return;
					const message =
						reason instanceof Error ? reason.message : 'The trajectory could not be calculated.';
					setState((previous) =>
						previous?.projectId === document.id && previous.complete ? previous : null
					);
					setCompiling(false);
					setProgress(null);
					setError(message);
				});
		});
		return () => {
			current = false;
		};
	}, [signature, project.id, attempt]);
	const performance = React.useMemo(() => {
		if (state?.projectId !== project.id) return null;
		return {
			...state.result,
			noteMarkers: createNoteMarkers(
				project.notes,
				state.result,
				state.result.samples.at(-1)?.time ?? -1
			)
		};
	}, [state, project.id, project.notes]);
	return {
		performance,
		previewStale: compiling && state?.projectId === project.id && state.complete,
		compiling,
		progress,
		error,
		retry
	};
}
interface TMotionPerformanceOptions {
	onStart(): void;
}
