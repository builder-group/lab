import { convertFileSrc } from '@tauri-apps/api/core';
import { useFeatureState } from 'feature-react/state';
import { CircleAlert, CircleCheck, Film, Monitor } from 'lucide-react';
import React from 'react';
import { HelpTip, Select } from '@/components';
import { host } from '@/environment';
import type { TRenderPreset } from '@/modules/scene';
import { mutedSoundtrackNote } from '@/modules/music';
import type { StudioCx } from '@/modules/studio';
import { estimateExport, filmSize, formatClock, formatEstimate, getRenderPreset, remainingExportSeconds, renderPresetOption, renderPresets, type TExportEstimate } from '@/modules/scene';
import { ExportPreflight, useExportPreflight } from './ExportPreflight';
import type { TExportJob } from './FilmExportCx';

/** Export Film sheet, like a macOS export sheet: settings and an estimate, then progress, then the film */
export const ExportSheet: React.FC<TExportSheetProps> = (props) => {
	const { cx } = props;
	const isOpen = useFeatureState(cx.filmExport.$isSheetOpen);
	const job = useFeatureState(cx.filmExport.$job);

	React.useEffect(() => {
		if (!isOpen) return;
		function onKeyDown(event: KeyboardEvent): void {
			const isTextField = event.target instanceof HTMLInputElement && event.target.type === 'text';
			// An open pop-up menu in the sheet takes its own Escape and Return
			if (event.target instanceof Element && event.target.closest('[role="menu"]') != null) return;
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				cx.filmExport.closeSheet();
			}
			if (event.key === 'Enter' && !isTextField && cx.filmExport.$job.get().phase === 'idle' && cx.filmExport.isAvailable) {
				event.preventDefault();
				event.stopPropagation();
				void cx.filmExport.start();
			}
		}
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [cx, isOpen]);

	if (!isOpen) return null;

	return (
		<div className="absolute inset-0 z-40 flex justify-center bg-black/10" onPointerDown={(event) => event.stopPropagation()}>
			<div role="dialog" aria-modal aria-label="Export Film" className="mm-sheet mt-[60px] w-[460px]">
				{job.phase === 'idle' ? (
					<ExportSettings cx={cx} />
				) : job.phase === 'done' ? (
					<ExportDone cx={cx} job={job} />
				) : job.phase === 'failed' || job.phase === 'canceled' ? (
					<ExportStopped cx={cx} job={job} />
				) : (
					<ExportProgress cx={cx} job={job} />
				)}
			</div>
		</div>
	);
};

interface TExportSheetProps {
	cx: StudioCx;
}

const ExportSettings: React.FC<{ cx: StudioCx }> = (props) => {
	const { cx } = props;
	const settings = useFeatureState(cx.filmExport.$settings);
	const measured = useFeatureState(cx.filmExport.$measured);
	const preview = useFeatureState(cx.film.$preview);
	const result = useFeatureState(cx.simulation.$result);
	const project = useFeatureState(cx.$history)?.present;
	const preflight = useExportPreflight(cx);
	const mix = useFeatureState(cx.$mix);
	const isAvailable = cx.filmExport.isAvailable;
	if (project == null || preflight == null) return null;
	const mutedNote = mutedSoundtrackNote(project, mix);
	// Issues never block an export; the default button only says that it goes ahead despite them
	const exportLabel = preflight.warnings > 0 ? 'Export Anyway' : 'Export';

	const duration = result?.duration ?? project.end;
	const preset = getRenderPreset(settings.preset);
	const size = filmSize(project.frame, settings.preset);
	const estimate = estimateExport({ duration, frame: project.frame, preset: settings.preset, measured: measured[preset.engine], preview });

	return (
		<>
			<SheetHeader title="Export Film" subtitle={project.title} />
			{!isAvailable ? (
				<div className="mm-setup-card">
					<div className="flex items-start gap-2.5">
						<Monitor size={16} strokeWidth={1.6} className="mt-0.5 shrink-0 text-[var(--text-secondary)]" />
						<div className="flex items-center gap-1.5 font-semibold">
							Export Runs in the Desktop App
							<HelpTip side="right" text="Blender makes the film and can't start from the browser. Open MidiMarble on your Mac to export." />
						</div>
					</div>
				</div>
			) : null}
			<div className="mm-form">
				<label htmlFor="export-preset">Quality</label>
				<Select
					id="export-preset"
					value={settings.preset}
					options={renderPresets.map((item) => ({ value: item.id, label: renderPresetOption(item) }))}
					onChange={(value) => {
						cx.filmExport.updateSettings({ preset: value as TRenderPreset });
						// The project remembers the last choice, so the sheet opens on it next time
						cx.execute([{ type: 'setDesign', design: { renderPreset: value as TRenderPreset } }]);
					}}
				/>
				<label htmlFor="export-name">Save As</label>
				<div className="flex gap-1.5">
					<input
						id="export-name"
						type="text"
						className="mm-input min-w-0 flex-1"
						value={settings.fileName}
						onChange={(event) => cx.filmExport.updateSettings({ fileName: event.target.value, chosenPath: null })}
					/>
					<button className="mm-button" disabled={!isAvailable} onClick={() => void cx.filmExport.chooseLocation()} type="button">
						Choose…
					</button>
				</div>
				<span className="mm-form-label">Where</span>
				<span className="flex items-center gap-1.5 self-center">
					<span className="mm-caption">{settings.chosenPath != null ? folderOf(settings.chosenPath) : 'In the Project'}</span>
				</span>
			</div>

			<div className="mm-summary">
				<div className="mm-tabular">
					{size.width} × {size.height} · {preset.fps} fps · {formatClock(duration)}
				</div>
				<div className="flex items-baseline justify-between gap-3">
					<span className="font-medium">{estimate.seconds != null ? formatEstimate(estimate.seconds) : 'Time unknown'}</span>
					{estimate.basis !== 'none' ? <span className="text-[11px] text-[var(--text-secondary)]">{basisLabel(estimate.basis, settings.preset)}</span> : null}
				</div>
			</div>

			<ExportPreflight cx={cx} preflight={preflight} />
			{mutedNote != null ? <p className="text-[11px] leading-snug text-[var(--text-secondary)]">{mutedNote}</p> : null}

			<div className="flex justify-end gap-2">
				<button className="mm-button" data-size="dialog" onClick={() => cx.filmExport.closeSheet()} title="Cancel (Esc)" type="button">
					Cancel
				</button>
				<button className="mm-button" data-size="dialog" data-variant="primary" disabled={!isAvailable} onClick={() => void cx.filmExport.start()} title={`${exportLabel} (↩)`} type="button">
					{exportLabel}
				</button>
			</div>
		</>
	);
};

const ExportProgress: React.FC<{ cx: StudioCx; job: TExportJob }> = (props) => {
	const { cx, job } = props;
	const now = useNow(job.startedAt != null);
	const elapsed = job.startedAt == null ? 0 : (now - job.startedAt) / 1000;
	const remaining = job.frames == null ? null : remainingExportSeconds({ frame: job.frame, frames: job.frames, msPerFrame: job.msPerFrame });

	return (
		<>
			<SheetHeader title="Exporting Film" subtitle={exportStatusLabel(job)} />
			<progress className="mm-progress" max={1} value={job.phase === 'preparing' ? undefined : job.progress} aria-label="Export progress" />
			<div className="mm-tabular flex justify-between text-[11px] text-[var(--text-secondary)]">
				<span>Elapsed {formatClock(elapsed)}</span>
				<span>{remaining != null ? `About ${formatClock(remaining)} remaining` : job.phase === 'encoding' ? 'Finishing…' : 'Estimating…'}</span>
			</div>
			<div className="flex justify-end gap-2">
				<button className="mm-button" data-size="dialog" onClick={() => cx.filmExport.cancel()} type="button">
					Cancel Export
				</button>
				<button className="mm-button" data-size="dialog" data-variant="primary" onClick={() => cx.filmExport.$isSheetOpen.set(false)} title="Hide and keep working; the title bar shows the progress (Esc)" type="button">
					Hide
				</button>
			</div>
		</>
	);
};

const ExportDone: React.FC<{ cx: StudioCx; job: TExportJob }> = (props) => {
	const { cx, job } = props;
	const result = job.result;
	if (result == null) return null;
	const seconds = job.startedAt != null && job.finishedAt != null ? (job.finishedAt - job.startedAt) / 1000 : result.renderSeconds;

	async function reveal(): Promise<void> {
		if (result == null) return;
		const [isRevealedOk, revealedErr] = await host.revealInFinder(result.path);
		if (!isRevealedOk) cx.notify(revealedErr.message, 'error');
	}

	return (
		<>
			<SheetHeader icon={<CircleCheck size={16} strokeWidth={1.8} className="text-[var(--good)]" />} title="Film Exported" subtitle={result.path.split('/').pop() ?? ''} />
			<video className="mm-film" src={convertFileSrc(result.path)} controls playsInline style={{ aspectRatio: `${result.width} / ${result.height}` }} />
			<div className="mm-tabular text-[11px] text-[var(--text-secondary)]">
				{result.width} × {result.height} · {result.fps} fps · {formatClock(result.duration)} · rendered in {formatClock(seconds)}
				{result.hasAudio ? '' : ' · no song'}
			</div>
			<div className="flex justify-end gap-2">
				<button className="mm-button" onClick={() => void reveal()} type="button">
					<Film size={12} strokeWidth={1.8} />
					Show in Finder
				</button>
				<button className="mm-button" data-size="dialog" data-variant="primary" onClick={() => cx.filmExport.closeSheet()} type="button">
					Done
				</button>
			</div>
		</>
	);
};

const ExportStopped: React.FC<{ cx: StudioCx; job: TExportJob }> = (props) => {
	const { cx, job } = props;
	const isFailed = job.phase === 'failed';
	return (
		<>
			<SheetHeader
				icon={isFailed ? <CircleAlert size={16} strokeWidth={1.8} className="text-[var(--bad)]" /> : undefined}
				title={isFailed ? 'Export Failed' : 'Export Canceled'}
				subtitle={isFailed ? 'Blender reported a problem' : 'No film was written'}
			/>
			{job.error != null ? <p className="mm-error-box">{job.error}</p> : null}
			<div className="flex justify-end gap-2">
				<button className="mm-button" data-size="dialog" onClick={() => cx.filmExport.closeSheet()} type="button">
					Close
				</button>
				<button className="mm-button" data-size="dialog" data-variant="primary" onClick={() => cx.filmExport.$job.set({ ...job, phase: 'idle', error: null })} type="button">
					Try Again
				</button>
			</div>
		</>
	);
};

const SheetHeader: React.FC<{ title: string; subtitle?: string; icon?: React.ReactNode }> = (props) => {
	const { title, subtitle, icon } = props;
	return (
		<div className="flex items-start gap-2">
			{icon != null ? <span className="mt-px">{icon}</span> : null}
			<div className="min-w-0">
				<div className="font-semibold">{title}</div>
				{subtitle != null ? <div className="mm-caption mt-0.5 truncate">{subtitle}</div> : null}
			</div>
		</div>
	);
};

/** One line for the export's state, shared by the sheet and the toolbar activity view */
export function exportStatusLabel(job: TExportJob): string {
	switch (job.phase) {
		case 'preparing':
			return job.step ?? 'Preparing…';
		case 'rendering':
			return job.frame != null && job.frames != null ? `Rendering frame ${job.frame} of ${job.frames}` : 'Starting Blender…';
		case 'encoding':
			return 'Finishing the film…';
		case 'done':
			return 'Film exported';
		case 'failed':
			return 'Export failed';
		case 'canceled':
			return 'Export canceled';
		case 'idle':
			return '';
	}
}

function basisLabel(basis: TExportEstimate['basis'], preset: TRenderPreset): string {
	if (basis === 'measured') return `From your last ${getRenderPreset(preset).label} export`;
	if (basis === 'typical') return 'Typical Draft speed';
	return 'From the playhead preview';
}

function folderOf(path: string): string {
	const parts = path.split('/');
	parts.pop();
	return parts.slice(-2).join(' › ');
}

/** Current time, ticking once a second while active */
function useNow(isActive: boolean): number {
	const [now, setNow] = React.useState(() => Date.now());
	React.useEffect(() => {
		if (!isActive) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [isActive]);
	return now;
}
