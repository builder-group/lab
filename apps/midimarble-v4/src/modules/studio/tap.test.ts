import { readFileSync } from 'node:fs';
import { createState } from 'feature-state';
import { describe, expect, it, vi } from 'vitest';
import { createProject, parseProject, type TProject } from '@/modules/project';
import { addHit } from './menus';
import { StudioCx } from './StudioCx';
import { TAP_COUNT_IN_SECONDS, tapTime } from './tap';

describe('tapTime', () => {
	it('should round the tap to 0.1 ms', () => {
		expect(tapTime([], 1.234567)).toBe(1.2346);
	});

	it('should merge a tap within 50 ms of an existing hit', () => {
		expect(tapTime([{ time: 1 }], 1.03)).toBeNull();
		expect(tapTime([{ time: 1 }], 0.96)).toBeNull();
	});

	it('should add a tap 50 ms or more from every hit', () => {
		expect(tapTime([{ time: 1 }], 1.06)).toBe(1.06);
		expect(tapTime([{ time: 1 }, { time: 2 }], 1.5)).toBe(1.5);
	});

	it('should record nothing in the count-in after the press that started playback', () => {
		// Playback started at 0:00
		const countInEnd = TAP_COUNT_IN_SECONDS;
		expect(tapTime([], 0, countInEnd)).toBeNull();
		expect(tapTime([], 0.06, countInEnd)).toBeNull();
		expect(tapTime([], 0.31, countInEnd)).toBe(0.31);
	});
});

/** The parts of the studio that tapping and placing use, around the real methods */
function studio(project: TProject) {
	const fake = {
		project,
		$playing: createState(false),
		$playhead: createState(0),
		$selection: createState<string[]>([]),
		audio: { isPlaying: () => true, getTime: () => 1 },
		notify: vi.fn(),
		execute: vi.fn(() => true),
		tapHit: StudioCx.prototype.tapHit
	};
	return fake;
}

describe('hits work without a Song', () => {
	const noSong = createProject({ title: 'Empty' });

	it('should start playback for T without a Song, with no notice asking for one', () => {
		const cx = studio(noSong);

		cx.tapHit();

		expect(cx.$playing.get()).toBe(true);
		expect(cx.notify.mock.calls[0]?.[0]).toMatch(/^Playing: press T on each beat/);
	});

	it('should place a hit by hand without a Song and without a pitch', () => {
		const cx = studio(noSong);
		const lane = noSong.music.lanes[0];
		if (lane == null) throw new Error('A new project has a marble');

		addHit(cx as unknown as StudioCx, lane, 1);

		const commands = cx.execute.mock.calls[0] as unknown as [{ hits: { pitch?: number }[] }[]];
		expect(commands[0][0]?.hits[0]?.pitch).toBeUndefined();
	});

	it('should tap along in the Tap Along fixture, which brings its recording', () => {
		const [isOk, error, fixture] = parseProject(readFileSync(new URL('../../../fixtures/tap-along.marble.json', import.meta.url), 'utf8'));
		if (!isOk) throw error;
		const cx = studio(fixture);

		cx.tapHit();

		expect(cx.$playing.get()).toBe(true);
		expect(cx.notify.mock.calls[0]?.[0]).toMatch(/^Playing: press T on each beat/);
	});
});

describe('stepHit method', () => {
	function stepping(workspace: 'compose' | 'design'): StudioCx {
		const base = createProject({ title: 'Two' });
		const lane = base.music.lanes[0];
		if (lane == null) throw new Error('A new project has a marble');
		const project: TProject = { ...base, music: { ...base.music, lanes: [{ ...lane, hits: [{ id: 'a', time: 1 }, { id: 'b', time: 2 }] }] } };
		const cx = {
			project,
			$playhead: createState(0),
			$playheadReveal: createState(0),
			$selection: createState<string[]>([]),
			$workspace: createState(workspace),
			seek: StudioCx.prototype.seek,
			stepHit: StudioCx.prototype.stepHit
		};
		return cx as unknown as StudioCx;
	}

	it('should move to the next hit and select it in Compose', () => {
		const cx = stepping('compose');

		expect(cx.stepHit(1)).toBe(true);

		expect(cx.$playhead.get()).toBe(1);
		expect(cx.$selection.get()).toHaveLength(1);
		expect(cx.$selection.get()[0]).toContain(':a');
	});

	it('should keep the selection in Film, where the Scene stays in view', () => {
		const cx = stepping('design');

		cx.stepHit(1);

		expect(cx.$playhead.get()).toBe(1);
		expect(cx.$selection.get()).toEqual([]);
	});
});
