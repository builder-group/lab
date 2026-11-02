import { useFeatureState } from 'feature-react/state';
import {
	ArrowLeft,
	ArrowUpRight,
	Box,
	Check,
	ChevronDown,
	Download,
	FilePlus2,
	FolderOpen,
	List,
	MessageCircle,
	Plus,
	Redo2,
	Settings2,
	TerminalSquare,
	Undo2,
	Upload,
	Workflow
} from 'lucide-react';
import React from 'react';
import { Button, Field, Modal } from '../../components/ui';
import { isDesktop } from '../../environment/desktop';
import type { ProjectSessionCx } from '../projects/ProjectSessionCx';

export const ProjectNavigation: React.FC<TProjectNavigationProps> = (props) => {
	const {
		session,
		view,
		menuOpen,
		proposalCount,
		onMenuOpenChange,
		onViewChange,
		onNewProject,
		onRename,
		onAssistant,
		onQuestions,
		onIntegrations
	} = props;
	const project = useFeatureState(session.$project);
	const projects = useFeatureState(session.$projects);
	const history = useFeatureState(session.$history);
	function choose(action: () => void): void {
		onMenuOpenChange(false);
		action();
	}
	return (
		<>
			<header className="document-bar" data-tauri-drag-region>
				<div className="document-traffic-space" data-tauri-drag-region />
				<button
					className="document-file-tab"
					aria-label={project ? `Project menu · ${project.name}` : 'Yadori menu'}
					onClick={() => onMenuOpenChange(!menuOpen)}
				>
					<FolderOpen size={14} />
					<span>{project?.name ?? 'Yadori'}</span>
					<ChevronDown size={11} />
				</button>
				{project && (
					<nav className="document-view-tabs" aria-label="Project views">
						{(
							[
								{ id: 'canvas', label: 'Canvas', icon: Workflow },
								{ id: 'parts', label: 'Parts', icon: List }
							] as const
						).map((tab) => (
							<button
								key={tab.id}
								aria-pressed={view === tab.id}
								className={view === tab.id ? 'selected' : ''}
								onClick={() => onViewChange(tab.id)}
							>
								<tab.icon size={13} />
								{tab.label}
							</button>
						))}
					</nav>
				)}
				<div className="document-drag-space" data-tauri-drag-region />
			</header>
			{menuOpen && (
				<>
					<button
						className="menu-scrim"
						aria-label="Close project menu"
						onClick={() => onMenuOpenChange(false)}
					/>
					<div className="dropdown-menu project-menu">
						{project && (
							<button onClick={() => choose(() => void session.close())}>
								<ArrowLeft size={14} />
								All projects
							</button>
						)}
						<button onClick={() => choose(onNewProject)}>
							<FilePlus2 size={14} />
							New project
						</button>
						<button onClick={() => choose(() => void session.import())} disabled={!isDesktop()}>
							<Upload size={14} />
							Import project…
						</button>
						{project && (
							<>
								<button onClick={() => choose(onRename)}>Rename project…</button>
								<button onClick={() => choose(() => void session.export())}>
									<Download size={14} />
									Export project…
								</button>
							</>
						)}
						<div className="menu-separator" />
						{project && (
							<>
								<button disabled={!history.undo} onClick={() => choose(() => session.undo())}>
									<Undo2 size={14} />
									Undo<span className="menu-shortcut">⌘Z</span>
								</button>
								<button disabled={!history.redo} onClick={() => choose(() => session.redo())}>
									<Redo2 size={14} />
									Redo<span className="menu-shortcut">⇧⌘Z</span>
								</button>
								<button onClick={() => choose(onAssistant)}>
									<TerminalSquare size={14} />
									Assistant
									{proposalCount > 0 && <span className="menu-shortcut">{proposalCount}</span>}
								</button>
								<button onClick={() => choose(onQuestions)}>
									<MessageCircle size={14} />
									Project questions
								</button>
							</>
						)}
						<button onClick={() => choose(onIntegrations)}>
							<Settings2 size={14} />
							Integrations
						</button>
						{projects.length > 0 && <div className="menu-separator" />}
						{projects.slice(0, 8).map((record) => (
							<button key={record.id} onClick={() => choose(() => void session.open(record.id))}>
								<FolderOpen size={14} />
								{record.name}
								{project?.id === record.id && <Check size={12} />}
							</button>
						))}
					</div>
				</>
			)}
		</>
	);
};
interface TProjectNavigationProps {
	session: ProjectSessionCx;
	view: TWorkspaceView;
	menuOpen: boolean;
	proposalCount: number;
	onMenuOpenChange(open: boolean): void;
	onViewChange(view: TWorkspaceView): void;
	onNewProject(): void;
	onRename(): void;
	onAssistant(): void;
	onQuestions(): void;
	onIntegrations(): void;
}
export type TWorkspaceView = 'parts' | 'canvas';

export const ProjectsHome: React.FC<TProjectsHomeProps> = ({ session, onNewProject }) => {
	const projects = useFeatureState(session.$projects);
	return (
		<main className="projects-home">
			<div className="home-heading">
				<div className="home-logo">
					<Box size={25} />
				</div>
				<h1>Your projects</h1>
				<div className="actions">
					<Button
						icon={<Upload size={14} />}
						disabled={!isDesktop()}
						onClick={() => void session.import()}
					>
						Import…
					</Button>
					<Button variant="primary" icon={<Plus size={14} />} onClick={onNewProject}>
						New project
					</Button>
				</div>
			</div>
			{projects.length ? (
				<div className="project-list">
					{projects.map((record) => (
						<button
							className="project-card"
							key={record.id}
							onClick={() => void session.open(record.id)}
						>
							<span className="project-icon">
								<FolderOpen size={21} />
							</span>
							<span>
								<strong>{record.name}</strong>
								<small>
									{new Date(record.updatedAt).toLocaleDateString(undefined, {
										month: 'short',
										day: 'numeric',
										year: 'numeric'
									})}
								</small>
							</span>
							<ArrowUpRight size={15} />
						</button>
					))}
				</div>
			) : (
				<div className="projects-empty">
					<FolderOpen size={32} strokeWidth={1} />
					<p>Plan your first build.</p>
					<Button onClick={onNewProject}>Create a project</Button>
				</div>
			)}
		</main>
	);
};
interface TProjectsHomeProps {
	session: ProjectSessionCx;
	onNewProject(): void;
}

export const ProjectNameDialog: React.FC<TProjectNameDialogProps> = ({
	mode,
	initialName = '',
	onClose,
	onSubmit
}) => (
	<Modal title={mode === 'create' ? 'New project' : 'Rename project'} onClose={onClose}>
		<form
			onSubmit={(event) => {
				event.preventDefault();
				const value = new FormData(event.currentTarget).get('name');
				onSubmit(typeof value === 'string' ? value.trim() : '');
			}}
		>
			<Field label="Name">
				<input
					autoFocus
					name="name"
					required={mode === 'rename'}
					defaultValue={initialName}
					placeholder={mode === 'create' ? 'My portable home' : undefined}
				/>
			</Field>
			<div className="modal-actions">
				<Button onClick={onClose}>Cancel</Button>
				<Button variant="primary" type="submit">
					{mode === 'create' ? 'Create project' : 'Save'}
				</Button>
			</div>
		</form>
	</Modal>
);
interface TProjectNameDialogProps {
	mode: 'create' | 'rename';
	initialName?: string;
	onClose(): void;
	onSubmit(name: string): void;
}

export const SaveError: React.FC<{ session: ProjectSessionCx }> = ({ session }) => {
	const save = useFeatureState(session.$save);
	if (save.state !== 'error') return null;
	return (
		<footer className="app-status">
			<span className="save-status error" title={save.error ?? save.path}>
				<span />
				Couldn’t save
			</span>
			<button className="text-button" onClick={() => void session.retrySave()}>
				Retry
			</button>
			<button className="text-button" onClick={() => void session.export()}>
				Export a recovery copy
			</button>
			<span className="view-toolbar-spacer" />
		</footer>
	);
};

export const LoadingDialog: React.FC<{ title: string; onClose(): void }> = ({ title, onClose }) => (
	<Modal title={title} onClose={onClose}>
		<div className="panel-loading" role="status">
			Opening…
		</div>
	</Modal>
);
