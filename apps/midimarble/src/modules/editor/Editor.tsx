import {
	Camera,
	Check,
	ChevronLeft,
	ChevronRight,
	CircleAlert,
	CircleHelp,
	Download,
	Focus,
	FolderOpen,
	Grid3X3,
	Lightbulb,
	Link2,
	LoaderCircle,
	Maximize2,
	Pause,
	Play,
	Redo2,
	Repeat2,
	Settings2,
	SkipBack,
	SkipForward,
	Undo2,
	Volume2,
	X
} from 'lucide-react';
import React from 'react';
import { auditionNote, exportMidi, importMidi } from '../music';
import {
	addProjectNotes,
	createCatalogObject,
	createEmptyProject,
	createProjectHistory,
	createStudioProject,
	deleteProjectNotes,
	downloadFile,
	formatTime,
	getProjectMarbles,
	parseProjectFile,
	updateProjectNotes,
	type TAspectRatio,
	type TCameraSettings,
	type TLightingKeyframe,
	type TNote,
	type TNoteUpdate,
	type TObjectModelId,
	type TProject,
	type TSceneObject,
	type TSceneStyle,
	type TVec3
} from '../project';
import { exampleProjects } from '../project/example-projects';
import {
	cameraPoseToKeyframeSpace,
	convertCameraKeyframeSpace,
	evaluateLighting,
	MarbleScene,
	type TSceneHandle
} from '../scene';
import { CommandPalette } from './CommandPalette';
import { ContextHelp } from './ContextHelp';
import { Dialog } from './Dialog';
import { editorCommands, menuNames } from './editor-commands';
import type { TEditorEntity, TEditorTool, TEditorWorkspace } from './editor-types';
import { EditorDialogs } from './EditorDialogs';
import { ExportPanel } from './ExportPanel';
import { FloatingTools } from './FloatingTools';
import { getNoteTrajectory } from './note-trajectory';
import { getObjectMovePatch } from './object-editing';
import { ObjectTree } from './ObjectTree';
import { ProjectBrowser } from './ProjectBrowser';
import { PropertiesPanel } from './PropertiesPanel';
import { TextInput } from './PropertyFields';
import { getSceneEntityMovePatch } from './scene-entity-editing';
import { useProjectSession } from './use-project-session';
import './editor.css';
import { Timeline } from './Timeline';
import { summarizeTimelineContacts } from './timeline-contacts';
import { useMotionPerformance } from './use-motion-performance';
import { usePanelLayout } from './use-panel-layout';
import { useProjectDownload } from './use-project-download';
import { useTransport } from './use-transport';
import { useVideoExport } from './use-video-export';

export const Editor: React.FC = () => {
	const session = useProjectSession();
	if (!session.ready)
		return (
			<div className="studio-opening" role="status">
				<LoaderCircle size={18} className="spin" /> Opening your studio…
			</div>
		);
	return <Studio session={session} />;
};

const Studio: React.FC<{ session: ReturnType<typeof useProjectSession> }> = ({ session }) => {
	const { persistProject } = session;
	const { panelRef, resizePanel } = usePanelLayout();
	const [history] = React.useState(() =>
		createProjectHistory(session.initialProject ?? createEmptyProject())
	);
	const [hasWorkingProject, setHasWorkingProject] = React.useState(session.initialProject != null);
	const [projectBrowserOpen, setProjectBrowserOpen] = React.useState(
		session.initialProject == null || session.initialError != null
	);
	const [browserError, setBrowserError] = React.useState<string | null>(session.initialError);
	const [loadingExampleId, setLoadingExampleId] = React.useState<string | null>(null);
	const [loadingRecentId, setLoadingRecentId] = React.useState<string | null>(null);
	const [loadingLibraryProjectId, setLoadingLibraryProjectId] = React.useState<string | null>(null);
	const [saveState, setSaveState] = React.useState<'saved' | 'saving' | 'error'>('saved');
	const [pendingProjectSwitch, setPendingProjectSwitch] = React.useState<{
		project: TProject;
		error: string;
		downloadedProject: TProject | null;
	} | null>(null);
	const [fileError, setFileError] = React.useState<{
		message: string;
		kind: 'project' | 'midi';
	} | null>(null);
	const openingRef = React.useRef(false);
	const { project, canUndo, canRedo } = React.useSyncExternalStore(
		history.subscribe,
		history.getSnapshot
	);
	const {
		performance,
		compiling,
		error: compileError,
		retry: retryCompile,
		progress: compileProgress,
		previewStale
	} = useMotionPerformance(project, {
		onStart: () => stop()
	});
	const [selectedNoteId, setSelectedNoteId] = React.useState<string | null>(null);
	const [focusTrackRequest, setFocusTrackRequest] = React.useState<{
		trackId: string;
		token: string;
	} | null>(null);
	const [selectedObjectId, setSelectedObjectId] = React.useState<string | null>(null);
	const [showTrajectory, setShowTrajectory] = React.useState(true);
	const [view, setView] = React.useState<'camera' | 'orbit'>('camera');
	const [inspectorOpen, setInspectorOpen] = React.useState(() =>
		typeof window === 'undefined' ? true : window.matchMedia('(min-width: 901px)').matches
	);
	const [selectedMarbleId, setSelectedMarbleId] = React.useState('main');
	const [selectedTrackId, setSelectedTrackId] = React.useState<string | null>(null);
	const [notePlacementId, setNotePlacementId] = React.useState<string | null>(null);
	const [notePlacementMarbleId, setNotePlacementMarbleId] = React.useState('main');
	const [lightingKeyframeId, setLightingKeyframeId] = React.useState<string | null>(null);
	const [lightingPreview, setLightingPreview] = React.useState<TSceneStyle | null>(null);
	const [orbitAroundSelection, setOrbitAroundSelection] = React.useState(true);
	const [entity, setEntity] = React.useState<TEditorEntity>('project');
	const [keyframeId, setKeyframeId] = React.useState<string | null>(null);
	const [linkingObjectId, setLinkingObjectId] = React.useState<string | null>(null);
	const [draggingObjectId, setDraggingObjectId] = React.useState<string | null>(null);
	const [showGrid, setShowGrid] = React.useState(false);
	const [showSceneHelpers, setShowSceneHelpers] = React.useState(true);
	const [shading, setShading] = React.useState<'rendered' | 'solid' | 'material'>('rendered');
	const [workspace, setWorkspace] = React.useState<TEditorWorkspace>('animation');
	const [addOpen, setAddOpen] = React.useState(false);
	const [frameRequest, setFrameRequest] = React.useState<string | null>(null);
	const [menu, setMenu] = React.useState<string | null>(null);
	const [expandedPreview, setExpandedPreview] = React.useState(false);
	const cameraDistance = project.camera?.distance ?? project.cameraDistance ?? 9.2;
	const [savedProject, setSavedProject] = React.useState(project);
	const [tool, setTool] = React.useState<TEditorTool>('select');
	const [notification, setNotification] = React.useState<TEditorNotification | null>(null);
	const toast = notification?.message ?? null;
	const setToast = React.useCallback((message: string | null) => {
		setNotification((current) => {
			if (message != null && current?.localSaveError) return current;
			return message == null ? null : { message };
		});
	}, []);
	const projectDownload = useProjectDownload();
	const {
		time,
		timeRef,
		playing,
		startingAudio,
		volume,
		setVolume,
		loop,
		setLoop,
		stop,
		seek,
		play
	} = useTransport(project, setToast, performance);
	const [modal, setModal] = React.useState<
		'export' | 'help' | 'settings' | 'commands' | 'file-error' | 'switch-project' | null
	>(null);
	const [importing, setImporting] = React.useState(false);
	const [sceneError, setSceneError] = React.useState<string | null>(null);
	const inputRef = React.useRef<HTMLInputElement>(null);
	const midiInputRef = React.useRef<HTMLInputElement>(null);
	const sceneRef = React.useRef<TSceneHandle | null>(null);
	const videoExport = useVideoExport({
		project,
		performance,
		compiling,
		sceneError,
		sceneRef,
		onStop: stop,
		onMessage: setToast
	});
	const { exporting } = videoExport;
	const contactStatus = React.useMemo(() => {
		if (compileError != null) return 'Simulation failed';
		if (performance == null) return 'Ready';
		const { linked, aligned, unlinked, recontacts, extra } = summarizeTimelineContacts(performance);
		const parts: string[] = [];
		if (linked > 0) parts.push(`${aligned}/${linked} linked contacts aligned`);
		if (unlinked > 0) parts.push(`${unlinked} unlinked ${unlinked === 1 ? 'note' : 'notes'}`);
		if (recontacts > 0)
			parts.push(`${recontacts} ${recontacts === 1 ? 'recontact' : 'recontacts'}`);
		if (extra > 0) parts.push(`${extra} extra ${extra === 1 ? 'hit' : 'hits'}`);
		return parts.join(' · ') || 'Ready';
	}, [performance, compileError]);
	function changeWorkspace(next: TEditorWorkspace) {
		if (exporting) return;
		setWorkspace(next);
		setView(next === 'layout' ? 'orbit' : 'camera');
		setShowGrid(next === 'layout');
		setShading(next === 'layout' ? 'material' : 'rendered');
		setExpandedPreview(next === 'render');
	}
	function enterOrbitView() {
		if (workspace === 'render') changeWorkspace('layout');
		else setView('orbit');
	}
	function toggleCameraView() {
		if (view === 'camera') enterOrbitView();
		else setView('camera');
	}
	const selectedObject = project.objects.find((object) => object.id === selectedObjectId) ?? null;
	const selectedNote = project.notes.find((note) => note.id === selectedNoteId) ?? null;
	const canTransform = selectedObject != null && !selectedObject.locked;
	const helperEntity = entity === 'camera' || entity === 'lighting' ? entity : null;
	const helperAnimated =
		helperEntity === 'camera'
			? (project.camera?.keyframes.length ?? 0) > 0
			: (project.scene?.keyframes?.length ?? 0) > 0;
	const canMove =
		canTransform ||
		(helperEntity != null && view === 'orbit' && showSceneHelpers && !helperAnimated);
	const sceneTool = (
		tool === 'move' ? !canMove : ['rotate', 'scale'].includes(tool) && !canTransform
	)
		? 'select'
		: tool;
	const selectionFrameId =
		selectedObjectId ?? (helperEntity == null ? undefined : `entity:${helperEntity}`);
	const transformHint = selectedObject?.locked
		? 'Unlock the selected object to transform it.'
		: entity === 'marble'
			? "Edit the marble's launch position in Properties."
			: helperEntity == null
				? undefined
				: helperAnimated
					? 'Edit animated camera or lighting keys in Properties.'
					: 'Use Properties to change the camera aim or lighting settings.';
	function moveSceneEntity(next: 'camera' | 'lighting', position: TVec3, focus: TVec3) {
		if (exporting) return;
		const patch = getSceneEntityMovePatch(history.getSnapshot().project, next, position, focus);
		if (patch != null) updateProject(patch);
	}
	function linkObject(objectId: string, noteId: string) {
		if (exporting) return;
		const current = history.getSnapshot().project;
		const object = current.objects.find((item) => item.id === objectId);
		if (object == null || object.locked || !current.notes.some((note) => note.id === noteId)) {
			setLinkingObjectId(null);
			setTool('select');
			setToast('Choose an unlocked object and an existing note to link.');
			return;
		}
		const existing =
			object.kind === 'rail'
				? null
				: current.objects.find(
						(object) => object.binding?.noteId === noteId && object.id !== objectId
					);
		if (existing) {
			setToast('This note is already linked. Unlink its current object first.');
			return;
		}
		history.update((draft) => {
			const object = draft.objects.find((item) => item.id === objectId);
			if (object && !object.locked) {
				if (object.binding == null && object.trajectoryAnchor == null && object.marbleId == null)
					object.marbleId = getNoteTrajectory(current, noteId, selectedMarbleId);
				if (object.kind === 'rail') {
					object.binding = null;
					object.trajectoryAnchor = {
						time: current.notes.find((note) => note.id === noteId)?.time ?? 0,
						offset: [0, 0, 0]
					};
				} else {
					object.binding = { noteId, offset: [0, 0, 0] };
					delete object.trajectoryAnchor;
				}
			}
		});
		setSelectedObjectId(objectId);
		setSelectedNoteId(noteId);
		setEntity('object');
		setLinkingObjectId(null);
		setTool('select');
		setToast(
			object.kind === 'rail'
				? 'Rail follows the trajectory at this time. Rolling sounds follow contact.'
				: 'Linked to the note. This object now follows the updated trajectory.'
		);
	}
	function selectNote(id: string) {
		if (linkingObjectId) {
			linkObject(linkingObjectId, id);
			return;
		}
		setSelectedNoteId(id);
		setSelectedObjectId(null);
		sceneRef.current?.cancelTransform();
		if (tool !== 'hand') setTool('select');
		setEntity('note');
		setInspectorOpen(true);
	}
	function selectObject(id: string | null) {
		sceneRef.current?.cancelTransform();
		setSelectedObjectId(id);
		setSelectedNoteId(
			history.getSnapshot().project.objects.find((object) => object.id === id)?.binding?.noteId ??
				null
		);
		setLinkingObjectId(null);
		if (tool === 'link') setTool('select');
		setEntity(id ? 'object' : 'project');
		setInspectorOpen(true);
	}
	function selectEntity(next: TEditorEntity) {
		sceneRef.current?.cancelTransform();
		setEntity(next);
		setSelectedObjectId(null);
		setSelectedNoteId(null);
		setLinkingObjectId(null);
		if (next === 'lighting') {
			const keys = [...(history.getSnapshot().project.scene?.keyframes ?? [])].sort(
				(a, b) => a.time - b.time
			);
			const current = keys.filter((key) => key.time <= timeRef.current).at(-1) ?? keys[0];
			setLightingKeyframeId(current?.id ?? null);
		}
		if (tool !== 'hand') setTool('select');
		setInspectorOpen(true);
	}
	function beginLink() {
		if (!selectedObject || selectedObject.locked) {
			setToast('Select an unlocked object to link it to a note.');
			return;
		}
		setLinkingObjectId(selectedObject.id);
		setTool('link');
		setShowTrajectory(true);
		setToast('Click a note in the trajectory or timeline. Escape cancels.');
	}
	function changeTool(next: TEditorTool) {
		if (['move', 'rotate', 'scale'].includes(next)) {
			if (next === 'move' ? !canMove : !canTransform) {
				setToast(transformHint ?? 'Select an unlocked scene object to transform it.');
				return;
			}
			stop();
		}
		sceneRef.current?.cancelTransform();
		if (next === 'link') beginLink();
		else {
			setTool(next);
			if (next === 'hand') enterOrbitView();
			setLinkingObjectId(null);
		}
	}
	function updateObjectById(id: string, patch: Partial<TSceneObject>) {
		if (exporting) return;
		history.update((draft) => {
			const object = draft.objects.find((item) => item.id === id);
			if (object == null) return;
			if (object.locked) {
				if (patch.locked != null) object.locked = patch.locked;
				if (patch.disabled != null) object.disabled = patch.disabled;
				return;
			}
			Object.assign(object, patch);
		});
	}
	function updateProject(patch: Partial<TProject>) {
		history.update((draft) => Object.assign(draft, patch));
	}
	const updateNotes = React.useCallback(
		(updates: TNoteUpdate[]) => {
			if (exporting) return;
			history.update((draft) => updateProjectNotes(draft, updates));
		},
		[history, exporting]
	);
	const updateNote = React.useCallback(
		(id: string, patch: Partial<TNote>) => updateNotes([{ id, patch }]),
		[updateNotes]
	);
	const updateObject = React.useCallback(
		(patch: Partial<TSceneObject>) =>
			history.update((draft) => {
				const object = draft.objects.find((item) => item.id === selectedObjectId);
				if (object != null && !object.locked) Object.assign(object, patch);
			}),
		[history, selectedObjectId]
	);
	const transformObject = React.useCallback(
		(id: string, position: TVec3) => {
			const resolved = performance?.objects.find((object) => object.id === id);
			history.update((draft) => {
				const object = draft.objects.find((item) => item.id === id);
				if (object == null || object.locked) return;
				const patch = getObjectMovePatch(object, resolved, position);
				if (patch) Object.assign(object, patch);
			});
		},
		[history, performance]
	);

	function changeLibrary(open: boolean, noteId: string | null = null) {
		setNotePlacementId(noteId);
		if (open && noteId != null)
			setNotePlacementMarbleId(getNoteTrajectory(project, noteId, selectedMarbleId));
		setAddOpen(open);
	}
	function placeObject(modelId: TObjectModelId) {
		if (exporting) return;
		if (project.objects.length >= 600) {
			setToast('This project has reached the 600 object limit.');
			return;
		}
		const point = sceneRef.current?.getPlacementPoint() ?? project.launch.position;
		const object = createCatalogObject(modelId, [
			point[0],
			point[1] - project.launch.radius - 0.1,
			point[2]
		]);
		const note = project.notes.find((item) => item.id === notePlacementId);
		if (
			note &&
			object.kind !== 'rail' &&
			!project.objects.some((item) => item.binding?.noteId === note.id)
		) {
			object.binding = { noteId: note.id, offset: [0, 0, 0] };
			object.marbleId = notePlacementMarbleId;
		}
		history.update((draft) => {
			draft.objects.push(object);
		});
		setNotePlacementId(null);
		selectObject(object.id);
		setExpandedPreview(false);
		if (object.binding != null) {
			setTool('select');
			setFrameRequest(view === 'orbit' ? object.id : null);
			if (workspace === 'render') setWorkspace('animation');
		} else {
			setTool('move');
			setFrameRequest(null);
			setInspectorOpen(true);
			if (workspace === 'render') setWorkspace('animation');
		}
		setToast(
			object.binding
				? 'Instrument added and fitted to the note. Adjust its angle to shape the next bounce.'
				: 'World object added. Use Link to attach it to a note.'
		);
	}
	function duplicateSelection() {
		if (exporting) return;
		const current = history.getSnapshot().project;
		const original = current.objects.find((object) => object.id === selectedObjectId);
		if (original == null || current.objects.length >= 600) return;
		const copy = structuredClone(original);
		copy.id = crypto.randomUUID();
		copy.name += ' copy';
		copy.binding = null;
		delete copy.trajectoryAnchor;
		copy.locked = false;
		const resolved = performance?.objects.find((object) => object.id === original.id);
		copy.position = [
			(resolved?.position[0] ?? copy.position[0]) + 0.5,
			resolved?.position[1] ?? copy.position[1],
			resolved?.position[2] ?? copy.position[2]
		];
		history.update((draft) => {
			draft.objects.push(copy);
		});
		selectObject(copy.id);
	}
	function addCameraKeyframe() {
		if (compiling || performance == null || sceneError != null) {
			setToast('Wait for the trajectory before keying the camera.');
			return;
		}
		const pose = sceneRef.current?.getCameraPose();
		if (!pose) return;
		const key = {
			id: crypto.randomUUID(),
			time: timeRef.current,
			...cameraPoseToKeyframeSpace(project, performance, timeRef.current, pose)
		};
		const camera: TCameraSettings = structuredClone(
			project.camera ?? {
				fov: 40,
				distance: cameraDistance,
				azimuth: 0.2,
				elevation: 0.25,
				lead: 0.1,
				keyframes: []
			}
		);
		const at = camera.keyframes.findIndex((item) => Math.abs(item.time - key.time) < 1 / 30);
		if (at >= 0) camera.keyframes.splice(at, 1, key);
		else camera.keyframes.push(key);
		camera.keyframes.sort((a, b) => a.time - b.time);
		updateProject({ camera });
		setKeyframeId(key.id);
		selectEntity('camera');
		setToast('Camera pose keyed at the playhead.');
	}
	function changeCameraSpace(space: NonNullable<TCameraSettings['keyframeSpace']>) {
		const camera = project.camera ?? {
			fov: 40,
			distance: cameraDistance,
			azimuth: 0.2,
			elevation: 0.25,
			lead: 0.1,
			keyframes: []
		};
		if ((camera.keyframeSpace ?? 'world') === space) return;
		if (camera.keyframes.length > 0 && (compiling || performance == null)) {
			setToast('Wait for the trajectory before changing camera keyframe space.');
			return;
		}
		updateProject({
			camera: {
				...camera,
				keyframeSpace: space,
				keyframes: convertCameraKeyframeSpace(project, performance, space)
			}
		});
		setToast(
			space === 'follow'
				? 'Camera keys now follow the run; views at key times are preserved.'
				: 'Camera keys now stay in world space; views at key times are preserved.'
		);
	}

	async function openProject(next: TProject, allowWithoutAutosave = false): Promise<boolean> {
		if (openingRef.current) return false;
		openingRef.current = true;
		let outgoingSaved = !hasWorkingProject || allowWithoutAutosave;
		let localSaveError: string | null = null;
		try {
			if (hasWorkingProject && !allowWithoutAutosave) {
				await persistProject(history.getSnapshot().project);
			}
			outgoingSaved = true;
			await persistProject(next);
		} catch (error) {
			localSaveError = error instanceof Error ? error.message : 'Browser autosave is unavailable.';
			if (!outgoingSaved) {
				setBrowserError(localSaveError);
				setSaveState('error');
				setPendingProjectSwitch({ project: next, error: localSaveError, downloadedProject: null });
				setProjectBrowserOpen(false);
				setModal('switch-project');
				openingRef.current = false;
				return false;
			}
		}
		setPendingProjectSwitch(null);
		setHasWorkingProject(true);
		setFocusTrackRequest(null);
		setProjectBrowserOpen(false);
		setBrowserError(localSaveError);
		setLightingPreview(null);
		stop();
		history.replace(next);
		setSavedProject(next);
		setSaveState(localSaveError == null ? 'saved' : 'error');
		if (localSaveError != null) {
			setNotification({ message: localSaveError, localSaveError: true });
		} else {
			setNotification((current) => (current?.localSaveError ? null : current));
		}
		seek(0);
		selectEntity('project');
		setModal(null);
		videoExport.adjustSettings();
		setMenu(null);
		setKeyframeId(null);
		setLightingKeyframeId(null);
		setLinkingObjectId(null);
		setTool('select');
		setFrameRequest(null);
		setWorkspace('animation');
		setExpandedPreview(false);
		setShowGrid(false);
		setShading('rendered');
		changeLibrary(false);
		setNotePlacementId(null);
		setSelectedTrackId(null);
		setSelectedMarbleId('main');
		setView('camera');
		setSceneError(null);
		openingRef.current = false;
		return true;
	}
	function showProjects() {
		stop();
		setModal(null);
		setMenu(null);
		setBrowserError(null);
		setProjectBrowserOpen(true);
	}
	async function openExample(id: string) {
		if (loadingExampleId != null || loadingRecentId != null) return;
		const example = exampleProjects.find((item) => item.id === id);
		if (example == null) return;
		setLoadingExampleId(id);
		setBrowserError(null);
		try {
			const response = await fetch(example.file);
			if (!response.ok) throw new Error('This example could not be loaded. Try again.');
			const next = parseProjectFile(await response.text());
			next.id = crypto.randomUUID();
			await openProject(next);
		} catch (error) {
			setBrowserError(error instanceof Error ? error.message : 'The example could not be opened.');
		} finally {
			setLoadingExampleId(null);
		}
	}
	async function openRecent(id: string) {
		if (loadingExampleId != null || loadingRecentId != null) return;
		setLoadingRecentId(id);
		setBrowserError(null);
		try {
			const next = await session.loadRecentProject(id);
			if (next == null)
				throw new Error(
					'This project is no longer available on this device. Open its .marble file.'
				);
			await openProject(next);
		} catch (error) {
			setBrowserError(error instanceof Error ? error.message : 'The project could not be opened.');
		} finally {
			setLoadingRecentId(null);
		}
	}
	async function changeProjectArchive(id: string, archived: boolean) {
		if (loadingLibraryProjectId != null || (archived && id === project.id)) return;
		setLoadingLibraryProjectId(id);
		setBrowserError(null);
		try {
			if (archived) await session.archiveProject(id);
			else await session.restoreProject(id);
		} catch (error) {
			setBrowserError(
				error instanceof Error ? error.message : 'The project library could not be updated.'
			);
		} finally {
			setLoadingLibraryProjectId(null);
		}
	}
	function addLightingKeyframe() {
		if (exporting) return;
		stop();
		const current = history.getSnapshot().project;
		const at = timeRef.current;
		const existing = current.scene?.keyframes?.find((key) => Math.abs(key.time - at) < 1 / 30);
		const key: TLightingKeyframe = {
			id: existing?.id ?? crypto.randomUUID(),
			time: at,
			...evaluateLighting(current.scene, at)
		};
		history.update((draft) => {
			draft.scene ??= { theme: 'studio', ...evaluateLighting(undefined, 0), bloom: 0.6 };
			draft.scene.keyframes = [
				...(draft.scene.keyframes ?? []).filter((item) => item.id !== key.id),
				key
			].sort((a, b) => a.time - b.time);
		});
		selectEntity('lighting');
		setLightingKeyframeId(key.id);
	}
	function selectLightingKeyframe(id: string | null) {
		selectEntity('lighting');
		setLightingKeyframeId(id);
	}
	function moveLightingKeyframe(id: string, at: number) {
		if (exporting) return;
		history.update((draft) => {
			const key = draft.scene?.keyframes?.find((item) => item.id === id);
			if (key) key.time = Math.max(0, Math.min(draft.duration, at));
			draft.scene?.keyframes?.sort((a, b) => a.time - b.time);
		});
	}
	function deleteLightingKeyframe(id: string) {
		if (exporting) return;
		history.update((draft) => {
			if (draft.scene?.keyframes)
				draft.scene.keyframes = draft.scene.keyframes.filter((key) => key.id !== id);
		});
		if (lightingKeyframeId === id) setLightingKeyframeId(null);
	}
	function deleteNotes(ids: string[]) {
		if (exporting || !ids.length) return;
		let removed = false;
		history.update((draft) => {
			removed = deleteProjectNotes(draft, ids);
		});
		if (!removed) {
			setToast('Unlock linked objects before deleting these notes.');
			return;
		}
		if (selectedNoteId != null && ids.includes(selectedNoteId)) selectEntity('project');
	}
	function deleteNote(id: string) {
		deleteNotes([id]);
	}
	function addNotes(notes: TNote[]): boolean {
		if (exporting || !notes.length) return false;
		let error: string | null = null;
		history.update((draft) => {
			error = addProjectNotes(draft, notes);
		});
		if (error != null) setToast(error);
		return error == null;
	}

	function deleteSelection() {
		if (exporting) return;
		if (entity === 'camera' && keyframeId) {
			history.update((draft) => {
				if (draft.camera)
					draft.camera.keyframes = draft.camera.keyframes.filter((key) => key.id !== keyframeId);
			});
			setKeyframeId(null);
			return;
		}
		const current = history.getSnapshot().project;
		const object = current.objects.find((item) => item.id === selectedObjectId);
		if (object != null) {
			if (object.locked) {
				setToast('Unlock this object before deleting it.');
				return;
			}
			history.update((draft) => {
				draft.objects = draft.objects.filter((item) => item.id !== object.id);
			});
			selectEntity('project');
			return;
		}
		if (entity === 'note' && selectedNoteId) deleteNote(selectedNoteId);
	}

	function unlinkObject() {
		if (selectedObject == null || selectedObject.locked || exporting) return;
		if (compiling) {
			setToast('Wait for the trajectory before keeping this object’s resolved position.');
			return;
		}
		const resolved = performance?.objects.find((object) => object.id === selectedObject.id);
		if (
			(selectedObject.binding != null || selectedObject.trajectoryAnchor != null) &&
			resolved == null
		) {
			setToast('Resolve the trajectory before keeping this object’s world position.');
			return;
		}
		updateObject({
			binding: null,
			trajectoryAnchor: undefined,
			position: resolved?.position ?? selectedObject.position
		});
		setSelectedNoteId(null);
		setToast('Unlinked. This object now keeps its world position.');
	}

	async function importFile(file: File, kind: 'project' | 'midi') {
		stop();
		setImporting(true);
		try {
			if (file.size > 20 * 1024 * 1024)
				throw new Error('Choose a MIDI or project file smaller than 20 MB.');
			if (kind === 'project') {
				const loaded = parseProjectFile(await file.text());
				if (!(await openProject(loaded))) return;
				setToast(`Opened ${loaded.name}`);
				return;
			}
			const imported = await importMidi(file);
			const next = createEmptyProject();
			next.id = crypto.randomUUID();
			next.name = imported.name || file.name.replace(/\.[^.]+$/, '');
			next.bpm = imported.bpm;
			next.duration = Math.min(120, Math.max(5, imported.duration));
			next.notes = imported.notes;
			next.tracks = imported.tracks;
			next.tempos = imported.tempos;
			next.objects = [];
			if (imported.duration > 120)
				throw new Error('For now, import a MIDI excerpt shorter than two minutes.');
			if (!(await openProject(next))) return;
			setSelectedNoteId(next.notes[0]?.id ?? null);
			setEntity(next.notes.length ? 'note' : 'project');
			setToast('MIDI imported. Add world objects, then link them to notes.');
		} catch (error) {
			const message = error instanceof Error ? error.message : 'That file could not be opened.';
			if (projectBrowserOpen) setBrowserError(message);
			else {
				setFileError({ message, kind });
				setModal('file-error');
			}
		} finally {
			setImporting(false);
		}
	}

	function saveProject() {
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
		const current = history.getSnapshot().project;
		projectDownload.save(current);
		setNotification({ message: 'Project file ready.', projectDownload: true });
	}
	function addTrack() {
		if (project.tracks.length >= 64) {
			setToast('This project has reached the 64 track limit.');
			return;
		}
		const id = crypto.randomUUID();
		history.update((draft) => {
			draft.tracks.push({
				id,
				name: `Track ${draft.tracks.length + 1}`,
				instrument: 10,
				color: '#76c5d8',
				muted: false
			});
		});
		setSelectedTrackId(id);
		selectEntity('track');
	}
	function selectTrack(id: string) {
		setSelectedTrackId(id);
		selectEntity('track');
	}
	function selectMarble(id = 'main') {
		setSelectedMarbleId(id);
		selectEntity('marble');
	}
	function startWritingMusic() {
		const current = history.getSnapshot().project;
		const trackId = current.tracks[0]?.id ?? crypto.randomUUID();
		if (!current.tracks.length)
			history.update((draft) => {
				draft.tracks.push({
					id: trackId,
					name: 'Piano',
					color: '#9675dc',
					instrument: 0,
					muted: false
				});
			});
		setFocusTrackRequest({ trackId, token: crypto.randomUUID() });
		setWorkspace('animation');
		selectTrack(trackId);
	}

	function addNoteAtPlayhead() {
		addNote(
			selectedNote?.trackId ?? selectedTrackId ?? project.tracks[0]?.id ?? 'melody',
			timeRef.current
		);
	}
	function addNote(trackId: string, at: number, midi = 72, duration = 0.36, velocity = 0.75) {
		if (exporting || !Number.isFinite(at) || !Number.isFinite(midi)) return;
		const current = history.getSnapshot().project;
		if (current.notes.length >= 2000) {
			setToast('This project has reached the 2,000 note limit.');
			return;
		}
		const track = current.tracks.find((item) => item.id === trackId) ??
			current.tracks[0] ?? {
				id: crypto.randomUUID(),
				name: 'Melody',
				color: '#80d9ff',
				instrument: 10,
				muted: false
			};
		const noteTime = Math.max(0, Math.min(current.duration - 0.001, at));
		const note: TNote = {
			id: crypto.randomUUID(),
			trackId: track.id,
			time: noteTime,
			midi: Math.min(127, Math.max(0, Math.round(midi))),
			duration: Math.min(Math.max(0.001, duration), current.duration - noteTime),
			velocity: Math.max(0, Math.min(1, velocity))
		};
		history.update((draft) => {
			if (!draft.tracks.some((item) => item.id === track.id)) draft.tracks.push(track);
			draft.notes.push(note);
		});
		setSelectedNoteId(note.id);
		setSelectedObjectId(null);
		setEntity('note');
		setInspectorOpen(true);
		setLinkingObjectId(null);
		if (tool === 'link') setTool('select');
	}

	// MARK: - Effects
	React.useEffect(() => {
		if (!hasWorkingProject || project === savedProject) return;
		const timer = setTimeout(() => {
			if (openingRef.current || history.getSnapshot().project !== project) return;
			setSaveState('saving');
			void persistProject(project)
				.then(() => {
					if (history.getSnapshot().project !== project) return;
					setSavedProject(project);
					setSaveState('saved');
					setNotification((current) => (current?.localSaveError ? null : current));
				})
				.catch((error: unknown) => {
					if (history.getSnapshot().project !== project) return;
					setSaveState('error');
					setBrowserError(
						error instanceof Error ? error.message : 'Download your project to keep it.'
					);
					setNotification({
						message: 'Local save failed. Download your .marble project to keep it.',
						localSaveError: true
					});
				});
		}, 400);
		return () => clearTimeout(timer);
	}, [project, savedProject, hasWorkingProject, persistProject, history, setToast]);
	React.useEffect(() => {
		function saveBeforeLeaving() {
			if (!hasWorkingProject) return;
			if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
			const current = history.getSnapshot().project;
			if (current === savedProject) return;
			void persistProject(current).catch(() => undefined);
		}
		window.addEventListener('pagehide', saveBeforeLeaving);
		return () => window.removeEventListener('pagehide', saveBeforeLeaving);
	}, [history, savedProject, hasWorkingProject, persistProject]);

	React.useEffect(() => {
		if (notification == null || notification.projectDownload || notification.localSaveError) return;
		const timer = setTimeout(() => setToast(null), 6500);
		return () => clearTimeout(timer);
	}, [notification, setToast]);
	React.useEffect(() => {
		if (menu == null) return;
		function closeMenu(event: PointerEvent) {
			if (
				event.target instanceof Element &&
				event.target.closest('.menu-wrap, [data-menu-trigger]') != null
			)
				return;
			setMenu(null);
		}
		window.addEventListener('pointerdown', closeMenu);
		return () => window.removeEventListener('pointerdown', closeMenu);
	}, [menu]);
	React.useEffect(
		() =>
			history.subscribe(() => {
				const project = history.getSnapshot().project;
				if (
					selectedObjectId != null &&
					!project.objects.some((object) => object.id === selectedObjectId)
				) {
					setSelectedObjectId(null);
					if (entity === 'object') {
						setSelectedNoteId(null);
						setEntity('project');
					}
				}
				if (selectedNoteId != null && !project.notes.some((note) => note.id === selectedNoteId)) {
					setSelectedNoteId(null);
					if (entity === 'note') setEntity('project');
				}
				if (
					linkingObjectId != null &&
					!project.objects.some((object) => object.id === linkingObjectId && !object.locked)
				) {
					setLinkingObjectId(null);
					setTool('select');
				}
				if (
					keyframeId != null &&
					!project.camera?.keyframes.some((keyframe) => keyframe.id === keyframeId)
				)
					setKeyframeId(null);
				if (
					lightingKeyframeId != null &&
					!project.scene?.keyframes?.some((key) => key.id === lightingKeyframeId)
				)
					setLightingKeyframeId(null);
			}),
		[
			history,
			selectedObjectId,
			selectedNoteId,
			linkingObjectId,
			keyframeId,
			lightingKeyframeId,
			entity
		]
	);
	React.useEffect(() => {
		function keyDown(event: KeyboardEvent) {
			if (event.defaultPrevented || projectBrowserOpen) return;
			const target = event.target instanceof Element ? event.target : null;
			const typing = target?.closest('input, textarea, select, [contenteditable]') != null;
			const inTimeline = target?.closest('.mm-timeline') != null;
			const modifier = event.metaKey || event.ctrlKey;
			if (modifier && event.key.toLowerCase() === 's') {
				event.preventDefault();
				if (!event.repeat) saveProject();
				return;
			}
			if (exporting) return;
			if (event.key === 'F3' || (modifier && event.key.toLowerCase() === 'k')) {
				event.preventDefault();
				changeLibrary(false);
				setModal('commands');
				return;
			}
			if (modifier && event.key.toLowerCase() === 'z' && target?.matches('input[type="range"]')) {
				event.preventDefault();
				if (event.shiftKey) history.redo();
				else history.undo();
				return;
			}
			if (typing) return;
			if (event.key === 'Escape') {
				if (document.querySelector(':popover-open')) return;
				sceneRef.current?.cancelTransform();
				setModal(null);
				setMenu(null);
				changeLibrary(false);
				setLinkingObjectId(null);
				setTool('select');
				return;
			}
			if (
				modal != null ||
				addOpen ||
				draggingObjectId != null ||
				sceneRef.current?.isTransforming()
			)
				return;
			const control = target?.closest(
				'button, a[href], summary, [role="button"], [role="checkbox"], [role="switch"]'
			);
			if (control != null && (event.code === 'Space' || event.key === 'Enter')) return;
			if (control != null && !modifier && !inTimeline && target?.closest('.object-tree') == null)
				return;
			if (event.code === 'Space') {
				event.preventDefault();
				if (event.repeat) return;
				if (event.shiftKey) {
					setExpandedPreview(!expandedPreview);
					return;
				}
				if (!compiling && performance != null && sceneError == null) void play();
				return;
			}
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
				event.preventDefault();
				if (event.shiftKey) history.redo();
				else history.undo();
			}
			if (event.key === 'Delete' || event.key === 'Backspace') {
				event.preventDefault();
				if (!inTimeline) deleteSelection();
			}
			if (event.key === 'ArrowRight') seek(timeRef.current + (event.shiftKey ? 1 : 1 / 30));
			if (event.key === 'ArrowLeft') seek(timeRef.current - (event.shiftKey ? 1 : 1 / 30));
			if (event.metaKey || event.ctrlKey) return;
			if (inTimeline) return;
			const key = event.key.toLowerCase();
			if (event.shiftKey && key === 'a') {
				event.preventDefault();
				if (!event.repeat) changeLibrary(!addOpen);
			} else if (event.shiftKey && key === 'd') {
				event.preventDefault();
				if (!event.repeat) duplicateSelection();
			} else if (key === 'v') changeTool('select');
			else if (key === 'g' || key === 'r' || key === 's') {
				const mode = key === 'g' ? 'move' : key === 'r' ? 'rotate' : 'scale';
				changeTool(mode);
				sceneRef.current?.beginTransform(mode);
			} else if (key === 'h') changeTool('hand');
			else if (key === 'n' && !event.repeat) setInspectorOpen(!inspectorOpen);
			else if (event.code === 'Numpad0' && !event.repeat) toggleCameraView();
			else if (key === 'l') beginLink();
			else if (key === 'f' || event.code === 'NumpadDecimal') {
				enterOrbitView();
				sceneRef.current?.frameSelected(selectionFrameId);
			} else if (event.key === 'Home') {
				event.preventDefault();
				enterOrbitView();
				sceneRef.current?.frameAll();
			} else if (['x', 'y', 'z'].includes(key)) sceneRef.current?.setAxis(key as 'x' | 'y' | 'z');
			else if (event.code === 'Numpad1') {
				enterOrbitView();
				sceneRef.current?.setView('front');
			} else if (event.code === 'Numpad3') {
				enterOrbitView();
				sceneRef.current?.setView('right');
			} else if (event.code === 'Numpad7') {
				enterOrbitView();
				sceneRef.current?.setView('top');
			}
		}
		window.addEventListener('keydown', keyDown);
		return () => window.removeEventListener('keydown', keyDown);
	});

	React.useEffect(() => {
		if (
			frameRequest == null ||
			compiling ||
			!performance?.objects.some((object) => object.id === frameRequest)
		)
			return;
		const frame = requestAnimationFrame(() => {
			sceneRef.current?.frameSelected(frameRequest);
			setFrameRequest(null);
		});
		return () => cancelAnimationFrame(frame);
	}, [frameRequest, compiling, performance]);

	function runCommand(id: string) {
		setModal(null);
		setMenu(null);
		if (id.startsWith('add:')) {
			placeObject(id.slice(4) as TObjectModelId);
			return;
		}
		if (id.startsWith('tool:')) {
			changeTool(id.slice(5) as TEditorTool);
			return;
		}
		switch (id) {
			case 'play':
				if (!compiling) void play();
				break;
			case 'undo':
				history.undo();
				break;
			case 'redo':
				history.redo();
				break;
			case 'import':
				inputRef.current?.click();
				break;
			case 'import-midi':
				midiInputRef.current?.click();
				break;
			case 'projects':
				showProjects();
				break;
			case 'commands':
				setModal('commands');
				break;
			case 'export-midi':
				exportMidiFile();
				break;
			case 'save':
				saveProject();
				break;
			case 'export':
				setModal('export');
				break;
			case 'frame-selected':
				enterOrbitView();
				sceneRef.current?.frameSelected(selectionFrameId);
				break;
			case 'frame-all':
				enterOrbitView();
				sceneRef.current?.frameAll();
				break;
			case 'camera':
				setView('camera');
				break;
			case 'orbit-selected':
				setOrbitAroundSelection((value) => !value);
				break;
			case 'grid':
				setShowGrid((value) => !value);
				break;
			case 'path':
				setShowTrajectory((value) => !value);
				break;
			case 'solid':
				setShading('solid');
				break;
			case 'material':
				setShading('material');
				break;
			case 'rendered':
				setShading('rendered');
				break;
			case 'link':
				beginLink();
				break;
			case 'unlink':
				unlinkObject();
				break;
			case 'duplicate':
				duplicateSelection();
				break;
			case 'delete':
				deleteSelection();
				break;
			case 'track':
				addTrack();
				break;
			case 'note':
				addNoteAtPlayhead();
				break;
			case 'new':
				showProjects();
				break;
			case 'settings':
				setModal('settings');
				break;
			case 'key-camera':
				addCameraKeyframe();
				break;
			case 'key-lighting':
				addLightingKeyframe();
				break;
			case 'help':
				setModal('help');
				break;
		}
	}

	const menuItems: Record<
		string,
		{ id?: string; label: string; shortcut?: string; disabled?: boolean }[]
	> = {
		File: [
			{ id: 'projects', label: 'Projects…' },
			{ id: 'new', label: 'New project…' },
			{ id: 'import', label: 'Open project…' },
			{ id: 'import-midi', label: 'Import MIDI…' },
			{ id: 'save', label: 'Save project', shortcut: '⌘S' },
			{
				id: 'export',
				label: 'Export video…',
				disabled: compiling || !performance || sceneError != null
			},
			{ id: 'export-midi', label: 'Export MIDI' }
		],
		Edit: [
			{ label: 'Undo', shortcut: '⌘Z', disabled: !canUndo },
			{ label: 'Redo', shortcut: '⇧⌘Z', disabled: !canRedo },
			{ label: 'Duplicate', shortcut: '⇧D', disabled: !selectedObject },
			{
				label: 'Delete',
				shortcut: '⌫',
				disabled: (!selectedObject && !selectedNote) || selectedObject?.locked
			}
		],
		Add: [
			{ label: 'World object…', shortcut: '⇧A' },
			{ label: 'MIDI note at playhead' },
			{ label: 'Camera keyframe' },
			{ label: 'Lighting keyframe' }
		],
		View: [
			{ label: 'Camera view' },
			{ label: 'Perspective view' },
			{ label: 'Frame all', shortcut: 'Home' },
			{ label: 'Frame selected', shortcut: 'F' },
			{ label: showTrajectory ? 'Hide trajectory' : 'Show trajectory' },
			{ label: showGrid ? 'Hide grid' : 'Show grid' },
			{ label: 'Toggle panels', shortcut: '⇧Space' },
			{ label: orbitAroundSelection ? '✓ Orbit around selection' : 'Orbit around selection' }
		],
		Help: [
			{ id: 'help', label: 'Controls & workflow' },
			{ id: 'projects', label: 'Example projects…' },
			{ id: 'commands', label: 'Search commands', shortcut: 'F3' }
		]
	};
	function exportMidiFile() {
		try {
			downloadFile(
				new Blob([new Uint8Array(exportMidi(project))], { type: 'audio/midi' }),
				`${project.name}.mid`
			);
		} catch (error) {
			setToast(error instanceof Error ? error.message : 'MIDI could not be exported.');
		}
	}

	function runMenuAction(group: string, index: number) {
		switch (`${group}:${index}`) {
			case 'Edit:0':
				history.undo();
				break;
			case 'Edit:1':
				history.redo();
				break;
			case 'Edit:2':
				duplicateSelection();
				break;
			case 'Edit:3':
				deleteSelection();
				break;
			case 'Add:0':
				changeLibrary(true);
				break;
			case 'Add:1':
				addNoteAtPlayhead();
				break;
			case 'Add:2':
				addCameraKeyframe();
				break;
			case 'Add:3':
				addLightingKeyframe();
				break;
			case 'View:0':
				setView('camera');
				break;
			case 'View:1':
				enterOrbitView();
				break;
			case 'View:2':
				enterOrbitView();
				sceneRef.current?.frameAll();
				break;
			case 'View:3':
				enterOrbitView();
				sceneRef.current?.frameSelected(selectionFrameId);
				break;
			case 'View:4':
				setShowTrajectory(!showTrajectory);
				break;
			case 'View:5':
				setShowGrid(!showGrid);
				break;
			case 'View:6':
				setExpandedPreview(!expandedPreview);
				break;
			case 'View:7':
				setOrbitAroundSelection((value) => !value);
				break;
		}
	}

	return (
		<>
			<input
				ref={inputRef}
				className="visually-hidden"
				type="file"
				accept=".marble,.json"
				aria-label="Open MidiMarble project"
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void importFile(file, 'project');
					event.target.value = '';
				}}
			/>
			<input
				ref={midiInputRef}
				className="visually-hidden"
				type="file"
				accept=".mid,.midi"
				aria-label="Import MIDI file"
				onChange={(event) => {
					const file = event.target.files?.[0];
					if (file) void importFile(file, 'midi');
					event.target.value = '';
				}}
			/>
			<main
				inert={projectBrowserOpen}
				ref={panelRef}
				className={`studio workspace-${workspace} ${expandedPreview ? 'expanded-preview' : ''} ${!inspectorOpen ? 'properties-hidden' : ''}`}
			>
				<header className="app-header">
					<button
						className="app-symbol"
						title="Projects"
						aria-label="Projects"
						disabled={exporting}
						onClick={showProjects}
					>
						◉
					</button>
					<nav className="main-menus" aria-label="Application menus">
						{menuNames.map((name) => (
							<div className="menu-wrap" key={name}>
								<button
									className={menu === name ? 'active' : ''}
									aria-expanded={menu === name}
									onClick={() => setMenu(menu === name ? null : name)}
								>
									{name}
								</button>
								{menu === name && (
									<div className="app-menu">
										{menuItems[name]?.map((item, index) => (
											<button
												key={item.label}
												disabled={item.disabled || exporting}
												onClick={() => {
													if (item.id != null) runCommand(item.id);
													else runMenuAction(name, index);
													setMenu(null);
												}}
											>
												{item.label}
												<kbd>{item.shortcut}</kbd>
											</button>
										))}
									</div>
								)}
							</div>
						))}
					</nav>
					<div className="workspace-tabs" role="tablist" aria-label="Workspace">
						{(['layout', 'animation', 'render'] as const).map((name) => (
							<button
								key={name}
								role="tab"
								aria-selected={workspace === name}
								title={
									name === 'layout'
										? 'Arrange objects with materials, wall and grid'
										: name === 'animation'
											? 'Edit music and camera timing'
											: 'Clean camera preview and video export'
								}
								className={workspace === name ? 'active' : ''}
								disabled={exporting}
								onClick={() => changeWorkspace(name)}
							>
								{name[0]?.toUpperCase()}
								{name.slice(1)}
							</button>
						))}
					</div>
					<select
						className="workspace-select"
						aria-label="Workspace"
						value={workspace}
						disabled={exporting}
						onChange={(event) => changeWorkspace(event.target.value as TEditorWorkspace)}
					>
						<option value="layout">Layout</option>
						<option value="animation">Animation</option>
						<option value="render">Render</option>
					</select>
					<div className="project-title">
						<TextInput
							key={project.id}
							label="Project title"
							value={project.name}
							disabled={exporting}
							onChange={(name) => updateProject({ name })}
						/>
						<span
							className="saved-indicator"
							title={
								saveState === 'error'
									? 'Autosave unavailable. Download your project to keep it.'
									: savedProject === project
										? 'Autosaved on this device'
										: 'Saving changes…'
							}
						>
							{saveState === 'error' ? (
								<CircleAlert size={12} />
							) : saveState === 'saved' && savedProject === project ? (
								<Check size={11} />
							) : (
								<span>•</span>
							)}
						</span>
					</div>
					<button
						className="icon-button"
						aria-label="Open project"
						title="Open project"
						disabled={importing || exporting}
						onClick={() => inputRef.current?.click()}
					>
						<FolderOpen size={14} />
					</button>
					<button
						className="export-button"
						disabled={compiling || !performance || !!sceneError || exporting}
						onClick={() => setModal('export')}
					>
						<Download size={13} />
						Export
					</button>
				</header>
				<div className="workspace">
					{!expandedPreview && (
						<>
							<ObjectTree
								key={project.id}
								project={project}
								selectedId={selectedObjectId}
								entity={entity}
								selectedMarbleId={selectedMarbleId}
								onSelectMarble={selectMarble}
								onSelect={selectObject}
								onEntity={selectEntity}
								onUpdate={updateObjectById}
								onDuplicate={duplicateSelection}
								onDelete={deleteSelection}
								onLink={beginLink}
								onDropObject={linkObject}
								onDragObject={(id) => {
									setDraggingObjectId(id);
									if (id) setToast('Drop this object onto a MIDI note to link it.');
								}}
								onFrame={(id) => {
									enterOrbitView();
									sceneRef.current?.frameSelected(id ?? selectionFrameId);
								}}
							/>
							<div
								className="panel-resizer vertical"
								role="separator"
								aria-label="Resize outliner"
								onPointerDown={(event) => resizePanel(event, 'outliner')}
							/>
						</>
					)}
					<section
						className={`viewport-column ${compiling ? 'rebuilding' : ''}`}
						aria-label="3D editor"
					>
						<div className="viewport-header">
							<span className="editor-type">
								<BoxIcon />
								Object Mode
							</span>
							<button data-menu-trigger onClick={() => setMenu(menu === 'View' ? null : 'View')}>
								View
							</button>
							<button data-add-trigger onClick={() => changeLibrary(!addOpen)}>
								Add
							</button>
							<span className="header-spacer" />
							<button
								aria-label="Search commands"
								title="Search commands (F3)"
								onClick={() => setModal('commands')}
							>
								⌕
							</button>
							<button
								className={showSceneHelpers && view === 'orbit' ? 'active' : ''}
								aria-label="Toggle camera and light helpers"
								aria-pressed={showSceneHelpers && view === 'orbit'}
								title={
									view === 'orbit'
										? 'Camera and light helpers'
										: 'Camera and lights are visible in User Perspective'
								}
								disabled={view !== 'orbit'}
								onClick={() => setShowSceneHelpers((visible) => !visible)}
							>
								<Lightbulb size={14} />
							</button>
							<button
								className={showGrid ? 'active' : ''}
								aria-label="Toggle grid"
								aria-pressed={showGrid}
								title="Grid"
								onClick={() => setShowGrid(!showGrid)}
							>
								<Grid3X3 size={13} />
							</button>
							<button
								className={showTrajectory ? 'active linked-text' : ''}
								aria-label="Toggle trajectory"
								aria-pressed={showTrajectory}
								title="Trajectory and note markers"
								onClick={() => setShowTrajectory(!showTrajectory)}
							>
								⌁
							</button>
							<button
								aria-label="Orbit around selected"
								aria-pressed={orbitAroundSelection}
								className={orbitAroundSelection ? 'active' : ''}
								title="Orbit around selection · middle mouse rotates around the selected object"
								onClick={() => setOrbitAroundSelection((value) => !value)}
							>
								<Focus size={13} />
							</button>
							<div className="segmented">
								<button
									aria-label="Solid shading"
									title="Solid shading"
									className={shading === 'solid' ? 'active' : ''}
									onClick={() => setShading('solid')}
								>
									◐
								</button>
								<button
									aria-label="Material preview shading"
									title="Material Preview · textures and environment"
									className={shading === 'material' ? 'active' : ''}
									onClick={() => setShading('material')}
								>
									◑
								</button>
								<button
									aria-label="Rendered shading"
									title="Rendered shading"
									className={shading === 'rendered' ? 'active' : ''}
									onClick={() => setShading('rendered')}
								>
									◉
								</button>
							</div>
							<select
								aria-label="Output aspect ratio"
								value={project.aspectRatio}
								disabled={exporting}
								onChange={(event) =>
									updateProject({ aspectRatio: event.target.value as TAspectRatio })
								}
							>
								<option>9:16</option>
								<option>16:9</option>
								<option>1:1</option>
							</select>
							<button
								aria-label="Toggle properties"
								title="Properties"
								onClick={() => setInspectorOpen(!inspectorOpen)}
							>
								<Settings2 size={14} />
							</button>
						</div>
						<div className="viewport">
							<MarbleScene
								key={project.id}
								project={project}
								scenePreview={lightingPreview}
								performance={performance}
								keepSceneVisible={previewStale}
								timeRef={timeRef}
								selectedObjectId={workspace === 'render' ? null : selectedObjectId}
								selectedNoteId={workspace === 'render' ? null : selectedNoteId}
								showTrajectory={workspace !== 'render' && showTrajectory}
								showGrid={workspace !== 'render' && showGrid}
								showSceneHelpers={workspace !== 'render' && showSceneHelpers}
								selectedEntity={workspace === 'render' ? null : helperEntity}
								onSelectEntity={selectEntity}
								onMoveEntity={moveSceneEntity}
								onBeginTransform={stop}
								shading={shading}
								selectedMarble={workspace !== 'render' && entity === 'marble'}
								selectedMarbleId={
									workspace !== 'render' && entity === 'marble' ? selectedMarbleId : null
								}
								onSelectMarble={selectMarble}
								orbitAroundSelection={orbitAroundSelection}
								onRequestOrbit={workspace === 'render' ? undefined : enterOrbitView}
								simulationProgress={
									compiling && compileProgress
										? {
												phase: compileProgress.phase,
												ratio: compileProgress.total
													? compileProgress.completed / compileProgress.total
													: 0,
												simulatedUntil: compileProgress.simulatedUntil ?? 0
											}
										: undefined
								}
								cameraContext={workspace !== 'render'}
								view={view}
								tool={workspace === 'render' ? 'select' : sceneTool}
								cameraDistance={cameraDistance}
								sceneRef={sceneRef}
								onSelectObject={selectObject}
								onSelectNote={selectNote}
								onTransformObject={transformObject}
								onUpdateObject={updateObjectById}
								onLinkObject={linkObject}
								onError={setSceneError}
							/>
							{workspace !== 'render' &&
								!project.objects.length &&
								focusTrackRequest == null &&
								!addOpen && (
									<div className="scene-start">
										{!project.notes.length ? (
											<>
												<strong>Start with your music</strong>
												<div>
													<button
														className="button primary"
														onClick={() => midiInputRef.current?.click()}
													>
														Import MIDI
													</button>
													<button className="button subtle" onClick={startWritingMusic}>
														Write notes
													</button>
												</div>
											</>
										) : (
											<>
												<strong>Your music is ready</strong>
												<button
													className="button primary"
													onClick={() => changeLibrary(true, project.notes[0]?.id)}
												>
													Add the first instrument
												</button>
											</>
										)}
									</div>
								)}
							<div className="viewport-label">
								<strong>{view === 'camera' ? 'Camera Perspective' : 'User Perspective'}</strong>
								<span>
									{selectedObject?.name ?? (entity === 'camera' ? 'Camera' : project.name)}
								</span>
							</div>
							<div className="viewport-navigation">
								<div className="axis-gizmo">
									<button
										className="axis-z"
										title="Front view"
										aria-label="Front view"
										onClick={() => {
											enterOrbitView();
											sceneRef.current?.setView('front');
										}}
									>
										Z
									</button>
									<button
										className="axis-y"
										title="Top view"
										aria-label="Top view"
										onClick={() => {
											enterOrbitView();
											sceneRef.current?.setView('top');
										}}
									>
										Y
									</button>
									<button
										className="axis-x"
										title="Right view"
										aria-label="Right view"
										onClick={() => {
											enterOrbitView();
											sceneRef.current?.setView('right');
										}}
									>
										X
									</button>
								</div>
								<button
									className={view === 'camera' ? 'active' : ''}
									aria-label="Toggle camera view"
									title="Camera / free orbit"
									onClick={() => toggleCameraView()}
								>
									<Camera size={15} />
								</button>
								<button
									aria-label="Frame selected"
									title="Frame selected (F)"
									onClick={() => {
										enterOrbitView();
										sceneRef.current?.frameSelected(selectionFrameId);
									}}
								>
									<Focus size={15} />
								</button>
								<button
									aria-label="Frame all"
									title="Frame all (Home)"
									onClick={() => {
										enterOrbitView();
										sceneRef.current?.frameAll();
									}}
								>
									<Maximize2 size={14} />
								</button>
							</div>
							{compiling && (
								<div className="simulation-status" role="status">
									<LoaderCircle className="spin" size={13} />
									{compileProgress
										? `${compileProgress.phase === 'placement' ? 'Solving placements' : 'Baking motion'} · ${Math.round((compileProgress.completed / Math.max(1, compileProgress.total)) * 100)}%${compileProgress.reused ? ` · ${compileProgress.reused} reused` : ''}`
										: 'Updating trajectory…'}
								</div>
							)}
							{sceneError && (
								<div className="viewport-error" role="alert">
									{sceneError}
								</div>
							)}
							{compileError != null && !compiling && (
								<div className="viewport-error" role="alert">
									<strong>Trajectory unavailable</strong>
									<span>{compileError}</span>
									<button type="button" className="button subtle" onClick={retryCompile}>
										Retry simulation
									</button>
								</div>
							)}
							{linkingObjectId && (
								<div className="link-banner">
									<Link2 size={14} />
									Choose a note to link <strong>{selectedObject?.name}</strong>
									<button
										aria-label="Cancel linking"
										onClick={() => {
											setLinkingObjectId(null);
											setTool('select');
										}}
									>
										<X size={13} />
									</button>
								</div>
							)}
							<FloatingTools
								tool={workspace === 'render' ? 'select' : sceneTool}
								onTool={changeTool}
								onAdd={placeObject}
								addOpen={addOpen}
								notePlacement={project.notes.find((item) => item.id === notePlacementId) ?? null}
								placementMarbles={getProjectMarbles(project)}
								placementMarbleId={notePlacementMarbleId}
								onPlacementMarbleChange={setNotePlacementMarbleId}
								onAddOpen={(open) => {
									if (!open) setNotePlacementId(null);
									changeLibrary(open);
								}}
								disabled={exporting}
								canLink={!!selectedObject && !selectedObject.locked}
								canTransform={canTransform}
								canMove={canMove}
								disabledTransformHint={transformHint}
							/>
							<div className="viewport-bottom">
								<ContextHelp label="Viewport help">
									<p>
										<kbd>Middle drag</kbd> orbit · <kbd>Shift</kbd> + middle drag pan · scroll to
										zoom.
									</p>
									<p>
										<kbd>G</kbd> move · <kbd>R</kbd> rotate · <kbd>S</kbd> scale. Then <kbd>X</kbd>,{' '}
										<kbd>Y</kbd> or <kbd>Z</kbd> to constrain. <kbd>Esc</kbd> cancels.
									</p>
									<p>
										<kbd>F</kbd> frames the selection. Camera view shows the saved film framing.
									</p>
								</ContextHelp>
								<span>{performance?.objects.length ?? project.objects.length} objects · Y up</span>
							</div>
						</div>
					</section>
					{!expandedPreview && inspectorOpen && (
						<>
							<div
								className="panel-resizer vertical"
								role="separator"
								aria-label="Resize properties"
								onPointerDown={(event) => resizePanel(event, 'properties')}
							/>
							<PropertiesPanel
								entity={entity}
								selectedMarbleId={selectedMarbleId}
								onSelectMarble={selectMarble}
								onAddAtNote={(id) => {
									seek(project.notes.find((note) => note.id === id)?.time ?? timeRef.current);
									changeLibrary(true, id);
									setExpandedPreview(false);
								}}
								trackId={selectedTrackId}
								project={project}
								performance={performance}
								object={selectedObject}
								note={selectedNote}
								keyframeId={keyframeId}
								lightingKeyframeId={lightingKeyframeId}
								onSelectLightingKeyframe={selectLightingKeyframe}
								onAddLightingKeyframe={addLightingKeyframe}
								onDeleteLightingKeyframe={deleteLightingKeyframe}
								onPreviewLighting={setLightingPreview}
								onUseRenderedPreview={() => setShading('rendered')}
								onSelectObject={selectObject}
								time={time}
								onUpdateProject={updateProject}
								onUpdateObject={updateObject}
								onUpdateNote={updateNote}
								onLink={(noteId) => {
									if (selectedObject) linkObject(selectedObject.id, noteId);
								}}
								onUnlink={unlinkObject}
								onBeginLink={beginLink}
								onDelete={deleteSelection}
								onDuplicate={duplicateSelection}
								onSeek={seek}
								onAddCameraKeyframe={addCameraKeyframe}
								onSelectCameraKeyframe={setKeyframeId}
								cameraAnimationReady={!compiling && performance != null && sceneError == null}
								onChangeCameraSpace={changeCameraSpace}
							/>
						</>
					)}
				</div>
				<div
					className="panel-resizer horizontal"
					role="separator"
					aria-label="Resize timeline"
					onPointerDown={(event) => resizePanel(event, 'timeline')}
				/>
				<div className="transport">
					<div className="transport-left">
						<button
							aria-label="Undo"
							disabled={!canUndo || exporting}
							title="Undo (⌘Z)"
							onClick={history.undo}
						>
							<Undo2 size={13} />
						</button>
						<button
							aria-label="Redo"
							disabled={!canRedo || exporting}
							title="Redo (⇧⌘Z)"
							onClick={history.redo}
						>
							<Redo2 size={13} />
						</button>
						<span>{workspace === 'render' ? 'Camera preview' : 'Animation'}</span>
					</div>
					<div className="transport-center">
						<button
							aria-label="Jump to start"
							disabled={exporting}
							onClick={() => {
								stop();
								seek(0);
							}}
						>
							<SkipBack size={13} />
						</button>
						<button
							aria-label="Previous frame"
							disabled={exporting}
							onClick={() => seek(timeRef.current - 1 / 30)}
						>
							<ChevronLeft size={14} />
						</button>
						<button
							className="play-button"
							aria-label={playing ? 'Pause playback' : 'Play soundtrack'}
							title="Play / pause (Space)"
							disabled={compiling || !performance || exporting}
							onClick={() => void play()}
						>
							{startingAudio ? (
								<LoaderCircle className="spin" size={15} />
							) : playing ? (
								<Pause size={15} />
							) : (
								<Play size={15} fill="currentColor" />
							)}
						</button>
						<button
							aria-label="Next frame"
							disabled={exporting}
							onClick={() => seek(timeRef.current + 1 / 30)}
						>
							<ChevronRight size={14} />
						</button>
						<button
							aria-label="Jump to end"
							disabled={exporting}
							onClick={() => {
								stop();
								seek(project.duration);
							}}
						>
							<SkipForward size={13} />
						</button>
						<button
							className={loop ? 'active' : ''}
							aria-label="Loop playback"
							aria-pressed={loop}
							onClick={() => setLoop(!loop)}
						>
							<Repeat2 size={13} />
						</button>
						<input
							aria-label="Current frame"
							type="number"
							min={0}
							max={Math.round(project.duration * 30)}
							value={Math.round(time * 30)}
							onChange={(event) => seek(Number(event.target.value) / 30)}
						/>
						<span className="time-display">{formatTime(time)}</span>
					</div>
					<div className="transport-right">
						<Volume2 size={13} />
						<input
							type="range"
							aria-label="Playback volume"
							min={0}
							max={1}
							step={0.05}
							value={volume}
							onChange={(event) => setVolume(Number(event.target.value))}
						/>
						<span>End {Math.round(project.duration * 30)}</span>
					</div>
				</div>
				<Timeline
					focusRequest={focusTrackRequest}
					disabled={exporting}
					selectedLightingKeyframeId={lightingKeyframeId}
					onSelectLightingKeyframe={selectLightingKeyframe}
					onAddLightingKeyframe={addLightingKeyframe}
					onMoveLightingKeyframe={moveLightingKeyframe}
					onDeleteLightingKeyframe={deleteLightingKeyframe}
					key={project.id}
					project={project}
					performance={performance}
					time={time}
					timeRef={timeRef}
					playing={playing}
					fps={30}
					selectedNoteId={selectedNote?.id ?? null}
					selectedObjectId={selectedObjectId}
					selectedCameraKeyframeId={keyframeId}
					linkingObjectId={linkingObjectId}
					draggingObjectId={draggingObjectId}
					onLinkObject={linkObject}
					onSeek={seek}
					onSelectNote={selectNote}
					onSelectObject={selectObject}
					onUpdateNote={updateNote}
					onUpdateNotes={updateNotes}
					onDeleteNotes={deleteNotes}
					onAddNotes={addNotes}
					onClipboardMessage={setToast}
					onAddNote={addNote}
					onAddTrack={addTrack}
					onSelectTrack={selectTrack}
					onFocusMidi={(id) => {
						if (id) selectTrack(id);
					}}
					onAuditionNote={(midi, trackId) => {
						const track = project.tracks.find((item) => item.id === trackId);
						if (track)
							void auditionNote(midi, track).catch((error: unknown) =>
								setToast(error instanceof Error ? error.message : 'Could not preview this note.')
							);
					}}
					onDeleteNote={deleteNote}

					onMuteTrack={(id) =>
						history.update((draft) => {
							const track = draft.tracks.find((item) => item.id === id);
							if (track) track.muted = !track.muted;
						})
					}
					onSoloTrack={(id) =>
						history.update((draft) => {
							const track = draft.tracks.find((item) => item.id === id);
							if (track) track.solo = !track.solo;
						})
					}
					onAddCameraKeyframe={addCameraKeyframe}
					onSelectCameraKeyframe={(id) => {
						setKeyframeId(id);
						selectEntity('camera');
					}}
					onDeleteCameraKeyframe={(id) => {
						history.update((draft) => {
							if (draft.camera)
								draft.camera.keyframes = draft.camera.keyframes.filter((key) => key.id !== id);
						});
						setKeyframeId(null);
					}}
					onUpdateCameraKeyframe={(id, at) =>
						history.update((draft) => {
							const key = draft.camera?.keyframes.find((item) => item.id === id);
							if (key) key.time = Math.max(0, Math.min(draft.duration, at));
						})
					}
				/>
				<footer className="app-status">
					<span>
						<i
							className={compiling ? 'status-working' : 'status-ready'}
							data-failed={!compiling && compileError != null}
						/>
						{compiling ? 'Simulating' : contactStatus}
						{performance?.warnings.length
							? ` · ${performance.warnings.length} timing warnings`
							: ''}
					</span>
					<span>
						MidiMarble · local project · 30 fps{' '}
						<button aria-label="Help" onClick={() => setModal('help')}>
							<CircleHelp size={12} />
						</button>
					</span>
				</footer>
				{toast && (
					<div className="toast" role={notification?.localSaveError ? 'alert' : 'status'}>
						{notification?.localSaveError ? <CircleAlert size={14} /> : <Check size={14} />}
						<span>{toast}</span>
						{notification?.localSaveError && (
							<button onClick={saveProject}>Download project</button>
						)}
						{notification?.projectDownload && projectDownload.file != null && (
							<a href={projectDownload.file.url} download={projectDownload.file.name}>
								Download project
							</a>
						)}
						<button aria-label="Dismiss notification" onClick={() => setToast(null)}>
							<X size={14} />
						</button>
					</div>
				)}
				{startingAudio && (
					<div className="audio-loading" role="status">
						<LoaderCircle size={14} className="spin" />
						Preparing instrument bank & soundtrack…
					</div>
				)}
				{modal && (
					<Dialog
						focusKey={modal}
						dismissible={!exporting}
						onClose={() => setModal(null)}
						onEscape={exporting ? videoExport.cancel : undefined}
					>
						{modal === 'commands' && (
							<CommandPalette commands={editorCommands} onRun={runCommand} />
						)}
						{modal === 'export' && <ExportPanel project={project} videoExport={videoExport} />}
						{modal === 'switch-project' && pendingProjectSwitch != null && (
							<>
								<h1 id="modal-title">Keep a copy before switching</h1>
								<p role="alert">{pendingProjectSwitch.error}</p>
								<p>
									Download {project.name} and save the file before opening{' '}
									{pendingProjectSwitch.project.name}. Your current project stays open until you
									choose to continue.
								</p>
								<p>
									<button
										className="button primary full"
										onClick={() => {
											saveProject();
											setPendingProjectSwitch({
												...pendingProjectSwitch,
												downloadedProject: history.getSnapshot().project
											});
										}}
									>
										Download current project
									</button>
									{pendingProjectSwitch.downloadedProject === project &&
										projectDownload.file != null && (
											<a href={projectDownload.file.url} download={projectDownload.file.name}>
												Download again if the browser blocked it
											</a>
										)}
								</p>
								<p>
									<button
										className="button full"
										disabled={pendingProjectSwitch.downloadedProject !== project}
										onClick={() => {
											void openProject(pendingProjectSwitch.project, true);
										}}
									>
										Continue without autosave
									</button>
								</p>
								<button
									className="button full"
									onClick={() => {
										setPendingProjectSwitch(null);
										setModal(null);
									}}
								>
									Keep editing
								</button>
							</>
						)}
						{modal === 'file-error' && fileError != null && (
							<>
								<h1 id="modal-title">
									Couldn’t open {fileError.kind === 'project' ? 'project' : 'MIDI'}
								</h1>
								<p role="alert">{fileError.message}</p>
								<button
									className="button primary full"
									onClick={() => {
										setModal(null);
										(fileError.kind === 'project' ? inputRef : midiInputRef).current?.click();
									}}
								>
									Choose another file
								</button>
							</>
						)}

						{(modal === 'help' || modal === 'settings') && (
							<EditorDialogs
								modal={modal}
								project={project}
								onGravityChange={(gravity) => updateProject({ gravity })}
								onClose={() => setModal(null)}
							/>
						)}
					</Dialog>
				)}
			</main>
			{projectBrowserOpen && (
				<ProjectBrowser
					currentProjectName={hasWorkingProject ? project.name : undefined}
					recentProjects={session.recentProjects.filter((item) => item.id !== project.id)}
					archivedProjects={session.archivedProjects}
					examples={exampleProjects}
					loadingExampleId={loadingExampleId}
					loadingRecentId={loadingRecentId}
					loadingProjectId={loadingLibraryProjectId}
					saving={saveState === 'saving' || savedProject !== project}
					saveFailed={saveState === 'error'}
					error={browserError}
					onNew={(preset) => {
						void openProject(createStudioProject(preset));
					}}
					onOpenProject={() => inputRef.current?.click()}
					onImportMidi={() => midiInputRef.current?.click()}
					onOpenExample={(id) => {
						void openExample(id);
					}}
					onOpenRecent={(id) => {
						void openRecent(id);
					}}
					onDownloadCurrent={hasWorkingProject ? saveProject : undefined}
					onArchiveProject={(id) => {
						void changeProjectArchive(id, true);
					}}
					onRestoreProject={(id) => {
						void changeProjectArchive(id, false);
					}}
					onContinue={hasWorkingProject ? () => setProjectBrowserOpen(false) : undefined}
				/>
			)}
		</>
	);
};

interface TEditorNotification {
	message: string;
	projectDownload?: boolean;
	localSaveError?: boolean;
}
const BoxIcon: React.FC = () => <span className="mode-icon">◇</span>;
