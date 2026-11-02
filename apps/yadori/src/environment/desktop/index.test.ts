import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportProject, registerDesktopCloseGuard } from './index';

const mock = vi.hoisted(() => ({
	invoke: vi.fn(),
	listen: vi.fn(),
	close: vi.fn(),
	destroy: vi.fn(),
	unlistenClose: vi.fn(),
	unlistenQuit: vi.fn(),
	quitCallback: null as ((event: unknown) => void) | null,
	closeCallback: null as ((event: { preventDefault(): void }) => void) | null
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mock.listen }));
vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({ onCloseRequested: mock.close, destroy: mock.destroy })
}));

beforeEach(() => {
	vi.clearAllMocks();
	mock.quitCallback = null;
	mock.closeCallback = null;
	mock.invoke.mockResolvedValue(undefined);
	mock.destroy.mockResolvedValue(undefined);
	mock.listen.mockImplementation(async (_event, callback) => {
		mock.quitCallback = callback;
		return mock.unlistenQuit;
	});
	mock.close.mockImplementation(async (callback) => {
		mock.closeCallback = callback;
		return mock.unlistenClose;
	});
});
describe('registerDesktopCloseGuard function', () => {
	it('should register native quit protection only after both JS listeners exist and unregister its own token', async () => {
		const cleanup = await registerDesktopCloseGuard(async () => true);
		expect(mock.listen).toHaveBeenCalledWith('desktop-quit-requested', expect.any(Function));
		expect(mock.close).toHaveBeenCalledOnce();
		const registration = mock.invoke.mock.calls.find(
			(call) => call[0] === 'register_desktop_quit_guard'
		);
		expect(registration?.[1]).toEqual({ guardId: expect.any(String) });
		cleanup();
		expect(mock.invoke).toHaveBeenCalledWith('unregister_desktop_quit_guard', registration?.[1]);
		expect(mock.unlistenClose).toHaveBeenCalledOnce();
		expect(mock.unlistenQuit).toHaveBeenCalledOnce();
	});
	it('should wait for flushing before closing the window', async () => {
		let resolve: ((value: boolean) => void) | undefined;
		const flush = vi.fn(
			() =>
				new Promise<boolean>((done) => {
					resolve = done;
				})
		);
		const cleanup = await registerDesktopCloseGuard(flush);
		const event = { preventDefault: vi.fn() };
		mock.closeCallback?.(event);
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(mock.destroy).not.toHaveBeenCalled();
		resolve?.(true);
		await vi.waitFor(() => expect(mock.destroy).toHaveBeenCalledOnce());
		cleanup();
	});
	it('should coalesce Cmd-Q with a pending window flush and approve app exit instead of destroying', async () => {
		let resolve: ((value: boolean) => void) | undefined;
		const flush = vi.fn(
			() =>
				new Promise<boolean>((done) => {
					resolve = done;
				})
		);
		const cleanup = await registerDesktopCloseGuard(flush);
		mock.closeCallback?.({ preventDefault: vi.fn() });
		mock.quitCallback?.({});
		mock.quitCallback?.({});
		expect(flush).toHaveBeenCalledOnce();
		expect(mock.invoke).not.toHaveBeenCalledWith('approve_desktop_exit');
		resolve?.(true);
		await vi.waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('approve_desktop_exit'));
		expect(mock.destroy).not.toHaveBeenCalled();
		cleanup();
	});
	it('should retain the application and allow retry when saves fail', async () => {
		const flush = vi.fn().mockResolvedValue(false);
		const cleanup = await registerDesktopCloseGuard(flush);
		mock.quitCallback?.({});
		await vi.waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('reject_desktop_exit'));
		expect(mock.destroy).not.toHaveBeenCalled();
		expect(mock.invoke).not.toHaveBeenCalledWith('approve_desktop_exit');
		flush.mockResolvedValue(true);
		mock.quitCallback?.({});
		await vi.waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('approve_desktop_exit'));
		cleanup();
	});
	it('should not close or approve exit after a guard is disposed during flushing', async () => {
		let resolve: ((value: boolean) => void) | undefined;
		const cleanup = await registerDesktopCloseGuard(
			() =>
				new Promise<boolean>((done) => {
					resolve = done;
				})
		);
		mock.quitCallback?.({});
		cleanup();
		resolve?.(true);
		await vi.waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('reject_desktop_exit'));
		expect(mock.invoke).not.toHaveBeenCalledWith('approve_desktop_exit');
		expect(mock.destroy).not.toHaveBeenCalled();
	});
	it('should remove listeners if native registration fails', async () => {
		mock.invoke.mockRejectedValueOnce(new Error('Fixture registration error'));
		await expect(registerDesktopCloseGuard(async () => true)).rejects.toThrow('registration error');
		expect(mock.unlistenClose).toHaveBeenCalledOnce();
		expect(mock.unlistenQuit).toHaveBeenCalledOnce();
	});
});
describe('exportProject function', () => {
	it('should pass the current serialized project for a recovery snapshot', async () => {
		await exportProject('project', '{"unsaved":true}');
		expect(mock.invoke).toHaveBeenCalledWith('export_project', {
			projectId: 'project',
			content: '{"unsaved":true}'
		});
	});
});
