import React from 'react';
import { getProjectFileName, serializeProjectFile, triggerDownload, type TProject } from '../project';

/** Keeps the latest project download available when the browser blocks the automatic attempt. */
export function useProjectDownload() {
	const [file, setFile] = React.useState<TProjectDownload | null>(null);
	const fileRef = React.useRef<TProjectDownload | null>(null);

	const save = React.useCallback((project: TProject) => {
		const blob = new Blob([serializeProjectFile(project)], { type: 'application/json' });
		const next = { url: URL.createObjectURL(blob), name: getProjectFileName(project) };
		const previous = fileRef.current;
		fileRef.current = next;
		setFile(next);
		if (previous != null) URL.revokeObjectURL(previous.url);
		try {
			triggerDownload(next.url, next.name);
		} catch {
			// The explicit link remains available if the automatic attempt is rejected
		}
	}, []);

	React.useEffect(
		() => () => {
			if (fileRef.current != null) URL.revokeObjectURL(fileRef.current.url);
		},
		[]
	);

	return { file, save };
}

interface TProjectDownload {
	url: string;
	name: string;
}
