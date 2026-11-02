import { describe, expect, it, vi } from 'vitest';
import { libraryItems } from '../library/data';
import {
	createLibraryPart,
	createProject,
	executeCommands,
	getRunLengthM,
	type TProject
} from '../project/model';
import { CanvasCx, type TCanvasBindings } from './CanvasCx';
import { CanvasSceneView, createCanvasDocumentScene } from './CanvasScene';

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing fixture');
	return value;
}
function fixture(): TProject {
	const item = libraryItems.find((i) => i.id === 'victron-lithium-smart-12-200');
	if (!item) throw new Error('Battery fixture missing');
	let project = executeCommands(createProject('Scene'), [
		{ type: 'part.add', part: createLibraryPart(item, { id: 'battery', buildState: 'in-build' }) }
	]);
	const bindings: TCanvasBindings = {
		project,
		onSelectPart: vi.fn(),
		onAddPreset: vi.fn(),
		onCommand: (commands) => {
			project = executeCommands(project, commands);
			cx.bind({ ...bindings, project });
		}
	};
	const cx = new CanvasCx(bindings),
		part = required(project.parts[0]);
	cx.place(part, { x: 100, y: 100 });
	cx.place(part, { x: 600, y: 100 }, true);
	cx.place(part, { x: 1100, y: 100 }, true);
	const [a, b] = project.instances;
	if (!a || !b) throw new Error('Missing units');
	cx.connect({ instanceId: a.id, portId: 'positive' }, { instanceId: b.id, portId: 'positive' });
	return project;
}
function view(project: TProject): CanvasSceneView {
	return new CanvasSceneView(
		createCanvasDocumentScene(project),
		required(project.layouts[0]).id,
		vi.fn(),
		vi.fn()
	);
}
describe('canvas document and pointer scene separation', () => {
	it('should preserve every render object and both arrays when unrelated UI changes', () => {
		const scene = view(fixture()),
			first = scene.frame(null),
			second = scene.frame(null);
		expect(second.nodes).toBe(first.nodes);
		expect(second.edges).toBe(first.edges);
	});
	it('should only replace selected node wrappers while preserving all device data and wires', () => {
		const project = fixture(),
			scene = view(project),
			first = scene.frame(null),
			id = required(project.placements[0]).id;
		const next = scene.frame({ kind: 'placement', id });
		expect(next.nodes.filter((n, i) => n !== first.nodes[i]).map((n) => n.id)).toEqual([id]);
		expect(next.nodes.find((n) => n.id === id)?.data).toBe(
			first.nodes.find((n) => n.id === id)?.data
		);
		expect(next.edges).toBe(first.edges);
	});
	it('should preview only the moved unit and attached wires without mutating measured requirements', () => {
		const project = fixture(),
			scene = view(project),
			first = scene.frame(null),
			placement = required(project.placements[0]),
			before = getRunLengthM(project, required(project.runs[0]));
		const next = scene.frame(null, {
			[placement.id]: { x: placement.xMm + 25, y: placement.yMm + 10 }
		});
		expect(next.nodes.filter((n, i) => n !== first.nodes[i]).map((n) => n.id)).toEqual([
			placement.id
		]);
		expect(next.edges[0]?.data?.fromPoint?.x).toBe((first.edges[0]?.data?.fromPoint?.x ?? 0) + 25);
		expect(getRunLengthM(project, required(project.runs[0]))).toBe(before);
		expect(project.placements[0]?.xMm).toBe(placement.xMm);
		expect(scene.frame(null).edges[0]?.data).toBe(first.edges[0]?.data);
	});
	it('should invalidate document findings and geometry after an ordinary command', () => {
		const project = fixture(),
			placement = required(project.placements[0]),
			before = view(project).frame(null);
		const changed = executeCommands(project, [
			{ type: 'placement.update', id: placement.id, patch: { xMm: 400 } }
		]);
		const after = view(changed).frame(null);
		expect(after.nodes.find((n) => n.id === placement.id)?.position.x).toBe(400);
		expect(before.nodes.find((n) => n.id === placement.id)?.position.x).toBe(100);
	});
});
