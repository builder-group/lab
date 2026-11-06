import { afterEach, describe, expect, it, vi } from 'vitest';
import { host } from '@/environment';
import { createProject, serializeProject } from '@/modules/project';
import { StudioCx } from './StudioCx';

describe('StudioCx openProject function', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function opening(projectJson: string): { cx: StudioCx; remembered: ReturnType<typeof vi.fn> } {
		const remembered = vi.fn(async () => undefined);
		vi.spyOn(host, 'openProject').mockResolvedValue([true, null, { path: '/Song.marble', projectJson }] as never);
		vi.spyOn(host, 'rememberRecentProject').mockImplementation(remembered);
		vi.spyOn(host, 'listRecentProjects').mockResolvedValue([]);
		return { cx: new StudioCx(), remembered };
	}

	it('should add a file to Recent once it opened', async () => {
		const { cx, remembered } = opening(serializeProject(createProject({ title: 'Song' })));
		expect(await cx.openProject('/Song.marble')).toBe(true);
		expect(remembered).toHaveBeenCalledWith('/Song.marble');
	});

	it('should leave a file that failed to open out of Recent, and say why', async () => {
		const { cx, remembered } = opening('{ "title": ');
		expect(await cx.openProject('/Song.marble')).toBe(false);
		expect(remembered).not.toHaveBeenCalled();
		expect(cx.$notice.get()?.message).toMatch(/damaged/);
	});
});
