import { describe, expect, it } from 'vitest';
import { createProject, type TProject } from '@/modules/project';
import { StudioCx } from './StudioCx';

function opened(): StudioCx {
	const cx = new StudioCx();
	(cx as unknown as { load: (project: TProject, path: string) => void }).load(createProject({ title: 'Song' }), '/tmp/Song.marble');
	return cx;
}

describe('Revert to Opened', () => {
	it('should have nothing to revert until an edit, and again after undoing it', () => {
		const cx = opened();
		expect(cx.canRevert()).toBe(false);
		cx.execute([{ type: 'setEnd', end: 42 }]);
		expect(cx.canRevert()).toBe(true);
		cx.undo();
		expect(cx.canRevert()).toBe(false);
	});

	it('should ask first, go back as one named step, and undo', async () => {
		const cx = opened();
		const before = cx.project?.end;
		cx.execute([{ type: 'setEnd', end: 42 }]);

		const canceled = cx.revertToOpened();
		cx.answerConfirm(false);
		await canceled;
		expect(cx.project?.end).toBe(42);

		const reverted = cx.revertToOpened();
		expect(cx.$confirmPrompt.get()?.action).toBe('Revert');
		cx.answerConfirm(true);
		await reverted;
		expect(cx.project?.end).toBe(before);
		expect(cx.undoLabel).toBe('Revert to Opened');

		cx.undo();
		expect(cx.project?.end).toBe(42);
	});
});
