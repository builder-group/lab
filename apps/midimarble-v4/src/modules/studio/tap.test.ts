import { readFileSync } from 'node:fs';
import { createState } from 'feature-state';
import { describe, expect, it, vi } from 'vitest';
import { earliestHitTime, releaseFollowsFirstHit } from '@/modules/building';
import { createProject, parseProject, type TEntity, type TProject, type TProjectCommand } from '@/modules/project';
import { addHit } from './menus';
import { StudioCx } from './StudioCx';
import { tapTime } from './tap';

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

	it('should add a hit at the playhead for T while stopped, without starting playback', () => {
		const cx = studio(noSong);
		cx.$playhead.set(1.25);

		cx.tapHit();

		expect(cx.$playing.get()).toBe(false);
		const commands = cx.execute.mock.calls[0] as unknown as [{ hits: { time: number }[] }[]];
		expect(commands[0][0]?.hits[0]?.time).toBe(1.25);
	});

	it('should place T at 0:00 at the earliest reachable time, move the playhead there and keep adding', () => {
		const marble = noSong.music.marbles[0];
		if (marble == null) throw new Error('A new project has a marble');
		const cx = studio(noSong);
		const earliest = earliestHitTime(noSong, marble.id) ?? 0;
		expect(earliest).toBeGreaterThan(0);

		cx.tapHit();

		const placed = cx.execute.mock.calls[0] as unknown as [{ hits: { time: number }[] }[]];
		expect(placed[0][0]?.hits[0]?.time).toBe(earliest);
		expect(cx.$playhead.get()).toBe(earliest);

		const next = studio({ ...noSong, music: { ...noSong.music, marbles: [{ ...marble, hits: [{ id: 'a', time: earliest }] }] } });
		next.$playhead.set(earliest);

		next.tapHit();

		const added = next.execute.mock.calls[0] as unknown as [{ hits: { time: number }[] }[]];
		expect(added[0][0]?.hits[0]?.time).toBeCloseTo(earliest + 0.5);
		expect(next.$playhead.get()).toBeCloseTo(earliest + 0.5);
	});

	it('should release a marble with no track before its first hit, and leave it once it has pieces', () => {
		const marble = noSong.music.marbles[0];
		if (marble == null) throw new Error('A new project has a marble');
		const commands: TProjectCommand[] = [{ type: 'upsertHits', marbleId: marble.id, hits: [{ id: 'a', time: 3 }] }];
		const hit = { ...noSong, music: { ...noSong.music, marbles: [{ ...marble, hits: [{ id: 'a', time: 3 }] }] } };

		expect(releaseFollowsFirstHit(noSong, hit, commands).entities[0]?.components.release?.time).toBe(2.5);
		const later = { ...hit, music: { ...hit.music, marbles: [{ ...marble, hits: [{ id: 'a', time: 3 }, { id: 'b', time: 4 }] }] } };
		expect(releaseFollowsFirstHit(hit, later, commands)).toBe(later);
		const piece = { id: 'p', components: { piece: { type: 'platform', params: {} } } } as unknown as TEntity;
		const tracked = { ...hit, entities: [...hit.entities, piece] };
		expect(releaseFollowsFirstHit(noSong, tracked, commands)).toBe(tracked);
	});

	it('should place a hit by hand without a Song and without a pitch', () => {
		const cx = studio(noSong);
		const marble = noSong.music.marbles[0];
		if (marble == null) throw new Error('A new project has a marble');

		addHit(cx as unknown as StudioCx, marble, 1);

		const commands = cx.execute.mock.calls[0] as unknown as [{ hits: { pitch?: number }[] }[]];
		expect(commands[0][0]?.hits[0]?.pitch).toBeUndefined();
	});

	it('should tap along in the Tap Along fixture, which brings its recording', () => {
		const [isOk, error, fixture] = parseProject(readFileSync(new URL('../../../fixtures/tap-along.marble.json', import.meta.url), 'utf8'));
		if (!isOk) throw error;
		const cx = studio(fixture);
		cx.$playing.set(true);

		cx.tapHit();

		const commands = cx.execute.mock.calls[0] as unknown as [{ hits: { time: number }[] }[]];
		expect(commands[0][0]?.hits[0]?.time).toBe(1);
	});
});

describe('stepHit method', () => {
	function stepping(workspace: 'track' | 'film'): StudioCx {
		const base = createProject({ title: 'Two' });
		const marble = base.music.marbles[0];
		if (marble == null) throw new Error('A new project has a marble');
		const project: TProject = { ...base, music: { ...base.music, marbles: [{ ...marble, hits: [{ id: 'a', time: 1 }, { id: 'b', time: 2 }] }] } };
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

	it('should move to the next hit and select it in Track', () => {
		const cx = stepping('track');

		expect(cx.stepHit(1)).toBe(true);

		expect(cx.$playhead.get()).toBe(1);
		expect(cx.$selection.get()).toHaveLength(1);
		expect(cx.$selection.get()[0]).toContain(':a');
	});

	it('should keep the selection in Film, where the Scene stays in view', () => {
		const cx = stepping('film');

		cx.stepHit(1);

		expect(cx.$playhead.get()).toBe(1);
		expect(cx.$selection.get()).toEqual([]);
	});
});
