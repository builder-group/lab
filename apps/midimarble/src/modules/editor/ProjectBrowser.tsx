import {
	Archive,
	ArrowRight,
	Check,
	ChevronDown,
	CircleAlert,
	Download,
	FileMusic,
	FolderOpen,
	LoaderCircle,
	Plus,
	X
} from 'lucide-react';
import React from 'react';
import { useDialogFocus } from './use-dialog-focus';
import './ProjectBrowser.css';

export const ProjectBrowser: React.FC<TProjectBrowserProps> = (props) => {
	const {
		currentProjectName,
		examples,
		recentProjects = [],
		archivedProjects = [],
		loadingExampleId,
		loadingRecentId,
		loadingProjectId,
		saving = false,
		saveFailed = false,
		error,
		onNew,
		onOpenProject,
		onImportMidi,
		onOpenExample,
		onOpenRecent,
		onDownloadCurrent,
		onArchiveProject,
		onRestoreProject,
		onContinue
	} = props;
	const browserRef = React.useRef<HTMLDivElement>(null);
	const newProjectRef = React.useRef<HTMLButtonElement>(null);
	const [showTemplates, setShowTemplates] = React.useState(false);
	const [showAllRecent, setShowAllRecent] = React.useState(false);
	const [showArchived, setShowArchived] = React.useState(false);
	const [lastExampleId, setLastExampleId] = React.useState<string | null>(null);
	const busy = loadingExampleId != null || loadingRecentId != null || loadingProjectId != null;
	const visibleRecent = showAllRecent ? recentProjects : recentProjects.slice(0, 6);
	let saveLabel = 'Autosaved on this device';
	if (saving) saveLabel = 'Saving…';
	if (saveFailed) saveLabel = 'Local save unavailable';
	const openProject = React.useCallback(() => {
		setLastExampleId(null);
		onOpenProject();
	}, [onOpenProject]);
	const importMidi = React.useCallback(() => {
		setLastExampleId(null);
		onImportMidi();
	}, [onImportMidi]);
	const newProject = React.useCallback(
		(type: 'wall' | 'duet' | 'empty') => {
			setLastExampleId(null);
			onNew(type);
		},
		[onNew]
	);
	const openRecent = React.useCallback(
		(id: string) => {
			setLastExampleId(null);
			onOpenRecent?.(id);
		},
		[onOpenRecent]
	);
	const openExample = React.useCallback(
		(id: string) => {
			setLastExampleId(id);
			onOpenExample(id);
		},
		[onOpenExample]
	);
	const archiveProject = React.useCallback(
		(id: string) => {
			setLastExampleId(null);
			onArchiveProject?.(id);
		},
		[onArchiveProject]
	);
	const restoreProject = React.useCallback(
		(id: string) => {
			setLastExampleId(null);
			onRestoreProject?.(id);
		},
		[onRestoreProject]
	);
	useDialogFocus(browserRef, {
		dismissible: onContinue != null && !busy,
		initialFocusRef: newProjectRef,
		onClose: () => onContinue?.()
	});

	return (
		<div
			ref={browserRef}
			className="project-browser"
			role="dialog"
			aria-modal="true"
			aria-label="MidiMarble projects"
			tabIndex={-1}
		>
			<header className="project-browser-header">
				<div className="project-browser-brand">
					<span className="project-browser-symbol" aria-hidden="true">
						<span />
					</span>
					<div>
						<strong>MidiMarble</strong>
						<span>Music in motion</span>
					</div>
				</div>
				{onContinue != null && (
					<button
						type="button"
						className="project-browser-close"
						onClick={onContinue}
						disabled={busy}
						aria-label="Close projects and continue editing"
					>
						<X size={18} />
					</button>
				)}
			</header>
			<main className="project-browser-content">
				<div className="project-browser-heading">
					<div>
						<h1>Your studio</h1>
						<p>Build a run. Make it musical.</p>
					</div>
					<span className="project-browser-local">
						<span /> Saved on this device
					</span>
				</div>
				<div className="project-browser-actions">
					<button
						ref={newProjectRef}
						type="button"
						className="project-browser-action project-browser-action-new"
						aria-expanded={showTemplates}
						aria-controls="project-browser-templates"
						disabled={busy}
						onClick={() => setShowTemplates((visible) => !visible)}
					>
						<Plus size={21} />
						<span>
							<strong>New project</strong>
							<small>Choose a starting point</small>
						</span>
						<ChevronDown size={15} className="project-browser-action-arrow" />
					</button>
					<button
						type="button"
						className="project-browser-action"
						onClick={openProject}
						disabled={busy}
					>
						<FolderOpen size={21} />
						<span>
							<strong>Open project</strong>
							<small>Open a .marble file</small>
						</span>
					</button>
					<button
						type="button"
						className="project-browser-action"
						onClick={importMidi}
						disabled={busy}
					>
						<FileMusic size={21} />
						<span>
							<strong>Import MIDI</strong>
							<small>Start with your music</small>
						</span>
					</button>
				</div>
				{error != null && (
					<p className="project-browser-error" role="alert">
						<span>{error}</span>
						{lastExampleId != null && (
							<button type="button" onClick={() => openExample(lastExampleId)} disabled={busy}>
								Try again <ArrowRight size={13} />
							</button>
						)}
					</p>
				)}
				{showTemplates && (
					<section
						className="project-browser-templates"
						id="project-browser-templates"
						aria-labelledby="project-browser-templates-title"
					>
						<div className="project-browser-section-heading">
							<h2 id="project-browser-templates-title">Choose a starting point</h2>
							<button
								type="button"
								aria-label="Close starting points"
								onClick={() => setShowTemplates(false)}
							>
								<X size={16} />
							</button>
						</div>
						<div className="project-browser-template-grid">
							{templates.map((template) => (
								<button
									type="button"
									className="project-browser-template"
									key={template.id}
									onClick={() => newProject(template.id)}
									disabled={busy}
								>
									<span
										className={`project-browser-template-preview ${template.id}`}
										aria-hidden="true"
									>
										<span className="template-line" />
										<span className="template-line" />
										<span className="template-line" />
										<span className="template-marble" />
										<span className="template-marble second" />
										{template.id === 'empty' && <Plus size={23} />}
									</span>
									<span className="project-browser-template-copy">
										<strong>{template.title}</strong>
										<small>{template.description}</small>
									</span>
									<ArrowRight size={15} />
								</button>
							))}
						</div>
					</section>
				)}
				{currentProjectName != null && onContinue != null && (
					<section className="project-browser-current" aria-label="Current project">
						<span className="project-browser-current-icon">
							<FileMusic size={20} />
						</span>
						<div>
							<strong>{currentProjectName}</strong>
							<span aria-live="polite">
								{saving && !saveFailed && <LoaderCircle className="spin" size={12} />}
								{saveFailed && <CircleAlert size={12} />}
								{!saving && !saveFailed && <Check size={12} />}
								{saveLabel}
							</span>
						</div>
						{onDownloadCurrent != null && (
							<button
								type="button"
								className="project-browser-download-current"
								onClick={onDownloadCurrent}
								disabled={busy}
								aria-label="Download current project"
							>
								<Download size={14} /> Download
							</button>
						)}
						<button type="button" onClick={onContinue} disabled={busy}>
							Continue editing <ArrowRight size={15} />
						</button>
					</section>
				)}
				{recentProjects.length > 0 && (
					<section
						className="project-browser-recent"
						aria-labelledby="project-browser-recent-title"
					>
						<div className="project-browser-section-heading">
							<h2 id="project-browser-recent-title">Recent projects</h2>
							<span>On this device</span>
						</div>
						<ul className="project-browser-recent-list">
							{visibleRecent.map((project) => {
								const loading = loadingRecentId === project.id;
								return (
									<li key={project.id}>
										<button
											type="button"
											className="project-browser-recent-open"
											onClick={() => openRecent(project.id)}
											disabled={busy || onOpenRecent == null}
											aria-label={`${loading ? 'Opening' : 'Open'} ${project.name}`}
											aria-busy={loading}
										>
											<FileMusic size={19} />
											<span className="project-browser-recent-copy">
												<strong>{project.name}</strong>
												<span>
													{project.noteCount} {project.noteCount === 1 ? 'note' : 'notes'}{' '}
													<span aria-hidden="true">·</span> {project.objectCount}{' '}
													{project.objectCount === 1 ? 'object' : 'objects'}
												</span>
											</span>
											<time dateTime={new Date(project.updatedAt).toISOString()}>
												{formatUpdatedAt(project.updatedAt)}
											</time>
											{loading ? (
												<LoaderCircle className="spin" size={16} />
											) : (
												<ArrowRight size={16} />
											)}
										</button>
										{onArchiveProject != null && (
											<button
												type="button"
												className="project-browser-archive-project"
												onClick={() => archiveProject(project.id)}
												disabled={busy}
												aria-label={`Archive ${project.name}`}
												aria-busy={loadingProjectId === project.id}
												title="Archive project"
											>
												{loadingProjectId === project.id ? (
													<LoaderCircle className="spin" size={15} />
												) : (
													<Archive size={15} />
												)}
											</button>
										)}
									</li>
								);
							})}
						</ul>
						{recentProjects.length > 6 && (
							<button
								type="button"
								className="project-browser-show-recent"
								onClick={() => setShowAllRecent((visible) => !visible)}
							>
								{showAllRecent ? 'Show less' : `Show all ${recentProjects.length} projects`}{' '}
								<ChevronDown size={13} />
							</button>
						)}
					</section>
				)}
				{archivedProjects.length > 0 && (
					<section className="project-browser-archived" aria-label="Archived projects">
						<button
							type="button"
							className="project-browser-archived-toggle"
							aria-expanded={showArchived}
							aria-controls="project-browser-archived-list"
							onClick={() => setShowArchived((visible) => !visible)}
						>
							<Archive size={14} /> Archived <span>{archivedProjects.length}</span>{' '}
							<ChevronDown size={13} />
						</button>
						{showArchived && (
							<div id="project-browser-archived-list">
								<p className="project-browser-archive-note">
									Archived projects stay on this device and can be restored.
								</p>
								<ul className="project-browser-recent-list">
									{archivedProjects.map((project) => (
										<li key={project.id}>
											<div className="project-browser-archived-details">
												<FileMusic size={19} />
												<span className="project-browser-recent-copy">
													<strong>{project.name}</strong>
													<span>
														{project.noteCount} {project.noteCount === 1 ? 'note' : 'notes'}{' '}
														<span aria-hidden="true">·</span> {project.objectCount}{' '}
														{project.objectCount === 1 ? 'object' : 'objects'}
													</span>
												</span>
												<time dateTime={new Date(project.updatedAt).toISOString()}>
													{formatUpdatedAt(project.updatedAt)}
												</time>
											</div>
											<button
												type="button"
												className="project-browser-restore-project"
												onClick={() => restoreProject(project.id)}
												disabled={busy || onRestoreProject == null}
												aria-label={`Restore ${project.name}`}
												aria-busy={loadingProjectId === project.id}
											>
												{loadingProjectId === project.id && (
													<LoaderCircle className="spin" size={13} />
												)}{' '}
												Restore
											</button>
										</li>
									))}
								</ul>
							</div>
						)}
					</section>
				)}
				<section
					className="project-browser-examples"
					aria-labelledby="project-browser-examples-title"
				>
					<div className="project-browser-section-heading">
						<h2 id="project-browser-examples-title">Explore examples</h2>
						<span>Open, play, make them yours</span>
					</div>
					<div className="project-browser-example-grid">
						{examples.map((example) => {
							const loading = loadingExampleId === example.id;
							return (
								<article className="project-browser-example" key={example.id}>
									<button
										type="button"
										className="project-browser-example-open"
										onClick={() => openExample(example.id)}
										disabled={busy}
										aria-label={`${loading ? 'Opening' : 'Open'} ${example.title}`}
										aria-busy={loading}
									>
										<span className="project-browser-example-image">
											<img src={example.thumbnail} alt="" draggable={false} />
											<span className="project-browser-example-overlay">
												{loading ? (
													<LoaderCircle className="spin" size={21} />
												) : (
													<ArrowRight size={20} />
												)}
											</span>
										</span>
										<span className="project-browser-example-copy">
											<strong>{example.title}</strong>
											<span>{example.description}</span>
										</span>
									</button>
									<div className="project-browser-example-footer">
										<span>
											{formatDuration(example.duration)} <span aria-hidden="true">·</span>{' '}
											{example.marbles} {example.marbles === 1 ? 'marble' : 'marbles'}
										</span>
										<a
											href={example.file}
											download
											aria-label={`Download ${example.title} as a .marble project`}
										>
											<Download size={13} /> .marble
										</a>
									</div>
								</article>
							);
						})}
					</div>
				</section>
				<footer className="project-browser-footer">
					<span className="project-browser-file-mark">.marble</span>
					<p>
						Your scene, music, and camera in one project file.
						<br />
						Save a copy to keep it or share it with someone.
					</p>
				</footer>
			</main>
		</div>
	);
};

export interface TProjectBrowserProps {
	currentProjectName?: string;
	examples: readonly TProjectBrowserExample[];
	recentProjects?: readonly TProjectBrowserRecent[];
	archivedProjects?: readonly TProjectBrowserRecent[];
	loadingExampleId?: string | null;
	loadingRecentId?: string | null;
	loadingProjectId?: string | null;
	saving?: boolean;
	saveFailed?: boolean;
	error?: string | null;
	onNew(type: 'wall' | 'duet' | 'empty'): void;
	onOpenProject(): void;
	onImportMidi(): void;
	onOpenExample(id: string): void;
	onOpenRecent?(id: string): void;
	onDownloadCurrent?(): void;
	onArchiveProject?(id: string): void;
	onRestoreProject?(id: string): void;
	onContinue?(): void;
}

export interface TProjectBrowserRecent {
	id: string;
	name: string;
	updatedAt: number;
	noteCount: number;
	objectCount: number;
}

export interface TProjectBrowserExample {
	id: string;
	title: string;
	description: string;
	duration: number | string;
	marbles: number;
	thumbnail: string;
	file: string;
}

const templates = [
	{ id: 'wall', title: 'Wall studio', description: 'One marble, ready for your music' },
	{ id: 'duet', title: 'Duo', description: 'Two marbles, a shared stage' },
	{ id: 'empty', title: 'Empty scene', description: 'Build your own from the ground up' }
] as const;

function formatDuration(duration: number | string): string {
	if (typeof duration === 'string') return duration;
	const seconds = Math.round(duration);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatUpdatedAt(updatedAt: number): string {
	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	}).format(updatedAt);
}
