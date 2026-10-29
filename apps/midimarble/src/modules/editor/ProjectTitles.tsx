import { Plus, X } from 'lucide-react';
import React from 'react';
import type { TProject } from '../project';
import { NumberField } from './PropertyFields';

/** Simple timed captions belong to the film document and never affect physical or musical timing. */
export const ProjectTitles: React.FC<TProjectTitlesProps> = ({ project, time, onUpdate }) => {
	const titles = project.titles ?? [];
	function update(id: string, patch: Partial<NonNullable<TProject['titles']>[number]>) {
		onUpdate(titles.map((title) => (title.id === id ? { ...title, ...patch } : title)));
	}
	return (
		<div className="project-titles">
			{titles.map((title, index) => (
				<div className="title-editor" key={title.id}>
					<div className="title-editor-heading">
						<span>Title {index + 1}</span>
						<button
							aria-label={`Remove title ${index + 1}`}
							onClick={() => onUpdate(titles.filter((item) => item.id !== title.id))}
						>
							<X size={12} />
						</button>
					</div>
					<input
						aria-label={`Title ${index + 1} text`}
						key={title.text}
						defaultValue={title.text}
						maxLength={100}
						onBlur={(event) => {
							const next = event.currentTarget.value.trim();
							if (next && next !== title.text) update(title.id, { text: next });
							else event.currentTarget.value = title.text;
						}}
						onKeyDown={(event) => {
							if (event.nativeEvent.isComposing || !['Escape', 'Enter'].includes(event.key)) return;
							event.preventDefault();
							event.stopPropagation();
							if (event.key === 'Escape') event.currentTarget.value = title.text;
							if (event.key === 'Escape' || event.key === 'Enter') event.currentTarget.blur();
						}}
					/>
					<div className="property-grid">
						<NumberField
							label="Start"
							ariaLabel={`Title ${index + 1} start`}
							value={title.time}
							min={0}
							max={project.duration - title.duration}
							step={1 / 30}
							suffix="s"
							onChange={(value) => update(title.id, { time: value })}
						/>
						<NumberField
							label="Duration"
							ariaLabel={`Title ${index + 1} duration`}
							value={title.duration}
							min={0.01}
							max={project.duration - title.time}
							step={1 / 30}
							suffix="s"
							onChange={(value) => update(title.id, { duration: value })}
						/>
					</div>
				</div>
			))}
			<button
				className="button subtle full"
				disabled={titles.length >= 100}
				onClick={() => {
					const at = Math.max(0, Math.min(project.duration - 0.01, time));
					onUpdate([
						...titles,
						{
							id: crypto.randomUUID(),
							text: 'Your title',
							time: at,
							duration: Math.min(3, project.duration - at)
						}
					]);
				}}
			>
				<Plus size={12} />
				Add title at playhead
			</button>
			<p className="property-hint">Titles appear in the camera view and exported film.</p>
		</div>
	);
};
interface TProjectTitlesProps {
	project: TProject;
	time: number;
	onUpdate(titles: NonNullable<TProject['titles']>): void;
}
