import { useFeatureState } from 'feature-react/state';
import { LoaderCircle } from 'lucide-react';
import React from 'react';
import type { StudioCx } from '@/modules/studio';
import type { TDesignStatus } from './DesignCx';
import { exportStatusLabel } from './ExportSheet';

/**
 * Toolbar activity view like Xcode's: what Blender and agents are doing, with a progress bar while a film
 * exports. Clicking it during an export shows the export sheet.
 */
export const ActivityView: React.FC<TActivityViewProps> = (props) => {
	const { cx } = props;
	const workspace = useFeatureState(cx.$workspace);
	const status = useFeatureState(cx.design.$status);
	const version = useFeatureState(cx.design.$blenderVersion);
	const job = useFeatureState(cx.film.$job);
	const runs = useFeatureState(cx.agents.$runs);
	const working = runs.filter((run) => run.phase === 'working').length;
	const isExporting = job.phase === 'preparing' || job.phase === 'rendering' || job.phase === 'encoding';

	let activity: TActivity | null = null;
	if (isExporting) {
		activity = { label: 'Exporting Film', detail: exportStatusLabel(job), tone: 'busy', progress: job.phase === 'preparing' ? null : job.progress };
	} else if (job.phase === 'done' || job.phase === 'failed') {
		activity = { label: job.phase === 'done' ? 'Film Exported' : 'Export Failed', detail: job.phase === 'done' ? 'Click to view' : 'Click for details', tone: job.phase === 'done' ? 'good' : 'bad' };
	} else if (working > 0) {
		activity = { label: working === 1 ? 'Agent Working' : `${working} Agents Working`, detail: 'Building a candidate in Blender', tone: 'busy' };
	} else if (workspace === 'design') {
		activity = designActivity(status, version);
	}
	if (activity == null) return null;
	const isClickable = isExporting || job.phase === 'done' || job.phase === 'failed';

	return (
		<button
			className="mm-activity"
			data-clickable={isClickable}
			disabled={!isClickable}
			onClick={() => cx.film.$isSheetOpen.set(true)}
			aria-live="polite"
			title={isClickable ? 'Show Export' : activity.detail}
			type="button"
		>
			<span className="flex min-w-0 items-center gap-1.5">
				{activity.tone === 'busy' ? (
					<LoaderCircle size={11} strokeWidth={2.2} className="shrink-0 animate-spin text-[var(--text-secondary)]" />
				) : (
					<span className="mm-activity-dot" data-tone={activity.tone} />
				)}
				<span className="truncate font-medium">{activity.label}</span>
				{activity.detail.length > 0 ? <span className="truncate text-[var(--text-secondary)]">{activity.detail}</span> : null}
			</span>
			{activity.progress !== undefined ? (
				<span className="mm-activity-bar" data-indeterminate={activity.progress == null}>
					<span style={{ width: `${Math.round((activity.progress ?? 0.3) * 100)}%` }} />
				</span>
			) : null}
		</button>
	);
};

interface TActivityViewProps {
	cx: StudioCx;
}

interface TActivity {
	label: string;
	detail: string;
	tone: 'busy' | 'good' | 'bad' | 'idle';
	/** 0 to 1, null for an indeterminate bar, undefined for none */
	progress?: number | null;
}

function designActivity(status: TDesignStatus, version: string | null): TActivity {
	const blender = version != null ? `Blender ${version.split(' ')[0] ?? ''}` : 'Blender';
	switch (status) {
		case 'unavailable':
			return { label: 'Blender', detail: 'Desktop app only', tone: 'idle' };
		case 'missing':
			return { label: 'Blender Not Found', detail: 'Install it in Applications', tone: 'bad' };
		case 'starting':
			return { label: 'Starting Blender', detail: '', tone: 'busy', progress: null };
		case 'syncing':
			return { label: blender, detail: 'Updating scene…', tone: 'busy' };
		case 'rendering':
			return { label: blender, detail: 'Rendering preview…', tone: 'busy' };
		case 'ready':
			return { label: blender, detail: 'Ready', tone: 'good' };
		case 'error':
			return { label: blender, detail: 'Reported a problem', tone: 'bad' };
		case 'idle':
			return { label: blender, detail: 'Idle', tone: 'idle' };
	}
}
