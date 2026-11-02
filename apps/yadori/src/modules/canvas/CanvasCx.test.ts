import { describe, expect, it, vi } from 'vitest';
import { libraryItems } from '../library/data';
import { createLibraryPart, createProject, executeCommands, type TProject } from '../project/model';
import { CanvasCx, type TCanvasBindings } from './CanvasCx';

function setup(): { cx: CanvasCx; project: () => TProject; dispose: () => void } {
	const item = libraryItems.find((entry) => entry.id === 'victron-lithium-smart-12-200');
	if (!item) throw new Error('Battery library fixture missing');
	let project = executeCommands(createProject('Canvas test'), [
		{ type: 'part.add', part: createLibraryPart(item, { id: 'battery', buildState: 'in-build' }) }
	]);
	const bindings: TCanvasBindings = {
		project,
		onCommand: (commands) => {
			project = executeCommands(project, commands);
			cx.bind({ ...bindings, project });
		},
		onSelectPart: vi.fn(),
		onAddPreset: vi.fn()
	};
	const cx = new CanvasCx(bindings);
	return { cx, project: () => project, dispose: cx.mount() };
}

describe('canvas build interactions', () => {
	it('should select an existing unit without changing quantity or jumping the camera', () => {
		const { cx, project, dispose } = setup();
		const part = project().parts[0];
		if (!part) throw new Error('Missing test part');
		cx.place(part, { x: 100, y: 100 });
		cx.place(part, { x: 500, y: 100 });
		expect(project().instances).toHaveLength(1);
		expect(project().placements).toHaveLength(1);
		expect(project().parts[0]?.quantity).toBe(1);
		expect(cx.$focus.get()).toBeNull();
		expect(cx.$selection.get()?.id).toBe(project().placements[0]?.id);
		dispose();
	});
	it('should place an explicit additional unit without covering the existing device', () => {
		const { cx, project, dispose } = setup();
		const part = project().parts[0];
		if (!part) throw new Error('Missing test part');
		cx.place(part, { x: 100, y: 100 });
		cx.place(part, { x: 100, y: 100 }, true);
		expect(project().parts[0]?.quantity).toBe(2);
		expect(project().placements).toHaveLength(2);
		expect(
			project().placements[0]?.xMm === project().placements[1]?.xMm &&
				project().placements[0]?.yMm === project().placements[1]?.yMm
		).toBe(false);
		dispose();
	});
	it('should draft wire requirements without purchasing stock and retain connections when unplacing a unit', () => {
		const { cx, project, dispose } = setup();
		const part = project().parts[0];
		if (!part) throw new Error('Missing test part');
		cx.place(part, { x: 100, y: 100 });
		cx.place(part, { x: 600, y: 100 }, true);
		const [a, b] = project().instances;
		if (!a || !b) throw new Error('Missing test units');
		cx.connect({ instanceId: a.id, portId: 'positive' }, { instanceId: b.id, portId: 'positive' });
		expect(project().runs).toHaveLength(1);
		expect(project().purchases).toHaveLength(0);
		expect(project().stockPieces).toHaveLength(0);
		const placement = project().placements[0];
		if (!placement) throw new Error('Missing placement');
		cx.$selection.set({ kind: 'placement', id: placement.id });
		cx.removeSelection();
		expect(project().runs).toHaveLength(1);
		expect(project().parts.find((p) => p.id === 'battery')?.quantity).toBe(2);
		dispose();
	});
	it('should arm an existing linked cable without placing another equipment unit', () => {
		const item = libraryItems.find((i) => i.id === 'generic-copper-cable-6mm2');
		if (!item) throw new Error('Cable library fixture missing');
		const part = createLibraryPart(item, { buildState: 'in-build' });
		const project = executeCommands(createProject('Cable test'), [{ type: 'part.add', part }]);
		const onAddPreset = vi.fn(),
			onCommand = vi.fn();
		const cx = new CanvasCx({ project, onCommand, onAddPreset, onSelectPart: vi.fn() });
		cx.addPreset(item, { x: 100, y: 100 });
		expect(cx.$materialId.get()).toBe(part.id);
		expect(cx.$tool.get()).toBe('wire');
		expect(onAddPreset).not.toHaveBeenCalled();
		expect(onCommand).not.toHaveBeenCalled();
		expect(project.placements).toHaveLength(0);
		expect(part.quantity).toBe(0);
	});
	it('should not reuse a detached cable profile by its retained provenance', () => {
		const item = libraryItems.find((i) => i.id === 'generic-copper-cable-6mm2');
		if (!item) throw new Error('Cable library fixture missing');
		const part = createLibraryPart(item, { buildState: 'in-build' });
		let project = executeCommands(createProject('Detached cable test'), [
			{ type: 'part.add', part },
			{ type: 'part.detach', id: part.id }
		]);
		const onAddPreset = vi.fn();
		const bindings: TCanvasBindings = {
			project,
			onSelectPart: vi.fn(),
			onAddPreset,
			onCommand: (commands) => {
				project = executeCommands(project, commands);
				cx.bind({ ...bindings, project });
			}
		};
		const cx = new CanvasCx(bindings);
		cx.addPreset(item, { x: 100, y: 100 });
		expect(onAddPreset).toHaveBeenCalledOnce();
		expect(cx.$materialId.get()).toBeNull();
		expect(project.parts[0]?.libraryOrigin?.itemId).toBe(item.id);
		expect(project.parts[0]?.libraryLink).toBeNull();
	});
});
