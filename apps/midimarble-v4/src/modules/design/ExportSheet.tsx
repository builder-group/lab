import { convertFileSrc } from '@tauri-apps/api/core';
import { useFeatureState } from 'feature-react/state';
import { CircleAlert, CircleCheck, Film, Monitor } from 'lucide-react';
import React from 'react';
import { Select } from '@/components';
import { host } from '@/environment';
import type { TRenderPreset } from '@/modules/blender';
import type { StudioCx } from '@/modules/studio';
import { estimateExport, filmSize, formatClock, formatEstimate, getRenderPreset, remainingExportSeconds, renderPresets, type TRenderEngine } from './export-estimate';
import type { TExportJob } from './FilmExportCx';

/** Export Film sheet, like a macOS export sheet: settings and an estimate, then progress, then the film */
export const ExportSheet: React.FC<TExportSheetProps> = (props) => {
	const { cx } = props;
	const isOpen = useFeatureState(cx.film.$isSheetOpen);
	const job = useFeatureState(cx.film.$job);

	React.useEffect(() => {
		if (!isOpen) return;
		function onKeyDown(event: KeyboardEvent): void {
			const isTextField = event.target instanceof HTMLInputElement && event.target.type === 'text';
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				cx.film.closeSheet();
			}
			if (event.key === 'Enter' && !isTextField && cx.film.$job.get().phase === 'idle' && cx.film.isAvailable) {
				event.preventDefault();
				event.stopPropagation();
				void cx.film.start();
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
				) : job.phase === 'failed' || job.phase === 'cancelled' ? (
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
	const settings = useFeatureState(cx.film.$settings);
	const measured = useFeatureState(cx.film.$measured);
	const preview = useFeatureState(cx.design.$preview);
	const result = useFeatureState(cx.simulation.$result);
	const project = useFeatureState(cx.$history)?.present;
	const isAvailable = cx.film.isAvailable;
	if (project == null) return null;

	const duration = result?.duration ?? project.end;
	const preset = getRenderPreset(settings.preset);
	const size = filmSize(project.frame, settings.preset);
	const estimate = estimateExport({ duration, frame: project.frame, preset: settings.preset, engine: settings.engine, measured: measured[settings.engine], preview });

	return (
		<>
			<SheetHeader title="Export Film" subtitle={project.title} />
			{!isAvailable ? (
				<div className="mm-setup-card">
					<div className="flex items-start gap-2.5">
						<Monitor size={16} strokeWidth={1.6} className="mt-0.5 shrink-0 text-[var(--text-secondary)]" />
						<div className="flex flex-col gap-0.5">
							<div className="font-semibold">Export Runs in the Desktop App</div>
							<div className="mm-caption">Films render in Blender, which the browser preview cannot start. Open MidiMarble on your Mac to export.</div>
						</div>
					</div>
				</div>
			) : null}
			<div className="mm-form">
				<label htmlFor="export-preset">Preset</label>
				<Select
					id="export-preset"
					value={settings.preset}
					options={renderPresets.map((item) => ({ value: item.id, label: `${item.label} · ${item.shortSide}p, ${item.fps} fps` }))}
					onChange={(value) => cx.film.updateSettings({ preset: value as TRenderPreset })}
				/>
				<span className="mm-form-label">Renderer</span>
				<div>
					<div className="mm-segmented" role="radiogroup" aria-label="Renderer">
						{engines.map((engine) => (
							<button
								key={engine.id}
								role="radio"
								aria-checked={settings.engine === engine.id}
								data-active={settings.engine === engine.id}
								onClick={() => cx.film.updateSettings({ engine: engine.id })}
								type="button"
							>
								{engine.label}
							</button>
						))}
					</div>
					<div className="mm-caption mt-1">{engines.find((engine) => engine.id === settings.engine)?.description}</div>
				</div>
				<label htmlFor="export-name">Save As</label>
				<div className="flex gap-1.5">
					<input
						id="export-name"
						type="text"
						className="mm-input min-w-0 flex-1"
						value={settings.fileName}
						onChange={(event) => cx.film.updateSettings({ fileName: event.target.value, chosenPath: null })}
					/>
					<button className="mm-button" disabled={!isAvailable} onClick={() => void cx.film.chooseLocation()} type="button">
						Choose…
					</button>
				</div>
				<span className="mm-form-label">Where</span>
				<span className="mm-caption self-center">{settings.chosenPath != null ? folderOf(settings.chosenPath) : 'Renders folder in the project'}</span>
			</div>

			<div className="mm-summary">
				<div className="mm-tabular">
					{size.width} × {size.height} · {preset.fps} fps · {estimate.frames} frames · {formatClock(duration)}
				</div>
				<div className="flex items-baseline justify-between gap-3">
					<span className="font-medium">{estimate.seconds != null ? formatEstimate(estimate.seconds) : 'Time unknown'}</span>
					<span className="text-[11px] text-[var(--text-secondary)]">{basisLabel(estimate.basis, settings.engine)}</span>
				</div>
			</div>

			<div className="flex justify-end gap-2">
				<button className="mm-button" data-size="dialog" onClick={() => cx.film.closeSheet()} title="Cancel (Esc)" type="button">
					Cancel
				</button>
				<button className="mm-button" data-size="dialog" data-variant="primary" disabled={!isAvailable} onClick={() => void cx.film.start()} title="Export (↩)" type="button">
					Export
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
			<p className="mm-caption">Blender renders in a separate process. You can hide this sheet and keep working; the toolbar shows the progress.</p>
			<div className="flex justify-end gap-2">
				<button className="mm-button" data-size="dialog" onClick={() => cx.film.cancel()} type="button">
					Cancel Export
				</button>
				<button className="mm-button" data-size="dialog" data-variant="primary" onClick={() => cx.film.$isSheetOpen.set(false)} title="Hide (Esc)" type="button">
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
				{result.hasAudio ? '' : ' · no soundtrack'}
			</div>
			{job.outsidePackage ? (
				<p className="mm-caption">Films are written inside the project for now, so it is in the project’s Renders folder. Reveal it to move it.</p>
			) : null}
			<div className="flex justify-end gap-2">
				<button className="mm-button" onClick={() => void reveal()} type="button">
					<Film size={12} strokeWidth={1.8} />
					Reveal in Finder
				</button>
				<button className="mm-button" data-size="dialog" data-variant="primary" onClick={() => cx.film.closeSheet()} type="button">
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
				title={isFailed ? 'Export Failed' : 'Export Cancelled'}
				subtitle={isFailed ? 'Blender reported a problem' : 'No film was written'}
			/>
			{job.error != null ? <p className="mm-error-box">{job.error}</p> : null}
			<div className="flex justify-end gap-2">
				<button className="mm-button" data-size="dialog" onClick={() => cx.film.closeSheet()} type="button">
					Close
				</button>
				<button className="mm-button" data-size="dialog" data-variant="primary" onClick={() => cx.film.$job.set({ ...job, phase: 'idle', error: null })} type="button">
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

const engines: { id: TRenderEngine; label: string; description: string }[] = [
	{ id: 'eevee', label: 'Eevee', description: 'Fast, matches the Design preview' },
	{ id: 'cycles', label: 'Cycles', description: 'Path traced, much slower and more realistic' }
];

/** One line for the export's state, shared by the sheet and the toolbar activity view */
export function exportStatusLabel(job: TExportJob): string {
	switch (job.phase) {
		case 'preparing':
			return job.step ?? 'Preparing…';
		case 'rendering':
			return job.frame != null && job.frames != null ? `Rendering frame ${job.frame} of ${job.frames}` : 'Starting Blender…';
		case 'encoding':
			return 'Encoding the video…';
		case 'done':
			return 'Film exported';
		case 'failed':
			return 'Export failed';
		case 'cancelled':
			return 'Export cancelled';
		case 'idle':
			return '';
	}
}

function basisLabel(basis: 'measured' | 'preview' | 'none', engine: TRenderEngine): string {
	if (basis === 'measured') return `From your last ${engine === 'eevee' ? 'Eevee' : 'Cycles'} export`;
	if (basis === 'preview') return engine === 'cycles' ? 'Rough guess from the Eevee preview' : 'From the playhead preview';
	return 'Shown after the first preview render';
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
