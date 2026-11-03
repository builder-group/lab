import { useFeatureState } from 'feature-react/state';
import React from 'react';
import type { TProject } from '@/modules/project';
import type { StudioCx } from './StudioCx';

export const Inspector: React.FC<TInspectorProps> = (props) => {
	const { cx } = props;
	const history = useFeatureState(cx.$history);
	const selection = useFeatureState(cx.$selection);
	const project = history?.present;
	if (project == null) return null;
	const entity = project.entities.find((item) => item.id === selection[0]);

	return (
		<aside
			className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-t border-l border-[var(--separator)] bg-[var(--content)]"
			aria-label="Inspector"
		>
			{entity == null ? (
				<ProjectInspector cx={cx} project={project} />
			) : (
				<div className="p-3">
					<div className="mb-2 text-[13px] font-semibold">{entity.name ?? 'Selection'}</div>
					<div className="text-[12px] text-[var(--text-secondary)]">
						{Object.keys(entity.components).join(', ')}
					</div>
				</div>
			)}
		</aside>
	);
};

interface TInspectorProps {
	cx: StudioCx;
}

/** Shown without a selection, like page properties in Figma */
const ProjectInspector: React.FC<TProjectInspectorProps> = (props) => {
	const { cx, project } = props;
	const aspect = aspects.find((item) => item.width === project.frame.width && item.height === project.frame.height);

	return (
		<div className="flex flex-col gap-1 py-2">
			<div className="mm-section-title">Project</div>
			<div className="flex flex-col gap-1.5 px-3">
				<div className="mm-field">
					<label htmlFor="project-title">Title</label>
					<CommitInput
						id="project-title"
						value={project.title}
						onCommit={(title) => cx.execute([{ type: 'setTitle', title }])}
					/>
				</div>
				<div className="mm-field">
					<label htmlFor="project-frame">Frame</label>
					<select
						id="project-frame"
						className="mm-input"
						value={aspect?.label ?? 'custom'}
						onChange={(event) => {
							const next = aspects.find((item) => item.label === event.target.value);
							if (next != null) cx.execute([{ type: 'setFrame', width: next.width, height: next.height }]);
						}}
					>
						{aspects.map((item) => (
							<option key={item.label} value={item.label}>
								{item.label}
							</option>
						))}
						{aspect == null ? <option value="custom">Custom</option> : null}
					</select>
				</div>
				<div className="mm-field">
					<label htmlFor="project-end">Length</label>
					<CommitInput
						id="project-end"
						value={project.end.toFixed(2)}
						suffix="s"
						onCommit={(value) => {
							const end = Number(value);
							if (Number.isFinite(end) && end > 0) cx.execute([{ type: 'setEnd', end }]);
						}}
					/>
				</div>
			</div>
		</div>
	);
};

interface TProjectInspectorProps {
	cx: StudioCx;
	project: TProject;
}

const aspects = [
	{ label: '9:16 Portrait', width: 9, height: 16 },
	{ label: '1:1 Square', width: 1, height: 1 },
	{ label: '4:5 Portrait', width: 4, height: 5 },
	{ label: '16:9 Landscape', width: 16, height: 9 }
];

/** Text input that commits on Return or blur and reverts on Escape, like native inspectors */
export const CommitInput: React.FC<TCommitInputProps> = (props) => {
	const { id, value, suffix, onCommit } = props;
	const [draft, setDraft] = React.useState(value);
	const [source, setSource] = React.useState(value);
	// Reset the draft during render when the committed value changes elsewhere, such as through undo
	if (source !== value) {
		setSource(value);
		setDraft(value);
	}

	function commit(): void {
		if (draft !== value) onCommit(draft);
	}

	return (
		<div className="relative">
			<input
				id={id}
				className="mm-input"
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
					if (event.key === 'Escape') {
						setDraft(value);
						requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
					}
				}}
			/>
			{suffix != null ? (
				<span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-[var(--text-tertiary)]">
					{suffix}
				</span>
			) : null}
		</div>
	);
};

interface TCommitInputProps {
	id: string;
	value: string;
	suffix?: string;
	onCommit: (value: string) => void;
}
