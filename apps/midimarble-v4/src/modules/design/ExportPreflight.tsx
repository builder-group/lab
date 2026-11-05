import { useFeatureState } from 'feature-react/state';
import { createState } from 'feature-state';
import { ChevronRight, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import React from 'react';
import type { TBuildProgress } from '@/modules/compose/build-track';
import type { TProject } from '@/modules/project';
import type { StudioCx } from '@/modules/studio';
import { formatTime } from '@/modules/studio/format';
import { preflightExport, type TExportPreflight, type TPreflightIssue } from './export-preflight';

/** The export preflight of the open project and its current simulation result */
export function useExportPreflight(cx: StudioCx): TExportPreflight | null {
	const project = useFeatureState(cx.$history)?.present ?? null;
	const result = useFeatureState(cx.simulation.$result);
	const blenderObjects = useFeatureState(cx.design.$blenderObjects);
	return React.useMemo(() => (project != null ? preflightExport(project, result, blenderObjects) : null), [project, result, blenderObjects]);
}

const NOT_BUILDING = createState<TBuildProgress | null>(null);

/**
 * The checked preflight for what stays on screen around the wall, or null until the run has caught up with the
 * project. A drag keeps showing the last value, so no pointer move checks the whole run on the main thread, and while
 * Build Track works there is none, so no step does.
 */
export function useRunPreflight(cx: StudioCx, project: TProject | undefined): TExportPreflight | null {
	const result = useFeatureState(cx.simulation.$result);
	const blenderObjects = useFeatureState(cx.design.$blenderObjects);
	const isPreviewing = useFeatureState(cx.simulation.$previewing);
	const isBuilding = useFeatureState(useFeatureState(cx.$compose)?.assist.$building ?? NOT_BUILDING) != null;
	return React.useMemo(() => {
		if (project == null || isBuilding) return null;
		const held = isPreviewing ? lastPreflight.get(cx) : undefined;
		if (held != null) return held;
		const preflight = preflightExport(project, result, blenderObjects);
		if (preflight.state !== 'checked') {
			lastPreflight.delete(cx);
			return null;
		}
		lastPreflight.set(cx, preflight);
		return preflight;
	}, [cx, isBuilding, isPreviewing, project, result, blenderObjects]);
}

// What a drag keeps showing, shared so a panel that opens during the drag shows it too
const lastPreflight = new WeakMap<StudioCx, TExportPreflight>();

/**
 * Preflight in the export sheet, like Final Cut's share warnings with Xcode's issue list: a summary line
 * that discloses the issues, the same problem model as the hit summary. Clicking an issue closes the sheet and
 * shows it in Compose, or in Film with the Camera selected for a framing problem.
 */
export const ExportPreflight: React.FC<TExportPreflightProps> = (props) => {
	const { cx, preflight } = props;
	const hasIssues = preflight.issues.length > 0 && preflight.state === 'checked';
	// Warnings start disclosed and notes folded, until the user toggles the list
	const [toggledOpen, setToggledOpen] = React.useState<boolean | null>(null);
	const isOpen = toggledOpen ?? preflight.warnings > 0;

	return (
		<div className="mm-preflight" aria-label="Preflight">
			<button className="mm-preflight-summary" disabled={!hasIssues} aria-expanded={hasIssues ? isOpen : undefined} onClick={() => setToggledOpen(!isOpen)} type="button">
				<PreflightIcon preflight={preflight} />
				<span className="min-w-0 flex-1 truncate font-medium">{preflight.summary}</span>
				{hasIssues ? (
					<span className="mm-disclosure" data-open={isOpen}>
						<ChevronRight size={11} strokeWidth={2.2} />
					</span>
				) : null}
			</button>
			{hasIssues && isOpen ? (
				<ul className="mm-preflight-list">
					{preflight.issues.map((issue) => (
						<li key={issue.id}>
							<PreflightRow issue={issue} onReveal={issue.target != null ? () => issue.target != null && cx.revealIssue(issue.target) : undefined} />
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
};

interface TExportPreflightProps {
	cx: StudioCx;
	preflight: TExportPreflight;
}

const PreflightRow: React.FC<{ issue: TPreflightIssue; onReveal?: () => void }> = (props) => {
	const { issue, onReveal } = props;
	const content = (
		<>
			<SeverityIcon severity={issue.severity} />
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate">{issue.title}</span>
				{issue.detail != null && issue.detail.length > 0 ? <span className="mm-preflight-detail">{issue.detail}</span> : null}
			</span>
			{issue.time != null ? <span className="mm-row-secondary shrink-0">{formatTime(issue.time)}</span> : null}
		</>
	);
	if (onReveal == null) return <div className="mm-preflight-row">{content}</div>;
	return (
		<button className="mm-preflight-row" data-clickable onClick={onReveal} title={issue.target?.workspace === 'design' ? 'Show in Film with the Camera' : 'Show in Track'} type="button">
			{content}
		</button>
	);
};

/** Check, warning or spinner for the preflight summary */
export const PreflightIcon: React.FC<{ preflight: TExportPreflight }> = (props) => {
	const { preflight } = props;
	if (preflight.state === 'pending') return <LoaderCircle size={14} strokeWidth={2} className="shrink-0 animate-spin text-[var(--text-secondary)]" aria-label="Checking" />;
	if (preflight.warnings > 0) return <SeverityIcon severity="warning" />;
	return <CircleCheck size={14} strokeWidth={1.8} className="shrink-0 text-[var(--good)]" aria-label="Ready" />;
};

const SeverityIcon: React.FC<{ severity: TPreflightIssue['severity'] }> = (props) =>
	props.severity === 'warning' ? (
		<TriangleAlert size={14} strokeWidth={1.8} className="mt-px shrink-0 text-[var(--warn)]" aria-label="Warning" />
	) : (
		<Info size={14} strokeWidth={1.8} className="mt-px shrink-0 text-[var(--text-secondary)]" aria-label="Tip" />
	);
