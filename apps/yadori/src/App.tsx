import { useFeatureState } from 'feature-react/state';
import { X } from 'lucide-react';
import React from 'react';
import './styles/document-chrome.css';
import { IconButton } from './components/ui';
import * as desktop from './environment/desktop';
import { AgentCx } from './modules/agents/AgentCx';
import { CanvasView } from './modules/canvas/CanvasView';
import { libraryItems } from './modules/library/data';
import { PartDialog } from './modules/parts/components/PartDialog';
import { materializeLibraryAssets } from './modules/parts/library-assets';
import { makeSource, PartsCx } from './modules/parts/PartsCx';
import { PartsView } from './modules/parts/PartsView';
import {
	createInstance,
	createLibraryPart,
	createPlacement,
	getCapability,
	type TCommand,
	type TLibraryItem
} from './modules/project/model';
import { ProjectSessionCx } from './modules/projects/ProjectSessionCx';
import { ReviewDialog } from './modules/review/ReviewNotes';
import {
	LoadingDialog,
	ProjectNameDialog,
	ProjectNavigation,
	ProjectsHome,
	SaveError,
	type TWorkspaceView
} from './modules/workspace/WorkspaceChrome';

const PartPage = React.lazy(() =>
	import('./modules/parts/PartPage').then((m) => ({ default: m.PartPage }))
);
const CaptureDialog = React.lazy(() =>
	import('./modules/parts/components/CaptureDialog').then((m) => ({ default: m.CaptureDialog }))
);
const IntegrationSettings = React.lazy(() =>
	import('./modules/pricing').then((m) => ({ default: m.IntegrationSettings }))
);
const AgentsPanel = React.lazy(() =>
	import('./modules/agents/AgentsPanel').then((m) => ({ default: m.AgentsPanel }))
);

export const App: React.FC = () => {
	const [session] = React.useState(() => new ProjectSessionCx());
	const [parts] = React.useState(() => new PartsCx(session));
	const [agents] = React.useState(() => new AgentCx(session));
	const project = useFeatureState(session.$project);
	const notice = useFeatureState(session.$notice);
	const selectedId = useFeatureState(parts.$selectedId);
	const fullPage = useFeatureState(parts.$fullPage);
	const captureOpen = useFeatureState(parts.$captureOpen);
	const jobs = useFeatureState(agents.$jobs);
	const proposals = useFeatureState(agents.$proposals);
	const [view, setView] = React.useState<TWorkspaceView>('canvas');
	const [assistant, setAssistant] = React.useState(false);
	const [settings, setSettings] = React.useState(false);
	const [reviewOpen, setReviewOpen] = React.useState(false);
	const [projectDialog, setProjectDialog] = React.useState<'create' | 'rename' | null>(null);
	const [canvasFocus, setCanvasFocus] = React.useState<{
		id: string;
		kind: 'run' | 'placement';
		nonce: number;
	} | null>(null);
	const [projectMenu, setProjectMenu] = React.useState(false);
	const [busy, setBusy] = React.useState(false);
	const addingLibraryRef = React.useRef(false);
	const selected = project?.parts.find((part) => part.id === selectedId);
	const hasProject = project != null;
	const active = jobs.some((job) => job.state === 'running');
	React.useEffect(() => session.mount(), [session]);
	React.useEffect(() => agents.mount(), [agents]);
	React.useEffect(() => {
		let dispose: (() => void) | undefined;
		let mounted = true;
		if (desktop.isDesktop())
			void desktop
				.registerDesktopCloseGuard(async () => {
					if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
					return session.close();
				})
				.then((fn) => {
					if (mounted) dispose = fn;
					else fn();
				});
		return () => {
			mounted = false;
			dispose?.();
		};
	}, [session]);
	React.useEffect(() => {
		parts.close();
		void agents.refresh();
	}, [project?.id, parts, agents]);
	React.useEffect(() => {
		const key = (event: KeyboardEvent): void => {
			const target = event.target;
			const editing =
				target instanceof HTMLElement &&
				(target.matches('input,textarea,select') || target.isContentEditable);
			if (
				event.key === 'Escape' &&
				!event.defaultPrevented &&
				!editing &&
				!captureOpen &&
				!(target instanceof Element && target.closest('dialog,[role=dialog],[aria-modal=true]'))
			) {
				parts.close();
				return;
			}
			if (!(event.metaKey || event.ctrlKey)) return;
			if (event.key === 's') {
				event.preventDefault();
				void session.flush();
			}
			if (event.key.toLowerCase() === 'z' && !editing) {
				event.preventDefault();
				if (event.shiftKey) session.redo();
				else session.undo();
			}
			if (event.key === 'n') {
				event.preventDefault();
				if (hasProject) parts.$captureOpen.set(true);
				else setProjectDialog('create');
			}
			if (!editing && ['1', '2'].includes(event.key)) {
				event.preventDefault();
				setView(event.key === '1' ? 'parts' : 'canvas');
				parts.close();
			}
		};
		window.addEventListener('keydown', key);
		return () => window.removeEventListener('keydown', key);
	}, [captureOpen, parts, hasProject, session]);
	const addLibrary = React.useCallback(
		async (
			item: TLibraryItem,
			position?: { layoutId: string; xMm: number; yMm: number }
		): Promise<void> => {
			if (addingLibraryRef.current) return;
			const current = session.$project.get();
			if (!current) return;
			addingLibraryRef.current = true;
			setBusy(true);
			try {
				const assets = await materializeLibraryAssets(session, item);
				if (session.$project.get()?.id !== current.id) return;
				const latest = session.$project.get();
				if (!latest) return;
				const existing = latest.parts.find(
					(part) => part.libraryLink?.itemId === item.id && part.buildState !== 'archived'
				);
				const part =
					existing ?? createLibraryPart(item, { buildState: position ? 'in-build' : 'wishlist' });
				const commands: TCommand[] = [...assets];
				if (!existing) {
					commands.push({ type: 'part.add', part });
					if (item.sourceUrl)
						commands.push({
							type: 'source.add',
							source: makeSource(part.id, item.sourceUrl, 'product')
						});
				}
				if (position && existing && part.buildState !== 'in-build')
					commands.push({ type: 'part.update', id: part.id, patch: { buildState: 'in-build' } });
				if (position && !getCapability(item, 'cable')) {
					const units = latest.instances.filter((unit) => unit.partId === part.id);
					const instance =
						units.find((unit) => !latest.placements.some((p) => p.instanceId === unit.id)) ??
						createInstance(part.id);
					if (!units.some((unit) => unit.id === instance.id)) {
						if (units.length >= part.quantity)
							commands.push({
								type: 'part.update',
								id: part.id,
								patch: { quantity: units.length + 1 }
							});
						commands.push({ type: 'instance.add', instance });
					}
					commands.push({
						type: 'placement.add',
						placement: createPlacement(instance.id, position.layoutId, position.xMm, position.yMm)
					});
				}
				if (commands.length && !session.execute(commands, 'Add from library')) return;
				parts.$captureOpen.set(false);
				if (!position) {
					parts.$query.set('');
					parts.$filter.set(part.buildState === 'in-build' ? 'in-build' : 'wishlist');
					parts.open(part.id);
				}
			} catch (error) {
				session.notify(String(error));
			} finally {
				addingLibraryRef.current = false;
				setBusy(false);
			}
		},
		[parts, session]
	);
	const canvasCommands = React.useCallback(
		(commands: TCommand[], label = 'Edit plan') => session.execute(commands, label),
		[session]
	);
	const openCanvasPart = React.useCallback((id: string) => parts.open(id, true), [parts]);
	const addCanvasLibrary = React.useCallback(
		(item: TLibraryItem, position?: { layoutId: string; xMm: number; yMm: number }) => {
			void addLibrary(item, position);
		},
		[addLibrary]
	);
	const capturePart = React.useCallback(() => parts.$captureOpen.set(true), [parts]);
	const openProjectMenu = React.useCallback(() => setProjectMenu(true), []);
	const showParts = React.useCallback(() => {
		setView('parts');
		parts.close();
	}, [parts]);
	const openAssistant = React.useCallback(() => setAssistant(true), []);
	const openIntegrations = React.useCallback(() => setSettings(true), []);
	const partDocument = project && selected && (
		<React.Suspense
			fallback={
				<div className="document-loading" role="status">
					Opening part…
				</div>
			}
		>
			<PartPage
				key={selected.id}
				part={selected}
				project={project}
				cx={parts}
				full={view === 'canvas' || fullPage}
				onEnhance={() => {
					setAssistant(true);
					void agents.enhancePart(selected.id, libraryItems);
				}}
			/>
		</React.Suspense>
	);
	return (
		<div className="app-shell">
			<ProjectNavigation
				session={session}
				view={view}
				menuOpen={projectMenu}
				proposalCount={proposals.length}
				onMenuOpenChange={setProjectMenu}
				onViewChange={(next) => {
					setView(next);
					parts.close();
				}}
				onNewProject={() => setProjectDialog('create')}
				onRename={() => setProjectDialog('rename')}
				onAssistant={openAssistant}
				onQuestions={() => setReviewOpen(true)}
				onIntegrations={openIntegrations}
			/>
			{project ? (
				<main
					className={`workspace view-${view} ${view === 'parts' && selected && !fullPage ? 'has-peek' : ''}`}
				>
					<div
						className="primary-view"
						style={{ display: view === 'canvas' ? undefined : 'none' }}
						inert={view !== 'canvas'}
					>
						<CanvasView
							key={project.id}
							active={view === 'canvas'}
							project={project}
							focusRequest={canvasFocus ?? undefined}
							onCommand={canvasCommands}
							onSelectPart={openCanvasPart}
							onAddPreset={addCanvasLibrary}
							onCreatePart={capturePart}
							onProjectMenu={openProjectMenu}
							onShowParts={showParts}
							onAssistant={openAssistant}
							onIntegrations={openIntegrations}
							assistantBusy={active}
							assistantProposalCount={proposals.length}
						/>
					</div>
					<div
						className="primary-view"
						style={{ display: view === 'parts' && !(fullPage && selected) ? undefined : 'none' }}
						inert={view !== 'parts' || !!(fullPage && selected)}
					>
						<PartsView key={project.id} cx={parts} />
					</div>
					{view === 'parts' && partDocument}
				</main>
			) : (
				<ProjectsHome session={session} onNewProject={() => setProjectDialog('create')} />
			)}
			{project && <SaveError session={session} />}
			{project && view === 'canvas' && fullPage && selected && (
				<PartDialog onClose={() => parts.close()}>{partDocument}</PartDialog>
			)}
			{notice && (
				<div className="toast" role="status">
					{notice}
					<IconButton label="Dismiss message" onClick={() => session.$notice.set(null)}>
						<X size={13} />
					</IconButton>
				</div>
			)}
			{busy && (
				<div className="busy-toast" role="status">
					Adding part…
				</div>
			)}
			{projectDialog && (projectDialog === 'create' || project) && (
				<ProjectNameDialog
					key={projectDialog}
					mode={projectDialog}
					initialName={projectDialog === 'rename' ? project?.name : ''}
					onClose={() => setProjectDialog(null)}
					onSubmit={(name) => {
						if (projectDialog === 'create') void session.create(name);
						else if (name)
							session.execute([{ type: 'project.update', patch: { name } }], 'Rename project');
						else return;
						setProjectDialog(null);
					}}
				/>
			)}
			{captureOpen && project && (
				<React.Suspense
					fallback={
						<LoadingDialog title="Add part" onClose={() => parts.$captureOpen.set(false)} />
					}
				>
					<CaptureDialog
						cx={parts}
						onClose={() => parts.$captureOpen.set(false)}
						onAddLibrary={(item) => void addLibrary(item)}
					/>
				</React.Suspense>
			)}
			{assistant && project && (
				<React.Suspense
					fallback={<LoadingDialog title="Local assistant" onClose={() => setAssistant(false)} />}
				>
					<AgentsPanel cx={agents} onClose={() => setAssistant(false)} />
				</React.Suspense>
			)}
			{reviewOpen && project && (
				<ReviewDialog
					project={project}
					onCommands={(commands) => session.execute(commands, 'Review question')}
					onClose={() => setReviewOpen(false)}
					onOpenTarget={(target) => {
						if (target.type === 'project') return;
						setReviewOpen(false);
						if (target.type === 'part') parts.open(target.id);
						else {
							parts.close();
							setView('canvas');
							setCanvasFocus({ id: target.id, kind: 'run', nonce: Date.now() });
						}
					}}
				/>
			)}
			{settings && (
				<React.Suspense
					fallback={<LoadingDialog title="Integrations" onClose={() => setSettings(false)} />}
				>
					<IntegrationSettings onClose={() => setSettings(false)} />
				</React.Suspense>
			)}
		</div>
	);
};
